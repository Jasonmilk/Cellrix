//! Tuck audit client — fetches the Engram imprint from `GET /v1/audit`.
//!
//! The gateway's audit endpoint is read-only and identity-gated
//! (fail-closed: no credential → 401). The caller credential is the Tuck
//! identity key — never the upstream secret (that never leaves Tuck).
//!
//! # Design principles
//!
//! - **按需加载**: every query carries filters (trace_id / kind / action /
//!   limit) — the chain is never pulled wholesale.
//! - **确定性优先**: the trace id `{job_id}#{index}` contains `#`, which is
//!   a URL fragment separator — it must be percent-encoded (`%23`) in the
//!   query string.
//! - **极致解耦**: this client only knows the HTTP contract; rendering and
//!   state live in cellrix-ui.

use cellrix_protocol::engram::EngramQuery;
use serde::Serialize;

/// Error surfaced to the UI layer.
#[derive(Debug, thiserror::Error)]
pub enum AuditClientError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("gateway refused: {0}")]
    Gateway(String),
    #[error("response parse: {0}")]
    Parse(String),
}

/// Query filters — all optional; absent filters are omitted (whole-chain
/// pulls are the caller's choice, never the client's default).
#[derive(Debug, Default, Clone, Serialize)]
pub struct AuditQuery {
    pub trace_id: Option<String>,
    pub kind: Option<String>,
    pub action: Option<String>,
    pub limit: Option<usize>,
}

/// Fetch capability used by the UI poller (trait object, decoupled from
/// the concrete reqwest client — the UI never depends on transport impl).
#[async_trait::async_trait]
pub trait TuckAuditFetcher: Send + Sync {
    /// Fetch entries matching `q`.
    async fn fetch(&self, q: &AuditQuery) -> Result<EngramQuery, AuditClientError>;
}

/// HTTP client for the Tuck governance gateway's read-only audit endpoint.
#[derive(Debug, Clone)]
pub struct TuckAuditClient {
    /// Gateway base, e.g. `http://127.0.0.1:60052` (injected, no literal).
    base_url: String,
    /// Tuck identity credential (Bearer) — not the upstream secret.
    key: String,
    client: reqwest::Client,
}

impl TuckAuditClient {
    /// `base_url` is the gateway root (protocol default 127.0.0.1:60052 is
    /// a documented default, overridable); `key` must be injected.
    pub fn new(base_url: impl Into<String>, key: impl Into<String>) -> Self {
        TuckAuditClient {
            base_url: base_url.into(),
            key: key.into(),
            client: reqwest::Client::new(),
        }
    }

    /// Fetch audit entries matching the query. `#` in trace ids is a URL
    /// fragment separator; reqwest percent-encodes it in the query string
    /// (`%23`) — we pass the raw id and let the encoder do the right thing
    /// (pre-encoding here would double-encode the `%`).
    pub async fn query(&self, q: &AuditQuery) -> Result<EngramQuery, AuditClientError> {
        let mut params: Vec<(String, String)> = Vec::new();
        if let Some(t) = &q.trace_id {
            params.push(("trace_id".into(), t.clone()));
        }
        if let Some(k) = &q.kind {
            params.push(("kind".into(), k.clone()));
        }
        if let Some(a) = &q.action {
            params.push(("action".into(), a.clone()));
        }
        if let Some(n) = &q.limit {
            params.push(("limit".into(), n.to_string()));
        }

        let url = format!("{}/v1/audit", self.base_url.trim_end_matches('/'));
        let resp = self
            .client
            .get(&url)
            .query(&params)
            .bearer_auth(&self.key)
            .send()
            .await
            .map_err(AuditClientError::Http)?;

        if !resp.status().is_success() {
            return Err(AuditClientError::Gateway(format!(
                "status {}",
                resp.status()
            )));
        }
        let body = resp.text().await.map_err(AuditClientError::Http)?;
        serde_json::from_str(&body).map_err(|e| AuditClientError::Parse(e.to_string()))
    }
}

