use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use ratatui::text::Text;
use cellrix_protocol::SemanticNode;
use crate::widgets::WidgetContext;

pub struct CodeDiffWidget<'a> {
    node: &'a SemanticNode,
    ctx: &'a WidgetContext<'a>,
}

impl<'a> CodeDiffWidget<'a> {
    pub fn new(node: &'a SemanticNode, ctx: &'a WidgetContext<'a>) -> Self {
        Self { node, ctx }
    }
}

impl<'a> Widget for CodeDiffWidget<'a> {
    fn render(self, area: ratatui::layout::Rect, buf: &mut ratatui::buffer::Buffer) {
        let diff_text = self.node.content.get("diff")
            .and_then(|v| v.as_str())
            .unwrap_or("No diff available");
        let block = Block::default()
            .borders(Borders::ALL)
            .title(self.node.label.as_str())
            .border_style(self.ctx.theme.style_secondary());
        let para = Paragraph::new(Text::from(diff_text))
            .block(block)
            .style(self.ctx.theme.style_default());
        para.render(area, buf);
    }
}
