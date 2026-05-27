use crate::cap_client::Snapshot;

/// Thread-safe shared UI state for asynchronous rendering
/// Stores agent connection status and last received CAP snapshot
pub struct ShadowUiState {
    pub agent_connected: bool,
    pub is_dirty: bool,
    pub last_snapshot: Option<Snapshot>,
}

impl Default for ShadowUiState {
    fn default() -> Self {
        Self {
            agent_connected: false,
            is_dirty: false,
            last_snapshot: None,
        }
    }
}
