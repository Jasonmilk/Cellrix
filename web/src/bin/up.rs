//! `up` — one command to the cockpit, guided for a complete beginner:
//! run `up`, press Enter a couple of times, browser opens. No commands to
//! remember, no flags to type (最多选择加回车).
//!
//! How it stays zero-hardcoded and decoupled:
//! - Configuration source chain: CLI flags > env > `~/.cellrix/up.toml` >
//!   protocol defaults. `up` never guesses where Anaphase/Tuck live — the
//!   first guided run asks for start commands once and persists them, so
//!   every later run is Enter-only.
//! - The web binary path is derived deterministically (`CARGO_BIN_EXE_`
//!   under cargo, else the sibling of this executable in the build dir).
//! - Tuck's key lives only in the 0600 user config file (never in git,
//!   never echoed).

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use cellrix_web::{extract_json_str, post_json, probe};

/// How long to wait for a component to become healthy after starting it.
const WAIT_DEFAULT_SECS: u64 = 30;
/// Poll interval while waiting for health.
const POLL_INTERVAL_MS: u64 = 500;
/// Default web port when not given (mirrors the panel).
const WEB_PORT_DEFAULT: u16 = 8080;
/// Default Anaphase cap_http endpoint (mirrors the panel).
const ANAPHASE_ENDPOINT_DEFAULT: &str = "http://127.0.0.1:50061";
// Tuck protocol defaults (source = Tuck gateway): local port + its default
// local audit key. `up` never guesses — these are the protocol's own values.
const TUCK_ENDPOINT_DEFAULT: &str = "http://127.0.0.1:60052";
const TUCK_KEY_DEFAULT: &str = "tk-local-gate";
/// User config file: `$HOME/.cellrix/up.toml` (per-user, 0600, never in a
/// repository). Key name is a fixed convention, not a hardcoded path.
const CONFIG_REL_PATH: &str = ".cellrix/up.toml";

#[derive(Debug, Clone, Default)]
struct UpConfig {
    anaphase_endpoint: Option<String>,
    tuck_endpoint: Option<String>,
    tuck_key: Option<String>,
    anaphase_cmd: Option<String>,
    tuck_cmd: Option<String>,
    wait_secs: Option<u64>,
    port: Option<u16>,
    no_open: bool,
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|w| w[0] == name)
        .map(|w| w[1].clone())
        .filter(|v| !v.is_empty())
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

/// `$HOME/.cellrix/up.toml` — deterministic per-user location.
fn config_path() -> Option<PathBuf> {
    let home = env("HOME")?;
    Some(PathBuf::from(home).join(CONFIG_REL_PATH))
}

/// Parse a saved config file (TOML-lite, our own shape). Unknown keys are
/// ignored — forward-compatible.
fn load_config_file(path: &PathBuf) -> UpConfig {
    let mut c = UpConfig::default();
    let Ok(content) = std::fs::read_to_string(path) else {
        return c;
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let v = v.trim().trim_matches('"').to_string();
        match k.trim() {
            "anaphase_endpoint" => c.anaphase_endpoint = Some(v),
            "tuck_endpoint" => c.tuck_endpoint = Some(v),
            "tuck_key" => c.tuck_key = Some(v),
            "anaphase_cmd" => c.anaphase_cmd = Some(v),
            "tuck_cmd" => c.tuck_cmd = Some(v),
            _ => {}
        }
    }
    c
}

