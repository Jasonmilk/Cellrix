use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph, BorderType},
};
use std::io;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

mod cap_client;
mod app;
mod layout;
mod widgets;
mod theme;

use app::ShadowUiState;
use cap_client::{start_async_cap_listener, RealCapClient, NoopCapClient, CapClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse command line arguments for connection target
    let args: Vec<String> = std::env::args().collect();
    let connect_target = args.iter().position(|a| a == "--connect").and_then(|i| args.get(i + 1));

    // Initialize logging subsystem
    tracing_subscriber::fmt::init();

    // Create thread-safe shared UI state
    let ui_state = Arc::new(RwLock::new(ShadowUiState::default()));

    // Select CAP client based on command line arguments
    let cap_client: Arc<dyn CapClient + Send + Sync> = if let Some(target) = connect_target {
        Arc::new(RealCapClient::new(target))
    } else {
        Arc::new(NoopCapClient)
    };

    // Spawn async network listener thread
    let state_clone = ui_state.clone();
    let client_clone = cap_client.clone();
    tokio::spawn(async move {
        start_async_cap_listener(state_clone, client_clone).await;
    });

    // Initialize terminal configuration
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Main loop configuration (30 FPS tick rate)
    let tick_rate = Duration::from_millis(33);
    let mut last_tick = Instant::now();

    loop {
        // Check if UI requires redraw (dirty flag)
        let should_draw = {
            if let Ok(mut state) = ui_state.write() {
                let dirty = state.is_dirty;
                state.is_dirty = false;
                dirty
            } else {
                false
            }
        };

        // Redraw UI on dirty state or tick timeout
        if should_draw || last_tick.elapsed() >= tick_rate {
            terminal.draw(|f| {
                ui(f, &ui_state.read().unwrap());
            })?;
            last_tick = Instant::now();
        }

        // Non-blocking keyboard event handling
        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or(Duration::from_secs(0));

        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => break,
                    _ => {}
                }
            }
        }
    }

    // Restore terminal to original system state
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen
    )?;
    terminal.show_cursor()?;

    Ok(())
}

/// Main UI rendering function (Nord theme + dynamic CAP data rendering)
fn ui(f: &mut Frame, state: &ShadowUiState) {
    let bg = theme::Nord::background();
    f.render_widget(Paragraph::new("").style(Style::default().bg(bg)), f.size());

    let size = f.size();

    // Vertical layout: Status Bar | Main Area | Action Footer
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),  // Status bar
            Constraint::Min(0),     // Main content area
            Constraint::Length(1),  // Action hints
        ])
        .split(size);

    // Status bar (English only)
    let status_text = format!(
        " Cellrix v0.1.0 | Agent: {} | Press q to exit",
        if state.agent_connected { "Online" } else { "Waiting for connection" }
    );
    f.render_widget(
        Paragraph::new(status_text)
            .style(Style::default().fg(theme::Nord::text_primary())),
        chunks[0],
    );

    // Main area: Horizontal split (40% / 60%)
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(chunks[1]);

    // Left panel: Dynamic Semantic Tree Rendering
    let snapshot = &state.last_snapshot;
    let tree_text = snapshot
        .as_ref()
        .and_then(|s| s.get("semantic_tree"))
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .map(|node| {
                    let label = node["label"].as_str().unwrap_or("Unknown Node");
                    let content = node["content"].as_str().unwrap_or("No content");
                    format!("{}: {}", label, content)
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| "No state tree data\n\nWaiting for Agent connection...".to_string());

    let left_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::Nord::border_inactive()))
        .title(" ⏳ STATE TREE ")
        .title_style(Style::default().fg(theme::Nord::text_secondary()));
    f.render_widget(left_block, main_chunks[0]);
    f.render_widget(
        Paragraph::new(tree_text).style(Style::default().fg(theme::Nord::text_secondary())),
        main_chunks[0].inner(&Margin::new(2, 1)),
    );

    // Right panel: Dynamic Agent Metrics Rendering
    let metrics_text = snapshot
        .as_ref()
        .and_then(|s| s.get("metrics"))
        .and_then(|m| serde_json::to_string_pretty(m).ok())
        .unwrap_or_else(|| "No metrics data".to_string());

    let right_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::Nord::border_inactive()))
        .title(" 📊 METRICS ")
        .title_style(Style::default().fg(theme::Nord::text_secondary()));
    f.render_widget(right_block, main_chunks[1]);
    f.render_widget(
        Paragraph::new(metrics_text).style(Style::default().fg(theme::Nord::text_primary())),
        main_chunks[1].inner(&Margin::new(2, 1)),
    );

    // Footer action hints (English only)
    f.render_widget(
        Paragraph::new("[q] Exit  [Tab] Switch Focus (Pending)")
            .style(Style::default().fg(theme::Nord::text_secondary())),
        chunks[2],
    );
}
