//! Route handlers, one per endpoint.
//!
//! Split out of `server.rs` (2026-09-15): `handle()` was a 287-line `match`
//! that pushed the file past the 400-line decoupling limit. Moving the arms
//! into functions inside the same file would not have changed the line count —
//! the bodies had to leave. `handle` is now a dispatcher.
//!
//! Every handler takes the same three things: the stream to answer on, the
//! panel config, and the raw request text (only the write paths read a body).

use std::io::Write;
use std::net::TcpStream;

use crate::config::PanelConfig;
use crate::server::{respond, Route, SNAPSHOT_PATH};

/// `Index`.
pub fn route_index(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
            let body = crate::index_html(cfg);
            respond(stream, 200, "text/html; charset=utf-8", body.as_bytes())?;
    Ok(())
}

/// `Snapshot`.
pub fn route_snapshot(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
            let auth = cellrix_web::client_bearer();
            match cellrix_web::fetch_json(&cfg.anaphase_endpoint, SNAPSHOT_PATH, auth.as_deref()) {
                Ok(body) => respond(stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"status\":\"Error\",\"error\":\"{e}\"}}");
                    respond(stream, 502, "application/json", msg.as_bytes())?;
                }
            }
    Ok(())
}

/// `Audit`.
pub fn route_audit(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
            // Isomorphic with the TUI's TuckAuditFetcher: same query window,
            // same ProveTrackQuery JSON shape (entries/count/queried_by).
            match &cfg.tuck_endpoint {
                Some(ep) => {
                    let q = format!("/v1/audit?limit={}", cfg.tuck_limit);
                    match cellrix_web::fetch_json(ep, &q, cfg.tuck_key.as_deref()) {
                        Ok(body) => {
                            respond(stream, 200, "application/json", body.as_bytes())?
                        }
                        Err(e) => {
                            let msg = format!(
                                "{{\"configured\":true,\"count\":0,\"queried_by\":\"\",\"error\":\"{e}\"}}"
                            );
                            respond(stream, 502, "application/json", msg.as_bytes())?;
                        }
                    }
                }
                None => {
                    let msg =
                        "{\"configured\":false,\"count\":0,\"queried_by\":\"\",\"entries\":[]}";
                    respond(stream, 200, "application/json", msg.as_bytes())?;
                }
            }
    Ok(())
}

/// `Trace`.
pub fn route_trace(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
            // ProveTrack body half: proxy the Anaphase reasoning-trace query,
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
                Ok(body) => respond(stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"configured\":false,\"count\":0,\"entries\":[],\"error\":\"{e}\"}}");
                    respond(stream, 502, "application/json", msg.as_bytes())?;
                }
            }
    Ok(())
}

/// `Sessions`.
pub fn route_sessions(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
            // Session-management sidebar (ProveTrack v2): proxy the Anaphase
            // period list (one summary per cognitive period, newest first).
            let auth = cellrix_web::client_bearer();
            let target = "/v1/sessions?limit=50";
            match cellrix_web::fetch_json(&cfg.anaphase_endpoint, target, auth.as_deref()) {
                Ok(body) => respond(stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"configured\":false,\"periods\":[],\"error\":\"{e}\"}}");
                    respond(stream, 502, "application/json", msg.as_bytes())?;
                }
            }
    Ok(())
}

/// `SessionsRename`.
pub fn route_sessions_rename(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
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
                Ok(out) => respond(stream, 200, "application/json", out.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"ok\":false,\"error\":\"{e}\"}}");
                    respond(stream, 502, "application/json", msg.as_bytes())?;
                }
            }
    Ok(())
}

/// `Events`.
pub fn route_events(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
            // One period's event stream (ProveTrack turn timeline): pass the
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
                Ok(body) => respond(stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"configured\":false,\"missing\":true,\"events\":[],\"error\":\"{e}\"}}");
                    respond(stream, 502, "application/json", msg.as_bytes())?;
                }
            }
    Ok(())
}

/// `Flows`.
pub fn route_flows(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
            // 检定台数据面板：FlowModus 供应商池/路由 + Tuck 审计统计。
            // 任一未配置/失败 → null（前端零态自证，按需加载）。
            let fm = match &cfg.flowmodus_url {
                Some(ep) => cellrix_web::fetch_json(ep, "/api/status", None).ok(),
                None => None,
            };
            let stats = match &cfg.tuck_endpoint {
                Some(ep) => cellrix_web::fetch_json(ep, "/v1/stats", cfg.tuck_key.as_deref()).ok(),
                None => None,
            };
            let body = format!(
                "{{\"flows\":{},\"stats\":{}}}",
                fm.unwrap_or_else(|| "null".into()),
                stats.unwrap_or_else(|| "null".into())
            );
            respond(stream, 200, "application/json", body.as_bytes())?;
    Ok(())
}

/// `Ecosystem`.
pub fn route_ecosystem(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
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
            // FlowModus was absent from this strip entirely, so the panel could
            // not even show that the router existed (its Flows view read a URL
            // nothing had wired). Port is its own protocol default, like the
            // others here — not a guess.
            let f_state = if tcp_up(60053) {
                let base = cfg
                    .flowmodus_url
                    .as_deref()
                    .unwrap_or("http://127.0.0.1:60053");
                http_state(base, "/api/status", None)
            } else {
                "off"
            };
            comps.push(format!("{{\"name\":\"flowmodus\",\"port\":60053,\"state\":\"{f_state}\"}}"));
            comps.push("{\"name\":\"panel\",\"port\":0,\"state\":\"ok\"}".to_string());
            let body = format!("{{\"components\":[{}]}}", comps.join(","));
            respond(stream, 200, "application/json", body.as_bytes())?;
    Ok(())
}

/// `Chat`.
pub fn route_chat(
    stream: &mut TcpStream,
    cfg: &PanelConfig,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
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
                Ok(resp) => respond(stream, 200, "application/json", resp.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"error\":\"{e}\"}}");
                    respond(stream, 502, "application/json", msg.as_bytes())?;
                }
            }
    Ok(())
}
