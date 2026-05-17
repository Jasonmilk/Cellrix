# Cellrix

Cellrix 是 [通用意图规范 (CIS)](https://github.com/CommonIntents/CIS) 的参考 TUI 实现。

**一个意图驱动的、确定性的、空间语义化的终端 UI 协议及高性能运行时。**

> *Cellrix 不仅仅是为终端时代设计的工具，更是为后 AGI 时代打造的 OS 级 UI 协议——弥合碳基与硅基智能之间的理解鸿沟。*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![Ruff](https://img.shields.io/badge/linter-Ruff-brightgreen)](https://github.com/astral-sh/ruff)
[![Mypy](https://img.shields.io/badge/type--checker-Mypy-blue)](https://mypy-lang.org/)
[![Tests](https://img.shields.io/badge/tests-48%2F48%20passed-green)](#)

---

## 什么是 Cellrix？

用 JSON 文件描述你的终端界面，Cellrix 负责渲染——包含布局、焦点跟踪、键盘快捷键和内置帮助系统。无需手动计算坐标，无模板绘图代码，无框架锁定。

Cellrix 是 **协议优先** 的设计。布局求解器是一个纯函数：相同的清单文件 + 相同的终端尺寸 = 完全一致的结果。渲染器只是该协议的一个合规消费者。

**Cellrix 提供两个生产级适配器：**

| 适配器 | 适用场景 |
|:---|:---|
| `cellrix preview` (Rich) | 轻量、零配置的终端预览 |
| `cellrix run` (Textual) | 全屏交互式工作台，支持原生部件 |


## 为什么选择 Cellrix？

| 问题 | Cellrix 的解决方案 |
|:---|:---|
| TUI 开发充满重复的坐标计算 | 声明 `weight`、`minConstraint`、`slot`——求解器自动完成其余工作 |
| 每个工具都发明自己的键盘处理 | 统一输入路由，通过 Keybindings 解耦渲染器 |
| 终端应用对屏幕阅读器不可见 | 语义树对齐 W3C ARIA 1.3 标准 |
| AI 代理无法读取终端输出 | 语义树是结构化的 JSON——无需 OCR |


## Cellrix 能为你做什么？

### Level 0：快速校验

```bash
cellrix check my-dashboard.json
# ✅ Manifest is valid.
```

### Level 1：声明与预览

```bash
cellrix preview hello.json
```

```json
{
  "version": "2.3",
  "layout": { "direction": "vertical", "slots": [{ "id": "main", "weight": 1 }] },
  "cells": [
    { "id": "greeting", "type": "static", "slot": "main", "content": "Hello, Cellrix!" }
  ]
}
```

按 `F1` 或 `?` 查看快捷键。`Tab` 移动焦点。`q` 退出。

### Level 2：设计布局

使用 `weight`、`minConstraint`、`collapseMode` 以及嵌套插槽，创建适应终端尺寸变化的响应式布局。

### Level 3：语义小部件 (v2.3)

直接从结构化数据渲染进度条、表格和列表：

| 小部件 | 数据 | 渲染效果 |
|:---|:---|:---|
| `"progress"` | 数字 0–100 | `████████████████░░░░ 75%` |
| `"table"` | 二维数组 | 竖线分隔的表格 |
| `"list"` | 字符串数组 | 项目符号列表 |

### Level 4：动态数据管道

```bash
cellrix preview clock.json --trust
```

单元格内容通过 Shell 命令、日志文件或套接字实时更新。

### Level 5：流式与嵌入

```bash
generate_manifests | cellrix stream
```

或直接嵌入：

```python
from cli.runtime import CellrixRuntime
runtime = CellrixRuntime(manifest)
runtime.run()
```

### Level 6：Agent 可访问 API

```bash
cellrix daemon
```

启动本地 HTTP 服务器，向 AI Agent 暴露当前 UI 状态：

| 端点 | 用途 |
|:---|:---|
| `GET /v1/agent/snapshot` | 只读语义树及视口元数据 |
| `POST /v1/agent/action` | 执行已注册的动作（如 `focus_next`） |

Agent 无需 OCR 即可导航、滚动和切换面板——结构化 JSON、严格 Pydantic 契约、P99 延迟 < 10ms。高风险操作由 **ActionInterceptor**（人机确认回路）把关。详见 `docs/CAP.md`。


## 交互式工作台

| 功能 | 按键 |
|:---|:---|
| 焦点下/上一个面板 | `Tab` / `Shift+Tab` |
| Leader 键（显示跳转标签） | `g` |
| 滚动 | `↑↓ PgUp PgDn Home End` |
| 帮助覆盖层 | `F1` 或 `?` |
| 退出 | `q` |


## 面向项目作者：让你的 CLI 接入 Cellrix

你的项目只需一个能输出 Cell‑Manifest JSON 的入口点，**无需依赖 Cellrix 本身**。

完整标准请参见 [通用意图规范 (CIS)](https://github.com/CommonIntents/CIS)。


## 当前状态

| 项目 | 状态 |
|:---|:---|
| 协议规范 (WHITEPAPER.md v2.4) | ✅ 已定稿 |
| 意图规范 (CIS v0.6.0) | ✅ 已定稿 |
| `ruff check` | ✅ 全部检查通过 |
| `mypy --strict` | ✅ 成功，0 错误 |
| 测试 | ✅ 48/48 通过 |
| Rich 适配器 | ✅ 完成 |
| Textual 适配器 | ✅ 完成 |
| 语义小部件 (progress, table, list) | ✅ 完成 |
| Agent API 守护进程 (P1a/P1b) | ✅ 完成 |
| ActionInterceptor (人机确认网关) | ✅ 完成 |
| CAP v0.2 规范 | ✅ 完成 |
| 合规性套件 | ✅ 9 项边界测试 |


## 快速开始

```bash
git clone git@github.com:Jasonmilk/Cellrix.git
cd Cellrix
uv venv && source .venv/bin/activate
uv pip install -e ".[dev,server]"
uv run cellrix preview examples/hello.json
```


## 设计哲学 —— *Cellrix Zen*

1. **编排优先，而非构建** —— 运行时是调度器，不是渲染器。
2. **严格契约，模型校验** —— 所有通信通过类型化的 Pydantic 模型。
3. **纯净流，硬失败** —— `stdout` 用于数据，`stderr` 用于诊断。
4. **绝对幂等** —— 相同的清单 + 终端尺寸 = 完全一致的 ViewTree。
5. **极简主义，生态复用** —— 直接依赖 ≤5。
6. **安全优先，人在回路** —— 阻止 ANSI 注入；关键操作需人类审批。


## 许可证

MIT。行善，勿害，保持简单。

---

*英文版: [README.md](README.md)*
