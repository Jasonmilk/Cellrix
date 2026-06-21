use std::io::{Write, Stdout};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use crate::UiError;

/// RAII Terminal barrier. Ensures raw terminal settings, mouse capturing,
/// and alternate screen setups are automatically rolled back safely on exit (or on Panics!).
pub struct TerminalGuard {
    pub terminal: Terminal<CrosstermBackend<Stdout>>,
}

impl TerminalGuard {
    /// Initialized raw terminal environment.
    pub fn create() -> Result<Self, UiError> {
        crossterm::terminal::enable_raw_mode()?;
        let mut stdout = std::io::stdout();
        
        crossterm::execute!(
            stdout, 
            crossterm::terminal::EnterAlternateScreen,
            crossterm::event::EnableMouseCapture
        )?;
        let _ = stdout.flush();
        
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;
        terminal.clear()?;

        Ok(Self { terminal })
    }
}

impl Drop for TerminalGuard {
    /// Graceful teardown. Automatically restores terminal context even under panic unwinding.
    fn drop(&mut self) {
        let mut stdout = std::io::stdout();
        let _ = crossterm::execute!(
            stdout,
            crossterm::event::DisableMouseCapture,
            crossterm::terminal::LeaveAlternateScreen
        );
        let _ = stdout.flush();
        let _ = crossterm::terminal::disable_raw_mode();
    }
}
