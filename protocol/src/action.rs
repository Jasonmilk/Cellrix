use serde::{Deserialize, Serialize};
use crate::ViewHash;

/// 用户（或系统）触发的动作请求（CAP协议 action端点）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRequest {
    pub action_id: String,
    pub parameters: serde_json::Value,
    /// 执行前最后渲染的界面视图哈希（用于CAP验证）
    pub view_hash: Option<ViewHash>,
}

/// 动作执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionResponse {
    Success { message: String },
    Failure { error: String, recoverable: bool },
    Pending { poll_id: String },
}
