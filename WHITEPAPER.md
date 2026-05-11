# Cellrix Whitepaper v2.3

**Intent-Driven Spatial & Semantic Protocol and High-Performance Runtime**

**Status:** Final  
**Authors:** Jasonmilk & Cellrix Research Community  
**Date:** 2026-05-12

> *Cellrix is not just a terminal tool. It is an OS-grade UI protocol built for the post-AGI era — bridging the comprehension gap between carbon-based and silicon-based minds.*

---

## 1. Abstract

Cellrix believes that **the essence of UI is the spatial projection of data intent**. We relinquish passive control at the pixel level in pursuit of absolute mastery at the logic level.

Cellrix is a universal terminal workspace and UI protocol designed for developers, DevOps engineers, and AI agents. Through a declarative, strongly-typed file called a **Cell-Manifest**, it describes "interface intent". The local **Cellrix Runtime** converts this into a responsive, adaptively laid-out visual interface via deterministic mathematical algorithms.

Cellrix strictly adheres to the **MVI (Model-View-Intent)** architecture, cleanly separating interface "structure and rules (Manifest)" from "high-frequency data streams (Source)". Its pure-function solver produces two abstract trees simultaneously: a **Render Tree** carrying physical coordinates for human vision, and a **Semantic Tree** preserving full spatial topology, strictly aligned with **W3C ARIA 1.3**, serving both AI agents and screen readers for visually impaired engineers in a noise-free, structured, machine-readable form.

Cellrix is a rendering-backend-agnostic declarative UI protocol. The specification itself does not mandate any specific terminal rendering technology or graphics library. Any event-driven system capable of consuming a Manifest and outputting a visual interface qualifies as a compliant Cellrix adapter. The official reference implementation provides both a lightweight terminal adapter and a production-grade adapter for complex interactions; developers may choose according to their scenario or implement their own following the CIS specification.

Cellrix employs a Daemon-Client separation architecture. The Daemon runs persistently in the background, maintaining data pipelines and the Semantic Tree for headless consumption by AI; the Client handles only rendering and can attach/detach at any time.

**Cellrix's design philosophy originates from the engineering discipline of the Helix ecosystem: orchestrate over build, strict contracts, pure I/O, absolute idempotency, radical simplicity, security-first. We treat code as liability and composition as asset. The protocol defines only "interfaces and invariants"; implementation details are left to the heroes to compete over.**

---

## 2. Motivation & Design Philosophy

### 2.1 Pain Points
- **The "heaviness" of Web UIs**: Building graphical interfaces for rapidly iterating backends is extremely inefficient.
- **The "disorder" of traditional TUIs**: There is no declarative standard akin to Markdown.
- **The "visual black box" of AI agents**: Complex agent logic is a black box; developers need a "neural hub" to observe its cognitive trajectory in real time, not dead logs for post-mortem analysis.

### 2.2 Core Design Principles (Cellrix Zen)

Distilled from the 11 axioms of Helix engineering, here are the six fundamental principles of Cellrix:

1.  **Orchestrate, Don't Build**
    The Cellrix Runtime is merely a "scheduling engine" and "layout bus". It does not render terminals itself — rendering is delegated to external adapters; it does not implement SSH itself — it delegates to external WASM or processes via the Driver protocol; it does not parse Markdown itself — it integrates existing parsers. All substantive work is pushed down; the core is responsible only for deterministic orchestration.

2.  **Strict Contracts, Model Validation**
    Components communicate only through contracts strictly defined by **JSON Schema**. The Manifest is the sacred interface protocol. Strongly-typed validation via `pydantic` or equivalent is a hard requirement for all implementations. A missing field? Reject. An illegal type? Reject. Never guess.

3.  **Pure Streams & Hard Fails**
    Follow the Unix iron law: `stdout` outputs only structured renderable data (ViewTree JSON / ANSI); `stderr` outputs only diagnostic logs. Every error must be propagated explicitly, returning a non-zero exit code or a definitive error event. **Silently swallowing exceptions is strictly forbidden.**

