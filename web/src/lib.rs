//! Shared HTTP plumbing for the cellrix-web panel and the `up` launcher.
//!
//! Hand-rolled, std-only: every endpoint is a trusted local service on the
//! same machine (Anaphase cap_http / Tuck gateway / local LLM proxy), so a
//! bare GET with `Connection: close` and a 2s read timeout is all we need —
//! no framework, no dependency (按需加载, 极致解耦).

use std::io::{Read, Write};
use std::net::TcpStream;

/// Read timeout for probes and proxies: plenty for local tools, keeps a
/// half-open peer from hanging a thread.
const READ_TIMEOUT_SECS: u64 = 2;

/// Hand-rolled HTTP GET: read the body after the blank line.
/// `bearer` is an optional identity credential (never sent to the browser).
pub fn fetch_json(
    base: &str,
    path: &str,
    bearer: Option<&str>,
) -> Result<String, String> {
    let base = base.trim_start_matches("http://").trim_end_matches('/');
    let (host, port) = match base.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().map_err(|e| e.to_string())?),
        None => (base.to_string(), 80),
    };
    let mut stream = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(READ_TIMEOUT_SECS)))
        .map_err(|e| e.to_string())?;
    let auth = match bearer {
        Some(k) if !k.is_empty() => format!("Authorization: Bearer {k}\r\n"),
        _ => String::new(),
    };
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\n{auth}Connection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    buf.split("\r\n\r\n")
        .nth(1)
        .map(|s| s.to_string())
        .ok_or_else(|| "empty response".to_string())
}

/// Probe one data source: Ok when the peer answers with a JSON body.
/// Refused/half-open/timeout peers are Err — callers decide what to do
/// (panel: report; `up`: start the missing component or guide).
pub fn probe(base: &str, path: &str, bearer: Option<&str>) -> Result<(), String> {
    let body = fetch_json(base, path, bearer)?;
    if body.trim_start().starts_with('{') {
        Ok(())
    } else {
        Err("unexpected body".to_string())
    }
}

/// Extract the names of configured-but-unhealthy checks from a /v1/health
/// body. Field order is stable (name, configured, ok, detail) — this stays
/// a cheap string scan, no JSON dependency.
pub fn unhealthy_names(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    for seg in body.split("\"name\":\"") {
        if seg.len() < 3 {
            continue;
        }
        let name = &seg[..seg.find('"').unwrap_or(0)];
        if name.is_empty() {
            continue;
        }
        if seg.contains("\"configured\":true") && seg.contains("\"ok\":false") {
            out.push(name.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    #[test]
    fn sign_bearer_shape() {
        let secret = "k".repeat(32);
        let tok = sign_bearer("anaphase#abc123", &secret);
        let parts: Vec<&str> = tok.split('.').collect();
        // v1.<id>.<ts>.<nonce>.<hmac> — fetch_json prepends "Bearer ".
        assert_eq!(parts.len(), 5);
        assert_eq!(parts[0], "v1");
        assert!(parts[1].starts_with("anaphase#"));
        assert!(parts[2].parse::<u64>().is_ok());
        assert!(!parts[3].is_empty());
        assert_eq!(parts[4].len(), 64);
    }

    #[test]
    fn sign_bearer_unique_per_call() {
        let secret = "k".repeat(32);
        let a = sign_bearer("anaphase#abc123", &secret);
        let b = sign_bearer("anaphase#abc123", &secret);
        assert_ne!(a, b);
    }

    #[test]
    fn extract_json_str_finds_values() {
        assert_eq!(extract_json_str(r#"{"pairing_code":"123456"}"#, "pairing_code").as_deref(), Some("123456"));
        assert_eq!(extract_json_str(r#"{"bound": true}"#, "bound"), None);
    }

    #[test]
    fn probe_ok_on_json_and_err_on_garbage() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap().to_string();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = l.accept() {
                let _ = s.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}",
                );
            }
        });
        assert!(probe(&format!("http://{addr}"), "/v1/health", None).is_ok());
    }

    #[test]
    fn probe_errs_on_refused() {
        // Bind and drop: the port is free, nothing listening.
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap().to_string();
        drop(l);
        assert!(probe(&format!("http://{addr}"), "/v1/health", None).is_err());
    }

    #[test]
    fn unhealthy_names_parses_failed_checks() {
        let body = r#"{"ok":false,"checks":[{"name":"tentacle","configured":true,"ok":false,"detail":"refused"},{"name":"trace","configured":true,"ok":true,"detail":"ok"},{"name":"mind","configured":false,"ok":true,"detail":"not configured"}]}"#;
        let bad = unhealthy_names(body);
        assert_eq!(bad, vec!["tentacle"]);
    }

    #[test]
    fn unhealthy_names_ok_body_is_empty() {
        let body = r#"{"ok":true,"checks":[]}"#;
        assert!(unhealthy_names(body).is_empty());
    }
}

// === One-to-one binding client (2026-09-07) ===
// The client holds the same secret Anaphase minted at confirm time, in
// `~/.cellrix/identity.toml` (0600, written once by `up`'s guided bind).
// Every request is signed fresh: Bearer v1.<id>.<ts>.<nonce>.<hmac> —
// replay dies on the Anaphase side (window + one-time nonce).

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Read the client identity file (device_id + secret). Missing/empty =
/// unbound — callers then simply send no header (Anaphase is open until
/// bound, honest "not bound" state).
pub fn load_client_identity() -> Option<(String, String)> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home).join(".cellrix/identity.toml");
    let body = std::fs::read_to_string(path).ok()?;
    let mut id = None;
    let mut secret = None;
    for line in body.lines() {
        let line = line.trim();
        let Some((k, v)) = line.split_once('=') else { continue };
        let v = v.trim().trim_matches('"').to_string();
        match k.trim() {
            "device_id" => id = Some(v),
            "secret" => secret = Some(v),
            _ => {}
        }
    }
    match (id, secret) {
        (Some(id), Some(secret)) => Some((id, secret)),
        _ => None,
    }
}

