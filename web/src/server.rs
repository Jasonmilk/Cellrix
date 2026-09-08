//! HTTP serving layer: route → proxy the truth sources (Anaphase / Tuck),
//! one std-only listener. The browser is never given credentials — Bearer
//! injection happens here (proxy pattern, ADR-0010/0014).
//!
//! Two projections of one truth: the **Cockpit** view (Anaphase
//! `/v1/agent/snapshot`, ADR-0010) and the **Engram** imprint view (Tuck
//! `/v1/audit` chain). The browser renders the *same data model* the TUI
//! shows, so the silicon and carbon sides read the same picture with no
//! ambiguity (TUI=Web isomorphic projection).

use std::io::{Read, Write};
use std::net::TcpStream;

use crate::config::PanelConfig;

/// Route table: the panel's own surface. Everything else proxies upstream.
#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    Index,
    Snapshot,
    Audit,
    Trace,
    Sessions,
    SessionsRename,
    Events,
    Ecosystem,
    Chat,
    NotFound,
}

/// Parse the request target into a Route (query string stripped — the
/// routing decision never depends on query content).
pub fn route(path: &str) -> Route {
    let p = path.split('?').next().unwrap_or(path);
    match p {
        "/" | "" => Route::Index,
        "/api/snapshot" => Route::Snapshot,
        "/api/audit" => Route::Audit,
        "/api/trace" => Route::Trace,
        "/api/sessions" => Route::Sessions,
        "/api/sessions/rename" => Route::SessionsRename,
        "/api/events" => Route::Events,
        "/api/ecosystem" => Route::Ecosystem,
        "/api/chat" => Route::Chat,
        _ => Route::NotFound,
    }
}

/// True when a Cellrix panel is already answering on `port` (probe the
/// index page — our HTML carries the `view-chat` marker). Anything else on
/// the port (foreign service) reads as false and stays an honest error.
pub fn panel_already_up(port: &u16) -> bool {
    let base = format!("http://127.0.0.1:{port}");
    match cellrix_web::fetch_json(&base, "/", None) {
        Ok(body) => body.contains("view-chat"),
        Err(_) => false,
    }
}

