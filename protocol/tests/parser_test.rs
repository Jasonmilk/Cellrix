// protocol/tests/parser_test.rs
use cellrix_protocol::parse_snapshot_gracefully;
use cellrix_protocol::NodeType;

/// 验证 C03 公理：即便快照格式严重损坏，解析器也必须优雅退化，绝对不允许引发崩溃 (Panic Prevention)
#[test]
fn test_parser_graceful_recovery_on_corrupted_json() {
    // 注入合规的 JSON 语法但类型完全错乱的畸形 Payload（已彻底移除 // 非标准注释）
    let corrupted_payload = r#"{
        "epoch_time": "this_should_be_a_u64_but_is_a_string",
        "status": 12345,
        "semantic_tree": [
            {
                "id": "exploit_node",
                "node_type": "unknown_shadow_type",
                "label": "Degraded Card",
                "content": { "nested": "data" }
            }
        ]
    }"#;

    // Google 规范：使用 assert!(result.is_ok())，确保在测试执行时优雅拦截
    let result = parse_snapshot_gracefully(corrupted_payload);
    assert!(result.is_ok(), "The graceful parser must not return an Err on corrupted inputs!");

    let snapshot = result.unwrap();
    assert_eq!(snapshot.semantic_tree.len(), 1);
    
    // 核心安全断言：损坏和未知的节点必须在物理内存中退化为 NodeType::Unknown，阻止 TUI 侧崩溃
    assert_eq!(snapshot.semantic_tree[0].node_type, NodeType::Unknown);
    assert_eq!(snapshot.semantic_tree[0].id, "exploit_node");
}

/// 验证 C03 资源上限：测试在大文件 DDoS（内存耗尽攻击）下，解析器对单个节点 1MB 的安全拦截机制
#[test]
fn test_parser_defense_against_massive_payload() {
    // 构造一个极其庞大、超出 1MB 限制的恶意 content 节点
    let mut ddos_text = String::with_capacity(1_500_000); // 1.5 MB
    for _ in 0..150_000 {
        ddos_text.push_str("ATTACK_VECTOR_");
    }

    let ddos_json = serde_json::json!({
        "epoch_time": 1780265356,
        "status": "degraded_state",
        "metrics": {},
        "semantic_tree": [
            {
                "id": "ddos_node",
                "node_type": "text_panel",
                "label": "Giant Node",
                "content": { "text": ddos_text }, // 恶意灌入超大文本
                "slot_binding": null,
                "focused": false
            }
        ]
    }).to_string();

    let result = parse_snapshot_gracefully(&ddos_json);
    assert!(result.is_ok());

    let snapshot = result.unwrap();
    assert_eq!(snapshot.semantic_tree.len(), 1);

    // 核心安全断言：超出 1MB 的节点内容必须被强制截断或退化，防止 TUI 侧发生 Out-Of-Memory (OOM)
    let content_obj = snapshot.semantic_tree[0].content.as_object().unwrap();
    assert!(
        content_obj.contains_key("error") || content_obj.contains_key("limit_violated"),
        "The parser failed to safely truncate the 1MB+ oversized node payload!"
    );
}
