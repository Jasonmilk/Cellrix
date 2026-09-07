// ui/src/app.rs
//! TUI application orchestrator for Cellrix.
//! 
//! Aligned with:
//! - CI-144 Protocol Family
//! - CIB19 (BIND-19) standard heartbeats and timeouts (no hardcoding)

pub mod state;
pub mod terminal;
pub mod handler;
pub mod dispatcher;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex};
use ratatui::Terminal; // 完美修复：精确补上丢失的 Terminal 命名空间！

use cellrix_protocol::{AgentEvent, NodeType};
use cellrix_transport::CapTransport;
use cellrix_protocol::anaphase::AgentSnapshot;
use cellrix_transport::anaphase_client::AnaphaseClient;

use crate::{Renderer, UiError};
use state::{ActiveView, AppState};
use terminal::TerminalGuard;
use handler::{InputHandler, KeyMap};
use dispatcher::EventDispatcher;

pub const DEFAULT_HEARTBEAT_TIMEOUT_SECS: u64 = 40;

pub struct App {
    transport: Box<dyn CapTransport>,
    renderer: Renderer,
    event_rx: mpsc::Receiver<AgentEvent>,
    key_rx: mpsc::Receiver<crossterm::event::Event>,
    state: AppState,
    req_map: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<cellrix_protocol::ActionResponse>>>>,
    pub key_map: KeyMap,
    pub heartbeat_timeout: Duration,
    /// Candidate G: cockpit projection channel (poller -> UI).
    cockpit_rx: Option<mpsc::Receiver<AgentSnapshot>>,
    /// Engram: audit-query projection channel (poller -> UI).
    engram_rx: Option<mpsc::Receiver<cellrix_protocol::engram::EngramQuery>>,
}

impl App {
    pub async fn new(mut transport: Box<dyn CapTransport>) -> Result<Self, UiError> {
        let (manifest, raw_stream) = transport.connect().await?;

        let (event_tx, event_rx) = mpsc::channel(32);
        let (key_tx, key_rx) = mpsc::channel(32);
        let req_map = Arc::new(Mutex::new(HashMap::new()));

        let stream = raw_stream;
        let req_map_clone = Arc::clone(&req_map);
        tokio::spawn(async move {
            EventDispatcher::background_dispatch(stream, event_tx, req_map_clone).await;
        });

        tokio::spawn(async move {
            EventDispatcher::capture_key_events(key_tx).await;
        });

        Ok(Self {
            cockpit_rx: None,
            engram_rx: None,
            transport,
            renderer: Renderer::new(),
            event_rx,
            key_rx,
            state: AppState::new(manifest.agent_name.clone()),
            req_map,
            key_map: KeyMap::default(),
            heartbeat_timeout: Duration::from_secs(DEFAULT_HEARTBEAT_TIMEOUT_SECS),
        })
    }

