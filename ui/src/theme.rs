//! Somatic monasticism theme: colors only represent state, never decoration.

use ratatui::style::{Color, Modifier, Style};

#[derive(Debug, Clone)]
pub struct Theme {
    pub background: Color,
    pub foreground: Color,
    pub secondary: Color,
    pub reasoning: Color,      // Deep blue/indigo for reasoning
    pub alert: Color,          // Amber for high-risk / HITL
    pub success: Color,        // Green, transient flash
    pub deprecated: Style,     // Strikethrough + gray
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            background: Color::Rgb(24, 24, 26),      // #18181A
            foreground: Color::Rgb(228, 228, 231),   // #E4E4E7
            secondary: Color::Rgb(113, 113, 122),    // #71717A
            reasoning: Color::Rgb(91, 95, 199),      // #5B5FC7
            alert: Color::Rgb(208, 135, 112),        // #D08770
            success: Color::Rgb(163, 190, 140),      // #A3BE8C
            deprecated: Style::default()
                .fg(Color::Rgb(113, 113, 122))
                .add_modifier(Modifier::CROSSED_OUT),
        }
    }
}

impl Theme {
    pub fn style_default(&self) -> Style {
        Style::default().fg(self.foreground).bg(self.background)
    }

    pub fn style_secondary(&self) -> Style {
        Style::default().fg(self.secondary).bg(self.background)
    }

    pub fn style_reasoning(&self) -> Style {
        Style::default().fg(self.reasoning).bg(self.background)
    }

    pub fn style_alert(&self) -> Style {
        Style::default().fg(self.alert).bg(self.background).add_modifier(Modifier::BOLD)
    }

    pub fn style_success(&self) -> Style {
        Style::default().fg(self.success).bg(self.background)
    }
}
