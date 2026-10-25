//! Cellrix ⇐ Anaphase 依赖边判据（**三态**）· 2026-10-25
//! · 可达 ⇒ 真跑原 4 条断言（一条不减）
//! · 不可达 且 未设 `ANAPHASE_REQUIRED=1` ⇒ 打印 `NEEDS-INPUT: Anaphase unreachable at {base}` 并 **pass**
//!   （CI 里没有 anaphase，panic 会造成永久红）
//! · 不可达 且 `ANAPHASE_REQUIRED=1` ⇒ `panic!` 具名原因（ring-check 断上游时的**红**）
//!
//! **端口不许字面默认**（照 `Cellrix/web/tests/all_views_test.js:18-21` 的纪律：地址是声明出来的，不是猜的）：
//! 地址来源 ① `ANAPHASE_ENDPOINT`；② `anaphase-helix/ecosystem/chain.json` 的 `components[name=anaphase].port`。
//! 两者都取不到 ⇒ 同样是【缺输入】（未设 REQUIRE=1 时 pass 并打印，设了则 panic）——绝不回退到字面端口。

use cellrix_transport::anaphase_client::{AnaphaseClient, HttpAnaphaseClient};
use std::time::Duration;

/// `chain.json` 里 anaphase 的地址（**唯一真源**；取不到返回 None）
fn base_from_chain() -> Option<String> {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../anaphase-helix/ecosystem/chain.json");
    let txt = std::fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    let port = v
        .get("components")?
        .as_array()?
        .iter()
        .find(|c| c.get("name").and_then(|n| n.as_str()) == Some("anaphase"))?
        .get("port")?
        .as_u64()?;
    Some(format!("http://127.0.0.1:{port}"))
}

fn required() -> bool {
    std::env::var("ANAPHASE_REQUIRED").map(|v| v.trim() == "1").unwrap_or(false)
}

/// 缺输入 / 不可达的统一出口：REQUIRE=1 ⇒ panic（具名）；否则打印并 pass
fn needs_input(msg: String) {
    if required() {
        panic!("{msg}（ANAPHASE_REQUIRED=1 ⇒ 这笔依赖必须红）")
    } else {
        println!("{msg}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn live_snapshot_roundtrip() {
    let base = match std::env::var("ANAPHASE_ENDPOINT")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(base_from_chain)
    {
        Some(b) => b,
        None => {
            needs_input(
                "NEEDS-INPUT: Anaphase endpoint 未声明（ANAPHASE_ENDPOINT 未设，且 chain.json 无 anaphase 条目）".into(),
            );
            return;
        }
    };

    // 可达性探测（带超时；探测本身不 panic）
    let reachable = tokio::time::timeout(Duration::from_millis(4000), async {
        HttpAnaphaseClient::new(base.clone())
            .health_check()
            .await
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false);
    if !reachable {
        needs_input(format!("NEEDS-INPUT: Anaphase unreachable at {base}"));
        return;
    }

    // 可达 ⇒ 原断言，一条不减：health_check / snapshot / episodes / ledger
    let client = HttpAnaphaseClient::new(base.clone());
    assert!(client.health_check().await.unwrap(), "Anaphase not reachable at {base}");

    let snap = client.get_snapshot().await.expect("snapshot fetch failed");
    // Mode must parse as a known InteractionMode (contract: snake_case).
    let _mode = snap.mode;
    let _state = snap.state;
    let _episodes = client.get_episodes().await.unwrap();
    let _ledger = client.get_ledger().await.unwrap();
}
