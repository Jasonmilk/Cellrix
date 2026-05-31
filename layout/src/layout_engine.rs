use std::collections::HashMap;
use cellrix_protocol::{
    SemanticSnapshot, CapabilityManifest, NodeType, GridDefinition, SlotConstraint,
};
use crate::{LayoutError, LayoutRect};

/// Input to the layout engine.
pub struct LayoutRequest {
    pub snapshot: SemanticSnapshot,
    pub manifest: Option<CapabilityManifest>,
    pub terminal_width: u16,
    pub terminal_height: u16,
    pub zen_focus_node_id: Option<String>,
    /// Optional overrides for active node per slot (e.g., from user tab switching).
    pub active_overrides: HashMap<String, String>,
}

/// Output of the layout engine.
#[derive(Debug, Clone)]
pub struct LayoutOutput {
    /// Rectangles for all nodes (for mouse hit testing, etc.).
    pub node_rects: Vec<(String, LayoutRect)>,
    /// Logical slot rectangles.
    pub slot_rects: Vec<(String, LayoutRect)>,
    /// Currently visible node per slot (slot_id -> node_id).
    pub active_node_per_slot: HashMap<String, String>,
    /// All node IDs in each slot.
    pub slot_nodes: HashMap<String, Vec<String>>,
}

/// Lightweight layout specification extracted from either overrides or hints.
#[derive(Debug, Clone)]
enum LayoutSpec {
    Explicit(GridDefinition),
    Implicit,
}

pub struct LayoutEngine;

impl LayoutEngine {
    pub fn new() -> Self {
        Self
    }

    /// Compute layout based on the full override priority defined in CAP §3.1.
    ///
    /// Priority: snapshot.layout_overrides > manifest.layout_hints > implicit heuristics.
    /// Higher priority sources completely override lower ones.
    pub fn compute(&mut self, req: &LayoutRequest) -> Result<LayoutOutput, LayoutError> {
        let spec = Self::select_spec(&req.snapshot, req.manifest.as_ref())?;
        
        // 允许 slots 可变以便于注入禅修（Zen Mode）状态
        let mut slots = match spec {
            LayoutSpec::Explicit(grid) => Self::build_slots_from_grid(
                &grid,
                req.terminal_width,
                req.terminal_height,
            )?,
            LayoutSpec::Implicit => Self::build_implicit_slots(
                &req.snapshot.semantic_tree,
                req.terminal_width,
                req.terminal_height,
            ),
        };

        // Map nodes to slots (by slot_binding or type heuristic).
        let node_to_slot = Self::assign_nodes_to_slots(&req.snapshot.semantic_tree, &slots);

        // ==================== 禅修模式（Zen Mode）拦截适配 ====================
        // 如果激活了禅修模式，找到聚焦节点所属的槽位，将其尺寸提升为 100%，其他槽位收缩为 0。
        if let Some(ref zen_node_id) = req.zen_focus_node_id {
            if let Some(zen_slot_id) = node_to_slot.get(zen_node_id).cloned() {
                for (slot_id, rect) in &mut slots {
                    if *slot_id == zen_slot_id {
                        *rect = LayoutRect {
                            x: 0,
                            y: 0,
                            width: req.terminal_width,
                            height: req.terminal_height,
                        };
                    } else {
                        *rect = LayoutRect {
                            x: 0,
                            y: 0,
                            width: 0,
                            height: 0,
                        };
                    }
                }
            }
        }
        // ====================================================================

        // Build slot_id -> sorted list of node IDs.
        let mut slot_nodes: HashMap<String, Vec<String>> = HashMap::new();
        for (node_id, slot_id) in &node_to_slot {
            slot_nodes.entry(slot_id.clone()).or_default().push(node_id.clone());
        }

        // Determine active node per slot: first check user overrides, then focused hint,
        // then fall back to first node in slot.
        let mut active_node_per_slot: HashMap<String, String> = HashMap::new();
        for (slot_id, nodes) in &slot_nodes {
            if nodes.is_empty() {
                continue;
            }
            // User override has highest priority.
            if let Some(active) = req.active_overrides.get(slot_id) {
                if nodes.contains(active) {
                    active_node_per_slot.insert(slot_id.clone(), active.clone());
                    continue;
                }
            }
            // Use agent-suggested focused node if present in this slot.
            if let Some(focused) = req.snapshot.semantic_tree.iter()
                .find(|n| n.focused && nodes.contains(&n.id))
            {
                active_node_per_slot.insert(slot_id.clone(), focused.id.clone());
                continue;
            }
            // Default: first node in the slot.
            active_node_per_slot.insert(slot_id.clone(), nodes[0].clone());
        }

        // Build rectangles for all nodes (each node gets its slot rectangle).
        // 禅修模式下，非活跃槽位内的节点会自动继承宽度和高度为 0 的 LayoutRect，阻断视觉绘制
        let mut node_rects = Vec::new();
        for (node_id, slot_id) in &node_to_slot {
            if let Some(rect) = slots.iter().find(|(id, _)| id == slot_id).map(|(_, r)| *r) {
                node_rects.push((node_id.clone(), rect));
            }
        }

        Ok(LayoutOutput {
            node_rects,
            slot_rects: slots,
            active_node_per_slot,
            slot_nodes,
        })
    }

