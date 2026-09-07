//! `cellrix-web` — Anaphase cockpit + Engram web panel (candidate G2, ADR-0014).
//!
//! Two projections of one truth: the **Cockpit** view (Anaphase
//! `/v1/agent/snapshot`, ADR-0010) and the **Engram** imprint view (Tuck
//! `/v1/audit` chain). The browser renders the *same data model* the TUI
//! shows — `EngramEntry { seq, ts, payload{kind,trace_id,data}, prev_hash,
//! hash }` — so the silicon and carbon sides read the same picture with no
//! ambiguity (TUI=Web isomorphic projection).
//!
//! Zero new dependencies: std-only HTTP server, one embedded HTML page,
//! native JS polling. The audit chain is proxied (Bearer injected here, the
//! identity credential never reaches the browser).
//!
//! Usage:
//!   cellrix-web                                  # cockpit only, :8080
//!   cellrix-web --tuck-endpoint http://127.0.0.1:60052 --tuck-key tk-local-gate
//!   WEB_PORT=9090 TUCK_ENDPOINT=... TUCK_KEY=... cellrix-web
//!
//! Zero-hardcoding: anaphase/tuck endpoint defaults are the documented
//! protocol defaults (ADR-0010 / Tuck gateway); `--tuck-limit` default 200
//! matches the CLI contract; unset tuck -> Engram shows a setup hint.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use cellrix_web::{fetch_json, probe, unhealthy_names};

/// Web panel listening port when no `--port`/`WEB_PORT` is given (this
/// panel's documented protocol default; unassigned common HTTP port).
const WEB_PORT_DEFAULT: u16 = 8080;
/// Anaphase snapshot endpoint when no `--anaphase-endpoint` is given
/// (ADR-0010: Anaphase cap_http protocol default, `config.toml cap_http_port`).
const ANAPHASE_ENDPOINT_DEFAULT: &str = "http://127.0.0.1:50061";
/// Engram poll window: newest N chain entries per fetch (CLI contract
/// default — `cellrix-cli --tuck-limit`, default 200).
const TUCK_LIMIT_DEFAULT: usize = 200;
/// Browser refresh cadence (snapshot polling interval, seconds).
const REFRESH_SECS: u64 = 2;

/// Request routing: path + optional query string, then match.
/// Pure function — parse only what we serve, reject the rest.
fn route(path: &str) -> Route {
    let path = path.split('?').next().unwrap_or("/");
    match path.trim_matches('/') {
        "" => Route::Index,
        "api/snapshot" => Route::Snapshot,
        "api/audit" => Route::Audit,
        "api/trace" => Route::Trace,
        "api/sessions" => Route::Sessions,
        "api/sessions/rename" => Route::SessionsRename,
        "api/events" => Route::Events,
        "api/ecosystem" => Route::Ecosystem,
        "api/chat" => Route::Chat,
        _ => Route::NotFound,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Route {
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

/// Panel wiring: where the two data sources live and how the audit is
/// authenticated. Derives from flags > env > protocol defaults.
#[derive(Debug, Clone)]
struct PanelConfig {
    anaphase_endpoint: String,
    tuck_endpoint: Option<String>,
    tuck_key: Option<String>,
    tuck_limit: usize,
}

impl PanelConfig {
    /// Derive from argv (flags win), then env, then protocol defaults.
    fn derive(args: &[String]) -> Self {
        let flag = |name: &str| {
            args.windows(2)
                .find(|w| w[0] == name)
                .map(|w| w[1].clone())
                .filter(|v| !v.is_empty())
        };
        let env = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());

        let anaphase_endpoint = flag("--anaphase-endpoint")
            .or_else(|| env("ANAPHASE_ENDPOINT"))
            .unwrap_or_else(|| ANAPHASE_ENDPOINT_DEFAULT.to_string());

        let tuck_endpoint = flag("--tuck-endpoint").or_else(|| env("TUCK_ENDPOINT"));
        let tuck_key = flag("--tuck-key").or_else(|| env("TUCK_KEY"));
        let tuck_limit = flag("--tuck-limit")
            .and_then(|v| v.parse::<usize>().ok())
            .or_else(|| env("TUCK_LIMIT").and_then(|v| v.parse().ok()))
            .unwrap_or(TUCK_LIMIT_DEFAULT);

        Self {
            anaphase_endpoint,
            tuck_endpoint,
            tuck_key,
            tuck_limit,
        }
    }
}

/// True when a Cellrix panel is already answering on `port` (probe the
/// index page — our HTML carries the `view-chat` marker). Anything else on
/// the port (foreign service) reads as false and stays an honest error.
fn panel_already_up(port: &u16) -> bool {
    let base = format!("http://127.0.0.1:{port}");
    match cellrix_web::fetch_json(&base, "/", None) {
        Ok(body) => body.contains("view-chat"),
        Err(_) => false,
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let cfg = PanelConfig::derive(&args);

    let port = args
        .windows(2)
        .find(|w| w[0] == "--port")
        .and_then(|w| w[1].parse::<u16>().ok())
        .or_else(|| std::env::var("WEB_PORT").ok().and_then(|v| v.parse().ok()))
        .unwrap_or(WEB_PORT_DEFAULT);

    println!("cellrix-web: cockpit+engram panel on http://127.0.0.1:{port}");
    println!("             anaphase snapshot @ {}", cfg.anaphase_endpoint);
    match &cfg.tuck_endpoint {
        Some(ep) => println!("             engram chain @ {ep} (limit {})", cfg.tuck_limit),
        None => println!("             engram: off (pass --tuck-endpoint + --tuck-key to enable)"),
    }
    health_check(&cfg);

    // Idempotent start (2026-09-07): re-running `up` is the normal daily
    // path for a beginner — if the panel is already serving on this port,
    // do not stack a second listener (AddrInUse); open the browser and go.
    if panel_already_up(&port) {
        println!("  面板已在运行：http://127.0.0.1:{port}/（无需重复启动）");
        if args.iter().any(|a| a == "--open") {
            let url = format!("http://127.0.0.1:{port}/");
            std::process::Command::new("open").arg(&url).spawn()?;
        }
        return Ok(());
    }
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(l) => l,
        Err(e) => {
            // Race fallback: someone took the port between probe and bind.
            if panel_already_up(&port) {
                println!("  面板已在运行：http://127.0.0.1:{port}/（无需重复启动）");
                if args.iter().any(|a| a == "--open") {
                    let url = format!("http://127.0.0.1:{port}/");
                    std::process::Command::new("open").arg(&url).spawn()?;
                }
                return Ok(());
            }
            return Err(e.into());
        }
    };
    if args.iter().any(|a| a == "--open") {
        let url = format!("http://127.0.0.1:{port}/");
        println!("             opening browser: {url}");
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open").arg(&url).spawn()?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = url;
        }
    }
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let cfg = cfg.clone();
                // One thread per connection: the panel is a local tool with
                // a handful of browsers; simplicity beats connection pooling.
                thread::spawn(move || {
                    if let Err(e) = handle(s, &cfg) {
                        eprintln!("cellrix-web: {e}");
                    }
                });
            }
            Err(e) => eprintln!("cellrix-web: accept error: {e}"),
        }
    }
    Ok(())
}

