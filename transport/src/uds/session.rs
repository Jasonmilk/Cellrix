use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::UnixStream;
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use tokio_stream::StreamExt;
use tokio::io::AsyncWriteExt; // Raw write for downstream actions

use crate::cap_transport::TransportError;
use cellrix_protocol::{AgentEvent, ActionRequest};
use super::server::ClientRegistry;

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
/// Supports high-performance multiplexed bi-directional I/O via tokio::select!
pub struct UdsSession {
    pub framed: Framed<UnixStream, LengthDelimitedCodec>,
    pub is_active: Arc<AtomicBool>,
    pub tx: tokio::sync::mpsc::UnboundedSender<Result<AgentEvent, TransportError>>,
    pub action_rx: tokio::sync::mpsc::UnboundedReceiver<ActionRequest>,
    pub registry: Arc<ClientRegistry>,
    pub agent_name: String,
}

impl UdsSession {
    /// Spawns the session handler in a separate non-blocking task.
    pub fn spawn_run(self) {
        let mut framed = self.framed;
        let mut action_rx = self.action_rx;
        let is_active = self.is_active;
        let tx = self.tx;
        let registry = self.registry;
        let agent_name = self.agent_name;

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // 1. Upstream processing: Read frames from client
                    result = framed.next() => {
                        match result {
                            Some(Ok(bytes)) => {
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
                            Some(Err(e)) => {
                                let _ = tx.send(Err(TransportError::Io(e)));
                                break;
                            }
                            None => break, // Client hung up
                        }
                    }
                    // 2. Downstream processing: Receive ActionRequests to write back to client
                    Some(action) = action_rx.recv() => {
                        if let Ok(action_bytes) = rmp_serde::to_vec(&action) {
                            let len_bytes = (action_bytes.len() as u32).to_be_bytes();
                            let raw_stream = framed.get_mut(); // Access raw stream to bypass SinkExt dependency
                            
                            // Write framed action back to client
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
