pub mod config;
pub mod session;
pub mod server;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::net::{UnixListener, UnixStream};
use tokio::time::Duration;
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use tokio_stream::StreamExt;
use async_trait::async_trait;

use crate::cap_transport::{CapTransport, TransportStream, TransportError};
use cellrix_protocol::{CapabilityManifest, AgentEvent, ActionRequest, ActionResponse};

pub use config::CellrixDaemonConfig;
pub use session::UdsSession;
pub use server::{ClientRegistry, UdsServer, ReceiverStream, verify_peer_credentials_static};

/// Role discrimination for the UDS transport.
#[derive(Debug, Clone, Copy)]
pub enum UdsRole {
    /// Server mode: binds and listens, acts as the display host
    Server,
    /// Client mode: actively connects to an existing daemon
    Client,
}

/// High-performance, fully decoupled UDS transport proxy.
pub struct UdsTransport {
    role: UdsRole,
    socket_path: PathBuf,
    config: Arc<CellrixDaemonConfig>,
    registry: Arc<ClientRegistry>,
}

impl UdsTransport {
    /// Creates a new UDS transport in Server (display host) mode.
    pub async fn new_server(socket_path: PathBuf) -> Result<Self, TransportError> {
        Ok(Self {
            role: UdsRole::Server,
            socket_path,
            config: Arc::new(CellrixDaemonConfig::load_layered()?),
            registry: Arc::new(ClientRegistry::new()),
        })
    }

    /// Creates a new UDS transport in Client (debugging) mode.
    pub async fn new_client(socket_path: PathBuf) -> Result<Self, TransportError> {
        Ok(Self {
            role: UdsRole::Client,
            socket_path,
            config: Arc::new(CellrixDaemonConfig::load_layered()?),
            registry: Arc::new(ClientRegistry::new()),
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

    /// Server mode: binds, accepts first client with timeout, then spawns UdsServer.
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

        // 7. Read CapabilityManifest as the first frame
        let first_frame = first_framed.next().await
            .ok_or_else(|| TransportError::Protocol("Client disconnected before handshake".into()))?
            .map_err(|e| TransportError::Io(e))?;

        let manifest: CapabilityManifest = rmp_serde::from_slice(&first_frame)
            .map_err(|e| TransportError::Serialization(format!("Manifest decode failed: {}", e)))?;

        // 8. Create central event multiplexing channel
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<AgentEvent, TransportError>>();

        // Register the first client under its bootstrap identity
        let client_ns = manifest.agent_name.clone();
        let (is_active, action_rx) = self.registry.register(&client_ns);

        // 9. Spawn dedicated UdsSession task to handle the first client's stream
        let session = UdsSession {
            framed: first_framed,
            is_active,
            tx: tx.clone(),
            action_rx,
            registry: self.registry.clone(),
            agent_name: client_ns,
            config: self.config.clone(), // 完美修复：补全第一路会话的 config 引用传递！
        };
        session.spawn_run();

        // 10. Spawn the background UdsServer to dispatch subsequent client connections
        let server = UdsServer {
            listener,
            registry: self.registry.clone(),
            tx,
            config: self.config.clone(),
        };
        server.spawn_run();

        let receiver_stream = ReceiverStream { inner: rx };
        Ok((manifest, Box::pin(receiver_stream)))
    }

    /// Client mode: actively connects to host, verifies identity, reads manifest
    async fn run_client_handshake(&self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        let stream = UnixStream::connect(&self.socket_path)
            .await
            .map_err(|e| TransportError::Io(e))?;

        self.verify_peer_credentials(&stream)?;

        let framed = Framed::new(stream, LengthDelimitedCodec::new());
        let mut framed = Box::pin(framed);
        let first_frame = framed.next().await
            .ok_or_else(|| TransportError::Protocol("Host disconnected before handshake".into()))?
            .map_err(|e| TransportError::Io(e))?;

        let manifest: CapabilityManifest = rmp_serde::from_slice(&first_frame)
            .map_err(|e| TransportError::Serialization(format!("Manifest decode failed: {}", e)))?;

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
    async fn connect(&mut self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        match self.role {
            UdsRole::Server => self.run_server_handshake().await,
            UdsRole::Client => self.run_client_handshake().await,
        }
    }

    /// Mechanism is separate from Policy. The UI sends a focus_swap action request,
    /// and the transport layer intercepts it, updating lock-free atomics to drive conditional parsing.
    async fn send_action(&mut self, request: ActionRequest) -> Result<ActionResponse, TransportError> {
        if request.action_id == "sys_focus_swap" {
            if let Some(target_ns) = request.parameters.get("namespace").and_then(|v| v.as_str()) {
                let clients = self.registry.clients.lock().unwrap();
                for (ns, meta) in clients.iter() {
                    if ns == target_ns {
                        meta.is_active.store(true, Ordering::Release);
                        let _ = meta.action_tx.send(ActionRequest {
                            action_id: "sys_resume".to_string(),
                            parameters: serde_json::Value::Null,
                            view_hash: None,
                        });
                    } else {
                        meta.is_active.store(false, Ordering::Release);
                        let _ = meta.action_tx.send(ActionRequest {
                            action_id: "sys_suspend".to_string(),
                            parameters: serde_json::Value::Null,
                            view_hash: None,
                        });
                    }
                }
                return Ok(ActionResponse::Success { message: "focus swapped".to_string() });
            }
        }
        Err(TransportError::NotImplemented("Action routing not yet available in UDS".into()))
    }
}
