use std::collections::HashMap;
use std::time::Instant;
use cellrix_protocol::SemanticSnapshot;
use cellrix_protocol::anaphase::AgentSnapshot;
use cellrix_layout::FocusManager;
use crate::widgets::engram::EngramViewState;

/// Top-level view the driver is looking at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveView {
    /// The snapshot-driven cockpit (nodes / layout engine).
    Cockpit,
    /// The Engram imprint panel (Tuck audit chain).
    Engram,
}

/// Pure logical state machine for Cellrix UI.
/// Completely decoupled from physical terminal I/O (crossterm).
/// Extremely friendly to unit-testing and future WASM WebUI compilation.
pub struct AppState {
    pub snapshot: Option<SemanticSnapshot>,
    /// Anaphase cockpit projection (candidate G) — refreshed by the CLI
    /// poller; rendered by the cockpit widget when present.
    pub cockpit: Option<AgentSnapshot>,
    /// Engram imprint state (Tuck audit chain) — refreshed by the CLI
    /// poller on filter submit / poll tick.
    pub engram: EngramViewState,
    /// Which view is active (Ctrl+E toggles Cockpit/Engram).
    pub active_view: ActiveView,
    pub error: Option<String>,
    pub focus_manager: FocusManager,
    pub last_heartbeat: Instant,
    pub slot_nodes: HashMap<String, Vec<String>>,
    pub active_slot_nodes: HashMap<String, String>,
    pub is_zen_mode: bool,
    pub mouse_capture: bool,
    pub active_agents: Vec<String>,
    pub current_agent: Option<String>,
    /// Text input for a `needs_input` action (e.g. send_message): the
    /// target action id while typing, the typed buffer, and the last
    /// action response (the Helix reply) for display.
    pub input_action: Option<String>,
    /// Chat box focus: Enter anywhere (no action button selected) opens it,
    /// typed chars go to `input_buffer`, Enter sends, Esc blurs (draft kept).
    /// Always rendered as a fixed 3-row box at the bottom.
    pub chat_focused: bool,
    pub input_buffer: String,
    pub last_response: Option<String>,
}

impl AppState {
    /// Creates a new AppState initialized with the bootstrap agent.
    pub fn new(bootstrap_agent: String) -> Self {
        let mut active_agents = Vec::new();
        let current_agent = Some(bootstrap_agent.clone());
        active_agents.push(bootstrap_agent);

        Self {
            snapshot: None,
            cockpit: None,
            engram: EngramViewState::default(),
            active_view: ActiveView::Cockpit,
            error: None,
            focus_manager: FocusManager::new(),
            last_heartbeat: Instant::now(),
            slot_nodes: HashMap::new(),
            active_slot_nodes: HashMap::new(),
            is_zen_mode: false,
            mouse_capture: true,
            active_agents,
            current_agent,
            // Pre-focused chat box: the driver opens the TUI and can type
            // immediately (Enter is no longer needed to arm the box — a
            // selected action button used to swallow Enter and confuse the
            // "where do I type" flow). Tab still moves focus away.
            input_action: Some("send_message".to_string()),
            chat_focused: true,
            input_buffer: String::new(),
            last_response: None,
        }
    }

    /// Update the cockpit projection (latest snapshot wins).
    pub fn set_cockpit(&mut self, snapshot: AgentSnapshot) {
        self.cockpit = Some(snapshot);
    }

    /// Replace the Engram entries (chain order), keeping the selection
    /// clamped to the new length.
    pub fn set_engram(&mut self, query: cellrix_protocol::engram::EngramQuery) {
        self.engram.entries = query.entries;
        self.engram.queried_by = query.queried_by;
        self.engram.error = None;
        self.engram.loading = false;
        if let Some(idx) = self.engram.selected {
            self.engram.selected =
                Some(idx.min(self.engram.entries.len().saturating_sub(1)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_fields_start_prefocused() {
        let state = AppState::new("test-agent".to_string());
        assert_eq!(state.input_action.as_deref(), Some("send_message"));
        assert!(state.chat_focused);
        assert!(state.input_buffer.is_empty());
        assert_eq!(state.last_response, None);
    }

    #[test]
    fn input_lifecycle_is_plain_fields() {
        let mut state = AppState::new("test-agent".to_string());
        // opening the input for an action + typing is pure field state
        state.input_action = Some("send_message".to_string());
        state.chat_focused = true;
        state.input_buffer.push_str("hi helix");
        assert_eq!(state.input_action.as_deref(), Some("send_message"));
        assert!(state.chat_focused);
        assert_eq!(state.input_buffer, "hi helix");
        // send: keep focus for the conversation, store the reply
        state.input_buffer.clear();
        state.last_response = Some("✓ hello driver".to_string());
        assert!(state.chat_focused);
        assert_eq!(state.last_response.as_deref(), Some("✓ hello driver"));
        // blur: draft is kept, focus released
        state.chat_focused = false;
        state.input_action = None;
        assert!(!state.chat_focused);
    }

    #[test]
    fn test_set_cockpit_updates_projection() {
        let mut state = AppState::new("test-agent".to_string());
        assert!(state.cockpit.is_none());
        state.set_cockpit(AgentSnapshot::empty());
        assert!(state.cockpit.is_some());
    }
}
