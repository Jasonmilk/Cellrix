use async_trait::async_trait;
use serde_json::Value;

#[async_trait]
pub trait CapTransport: Send + Sync {
    async fn connect(&mut self) -> Result<(), String>;
    async fn get_snapshot(&mut self) -> Result<Value, String>;
    async fn send_action(&mut self, action: &str, params: Value) -> Result<String, String>;
}