    /// Candidate G: attach the cockpit poller. A background task refreshes
    /// the snapshot projection on a fixed interval (one HTTP fetch per tick);
    /// the UI drains the latest value before each frame.
    pub fn attach_cockpit(&mut self, client: Arc<dyn AnaphaseClient>, poll_interval: Duration) {
        let (tx, rx) = mpsc::channel(8);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(poll_interval);
            loop {
                tick.tick().await;
                match client.get_snapshot().await {
                    Ok(snap) => {
                        if tx.send(snap).await.is_err() {
                            break; // UI gone
                        }
                    }
                    Err(_) => { /* transient — keep polling */ }
                }
            }
        });
        self.cockpit_rx = Some(rx);
    }

    /// Engram: attach the audit poller. A background task refetches the
    /// latest `limit` chain entries on a fixed interval (one `/v1/audit`
    /// fetch per tick, always newest-first view); the UI drains the latest
    /// value before each frame. The trace filter is applied locally by the
    /// widget — the gateway is never spammed with filter churn.
    pub fn attach_engram(
        &mut self,
        client: Arc<dyn cellrix_transport::tuck_audit_client::TuckAuditFetcher>,
        poll_interval: Duration,
        limit: usize,
    ) {
        let (tx, rx) = mpsc::channel(8);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(poll_interval);
            loop {
                tick.tick().await;
                let q = cellrix_transport::tuck_audit_client::AuditQuery {
                    limit: Some(limit),
                    ..Default::default()
                };
                match client.fetch(&q).await {
                    Ok(query) => {
                        if tx.send(query).await.is_err() {
                            break; // UI gone
                        }
                    }
                    Err(_) => { /* transient — keep polling */ }
                }
            }
        });
        self.engram_rx = Some(rx);
    }

    pub async fn run(&mut self) -> Result<(), UiError> {
        let mut guard = TerminalGuard::create()?;
        let result = self.run_loop(&mut guard.terminal).await;
        result
    }

    async fn run_loop(
        &mut self,
        terminal: &mut Terminal<ratatui::backend::CrosstermBackend<std::io::Stdout>>,
    ) -> Result<(), UiError> {
        loop {
            if self.state.last_heartbeat.elapsed() > self.heartbeat_timeout {
                self.state.error = Some("Connection lost: No heartbeat received within the timeout budget".to_string());
            }

            tokio::select! {
                event = self.event_rx.recv() => {
                    match event {
                        Some(AgentEvent::Manifest(manifest)) => {
                            let agent_name = manifest.agent_name.clone();
                            if !self.state.active_agents.contains(&agent_name) {
                                self.state.active_agents.push(agent_name);
                            }
                        }
                        Some(AgentEvent::Snapshot(snap)) => {
                            self.state.snapshot = Some(snap.clone());
                            self.state.error = None;

                            let focusable_ids: Vec<String> = snap
                                .semantic_tree
                                .iter()
                                .filter(|n| {
                                    matches!(
                                        n.node_type,
                                        NodeType::StateTree
                                            | NodeType::TextPanel
                                            | NodeType::ActionButton
                                            | NodeType::CodeDiff
                                            | NodeType::Unknown
                                    )
                                })
                                .map(|n| n.id.clone())
                                .collect();

                            let current_focus = self.state.focus_manager.current_focus().map(|s| s.to_string());
                            let target = current_focus.as_deref();
                            self.state.focus_manager.rebuild(focusable_ids, target);

                            // One-shot chat auto-open: on the first snapshot,
                            // focus the agent-declared needs_input action
                            // button (send_message) and open its input panel,
                            // so the driver can type immediately. The action
                            // id and label come from the node itself — the
                            // UI derives, never hardcodes.
                            if self.state.pending_chat {
                                self.state.pending_chat = false;
                                if let Some(node) = snap.semantic_tree.iter().find(|n| {
                                    n.node_type == NodeType::ActionButton
                                        && n.content.get("needs_input").and_then(|v| v.as_bool()).unwrap_or(false)
                                }) {
                                    let action_id = node
                                        .content
                                        .get("action_id")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    if !action_id.is_empty() {
                                        self.state.focus_manager.active_focus_id = Some(node.id.clone());
                                        self.state.input_action = Some(action_id);
                                        self.state.chat_focused = true;
                                    }
                                }
                            }
                        }
                        Some(AgentEvent::Heartbeat { .. }) => {
                            self.state.last_heartbeat = Instant::now();
                        }
                        Some(AgentEvent::StreamError(e)) => {
                            if e == "Transport stream closed" {
                                self.state.error = Some(format!("Stream error: {}", e));
                                break;
                            } else {
                                if let Some(start) = e.find('\'') {
                                    if let Some(end) = e[start+1..].find('\'') {
                                        let name = &e[start+1..start+1+end];
                                        self.state.active_agents.retain(|a| a != name);
                                        if self.state.current_agent.as_deref() == Some(name) {
                                            self.state.current_agent = self.state.active_agents.first().cloned();
                                            self.state.snapshot = None;
                                        }
                                    }
                                }
                            }
                        }
                        None => {
                            self.state.error = Some("Agent event stream closed".to_string());
                            break;
                        }
                    }
                }

                key_event = self.key_rx.recv() => {
                    match key_event {
                        Some(crossterm::event::Event::Key(key)) => {
                            if key.kind == crossterm::event::KeyEventKind::Press {
                                if let Some(err) = InputHandler::handle_key(
                                    &mut self.state,
                                    &mut self.transport,
                                    &self.req_map,
                                    &self.key_map,
                                    key.code,
                                    key.modifiers
                                ).await? {
                                    return Err(err);
                                }
                            }
                        }
                        Some(crossterm::event::Event::Mouse(mouse)) => {
                            if self.state.mouse_capture {
                                InputHandler::handle_mouse(&mut self.state, &mut self.renderer, mouse).await;
                            }
                        }
                        _ => {}
                    }
                }
            }

            // Candidate G: drain the latest cockpit projection before drawing.
            if let Some(rx) = &mut self.cockpit_rx {
                while let Ok(snap) = rx.try_recv() {
                    self.state.set_cockpit(snap);
                }
            }

            // Engram: drain the latest audit projection before drawing.
            if let Some(rx) = &mut self.engram_rx {
                while let Ok(query) = rx.try_recv() {
                    self.state.set_engram(query);
                }
            }

            terminal.draw(|f| {
                let size = f.size();
                
                // Fixed 3-row chat box (title / input line / status line):
                // always visible, so the driver can see where to type and
                // whether the last send succeeded.
                let chunks = ratatui::layout::Layout::default()
                    .direction(ratatui::layout::Direction::Vertical)
                    .constraints([
                        ratatui::layout::Constraint::Min(0),
                        ratatui::layout::Constraint::Length(9),
                        ratatui::layout::Constraint::Length(1),
                    ].as_ref())
                    .split(size);

                let main_area = chunks[0];
                let input_area = chunks[1];
                let status_area = chunks[2];

                // Engram view: the audit imprint panel owns the whole main
                // area (its own grid by proportion); the snapshot-driven
                // renderer is bypassed entirely.
                if self.state.active_view == ActiveView::Engram {
                    // The audit imprint panel owns the whole main area (its
                    // own grid by proportion); the snapshot-driven renderer
                    // is bypassed. Status bar + chat box still render below.
                    crate::widgets::engram::render_engram(&self.state.engram, main_area, f.buffer_mut());
                } else if let Some(snap) = &self.state.snapshot {
                    let zen_node_id = if self.state.is_zen_mode {
                        self.state.focus_manager.current_focus()
                    } else {
                        None
                    };

                    match self.renderer.render(
                        f, snap, None, (main_area.width, main_area.height), &self.state.focus_manager,
                        self.state.active_slot_nodes.clone(), zen_node_id.as_deref(),
                        self.state.cockpit.as_ref(),
                        self.state.mouse_capture,
                    ) {
                        Ok(layout_output) => {
                            if self.state.slot_nodes.is_empty() {
                                self.state.slot_nodes = layout_output.slot_nodes.clone();
                            }
                            for (slot_id, nodes) in &layout_output.slot_nodes {
                                if let Some(current_active) = self.state.active_slot_nodes.get(slot_id) {
                                    if nodes.contains(current_active) {
                                        continue;
                                    }
                                }
                                if let Some(default_active) = layout_output.active_node_per_slot.get(slot_id) {
                                    self.state.active_slot_nodes.insert(slot_id.clone(), default_active.clone());
                                }
                            }
                        },
                        Err(e) => self.state.error = Some(format!("Layout render error: {}", e)),
                    }
                } else if let Some(err) = &self.state.error {
                    let block = ratatui::widgets::Block::default()
                        .borders(ratatui::widgets::Borders::ALL)
                        .title("Error");
                    let para = ratatui::widgets::Paragraph::new(err.as_str()).block(block);
                    f.render_widget(para, main_area);
                }

                // Render Somatic Monasticism Status Bar (Monastic Indigo + Slate Gray)
                let mut status_spans = vec![ratatui::text::Span::raw(" ACTIVE REGIME SENSORS: ")];
                for agent in &self.state.active_agents {
                    let is_current = Some(agent) == self.state.current_agent.as_ref();
                    let style = if is_current {
                        ratatui::style::Style::default()
                            .fg(ratatui::style::Color::Black)
                            .bg(ratatui::style::Color::Rgb(91, 95, 199))
                    } else {
                        ratatui::style::Style::default()
                            .fg(ratatui::style::Color::Rgb(113, 113, 122))
                    };
                    status_spans.push(ratatui::text::Span::styled(format!(" [{}] ", agent), style));
                }
                let status_para = ratatui::widgets::Paragraph::new(ratatui::text::Line::from(status_spans));
                f.render_widget(status_para, status_area);

                // Chat panel: the same conversation semantics as the WebUI
                // (who + timestamp + text), plus the input line and the
                // last-send status. The title derives from the focused
                // needs_input action button label — the tree declares it.
                let focused_label = self.state.focus_manager.current_focus().and_then(|id| {
                    self.state.snapshot.as_ref().and_then(|snap| {
                        snap.semantic_tree
                            .iter()
                            .find(|n| n.id == id)
                            .map(|n| n.label.clone())
                    })
                });
                let title = if self.state.chat_focused {
                    format!(
                        " [ {} — Enter 发送 · Esc 退出 ] ",
                        focused_label.unwrap_or_else(|| "对话 Chat".to_string())
                    )
                } else {
                    " [ 对话 Chat — 输入消息 ] ".to_string()
                };
                let title_style = if self.state.chat_focused {
                    ratatui::style::Style::default().fg(ratatui::style::Color::Rgb(82, 196, 26))
                } else {
                    ratatui::style::Style::default().fg(ratatui::style::Color::Rgb(113, 113, 122))
                };
                let input_text = if self.state.chat_focused {
                    format!("> {}{}", self.state.input_buffer, "▌")
                } else {
                    "> （按 Enter 开始输入）".to_string()
                };
                let status_text = match &self.state.last_response {
                    Some(r) if r.starts_with("✗") => r.clone(),
                    Some(r) => format!("Helix: {r}"),
                    None => "（还没有对话，发第一句吧）".to_string(),
                };
                let status_style = match &self.state.last_response {
                    Some(r) if r.starts_with("✗") => {
                        ratatui::style::Style::default().fg(ratatui::style::Color::Rgb(224, 108, 117))
                    }
                    _ => ratatui::style::Style::default().fg(ratatui::style::Color::Rgb(139, 200, 234)),
                };
                let mut chat_lines: Vec<ratatui::text::Line> = Vec::new();
                // Conversation record (isomorphic with the WebUI message
                // flow): newest N entries, each who + HH:MM + text.
                let tail: Vec<_> = self.state.chat_history.iter().rev().take(5).collect();
                for entry in tail.iter().rev() {
                    let who = match entry.who {
                        super::app::state::ChatWho::Driver => "你",
                        super::app::state::ChatWho::Helix => "Helix",
                    };
                    let who_style = match entry.who {
                        super::app::state::ChatWho::Driver => {
                            ratatui::style::Style::default().fg(ratatui::style::Color::Rgb(139, 200, 234))
                        }
                        super::app::state::ChatWho::Helix => {
                            ratatui::style::Style::default().fg(ratatui::style::Color::Rgb(158, 172, 234))
                        }
                    };
                    chat_lines.push(ratatui::text::Line::from(vec![
                        ratatui::text::Span::styled(format!("{who} "), who_style),
                        ratatui::text::Span::styled(
                            entry.ts.clone(),
                            ratatui::style::Style::default()
                                .fg(ratatui::style::Color::Rgb(113, 113, 122)),
                        ),
                        ratatui::text::Span::raw("  "),
                        ratatui::text::Span::raw(entry.text.clone()),
                    ]));
                }
                chat_lines.push(ratatui::text::Line::from(ratatui::text::Span::raw(input_text)));
                chat_lines.push(ratatui::text::Line::from(ratatui::text::Span::styled(status_text, status_style)));
                let chat_box = ratatui::widgets::Block::default()
                    .borders(ratatui::widgets::Borders::ALL)
                    .border_style(ratatui::style::Style::default().fg(ratatui::style::Color::Rgb(91, 95, 199)));
                let chat_para = ratatui::widgets::Paragraph::new(chat_lines).block(chat_box);
                f.render_widget(chat_para, input_area);
            })?;
        }
        
        // 完美修复：在 loop 外侧补全 Ok(()) 彻底根治 E0308 类型不匹配！
        #[allow(unreachable_code)]
        Ok(())
    }
}
