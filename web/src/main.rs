//! `cellrix-web` — Anaphase cockpit Web panel (candidate G2, ADR-0014).
//!
//! A browser-visible white-box for the conscious layer: it proxies the
//! Anaphase snapshot endpoint (`/v1/agent/snapshot`, ADR-0010 contract) and
//! renders the same data the TUI cockpit shows — mode / cognitive state /
//! episode / ledger. Zero new dependencies: std-only HTTP server, single
//! embedded HTML page, native JS polling.
//!
//! Why a proxy instead of direct browser fetch: the Anaphase endpoint has no
//! CORS headers; proxying keeps one origin, one port, no config. The data
//! contract is shared with the TUI (snapshot protocol) — the Web panel is a
//! projection of the same truth, not a second data source.
//!
//! Usage:
//!   cellrix-web                          # anaphase 127.0.0.1:50061, web :8080
//!   cellrix-web --anaphase-endpoint http://127.0.0.1:50061 --port 9090
//!   WEB_PORT=9090 cellrix-web            # env knob (same 12-factor style)
//!
//! Zero-hardcoding: the anaphase endpoint default is the Anaphase cap_http
//! protocol default (config.toml `cap_http_port`, documented in ADR-0010);
//! the web port default 8080 is the panel's own documented protocol default.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

/// Web panel listening port when no `--port`/`WEB_PORT` is given (this
/// panel's documented protocol default; unassigned common HTTP port).
const WEB_PORT_DEFAULT: u16 = 8080;
/// Anaphase snapshot endpoint when no `--anaphase-endpoint` is given
/// (ADR-0010: Anaphase cap_http protocol default, `config.toml cap_http_port`).
const ANAPHASE_ENDPOINT_DEFAULT: &str = "http://127.0.0.1:50061";
/// Browser refresh cadence (snapshot polling interval, seconds).
const REFRESH_SECS: u64 = 2;

