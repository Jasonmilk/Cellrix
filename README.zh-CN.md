# Cellrix

**意图驱动的、确定性的、空间-语义化终端 UI 协议与高性能运行时。**

> *Cellrix 不只是一个终端复古工具。它是为后 AGI 时代准备的、跨越碳基与硅基理解鸿沟的操作系统级 UI 协议。*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![Ruff](https://img.shields.io/badge/linter-Ruff-brightgreen)](https://github.com/astral-sh/ruff)
[![Mypy](https://img.shields.io/badge/type--checker-Mypy-blue)](https://mypy-lang.org/)
[![Tests](https://img.shields.io/badge/tests-23%2F23%20passed-green)](#)

---

## 什么是 Cellrix？

用一份 JSON 文件描述你的终端界面，Cellrix 负责渲染——包括布局、焦点追踪、键盘快捷键和内置帮助系统。无需手动计算坐标，无样板绘制代码，无框架锁定。

Cellrix **协议优先**，而非实现优先。布局求解器是纯函数：相同的 Manifest + 相同的终端尺寸 = 每次完全相同的输出。渲染器只是协议的一个合规实例。只要你愿意，可以自己实现渲染器——只要通过 Conformance Suite，就是合法的 Cellrix Runtime。


## 为什么选择 Cellrix？

| 痛点 | Cellrix 的解决方案 |
|:---|:---|
| TUI 开发是重复的坐标数学 | 声明 `weight`、`minConstraint`、`slot`——求解器自动计算 |
| 每个工具各自发明键盘处理机制 | 通过 Keybindings 统一输入路由（与渲染器解耦） |
| 终端应用对视障工程师不友好 | 语义树严格对齐 W3C ARIA 1.3 |
| AI 智能体无法阅读终端输出 | 语义树是结构化 JSON——无需 OCR |


## Cellrix 能为你做什么？

Cellrix 专为**四个递进层次**设计。你可以只使用需要的部分，不引入额外复杂性。

### 第一层：声明与预览

编写一份 Cell‑Manifest，立即看到渲染结果。这是最快的入门方式。

```bash
cellrix preview hello.json
```

```json
{
  "version": "2.0",
  "layout": { "direction": "vertical", "slots": [{ "id": "main", "weight": 1 }] },
  "cells": [
    { "id": "greeting", "type": "static", "slot": "main", "content": "你好，Cellrix！" }
  ]
}
```

随时按 `F1` 或 `?` 查看可用快捷键。按 `Tab` 在面板间移动焦点。按 `q` 退出。

### 第二层：设计布局

使用 `weight`、`minConstraint`、`collapseMode` 和嵌套槽位，构建复杂、响应式的布局，自适应终端尺寸变化——零手动坐标计算。

```json
{
  "version": "2.0",
  "layout": {
    "direction": "horizontal",
    "slots": [
      { "id": "sidebar", "weight": 1 },
      { "id": "main", "weight": 3, "layout": {
        "direction": "vertical",
        "slots": [
          { "id": "status", "weight": 1 },
          { "id": "log", "weight": 4 }
        ]
      }}
    ]
  },
  "cells": [
    { "id": "nav", "type": "static", "slot": "sidebar", "content": "# 仪表盘",
      "minConstraint": { "width": 10, "height": 3 }, "priority": 100 },
    { "id": "cpu", "type": "realtime", "slot": "status", "content": "CPU: 空闲",
      "minConstraint": { "width": 5, "height": 1 } },
    { "id": "events", "type": "dynamic", "slot": "log",
      "collapseMode": "scroll", "priority": 50 }
  ]
}
```

求解器自动完成：
- 侧边栏与主区域以 1:3 比例分割水平空间
- 主区域以 1:4 比例垂直分割状态栏和日志面板
- 终端缩小时保护高优先级面板不被挤压
- 低优先级面板折叠为滚动模式，而非崩溃

你定义**什么**，运行时负责**如何**。

### 第三层：连接数据管道（动态内容）

将单元绑定到真实数据源：Shell 命令、日志文件、Socket。内容自动更新——无需全量替换 Manifest。

```bash
# 实时时钟（需要 --trust 启用管道执行）
cellrix preview clock.json --trust
```

```json
{
  "version": "2.0",
  "layout": { "direction": "vertical", "slots": [{ "id": "main", "weight": 1 }] },
  "cells": [
    { "id": "clock", "type": "realtime", "slot": "main",
      "source": { "type": "pipe", "command": "while true; do date; sleep 1; done" } }
  ]
}
```

**安全第一：** 管道执行默认禁用。你必须显式使用 `--trust` 来启用。否则，单元显示安全锁定提示，不启动子进程。

### 第四层：流式传输与嵌入（程序化使用）

将 Manifest JSON 流传输到 `cellrix stream`，实现数据到达时实时更新的仪表盘。流结束后，界面保持交互状态，你可以检查最终状态。

```bash
# 每秒钟生成一个 Manifest 并流式传输
generate_manifests | cellrix stream
```

或直接将运行时嵌入你的 Python 应用：

```python
from core.manifest.parser import parse_manifest
from cli.runtime import CellrixRuntime

manifest = parse_manifest("my_dashboard.json")
runtime = CellrixRuntime(manifest)
runtime.run()   # 阻塞直到用户按下 'q'
```

运行时控制整个交互循环：渲染、输入处理和动态数据轮询。你提供 Manifest——Cellrix 处理其余一切。


## 交互式工作台（内置）

每次 `cellrix preview` 会话自动包含以下交互功能，无需任何配置。

### 导航

| 功能 | 按键 |
|:---|:---|
| 焦点移到下一个面板 | `Tab` |
| 焦点移到上一个面板 | `Shift+Tab` |
| 按面板索引直接跳转 | `Alt+1` … `Alt+9` |
| Leader Key（显示跳转标签） | `g` |
| 跳转到标签面板 | `g` 然后 `a` … `z` |

### 滚动（面板需设置 `collapseMode: "scroll"`）

| 功能 | 按键 |
|:---|:---|
| 向上/向下滚动（行） | `↑` / `↓` |
| 向上/向下翻页 | `PgUp` / `PgDn` |
| 跳到开头/结尾 | `Home` / `End` |

### 帮助与退出

| 功能 | 按键 |
|:---|:---|
| 显示所有快捷键（上下文感知） | `F1` 或 `?` |
| 关闭帮助覆盖层 | `Esc`（仅当帮助打开时） |
| 退出 | `q` |

底部状态栏始终显示最相关的快捷键。无需记忆——随时按 `?` 即可看到一切。


## 给项目作者：让你的 CLI 开口说 Cellrix

Cellrix 不是一个需要你导入的库——它是一个你的项目可以说出的协议。任何项目都能成为“意图生产者”，并被 Cellrix 渲染，而无需安装任何 Cellrix 依赖。

[Cellrix Intents Specification (CIS)](CIS.md) 定义了标准。概览如下：

### 规则

你的项目需要**一个入口点**，产出 Cell‑Manifest JSON。有两种注册方式：

**通道 A — Manifest 文件**（语言无关，推荐）

在项目根目录放置 `cellrix_manifest.json`：

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

非 Python 项目使用 CLI 子进程代替：

```json
{
  "bridge": {
    "type": "cli_subprocess",
    "command": "my-cli-tool --cellrix"
  }
}
```

**通道 B — Python 入口点**（Python 包的可选加分项）

在 `pyproject.toml` 中声明：

```toml
[project.entry-points."cellrix.bridge"]
my_bridge = "my_project.cellrix:build_manifest"
```

### 函数

在 Python 项目中，`build_manifest` 函数可以像这样：

```python
# my_project/cellrix.py  —  无需 import cellrix!
def build_manifest(config: dict | None = None) -> dict:
    return {
        "version": "2.0",
        "layout": ...,
        "cells": [...]
    }
```

### 发现与验证

运行 `cellrix check`——它会扫描两条通道，调用桥接，并按 JSON Schema 验证输出。一旦通过，你的项目就是 Cellrix 就绪的。

完整的事件协议、语义控件和所有支持的桥接模式，请参阅 [CIS 规范](CIS.md)。


## 核心概念

### Cell‑Manifest

描述界面的 JSON 文件。三种单元类型：

| 类型 | 行为 |
|:---|:---|
| `static` | 永不更新（标题、导航、按钮） |
| `dynamic` | 从数据源追加数据（日志流、事件列表） |
| `realtime` | 轮询并替换内容（CPU 仪表、状态指示器） |

### 布局

带有 `weight` 比例的嵌套槽位。水平和垂直分割组合成分形网格。无像素计算——求解器确定性地计算坐标。

### 键位

与渲染器解耦。全局绑定（`q` = 退出）不可被 Manifest 动作覆盖。上下文相关绑定在帮助覆盖层和状态栏中显示。

### 主题

颜色存储为数据（`cli/theme.py`），不硬编码。切换主题无需修改渲染器逻辑。


## 快速上手

**环境要求:** Python 3.11+, [`uv`](https://astral.sh/uv)

```bash
git clone git@github.com:Jasonmilk/Cellrix.git
cd Cellrix
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
uv run cellrix preview examples/hello.json
```


## 当前状态

| 门禁 | 状态 |
|:---|:---|
| 协议规范 (WHITEPAPER.md v2.2) | ✅ 定稿 |
| 工程指引手册 (10 章) | ✅ 完成 |
| Manifest 解析器 + 严格校验 | ✅ 完成 |
| ANSI 净化 + 能力验证 | ✅ 完成 |
| `ruff check` | ✅ 全部通过 |
| `mypy --strict` (21 个源文件) | ✅ 成功，0 错误 |
| 布局求解器 + 交互式渲染 | ✅ 工作台就绪 |
| 动态数据管道 (SourceManager) | ✅ `--trust` 门控启用 |
| 流模式 (stdin ndjson) | ✅ 流结束后交互可用 |
| Textual 适配器 (`cellrix run`) | ✅ 双向管道 |
| 多层输入路由（Leader Key、滚动、上下文帮助） | ✅ 完成 |


## 设计哲学 —— *Cellrix Zen*

每一次提交、每一个 PR、每一项设计决策，都必须恪守这六条公理：

1. **编排优先，拒造实体** — 运行时是调度引擎，而非渲染器本身。
2. **契约至上，模型校验** — 所有组件通过强类型 Pydantic 模型通信。
3. **纯净 I/O，异常熔断** — `stdout` 传递数据，`stderr` 输送诊断，错误绝不静默吞没。
4. **绝对幂等** — 同一份 Manifest 与终端尺寸，永远产生完全相同的 ViewTree。
5. **极简复用，外包生态** — 直接依赖上限为 ≤5 个；每一行新代码都须证明其存在之必要性。
6. **安全第一，人机协同** — ANSI 注入已在渲染层阻断；关键操作必经物理确认屏障。


## 仓库结构

```
cellrix/
├── core/                   # 协议引擎（解析器、求解器、安全、数据源）
├── cli/                    # 交互式终端客户端 + 主题与键位
├── devkit/                 # 模板、协议桥接 (MCP/AG-UI)
├── adapters/               # 渲染适配器（可选依赖）
│   └── textual/            # Textual 适配器（生产级交互）
├── tests/                  # 单元测试 + 一致性测试套件
├── WHITEPAPER.md           # 协议宪法
├── CIS.md                  # 意图规范
├── ARCHITECTURE.md         # 参考实现决策
├── ENGINEERING_GUIDE.md    # 施工手册 (中文)
└── pyproject.toml
```


## 质量门禁

```bash
uv run ruff check .          # 零警告
uv run ruff format . --check # 格式一致
uv run mypy --strict cli/ core/ devkit/  # 零错误
uv run pytest                # 35/35 通过
```


## 许可证

MIT。行善，勿害，保持简单。

---

*若白皮书为魂，此引擎即为体。二者遵循同一套六项法则。*

*英文版: [README.md](README.md)*
