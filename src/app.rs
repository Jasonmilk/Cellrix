use crate::cap_client::CapClient;

// -----------------------------------------------------------------------------
// Legacy App State (for panel navigation & snapshot refresh)
// -----------------------------------------------------------------------------
/// Global application state for UI navigation and client management
pub struct App {
    pub cap_client: Box<dyn CapClient + Send>,
    pub anaphase_connected: bool,
    pub mind_connected: bool,
    pub active_panel: Panel,
}

#[derive(PartialEq, Eq)]
pub enum Panel {
    Dag,
    Chat,
}

impl App {
    pub fn new(cap_client: impl CapClient + Send + 'static) -> Self {
        Self {
            cap_client: Box::new(cap_client),
            anaphase_connected: false,
            mind_connected: false,
            active_panel: Panel::Dag,
        }
    }

    /// Switch between active UI panels
    pub fn next_panel(&mut self) {
        self.active_panel = match self.active_panel {
            Panel::Dag => Panel::Chat,
            Panel::Chat => Panel::Dag,
        };
    }

    /// Fetch CAP snapshot from the agent on demand
    pub async fn refresh_snapshot(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        match self.cap_client.get_snapshot().await {
            Ok(snapshot) => {
                self.anaphase_connected = !snapshot.is_empty();
                // Snapshot parsing and DAG/Chat updates will be implemented later
                Ok(())
            }
            Err(_) => {
                self.anaphase_connected = false;
                Ok(())
            }
        }
    }
}

// -----------------------------------------------------------------------------
// New Shadow UI State (for multi-threaded rendering, Phase 1 requirement)
// -----------------------------------------------------------------------------
/// Thread-safe shared UI state for asynchronous rendering and agent status
pub struct ShadowUiState {
    pub agent_connected: bool,
    pub is_dirty: bool,
}

impl Default for ShadowUiState {
    fn default() -> Self {
        Self {
            agent_connected: false,
            is_dirty: false,
        }
    }
}
