# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Multi‑level input routing with Leader Key (`g` then `a-z`) for instant panel focus.
- Scroll support for cells with `collapseMode: "scroll"` — arrow keys, page up/down, home/end.
- Context‑aware shortcut overlay (`?` key) showing all available actions for the focused panel.
- Panel index labels (`[1]–[9]`) rendered automatically; `Alt+1` to `Alt+9` direct jump.
- Centralised action constants and handler registry (`cli/actions.py`).
- `cli/input_router.py`: stateful key resolver with leader‑key state machine.
- `cellrix run` command for bidirectional pipe communication with subprocess (Textual adapter).

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
