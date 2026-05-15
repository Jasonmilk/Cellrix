# Cellrix 意图规范 (CIS) v0.4.1
**意图生成规范 — 如何与 Cellrix 对话**
**状态:** 草案  
**对齐:** Cellrix 白皮书 v2.4  
**日期:** 2026-05-16

---

## 1. 目的

CIS 定义了一份语言无关、零依赖的契约，使得任何项目——无论是 Python、Rust、Go 还是纯 Shell 脚本——都能够生成可供 Cellrix Runtime 消费的声明式 UI 描述。

**核心信条：** 一个项目永远不需要安装 Cellrix 就能成为“意图生产者”。Cellrix 仅负责验证与渲染。

---

## 2. 核心原则
| 原则            | 说明                                                                                                                       |
| :------------ | :----------------------------------------------------------------------------------------------------------------------- |
| **零依赖**       | 桥接代码不得 `import cellrix`。只允许使用宿主语言的标准库生成字典（或输出 JSON）。                                                                     |
| **语言无关**      | 契约是一份 JSON Schema；任何语言均可实现。                                                                                              |
| **自描述**       | 意图生产者通过 Manifest 文件或 Python 入口点（或两者兼有）声明自身能力。                                                                            |
| **Fail Fast** | Cellrix 在消费任何 Manifest 之前执行严格的 Schema 校验。任何偏差立即被拒绝，并给出精准的错误路径。                                                           |
| **最小接口**      | 只需一个入口点加一个纯函数（`config → dict`）。                                                                                          |
| **视觉独立**      | 契约仅传达语义意图；所有视觉呈现由适配器的本地设计系统 (CDS) 决定。                                                                                    |
| **按需声明**      | 意图生产者应仅输出当前任务所需的 Manifest 内容。不预生成未来可能需要的界面组件；不假设 Runtime 的渲染能力。Cellrix 的所有交互通道默认关闭，由 Manifest 中的 `actions` 字段显式声明所需交互类型。 |

---

## 3. 桥接模式

### 3.1 Python 函数（内存模式）

- `bridge_type: "python_function"`
- Cellrix 通过 Manifest 文件或入口点发现 `build_manifest` 函数。
- 签名：`def build_manifest(config: dict | None = None) -> dict`
- 返回的 `dict` 必须符合 `cellrix_manifest.schema.json`。
- 生产者**不得**导入 Cellrix；它只是返回一个字典。

### 3.2 CLI 子进程（跨语言 / 流模式）

- `bridge_type: "cli_subprocess"`
- 必须指定 `command` 字段（例如 `"ana loom --cellrix"`）。
- Cellrix 执行该命令，捕获 `stdout`，并期望得到符合 Schema 的 JSON。
- 同时检查退出码和 `stderr`。
- 该模式天然兼容 `cellrix stream`。

---

## 4. 发现机制（双通道）

Cellrix 按以下优先级发现意图生产者：

1. **Manifest 文件** — 项目根目录（或当前目录）下的 `cellrix_manifest.json`：
   ```json
   {
     "bridge": {
       "type": "python_function",
       "module": "my_project.cellrix",
       "function": "build_manifest"
     },
     "config": {}
   }
   ```

2. **Python 入口点** — 在 `pyproject.toml` 中声明：
   ```toml
   [project.entry-points."cellrix.bridge"]
   my_bridge = "my_project.cellrix:build_manifest"
   ```

`cellrix check` 会合并两个通道的结果。若都未找到，检查失败。

---

## 5. JSON Schema 契约

Cellrix 提供 `cellrix_manifest.schema.json`，定义了 Manifest 的合法形态。桥接函数返回的字典（或 CLI 桥接输出的 JSON）必须通过该 Schema 的严格验证。

**Schema 核心约束：**
- 顶层必须包含 `version`、`layout`、`cells`。
- `layout` 支持嵌套 `slots`；`weight` 必须为正整数。
- 每个 `Cell` 必须指定 `id`、`type`、`slot`。
- `type` 限定为 `static`、`dynamic`、`realtime`。
- `source` 可选；其 `type` 可为 `pipe`、`file` 或 `socket`。
- 可选字段 `semantic_widget` 可声明控件类别（见 §7.2）。
- 可选字段 `content_type` 可声明 `content` 格式（见 §7.1）。
- 可选字段 `semantic_data` 可承载结构化载荷（见 §7.3）。
- **严格 JSON 合规**：所有载荷必须完全兼容 RFC 8259。禁止 `NaN`、`Infinity` 等非标准字面量。Python 适配器必须通过 `parse_constant` 钩子或使用 `orjson` 等库进行拦截。