4.  **Absolute Idempotency**
    The layout solver is a pure function: the same Manifest and terminal dimensions will forever produce the identical ViewTree. Replays of data pipelines, Client attach/detach — none alter the deterministic semantics of the system.

5.  **Radical Simplicity & Ecosystem Reuse**
    Every newly added line of code must have an irreplaceable justification. Where `pydantic` can validate, a protocol adapter can render, `click` can handle CLI, `protobuf` can serialize — never reinvent the wheel.  
    **Visual Control Inversion Principle (CDS)**: The protocol layer conveys only semantic intent; all visual presentation (colors, corner radii, spacing, symbols) is determined by the adapter's local design system (Cellrix Design System). Agents express intent through semantic keywords (e.g., `primary`, `danger`); adapters handle the mapping to concrete visual representation. This is the Second Amendment of the Cellrix Constitution.

6.  **Security-First & Human-in-the-Loop**
    The protocol layer natively supports operation security classification and human approval barriers. Sensitive operations initiated by AI agents must pass through the Runtime's confirmation barrier and be approved by a human before execution. All external input must undergo security sanitization. Driver extensions are sandboxed with minimum permissions via capability declarations (`capabilities`). Privacy is a red line; data never leaks off-device without explicit authorization.

### 2.3 Absolute Boundary between Protocol and Implementation

**This is the First Amendment of the Cellrix Constitution:**

-   **This Whitepaper** defines only **protocol contracts**: Manifest Schema, dual-tree output specification, HITL state machine communication, security sanitization commands, version semantics.
-   **The reference implementation (`cellrix-core`)** is **one compliant instance** of the protocol. It chooses Python (not Rust, Go, or others), Ring Buffers (not other buffering strategies), Protobuf (not other serialization formats) — these are engineering decisions, not protocol constraints.
-   **Any implementation that passes the full Conformance Suite is a legal Runtime**, regardless of language, caching algorithm, persistence backend, or rendering technology.

**The protocol is the sacred interface; implementations are a diverse competition.**

---

## 3. Core Architecture: Cellrix Process Model

Cellrix employs a Daemon-Client separation architecture, physically decoupling the interface lifecycle from human attention spans.

| Process | Responsibility | Lifecycle |
| :--- | :--- | :--- |
| **Cellrix Daemon** | Maintains Manifest, manages Source pipelines, executes layout solving, updates Semantic Tree, exposes Semantic Tree query API via Unix Socket/TCP. | **Persistent background**, independent of client connections. |
| **Cellrix Client** | Connects to Daemon, retrieves Render Tree and outputs a visual interface; converts human input into Intent events and sends back to Daemon. | **Instant attach/detach**. |

**Client Attach Protocol Behavior**:
-   `static` and `realtime` Cells: Daemon delivers current snapshot.
-   `dynamic` Cells: Daemon delivers the most recent available history. **The specific buffering strategy is left to the implementation; the protocol does not dictate it.**

---

## 4. Cell-Manifest v2.3 Protocol Specification

### 4.0 Global Capability Declaration & AI Security Whitelist (`capabilities`)

The top-level Manifest declares global sandbox permissions, simultaneously serving as a **whitelist** for AI-generated Manifests. **If a declared `driver` or `actions.emit` target is not in this whitelist, the Runtime MUST reject the Manifest and return a rejection reason event.**

**Permission Matching Rules (Protocol Contract)**:
-   Domains only support `*.domain.tld` prefix wildcards.
-   IPs follow strict CIDR mask matching.
-   **Regular expressions are forbidden** to prevent ReDoS attacks and inconsistencies across language implementations.

```json
{
  "$schema": "https://cellrix.dev/protocol/v2.3/schema.json",
  "version": "2.3",
  "capabilities": {
    "network": ["*.example.com", "192.168.1.0/24"],
    "fs.read": ["/var/log/"],
    "drivers": ["text_input", "meter"],
    "actions.emit": ["QUERY_SUBMIT", "NODE_RESTART"]
  },
  "layout": { ... },
  "cells": [ ... ]
}
```

