# Cellrix 技术白皮书 v2.1

**意图驱动的空间结构化协议与高性能运行时**

*Intent-Driven Spatial & Semantic Protocol and High-Performance Runtime*

**状态:** 终审定稿
**作者:** Jasonmilk & Cellrix 研究社群
**日期:** 2026-05-07

> *Cellrix 不仅仅是一个终端工具，它是为后 AGI 时代准备的、跨越碳基与硅基理解鸿沟的操作系统级 UI 协议。*

---

## 1. 摘要 (Abstract)

Cellrix 认为，**UI 的本质是数据意图的空间投射**。我们放弃像素级的被动控制，追求逻辑级的绝对掌控。

Cellrix 是一个为开发者、DevOps 工程师和 AI 智能体设计的通用终端工作台与 UI 协议。它通过一份名为 **Cell-Manifest** 的声明式、强类型文件描述"界面意图"，由 **Cellrix Runtime** 通过确定性的数学算法，将其转化为响应迅速、自适应布局的可视化界面。

Cellrix 严格遵循 **MVI (Model-View-Intent)** 架构，将界面定义为"结构与规则（Manifest）"与"高频数据流（Source）"的严格解耦。其纯函数求解器同时产出两棵抽象树：一棵**渲染树 (Render Tree)** 携带物理坐标，服务于人类的视觉；一棵**语义树 (Semantic Tree)** 保留完整的空间拓扑，严格对齐 **W3C ARIA 1.3 规范**，以无噪声、结构化、机器可读的形态，同时服务于 AI 智能体与视障工程师的屏幕阅读器。

Cellrix 是与渲染后端无关的声明式 UI 协议。协议本身不规定具体的终端渲染技术或图形库。任何能够消费 Manifest 并输出可视化界面的事件驱动系统，均可视为合规的 Cellrix 适配器。官方参考实现提供轻量级终端适配器及面向复杂交互的生产级适配器，开发者可按场景选择或按 CIS 规范自行实现。

Cellrix 采用 Daemon-Client 分离架构。Daemon 常驻后台，维护数据管道与语义树，供 AI 无头消费；Client 仅负责终端渲染，可随时 attach/detach。

**Cellrix 的设计哲学源自 Helix 生态的工程铁律：编排优先、契约至上、纯净 I/O、绝对幂等、极简复用。我们视代码为负债，视组合为资产。协议只定义"接口与不变性"，实现细节交由各路英雄去内卷。**

---

## 2. 动机与设计哲学 (Motivation & Philosophy)

### 2.1 痛点
- **Web UI 的 "重"**: 为高速迭代的后端系统构建图形界面能效比极低。
- **传统 TUI 的 "无序"**: 缺少类似 Markdown 的声明式标准。
- **AI 智能体的"视觉黑盒"**: 复杂 AI 逻辑是一个黑盒，开发者需要能即时观测其思维轨迹的"神经中枢"。

### 2.2 核心设计原则（Cellrix Zen）

我们以 Helix 工程的 11 条公理为源头，提炼出 Cellrix 的六项根本原则：

