use serde::{Deserialize, Serialize};

/// Agent capability declaration (CAP protocol manifest endpoint)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityManifest {
    pub agent_name: String,
    pub version: String,
    pub actions: Vec<Action>,
    pub layout_hints: Option<LayoutHints>,
}

/// A single user-triggerable action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub label: String,
    pub security_class: SecurityClass,
    /// JSON Schema describing parameter structure
    pub parameters: serde_json::Value,
}

/// Security classification: distinguish normal actions and critical actions requiring confirmation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecurityClass {
    Normal,
    Critical,   // Require HITL (Human-in-the-Loop) confirmation
}

/// Layout hints (optional, higher priority than implicit heuristics)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutHints {
    pub preferred_panels: Vec<String>,
    pub grid: Option<GridDefinition>,
}

/// Explicit grid layout definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridDefinition {
    pub rows: Vec<GridSlot>,
}

/// Single grid slot unit
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
