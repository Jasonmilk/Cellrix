# Cellrix Design Guide

**Audience:** AI agents generating Cellrix interfaces, and developers.  
**Goal:** Produce strictly correct `manifest.json`, `theme.json`, and CIS `intents.json` without manual JSON editing.

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

### 3.1 Intent Template Library

Cellrix provides a template library aligned with the CIS v0.6.0 **Core Intent Set**. The AI selects the closest intent for each user requirement, fills in business details, and produces a CIS-compliant `intents.json`.

**Core Intent Templates** (subset applicable to TUI runtimes):

| Template ID | User need | Fixed constraints |
|-------------|-----------|-------------------|
| `navigate` | Move focus to a panel or section | Low risk, no parameters required |
| `click` | Activate a focused element | Low risk |
| `select` | Choose an item from a list | Low risk |
| `input` | Enter text into a field | Low risk |
| `confirm` | Confirm a pending operation | Medium risk if side effects exist |
| `cancel` | Dismiss a dialog or cancel an operation | Low risk |
| `execute` | Run a registered command | Risk depends on command |
| `reset_settings` | Reset all settings to factory defaults | `requires_hitl: true`, `risk_level: high` |

**Template skeleton (`reset_settings`):**
```json
{
  "id": "reset_settings",
  "name": "Reset Settings",
  "description": "Restore all custom settings to factory defaults. This action cannot be undone and requires confirmation.",
  "parameters": {
    "type": "object",
    "properties": {
      "confirm": { "type": "boolean", "description": "Explicit confirmation flag" }
    },
    "required": ["confirm"]
  },
  "security": {
    "risk_level": "high",
    "requires_hitl": true,
    "required_scopes": ["admin:write"]
  }
}
```

### 3.2 AI Generation Workflow

1. Understand user requirements (e.g., "I need navigation, a reset button, and a way to enter text").
2. For each requirement, pick the closest template from the Core Intent Set.
3. Instantiate the template, filling in any business-specific parameters or descriptions.
4. Assemble all intents into a single `intents.json` file.
5. **Run the self-check below before outputting.**

**Mandatory AI Self-Check:**
- [ ] Outer object contains `cis_version` and `intents`?
- [ ] Every `description` clearly states side effects?
- [ ] Destructive actions have `requires_hitl: true`?
- [ ] `parameters` are valid JSON Schema when present?
- [ ] All intent IDs unique?
- [ ] No intent IDs from the Core Intent Set are omitted if the user needs them?

### 3.3 User-Side Fix Commands

Once the intent registry file is created, the user can validate it:

```bash
cellrix check intent-registry intents.json
```

This command verifies strict compliance with the CIS v0.6.0 schema. If errors are found, the user can either fix them manually or feed the error messages back to the AI for regeneration.

### 3.4 Reference Example

See `stations/night-blue-pro/intents.json` for a complete, production-ready example of a generic Cellrix intent registry that follows this guide.

---

## Appendix: Complete Operation Station

A full Cellrix station = `manifest.json` + `theme.json` + `intents.json`.  
AI can provide all three files in one answer.
