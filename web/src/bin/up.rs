//! `up` — one command to the cockpit: ensure Anaphase + Tuck are healthy
//! (auto-start them when a `--*-cmd` is given), then launch the web panel
//! and open the browser. After this command you do not need another one.
//!
//! Decoupling: `up` never guesses where Anaphase/Tuck live or how they are
//! configured — their start commands come from `--anaphase-cmd` /
//! `--tuck-cmd` (or `UP_ANAPHASE_CMD` / `UP_TUCK_CMD`). With no command
//! given, a missing component is reported with a pointer to README §Run
//! instead of being silently skipped (物理事实优先).
//!
//! The web binary path is injected at compile time (`CARGO_BIN_EXE_`), so
//! there is no runtime path guessing — 0 hardcoding, deterministic.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use cellrix_web::probe;

/// How long to wait for a component to become healthy after starting it.
/// Protocol default — overridable with `--wait`.
const WAIT_DEFAULT_SECS: u64 = 30;
/// Poll interval while waiting for health.
const POLL_INTERVAL_MS: u64 = 500;
/// Default web port when no `--port`/`WEB_PORT` is given (mirrors the panel).
const WEB_PORT_DEFAULT: u16 = 8080;
/// Default Anaphase cap_http endpoint when not given (mirrors the panel).
const ANAPHASE_ENDPOINT_DEFAULT: &str = "http://127.0.0.1:50061";

fn flag<'a>(args: &'a [String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|w| w[0] == name)
        .map(|w| w[1].clone())
        .filter(|v| !v.is_empty())
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

/// Spawn a start command detached (it keeps running after `up` exits).
fn spawn_detached(cmd: &str) -> Result<(), String> {
    Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("spawn failed: {e}"))
}

/// Wait until the probe succeeds or the deadline passes.
fn poll_until(
    name: &str,
    base: &str,
    path: &str,
    bearer: Option<&str>,
    wait_secs: u64,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(wait_secs);
    loop {
        match probe(base, path, bearer) {
            Ok(()) => return Ok(()),
            Err(e) if Instant::now() >= deadline => {
                return Err(format!("{name} not healthy within {wait_secs}s (last: {e})"))
            }
            Err(_) => std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS)),
        }
    }
}

/// Ensure one component is healthy: already up → ok; down + start command →
/// spawn and poll; down + no command → Err with guidance (never silently
/// skipped).
fn ensure(
    name: &str,
    base: &str,
    path: &str,
    bearer: Option<&str>,
    cmd: Option<&str>,
    wait_secs: u64,
) -> Result<(), String> {
    match probe(base, path, bearer) {
        Ok(()) => {
            println!("{name}: ✅ already healthy");
            Ok(())
        }
        Err(e) => match cmd {
            Some(c) => {
                println!("{name}: ❌ down ({e}) — starting: {c}");
                spawn_detached(c)?;
                poll_until(name, base, path, bearer, wait_secs)
            }
            None => Err(format!(
                "{name} not running ({e})\n  → pass --{name}-cmd \"...\" to auto-start, or start it manually (README §Run)"
            )),
        },
    }
}

/// Locate the panel binary: cargo injects `CARGO_BIN_EXE_cellrix-web` under
/// `cargo run`/`cargo test`; when the binary is executed directly, derive it
/// deterministically as the sibling of this executable (same build dir) —
/// no hardcoded path either way (0 hardcoding).
fn web_bin() -> String {
    if let Ok(p) = std::env::var("CARGO_BIN_EXE_cellrix-web") {
        return p;
    }
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    dir.join("cellrix-web").to_string_lossy().into_owned()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    let anaphase_endpoint = flag(&args, "--anaphase-endpoint")
        .or_else(|| env("ANAPHASE_ENDPOINT"))
        .unwrap_or_else(|| ANAPHASE_ENDPOINT_DEFAULT.to_string());
    let tuck_endpoint = flag(&args, "--tuck-endpoint").or_else(|| env("TUCK_ENDPOINT"));
    let tuck_key = flag(&args, "--tuck-key").or_else(|| env("TUCK_KEY"));
    let anaphase_cmd = flag(&args, "--anaphase-cmd").or_else(|| env("UP_ANAPHASE_CMD"));
    let tuck_cmd = flag(&args, "--tuck-cmd").or_else(|| env("UP_TUCK_CMD"));
    let wait_secs = flag(&args, "--wait")
        .and_then(|v| v.parse().ok())
        .unwrap_or(WAIT_DEFAULT_SECS);
    let port = flag(&args, "--port")
        .and_then(|v| v.parse().ok())
        .or_else(|| env("WEB_PORT").and_then(|v| v.parse().ok()))
        .unwrap_or(WEB_PORT_DEFAULT);
    let no_open = args.iter().any(|a| a == "--no-open");

    println!("up: one command to the cockpit");
    println!("  anaphase @ {anaphase_endpoint}");
    if let Some(ep) = &tuck_endpoint {
        println!("  tuck @ {ep}");
    } else {
        println!("  tuck: not configured (pass --tuck-endpoint + --tuck-key)");
    }

    // 1. Anaphase self-check first — the cockpit's own source of truth.
    ensure(
        "anaphase",
        &anaphase_endpoint,
        "/v1/health",
        None,
        anaphase_cmd.as_deref(),
        wait_secs,
    )?;

    // 2. Tuck audit chain (optional — the panel degrades without it).
    if let Some(ep) = &tuck_endpoint {
        let key = tuck_key.as_deref().unwrap_or("");
        ensure(
            "tuck",
            ep,
            "/v1/audit?limit=1",
            Some(key),
            tuck_cmd.as_deref(),
            wait_secs,
        )?;
    }

    // 3. Launch the panel (deterministic sibling path) and open the browser.
    let web = web_bin();
    let mut cmd = Command::new(web);
    cmd.arg("--anaphase-endpoint")
        .arg(&anaphase_endpoint)
        .arg("--port")
        .arg(port.to_string());
    if let Some(ep) = &tuck_endpoint {
        cmd.arg("--tuck-endpoint").arg(ep);
    }
    if let Some(k) = &tuck_key {
        cmd.arg("--tuck-key").arg(k);
    }
    if !no_open {
        cmd.arg("--open");
    }
    let mut child = cmd.spawn().map_err(|e| format!("launch web: {e}"))?;
    println!("up: panel launched — Ctrl+C here to stop it");
    let status = child.wait()?;
    if !status.success() {
        eprintln!("up: panel exited abnormally: {status}");
    }
    Ok(())
}