Schema 随 Cellrix 协议版本一起发布。任何实现都必须对齐该 Schema。

---

## 6. 验证流程（`cellrix check`）

当用户运行 `cellrix check` 时，Cellrix 会：

1. **发现** — 定位 Manifest 文件或入口点。
2. **生成** — 调用桥接函数（或执行 CLI 命令）获得原始字典。
3. **大小门禁** — 若原始载荷超出大小限制（建议单 Cell ≤ 2 MB），在解析前即行截断，防止 OOM 攻击。
4. **验证** — 应用 JSON Schema，包括对 `semantic_data` 的类型检查（见 §7.3）；任何失败将产生详细的错误信息并返回非零退出码。
5. **报告** — 显示摘要，包括版本兼容性检查。

通过验证的 Manifest 可进一步使用 `cellrix preview` 进行可视化检查。

---

## 7. 内容类型、语义控件与结构化数据

### 7.1 内容类型 (`content_type`)

Cell 可通过可选的 `content_type` 字段声明其 `content` 字段的格式。适配器负责据此选择渲染方式。

| 值 | 语义 | 说明 |
|:---|:---|:---|
| `"text"` | 纯文本 | 默认值 |
| `"markdown"` | Markdown 格式 | 适配器应使用原生 Markdown 渲染（表格、代码块、列表等） |
| `"code"` | 源代码块 | 适配器应提供语法高亮。可附带 `language` 字段（如 `"python"`, `"rust"`）指导高亮器 |

协议永远不引用任何特定的 Markdown 或语法高亮库。

### 7.2 语义控件 (`semantic_widget`)

Cell 可以通过可选的 `semantic_widget` 字段声明其交互角色。协议定义了一小组通用值——**任何时候都不允许出现框架特定的类名**。

| 值 | 语义 | 说明 |
|:---|:---|:---|
| `"text"` | 文本块 | 默认值 |
| `"table"` | 表格 | 需要 `semantic_data` 提供二维数组（见 §7.3） |
| `"list"` | 列表 | 需要 `semantic_data` 提供字符串数组（见 §7.3） |
| `"progress"` | 进度条 | 需要 `semantic_data` 提供 0-100 数值（见 §7.3） |
| `"input"` | 单行或多行文本输入 | 支持 `placeholder`、`multiline`、`autocomplete` 属性。必须伴随 `actions.onSubmit`，提交时携带 `payload.value` |
| `"modal"` | 覆盖层对话框（确认或提示） | **脱离布局网格独立渲染**，适配器必须将其渲染为居中浮层。必须定义 `actions.onConfirm` 和/或 `actions.onCancel` |
| `"tree"` | 层级可展开树 | 使用 `data` 字段，格式为递归 `{label, children}` 结构（见 §7.4）。支持 `actions.onNodeSelect` |

### 7.3 结构化数据 (`semantic_data`)

一个可选字段，用于承载语义控件的类型化载荷。其期望类型由配套的 `semantic_widget` 决定：

| `semantic_widget` | 期望的 `semantic_data` 类型 | 回退策略 |
|:---|:---|:---|
| `"text"` (默认) | 不需要 | — |
| `"table"` | `Array<Array<string\|number>>` (二维数组) | 降级为 `text`，渲染 `content` |
| `"progress"` | `number` (整数或浮点数，域 0–100) | 夹定至边界；若为 `NaN`、`Infinity` 或非数字 → 降级为 `text` |
| `"list"` | `Array<string>` (一维字符串数组) | 降级为 `text`，渲染 `content` |

**类型校验规则：**
- `Boolean` 值（`true`/`false`）**不可**作为 `"progress"` 的 `semantic_data`——必须触发降级。
- 对于 `"table"` 和 `"list"`，若内部元素为非基本类型（Object、Array、null、boolean），适配器**必须**将其替换为空字符串 `""`，而非调用各语言的内建字符串化方法。
- 对于 `"table"`，锯齿数组（行长度不一致）缺失的单元格必须用空字符串 `""` 补齐。

