use async_trait::async_trait;
use tokio_stream::Stream;
use std::pin::Pin;
use serde::Deserialize;

use cellrix_protocol::{CapabilityManifest, ActionRequest, ActionResponse};
pub use crate::error::TransportError;   // Re-export for external use

/// Events pushed from Agent to Cellrix.
#[derive(Debug, Deserialize)]
pub enum AgentEvent {
    Manifest(CapabilityManifest),
    Snapshot(cellrix_protocol::SemanticSnapshot),
    Heartbeat { epoch: u64 },
    StreamError(String),
}

/// Stream of agent events.
pub type TransportStream = Pin<Box<dyn Stream<Item = Result<AgentEvent, TransportError>> + Send>>;

/// The core transport trait for Cellrix (CIB v0.1.0 compliant).
#[async_trait]
pub trait CapTransport: Send + Sync {
    async fn connect(&mut self) -> Result<(CapabilityManifest, TransportStream), TransportError>;
    async fn send_action(&mut self, request: ActionRequest) -> Result<ActionResponse, TransportError>;
}
