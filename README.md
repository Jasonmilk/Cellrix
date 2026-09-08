# Cellrix (`cx`)

> **An Intent-Driven, Deterministic, Spatial-Semantic Terminal UI Protocol and High-Performance Runtime.**
> Aligned with the **CommonIntents-144 (`CI-144`)** Protocol Family.
> **Ecosystem Integrated**: Tuck (Security) + Helix-Mind (Memory/Cognition) + Anaphase (Orchestration) + Tentacle (Tool Execution)

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Protocol](https://img.shields.io/badge/Protocol-CI--144%20v2.0-blue.svg)]()
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange.svg)]()
[![License](https://img.shields.io/badge/License-MIT-blue.svg)]()
[![Tests](https://img.shields.io/badge/tests-341-green.svg)]()
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

> **Status 2026-09-09 (ADR-0015 + 印痕 v3)**: WebUI redesigned under the
> **水之波光 · 触境 (Lumtact)** design system — design tokens are sourced
> one-to-one from `lumtract/web-viewer/src/design/lumtact-tokens.css`
> (dark/light dual theme with `跟随/日间/暗黑` switcher, `[PHYS:D-006]`),
> ripple feedback grows from the trigger coordinate, hit targets ≥44px
> (`[PHYS:P-010]`), timings 120/200/260ms (`[PHYS:P-004/P-005]`).
> **Engram v3** is the 水之波光 **Harness v11.2.0 trajectory skeleton**:
> five-column event table (type/summary/status/duration/tokens) + Overview
> three-track timeline (Input/Model/Tools sharing one horizontal ruler) +
> toolbar (mono-width / fold turns / unfold calls / replay / search) +
> bottom stats bar + right inspector drawer (Summary/Payload/Result/
> Schema/Timing) — rendered from the standalone asset
> `web/assets/engram.html` (`e-` prefixed tokens, view-scoped isolation).
> Semantic status (Met/Unmet/PASS/FAIL/ok/fail) keeps semantic colors
> (`[PHYS:L-002]`). Selected rows highlight with background only — no
> colored bold left border (`[PHYS:D-003]`). Status dots are static
> (idle animation violates `[PHYS:R-003]`); degradation ladder covers
> reduced-motion / high-contrast / narrow screens (卷三 3.5.3).
>
> **Status 2026-09-08**: Web panel (:8080) is now the primary white-box
> window (ADR-0033): 印痕 Engram (pre-v3) was a DSH-style **turn outline**;
> chat shows a collapsible **思考 (think) row** (streamed `think` field,
> display-only, never judged) and the SSE stream is deterministically
> drained (events before the terminal `{done,reply}`, reply is
> authoritative — no truncated answers); sessions are auto-named from the
> first user message and **renameable** (✎, sidecar `.name`, empty =
> fallback to auto name); **续接** (resume) dropdown in the chat-input's
> bottom-right continues an explicit experience — selecting one **loads
> that experience's history into the chat space** (messages, answers,
> tool outcomes), then the next sentence continues it.
>
> **Chain integrity (ADR-0029)**: the imprint is a closed loop —
> physical outcome → deterministic check → audited verdict. `tool/result`
> rows carry `outcome + outcome_sha` (byte-verifiable product), every
> criteria report becomes a `check/status` row (judge/gate/expect/
> evidence_id/reason — no bare labels), `VERDICT` carries its reason,
> and `END.success ≡ (verdict ≠ Unmet)` (never self-reported). Private
> thinking persists as `assistant/think` (redacted, display-only) and
> every expandable row uses **one fold primitive** (click to expand /
> click to close / hover to preview). Transport faults never interrupt a
> streamed answer — a partial answer is kept, only a fault with no
> content toasts. `POST /v1/crystallize` distills UNMET rounds into
> 0-token rule suggestions (machine suggests, human reviews, nothing
> auto-injected). TUI/Web share one state model (isomorphic display;
> renderers are thin backends).
> **Start**: `cargo run --bin up` from the repo root — Enter through the
> prompts, the panel opens at http://127.0.0.1:8080/ (or `up --restart`
> to restart the whole ecosystem; bind/1-to-1 pairing happens on first
> launch).
> **全链路正文回放**：Anaphase 设 `reasoning_trace_path`（本地 config）后，Engram 详情可回放每轮 prompt/response（写前脱敏 + 截断）；推理经 `x-tuck-trace` 头把 `run-xxx` id 传给 Tuck 审计链，链与正文共用一键 join。

**Test Coverage**: 327 tests (实测 `cargo test --workspace --all-features`, 2026-09-07, 0 failed)
- `cellrix-protocol`: 137 tests (incl. `engram` real-chain shapes)
- `cellrix-transport`: 95 tests (incl. `tuck_audit_client` e2e + live gateway)
- `cellrix-ui`: 90 tests
- cockpit live roundtrip: `transport/tests/anaphase_live.rs` (#[ignore], needs live Anaphase)
- Engram live gateway: `transport/src/tuck_audit_client.rs` `live_fetch_from_real_gateway` (#[ignore], needs the Tuck gateway on :60052)
- cockpit TUI (real render): see §6.4 (stdio/uds, verified 2026-09-06 both channels)
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
running Anaphase (the `up` launcher below starts one for you).

**Two transports** (choose one; `--mode` is the transport, not the app mode):

```bash
# stdio: cockpit spawns the agent itself (single terminal, simplest)
cellrix-cli run --mode stdio --exec /path/to/anaphase --anaphase-endpoint http://127.0.0.1:50061

# uds: cockpit is the display server, agent connects to the socket (two terminals)
cellrix-cli run --mode uds --socket /tmp/cellrix.sock --anaphase-endpoint http://127.0.0.1:50061
mock-agent --mode uds --socket /tmp/cellrix.sock
```

> **Cockpit chat (verified 2026-09-06, real LLM round trip)**: a fixed
> 3-row chat box is always visible at the bottom — press **Enter** (with no
> action button selected) to focus it, type, **Enter** sends one cognitive
> period (Mind retrieval → LLM reasoning → Tentacle execution → ledger),
> **Esc** blurs (draft kept). The status row shows the result: green ✓ reply /
> red ✗ failure; sending keeps focus for a continuous conversation. The
> declarative `needs_input` action buttons work the same way.

> **CI-144 stdio closed loop (ADR-0017, verified 2026-09-06)**: the stdio
> transport speaks the full ecosystem dialect with the *real* Anaphase
> binary — CIB/1.0 handshake → MessagePack frames → Manifest → snapshot
> push → `send_action` round trips. Anaphase accepts the launcher convention
> `--mode stdio` (and its native `--stdio`); `StdioTransport::send_action`
> routes ActionResponses through a dedicated channel (single background
> reader owns stdout — no frame stealing). Verified live end to end:
> `manifest` / `snapshot` / `action` subcommands against the real binary
> (`transport/tests/ci144_anaphase_live.rs`, #[ignore]).

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

**已验证**（2026-09-06）：`anaphase :50061 snapshot → cellrix-web :8080 代理`
全链路实测通过——mode / state / episode / ledger / ecosystem 六组件点亮，
2 秒轮询，`curl http://127.0.0.1:8080/api/snapshot` 返回真实快照。

### 6.9 操作方式（2026-09-07）

**Web 面板**：鼠标点击顶部标签切换（驾驶舱/印痕/对话）；对话页输入框打字后
回车发送（或点「发送」）。回复以 **SSE 流式**逐字渲染（打字机效果）——浏览器
请求带 `Accept: text/event-stream`，面板按字节管道透传 Anaphase 的流式输出
（`delta` 增量 + `done` 收尾行）；旧客户端 / curl 不带该头时自动回落一次性
JSON（同一契约两种传输）。

**TUI 终端**（`up` 选 2）：
- 启动后自动聚焦对话输入（语义树里 agent 声明的 send_message 按钮），
  打开即可直接打字；
- `Enter` 发送，`Esc` 退出输入框（草稿保留）；
- `Tab` 移动焦点，`Ctrl+T` 开关鼠标捕获，`q` 退出；
- 底部面板显示对话记录（谁 + HH:MM + 内容），与 WebUI 消息流同构。

**同构契约**（TUI ↔ WebUI）：同一数据源（Anaphase snapshot / Tuck audit /
同一对话语义），同一视图结构（驾驶舱 / 印痕 / 对话），错误一律不进对话流
（TUI 状态行红字 = WebUI 居中 toast）。差异仅限渲染介质（终端 vs 浏览器）：
TUI 走 stdio 语义树，WebUI 走 HTTP + SSE——语义一致，传输不同。

### 6.10 一键重启 + 生态点亮（2026-09-07）

**`up --restart`**：一条命令重启全部生态，零提问。停止按逆依赖序
（面板 → Tuck → Anaphase → Mind → Tentacle），启动按依赖序
（Tentacle → Mind → Anaphase → Tuck → 面板），每步健康检查后如实报告。
各组件启动命令从固定工作区布局 + 各服务协议默认值推导；`~/.cellrix/up.toml`
里保存的自定义命令优先（anaphase_cmd / tuck_cmd）。

```bash
cd Cellrix
cargo run --bin up -- --restart     # 或 target/debug/up --restart
```

**生态点亮条**（Web 面板顶部）：tentacle :50051 / mind :50052 / anaphase
:50061 / tuck :60052 / panel —— 每组件一个状态点：
`绿 = 健康` · `黄 = 端口通但健康探测未过` · `灰 = 未运行` · `红 = 错误`。
数据源 `/api/ecosystem`（TCP 探测 + HTTP health 双检，协议默认端口，
无硬编码）。

**印痕 Engram v3（水之波光 v11.2.0 轨迹骨架 · 白盒 + 三轨投影 + 检查器，ADR-0015/0033）**：
左侧经历列表（每会话一条：时间 · 事件数 · 用户输入预览 + **继续**按钮），
点击任意经历加载全链路轨迹——**五列事件表**（类型/摘要/状态/耗时/Tokens）+
**Overview 三轨时间线**（Input/Model/Tools 共用一根横向标尺：每一列在三轨上
是同一步，空白 = 该轨确实空闲）+ 工具栏（等宽/折叠轮次/展开调用/重放/搜索）+
底部统计栏（TURNS·STEPS·TOOL CALLS·耗时·TOKENS）+ **右侧检查器抽屉**
（Summary/Payload/Result/Schema/Timing 五页签）。**CONTEXT 行展开
SA-Core 选择白盒**：`SA-Core 选择 {L1×9 L3×11}` + top 节点短 id · heat ·
相态——看到 Helix 从记忆捞了什么、信了几分（provenance only，绝不写节点正文）。
**重放轨迹** = 按事件步进高亮（spin 按钮 + 行脉冲），搜索按事件类型/摘要/工具
过滤（命中行高亮）。真实数据无 tokens 字段时显示 `—`（物理事实优先，不猜数）。
**继续** = 显式续聊：带 `job_id` 发起新一轮，上一轮摘要作为 true history
注入，新轮 `context/inject` 记 `resume_from`。会话 = 经历（ADR-0026），
判据与行动同线——这是 Helix 相对 DSH 轨迹多出的一层（DSH 没有 verdict）。
对话视图同一经历列表（一份数据两个入口）。

### 6.8 界面选择（2026-09-07）

`up` 起界面时问一次：`[1] Web 面板（回车） [2] TUI 终端`。
Web = 浏览器面板（默认）；TUI = 终端交互界面（`cellrix-cli run --mode
stdio`，自带一个 Anaphase 子进程，与 Web 的 daemon 不冲突）。

### 6.7 重复运行（2026-09-07）

`up` 幂等：面板已在运行时再跑 `up`，会探测到并提示
「面板已在运行（无需重复启动）」+ 打开浏览器，不会报端口占用错误。

### 6.6 对话（2026-09-07）

打开面板后点「对话 Chat」——输入消息回车即发送。Anaphase `/v1/chat`
每次请求装配一个全新 Helix 跑单周期（同潜意识、同黑盒），回复走 Tuck
网关审计（Engram 可查）。当前每轮无跨轮记忆（对话连续性属未来 Memory
/L3 情景），Helix 会诚实告诉你"没有之前的记录"。

### 6.5 从零开始（推荐 · 一个入口，之后只有回车）

The one-command path — no flags, no commands to remember:

```bash
# 1. Build once
cargo build --release --workspace

# 2. First run: guided — press Enter, and when asked, paste the Anaphase
#    start command once (e.g. `ANAPHASE_CONFIG=/path/to/config.toml /path/to/anaphase`).
#    It is saved to ~/.cellrix/up.toml (0600) and never asked again.
cargo run -p cellrix-web --bin up

# 3. Every later run: Enter, Enter — browser opens.
cargo run -p cellrix-web --bin up
```

What `up` does, step by step:

1. Probes Anaphase (`/v1/health`) and Tuck (audit chain).
2. Healthy → `✅ 运行中`; down + saved command → `[1] 启动 [2] 跳过` (Enter = 1).
3. Nothing saved yet → asks once for the start command, persists it.
4. Launches the cockpit panel and opens the browser. Ctrl+C stops it.
5. **Fail-closed**: if Tuck is configured but unreachable, Anaphase refuses
   to reason and tells you (`⚠️ Tuck 不在岗，已停止工作`) — restore Tuck
   and re-run. The panel always shows the honest state.
6. **One-to-one binding** (first run asks): `up` offers `[1] 绑定  [2] 稍后`
   — Anaphase mints a 6-digit pairing code (one-time, 10 min), you press
   Enter to confirm (physical presence = HITL), and the device is bound.
   Every panel request is then signed (`Bearer v1.<id>.<ts>.<nonce>.<hmac>`):
   replay dies on ±60s window + one-time nonce; the secret lives only in
   0600 files (`~/.cellrix/anaphase-identity.json` on the Anaphase side,
   `~/.cellrix/identity.toml` on the client side — never in git). Unbound =
   open, honestly reported by `/v1/bind/status`.

Minimum prerequisites for Anaphase to actually reason:

- `config.toml`: `reasoning_endpoint` (an OpenAI-compatible LLM — e.g. the
  Tuck gateway `http://127.0.0.1:60052/v1`) and `reasoning_api_key`.
- Tuck gateway running (LLM traffic + audit chain, `tuck_endpoint` set).
- Everything else (`/v1/health`) reports `not configured` honestly until
  you point it at real organs — no fake green.

## 7. Testing & Verification

Following Google’s strict hermetic testing conventions, all integration tests are isolated inside crate-level `tests/` directories.

### 7.1 Test Coverage (327 tests total, 2026-09-07, `--all-features`)

| Crate | Tests | Coverage |
|---|---|---|
| `cellrix-protocol` | 137 | PFP/SAP parser, snapshot, action protocol, helix_mind data structures, tuck_audit, **engram (real audit-chain shapes)** |
| `cellrix-ui` | 90 | State tree, chat input lifecycle, text panel, audit widgets, PFP widgets, security notifications, helix_mind widgets |
| `cellrix-transport` | 95 | UDS multiplexing, stdio frames, action round trips, helix_mind client (trait + mock), **tuck_audit_client (e2e + live gateway)** |
| Other | 3 | Integration tests |

### 7.3 Engram (印痕) — the audit imprint panel

Engram is the full-chain audit imprint view: what Helix *actually* did,
governed by Tuck's gateway, hash-linked so any tampering breaks the chain.

```bash
# Run with the cockpit + Engram (Tuck gateway on :60052 by default):
cellrix-cli run --mode stdio --exec ./target/debug/mock-agent \
  --anaphase-endpoint http://127.0.0.1:50061 \
  --tuck-endpoint http://127.0.0.1:60052 --tuck-key tk-local-gate
```

- `Ctrl+E` — toggle cockpit / Engram view
- `↑` / `↓` — move the timeline selection (virtual list, only visible rows render)
- `f` — type a trace_id filter, `Enter` applies, `Esc` cancels (filtered locally — the gateway is never spammed)
- `g` — jump to the newest entry
- `Esc` — back to the cockpit
- Detail column shows kind / trace / caller / destination / status / verdicts /
  chain `prev_hash` / `hash` — the tamper-evidence link is inspectable, not assumed

**Web projection (isomorphic)** — the browser renders the *same data model*
the TUI shows (one truth, two projections; silicon and carbon read the same
picture). `cellrix-web` proxies `/api/snapshot` (Anaphase) and `/api/audit`
(Tuck chain, Bearer injected here — the identity credential never reaches
the browser):

```bash
cellrix-web --tuck-endpoint http://127.0.0.1:60052 --tuck-key tk-local-gate
# -> http://127.0.0.1:8080  (WEB_PORT / --port override)
```

- Top bar buttons switch Cockpit ↔ Engram (mirrors the TUI `Ctrl+E`)
- Engram panel: overview strip / timeline `2fr` + detail `1fr` proportional
  grid; click a row for the full imprint (caller / destination / status /
  verdicts / prev_hash / hash + raw payload)
- **Full-text replay** (2026-09-07): clicking an audit row also fetches that
  round's bodies via `/api/trace` → Anaphase `/v1/trace` — prompt + response
  of the exact round, redacted at write time, rendered under the imprint
- trace_id filter box (Enter applies, Esc clears)
- Auto-poll both projections every 2s; audit limit default 200 (CLI contract)
- **Up-style self check**: on startup the panel probes Anaphase's own
  `/v1/health` (the ecosystem's one watch-table source — Cellrix renders it,
  Helix-Mind reads it on demand) and the Tuck audit chain, printing
  ✅/❌ + what is unhealthy before you open a tab
- **`--open`**: after binding, opens the panel in your default browser —
  one command, then no more commands

### `up` — one command to the cockpit (guided for beginners)

Run it and press Enter — that's it. The first run asks once for the start
commands, saves them, and every later run is fully automatic:

```text
cargo run -p cellrix-web --bin up
```

What happens:

1. `up` probes Anaphase (`/v1/health`) and Tuck (audit chain).
2. Healthy → `✅ 运行中`, nothing to do.
3. Down + saved command → one choice: `[1] 启动  [2] 跳过` (Enter = 1).
4. Down + nothing saved yet → asked once for the start command
   (e.g. `ANAPHASE_CONFIG=/path/to/config.toml /path/to/anaphase`);
   it is saved to `~/.cellrix/up.toml` (0600, never in git) and used
   from then on. Enter alone skips — the panel honestly shows ❌.
5. The panel launches and the browser opens. Ctrl+C stops it.

Advanced knobs (optional — a beginner never needs them):
`--anaphase-endpoint / --tuck-endpoint / --tuck-key / --anaphase-cmd /
--tuck-cmd / --wait / --port / --no-open`. Env equivalents:
`ANAPHASE_ENDPOINT, TUCK_ENDPOINT, TUCK_KEY, UP_ANAPHASE_CMD, UP_TUCK_CMD,
WEB_PORT`. Source chain: flags > env > `~/.cellrix/up.toml` > protocol
defaults — `up` never guesses, 0 hardcoding.

Live gateway verification (needs Tuck running on :60052):
```bash
cargo test -p cellrix-transport --all-features -- --ignored live
```

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
