use std::collections::HashMap;
use std::time::Instant;
use cellrix_protocol::SemanticSnapshot;
use cellrix_protocol::anaphase::AgentSnapshot;
use cellrix_layout::FocusManager;

/// Pure logical state machine for Cellrix UI.
/// Completely decoupled from physical terminal I/O (crossterm).
/// Extremely friendly to unit-testing and future WASM WebUI compilation.
pub struct AppState {
    pub snapshot: Option<SemanticSnapshot>,
    /// Anaphase cockpit projection (candidate G) — refreshed by the CLI
    /// poller; rendered by the cockpit widget when present.
    pub cockpit: Option<AgentSnapshot>,
    pub error: Option<String>,
    pub focus_manager: FocusManager,
    pub last_heartbeat: Instant,
    pub slot_nodes: HashMap<String, Vec<String>>,
    pub active_slot_nodes: HashMap<String, String>,
    pub is_zen_mode: bool,
    pub mouse_capture: bool,
    pub active_agents: Vec<String>,
    pub current_agent: Option<String>,
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
            error: None,
            focus_manager: FocusManager::new(),
            last_heartbeat: Instant::now(),
            slot_nodes: HashMap::new(),
            active_slot_nodes: HashMap::new(),
            is_zen_mode: false,
            mouse_capture: true,
            active_agents,
            current_agent,
        }
    }

    /// Update the cockpit projection (latest snapshot wins).
    pub fn set_cockpit(&mut self, snapshot: AgentSnapshot) {
        self.cockpit = Some(snapshot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_cockpit_updates_projection() {
        let mut state = AppState::new("test-agent".to_string());
        assert!(state.cockpit.is_none());
        state.set_cockpit(AgentSnapshot::empty());
        assert!(state.cockpit.is_some());
    }
}
