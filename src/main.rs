use std::io;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph, BorderType},
};

mod app;
mod cap_client;
mod layout;
mod transport;
mod theme;
mod widgets;

use app::{Panel, ShadowUiState, AestheticLevel};
use cap_client::CapTransport;
use transport::tcp::TcpTransport;
use transport::stdio::StdioTransport;
use transport::uds::UdsTransport;
use theme::Nord;

fn detect_aesthetic_level() -> AestheticLevel {
    if let Ok(val) = std::env::var("CELLRIX_AESTHETIC") {
        match val.to_lowercase().as_str() {
            "discrete"   => return AestheticLevel::Discrete,
            "reactive"   => return AestheticLevel::Reactive,
            "continuous" => return AestheticLevel::Continuous,
            _ => {}
        }
    }
    let is_remote = std::env::var("SSH_TTY").is_ok() || std::env::var("SSH_CONNECTION").is_ok();
    let has_true_color = std::env::var("COLORTERM").map(|v| v == "truecolor" || v == "24bit").unwrap_or(false);
    let is_gpu_accelerated = std::env::var("TERM").map(|t| matches!(t.as_str(), "alacritty" | "kitty" | "wezterm")).unwrap_or(false);
    if is_remote || !has_true_color {
        AestheticLevel::Discrete
    } else if is_gpu_accelerated {
        AestheticLevel::Continuous
    } else {
        AestheticLevel::Reactive
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let args: Vec<String> = std::env::args().collect();
    let mut connect_target: Option<String> = None;
    let mut exec_target: Option<String> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--connect" => { i += 1; if i < args.len() { connect_target = Some(args[i].clone()); } }
            "--exec" => { i += 1; if i < args.len() { exec_target = Some(args[i].clone()); } }
            _ => {}
        }
        i += 1;
    }

    let aesthetic = detect_aesthetic_level();
    let mut ui_state = ShadowUiState::default();
    ui_state.aesthetic_level = aesthetic;
    let ui_state = Arc::new(RwLock::new(ui_state));

    // Initialize transport layer
    let transport: Option<Arc<tokio::sync::Mutex<Box<dyn CapTransport>>>> = if let Some(cmd) = exec_target {
        let stdio = StdioTransport::new(&cmd).await?;
        Some(Arc::new(tokio::sync::Mutex::new(Box::new(stdio))))
    } else if let Some(target) = connect_target {
        let t: Box<dyn CapTransport> = if target.starts_with("tcp://") {
            Box::new(TcpTransport::new(&target[6..]))
        } else if target.starts_with("uds://") {
            Box::new(UdsTransport::new(&target[6..]))
        } else {
            Box::new(TcpTransport::new(&target))
        };
        Some(Arc::new(tokio::sync::Mutex::new(t)))
    } else {
        None
    };

    // Start network listener task
    if let Some(ref transport) = transport {
        let state = ui_state.clone();
        let t = transport.clone();
        tokio::spawn(async move {
            loop {
                let snapshot = {
                    let mut transport = t.lock().await;
                    transport.get_snapshot().await
                };
                match snapshot {
                    Ok(snapshot) => {
                        let mut s = state.write().unwrap();
                        s.agent_connected = true;
                        s.last_snapshot = Some(snapshot);
                        s.is_dirty = true;
                    }
                    Err(_) => {
                        let mut s = state.write().unwrap();
                        s.agent_connected = false;
                        s.is_dirty = true;
                    }
                }
                tokio::time::sleep(Duration::from_millis(1000)).await;
            }
        });
    }

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let tick_rate = Duration::from_millis(33);
    let mut last_tick = Instant::now();

    loop {
        let should_draw = {
            let mut s = ui_state.write().unwrap();
            let dirty = s.is_dirty;
            s.is_dirty = false;
            dirty
        };
        if should_draw || last_tick.elapsed() >= tick_rate {
            terminal.draw(|f| ui(f, &ui_state.read().unwrap()))?;
            last_tick = Instant::now();
        }

        let timeout = tick_rate.checked_sub(last_tick.elapsed()).unwrap_or(Duration::from_secs(0));
        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                let mut state = ui_state.write().unwrap();
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => {
                        if state.input_buffer.is_empty() { break; }
                        else { state.input_buffer.clear(); }
                    }
                    KeyCode::Tab => {
                        state.active_panel = match state.active_panel {
                            Panel::StateTree => Panel::Chat,
                            Panel::Chat => Panel::Metrics,
                            Panel::Metrics => Panel::StateTree,
                        };
                        state.is_dirty = true;
                    }
                    KeyCode::Up => {
                        match state.active_panel {
                            Panel::Chat => state.chat_scroll = state.chat_scroll.saturating_sub(1),
                            Panel::StateTree => state.state_tree_scroll = state.state_tree_scroll.saturating_sub(1),
                            _ => {}
                        }
                        state.is_dirty = true;
                    }
                    KeyCode::Down => {
                        match state.active_panel {
                            Panel::Chat => state.chat_scroll += 1,
                            Panel::StateTree => state.state_tree_scroll += 1,
                            _ => {}
                        }
                        state.is_dirty = true;
                    }
                    KeyCode::Enter => {
                        let msg = state.input_buffer.trim().to_string();
                        if !msg.is_empty() {
                            state.chat_history.push(format!("You: {}", msg));
                            state.input_buffer.clear();

                            if let Some(ref transport) = transport {
                                let mut t = transport.lock().await;
                                let params = serde_json::json!({"message": msg});
                                match t.send_action("send_message", params).await {
                                    Ok(response) => {
                                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response) {
                                            let content = json["content"].as_str().unwrap_or("No response");
                                            state.chat_history.push(format!("Helix: {}", content));
                                        } else {
                                            state.chat_history.push(format!("Helix: {}", response));
                                        }
                                    }
                                    Err(_) => {
                                        state.chat_history.push("Helix: (offline - no response)".to_string());
                                    }
                                }
                            } else {
                                state.chat_history.push("Helix: (offline)".to_string());
                            }
                            state.is_dirty = true;
                        }
                    }
                    KeyCode::Char(c) => { state.input_buffer.push(c); state.is_dirty = true; }
                    KeyCode::Backspace => { state.input_buffer.pop(); state.is_dirty = true; }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}

