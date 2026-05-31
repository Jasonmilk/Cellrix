// ui/src/tui/widgets/action_button.rs
use ratatui::{prelude::*, widgets::*};

pub fn render_action_button(
    frame: &mut Frame,
    area: Rect,
    label: &str,
    is_focused: bool, // 必须由 ui 渲染器通过判断 (node.id == local_focus_id) 传入
) {
    // 对齐白皮书 8.2 调色板
    let border_color = if is_focused {
        Color::from_u32(0x5B5FC7) // 深邃蓝/靛青：焦点激活
    } else {
        Color::from_u32(0x71717A) // 板岩灰：未激活
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(
            label,
            Style::default().fg(if is_focused { Color::from_u32(0xE4E4E7) } else { Color::from_u32(0x71717A) }),
        ));

    frame.render_widget(block, area);
}
