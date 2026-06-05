// ui/src/app.rs
//! TUI application orchestrator for Cellrix.
//! 
//! Aligned with:
//! - CI-144 Protocol Family
//! - CIB19 (BIND-19) standard heartbeats and timeouts (no hardcoding)

use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::{Terminal, backend::CrosstermBackend};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_stream::StreamExt;
use std::io::Write;

use cellrix_protocol::{ActionRequest, ActionResponse, SemanticSnapshot, NodeType};
use cellrix_transport::{AgentEvent, CapTransport, TransportStream};

use crate::{FocusManager, Renderer, UiError};

/// Default BIND-19 (CIB19) heartbeat timeout: 40 seconds (2 * 19s heartbeat interval + 2s buffer)
pub const DEFAULT_HEARTBEAT_TIMEOUT_SECS: u64 = 40;

/// Pure Rust high-performance Base64 encoder for OSC 52 physical bypass copying over SSH
pub fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = match chunk.len() {
            3 => ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32),
            2 => ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8),
            1 => (chunk[0] as u32) << 16,
            _ => unreachable!(),
        };
        result.push(CHARSET[((b >> 18) & 63) as usize] as char);
        result.push(CHARSET[((b >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARSET[((b >> 6) & 63) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARSET[(b & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[derive(Debug, Clone)]
pub struct KeyMap {
    pub exit: (KeyCode, KeyModifiers),
    pub zen_toggle: (KeyCode, KeyModifiers),
    pub focus_next: (KeyCode, KeyModifiers),
    pub focus_prev: (KeyCode, KeyModifiers),
    pub tab_next: (KeyCode, KeyModifiers),
    pub tab_prev: (KeyCode, KeyModifiers),
}

impl Default for KeyMap {
    fn default() -> Self {
        Self {
            exit: (KeyCode::Char('c'), KeyModifiers::CONTROL),       // ^C
            zen_toggle: (KeyCode::Char('o'), KeyModifiers::CONTROL), // ^O
            focus_next: (KeyCode::Tab, KeyModifiers::NONE),          // Tab
            focus_prev: (KeyCode::Tab, KeyModifiers::SHIFT),         // Shift+Tab
            tab_next: (KeyCode::Right, KeyModifiers::ALT),           // Alt+Right
            tab_prev: (KeyCode::Left, KeyModifiers::ALT),            // Alt+Left
        }
    }
}

pub struct App {
    transport: Box<dyn CapTransport>,
    renderer: Renderer,
    event_rx: mpsc::Receiver<AgentEvent>,
    key_rx: mpsc::Receiver<Event>,
    snapshot: Option<SemanticSnapshot>,
    error: Option<String>,
    focus_manager: FocusManager,
    last_heartbeat: Instant,
    req_map: Arc<Mutex<HashMap<String, oneshot::Sender<ActionResponse>>>>,
    slot_nodes: HashMap<String, Vec<String>>,
    active_slot_nodes: HashMap<String, String>,
    is_zen_mode: bool,
    mouse_capture: bool,
    pub key_map: KeyMap,
    
    // Core Upgrade: Configurable heartbeat timeout field instead of hardcoded literals!
    pub heartbeat_timeout: Duration,
}

impl App {
    pub async fn new(mut transport: Box<dyn CapTransport>) -> Result<Self, UiError> {
        let (_manifest, raw_stream) = transport.connect().await?;

        let (event_tx, event_rx) = mpsc::channel(32);
        let (key_tx, key_rx) = mpsc::channel(32);
        let req_map = Arc::new(Mutex::new(HashMap::new()));

        let stream = raw_stream;
        let req_map_clone = Arc::clone(&req_map);
        tokio::spawn(async move {
            Self::background_dispatch(stream, event_tx, req_map_clone).await;
        });

        tokio::spawn(async move {
            Self::capture_key_events(key_tx).await;
        });

        Ok(Self {
            transport,
            renderer: Renderer::new(),
            event_rx,
            key_rx,
            snapshot: None,
            error: None,
            focus_manager: FocusManager::new(),
            last_heartbeat: Instant::now(),
            req_map,
            slot_nodes: HashMap::new(),
            active_slot_nodes: HashMap::new(),
            is_zen_mode: false,
            mouse_capture: true, // Permanent mouse tracking for seamless hit-testing and custom copy-paste
            key_map: KeyMap::default(),
            
            // Initialized with CIB19 default 40s timeout (fully open to overrides!)
            heartbeat_timeout: Duration::from_secs(DEFAULT_HEARTBEAT_TIMEOUT_SECS),
        })
    }

    pub async fn run(&mut self) -> Result<(), UiError> {
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

        let result = self.run_loop(&mut terminal).await;

        let mut stdout = std::io::stdout();
        let _ = crossterm::execute!(
            stdout,
            crossterm::event::DisableMouseCapture,
            crossterm::terminal::LeaveAlternateScreen
        );
        let _ = stdout.flush();
        crossterm::terminal::disable_raw_mode()?;
        result
    }

    async fn run_loop(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    ) -> Result<(), UiError> {
        loop {
            // Evaluates timeout against the configurable self.heartbeat_timeout
            if self.last_heartbeat.elapsed() > self.heartbeat_timeout {
                self.error = Some("Connection lost: No heartbeat received within the timeout budget".to_string());
            }

            tokio::select! {
                event = self.event_rx.recv() => {
                    match event {
                        Some(AgentEvent::Snapshot(snap)) => {
                            self.snapshot = Some(snap.clone());
                            self.error = None;

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

                            let current_focus = self.focus_manager.current_focus().map(|s| s.to_string());
                            let target = current_focus.as_deref();
                            self.focus_manager.rebuild(focusable_ids, target);
                        }
                        Some(AgentEvent::Heartbeat { .. }) => {
                            self.last_heartbeat = Instant::now();
                        }
                        Some(AgentEvent::StreamError(e)) => {
                            self.error = Some(format!("Stream error: {}", e));
                            break;
                        }
                        Some(_) => {}
                        None => {
                            self.error = Some("Agent event stream closed".to_string());
                            break;
                        }
                    }
                }

                key_event = self.key_rx.recv() => {
                    match key_event {
                        Some(Event::Key(key)) => {
                            if key.kind == KeyEventKind::Press {
                                self.handle_key_press(key.code, key.modifiers).await?;
                            }
                        }
                        Some(Event::Mouse(mouse)) => {
                            if self.mouse_capture {
                                match mouse.kind {
                                    crossterm::event::MouseEventKind::Down(crossterm::event::MouseButton::Left) => {
                                        self.renderer.clear_selection();

                                        if let Some(clicked_node_id) = self.renderer.hit_test(mouse.column, mouse.row) {
                                            self.focus_manager.active_focus_id = Some(clicked_node_id);
                                        }
                                        if mouse.modifiers.contains(crossterm::event::KeyModifiers::ALT) {
                                            let _ = self.renderer.handle_mouse_event(mouse);
                                        }
                                    }
                                    _ => {
                                        if self.renderer.is_selection_dragging() {
                                            if let Some(copied_text) = self.renderer.handle_mouse_event(mouse) {
                                                // Convert copied text to base64 and write using OSC 52 ANSI escape sequences
                                                let b64 = base64_encode(copied_text.as_bytes());
                                                let osc52_sequence = format!("\x1b]52;c;{}\x07", b64);
                                                let mut stdout = std::io::stdout();
                                                let _ = stdout.write_all(osc52_sequence.as_bytes());
                                                let _ = stdout.flush();

                                                // Fallback: Also set the local clipboard via arboard
                                                if let Ok(mut ctx) = arboard::Clipboard::new() {
                                                    let _ = ctx.set_text(copied_text);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            terminal.draw(|f| {
                if let Some(snap) = &self.snapshot {
                    let size = f.size();
                    
                    let zen_node_id = if self.is_zen_mode {
                        self.focus_manager.current_focus()
                    } else {
                        None
                    };

                    match self.renderer.render(
                        f, snap, None, (size.width, size.height), &self.focus_manager,
                        self.active_slot_nodes.clone(), zen_node_id.as_deref(),
                        self.mouse_capture, // Aligned 8-parameter render
                    ) {
                        Ok(layout_output) => {
                            if self.slot_nodes.is_empty() {
                                self.slot_nodes = layout_output.slot_nodes.clone();
                            }
                            for (slot_id, nodes) in &layout_output.slot_nodes {
                                if let Some(current_active) = self.active_slot_nodes.get(slot_id) {
                                    if nodes.contains(current_active) {
                                        continue;
                                    }
                                }
                                if let Some(default_active) = layout_output.active_node_per_slot.get(slot_id) {
                                    self.active_slot_nodes.insert(slot_id.clone(), default_active.clone());
                                }
                            }
                        },
                        Err(e) => self.error = Some(format!("Layout render error: {}", e)),
                    }
                } else if let Some(err) = &self.error {
                    let block = ratatui::widgets::Block::default()
                        .borders(ratatui::widgets::Borders::ALL)
                        .title("Error");
                    let para = ratatui::widgets::Paragraph::new(err.as_str()).block(block);
                    f.render_widget(para, f.size());
                }
            })?;
        }

        Ok(())
    }

    async fn handle_key_press(&mut self, code: KeyCode, modifiers: KeyModifiers) -> Result<(), UiError> {
        let key = (code, modifiers);

        if key == self.key_map.exit {
            return Err(UiError::NormalExit);
        }
        if key == self.key_map.zen_toggle {
            self.is_zen_mode = !self.is_zen_mode;
            return Ok(());
        }
        if key == self.key_map.focus_next {
            self.focus_manager.next();
            return Ok(());
        }
        if key == self.key_map.focus_prev {
            self.focus_manager.prev();
            return Ok(());
        }
        if key == self.key_map.tab_next {
            self.cycle_slot_active_node(1);
            return Ok(());
        }
        if key == self.key_map.tab_prev {
            self.cycle_slot_active_node(-1);
            return Ok(());
        }

        match code {
            KeyCode::Esc => {
                self.renderer.clear_selection();
            }
            KeyCode::Char('t') if modifiers == KeyModifiers::CONTROL => {
                self.mouse_capture = !self.mouse_capture;
                let mut stdout = std::io::stdout();
                if self.mouse_capture {
                    let _ = crossterm::execute!(stdout, crossterm::event::EnableMouseCapture);
                } else {
                    let _ = crossterm::execute!(stdout, crossterm::event::DisableMouseCapture);
                }
            }
            KeyCode::Enter => {
                if let Some(focused_id) = self.focus_manager.current_focus() {
                    if let Some(snap) = &self.snapshot {
                        if let Some(node) = snap.semantic_tree.iter().find(|n| n.id == focused_id) {
                            if node.node_type == NodeType::ActionButton {
                                let action_id = node.content
                                    .get("action_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();

                                let req = ActionRequest {
                                    action_id,
                                    parameters: serde_json::json!({}),
                                    view_hash: None,
                                };

                                let _ = self.send_action_request(req).await;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn cycle_slot_active_node(&mut self, delta: i32) {
        let focused_id = match self.focus_manager.current_focus() {
            Some(id) => id.to_string(),
            None => return,
        };

        let (slot_id, nodes) = match self.slot_nodes.iter().find(|(_, nodes)| nodes.contains(&focused_id)) {
            Some((sid, nodes)) => (sid.clone(), nodes.clone()),
            None => return,
        };

        if nodes.is_empty() {
            return;
        }

        let current_active = self.active_slot_nodes.get(&slot_id).cloned();
        let current_idx = match current_active {
            Some(ref id) => nodes.iter().position(|n| n == id).unwrap_or(0),
            None => 0,
        };

        let new_idx = if delta > 0 {
            (current_idx + 1) % nodes.len()
        } else {
            if current_idx == 0 {
                nodes.len() - 1
            } else {
                current_idx - 1
            }
        };

        let new_active = nodes[new_idx].clone();
        self.active_slot_nodes.insert(slot_id, new_active.clone());

        if let Some(snap) = &self.snapshot {
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

            if focusable_ids.contains(&new_active) {
                self.focus_manager.rebuild(focusable_ids, Some(&new_active));
            }
        }
    }

    async fn send_action_request(&mut self, req: ActionRequest) -> Result<ActionResponse, UiError> {
        let req_id = format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );

        let (tx, _rx) = oneshot::channel();

        self.req_map.lock().await.insert(req_id.clone(), tx);

        let response = self.transport.send_action(req).await?;
        Ok(response)
    }

    async fn background_dispatch(
        mut stream: TransportStream,
        event_tx: mpsc::Sender<AgentEvent>,
        _req_map: Arc<Mutex<HashMap<String, oneshot::Sender<ActionResponse>>>>,
    ) {
        while let Some(event) = stream.next().await {
            match event {
                Ok(agent_event) => {
                    let _ = event_tx.send(agent_event).await;
                }
                Err(_) => break,
            }
        }
        let _ = event_tx.send(AgentEvent::StreamError("Transport stream closed".into())).await;
    }

    async fn capture_key_events(key_tx: mpsc::Sender<Event>) {
        loop {
            if event::poll(Duration::from_millis(50)).unwrap_or(false) {
                if let Ok(evt) = event::read() {
                    let _ = key_tx.send(evt).await;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}
