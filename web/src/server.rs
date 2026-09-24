//! HTTP serving layer: route → proxy the truth sources (Anaphase / Tuck),
//! one std-only listener. The browser is never given credentials — Bearer
//! injection happens here (proxy pattern, ADR-0010/0014).
//!
//! Two projections of one truth: the **Cockpit** view (Anaphase
//! `/v1/agent/snapshot`, ADR-0010) and the **ProveTrack** imprint view (Tuck
//! `/v1/audit` chain). The browser renders the *same data model* the TUI
//! shows, so the silicon and carbon sides read the same picture with no
//! ambiguity (TUI=Web isomorphic projection).

use std::io::{Read, Write};
use std::net::TcpStream;

use crate::config::PanelConfig;
use crate::routes::{
    route_audit, route_chat, route_ecosystem, route_events, route_flows, route_flows_suppliers,
    route_index, route_sessions, route_sessions_rename, route_snapshot, route_trace,
};

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
    Flows,
    FlowsSuppliers,
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
        "/api/flows" => Route::Flows,
        "/api/flowmodus/suppliers" | "/api/flowmodus/suppliers/probe" => Route::FlowsSuppliers,
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
        Route::Index => route_index(&mut stream, cfg, &text)?,
        Route::Snapshot => route_snapshot(&mut stream, cfg, &text)?,
        Route::Audit => route_audit(&mut stream, cfg, &text)?,
        Route::Trace => route_trace(&mut stream, cfg, &text)?,
        Route::Sessions => route_sessions(&mut stream, cfg, &text)?,
        Route::SessionsRename => route_sessions_rename(&mut stream, cfg, &text)?,
        Route::Events => route_events(&mut stream, cfg, &text)?,
        Route::Flows => route_flows(&mut stream, cfg, &text)?,
        Route::FlowsSuppliers => route_flows_suppliers(&mut stream, cfg, &text)?,
        Route::Ecosystem => route_ecosystem(&mut stream, cfg, &text)?,
        Route::Chat => route_chat(&mut stream, cfg, &text)?,
        Route::NotFound => {
            respond(&mut stream, 404, "text/plain; charset=utf-8", b"not found")?;
        }
    }
    Ok(())
}

/// Anaphase snapshot protocol path (ADR-0010 contract): the panel's
/// `--anaphase-endpoint` is the cap_http host:port; this path is fixed.
pub const SNAPSHOT_PATH: &str = "/v1/agent/snapshot";

/// Minimal HTTP/1.1 response with a status line, Content-Length and
/// Connection: close.
pub(crate) fn respond(
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
