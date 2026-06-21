//! Shared coordinate type for layout engine.

use serde::Serialize;

/// Screen rectangle with integer coordinates.
/// Derives Serialize to support lossless cross-boundary data transmission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LayoutRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}
