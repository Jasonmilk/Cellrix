use serde::{Deserialize, Serialize};
use crate::LayoutHints;

/// Agent 的状态投影（CAP协议 snapshot端点）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSnapshot {
    pub epoch_time: u64,
    pub status: String,
    pub metrics: serde_json::Value,
    pub semantic_tree: Vec<SemanticNode>,
    pub active_focus: Option<String>,
    pub layout_overrides: Option<LayoutHints>,
}

/// 语义树中的单个节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticNode {
    pub id: String,
    pub node_type: NodeType,
    pub label: String,
    pub content: serde_json::Value,
    pub slot_binding: Option<String>,
    pub focused: bool,
}

/// 节点类型（未知类型安全降级）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    StateTree,
    TextPanel,
    ActionButton,
    ProgressBar,
    CodeDiff,
    Metrics,
    /// 未知节点类型（容错解析时使用）
    #[serde(other)]
    Unknown,
}
