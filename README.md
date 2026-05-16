# Cellrix

Cellrix is the reference TUI implementation of the [Common Intents Specification (CIS)](https://github.com/CommonIntents/CIS).

**An intent-driven, deterministic, spatial-semantic terminal UI protocol and high-performance runtime.**

> *Cellrix is not just a tool for the terminal age. It is an OS-grade UI protocol built for the post-AGI era — bridging the comprehension gap between carbon-based and silicon-based minds.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![Ruff](https://img.shields.io/badge/linter-Ruff-brightgreen)](https://github.com/astral-sh/ruff)
[![Mypy](https://img.shields.io/badge/type--checker-Mypy-blue)](https://mypy-lang.org/)
[![Tests](https://img.shields.io/badge/tests-35%2F35%20passed-green)](#)

---

## What is Cellrix?

Describe your terminal interface in a JSON file. Cellrix renders it — with layout, focus tracking, keyboard shortcuts, and a built‑in help system. No manual coordinate math, no boilerplate drawing code, no framework lock‑in.

Cellrix is a **protocol first**, not an implementation. The layout solver is a pure function: same manifest + same terminal size = identical result every time. The renderer is just one compliant consumer of the protocol.

**Two production‑grade adapters ship with Cellrix:**

| Adapter | Best for |
|:---|:---|
| `cellrix preview` (Rich) | Lightweight, zero‑config terminal preview |
| `cellrix run` (Textual) | Full‑screen interactive workbench with native widgets |


## Why Cellrix?

| Problem | Cellrix answer |
|:---|:---|
| TUI development is repetitive coordinate math | Declare `weight`, `minConstraint`, `slot` — Solver computes the rest |
| Every tool invents its own keyboard handling | Unified input routing via Keybindings (decoupled from renderer) |
| Terminal apps are invisible to screen readers | Semantic tree aligned with W3C ARIA 1.3 |
| AI agents cannot read terminal output | Semantic tree is structured JSON — no OCR needed |


## What can Cellrix do for you?

### Level 0: Validate First

```bash
cellrix check my-dashboard.json
# ✅ Manifest is valid.
```

### Level 1: Declare & Preview

```bash
cellrix preview hello.json
```

```json
{
  "version": "2.3",
  "layout": { "direction": "vertical", "slots": [{ "id": "main", "weight": 1 }] },
  "cells": [
    { "id": "greeting", "type": "static", "slot": "main", "content": "Hello, Cellrix!" }
  ]
}
```

Press `F1` or `?` for shortcuts. `Tab` to move focus. `q` to quit.

### Level 2: Design Layouts

Use `weight`, `minConstraint`, `collapseMode`, and nested slots for responsive layouts that adapt to terminal resizing.

### Level 3: Semantic Widgets (v2.3)

Render progress bars, tables, and lists directly from structured data:

| Widget | Data | Renders as |
|:---|:---|:---|
| `"progress"` | Number 0–100 | `████████████████░░░░ 75%` |
| `"table"` | 2‑D array | Pipe‑separated table |
| `"list"` | Array of strings | Bulleted list |

### Level 4: Dynamic Data Pipes

```bash
cellrix preview clock.json --trust
```

Cells update in real‑time from shell commands, log files, or sockets.

### Level 5: Stream & Embed

```bash
generate_manifests | cellrix stream
```

Or embed directly:

```python
from cli.runtime import CellrixRuntime
runtime = CellrixRuntime(manifest)
runtime.run()
```

### Level 6: Agent‑Accessible API (NEW)

```bash
cellrix daemon
```

Launches a local HTTP server that exposes the current UI state to AI agents:

| Endpoint | Purpose |
|:---|:---|
| `GET /v1/agent/snapshot` | Read‑only semantic tree + viewport metadata |
| `POST /v1/agent/action` | Execute a registered action (e.g. `focus_next`) |

Agents can navigate, scroll, and toggle panels without OCR — structured JSON, strict Pydantic contracts, P99 < 10ms latency. High‑risk actions are gated by the **ActionInterceptor** (human approval loop). See `docs/ROADMAP.md` Phase 1.


## Interactive Workbench

| Feature | Key |
|:---|:---|
| Focus next / prev panel | `Tab` / `Shift+Tab` |
| Leader key (show jump labels) | `g` |
| Scroll | `↑↓ PgUp PgDn Home End` |
| Help overlay | `F1` or `?` |
| Quit | `q` |


## For Project Authors: Make Your CLI Speak Cellrix

Your project needs **one entry point** that produces a Cell‑Manifest JSON. No Cellrix dependency required.

See the [Cellrix Intents Specification (CIS)](CIS.md) for the full standard.


## Current Status

| Gate | Status |
|:---|:---|
| Protocol Spec (WHITEPAPER.md v2.3) | ✅ Finalized |
| Intents Specification (CIS v0.6.0) | ✅ Finalized |
| `ruff check` | ✅ All checks passed |
| `mypy --strict` | ✅ Success, 0 errors |
| Tests | ✅ 35/35 passing |
| Rich adapter | ✅ Complete |
| Textual adapter | ✅ Complete |
| Semantic widgets (progress, table, list) | ✅ Complete |
| Agent API daemon (P1a/P1b) | ✅ Complete |
| Conformance Suite | ✅ 9 boundary tests |


## Quick Start

```bash
git clone git@github.com:Jasonmilk/Cellrix.git
cd Cellrix
uv venv && source .venv/bin/activate
uv pip install -e ".[dev,server]"
uv run cellrix preview examples/hello.json
```


## Design Philosophy — *The Cellrix Zen*

1. **Orchestrate, Don't Build** — The runtime is a scheduler, not a renderer.
2. **Strict Contracts, Model Validation** — All communication via typed Pydantic models.
3. **Pure Streams & Hard Fails** — `stdout` for data, `stderr` for diagnostics.
4. **Absolute Idempotency** — Same manifest + terminal size = identical ViewTree.
5. **Radical Simplicity & Ecosystem Reuse** — Direct dependencies ≤5.
6. **Security‑First & Human‑in‑the‑Loop** — ANSI injection blocked; critical actions require human approval.


## License

MIT. Do good, don't harm, keep it simple.

---

*中文版: [README.zh-CN.md](README.zh-CN.md)*
