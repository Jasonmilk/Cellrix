//! `up` forwarding entry (Cellrix side).
//!
//! Thin door to the Anaphase launcher (ADR-0011..0013): the launcher owns
//! the full-stack logic, this bin only locates it and execs it with the
//! anaphase-helix working directory (the launcher reads `config.toml` from
//! cwd and starts `./target/debug/...` binaries relative to it).
//!
//! Zero duplication (DNA reuse): the interactive menu, readiness probes and
//! status polling all live in Anaphase `up` — running it from Cellrix means
//! the same experience, one command.

use std::path::Path;
use std::process::{Command, exit};

/// Anaphase launcher binary, relative to the Cellrix crate directory.
/// Workspace layout fact: sibling repos under the fixed workspace root
/// (ECOSYSTEM.md §0).
const ANAPHASE_UP_REL: &str = "../anaphase-helix/target/debug/up";
/// Anaphase launcher working directory (where its `config.toml` lives).
const ANAPHASE_DIR_REL: &str = "../anaphase-helix";

fn main() {
    if !Path::new(ANAPHASE_UP_REL).exists() {
        eprintln!("[up] Anaphase 启动器未构建 — 先在 anaphase-helix 目录执行:");
        eprintln!("     cd ../anaphase-helix && cargo build --bin up");
        exit(1);
    }
    // `status()` inherits stdio: the interactive menu works as-is.
    let status = Command::new(ANAPHASE_UP_REL)
        .current_dir(ANAPHASE_DIR_REL)
        .status()
        .expect("failed to run Anaphase launcher");
    exit(status.code().unwrap_or(1));
}
