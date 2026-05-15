# Cellrix 技术白皮书 v2.4

**意图驱动的空间结构化协议与高性能运行时**

*Intent-Driven Spatial & Semantic Protocol and High-Performance Runtime*

**状态:** 终审定稿
**作者:** Jasonmilk & Cellrix 研究社群
**日期:** 2026-05-16

> *Cellrix 不仅仅是一个终端工具，它是为后 AGI 时代准备的、跨越碳基与硅基理解鸿沟的操作系统级 UI 协议。*

---

## 1. 摘要 (Abstract)

Cellrix 认为，**UI 的本质是数据意图的空间投射**。我们放弃像素级的被动控制，追求逻辑级的绝对掌控。

Cellrix 是一个为开发者、DevOps 工程师和 AI 智能体设计的通用终端工作台与 UI 协议。它通过一份名为 **Cell-Manifest** 的声明式、强类型文件描述“界面意图”，由 **Cellrix Runtime** 通过确定性的数学算法，将其转化为响应迅速、自适应布局的可视化界面。

Cellrix 严格遵循 **MVI (Model-View-Intent)** 架构，将界面定义为“结构与规则（Manifest）”与“高频数据流（Source）”的严格解耦。其纯函数求解器同时产出两棵抽象树：一棵**渲染树 (Render Tree)** 携带物理坐标，服务于人类的视觉；一棵**语义树 (Semantic Tree)** 保留完整的空间拓扑，严格对齐 **W3C ARIA 1.3 规范**，以无噪声、结构化、机器可读的形态，同时服务于 AI 智能体与视障工程师的屏幕阅读器。

Cellrix 是与渲染后端无关的声明式 UI 协议。协议本身不规定具体的终端渲染技术或图形库。任何能够消费 Manifest 并输出可视化界面的事件驱动系统，均可视为合规的 Cellrix 适配器。官方参考实现提供轻量级终端适配器及面向复杂交互的生产级适配器，开发者可按场景选择或按 CIS 规范自行实现。

Cellrix 采用 Daemon-Client 分离架构。Daemon 常驻后台，维护数据管道与语义树，供 AI 无头消费；Client 仅负责终端渲染，可随时 attach/detach。

**Cellrix 的设计哲学源自 Helix 生态的工程铁律：编排优先、契约至上、纯净 I/O、绝对幂等、极简复用、安全第一、按需驱动。我们视代码为负债，视组合为资产。协议只定义“接口与不变性”，实现细节交由各路英雄去内卷。**

---

## 2. 动机与设计哲学 (Motivation & Philosophy)

### 2.1 痛点
- **Web UI 的 “重”**: 为高速迭代的后端系统构建图形界面能效比极低。
- **传统 TUI 的 “无序”**: 缺少类似 Markdown 的声明式标准。
- **AI 智能体的“视觉黑盒”**: 复杂 AI 逻辑是一个黑盒，开发者需要能即时观测其思维轨迹的“神经中枢”。

### 2.2 核心设计原则（Cellrix Zen）

我们以 Helix 工程的 11 条公理为源头，提炼出 Cellrix 的七项根本原则：

