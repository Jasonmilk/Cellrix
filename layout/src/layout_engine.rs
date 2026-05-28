use cellrix_protocol::{SemanticSnapshot, CapabilityManifest, NodeType};
use crate::{SlotAllocator, SlotAssignment, SlotType, LayoutError, LayoutRect};

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
        let (slot_ids, slot_types, weights) = self.resolve_layout_strategy(req);
        let slot_rects = self.slot_allocator.allocate_slots(
            req.terminal_width,
            req.terminal_height,
            &slot_ids,
            &slot_types,
            &weights,
        )?;

        let node_rects = self.assign_nodes_to_slots(req, &slot_ids, &slot_rects);
        let slot_assignments = self.build_slot_assignments(req, &slot_ids, &slot_rects);

        Ok(LayoutOutput {
            node_rects,
            slot_assignments,
            slot_rects,
        })
    }

    /// Returns (slot_ids, slot_types, weights)
    fn resolve_layout_strategy(
        &self,
        req: &LayoutRequest,
    ) -> (Vec<String>, Vec<SlotType>, Vec<f64>) {
        // Zen mode override
        if let Some(focus_id) = &req.zen_focus_node_id {
            return self.build_zen_layout(req, focus_id);
        }

        // Explicit grid from snapshot.layout_overrides
        if let Some(overrides) = &req.snapshot.layout_overrides {
            if let Some(grid_def) = &overrides.grid {
                if let Ok((ids, types)) = self.convert_grid_definition(grid_def) {
                    let weights = vec![1.0; types.len()];
                    return (ids, types, weights);
                }
            }
        }

        // Explicit grid from manifest.layout_hints
        if let Some(manifest) = &req.manifest {
            if let Some(hints) = &manifest.layout_hints {
                if let Some(grid_def) = &hints.grid {
                    if let Ok((ids, types)) = self.convert_grid_definition(grid_def) {
                        let weights = vec![1.0; types.len()];
                        return (ids, types, weights);
                    }
                }
            }
        }

        // Implicit heuristics
        self.build_implicit_layout(req)
    }

    fn convert_grid_definition(
        &self,
        def: &cellrix_protocol::GridDefinition,
    ) -> Result<(Vec<String>, Vec<SlotType>), LayoutError> {
        let mut ids = Vec::new();
        let mut types = Vec::new();
        for grid_slot in &def.rows {
            ids.push(grid_slot.id.clone());
            let slot_type = match &grid_slot.constraint {
                cellrix_protocol::SlotConstraint::Percentage(p) => SlotType::Percentage(*p),
                cellrix_protocol::SlotConstraint::FixedLines(lines) => SlotType::FixedLines(*lines),
                cellrix_protocol::SlotConstraint::Min(min) => SlotType::Min(*min),
            };
            types.push(slot_type);
        }
        Ok((ids, types))
    }

    /// Implicit layout: sidebar (30%), main (70%), bottom (3 lines)
    fn build_implicit_layout(
        &self,
        req: &LayoutRequest,
    ) -> (Vec<String>, Vec<SlotType>, Vec<f64>) {
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

        let mut ids = Vec::new();
        let mut types = Vec::new();
        if has_sidebar {
            ids.push("sidebar".to_string());
            types.push(SlotType::Percentage(30.0));
        }
        if has_main {
            ids.push("main".to_string());
            types.push(SlotType::Percentage(70.0));
        }
        if has_bottom {
            ids.push("bottom".to_string());
            types.push(SlotType::FixedLines(3));
        }
        if ids.is_empty() {
            ids.push("main".to_string());
            types.push(SlotType::Percentage(100.0));
        }
        let weights = vec![1.0; types.len()];
        (ids, types, weights)
    }

    fn build_zen_layout(
        &self,
        req: &LayoutRequest,
        focus_id: &str,
    ) -> (Vec<String>, Vec<SlotType>, Vec<f64>) {
        let target_slot = self.find_slot_for_node(req, focus_id);
        let (ids, types, mut weights) = self.build_implicit_layout(req);
        let target_index = ids.iter().position(|id| id == &target_slot).unwrap_or(0);
        for i in 0..weights.len() {
            weights[i] = if i == target_index { 1.0 } else { 0.0 };
        }
        (ids, types, weights)
    }

    fn find_slot_for_node(&self, req: &LayoutRequest, node_id: &str) -> String {
        for node in &req.snapshot.semantic_tree {
            if node.id == node_id {
                if let Some(binding) = &node.slot_binding {
                    return binding.clone();
                }
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

    fn assign_nodes_to_slots(
        &self,
        req: &LayoutRequest,
        slot_ids: &[String],
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
        slot_ids: &[String],
        slot_rects: &[(String, LayoutRect)],
    ) -> Vec<SlotAssignment> {
        let mut assignments = Vec::new();
        for (slot_id, rect) in slot_rects {
            let node_ids: Vec<String> = req
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
                    binding == *slot_id
                })
                .map(|n| n.id.clone())
                .collect();
            assignments.push(SlotAssignment {
                slot_id: slot_id.clone(),
                rect: *rect,
                node_ids,
            });
        }
        assignments
    }
}

impl Default for LayoutEngine {
    fn default() -> Self {
        Self::new()
    }
}
