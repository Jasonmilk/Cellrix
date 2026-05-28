//! # cellrix-ui — TUI renderer for Cellrix

mod app;
mod renderer;
mod widgets;
mod theme;
mod selection;
mod energy;

pub use app::App;
pub use renderer::Renderer;
pub use theme::Theme;
pub use selection::SelectionManager;
pub use energy::EnergyMode;

// Re-export FocusManager from layout so UI can use it
pub use cellrix_layout::FocusManager;

/// Common UI error type.
#[derive(Debug, thiserror::Error)]
pub enum UiError {
    #[error("Terminal initialization failed: {0}")]
    TerminalInit(String),
    #[error("Layout error: {0}")]
    Layout(#[from] cellrix_layout::LayoutError),
    #[error("Transport error: {0}")]
    Transport(#[from] cellrix_transport::TransportError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
