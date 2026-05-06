# Cellrix

**An intent-driven, deterministic, spatial-semantic terminal UI protocol and high-performance runtime.**

> *Cellrix is not just a tool for the terminal age. It is an OS-grade UI protocol built for the post-AGI era — bridging the comprehension gap between carbon-based and silicon-based minds.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![Ruff](https://img.shields.io/badge/linter-Ruff-brightgreen)](https://github.com/astral-sh/ruff)
[![Mypy](https://img.shields.io/badge/type--checker-Mypy-blue)](https://mypy-lang.org/)
[![Tests](https://img.shields.io/badge/tests-23%2F23%20passed-green)](#)

---

## Why Cellrix?

Modern terminal UIs require too much manual layout calculation, and web UIs are too heavy for fast‑moving backends and AI agents. Cellrix solves both with **declarative intent**.

Describe your interface in a strict JSON/YAML **Cell‑Manifest**, and the **Cellrix Runtime** deterministically computes the layout, data binding, and interaction — outputting a fully adaptive TUI (and GUI) in milliseconds.

| Traditional TUI | Cellrix |
|:---|:---|
| Hand‑computed x,y coordinates | Declare `weight`, `minConstraint`, `slot` |
| Hundreds of lines of code per pane | Single manifest, zero UI boilerplate |
| Screen reader unfriendly | Semantic tree aligned with W3C ARIA 1.3 |
| AI cannot understand the screen | AI reads the Semantic Tree directly |

---

## 🚀 Milestone: Interactive Workbench with Dynamic Data Pipes

The layout solver (pure function, O(N), zero‑reflow) now powers a fully interactive terminal dashboard with:

*   **Nano‑style self‑explaining interface** – single‑line status bar and a full‑screen help overlay (`F1`) that shows global and context‑sensitive shortcuts.
*   **Decoupled theme & keybinding system** – change colors or remap keys without touching a line of renderer code.
*   **Focus tracking** – `Tab` / `Shift+Tab` cycle through panels; active panel highlighted with a bold green border.
*   **Dynamic data pipes** – bind cells to real-time data sources (pipes, subprocesses) with `--trust` security gate.
*   **Stream mode** – pipe a stream of Manifest JSON lines into `cellrix stream` for real‑time updates.
*   **Robust cross‑platform input** – non‑blocking keyboard handling via `readchar`, zero flicker.

```bash
# Interactive static preview
cellrix preview examples/hello.json

# Real‑time dashboard with pipe source (clock example)
cellrix preview examples/dynamic_clock.json --trust

# Stream mode (consume Manifest JSON from stdin)
cat manifests_stream.ndjson | cellrix stream
```

---

## Current Status

| Gate | Status |
|:---|:---|
| Protocol Spec (WHITEPAPER.md v2.0) | ✅ Finalized |
| Engineering Guide (10 chapters) | ✅ Complete |
| Manifest Parser + Strict Validation | ✅ Complete |
| ANSI Sanitizer + Capability Validator | ✅ Complete |
| `ruff check` | ✅ All checks passed |
| `mypy --strict` (21 source files) | ✅ Success, 0 errors |
| Layout Solver + Rendering | ✅ Interactive workbench live |
| Dynamic Data Pipes (SourceManager) | ✅ `--trust` gate enabled |
| Stream Mode (stdin ndjson) | ✅ Interactive after stream ends |

---

## Quick Start

**Requirements:** Python 3.11+, [`uv`](https://astral.sh/uv)

```bash
git clone git@github.com:Jasonmilk/Cellrix.git
cd Cellrix
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
uv run cellrix preview examples/hello.json
```

---

## Design Philosophy — *The Cellrix Zen*

Every commit, every PR, every design decision must honor these six axioms:

1. **Orchestrate, Don't Build** – The runtime is a scheduler, not a renderer.
2. **Strict Contracts, Model Validation** – All communication via typed Pydantic models.
3. **Pure Streams & Hard Fails** – `stdout` for data, `stderr` for diagnostics, errors never swallowed.
4. **Absolute Idempotency** – Same manifest + terminal size = identical ViewTree.
5. **Radical Simplicity & Ecosystem Reuse** – Direct dependencies capped at ≤5; every new line must justify itself.
6. **Security‑First & Human‑in‑the‑Loop** – ANSI injection blocked; critical actions require physical approval.

---

## Repository Layout

```
cellrix/
├── core/                   # Protocol engine (parser, solver, security, source)
├── cli/                    # Interactive terminal client + theme & keybinding
├── devkit/                 # Templates, protocol bridges (MCP/AG-UI)
├── tests/                  # Unit + conformance suite
├── WHITEPAPER.md           # The Protocol Constitution
├── ARCHITECTURE.md         # Reference Implementation Decisions
├── ENGINEERING_GUIDE.md    # Construction Manual (Chinese)
└── pyproject.toml
```

## Quality Gates

```bash
uv run ruff check .          # Zero warnings
uv run ruff format . --check # Consistent formatting
uv run mypy --strict cli/ core/ devkit/  # Zero errors
uv run pytest                # 23/23 passing
```

---

## License

MIT. Do good, don't harm, keep it simple.

---

*If the white paper is the soul, this engine is the body. Both obey the same six laws.*

*中文版: [README.zh-CN.md](README.zh-CN.md)*
