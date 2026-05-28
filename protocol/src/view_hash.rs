use serde::{Deserialize, Serialize};
use crate::{SemanticSnapshot, ProtocolError};

/// 视图哈希：密码学上锚定“所见内容”的指纹
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ViewHash(pub [u8; 32]);

/// 用于计算确定性哈希的上下文（排除瞬态排版）
#[derive(Debug, Clone)]
pub struct HashContext {
    pub snapshot: SemanticSnapshot,
    /// 节点到槽位的绑定映射 (node_id -> slot_id)
    pub slot_bindings: Vec<(String, String)>,
    pub theme_version: String,
}

/// 视图哈希计算接口（由渲染后端实现）
pub trait ViewHashCompute {
    fn compute_deterministic_hash(&self, ctx: &HashContext) -> Result<ViewHash, ProtocolError>;
}
