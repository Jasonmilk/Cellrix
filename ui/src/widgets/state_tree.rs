use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use ratatui::text::Text;
use cellrix_protocol::SemanticNode;
use crate::widgets::WidgetContext;

pub struct StateTreeWidget<'a> {
    node: &'a SemanticNode,
    ctx: &'a WidgetContext<'a>,
}

impl<'a> StateTreeWidget<'a> {
    pub fn new(node: &'a SemanticNode, ctx: &'a WidgetContext<'a>) -> Self {
        Self { node, ctx }
    }
}

impl<'a> Widget for StateTreeWidget<'a> {
    fn render(self, area: ratatui::layout::Rect, buf: &mut ratatui::buffer::Buffer) {
        let content = format!("📁 {}\n{}", self.node.label, 
            serde_json::to_string_pretty(&self.node.content).unwrap_or_default());
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(self.ctx.theme.style_secondary());
        let para = Paragraph::new(Text::from(content))
            .block(block)
            .style(self.ctx.theme.style_default());
        para.render(area, buf);
    }
}
