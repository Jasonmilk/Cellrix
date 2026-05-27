use serde_json::Value;

/// UI rendering mode for environment-adaptive display
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum AestheticLevel {
    Discrete,
    Reactive,
    Continuous,
}

/// Active focus panel in the UI
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Panel {
    StateTree,
    Metrics,
}

/// Global UI state for Cellrix application
pub struct ShadowUiState {
    pub agent_connected: bool,
    pub last_snapshot: Option<Value>,
    pub active_panel: Panel,
    pub state_tree_scroll: usize,
    pub metrics_scroll: usize,
    pub chat_scroll: usize,
    pub chat_history: Vec<String>,
    pub is_dirty: bool,
    pub aesthetic_level: AestheticLevel,
}

impl Default for ShadowUiState {
    fn default() -> Self {
        Self {
            agent_connected: false,
            last_snapshot: None,
            active_panel: Panel::StateTree,
            state_tree_scroll: 0,
            metrics_scroll: 0,
            chat_scroll: 0,
            chat_history: Vec::new(),
            is_dirty: true,
            aesthetic_level: AestheticLevel::Reactive,
        }
    }
}
