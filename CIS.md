# Cellrix Intents Specification (CIS) v0.2.0

**Intent Generation Specification — How to Speak Cellrix**

**Status:** Draft
**Aligned with:** Cellrix White Paper v2.1
**Date:** 2026-05-07

---

## 1. Purpose

CIS defines a language‑agnostic, zero‑dependency contract that allows any project — Python, Rust, Go, or even a plain shell script — to produce declarative UI descriptions consumable by a Cellrix Runtime.

**Core tenet:** A project shall never need to install Cellrix to become an “intent producer”. Cellrix is responsible solely for validation and rendering.

---

## 2. Core Principles

| Principle | Description |
|:---|:---|
| **Zero Dependencies** | Bridge code must not `import cellrix`. Only the standard library of the host language may be used to generate a dictionary (or output JSON). |
| **Language Agnostic** | The contract is a JSON Schema; any language can implement it. |
| **Self‑Describing** | An intent producer declares its capabilities through a Manifest file or a Python entry point (or both). |
| **Fail Fast** | Cellrix performs strict schema validation before consuming any Manifest. Any deviation is immediately rejected with a precise error path. |
| **Minimal Interface** | Everything needed is a single entry point plus a pure function (`config → dict`). |

---

## 3. Bridge Modes

### 3.1 Python Function (In‑Memory)

- `bridge_type: "python_function"`
- Cellrix discovers a `build_manifest` function via a Manifest file or an entry point.
- Signature: `def build_manifest(config: dict | None = None) -> dict`
- The returned `dict` must conform to `cellrix_manifest.schema.json`.
- The producer **must not** import Cellrix; it simply returns a dictionary.

### 3.2 CLI Subprocess (Cross‑Language / Stream)

- `bridge_type: "cli_subprocess"`
- A `command` field is required (e.g., `"ana loom --cellrix"`).
- Cellrix executes the command, captures `stdout`, and expects JSON that conforms to the schema.
- The exit code and `stderr` are also checked.
- This mode composes naturally with `cellrix stream`.

---

## 4. Discovery Mechanism (Dual Channel)

Cellrix discovers intent producers with the following precedence:

1. **Manifest file** — a `cellrix_manifest.json` at the project root (or current directory):
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

2. **Python entry point** — declared in `pyproject.toml`:
   ```toml
   [project.entry-points."cellrix.bridge"]
   my_bridge = "my_project.cellrix:build_manifest"
   ```

`cellrix check` merges results from both channels. If neither is found, the check fails.

---

## 5. JSON Schema Contract

Cellrix provides `cellrix_manifest.schema.json`, which defines the legal shape of a Manifest. The dictionary returned by a bridge function (or the JSON emitted by a CLI bridge) must pass strict validation against this schema.

**Core schema constraints:**
- Top‑level must include `version`, `layout`, `cells`.
- `layout` supports nested `slots`; `weight` must be a positive integer.
- Every `Cell` must specify `id`, `type`, `slot`.
- `type` is restricted to `static`, `dynamic`, `realtime`.
- `source` is optional; its `type` can be `pipe`, `file`, or `socket`.
- An optional `semantic_widget` field may declare a widget class (see §7).

The schema is versioned alongside the Cellrix protocol. Every implementation must align with it.

---

## 6. Validation Flow (`cellrix check`)

When a user runs `cellrix check`, Cellrix will:

1. **Discover** — locate a Manifest file or entry point.
2. **Generate** — invoke the bridge function (or execute the CLI command) to obtain a raw dictionary.
3. **Validate** — apply the JSON Schema; any failure results in a detailed error message and a non‑zero exit code.
4. **Report** — display a summary including version‑compatibility checks.

A Manifest that passes validation may then be visually inspected with `cellrix preview`.

---

## 7. Semantic Widgets

A Cell may optionally declare a `semantic_widget` field to indicate its intended interactive role. The protocol defines a small set of universal values — **no framework‑specific class names are ever allowed**.

| Value | Semantics | Notes |
|:---|:---|:---|
| `"text"` | Text block | Default; plain text rendering. |
| `"table"` | Table | Requires `columns` and `rows` fields. |
| `"list"` | List | Requires `items` field; supports focus selection. |
| `"progress"` | Progress bar | Requires `value` field (0–100). |

The `semantic_widget` field is always optional. When omitted, adapters default to `"text"`. It is the adapter’s responsibility to map these semantics to concrete UI components.

---

## 8. Event Protocol

Cellrix adapters must translate user interactions (keyboard, mouse, touch) into standardised **Cellrix Action JSON** messages. These messages are delivered to business logic through a pipe or callback.

**Standard Action JSON format:**
```json
{
  "event": "cellrix.action",
  "action": "focus_next",
  "cell_id": "my_cell",
  "payload": {}
}
```

**Global standard actions:**
| Action | Description |
|:---|:---|
| `focus_next` | Move focus to the next panel |
| `focus_prev` | Move focus to the previous panel |
| `toggle_help` | Toggle the full‑screen help overlay |
| `quit` | Exit the current session |

**Business‑logic side:**
- Receives the Action JSON, processes it, and returns either a new Manifest or an update to the existing one.
- The adapter re‑renders the interface according to the new Manifest.

**Rules:**
- The event format is a protocol contract; all adapters must follow it.
- The mapping from raw input (e.g. keystrokes) to actions is implementation‑specific but must be configurable through the Keybindings mechanism.

---

## 9. Adapter Responsibilities

Any compliant Cellrix adapter must fulfil three duties:

1. **Render** — consume a Manifest and present a visual interface to the user.
2. **Normalise events** — convert user interactions into standard Cellrix Action JSON.
3. **Dynamic update** — accept a new Manifest and re‑render (partially or fully).

Adapters are free to choose their own rendering technology, input‑handling strategy, and update policy.

---

## 10. Compliance

An implementation is CIS‑compliant if it:

- Exposes an entry point through one of the discovery channels.
- Produces a dictionary (or JSON) that passes Cellrix JSON Schema validation.
- Does **not** import any Cellrix module.

**Official recommendation:** Python projects should provide both a Manifest file and an entry point. Non‑Python projects need only supply a Manifest file.

---

*This specification evolves with the Cellrix protocol. Any changes must follow the CEP process.*
