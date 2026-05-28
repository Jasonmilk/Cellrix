use serde::{Deserialize, Serialize};

/// Agent 的能力声明（CAP协议 manifest端点）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityManifest {
    pub agent_name: String,
    pub version: String,
    pub actions: Vec<Action>,
    pub layout_hints: Option<LayoutHints>,
}

/// 一个可被用户触发的动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub label: String,
    pub security_class: SecurityClass,
    /// JSON Schema 描述参数结构
    pub parameters: serde_json::Value,
}

/// 安全等级：区分普通动作与需要显式确认的关键动作
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecurityClass {
    Normal,
    Critical,
}

/// 布局提示（可选，优先于隐式启发）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutHints {
    pub preferred_panels: Vec<String>,
    pub grid: Option<GridDefinition>,
}

/// 显式栅格定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridDefinition {
    pub rows: Vec<GridSlot>,
}

/// 单个槽位
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridSlot {
    pub id: String,
    pub constraint: SlotConstraint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotConstraint {
    Percentage(f64),
    FixedLines(u16),
    Min(u16),
}
