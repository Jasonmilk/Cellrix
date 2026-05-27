use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};
use std::io;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use argh::FromArgs;
use std::env;

// Core Modules
mod cap_client;
mod app;
mod transport;
mod theme;

// Import Core Types
use app::{ShadowUiState, Panel, AestheticLevel};
use cap_client::{CapTransport, start_async_cap_listener};
use transport::{tcp::TcpTransport, stdio::StdioTransport, uds::UdsTransport};
use theme::Nord;

/// Cellrix: Universal Agent UI runtime
#[derive(FromArgs)]
struct Cli {
    /// agent endpoint (tcp://host:port, uds://path, http://host:port)
    #[argh(option)]
    connect: Option<String>,

    /// command to launch agent (STDIO mode)
    #[argh(option)]
    exec: Option<String>,

    /// override UI aesthetic level (discrete, reactive, continuous)
    #[argh(option)]
    aesthetic: Option<String>,
}

/// Auto-detect optimal aesthetic level based on environment
fn detect_aesthetic_level(args: &Cli) -> AestheticLevel {
    // CLI argument override (highest priority)
    if let Some(ref val) = args.aesthetic {
        match val.to_lowercase().as_str() {
            "discrete" => return AestheticLevel::Discrete,
            "reactive" => return AestheticLevel::Reactive,
            "continuous" => return AestheticLevel::Continuous,
            _ => eprintln!("Unknown aesthetic level '{}', using auto-detect", val),
        }
    }

    // Environment variable override
    if let Ok(val) = env::var("CELLRIX_AESTHETIC") {
        match val.to_lowercase().as_str() {
            "discrete" => return AestheticLevel::Discrete,
            "reactive" => return AestheticLevel::Reactive,
            "continuous" => return AestheticLevel::Continuous,
            _ => eprintln!("Invalid CELLRIX_AESTHETIC value, falling back"),
        }
    }

    // Heuristic environment detection
    let is_remote_session = env::var("SSH_TTY").is_ok() || env::var("SSH_CONNECTION").is_ok();
    let has_true_color = env::var("COLORTERM")
        .map(|v| v == "truecolor" || v == "24bit")
        .unwrap_or(false);
    let is_gpu_terminal = env::var("TERM")
        .map(|t| matches!(t.as_str(), "alacritty" | "kitty" | "wezterm"))
        .unwrap_or(false);

    if is_remote_session || !has_true_color {
        AestheticLevel::Discrete
    } else if is_gpu_terminal {
        AestheticLevel::Continuous
    } else {
        AestheticLevel::Reactive
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse CLI arguments
    let cli: Cli = argh::from_env();
    let aesthetic_level = detect_aesthetic_level(&cli);

    // Initialize logging
    tracing_subscriber::fmt::init();

    // Initialize shared UI state with detected aesthetic level
    let mut ui_state = ShadowUiState::default();
    ui_state.aesthetic_level = aesthetic_level;
    let ui_state = Arc::new(RwLock::new(ui_state));

    // Transport layer initialization
    let transport: Arc<tokio::sync::Mutex<Box<dyn CapTransport>>> = if let Some(cmd) = cli.exec {
        let stdio_transport = StdioTransport::new(&cmd).await?;
        Arc::new(tokio::sync::Mutex::new(Box::new(stdio_transport)))
    } else if let Some(target) = cli.connect {
        if target.starts_with("tcp://") {
            let tcp_transport = TcpTransport::new(&target[6..]);
            Arc::new(tokio::sync::Mutex::new(Box::new(tcp_transport)))
        } else if target.starts_with("uds://") {
            let uds_transport = UdsTransport::new(&target[6..]);
            Arc::new(tokio::sync::Mutex::new(Box::new(uds_transport)))
        } else {
            let tcp_transport = TcpTransport::new(&target);
            Arc::new(tokio::sync::Mutex::new(Box::new(tcp_transport)))
        }
    } else {
        println!("Noop mode: No agent connected. Use --connect or --exec");
        return Ok(());
    };

    // Start background network listener
    let state_clone = ui_state.clone();
    tokio::spawn(async move {
        start_async_cap_listener(state_clone, transport).await;
    });

    // Terminal initialization
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // UI render loop configuration
    let tick_rate = Duration::from_millis(33);
    let mut last_tick = std::time::Instant::now();

    // Main event loop
    loop {
        let state = ui_state.read().unwrap();
        terminal.draw(|f| ui(f, &state))?;
        drop(state);

        // Input event handling
        if crossterm::event::poll(tick_rate - last_tick.elapsed())? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    // Quit application
                    KeyCode::Esc | KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        break;
                    }

                    // Switch active panel
                    KeyCode::Tab => {
                        let mut state = ui_state.write().unwrap();
                        state.active_panel = match state.active_panel {
                            Panel::StateTree => Panel::Metrics,
                            Panel::Metrics => Panel::StateTree,
                        };
                        state.is_dirty = true;
                    }

                    // Scroll controls
                    KeyCode::Up => {
                        let mut state = ui_state.write().unwrap();
                        state.state_tree_scroll = state.state_tree_scroll.saturating_sub(1);
                        state.is_dirty = true;
                    }
                    KeyCode::Down => {
                        let mut state = ui_state.write().unwrap();
                        state.state_tree_scroll += 1;
                        state.is_dirty = true;
                    }

                    _ => {}
                }
            }
        }

        // Render loop throttling
        if last_tick.elapsed() >= tick_rate {
            last_tick = std::time::Instant::now();
        }
    }

    // Terminal cleanup
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}