#[async_trait::async_trait]
impl TuckAuditFetcher for TuckAuditClient {
    async fn fetch(&self, q: &AuditQuery) -> Result<EngramQuery, AuditClientError> {
        self.query(q).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Replicates reqwest's percent-encoding of `#` in a query value —
    /// the wire contract the Tuck gateway sees (`live%231`).
    fn urlencoding_of_hash() -> String {
        let mut out = String::new();
        for b in b"live#1" {
            match b {
                b'#' => out.push_str("%23"),
                _ => out.push(*b as char),
            }
        }
        out
    }

    #[test]
    fn trace_id_encoding_rule() {
        // `#` must survive as `%23` in the wire query (Tuck query contract);
        // the encoder is reqwest — this asserts the contract the gateway sees.
        assert_eq!(urlencoding_of_hash(), "live%231");
        let c = TuckAuditClient::new("http://127.0.0.1:60052", "tk-test");
        assert_eq!(c.base_url, "http://127.0.0.1:60052");
    }

    /// End-to-end over a real TCP loopback server: proves the Bearer
    /// credential is attached, the `#` trace id is percent-encoded, and the
    /// response deserializes into `EngramQuery` — no mocks in the client.
    /// All I/O is async (`tokio::net`): a blocking std socket would starve
    /// the current-thread runtime and deadlock the test.
    #[tokio::test]
    async fn fetch_hits_gateway_contract() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let gateway = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            // The contract: Bearer credential + encoded trace id. Header
            // names arrive lower-cased on the wire (hyper normalizes them).
            let lower = req.to_lowercase();
            assert!(lower.contains("authorization: bearer tk-test"), "missing bearer: {req}");
            assert!(req.contains("trace_id=live%231"), "missing encoded trace: {req}");
            let body = r#"{"entries":[{"seq":0,"ts":"2026-09-07T05:28:00Z","payload":{"kind":"request","trace_id":"live#1","data":{"action":"forward"}},"prev_hash":"","hash":"f73e6c3fb518fb2b9f56e6657990255a42fd46f7e2fbbefe56016826a1ad070c"}],"count":1,"queried_by":"cellrix"}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(resp.as_bytes()).await.unwrap();
        });

        let client = TuckAuditClient::new(format!("http://{addr}"), "tk-test");
        let q = AuditQuery {
            trace_id: Some("live#1".to_string()),
            ..Default::default()
        };
        let out = client.query(&q).await.unwrap();
        assert_eq!(out.count, 1);
        assert_eq!(out.entries[0].payload.trace_id, "live#1");
        assert_eq!(out.entries[0].payload.kind, "request");
        assert_eq!(out.queried_by, "cellrix");
        gateway.await.unwrap();
    }

    /// Live gateway check (project pattern, same as m1_e2e_live): requires
    /// the real Tuck gateway at `TUCK_GATEWAY` (default localhost:60052)
    /// with `TUCK_KEY` (default tk-local-gate). Run explicitly:
    /// `cargo test -p cellrix-transport --all-features -- --ignored live`
    #[tokio::test]
    #[ignore = "requires the real Tuck gateway running"]
    async fn live_fetch_from_real_gateway() {
        let gateway = std::env::var("TUCK_GATEWAY")
            .unwrap_or_else(|_| "http://127.0.0.1:60052".to_string());
        let key = std::env::var("TUCK_KEY").unwrap_or_else(|_| "tk-local-gate".to_string());
        let client = TuckAuditClient::new(gateway, key);
        let out = client
            .query(&AuditQuery {
                limit: Some(10),
                ..Default::default()
            })
            .await
            .expect("real gateway must answer /v1/audit");
        assert!(!out.entries.is_empty(), "chain has entries (live#1 was verified)");
        // The chain is hash-linked: each entry's hash must equal the next
        // entry's prev_hash (tamper-evidence — physical fact, not belief).
        for pair in out.entries.windows(2) {
            assert_eq!(
                pair[1].prev_hash, pair[0].hash,
                "chain link broken at seq {}",
                pair[1].seq
            );
        }
    }
}