1.  **编排优先，拒造实体 (Orchestrate, Don't Build)**
    Cellrix Runtime 只是一个"调度引擎"和"布局总线"。它不亲自渲染终端——渲染委托给外部适配器；不亲自实现 SSH——通过 Driver 协议委托给外部 WASM 或进程；不自己解析 Markdown——集成现有解析器。一切实质性工作下放，核心只负责确定性调度。

2.  **契约至上，模型校验 (Strict Contracts, Model Validation)**
    组件之间不通过模糊的内存对象通信，只通过 **JSON Schema 严格定义的契约**。Manifest 是神圣的接口协议。`pydantic` 或等价的强类型校验是所有实现的硬性要求。字段缺失？拒收。类型非法？拒收。绝不猜测。

3.  **纯净 I/O，异常熔断 (Pure Streams & Hard Fails)**
    遵循 Unix 铁律：`stdout` 只输出可渲染的结构化数据（ViewTree JSON / ANSI），`stderr` 只输出诊断日志。任何错误必须显式传播，返回非零退出码或明确的错误事件。**严禁静默吞没异常**。

4.  **绝对幂等，状态恒定 (Absolute Idempotency)**
    布局求解器是纯函数：同一份 Manifest 与终端尺寸，永远产生完全相同的 ViewTree。数据管道的重放、Client 的 attach/detach，都不改变系统的确定性语义。

5.  **极简复用，外包生态 (Radical Simplicity & Ecosystem Reuse)**
    每一行新增代码都必须有不可替代的理由。能用 `pydantic` 做校验、协议适配器做渲染、`click` 做 CLI、`protobuf` 做序列化的，绝不自己造轮子。

6.  **安全第一与人机协同 (Security-First & Human-in-the-Loop)**
    协议层原生支持操作安全分级与人类审批屏障。AI Agent 发起的敏感操作必须经过 Runtime 的确认屏障，人类确认后方可执行。所有外部输入必须经过 ANSI 净化。Driver 通过能力声明 (`capabilities`) 进行最小权限沙盒管控。隐私是最高红线，数据不在未授权时外泄。

### 2.3 协议与实现的绝对边界

**这是 Cellrix 宪法的第一修正案：**

-   **白皮书（本文档）** 只定义 **协议契约**：Manifest Schema、双树输出规范、HITL 状态机通信、ANSI 净化命令、版本语义。
-   **参考实现 (`cellrix-core`)** 是协议的**一个合规实例**，它选择 Python（而非 Rust、Go 或其他语言），选择 Ring Buffer（而非其他缓冲策略），选择 Protobuf（而非其他序列化格式）——这些都是工程决策，不是协议约束。
-   **任何实现只要通过 Conformance Suite 的全部测试，即为合法 Runtime**，无论它使用何种语言、何种缓存算法、何种持久化后端、何种渲染技术。

**协议是神圣的接口，实现是多元的竞争。**

---

## 3. 核心架构：Cellrix 进程模型

Cellrix 采用 Daemon-Client 分离架构，从物理上解耦界面生命周期与人类注意力周期。

| 进程 | 职责 | 生命周期 |
| :--- | :--- | :--- |
| **Cellrix Daemon** | 维护 Manifest、管理 Source 管道、执行布局求解、更新语义树，通过 Unix Socket/TCP 暴露语义树查询 API。 | **常驻后台**，独立于客户端连接。 |
| **Cellrix Client** | 连接 Daemon，获取渲染树并输出为可视化界面；将人类输入转化为 Intent 事件发回 Daemon。 | **即时 attach/detach**。 |

**Client Attach 协议行为**：
-   `static` 与 `realtime` Cell：Daemon 下发当前快照（Snapshot）。
-   `dynamic` Cell：Daemon 下发最近可用的历史记录。**具体的缓冲策略由实现决定，协议不规定。**

---

## 4. Cell-Manifest v2.1 协议规范

### 4.0 全局能力声明与 AI 安全白名单 (`capabilities`)

Manifest 顶层声明全局沙盒权限，同时是 AI 生成 Manifest 的**白名单**。**若声明的 `driver` 或 `actions.emit` 目标不在此清单内，Runtime 必须拒绝该 Manifest 并回传拒绝原因事件。**

**权限匹配规则（协议契约）**：
-   域名仅限 `*.domain.tld` 前缀通配。
-   IP 遵循严格 CIDR 掩码匹配。
-   **禁止使用正则表达式**，以杜绝 ReDoS 攻击及跨语言实现不一致。

```json
{
  "$schema": "https://cellrix.dev/protocol/v2.1/schema.json",
  "version": "2.1",
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

### 4.1 顶层结构与分形布局 (`Layout`)

`layout` 定义空间槽位 (Slots)，支持递归嵌套形成**分形网格**。同级兄弟间通过 `weight` 分配空间。

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

### 4.2 原子单元：细胞类型、语义控件、双态数据绑定、安全交互路由

每个 `Cell` 拥有三种**不可扩展**的生命周期类型。

| 类型 | 生命周期策略 |
| :--- | :--- |
| **`static`** | 永不更新。 |
| **`dynamic`** | 通过 `source` 拉取/推送，追加式渲染。 |
| **`realtime`** | Runtime 主动订阅，局部刷新。 |

**语义控件 (`semantic_widget`)**

Cell 可通过可选的 `semantic_widget` 字段声明控件的语义类型。协议规定极少数通用语义值，不做框架级绑定。

| 值 | 语义 | 说明 |
|:---|:---|:---|
| `"text"` | 文本块 | 默认值，纯文本渲染 |
| `"table"` | 表格 | 需附带 `columns` 和 `rows` 字段 |
| `"list"` | 列表 | 需附带 `items` 字段，支持焦点选择 |
| `"progress"` | 进度条 | 需附带 `value` 字段（0-100） |

Cell 的 `semantic_widget` 字段始终可选。若未指定，适配器默认为 `"text"`。协议永远不引用任何框架的类名或组件名，适配器负责将语义控件映射到具体实现。

**双态高性能数据通道**

`source` 支持 JSON 与 Protobuf 双协议。Driver 解析后将可视内容推入渲染树，摘要推入语义树。

**`actions` 安全事件路由 (HITL 安全模型)**

`securityClass` 定义操作等级（`"safe"`, `"restricted"`, `"critical"`）。`requiresApproval` 触发 HITL 屏障，含 `timeout`、`timeoutAction`、`fallbackEmit` 字段。

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
        "prompt": "确认重启生产节点 tx_1？",
        "timeout": 30000,
        "timeoutAction": "reject",
        "fallbackEmit": "REJECTED_BY_HITL"
      },
      "payload": { "node_id": "tx_1" }
    }
  }
}
```

**HITL 状态机**：安全/普通→直接执行；受限/关键→挂起，渲染确认屏障。人类确认→执行；拒绝或超时→执行 timeoutAction，回传 fallbackEmit 给 AI Agent。

### 4.3 扩展机制与供应链安全 (`Driver` 字段)

不修改 `type`，通过 `driver` 附加实现。**任何 Driver 扩展不得重新定义核心字段语义。**

生产环境 Driver 引用必须采用内容可寻址标识符。Runtime 加载 WASM 前强制校验哈希。

```json
{
  "driver": "pkg:wasm/registry.cellrix.dev/ssh@1.2.0?sha256=...",
  "driverConfig": { "host": "...", "auth": { "keyPath": "..." } }
}
```

### 4.4 解析器行为规范 (Conformance Mandate)

| 场景 | 协议契约 |
| :--- | :--- |
| **必填字段缺失 / `type` 非法 / `slot` 不存在** | 拒绝解析并返回错误。 |
| **未知字段** | 生产环境忽略并警告；开发环境拒绝解析。 |
| **约束冲突** | 按 `priority` 降级。 |
| **权限越界 / AI 生成越界** | Runtime 拒绝并回传拒绝原因事件。 |
| **ANSI 注入** | Runtime 必须剥离或转义所有外部输入中的 ANSI 逃逸序列。格式需求必须通过声明式 `style` 属性实现，禁止字符串夹带原生控制码。 |
| **版本缺失** | 按 v1.0 解析并发出弃用警告。 |

---

## 5. 布局求解引擎与语义树标准

### 5.1 纯函数求解器

布局求解器必须是单向纯函数，具备 O(N) 时间复杂度。求解算法必须免回溯——父级约束确定后，子节点失败绝不触发父级重算。

```text
输入: (Manifest, Terminal_Width, Terminal_Height) → 输出: (RenderTree, SemanticTree)
```

**标准渲染基准**：xterm-256color + Unicode 11 East Asian Width。

### 5.2 双树模型与语义树按需查询

| 树类型 | 内容 | 服务对象 |
| :--- | :--- | :--- |
| **渲染树 (Render Tree)** | 物理坐标及样式，Client 消费。 | 人类的眼睛。 |
| **语义树 (Semantic Tree)** | 嵌套拓扑，高层语义，Daemon 暴露 API。 | AI 智能体 和 视障工程师。 |

语义树 API 支持过滤参数 `?slot_id=&limit=&role=`，由 Runtime 在协议层完成数据裁剪。

### 5.3 语义树与 W3C ARIA 映射规范

| Cellrix `role` | W3C ARIA 等价属性 | 无障碍行为 |
| :--- | :--- | :--- |
| `"navigation"` | `role="navigation"` | 识别为导航区 |
| `"metric"` | `role="status"` + `aria-live="polite"` | 数值更新时 TTS 播报 |
| `"log_viewer"` | `role="log"` + `aria-live="off"` | 日志流静默 |
| `"button"` | `role="button"` | 触发键盘事件 |
| `"input"` | `role="textbox"` | 启用文本编辑 |

---

## 6. 应用蓝图

Claude Code 式界面：`dynamic` Cell 承载对话流 + `actions.onKey` 实现审批交互。  
htop 式仪表盘：`realtime` Cell 承载 CPU/内存仪表 + `dynamic` 进程列表 + HITL 安全 Kill。

---

## 7. 工程落地关键挑战与铁律应对

| 挑战 | 哲学对应 | 解决方案 |
| :--- | :--- | :--- |
| 1. 高频 JSON 序列化瓶颈 | 极简复用 | Protobuf 双态通道，外包给生态 |
| 2. 终端尺寸变化颤动 | 绝对幂等 | 约束冲突降级链，零重排 |
| 3. 键盘/鼠标平衡 | 编排优先 | 所有交互翻译为同构 Intent |
| 4. Emoji/CJK 对齐 | 契约至上 | xterm-256color + Unicode 11 基准 |
| 5. 屏幕阅读器兼容 | 纯净 I/O | 语义树 ARIA 对齐，线性化输出 |
| 6. Driver 崩溃 | 异常熔断 | WASI 沙盒隔离，独立崩溃域 |
| 7. AI 生成非法 Manifest | 契约至上 | 严格模式 + capabilities 白名单 |
| 8. 跨平台兼容性 | 极简复用 | 依赖生态成熟库 |
| 9. 布局性能退化 | 编排优先 | O(N) 免回溯求解器 |
| 10. 冷启动门槛 | 极简复用 | `cellrix init --template` 一键生成 |
| 11. LLM Token 爆炸 | 编排优先 | 语义树按需查询 API |
| 12. Driver 供应链攻击 | 安全第一 | 内容可寻址 URI + SRI 哈希校验 |
| 13. 终端断开 AI 监控中断 | 编排优先 | Daemon-Client 分离，无头闭环 |
| 14. ANSI 逃逸注入 | 纯净 I/O | 渲染层强制净化，禁止透传 |
| 15. 扩展复杂度失控 | 契约至上 | conformance test 门槛，driver 不污染核心 |

---

## 8. 协议治理与版本演进

### 8.1 版本语义

| 版本变更 | 允许行为 |
| :--- | :--- |
| **主版本号** | 允许 breaking changes。旧版 Manifest 需识别迁移。 |
| **次版本号** | 仅新增可选字段，废弃字段至少支持一个主版本周期。 |
| **未声明版本** | 按 v1.0 解析，发出弃用警告。 |

### 8.2 治理模型

Cellrix 协议演进采用 **RFC 模式**（CEP，Cellrix Enhancement Proposal）：
1. 任何人可提交 CEP。
2. 公开讨论期 ≥ 14 天。
3. 接受后必须附带 Conformance Test 的 PR 方可合入规范。
4. 治理不依赖单一个体，由 Core Team 共识决定。

**任何违反"纯净 I/O"、"契约至上"、"极简复用"或"绝对幂等"核心公理的提案，将被直接拒绝，无需技术评估。**

---

## 9. 路线图

**第一阶段（当前 - 2026 Q3）**
发布 v2.1 Schema 与完整规范，CEP-0001 启动治理，参考实现验证全链路，AG-UI/MCP 桥接器设计，Conformance Suite 发布。

**第二阶段（2026 Q4 - 2027 Q2）**
生产级适配器开发，WASI 沙盒原型，HITL 拦截器，`cellrix preview` CLI。

**第三阶段（2027 Q3 -）**
Spatial-CRDT 协同算法，企业级 HITL 审计，语义树到 Web-Accessibility 桥接器，多后端适配器生态成熟。

---

## 10. 结语

Cellrix 是一个源于真实痛点、严格遵循第一性原理的工程实践。它不追求成为最漂亮的终端画布，而是要成为最**高效、最稳定、最安全、最包容**的交互中枢。

我们遵循 **编排优先、契约至上、纯净 I/O、绝对幂等、极简复用**的哲学，将协议与实现严格分离。协议是神圣的接口，实现是多元的竞争。

**我们拒绝模糊，拥抱确定性。我们拒绝黑盒，拥抱安全。我们拒绝复杂，拥抱极简。我们拒绝治理真空，拥抱开放演进。**

---

## 修订记录

| 版本 | 日期 | 主要变更 |
| :--- | :--- | :--- |
| v1.2.0 | 2026-05-06 | ANSI净化、O(N)求解器约束、治理模型、AI白名单 |
| v2.0 | 2026-05-06 | 注入 Helix Zen 设计哲学，明确协议与实现边界，重写原则为六条公理，增加哲学审查的治理条款 |
| **v2.1** | **2026-05-07** | **新增多后端渲染架构声明，新增语义控件枚举（semantic_widget），明确协议与渲染后端的无关性** |

---

**本白皮书是 Cellrix 项目的最高宪法。所有代码、文档、决策，均需在此框架内完成。**
