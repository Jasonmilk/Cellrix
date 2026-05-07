# Cellrix Intents Specification (CIS) v0.3.0

**Intent Generation Specification — How to Speak Cellrix**

**Status:** Draft  
**Aligned with:** Cellrix White Paper v2.1  
**Date:** 2026-05-08

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
- An optional `content_type` field may declare the format of the `content` field (see §7).

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

## 7. Content Types & Semantic Widgets

### 7.1 Content Types

A Cell may optionally declare a `content_type` field to indicate how its `content` field should be interpreted. The adapter is responsible for rendering accordingly.

| Value | Semantics | Notes |
|:---|:---|:---|
| `"text"` | Plain text | Default when omitted. |
| `"markdown"` | Markdown formatted text | Adapter should use native Markdown rendering capabilities (tables, code blocks, lists, etc.). |
| `"code"` | Source code block | Adapter should apply syntax highlighting. A `language` field (e.g., `"python"`, `"rust"`) may be specified alongside to guide the highlighter. |

The protocol never references any specific Markdown or syntax‑highlighting library.

### 7.2 Semantic Widgets

A Cell may optionally declare a `semantic_widget` field to indicate its intended interactive role. The protocol defines a small set of universal values — **no framework‑specific class names are ever allowed**.

| Value | Semantics | Notes |
|:---|:---|:---|
| `"text"` | Static or dynamic text block | Default. |
| `"table"` | Tabular data | Requires `columns` and `rows` fields. |
| `"list"` | Flat selectable list | Requires `items` field; supports focus selection. |
| `"progress"` | Progress bar | Requires `value` field (0–100). |
| `"input"` | Single‑ or multi‑line text input | Supports `placeholder`, `multiline`, `autocomplete` properties. Must be accompanied by an `actions.onSubmit` that carries `payload.value`. |
| `"modal"` | Overlay dialog for confirmation or alert | Rendered as a centered floating overlay, **independent of the layout grid**. Must define `actions.onConfirm` and/or `actions.onCancel`. |
| `"tree"` | Hierarchical expandable tree | Uses a `data` field with a recursive `{label, children}` structure (see §7.3). Supports `actions.onNodeSelect`. |

### 7.3 Tree Data Schema

When `semantic_widget` is `"tree"`, the `data` field must conform to the following recursive structure:

```json
"data": [
  {
    "label": "Node label",
    "children": [
      { "label": "Child A" },
      { "label": "Child B", "children": [...] }
    ]
  }
]
```

Each node may optionally carry an `icon` or `metadata` field. The adapter is responsible for rendering the hierarchy and handling expand/collapse interactions.

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
| `submit_input` | Emitted when an `input` widget submits its value |
| `confirm_modal` | Emitted when a `modal` dialog is confirmed |
| `cancel_modal` | Emitted when a `modal` dialog is dismissed |
| `node_select` | Emitted when a `tree` node is selected |

### 8.1 Input Payload Specification

When a `semantic_widget: "input"` Cell triggers its `actions.onSubmit`, the emitted Action JSON must include the current input value in `payload.value`:

```json
{
  "event": "cellrix.action",
  "action": "submit_input",
  "cell_id": "code_editor",
  "payload": {
    "value": "print('Hello, Cellrix!')"
  }
}
```

### 8.2 Modal Event Specification

Modal events carry an optional payload indicating the user's choice:

```json
{
  "event": "cellrix.action",
  "action": "confirm_modal",
  "cell_id": "restart_confirm",
  "payload": {
    "choice": "yes"
  }
}
```

### 8.3 Tree Node Selection Event

When a `semantic_widget: "tree"` node is selected, the event carries the selected node's path:

```json
{
  "event": "cellrix.action",
  "action": "node_select",
  "cell_id": "file_browser",
  "payload": {
    "path": ["src", "main.py"]
  }
}
```

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

### 9.1 Modal Rendering Rule

Adapters must render `semantic_widget: "modal"` cells as a centered overlay that floats above the main layout. Such cells must not participate in the layout grid (`weight`, `slot` allocation); their position and size are determined exclusively by the adapter's modal implementation.

---

## 10. Compliance

An implementation is CIS‑compliant if it:

- Exposes an entry point through one of the discovery channels.
- Produces a dictionary (or JSON) that passes Cellrix JSON Schema validation.
- Does **not** import any Cellrix module.

**Official recommendation:** Python projects should provide both a Manifest file and an entry point. Non‑Python projects need only supply a Manifest file.

---

*This specification evolves with the Cellrix protocol. Any changes must follow the CEP process.*
