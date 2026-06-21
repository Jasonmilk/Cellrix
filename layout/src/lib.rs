//! # cellrix-layout — Dual-track layout engine for Cellrix

mod layout_engine;
mod slot_allocator;
mod focus_manager;
mod zen_mode;
mod coords;
mod mouse_selector;

pub use layout_engine::{LayoutEngine, LayoutRequest, LayoutOutput, LayoutConfig, DefaultSlotIds};
pub use slot_allocator::{SlotAllocator, SlotAssignment, SlotType};
pub use focus_manager::FocusManager;
pub use zen_mode::ZenMode;
pub use coords::LayoutRect;
pub use mouse_selector::MouseSelector;

/// Common error type for layout operations.
#[derive(Debug, thiserror::Error)]
pub enum LayoutError {
    #[error("No screen space available for layout")]
    NoSpace,
    #[error("Invalid grid definition: {0}")]
    InvalidGrid(String),
    #[error("Node not found: {0}")]
    NodeNotFound(String),
    #[error("Zen mode error: {0}")]
    ZenModeError(String),
}

// Conditional compilation block. 
// Protects the native compiler from loading WASM dependencies.
#[cfg(target_arch = "wasm32")]
pub mod wasm;
