use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use crate::app::ShadowUiState;

/// Raw snapshot data from CAP protocol (JSON value)
pub type Snapshot = serde_json::Value;

/// Structured agent snapshot from CAP endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub status: String,
    pub metrics: serde_json::Value,
    pub semantic_tree: Vec<TreeNode>,
}

/// Node structure for cognitive semantic tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub id: String,
    pub node_type: String,
    pub label: String,
    pub content: String,
}

/// Core trait for CAP (Cognitive Agent Protocol) clients
#[async_trait]
pub trait CapClient {
    /// Fetch latest semantic snapshot from the agent
    async fn get_snapshot(&self) -> Result<Snapshot, Box<dyn std::error::Error>>;
}

/// No-operation client (offline fallback, no external dependencies)
pub struct NoopCapClient;

#[async_trait]
impl CapClient for NoopCapClient {
    async fn get_snapshot(&self) -> Result<Snapshot, Box<dyn std::error::Error>> {
        Ok(serde_json::Value::Null)
    }
}

/// Real HTTP client for connecting to Anaphase CAP endpoint
pub struct RealCapClient {
    endpoint: String,
    client: reqwest::Client,
}

impl RealCapClient {
    /// Create new HTTP CAP client with target endpoint
    pub fn new(endpoint: &str) -> Self {
        Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl CapClient for RealCapClient {
    async fn get_snapshot(&self) -> Result<Snapshot, Box<dyn std::error::Error>> {
        let url = format!("{}/v1/agent/snapshot", self.endpoint);
        let resp = self.client.get(&url).send().await?;
        let body: Snapshot = resp.json().await?;
        Ok(body)
    }
}

/// Async background task: periodically fetch CAP snapshots
pub async fn start_async_cap_listener(
    state: Arc<RwLock<ShadowUiState>>,
    cap_client: Arc<dyn CapClient + Send + Sync>,
) {
    loop {
        match cap_client.get_snapshot().await {
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
