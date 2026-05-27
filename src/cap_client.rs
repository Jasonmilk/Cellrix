use async_trait::async_trait;
use std::sync::{Arc, RwLock};
use crate::app::ShadowUiState;

/// Raw snapshot data from the CAP protocol (temporary string type)
pub type Snapshot = String;

// -----------------------------------------------------------------------------
// Core CAP Client Trait
// -----------------------------------------------------------------------------
#[async_trait]
pub trait CapClient {
    /// Retrieve semantic snapshot from Anaphase agent
    async fn get_snapshot(&self) -> Result<Snapshot, Box<dyn std::error::Error>>;
    // Future extensions: send_action, get_manifest, etc.
}

// -----------------------------------------------------------------------------
// Noop CAP Client (Offline Fallback)
// -----------------------------------------------------------------------------
/// No-operation implementation: returns empty snapshot with no external dependencies
pub struct NoopCapClient;

#[async_trait]
impl CapClient for NoopCapClient {
    async fn get_snapshot(&self) -> Result<Snapshot, Box<dyn std::error::Error>> {
        // Return empty data to keep the app in offline mode
        Ok(String::new())
    }
}

// -----------------------------------------------------------------------------
// Async CAP Listener (Phase 1 Multi-Thread Requirement)
// -----------------------------------------------------------------------------
/// Asynchronous background task to simulate agent connection and state updates
pub async fn start_async_cap_listener(state: Arc<RwLock<ShadowUiState>>) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
        
        // Update connection status and mark UI for redraw
        if let Ok(mut ui_state) = state.write() {
            ui_state.agent_connected = true;
            ui_state.is_dirty = true;
        }
    }
}

// RealCapClient will be implemented later using reqwest for HTTP API calls
