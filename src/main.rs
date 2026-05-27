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

use app::{ShadowUiState, Panel};
use cap_client::{start_async_cap_listener, RealCapClient, NoopCapClient, CapClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let connect_target = args.iter().position(|a| a == "--connect").and_then(|i| args.get(i + 1));

    tracing_subscriber::fmt::init();

    let ui_state = Arc::new(RwLock::new(ShadowUiState::default()));

    let cap_client: Arc<dyn CapClient + Send + Sync> = if let Some(target) = connect_target {
        Arc::new(RealCapClient::new(target))
    } else {
        Arc::new(NoopCapClient)
    };

    let state_clone = ui_state.clone();
    let client_clone = cap_client.clone();
    tokio::spawn(async move {
        start_async_cap_listener(state_clone, client_clone).await;
    });

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let tick_rate = Duration::from_millis(33);
    let mut last_tick = Instant::now();

    loop {
        let should_draw = {
            if let Ok(mut state) = ui_state.write() {
                let dirty = state.is_dirty;
                state.is_dirty = false;
                dirty
            } else {
                false
            }
        };

        if should_draw || last_tick.elapsed() >= tick_rate {
            terminal.draw(|f| {
                ui(f, &ui_state.read().unwrap());
            })?;
            last_tick = Instant::now();
        }

        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or(Duration::from_secs(0));

        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => break,
                    KeyCode::Tab => {
                        if let Ok(mut state) = ui_state.write() {
                            state.active_panel = match state.active_panel {
                                Panel::StateTree => Panel::Metrics,
                                Panel::Metrics => Panel::StateTree,
                            };
                            state.is_dirty = true;
                        }
                    }
                    KeyCode::Up => {
                        if let Ok(mut state) = ui_state.write() {
                            match state.active_panel {
                                Panel::StateTree => state.state_tree_scroll = state.state_tree_scroll.saturating_sub(1),
                                Panel::Metrics => state.metrics_scroll = state.metrics_scroll.saturating_sub(1),
                            };
                            state.is_dirty = true;
                        }
                    }
                    KeyCode::Down => {
                        if let Ok(mut state) = ui_state.write() {
                            match state.active_panel {
                                Panel::StateTree => state.state_tree_scroll += 1,
                                Panel::Metrics => state.metrics_scroll += 1,
                            };
                            state.is_dirty = true;
                        }
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
    let bg = theme::Nord::background();
    f.render_widget(Paragraph::new("").style(Style::default().bg(bg)), f.size());

    let size = f.size();

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .split(size);

    let status_text = format!(
        " Cellrix v0.1.0 | Agent: {} | Tab:Switch | ↑↓:Scroll | q:Quit",
        if state.agent_connected { "Online" } else { "Waiting" }
    );
    f.render_widget(
        Paragraph::new(status_text).style(Style::default().fg(theme::Nord::text_primary())),
        chunks[0],
    );

    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(chunks[1]);

    let snapshot = &state.last_snapshot;

    let tree_nodes: Vec<(String, String)> = snapshot
        .as_ref()
        .and_then(|s| s.get("semantic_tree"))
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .map(|node| {
                    let label = node["label"].as_str().unwrap_or("").to_string();
                    let content = node["content"].as_str().unwrap_or("").to_string();
                    (label, content)
                })
                .collect()
        })
        .unwrap_or_default();

    let tree_rendered = render_swimlane(&tree_nodes);
    let left_focused = state.active_panel == Panel::StateTree;

    let left_border = if left_focused { theme::Nord::border_active() } else { theme::Nord::border_inactive() };
    let left_title = if left_focused {
        Style::default().fg(theme::Nord::text_primary()).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(theme::Nord::text_secondary())
    };

    let left_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(left_border))
        .title(" ⏳ STATE TREE ")
        .title_style(left_title);
    f.render_widget(left_block, main_chunks[0]);

    let inner_left = main_chunks[0].inner(&Margin::new(2, 1));
    let lines_left: Vec<&str> = tree_rendered.lines().collect();
    let scroll_left = state.state_tree_scroll as usize;
    let visible_left: Vec<&str> = lines_left.iter().skip(scroll_left).take(inner_left.height as usize).cloned().collect();
    
    f.render_widget(
        Paragraph::new(visible_left.join("\n"))
            .style(if left_focused { Style::default().fg(theme::Nord::text_primary()) } else { Style::default().fg(theme::Nord::text_secondary()) }),
        inner_left,
    );

    let metrics_text = snapshot
        .as_ref()
        .and_then(|s| s.get("metrics"))
        .and_then(|m| serde_json::to_string_pretty(m).ok())
        .unwrap_or_else(|| "No metrics data".to_string());

    let right_focused = state.active_panel == Panel::Metrics;
    let right_border = if right_focused { theme::Nord::border_active() } else { theme::Nord::border_inactive() };
    let right_title = if right_focused {
        Style::default().fg(theme::Nord::text_primary()).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(theme::Nord::text_secondary())
    };

    let right_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(right_border))
        .title(" 📊 METRICS ")
        .title_style(right_title);
    f.render_widget(right_block, main_chunks[1]);

    let inner_right = main_chunks[1].inner(&Margin::new(2, 1));
    let lines_right: Vec<&str> = metrics_text.lines().collect();
    let scroll_right = state.metrics_scroll as usize;
    let visible_right: Vec<&str> = lines_right.iter().skip(scroll_right).take(inner_right.height as usize).cloned().collect();
    
    f.render_widget(
        Paragraph::new(visible_right.join("\n"))
            .style(if right_focused { Style::default().fg(theme::Nord::text_primary()) } else { Style::default().fg(theme::Nord::text_secondary()) }),
        inner_right,
    );

    f.render_widget(
        Paragraph::new("[q] Quit  [Tab] Switch  [↑↓] Scroll")
            .style(Style::default().fg(theme::Nord::text_secondary())),
        chunks[2],
    );
}

fn render_swimlane(nodes: &[(String, String)]) -> String {
    if nodes.is_empty() {
        return "No state tree data".to_string();
    }
    let mut out = String::new();
    for (i, (label, content)) in nodes.iter().enumerate() {
        let branch = if i == nodes.len() - 1 { "└─" } else { "├─" };
        out.push_str(&format!("{} {}: {}\n", branch, label, content));
    }
    out
}
