use async_trait::async_trait;
use tokio::process::{Command, ChildStdin};
use tokio::io::{BufReader, BufWriter};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use crate::cap_transport::{CapTransport, AgentEvent, TransportStream, TransportError};
use crate::protocol::{WireFormat, handshake_client, recv_message, DEFAULT_TIMEOUT_MS};
use cellrix_protocol::{CapabilityManifest, ActionRequest, ActionResponse};

pub struct StdioTransport {
    stdin: BufWriter<ChildStdin>,
    child: tokio::process::Child,
    format: WireFormat,
}

impl StdioTransport {
    pub async fn new(command: &str, args: &[String]) -> Result<Self, TransportError> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = BufWriter::new(child.stdin.take().unwrap());
        let stdout = BufReader::new(child.stdout.take().unwrap());

        let (mut writer, mut reader) = (stdin, stdout);
        let chosen = handshake_client(&mut writer, &mut reader, WireFormat::MessagePack)
            .await
            .map_err(|e| TransportError::Io(e))?;
        Ok(Self {
            stdin: writer,
            child,
            format: chosen,
        })
    }
}

#[async_trait]
impl CapTransport for StdioTransport {
    async fn connect(&mut self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        let stdout = self.child.stdout.take()
            .ok_or(TransportError::Protocol("stdout already taken".into()))?;
        let mut reader = BufReader::new(stdout);
        let format = self.format;

        let first_event: AgentEvent = recv_message(&mut reader, format, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| TransportError::Io(e))?;
        let manifest = match first_event {
            AgentEvent::Manifest(m) => m,
            _ => return Err(TransportError::Protocol("First event must be manifest/update".into())),
        };

        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                match recv_message::<AgentEvent>(&mut reader, format, DEFAULT_TIMEOUT_MS).await {
                    Ok(event) => {
                        if tx.send(Ok(event)).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(TransportError::Io(e)));
                        break;
                    }
                }
            }
        });

        let stream: TransportStream = Box::pin(UnboundedReceiverStream::new(rx));
        Ok((manifest, stream))
    }

    async fn send_action(&mut self, _request: ActionRequest) -> Result<ActionResponse, TransportError> {
        Err(TransportError::NotImplemented("send_action not yet implemented".into()))
    }
}
