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
use serde_json::json;

mod app;
mod cap_client;
mod layout;
mod transport;
mod theme;
mod widgets;

use app::{AestheticLevel, Panel, ShadowUiState};
use cap_client::CapTransport;
use transport::tcp::TcpTransport;
use transport::stdio::StdioTransport;
use transport::uds::UdsTransport;
use theme::Nord;

fn detect_aesthetic_level() -> AestheticLevel {
    if let Ok(val) = std::env::var("CELLRIX_AESTHETIC") {
        match val.to_lowercase().as_str() {
            "discrete" => return AestheticLevel::Discrete,
            "reactive" => return AestheticLevel::Reactive,
            "continuous" => return AestheticLevel::Continuous,
            _ => {}
        }
    }

    let is_remote = std::env::var("SSH_TTY").is_ok() || std::env::var("SSH_CONNECTION").is_ok();
    let has_true_color = std::env::var("COLORTERM")
        .map(|v| v == "truecolor" || v == "24bit")
        .unwrap_or(false);
    let is_gpu_accelerated = std::env::var("TERM")
        .map(|term| matches!(term.as_str(), "alacritty" | "kitty" | "wezterm"))
        .unwrap_or(false);

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
            "--connect" => {
                i += 1;
                if i < args.len() { connect_target = Some(args[i].clone()); }
            }
            "--exec" => {
                i += 1;
                if i < args.len() { exec_target = Some(args[i].clone()); }
            }
            _ => {}
        }
        i += 1;
    }

    let aesthetic = detect_aesthetic_level();
    let mut ui_state = ShadowUiState::default();
    ui_state.aesthetic_level = aesthetic;
    let ui_state = Arc::new(RwLock::new(ui_state));

    let transport: Option<Arc<tokio::sync::Mutex<Box<dyn CapTransport>>>> = if let Some(cmd) = exec_target {
        let stdio = StdioTransport::new(&cmd).await?;
        Some(Arc::new(tokio::sync::Mutex::new(Box::new(stdio))))
    } else if let Some(target) = connect_target {
        if target.starts_with("tcp://") {
            let tcp = TcpTransport::new(&target[6..]);
            Some(Arc::new(tokio::sync::Mutex::new(Box::new(tcp))))
        } else if target.starts_with("uds://") {
            let uds = UdsTransport::new(&target[6..]);
            Some(Arc::new(tokio::sync::Mutex::new(Box::new(uds))))
        } else {
            let tcp = TcpTransport::new(&target);
            Some(Arc::new(tokio::sync::Mutex::new(Box::new(tcp))))
        }
    } else {
        None
    };

    if let Some(transport) = transport.clone() {
        let state_clone = ui_state.clone();
        tokio::spawn(async move {
            loop {
                let snapshot = {
                    let mut t = transport.lock().await;
                    t.get_snapshot().await
                };
                match snapshot {
                    Ok(snapshot) => {
                        let mut state = state_clone.write().unwrap();
                        state.agent_connected = true;
                        state.last_snapshot = Some(snapshot);
                        state.is_dirty = true;
                    }
                    Err(_) => {
                        let mut state = state_clone.write().unwrap();
                        state.agent_connected = false;
                        state.is_dirty = true;
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
            let mut state = ui_state.write().unwrap();
            let dirty = state.is_dirty;
            state.is_dirty = false;
            dirty
        };

        if should_draw || last_tick.elapsed() >= tick_rate {
            terminal.draw(|f| ui(f, &ui_state.read().unwrap()))?;
            last_tick = Instant::now();
        }

        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or(Duration::from_secs(0));

        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                let mut state = ui_state.write().unwrap();
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => {
                        if state.input_buffer.is_empty() {
                            break;
                        } else {
                            state.input_buffer.clear();
                        }
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
                    // 架构师修复1：修复消息发送，使用 send_message 并解析响应
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
                                state.chat_history.push("Helix: (offline - no agent connected)".to_string());
                            }
                            state.is_dirty = true;
                        }
                    }
                    KeyCode::Char(c) => {
                        state.input_buffer.push(c);
                        state.is_dirty = true;
                    }
                    KeyCode::Backspace => {
                        state.input_buffer.pop();
                        state.is_dirty = true;
                    }
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

    // 架构师修复2：修改输入框高度为 3，解决截断问题
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(3),
        ])
        .split(size);

    let status_text = format!(
        " Cellrix v0.1.0 | Agent: {} | Mode: {:?} | Tab: switch, ↑↓: scroll, Enter: send, q: quit",
        if state.agent_connected { "Online" } else { "Offline" },
        state.aesthetic_level
    );
    f.render_widget(
        Paragraph::new(status_text).style(Nord::status_bar()),
        chunks[0],
    );

    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(chunks[1]);

    let snapshot = &state.last_snapshot;
    let tree_text = snapshot
        .as_ref()
        .and_then(|s| s.get("semantic_tree"))
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .map(|node| {
                    let label = node["label"].as_str().unwrap_or("");
                    let content = node["content"].as_str().unwrap_or("");
                    format!("├─ {}: {}", label, content)
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| "No data".to_string());

    let left_focused = state.active_panel == Panel::StateTree;
    let left_border = if left_focused { Nord::active_border() } else { Nord::inactive_border() };
    f.render_widget(
        Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(left_border)
            .title(" ⏳ STATE TREE "),
        main_chunks[0],
    );
    f.render_widget(
        Paragraph::new(tree_text)
            .style(if left_focused { Nord::text_primary() } else { Nord::text_secondary() })
            .scroll((state.state_tree_scroll as u16, 0)),
        main_chunks[0].inner(&Margin::new(2, 1)),
    );

    let right_focused = state.active_panel == Panel::Chat || state.active_panel == Panel::Metrics;
    let right_border = if right_focused { Nord::active_border() } else { Nord::inactive_border() };
    f.render_widget(
        Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(right_border)
            .title(" 💬 CHAT "),
        main_chunks[1],
    );
    let chat_text = state.chat_history.join("\n");
    let display_text = if chat_text.is_empty() {
        "Welcome to Cellrix\n\nType your message and press Enter to send.".to_string()
    } else {
        chat_text
    };
    f.render_widget(
        Paragraph::new(display_text)
            .style(Nord::text_primary())
            .scroll((state.chat_scroll as u16, 0)),
        main_chunks[1].inner(&Margin::new(2, 1)),
    );

    let input_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Nord::inactive_border())
        .title(" INPUT (Enter to send, Esc to clear, q to quit) ")
        .title_style(Nord::text_secondary());
    let input_area = input_block.inner(chunks[2]);
    f.render_widget(input_block, chunks[2]);
    f.render_widget(
        Paragraph::new(format!("> {}", state.input_buffer))
            .style(Nord::text_primary()),
        input_area,
    );
}
