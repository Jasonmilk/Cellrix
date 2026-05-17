# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `cellrix check` command for headless manifest validation (strict Pydantic schema, exit codes).
- Multi‑level input routing with Leader Key (`g` then `a-z`) for instant panel focus.
- Scroll support for cells with `collapseMode: "scroll"` — arrow keys, page up/down, home/end.
- Context‑aware shortcut overlay (`?` key) showing all available actions for the focused panel.
- Panel index labels (`[1]–[9]`) rendered automatically; `Alt+1` to `Alt+9` direct jump.
- Centralised action constants and handler registry (`cli/actions.py`).
- `cli/input_router.py`: stateful key resolver with leader‑key state machine.
- `cellrix run` command for bidirectional pipe communication with subprocess (Textual adapter).
- `cellrix daemon` command launching FastAPI server for Agent accessibility.
- `GET /v1/agent/snapshot` and `POST /v1/agent/action` endpoints with Pydantic strict contracts.
- Agent API contract models in `core/schemas/agent.py`.
- Action dispatcher now raises `ValueError` for unregistered actions (fail-fast).
- Phase 1e agent accessibility test suite (`tests/test_agent_accessibility.py`).
- `cli/daemon/interceptor.py`: ActionInterceptor enforcing HITL security model.
- HITL state machine with approve/reject/timeout lifecycle.
- `tests/test_hitl_state_machine.py` (6/6 passing).
- `docs/CAP.md` + `docs/CAP.zh-CN.md`: Cellrix Agent Protocol v0.2 specification.
- `docs/design_guide.md`: AI-readable design guide for theme/intents generation.
- `stations/night-blue-pro/`: full example station (manifest + theme + intents).
- Auto-discovery of station presets from `stations/` directory.
- `--theme` option on `cellrix preview` for runtime theme switching.

### Changed
- Refactored `cli/runtime.py` — all hard‑coded key handling moved into `actions` and `InputRouter`.
- `cli/renderer.py` now supports per‑cell scroll offsets and dynamic shortcut overlays.
- Help overlay (F1/?) now toggles cleanly with a single press; Esc closes overlay without quitting.
- Bottom status bar updated to show leader key and context‑sensitive shortcuts.

### Fixed
- Terminal input ghosting after quit — raw‑mode reader now correctly restores terminal settings.
- Missing `readchar` dependency in core `pyproject.toml`.

## [0.1.0] - 2026-05-06
### Added
- Initial release of Cellrix protocol and reference implementation.
- Layout solver, manifest parser, security sanitizer, and interactive preview.
- White Paper v2.0, Engineering Guide, and Intents Specification (CIS).
