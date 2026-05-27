use async_trait::async_trait;
use serde_json::Value;
use reqwest::Client;
use crate::cap_client::CapTransport;

pub struct TcpTransport {
    client: Client,
    endpoint: String,
}

impl TcpTransport {
    pub fn new(endpoint: &str) -> Self {
        Self {
            client: Client::new(),
            endpoint: format!("http://{}", endpoint),
        }
    }
}

#[async_trait]
impl CapTransport for TcpTransport {
    async fn connect(&mut self) -> Result<(), String> {
        Ok(())
    }

    async fn get_snapshot(&mut self) -> Result<Value, String> {
        let resp = self.client
            .get(&format!("{}/v1/agent/snapshot", self.endpoint))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        
        let json = resp.json().await.map_err(|e| e.to_string())?;
        Ok(json)
    }

    async fn send_action(&mut self, _action: &str, _params: Value) -> Result<String, String> {
        let resp = self.client
            .post(&format!("{}/v1/agent/action", self.endpoint))
            .json(&_params)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        
        let text = resp.text().await.map_err(|e| e.to_string())?;
        Ok(text)
    }
}
