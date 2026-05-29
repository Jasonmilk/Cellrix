use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::{Terminal, backend::CrosstermBackend};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, Mutex};

use cellrix_protocol::{ActionRequest, ActionResponse, SemanticSnapshot, NodeType};
use cellrix_transport::{AgentEvent, CapTransport, TransportStream};
use cellrix_layout::LayoutOutput;

use crate::{FocusManager, Renderer, UiError};

/// Main application state for Cellrix UI
pub struct App {
    /// Transport handle for sending actions
    transport: Box<dyn CapTransport>,
    /// Renderer (layout engine + TUI rendering)
    renderer: Renderer,
    /// Receiver for agent pushed events (snapshot / heartbeat)
    event_rx: mpsc::Receiver<AgentEvent>,
    /// Receiver for keyboard input events
    key_rx: mpsc::Receiver<Event>,
    /// Current active semantic snapshot from agent
    snapshot: Option<SemanticSnapshot>,
    /// Global error message
    error: Option<String>,
    /// Focus manager for interactive UI nodes
    focus_manager: FocusManager,
    /// Last received heartbeat timestamp (for timeout detection)
    last_heartbeat: Instant,
    /// Request ID -> OneShot sender for request-response matching
    req_map: Arc<Mutex<HashMap<String, oneshot::Sender<ActionResponse>>>>,
    /// All node IDs per slot (from last layout output)
    slot_nodes: HashMap<String, Vec<String>>,
    /// Current active node per slot (for tab switching within a slot)
    active_slot_nodes: HashMap<String, String>,
}

