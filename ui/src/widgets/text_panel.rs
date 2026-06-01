// ui/src/widgets/text_panel.rs
use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use ratatui::text::Text;
use cellrix_protocol::SemanticNode;
use crate::widgets::WidgetContext;

pub struct TextPanelWidget<'a> {
    node: &'a SemanticNode,
    ctx: &'a WidgetContext<'a>,
}

impl<'a> TextPanelWidget<'a> {
    pub fn new(node: &'a SemanticNode, ctx: &'a WidgetContext<'a>) -> Self {
        Self { node, ctx }
    }
}

impl<'a> Widget for TextPanelWidget<'a> {
    fn render(self, area: ratatui::layout::Rect, buf: &mut ratatui::buffer::Buffer) {
        let text = self.node.content.get("text")
            .and_then(|v| v.as_str())
            .unwrap_or(&self.node.label);

        // Query the focused state dynamically
        let is_focused = self.ctx.focus_manager.is_focused(&self.node.id);

        // 核心解耦点二：完全交由 Theme 统一审美驱动，告别硬编码！
        let border_style = if is_focused {
            self.ctx.theme.style_focus()
        } else {
            self.ctx.theme.style_secondary()
        };

        // Render localized indicators based on focus state
        let title = if is_focused {
            format!(" ● {} ", self.node.label)
        } else {
            format!(" 📖 {} ", self.node.label)
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .title(title)
            .border_style(border_style);
            
        let para = Paragraph::new(Text::from(text))
            .block(block)
            .style(self.ctx.theme.style_default());
        para.render(area, buf);
    }
}
