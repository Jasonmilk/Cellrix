use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use ratatui::text::Text;
use cellrix_protocol::SemanticNode;
use crate::widgets::WidgetContext;

pub struct ActionButtonWidget<'a> {
    node: &'a SemanticNode,
    ctx: &'a WidgetContext<'a>,
}

impl<'a> ActionButtonWidget<'a> {
    pub fn new(node: &'a SemanticNode, ctx: &'a WidgetContext<'a>) -> Self {
        Self { node, ctx }
    }
}

impl<'a> Widget for ActionButtonWidget<'a> {
    fn render(self, area: ratatui::layout::Rect, buf: &mut ratatui::buffer::Buffer) {
        // 直接从 FocusManager 查询当前节点是否处于焦点
        let is_focused = self.ctx.focus_manager.is_focused(&self.node.id);
        let border_style = if is_focused {
            self.ctx.theme.style_reasoning()
        } else {
            self.ctx.theme.style_secondary()
        };
        let block = Block::default()
            .borders(Borders::ALL)
            .title(format!("[ {} ]", self.node.label))
            .border_style(border_style);
        let instruction = if is_focused { "Press Enter to execute" } else { "Click to execute" };
        let para = Paragraph::new(Text::from(instruction))
            .block(block)
            .style(self.ctx.theme.style_default());
        para.render(area, buf);
    }
}
