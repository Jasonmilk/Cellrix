# Cellrix Architecture Overview

## Layers

| Layer | Location | Responsibility |
|:---|:---|:---|
| Protocol | `core/` | Manifest parsing, layout solving, security sanitization |
| CLI | `cli/` | Terminal rendering, command dispatch, Daemon HTTP server |
| Adapters | `adapters/` | Textual adapter for full‑screen interactive workbench |
| DevKit | `devkit/` | Bridge helpers, template generators |

## Daemon (CAP v0.2)

The Daemon exposes the Cellrix Agent Protocol (`docs/CAP.md`). It runs a FastAPI server providing:

- `GET /v1/agent/snapshot` — semantic tree snapshot (idempotent, read‑only)
- `POST /v1/agent/action` — intent execution with parameter validation and HITL interception

The ActionInterceptor (`cli/daemon/interceptor.py`) enforces the security model defined in the Cell‑Manifest.

## Design Tokens

Themes are defined as semantic color tokens (`cli/theme.py`). The renderer maps tokens to Rich styles via `ThemeStyles`. Station presets are auto‑discovered from the `stations/` directory.

## Key Design Decisions

- **Pure‑Function Layout Solver**: `solve()` is deterministic, side‑effect‑free, and independently testable.
- **Strict Pydantic Contracts**: All external data (Manifest, Theme, Agent requests) is validated with strict models.
- **Zero Hard‑Coded Values**: All thresholds, paths, and configuration are driven by environment variables or manifest files.
- **On‑Demand WebSocket**: Future Web UI adapter will only activate when a browser connects.
