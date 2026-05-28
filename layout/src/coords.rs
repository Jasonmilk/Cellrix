//! Shared coordinate type for layout engine.

/// Screen rectangle with integer coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}
