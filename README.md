# Cellrix (`cx`)

> **An Intent-Driven, Deterministic, Spatial-Semantic Terminal UI Protocol and High-Performance Runtime.**
> Aligned with the **CommonIntents-144 (`CI-144`)** Protocol Family.
> **Ecosystem Integrated**: Tuck (Security) + Helix-Mind (Memory/Cognition) + Anaphase (Orchestration) + Tentacle (Tool Execution)

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Protocol](https://img.shields.io/badge/Protocol-CI--144%20v2.0-blue.svg)]()
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange.svg)]()
[![License](https://img.shields.io/badge/License-MIT-blue.svg)]()
[![Tests](https://img.shields.io/badge/tests-316-green.svg)]()
[![Phases](https://img.shields.io/badge/phases-P0--P6%20complete-5B5FC7.svg)]()

---

## 0. Project Status (2026-08-30) 🎉 All Phases Complete

| Phase | Content | Status |
|---|---|---|
| **P0** | Methodology Init + Code Audit | ✅ Complete |
| **P1** | CI-144 v2.0 Alignment (PFP + SAP) | ✅ Complete |
| **P2** | Tuck Integration (Audit Log + Security Events) | ✅ Complete |
| **P3** | Helix-Mind Integration (Semantic Snapshot + Cognitive Craft) | ✅ Complete |
| **P4** | Anaphase Integration (Orchestration + HITL) | ✅ Complete |
| **P5** | Tentacle Integration (Tool Execution + Plugin Audit) | ✅ Complete |
| **P6** | Production Ready (Config/Logging/Monitoring/Deploy) | ✅ Complete |

**Test Coverage**: 316 tests (307 + 9 cockpit: widget 3 + AppState 1 + snapshot views 2 + parse 3)
- `cellrix-protocol`: 133 tests
- `cellrix-ui`: 88 tests
- cockpit live roundtrip: `transport/tests/anaphase_live.rs` (#[ignore], needs live Anaphase)
- cockpit TUI (real render): see §6.4 (stdio/uds, verified 2026-09-06 both channels)
- `cellrix-transport`: 85 tests
- Other: 5 tests

**Helix Ecosystem Full Integration**:
- **Tuck** (Security/Immune System) — Audit Log + Security Events + PFP Visualization
- **Helix-Mind** (Memory/Cognition) — Semantic Snapshot + Cognitive Craft + Knowledge Graph
- **Anaphase** (Orchestration) — Task DAG + HITL + Lifecycle + Cognitive Phase
- **Tentacle** (Tool Execution) — Tool Execution + Plugin Audit + Call Chain
- **Production Ready** — Config + Logging + Health Check + Metrics

---

## 1. Executive Philosophy: Why Cellrix?

Traditional Terminal UIs (TUIs) and graphical interfaces are designed exclusively for **carbon-based visual perception**. They render pixels or raw characters in absolute coordinates. When **silicon-based agents (AI)** interact with them, they must either parse cluttered, non-standard text dumps or execute costly visual OCR.

**Cellrix bridges the comprehension gap between carbon and silicon minds.** 

By treating the terminal screen not as a raw canvas, but as a **grid of deterministic, semantic cells**, Cellrix implements a dual-aspect spatial-semantic paradigm:
- **To Human Eyes**: It presents a beautiful, responsive visual layout following the **Somatic Monasticism** aesthetic.
- **To Silicon Agents**: It exposes a deterministic topological graph of semantic nodes (`CIN7`), allowing the agent to navigate, inspect, and interact without visual friction or screen scraping.

```
       [ Silicon Agent ]                   [ Carbon Human ]
               │                                  │
      (CIN7 / CIB19 Stream)             (Crossterm TUI Render)
               ▼                                  ▼
┌───────────────────────────────┐  ┌───────────────────────────────┐
│     Semantic Topology         │  │     Somatic Visual Grid       │
│  { "id": "text_1",            │  │  ┌─────────────────────────┐  │
│    "node_type": "text_panel", │  │  │ ● ACTIVE SENSORS        │  │
│    "slot": "main" }           │  │  │ # Hello from mock agent │  │
└───────────────────────────────┘  └───────────────────────────────┘
```

---

## 2. CI-144 Protocol Family Compliance (v2.0)

Cellrix is the official reference implementation of the **CommonIntents-144 (CI-144)** protocol family, now upgraded to **v2.0** with the Physical Anchor Layer:

### 2.1 Core Protocols (v1.0)

*   **`CIN7` (INTENT-7)**: Defines the intent schema, structuring snapshots into 7 core semantic fields. It mandates a hard safety limit of **256 nodes** and **1MB content** per node to prevent DDoS and memory exhaustion (OOM) on resource-constrained devices.
*   **`CIC13` (CAPABILITY-13)**: Governs capability authorization and confirmation. The Display Server intercepts focus switches and routes downstream `sys_suspend` and `sys_resume` commands, allowing agents to execute local self-throttling.
*   **`CIB19` (BIND-19)**: Establishes the transmission binding, mandating a prime-number heartbeat interval of **19 seconds** (to prevent multi-agent network resonance) and a client timeout threshold of **40 seconds**.

### 2.2 v2.0 Physical Anchor Layer (PFP + SAP)

*   **`PFP-xCF14` (Physical Feature Protocol)**: 4-byte fixed-offset header carrying physical context for hard real-time security decisions.
    - Fields: Modality (COGNITIVE/RENDER/EXECUTIVE/SENSOR_FEED), Risk-Level (LOW/MEDIUM/CRITICAL/CATASTROPHIC), Body-Stance, Proximity-Edge, Output-Dest, Override-Flag, Replay-Enable
    - Magic number: `0xCF14` (2 bytes) + 1 byte protocol ID + 1 byte data
    - Tuck reads only PFP for sub-millisecond security decisions — no decryption required
*   **`SAP-xCF14` (Security Attestation Protocol)**: 28-byte optional security layer loaded on-demand.
    - Fields: Seq-Counter (16-bit anti-replay), PAH-Hash (112-bit SHA-256 truncated), PAH-Signature (64-bit ECC truncated)
    - Rule 6: Replay-Enable=0 forces Risk-Level downgrade to MEDIUM + mandatory PAH verification
    - Dual-layer security: 64-bit fast verification (Tuck real-time) + 512-bit full verification (post-hoc audit)

---

## 2.5 Ecosystem Integration

Cellrix is the **semantic projection terminal** for the Helix ecosystem, integrating with all core components:

| Component | Role | Integration Status |
|---|---|---|
| **Tuck** | Immune System (Security Gate) | ✅ Audit log consumption + security event visualization |
| **Helix-Mind** | Memory & Cognition (Brain) | ✅ Semantic snapshot + cognitive craft + metabolism display |
| **Anaphase** | Orchestration (Torso) | ⏳ P4: Task queue + HITL interaction |
| **Tentacle** | Tool Execution (Hands) | ⏳ P5: Tool status + plugin audit |

### Tuck Integration (P2 Complete)
- **Audit Log Reader**: Consumes Tuck's chain-HMAC tamper-proof audit logs (JSON Lines format)
- **Security Event System**: 5-level priority queue (Info/Pass/Reject/HITL/HardOverride) with notification banners, confirm dialogs, and emergency full-screen overlays
- **PFP Visualization**: 7-field color-coded physical feature display with risk-level progress bars and Rule 6 downgrade support

### Helix-Mind Integration (P3 Complete)
- **Cognitive Craft Display**: Real-time visualization of CognitiveMode (Skilled/Anchor/Imagination), impasse level (0-5), stages attempted, suggested actions, and activation vectors
- **Memory Metabolism Display**: Phase state indicator (Gas/Liquid/Crystal ●/○), heat/tension progress bars, concentration (Dissolved/Colloidal), generation count
- **Knowledge Graph Display**: Node/edge lists with heat-based color coding, phase state tags, and relation type visualization
- **Client Trait + Mock**: `HelixMindClient` trait with 7 methods (query/remember/forget/helix_query/consolidate/get_snapshot/health_check) + `MockHelixMindClient` for testing and development

---

## 3. Crate Workspace Architecture

The workspace is split into decoupled, isolated crates to guarantee maximum portability and WebAssembly (WASM) cross-compilation:

```text
cellrix/ (Workspace Root)
├── cellrix-protocol/ (`protocol`)   # Aligns CIN7/CIC13. Zero-dependency, 100% WASM-compilable.
├── cellrix-layout/   (`layout`)     # Pure math layout engine & DFS Focus Manager. Exposes WASM bindings.
├── cellrix-ui/       (`ui`)         # Modularized UI. AppState is decoupled from Crossterm IO for WASM.
├── cellrix-transport/(`transport`)  # Multiplexed UDS/Stdio Display Server implementing CIB19 watchdogs.
└── cellrix-cli/      (`cli`)        # The command-line tool launcher (cx).
```

### 3.1 Symmetrical Wayland-Style Multi-Client Multiplexing
Unlike traditional TUIs bound to a single process, `cellrix-transport` implements a **UDS Multiplexing Daemon**. Cellrix acts as the Wayland-style display server (accepting connections), while your agents connect passively as clients. 
- **Active client (In focus)**: Cellrix performs full, high-speed deserialization of the incoming `AgentEvent::Snapshot`.
- **Inactive clients (In background)**: Cellrix performs **lightweight tag peeking** using `serde::de::IgnoredAny`. It skips the massive snapshot body entirely—resulting in **absolute zero heap allocation**—and drains the raw bytes safely from the socket buffer to prevent background client thread-blocking.

---

## 4. Somatic Monasticism Aesthetics

Cellrix is built on a quiet, high-contrast, low-energy palette where colors represent **system states**, never decoration:
*   **Volcano Base Background**: `#18181A` (RGB: 24, 24, 26)
*   **Paper White Text**: `#E4E4E7` (RGB: 228, 228, 231)
*   **Monastic Indigo Highlight**: `#5B5FC7` (RGB: 91, 95, 199) — activated during active reasoning, focused states, or active tab indicators.
*   **Alert Amber**: `#D08770` (RGB: 208, 135, 112) — triggered during high-risk actions or active Zen modes.
*   **Slate Gray secondary**: `#71717A` (RGB: 113, 113, 122)

---

## 5. Interaction Manifesto & Keybindings

All keybindings and mouse interactions are designed to respect professional developer habits (Vim, Tmux, Claude Code, and Nano):

| Shortcut Key / Action | Behavior | Design Philosophy |
|:---|:---|:---|
| **`Tab`** | Focus next interactive panel or button | Standard TUI DFS traversal |
| **`Shift+Tab`** | Focus previous interactive panel or button | Reverse TUI DFS traversal |
| **`Alt + Left/Right`** | Cycle slot active node (tabbed views) | **Claude Code** Agent View tab switching |
| **`Alt + n`** | Focus next active Agent (swaps active stream) | Dynamic multi-agent active routing |
| **`Alt + p`** | Focus previous active Agent (swaps active stream) | Dynamic multi-agent active routing |
| **`Ctrl+O`** | Toggle **Zen Mode** (100% viewport expansion) | **Nano** (`^O` WriteOut) & **Claude Code** view toggle |
| **`Ctrl+L`** | Redraw terminal buffer | Readline / Terminal redraw standard |
| **`Ctrl+C`** | Graceful exit (Restores alternate screen cleanly) | Nano (`^X`) & standard Unix interrupt |
| **`Left-Click`** | Focus clicked panel immediately | Intuitive spatial hit-testing |
| **`Left-Click + Drag`** | Trigger custom high-precision copying | **Pillar B**: Column-isolated copy, bypassing borders |
| **`Shift + Drag`** | Native OS terminal copying bypass | Unix-native bypass standard |

---

## 6. Getting Started

### 6.1 Prerequisites
Ensure you have the Rust toolchain and target installed:
```bash
rustup default stable
rustup target add wasm32-unknown-unknown
```

### 6.2 Build the Workspace (Native TUI)
To prevent multi-agent CPU starvation in unoptimized debug-mode loops, we highly recommend building and running in **Release mode**:
```bash
cargo build --release --workspace
```

### 6.3 Build the Layout Solver (WebAssembly)
To compile the pure-mathematical `cellrix-layout` engine for browser WebGL/R3F high-fidelity holographic projection environments, run:
```bash
cargo build --target wasm32-unknown-unknown -p cellrix-layout
```
*(Alternatively, use `wasm-pack build layout --target web` to generate standard JS/TS glue bindings).*

### 6.4 Anaphase Cockpit (驾驶舱, candidate G, ADR-0009)

The cockpit projects the Anaphase conscious-layer snapshot (mode / cognitive
state / episode / ledger) — a white-box window into the agent. Point it at a
running Anaphase (the `up` launcher in anaphase-helix starts one for you).

**Two transports** (choose one; `--mode` is the transport, not the app mode):

```bash
# stdio: cockpit spawns the agent itself (single terminal, simplest)
cellrix-cli run --mode stdio --exec ./target/debug/mock-agent --anaphase-endpoint http://127.0.0.1:50061

# uds: cockpit is the display server, agent connects to the socket (two terminals)
cellrix-cli run --mode uds --socket /tmp/cellrix.sock --anaphase-endpoint http://127.0.0.1:50061
mock-agent --mode uds --socket /tmp/cellrix.sock
```

> Note: `--anaphase-endpoint` defaults to `http://127.0.0.1:50061` (Anaphase
> cap_http). Override with `ANAPHASE_ENDPOINT` for live tests. The cockpit tab
> shows: mode bar (`[DRIVE]/[PARTNER]/[SURVIVE]`), cognitive state, episode
> status, and the real ledger entries (`MET/UNMET` with trace ids) — same
> snapshot protocol the future Web panel (G2) will consume.

**Easiest path**: build once, then run everything from anaphase-helix:

```bash
cargo run --bin up -- --cockpit   # in anaphase-helix: tentacle + anaphase + cockpit
```

---


### Web 面板（Web Panel）

浏览器即开的 Anaphase 驾驶舱白盒窗口（ADR-0014）。与 TUI 共享同一
snapshot 协议——模式 / 认知状态 / 经历 / ledger 逐条可查，自动刷新。

```bash
cargo run -p cellrix-web          # 打开 http://127.0.0.1:8080
# --anaphase-endpoint 默认 http://127.0.0.1:50061（Anaphase cap_http 协议默认）
# --port / WEB_PORT 默认 8080
```

零依赖（std-only HTTP + 单文件 HTML，无构建链）。先起 Anaphase
（`cargo run --bin up`）再看面板；未起时页面显示离线。

## 7. Testing & Verification

Following Google’s strict hermetic testing conventions, all integration tests are isolated inside crate-level `tests/` directories.

### 7.1 Test Coverage (156 tests total)

| Crate | Tests | Coverage |
|---|---|---|
| `cellrix-protocol` | 78 | PFP/SAP parser, snapshot, helix_mind data structures, tuck_audit |
| `cellrix-ui` | 57 | State tree, text panel, audit widgets, PFP widgets, security notifications, helix_mind widgets |
| `cellrix-transport` | 17 | UDS multiplexing, helix_mind client (trait + mock) |
| Other | 4 | Integration tests |

### 7.2 Run Specific Test Suites

To run the robust, panic-prevention test suite for the `cellrix-protocol` parser (covering corrupted JSON recovery and DDoS payload truncations):
```bash
cargo test -p cellrix-protocol --test parser_test
```

To run the UDS integration tests verifying **CIB19 heartbeat watchdog self-healing** and **symmetrical multi-client handshakes**:
```bash
cargo test -p cellrix-transport --test uds_test
```

To run PFP/SAP protocol parser tests (CI-144 v2.0 alignment):
```bash
cargo test -p cellrix-protocol pfp
cargo test -p cellrix-protocol sap
```

To run Helix-Mind integration tests (data structures + client + UI widgets):
```bash
cargo test -p cellrix-protocol helix_mind
cargo test -p cellrix-transport helix_mind
cargo test -p cellrix-ui helix_mind
```

To run Tuck integration tests (audit log + security events + PFP visualization):
```bash
cargo test -p cellrix-protocol tuck_audit
cargo test -p cellrix-ui audit
cargo test -p cellrix-ui pfp
cargo test -p cellrix-ui security
```

To run the full workspace test suite:
```bash
cargo test --workspace
```

---

## 8. Methodology: phyt-DNA v1.0

Cellrix follows the **phyt-DNA** (Plant DNA) self-growth methodology, ensuring knowledge doesn't腐化, growth paths stay clear, decisions are traceable, and documentation lifecycle is managed:

| Component | Purpose | Path |
|---|---|---|
| **VISION** | North Star vision document | `docs/VISION.md` |
| **DNA** | Core philosophy & principles | `docs/DNA.md` |
| **RNA** | Standard Operating Procedures (SOP) | `docs/RNA.md` |
| **SPEC** | Technical specification (5 volumes) | `docs/SPEC.md` + `docs/spec/` |
| **PLAN** | Current phase navigation card | `docs/PLAN.md` |
| **GROWTH** | Last 3 health snapshots | `docs/GROWTH.md` |
| **DEPRECATE** | Deprecated features & migration | `docs/DEPRECATE.md` |
| **ADR** | Architecture Decision Records | `docs/decisions/ADR-XXXX-*.md` |
| **Archive** | Archived growth snapshots | `docs/archive/growth/` |

### Architecture Decision Records (ADR)

| ADR | Title | Status |
|---|---|---|
| ADR-0001 | Methodology Initialization | ✅ Adopted |
| ADR-0002 | CI-144 v2.0 Alignment (PFP+SAP) | ✅ Adopted |
| ADR-0003 | Tuck Integration Architecture | ✅ Adopted |
| ADR-0004 | CPPC v1.1.0 as v2.0 Vision | ✅ Adopted |
| ADR-0005 | Helix-Mind Integration Architecture | ✅ Adopted |

### CPPC v1.1.0 Vision (Cellrix Physical Protocol Charter)

The **Cellrix Physical Protocol Charter (CPPC) v1.1.0** defines the long-term vision for Cellrix v2.0:
- **Three Physical Laws**: Pure Symbolic Contract + Logical State Determinism + Physical Layer Sovereignty
- **Dual Universe Architecture**: Logic Universe (pure symbols) + Physical Universe (native rendering)
- **12 Core Reserved Tokens**: 6 structure types + 5 spatial layout + 1 interaction trigger
- **Patch Algebra**: INSERT/DELETE/UPDATE/REPLACE/TAKE/PLACE (MOVE abolished)
- **Full-Incremental Dual Track**: Initial full snapshot + steady-state incremental patches + logical checkpoints (100 patches / 5 minutes)

See `docs/vision/cppc-v1.1.0.md` for the full charter.

---

## 9. License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
