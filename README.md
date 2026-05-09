# Cellrix

**An intent-driven, deterministic, spatial-semantic terminal UI protocol and high-performance runtime.**

> *Cellrix is not just a tool for the terminal age. It is an OS-grade UI protocol built for the post-AGI era — bridging the comprehension gap between carbon-based and silicon-based minds.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![Ruff](https://img.shields.io/badge/linter-Ruff-brightgreen)](https://github.com/astral-sh/ruff)
[![Mypy](https://img.shields.io/badge/type--checker-Mypy-blue)](https://mypy-lang.org/)
[![Tests](https://img.shields.io/badge/tests-23%2F23%20passed-green)](#)

---

## What is Cellrix?

Describe your terminal interface in a JSON file. Cellrix renders it — with layout, focus tracking, keyboard shortcuts, and a built‑in help system. No manual coordinate math, no boilerplate drawing code, no framework lock‑in.

Cellrix is a **protocol first**, not an implementation. The layout solver is a pure function: same manifest + same terminal size = identical result every time. The renderer is just one compliant consumer of the protocol. Write your own if you prefer — as long as it passes the Conformance Suite, it's a valid Cellrix Runtime.


## Why Cellrix?

| Problem | Cellrix answer |
|:---|:---|
| TUI development is repetitive coordinate math | Declare `weight`, `minConstraint`, `slot` — Solver computes the rest |
| Every tool invents its own keyboard handling | Unified input routing via Keybindings (decoupled from renderer) |
| Terminal apps are invisible to screen readers | Semantic tree aligned with W3C ARIA 1.3 |
| AI agents cannot read terminal output | Semantic tree is structured JSON — no OCR needed |


## What can Cellrix do for you?

Cellrix is designed for **four levels of engagement**. You can use only what you need, without complexity you don't.

### Level 1: Declare & Preview

Write a Cell‑Manifest and see it rendered immediately. This is the fastest way to get started.

```bash
cellrix preview hello.json
```

```json
{
  "version": "2.0",
  "layout": { "direction": "vertical", "slots": [{ "id": "main", "weight": 1 }] },
  "cells": [
    { "id": "greeting", "type": "static", "slot": "main", "content": "Hello, Cellrix!" }
  ]
}
```

Press `F1` or `?` anytime to see available shortcuts. Press `Tab` to move focus between panels. Press `q` to quit.

### Level 2: Design Layouts

Use `weight`, `minConstraint`, `collapseMode`, and nested slots to build sophisticated, responsive layouts that adapt to terminal resizing — with zero manual coordinate math.

```json
{
  "version": "2.0",
  "layout": {
    "direction": "horizontal",
    "slots": [
      { "id": "sidebar", "weight": 1 },
      { "id": "main", "weight": 3, "layout": {
        "direction": "vertical",
        "slots": [
          { "id": "status", "weight": 1 },
          { "id": "log", "weight": 4 }
        ]
      }}
    ]
  },
  "cells": [
    { "id": "nav", "type": "static", "slot": "sidebar", "content": "# Dashboard",
      "minConstraint": { "width": 10, "height": 3 }, "priority": 100 },
    { "id": "cpu", "type": "realtime", "slot": "status", "content": "CPU: idle",
      "minConstraint": { "width": 5, "height": 1 } },
    { "id": "events", "type": "dynamic", "slot": "log",
      "collapseMode": "scroll", "priority": 50 }
  ]
}
```

The Solver automatically:
- Splits horizontal space 1:3 between sidebar and main area
- Splits main area vertically 1:4 between status and log
- Protects high‑priority panels from being squeezed when the terminal shrinks
- Collapses low‑priority panels into scroll mode instead of crashing

You define **what** — the Runtime handles **how**.

### Level 3: Connect Data Pipes (Dynamic Content)

Bind cells to real data sources: shell commands, log files, sockets. Content updates automatically — no full‑manifest replacement needed.

```bash
# Real‑time clock (requires --trust to enable pipe execution)
cellrix preview clock.json --trust
```

```json
{
  "version": "2.0",
  "layout": { "direction": "vertical", "slots": [{ "id": "main", "weight": 1 }] },
  "cells": [
    { "id": "clock", "type": "realtime", "slot": "main",
      "source": { "type": "pipe", "command": "while true; do date; sleep 1; done" } }
  ]
}
```

**Security first:** Pipe execution is disabled by default. You must explicitly opt in with `--trust`. Without it, the cell displays a security lock notice and no subprocess runs.

### Level 4: Stream & Embed (Programmatic Usage)

Pipe a stream of Manifest JSON lines into `cellrix stream` for real‑time dashboards that update as data arrives. When the stream ends, the display stays interactive so you can inspect the final state.

```bash
# Generate a manifest every second and stream it
generate_manifests | cellrix stream
```

Or embed the Runtime directly into your Python application:

```python
from core.manifest.parser import parse_manifest
from cli.runtime import CellrixRuntime

manifest = parse_manifest("my_dashboard.json")
runtime = CellrixRuntime(manifest)
runtime.run()   # blocks until user presses 'q'
```

The Runtime controls the entire interactive loop: rendering, input handling, and dynamic data polling. You provide the Manifest — Cellrix handles everything else.


## Interactive Workbench (Built‑in)

Every `cellrix preview` session includes these interaction features automatically. No configuration needed.

### Navigation

| Feature | Key |
|:---|:---|
| Focus next panel | `Tab` |
| Focus previous panel | `Shift+Tab` |
| Direct jump to panel by index | `Alt+1` … `Alt+9` |
| Leader key (show jump labels) | `g` |
| Jump to labelled panel | `g` then `a` … `z` |

### Scrolling (when panel has `collapseMode: "scroll"`)

| Feature | Key |
|:---|:---|
| Scroll up / down (line) | `↑` / `↓` |
| Scroll page up / down | `PgUp` / `PgDn` |
| Jump to top / bottom | `Home` / `End` |

### Help & Quit

| Feature | Key |
|:---|:---|
| Show all shortcuts (context‑aware) | `F1` or `?` |
| Close help overlay | `Esc` (when help is open) |
| Quit | `q` |

The bottom status bar always shows the most relevant shortcuts. No memorisation required — press `?` anytime to see everything.


## For Project Authors: Make Your CLI Speak Cellrix

Cellrix is not a library you import — it's a protocol your project speaks. Any project can become an "intent producer" and be rendered by Cellrix without installing any Cellrix dependency.

The [Cellrix Intents Specification (CIS)](CIS.md) defines the standard. At a glance:

### The Rule

Your project needs **one entry point** that produces a Cell‑Manifest JSON. There are two ways to register it:

**Channel A — Manifest file** (language‑agnostic, recommended)

Place a `cellrix_manifest.json` in your project root:

```json
{
  "bridge": {
    "type": "python_function",
    "module": "my_project.cellrix",
    "function": "build_manifest"
  },
  "config": {}
}
```

For non‑Python projects, use a CLI subprocess instead:

```json
{
  "bridge": {
    "type": "cli_subprocess",
    "command": "my-cli-tool --cellrix"
  }
}
```

**Channel B — Python entry point** (optional bonus for Python packages)

Declare in `pyproject.toml`:

```toml
[project.entry-points."cellrix.bridge"]
my_bridge = "my_project.cellrix:build_manifest"
```

### The Function

In a Python project, a `build_manifest` function may look like:

```python
# my_project/cellrix.py  —  no import cellrix needed!
def build_manifest(config: dict | None = None) -> dict:
    return {
        "version": "2.0",
        "layout": ...,
        "cells": [...]
    }
```

### Discovery & Validation

Run `cellrix check` — it scans both channels, invokes the bridge, and validates the output against the JSON Schema. Once verified, your project is Cellrix‑ready.

See the full [CIS specification](CIS.md) for details on event protocols, semantic widgets, and all supported bridge modes.


## Core Concepts

### Cell‑Manifest

A JSON file that describes your interface. Three cell types:

| Type | Behavior |
|:---|:---|
| `static` | Never updates (headers, navigation, buttons) |
| `dynamic` | Appends data from a source (log streams, event lists) |
| `realtime` | Polls and replaces content (CPU gauges, status indicators) |

### Layout

Nested slots with `weight` ratios. Horizontal and vertical splits compose into fractal grids. No pixel math — the Solver computes coordinates deterministically.

### Keybindings

Decoupled from the renderer. Global bindings (`q` = quit) cannot be overridden by Manifest actions. Context‑sensitive bindings are shown in the help overlay and status bar.

### Theme

Colors stored as data (`cli/theme.py`), not hardcoded. Swap themes without touching renderer logic.


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


## Current Status

| Gate | Status |
|:---|:---|
| Protocol Spec (WHITEPAPER.md v2.2) | ✅ Finalized |
| Engineering Guide (10 chapters) | ✅ Complete |
| Manifest Parser + Strict Validation | ✅ Complete |
| ANSI Sanitizer + Capability Validator | ✅ Complete |
| `ruff check` | ✅ All checks passed |
| `mypy --strict` (21 source files) | ✅ Success, 0 errors |
| Layout Solver + Interactive Rendering | ✅ Live workbench |
| Dynamic Data Pipes (SourceManager) | ✅ `--trust` gate enabled |
| Stream Mode (stdin ndjson) | ✅ Interactive after stream ends |
| Textual Adapter (`cellrix run`) | ✅ Bidirectional pipe |
| Multi‑level Input Routing (Leader Key, scrolling, contextual help) | ✅ Complete |


## Design Philosophy — *The Cellrix Zen*

Every commit, every PR, every design decision must honor these six axioms:

1. **Orchestrate, Don't Build** — The runtime is a scheduler, not a renderer.
2. **Strict Contracts, Model Validation** — All communication via typed Pydantic models.
3. **Pure Streams & Hard Fails** — `stdout` for data, `stderr` for diagnostics, errors never swallowed.
4. **Absolute Idempotency** — Same manifest + terminal size = identical ViewTree.
5. **Radical Simplicity & Ecosystem Reuse** — Direct dependencies capped at ≤5; every new line must justify itself.
6. **Security‑First & Human‑in‑the‑Loop** — ANSI injection blocked; critical actions require physical approval.


## Repository Layout

```
cellrix/
├── core/                   # Protocol engine (parser, solver, security, source)
├── cli/                    # Interactive terminal client + theme & keybinding
├── devkit/                 # Templates, protocol bridges (MCP/AG-UI)
├── adapters/               # Rendering adapters (optional dependencies)
│   └── textual/            # Textual adapter (production-grade interactivity)
├── tests/                  # Unit + conformance suite
├── WHITEPAPER.md           # The Protocol Constitution
├── CIS.md                  # Intents Specification
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


## License

MIT. Do good, don't harm, keep it simple.

---

*If the white paper is the soul, this engine is the body. Both obey the same six laws.*

---

*中文版: [README.zh-CN.md](README.zh-CN.md)*
