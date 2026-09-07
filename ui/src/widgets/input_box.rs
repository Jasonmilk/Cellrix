// ui/src/widgets/input_box.rs
//! Input panel widget — the dynamic-attribute input box.
//!
//! When an action button declares `needs_input=true` (e.g. the agent's
//! `send_message`), the renderer instantiates this widget instead of the
//! plain action button. It renders the conversation record (who + timestamp
//! + text, isomorphic with the WebUI message flow), the input line, and the
//! last-send status — inside the node's own grid slot, so background,
//! borders and focus all follow the Cellrix theme and the semantic tree.
//! Nothing here is hardcoded: label/placeholder come from the node, colors
//! come from the theme, row count adapts to the slot height.

use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use ratatui::text::Text;
use ratatui::style::{Style, Modifier};
use cellrix_protocol::SemanticNode;
use crate::widgets::{WidgetContext, ChatUiState};

pub struct InputBoxWidget<'a> {
    node: &'a SemanticNode,
    ctx: &'a WidgetContext<'a>,
    chat: &'a ChatUiState<'a>,
}

impl<'a> InputBoxWidget<'a> {
    pub fn new(node: &'a SemanticNode, ctx: &'a WidgetContext<'a>, chat: &'a ChatUiState<'a>) -> Self {
        Self { node, ctx, chat }
    }

    fn placeholder(&self) -> String {
        self.node
            .content
            .get("placeholder")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "message...".to_string())
    }
}

impl<'a> Widget for InputBoxWidget<'a> {
    fn render(self, area: ratatui::layout::Rect, buf: &mut ratatui::buffer::Buffer) {
        let node_focused = self.ctx.focus_manager.is_focused(&self.node.id);
        let active = node_focused && self.chat.input_active;

        let border_style = if node_focused {
            self.ctx.theme.style_focus()
        } else {
            self.ctx.theme.style_secondary()
        };
        let title = if active {
            format!(" [ {} — Enter 发送 · Esc 退出 ] ", self.node.label)
        } else {
            format!(" [ {} ] ", self.node.label)
        };
        let block = Block::default()
            .borders(Borders::ALL)
            .title(title)
            .border_style(border_style);

        // Content rows adapt to the slot height: status + input lines are
        // fixed, everything else belongs to the conversation record.
        let inner_h = area.height.saturating_sub(2).max(2) as usize;
        let record_rows = inner_h.saturating_sub(2);

        let mut lines: Vec<ratatui::text::Line> = Vec::new();
        let tail: Vec<_> = self.chat.history.iter().rev().take(record_rows).collect();
        for entry in tail.iter().rev() {
            let who = match entry.who {
                crate::app::state::ChatWho::Driver => "你",
                crate::app::state::ChatWho::Helix => "Helix",
            };
            let who_style = match entry.who {
                crate::app::state::ChatWho::Driver => self.ctx.theme.style_reasoning(),
                crate::app::state::ChatWho::Helix => {
                    Style::default()
                        .fg(self.ctx.theme.reasoning)
                        .bg(self.ctx.theme.background)
                }
            };
            lines.push(ratatui::text::Line::from(vec![
                ratatui::text::Span::styled(format!("{who} "), who_style),
                ratatui::text::Span::styled(
                    entry.ts.clone(),
                    Style::default()
                        .fg(self.ctx.theme.secondary)
                        .bg(self.ctx.theme.background),
                ),
                ratatui::text::Span::raw("  "),
                ratatui::text::Span::styled(
                    entry.text.clone(),
                    Style::default()
                        .fg(self.ctx.theme.foreground)
                        .bg(self.ctx.theme.background),
                ),
            ]));
        }

        let input_text = if active {
            format!("> {}{}", self.chat.buffer, "▌")
        } else {
            format!("> {}（按 Enter 输入）", self.placeholder())
        };
        lines.push(ratatui::text::Line::from(ratatui::text::Span::styled(
            input_text,
            Style::default()
                .fg(self.ctx.theme.foreground)
                .bg(self.ctx.theme.background),
        )));

        let status_text = match self.chat.last_response {
            Some(r) if r.starts_with("✗") => r.to_string(),
            Some(r) => format!("Helix: {r}"),
            None => "（还没有对话，发第一句吧）".to_string(),
        };
        let status_style = match self.chat.last_response {
            Some(r) if r.starts_with("✗") => self.ctx.theme.style_alert(),
            _ => Style::default()
                .fg(self.ctx.theme.reasoning)
                .bg(self.ctx.theme.background),
        };
        lines.push(ratatui::text::Line::from(ratatui::text::Span::styled(
            status_text,
            status_style,
        )));

        let para = Paragraph::new(Text::from(lines))
            .block(block)
            .style(self.ctx.theme.style_default());
        para.render(area, buf);
    }
}