/// Request routing: path + optional query string, then match.
/// Pure function — parse only what we serve, reject the rest.
fn route(path: &str) -> Route {
    let path = path.split('?').next().unwrap_or("/");
    match path.trim_matches('/') {
        "" => Route::Index,
        "api/snapshot" => Route::Snapshot,
        _ => Route::NotFound,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Route {
    Index,
    Snapshot,
    NotFound,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    // Derive the anaphase endpoint (explicit flag > env > protocol default).
    let anaphase_endpoint = args
        .windows(2)
        .find(|w| w[0] == "--anaphase-endpoint")
        .map(|w| w[1].clone())
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var("ANAPHASE_ENDPOINT").ok().filter(|v| !v.is_empty()))
        .unwrap_or_else(|| ANAPHASE_ENDPOINT_DEFAULT.to_string());

    // Derive the web port (explicit flag > env > protocol default).
    let port = args
        .windows(2)
        .find(|w| w[0] == "--port")
        .and_then(|w| w[1].parse::<u16>().ok())
        .or_else(|| std::env::var("WEB_PORT").ok().and_then(|v| v.parse().ok()))
        .unwrap_or(WEB_PORT_DEFAULT);

    println!("cellrix-web: cockpit panel on http://127.0.0.1:{port}");
    println!("             proxying anaphase snapshot @ {anaphase_endpoint}");

    let listener = TcpListener::bind(("127.0.0.1", port))?;
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let endpoint = anaphase_endpoint.clone();
                // One thread per connection: the panel is a local tool with
                // a handful of browsers; simplicity beats connection pooling.
                thread::spawn(move || {
                    if let Err(e) = handle(s, &endpoint) {
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
fn handle(mut stream: TcpStream, anaphase_endpoint: &str) -> Result<(), Box<dyn std::error::Error>> {
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
            let body = index_html();
            respond(&mut stream, 200, "text/html; charset=utf-8", body.as_bytes())?;
        }
        Route::Snapshot => {
            match fetch(anaphase_endpoint) {
                Ok(body) => respond(&mut stream, 200, "application/json", body.as_bytes())?,
                Err(e) => {
                    let msg = format!("{{\"status\":\"Error\",\"error\":\"{e}\"}}");
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

/// Hand-rolled HTTP GET (same pattern as `up`'s snapshot probe): read the
/// body after the blank line. The endpoint is a trusted local service.
fn fetch(url: &str) -> Result<String, String> {
    let url = url.trim_start_matches("http://");
    let url = url.trim_start_matches("http://").trim_end_matches('/');
    let (host, port) = match url.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().map_err(|e| e.to_string())?),
        None => (url.to_string(), 80),
    };
    let mut stream = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
    let req = format!(
        "GET {SNAPSHOT_PATH} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    buf.split("\r\n\r\n")
        .nth(1)
        .map(|s| s.to_string())
        .ok_or_else(|| "empty response".to_string())
}

/// The embedded panel page: native JS polls `/api/snapshot` and renders the
/// same white-box the TUI cockpit shows. No frameworks, no build step.
fn index_html() -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anaphase Cockpit</title>
<style>
  :root {{ --bg:#16161a; --panel:#1e1e24; --line:#2c2c34; --text:#e8e8ec; --dim:#9a9aa4; --ok:#4ec9a0; --bad:#e06c75; --acc:#9eacEA; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ background:var(--bg); color:var(--text); font-family:'SF Mono','Menlo','PingFang SC',monospace; padding:20px; }}
  h1 {{ font-size:16px; font-weight:600; color:var(--acc); margin-bottom:4px; }}
  .sub {{ color:var(--dim); font-size:12px; margin-bottom:16px; }}
  .bar {{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }}
  .badge {{ padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; border:1px solid var(--line); }}
  .badge.partner {{ background:rgba(158,172,234,.15); color:var(--acc); border-color:var(--acc); }}
  .badge.drive {{ background:rgba(156,204,169,.12); color:var(--ok); border-color:var(--ok); }}
  .badge.survive {{ background:rgba(224,108,117,.12); color:var(--bad); border-color:var(--bad); }}
  .cards {{ display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; }}
  .card {{ flex:1 1 200px; min-width:0; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px; }}
  .card .k {{ font-size:11px; color:var(--dim); margin-bottom:6px; }}
  .card .v {{ font-size:20px; font-weight:600; }}
  .card .v.small {{ font-size:13px; }}
  .ledger {{ background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }}
  .ledger .head {{ padding:10px 12px; font-size:12px; color:var(--dim); border-bottom:1px solid var(--line); }}
  .entry {{ padding:10px 12px; border-bottom:1px solid var(--line); font-size:12px; display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }}
  .entry:last-child {{ border-bottom:none; }}
  .entry .st {{ font-weight:700; padding:1px 8px; border-radius:6px; font-size:11px; }}
  .st.MET {{ color:var(--ok); background:rgba(78,201,160,.12); }}
  .st.UNMET {{ color:var(--bad); background:rgba(224,108,117,.12); }}
  .st.BLOCKED {{ color:var(--bad); background:rgba(224,108,117,.12); }}
  .dim {{ color:var(--dim); }}
  .empty {{ padding:14px 12px; font-size:12px; color:var(--dim); }}
  .foot {{ color:var(--dim); font-size:11px; margin-top:14px; }}
  .live {{ color:var(--ok); }}
</style>
</head>
<body>
  <h1>Anaphase Cockpit</h1>
  <div class="sub" id="sub">连接中…</div>
  <div class="bar">
    <span class="badge" id="mode">…</span>
    <span class="badge" id="state">…</span>
    <span class="badge" id="conn">…</span>
  </div>
  <div class="cards">
    <div class="card"><div class="k">经历 episode</div><div class="v small" id="episode">…</div></div>
    <div class="card"><div class="k">Ledger 记录</div><div class="v" id="nledger">…</div></div>
    <div class="card"><div class="k">刷新</div><div class="v small" id="tick">…</div></div>
  </div>
  <div class="ledger">
    <div class="head">Ledger 白盒（append-only，可逐条审查）</div>
    <div id="entries"><div class="empty">等待数据…</div></div>
  </div>
  <div class="foot">数据源: Anaphase /v1/agent/snapshot（ADR-0010 契约）· 自动刷新 {refresh}s · <a href="/api/snapshot" style="color:var(--acc);">原始 JSON</a></div>
<script>
(function () {{
  var refresh = {refresh};
  var last = null;
  function esc(s) {{ return String(s).replace(/[&<>"']/g, function (c) {{ return {{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]; }}); }}
  function tick() {{
    fetch('/api/snapshot').then(function (r) {{ return r.json(); }}).then(function (j) {{
      var snap = j.snapshot || null;
      var mode = document.getElementById('mode');
      var st = document.getElementById('state');
      var conn = document.getElementById('conn');
      if (!snap) {{ mode.textContent = 'NO SNAPSHOT'; st.textContent = j.status || '?'; conn.textContent = 'booting/未刷新'; conn.className = 'badge'; return; }}
      var m = snap.mode || '?';
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
        var why = document.createElement('span'); why.className = 'dim';
        if (e.check_reports) {{ var n = e.check_reports.length; why.textContent = n + ' 判据' + (e.check_reports.every(function (c) {{ return c.pass; }}) ? ' 全过' : ' 有未过'); }}
        if (e.evidence_ids) {{ var ev = document.createElement('span'); ev.className = 'dim'; ev.textContent = 'evidence: ' + e.evidence_ids.join(','); div.appendChild(ev); }}
        div.appendChild(sts); div.appendChild(tid); div.appendChild(why);
        box.appendChild(div);
      }});
      document.getElementById('sub').textContent = '白盒窗口：模式 / 认知状态 / 经历 / ledger——与 TUI 驾驶舱同一 snapshot 协议';
    }}).catch(function (e) {{
      document.getElementById('conn').textContent = '✗ 离线';
      document.getElementById('conn').className = 'badge';
      document.getElementById('sub').textContent = '无法连接 Anaphase（请先 cargo run --bin up）';
    }});
  }}
  tick();
  setInterval(tick, refresh * 1000);
}})();
</script>
</body>
</html>"#,
        refresh = REFRESH_SECS,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_index_and_snapshot() {
        assert_eq!(route("/"), Route::Index);
        assert_eq!(route(""), Route::Index);
        assert_eq!(route("/api/snapshot"), Route::Snapshot);
        assert_eq!(route("/api/snapshot?x=1"), Route::Snapshot); // query stripped inside route
    }

    #[test]
    fn route_unknown_is_not_found() {
        assert_eq!(route("/favicon.ico"), Route::NotFound);
        assert_eq!(route("/etc/passwd"), Route::NotFound);
        assert_eq!(route("/api/other"), Route::NotFound);
    }

    #[test]
    fn index_html_contains_panel_and_refresh() {
        let html = index_html();
        assert!(html.contains("Anaphase Cockpit"));
        assert!(html.contains("/api/snapshot"));
        assert!(html.contains("Ledger 白盒"));
    }
}
