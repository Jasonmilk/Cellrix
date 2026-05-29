//! # cellrix-ui — TUI renderer for Cellrix

use cellrix_layout::LayoutError;
use cellrix_transport::TransportError;
use thiserror::Error;

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
#[derive(Debug, Error)]
pub enum UiError {
    #[error("Normal exit")]
    NormalExit,

    #[error("Layout error: {0}")]
    Layout(#[from] LayoutError),

    #[error("Transport error: {0}")]
    TransportError(#[from] TransportError),

    #[error("Request timeout")]
    RequestTimeout,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Application error: {0}")]
    Other(String),
}