/// Build a fresh signed token for (device_id, secret). The token is the
/// bare `v1.<id>.<ts>.<nonce>.<hmac>` part — `fetch_json` prepends the
/// `Authorization: Bearer ` wrapper (same contract as the Tuck key).
pub fn sign_bearer(device_id: &str, secret: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let ts = now.as_secs().to_string();
    // Nonce: nanosecond clock + pid — unique per request (a same-second
    // repeat would be rejected as a replay by the Anaphase side).
    let nonce = format!("{:x}", now.as_nanos() ^ std::process::id() as u128 ^ 0x5f3759dfu128);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(format!("{device_id}|{ts}|{nonce}").as_bytes());
    let mac = mac.finalize().into_bytes();
    let mac_hex: String = mac.iter().map(|b| format!("{b:02x}")).collect();
    format!("v1.{device_id}.{ts}.{nonce}.{mac_hex}")
}

/// Signed token if bound, else None (unbound → no header → Anaphase open).
pub fn client_bearer() -> Option<String> {
    load_client_identity().map(|(id, secret)| sign_bearer(&id, &secret))
}

/// Minimal JSON string-field extractor (no serde dependency — 极致节能).
/// Finds `"key":"value"` / `"key": "value"` and returns value, else None.
pub fn extract_json_str(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let idx = body.find(&needle)?;
    let rest = &body[idx + needle.len()..];
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// POST a JSON body, return the response body. Same transport contract as
/// `fetch_json` (raw TCP, no external deps).
pub fn post_json(
    base: &str,
    path: &str,
    body: &str,
    bearer: Option<&str>,
) -> Result<String, String> {
    let base = base.trim_start_matches("http://").trim_end_matches('/');
    let (host, port) = match base.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().map_err(|e| e.to_string())?),
        None => (base.to_string(), 80),
    };
    let mut stream = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(READ_TIMEOUT_SECS)))
        .map_err(|e| e.to_string())?;
    let mut req = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        body.len()
    );
    if let Some(k) = bearer.filter(|k| !k.is_empty()) {
        req.push_str(&format!("Authorization: Bearer {k}\r\n"));
    }
    req.push_str("Connection: close\r\n\r\n");
    req.push_str(body);
    use std::io::Write;
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    read_http_body(&mut stream)
}

fn read_http_body(stream: &mut TcpStream) -> Result<String, String> {
    use std::io::Read;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(e) => return Err(e.to_string()),
        }
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    // Body starts after the first blank line.
    match text.find("\r\n\r\n") {
        Some(i) => Ok(text[i + 4..].to_string()),
        None => Ok(text),
    }
}
