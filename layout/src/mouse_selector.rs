// layout/src/mouse_selector.rs
use cellrix_protocol::SemanticNode;
use crate::LayoutRect;

pub struct MouseSelector;

impl MouseSelector {
    /// Pure mathematical coordinate projection algorithm.
    /// Fully aligned with 1-pixel border offsets to guarantee precision selection.
    pub fn select_text(
        start_x: u16,
        start_y: u16,
        end_x: u16,
        end_y: u16,
        node_rects: &[(String, LayoutRect)],
        nodes: &[SemanticNode],
    ) -> Option<String> {
        // 1. Normalize dragging directions
        let (s_x, s_y, e_x, e_y) = if start_y < end_y || (start_y == end_y && start_x <= end_x) {
            (start_x, start_y, end_x, end_y)
        } else {
            (end_x, end_y, start_x, start_y)
        };

        // 2. Physical collision detection: locate target node rect
        let mut target_node_id: Option<&str> = None;
        let mut target_rect: Option<LayoutRect> = None;

        for (node_id, rect) in node_rects {
            if s_x >= rect.x
                && s_x < rect.x + rect.width
                && s_y >= rect.y
                && s_y < rect.y + rect.height
            {
                target_node_id = Some(node_id);
                target_rect = Some(*rect);
                break;
            }
        }

        let node_id = target_node_id?;
        let rect = target_rect?;
        
        let node = nodes.iter().find(|n| n.id == node_id)?;
        
        // Decoupled JSON fallback extraction
        let raw_text_owned = match node.content.get("text").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => serde_json::to_string_pretty(&node.content).unwrap_or_default(),
        };
        let raw_text = &raw_text_owned;

        // 3. Core Fix: Subtract 1-pixel padding offset (due to Block borders ALL)
        // This aligns the mouse coordinates with actual rendered text offsets.
        let rel_s_x = s_x.saturating_sub(rect.x).saturating_sub(1);
        let rel_s_y = s_y.saturating_sub(rect.y).saturating_sub(1);
        
        let rel_e_x = (e_x.saturating_sub(rect.x).saturating_sub(1)).min(rect.width.saturating_sub(2));
        let rel_e_y = (e_y.saturating_sub(rect.y).saturating_sub(1)).min(rect.height.saturating_sub(2));

        // 4. Wrap text dynamically using the clean text area width (width - 2)
        let wrap_width = rect.width.saturating_sub(2);
        let wrapped_lines = Self::wrap_text(raw_text, wrap_width);
        if wrapped_lines.is_empty() {
            return None;
        }

        let mut selected_text = Vec::new();

        for y in rel_s_y..=rel_e_y {
            let line_idx = y as usize;
            if line_idx >= wrapped_lines.len() {
                break;
            }
            let line = &wrapped_lines[line_idx];
            let chars: Vec<char> = line.chars().collect();
            if chars.is_empty() {
                selected_text.push(String::new());
                continue;
            }

            let line_len = chars.len();

            let (start_col, end_col) = if rel_s_y == rel_e_y {
                // Case A: Single line selection range
                let s_col = (rel_s_x as usize).min(line_len);
                let e_col = (rel_e_x as usize).min(line_len);
                (s_col, e_col)
            } else if y == rel_s_y {
                // Case B: First line in multi-line selection
                let s_col = (rel_s_x as usize).min(line_len);
                (s_col, line_len)
            } else if y == rel_e_y {
                // Case C: Last line in multi-line selection
                let e_col = (rel_e_x as usize).min(line_len);
                (0, e_col)
            } else {
                // Case D: Middle lines
                (0, line_len)
            };

            if start_col < end_col {
                let slice: String = chars[start_col..end_col].iter().collect();
                selected_text.push(slice);
            }
        }

        Some(selected_text.join("\n"))
    }

    pub fn wrap_text(text: &str, max_width: u16) -> Vec<String> {
        if max_width == 0 {
            return vec![text.to_string()];
        }
        let mut lines = Vec::new();
        for paragraph in text.lines() {
            let chars: Vec<char> = paragraph.chars().collect();
            if chars.is_empty() {
                lines.push(String::new());
                continue;
            }
            let mut chunk = Vec::new();
            for c in chars {
                chunk.push(c);
                if chunk.len() == max_width as usize {
                    lines.push(chunk.iter().collect());
                    chunk.clear();
                }
            }
            if !chunk.is_empty() {
                lines.push(chunk.iter().collect());
            }
        }
        lines
    }
}
