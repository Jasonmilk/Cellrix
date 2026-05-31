// ui/src/tui/mouse.rs
use arboard::Clipboard;
use protocol::snapshot::SemanticNode;

pub fn copy_selected_node_content(node: &SemanticNode) {
    if let Some(text) = node.content.get("text").and_then(|t| t.as_str()) {
        if let Ok(mut ctx) = Clipboard::new() {
            // 完美复制 Node 内的干净 Markdown/Text，绝对没有终端边框线（│）或侧边栏字符的污染！
            let _ = ctx.set_text(text.to_string());
        }
    }
}