impl App {
    /// Create new UI application, initialize transport and background dispatch task
    pub async fn new(mut transport: Box<dyn CapTransport>) -> Result<Self, UiError> {
        // Establish connection and get manifest + raw event stream
        let (_manifest, raw_stream) = transport.connect().await?;

        // Channel for agent pushed events (snapshot, heartbeat, error)
        let (event_tx, event_rx) = mpsc::channel(32);
        // Channel for keyboard events
        let (key_tx, key_rx) = mpsc::channel(32);
        // Request ID map for request-response matching
        let req_map = Arc::new(Mutex::new(HashMap::new()));

        // Spawn background frame dispatch task: parse CIB envelope and route frames
        let stream = raw_stream;
        let req_map_clone = Arc::clone(&req_map);
        tokio::spawn(async move {
            Self::background_dispatch(stream, event_tx, req_map_clone).await;
        });

        // Spawn keyboard event capture task (non-blocking)
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

    /// Main UI entry point: enable terminal mode and start event loop
    pub async fn run(&mut self) -> Result<(), UiError> {
        crossterm::terminal::enable_raw_mode()?;
        let mut stdout = std::io::stdout();
        crossterm::execute!(stdout, crossterm::event::EnableMouseCapture)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;
        terminal.clear()?;

        let result = self.run_loop(&mut terminal).await;

        // Restore terminal state on exit
        crossterm::execute!(std::io::stdout(), crossterm::event::DisableMouseCapture)?;
        crossterm::terminal::disable_raw_mode()?;
        result
    }

    /// Core event loop: use tokio::select to handle event stream and keyboard input concurrently
    async fn run_loop(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    ) -> Result<(), UiError> {
        const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(10);

        loop {
            // Check heartbeat timeout first
            if self.last_heartbeat.elapsed() > HEARTBEAT_TIMEOUT {
                self.error = Some("Connection lost: No heartbeat received for 10 seconds".to_string());
            }

            tokio::select! {
                // Receive pushed events from agent (snapshot / heartbeat / error)
                event = self.event_rx.recv() => {
                    match event {
                        Some(AgentEvent::Snapshot(snap)) => {
                            self.snapshot = Some(snap.clone());
                            self.error = None;
                            // Rebuild focus list for ActionButton nodes only
                            let focusable_ids: Vec<String> = snap
                                .semantic_tree
                                .iter()
                                .filter(|n| n.node_type == NodeType::ActionButton)
                                .map(|n| n.id.clone())
                                .collect();
                            self.focus_manager.rebuild_order(&focusable_ids);
                        }
                        Some(AgentEvent::Heartbeat) => {
                            // Reset heartbeat timeout timer
                            self.last_heartbeat = Instant::now();
                        }
                        Some(AgentEvent::StreamError(e)) => {
                            self.error = Some(format!("Stream error: {}", e));
                            break;
                        }
                        None => {
                            // Event stream closed
                            self.error = Some("Agent event stream closed".to_string());
                            break;
                        }
                    }
                }

                // Receive keyboard input events
                key_event = self.key_rx.recv() => {
                    if let Some(Event::Key(key)) = key_event {
                        if key.kind == KeyEventKind::Press {
                            self.handle_key_press(key.code, key.modifiers).await?;
                        }
                    }
                }
            }

            // Render UI on every loop iteration
            terminal.draw(|f| {
                if let Some(snap) = &self.snapshot {
                    let size = f.size();
                    match self.renderer.render(
                        f, snap, None, (size.width, size.height), &self.focus_manager,
                        self.active_slot_nodes.clone(),
                    ) {
                        Ok(layout_output) => {
                            // Update slot nodes and active nodes from layout engine
                            // Only set if not already overridden (to preserve user tab choices)
                            if self.slot_nodes.is_empty() {
                                self.slot_nodes = layout_output.slot_nodes.clone();
                            }
                            // For active nodes, respect existing overrides if they remain valid
                            for (slot_id, nodes) in &layout_output.slot_nodes {
                                if let Some(current_active) = self.active_slot_nodes.get(slot_id) {
                                    if nodes.contains(current_active) {
                                        continue; // keep user override
                                    }
                                }
                                // Fall back to engine default
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

    /// Handle keyboard key press logic
    async fn handle_key_press(&mut self, code: KeyCode, modifiers: KeyModifiers) -> Result<(), UiError> {
        match code {
            // Exit app with Ctrl + C
            KeyCode::Char('c') if modifiers == KeyModifiers::CONTROL => {
                return Err(UiError::NormalExit);
            }

            // Switch focus to previous node with Shift + Tab
            KeyCode::Tab if modifiers == KeyModifiers::SHIFT => {
                self.focus_manager.focus_prev();
            }

            // Switch focus to next node with Tab
            KeyCode::Tab if modifiers.is_empty() => {
                self.focus_manager.focus_next();
            }

            // Cycle active node in the current slot (Ctrl+Tab / Ctrl+Shift+Tab)
            KeyCode::Tab if modifiers == KeyModifiers::CONTROL => {
                self.cycle_slot_active_node(1);
            }
            KeyCode::Tab if modifiers == KeyModifiers::CONTROL | KeyModifiers::SHIFT => {
                self.cycle_slot_active_node(-1);
            }

            // Trigger selected ActionButton with Enter
            KeyCode::Enter => {
                if let Some(focused_id) = self.focus_manager.current_focus() {
                    if let Some(snap) = &self.snapshot {
                        if let Some(node) = snap.semantic_tree.iter().find(|n| n.id == focused_id) {
                            if node.node_type == NodeType::ActionButton {
                                // Extract action_id from node content
                                let action_id = node.content
                                    .get("action_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();

                                // Build action request
                                let req = ActionRequest {
                                    action_id,
                                    parameters: serde_json::json!({}),
                                    view_hash: None,
                                };

                                // Send request and wait for response
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

    /// Cycle the active node in the slot that currently has the focused node.
    fn cycle_slot_active_node(&mut self, delta: i32) {
        let focused_id = match self.focus_manager.current_focus() {
            Some(id) => id.to_string(),
            None => return,
        };

        // Find which slot contains the focused node
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

        // If the new active node is focusable (ActionButton), move focus to it
        let focusable_ids: Vec<String> = self.focus_manager.focusable_ids().to_vec(); // assuming a getter
        if focusable_ids.contains(&new_active) {
            // Move focus to that node (simplified: rebuild with new focus)
            self.focus_manager.rebuild_order(&focusable_ids);
            while self.focus_manager.current_focus() != Some(&new_active) {
                self.focus_manager.focus_next();
            }
        }
    }

    /// Send action request and match response via OneShot channel
    async fn send_action_request(&mut self, req: ActionRequest) -> Result<ActionResponse, UiError> {
        use rand::Rng;
        use std::time::SystemTime;

        // Generate unique request ID for request-response matching
        let mut rng = rand::thread_rng();
        let req_id = format!(
            "{}-{}",
            SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)?.as_millis(),
            rng.gen::<u16>()
        );

        // Create one-shot channel for single response
        let (tx, rx) = oneshot::channel();

        // Register sender to request map
        self.req_map.lock().await.insert(req_id.clone(), tx);

        // Send request to transport layer (carries CIB envelope id)
        if let Err(e) = self.transport.send_action_with_id(req, &req_id).await {
            // Clean up map on send failure
            self.req_map.lock().await.remove(&req_id);
            return Err(UiError::TransportError(e));
        }

        // Wait for response from background dispatch task
        match rx.await {
            Ok(resp) => Ok(resp),
            Err(_) => {
                self.req_map.lock().await.remove(&req_id);
                Err(UiError::RequestTimeout)
            }
        }
    }

    /// Background task: parse raw CIB frames, route events and responses
    async fn background_dispatch(
        mut stream: TransportStream,
        event_tx: mpsc::Sender<AgentEvent>,
        req_map: Arc<Mutex<HashMap<String, oneshot::Sender<ActionResponse>>>>,
    ) {
        while let Ok(Some(envelope)) = stream.next_frame().await {
            match envelope.r#type.as_str() {
                // Route event frames to UI event channel
                "event" => {
                    let event = match envelope.body.event.as_str() {
                        "snapshot/update" => AgentEvent::Snapshot(envelope.body.data),
                        "heartbeat" => AgentEvent::Heartbeat,
                        _ => continue,
                    };
                    let _ = event_tx.send(event).await;
                }

                // Route response frames: match by request ID and wake up waiting sender
                "response" => {
                    let req_id = envelope.id;
                    let mut map = req_map.lock().await;
                    if let Some(tx) = map.remove(&req_id) {
                        let _ = tx.send(envelope.body.data);
                    }
                }

                _ => continue,
            }
        }

        // Stream closed, send stream closed event
        let _ = event_tx.send(AgentEvent::StreamError("Transport stream closed".into())).await;
    }

    /// Background task: capture keyboard events continuously
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
