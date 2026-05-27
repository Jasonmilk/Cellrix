use serde_json::Value;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum AestheticLevel {
    Discrete,
    Reactive,
    Continuous,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Panel {
    StateTree,
    Chat,
    Metrics,
}

pub struct ShadowUiState {
    pub agent_connected: bool,
    pub last_snapshot: Option<Value>,
    pub active_panel: Panel,
    pub state_tree_scroll: usize,
    pub chat_scroll: usize,
    pub chat_history: Vec<String>,
    pub input_buffer: String,
    pub is_dirty: bool,
    pub aesthetic_level: AestheticLevel,
}

impl Default for ShadowUiState {
    fn default() -> Self {
        Self {
            agent_connected: false,
            last_snapshot: None,
            active_panel: Panel::Chat,
            state_tree_scroll: 0,
            chat_scroll: 0,
            chat_history: Vec::new(),
            input_buffer: String::new(),
            is_dirty: true,
            aesthetic_level: AestheticLevel::Reactive,
        }
    }
}
