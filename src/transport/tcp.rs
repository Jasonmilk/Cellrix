use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;
use super::super::cap_client::CapTransport;

pub struct TcpTransport {
    endpoint: String,
    client: Client,
}

impl TcpTransport {
    pub fn new(endpoint: &str) -> Self {
        Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            client: Client::new(),
        }
    }
}

#[async_trait]
impl CapTransport for TcpTransport {
    async fn connect(&mut self) -> Result<(), String> {
        self.get_snapshot().await?;
        Ok(())
    }

    async fn get_snapshot(&mut self) -> Result<Value, String> {
        let url = format!("{}/v1/agent/snapshot", self.endpoint);
        let resp = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
        let body: Value = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body)
    }

    async fn send_action(&mut self, _action: &str, _params: Value) -> Result<(), String> {
        Ok(())
    }
}
