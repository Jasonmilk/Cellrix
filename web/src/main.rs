//! `cellrix-web` — Anaphase cockpit + Engram web panel (candidate G2, ADR-0014).
//!
//! Thin entry: config + server modules carry the logic; this file holds the
//! entry point, the asset-assembled index page and the unit tests. Per the
//! 400-line decoupling red line (DNA v1.1), any file growing past 400 lines
//! must be split — assets live in `web/assets/`, logic in `server.rs`/`config.rs`.

mod config;
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

/// The embedded panel page: native JS polls `/api/snapshot` + `/api/audit`
/// and renders the two projections of the same truth the TUI shows.
/// No frameworks, no build step. View switch mirrors the TUI's Ctrl+E.
///
/// 资产化拼装（ADR-0015 D8 / 解耦）：视图 HTML/CSS/JS 全部独立为
/// web/assets/*.html，宿主只做 replace 拼装——零 format! 转义，
/// 资产内部 `{}` 自由书写。动态值仅 __REFRESH__ / __TUCK_CONFIGURED__。
fn index_html(cfg: &PanelConfig) -> String {
    const BASE: &str = include_str!("../assets/base.html");
    const TOKENS: &str = include_str!("../assets/tokens.html");
    const COMPONENTS: &str = include_str!("../assets/components.html");
    const COCKPIT: &str = include_str!("../assets/cockpit.html");
    const CHAT: &str = include_str!("../assets/chat.html");
    const ENGRAM: &str = include_str!("../assets/engram.html");
    const SCRIPT: &str = include_str!("../assets/script.html");
    const GLEAM: &str = include_str!("../assets/gleam.html");

    let tuck_configured = cfg.tuck_endpoint.is_some();
    BASE
        .replace("__TOKENS__", TOKENS)
        .replace("__COMPONENTS__", COMPONENTS)
        .replace("__COCKPIT__", COCKPIT)
        .replace("__CHAT__", CHAT)
        .replace("__ENGRAM__", ENGRAM)
        .replace("__SCRIPT__", SCRIPT)
        .replace("__GLEAM__", GLEAM)
        .replace("__REFRESH__", &config::REFRESH_SECS.to_string())
        .replace("__TUCK_CONFIGURED__", &tuck_configured.to_string())
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
