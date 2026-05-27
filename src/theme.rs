use ratatui::style::Color;

/// Nord theme color palette for Cellrix TUI
pub struct Nord;

impl Nord {
    pub const fn background() -> Color { Color::Rgb(24, 24, 26) }       
    pub const fn text_primary() -> Color { Color::Rgb(228, 228, 231) } 
    pub const fn text_secondary() -> Color { Color::Rgb(113, 113, 122) } 
    pub const fn border_inactive() -> Color { Color::Rgb(39, 39, 42) } 
    pub const fn border_active() -> Color { Color::Rgb(113, 113, 122) } 
    pub const fn accent_indigo() -> Color { Color::Rgb(91, 95, 199) }   
    pub const fn accent_amber() -> Color { Color::Rgb(208, 135, 112) }  
    pub const fn accent_green() -> Color { Color::Rgb(163, 190, 140) }  
}
