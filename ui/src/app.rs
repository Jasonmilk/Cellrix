use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::{Terminal, backend::CrosstermBackend};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_stream::StreamExt;

use cellrix_protocol::{ActionRequest, ActionResponse, SemanticSnapshot, NodeType};
use cellrix_transport::{AgentEvent, CapTransport, TransportStream};

use crate::{FocusManager, Renderer, UiError};

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
        })
    }

    pub async fn run(&mut self) -> Result<(), UiError> {
        crossterm::terminal::enable_raw_mode()?;
        let mut stdout = std::io::stdout();
        crossterm::execute!(stdout, crossterm::event::EnableMouseCapture)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;
        terminal.clear()?;

        let result = self.run_loop(&mut terminal).await;

        crossterm::execute!(std::io::stdout(), crossterm::event::DisableMouseCapture)?;
        crossterm::terminal::disable_raw_mode()?;
        result
    }

    async fn run_loop(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    ) -> Result<(), UiError> {
        const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(10);

        loop {
            if self.last_heartbeat.elapsed() > HEARTBEAT_TIMEOUT {
                self.error = Some("Connection lost: No heartbeat received for 10 seconds".to_string());
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
                                .filter(|n| n.node_type == NodeType::ActionButton)
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
                    if let Some(Event::Key(key)) = key_event {
                        if key.kind == KeyEventKind::Press {
                            self.handle_key_press(key.code, key.modifiers).await?;
                        }
                    }
                }
            }

            terminal.draw(|f| {
                if let Some(snap) = &self.snapshot {
                    let size = f.size();
                    match self.renderer.render(
                        f, snap, None, (size.width, size.height), &self.focus_manager,
                        self.active_slot_nodes.clone(),
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
        match code {
            KeyCode::Char('c') if modifiers == KeyModifiers::CONTROL => {
                return Err(UiError::NormalExit);
            }
            KeyCode::Tab if modifiers == KeyModifiers::SHIFT => {
                self.cycle_slot_active_node(-1);
            }
            KeyCode::Tab if modifiers.is_empty() => {
                self.focus_manager.focus_next();
            }
            KeyCode::Tab if modifiers == KeyModifiers::CONTROL => {
                self.cycle_slot_active_node(1);
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
            let focusable_ids: Vec<String> = snap.semantic_tree.iter()
                .filter(|n| n.node_type == NodeType::ActionButton)
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

    /// 已替换为新实现：使用 StreamExt::next() 读取流
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