/// Main UI rendering function
fn ui(f: &mut Frame, state: &ShadowUiState) {
    // Root layout (fixed f.area() → f.size())
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(0),
        ])
        .split(f.size());

    // Status bar
    let status_text = format!(
        "Cellrix | Agent: {} | Tab: Switch | ↑↓: Scroll",
        if state.agent_connected { "ONLINE" } else { "WAITING" }
    );
    f.render_widget(
        Paragraph::new(status_text).style(Nord::status_bar()),
        chunks[0],
    );

    // Content split
    let content_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[1]);

    // State Tree Panel
    let tree_block = Block::default()
        .borders(Borders::ALL)
        .title(" 🧠 Cognitive State Tree ")
        .border_style(
            if state.active_panel == Panel::StateTree {
                Nord::active_border()
            } else {
                Nord::inactive_border()
            },
        );
    let tree_area = tree_block.inner(content_chunks[0]);
    f.render_widget(tree_block, content_chunks[0]);

    let tree_content = if let Some(snapshot) = &state.last_snapshot {
        if let Some(nodes) = snapshot["semantic_tree"].as_array() {
            nodes
                .iter()
                .map(|n| {
                    format!(
                        "• {}: {}",
                        n["label"].as_str().unwrap_or(""),
                        n["content"].as_str().unwrap_or("")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            "No state data available".to_string()
        }
    } else {
        "Waiting for agent data...".to_string()
    };

    f.render_widget(
        Paragraph::new(tree_content)
            .scroll((state.state_tree_scroll as u16, 0))
            .style(Nord::text_primary()),
        tree_area,
    );

    // Metrics Panel
    let metrics_block = Block::default()
        .borders(Borders::ALL)
        .title(" 📊 Metrics ")
        .border_style(
            if state.active_panel == Panel::Metrics {
                Nord::active_border()
            } else {
                Nord::inactive_border()
            },
        );
    let metrics_area = metrics_block.inner(content_chunks[1]);
    f.render_widget(metrics_block, content_chunks[1]);

    let metrics_content = if let Some(snapshot) = &state.last_snapshot {
        format!("{:#?}", snapshot["metrics"])
    } else {
        "No metrics available".to_string()
    };

    f.render_widget(
        Paragraph::new(metrics_content).style(Nord::text_secondary()),
        metrics_area,
    );
}