### 4.1 Top-Level Structure and Fractal Layout (`Layout`)

`layout` defines spatial slots, supporting recursive nesting to form **fractal grids**. Siblings divide space via `weight`.

```json
"layout": {
  "direction": "horizontal",
  "slots": [
    { "id": "sidebar", "weight": 1 },
    { "id": "main_area", "weight": 3, "layout": { "direction": "vertical", "slots": [
      { "id": "status_bar", "weight": 1 },
      { "id": "log_viewer", "weight": 4 }
    ]}}
  ]
}
```

### 4.2 Atomic Units: Cell Types, Content Types, Semantic Widgets, Structured Data, and Secure Interaction Routing

Each `Cell` possesses one of three **non-extensible** lifecycle types.

| Type | Lifecycle Strategy |
| :--- | :--- |
| **`static`** | Never updated. |
| **`dynamic`** | Pulls/pushes data via `source`, appending-style rendering. |
| **`realtime`** | Runtime actively subscribes to data source; partial instantaneous refresh. |

**Content Type (`content_type`)**

| Value | Semantics | Notes |
|:---|:---|:---|
| `"text"` | Plain text | Default. |
| `"markdown"` | Markdown formatted text | Adapter should use native Markdown rendering (tables, code blocks, lists, etc.). |
| `"code"` | Source code block | Adapter should provide syntax highlighting. A `language` field (e.g., `"python"`, `"rust"`) may guide the highlighter. |

**Semantic Widget (`semantic_widget`)**

A Cell may optionally declare a `semantic_widget` field to indicate its interactive role. The protocol defines a minimal set of universal values — **no framework-specific class names are ever allowed**.

| Value | Semantics | Notes |
|:---|:---|:---|
| `"text"` | Static or dynamic text block | Default. |
| `"table"` | Tabular data | Requires `semantic_data` as a 2‑D array. |
| `"list"` | Flat selectable list | Requires `semantic_data` as an array of strings. |
| `"progress"` | Progress bar | Requires `semantic_data` as a number (0–100). |
| `"input"` | Single‑ or multi‑line text input | Supports `placeholder`, `multiline`, `autocomplete`. Must be accompanied by an `actions.onSubmit` that carries `payload.value`. |
| `"modal"` | Overlay dialog for confirmation or alert | **Exempt from the layout grid** — adapters must render it as a centered floating overlay. Must define `actions.onConfirm` and/or `actions.onCancel`. |
| `"tree"` | Hierarchical expandable tree | Uses a `data` field with a recursive `{label, children}` structure. Supports `actions.onNodeSelect`. |

The `semantic_widget` field is always optional. When omitted, adapters default to `"text"`. It is the adapter's responsibility to map these semantics to concrete UI components.

**Modal Special Layout Rule**

Cells with `semantic_widget: "modal"` are exempt from the `weight` allocation. The solver treats them as ordinary cells, but the adapter must ignore their computed coordinates and render them as a centered overlay floating above the main interface.

#### Structured Data Field (`semantic_data`)

An optional field that carries typed payload for semantic widgets. Its type is constrained by the accompanying `semantic_widget`:

| `semantic_widget` | Expected `semantic_data` type | Fallback |
|:---|:---|:---|
| `"text"` (default) | Not required | — |
| `"table"` | `Array<Array<string\|number>>` (2‑D array) | Downgrade to `text`, rendering `content` |
| `"progress"` | `number` (0–100) | Clamp to boundaries; if `NaN`, `Infinity`, or non‑numeric → downgrade to `text` |
| `"list"` | `Array<string>` (1‑D array of strings) | Downgrade to `text`, rendering `content` |

**Data Sanitization and Rendering Security Contract**:

