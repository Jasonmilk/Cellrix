//! `cellrix-web` — Anaphase cockpit + ProveTrack web panel (candidate G2, ADR-0014).
//!
//! Thin entry: config + server modules carry the logic; this file holds the
//! entry point, the asset-assembled index page and the unit tests. Per the
//! 400-line decoupling red line (DNA v1.1), any file growing past 400 lines
//! must be split — assets live in `web/assets/`, logic in `server.rs`/`config.rs`.

mod boot;
mod config;
mod routes;
mod server;

use std::net::TcpListener;
use std::thread;

use config::{PanelConfig, WEB_PORT_DEFAULT};
use server::{handle, health_check, panel_already_up};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let cfg = PanelConfig::derive(&args);

    let port = args
        .windows(2)
        .find(|w| w[0] == "--port")
        .and_then(|w| w[1].parse::<u16>().ok())
        .or_else(|| std::env::var("WEB_PORT").ok().and_then(|v| v.parse().ok()))
        .unwrap_or(WEB_PORT_DEFAULT);

    println!("cellrix-web: cockpit+prove_track panel on http://127.0.0.1:{port}");
    println!("             anaphase snapshot @ {}", cfg.anaphase_endpoint);
    match &cfg.tuck_endpoint {
        Some(ep) => println!("             prove_track chain @ {ep} (limit {})", cfg.tuck_limit),
        None => println!("             prove_track: off (pass --tuck-endpoint + --tuck-key to enable)"),
    }
    // White-box self-report (ADR-0021 T1a): name the live assembly graph rather
    // than leave the operator to infer it from the binary's age.
    match boot::graph() {
        Ok(g) => println!("             {}", boot::describe(&g)),
        Err(e) => eprintln!("cellrix-web: 起搏图损坏: {e}"),
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

/// The embedded panel page: native JS polls `/api/snapshot` + `/api/audit`
/// and renders the two projections of the same truth the TUI shows.
/// No frameworks, no build step. View switch mirrors the TUI's Ctrl+E.
///
/// 起搏图装配（ADR-0021 T1a）：面板由什么构成是**数据**——顺序与映射住在
/// `web/assets/boot.json`，不再散落为本文件里的 23 次 `replace`。机制在
/// `boot.rs`；本函数只取结果，并把装配失败变成**响亮的诚实状态**。
///
/// 资产仍是编译期 `include_str!` 嵌入（零构建步骤，ADR-0016 D7），所以
/// "哪些字节被嵌入"必然留在 `boot.rs` 的清单里——那是嵌入清单，不是装配逻辑。
///
/// Nothing from `PanelConfig` is injected today, so the parameter is unused —
/// it stays so callers don't churn when the first dynamic value lands (e.g.
/// injecting the flowmodus endpoint for the Flows view).
fn index_html(_cfg: &PanelConfig) -> String {
    match boot::render_index() {
        Ok(page) => page,
        // Loud, honest failure: a broken graph is a build mistake, and naming it
        // in the browser beats a blank panel (fail-loud, never silent).
        Err(e) => {
            eprintln!("cellrix-web: 起搏图损坏: {e}");
            boot::failure_page(&e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    use config::{ANAPHASE_ENDPOINT_DEFAULT, TUCK_LIMIT_DEFAULT};
    use server::{route, Route};

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
    fn config_derive_flowmodus_defaults_to_the_protocol_port() {
        // It used to be flag/env-only, so whichever launcher forgot the flag
        // produced a silently empty Flows view — and `up` was exactly that
        // launcher. A display source with a documented protocol port must not
        // depend on remembering a flag.
        let cfg = PanelConfig::derive(&["cellrix-web".to_string()]);
        assert_eq!(cfg.flowmodus_url.as_deref(), Some(config::FLOWMODUS_URL_DEFAULT));

        // The flag still wins when the operator points somewhere else.
        let cfg = PanelConfig::derive(&[
            "cellrix-web".to_string(),
            "--flowmodus-url".to_string(),
            "http://127.0.0.1:7000".to_string(),
        ]);
        assert_eq!(cfg.flowmodus_url.as_deref(), Some("http://127.0.0.1:7000"));
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
    fn index_html_contains_both_views_and_prove_track_fields() {
        let cfg = PanelConfig {
            anaphase_endpoint: ANAPHASE_ENDPOINT_DEFAULT.to_string(),
            tuck_endpoint: Some("http://127.0.0.1:60052".to_string()),
            tuck_key: Some("tk-local-gate".to_string()),
            tuck_limit: 200,
            flowmodus_url: Some("http://127.0.0.1:60053".to_string()),
        };
        let html = index_html(&cfg);
        assert!(html.contains("驾驶舱 Cockpit"));
        assert!(html.contains("证轨 ProveTrack"));
        assert!(html.contains("/api/audit"));
        assert!(html.contains("Ledger 白盒"));
        // ProveTrack v3: experience sidebar + trajectory skeleton (v11.2.0).
        assert!(html.contains("id=\"s-side\""));
        assert!(html.contains("id=\"s-main\""));
        assert!(html.contains("id=\"chat-side\""));
        assert!(html.contains("__proveTrackLoad"));
        assert!(html.contains("id=\"eTblVp\""));
        assert!(html.contains("id=\"eLaneInput\""));
        assert!(html.contains("id=\"eInsp\""));
        assert!(html.contains("loadEcosystem"));
        assert!(html.contains("id=\"eco\""));
        assert!(html.contains("/api/ecosystem"));

        // ADR-0016: first-byte regression net. base.html once carried a stray
        // `        r#"` prefix — left over from extracting the Rust raw string —
        // which pushed DOCTYPE off byte 0 (quirks mode) and rendered a literal
        // `r#"` on screen. Every assertion above used `contains` and never saw it.
        assert!(html.starts_with("<!DOCTYPE html>"));
        // Derived invariant: every `__NAME__` token appearing in base.html is a
        // placeholder the assembly must consume. Deriving the list from BASE
        // (instead of hardcoding it) means a newly added placeholder is covered
        // automatically — forget its replace() and this fails, instead of
        // shipping a literal `__FOO__` into the DOM. The old assertion only
        // looked for `__PROVE_TRACK`, so any other placeholder could slip by.
        let base = include_str!("../assets/base.html");
        let mut i = 0;
        let mut checked = 0usize;
        while let Some(off) = base[i..].find("__") {
            let start = i + off;
            let rest = &base[start + 2..];
            if let Some(end) = rest.find("__") {
                let name = &rest[..end];
                if !name.is_empty()
                    && name.chars().all(|c| c.is_ascii_uppercase() || c == '_')
                {
                    let token = &base[start..start + 2 + end + 2];
                    assert!(!html.contains(token), "placeholder {token} survived assembly");
                    checked += 1;
                }
            }
            i = start + 2;
        }
        // The scan must have found them — otherwise it would pass vacuously.
        assert!(checked >= 21, "placeholder scan found only {checked} tokens");
        // ADR-0016: all four split assets must land in the page.
        assert!(html.contains("--e-trk-tl")); // prove_track.css (tokens)
        assert!(html.contains("function buildSession")); // prove_track.node.js
        assert!(html.contains("function renderTable")); // prove_track.view.js
        assert!(html.contains("window.CxProveTrack")); // cross-asset bridge
        assert!(html.contains("__proveTrackClear")); // prove_track.js (ctrl)
        // ADR-0015 D8 follow-through: the split view assets land too, and the
        // shell's view switch is driven by the markup rather than by a
        // hardcoded list (adding a view must not touch the shell).
        assert!(html.contains("window.CxCockpit")); // cockpit.js
        assert!(html.contains("window.sendChat")); // chat.js
        assert!(html.contains("Cx.onEnter")); // view-registration seam
        assert!(html.contains("data-view=\"cockpit\"")); // base.html nav
        assert!(!html.contains("onclick=\"showView(")); // nav no longer inlines it
        assert!(html.contains("__CHAT_JS__") == false); // and it was substituted
    }
}
