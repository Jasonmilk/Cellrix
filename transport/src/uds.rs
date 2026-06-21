use std::path::PathBuf;
use std::sync::Arc;
use std::pin::Pin;
use tokio::net::{UnixListener, UnixStream};
use tokio::time::Duration;
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use tokio_stream::{Stream, StreamExt};
use async_trait::async_trait;

use crate::cap_transport::{CapTransport, TransportStream, TransportError};
use cellrix_protocol::{CapabilityManifest, AgentEvent, ActionRequest, ActionResponse};

/// Layered configuration resolver for the Cellrix Daemon/Client runtime.
/// Zero hardcoding: values cascade from Env -> Defaults.
#[derive(Debug, Clone)]
pub struct CellrixDaemonConfig {
    pub socket_permissions: u32,
    pub idle_shutdown_seconds: u64,
    pub enable_peer_verification: bool,
}

impl CellrixDaemonConfig {
    /// Loads configuration dynamically with zero magic numbers.
    pub fn load_layered() -> Result<Self, TransportError> {
        let mut config = Self::default();

        // 1. Resolve socket permissions mask from environment (e.g. "0600")
        if let Ok(env_val) = std::env::var("CELLRIX_SOCKET_PERMISSIONS") {
            if let Ok(parsed) = u32::from_str_radix(&env_val, 8) {
                config.socket_permissions = parsed;
            } else {
                return Err(TransportError::Protocol(format!(
                    "Invalid octal format for CELLRIX_SOCKET_PERMISSIONS: {}", env_val
                )));
            }
        }

        // 2. Resolve idle shutdown timeout
        if let Ok(env_val) = std::env::var("CELLRIX_IDLE_TIMEOUT") {
            if let Ok(parsed) = env_val.parse::<u64>() {
                config.idle_shutdown_seconds = parsed;
            } else {
                return Err(TransportError::Protocol(format!(
                    "Invalid integer for CELLRIX_IDLE_TIMEOUT: {}", env_val
                )));
            }
        }

        // 3. Resolve peer verification flag
        if let Ok(env_val) = std::env::var("CELLRIX_PEER_VERIFY") {
            if env_val.to_lowercase() == "false" || env_val == "0" {
                config.enable_peer_verification = false;
            }
        }

        Ok(config)
    }

    fn default() -> Self {
        Self {
            socket_permissions: 0o600,
            idle_shutdown_seconds: 5,
            enable_peer_verification: true,
        }
    }
}

/// Role discrimination for the UDS transport.
/// Perfectly resolves the "connect vs accept" semantic paradox as stateless unit variants.
#[derive(Debug, Clone, Copy)]
pub enum UdsRole {
    /// Server mode: binds and listens, acts as the display host (Wayland style)
    Server,
    /// Client mode: actively connects to an existing daemon (debugging tools style)
    Client,
}

/// Symmetrical adapter to map Tokio's UnboundedReceiver directly to a CapTransport-compliant Stream,
/// completely bypassing any external futures-util dependencies.
struct ReceiverStream {
    inner: tokio::sync::mpsc::UnboundedReceiver<Result<AgentEvent, TransportError>>,
}

impl Stream for ReceiverStream {
    type Item = Result<AgentEvent, TransportError>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<Option<Self::Item>> {
        self.inner.poll_recv(cx)
    }
}

/// Static, thread-safe peer credentials auditor to verify UNIX process identities.
fn verify_peer_credentials_static(stream: &UnixStream, config: &CellrixDaemonConfig) -> Result<(), TransportError> {
    if !config.enable_peer_verification {
        return Ok(());
    }

    let peer_cred = stream.peer_cred()
        .map_err(|e| TransportError::Io(e))?;

    // Standard Unix linkage block to retrieve current process UID natively
    extern "C" {
        fn getuid() -> u32;
    }
    let current_uid = unsafe { getuid() };

    if peer_cred.uid() != current_uid {
        return Err(TransportError::Protocol(format!(
            "Security: Peer UID mismatch! Host UID is {}, Peer UID is {}",
            current_uid, peer_cred.uid()
        )));
    }
    Ok(())
}

/// High-performance, zero-overhead UDS transport supporting dual-mode operation and multi-client routing.
pub struct UdsTransport {
    role: UdsRole,
    socket_path: PathBuf,
    config: Arc<CellrixDaemonConfig>,
}

impl UdsTransport {
    /// Creates a new UDS transport in Server (display host) mode.
    pub async fn new_server(socket_path: PathBuf) -> Result<Self, TransportError> {
        Ok(Self {
            role: UdsRole::Server,
            socket_path,
            config: Arc::new(CellrixDaemonConfig::load_layered()?),
        })
    }

    /// Creates a new UDS transport in Client (debugging / project) mode.
    pub async fn new_client(socket_path: PathBuf) -> Result<Self, TransportError> {
        Ok(Self {
            role: UdsRole::Client,
            socket_path,
            config: Arc::new(CellrixDaemonConfig::load_layered()?),
        })
    }

    /// Enforces local file permissions on the UDS socket file (Unix exclusive).
    fn apply_socket_permissions(&self) -> Result<(), TransportError> {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::metadata(&self.socket_path)
            .map_err(|e| TransportError::Io(e))?
            .permissions();
        
        let mut new_perms = perms;
        new_perms.set_mode(self.config.socket_permissions);
        std::fs::set_permissions(&self.socket_path, new_perms)
            .map_err(|e| TransportError::Io(e))
    }

    /// Validates connected peer's UID against current process UID.
    fn verify_peer_credentials(&self, stream: &UnixStream) -> Result<(), TransportError> {
        verify_peer_credentials_static(stream, &self.config)
    }