/// Serve one connection: parse the request line, route, respond.
pub fn handle(
    mut stream: TcpStream,
    cfg: &PanelConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf)?;
    if n == 0 {
        return Ok(());
    }
    let text = String::from_utf8_lossy(&buf[..n]);
    let path = text
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/");

    match route(path) {
        Route::Index => {
            let body = crate::index_html(cfg);
            respond(&mut stream, 200, "text/html; charset=utf-8", body.as_bytes())?;
        }
        Route::Snapshot => {
            let auth = cellrix_web::client_bearer();
            match cellrix_web::fetch_json(&cfg.anaphase_endpoint, SNAPSHOT_PATH, auth.as_deref()) {
                Ok(body) => respond(&mut stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"status\":\"Error\",\"error\":\"{e}\"}}");
                    respond(&mut stream, 502, "application/json", msg.as_bytes())?;
                }
            }
        }
        Route::Audit => {
            // Isomorphic with the TUI's TuckAuditFetcher: same query window,
            // same EngramQuery JSON shape (entries/count/queried_by).
            match &cfg.tuck_endpoint {
                Some(ep) => {
                    let q = format!("/v1/audit?limit={}", cfg.tuck_limit);
                    match cellrix_web::fetch_json(ep, &q, cfg.tuck_key.as_deref()) {
                        Ok(body) => {
                            respond(&mut stream, 200, "application/json", body.as_bytes())?
                        }
                        Err(e) => {
                            let msg = format!(
                                "{{\"configured\":true,\"count\":0,\"queried_by\":\"\",\"error\":\"{e}\"}}"
                            );
                            respond(&mut stream, 502, "application/json", msg.as_bytes())?;
                        }
                    }
                }
                None => {
                    let msg =
                        "{\"configured\":false,\"count\":0,\"queried_by\":\"\",\"entries\":[]}";
                    respond(&mut stream, 200, "application/json", msg.as_bytes())?;
                }
            }
        }
        Route::Trace => {
            // Engram body half: proxy the Anaphase reasoning-trace query,
            // passing the browser's query string (trace_id=...) through.
            // The Anaphase side answers with redacted bodies — no
            // credential ever rides this path (Redaction ran on write).
            let q = text
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("/api/trace");
            let query = q.split('?').nth(1).unwrap_or("");
            let target = if query.is_empty() {
                "/v1/trace?limit=20".to_string()
            } else {
                format!("/v1/trace?{query}&limit=20")
            };
            let auth = cellrix_web::client_bearer();
            match cellrix_web::fetch_json(&cfg.anaphase_endpoint, &target, auth.as_deref()) {
                Ok(body) => respond(&mut stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"configured\":false,\"count\":0,\"entries\":[],\"error\":\"{e}\"}}");
                    respond(&mut stream, 502, "application/json", msg.as_bytes())?;
                }
            }
        }
        Route::Sessions => {
            // Session-management sidebar (Engram v2): proxy the Anaphase
            // period list (one summary per cognitive period, newest first).
            let auth = cellrix_web::client_bearer();
            let target = "/v1/sessions?limit=50";
            match cellrix_web::fetch_json(&cfg.anaphase_endpoint, target, auth.as_deref()) {
                Ok(body) => respond(&mut stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"configured\":false,\"periods\":[],\"error\":\"{e}\"}}");
                    respond(&mut stream, 502, "application/json", msg.as_bytes())?;
                }
            }
        }
        Route::SessionsRename => {
            // Human-chosen experience name: proxy the POST body through to
            // Anaphase /v1/sessions/rename (sidecar `{job_id}.name`), signed
            // when bound. One source of truth, shared by every client.
            let body = text
                .split("\r\n\r\n")
                .nth(1)
                .unwrap_or("{}");
            let auth = cellrix_web::client_bearer();
            match cellrix_web::post_json(
                &cfg.anaphase_endpoint,
                "/v1/sessions/rename",
                body,
                auth.as_deref(),
            ) {
                Ok(out) => respond(&mut stream, 200, "application/json", out.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"ok\":false,\"error\":\"{e}\"}}");
                    respond(&mut stream, 502, "application/json", msg.as_bytes())?;
                }
            }
        }
        Route::Events => {
            // One period's event stream (Engram turn timeline): pass the
            // browser's job_id= query through to Anaphase /v1/events.
            let q = text
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("/api/events");
            let query = q.split('?').nth(1).unwrap_or("");
            let target = if query.is_empty() {
                "/v1/events".to_string()
            } else {
                format!("/v1/events?{query}")
            };
            let auth = cellrix_web::client_bearer();
            match cellrix_web::fetch_json(&cfg.anaphase_endpoint, &target, auth.as_deref()) {
                Ok(body) => respond(&mut stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"configured\":false,\"missing\":true,\"events\":[],\"error\":\"{e}\"}}");
                    respond(&mut stream, 502, "application/json", msg.as_bytes())?;
                }
            }
        }
        Route::Ecosystem => {
            // Ecosystem status board: probe every component's port; the two
            // HTTP-capable services (anaphase, tuck) get an extra health
            // probe for the fine-grained green/yellow split. Ports are each
            // service's own protocol defaults (tentacle grpc-port 50051,
            // mind 50052, anaphase cap_http 50061, tuck 60052) — not
            // hardcoded guesses.
            use std::net::{SocketAddr, TcpStream};
            use std::time::Duration;
            let tcp_up = |port: u16| -> bool {
                TcpStream::connect_timeout(
                    &SocketAddr::from(([127, 0, 0, 1], port)),
                    Duration::from_millis(400),
                )
                .is_ok()
            };
            let http_state = |base: &str, path: &str, bearer: Option<&str>| -> &'static str {
                match cellrix_web::probe(base, path, bearer) {
                    Ok(()) => "ok",
                    Err(_) => "starting",
                }
            };
            let mut comps = vec![
                format!(
                    "{{\"name\":\"tentacle\",\"port\":50051,\"state\":{}}}",
                    if tcp_up(50051) { "\"ok\"" } else { "\"off\"" }
                ),
                format!(
                    "{{\"name\":\"mind\",\"port\":50052,\"state\":{}}}",
                    if tcp_up(50052) { "\"ok\"" } else { "\"off\"" }
                ),
            ];
            let a_state = if tcp_up(50061) {
                http_state(
                    &cfg.anaphase_endpoint,
                    "/v1/health",
                    cellrix_web::client_bearer().as_deref(),
                )
            } else {
                "off"
            };
            comps.push(format!("{{\"name\":\"anaphase\",\"port\":50061,\"state\":\"{a_state}\"}}"));
            let t_state = if tcp_up(60052) {
                // tuck_endpoint is optional in the panel config; fall back
                // to the gateway's own protocol default (60052).
                let base = cfg
                    .tuck_endpoint
                    .as_deref()
                    .unwrap_or("http://127.0.0.1:60052");
                http_state(base, "/v1/audit?limit=1", cfg.tuck_key.as_deref())
            } else {
                "off"
            };
            comps.push(format!("{{\"name\":\"tuck\",\"port\":60052,\"state\":\"{t_state}\"}}"));
            comps.push("{\"name\":\"panel\",\"port\":0,\"state\":\"ok\"}".to_string());
            let body = format!("{{\"components\":[{}]}}", comps.join(","));
            respond(&mut stream, 200, "application/json", body.as_bytes())?;
        }
        Route::Chat => {
            // Partner-mode dialogue: proxy the panel input box to Anaphase
            // /v1/chat (signed when bound). One single-period cycle per
            // request; the reply is the reasoning output (redacted already
            // on the Anaphase side).
            // Two transports, one contract: when the browser asks for SSE we
            // relay live bytes (typewriter chat, no read-timeout cliff); the
            // plain JSON path stays for curl / old clients.
            let body = text
                .split("\r\n\r\n")
                .nth(1)
                .unwrap_or("{\"message\":\"\"}");
            let auth = cellrix_web::client_bearer();
            let wants_sse = text.lines().any(|l| {
                l.to_ascii_lowercase().starts_with("accept:")
                    && l.to_ascii_lowercase().contains("text/event-stream")
            });
            if wants_sse {
                // Byte pipe: headers first (no Content-Length — the stream
                // length is unknown), then relay chunks as they arrive.
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                    )
                    .map_err(|e| e.to_string())?;
                let mut out = stream.try_clone().map_err(|e| e.to_string())?;
                match cellrix_web::post_stream(
                    &cfg.anaphase_endpoint,
                    "/v1/chat",
                    body,
                    auth.as_deref(),
                    &mut |chunk| out.write_all(chunk),
                ) {
                    Ok(()) => {}
                    Err(e) => {
                        // Stream aborted (origin closed or timeout): surface
                        // an error line so the browser never sees a silent
                        // hang. A closed browser socket is not an error we
                        // need to report — write failures are expected there.
                        let _ = out.write_all(
                            format!("data: {{\"error\":\"{e}\"}}\n\n").as_bytes(),
                        );
                    }
                }
                return Ok(());
            }
            match cellrix_web::post_json(
                &cfg.anaphase_endpoint,
                "/v1/chat",
                body,
                auth.as_deref(),
            ) {
                Ok(resp) => respond(&mut stream, 200, "application/json", resp.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"error\":\"{e}\"}}");
                    respond(&mut stream, 502, "application/json", msg.as_bytes())?;
                }
            }
        }
        Route::NotFound => {
            respond(&mut stream, 404, "text/plain", b"404 not found")?;
        }
    }
    Ok(())
}

