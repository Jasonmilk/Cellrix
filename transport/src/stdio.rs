use async_trait::async_trait;
use tokio::process::{Command, ChildStdin};
use tokio::io::BufWriter;
use crate::cap_transport::{CapTransport, TransportStream, TransportError};
use cellrix_protocol::{CapabilityManifest, ActionRequest, ActionResponse};

pub struct StdioTransport {
    stdin: BufWriter<ChildStdin>,
}

impl StdioTransport {
    pub async fn new(command: &str, args: &[String]) -> Result<Self, TransportError> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = BufWriter::new(child.stdin.take().unwrap());
        Ok(Self { stdin })
    }
}

#[async_trait]
impl CapTransport for StdioTransport {
    async fn connect(&mut self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        let manifest = CapabilityManifest {
            agent_name: "placeholder".into(),
            version: "0.0.0".into(),
            actions: vec![],
            layout_hints: None,
        };
        let stream = Box::pin(tokio_stream::empty());
        Ok((manifest, stream))
    }

    async fn send_action(&mut self, _request: ActionRequest) -> Result<ActionResponse, TransportError> {
        Err(TransportError::NotImplemented("StdioTransport::send_action not yet implemented".into()))
    }
}