**安全契约（所有适配器强制执行）：**
- **严格 JSON**：不允许 `NaN`、`Infinity` 或其他非 RFC‑8259 字面量。Python 适配器必须通过 `json.loads` 钩子拦截，或使用 `orjson` 等库。
- **内存门禁**：解析前，适配器必须强制执行单 Cell 载荷大小限制（建议 ≤ 2 MB）。超出限制的载荷将被拒绝。
- **防 ReDoS**：所有输入清洗（HTML 转义、ANSI 剥离）必须在 $O(N)$ 时间内完成；禁止使用可能回溯的正则表达式。
- **未知控件**：任何未在 §7.2 中列出的 `semantic_widget` 值必须视为 `"text"`。

### 7.4 树数据 Schema

当 `semantic_widget` 为 `"tree"` 时，`data` 字段必须符合以下递归结构：

```json
"data": [
  {
    "label": "节点标签",
    "children": [
      { "label": "子节点 A" },
      { "label": "子节点 B", "children": [...] }
    ]
  }
]
```

每个节点可选地携带 `icon` 或 `metadata` 字段。适配器负责渲染层级结构并处理展开/折叠交互。

### 7.5 键位视觉增强

每个 keybinding 对象可携带以下可选视觉字段，以指导适配器侧渲染：

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `label` | `string` | 按钮标签。若省略，快捷键不可见但仍有效。 |
| `style` | `string` | 语义化样式枚举：`primary`, `secondary`, `success`, `danger`, `warning`, `info` |
| `show_key` | `boolean` | 是否显示按键提示（默认 `true`） |
| `hint` | `string` (可选) | CDS 风格暗示，适配器可忽略 |

**渲染规则：**
- `key` **区分大小写**：`"a"` 仅匹配小写键，`"A"` 匹配 `Shift+A`。
- **键冲突决议**：若同一 `keybindings` 数组中出现重复 `key`，采用 **First‑Wins** 原则——仅注册首次出现的定义，后续重复项静默忽略。
- 无效的 `style` 值必须回退至适配器的默认按钮样式；禁止崩溃。

---

## 8. 事件协议

Cellrix 适配器必须将用户交互（键盘、鼠标、触摸）转换为标准化的 **Cellrix Action JSON** 消息。这些消息通过管道或回调传递给业务逻辑。

**标准 Action JSON 格式：**
```json
{
  "event": "cellrix.action",
  "action": "focus_next",
  "cell_id": "my_cell",
  "payload": {}
}
```

**全局标准动作：**
| 动作 | 说明 |
|:---|:---|
| `focus_next` | 移动焦点到下一个面板 |
| `focus_prev` | 移动焦点到上一个面板 |
| `toggle_help` | 切换全屏帮助覆盖层 |
| `quit` | 退出当前会话 |
| `submit_input` | 当 `input` 控件提交其值时发出 |
| `confirm_modal` | 当 `modal` 对话框被确认时发出 |
| `cancel_modal` | 当 `modal` 对话框被取消时发出 |
| `node_select` | 当 `tree` 节点被选中时发出 |

### 8.1 输入载荷规范

当 `semantic_widget: "input"` 的 Cell 触发其 `actions.onSubmit` 时，发出的 Action JSON 必须在 `payload.value` 中包含当前输入值：

```json
{
  "event": "cellrix.action",
  "action": "submit_input",
  "cell_id": "code_editor",
  "payload": {
    "value": "print('Hello, Cellrix!')"
  }
}
```

### 8.2 Modal 事件规范

Modal 事件携带一个可选载荷以指示用户的选择：

```json
{
  "event": "cellrix.action",
  "action": "confirm_modal",
  "cell_id": "restart_confirm",
  "payload": {
    "choice": "yes"
  }
}
```

### 8.3 Tree 节点选择事件

当 `semantic_widget: "tree"` 的节点被选中时，事件携带选中节点的路径：

```json
{
  "event": "cellrix.action",
  "action": "node_select",
  "cell_id": "file_browser",
  "payload": {
    "path": ["src", "main.py"]
  }
}
```

**业务逻辑侧：**
- 接收 Action JSON，处理并返回新的 Manifest 或对已有 Manifest 的更新。
- 适配器根据新 Manifest 重新渲染界面。

**规则：**
- 事件格式是协议契约；所有适配器必须遵守。
- 原始输入（如键盘按键）到动作的映射由具体实现决定，但必须可通过键位机制配置。

---

## 9. 适配器职责

任何合规的 Cellrix 适配器必须履行三项职责：

