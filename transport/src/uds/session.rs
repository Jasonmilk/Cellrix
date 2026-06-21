use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::UnixStream;
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use tokio_stream::StreamExt;

use crate::cap_transport::TransportError;
use cellrix_protocol::AgentEvent;
use super::server::ClientRegistry;

/// Lightweight proxy enum designed for zero-heap-allocation tag peeking.
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
    pub registry: Arc<ClientRegistry>,
    pub agent_name: String,
}

impl UdsSession {
    /// Spawns the session handler in a separate non-blocking task.
    pub fn spawn_run(self) {
        tokio::spawn(async move {
            let mut framed = self.framed;
            while let Some(result) = framed.next().await {
                match result {
                    Ok(bytes) => {
                        // ON-DEMAND PROCESSING: Only deserialize fully if in active focus
                        if self.is_active.load(Ordering::Acquire) {
                            if let Ok(event) = rmp_serde::from_slice::<AgentEvent>(&bytes) {
                                let _ = self.tx.send(Ok(event));
                            }
                        } else {
                            // Backpressured/Throttled: Peek tag and drop heavy payload instantly!
                            if let Ok(tag) = rmp_serde::from_slice::<AgentEventTag>(&bytes) {
                                if let AgentEventTag::StreamError(err) = tag {
                                    // Forward only critical background errors
                                    let _ = self.tx.send(Ok(AgentEvent::StreamError(err)));
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = self.tx.send(Err(TransportError::Io(e)));
                        break;
                    }
                }
            }
            self.registry.unregister(&self.agent_name);
        });
    }
}
