// ui/src/renderer.rs
use std::collections::HashMap;

use cellrix_protocol::anaphase::AgentSnapshot;
use ratatui::{layout::Rect, Frame};
use ratatui::widgets::{Widget, Paragraph};
use ratatui::text::{Line, Span};
use ratatui::style::{Style, Color, Modifier};

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

    /// Clear the selection highlight (called dynamically by App)
    pub fn clear_selection(&mut self) {
        self.selection.clear();
    }

    /// Check if the selection drag is actively started
    pub fn is_selection_dragging(&self) -> bool {
        self.selection.is_dragging()
    }

    /// Perform physical hit testing: find which semantic node contains the mouse coordinate (col, row)
    pub fn hit_test(&self, col: u16, row: u16) -> Option<String> {
        let layout = self.last_layout.as_ref()?;
        for (node_id, rect) in &layout.node_rects {
            if col >= rect.x
                && col < rect.x + rect.width
                && row >= rect.y
                && row < rect.y + rect.height
            {
                return Some(node_id.clone());
            }
        }
        None
    }

    pub fn render(
        &mut self,
        frame: &mut Frame,
        snapshot: &SemanticSnapshot,
        manifest: Option<&CapabilityManifest>,
        terminal_size: (u16, u16),
        focus_manager: &FocusManager,
        active_overrides: HashMap<String, String>,
        zen_focus_node_id: Option<&str>,
        cockpit: Option<&AgentSnapshot>,
        _mouse_capture_active: bool, // Core Fix: Added underscore to completely eliminate unused variable compiler warnings
    ) -> Result<LayoutOutput, LayoutError> {
        // Reserve the bottom rows: 1 legend bar + (optional) cockpit strip.
        let cockpit_h: u16 = if cockpit.is_some() { 5 } else { 0 };
        let layout_height = terminal_size.1.saturating_sub(1).saturating_sub(cockpit_h);

        let layout_req = LayoutRequest {
            snapshot: snapshot.clone(),
            manifest: manifest.cloned(),
            terminal_width: terminal_size.0,
            terminal_height: layout_height,
            zen_focus_node_id: zen_focus_node_id.map(|s| s.to_string()),
            active_overrides,
            config: cellrix_layout::LayoutConfig::default(), // Decoupled config injected natively!
        };
        let layout_output = self.layout_engine.compute(&layout_req)?;
        self.last_layout = Some(layout_output.clone());
        self.last_snapshot = Some(snapshot.clone());

        let ctx = WidgetContext {
            theme: &self.theme,
            snapshot,
            layout: &layout_output,
            is_zen: zen_focus_node_id.is_some(),
            focus_manager,
        };

        let buffer = frame.buffer_mut();
        // Only render the active node in each slot to avoid overlapping.
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

        // ==================== Selection Highlight Rendering over physical cells ====================
        if let Some(((x1, y1), (x2, y2))) = self.selection.get_range() {
            let min_x = x1.min(x2);
            let max_x = x1.max(x2);
            let min_y = y1.min(y2);
            let max_y = y1.max(y2);

            let buffer = frame.buffer_mut();
            for y in min_y..=max_y {
                for x in min_x..=max_x {
                    if x < buffer.area.width && y < buffer.area.height {
                        let cell = buffer.get_mut(x, y);
                        cell.set_style(
                            Style::default()
                                .bg(Color::Rgb(91, 95, 199)) // Selection background: Monastic Indigo Blue (#5B5FC7)
                                .fg(Color::Rgb(228, 228, 231)) // Selection foreground: Paper White (#E4E4E7)
                        );
                    }
                }
            }
        }

        // ==================== Somatic Help Legend (Alt/Opt Dual-Key Prompting) ====================
        let key_style = Style::default().fg(Color::Rgb(91, 95, 199)).add_modifier(Modifier::BOLD); // Monastic Indigo Blue
        let desc_style = Style::default().fg(Color::Rgb(113, 113, 122)); // Slate Gray (#71717A)
        let separator_style = Style::default().fg(Color::Rgb(63, 63, 70)); // Dark Gray Boundary

        let legend_line = Line::from(vec![
            Span::styled(" ^C ", key_style),
            Span::styled("Exit  ", desc_style),
            Span::styled("│", separator_style),
            Span::styled(" Tab ", key_style),
            Span::styled("Focus  ", desc_style),
            Span::styled("│", separator_style),
            Span::styled(" Alt+←/→ ", key_style),
            Span::styled("Tabs  ", desc_style),
            Span::styled("│", separator_style),
            // Mac-Compatible self-documenting legend: clearly points out Option/Alt key usage
            Span::styled(" Alt/Opt+Drag ", key_style),
            Span::styled("Copy  ", desc_style),
            Span::styled("│", separator_style),
            // Added Shift+Drag OS-Bypass legend to guide Mac users on native copy (Pillar B aligned)
            Span::styled(" Shift+Drag ", key_style),
            Span::styled("OS  ", desc_style),
            Span::styled("│", separator_style),
            if zen_focus_node_id.is_some() {
                Span::styled(" ^O ", Style::default().fg(Color::Rgb(208, 135, 112)).add_modifier(Modifier::BOLD)) // Alert Amber (#D08770)
            } else {
                Span::styled(" ^O ", key_style)
            },
            if zen_focus_node_id.is_some() {
                Span::styled("Exit Zen  ", desc_style)
            } else {
                Span::styled("Zen  ", desc_style)
            },
        ]);

        let legend_paragraph = Paragraph::new(legend_line)
            .style(Style::default().bg(Color::Rgb(24, 24, 26))); // Volcano base background (#18181A)
        
        let legend_area = Rect::new(0, terminal_size.1.saturating_sub(1), terminal_size.0, 1);
        frame.render_widget(legend_paragraph, legend_area);

        // Candidate G: Anaphase cockpit strip (mode / episode / ledger review).
        if let Some(snap) = cockpit {
            if terminal_size.1 >= 12 {
                let cockpit_area = Rect::new(
                    0,
                    legend_area.y.saturating_sub(cockpit_h),
                    terminal_size.0,
                    cockpit_h,
                );
                let widget = crate::widgets::CockpitWidget::new(snap);
                Widget::render(widget, cockpit_area, frame.buffer_mut());
            }
        }
        // =========================================================================================

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
