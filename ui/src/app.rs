use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use ratatui::{Terminal, backend::CrosstermBackend};
use cellrix_protocol::{SemanticSnapshot, ActionRequest, NodeType};
use cellrix_transport::CapTransport;
use crate::{Renderer, UiError, FocusManager};

pub struct App {
    transport: Box<dyn CapTransport>,
    renderer: Renderer,
    snapshot: Option<SemanticSnapshot>,
    error: Option<String>,
    focus_manager: FocusManager,
}

impl App {
    pub async fn new(transport: Box<dyn CapTransport>) -> Result<Self, UiError> {
        let mut app = Self {
            transport,
            renderer: Renderer::new(),
            snapshot: None,
            error: None,
            focus_manager: FocusManager::new(),
        };
        app.refresh_snapshot().await?;
        Ok(app)
    }

    async fn refresh_snapshot(&mut self) -> Result<(), UiError> {
        match self.transport.fetch_snapshot().await {
            Ok(snap) => {
                self.snapshot = Some(snap.clone());
                self.error = None;
                // 构建可聚焦节点列表（只有 ActionButton）
                let focusable_ids: Vec<String> = snap
                    .semantic_tree
                    .iter()
                    .filter(|n| n.node_type == NodeType::ActionButton)
                    .map(|n| n.id.clone())
                    .collect();
                self.focus_manager.rebuild_order(&focusable_ids);
                Ok(())
            }
            Err(e) => {
                self.error = Some(format!("Transport error: {}", e));
                Err(e.into())
            }
        }
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
        loop {
            terminal.draw(|f| {
                if let Some(snap) = &self.snapshot {
                    let size = f.size();
                    if let Err(e) = self.renderer.render(
                        f, snap, None, (size.width, size.height), &self.focus_manager
                    ) {
                        self.error = Some(format!("Layout error: {}", e));
                    }
                } else if let Some(err) = &self.error {
                    let block = ratatui::widgets::Block::default()
                        .borders(ratatui::widgets::Borders::ALL)
                        .title("Error");
                    let para = ratatui::widgets::Paragraph::new(err.as_str()).block(block);
                    f.render_widget(para, f.size());
                }
            })?;

            if event::poll(std::time::Duration::from_millis(50))? {
                if let Event::Key(key) = event::read()? {
                    if key.kind == KeyEventKind::Press {
                        match key.code {
                            KeyCode::Char('c') if key.modifiers == event::KeyModifiers::CONTROL => {
                                break Ok(());
                            }
                            KeyCode::Char('r') => {
                                self.refresh_snapshot().await?;
                            }
                            KeyCode::Tab => {
                                if key.modifiers == event::KeyModifiers::SHIFT {
                                    self.focus_manager.focus_prev();
                                } else {
                                    self.focus_manager.focus_next();
                                }
                                // 焦点变化，重绘即可
                            }
                            KeyCode::Enter => {
                                if let Some(focused_id) = self.focus_manager.current_focus() {
                                    if let Some(snap) = &self.snapshot {
                                        if let Some(node) = snap.semantic_tree.iter().find(|n| n.id == focused_id) {
                                            if node.node_type == NodeType::ActionButton {
                                                let action_id = node.content.get("action_id")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("unknown");
                                                let req = ActionRequest {
                                                    action_id: action_id.to_string(),
                                                    parameters: serde_json::json!({}),
                                                    view_hash: None,
                                                };
                                                if let Ok(resp) = self.transport.send_action(req).await {
                                                    eprintln!("Action response: {:?}", resp);
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
            }
        }
    }
}
