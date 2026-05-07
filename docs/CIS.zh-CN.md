# Cellrix 意图规范 (CIS) v0.2.0

**意图生成规范 — 如何与 Cellrix 对话**

**状态:** 草案
**对齐:** Cellrix 白皮书 v2.1
**日期:** 2026-05-07

---

## 1. 目的

CIS 定义了一份语言无关、零依赖的契约，使得任何项目——无论是 Python、Rust、Go 还是纯 Shell 脚本——都能够生成可供 Cellrix Runtime 消费的声明式 UI 描述。

**核心信条：** 一个项目永远不需要安装 Cellrix 就能成为“意图生产者”。Cellrix 仅负责验证与渲染。

---

## 2. 核心原则

| 原则 | 说明 |
|:---|:---|
| **零依赖** | 桥接代码不得 `import cellrix`。只允许使用宿主语言的标准库生成字典（或输出 JSON）。 |
| **语言无关** | 契约是一份 JSON Schema；任何语言均可实现。 |
| **自描述** | 意图生产者通过 Manifest 文件或 Python 入口点（或两者兼有）声明自身能力。 |
| **Fail Fast** | Cellrix 在消费任何 Manifest 之前执行严格的 Schema 校验。任何偏差立即被拒绝，并给出精准的错误路径。 |
| **最小接口** | 只需一个入口点加一个纯函数（`config → dict`）。 |

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
- 可选字段 `semantic_widget` 可声明控件类别（见 §7）。

Schema 随 Cellrix 协议版本一起发布。任何实现都必须对齐该 Schema。

---

## 6. 验证流程（`cellrix check`）

当用户运行 `cellrix check` 时，Cellrix 会：

1. **发现** — 定位 Manifest 文件或入口点。
2. **生成** — 调用桥接函数（或执行 CLI 命令）获得原始字典。
3. **验证** — 应用 JSON Schema；任何失败将产生详细的错误信息并返回非零退出码。
4. **报告** — 显示摘要，包括版本兼容性检查。

通过验证的 Manifest 可进一步使用 `cellrix preview` 进行可视化检查。

---

## 7. 语义控件

Cell 可以通过可选的 `semantic_widget` 字段声明其交互角色。协议定义了一小组通用值——**任何时候都不允许出现框架特定的类名**。

| 值 | 语义 | 说明 |
|:---|:---|:---|
| `"text"` | 文本块 | 默认值；纯文本渲染。 |
| `"table"` | 表格 | 需要 `columns` 和 `rows` 字段。 |
| `"list"` | 列表 | 需要 `items` 字段；支持焦点选择。 |
| `"progress"` | 进度条 | 需要 `value` 字段（0–100）。 |

`semantic_widget` 字段始终可选。省略时适配器默认为 `"text"`。适配器负责将这些语义映射到具体的 UI 组件。

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

---

## 10. 合规性

一个实现若满足以下条件即为 CIS 合规：

- 通过一种发现渠道暴露入口点。
- 产生的字典（或 JSON）通过 Cellrix JSON Schema 验证。
- **不**导入任何 Cellrix 模块。

**官方建议：** Python 项目应同时提供 Manifest 文件和入口点。非 Python 项目只需提供 Manifest 文件。

---

*本规范随 Cellrix 协议演进。任何变更必须遵循 CEP 流程。*
