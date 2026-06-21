use std::sync::Arc;
use std::pin::Pin;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use tokio::net::{UnixListener, UnixStream};
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use tokio_stream::{Stream, StreamExt};

use crate::cap_transport::TransportError;
use cellrix_protocol::{CapabilityManifest, AgentEvent, ActionRequest};
use super::config::CellrixDaemonConfig;
use super::session::UdsSession;

/// Metadata holding the client's focus state and downstream control pipeline.
pub struct ClientMetadata {
    pub is_active: Arc<AtomicBool>,
    pub action_tx: tokio::sync::mpsc::UnboundedSender<ActionRequest>,
}

/// Central registry mapping connected client names to their state metadata.
pub struct ClientRegistry {
    pub clients: std::sync::Mutex<HashMap<String, ClientMetadata>>,
}

impl ClientRegistry {
    pub fn new() -> Self {
        Self {
            clients: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn register(
        &self, 
        agent_name: &str
    ) -> (Arc<AtomicBool>, tokio::sync::mpsc::UnboundedReceiver<ActionRequest>) {
        let mut clients = self.clients.lock().unwrap();
        
        let (action_tx, action_rx) = tokio::sync::mpsc::unbounded_channel::<ActionRequest>();
        let is_active = Arc::new(AtomicBool::new(clients.is_empty()));
        
        clients.insert(
            agent_name.to_string(),
            ClientMetadata {
                is_active: is_active.clone(),
                action_tx,
            },
        );
        (is_active, action_rx)
    }

    pub fn unregister(&self, agent_name: &str) {
        let mut clients = self.clients.lock().unwrap();
        clients.remove(agent_name);
    }
}

pub struct ReceiverStream {
    pub inner: tokio::sync::mpsc::UnboundedReceiver<Result<AgentEvent, TransportError>>,
}

impl Stream for ReceiverStream {
    type Item = Result<AgentEvent, TransportError>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<Option<Self::Item>> {
        self.inner.poll_recv(cx)
    }
}

/// Static, thread-safe peer credentials auditor to verify UNIX process identities.
pub fn verify_peer_credentials_static(stream: &UnixStream, config: &CellrixDaemonConfig) -> Result<(), TransportError> {
    if !config.enable_peer_verification {
        return Ok(());
    }

    let peer_cred = stream.peer_cred()
        .map_err(|e| TransportError::Io(e))?;

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

pub struct UdsServer {
    pub listener: UnixListener,
    pub registry: Arc<ClientRegistry>,
    pub tx: tokio::sync::mpsc::UnboundedSender<Result<AgentEvent, TransportError>>,
    pub config: Arc<CellrixDaemonConfig>,
}

impl UdsServer {
    /// Spawns the background accept loop.
    pub fn spawn_run(self) {
        let listener_arc = Arc::new(self.listener);
        let config = self.config;
        let registry = self.registry;
        let tx = self.tx;

        tokio::spawn(async move {
            loop {
                if let Ok((stream, _)) = listener_arc.accept().await {
                    if verify_peer_credentials_static(&stream, &config).is_err() {
                        continue;
                    }

                    let tx_client = tx.clone();
                    let registry_client = registry.clone();

                    tokio::spawn(async move {
                        // Aligned with the client-side little endian constraint
                        let mut framed = Framed::new(
                            stream, 
                            LengthDelimitedCodec::builder().little_endian().new_codec()
                        );
                        if let Some(Ok(first_frame)) = framed.next().await {
                            if let Ok(manifest) = rmp_serde::from_slice::<CapabilityManifest>(&first_frame) {
                                let agent_name = manifest.agent_name.clone();
                                let (is_active, action_rx) = registry_client.register(&agent_name);

                                let session = UdsSession {
                                    framed,
                                    is_active,
                                    tx: tx_client,
                                    action_rx,
                                    registry: registry_client,
                                    agent_name,
                                };
                                session.spawn_run();
                            }
                        }
                    });
                }
            }
        });
    }
}
