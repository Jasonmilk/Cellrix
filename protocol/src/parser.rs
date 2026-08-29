// protocol/src/parser.rs
use serde_json::Value;
use crate::{SemanticSnapshot, SemanticNode, NodeType, ProtocolError};

/// Tolerant parser: parses a JSON string into SemanticSnapshot,
/// degrading individual malformed nodes to Unknown without panicking.
/// 
/// 升级对齐 C03 物理防爆规范：强制进行 256 节点截断，并对超出 1MB 的 content 实施强硬降级，杜绝客户端 OOM。
pub fn parse_snapshot_gracefully(raw_json: &str) -> Result<SemanticSnapshot, ProtocolError> {
    let v: Value = serde_json::from_str(raw_json)?;

    // Try full deserialization first; if fails, fallback to manual reconstruction.
    let mut snapshot = match serde_json::from_value::<SemanticSnapshot>(v.clone()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[WARN] Full snapshot deserialization failed, entering manual reconstruction: {}", e);
            reconstruct_snapshot_manually(&v)?
        }
    };

    // Process each node, replacing malformed ones with Unknown.
    // Use a static empty vec as default to avoid temporary value issue.
    let empty_vec = vec![];
    let nodes_array = v
        .get("semantic_tree")
        .and_then(Value::as_array)
        .unwrap_or(&empty_vec);
    
    // C03 物理规范一：节点数量强制截断至 256，丢弃多余节点，保障高能效与内存安全
    let mut fixed_nodes = Vec::with_capacity(nodes_array.len().min(256));
    
    for (idx, node_val) in nodes_array.iter().enumerate() {
        if idx >= 256 {
            eprintln!("[WARN] DDoS safety: semantic_tree exceeded 256 nodes, truncating remaining.");
            break;
        }

        match serde_json::from_value::<SemanticNode>(node_val.clone()) {
            Ok(mut node) => {
                // C03 物理规范二：当单个内容体积大于 1MB 时，执行阻断截断
                let content_size = serde_json::to_string(&node.content).map(|s| s.len()).unwrap_or(0);
                if content_size > 1024 * 1024 {
                    node.content = serde_json::json!({
                        "error": "Truncated: Content size exceeded 1MB budget",
                        "limit_violated": true
                    });
                }
                fixed_nodes.push(node);
            }
            Err(e) => {
                let id = node_val
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let label = node_val
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Corrupted Node")
                    .to_string();
                
                // 恶意节点即使解析失败，其 content 依然需要经过 1MB 资源限制校验
                let mut content = node_val.clone();
                let content_size = serde_json::to_string(&content).map(|s| s.len()).unwrap_or(0);
                if content_size > 1024 * 1024 {
                    content = serde_json::json!({
                        "error": "Truncated: Content size exceeded 1MB budget",
                        "limit_violated": true
                    });
                }

                fixed_nodes.push(SemanticNode {
                    id,
                    node_type: NodeType::Unknown,
                    label,
                    content,
                    slot_binding: None,
                    focused: false,
                });
                eprintln!("[WARN] Failed to parse node, degraded to Unknown: {}", e);
            }
        }
    }
    snapshot.semantic_tree = fixed_nodes;
    Ok(snapshot)
}

fn reconstruct_snapshot_manually(v: &Value) -> Result<SemanticSnapshot, ProtocolError> {
    let epoch_time = v.get("epoch_time").and_then(|v| v.as_u64()).unwrap_or(0);
    let status = v
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let metrics = v.get("metrics").cloned().unwrap_or(Value::Null);
    let active_focus = v
        .get("active_focus")
        .and_then(|v| v.as_str())
        .map(String::from);
    let layout_overrides = v
        .get("layout_overrides")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    let mut semantic_tree = Vec::new();
    if let Some(nodes) = v.get("semantic_tree").and_then(Value::as_array) {
        for (idx, node_val) in nodes.iter().enumerate() {
            if idx >= 256 {
                break;
            }
            if let Ok(node) = serde_json::from_value(node_val.clone()) {
                semantic_tree.push(node);
            } else {
                let id = node_val
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let label = node_val
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Broken Node")
                    .to_string();
                semantic_tree.push(SemanticNode {
                    id,
                    node_type: NodeType::Unknown,
                    label,
                    content: node_val.clone(),
                    slot_binding: None,
                    focused: false,
                });
            }
        }
    }

    Ok(SemanticSnapshot {
        epoch_time,
        status,
        metrics,
        semantic_tree,
        active_focus,
        layout_overrides,
        pfp: None,
        sap: None,
    })
}
