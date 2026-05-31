// layout/src/focus_manager.rs
use cellrix_protocol::{SemanticSnapshot, NodeType};

pub struct FocusManager {
    pub nodes: Vec<String>,
    pub active_focus_id: Option<String>,
}

impl FocusManager {
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            active_focus_id: None,
        }
    }

    pub fn current_focus(&self) -> Option<String> {
        self.active_focus_id.clone()
    }

    /// 零泛型、纯混凝土类型入参，100% 兼容 WASM，零推导二义性
    pub fn rebuild(&mut self, node_ids: Vec<String>, default_focus: Option<&str>) {
        self.nodes = node_ids;
        let target = default_focus.map(|s| s.to_string());
        
        if let Some(ref curr) = self.active_focus_id {
            if !self.nodes.contains(curr) {
                self.active_focus_id = target.or_else(|| self.nodes.first().cloned());
            }
        } else {
            self.active_focus_id = target.or_else(|| self.nodes.first().cloned());
        }
    }

    pub fn is_focused(&self, node_id: &str) -> bool {
        self.active_focus_id.as_deref() == Some(node_id)
    }

    pub fn focus_next(&mut self) -> Option<String> {
        self.next()
    }

    pub fn extract_focusable_node_ids(&self, snapshot: &SemanticSnapshot) -> Vec<String> {
        snapshot.semantic_tree
            .iter()
            .filter(|node| node.node_type == NodeType::ActionButton)
            .map(|node| node.id.clone())
            .collect()
    }

    pub fn next(&mut self) -> Option<String> {
        if self.nodes.is_empty() {
            self.active_focus_id = None;
            return None;
        }

        let next_id = match &self.active_focus_id {
            Some(curr) => {
                if let Some(pos) = self.nodes.iter().position(|id| id == curr) {
                    let next_idx = (pos + 1) % self.nodes.len();
                    self.nodes[next_idx].clone()
                } else {
                    self.nodes[0].clone()
                }
            }
            None => self.nodes[0].clone(),
        };

        self.active_focus_id = Some(next_id.clone());
        Some(next_id)
    }

    pub fn prev(&mut self) -> Option<String> {
        if self.nodes.is_empty() {
            self.active_focus_id = None;
            return None;
        }

        let prev_id = match &self.active_focus_id {
            Some(curr) => {
                if let Some(pos) = self.nodes.iter().position(|id| id == curr) {
                    let prev_idx = if pos == 0 { self.nodes.len() - 1 } else { pos - 1 };
                    self.nodes[prev_idx].clone()
                } else {
                    self.nodes[0].clone()
                }
            }
            None => self.nodes[self.nodes.len() - 1].clone(),
        };

        self.active_focus_id = Some(prev_id.clone());
        Some(prev_id)
    }
}

impl Default for FocusManager {
    fn default() -> Self {
        Self::new()
    }
}