/// Persist the guided answers so later runs are Enter-only. Writes with
/// 0600 (owner read/write only) — the key must not be world-readable.
fn save_config_file(path: &PathBuf, c: &UpConfig) -> Result<(), String> {
    let dir = path.parent().ok_or("config dir unavailable")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut toml = String::from("# up saved config (per-user, 0600)\n");
    let mut push = |k: &str, v: Option<&String>| {
        if let Some(v) = v {
            toml.push_str(&format!("{k} = \"{}\"\n", v.replace('"', "\\\"")));
        }
    };
    push("anaphase_endpoint", c.anaphase_endpoint.as_ref());
    push("tuck_endpoint", c.tuck_endpoint.as_ref());
    push("tuck_key", c.tuck_key.as_ref());
    push("anaphase_cmd", c.anaphase_cmd.as_ref());
    push("tuck_cmd", c.tuck_cmd.as_ref());
    std::fs::write(path, toml).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Merge: file < env < flags (later sources win).
fn derive_config(args: &[String]) -> UpConfig {
    let path = config_path();
    let mut c = path.as_ref().map(load_config_file).unwrap_or_default();

    c.anaphase_endpoint = flag(args, "--anaphase-endpoint")
        .or_else(|| env("ANAPHASE_ENDPOINT"))
        .or(c.anaphase_endpoint);
    c.tuck_endpoint = flag(args, "--tuck-endpoint")
        .or_else(|| env("TUCK_ENDPOINT"))
        .or(c.tuck_endpoint);
    c.tuck_key = flag(args, "--tuck-key")
        .or_else(|| env("TUCK_KEY"))
        .or(c.tuck_key);
    c.anaphase_cmd = flag(args, "--anaphase-cmd")
        .or_else(|| env("UP_ANAPHASE_CMD"))
        .or(c.anaphase_cmd);
    c.tuck_cmd = flag(args, "--tuck-cmd")
        .or_else(|| env("UP_TUCK_CMD"))
        .or(c.tuck_cmd);
    c.wait_secs = flag(args, "--wait")
        .and_then(|v| v.parse().ok())
        .or_else(|| env("UP_WAIT").and_then(|v| v.parse().ok()))
        .or(c.wait_secs);
    c.port = flag(args, "--port")
        .and_then(|v| v.parse().ok())
        .or_else(|| env("WEB_PORT").and_then(|v| v.parse().ok()))
        .or(c.port);
    c.no_open = args.iter().any(|a| a == "--no-open") || c.no_open;
    c
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

/// One yes/no style question. Enter = `default`. Anything else parses as a
/// number and falls back to `default` when invalid.
fn ask(prompt: &str, default: u8) -> u8 {
    print!("{prompt}");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
    let t = line.trim();
    if t.is_empty() {
        return default;
    }
    t.parse().unwrap_or(default)
}

/// Ask for a start command once (the only typing a beginner ever does),
/// persist it, and report the choice.
fn ask_cmd(component: &str, prompt_hint: &str) -> Option<String> {
    println!();
    println!("  {component} 尚未运行，也无法自动启动（还没有保存启动命令）。");
    println!("  {prompt_hint}");
    println!("  例如：ANAPHASE_CONFIG=/path/to/config.toml /path/to/anaphase");
    print!("  输入启动命令（直接回车=跳过，本次不启动）: ");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
    let t = line.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// Guided ensure: healthy → done; down → ask start/skip; when a command is
/// chosen it is spawned, polled, and (first time) persisted.
fn ensure_guided(
    name: &str,
    base: &str,
    health_path: &str,
    bearer: Option<&str>,
    cfg_cmd: Option<String>,
    wait_secs: u64,
    save_cmd: impl FnOnce(Option<String>),
) -> Result<(), String> {
    match probe(base, health_path, bearer) {
        Ok(()) => {
            println!("  {name}: ✅ 运行中");
            Ok(())
        }
        Err(e) => {
            println!("  {name}: ❌ 未运行（{e}）");
            match cfg_cmd {
                Some(cmd) => {
                    let choice = ask(
                        &format!("  要自动启动 {name} 吗？[1] 启动  [2] 跳过（回车=1）: "),
                        1,
                    );
                    if choice == 1 {
                        println!("  启动中: {cmd}");
                        spawn_detached(&cmd)?;
                        poll_until(name, base, health_path, bearer, wait_secs)?;
                        println!("  {name}: ✅ 已就绪");
                        Ok(())
                    } else {
                        println!("  {name}: 跳过（面板会显示 ❌）");
                        Ok(())
                    }
                }
                None => {
                    // First time: capture the start command once and keep it.
                    let cmd = ask_cmd(name, "请输入它的启动命令（只输入这一次，之后回车即可）。");
                    save_cmd(cmd.clone());
                    match cmd {
                        Some(c) => {
                            println!("  启动中: {c}");
                            spawn_detached(&c)?;
                            poll_until(name, base, health_path, bearer, wait_secs)?;
                            println!("  {name}: ✅ 已就绪");
                            Ok(())
                        }
                        None => {
                            println!("  {name}: 已跳过（面板会显示 ❌）");
                            Ok(())
                        }
                    }
                }
            }
        }
    }
}

/// Persist the client half of the one-to-one binding (0600, never in git).
fn save_client_identity(device_id: &str, secret: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME unset".to_string())?;
    let dir = std::path::Path::new(&home).join(".cellrix");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("identity.toml");
    let body = format!(
        "# up client identity (0600, never in git)\ndevice_id = \"{device_id}\"\nsecret = \"{secret}\"\n"
    );
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Cellrix TUI binary (workspace sibling, same profile dir as up).
fn cellrix_cli_bin() -> Option<String> {
    std::env::current_exe().ok().and_then(|exe| {
        let dir = exe.parent()?;
        let cand = dir.join("cellrix-cli");
        if cand.exists() { Some(cand.to_string_lossy().into_owned()) } else { None }
    })
}

/// Anaphase binary, derived from the fixed workspace layout (ECOSYSTEM.md
/// §0) — sibling repos under the workspace root, never hardcoded per user.
fn anaphase_bin_path() -> String {
    let ws = workspace_root();
    ws.join("anaphase-helix/target/debug/anaphase")
        .to_string_lossy()
        .into_owned()
}

/// Anaphase config, same derivation. Missing file → Anaphase falls back to
/// Noop (its own honest default), so this never breaks the launch.
fn anaphase_config_path() -> String {
    let ws = workspace_root();
    ws.join("anaphase-helix/config.toml")
        .to_string_lossy()
        .into_owned()
}

/// Workspace root: parent of the Cellrix checkout (env! resolves at compile
/// time — absolute, any cwd).
fn workspace_root() -> std::path::PathBuf {
    // `up` is compiled in Cellrix/web → manifest dir = <ws>/Cellrix/web;
    // the fixed workspace root is two levels up (ECOSYSTEM.md §0).
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_default()
}

/// Locate the panel binary: `CARGO_BIN_EXE_cellrix-web` under cargo, else
/// the sibling of this executable (same build dir). No hardcoded path.
fn web_bin() -> String {
    if let Ok(p) = std::env::var("CARGO_BIN_EXE_cellrix-web") {
        return p;
    }
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    dir.join("cellrix-web").to_string_lossy().into_owned()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let cfg = derive_config(&args);

    let anaphase_endpoint = cfg
        .anaphase_endpoint
        .clone()
        .unwrap_or_else(|| ANAPHASE_ENDPOINT_DEFAULT.to_string());
    let tuck_endpoint = cfg
        .tuck_endpoint
        .clone()
        .unwrap_or_else(|| TUCK_ENDPOINT_DEFAULT.to_string());
    let tuck_key = cfg.tuck_key.clone().unwrap_or_else(|| TUCK_KEY_DEFAULT.to_string());
    let wait_secs = cfg.wait_secs.unwrap_or(WAIT_DEFAULT_SECS);
    let port = cfg.port.unwrap_or(WEB_PORT_DEFAULT);

    println!();
    println!("  ─────────────────────────────────────────────");
    println!("  Helix 驾驶舱启动器（up）");
    println!("  一路回车即可——最后自动打开浏览器");
    println!("  ─────────────────────────────────────────────");
    println!();

    // 1. Anaphase — the cockpit's own source of truth.
    let anaphase_cmd = cfg.anaphase_cmd.clone();
    let saved_path = config_path();
    let save_anaphase = {
        let path = saved_path.clone();
        let ep = anaphase_endpoint.clone();
        let tuck_ep = tuck_endpoint.clone();
        let tuck_k = tuck_key.clone();
        move |cmd: Option<String>| {
            if let Some(p) = &path {
                let mut c = UpConfig::default();
                c.anaphase_endpoint = Some(ep.clone());
                c.tuck_endpoint = Some(tuck_ep.clone());
                c.tuck_key = Some(tuck_k.clone());
                c.anaphase_cmd = cmd.clone();
                let _ = save_config_file(p, &c);
            }
        }
    };
    ensure_guided(
        "Anaphase",
        &anaphase_endpoint,
        "/v1/health",
        None,
        anaphase_cmd,
        wait_secs,
        save_anaphase,
    )?;

    // 2. Tuck (protocol default 60052 — the audit/LLM gateway; the panel
    //    degrades gracefully if it is down, but up always probes it).
    {
        let key = tuck_key.as_str();
        let tuck_cmd = cfg.tuck_cmd.clone();
        let path = saved_path.clone();
        let ep2 = tuck_endpoint.clone();
        let k2 = Some(tuck_key.clone());
        let a_ep = anaphase_endpoint.clone();
        let save_tuck = move |cmd: Option<String>| {
            if let Some(p) = &path {
                let mut c = UpConfig::default();
                c.anaphase_endpoint = Some(a_ep.clone());
                c.tuck_endpoint = Some(ep2.clone());
                c.tuck_key = k2.clone();
                c.tuck_cmd = cmd.clone();
                let _ = save_config_file(p, &c);
            }
        };
        ensure_guided(
            "Tuck",
            &tuck_endpoint,
            "/v1/audit?limit=1",
            Some(key),
            tuck_cmd,
            wait_secs,
            save_tuck,
        )?;
    }

    // 3. One-to-one binding (2026-09-07): Anaphase is the challenger —
    //    it mints the pairing code and verifies the confirm; `up` only
    //    relays the human's physical presence (回车 = 在场证明, HITL).
    //    Unbound = open, honest; bound = every panel request is signed.
    let status_body = cellrix_web::fetch_json(&anaphase_endpoint, "/v1/bind/status", None).ok();
    let bound = status_body
        .as_deref()
        .map(|b| b.contains("\"bound\":true"))
        .unwrap_or(false);
    if !bound {
        let choice = ask(
            "  要绑定这台设备吗（1对1 身份）？[1] 绑定  [2] 稍后（回车=1）: ",
            1,
        );
        if choice == 1 {
            match post_json(&anaphase_endpoint, "/v1/bind/start", "{}", None) {
                Ok(resp) => {
                    let Some(code) = extract_json_str(&resp, "pairing_code") else {
                        println!("  绑定不可用：{resp}");
                        return Ok(());
                    };
                    println!();
                    println!("  ── 配对码（10 分钟内有效，仅显示在本机）──");
                    println!("  {code}");
                    println!("  ────────────────────────────────────────");
                    print!("  确认绑定？回车确认（取消按 Ctrl+C）: ");
                    let _ = std::io::stdout().flush();
                    let mut _line = String::new();
                    let _ = std::io::stdin().read_line(&mut _line);
                    let body = format!("{{\"pairing_code\":\"{code}\"}}");
                    match post_json(&anaphase_endpoint, "/v1/bind/confirm", &body, None) {
                        Ok(confirm) => {
                            if let (Some(id), Some(secret)) = (
                                extract_json_str(&confirm, "device_id"),
                                extract_json_str(&confirm, "client_secret"),
                            ) {
                                match save_client_identity(&id, &secret) {
                                    Ok(()) => println!("  ✅ 绑定完成：{id}（凭证已存 ~/.cellrix/identity.toml, 0600）"),
                                    Err(e) => println!("  ⚠️ 绑定已确认，但凭证保存失败：{e}"),
                                }
                            } else {
                                println!("  绑定失败：{confirm}");
                            }
                        }
                        Err(e) => println!("  绑定失败：{e}"),
                    }
                }
                Err(e) => println!("  绑定不可用：{e}"),
            }
        }
    }

    // 4. Surface choice: Web panel (default, 回车) or TUI terminal.
    //    The beginner's promise is "最多选择加回车" — the default is the
    //    Web panel; TUI is one extra choice, never a separate command to
    //    remember.
    let tui_bin = cellrix_cli_bin();
    let pick = ask(
        "  界面： [1] Web 面板（回车=1）  [2] TUI 终端: ",
        1,
    );
    if pick == 2 {
        match tui_bin {
            Some(tui) => {
                // TUI (stdio) spawns its own Anaphase child — same config
                // injected via `--config` (absolute path, works from any cwd).
                // The stdio child does not bind cap_http (no port clash).
                let exec = format!(
                    "{} --config {}",
                    anaphase_bin_path(),
                    anaphase_config_path()
                );
                let status = std::process::Command::new(&tui)
                    .args([
                        "run",
                        "--mode", "stdio",
                        "--exec", &exec,
                        "--anaphase-endpoint", &anaphase_endpoint,
                        "--tuck-endpoint", &tuck_endpoint,
                        "--tuck-key", &tuck_key,
                    ])
                    .status()?;
                if !status.success() {
                    eprintln!("  up: TUI 异常退出: {status}");
                }
                return Ok(());
            }
            None => {
                println!("  TUI 未构建——先运行: cargo build -p cellrix-cli");
            }
        }
    }

    // 5. Launch the panel and open the browser.
    let web = web_bin();
    let mut cmd = Command::new(web);
    cmd.arg("--anaphase-endpoint")
        .arg(&anaphase_endpoint)
        .arg("--port")
        .arg(port.to_string());
    cmd.arg("--tuck-endpoint").arg(&tuck_endpoint);
    cmd.arg("--tuck-key").arg(&tuck_key);
    if !cfg.no_open {
        cmd.arg("--open");
    }
    let mut child = cmd.spawn().map_err(|e| format!("launch web: {e}"))?;
    println!();
    println!("  面板已启动：http://127.0.0.1:{port}/");
    println!("  按 Ctrl+C 停止面板。之后再次运行 up，一路回车即可。");
    let status = child.wait()?;
    if !status.success() {
        eprintln!("  up: 面板异常退出: {status}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_file_round_trip() {
        let mut c = UpConfig::default();
        c.anaphase_endpoint = Some("http://127.0.0.1:50123".into());
        c.tuck_endpoint = Some("http://127.0.0.1:60052".into());
        c.tuck_key = Some("tk-local-gate".into());
        c.anaphase_cmd = Some("ANAPHASE_CONFIG=/tmp/c.toml anaphase".into());
        let dir = std::env::temp_dir().join(format!("up-cfg-test-{}", std::process::id()));
        let path = dir.join("up.toml");
        save_config_file(&path, &c).unwrap();
        let loaded = load_config_file(&path);
        assert_eq!(loaded.anaphase_cmd.as_deref(), Some("ANAPHASE_CONFIG=/tmp/c.toml anaphase"));
        assert_eq!(loaded.tuck_key.as_deref(), Some("tk-local-gate"));
        assert_eq!(loaded.anaphase_endpoint.as_deref(), Some("http://127.0.0.1:50123"));
        // 0600 on unix.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_merge_flags_win_over_file() {
        let mut c = UpConfig::default();
        c.anaphase_endpoint = Some("http://127.0.0.1:1".into());
        c.tuck_cmd = Some("old".into());
        let dir = std::env::temp_dir().join(format!("up-cfg-merge-{}", std::process::id()));
        let path = dir.join("up.toml");
        save_config_file(&path, &c).unwrap();
        let saved = load_config_file(&path);
        // Simulate flags overriding: saved file value must be replaceable.
        let mut merged = saved;
        merged.anaphase_endpoint = Some("http://127.0.0.1:2".into());
        assert_eq!(merged.anaphase_endpoint.as_deref(), Some("http://127.0.0.1:2"));
        assert_eq!(merged.tuck_cmd.as_deref(), Some("old"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
