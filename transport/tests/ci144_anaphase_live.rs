//! Live CI-144 stdio connectivity test (ADR-0017): real Anaphase binary over
//! the CIB/1.0 MessagePack transport — handshake, Manifest, snapshot push,
//! action round trips. Ignored by default; run with:
//!   cargo test -p cellrix-transport --test ci144_anaphase_live -- --ignored
//! Requires the Anaphase binary (ANAPHASE_BIN, default: sibling repo path).

use cellrix_transport::{CapTransport, StdioTransport};
use tokio_stream::StreamExt;
use cellrix_protocol::{ActionRequest, AgentEvent};

async fn spawn_transport() -> StdioTransport {
    /* A MISSING PRECONDITION MUST NOT READ AS A PASS (2026-10-09).
     *
     * This used to be `std::env::var("ANAPHASE_BIN").ok()?` and the caller did
     * `let Some(t) = ... else { eprintln!("skipping live probe"); return; }` — so an
     * un-measured run was recorded as PASSING: "not measured" and "measured and fine"
     * looked identical. That is the same fault this repo names elsewhere
     * (`port_table_test.js`: "a declared SKIP, not a silent pass and not a crash";
     *  and the engine's I7: "no gate installed must not look like a gate that passed").
     *
     * The test is `#[ignore]` — i.e. it is DECLARED as not-run-by-default. So if someone
     * runs it explicitly (`-- --ignored`) and the binary is not there, the honest outcome
     * is a NAMED failure, not a green line.
     */
    let bin = std::env::var("ANAPHASE_BIN").unwrap_or_else(|_| {
        panic!(
            "UNMEASURED: ANAPHASE_BIN 未设置 —— 这条判据测的是【跨仓协议一致性】，
             没有真二进制就无法测。缺前提是具名失败，不是通过。             （跑法：cargo build --bin anaphase 后设 ANAPHASE_BIN=<path> 再 -- --ignored）"
        )
    });
    let args = vec![bin, "--stdio".to_string()];
    let (cmd, rest) = args.split_first().unwrap();
    match StdioTransport::new(cmd, rest).await {
        Ok(t) => t,
        Err(e) => panic!("spawn anaphase: {e:?} (set ANAPHASE_BIN to the real binary)"),
    }
}

#[tokio::test]
#[ignore = "requires the real Anaphase binary (cargo build first)"]
async fn live_manifest_snapshot_actions() {
    let mut transport = spawn_transport().await;

    // Handshake + Manifest (first frame must be the capability manifest).
    let (manifest, mut stream) = transport.connect().await.expect("connect");
    assert_eq!(manifest.agent_name, "anaphase-helix");
    assert!(manifest.actions.iter().any(|a| a.id == "status"));

    // Snapshot push arrives on the event stream.
    let snap = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        async {
            loop {
                match stream.next().await {
                    Some(Ok(AgentEvent::Snapshot(s))) => return s,
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => panic!("stream error: {e:?}"),
                    None => panic!("stream ended before snapshot"),
                }
            }
        },
    )
    .await
    .expect("snapshot push timeout");
    assert!(!snap.semantic_tree.is_empty());

    // Action: status -> Success.
    let resp = transport
        .send_action(ActionRequest {
            action_id: "status".to_string(),
            parameters: serde_json::json!({}),
            view_hash: None,
        })
        .await
        .expect("status action");
    match resp {
        cellrix_protocol::ActionResponse::Success { message } => {
            assert!(message.contains("mode="), "status message: {message}");
        }
        other => panic!("expected Success, got {other:?}"),
    }

    // Action: send_message -> one real cognitive period.
    let resp = transport
        .send_action(ActionRequest {
            action_id: "send_message".to_string(),
            parameters: serde_json::json!({"message": "hello helix"}),
            view_hash: None,
        })
        .await
        .expect("send_message action");
    match resp {
        cellrix_protocol::ActionResponse::Success { message } => {
            assert!(!message.is_empty(), "send_message returned empty text");
        }
        other => panic!("expected Success, got {other:?}"),
    }

    // Action: unknown -> recoverable Failure (not a transport error).
    let resp = transport
        .send_action(ActionRequest {
            action_id: "nope".to_string(),
            parameters: serde_json::json!({}),
            view_hash: None,
        })
        .await
        .expect("unknown action must not fail at transport level");
    match resp {
        cellrix_protocol::ActionResponse::Failure { recoverable: true, .. } => {}
        other => panic!("expected recoverable Failure, got {other:?}"),
    }

    drop(transport);
}
