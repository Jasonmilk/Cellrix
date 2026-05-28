use cellrix_protocol::{SemanticSnapshot, CapabilityManifest, NodeType};
use crate::{LayoutError, LayoutRect};

pub struct LayoutRequest {
    pub snapshot: SemanticSnapshot,
    pub manifest: Option<CapabilityManifest>,
    pub terminal_width: u16,
    pub terminal_height: u16,
    pub zen_focus_node_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LayoutOutput {
    pub node_rects: Vec<(String, LayoutRect)>,
    pub slot_assignments: Vec<SlotAssignment>, // kept for compatibility
    pub slot_rects: Vec<(String, LayoutRect)>,
}

// Simplified slot assignment for compatibility
#[derive(Debug, Clone)]
pub struct SlotAssignment {
    pub slot_id: String,
    pub rect: LayoutRect,
    pub node_ids: Vec<String>,
}

pub struct LayoutEngine;

impl LayoutEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn compute(&mut self, req: &LayoutRequest) -> Result<LayoutOutput, LayoutError> {
        let width = req.terminal_width;
        let height = req.terminal_height;

        // Determine which slots are needed
        let mut has_sidebar = false;
        let mut has_main = false;
        let mut has_bottom = false;
        for node in &req.snapshot.semantic_tree {
            match node.node_type {
                NodeType::StateTree | NodeType::Metrics => has_sidebar = true,
                NodeType::TextPanel | NodeType::CodeDiff => has_main = true,
                NodeType::ActionButton | NodeType::ProgressBar => has_bottom = true,
                _ => {}
            }
        }

        // Define slot rectangles
        let mut slot_rects = Vec::new();
        let mut sidebar_rect = None;
        let mut main_rect = None;
        let mut bottom_rect = None;

        let bottom_height = if has_bottom { 3 } else { 0 };
        let remaining_height = height.saturating_sub(bottom_height);

        if has_sidebar && has_main {
            // Split remaining width: 30% sidebar, 70% main
            let sidebar_width = (width as f64 * 0.3) as u16;
            let main_width = width - sidebar_width;
            sidebar_rect = Some(LayoutRect { x: 0, y: 0, width: sidebar_width, height: remaining_height });
            main_rect = Some(LayoutRect { x: sidebar_width, y: 0, width: main_width, height: remaining_height });
        } else if has_sidebar {
            sidebar_rect = Some(LayoutRect { x: 0, y: 0, width, height: remaining_height });
        } else if has_main {
            main_rect = Some(LayoutRect { x: 0, y: 0, width, height: remaining_height });
        }

        if has_bottom {
            bottom_rect = Some(LayoutRect { x: 0, y: remaining_height, width, height: bottom_height });
        }

        // Build slot_rects list
        if let Some(rect) = sidebar_rect {
            slot_rects.push(("sidebar".to_string(), rect));
        }
        if let Some(rect) = main_rect {
            slot_rects.push(("main".to_string(), rect));
        }
        if let Some(rect) = bottom_rect {
            slot_rects.push(("bottom".to_string(), rect));
        }

        // Assign each node to a slot based on its type
        let mut node_rects = Vec::new();
        for node in &req.snapshot.semantic_tree {
            let slot_id = match node.node_type {
                NodeType::StateTree | NodeType::Metrics => "sidebar",
                NodeType::TextPanel | NodeType::CodeDiff => "main",
                NodeType::ActionButton | NodeType::ProgressBar => "bottom",
                _ => "main",
            };
            if let Some((_, rect)) = slot_rects.iter().find(|(id, _)| id == slot_id) {
                node_rects.push((node.id.clone(), *rect));
            } else if let Some(first_rect) = slot_rects.first().map(|(_, r)| *r) {
                // fallback
                node_rects.push((node.id.clone(), first_rect));
            }
        }

        // Build empty slot_assignments for compatibility
        let slot_assignments = slot_rects
            .iter()
            .map(|(id, rect)| SlotAssignment {
                slot_id: id.clone(),
                rect: *rect,
                node_ids: vec![],
            })
            .collect();

        Ok(LayoutOutput {
            node_rects,
            slot_assignments,
            slot_rects,
        })
    }
}

impl Default for LayoutEngine {
    fn default() -> Self {
        Self::new()
    }
}
