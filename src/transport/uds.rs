use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use super::super::cap_client::CapTransport;

pub struct UdsTransport {
    socket_path: String,
    stream: Option<UnixStream>,
}

impl UdsTransport {
    pub fn new(socket_path: &str) -> Self {
        Self {
            socket_path: socket_path.to_string(),
            stream: None,
        }
    }
}

#[async_trait]
impl CapTransport for UdsTransport {
    async fn connect(&mut self) -> Result<(), String> {
        let stream = UnixStream::connect(&self.socket_path).await.map_err(|e| e.to_string())?;
        self.stream = Some(stream);
        Ok(())
    }

    async fn get_snapshot(&mut self) -> Result<Value, String> {
        let stream = self.stream.as_mut().ok_or("UDS not connected".to_string())?;
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
        serde_json::from_str(&line).map_err(|e| e.to_string())
    }

    async fn send_action(&mut self, _action: &str, _params: Value) -> Result<(), String> {
        Ok(())
    }
}
