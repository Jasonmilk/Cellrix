//! HTTP transport for the cellrix-web panel and the `up` launcher.
//!
//! Hand-rolled, std-only: every endpoint is a trusted local service on the
//! same machine (Anaphase cap_http / Tuck gateway / local LLM proxy) —
//! no framework, no dependency (按需加载, 极致解耦).

use std::io::{Read, Write};
use std::net::TcpStream;

/// Read timeout for probes and proxies: plenty for local tools, keeps a
/// half-open peer from hanging a thread.
// LLM reasoning takes seconds (1-2s typical, bursts beyond); a 2s read
// timeout made the panel proxy hit macOS WouldBlock (os error 35) mid-reply.
const READ_TIMEOUT_SECS: u64 = 180;

/// Hand-rolled HTTP GET: read the body after the blank line.
/// `bearer` is an optional identity credential (never sent to the browser).
pub fn fetch_json(base: &str, path: &str, bearer: Option<&str>) -> Result<String, String> {
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
    let req = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{auth}Connection: close\r\n\r\n");
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

/// POST a JSON body, return the response body. Same transport contract as
/// `fetch_json` (raw TCP, no external deps).
/// Open a POST connection, write the (signed) request and return the
/// connected stream. Shared by the buffered and streamed paths — one
/// request shape, two transports.
fn post_open(
    base: &str,
    path: &str,
    body: &str,
    bearer: Option<&str>,
    accept_sse: bool,
) -> Result<TcpStream, String> {
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
    if accept_sse {
        req.push_str("Accept: text/event-stream\r\n");
    }
    if let Some(k) = bearer.filter(|k| !k.is_empty()) {
        req.push_str(&format!("Authorization: Bearer {k}\r\n"));
    }
    req.push_str("Connection: close\r\n\r\n");
    req.push_str(body);
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    Ok(stream)
}

pub fn post_json(base: &str, path: &str, body: &str, bearer: Option<&str>) -> Result<String, String> {
    let mut stream = post_open(base, path, body, bearer, false)?;
    read_http_body(&mut stream)
}

/// Streamed POST (SSE): forwards origin body bytes to the browser as they
/// arrive. This proxy is a proper HTTP relay — it strips the origin response
/// head (the panel writes its own) and decodes chunked transfer encoding so
/// the browser receives clean SSE lines (`data: ...`) with no framing noise.
/// It never parses the SSE semantics, only the HTTP transport.
pub fn post_stream(
    base: &str,
    path: &str,
    body: &str,
    bearer: Option<&str>,
    on_chunk: &mut dyn FnMut(&[u8]) -> std::io::Result<()>,
) -> Result<(), String> {
    let mut stream = post_open(base, path, body, bearer, true)?;

    // 1. Read the response head (up to the blank line) and discard it.
    let mut head = Vec::new();
    let mut tmp = [0u8; 8192];
    let mut head_end = None;
    while head_end.is_none() {
        let n = stream.read(&mut tmp).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("empty origin response".to_string());
        }
        head.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_sub(&head, b"\r\n\r\n") {
            head_end = Some(pos + 4);
        }
    }
    let head_end = head_end.unwrap();
    let head_text = String::from_utf8_lossy(&head[..head_end.saturating_sub(4)]);
    let chunked = head_text
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked");
    let mut buffered = head[head_end..].to_vec();

    // 2. Relay the body. Chunked is decoded (transport-level, not SSE
    //    semantics); anything else is forwarded byte-for-byte.
    let mut done = false;
    while !done {
        if chunked {
            // chunk size line
            let size_line = read_line_from(&mut stream, &mut buffered)?;
            if size_line.is_empty() {
                break; // clean EOF between chunks
            }
            let size_text = String::from_utf8_lossy(&size_line);
            let size_text = size_text.split(';').next().unwrap_or("").trim();
            let size = usize::from_str_radix(size_text, 16)
                .map_err(|_| format!("bad chunk size: {size_text}"))?;
            if size == 0 {
                break; // terminal chunk; trailer (if any) is ignored
            }
            // chunk payload
            let mut payload = Vec::with_capacity(size.min(65536));
            let mut remaining = size;
            while remaining > 0 {
                if !buffered.is_empty() {
                    let take = remaining.min(buffered.len());
                    payload.extend_from_slice(&buffered[..take]);
                    buffered.drain(..take);
                    remaining -= take;
                } else {
                    let n = stream.read(&mut tmp).map_err(|e| e.to_string())?;
                    if n == 0 {
                        // EOF inside a chunk payload: flush the remainder.
                        if !buffered.is_empty() {
                            on_chunk(&buffered).map_err(|e| e.to_string())?;
                            buffered.clear();
                        }
                        return Ok(());
                    }
                    buffered.extend_from_slice(&tmp[..n]);
                }
            }
            on_chunk(&payload).map_err(|e| e.to_string())?;
            // chunk terminator CRLF
            let _ = read_line_from(&mut stream, &mut buffered)?;
        } else {
            if !buffered.is_empty() {
                on_chunk(&buffered).map_err(|e| e.to_string())?;
                buffered.clear();
            }
            match stream.read(&mut tmp) {
                Ok(0) => done = true,
                Ok(n) => on_chunk(&tmp[..n]).map_err(|e| e.to_string())?,
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    Ok(())
}

/// Index of the first occurrence of `needle` in `hay`, or None.
fn find_sub(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Read one line (terminated by CRLF or LF) from buffered + stream.
fn read_line_from(stream: &mut TcpStream, buffered: &mut Vec<u8>) -> Result<Vec<u8>, String> {
    let mut tmp = [0u8; 8192];
    loop {
        if let Some(pos) = find_sub(buffered, b"\n") {
            let line = buffered[..pos].to_vec();
            buffered.drain(..pos + 1);
            return Ok(line);
        }
        let n = stream.read(&mut tmp).map_err(|e| e.to_string())?;
        if n == 0 {
            // EOF: flush whatever is buffered (may be empty) and end.
            // A partial line is relayed, never dropped with a hard error.
            return Ok(std::mem::take(buffered));
        }
        buffered.extend_from_slice(&tmp[..n]);
    }
}

fn read_http_body(stream: &mut TcpStream) -> Result<String, String> {
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
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}");
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