1.  **编排优先，拒造实体 (Orchestrate, Don't Build)**
    Cellrix Runtime 只是一个“调度引擎”和“布局总线”。它不亲自渲染终端——渲染委托给外部适配器；不亲自实现 SSH——通过 Driver 协议委托给外部 WASM 或进程；不自己解析 Markdown——集成现有解析器。一切实质性工作下放，核心只负责确定性调度。

2.  **契约至上，模型校验 (Strict Contracts, Model Validation)**
    组件之间不通过模糊的内存对象通信，只通过 **JSON Schema 严格定义的契约**。Manifest 是神圣的接口协议。`pydantic` 或等价的强类型校验是所有实现的硬性要求。字段缺失？拒收。类型非法？拒收。绝不猜测。

3.  **纯净 I/O，异常熔断 (Pure Streams & Hard Fails)**
    遵循 Unix 铁律：`stdout` 只输出可渲染的结构化数据（ViewTree JSON / ANSI），`stderr` 只输出诊断日志。任何错误必须显式传播，返回非零退出码或明确的错误事件。**严禁静默吞没异常**。

4.  **绝对幂等，状态恒定 (Absolute Idempotency)**
    布局求解器是纯函数：同一份 Manifest 与终端尺寸，永远产生完全相同的 ViewTree。数据管道的重放、Client 的 attach/detach，都不改变系统的确定性语义。

5.  **极简复用，外包生态 (Radical Simplicity & Ecosystem Reuse)**
    每一行新增代码都必须有不可替代的理由。能用 `pydantic` 做校验、协议适配器做渲染、`click` 做 CLI、`protobuf` 做序列化的，绝不自己造轮子。  
    **视觉控制反转原则 (CDS)**：协议层仅传达语义意图；所有视觉呈现（颜色、圆角、间距、符号）均由适配器根据本地设计系统 (Cellrix Design System) 决定。Agent 通过语义化关键词（如 `primary`, `danger`）表达意图，适配器负责映射为具体视觉表现。这被称为 Cellrix 宪法的第二修正案。

6.  **安全第一与人机协同 (Security-First & Human-in-the-Loop)**
    协议层原生支持操作安全分级与人类审批屏障。AI Agent 发起的敏感操作必须经过 Runtime 的确认屏障，人类确认后方可执行。所有外部输入必须经过安全清洗。Driver 通过能力声明 (`capabilities`) 进行最小权限沙盒管控。隐私是最高红线，数据不在未授权时外泄。

7.  **按需驱动，零浪费 (On-Demand, Zero Waste)**
    Cellrix 的所有能力均按需激活，默认关闭。数据管道仅在 `--trust` 时启动；交互通道（如 Agent API、WebSocket）仅在显式请求时建立；WebUI 适配器仅在浏览器连接时渲染 DOM，无连接时自动释放所有图形资源，内存回落至纯 TUI 基线。不做任何预加载、不做任何假设性初始化。这是 Cellrix 宪法的第三修正案。

### 2.3 协议与实现的绝对边界

**这是 Cellrix 宪法的第一修正案：**

-   **白皮书（本文档）** 只定义 **协议契约**：Manifest Schema、双树输出规范、HITL 状态机通信、安全净化命令、版本语义。
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

## 4. Cell-Manifest v2.4 协议规范

### 4.0 全局能力声明与 AI 安全白名单 (`capabilities`)

Manifest 顶层声明全局沙盒权限，同时是 AI 生成 Manifest 的**白名单**。**若声明的 `driver` 或 `actions.emit` 目标不在此清单内，Runtime 必须拒绝该 Manifest 并回传拒绝原因事件。**

**权限匹配规则（协议契约）**：
-   域名仅限 `*.domain.tld` 前缀通配。
-   IP 遵循严格 CIDR 掩码匹配。
-   **禁止使用正则表达式**，以杜绝 ReDoS 攻击及跨语言实现不一致。

```json
{
  "$schema": "https://cellrix.dev/protocol/v2.4/schema.json",
  "version": "2.4",
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

### 4.2 原子单元：细胞类型、内容类型、语义控件、结构化数据与安全交互路由

每个 `Cell` 拥有三种**不可扩展**的生命周期类型。

| 类型 | 生命周期策略 |
| :--- | :--- |
| **`static`** | 永不更新。 |
| **`dynamic`** | 通过 `source` 拉取/推送，追加式渲染。 |
| **`realtime`** | Runtime 主动订阅，局部刷新。 |

**内容类型 (`content_type`)**

Cell 可通过可选的 `content_type` 字段声明其 `content` 字段的格式。适配器负责据此选择渲染方式。

| 值 | 语义 | 说明 |
|:---|:---|:---|
| `"text"` | 纯文本 | 默认值 |
| `"markdown"` | Markdown 格式 | 适配器应使用原生 Markdown 渲染（表格、代码块、列表等） |
| `"code"` | 源代码块 | 适配器应提供语法高亮。可附带 `language` 字段（如 `"python"`, `"rust"`）指导高亮器 |

**语义控件 (`semantic_widget`)**

Cell 可通过可选的 `semantic_widget` 字段声明控件的交互语义。协议定义一组通用语义值——**任何时候都不允许出现框架特定的类名**。

| 值 | 语义 | 说明 |
|:---|:---|:---|
| `"text"` | 文本块 | 默认值，纯文本渲染 |
| `"table"` | 表格 | 需配合 `semantic_data` 提供二维数组 |
| `"list"` | 列表 | 需配合 `semantic_data` 提供字符串数组 |
| `"progress"` | 进度条 | 需配合 `semantic_data` 提供 0-100 数值 |
| `"input"` | 单行或多行文本输入 | 支持 `placeholder`、`multiline`、`autocomplete` 属性。必须伴随 `actions.onSubmit`，提交时携带 `payload.value` |
| `"modal"` | 覆盖层对话框（确认或提示） | **脱离布局网格独立渲染**，适配器必须将其渲染为居中浮层。必须定义 `actions.onConfirm` 和/或 `actions.onCancel` |
| `"tree"` | 层级可展开树 | 使用 `data` 字段，格式为递归 `{label, children}` 结构。支持 `actions.onNodeSelect` |

`semantic_widget` 字段始终可选。若未指定，适配器默认为 `"text"`。协议永远不引用任何框架的类名或组件名，适配器负责将语义值映射到具体组件。

**Modal 特殊布局规则**

带有 `semantic_widget: "modal"` 的 Cell 不受 `layout` 权重分配约束。求解器将其视为普通 Cell 输出，但适配器识别后必须忽略坐标，改为渲染为覆盖主界面的居中浮层。

#### 结构化数据字段 (`semantic_data`)

为承载非纯文本的复杂数据，Cell 新增可选字段 `semantic_data`。其类型由 `semantic_widget` 严格约束：

| `semantic_widget` | `semantic_data` 类型 | 降级策略 |
|:---|:---|:---|
| `"text"` (默认) | 不需要 | - |
| `"table"` | `Array<Array<string\|number>>` | 若非二维数组，降级为 `text`；内部元素非法时替换为空字符串 `""` |
| `"progress"` | `number` (0-100) | 越界截断（<0 取 0，>100 取 100）；若非数字或为 `NaN`/`Infinity`，降级为 `text`；严格区分 `Boolean` 与 `Number` |
| `"list"` | `Array<string>` | 若非数组，降级为 `text`；内部元素非法时替换为空字符串 `""` |

**数据清洗与渲染安全契约**：

-   **严格 JSON 合规**：Cellrix 载荷必须是完全兼容 **RFC 8259** 的严格 JSON。严禁 `NaN`、`Infinity` 等非标准字面量（Python 适配器必须通过 `json.loads` 的 `parse_constant` 钩子拦截，或使用 `orjson` 等严格解析器）。
-   **布尔值区分**：类型校验时必须严格区分 `Number` 与 `Boolean`，遇到 `true`/`false` 作为 `semantic_data` 时必须降级为 `text`。
-   **内存红线**：适配器必须在解析 JSON 前（字节流层）执行大小硬限制（建议单 Cell Payload ≤ 2MB），超出截断，杜绝 OOM 攻击。
-   **防 ReDoS**：清洗不可信输入时，过滤算法必须为线性时间复杂度 $O(N)$，严禁使用可能回溯的复杂正则。
-   **表格容错**：对于 `table` / `list`，若内部元素包含非基本类型（如 Object、Array、null、boolean），**必须直接替换为空字符串 `""`**，而非调用各语言的内建字符串化方法，以确保跨端一致性；若行长度不一致（锯齿数组），缺失单元格同样以 `""` 补齐。
-   **未知 Widget 降级**：遇到适配器不支持的 `semantic_widget` 值，强制回退为 `"text"`，仅渲染 `content` 字段。

#### `keybindings` 视觉升格

`keybindings` 数组中的每个对象可包含以下可选字段以实现跨端交互组件：

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `label` | `string` | 按钮显示文本。若未提供，则仅作为静默后台快捷键 |
| `style` | `string` | 语义化样式枚举，取值：`primary`, `secondary`, `success`, `danger`, `warning`, `info` |
| `show_key` | `boolean` | 是否在界面上显式提示快捷键（默认 `true`） |
| `hint` | `string` (可选) | CDS 风格暗示，适配器完全拥有忽略它的权力 |

**渲染契约**：

-   `key` 字段保持强制性。若意图提供纯视觉按钮，可保留 `key` 并将 `show_key` 设为 `false`。
-   **严格大小写匹配 (Case-Sensitivity)**：`key` 字段的绑定必须严格区分大小写。例如，`"key": "a"` 仅响应小写按键，`"key": "A"` 必须响应 `Shift+A`。
-   **键冲突决议 (Key Collision Resolution)**：若 `keybindings` 数组中出现重复的 `key` 定义，适配器必须采用 **“First-Wins”（首项生效）** 原则。即：只绑定并渲染数组中首次出现的 `key`，静默忽略后续所有具有相同 `key` 的对象。
-   非法 `style` 值降级为默认样式，禁止崩溃。

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

在原有规范基础上，新增以下强制性条款以适应 v2.4 的结构化语义扩展：

| 场景 | 协议契约 |
| :--- | :--- |
| **必填字段缺失 / `type` 非法 / `slot` 不存在** | 拒绝解析并返回错误。 |
| **未知字段** | 生产环境忽略并警告；开发环境拒绝解析。 |
| **约束冲突** | 按 `priority` 降级。 |
| **权限越界 / AI 生成越界** | Runtime 拒绝并回传拒绝原因事件。 |
| **ANSI 注入** | Runtime 必须剥离或转义所有外部输入中的 ANSI 逃逸序列。格式需求必须通过声明式 `style` 属性实现，禁止字符串夹带原生控制码。 |
| **版本缺失** | 按 v1.0 解析并发出弃用警告。 |
| **非标准 JSON 字面量** | 拒绝解析。`NaN`, `Infinity`, 裸 `true`/`false` 作为 `semantic_data` 必须触发降级或拒绝。 |
| **超大载荷** | 解析前即按大小限制（建议 ≤ 2MB）截断，不进入内存。 |
| **非法语义控件** | 未知 `semantic_widget` 值必须静默降级为 `text`。 |
| **`key` 冲突** | 按 First-Wins 原则处理，静默忽略重复。 |

---

## 5. 布局求解引擎与语义树标准

### 5.1 纯函数求解器

布局求解器必须是单向纯函数，具备 O(N) 时间复杂度。求解算法必须免回溯——父级约束确定后，子节点失败绝不触发父级重算。

```text
输入: (Manifest, Terminal_Width, Terminal_Height) → 输出: (RenderTree, SemanticTree)
```

**标准渲染基准**：xterm-256color + Unicode 11 East Asian Width。

### 5.2 双树模型、语义树按需查询与 Agent 可访问性

| 树类型 | 内容 | 服务对象 |
| :--- | :--- | :--- |
| **渲染树 (Render Tree)** | 物理坐标及样式，Client 消费。 | 人类的眼睛。 |
| **语义树 (Semantic Tree)** | 嵌套拓扑，高层语义，Daemon 暴露 API。 | AI 智能体 和 视障工程师。 |

语义树 API 支持过滤参数 `?slot_id=&limit=&role=`，由 Runtime 在协议层完成数据裁剪。

**Agent 可访问性接口 (Agent Accessibility Interface)**：语义树 API 同时是 Cellrix 的 Agent 可访问性接口。任何能够消费结构化 JSON 的外部系统（包括 AI Agent、自动化脚本、测试框架）均可通过标准 HTTP 或 Socket 连接，读取当前界面的完整语义状态，并通过标准化的动作端点执行操作。Agent 不需要理解 ANSI 转义码、不需要截图、不需要 OCR——它只需要理解 JSON。这是 Cellrix 相对于所有“事后 OCR”方案的压倒性优势。

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
| 16. 结构化数据非法格式 | 契约至上 + 安全第一 | 强制降级为 `text` + 空字符串占位符 |
| 17. 内存溢出攻击 (OOM) | 安全第一 | 单 Cell Payload 硬限制 ≤ 2MB，解析前截断 |
| 18. ReDoS 清洗阻塞 | 安全第一 + 极简复用 | $O(N)$ 线性过滤，禁用回溯正则 |

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

**任何违反“纯净 I/O”、“契约至上”、“极简复用”或“绝对幂等”核心公理的提案，将被直接拒绝，无需技术评估。**

---

## 9. 路线图

**第一阶段（当前 - 2026 Q3）**
发布 v2.4 Schema 与完整规范，CEP-0001 启动治理，参考实现验证全链路，AG-UI/MCP 桥接器设计，Conformance Suite 发布（含结构化语义边界测试）。

**第二阶段（2026 Q4 - 2027 Q2）**
生产级适配器开发，WASI 沙盒原型，HITL 拦截器，`cellrix preview` CLI，`semantic_data` 全控件渲染落地。

**第三阶段（2027 Q3 -）**
Spatial-CRDT 协同算法，企业级 HITL 审计，语义树到 Web-Accessibility 桥接器，多后端适配器生态成熟。

---

## 10. 结语

Cellrix 是一个源于真实痛点、严格遵循第一性原理的工程实践。它不追求成为最漂亮的终端画布，而是要成为最**高效、最稳定、最安全、最包容**的交互中枢。

我们遵循 **编排优先、契约至上、纯净 I/O、绝对幂等、极简复用、安全第一、按需驱动**的哲学，将协议与实现严格分离。协议是神圣的接口，实现是多元的竞争。

**我们拒绝模糊，拥抱确定性。我们拒绝黑盒，拥抱安全。我们拒绝复杂，拥抱极简。我们拒绝预加载，拥抱按需驱动。我们拒绝治理真空，拥抱开放演进。**

---

## 修订记录

| 版本 | 日期 | 主要变更 |
| :--- | :--- | :--- |
| v1.2.0 | 2026-05-06 | ANSI净化、O(N)求解器约束、治理模型、AI白名单 |
| v2.0 | 2026-05-06 | 注入 Helix Zen 设计哲学，明确协议与实现边界，重写原则为六条公理，增加哲学审查的治理条款 |
| v2.1 | 2026-05-07 | 新增多后端渲染架构声明，新增语义控件枚举（semantic_widget），明确协议与渲染后端的无关性 |
| v2.2 | 2026-05-08 | 内容类型（content_type）、语义控件扩展（input/modal/tree）、Modal 特殊布局规则、与 CIS v0.3.0 对齐 |
| v2.3 | 2026-05-12 | 结构化语义扩展 (`semantic_data`)、视觉控制反转原则 (CDS)、`keybindings` 视觉升格、基建级安全与鲁棒性防御条款 |
| **v2.4** | **2026-05-16** | **新增第七项原则“按需驱动，零浪费”；§5.2 新增 Agent 可访问性接口声明；更新版本号与 Schema 链接** |

---

**本白皮书是 Cellrix 项目的最高宪法。所有代码、文档、决策，均需在此框架内完成。**
