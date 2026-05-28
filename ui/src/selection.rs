//! Physical selection capture: mouse drag over semantic boundaries.

use ratatui::layout::Rect;
use cellrix_layout::LayoutRect;
use cellrix_protocol::SemanticSnapshot;

#[derive(Debug, Clone, Default)]
pub struct SelectionManager {
    start: Option<(u16, u16)>,
    end: Option<(u16, u16)>,
}

impl SelectionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_drag(&mut self, x: u16, y: u16) {
        self.start = Some((x, y));
        self.end = None;
    }

    pub fn update_drag(&mut self, x: u16, y: u16) {
        self.end = Some((x, y));
    }

    pub fn end_drag(&mut self) -> Option<Rect> {
        if let (Some((x1, y1)), Some((x2, y2))) = (self.start, self.end) {
            self.start = None;
            self.end = None;
            let x = x1.min(x2);
            let y = y1.min(y2);
            let width = (x1 as i32 - x2 as i32).abs() as u16 + 1;
            let height = (y1 as i32 - y2 as i32).abs() as u16 + 1;
            Some(Rect::new(x, y, width, height))
        } else {
            None
        }
    }

    pub fn is_active(&self) -> bool {
        self.start.is_some()
    }

    /// Extract text from nodes intersecting the selected rectangle.
    /// In full implementation, this would perform semantic copying.
    pub fn extract_text(
        &self,
        _rect: Rect,
        _node_rects: &[(String, LayoutRect)],
        _snapshot: &SemanticSnapshot,
    ) -> String {
        // Placeholder: will be implemented to copy based on node boundaries.
        // Real implementation would iterate node_rects, find intersection,
        // and extract content from the node's TextPanel or StateTree.
        String::new()
    }
}