    /// Server mode: binds, accepts first client with timeout, then multiplexes subsequent connections.
    async fn run_server_handshake(&self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        // 1. Prune stale socket file safely
        let _ = std::fs::remove_file(&self.socket_path);

        // 2. Bind the OS listener
        let listener = UnixListener::bind(&self.socket_path)
            .map_err(|e| TransportError::Io(e))?;

        // 3. Enforce permission mask (0o600)
        self.apply_socket_permissions()?;

        // 4. Asynchronously wait for the FIRST connection with timeout (Lazy exit on idle)
        let timeout_duration = Duration::from_secs(self.config.idle_shutdown_seconds);
        let (first_stream, _) = match tokio::time::timeout(timeout_duration, listener.accept()).await {
            Ok(Ok(connection)) => connection,
            Ok(Err(e)) => return Err(TransportError::Io(e)),
            Err(_) => {
                // Idle timer elapsed. Perform self-destruction.
                std::process::exit(0);
            }
        };

        // 5. Audit first peer identity
        self.verify_peer_credentials(&first_stream)?;

        // 6. Wrap first stream into length-delimited codec
        let mut first_framed = Framed::new(first_stream, LengthDelimitedCodec::new());

        // 7. CIB Handshake Step 1: Read CapabilityManifest as the first frame
        let first_frame = first_framed.next().await
            .ok_or_else(|| TransportError::Protocol("Client disconnected before handshake".into()))?
            .map_err(|e| TransportError::Io(e))?;

        let manifest: CapabilityManifest = rmp_serde::from_slice(&first_frame)
            .map_err(|e| TransportError::Serialization(format!("Manifest decode failed: {}", e)))?;

        // 8. Create central event multiplexing channel
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<AgentEvent, TransportError>>();

        // 9. Spawn thread-safe task to route first client's telemetry stream
        let tx_first = tx.clone();
        tokio::spawn(async move {
            while let Some(result) = first_framed.next().await {
                match result {
                    Ok(bytes) => {
                        if let Ok(event) = rmp_serde::from_slice::<AgentEvent>(&bytes) {
                            let _ = tx_first.send(Ok(event));
                        }
                    }
                    Err(e) => {
                        let _ = tx_first.send(Err(TransportError::Io(e)));
                        break;
                    }
                }
            }
        });

        // 10. Spawn background dispatcher to handle MULTIPLE subsequent connections concurrently
        let tx_subsequent = tx.clone();
        let config_clone = self.config.clone();
        let listener_arc = Arc::new(listener);
        
        tokio::spawn(async move {
            loop {
                if let Ok((stream, _)) = listener_arc.accept().await {
                    if verify_peer_credentials_static(&stream, &config_clone).is_err() {
                        continue; // Dropping unauthorized connections
                    }

                    let tx_client = tx_subsequent.clone();
                    tokio::spawn(async move {
                        let mut framed = Framed::new(stream, LengthDelimitedCodec::new());
                        if let Some(Ok(first_frame)) = framed.next().await {
                            if let Ok(_manifest) = rmp_serde::from_slice::<CapabilityManifest>(&first_frame) {
                                while let Some(result) = framed.next().await {
                                    match result {
                                        Ok(bytes) => {
                                            if let Ok(event) = rmp_serde::from_slice::<AgentEvent>(&bytes) {
                                                let _ = tx_client.send(Ok(event));
                                            }
                                        }
                                        Err(e) => {
                                            let _ = tx_client.send(Err(TransportError::Io(e)));
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
            }
        });

        let receiver_stream = ReceiverStream { inner: rx };
        Ok((manifest, Box::pin(receiver_stream)))
    }

    /// Client mode: actively connects to host, verifies identity, reads manifest
    async fn run_client_handshake(&self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        // 1. Establish socket connection to the active host daemon
        let stream = UnixStream::connect(&self.socket_path)
            .await
            .map_err(|e| TransportError::Io(e))?;

        // 2. Audit host identity for safety
        self.verify_peer_credentials(&stream)?;

        // 3. Wrap stream into framed codec
        let framed = Framed::new(stream, LengthDelimitedCodec::new());

        // 4. CIB Handshake Step 1: Client also reads the host's capabilities or state
        let mut framed = Box::pin(framed);
        let first_frame = framed.next().await
            .ok_or_else(|| TransportError::Protocol("Host disconnected before handshake".into()))?
            .map_err(|e| TransportError::Io(e))?;

        let manifest: CapabilityManifest = rmp_serde::from_slice(&first_frame)
            .map_err(|e| TransportError::Serialization(format!("Manifest decode failed: {}", e)))?;

        // 5. Map subsequent frames to TransportStream
        let mapped_stream = framed.map(|item| {
            item.map_err(|e| TransportError::Io(e))
                .and_then(|bytes| {
                    rmp_serde::from_slice::<AgentEvent>(&bytes)
                        .map_err(|e| TransportError::Serialization(e.to_string()))
                })
        });

        Ok((manifest, Box::pin(mapped_stream)))
    }
}

#[async_trait]
impl CapTransport for UdsTransport {
    /// Unified entry point matching CIB v0.1.0 and CapTransport trait contract.
    async fn connect(&mut self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        match self.role {
            UdsRole::Server => self.run_server_handshake().await,
            UdsRole::Client => self.run_client_handshake().await,
        }
    }

    async fn send_action(&mut self, _request: ActionRequest) -> Result<ActionResponse, TransportError> {
        // [To be fully implemented in Milestone 2 (downstream action routing)]
        Err(TransportError::NotImplemented("Action routing not yet available in UDS".into()))
    }
}
