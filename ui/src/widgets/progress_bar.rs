use ratatui::widgets::{Block, Borders, Widget, Gauge};
use ratatui::style::Style;
use cellrix_protocol::SemanticNode;
use crate::widgets::WidgetContext;

pub struct ProgressBarWidget<'a> {
    node: &'a SemanticNode,
    ctx: &'a WidgetContext<'a>,
}

impl<'a> ProgressBarWidget<'a> {
    pub fn new(node: &'a SemanticNode, ctx: &'a WidgetContext<'a>) -> Self {
        Self { node, ctx }
    }
}

impl<'a> Widget for ProgressBarWidget<'a> {
    fn render(self, area: ratatui::layout::Rect, buf: &mut ratatui::buffer::Buffer) {
        let percent = self.node.content.get("percent")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as u16;
        let gauge = Gauge::default()
            .block(Block::default().borders(Borders::ALL).title(self.node.label.as_str()))
            .gauge_style(Style::default().fg(self.ctx.theme.reasoning))
            .percent(percent);
        gauge.render(area, buf);
    }
}
