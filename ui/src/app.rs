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

use crate::{Renderer, UiError};
use state::AppState;
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

            terminal.draw(|f| {
                let size = f.size();
                
                let chunks = ratatui::layout::Layout::default()
                    .direction(ratatui::layout::Direction::Vertical)
                    .constraints([
                        ratatui::layout::Constraint::Min(0),
                        ratatui::layout::Constraint::Length(1),
                    ].as_ref())
                    .split(size);

                let main_area = chunks[0];
                let status_area = chunks[1];

                if let Some(snap) = &self.state.snapshot {
                    let zen_node_id = if self.state.is_zen_mode {
                        self.state.focus_manager.current_focus()
                    } else {
                        None
                    };

                    match self.renderer.render(
                        f, snap, None, (main_area.width, main_area.height), &self.state.focus_manager,
                        self.state.active_slot_nodes.clone(), zen_node_id.as_deref(),
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
            })?;
        }
        
        // 完美修复：在 loop 外侧补全 Ok(()) 彻底根治 E0308 类型不匹配！
        #[allow(unreachable_code)]
        Ok(())
    }
}
