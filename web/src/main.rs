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
  <meta name="color-scheme" content="dark light">
  <script>
  (function(){{
    var K='cellrix-theme', R=document.documentElement, mq=matchMedia('(prefers-color-scheme: dark)');
    function cur(){{ try{{ return localStorage.getItem(K)||'auto'; }}catch(e){{ return 'auto'; }} }}
    function apply(m){{ var real=m==='auto'?(mq.matches?'dark':'light'):m; R.setAttribute('data-theme',real); }}
    apply(cur());
    window.__setTheme=function(m){{ try{{ localStorage.setItem(K,m); }}catch(e){{}} apply(m);
      var bs=document.querySelectorAll('.theme-switch button');
      for(var i=0;i<bs.length;i++){{ bs[i].className=bs[i].getAttribute('data-t')===m?'on':''; }} }};
    if(mq.addEventListener) mq.addEventListener('change',function(){{ if(cur()==='auto') apply('auto'); }});
  }})();
  </script>
<style>
  :root, [data-theme="dark"] {{ /* 令牌同源 lumtract-tokens.css（暗） */
    --bg-base:#1A1A1A; --bg-surface:#1F1F1F; --bg-elevated:#262626;
    --text-1:#EDEDED; --text-2:#A8A8A8; --text-3:#7A7A7A;
    --line:#2E2E2E; --line-strong:#3D3D3D;
    --brand:#2B8CBE; --brand-fg:#06131A;
    --ok:#52C41A; --warn:#FAAD14; --bad:#EA6668;
    --row-zebra:rgba(255,255,255,.02); --row-hover:rgba(43,140,190,.08); --row-sel:rgba(43,140,190,.14);
    --chip-bg:rgba(255,255,255,.06); --shadow:0 4px 18px rgba(0,0,0,.35);
    --r-sm:4px; --r-md:8px; --r-lg:12px; --sp-2:8px; --sp-3:12px; --sp-4:16px;
    --dur-press:120ms; --dur-state:200ms; --dur-enter:260ms;
    color-scheme: dark;
  }}
  [data-theme="light"] {{ /* 令牌同源 lumtract-tokens.css（浅：极性翻转——白底无上升空间，
    层级靠变暗阴影/波纹反光承担） */
    --bg-base:#F4F3EE; --bg-surface:#FFFFFF; --bg-elevated:#FFFFFF;
    --text-1:#1A1B1C; --text-2:#4A4F58; --text-3:#6B7280;
    --line:#E4E3DD; --line-strong:#C9C8C2;
    --brand:#14506F; --brand-fg:#FFFFFF;
    --ok:#1E7E34; --warn:#8A5A00; --bad:#B3261E;
    --row-zebra:rgba(0,0,0,.02); --row-hover:rgba(20,80,111,.07); --row-sel:rgba(20,80,111,.12);
    --chip-bg:rgba(0,0,0,.05); --shadow:0 4px 18px rgba(0,0,0,.12);
    color-scheme: light;
  }}
  /* ================================================================
     Cellrix WebUI · 水之波光化（Lumtact 设计体系 · v10.0.4）
     推导：目的档案 cellrix-webui-purpose-2026-09-09 · 卷三推导引擎
     关键裁决：
     · 事件类型 badge 单色相中性 —— 10 种类型 10 种颜色 = 装饰性显著
       性是噪音 [PHYS:P-016]；类型靠文字区分（层级单调 [PHYS:L-001]，
       同层级外观一致 [PHYS:P-013]）。语义状态（Met/Unmet、PASS/FAIL、
       ok/fail）保留语义色 [PHYS:L-002]（内容强制）。
     · 选中行背景高亮，无彩色加粗左边框 —— [PHYS:D-003]（1px 彩色
       分割线 / Pentile 彩边）。
     · 状态点纯色静态（无呼吸动画）—— 面板常开，闲置动画违反
       [PHYS:R-003]；「等待」保留确定性可视化 [PHYS:C-003]。
     · 时间令牌 120/200/260ms —— [PHYS:P-004]（>100ms 因果下限）/
       [PHYS:P-005]（200–350ms 舒适区）。
     · 热区 ≥44px —— [PHYS:P-010]。
     · 主题三段式（跟随/日/夜）—— [PHYS:D-006] 环境融合。
     · 降级：reduced-motion 流转权降级、prefers-contrast 实色边界、
       窄屏单列 —— 卷三 3.5.3 降级阶梯。
     ================================================================ */
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ background:var(--bg-base); color:var(--text-1);
    font-family:'SF Mono','Menlo','PingFang SC',monospace; padding:20px; }}
  h1 {{ font-size:16px; font-weight:600; color:var(--brand); margin-bottom:4px; }}
  .sub {{ color:var(--text-2); font-size:12px; margin-bottom:14px; }}
  .bar {{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }}
  .theme-switch {{ display:flex; gap:2px; margin-left:auto; border:1px solid var(--line);
    border-radius:var(--r-md); padding:2px; }}
  .theme-switch button {{ background:transparent; border:0; color:var(--text-2);
    font-size:11px; padding:4px 10px; min-height:32px; cursor:pointer;
    border-radius:6px; font-family:inherit; }}
  .theme-switch button.on {{ background:var(--row-sel); color:var(--brand); }}
  .chat-msgs {{ max-height:340px; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }}
  .msg {{ max-width:85%; padding:8px 12px; border-radius:var(--r-lg); font-size:12px; line-height:1.6;
    white-space:pre-wrap; word-break:break-word; }}
  .msg.user {{ align-self:flex-end; background:var(--row-sel); color:var(--text-1); }}
  .msg.helix {{ align-self:flex-start; background:var(--bg-surface); border:1px solid var(--line); }}
  .msg .who {{ display:block; font-size:10px; color:var(--text-2); margin-bottom:3px; }}
  .msg.err {{ border-color:var(--bad); color:var(--bad); }}
  .chat-input {{ position:relative; display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--line); }}
  .chat-input input {{ flex:1; background:var(--bg-base); color:var(--text-1);
    border:1px solid var(--line); border-radius:var(--r-md); padding:10px; min-height:var(--hit,44px);
    font-size:13px; font-family:inherit; outline:none; }}
  .chat-input input:focus {{ border-color:var(--brand); }}
  .toast {{ position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:50;
    background:var(--bg-elevated); border:1px solid var(--bad); color:var(--bad);
    padding:8px 16px; border-radius:10px; font-size:12px; max-width:70%; box-shadow:var(--shadow); }}
  .msg .ts {{ float:right; margin-left:10px; font-size:10px; color:var(--text-2); opacity:.75; }}
  .btn {{ background:var(--bg-surface); color:var(--text-2); border:1px solid var(--line);
    border-radius:var(--r-md); padding:8px 14px; min-height:36px; font-size:12px; font-family:inherit;
    cursor:pointer; position:relative; overflow:hidden;
    transition:border-color var(--dur-state),color var(--dur-state); }}
  .btn:hover {{ border-color:var(--brand); color:var(--brand); }}
  .btn.on {{ color:var(--brand); border-color:var(--brand); background:var(--row-sel); }}
  .badge {{ padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600;
    border:1px solid var(--line); }}
  .badge.partner {{ background:var(--row-sel); color:var(--brand); border-color:var(--brand); }}
  .badge.drive {{ background:rgba(30,126,52,.12); color:var(--ok); border-color:var(--ok); }}
  .badge.survive {{ background:rgba(179,38,30,.12); color:var(--bad); border-color:var(--bad); }}
  .badge.live {{ color:var(--ok); }}
  .cards {{ display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; }}
  .card {{ flex:1 1 200px; min-width:0; background:var(--bg-surface); border:1px solid var(--line);
    border-radius:var(--r-lg); padding:12px; }}
  .card .k {{ font-size:11px; color:var(--text-2); margin-bottom:6px; }}
  .card .v {{ font-size:20px; font-weight:600; }}
  .card .v.small {{ font-size:13px; }}
  .panel {{ background:var(--bg-surface); border:1px solid var(--line);
    border-radius:var(--r-lg); overflow:hidden; }}
  .panel .head {{ padding:10px 12px; font-size:12px; color:var(--text-2);
    border-bottom:1px solid var(--line); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }}
  .ledger .entry {{ padding:10px 12px; border-bottom:1px solid var(--line); font-size:12px;
    display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }}
  .ledger .entry:last-child {{ border-bottom:none; }}
  .entry .st {{ font-weight:700; padding:2px 8px; border-radius:6px; font-size:11px; }}
  .st.MET {{ color:var(--ok); background:rgba(30,126,52,.12); }}
  .st.UNMET {{ color:var(--bad); background:rgba(179,38,30,.12); }}
  .st.BLOCKED {{ color:var(--bad); background:rgba(179,38,30,.12); }}
  /* Engram：比例 2D 网格（概览 / 时间线 2fr + 明细 1fr） */
  .engram-overview {{ display:flex; gap:10px; flex-wrap:wrap; padding:10px 12px; font-size:12px;
    color:var(--text-2); border-bottom:1px solid var(--line); align-items:center; }}
  .engram-overview .k {{ color:var(--text-2); }}
  .engram-overview .v {{ color:var(--text-1); font-weight:600; }}
  .engram-filter {{ margin-left:auto; display:flex; gap:6px; }}
  .engram-filter input {{ background:var(--bg-base); color:var(--text-1);
    border:1px solid var(--line); border-radius:6px; padding:8px; min-height:36px;
    font-size:12px; font-family:inherit; width:180px; }}
  .engram-main {{ display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:16px; }}
  .timeline {{ max-height:420px; overflow-y:auto; }}
  .row {{ padding:8px 12px; border-bottom:1px solid var(--line); font-size:12px; cursor:pointer;
    display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; min-height:36px; }}
  .row:hover {{ background:var(--row-hover); }}
  .row.sel {{ background:var(--row-sel); }} /* 选中=背景高亮，无彩色左边框 [PHYS:D-003] */
  .redact {{ color:var(--bad); background:rgba(179,38,30,.09); border-radius:3px;
    padding:0 3px; font-weight:600; white-space:nowrap; }}
  .row .seq {{ color:var(--text-2); }}
  .row .kind {{ color:var(--brand); font-weight:600; }}
  .row .tid {{ color:var(--text-2); }}
  .row .ok {{ color:var(--ok); }} .row .bad {{ color:var(--bad); }}
  .grp-head {{ padding:8px 12px; font-size:12px; cursor:pointer; background:var(--row-zebra);
    border-bottom:1px solid var(--line); display:flex; gap:8px; align-items:baseline; user-select:none; }}
  .grp-head:hover {{ background:var(--row-hover); }}
  .ses-side {{ border-right:1px solid var(--line); padding-right:12px; max-height:480px; overflow-y:auto; }}
  .ses-item {{ padding:10px; border:1px solid var(--line); border-radius:var(--r-md);
    margin-bottom:8px; cursor:pointer; font-size:12px; }}
  .ses-item:hover {{ border-color:var(--brand); }}
  .ses-item.sel {{ border-color:var(--brand); background:var(--row-sel); }}
  .ses-item .t {{ color:var(--text-2); font-size:11px; }}
  .ses-item .p {{ margin-top:3px; color:var(--text-1); word-break:break-all; }}
  .ses-stats {{ display:flex; gap:16px; padding:8px 12px; border-bottom:1px solid var(--line);
    font-size:12px; flex-wrap:wrap; }}
  .ses-stats span {{ color:var(--text-2); }}
  .ses-stats b {{ color:var(--text-1); font-weight:600; }}
  .ev-row {{ padding:8px 12px; border-bottom:1px solid var(--line); font-size:12px;
    display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; min-height:36px; }}
  /* 事件类型 badge：单色相中性 —— 类型靠文字区分 [PHYS:P-016]/[PHYS:L-001]。
     语义状态（PASS/FAIL/Met/Unmet）由 body 内 .ok/.bad 承担 [PHYS:L-002]。 */
  .ev-row .badge {{ font-size:10px; font-weight:700; padding:2px 7px; border-radius:4px;
    letter-spacing:.5px; background:var(--chip-bg); color:var(--text-2); border:1px solid var(--line); }}
  .ev-row .badge.verdict-status {{ color:var(--bad); border-color:rgba(179,38,30,.4); }}
  .ev-row .body {{ color:var(--text-1); word-break:break-all; }}
  .ev-row .ok {{ color:var(--ok); }} .ev-row .bad {{ color:var(--bad); }}
  .btn.ghost {{ border:1px solid var(--line); background:transparent; color:var(--text-2); }}
  .btn.ghost:hover {{ border-color:var(--brand); color:var(--brand); }}
  .rename-btn {{ margin-left:8px; font-size:11px; padding:4px 6px; min-height:28px;
    border-radius:5px; border:1px solid var(--line); background:transparent; color:var(--text-2); cursor:pointer; }}
  .rename-btn:hover {{ border-color:var(--brand); color:var(--brand); }}
  .sa-core {{ color:var(--brand); font-weight:600; }}
  /* 记忆层级 chip：单色相（brand 系）分级亮度 —— [PHYS:L-002] 语义 + 收敛 */
  .chip {{ display:inline-block; font-size:10px; padding:2px 7px; border-radius:999px;
    border:1px solid var(--line); margin-right:4px; vertical-align:1px;
    color:var(--text-2); background:var(--chip-bg); }}
  .chip.tier-L0 {{ color:var(--text-2); }}
  .chip.tier-L1 {{ color:var(--brand); }}
  .chip.tier-L2 {{ color:var(--brand); background:rgba(43,140,190,.12); }}
  .chip.tier-L3 {{ color:var(--brand); background:rgba(43,140,190,.18); border-color:var(--brand); }}
  .chip.mnode {{ color:var(--brand); background:rgba(43,140,190,.08); }}
  .chip.none {{ background:transparent; color:var(--text-2); }}
  .think-row {{ padding:8px 12px; font-size:11px; color:var(--text-2); cursor:pointer;
    display:flex; gap:8px; align-items:baseline; border-bottom:1px solid var(--line); }}
  .think-row .think-head {{ color:var(--brand); font-weight:600; flex-shrink:0; }}
  .think-row .think-body {{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:88%; }}
  .think-row.open .think-body {{ white-space:pre-wrap; word-break:break-all; max-height:200px; overflow:auto; }}
  .fold {{ display:inline-block; vertical-align:middle; cursor:pointer; }}
  .fold .fold-head {{ color:var(--brand); font-weight:600; }}
  .fold .fold-tip {{ color:var(--text-2); }}
  .fold.open .fold-tip {{ transform:rotate(90deg); display:inline-block; }}
  .fold .fold-body {{ display:none; }}
  .fold.open .fold-body {{ display:inline; }}
  .fold .think-full {{ display:inline; white-space:pre-wrap; word-break:break-all;
    max-height:160px; overflow:auto; font-size:11px; color:var(--text-1); }}
  .chip.gate.hard {{ color:var(--bad); background:rgba(179,38,30,.1); border-color:rgba(179,38,30,.4); }}
  .chip.gate.soft {{ color:var(--warn); background:rgba(138,90,0,.1); border-color:rgba(138,90,0,.4); }}
  .chip.judge {{ color:var(--brand); background:rgba(43,140,190,.08); }}
  .sha {{ font-family:monospace; font-size:10px; color:var(--text-2); }}
  .period-head {{ padding:8px 12px; font-size:11px; color:var(--text-2); border-bottom:1px solid var(--line); }}
  .resume-list {{ position:absolute; right:12px; bottom:54px; width:280px; background:var(--bg-surface);
    border:1px solid var(--line); border-radius:var(--r-md); box-shadow:var(--shadow); z-index:10;
    max-height:260px; overflow:auto; }}
  .resume-opt {{ padding:10px; font-size:12px; cursor:pointer; border-bottom:1px solid var(--line);
    color:var(--text-1); word-break:break-all; }}
  .resume-opt:hover {{ background:var(--row-hover); }}
  .mnode {{ color:var(--brand); }}
  .cont-banner {{ padding:8px 12px; font-size:11px; color:var(--brand);
    border-bottom:1px solid var(--line); background:var(--row-zebra); }}
  .grp-head .arrow {{ color:var(--brand); width:12px; display:inline-block; }}
  .grp-head .tid {{ color:var(--brand); font-weight:600; }}
  .grp-body .row {{ padding-left:22px; }}
  .detail {{ padding:12px; font-size:12px; }}
  .detail .line {{ margin-bottom:6px; display:flex; gap:8px; flex-wrap:wrap; }}
  .detail .key {{ color:var(--text-2); min-width:90px; }}
  .detail .val {{ color:var(--text-1); word-break:break-all; }}
  .detail pre {{ margin-top:8px; background:var(--bg-base); border:1px solid var(--line);
    border-radius:var(--r-md); padding:10px; font-size:11px; overflow-x:auto; max-height:260px;
    color:var(--text-1); white-space:pre-wrap; word-break:break-all; }}
  .dim {{ color:var(--text-2); }}
  .empty {{ padding:14px 12px; font-size:12px; color:var(--text-2); }}
  .eco {{ display:flex; gap:18px; flex-wrap:wrap; font-size:12px; color:var(--text-2); padding:8px 0 4px; }}
  .eco .c {{ display:inline-flex; align-items:center; gap:6px; }}
  .eco .dot {{ width:10px; height:10px; border-radius:50%; display:inline-block; }}
  .eco .dot.ok {{ background:var(--ok); }}
  .eco .dot.off {{ background:var(--text-3); }}
  .eco .dot.starting {{ background:var(--warn); }}
  .eco .dot.error {{ background:var(--bad); }}
  .foot {{ color:var(--text-2); font-size:11px; margin-top:14px; }}
  /* 波纹反馈：果从因的位置长出 [PURPOSE] —— 涟漪四阶段（升起/扩散/消散/复原） */
  .ripple {{ position:absolute; border-radius:50%; pointer-events:none;
    background:var(--brand); opacity:.18; transform:scale(0);
    animation:ripple-rip var(--dur-state) ease-out forwards; }}
  @keyframes ripple-rip {{ to {{ transform:scale(3); opacity:0; }} }}
  /* 等待可视化（不可降级 [PHYS:C-003]） */
  .loading {{ display:inline-block; width:12px; height:12px; border:2px solid var(--line);
    border-top-color:var(--brand); border-radius:50%; animation:spin 720ms linear infinite; }}
  @keyframes spin {{ to {{ transform:rotate(360deg); }} }}
  /* 降级 · 第一档：reduced-motion —— 流转权降级，识读/反馈权保留 [PHYS:R-005] */
  @media (prefers-reduced-motion:reduce) {{
    *,*::before,*::after {{ animation-duration:1ms!important; animation-iteration-count:1!important;
      transition-duration:1ms!important; }}
    .loading {{ animation-duration:720ms!important; }}
  }}
  /* 降级 · 第四档：高对比 —— 半透明剥离，层级靠实色边界 */
  @media (prefers-contrast:more) {{
    [data-theme="dark"] {{ --line:#7A8089; --line-strong:#A8AEB6; --text-2:#C7CDD4;
      --brand:#8FC8E8; --ok:#7CE0B5; --bad:#F5A192; --warn:#FFD97A; }}
    [data-theme="light"] {{ --line:#8A9099; --line-strong:#4A5058; --text-2:#33383F;
      --brand:#14506F; --ok:#1E7E34; --bad:#96271A; --warn:#8A5A00; }}
    .panel,.card,.ses-item,.btn,.msg,.chip {{ border-width:2px; }}
  }}
  /* 降级 · 窄屏：网格单列 [PHYS:P-012 接近性] */
  @media (max-width:800px) {{
    .engram-main {{ grid-template-columns:1fr; }}
    .timeline {{ max-height:300px; }}
    .ses-side {{ border-right:0; padding-right:0; max-height:220px; }}
    body {{ padding:12px; }}
  }}

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
    <div class="theme-switch" role="group" aria-label="主题">
      <button type="button" data-t="auto" class="on" onclick="__setTheme('auto')">跟随</button>
      <button type="button" data-t="light" onclick="__setTheme('light')">日间</button>
      <button type="button" data-t="dark" onclick="__setTheme('dark')">暗黑</button>
    </div>
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
    <div class="head" style="margin-bottom:12px">印痕 Engram — 全链路可审计轨迹（会话 = 经历 · 判据与行动同线 · 水之波光 v11.2.0 骨架）</div>
    <div class="engram-main" style="grid-template-columns:280px 1fr;">
      <div class="ses-side" id="s-side"><div class="empty">经历列表加载中…</div></div>
      <div id="s-main">{engram}</div>
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

  // === Engram v3 (水之波光 v11.2.0 骨架): experience sidebar + trajectory
  // === One cognitive period = one `run-xxx` event stream, keyed by the same
  // derived job id as the body trace and the Tuck audit chain. The sidebar
  // lists periods (newest first); selecting one loads the trajectory
  // skeleton rendered by assets/engram.html — badges, tracks, inspector.
  var selectedPeriod = null;
  // Explicit continuation (ADR-0026): while set, the next chat request
  // resumes this experience (`job_id`) instead of opening a fresh stranger.
  var chatJobId = null;

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
        window.__engramMeta = {{ job_id: p.job_id, name: p.name, preview: p.preview }};
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
    // 印痕 v3（水之波光 v11.2.0 骨架）：轨迹视图由 engram.html 资产渲染。
    // 会话元信息（名称/预览）通过 window.__engramMeta 桥接。
    var meta = window.__engramMeta || null;
    if (window.__engramLoad) window.__engramLoad(jobId, meta);
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
  // 主题按钮状态初始化（与 head 引导脚本对齐）
  (function(){{ try{{
    var K='cellrix-theme', cur=localStorage.getItem(K)||'auto';
    var bs=document.querySelectorAll('.theme-switch button');
    for(var i=0;i<bs.length;i++){{ bs[i].className=bs[i].getAttribute('data-t')===cur?'on':''; }}
  }}catch(e){{}} }})();
  // 波纹反馈：果从因的位置长出 —— 点击按钮处生成涟漪（[PURPOSE] 涟漪四阶段）
  document.addEventListener('click', function(e){{
    var btn=e.target.closest ? e.target.closest('.btn,.ses-item,.fold-head') : null;
    if(!btn || btn.closest('input')) return;
    var r=btn.getBoundingClientRect();
    var rip=document.createElement('span');
    rip.className='ripple';
    var d=Math.max(r.width,r.height);
    rip.style.width=rip.style.height=d+'px';
    rip.style.left=(e.clientX-r.left-d/2)+'px';
    rip.style.top=(e.clientY-r.top-d/2)+'px';
    btn.appendChild(rip);
    setTimeout(function(){{ rip.remove(); }}, 300);
  }}, true);
  window.toggleResume = toggleResume;
}})();
</script>
</body>
</html>
"#,
        refresh = REFRESH_SECS,
        tuck_configured = tuck_configured,
        engram = include_str!("../assets/engram.html"),
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
        // Engram v3: experience sidebar + trajectory skeleton (v11.2.0).
        assert!(html.contains("id=\"s-side\""));
        assert!(html.contains("id=\"s-main\""));
        assert!(html.contains("id=\"chat-side\""));
        assert!(html.contains("__engramLoad"));
        assert!(html.contains("id=\"eTblVp\""));
        assert!(html.contains("id=\"eLaneInput\""));
        assert!(html.contains("id=\"eInsp\""));
        assert!(html.contains("loadEcosystem"));
        assert!(html.contains("id=\"eco\""));
        assert!(html.contains("/api/ecosystem"));
    }
}
