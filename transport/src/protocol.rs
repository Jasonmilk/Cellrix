//! CIB framing and format negotiation.
//! Handshake uses raw text lines, then switches to length-prefixed frames.

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, AsyncReadExt};
use rmp_serde::{encode, decode};
use serde::{Serialize, Deserialize};
use std::time::Duration;
use serde_json::Value;
use cellrix_protocol::{CapabilityManifest, SemanticSnapshot};

pub const DEFAULT_TIMEOUT_MS: u64 = 5000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireFormat {
    MessagePack,
    Json,
}

impl WireFormat {
    pub fn to_handshake_str(&self) -> &'static str {
        match self {
            WireFormat::MessagePack => "CIB/1.0 MSGPACK\n",
            WireFormat::Json => "CIB/1.0 JSON\n",
        }
    }

    pub fn from_handshake(s: &str) -> Option<Self> {
        match s.trim() {
            "CIB/1.0 MSGPACK" => Some(WireFormat::MessagePack),
            "CIB/1.0 JSON" => Some(WireFormat::Json),
            _ => None,
        }
    }
}

/// CIB standard envelope structure for all frames
#[derive(Debug, Deserialize)]
struct CibEnvelope {
    r#type: String,
    id: String,
    body: Value,
}

/// Perform raw-text handshake (no CIB framing).
pub async fn handshake_client<W, R>(
    writer: &mut W,
    reader: &mut R,
    preferred: WireFormat,
) -> Result<WireFormat, std::io::Error>
where
    W: AsyncWriteExt + Unpin,
    R: AsyncBufReadExt + Unpin,
{
    writer.write_all(preferred.to_handshake_str().as_bytes()).await?;
    writer.flush().await?;
    let mut line = String::new();
    reader.read_line(&mut line).await?;
    WireFormat::from_handshake(&line).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid handshake response")
    })
}

/// Encode a message with length prefix.
pub async fn send_message<T: Serialize>(
    writer: &mut (impl AsyncWriteExt + Unpin),
    format: WireFormat,
    msg: &T,
) -> Result<(), std::io::Error> {
    let data = match format {
        WireFormat::MessagePack => encode::to_vec(msg)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?,
        WireFormat::Json => serde_json::to_vec(msg)?,
    };
    let len = data.len() as u32;
    writer.write_all(&len.to_le_bytes()).await?;
    writer.write_all(&data).await?;
    writer.flush().await?;
    Ok(())
}

/// Decode a message from length-prefixed stream with timeout.
/// Requires `AsyncReadExt` for reading exact bytes.
pub async fn recv_message<T: for<'de> Deserialize<'de>>(
    reader: &mut (impl AsyncReadExt + Unpin),
    format: WireFormat,
    timeout_ms: u64,
) -> Result<T, std::io::Error> {
    let mut len_buf = [0u8; 4];
    tokio::time::timeout(Duration::from_millis(timeout_ms), async {
        reader.read_exact(&mut len_buf).await?;
        Ok::<_, std::io::Error>(())
    })
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "Read timeout"))??;
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut data = vec![0u8; len];
    tokio::time::timeout(Duration::from_millis(timeout_ms), async {
        reader.read_exact(&mut data).await?;
        Ok::<_, std::io::Error>(())
    })
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "Read timeout"))??;
    match format {
        WireFormat::MessagePack => decode::from_read(&data[..])
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        WireFormat::Json => serde_json::from_slice(&data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
    }
}
