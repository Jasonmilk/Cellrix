use std::collections::HashMap;
use std::time::Instant;
use cellrix_protocol::SemanticSnapshot;
use cellrix_layout::FocusManager;

/// Pure logical state machine for Cellrix UI.
/// Completely decoupled from physical terminal I/O (crossterm).
/// Extremely friendly to unit-testing and future WASM WebUI compilation.
pub struct AppState {
    pub snapshot: Option<SemanticSnapshot>,
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
}
