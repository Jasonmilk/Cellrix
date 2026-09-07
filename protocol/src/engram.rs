//! Engram — the full-chain audit imprint view (ADR-0004 D9/D11/D12).
//!
//! An "engram" is the physical trace Helix leaves behind: every governed
//! call (request + response), its detection verdicts, the caller identity,
//! the destination class, and the tamper-evident hash chain. The audit
//! chain never stores request/response bodies (that would be a sensitive
//! data lake — ADR-0004), so an engram is metadata + chain integrity, not
//! a replay of content.
//!
//! # Design principles
//!
//! - **物理事实优先**: these types deserialize the *real* Tuck `/v1/audit`
//!   response, not a mock shape. No UUID — the trace id is the derived
//!   `{job_id}#{index}` (ADR-0003).
//! - **极致解耦**: this module only defines data shapes; fetching lives in
//!   `cellrix-transport::tuck_audit_client`.
//! - **按需加载**: a query is always filtered (trace_id / kind / action /
//!   limit) — the client never pulls the whole chain.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One `GET /v1/audit` response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngramQuery {
    /// Entries, oldest first (the chain order).
    pub entries: Vec<EngramEntry>,
    /// Number of entries returned by this query.
    pub count: usize,
    /// Caller identity that performed the query (audited itself).
    pub queried_by: String,
}

/// One audit-chain entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngramEntry {
    /// Monotonic sequence — the chain cursor.
    pub seq: u64,
    /// RFC3339 timestamp from the gateway's clock.
    pub ts: String,
    /// The payload (request / response / event).
    pub payload: EngramPayload,
    /// SHA-256 of the previous entry ("" for the genesis entry).
    pub prev_hash: String,
    /// SHA-256 of this entry — the tamper-evidence link.
    pub hash: String,
}

/// The payload of one chain entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngramPayload {
    /// Entry kind: "request" | "response" | ... (open).
    pub kind: String,
    /// Derived trace id (`{job_id}#{index}`) — joins this imprint to the
    /// Anaphase ledger and the Cellrix conversation turn.
    pub trace_id: String,
    /// The entry body. Kept as a JSON value so the display layer renders
    /// whatever fields the gateway wrote (caller / destination / detection
    /// verdicts / status / session / demap_miss ...) without a brittle
    /// exhaustive schema — the chain is the source of truth.
    pub data: Value,
}

impl EngramEntry {
    /// Short one-line summary for the timeline column.
    pub fn summary(&self) -> String {
        let action = self
            .payload
            .data
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("-");
        format!(
            "#{:04} {} {} {} [{}]",
            self.seq,
            self.ts.get(11..19).unwrap_or(&self.ts),
            self.payload.kind,
            self.payload.trace_id,
            action
        )
    }

    /// The caller label (api_key_id or sub) if present.
    pub fn caller(&self) -> Option<String> {
        self.payload
            .data
            .get("caller")
            .and_then(|c| c.get("api_key_id").or_else(|| c.get("sub")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    /// The destination class (external / local / none).
    pub fn destination(&self) -> Option<String> {
        self.payload
            .data
            .get("destination")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    /// The HTTP status for a response entry.
    pub fn status(&self) -> Option<u16> {
        self.payload.data.get("status").and_then(|v| v.as_u64()).map(|s| s as u16)
    }

    /// Detection verdicts (the `messages` array), if any.
    pub fn verdicts(&self) -> Vec<String> {
        self.payload
            .data
            .get("messages")
            .and_then(|m| m.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m.get("action").and_then(|a| a.as_str()))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "entries": [{
            "seq": 0,
            "ts": "2026-09-07T05:28:00Z",
            "payload": {
                "kind": "request",
                "trace_id": "e2e#1",
                "data": {
                    "action": "forward",
                    "caller": {"api_key_id": "system"},
                    "destination": "external",
                    "messages": [{"action": "pass", "categories": [], "destination": "external", "transform": "none"}],
                    "session": "default"
                }
            },
            "prev_hash": "",
            "hash": "f73e6c3fb518fb2b9f56e6657990255a42fd46f7e2fbbefe56016826a1ad070c"
        }],
        "count": 1,
        "queried_by": "cellrix"
    }"#;

    #[test]
    fn parses_real_audit_shape() {
        let q: EngramQuery = serde_json::from_str(SAMPLE).unwrap();
        assert_eq!(q.count, 1);
        let e = &q.entries[0];
        assert_eq!(e.payload.kind, "request");
        assert_eq!(e.payload.trace_id, "e2e#1");
        assert_eq!(e.caller(), Some("system".to_string()));
        assert_eq!(e.destination(), Some("external".to_string()));
        assert_eq!(e.verdicts(), vec!["pass".to_string()]);
        assert_eq!(e.prev_hash, "");
        assert_eq!(e.hash.len(), 64);
    }

    #[test]
    fn response_entry_has_status() {
        let q: EngramQuery = serde_json::from_str(SAMPLE).unwrap();
        let e = &q.entries[0];
        assert_eq!(e.status(), None); // request entry has no status
        assert!(e.summary().contains("e2e#1"));
    }
}