-   **Strict JSON Compliance**: Cellrix payloads must be fully compliant with **RFC 8259**. Non‑standard literals such as `NaN` and `Infinity` are forbidden. Python adapters must intercept them via `json.loads` hooks or use libraries like `orjson`.
-   **Boolean Distinction**: Type validation must strictly distinguish `Number` from `Boolean`; `true`/`false` as `semantic_data` must trigger a downgrade to `text`.
-   **Memory Gate**: Adapters must enforce a hard per‑Cell payload size limit (recommended ≤ 2 MB) **before parsing**, rejecting oversized payloads to prevent OOM attacks.
-   **Anti‑ReDoS**: All input cleaning must execute in $O(N)$ time; never use backtracking‑prone regular expressions.
-   **Table Tolerance**: For `table`/`list`, if any element is a non‑primitive (Object, Array, null, boolean), it must be silently replaced with an empty string `""`, rather than a language‑specific string representation, ensuring cross‑platform consistency. Jagged arrays must be padded with `""`.
-   **Unknown Widget Downgrade**: Any `semantic_widget` value not listed above must be forced back to `"text"`, rendering only the `content` field.

#### Keybinding Visual Enhancement

Each keybinding object may carry optional visual fields to guide adapter‑side rendering:

| Field | Type | Description |
|:---|:---|:---|
| `label` | `string` | Button label. If omitted, the shortcut is invisible but still active. |
| `style` | `string` | Semantic style enum: `primary`, `secondary`, `success`, `danger`, `warning`, `info`. |
| `show_key` | `boolean` | Whether to display the key hint (default `true`). |
| `hint` | `string` (optional) | A CDS hint for the adapter; adapters may ignore it. |

**Rendering Rules**:
-   `key` is **case‑sensitive**: `"a"` matches only the lowercase key, `"A"` matches `Shift+A`.
-   **Key Collision Resolution**: If duplicate `key` values appear within the same `keybindings` array, adopt **First‑Wins** — only the first occurrence is registered, subsequent ones are silently ignored.
-   Invalid `style` values must fall back to the adapter's default button style; no crash.

**Dual-State High-Performance Data Channel**

`source` supports both JSON and Protobuf protocols. The Driver pushes visual content to the Render Tree and summaries to the Semantic Tree after parsing.

**`actions` Secure Event Routing (HITL Security Model)**

`securityClass` defines the operation level (`"safe"`, `"restricted"`, `"critical"`). `requiresApproval` triggers the HITL barrier, containing `timeout`, `timeoutAction`, and `fallbackEmit` fields.

```json
{
  "id": "btn.restart",
  "type": "static",
  "slot": "status_bar",
  "content": "[ Restart Node ]",
  "actions": {
    "onPress": {
      "target": "helix.node_manager",
      "emit": "NODE_RESTART",
      "securityClass": "critical",
      "requiresApproval": {
        "prompt": "Confirm restart of production node tx_1?",
        "timeout": 30000,
        "timeoutAction": "reject",
        "fallbackEmit": "REJECTED_BY_HITL"
      },
      "payload": { "node_id": "tx_1" }
    }
  }
}
```

**HITL State Machine**: Safe/normal → direct execution; restricted/critical → suspended, rendering confirmation barrier. Human confirms → execute; rejected or timeout → execute timeoutAction, send fallbackEmit to AI Agent.

### 4.3 Extension Mechanism & Supply-Chain Security (`Driver` Field)

`type` is never modified; `driver` adds implementation. **Any Driver extension must not redefine core field semantics.**

Production Driver references must use content-addressable identifiers. The Runtime must verify the hash before loading WASM.

```json
{
  "driver": "pkg:wasm/registry.cellrix.dev/ssh@1.2.0?sha256=...",
  "driverConfig": { "host": "...", "auth": { "keyPath": "..." } }
}
```

### 4.4 Parser Behavior Specification (Conformance Mandate)

In addition to the existing rules, the following mandatory clauses are introduced to accommodate the v2.3 structured semantic extensions:

