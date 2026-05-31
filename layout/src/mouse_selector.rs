// layout/src/mouse_selector.rs
use cellrix_protocol::SemanticNode;
use crate::LayoutRect;

pub struct MouseSelector;

impl MouseSelector {
    /// 核心空间算法：将鼠标的物理/绝对坐标，解算并投影到对应语义节点（SemanticNode）的字符折行内容中。
    /// 
    /// 此算法不依赖任何 native 终端、浏览器 DOM、或渲染引擎。
    /// 它完全基于 pure Rust 标准库编写，完美支持编译至 WebAssembly。
    pub fn select_text(
        start_x: u16,
        start_y: u16,
        end_x: u16,
        end_y: u16,
        node_rects: &[(String, LayoutRect)],
        nodes: &[SemanticNode],
    ) -> Option<String> {
        // 1. 规整化拖拽方向：确保 (s_x, s_y) 永远位于 (e_x, e_y) 之前（处理反向/向上拖拽）
        let (s_x, s_y, e_x, e_y) = if start_y < end_y || (start_y == end_y && start_x <= end_x) {
            (start_x, start_y, end_x, end_y)
        } else {
            (end_x, end_y, start_x, start_y)
        };

        // 2. 物理碰撞检测：确定鼠标起点落在哪个 `SemanticNode` 的 LayoutRect 物理边界内
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
        
        // 3. 定位到对应的语义节点
        let node = nodes.iter().find(|n| n.id == node_id)?;
        
        // C03 实现约束：从 content 中优雅提取原始文本
        let raw_text = node.content.get("text")?.as_str()?;

        // 4. 将物理绝对坐标，平移为该节点 LayoutRect 的相对局部坐标，并做安全裁剪
        let rel_s_x = s_x.saturating_sub(rect.x);
        let rel_s_y = s_y.saturating_sub(rect.y);
        let rel_e_x = (e_x.saturating_sub(rect.x)).min(rect.width);
        let rel_e_y = (e_y.saturating_sub(rect.y)).min(rect.height);

        // 5. 执行与渲染端完全对齐的 character-level 物理自适应折行计算（纯无状态、不依赖 UI 库）
        let wrapped_lines = Self::wrap_text(raw_text, rect.width);
        if wrapped_lines.is_empty() {
            return None;
        }

        // 6. 进行无污染行文本切片提取
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
                // 情况 A：单行内拖拽
                let s_col = (rel_s_x as usize).min(line_len);
                let e_col = (rel_e_x as usize).min(line_len);
                (s_col, e_col)
            } else if y == rel_s_y {
                // 情况 B：多行选取的起始行（从鼠标起点相对列拷贝到该行末尾）
                let s_col = (rel_s_x as usize).min(line_len);
                (s_col, line_len)
            } else if y == rel_e_y {
                // 情况 C：多行选取的结束行（从行首拷贝到鼠标终点相对列）
                let e_col = (rel_e_x as usize).min(line_len);
                (0, e_col)
            } else {
                // 情况 D：中间完整包含行
                (0, line_len)
            };

            if start_col < end_col {
                let slice: String = chars[start_col..end_col].iter().collect();
                selected_text.push(slice);
            }
        }

        Some(selected_text.join("\n"))
    }

    /// 纯算法 character-level 文本物理换行工具（兼容 WASM 运行时）
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
