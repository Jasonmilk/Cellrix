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
│    "node_type": "text_panel", │  │  │ ● Instructions          │  │
│    "slot": "main" }           │  │  │ # Hello from mock agent │  │
└───────────────────────────────┘  └───────────────────────────────┘
```

---

## 2. CI-144 Protocol Family Compliance

Cellrix is the official reference implementation of the **CommonIntents-144 (CI-144)** protocol family:

*   **`CIN7` (INTENT-7)**: Defines the intent schema, structuring snapshots into 7 core semantic fields. It mandates a hard safety limit of **256 nodes** and **1MB content** per node to prevent DDoS and memory exhaustion (OOM) on resource-constrained devices.
*   **`CIC13` (CAPABILITY-13)**: Governs capability authorization and confirmation using a 13-byte cryptographic salt token to prevent action replay attacks.
*   **`CIB19` (BIND-19)**: Establishes the transmission binding, mandating a prime-number heartbeat interval of **19 seconds** (to prevent multi-agent network resonance) and a client timeout threshold of **40 seconds**.

---

## 3. Crate Workspace Architecture

The workspace is split into decoupled, isolated crates to guarantee maximum portability and WebAssembly (WASM) cross-compilation:

```text
cellrix/ (Workspace Root)
├── cellrix-protocol/ (`protocol`)   # Aligns CIN7/CIC13. Zero-dependency, WASM-compilable.
├── cellrix-layout/   (`layout`)     # Pure math layout engine & DFS Focus Manager. No TUI dependencies.
├── cellrix-ui/       (`ui`)         # Dumb renderer (Ratatui). Translates slots to visual buffers.
├── cellrix-transport/(`transport`)  # Stdio/UDS transmission adapters implementing CIB19.
└── cellrix-cli/      (`cli`)        # The command-line tool launcher (cx).
```

---

## 4. Somatic Monasticism Aesthetics

Cellrix is built on a quiet, high-contrast, low-energy palette where colors represent **system states**, never decoration:
*   **Volcano Base Background**: `#18181A` (RGB: 24, 24, 26)
*   **Paper White Text**: `#E4E4E7` (RGB: 228, 228, 231)
*   **Monastic Indigo Highlight**: `#5B5FC7` (RGB: 91, 95, 199) — activated during active reasoning or focused states.
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
| **`Ctrl+O`** | Toggle **Zen Mode** (100% viewport expansion) | **Nano** (`^O` WriteOut) & **Claude Code** view toggle |
| **`Ctrl+L`** | Redraw terminal buffer | Readline / Terminal redraw standard |
| **`Ctrl+C`** | Graceful exit (Restores alternate screen cleanly) | Nano (`^X`) & standard Unix interrupt |
| **`Left-Click`** | Focus clicked panel immediately | Intuitive spatial hit-testing |
| **`Left-Click + Drag`** | Trigger custom high-precision copying | **Pillar B**: Column-isolated copy, bypassing borders |
| **`Shift + Drag`** | Native OS terminal copying bypass | Unix-native bypass standard |

### 5.1 High-Precision Column-Isolated Copying
When performing a normal drag selection, Cellrix intercepting mouse coordinates, performs a spatial intersection check, and extracts text *solely* from the active focused node (with an automatic pretty-printed JSON fallback for structured metadata panels like `StateTree`). 

The extracted text is base64 encoded and written using the **OSC 52 escape sequence** (`\x1b]52;c;...`), allowing you to copy text seamlessly to your local Mac/PC clipboard **even over remote, headless SSH connections with zero X11/clipboard dependencies on the server!**

---

## 6. Getting Started

### 6.1 Prerequisites
Ensure you have the Rust toolchain installed:
```bash
rustup default stable
```

### 6.2 Build the Workspace
To prevent multi-agent CPU starvation in unoptimized debug-mode loops, we highly recommend building and running in **Release mode**:
```bash
cargo build --release --workspace
```

### 6.3 Run the Interactive TUI
To launch the interactive terminal UI with the bundled mock-agent over an automated STDIO pipeline, run:
```bash
cargo run --release -p cellrix-cli -- run --mode stdio --exec target/release/mock-agent
```

---

## 7. Testing & Verification

Following Google’s strict hermetic testing conventions, all integration tests are isolated inside crate-level `tests/` directories.

To run the robust, panic-prevention test suite for the `cellrix-protocol` parser (covering corrupted JSON recovery and DDoS payload truncations):
```bash
cargo test -p cellrix-protocol --test parser_test
```

---

## 8. License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