| Scenario | Protocol Contract |
| :--- | :--- |
| **Missing required fields / illegal `type` / `slot` not found** | Reject parsing and return error. |
| **Unknown fields** | Production: ignore and warn; Development: reject parsing. |
| **Constraint conflict** | Downgrade by `priority`. |
| **Permission violation / AI-generated out-of-whitelist** | Runtime rejects and returns rejection reason event. |
| **ANSI injection** | Runtime MUST strip or escape all ANSI escape sequences in external input. Formatting requirements must be implemented via declarative `style` attributes; embedding raw control codes in strings is forbidden. |
| **Missing version** | Parse as v1.0 and issue deprecation warning. |
| **Non‑standard JSON literals** | Reject parsing. `NaN`, `Infinity`, bare `true`/`false` as `semantic_data` must trigger downgrade or rejection. |
| **Oversized payload** | Reject before parsing based on size limits (recommended ≤ 2 MB); do not load into memory. |
| **Illegal semantic widget** | Unknown `semantic_widget` values must silently downgrade to `text`. |
| **`key` collision** | Process according to First‑Wins; silently ignore duplicates. |

---

## 5. Layout Solving Engine & Semantic Tree Standard

### 5.1 Pure-Function Solver

The layout solver must be a unidirectional pure function with O(N) time complexity. The solving algorithm must be backtracking-free — once parent constraints are fixed, child failures must never trigger parent recalculation.

```text
Input: (Manifest, Terminal_Width, Terminal_Height) → Output: (RenderTree, SemanticTree)
```

**Standard Rendering Baseline**: xterm-256color + Unicode 11 East Asian Width.

### 5.2 Dual-Tree Model & Semantic Tree On-Demand Query

| Tree Type | Content | Served To |
| :--- | :--- | :--- |
| **Render Tree** | Physical coordinates and styling, consumed by Client. | Human eyes. |
| **Semantic Tree** | Nested topology, high-level semantics, exposed via Daemon API. | AI agents and visually impaired engineers. |

The Semantic Tree API supports filtering parameters `?slot_id=&limit=&role=`, with data clipping performed by the Runtime at the protocol layer.

### 5.3 Semantic Tree & W3C ARIA Mapping Specification

| Cellrix `role` | W3C ARIA Equivalent | Accessibility Behavior |
| :--- | :--- | :--- |
| `"navigation"` | `role="navigation"` | Recognized as navigation region |
| `"metric"` | `role="status"` + `aria-live="polite"` | TTS announcement on value update |
| `"log_viewer"` | `role="log"` + `aria-live="off"` | Log stream silent, no interruption |
| `"button"` | `role="button"` | Triggers keyboard events |
| `"input"` | `role="textbox"` | Enables text editing mode |

---

## 6. Application Blueprints

Claude Code-style interface: `dynamic` Cell carries conversation stream + `actions.onKey` implements approval interaction.  
htop-style dashboard: `realtime` Cell carries CPU/memory gauges + `dynamic` process list + HITL safe kill.

---

## 7. Key Engineering Challenges and Disciplined Responses

| Challenge | Philosophy Alignment | Solution |
| :--- | :--- | :--- |
| 1. High-frequency JSON serialization bottleneck | Radical Simplicity | Protobuf dual-state channel, outsourced to ecosystem |
| 2. Terminal resize jitter | Absolute Idempotency | Constraint conflict downgrade chain, zero reflow |
| 3. Keyboard/mouse balance | Orchestrate | All interactions translated into isomorphic Intents |
| 4. Emoji/CJK alignment | Strict Contracts | xterm-256color + Unicode 11 baseline |
| 5. Screen reader compatibility | Pure I/O | Semantic Tree ARIA alignment, linearized output |
| 6. Driver crash | Hard Fails | WASI sandbox isolation, independent crash domain |
| 7. AI-generated illegal Manifest | Strict Contracts | Strict mode + capabilities whitelist |
| 8. Cross-platform compatibility | Radical Simplicity | Rely on ecosystem-mature libraries |
| 9. Layout performance degradation | Orchestrate | O(N) backtracking-free solver |
| 10. Cold-start barrier | Radical Simplicity | `cellrix init --template` one-click generation |
| 11. LLM token explosion | Orchestrate | Semantic Tree on-demand query API |
| 12. Driver supply-chain attack | Security-First | Content-addressable URI + SRI hash verification |
| 13. AI monitoring interrupted on terminal disconnect | Orchestrate | Daemon-Client separation, headless closed loop |
| 14. ANSI escape injection | Pure I/O | Rendering layer forced sanitization, no passthrough |
| 15. Extension complexity runaway | Strict Contracts | Conformance test gate, Drivers do not pollute core |
| 16. Illegal structured data format | Strict Contracts + Security-First | Forced downgrade to `text` + empty string placeholder |
| 17. Memory overflow attack (OOM) | Security-First | Hard per‑Cell payload limit ≤ 2 MB, reject before parsing |
| 18. ReDoS cleaning block | Security-First + Radical Simplicity | $O(N)$ linear filtering, backtracking regex forbidden |

