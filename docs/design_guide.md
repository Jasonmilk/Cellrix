# Cellrix Design Guide

**Audience:** AI agents generating Cellrix interfaces, and developers.  
**Goal:** Produce strictly correct `manifest.json`, `theme.json`, and CIS `intents.json` without manual editing.

---

## §1 Structural Layer: Manifest

A manifest describes layout and content. It must be a valid Cellrix manifest (version `2.3` or later).

### 1.1 Required Fields

Every manifest must contain:

- `version` (string, e.g. `"2.3"`)
- `layout` (object with `direction` and `slots`)
- `cells` (array of cell objects)

### 1.2 Example (two-panel dashboard)

```json
{
  "version": "2.3",
  "layout": {
    "direction": "vertical",
    "slots": [
      { "id": "header", "weight": 1 },
      { "id": "main", "weight": 3 }
    ]
  },
  "cells": [
    {
      "id": "title",
      "type": "static",
      "slot": "header",
      "content": "My Dashboard",
      "role": "title"
    },
    {
      "id": "content",
      "type": "static",
      "slot": "main",
      "content": "Welcome to Cellrix.",
      "role": "body"
    }
  ]
}
```

### 1.3 AI Generation Rules

- Do NOT add extra top-level keys like `station_id`, `theme_ref`, `intent_source`. The manifest is pure Cellrix.
- All `id` values must be unique.
- Use only supported cell types: `static`, `dynamic`, `list`, `table`, `progress`, `button`.

---

## §2 Visual Layer: Theme

A theme is a set of color tokens. All values must be hex colors (`#RRGGBB`).

### 2.1 Token List

| Token | Role |
|-------|------|
| `primary` | Focus, active elements |
| `secondary` | Accents |
| `surface` | Main background |
| `panel` | Panel background |
| `text` | Primary text |
| `text_muted` | Muted text |
| `border` | Borders, separators |
| `success` | Success |
| `warning` | Warning |
| `error` | Error, destructive |

### 2.2 AI Generation

1. Ask user for a style preference (e.g., “dark mode with blue accents”).
2. Output a strict JSON file named `theme.json`.

**Mandatory AI Self-Check (include in response):**
- [ ] All 10 tokens present?
- [ ] All values in `#RRGGBB`?
- [ ] No extra keys?
- [ ] Dark/light consistency?

### 2.3 Example (`theme.json` – safe, generic name)

```json
{
  "name": "slate-dark",
  "tokens": {
    "primary": "#60a5fa",
    "secondary": "#a78bfa",
    "surface": "#0f172a",
    "panel": "#1e293b",
    "text": "#f8fafc",
    "text_muted": "#94a3b8",
    "border": "#334155",
    "success": "#4ade80",
    "warning": "#fbbf24",
    "error": "#f87171"
  }
}
```

- The `name` field is free text but should avoid trademarked terms (e.g., do NOT use “GitHub”, “Apple”, “Google” as part of the name). Use descriptive names like `slate-dark`, `ocean-light`, `ember` etc.
- The file itself should be saved as `theme.json` (no trademark risk in filenames).

### 2.4 Built-in Presets

Cellrix ships with safe presets:

- `dracula` (default)
- `slate-dark` (shown above)

---

## §3 Intent Layer: CIS Intents

Intents follow the [Common Intents Specification (CIS)](https://github.com/CommonIntents/CIS).

### 3.1 Required Structure

An intents file must be a JSON object with:

- `cis_version` (string, currently `"0.6"`)
- `intents` (array of intent objects)

**It must NOT be a bare array.**

### 3.2 Intent Object Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique ID (snake_case) |
| `name` | Yes | Human-readable name |
| `description` | Yes | Must explain side effects |
| `parameters` | No | JSON Schema for payload |
| `security` | No | `risk_level`, `requires_hitl`, `required_scopes` |

### 3.3 Template: Delete Resource

```json
{
  "id": "delete_<resource>",
  "name": "Delete <resource>",
  "description": "Permanently deletes the <resource>. This action cannot be undone.",
  "parameters": {
    "type": "object",
    "properties": {
      "<resource>_id": { "type": "string" }
    },
    "required": ["<resource>_id"]
  },
  "security": {
    "risk_level": "high",
    "requires_hitl": true,
    "required_scopes": ["admin:write"]
  }
}
```
Replace `<resource>` with the actual entity name.

### 3.4 AI Generation Rules

1. Select the closest template for each user requirement.
2. Fill in the business details.
3. Wrap all intents in a proper registry:

```json
{
  "cis_version": "0.6",
  "intents": [ ... ]
}
```

4. **Self-Check before output:**
   - [ ] Outer object contains `cis_version` and `intents`?
   - [ ] Every `description` mentions side effects?
   - [ ] Destructive actions have `requires_hitl: true`?
   - [ ] `parameters` are valid JSON Schema (when present)?
   - [ ] All intent IDs unique?

### 3.5 Example (`intents.json`)

```json
{
  "cis_version": "0.6",
  "intents": [
    {
      "id": "delete_file",
      "name": "Delete File",
      "description": "Permanently deletes the selected file. This action cannot be undone.",
      "parameters": {
        "type": "object",
        "properties": {
          "file_path": { "type": "string" }
        },
        "required": ["file_path"]
      },
      "security": {
        "risk_level": "high",
        "requires_hitl": true,
        "required_scopes": ["admin:write"]
      }
    },
    {
      "id": "view_log",
      "name": "View Log",
      "description": "Displays the last 100 lines of system log. No side effects.",
      "security": {
        "risk_level": "low",
        "requires_hitl": false,
        "required_scopes": ["log:read"]
      }
    }
  ]
}
```

### 3.6 Automatic Fix (Phase 2, design intent)

If validation fails, Cellrix will prompt:

```text
✗ intents.json is a bare array. Wrapping is required.

Fix automatically? [Y/n]: 
```

Default is `Y` (just press Enter). Advanced users can press `n` to see detailed errors and fix manually or via AI.

---

## §4 Complete Station Delivery

When a user requests a full Cellrix station, AI must deliver **three files**:

1. `manifest.json` — structure
2. `theme.json` — colors
3. `intents.json` — CIS intent registry

All files must pass the strict checks described above. Do not invent extra top-level fields.
