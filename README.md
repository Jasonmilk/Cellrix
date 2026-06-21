# Cellrix (`cx`)

> **An Intent-Driven, Deterministic, Spatial-Semantic Terminal UI Protocol and High-Performance Runtime.**
> Aligned with the **CommonIntents-144 (`CI-144`)** Protocol Family.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Protocol](https://img.shields.io/badge/Protocol-CI--144-blue.svg)]()
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange.svg)]()
[![License](https://img.shields.io/badge/License-MIT-blue.svg)]()

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

## 2. CI-144 Protocol Family Compliance

Cellrix is the official reference implementation of the **CommonIntents-144 (CI-144)** protocol family:

*   **`CIN7` (INTENT-7)**: Defines the intent schema, structuring snapshots into 7 core semantic fields. It mandates a hard safety limit of **256 nodes** and **1MB content** per node to prevent DDoS and memory exhaustion (OOM) on resource-constrained devices.
*   **`CIC13` (CAPABILITY-13)**: Governs capability authorization and confirmation. The Display Server intercepts focus switches and routes downstream `sys_suspend` and `sys_resume` commands, allowing agents to execute local self-throttling.
*   **`CIB19` (BIND-19)**: Establishes the transmission binding, mandating a prime-number heartbeat interval of **19 seconds** (to prevent multi-agent network resonance) and a client timeout threshold of **40 seconds**.

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

### 6.4 Run the Interactive TUI
To launch the display server with the bundled mock-agent, run:
```bash
# 1. Start the TUI Display Server (Awaiting connections)
cargo run --release -p cellrix-cli -- run --mode uds --socket /tmp/cellrix.sock

# 2. In a separate terminal, launch the Mock Agent to connect and stream
cargo run --release -p mock-agent -- --mode uds --socket /tmp/cellrix.sock
```

---

## 7. Testing & Verification

Following Google’s strict hermetic testing conventions, all integration tests are isolated inside crate-level `tests/` directories.

To run the robust, panic-prevention test suite for the `cellrix-protocol` parser (covering corrupted JSON recovery and DDoS payload truncations):
```bash
cargo test -p cellrix-protocol --test parser_test
```

To run the UDS integration tests verifying **CIB19 heartbeat watchdog self-healing** and **symmetrical multi-client handshakes**:
```bash
cargo test -p cellrix-transport --test uds_test
```

---

## 8. License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
