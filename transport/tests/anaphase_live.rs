//! Live connectivity test (candidate G-T5): real Anaphase /v1/agent/snapshot
//! -> HttpAnaphaseClient. Ignored by default; run with:
//!   cargo test -p cellrix-transport --test anaphase_live -- --ignored
//! Requires Anaphase running with cap_http_enabled (default port 50061).

use cellrix_transport::anaphase_client::{AnaphaseClient, HttpAnaphaseClient};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires live Anaphase with cap_http_enabled"]
async fn live_snapshot_roundtrip() {
    let base = std::env::var("ANAPHASE_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:50061".into());
    let client = HttpAnaphaseClient::new(base.clone());
    assert!(client.health_check().await.unwrap(), "Anaphase not reachable at {base}");

    let snap = client.get_snapshot().await.expect("snapshot fetch failed");
    // Mode must parse as a known InteractionMode (contract: snake_case).
    let _mode = snap.mode;
    let _state = snap.state;
    let _episodes = client.get_episodes().await.unwrap();
    let _ledger = client.get_ledger().await.unwrap();
}