1. **渲染** — 消费 Manifest，向用户呈现可视化界面。
2. **标准化事件** — 将用户交互转换为标准的 Cellrix Action JSON。
3. **动态更新** — 接受新的 Manifest 并重新渲染（部分或全局）。

适配器可自由选择渲染技术、输入处理策略和更新方式。

### 9.1 Modal 渲染规则

适配器必须将 `semantic_widget: "modal"` 的 Cell 渲染为居中浮层，覆盖在主布局上方。此类 Cell 不得参与布局网格（`weight`、`slot` 分配）；其位置和尺寸完全由适配器的 modal 实现决定。

### 9.2 防御性渲染（v0.4.0 增补）

除上述职责外，适配器还必须实施以下安全措施：

- **解析前大小门禁**：在完整解析前拒绝任何原始 JSON 载荷超出配置大小限制（建议 ≤ 2 MB）的 Cell。
- **严格 JSON 强制**：拒绝非 RFC‑8259 字面量（`NaN`、`Infinity`）。Python 适配器必须使用带 `parse_constant` 钩子的 `json.loads` 或类似 `orjson` 的库。
- **线性时间清洗**：所有输入清洗（HTML 转义、ANSI 剥离）必须在 $O(N)$ 时间内执行；永远不使用可能回溯的正则表达式。
- **回退优先渲染**：`semantic_data` 中的任何结构不匹配或类型违规必须立即触发回退至 `text` 控件，仅渲染 `content` 字符串。

---

## 10. 合规性

一个实现若满足以下条件即为 CIS 合规：

- 通过一种发现渠道暴露入口点。
- 产生的字典（或 JSON）通过 Cellrix JSON Schema 验证。
- 通过 §11 中定义的所有一致性测试。
- **不**导入任何 Cellrix 模块。

**官方建议：** Python 项目应同时提供 Manifest 文件和入口点。非 Python 项目只需提供 Manifest 文件。

---

## 11. 一致性测试用例（v0.4.0）

任何宣称 CIS 合规的实现必须通过以下测试：

**测试 1 — 非法表格数据降级**
- **输入**: `{"type":"static","content":"我的数据","semantic_widget":"table","semantic_data":"not an array"}`
- **预期**: 静默降级为 `text`，渲染 `"我的数据"`。

**测试 2 — 越界进度条数值**
- **输入**: `{"type":"static","content":"加载中","semantic_widget":"progress","semantic_data":999}`
- **预期**: 渲染为 100% 进度；不崩溃。

**测试 3 — 无效按钮样式枚举**
- **输入**: `{"keybindings":[{"key":"a","intent":"x","label":"按钮","style":"neon-pink"}]}`
- **预期**: 忽略无效样式，渲染默认按钮。

**测试 4 — XSS / ANSI 注入防御**
- **输入**: `{"type":"static","content":"Alert","semantic_widget":"list","semantic_data":["<script>alert(1)</script>","\\u001b[2J"]}`
- **预期**: Web 适配器转义标签；TUI 适配器剥离 ANSI 序列。

**测试 5 — 锯齿表格与无效元素鲁棒性**
- **输入**: `{"type":"static","semantic_widget":"table","semantic_data":[["A","B"],["C",{"hack":true}],["D"]]}`
- **预期**: 第二行第二列 → `""`（占位符，而非 `"[object Object]"`）；第三行第二列 → `""`。不崩溃。

**测试 6 — 未知控件降级**
- **输入**: `{"semantic_widget":"chart3d","semantic_data":{"x":1},"content":"数据为 {x:1}"}`
- **预期**: 回退至 `text`，仅渲染 `content`。

**测试 7 — RFC 8259 严格性（Python `allow_nan` 陷阱）**
- **输入**: `{"semantic_widget":"progress","semantic_data": NaN}` *(裸 `NaN`，非字符串)*
- **预期**: 解析错误或 Cell 被拒绝；若 JSON 解析后传入，降级为 `text`。

**测试 8 — 布尔值类型混淆防御**
- **输入**: `{"semantic_widget":"progress","semantic_data": true}`
- **预期**: 识别为布尔值而非数字；降级为 `text`。

**测试 9 — 键冲突决议**
- **输入**: `{"keybindings":[{"key":"a","intent":"yes"},{"key":"a","intent":"no"}]}`
- **预期**: 仅第一个绑定（`"yes"`）生效；第二个被静默忽略。

---

*本规范随 Cellrix 协议演进。任何变更必须遵循 CEP 流程。*
