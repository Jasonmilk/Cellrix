//! # cellrix-protocol — Physical Bindings for the CommonIntents Protocol Stack
//!
//! This crate provides core data structures and interfaces aligned with the BIND-19 (CIB19) standard:
//! - INTENT-7 (CIN7) specifications: `CapabilityManifest`, `SemanticSnapshot`
//! - CAPABILITY-13 (CIC13) specifications: `ActionRequest`, `ActionResponse`
//! - View hashing interfaces (actual implementation deferred to upper layers)
//! - Fault-tolerant parser: isolated node corruption does not invalidate the entire snapshot
//! - Universal grid system decoupled from UI renderers (`LayoutRect` with u16 precision)

mod manifest;
mod snapshot;
mod action;
mod view_hash;
mod parser;
mod coords;
mod agent_event;
mod pfp;
mod sap;
pub mod tuck_audit;

pub use manifest::*;
pub use snapshot::*;
pub use action::*;
pub use view_hash::*;
pub use parser::*;
pub use coords::*;
pub use agent_event::AgentEvent;
pub use pfp::*;
pub use sap::*;
pub use tuck_audit::*;

/// Unified error types for this crate.
#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("JSON parsing failed: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Node parsing failed, downgraded to Unknown: {0}")]
    NodeFallback(String),

    #[error("Missing required field: {0}")]
    MissingField(&'static str),

    #[error("View hash calculation failed: {0}")]
    HashError(String),
}
