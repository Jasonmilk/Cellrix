use async_trait::async_trait;
use serde_json::Value;
use tokio::net::UnixStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use crate::cap_client::CapTransport;

pub struct UdsTransport {
    stream: Option<UnixStream>,
    path: String,
}

impl UdsTransport {
    pub fn new(path: &str) -> Self {
        Self {
            stream: None,
            path: path.to_string(),
        }
    }
}

#[async_trait]
impl CapTransport for UdsTransport {
    async fn connect(&mut self) -> Result<(), String> {
        let stream = UnixStream::connect(&self.path).await.map_err(|e| e.to_string())?;
        self.stream = Some(stream);
        Ok(())
    }

    async fn get_snapshot(&mut self) -> Result<Value, String> {
        let stream = self.stream.as_mut().ok_or("Not connected")?;
        let req = b"{\"type\":\"get_snapshot\"}\n";
        stream.write_all(req).await.map_err(|e| e.to_string())?;
        stream.flush().await.map_err(|e| e.to_string())?;

        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.map_err(|e| e.to_string())?;
        let json = serde_json::from_slice(&buf).map_err(|e| e.to_string())?;
        Ok(json)
    }

    async fn send_action(&mut self, action: &str, params: Value) -> Result<String, String> {
        let stream = self.stream.as_mut().ok_or("Not connected")?;
        let msg = serde_json::json!({
            "type": "action",
            "action": action,
            "params": params
        });
        let msg_str = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        
        stream.write_all(msg_str.as_bytes()).await.map_err(|e| e.to_string())?;
        stream.write_all(b"\n").await.map_err(|e| e.to_string())?;
        stream.flush().await.map_err(|e| e.to_string())?;

        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.map_err(|e| e.to_string())?;
        let resp: Value = serde_json::from_slice(&buf).map_err(|e| e.to_string())?;
        Ok(resp["message"].as_str().unwrap_or("No response").to_string())
    }
}
