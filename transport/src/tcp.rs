use async_trait::async_trait;
use crate::cap_transport::{CapTransport, TransportStream, TransportError};
use cellrix_protocol::{CapabilityManifest, ActionRequest, ActionResponse};

pub struct TcpTransport;

impl TcpTransport {
    pub async fn connect(_addr: &str) -> Result<Self, TransportError> {
        Ok(Self)
    }
}

#[async_trait]
impl CapTransport for TcpTransport {
    async fn connect(&mut self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        Err(TransportError::NotImplemented("TCP not implemented".into()))
    }

    async fn send_action(&mut self, _request: ActionRequest) -> Result<ActionResponse, TransportError> {
        Err(TransportError::NotImplemented("TCP not implemented".into()))
    }
}
