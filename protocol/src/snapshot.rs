use serde::{Deserialize, Serialize};
use crate::LayoutHints;

/// Agent state projection (CAP protocol snapshot endpoint)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSnapshot {
    pub epoch_time: u64,
    pub status: String,
    pub metrics: serde_json::Value,
    pub semantic_tree: Vec<SemanticNode>,
    pub active_focus: Option<String>,           // Current focused semantic node ID
    pub layout_overrides: Option<LayoutHints>,  // Dynamic layout override, highest priority
}

/// Single node inside semantic tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticNode {
    pub id: String,
    pub node_type: NodeType,
    pub label: String,
    pub content: serde_json::Value,
    pub slot_binding: Option<String>,   // Bind to specified GridSlot, implicit allocation if None
    pub focused: bool,
}

/// Node type with extensibility, unknown type will fallback safely
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    StateTree,
    TextPanel,
    ActionButton,
    ProgressBar,
    CodeDiff,
    Metrics,
    /// Unknown node type (used for tolerant parsing)
    #[serde(other)]
    Unknown,
}
