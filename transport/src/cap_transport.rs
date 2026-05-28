use async_trait::async_trait;
use cellrix_protocol::{CapabilityManifest, SemanticSnapshot, ActionRequest, ActionResponse};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Protocol error: {0}")]
    Protocol(String),
    #[error("Remote error: {0}")]
    Remote(String),
    #[error("Not implemented: {0}")]
    NotImplemented(String),
    #[error("Timeout after {0} ms")]
    Timeout(u64),
}

#[async_trait]
pub trait CapTransport: Send + Sync {
    async fn fetch_manifest(&mut self) -> Result<CapabilityManifest, TransportError>;
    async fn fetch_snapshot(&mut self) -> Result<SemanticSnapshot, TransportError>;
    async fn send_action(&mut self, action: ActionRequest) -> Result<ActionResponse, TransportError>;
}
