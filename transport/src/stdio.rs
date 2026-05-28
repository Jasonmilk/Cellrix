use async_trait::async_trait;
use tokio::process::{Command, ChildStdin, ChildStdout};
use tokio::io::{BufReader, BufWriter};
use crate::cap_transport::{CapTransport, TransportError};
use crate::protocol::{WireFormat, handshake_client, send_message, recv_message, DEFAULT_TIMEOUT_MS};
use cellrix_protocol::{CapabilityManifest, SemanticSnapshot, ActionRequest, ActionResponse};

pub struct StdioTransport {
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    format: WireFormat,
    child: tokio::process::Child,
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
        let chosen = handshake_client(&mut writer, &mut reader, WireFormat::MessagePack).await?;
        Ok(Self {
            stdin: writer,
            stdout: reader,
            format: chosen,
            child,
        })
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        // child will be killed due to kill_on_drop(true)
    }
}

#[async_trait]
impl CapTransport for StdioTransport {
    async fn fetch_manifest(&mut self) -> Result<CapabilityManifest, TransportError> {
        send_message(&mut self.stdin, self.format, &"manifest").await?;
        recv_message(&mut self.stdout, self.format, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| TransportError::Io(e))
    }

    async fn fetch_snapshot(&mut self) -> Result<SemanticSnapshot, TransportError> {
        send_message(&mut self.stdin, self.format, &"snapshot").await?;
        recv_message(&mut self.stdout, self.format, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| TransportError::Io(e))
    }

    async fn send_action(&mut self, action: ActionRequest) -> Result<ActionResponse, TransportError> {
        send_message(&mut self.stdin, self.format, &action).await?;
        recv_message(&mut self.stdout, self.format, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| TransportError::Io(e))
    }
}
