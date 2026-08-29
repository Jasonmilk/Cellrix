# Cellrix 架构分卷

> **版本**：v1.0
> **日期**：2026-08-30
> **所属方法论**：phyt-DNA v1.0

---

## 一、Workspace 架构

Cellrix 采用 workspace 架构，分为 5 个解耦的 crate：

```
cellrix/ (Workspace Root)
├── cellrix-protocol/ (`protocol`)   # CIN7/CIC13 对齐。零依赖，100% WASM 兼容。
├── cellrix-layout/   (`layout`)     # 纯数学布局引擎 & DFS 焦点管理器。WASM 绑定。
├── cellrix-ui/       (`ui`)         # 模块化 UI。AppState 与 Crossterm IO 解耦。
├── cellrix-transport/(`transport`)  # 多路复用 UDS/Stdio 显示服务器，CIB19 看门狗。
└── cellrix-cli/      (`cli`)        # 命令行工具启动器 (cx)。
```

### 1.1 cellrix-protocol
- 零依赖，100% WASM 兼容
- CIN7（INTENT-7）语义模式
- CIC13（CAPABILITY-13）能力授权
- AgentEvent 事件定义
- 语义节点（Snapshot/Node/Coords）
- 视图哈希（view_hash）
- Manifest 清单

### 1.2 cellrix-layout
- 纯数学布局引擎
- DFS 焦点管理器
- 槽位分配器（slot_allocator）
- 鼠标选择器（mouse_selector）
- 禅模式（zen_mode）
- WASM 绑定

### 1.3 cellrix-ui
- 模块化 UI
- AppState 与 Crossterm IO 解耦
- TUI 渲染器
- 主题系统
- 组件库（widgets）
- 能量管理（energy）

### 1.4 cellrix-transport
- 多路复用 UDS/Stdio 显示服务器
- CIB19 看门狗（19 秒心跳，40 秒超时）
- TCP 传输
- 能力传输（cap_transport）
- 后台客户端零堆分配标签窥探

### 1.5 cellrix-cli
- 命令行工具启动器（cx）
- 配置加载
- 服务启动

---

## 二、分层模型

| 层 | 定位 | 核心价值 | 关键机制 |
|---|---|---|---|
| **L1 协议层** | CIN7/CIC13/CIB19 语义协议 | 碳硅共享的语义标准 | 256 节点硬限制、1MB 内容限制、19 秒心跳 |
| **L2 布局层** | 纯数学布局引擎 | 确定性空间分配 | DFS 焦点管理、槽位分配器、禅模式 |
| **L3 渲染层** | 模块化 UI 渲染 | 人类视觉呈现 | Crossterm TUI、主题系统、组件库 |
| **L4 传输层** | 多路复用显示服务器 | 多客户端并发 | UDS/Stdio/TCP、CIB19 看门狗、40 秒超时 |

---

## 三、Wayland 风格多客户端复用

与传统的绑定到单进程的 TUI 不同，`cellrix-transport` 实现了 **UDS 多路复用守护进程**。

### 3.1 架构
- Cellrix 充当 Wayland 风格的显示服务器（接受连接）
- 智能体作为客户端被动连接
- 支持多个客户端并发连接

### 3.2 活动客户端（聚焦中）
- Cellrix 对传入的 `AgentEvent::Snapshot` 执行完整的高速反序列化
- 完整渲染到终端
- 响应交互事件

### 3.3 非活动客户端（后台）
- Cellrix 使用 `serde::de::IgnoredAny` 执行**轻量级标签窥探**
- 完全跳过庞大的快照体——导致**绝对零堆分配**
- 安全地从套接字缓冲区中排出原始字节，防止后台客户端线程阻塞

---

## 四、数据流

```
智能体客户端
    ↓ AgentEvent (UDS/Stdio/TCP)
cellrix-transport (多路复用显示服务器)
    ↓ CIB19 看门狗 (19s 心跳, 40s 超时)
    ↓ 活动客户端: 完整反序列化
    ↓ 后台客户端: 零堆分配标签窥探
cellrix-protocol (CIN7/CIC13 语义解析)
    ↓ 语义节点拓扑图
cellrix-layout (纯数学布局引擎)
    ↓ 确定性空间分配
cellrix-ui (模块化 UI 渲染)
    ↓ Crossterm TUI
人类视觉终端
```

---

*《Cellrix 架构分卷》v1.0 完。*
