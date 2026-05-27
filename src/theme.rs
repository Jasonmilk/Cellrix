use ratatui::style::Color;

/// Nord theme color palette for Cellrix TUI
pub struct Nord;

impl Nord {
    pub const fn background() -> Color { Color::Rgb(24, 24, 26) }       // #18181A
    pub const fn text_primary() -> Color { Color::Rgb(228, 228, 231) } // #E4E4E7
    pub const fn text_secondary() -> Color { Color::Rgb(113, 113, 122) } // #71717A
    pub const fn border_inactive() -> Color { Color::Rgb(39, 39, 42) } // #27272A
    pub const fn accent_indigo() -> Color { Color::Rgb(91, 95, 199) }   // #5B5FC7
    pub const fn accent_amber() -> Color { Color::Rgb(208, 135, 112) }  // #D08770
    pub const fn accent_green() -> Color { Color::Rgb(163, 190, 140) }  // #A3BE8C
}
