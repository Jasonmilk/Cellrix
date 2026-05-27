use ratatui::style::{Color, Style, Modifier};

pub struct Nord;

impl Nord {
    pub fn bg() -> Color { Color::Rgb(24, 24, 26) }
    
    pub fn text_primary() -> Style { 
        Style::default().fg(Color::Rgb(228, 228, 231)) 
    }
    
    pub fn text_secondary() -> Style { 
        Style::default().fg(Color::Rgb(113, 113, 122)) 
    }
    
    pub fn active_border() -> Style { 
        Style::default().fg(Color::Rgb(91, 95, 199)).add_modifier(Modifier::BOLD) 
    }
    
    pub fn inactive_border() -> Style { 
        Style::default().fg(Color::Rgb(39, 39, 42)) 
    }
    
    pub fn status_bar() -> Style { 
        Style::default().bg(Color::Rgb(39, 39, 42)).fg(Color::Rgb(228, 228, 231)) 
    }
    
    pub fn accent_indigo() -> Color { Color::Rgb(91, 95, 199) }
    pub fn accent_amber() -> Color { Color::Rgb(208, 135, 112) }
    pub fn accent_green() -> Color { Color::Rgb(163, 190, 140) }
}
