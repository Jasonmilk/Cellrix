// TCP transport is planned for Phase 2. Currently not implemented.
use async_trait::async_trait;
use crate::cap_transport::{CapTransport, TransportError};
use cellrix_protocol::{CapabilityManifest, SemanticSnapshot, ActionRequest, ActionResponse};

pub struct TcpTransport;

#[async_trait]
impl CapTransport for TcpTransport {
    async fn fetch_manifest(&mut self) -> Result<CapabilityManifest, TransportError> {
        Err(TransportError::NotImplemented("TCP transport is not yet implemented".into()))
    }

    async fn fetch_snapshot(&mut self) -> Result<SemanticSnapshot, TransportError> {
        Err(TransportError::NotImplemented("TCP transport is not yet implemented".into()))
    }

    async fn send_action(&mut self, _action: ActionRequest) -> Result<ActionResponse, TransportError> {
        Err(TransportError::NotImplemented("TCP transport is not yet implemented".into()))
    }
}
