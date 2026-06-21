use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::UnixStream;
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use tokio_stream::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::time::Duration; // Timeout helper

use crate::cap_transport::TransportError;
use cellrix_protocol::{AgentEvent, ActionRequest};
use super::server::ClientRegistry;
use super::config::CellrixDaemonConfig;

#[derive(serde::Deserialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
enum AgentEventTag {
    Manifest(serde::de::IgnoredAny),
    Snapshot(serde::de::IgnoredAny),
    Heartbeat {
        #[allow(dead_code)]
        epoch: u64,
    },
    StreamError(String),
}

/// Dedicated, isolated Session task to handle a single client socket lifecycle.
pub struct UdsSession {
    pub framed: Framed<UnixStream, LengthDelimitedCodec>,
    pub is_active: Arc<AtomicBool>,
    pub tx: tokio::sync::mpsc::UnboundedSender<Result<AgentEvent, TransportError>>,
    pub action_rx: tokio::sync::mpsc::UnboundedReceiver<ActionRequest>,
    pub registry: Arc<ClientRegistry>,
    pub agent_name: String,
    pub config: Arc<CellrixDaemonConfig>, // Configured timeouts (0 hardcoding)
}

impl UdsSession {
    /// Spawns the session handler with embedded BIND-19 asynchronous watchdog.
    pub fn spawn_run(self) {
        let mut framed = self.framed;
        let mut action_rx = self.action_rx;
        let is_active = self.is_active;
        let tx = self.tx;
        let registry = self.registry;
        let agent_name = self.agent_name;
        
        let timeout_duration = Duration::from_secs(self.config.heartbeat_timeout_seconds);

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // 1. Upstream processing: Wrapped inside the CIB19 heartbeat timeout
                    result = tokio::time::timeout(timeout_duration, framed.next()) => {
                        match result {
                            // Frame arrived in time: reset the watchdog
                            Ok(Some(Ok(bytes))) => {
                                if is_active.load(Ordering::Acquire) {
                                    if let Ok(event) = rmp_serde::from_slice::<AgentEvent>(&bytes) {
                                        let _ = tx.send(Ok(event));
                                    }
                                } else {
                                    if let Ok(tag) = rmp_serde::from_slice::<AgentEventTag>(&bytes) {
                                        if let AgentEventTag::StreamError(err) = tag {
                                            let _ = tx.send(Ok(AgentEvent::StreamError(err)));
                                        }
                                    }
                                }
                            }
                            Ok(Some(Err(e))) => {
                                let _ = tx.send(Err(TransportError::Io(e)));
                                break;
                            }
                            Ok(None) => break, // Client disconnected gracefully
                            Err(_) => {
                                // CIB19 Watchdog triggered! Silent client detected.
                                eprintln!("CIB19 Watchdog: Client '{}' timed out. Purging connection.", agent_name);
                                
                                // Send standard StreamError with single-quoted name to trigger UI self-healing
                                let _ = tx.send(Ok(AgentEvent::StreamError(format!(
                                    "Client '{}' disconnected due to CIB19 heartbeat timeout", agent_name
                                ))));
                                break;
                            }
                        }
                    }
                    // 2. Downstream processing
                    Some(action) = action_rx.recv() => {
                        if let Ok(action_bytes) = rmp_serde::to_vec(&action) {
                            let len_bytes = (action_bytes.len() as u32).to_be_bytes();
                            let raw_stream = framed.get_mut();
                            
                            if raw_stream.write_all(&len_bytes).await.is_err() { break; }
                            if raw_stream.write_all(&action_bytes).await.is_err() { break; }
                            if raw_stream.flush().await.is_err() { break; }
                        }
                    }
                }
            }
            registry.unregister(&agent_name);
        });
    }
}
