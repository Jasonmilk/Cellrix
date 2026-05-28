use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use ratatui::text::Text;
use cellrix_protocol::SemanticNode;
use crate::widgets::WidgetContext;

pub struct FallbackWidget<'a> {
    node: &'a SemanticNode,
    ctx: &'a WidgetContext<'a>,
}

impl<'a> FallbackWidget<'a> {
    pub fn new(node: &'a SemanticNode, ctx: &'a WidgetContext<'a>) -> Self {
        Self { node, ctx }
    }
}

impl<'a> Widget for FallbackWidget<'a> {
    fn render(self, area: ratatui::layout::Rect, buf: &mut ratatui::buffer::Buffer) {
        let content = format!("⚠️ Unknown Node Type\nID: {}\nLabel: {}\nRaw: {}",
            self.node.id,
            self.node.label,
            serde_json::to_string(&self.node.content).unwrap_or_default()
        );
        let block = Block::default()
            .borders(Borders::ALL)
            .title("Diagnostic")
            .border_style(self.ctx.theme.style_alert());
        let para = Paragraph::new(Text::from(content))
            .block(block)
            .style(self.ctx.theme.style_default());
        para.render(area, buf);
    }
}
