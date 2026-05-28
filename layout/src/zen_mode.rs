/// Zen mode: dynamic weight adjustment to focus on a single panel.
#[derive(Debug, Clone)]
pub struct ZenMode {
    active: bool,
    focused_node_id: Option<String>,
}

impl ZenMode {
    pub fn new() -> Self {
        Self {
            active: false,
            focused_node_id: None,
        }
    }

    /// Activate zen mode for a specific node.
    pub fn activate(&mut self, node_id: String) {
        self.active = true;
        self.focused_node_id = Some(node_id);
    }

    /// Deactivate zen mode.
    pub fn deactivate(&mut self) {
        self.active = false;
        self.focused_node_id = None;
    }

    /// Check if zen mode is active.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Get the focused node in zen mode.
    pub fn focused_node(&self) -> Option<&str> {
        self.focused_node_id.as_deref()
    }

    /// Toggle zen mode: if active, deactivate; if inactive and node provided, activate.
    pub fn toggle(&mut self, node_id: Option<String>) {
        if self.active {
            self.deactivate();
        } else if let Some(id) = node_id {
            self.activate(id);
        }
    }
}

impl Default for ZenMode {
    fn default() -> Self {
        Self::new()
    }
}
