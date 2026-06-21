use std::io::Write;
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::{oneshot, Mutex};
use crossterm::event::{KeyCode, KeyModifiers, MouseEvent};
use cellrix_protocol::{ActionRequest, ActionResponse, NodeType};
use cellrix_transport::CapTransport;

use crate::UiError;
use super::state::AppState;

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

#[derive(Debug, Clone, Copy)]
pub struct KeyMap {
    pub exit: (KeyCode, KeyModifiers),
    pub zen_toggle: (KeyCode, KeyModifiers),
    pub focus_next: (KeyCode, KeyModifiers),
    pub focus_prev: (KeyCode, KeyModifiers),
    pub tab_next: (KeyCode, KeyModifiers),
    pub tab_prev: (KeyCode, KeyModifiers),
    pub agent_next: (KeyCode, KeyModifiers),
    pub agent_prev: (KeyCode, KeyModifiers),
}

impl Default for KeyMap {
    fn default() -> Self {
        Self {
            exit: (KeyCode::Char('c'), KeyModifiers::CONTROL),
            zen_toggle: (KeyCode::Char('o'), KeyModifiers::CONTROL),
            focus_next: (KeyCode::Tab, KeyModifiers::NONE),
            focus_prev: (KeyCode::Tab, KeyModifiers::SHIFT),
            tab_next: (KeyCode::Right, KeyModifiers::ALT),
            tab_prev: (KeyCode::Left, KeyModifiers::ALT),
            agent_next: (KeyCode::Char('n'), KeyModifiers::ALT),
            agent_prev: (KeyCode::Char('p'), KeyModifiers::ALT),
        }
    }
}

pub struct InputHandler;

impl InputHandler {
    /// Routes and executes keystroke intents.
    pub async fn handle_key(
        state: &mut AppState,
        transport: &mut Box<dyn CapTransport>,
        req_map: &Arc<Mutex<HashMap<String, oneshot::Sender<ActionResponse>>>>,
        key_map: &KeyMap,
        code: KeyCode,
        modifiers: KeyModifiers,
    ) -> Result<Option<UiError>, UiError> {
        let key = (code, modifiers);

        if key == key_map.exit {
            return Ok(Some(UiError::NormalExit));
        }
        if key == key_map.zen_toggle {
            state.is_zen_mode = !state.is_zen_mode;
            return Ok(None);
        }
        if key == key_map.focus_next {
            state.focus_manager.next();
            return Ok(None);
        }
        if key == key_map.focus_prev {
            state.focus_manager.prev();
            return Ok(None);
        }
        if key == key_map.tab_next {
            Self::cycle_slot_active_node(state, 1);
            return Ok(None);
        }
        if key == key_map.tab_prev {
            Self::cycle_slot_active_node(state, -1);
            return Ok(None);
        }
        if key == key_map.agent_next {
            Self::cycle_active_agent(state, transport, req_map, 1).await;
            return Ok(None);
        }
        if key == key_map.agent_prev {
            Self::cycle_active_agent(state, transport, req_map, -1).await;
            return Ok(None);
        }

        match code {
            KeyCode::Esc => {
                // Esc clears text copy selection
            }
            KeyCode::Char('t') if modifiers == KeyModifiers::CONTROL => {
                state.mouse_capture = !state.mouse_capture;
                let mut stdout = std::io::stdout();
                if state.mouse_capture {
                    let _ = crossterm::execute!(stdout, crossterm::event::EnableMouseCapture);
                } else {
                    let _ = crossterm::execute!(stdout, crossterm::event::DisableMouseCapture);
                }
            }
            KeyCode::Enter => {
                if let Some(focused_id) = state.focus_manager.current_focus() {
                    if let Some(snap) = &state.snapshot {
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

                                let _ = Self::send_action_request(transport, req_map, req).await;
                            }
                        }
                    }
                }
            }
            _ => {}
        }

        Ok(None)
    }

    /// Handles mouse-clicking focus routing and ALT-click dragging copy-pastes over SSH (OSC 52).
    pub async fn handle_mouse(
        state: &mut AppState,
        renderer: &mut crate::Renderer,
        mouse: MouseEvent,
    ) {
        match mouse.kind {
            crossterm::event::MouseEventKind::Down(crossterm::event::MouseButton::Left) => {
                renderer.clear_selection();

                if let Some(clicked_node_id) = renderer.hit_test(mouse.column, mouse.row) {
                    state.focus_manager.active_focus_id = Some(clicked_node_id);
                }
                if mouse.modifiers.contains(crossterm::event::KeyModifiers::ALT) {
                    let _ = renderer.handle_mouse_event(mouse);
                }
            }
            _ => {
                if renderer.is_selection_dragging() {
                    if let Some(copied_text) = renderer.handle_mouse_event(mouse) {
                        let b64 = base64_encode(copied_text.as_bytes());
                        let osc52_sequence = format!("\x1b]52;c;{}\x07", b64);
                        let mut stdout = std::io::stdout();
                        let _ = stdout.write_all(osc52_sequence.as_bytes());
                        let _ = stdout.flush();

                        if let Ok(mut ctx) = arboard::Clipboard::new() {
                            let _ = ctx.set_text(copied_text);
                        }
                    }
                }
            }
        }
    }

    /// Cycles active agents, pushing sys_focus_swap downstream for symmetrical background throttling.
    async fn cycle_active_agent(
        state: &mut AppState,
        transport: &mut Box<dyn CapTransport>,
        req_map: &Arc<Mutex<HashMap<String, oneshot::Sender<ActionResponse>>>>,
        delta: i32,
    ) {
        if state.active_agents.len() <= 1 {
            return;
        }

        let current_active = match &state.current_agent {
            Some(ns) => ns.clone(),
            None => return,
        };

        let current_idx = state.active_agents.iter().position(|a| a == &current_active).unwrap_or(0);
        let new_idx = if delta > 0 {
            (current_idx + 1) % state.active_agents.len()
        } else {
            if current_idx == 0 {
                state.active_agents.len() - 1
            } else {
                current_idx - 1
            }
        };

        let target_agent = state.active_agents[new_idx].clone();
        state.current_agent = Some(target_agent.clone());

        let swap_req = ActionRequest {
            action_id: "sys_focus_swap".to_string(),
            parameters: serde_json::json!({ "namespace": target_agent }),
            view_hash: None,
        };
        let _ = Self::send_action_request(transport, req_map, swap_req).await;
    }

    fn cycle_slot_active_node(state: &mut AppState, delta: i32) {
        let focused_id = match state.focus_manager.current_focus() {
            Some(id) => id.to_string(),
            None => return,
        };

        let (slot_id, nodes) = match state.slot_nodes.iter().find(|(_, nodes)| nodes.contains(&focused_id)) {
            Some((sid, nodes)) => (sid.clone(), nodes.clone()),
            None => return,
        };

        if nodes.is_empty() {
            return;
        }

        let current_active = state.active_slot_nodes.get(&slot_id).cloned();
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
        state.active_slot_nodes.insert(slot_id, new_active.clone());

        if let Some(snap) = &state.snapshot {
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
                state.focus_manager.rebuild(focusable_ids, Some(&new_active));
            }
        }
    }

    async fn send_action_request(
        transport: &mut Box<dyn CapTransport>,
        req_map: &Arc<Mutex<HashMap<String, oneshot::Sender<ActionResponse>>>>,
        req: ActionRequest,
    ) -> Result<ActionResponse, UiError> {
        let req_id = format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );

        let (tx, _rx) = oneshot::channel();
        req_map.lock().await.insert(req_id, tx);

        let response = transport.send_action(req).await?;
        Ok(response)
    }
}
