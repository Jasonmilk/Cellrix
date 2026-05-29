use serde::{Deserialize, Serialize};
use crate::{CapabilityManifest, SemanticSnapshot};

/// Events that an Agent pushes to Cellrix over the transport.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Agent's initial capability manifest (must be the first event after handshake).
    Manifest(CapabilityManifest),
    /// A full state snapshot for the UI to render.
    Snapshot(SemanticSnapshot),
    /// Periodic liveness signal.
    Heartbeat { epoch: u64 },
    /// An error that caused the event stream to terminate.
    StreamError(String),
}
