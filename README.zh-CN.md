# Cellrix (`cx`)

> **一个意图驱动、确定性、空间语义的终端 UI 协议与高性能运行时。**
> 遵循 **CommonIntents-144 (`CI-144`)** 协议家族。

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Protocol](https://img.shields.io/badge/Protocol-CI--144-blue.svg)]()
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange.svg)]()
[![License](https://img.shields.io/badge/License-MIT-blue.svg)]()

---

## 1. 核心理念：为什么需要 Cellrix？

传统的终端 UI（TUI）和图形界面是为 **碳基生物（人类）的视觉感知** 而设计的。它们以绝对坐标渲染像素或原始字符。当 **硅基智能体（AI）** 与它们交互时，要么需要解析杂乱的、非标准的文本日志，要么需要执行昂贵的视觉 OCR。

**Cellrix 架起了碳基与硅基认知之间的桥梁。**

通过将终端屏幕视为一个 **确定性、语义化的网格**，而非原始画布，Cellrix 实现了双重视角的“空间-语义”范式：
- **对人眼**：它呈现一个遵循 **躯体极简主义** 美学的、美观且响应式的视觉布局。
- **对智能体**：它暴露了一个确定性的语义节点拓扑图（`CIN7`），允许智能体无需视觉摩擦力或屏幕抓取即可导航、检查与交互。

```
       [ 硅基智能体 ]                   [ 碳基人类 ]
               │                                  │
      (CIN7 / CIB19 流)                   (Crossterm TUI 渲染)
               ▼                                  ▼
┌───────────────────────────────┐  ┌───────────────────────────────┐
│     语义拓扑结构              │  │     体感视觉网格              │
│  { "id": "text_1",            │  │  ┌─────────────────────────┐  │
│    "node_type": "text_panel", │  │  │ ● 活跃传感器           │  │
│    "slot": "main" }           │  │  │ # 来自 mock-agent 的问候│  │
└───────────────────────────────┘  └───────────────────────────────┘
```

---

## 2. CI-144 协议家族合规

Cellrix 是 **CommonIntents-144 (CI-144)** 协议家族的官方参考实现：

*   **`CIN7` (INTENT-7)**：定义意图模式，将快照结构化为 7 个核心语义字段。强制规定每个节点 **最多 256 个节点** 和 **1MB 内容** 的硬安全上限，以防止资源受限设备上的 DDoS 和内存耗尽（OOM）。
*   **`CIC13` (CAPABILITY-13)**：管理能力授权与确认。显示服务器拦截焦点切换，并向下游路由 `sys_suspend` 和 `sys_resume` 命令，使智能体能够执行本地自我节流。
*   **`CIB19` (BIND-19)**：建立传输绑定，强制要求 **19 秒** 的质数心跳间隔（以防止多智能体网络共振）和 **40 秒** 的客户端超时阈值。

---

## 3. 工作空间架构

工作空间被拆分为解耦、隔离的 crate，以确保最大可移植性和 WebAssembly（WASM）交叉编译：

```text
cellrix/ (工作空间根目录)
├── cellrix-protocol/ (`protocol`)   # 对齐 CIN7/CIC13。零依赖，100% WASM 可编译。
├── cellrix-layout/   (`layout`)     # 纯数学布局引擎 & DFS 焦点管理器。暴露 WASM 绑定。
├── cellrix-ui/       (`ui`)         # 模块化 UI。AppState 与 Crossterm IO 解耦，支持 WASM。
├── cellrix-transport/(`transport`)  # 多路复用 UDS/Stdio 显示服务器，实现 CIB19 看门狗。
└── cellrix-cli/      (`cli`)        # 命令行工具启动器 (cx)。
```

### 3.1 对称的 Wayland 风格多客户端多路复用

与绑定到单个进程的传统 TUI 不同，`cellrix-transport` 实现了 **UDS 多路复用守护进程**。Cellrix 充当 Wayland 风格的显示服务器（接受连接），而你的智能体作为客户端被动连接。
- **活跃客户端（前台焦点）**：Cellrix 对传入的 `AgentEvent::Snapshot` 执行完整的高速反序列化。
- **非活跃客户端（后台）**：Cellrix 使用 `serde::de::IgnoredAny` 执行 **轻量级标签嗅探**，完全跳过庞大的快照负载——实现 **绝对零堆内存分配**——并安全地从 Socket 缓冲区中排空原始字节，以防止后台客户端的线程阻塞。

---

## 4. 躯体极简主义美学

Cellrix 建立在一种安静、高对比度、低能量的调色板上，其中颜色代表 **系统状态**，而非装饰：
*   **火山黑背景**：`#18181A`（RGB: 24, 24, 26）
*   **纸白文本**：`#E4E4E7`（RGB: 228, 228, 231）
*   **修道院靛蓝高亮**：`#5B5FC7`（RGB: 91, 95, 199）——在活跃推理、焦点状态或活跃标签指示时激活。
*   **琥珀色警报**：`#D08770`（RGB: 208, 135, 112）——在高风险操作或活跃禅模式时触发。
*   **石板灰辅助色**：`#71717A`（RGB: 113, 113, 122）

---

## 5. 交互宣言与键位绑定

所有键位绑定和鼠标交互都遵循专业开发者习惯（Vim、Tmux、Claude Code、Nano）：

| 快捷键 / 操作 | 行为 | 设计理念 |
|:---|:---|:---|
| **`Tab`** | 焦点移至下一个可交互面板或按钮 | 标准 TUI DFS 遍历 |
| **`Shift+Tab`** | 焦点移至上一个可交互面板或按钮 | 反向 TUI DFS 遍历 |
| **`Alt + Left/Right`** | 循环切换槽内的活跃节点（标签页视图） | **Claude Code** 智能体视图标签切换 |
| **`Alt + n`** | 焦点移至下一个活跃智能体（切换活跃流） | 动态多智能体活跃路由 |
| **`Alt + p`** | 焦点移至上一个活跃智能体（切换活跃流） | 动态多智能体活跃路由 |
| **`Ctrl+O`** | 切换 **禅模式**（100% 视口扩展） | **Nano**（`^O` 写入）与 **Claude Code** 视图切换 |
| **`Ctrl+L`** | 重绘终端缓冲区 | Readline / 终端重绘标准 |
| **`Ctrl+C`** | 优雅退出（干净恢复备用屏幕） | Nano（`^X`）与标准 Unix 中断 |
| **`左键点击`** | 立即聚焦被点击的面板 | 直观的空间命中测试 |
| **`左键拖拽`** | 触发自定义高精度复制 | **Pillar B**：列隔离复制，绕过边框 |
| **`Shift + 拖拽`** | 绕过原生 OS 终端复制 | Unix 原生绕过标准 |

---

## 6. 快速开始

### 6.1 前置条件

确保已安装 Rust 工具链和目标：

```bash
rustup default stable
rustup target add wasm32-unknown-unknown
```

### 6.2 构建本地 TUI

为防止多智能体在未优化的 Debug 循环中争抢 CPU，强烈建议以 **Release 模式** 构建和运行：

```bash
cargo build --release --workspace
```

### 6.3 构建布局求解器（WebAssembly）

为浏览器 WebGL/R3F 高保真全息投影环境编译纯数学的 `cellrix-layout` 引擎：

```bash
cargo build --target wasm32-unknown-unknown -p cellrix-layout
```
*（或者使用 `wasm-pack build layout --target web` 生成标准的 JS/TS 胶水绑定。）*

### 6.4 运行交互式 TUI

启动显示服务器并连接内置的 mock-agent：

```bash
# 1. 启动 TUI 显示服务器（等待连接）
cargo run --release -p cellrix-cli -- run --mode uds --socket /tmp/cellrix.sock

# 2. 在另一个终端中，启动 Mock Agent 连接并发送数据流
cargo run --release -p mock-agent -- --mode uds --socket /tmp/cellrix.sock
```

---

## 7. 测试与验证

遵循 Google 严格的密封测试规范，所有集成测试都隔离在各 crate 的 `tests/` 目录中。

运行 `cellrix-protocol` 解析器的健壮防崩溃测试套件（覆盖损坏 JSON 恢复和 DDoS 负载截断）：

```bash
cargo test -p cellrix-protocol --test parser_test
```

运行 UDS 集成测试，验证 **CIB19 心跳看门狗自愈** 和 **对称多客户端握手**：

```bash
cargo test -p cellrix-transport --test uds_test
```

---

## 8. 许可证

本项目基于 MIT 许可证开源 - 详情请参阅 [LICENSE](LICENSE) 文件。
