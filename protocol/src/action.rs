use serde::{Deserialize, Serialize};
use crate::ViewHash;

/// Action request triggered by user or system (CAP protocol action endpoint)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRequest {
    pub action_id: String,
    pub parameters: serde_json::Value,
    /// View hash of last rendered interface before execution (for CAP validation)
    pub view_hash: Option<ViewHash>,
}

/// Action execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionResponse {
    Success { message: String },
    Failure { error: String, recoverable: bool },
    Pending { poll_id: String },   // Waiting for async HITL confirmation
}
