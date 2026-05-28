use serde_json::Value;
use crate::{SemanticSnapshot, SemanticNode, NodeType, ProtocolError};

/// Tolerant parser: parse raw JSON string to SemanticSnapshot.
/// Degrade single corrupted node instead of failing the whole parsing process.
pub fn parse_snapshot_gracefully(raw_json: &str) -> Result<SemanticSnapshot, ProtocolError> {
    // Step 1: Deserialize to generic JSON Value first
    let v: Value = serde_json::from_str(raw_json)?;

    // Step 2: Try full deserialization first
    let mut snapshot = match serde_json::from_value::<SemanticSnapshot>(v.clone()) {
        Ok(s) => s,
        Err(_) => {
            // Fallback: manually reconstruct snapshot if full parsing failed
            return reconstruct_snapshot_manually(&v);
        }
    };

    // Step 3: Check each node, replace broken node with Unknown type
    let empty_arr: &[Value] = &[];
    let node_array = v.get("semantic_tree")
        .and_then(Value::as_array)
        .map_or(empty_arr, |val| val);

    let mut fixed_nodes = Vec::with_capacity(snapshot.semantic_tree.len());
    for node_val in node_array {
        match serde_json::from_value::<SemanticNode>(node_val.clone()) {
            Ok(node) => fixed_nodes.push(node),
            Err(e) => {
                // Degrade corrupted node, keep basic info
                let id = node_val.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                let label = node_val.get("label").and_then(|v| v.as_str()).unwrap_or("Corrupted Node").to_string();
                fixed_nodes.push(SemanticNode {
                    id,
                    node_type: NodeType::Unknown,
                    label,
                    content: node_val.clone(),
                    slot_binding: None,
                    focused: false,
                });
                eprintln!("[WARN] Node parse error, degraded: {}", e);
            }
        }
    }

    snapshot.semantic_tree = fixed_nodes;
    Ok(snapshot)
}

/// Manually rebuild snapshot when full deserialization fails
fn reconstruct_snapshot_manually(v: &Value) -> Result<SemanticSnapshot, ProtocolError> {
    let epoch_time = v.get("epoch_time").and_then(|v| v.as_u64()).unwrap_or(0);
    let status = v.get("status").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
    let metrics = v.get("metrics").cloned().unwrap_or(Value::Null);
    let active_focus = v.get("active_focus").and_then(|v| v.as_str()).map(String::from);
    let layout_overrides = v.get("layout_overrides").and_then(|v| serde_json::from_value(v.clone()).ok());

    let mut semantic_tree = Vec::new();
    if let Some(nodes) = v.get("semantic_tree").and_then(Value::as_array) {
        for node_val in nodes {
            if let Ok(node) = serde_json::from_value(node_val.clone()) {
                semantic_tree.push(node);
            } else {
                // Degrade corrupted node
                let id = node_val.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                let label = node_val.get("label").and_then(|v| v.as_str()).unwrap_or("Broken Node").to_string();
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
    })
}
