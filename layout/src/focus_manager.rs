/// FocusManager maintains an ordered list of focusable node IDs and a cursor.
/// The list is rebuilt externally whenever the UI structure changes.
pub struct FocusManager {
    focusable_ids: Vec<String>,
    current_idx: usize,
}

impl FocusManager {
    pub fn new() -> Self {
        Self {
            focusable_ids: Vec::new(),
            current_idx: 0,
        }
    }

    /// Replace the entire focusable list and reset cursor to the given node (or first).
    pub fn rebuild(&mut self, ids: Vec<String>, focus_target: Option<&str>) {
        self.focusable_ids = ids;
        if self.focusable_ids.is_empty() {
            self.current_idx = 0;
            return;
        }
        if let Some(target) = focus_target {
            if let Some(pos) = self.focusable_ids.iter().position(|id| id == target) {
                self.current_idx = pos;
                return;
            }
        }
        self.current_idx = 0;
    }

    pub fn focus_next(&mut self) -> Option<String> {
        if self.focusable_ids.is_empty() {
            return None;
        }
        self.current_idx = (self.current_idx + 1) % self.focusable_ids.len();
        Some(self.focusable_ids[self.current_idx].clone())
    }

    pub fn focus_prev(&mut self) -> Option<String> {
        if self.focusable_ids.is_empty() {
            return None;
        }
        if self.current_idx == 0 {
            self.current_idx = self.focusable_ids.len() - 1;
        } else {
            self.current_idx -= 1;
        }
        Some(self.focusable_ids[self.current_idx].clone())
    }

    pub fn current_focus(&self) -> Option<&str> {
        if self.focusable_ids.is_empty() {
            None
        } else {
            Some(&self.focusable_ids[self.current_idx])
        }
    }

    pub fn is_focused(&self, node_id: &str) -> bool {
        self.current_focus() == Some(node_id)
    }

    pub fn focusable_ids(&self) -> &[String] {
        &self.focusable_ids
    }
}