    /// Select layout specification following CAP full-override priority.
    fn select_spec(
        snapshot: &SemanticSnapshot,
        manifest: Option<&CapabilityManifest>,
    ) -> Result<LayoutSpec, LayoutError> {
        // 1. Snapshot overrides.
        if let Some(overrides) = &snapshot.layout_overrides {
            if let Some(grid) = &overrides.grid {
                return Ok(LayoutSpec::Explicit(grid.clone()));
            }
        }
        // 2. Manifest layout hints.
        if let Some(m) = manifest {
            if let Some(hints) = &m.layout_hints {
                if let Some(grid) = &hints.grid {
                    return Ok(LayoutSpec::Explicit(grid.clone()));
                }
            }
        }
        // 3. Implicit heuristics.
        Ok(LayoutSpec::Implicit)
    }

    /// Build slot rectangles from a GridDefinition.
    fn build_slots_from_grid(
        grid: &GridDefinition,
        width: u16,
        height: u16,
    ) -> Result<Vec<(String, LayoutRect)>, LayoutError> {
        let mut slots = Vec::with_capacity(grid.rows.len());
        // We'll stack rows vertically; for simplicity, horizontal splits are not yet supported.
        let total_rows = grid.rows.len();
        if total_rows == 0 {
            return Err(LayoutError::InvalidGrid("Grid has no rows".into()));
        }

        // Calculate height for each row based on constraints.
        let mut remaining_height = height as i32;
        let mut y = 0u16;
        // First pass: handle fixed and min constraints; collect percentage rows.
        let mut percentage_rows: Vec<(usize, f64)> = Vec::new();
        for (idx, row) in grid.rows.iter().enumerate() {
            match &row.constraint {
                SlotConstraint::FixedLines(lines) => {
                    if remaining_height < *lines as i32 {
                        return Err(LayoutError::NoSpace);
                    }
                    slots.push((row.id.clone(), LayoutRect { x: 0, y, width, height: *lines }));
                    y += lines;
                    remaining_height -= *lines as i32;
                }
                SlotConstraint::Min(min) => {
                    if remaining_height < *min as i32 {
                        return Err(LayoutError::NoSpace);
                    }
                    // Treat Min as a fixed allocation for now; future: resize.
                    slots.push((row.id.clone(), LayoutRect { x: 0, y, width, height: *min }));
                    y += min;
                    remaining_height -= *min as i32;
                }
                SlotConstraint::Percentage(p) => {
                    percentage_rows.push((idx, *p));
                }
            }
        }

        // Distribute remaining height among percentage rows.
        if !percentage_rows.is_empty() {
            let total_perc: f64 = percentage_rows.iter().map(|(_, p)| p).sum();
            for (idx, perc) in percentage_rows {
                let h = ((remaining_height as f64) * (perc / total_perc)) as u16;
                // Ensure we don't overflow.
                let h = h.min(remaining_height as u16);
                slots.push((grid.rows[idx].id.clone(), LayoutRect { x: 0, y, width, height: h }));
                y += h;
                remaining_height -= h as i32;
            }
        }

        // Sort slots by original row order (they should already be in order).
        Ok(slots)
    }

    /// Build implicit slots based on node types (fallback).
    fn build_implicit_slots(
        nodes: &[cellrix_protocol::SemanticNode],
        width: u16,
        height: u16,
    ) -> Vec<(String, LayoutRect)> {
        let mut has_sidebar = false;
        let mut has_main = false;
        let mut has_bottom = false;
        for node in nodes {
            match node.node_type {
                NodeType::StateTree | NodeType::Metrics => has_sidebar = true,
                NodeType::TextPanel | NodeType::CodeDiff | NodeType::Unknown => has_main = true,
                NodeType::ActionButton | NodeType::ProgressBar => has_bottom = true,
            }
        }

        let bottom_height = if has_bottom { 3 } else { 0 };
        let remaining_height = height.saturating_sub(bottom_height);

        let mut slots = Vec::new();
        if has_sidebar && has_main {
            let sidebar_width = (width as f64 * 0.3) as u16;
            let main_width = width - sidebar_width;
            slots.push(("sidebar".to_string(), LayoutRect { x: 0, y: 0, width: sidebar_width, height: remaining_height }));
            slots.push(("main".to_string(), LayoutRect { x: sidebar_width, y: 0, width: main_width, height: remaining_height }));
        } else if has_sidebar {
            slots.push(("sidebar".to_string(), LayoutRect { x: 0, y: 0, width, height: remaining_height }));
        } else if has_main {
            slots.push(("main".to_string(), LayoutRect { x: 0, y: 0, width, height: remaining_height }));
        }
        if has_bottom {
            slots.push(("bottom".to_string(), LayoutRect { x: 0, y: remaining_height, width, height: bottom_height }));
        }
        slots
    }

    /// Assign every node to a slot ID.
    fn assign_nodes_to_slots(
        nodes: &[cellrix_protocol::SemanticNode],
        slots: &[(String, LayoutRect)],
    ) -> HashMap<String, String> {
        let mut map = HashMap::new();
        for node in nodes {
            // If node explicitly binds to a slot, use it.
            if let Some(ref binding) = node.slot_binding {
                if slots.iter().any(|(id, _)| id == binding) {
                    map.insert(node.id.clone(), binding.clone());
                    continue;
                }
            }
            // Otherwise, use type heuristic.
            let slot_id = match node.node_type {
                NodeType::StateTree | NodeType::Metrics => "sidebar",
                NodeType::TextPanel | NodeType::CodeDiff | NodeType::Unknown => "main",
                NodeType::ActionButton | NodeType::ProgressBar => "bottom",
            };
            // Ensure the heuristic slot actually exists; if not, pick the first available.
            if slots.iter().any(|(id, _)| id == slot_id) {
                map.insert(node.id.clone(), slot_id.to_string());
            } else if let Some(first) = slots.first() {
                map.insert(node.id.clone(), first.0.clone());
            }
        }
        map
    }
}

impl Default for LayoutEngine {
    fn default() -> Self {
        Self::new()
    }
}
