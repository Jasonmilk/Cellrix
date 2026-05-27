use serde_json::Value;

pub type Snapshot = Value;

/// Focused panel enum
#[derive(PartialEq, Eq, Clone, Copy)]
pub enum Panel {
    StateTree,
    Metrics,
}

pub struct ShadowUiState {
    pub agent_connected: bool,
    pub is_dirty: bool,
    pub last_snapshot: Option<Snapshot>,
    pub active_panel: Panel,
    // Scroll offset for panels
    pub state_tree_scroll: u16,
    pub metrics_scroll: u16,
}

impl Default for ShadowUiState {
    fn default() -> Self {
        Self {
            agent_connected: false,
            is_dirty: false,
            last_snapshot: None,
            active_panel: Panel::StateTree,
            state_tree_scroll: 0,
            metrics_scroll: 0,
        }
    }
}
