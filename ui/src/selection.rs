// ui/src/selection.rs
//! Physical selection capture: mouse drag over semantic boundaries.

use ratatui::layout::Rect;
use cellrix_layout::{LayoutRect, MouseSelector};
use cellrix_protocol::SemanticSnapshot;

#[derive(Debug, Clone, Default)]
pub struct SelectionManager {
    start: Option<(u16, u16)>,
    end: Option<(u16, u16)>,
    dragging: bool,
}

impl SelectionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_drag(&mut self, x: u16, y: u16) {
        self.start = Some((x, y));
        self.end = None;
        self.dragging = true;
    }

    pub fn update_drag(&mut self, x: u16, y: u16) {
        if self.dragging {
            self.end = Some((x, y));
        }
    }

    pub fn end_drag(&mut self) -> Option<Rect> {
        if let (Some((x1, y1)), Some((x2, y2))) = (self.start, self.end) {
            self.dragging = false; 
            let x = x1.min(x2);
            let y = y1.min(y2);
            let width = (x1 as i32 - x2 as i32).abs() as u16 + 1;
            let height = (y1 as i32 - y2 as i32).abs() as u16 + 1;
            Some(Rect::new(x, y, width, height))
        } else {
            None
        }
    }

    pub fn clear(&mut self) {
        self.start = None;
        self.end = None;
        self.dragging = false;
    }

    pub fn is_active(&self) -> bool {
        self.start.is_some() && self.end.is_some()
    }

    /// 核心修复一：增加正在拖动（已启动）的物理判定，保障首包 Drag 穿透
    pub fn is_dragging(&self) -> bool {
        self.dragging
    }

    pub fn get_range(&self) -> Option<((u16, u16), (u16, u16))> {
        if let (Some(s), Some(e)) = (self.start, self.end) {
            Some((s, e))
        } else {
            None
        }
    }

    pub fn extract_text(
        &self,
        rect: Rect,
        node_rects: &[(String, LayoutRect)],
        snapshot: &SemanticSnapshot,
    ) -> String {
        // 核心修复二：执行 rect.width - 1 与 height - 1 的闭区间映射，彻底消除 discrete 差一导致的多行拦截 Bug！
        MouseSelector::select_text(
            rect.x,
            rect.y,
            rect.x + rect.width - 1,
            rect.y + rect.height - 1,
            node_rects,
            &snapshot.semantic_tree,
        )
        .unwrap_or_default()
    }
}
