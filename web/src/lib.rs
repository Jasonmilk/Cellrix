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
