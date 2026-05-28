//! # cellrix-protocol — Physical binding for CommonIntents protocol stack
//!
//! This crate provides capabilities for the entire Helix ecosystem:
//! - CIS (Structured Intent Description Language) data types: `CapabilityManifest`, `SemanticSnapshot`
//! - CAP (Consensus Acknowledgment Protocol) data types: `ActionRequest`, `ActionResponse`
//! - Interface definition for view hash (actual algorithm implemented by upper layer)
//! - Tolerant parser: single corrupted node will not break the whole snapshot
//! - UI-agnostic universal coordinate system (`LayoutRect`, u16 precision)
//!
//! # Zero extra dependency rule
//! No runtime dependencies except `serde` / `serde_json` / `thiserror`.
//! Can be compiled to WASM and safely referenced by other crates.

mod manifest;
mod snapshot;
mod action;
mod view_hash;
mod parser;
mod coords;

// Public exports
pub use manifest::*;
pub use snapshot::*;
pub use action::*;
pub use view_hash::*;
pub use parser::*;
pub use coords::*;

/// Unified error type for this crate
#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("JSON parse failed: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Node parse failed, fallback to Unknown: {0}")]
    NodeFallback(String),

    #[error("Required field missing: {0}")]
    MissingField(&'static str),

    #[error("View hash calculation failed: {0}")]
    HashError(String),
}
