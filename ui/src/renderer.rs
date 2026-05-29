use std::collections::HashMap;

use ratatui::{layout::Rect, Frame};
use ratatui::widgets::Widget;
use cellrix_protocol::{SemanticSnapshot, CapabilityManifest, NodeType};
use cellrix_layout::{LayoutEngine, LayoutRequest, LayoutOutput, LayoutError};
use crate::{
    widgets::{
        StateTreeWidget, TextPanelWidget, ActionButtonWidget,
        ProgressBarWidget, CodeDiffWidget, MetricsWidget, FallbackWidget,
        WidgetContext,
    },
    Theme, EnergyMode, SelectionManager, FocusManager,
};

pub struct Renderer {
    layout_engine: LayoutEngine,
    theme: Theme,
    energy_mode: EnergyMode,
    selection: SelectionManager,
    last_layout: Option<LayoutOutput>,
    last_snapshot: Option<SemanticSnapshot>,
}

impl Renderer {
    pub fn new() -> Self {
        Self {
            layout_engine: LayoutEngine::new(),
            theme: Theme::default(),
            energy_mode: EnergyMode::detect(),
            selection: SelectionManager::new(),
            last_layout: None,
            last_snapshot: None,
        }
    }

    pub fn set_energy_mode(&mut self, mode: EnergyMode) {
        self.energy_mode = mode;
    }

    /// Render the current snapshot with given layout overrides.
    /// Returns the computed layout output for further processing (e.g., tab switching).
    pub fn render(
        &mut self,
        frame: &mut Frame,
        snapshot: &SemanticSnapshot,
        manifest: Option<&CapabilityManifest>,
        terminal_size: (u16, u16),
        focus_manager: &FocusManager,
        active_overrides: HashMap<String, String>,
    ) -> Result<LayoutOutput, LayoutError> {
        let layout_req = LayoutRequest {
            snapshot: snapshot.clone(),
            manifest: manifest.cloned(),
            terminal_width: terminal_size.0,
            terminal_height: terminal_size.1,
            zen_focus_node_id: None,
            active_overrides,
        };
        let layout_output = self.layout_engine.compute(&layout_req)?;
        self.last_layout = Some(layout_output.clone());
        self.last_snapshot = Some(snapshot.clone());

        let ctx = WidgetContext {
            theme: &self.theme,
            snapshot,
            layout: &layout_output,
            is_zen: false,
            focus_manager,
        };

        let buffer = frame.buffer_mut();
        // Only render the active node in each slot to avoid overlapping.
        // 核心修改：slot_id → _slot_id，消除未使用变量警告
        for (_slot_id, active_node_id) in &layout_output.active_node_per_slot {
            if let Some(rect) = layout_output
                .node_rects
                .iter()
                .find(|(nid, _)| nid == active_node_id)
                .map(|(_, r)| *r)
            {
                if let Some(node) = snapshot.semantic_tree.iter().find(|n| n.id == *active_node_id) {
                    let area = Rect::new(rect.x, rect.y, rect.width, rect.height);
                    match node.node_type {
                        NodeType::StateTree => {
                            let widget = StateTreeWidget::new(node, &ctx);
                            Widget::render(widget, area, buffer);
                        }
                        NodeType::TextPanel => {
                            let widget = TextPanelWidget::new(node, &ctx);
                            Widget::render(widget, area, buffer);
                        }
                        NodeType::ActionButton => {
                            let widget = ActionButtonWidget::new(node, &ctx);
                            Widget::render(widget, area, buffer);
                        }
                        NodeType::ProgressBar => {
                            let widget = ProgressBarWidget::new(node, &ctx);
                            Widget::render(widget, area, buffer);
                        }
                        NodeType::CodeDiff => {
                            let widget = CodeDiffWidget::new(node, &ctx);
                            Widget::render(widget, area, buffer);
                        }
                        NodeType::Metrics => {
                            let widget = MetricsWidget::new(node, &ctx);
                            Widget::render(widget, area, buffer);
                        }
                        NodeType::Unknown => {
                            let widget = FallbackWidget::new(node, &ctx);
                            Widget::render(widget, area, buffer);
                        }
                    }
                }
            }
        }
        Ok(layout_output)
    }

    pub fn handle_mouse_event(&mut self, event: crossterm::event::MouseEvent) -> Option<String> {
        match event.kind {
            crossterm::event::MouseEventKind::Down(button) if button == crossterm::event::MouseButton::Left => {
                self.selection.start_drag(event.column, event.row);
                None
            }
            crossterm::event::MouseEventKind::Drag(button) if button == crossterm::event::MouseButton::Left => {
                self.selection.update_drag(event.column, event.row);
                None
            }
            crossterm::event::MouseEventKind::Up(button) if button == crossterm::event::MouseButton::Left => {
                if let Some(rect) = self.selection.end_drag() {
                    if let (Some(layout), Some(snapshot)) = (self.last_layout.as_ref(), self.last_snapshot.as_ref()) {
                        let text = self.selection.extract_text(rect, &layout.node_rects, snapshot);
                        if !text.is_empty() {
                            return Some(text);
                        }
                    }
                }
                None
            }
            _ => None,
        }
    }
}

impl Default for Renderer {
    fn default() -> Self {
        Self::new()
    }
}