---

## 8. Protocol Governance & Version Evolution

### 8.1 Version Semantics

| Version Change | Allowed Behavior |
| :--- | :--- |
| **Major version** | Breaking changes allowed. Old Manifests must identify via `version` field and migrate. |
| **Minor version** | Only new optional fields added; deprecated fields must be supported for at least one major version cycle. |
| **Missing version** | Parse as v1.0 and issue deprecation warning. |

### 8.2 Governance Model

Cellrix protocol evolution follows the **RFC model** (CEP, Cellrix Enhancement Proposal):
1. Anyone may submit a CEP.
2. Public discussion period ≥ 14 days.
3. After acceptance, a PR with Conformance Test must accompany the specification merge.
4. Governance does not depend on a single individual; decisions are made by consensus of the Core Team.

**Any proposal that violates the core axioms of "Pure I/O", "Strict Contracts", "Radical Simplicity", or "Absolute Idempotency" will be rejected outright without technical evaluation.**

---

## 9. Roadmap

**Phase 1 (Current – 2026 Q3)**
Release v2.3 Schema and complete specification, CEP-0001 initiates governance, reference implementation validates the full chain, AG-UI/MCP bridge design, Conformance Suite published (including structured semantic boundary tests).

**Phase 2 (2026 Q4 – 2027 Q2)**
Production adapter development, WASI sandbox prototype, HITL interceptor, `cellrix preview` CLI, full rendering of `semantic_data` widgets.

**Phase 3 (2027 Q3 –)**
Spatial-CRDT collaborative algorithm, enterprise HITL auditing, Semantic Tree to Web-Accessibility bridge, multi-backend adapter ecosystem matures.

---

## 10. Conclusion

Cellrix is an engineering practice born from real pain points and governed by first principles. It does not strive to be the most beautiful terminal canvas, but to be the most **efficient, stable, secure, and inclusive** interaction hub.

Following the philosophy of **orchestrate over build, strict contracts, pure I/O, absolute idempotency, radical simplicity, security-first**, we strictly separate protocol from implementation. The protocol is the sacred interface; implementations are a diverse competition.

**We reject ambiguity, embrace determinism. We reject black boxes, embrace security. We reject complexity, embrace simplicity. We reject governance vacuum, embrace open evolution.**

---

## Revision History

| Version | Date | Major Changes |
| :--- | :--- | :--- |
| v1.2.0 | 2026-05-06 | ANSI sanitization, O(N) solver constraints, governance model, AI whitelist |
| v2.0 | 2026-05-06 | Injected Helix Zen design philosophy, clarified protocol-implementation boundary, rewritten principles into six axioms, added philosophy-review governance clause |
| v2.1 | 2026-05-07 | Added multi-backend rendering architecture declaration, added semantic widget enumeration (semantic_widget), clarified protocol rendering-backend agnosticism |
| v2.2 | 2026-05-08 | Content types (content_type), semantic widget extension (input/modal/tree), Modal special layout rule, aligned with CIS v0.3.0 |
| **v2.3** | **2026-05-12** | **Structured semantic extension (`semantic_data`), Visual Control Inversion principle (CDS), keybinding visual enhancement, infrastructure-grade security & robustness defence clauses** |

---

**This Whitepaper is the supreme constitution of the Cellrix project. All code, documentation, and decisions must be completed within this framework.**
