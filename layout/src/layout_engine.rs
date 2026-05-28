use cellrix_protocol::{SemanticSnapshot, CapabilityManifest, NodeType};
use crate::{SlotAllocator, SlotAssignment, SlotType, LayoutError};

/// Request to the layout engine.
pub struct LayoutRequest {
    pub snapshot: SemanticSnapshot,
    pub manifest: Option<CapabilityManifest>,
    pub terminal_width: u16,
    pub terminal_height: u16,
    pub zen_focus_node_id: Option<String>,
}

/// Result of layout computation.
#[derive(Debug, Clone)]
pub struct LayoutOutput {
    pub node_rects: Vec<(String, LayoutRect)>,
    pub slot_assignments: Vec<SlotAssignment>,
    pub slot_rects: Vec<(String, LayoutRect)>,
}

/// Screen rectangle with integer coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

/// Core layout engine.
pub struct LayoutEngine {
    slot_allocator: SlotAllocator,
}

impl LayoutEngine {
    pub fn new() -> Self {
        Self {
            slot_allocator: SlotAllocator::new(),
        }
    }

    pub fn compute(&mut self, req: &LayoutRequest) -> Result<LayoutOutput, LayoutError> {
        let (slot_types, weights) = self.resolve_layout_strategy(req);
        let slot_rects = self.slot_allocator.allocate_slots(
            req.terminal_width,
            req.terminal_height,
            &slot_types,
            &weights,
        )?;

        let node_rects = self.assign_nodes_to_slots(req, &slot_rects);
        let slot_assignments = self.build_slot_assignments(req, &slot_rects);

        Ok(LayoutOutput {
            node_rects,
            slot_assignments,
            slot_rects,
        })
    }

    fn resolve_layout_strategy(&self, req: &LayoutRequest) -> (Vec<SlotType>, Vec<f64>) {
        // Zen mode override
        if let Some(focus_id) = &req.zen_focus_node_id {
            return self.build_zen_layout(req, focus_id);
        }

        // Explicit grid from snapshot.layout_overrides
        if let Some(overrides) = &req.snapshot.layout_overrides {
            if let Some(grid_def) = &overrides.grid {
                if let Ok(slots) = self.convert_grid_definition(grid_def) {
                    let weights = vec![1.0; slots.len()];
                    return (slots, weights);
                }
            }
        }

        // Explicit grid from manifest.layout_hints
        if let Some(manifest) = &req.manifest {
            if let Some(hints) = &manifest.layout_hints {
                if let Some(grid_def) = &hints.grid {
                    if let Ok(slots) = self.convert_grid_definition(grid_def) {
                        let weights = vec![1.0; slots.len()];
                        return (slots, weights);
                    }
                }
            }
        }

        // Implicit heuristics
        self.build_implicit_layout(req)
    }

    fn convert_grid_definition(&self, def: &cellrix_protocol::GridDefinition) -> Result<Vec<SlotType>, LayoutError> {
        let mut slots = Vec::new();
        for grid_slot in &def.rows {
            let slot_type = match &grid_slot.constraint {
                cellrix_protocol::SlotConstraint::Percentage(p) => SlotType::Percentage(*p),
                cellrix_protocol::SlotConstraint::FixedLines(lines) => SlotType::FixedLines(*lines),
                cellrix_protocol::SlotConstraint::Min(min) => SlotType::Min(*min),
            };
            slots.push(slot_type);
        }
        Ok(slots)
    }

    fn build_implicit_layout(&self, req: &LayoutRequest) -> (Vec<SlotType>, Vec<f64>) {
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

        let mut slots = Vec::new();
        if has_sidebar {
            slots.push(SlotType::Percentage(30.0));
        }
        if has_main {
            slots.push(SlotType::Percentage(70.0));
        }
        if has_bottom {
            slots.push(SlotType::FixedLines(3));
        }
        if slots.is_empty() {
            slots.push(SlotType::Percentage(100.0));
        }
        let weights = vec![1.0; slots.len()];
        (slots, weights)
    }

    fn build_zen_layout(&self, req: &LayoutRequest, focus_id: &str) -> (Vec<SlotType>, Vec<f64>) {
        let target_slot = self.find_slot_for_node(req, focus_id);
        let (mut slots, mut weights) = self.build_implicit_layout(req);
        let target_index = self.find_slot_index_by_id(&slots, &target_slot);
        for i in 0..weights.len() {
            weights[i] = if i == target_index { 1.0 } else { 0.0 };
        }
        (slots, weights)
    }

    fn find_slot_for_node(&self, req: &LayoutRequest, node_id: &str) -> String {
        for node in &req.snapshot.semantic_tree {
            if node.id == node_id {
                return match node.node_type {
                    NodeType::StateTree | NodeType::Metrics => "sidebar".to_string(),
                    NodeType::TextPanel | NodeType::CodeDiff => "main".to_string(),
                    NodeType::ActionButton | NodeType::ProgressBar => "bottom".to_string(),
                    _ => "main".to_string(),
                };
            }
        }
        "main".to_string()
    }

    fn find_slot_index_by_id(&self, slots: &[SlotType], slot_id: &str) -> usize {
        match slot_id {
            "sidebar" => 0,
            "main" => {
                if slots.len() > 1 && matches!(slots[1], SlotType::Percentage(_)) {
                    1
                } else {
                    0
                }
            }
            "bottom" => slots.len().saturating_sub(1),
            _ => 0,
        }
    }

    fn assign_nodes_to_slots(
        &self,
        req: &LayoutRequest,
        slot_rects: &[(String, LayoutRect)],
    ) -> Vec<(String, LayoutRect)> {
        let mut result = Vec::new();
        let slot_rect_map: std::collections::HashMap<_, _> = slot_rects.iter().cloned().collect();

        for node in &req.snapshot.semantic_tree {
            let slot_id = node.slot_binding.clone().unwrap_or_else(|| {
                match node.node_type {
                    NodeType::StateTree | NodeType::Metrics => "sidebar".to_string(),
                    NodeType::TextPanel | NodeType::CodeDiff => "main".to_string(),
                    NodeType::ActionButton | NodeType::ProgressBar => "bottom".to_string(),
                    _ => "main".to_string(),
                }
            });
            if let Some(rect) = slot_rect_map.get(&slot_id) {
                result.push((node.id.clone(), *rect));
            } else if let Some(first_rect) = slot_rects.first().map(|(_, r)| *r) {
                result.push((node.id.clone(), first_rect));
            }
        }
        result
    }

    fn build_slot_assignments(
        &self,
        req: &LayoutRequest,
        slot_rects: &[(String, LayoutRect)],
    ) -> Vec<SlotAssignment> {
        slot_rects
            .iter()
            .map(|(id, rect)| {
                let node_ids = req
                    .snapshot
                    .semantic_tree
                    .iter()
                    .filter(|n| {
                        let binding = n.slot_binding.clone().unwrap_or_else(|| {
                            match n.node_type {
                                NodeType::StateTree | NodeType::Metrics => "sidebar".to_string(),
                                NodeType::TextPanel | NodeType::CodeDiff => "main".to_string(),
                                NodeType::ActionButton | NodeType::ProgressBar => "bottom".to_string(),
                                _ => "main".to_string(),
                            }
                        });
                        binding == *id
                    })
                    .map(|n| n.id.clone())
                    .collect();
                SlotAssignment {
                    slot_id: id.clone(),
                    rect: *rect,
                    node_ids,
                }
            })
            .collect()
    }
}

impl Default for LayoutEngine {
    fn default() -> Self {
        Self::new()
    }
}