/// Anaphase snapshot protocol path (ADR-0010 contract): the panel's
/// `--anaphase-endpoint` is the cap_http host:port; this path is fixed.
const SNAPSHOT_PATH: &str = "/v1/agent/snapshot";

/// Minimal HTTP/1.1 response with a status line, Content-Length and
/// Connection: close.
fn respond(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()?;
    Ok(())
}

/// Up-style self check: probe Anaphase's own `/v1/health` (the one source of
/// truth — the same endpoint Cellrix renders and Helix-Mind will read on
/// demand) and the Tuck audit chain. When something is down, say *what* is
/// unhealthy instead of leaving a dead panel.
pub fn health_check(cfg: &PanelConfig) {
    let auth = cellrix_web::client_bearer();
    match cellrix_web::fetch_json(&cfg.anaphase_endpoint, "/v1/health", auth.as_deref()) {
        Ok(body) if body.contains("\"ok\":true") => {
            println!("             anaphase: ✅ self-check ok")
        }
        Ok(body) => {
            let bad = cellrix_web::unhealthy_names(&body);
            println!(
                "             anaphase: ❌ self-check failed: {}",
                if bad.is_empty() {
                    "see /v1/health".to_string()
                } else {
                    bad.join(", ")
                }
            );
        }
        Err(e) => println!(
            "             anaphase: ❌ {e}\n               → start Anaphase first (README §Run: ANAPHASE_CONFIG + anaphase)"
        ),
    }
    if let Some(ep) = &cfg.tuck_endpoint {
        let key = cfg.tuck_key.as_deref().unwrap_or("");
        match cellrix_web::probe(ep, "/v1/audit?limit=1", Some(key)) {
            Ok(()) => println!("             tuck: ✅ audit chain reachable"),
            Err(e) => println!(
                "             tuck: ❌ {e}\n               → start the Tuck gateway first (README §Run)"
            ),
        }
    }
}
