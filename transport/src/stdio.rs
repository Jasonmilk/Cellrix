use async_trait::async_trait;
use tokio::process::{Command, ChildStdin};
use tokio::io::{BufReader, BufWriter};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use crate::cap_transport::{CapTransport, TransportStream, TransportError};
use crate::protocol::{WireFormat, handshake_client, recv_message, DEFAULT_TIMEOUT_MS};
use cellrix_protocol::{CapabilityManifest, ActionRequest, ActionResponse, AgentEvent};

pub struct StdioTransport {
    stdin: Option<BufWriter<ChildStdin>>,
    child: Option<tokio::process::Child>,
    format: WireFormat,
}

impl StdioTransport {
    pub async fn new(command: &str, args: &[String]) -> Result<Self, TransportError> {
        eprintln!("[DEBUG] Spawning child: {} {:?}", command, args);
        let child = Command::new(command)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true)
            .spawn()?;
        Ok(Self {
            stdin: None,
            child: Some(child),
            format: WireFormat::MessagePack,
        })
    }
}

#[async_trait]
impl CapTransport for StdioTransport {
    async fn connect(&mut self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        let mut child = self.child.take()
            .ok_or(TransportError::Protocol("child already taken".to_string()))?;
        let stdin = child.stdin.take()
            .ok_or(TransportError::Protocol("stdin not available".to_string()))?;
        let stdout = child.stdout.take()
            .ok_or(TransportError::Protocol("stdout not available".to_string()))?;

        let mut writer = BufWriter::new(stdin);
        let mut reader = BufReader::new(stdout);

        eprintln!("[DEBUG] Starting CIB handshake...");
        let chosen = handshake_client(&mut writer, &mut reader, WireFormat::MessagePack)
            .await
            .map_err(|e| {
                eprintln!("[DEBUG] Handshake failed: {:?}", e);
                TransportError::Io(e)
            })?;
        eprintln!("[DEBUG] Handshake succeeded, chosen format: {:?}", chosen);
        self.format = chosen;

        eprintln!("[DEBUG] Waiting for first event (must be Manifest)...");
        let first_event: AgentEvent = recv_message(&mut reader, chosen, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| {
                eprintln!("[DEBUG] Failed to read first event: {:?}", e);
                TransportError::Io(e)
            })?;
        eprintln!("[DEBUG] First event received: {:?}", &first_event);
        let manifest = match first_event {
            AgentEvent::Manifest(m) => m,
            other => {
                eprintln!("[DEBUG] Unexpected first event: {:?}", other);
                return Err(TransportError::Protocol("First event must be manifest/update".to_string()))
            }
        };

        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                match recv_message::<AgentEvent>(&mut reader, chosen, DEFAULT_TIMEOUT_MS).await {
                    Ok(event) => {
                        if tx.send(Ok(event)).is_err() { break; }
                    }
                    Err(e) => {
                        eprintln!("[DEBUG] Background reader error: {:?}", e);
                        let _ = tx.send(Err(TransportError::Io(e)));
                        break;
                    }
                }
            }
        });

        self.stdin = Some(writer);
        self.child = Some(child); // 👈 核心修复点：将所有权安然送回 self，延续 Agent 子进程的生命周期！
        
        let stream: TransportStream = Box::pin(UnboundedReceiverStream::new(rx));
        Ok((manifest, stream))
    }

    async fn send_action(&mut self, _request: ActionRequest) -> Result<ActionResponse, TransportError> {
        Err(TransportError::NotImplemented("send_action not yet implemented".to_string()))
    }
}
