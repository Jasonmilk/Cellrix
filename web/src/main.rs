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
        _ => Route::NotFound,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Route {
    Index,
    Snapshot,
    Audit,
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

    let listener = TcpListener::bind(("127.0.0.1", port))?;
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
            match fetch_json(&cfg.anaphase_endpoint, SNAPSHOT_PATH, None) {
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
/// `bearer` is an optional identity credential (never sent to the browser).
fn fetch_json(
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
  .row .seq {{ color:var(--dim); }}
  .row .kind {{ color:var(--acc); font-weight:600; }}
  .row .tid {{ color:var(--dim); }}
  .row .ok {{ color:var(--ok); }} .row .bad {{ color:var(--bad); }}
  .detail {{ padding:12px; font-size:12px; }}
  .detail .line {{ margin-bottom:6px; display:flex; gap:8px; flex-wrap:wrap; }}
  .detail .key {{ color:var(--dim); min-width:90px; }}
  .detail .val {{ color:var(--text); word-break:break-all; }}
  .detail pre {{ margin-top:8px; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; font-size:11px; overflow-x:auto; max-height:260px; color:var(--text); white-space:pre-wrap; word-break:break-all; }}
  .dim {{ color:var(--dim); }}
  .empty {{ padding:14px 12px; font-size:12px; color:var(--dim); }}
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
    <span class="badge" id="mode">…</span>
    <span class="badge" id="state">…</span>
    <span class="badge" id="conn">…</span>
  </div>

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
      <div class="engram-overview">
        <span class="k">链</span><span class="v" id="a-count">…</span>
        <span class="k">queried_by</span><span class="v" id="a-by">…</span>
        <span class="k" id="a-err" style="color:var(--bad);"></span>
        <span class="engram-filter"><input id="a-filter" placeholder="过滤 trace_id" onkeydown="if(event.key==='Enter')applyFilter();if(event.key==='Escape')clearFilter();"><button class="btn" onclick="applyFilter()">过滤</button><button class="btn" onclick="clearFilter()">清</button></span>
      </div>
      <div class="engram-main">
        <div class="timeline" id="a-timeline"><div class="empty">等待链数据…</div></div>
        <div class="detail" id="a-detail"><div class="empty">选择一行查看完整印痕</div></div>
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

  function esc(s) {{ return String(s).replace(/[&<>"']/g, function (c) {{ return {{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]; }}); }}
  function showView(v) {{
    document.getElementById('view-cockpit').style.display = v==='cockpit' ? '' : 'none';
    document.getElementById('view-engram').style.display = v==='engram' ? '' : 'none';
    document.getElementById('v-cockpit').className = 'btn' + (v==='cockpit' ? ' on' : '');
    document.getElementById('v-engram').className = 'btn' + (v==='engram' ? ' on' : '');
  }}

  function rowSummary(e) {{
    var d = e.payload.data || {{}};
    var action = d.action || '-';
    var status = d.status != null ? ' [' + d.status + ']' : '';
    return '#' + String(e.seq).padStart(4,'0') + ' ' + esc(e.payload.kind) + ' ' + esc(e.payload.trace_id) + ' ' + esc(action) + status;
  }}

  function renderAudit() {{
    var box = document.getElementById('a-timeline');
    var filtered = entries;
    var f = document.getElementById('a-filter').value.trim();
    if (f) {{ filtered = entries.filter(function(e){{ return (e.payload.trace_id||'').indexOf(f) >= 0; }}); }}
    if (!entries.length) {{
      box.innerHTML = '<div class="empty">' + (tuckConfigured ? '链为空（尚无推理调用）' : '未配置 Tuck —— 启动时加 --tuck-endpoint 与 --tuck-key') + '</div>';
      return;
    }}
    if (!filtered.length) {{ box.innerHTML = '<div class="empty">无匹配条目</div>'; return; }}
    box.innerHTML = '';
    filtered.slice().reverse().forEach(function (e, i) {{
      var div = document.createElement('div');
      div.className = 'row' + (selected === e.seq ? ' sel' : '');
      div.innerHTML = rowSummary(e);
      div.onclick = function () {{ selectEntry(e.seq); }};
      box.appendChild(div);
    }});
  }}

  function renderDetail() {{
    var box = document.getElementById('a-detail');
    if (selected == null) {{ box.innerHTML = '<div class="empty">选择一行查看完整印痕</div>'; return; }}
    var e = null;
    for (var i = 0; i < entries.length; i++) {{ if (entries[i].seq === selected) {{ e = entries[i]; break; }} }}
    if (!e) return;
    var d = e.payload.data || {{}};
    var caller = d.caller ? (d.caller.api_key_id || d.caller.sub || JSON.stringify(d.caller)) : '—';
    var dest = d.destination || '—';
    var status = d.status != null ? d.status : '—';
    var verdicts = (d.verdicts || []).join(', ') || '—';
    var html = '';
    html += '<div class="line"><span class="key">seq</span><span class="val">' + e.seq + '</span></div>';
    html += '<div class="line"><span class="key">ts</span><span class="val">' + esc(e.ts) + '</span></div>';
    html += '<div class="line"><span class="key">kind</span><span class="val">' + esc(e.payload.kind) + '</span></div>';
    html += '<div class="line"><span class="key">trace_id</span><span class="val">' + esc(e.payload.trace_id) + '</span></div>';
    html += '<div class="line"><span class="key">caller</span><span class="val">' + esc(caller) + '</span></div>';
    html += '<div class="line"><span class="key">destination</span><span class="val">' + esc(dest) + '</span></div>';
    html += '<div class="line"><span class="key">status</span><span class="val">' + esc(status) + '</span></div>';
    html += '<div class="line"><span class="key">verdicts</span><span class="val">' + esc(verdicts) + '</span></div>';
    html += '<div class="line"><span class="key">prev_hash</span><span class="val">' + esc(e.prev_hash || '') + '</span></div>';
    html += '<div class="line"><span class="key">hash</span><span class="val">' + esc(e.hash || '') + '</span></div>';
    html += '<div class="line"><span class="key">payload</span></div><pre>' + esc(JSON.stringify(d, null, 2)) + '</pre>';
    box.innerHTML = html;
  }}

  function selectEntry(seq) {{ selected = seq; renderAudit(); renderDetail(); }}
  function applyFilter() {{ selected = null; renderAudit(); renderDetail(); }}
  function clearFilter() {{ document.getElementById('a-filter').value = ''; selected = null; renderAudit(); renderDetail(); }}

  function pollAudit() {{
    fetch('/api/audit').then(function (r) {{ return r.json(); }}).then(function (j) {{
      var by = document.getElementById('a-by');
      var err = document.getElementById('a-err');
      by.textContent = j.queried_by || '—';
      if (j.configured === false) {{ err.textContent = '未配置 Tuck（--tuck-endpoint + --tuck-key）'; }}
      else if (j.error) {{ err.textContent = 'Tuck 不可达: ' + j.error; }}
      else {{ err.textContent = ''; }}
      entries = j.entries || [];
      document.getElementById('a-count').textContent = entries.length ? ('#' + entries[entries.length-1].seq + ' · ' + entries.length + ' 条') : '空';
      renderAudit(); renderDetail();
    }}).catch(function (e) {{
      document.getElementById('a-err').textContent = 'audit 拉取失败: ' + e;
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

  tick(); pollAudit();
  setInterval(tick, refresh * 1000);
  setInterval(pollAudit, refresh * 1000);
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
        assert!(html.contains("trace_id"));
        assert!(html.contains("prev_hash"));
        assert!(html.contains("Ledger 白盒"));
    }
}