fn ui(f: &mut Frame, state: &ShadowUiState) {
    let size = f.size();
    f.render_widget(Paragraph::new("").style(Style::default().bg(Nord::bg())), size);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(3),
        ])
        .split(size);

    // Status bar
    let status_text = format!(
        " Cellrix v0.1.0 | Agent: {} | Mode: {:?} | Tab: switch, ↑↓: scroll, Enter: send, q: quit",
        if state.agent_connected { "Online" } else { "Offline" },
        state.aesthetic_level
    );
    f.render_widget(Paragraph::new(status_text).style(Nord::status_bar()), chunks[0]);

    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(chunks[1]);

    // Left panel - STATE TREE
    let snapshot = &state.last_snapshot;
    let tree_text = snapshot.as_ref().and_then(|s| s.get("semantic_tree")).and_then(|t| t.as_array())
        .map(|arr| arr.iter().map(|node| {
            let label = node["label"].as_str().unwrap_or("");
            let content = node["content"].as_str().unwrap_or("");
            format!("├─ {}: {}", label, content)
        }).collect::<Vec<_>>().join("\n"))
        .unwrap_or_else(|| "No data".to_string());

    let left_focused = state.active_panel == Panel::StateTree;
    let left_border = if left_focused { Nord::active_border() } else { Nord::inactive_border() };
    f.render_widget(
        Block::default().borders(Borders::ALL).border_type(BorderType::Rounded).border_style(left_border).title(" ⏳ STATE TREE "),
        main_chunks[0],
    );
    f.render_widget(
        Paragraph::new(tree_text).style(if left_focused { Nord::text_primary() } else { Nord::text_secondary() }).scroll((state.state_tree_scroll as u16, 0)),
        main_chunks[0].inner(&Margin::new(2, 1)),
    );

    // Right chat area (with bubble separation)
    let right_focused = state.active_panel == Panel::Chat;
    let right_border = if right_focused { Nord::active_border() } else { Nord::inactive_border() };
    let right_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(right_border)
        .title(" 💬 CHAT ")
        .style(Style::default().bg(Nord::chat_bg()));
    f.render_widget(right_block, main_chunks[1]);

    let chat_area = main_chunks[1].inner(&Margin::new(1, 1));
    let mut lines: Vec<Line<'_>> = Vec::new();

    for (i, msg) in state.chat_history.iter().enumerate() {
        // Add empty line between messages (skip for first message)
        if i > 0 {
            lines.push(Line::from(""));
        }

        if let Some(content) = msg.strip_prefix("You: ") {
            lines.push(Line::from(vec![
                Span::styled("▎ ", Nord::user_message()),
                Span::styled(content, Nord::text_primary()),
            ]));
        } else if let Some(content) = msg.strip_prefix("Helix: ") {
            lines.push(Line::from(vec![
                Span::styled("▎ ", Nord::helix_message()),
                Span::styled(content, Nord::text_primary()),
            ]));
        } else {
            lines.push(Line::from(Span::styled(msg.as_str(), Nord::text_secondary())));
        }
    }

    let paragraph = Paragraph::new(lines)
        .scroll((state.chat_scroll as u16, 0));
    f.render_widget(paragraph, chat_area);

    // Bottom input bar (with simulated cursor)
    let input_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Nord::inactive_border())
        .title(" INPUT (Enter to send) ");
    f.render_widget(input_block, chunks[2]);

    // Static cursor symbol for visual feedback
    let cursor = "▊";
    let input_text = format!("> {}{}", state.input_buffer, cursor);
    f.render_widget(
        Paragraph::new(input_text).style(Nord::text_primary()),
        chunks[2].inner(&Margin::new(1, 1)),
    );
}