/// Serve one connection: parse the request line, route, respond.
fn handle(mut stream: TcpStream, cfg: &PanelConfig) -> Result<(), Box<dyn std::error::Error>> {
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
            let body = index_html(cfg);
            respond(&mut stream, 200, "text/html; charset=utf-8", body.as_bytes())?;
        }
        Route::Snapshot => {
            let auth = cellrix_web::client_bearer();
            match fetch_json(&cfg.anaphase_endpoint, SNAPSHOT_PATH, auth.as_deref()) {
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
                    match fetch_json(ep, &q, cfg.tuck_key.as_deref()) {
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
            match fetch_json(&cfg.anaphase_endpoint, &target, auth.as_deref()) {
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
            match fetch_json(&cfg.anaphase_endpoint, target, auth.as_deref()) {
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
            match cellrix_web::post_json(&cfg.anaphase_endpoint, "/v1/sessions/rename", body, auth.as_deref()) {
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
            match fetch_json(&cfg.anaphase_endpoint, &target, auth.as_deref()) {
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
                http_state(&cfg.anaphase_endpoint, "/v1/health", cellrix_web::client_bearer().as_deref())
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
            let wants_sse = text
                .lines()
                .any(|l| l.to_ascii_lowercase().starts_with("accept:") && l.to_ascii_lowercase().contains("text/event-stream"));
            if wants_sse {
                // Byte pipe: headers first (no Content-Length — the stream
                // length is unknown), then relay chunks as they arrive.
                use std::io::Write;
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
            match cellrix_web::post_json(&cfg.anaphase_endpoint, "/v1/chat", body, auth.as_deref())
            {
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
fn health_check(cfg: &PanelConfig) {
    let auth = cellrix_web::client_bearer();
    match fetch_json(&cfg.anaphase_endpoint, "/v1/health", auth.as_deref()) {
        Ok(body) if body.contains("\"ok\":true") => {
            println!("             anaphase: ✅ self-check ok")
        }
        Ok(body) => {
            let bad = unhealthy_names(&body);
            println!(
                "             anaphase: ❌ self-check failed: {}",
                if bad.is_empty() { "see /v1/health".to_string() } else { bad.join(", ") }
            );
        }
        Err(e) => println!(
            "             anaphase: ❌ {e}\n               → start Anaphase first (README §Run: ANAPHASE_CONFIG + anaphase)"
        ),
    }
    if let Some(ep) = &cfg.tuck_endpoint {
        let key = cfg.tuck_key.as_deref().unwrap_or("");
        match probe(ep, "/v1/audit?limit=1", Some(key)) {
            Ok(()) => println!("             tuck: ✅ audit chain reachable"),
            Err(e) => println!(
                "             tuck: ❌ {e}\n               → start the Tuck gateway first (README §Run)"
            ),
        }
    }
}

/// The embedded panel page: native JS polls `/api/snapshot` + `/api/audit`
/// and renders the two projections of the same truth the TUI shows.
/// No frameworks, no build step. View switch mirrors the TUI's Ctrl+E.
fn index_html(cfg: &PanelConfig) -> String {
    let tuck_configured = cfg.tuck_endpoint.is_some();
    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cellrix — Cockpit + Engram</title>
<style>
  :root {{ --bg:#16161a; --panel:#1e1e24; --line:#2c2c34; --text:#e8e8ec; --dim:#9a9aa4; --ok:#4ec9a0; --bad:#e06c75; --acc:#9eacEA; --warn:#e5c07b; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ background:var(--bg); color:var(--text); font-family:'SF Mono','Menlo','PingFang SC',monospace; padding:20px; }}
  h1 {{ font-size:16px; font-weight:600; color:var(--acc); margin-bottom:4px; }}
  .sub {{ color:var(--dim); font-size:12px; margin-bottom:14px; }}
  .bar {{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }}
  .chat-msgs {{ max-height:340px; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }}
  .msg {{ max-width:85%; padding:8px 12px; border-radius:12px; font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }}
  .msg.user {{ align-self:flex-end; background:rgba(158,172,234,.16); border:1px solid var(--acc); }}
  .msg.helix {{ align-self:flex-start; background:var(--panel); border:1px solid var(--line); color:var(--text); }}
  .msg .who {{ display:block; font-size:10px; color:var(--dim); margin-bottom:3px; }}
  .msg.err {{ border-color:var(--bad); color:var(--bad); }}
  .chat-input {{ position:relative; display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--line); }}
  .chat-input input {{ flex:1; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; font-family:inherit; outline:none; }}
  .chat-input input:focus {{ border-color:var(--acc); }}
  .toast {{ position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:50;
            background:#2a1f24; border:1px solid var(--bad); color:#ffb4b6;
            padding:8px 16px; border-radius:10px; font-size:12px; max-width:70%;
            box-shadow:0 4px 18px rgba(0,0,0,.35); }}
  .msg .ts {{ float:right; margin-left:10px; font-size:10px; color:var(--dim); opacity:.75; }}
  .btn {{ background:var(--panel); color:var(--dim); border:1px solid var(--line); border-radius:8px; padding:6px 14px; font-size:12px; font-family:inherit; cursor:pointer; }}
  .btn.on {{ color:var(--acc); border-color:var(--acc); background:rgba(158,172,234,.12); }}
  .badge {{ padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; border:1px solid var(--line); }}
  .badge.partner {{ background:rgba(158,172,234,.15); color:var(--acc); border-color:var(--acc); }}
  .badge.drive {{ background:rgba(156,204,169,.12); color:var(--ok); border-color:var(--ok); }}
  .badge.survive {{ background:rgba(224,108,117,.12); color:var(--bad); border-color:var(--bad); }}
  .badge.live {{ color:var(--ok); }}
  .cards {{ display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; }}
  .card {{ flex:1 1 200px; min-width:0; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px; }}
  .card .k {{ font-size:11px; color:var(--dim); margin-bottom:6px; }}
  .card .v {{ font-size:20px; font-weight:600; }}
  .card .v.small {{ font-size:13px; }}
  .panel {{ background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }}
  .panel .head {{ padding:10px 12px; font-size:12px; color:var(--dim); border-bottom:1px solid var(--line); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }}
  .ledger .entry {{ padding:10px 12px; border-bottom:1px solid var(--line); font-size:12px; display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }}
  .ledger .entry:last-child {{ border-bottom:none; }}
  .entry .st {{ font-weight:700; padding:1px 8px; border-radius:6px; font-size:11px; }}
  .st.MET {{ color:var(--ok); background:rgba(78,201,160,.12); }}
  .st.UNMET {{ color:var(--bad); background:rgba(224,108,117,.12); }}
  .st.BLOCKED {{ color:var(--bad); background:rgba(224,108,117,.12); }}
  /* Engram: proportional 2D grid — overview strip / timeline 2fr + detail 1fr */
  .engram-overview {{ display:flex; gap:10px; flex-wrap:wrap; padding:10px 12px; font-size:12px; color:var(--dim); border-bottom:1px solid var(--line); align-items:center; }}
  .engram-overview .k {{ color:var(--dim); }}
  .engram-overview .v {{ color:var(--text); font-weight:600; }}
  .engram-filter {{ margin-left:auto; display:flex; gap:6px; }}
  .engram-filter input {{ background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:4px 8px; font-size:12px; font-family:inherit; width:180px; }}
  .engram-main {{ display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:16px; }}
  .timeline {{ max-height:420px; overflow-y:auto; }}
  .row {{ padding:8px 12px; border-bottom:1px solid var(--line); font-size:12px; cursor:pointer; display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }}
  .row:hover {{ background:rgba(158,172,234,.06); }}
  .row.sel {{ background:rgba(158,172,234,.14); border-left:3px solid var(--acc); }}
  .redact {{ color:#EA6668; background:rgba(234,102,104,.09); border-radius:3px; padding:0 3px; font-weight:600; white-space:nowrap; }}
  .row .seq {{ color:var(--dim); }}
  .row .kind {{ color:var(--acc); font-weight:600; }}
  .row .tid {{ color:var(--dim); }}
  .row .ok {{ color:var(--ok); }} .row .bad {{ color:var(--bad); }}
  .grp-head {{ padding:7px 12px; font-size:12px; cursor:pointer; background:rgba(158,172,234,.05); border-bottom:1px solid var(--line); display:flex; gap:8px; align-items:baseline; user-select:none; }}
  .grp-head:hover {{ background:rgba(158,172,234,.10); }}
  .ses-side {{ border-right:1px solid var(--line); padding-right:12px; max-height:480px; overflow-y:auto; }}
  .ses-item {{ padding:8px 10px; border:1px solid var(--line); border-radius:8px; margin-bottom:8px; cursor:pointer; font-size:12px; }}
  .ses-item:hover {{ border-color:var(--acc); }}
  .ses-item.sel {{ border-color:var(--acc); background:rgba(158,172,234,.08); }}
  .ses-item .t {{ color:var(--dim); font-size:11px; }}
  .ses-item .p {{ margin-top:3px; color:var(--text); word-break:break-all; }}
  .ses-stats {{ display:flex; gap:16px; padding:8px 12px; border-bottom:1px solid var(--line); font-size:12px; flex-wrap:wrap; }}
  .ses-stats span {{ color:var(--dim); }}
  .ses-stats b {{ color:var(--text); font-weight:600; }}
  .ev-row {{ padding:7px 12px; border-bottom:1px solid var(--line); font-size:12px; display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }}
  .badge {{ font-size:10px; font-weight:700; padding:2px 7px; border-radius:4px; letter-spacing:.5px; }}
  .badge.turn-start {{ background:rgba(154,154,164,.18); color:#c8c8d0; }}
  .badge.user-message {{ background:rgba(158,172,234,.18); color:#9eacEA; }}
  .badge.context-inject {{ background:rgba(197,167,232,.18); color:#c5a7e8; }}
  .badge.assistant-attempt {{ background:rgba(78,201,160,.16); color:#4ec9a0; }}
  .badge.tool-call {{ background:rgba(229,192,123,.18); color:#e5c07b; }}
  .badge.tool-result {{ background:rgba(224,108,117,.16); color:#e06c75; }}
  .badge.verdict-status {{ background:rgba(224,108,117,.22); color:#e06c75; }}
  .badge.turn-end {{ background:rgba(154,154,164,.12); color:#9a9aa4; }}
  .ev-row .body {{ color:var(--text); word-break:break-all; }}
  .ev-row .ok {{ color:var(--ok); }} .ev-row .bad {{ color:var(--bad); }}
  .btn.ghost {{ border:1px solid var(--line); background:transparent; color:var(--dim); }}
  .btn.ghost:hover {{ border-color:var(--acc); color:var(--acc); }}
  .rename-btn {{ margin-left:8px; font-size:11px; padding:0 5px; border-radius:5px; border:1px solid var(--line); background:transparent; color:var(--dim); cursor:pointer; }}
  .rename-btn:hover {{ border-color:var(--acc); color:var(--acc); }}
  .sa-core {{ color:var(--acc); font-weight:600; }}
  .chip {{ display:inline-block; font-size:10px; padding:1px 7px; border-radius:999px; border:1px solid var(--line); margin-right:4px; vertical-align:1px; }}
  .chip.tier-L0 {{ background:rgba(154,154,164,.18); color:#c8c8d0; border-color:rgba(154,154,164,.45); }}
  .chip.tier-L1 {{ background:rgba(158,172,234,.15); color:#9eacea; border-color:rgba(158,172,234,.45); }}
  .chip.tier-L2 {{ background:rgba(229,192,123,.15); color:#e5c07b; border-color:rgba(229,192,123,.45); }}
  .chip.tier-L3 {{ background:rgba(78,201,160,.15); color:#4ec9a0; border-color:rgba(78,201,160,.45); }}
  .chip.mnode {{ background:rgba(78,201,160,.1); color:#4ec9a0; border-color:rgba(78,201,160,.3); }}
  .chip.none {{ background:transparent; color:var(--dim); }}
  .think-row {{ padding:6px 12px; font-size:11px; color:var(--dim); cursor:pointer; display:flex; gap:8px; align-items:baseline; border-bottom:1px solid var(--line); }}
  .think-row .think-head {{ color:var(--acc); font-weight:600; flex-shrink:0; }}
  .think-row .think-body {{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:88%; }}
  .think-row.open .think-body {{ white-space:pre-wrap; word-break:break-all; max-height:200px; overflow:auto; }}
  .fold {{ display:inline-block; vertical-align:middle; cursor:pointer; }}
  .fold .fold-head {{ color:var(--acc); font-weight:600; }}
  .fold .fold-tip {{ color:var(--dim); }}
  .fold.open .fold-tip {{ transform:rotate(90deg); display:inline-block; }}
  .fold .fold-body {{ display:none; }}
  .fold.open .fold-body {{ display:inline; }}
  .fold .think-full {{ display:inline; white-space:pre-wrap; word-break:break-all; max-height:160px; overflow:auto; font-size:11px; color:var(--text); }}
  .chip.gate.hard {{ background:rgba(234,102,104,.12); color:#b34146; }}
  .chip.gate.soft {{ background:rgba(250,173,20,.15); color:#9a6b00; }}
  .chip.judge {{ background:rgba(158,172,234,.15); color:#3d4a8f; }}
  .sha {{ font-family:monospace; font-size:10px; color:var(--dim); }}
  .period-head {{ padding:6px 12px; font-size:11px; color:var(--dim); border-bottom:1px solid var(--line); }}
  .resume-list {{ position:absolute; right:12px; bottom:54px; width:280px; background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,.3); z-index:10; max-height:260px; overflow:auto; }}
  .resume-opt {{ padding:8px 10px; font-size:12px; cursor:pointer; border-bottom:1px solid var(--line); color:var(--text); word-break:break-all; }}
  .resume-opt:hover {{ background:rgba(158,172,234,.12); }}
  .mnode {{ color:var(--acc); }}
  .cont-banner {{ padding:6px 12px; font-size:11px; color:var(--acc); border-bottom:1px solid var(--line); background:rgba(158,172,234,.07); }}
  .grp-head .arrow {{ color:var(--acc); width:12px; display:inline-block; }}
  .grp-head .tid {{ color:var(--acc); font-weight:600; }}
  .grp-body .row {{ padding-left:22px; }}
  .detail {{ padding:12px; font-size:12px; }}
  .detail .line {{ margin-bottom:6px; display:flex; gap:8px; flex-wrap:wrap; }}
  .detail .key {{ color:var(--dim); min-width:90px; }}
  .detail .val {{ color:var(--text); word-break:break-all; }}
  .detail pre {{ margin-top:8px; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; font-size:11px; overflow-x:auto; max-height:260px; color:var(--text); white-space:pre-wrap; word-break:break-all; }}
  .dim {{ color:var(--dim); }}
  .empty {{ padding:14px 12px; font-size:12px; color:var(--dim); }}
  .eco {{ display:flex; gap:18px; flex-wrap:wrap; font-size:12px; color:var(--dim); padding:8px 0 4px; }}
  .eco .c {{ display:inline-flex; align-items:center; gap:6px; }}
  .eco .dot {{ width:9px; height:9px; border-radius:50%; display:inline-block; }}
  .eco .dot.ok {{ background:var(--ok); box-shadow:0 0 6px rgba(78,201,160,.55); }}
  .eco .dot.off {{ background:#444; }}
  .eco .dot.starting {{ background:var(--warn); }}
  .eco .dot.error {{ background:var(--bad); }}
  .foot {{ color:var(--dim); font-size:11px; margin-top:14px; }}
  @media (max-width:800px) {{ .engram-main {{ grid-template-columns:1fr; }} .timeline {{ max-height:300px; }} }}
</style>
</head>
<body>
  <h1>Cellrix — 驾驶舱 · 印痕</h1>
  <div class="sub" id="sub">连接中…</div>
  <div class="bar">
    <button class="btn on" id="v-cockpit" onclick="showView('cockpit')">驾驶舱 Cockpit</button>
    <button class="btn" id="v-engram" onclick="showView('engram')">印痕 Engram</button>
    <button class="btn" id="v-chat" onclick="showView('chat')">对话 Chat</button>
    <span class="badge" id="mode">…</span>
    <span class="badge" id="state">…</span>
    <span class="badge" id="conn">…</span>
  </div>
  <div class="eco" id="eco">生态点亮探测中…</div>

  <div id="view-cockpit">
    <div class="cards">
      <div class="card"><div class="k">经历 episode</div><div class="v small" id="episode">…</div></div>
      <div class="card"><div class="k">Ledger 记录</div><div class="v" id="nledger">…</div></div>
      <div class="card"><div class="k">刷新</div><div class="v small" id="tick">…</div></div>
    </div>
    <div class="panel ledger">
      <div class="head">Ledger 白盒（append-only，可逐条审查）</div>
      <div id="entries"><div class="empty">等待数据…</div></div>
    </div>
  </div>

  <div id="view-engram" style="display:none;">
    <div class="panel">
      <div class="head">印痕 Engram — 经历时间线（会话 = 经历 · 一轮 = 一段认知周期 · 判据与行动同线）</div>
      <div class="engram-main" style="grid-template-columns:280px 1fr;">
        <div class="ses-side" id="s-side"><div class="empty">经历列表加载中…</div></div>
        <div id="s-main"><div class="empty">左侧选择一段经历，查看完整 turn 时间线</div></div>
      </div>
    </div>
  </div>

  <div id="view-chat" style="display:none;">
    <div class="panel">
      <div class="head">对话（伙伴模式 · 单周期一轮 · 走 Tuck 网关审计）</div>
      <div style="display:grid;grid-template-columns:240px 1fr;gap:12px;">
        <div class="ses-side" id="chat-side"><div class="empty">经历列表加载中…</div></div>
        <div>
      <div id="cont-banner" class="cont-banner" style="display:none;"></div>
      <div id="chat-msgs" class="chat-msgs"><div class="empty">说点什么吧——这是给 Helix 的一段新经历。</div></div>
      <div class="chat-input">
        <input id="chat-text" type="text" placeholder="输入消息，回车发送（Enter 发送 / Esc 清除）" autocomplete="off">
        <button class="btn" onclick="sendChat()">发送</button>
        <button class="btn ghost" onclick="toggleResume()" title="续接某段经历继续对话">续接</button>
        <div id="resume-list" class="resume-list" style="display:none;"></div>
      </div>
        </div>
      </div>
    </div>
  </div>

  <div class="foot">数据源: Anaphase /v1/agent/snapshot（ADR-0010）· Tuck /v1/audit 链 · 自动刷新 {refresh}s · 视图切换同 TUI Ctrl+E · <a href="/api/snapshot" style="color:var(--acc);">snapshot JSON</a> · <a href="/api/audit" style="color:var(--acc);">audit JSON</a></div>
<script>
(function () {{
  var refresh = {refresh};
  var tuckConfigured = {tuck_configured};
  var entries = [];
  var selected = null;
  document.addEventListener('keydown', function (e) {{
    if (e.target && e.target.id === 'chat-text' && e.key === 'Enter') {{ sendChat(); }}
    if (e.target && e.target.id === 'chat-text' && e.key === 'Escape') {{ document.getElementById('chat-text').value = ''; }}
  }});

  function esc(s) {{ return String(s).replace(/[&<>"']/g, function (c) {{ return {{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]; }}); }}
  function showView(v) {{
    document.getElementById('view-cockpit').style.display = v==='cockpit' ? '' : 'none';
    document.getElementById('view-engram').style.display = v==='engram' ? '' : 'none';
    document.getElementById('view-chat').style.display = v==='chat' ? '' : 'none';
    document.getElementById('v-cockpit').className = 'btn' + (v==='cockpit' ? ' on' : '');
    document.getElementById('v-engram').className = 'btn' + (v==='engram' ? ' on' : '');
    document.getElementById('v-chat').className = 'btn' + (v==='chat' ? ' on' : '');
    if (v==='chat') document.getElementById('chat-text').focus();
    if (v==='engram' || v==='chat') loadSessions();
  }}

  // === Engram v2 (ADR-0026): session event timeline ===
  // One cognitive period = one `run-xxx` event stream, keyed by the same
  // derived job id as the body trace and the Tuck audit chain. The sidebar
  // lists periods (newest first); selecting one loads its turn timeline —
  // badges from the event vocabulary, no second data source.
  var EV_BADGE = {{ 'turn/start':'START','user/message':'USER','context/inject':'CONTEXT','assistant/attempt':'ATTEMPT','assistant/think':'THINK','tool/call':'TOOL','tool/result':'RESULT','check/status':'CHECK','verdict/status':'VERDICT','turn/end':'END' }};
  var selectedPeriod = null;
  // Explicit continuation (ADR-0026): while set, the next chat request
  // resumes this experience (`job_id`) instead of opening a fresh stranger.
  var chatJobId = null;
  var CHAT_META = {{ 'turn-start':'#9a9aa4','user-message':'#9eacea','context-inject':'#c5a7e8','assistant-attempt':'#4ec9a0','tool-call':'#e5c07b','tool-result':'#e06c75','verdict-status':'#e06c75','turn-end':'#9a9aa4' }};

  function loadSessions() {{
    fetch('/api/sessions').then(function (r) {{ return r.json(); }}).then(function (j) {{
      var periods = j.periods || [];
      var empty = '<div class="empty">' + (j.configured ? '尚无经历（先和 Helix 说句话）' : '未开启会话事件流（Anaphase config `session_events_path`）') + '</div>';
      renderSide('s-side', periods, empty);
      renderSide('chat-side', periods, empty);
    }}).catch(function (e) {{
      document.getElementById('s-side').innerHTML = '<div class="empty">经历列表拉取失败: ' + esc(e.message) + '</div>';
    }});
  }}

  function renderSide(id, periods, empty) {{
    var box = document.getElementById(id);
    if (!periods.length) {{ box.innerHTML = empty; return; }}
    box.innerHTML = '';
    periods.forEach(function (p) {{
      var div = document.createElement('div');
      div.className = 'ses-item' + (selectedPeriod === p.job_id ? ' sel' : '');
      var title = p.name || p.preview || '(无用户输入)';
      div.innerHTML = '<div class="t">' + esc(p.first_ts.slice(5,19)) + ' · ' + p.count + ' 事件 · <span class="tid">' + esc(p.job_id) + '</span>' +
        '<button class="rename-btn" title="重命名">✎</button></div><div class="p">' + esc(title) + '</div>';
      div.onclick = function () {{
        selectedPeriod = p.job_id;
        showView('engram');
        selectPeriod(p.job_id);
      }};
      var rn = div.querySelector('.rename-btn');
      if (rn) rn.onclick = function (ev) {{
        ev.stopPropagation();
        var cur = p.name || '';
        var name = window.prompt('重命名这段经历（留空恢复自动名）', cur);
        if (name === null) return;
        fetch('/api/sessions/rename', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ job_id: p.job_id, name: name }})
        }}).then(function (r) {{ return r.json(); }}).then(function () {{
          loadSessions();
        }});
      }};
      box.appendChild(div);
    }});
  }}

  function selectPeriod(jobId) {{
    var main = document.getElementById('s-main');
    main.innerHTML = '<div class="empty">加载 ' + esc(jobId) + '…</div>';
    fetch('/api/events?job_id=' + encodeURIComponent(jobId)).then(function (r) {{ return r.json(); }}).then(function (j) {{
      if (j.missing || !j.events || !j.events.length) {{
        main.innerHTML = '<div class="empty">该轮无事件流（' + esc(jobId) + '）——见底部 audit JSON 链</div>';
        return;
      }}
      renderTimeline(main, j.events, jobId);
    }}).catch(function (e) {{
      main.innerHTML = '<div class="empty">加载失败: ' + esc(e.message) + '</div>';
    }});
  }}

  function renderTimeline(main, events, jobId) {{
    var dur = durMs(events[0].time, events[events.length-1].time);
    var tools = events.filter(function (e) {{ return e.type === 'tool/call'; }}).length;
    var verdicts = events.filter(function (e) {{ return e.type === 'verdict/status'; }}).map(function (e) {{ return e.data.status; }});
    var html = '<div class="ses-stats">' +
      '<span>Duration <b>' + (dur >= 0 ? dur + 'ms' : '—') + '</b></span>' +
      '<span>Events <b>' + events.length + '</b></span>' +
      '<span>Tools <b>' + tools + '</b></span>' +
      (verdicts.length ? '<span>Verdict <b class="' + (verdicts[0] === 'Met' ? 'ok' : 'bad') + '">' + esc(verdicts.join(',')) + '</b></span>' : '') +
      '<span class="tid">' + esc(jobId) + '</span></div>';
    // DSH-style trace is a turn outline, not a time axis: the event rows
    // below are the rail (compact, badge + timestamp + summary). The
    // gantt experiment was dropped — a time axis added noise without
    // structure (2026-09-08, after checking the DSH implementation).
    events.forEach(function (e) {{
      html += '<div class="ev-row">' + eventSummary(e) + '</div>';
    }});
    main.innerHTML = html;
  }}

  function eventSummary(e) {{
    var d = e.data || {{}};
    var body = '';
    if (e.type === 'user/message') body = esc(d.text || '');
    else if (e.type === 'context/inject') {{
      body = 'nodes=' + d.nodes + ' · chars=' + d.chars;
      if (d.resume_from) body += ' · <span class="chip none">resume</span> ' + esc(d.resume_from);
      var ch = d.choice;
      if (ch) {{
        var t = ch.tiers || {{}};
        var chips = [];
        for (var k in t) {{ if (t.hasOwnProperty(k)) chips.push('<span class="chip tier tier-' + esc(k) + '">' + esc(k) + '×' + t[k] + '</span>'); }}
        body += ' · <span class="sa-core">SA-Core 选择</span> ' + (chips.join('') || '<span class="chip none">—</span>');
        var top = ch.top || [];
        for (var i = 0; i < top.length; i++) {{
          var n = top[i];
          var nid = n.id ? n.id.slice(0, 8) : '';
          body += '<span class="chip mnode" title="' + esc(n.id || '') + '">' + esc(n.tier) + '·' + n.heat + ' ' + esc(nid) + ' ' + esc(n.phase || '') + '</span>';
        }}
      }}
    }}
    else if (e.type === 'assistant/attempt') body = esc((d.text || '').slice(0, 200));
    else if (e.type === 'assistant/think') body = foldHtml('思考', (d.text || '').slice(0, 60), '<pre class="think-full">' + esc(d.text || '') + '</pre>');
    else if (e.type === 'tool/call') body = esc(d.tool) + ' · #' + d.index + ' · expect=' + esc(d.expect);
    else if (e.type === 'tool/result') {{
      body = esc(d.tool) + ' · <span class="' + (d.ok ? 'ok' : 'bad') + '">' + (d.ok ? 'ok' : 'fail') + '</span> · ' + d.duration_ms + 'ms' +
        ' · sha <span class="sha">' + esc(d.outcome_sha || '—') + '</span>';
      var out = d.outcome || '';
      if (out) body += ' · ' + foldHtml('结果', out.slice(0, 60), '<pre class="think-full">' + esc(out) + '</pre>');
    }}
    else if (e.type === 'check/status') {{
      body = '<span class="chip gate ' + esc(d.gate || '') + '">' + esc((d.gate || 'gate').toUpperCase()) + '</span>' +
        '<span class="chip judge">' + esc(d.judge || '?') + '</span> · ' + esc(d.check || '') +
        ' · <span class="' + (d.passed ? 'ok' : 'bad') + '">' + (d.passed ? 'PASS' : 'FAIL') + '</span>' +
        ' · expect=' + esc(d.expect || '—') + ' · ' + esc(d.evidence_id || '');
      var why = d.reason || d.actual || '';
      if (why) body += ' · ' + foldHtml('依据', why.slice(0, 60), '<pre class="think-full">' + esc(why) + '</pre>');
    }}
    else if (e.type === 'verdict/status') {{
      body = '<b class="' + (d.status === 'Met' ? 'ok' : 'bad') + '">' + esc(d.status || '') + '</b>';
      if (d.checks !== undefined) body += ' · checks=' + d.checks;
      if (d.reason) body += ' · ' + esc(d.reason);
    }}
    else if (e.type === 'turn/end') {{
      body = 'done=' + d.done + ' · success=' + d.success + ' · impasse=' + d.impasse;
      if (d.verdict) body += ' · verdict=<b class="' + (d.verdict === 'Met' ? 'ok' : 'bad') + '">' + esc(d.verdict) + '</b>';
    }}
    else body = '';
    return '<span class="badge ' + (e.type.replace('/','-')) + '">' + (EV_BADGE[e.type] || esc(e.type)) + '</span> <span class="dim">' + esc(e.time.slice(11,19)) + '</span> <span class="body">' + body + '</span>';
  }}

  // One centered toast for system-level errors — never a Helix speech bubble
  // (a transport failure is not Helix talking, it is the cockpit reporting).
  function showError(msg) {{
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = '⚠ ' + msg;
    document.body.appendChild(t);
    setTimeout(function () {{ t.remove(); }}, 5000);
  }}

  function nowTs() {{
    var d = new Date();
    function p(n) {{ return (n < 10 ? '0' : '') + n; }}
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }}

  function addMsg(who, text, isErr) {{
    var box = document.getElementById('chat-msgs');
    var empty = box.querySelector('.empty');
    if (empty) empty.remove();
    var d = document.createElement('div');
    d.className = 'msg ' + who + (isErr ? ' err' : '');
    d.innerHTML = '<span class="who">' + (who==='user' ? '你' : 'Helix') + '<span class="ts">' + nowTs() + '</span></span>' + esc(text);
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }}

  // Streaming message element: created once per reply, text appended as
  // SSE deltas arrive (typewriter). Returns the element to finalize.
  function addStreamMsg() {{
    var box = document.getElementById('chat-msgs');
    var empty = box.querySelector('.empty');
    if (empty) empty.remove();
    var d = document.createElement('div');
    d.className = 'msg helix';
    d.innerHTML = '<span class="who">Helix</span><span class="body"></span>';
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d.querySelector('.body');
  }}

  // DSH-style reasoning disclosure (ReasoningRow): a collapsible think row
  // above the answer. Streamed while running; click to expand/collapse.
  function addThinkRow() {{
    var box = document.getElementById('chat-msgs');
    var empty = box.querySelector('.empty');
    if (empty) empty.remove();
    var d = document.createElement('div');
    d.className = 'think-row';
    d.innerHTML = '<span class="think-head">思考</span><span class="think-body"></span>';
    d.onclick = function () {{ d.classList.toggle('open'); }};
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d.querySelector('.think-body');
  }}

  // One fold capability for every expandable row (think / check /
  // outcome / long reason): click toggles open/closed, hover (title)
  // previews the full body. A single primitive — no per-feature patches.
  function foldHtml(label, preview, full) {{
    return '<span class="fold" onclick="this.classList.toggle(\'open\')" title="' + esc(preview) + '">' +
      '<span class="fold-head">' + label + ' <span class="fold-tip">▸</span></span>' +
      '<span class="fold-body">' + full + '</span></span>';
  }}

  // Load a past experience's history into the chat space (explicit resume):
  // user turns and answers render as messages, then the next sentence
  // continues the period (resume_from on the backend).
  function loadPeriodToChat(jobId) {{
    fetch('/api/events?job_id=' + encodeURIComponent(jobId)).then(function (r) {{ return r.json(); }}).then(function (j) {{
      if (j.missing || !j.events) return;
      var box = document.getElementById('chat-msgs');
      var empty = box.querySelector('.empty');
      if (empty) empty.remove();
      var d = document.createElement('div');
      d.className = 'period-head';
      d.textContent = '—— 经历 ' + jobId + ' 的历史 ——';
      box.appendChild(d);
      j.events.forEach(function (e) {{
        if (e.type === 'user/message') addMsg('user', e.data.text || '', false);
        else if (e.type === 'assistant/attempt') {{
          var a = document.createElement('div');
          a.className = 'msg helix';
          a.innerHTML = '<div class="who">Helix <span class="dim">(经历 ' + jobId.slice(0, 12) + ')</span></div><div class="text">' + esc((e.data.text || '').slice(0, 400)) + '</div>';
          box.appendChild(a);
        }} else if (e.type === 'tool/result') {{
          var t = document.createElement('div');
          t.className = 'msg helix';
          t.innerHTML = '<div class="who">Helix <span class="dim">工具 · ' + esc(e.data.tool) + '</span></div><div class="text">' + esc((e.data.outcome || '').slice(0, 200)) + '</div>';
          box.appendChild(t);
        }}
      }});
      box.scrollTop = box.scrollHeight;
    }});
  }}

  // Resume-from-experience dropdown: sits in the chat-input's bottom-right,
  // listing the latest periods to continue (explicit, never implicit).
  function toggleResume() {{
    var list = document.getElementById('resume-list');
    if (list.style.display !== 'none') {{ list.style.display = 'none'; return; }}
    fetch('/api/sessions').then(function (r) {{ return r.json(); }}).then(function (j) {{
      var periods = (j.periods || []).slice(0, 8);
      list.innerHTML = periods.map(function (p) {{
        var title = p.name || p.preview || '(无用户输入)';
        return '<div class="resume-opt" data-job="' + esc(p.job_id) + '">' + esc(title) + ' <span class="dim">' + esc(p.job_id.slice(0, 20)) + '</span></div>';
      }}).join('') || '<div class="empty">尚无经历</div>';
      list.style.display = '';
      list.querySelectorAll('.resume-opt').forEach(function (el) {{
        el.onclick = function () {{
          chatJobId = el.getAttribute('data-job');
          list.style.display = 'none';
          var b = document.getElementById('cont-banner');
          if (b) {{ b.style.display = ''; b.innerHTML = '续接经历 <span class="tid">' + esc(chatJobId) + '</span> —— 下一句话延续这段对话'; }}
          loadPeriodToChat(chatJobId);
          document.getElementById('chat-text').focus();
        }};
      }});
    }}).catch(function () {{ list.innerHTML = '<div class="empty">经历列表拉取失败</div>'; list.style.display = ''; }});
  }}

  function sendChat() {{
    var input = document.getElementById('chat-text');
    var text = input.value.trim();
    if (!text) return;
    addMsg('user', text, false);
    input.value = '';
    var btn = document.querySelector('.chat-input .btn');
    btn.disabled = true; btn.textContent = '思考中…';
    var done = false;
    var job = chatJobId || null;
    if (job) {{
      var b = document.getElementById('cont-banner');
      if (b) b.innerHTML = '已续接 ' + esc(job) + ' —— 新经历已开启，本提示仍显示本次续接来源';
    }}
    function finish() {{
      if (done) return;
      done = true;
      btn.disabled = false; btn.textContent = '发送';
      input.focus();
    }}
    fetch('/api/chat', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }},
      body: JSON.stringify({{ message: text, job_id: job }})
    }}).then(function (r) {{
      if (!r.body || !r.ok) {{ return r.json().then(function (j) {{
        throw new Error((j.error || 'HTTP ' + r.status) + (j.detail ? ' — ' + j.detail : ''));
      }}); }}
      var reader = r.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var bodyEl = null;
      var thinkEl = null;
      function pump() {{
        return reader.read().then(function (x) {{
          if (x.done) {{ finish(); return; }}
          buf += dec.decode(x.value, {{ stream: true }});
          var idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {{
            var evt = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            var line = evt.trim();
            if (line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (!payload) continue;
            var j;
            try {{ j = JSON.parse(payload); }} catch (e) {{ continue; }}
            if (j.error) {{
              // A transport fault is the cockpit's business, not Helix's.
              // If the answer already streamed, keep it and finish quietly;
              // only a fault with no content gets a toast.
              if (!bodyEl && !thinkEl) showError(j.error);
              finish(); return;
            }}
            if (j.think) {{
              if (!thinkEl) thinkEl = addThinkRow();
              thinkEl.textContent += j.think;
              var box = document.getElementById('chat-msgs');
              box.scrollTop = box.scrollHeight;
            }}
            if (j.delta) {{
              if (!bodyEl) bodyEl = addStreamMsg();
              bodyEl.textContent += j.delta;
              var box = document.getElementById('chat-msgs');
              box.scrollTop = box.scrollHeight;
            }}
            if (j.done) {{
              if (!bodyEl) bodyEl = addStreamMsg();
              // reply is the authoritative full text — overwrite the
              // typewriter accumulation so a dropped delta can never leave
              // a truncated answer on screen.
              if (j.reply) bodyEl.textContent = j.reply;
              finish(); return;
            }}
          }}
          return pump();
        }});
      }}
      return pump();
    }}).catch(function (e) {{
      showError('发送失败: ' + e.message);
    }}).finally(function () {{
      finish();
    }});
  }}

  // Round duration from the chain's own timestamps (RFC3339 → ms).
  // A single-entry round reports 0 — the chain cannot know when the
  // reasoning *started*, only when Tuck saw it (honest, no guessing).
  function durMs(a, b) {{
    var ta = Date.parse(a), tb = Date.parse(b);
    if (isNaN(ta) || isNaN(tb)) return -1;
    return tb - ta;
  }}

  function tick() {{
    fetch('/api/snapshot').then(function (r) {{
      if (!r.ok) {{ throw new Error('proxy ' + r.status); }}
      return r.json();
    }}).then(function (j) {{
      var snap = j.snapshot || null;
      var mode = document.getElementById('mode');
      var st = document.getElementById('state');
      var conn = document.getElementById('conn');
      var sub = document.getElementById('sub');
      if (!snap) {{
        mode.textContent = 'NO SNAPSHOT';
        st.textContent = j.status || '?';
        conn.textContent = '✗ 未就绪';
        conn.className = 'badge';
        sub.textContent = 'Anaphase 未提供快照（' + (j.error || j.status || '未知') + '）——检查 up 是否在运行';
        return;
      }}
      var m = snap.mode || '?';
      // Honest status line: success path must leave the "连接中…" placeholder.
      sub.textContent = 'Anaphase 在线 · ' + m.toUpperCase() + ' · ' + (snap.episode || '暂无经历');
      mode.textContent = m.toUpperCase();
      mode.className = 'badge ' + m;
      st.textContent = 'state: ' + (snap.state || '?');
      conn.textContent = '● 在线';
      conn.className = 'badge live';
      document.getElementById('episode').textContent = snap.episode || '无';
      var ledger = snap.ledger || [];
      document.getElementById('nledger').textContent = ledger.length;
      document.getElementById('tick').textContent = new Date().toLocaleTimeString();
      var box = document.getElementById('entries');
      if (!ledger.length) {{ box.innerHTML = '<div class="empty">暂无记录（Noop 模式 ledger 为空——配置 reasoning 后产生）</div>'; return; }}
      box.innerHTML = '';
      ledger.slice().reverse().forEach(function (e) {{
        var div = document.createElement('div'); div.className = 'entry';
        var status = (e.status || e.record_type || '?').toUpperCase();
        var sts = document.createElement('span'); sts.className = 'st ' + status; sts.textContent = status;
        var tid = document.createElement('span'); tid.textContent = esc(e.trace_id || e.episode_id || '');
        var at = document.createElement('span'); at.className = 'dim'; at.textContent = esc(e.ts || e.created_at || '');
        var call = document.createElement('span'); call.className = 'dim'; call.textContent = esc(e.tool || e.args || '');
        div.appendChild(sts); div.appendChild(tid); div.appendChild(at); div.appendChild(call);
        box.appendChild(div);
      }});
    }}).catch(function (e) {{
      var conn = document.getElementById('conn');
      conn.textContent = '✗ 断开';
      conn.className = 'badge';
      document.getElementById('sub').textContent = 'snapshot 拉取失败: ' + e;
    }});
  }}

  // Ecosystem status board: one dot per component (grey=off, yellow=up
  // but unhealthy, green=healthy). Polled with the same cadence as tick.
  function loadEcosystem() {{
    fetch('/api/ecosystem').then(function (r) {{ return r.json(); }}).then(function (j) {{
      var box = document.getElementById('eco');
      if (!box) return;
      var html = '';
      (j.components || []).forEach(function (c) {{
        html += '<span class="c"><span class="dot ' + esc(c.state) + '"></span>' + esc(c.name) + '</span>';
      }});
      box.innerHTML = html;
    }}).catch(function () {{
      var box = document.getElementById('eco');
      if (box) box.textContent = '生态探测不可用（proxy 未就绪）';
    }});
  }}

  tick(); loadEcosystem();
  setInterval(tick, refresh * 1000);
  setInterval(loadEcosystem, refresh * 1000);
  // Inline `onclick` attributes resolve against the global scope — expose
  // the interactive entry points explicitly (they live in this IIFE).
  window.showView = showView;
  window.sendChat = sendChat;
  window.toggleResume = toggleResume;
  window.applyFilter = applyFilter;
  window.clearFilter = clearFilter;
}})();
</script>
</body>
</html>
"#,
        refresh = REFRESH_SECS,
        tuck_configured = tuck_configured,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_index_and_snapshots() {
        assert_eq!(route("/"), Route::Index);
        assert_eq!(route(""), Route::Index);
        assert_eq!(route("/api/snapshot"), Route::Snapshot);
        assert_eq!(route("/api/snapshot?x=1"), Route::Snapshot); // query stripped inside route
        assert_eq!(route("/api/audit"), Route::Audit);
        assert_eq!(route("/api/audit?limit=50"), Route::Audit);
        assert_eq!(route("/api/trace"), Route::Trace);
        assert_eq!(route("/api/chat"), Route::Chat);
        assert_eq!(route("/api/sessions"), Route::Sessions);
        assert_eq!(route("/api/sessions/rename"), Route::SessionsRename);
        assert_eq!(route("/api/trace?trace_id=run-x"), Route::Trace);
    }

    #[test]
    fn route_unknown_is_not_found() {
        assert_eq!(route("/favicon.ico"), Route::NotFound);
        assert_eq!(route("/etc/passwd"), Route::NotFound);
        assert_eq!(route("/api/other"), Route::NotFound);
    }

    #[test]
    fn config_derive_flags_win_over_defaults() {
        let args = vec![
            "cellrix-web".to_string(),
            "--tuck-endpoint".to_string(),
            "http://127.0.0.1:60052".to_string(),
            "--tuck-key".to_string(),
            "tk-local-gate".to_string(),
            "--tuck-limit".to_string(),
            "50".to_string(),
        ];
        let cfg = PanelConfig::derive(&args);
        assert_eq!(cfg.tuck_endpoint.as_deref(), Some("http://127.0.0.1:60052"));
        assert_eq!(cfg.tuck_key.as_deref(), Some("tk-local-gate"));
        assert_eq!(cfg.tuck_limit, 50);
        assert_eq!(cfg.anaphase_endpoint, ANAPHASE_ENDPOINT_DEFAULT);
    }

    #[test]
    fn config_derive_unset_tuck_is_off() {
        let cfg = PanelConfig::derive(&["cellrix-web".to_string()]);
        assert!(cfg.tuck_endpoint.is_none());
        assert!(cfg.tuck_key.is_none());
        assert_eq!(cfg.tuck_limit, TUCK_LIMIT_DEFAULT);
    }

    #[test]
    fn panel_already_up_detects_own_panel_and_ignores_foreign() {
        // Our panel: a listener answering with the index page marker.
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\n<div id=view-chat></div>");
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(panel_already_up(&port));
        // Foreign/empty port: no panel.
        let l2 = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let p2 = l2.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut s, _) = l2.accept().unwrap();
            let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n");
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!panel_already_up(&p2));
        // No listener at all.
        assert!(!panel_already_up(&1));
    }

    #[test]
    fn index_html_contains_both_views_and_engram_fields() {
        let cfg = PanelConfig {
            anaphase_endpoint: ANAPHASE_ENDPOINT_DEFAULT.to_string(),
            tuck_endpoint: Some("http://127.0.0.1:60052".to_string()),
            tuck_key: Some("tk-local-gate".to_string()),
            tuck_limit: 200,
        };
        let html = index_html(&cfg);
        assert!(html.contains("驾驶舱 Cockpit"));
        assert!(html.contains("印痕 Engram"));
        assert!(html.contains("/api/audit"));
        assert!(html.contains("Ledger 白盒"));
        // Engram v2: experience sidebar + turn timeline + ecosystem board.
        assert!(html.contains("id=\"s-side\""));
        assert!(html.contains("id=\"s-main\""));
        assert!(html.contains("id=\"chat-side\""));
        assert!(html.contains("EV_BADGE"));
        assert!(html.contains("loadEcosystem"));
        assert!(html.contains("id=\"eco\""));
        assert!(html.contains("/api/ecosystem"));
    }
}
