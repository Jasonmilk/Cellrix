//! # FocusManager — 纯焦点状态机
//! 负责追踪和切换当前聚焦的节点ID。
//! 由 App 事件循环直接驱动，与渲染器解耦。

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

    /// 更新可聚焦的节点列表并重置焦点。
    pub fn rebuild_order(&mut self, node_ids: &[String]) {
        self.focusable_ids = node_ids.to_vec();
        self.current_idx = if self.focusable_ids.is_empty() {
            0
        } else {
            0
        };
    }

    /// 尝试将焦点移动到下一个节点。
    pub fn focus_next(&mut self) -> Option<String> {
        if self.focusable_ids.is_empty() {
            return None;
        }
        self.current_idx = (self.current_idx + 1) % self.focusable_ids.len();
        Some(self.focusable_ids[self.current_idx].clone())
    }

    /// 尝试将焦点移动到上一个节点。
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

    /// 获取当前焦点的节点ID。
    pub fn current_focus(&self) -> Option<&str> {
        if self.focusable_ids.is_empty() {
            None
        } else {
            Some(&self.focusable_ids[self.current_idx])
        }
    }

    /// 检查特定节点是否处于焦点。
    pub fn is_focused(&self, node_id: &str) -> bool {
        self.current_focus() == Some(node_id)
    }
}

impl Default for FocusManager {
    fn default() -> Self {
        Self::new()
    }
}
