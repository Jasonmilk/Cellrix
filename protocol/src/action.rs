use serde::{Deserialize, Serialize};
use crate::ViewHash;

/// Action request triggered by the user or the system (CAPABILITY-13 / CIC13 action endpoint).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRequest {
    pub action_id: String,
    pub parameters: serde_json::Value,
    /// View hash of the last rendered state before execution (used for CIC13 verification).
    pub view_hash: Option<ViewHash>,
}

/// Result of an action execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionResponse {
    Success { message: String },
    Failure { error: String, recoverable: bool },
    Pending { poll_id: String },
}
