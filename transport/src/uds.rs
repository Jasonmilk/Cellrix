use async_trait::async_trait;
use tokio::net::UnixStream;
use tokio::io::{BufReader, BufWriter, ReadHalf, WriteHalf};
use crate::cap_transport::{CapTransport, TransportError};
use crate::protocol::{WireFormat, handshake_client, send_message, recv_message, DEFAULT_TIMEOUT_MS};
use cellrix_protocol::{CapabilityManifest, SemanticSnapshot, ActionRequest, ActionResponse};

pub struct UdsTransport {
    writer: BufWriter<WriteHalf<UnixStream>>,
    reader: BufReader<ReadHalf<UnixStream>>,
    format: WireFormat,
}

impl UdsTransport {
    pub async fn connect(path: &str) -> Result<Self, TransportError> {
        let stream = UnixStream::connect(path).await?;
        let (read_half, write_half) = tokio::io::split(stream);
        let mut writer = BufWriter::new(write_half);
        let mut reader = BufReader::new(read_half);

        let chosen = handshake_client(&mut writer, &mut reader, WireFormat::MessagePack).await?;
        Ok(Self {
            writer,
            reader,
            format: chosen,
        })
    }
}

#[async_trait]
impl CapTransport for UdsTransport {
    async fn fetch_manifest(&mut self) -> Result<CapabilityManifest, TransportError> {
        send_message(&mut self.writer, self.format, &"manifest").await?;
        recv_message(&mut self.reader, self.format, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| TransportError::Io(e))
    }

    async fn fetch_snapshot(&mut self) -> Result<SemanticSnapshot, TransportError> {
        send_message(&mut self.writer, self.format, &"snapshot").await?;
        recv_message(&mut self.reader, self.format, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| TransportError::Io(e))
    }

    async fn send_action(&mut self, action: ActionRequest) -> Result<ActionResponse, TransportError> {
        send_message(&mut self.writer, self.format, &action).await?;
        recv_message(&mut self.reader, self.format, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| TransportError::Io(e))
    }
}
