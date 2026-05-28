/// Semantic focus manager: tracks focus by node ID.
pub struct FocusManager {
    current_focus: Option<String>,
    focus_order: Vec<String>,
}

impl FocusManager {
    pub fn new() -> Self {
        Self {
            current_focus: None,
            focus_order: Vec::new(),
        }
    }

    pub fn rebuild_order(&mut self, node_ids: &[String]) {
        self.focus_order = node_ids.to_vec();
        if self.current_focus.is_none() && !self.focus_order.is_empty() {
            self.current_focus = Some(self.focus_order[0].clone());
        } else if let Some(ref current) = self.current_focus {
            if !self.focus_order.contains(current) {
                self.current_focus = self.focus_order.first().cloned();
            }
        }
    }

    pub fn focus_next(&mut self) -> Option<&str> {
        if self.focus_order.is_empty() {
            return None;
        }
        let current_idx = self
            .current_focus
            .as_ref()
            .and_then(|id| self.focus_order.iter().position(|x| x == id))
            .unwrap_or(0);
        let next_idx = (current_idx + 1) % self.focus_order.len();
        self.current_focus = Some(self.focus_order[next_idx].clone());
        self.current_focus.as_deref()
    }

    pub fn focus_prev(&mut self) -> Option<&str> {
        if self.focus_order.is_empty() {
            return None;
        }
        let current_idx = self
            .current_focus
            .as_ref()
            .and_then(|id| self.focus_order.iter().position(|x| x == id))
            .unwrap_or(0);
        let prev_idx = if current_idx == 0 {
            self.focus_order.len() - 1
        } else {
            current_idx - 1
        };
        self.current_focus = Some(self.focus_order[prev_idx].clone());
        self.current_focus.as_deref()
    }

    pub fn set_focus(&mut self, node_id: String) -> Result<(), crate::LayoutError> {
        if self.focus_order.contains(&node_id) {
            self.current_focus = Some(node_id);
            Ok(())
        } else {
            Err(crate::LayoutError::NodeNotFound(node_id))
        }
    }

    pub fn current_focus(&self) -> Option<&str> {
        self.current_focus.as_deref()
    }

    pub fn clear_focus(&mut self) {
        self.current_focus = None;
    }
}

impl Default for FocusManager {
    fn default() -> Self {
        Self::new()
    }
}
