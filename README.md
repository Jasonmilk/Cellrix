# Cellrix

**An intent-driven, deterministic, spatial-semantic terminal UI protocol and high-performance runtime.**

> *Cellrix is not just a tool for the terminal age. It is an OS-grade UI protocol built for the post-AGI era — bridging the comprehension gap between carbon-based and silicon-based minds.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![Ruff](https://img.shields.io/badge/linter-Ruff-brightgreen)](https://github.com/astral-sh/ruff)
[![Mypy](https://img.shields.io/badge/type--checker-Mypy-strict-blue)](https://mypy-lang.org/)
[![Tests](https://img.shields.io/badge/tests-6/6%20passed-green)](#)

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

## Current Status: Foundation Established

The project has completed its protocol specification phase and established rigorous engineering discipline. The layout solver is the next milestone.

| Gate | Status |
|:---|:---|
| Protocol Spec (WHITEPAPER.md v2.0) | ✅ Finalized |
| Engineering Guide (10 chapters) | ✅ Complete |
| Manifest Parser + Strict Validation | ✅ Complete |
| ANSI Sanitizer + Capability Validator | ✅ 6/6 Tests Passing |
| `ruff check` | ✅ All checks passed |
| `mypy --strict` (15 source files) | ✅ Success, 0 errors |
| Layout Solver | 🔨 In progress |

**Installation (development-only for now):**

```bash
git clone git@github.com:Jasonmilk/Cellrix.git
cd Cellrix
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
uv run pytest  # 6 passed
```

---

## Design Philosophy — *The Cellrix Zen*

We hold these axioms sacred. Every commit, every PR, every design decision must honor them.

1. **Orchestrate, Don't Build** – The runtime is a scheduler, not a renderer. Rendering is delegated to battle‑tested libraries (`rich`).
2. **Strict Contracts, Model Validation** – All components communicate via typed Pydantic models. Unknown fields in dev mode? Reject.
3. **Pure Streams & Hard Fails** – `stdout` is for structured output; `stderr` for diagnostics. Never silently swallow errors.
4. **Absolute Idempotency** – The layout solver is a pure function. Same manifest + terminal size = identical ViewTree forever.
5. **Radical Simplicity & Ecosystem Reuse** – Direct dependencies limited to ≤5. Every added line of code must justify its existence.
6. **Security‑First & Human‑in‑the‑Loop** – ANSI injection is blocked at the rendering layer. Critical actions trigger a physical approval barrier.

---

## Protocol & Implementation

| Document | Purpose |
|:---|:---|
| [**WHITEPAPER.md**](WHITEPAPER.md) | The protocol constitution — Manifest schema, HITL state machine, Semantic Tree, versioning. |
| [**ARCHITECTURE.md**](ARCHITECTURE.md) | Implementation‑specific decisions of the `cellrix‑core` reference implementation. |
| [**ENGINEERING_GUIDE.md**](ENGINEERING_GUIDE.md) | Code style, module structure, testing strategy, release process (10 chapters). |

---

## Repository Layout

```
cellrix/
├── core/                   # Protocol engine (parser, solver, security)
├── cli/                    # Thin CLI shell (`cellrix preview`)
├── devkit/                 # Templates, protocol bridges (MCP/AG-UI)
├── tests/                  # Unit + conformance suite
├── WHITEPAPER.md           # The Protocol
├── ARCHITECTURE.md         # Reference Implementation
├── ENGINEERING_GUIDE.md    # Construction Manual (Chinese)
└── pyproject.toml
```

---

## Quality Gates

Every PR must pass:

```bash
uv run ruff check .          # Zero warnings
uv run ruff format . --check # Consistent formatting
uv run mypy --strict core/ cli/ devkit/  # Zero errors
uv run pytest                # All tests pass
```

---

## License

MIT. Do good, don't harm, keep it simple.

---

*If the white paper is the soul, this engine is the body. Both obey the same six laws.*

---

*README in other languages: [中文](README.zh-CN.md)*
