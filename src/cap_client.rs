use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, RwLock};
use crate::app::ShadowUiState;

/// Generic Agent snapshot structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub status: String,
    pub metrics: Value,
    pub semantic_tree: Vec<TreeNode>,
}

/// Semantic tree node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub id: String,
    pub node_type: String,
    pub label: String,
    pub content: String,
}

/// Core abstraction: Transport layer for Cellrix Agent Protocol
#[async_trait]
pub trait CapTransport: Send {
    async fn connect(&mut self) -> Result<(), String>;
    async fn get_snapshot(&mut self) -> Result<Value, String>;
    async fn send_action(&mut self, action: &str, params: Value) -> Result<(), String>;
}

/// Async network thread: Periodically pull CAP snapshot and update UI state
pub async fn start_async_cap_listener(
    state: Arc<RwLock<ShadowUiState>>,
    transport: Arc<tokio::sync::Mutex<Box<dyn CapTransport>>>,
) {
    loop {
        let snapshot_result = {
            let mut transport = transport.lock().await;
            transport.get_snapshot().await
        };

        match snapshot_result {
            Ok(snapshot) => {
                if let Ok(mut ui_state) = state.write() {
                    ui_state.agent_connected = true;
                    ui_state.last_snapshot = Some(snapshot);
                    ui_state.is_dirty = true;
                }
            }
            Err(_) => {
                if let Ok(mut ui_state) = state.write() {
                    ui_state.agent_connected = false;
                    ui_state.is_dirty = true;
                }
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
    }
}
