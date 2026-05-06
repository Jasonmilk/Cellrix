# Cellrix

**意图驱动的、确定性的、空间-语义化终端 UI 协议与高性能运行时。**

> *Cellrix 不只是一个终端复古工具。它是为后 AGI 时代准备的、跨越碳基与硅基理解鸿沟的操作系统级 UI 协议。*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![Ruff](https://img.shields.io/badge/linter-Ruff-brightgreen)](https://github.com/astral-sh/ruff)
[![Mypy](https://img.shields.io/badge/type--checker-Mypy-strict-blue)](https://mypy-lang.org/)

---

## 为什么是 Cellrix？

现代终端 UI 需要太多手动坐标计算，而 Web UI 对高速迭代的后端和 AI 智能体而言又过于臃肿。Cellrix 用**声明式意图**解决了这两个问题。

用一份严格的 JSON/YAML **Cell-Manifest** 描述你的界面，**Cellrix Runtime** 便确定性地计算出布局、数据绑定和交互——在毫秒内输出一个完全自适应的 TUI（以及 GUI）。

| 传统 TUI | Cellrix |
|:---|:---|
| 手动计算 x,y 坐标 | 声明 `weight`、`minConstraint`、`slot` |
| 每个窗格数百行代码 | 一份 Manifest，零 UI 样板代码 |
| 屏幕阅读器无法识别 | 语义树严格对齐 W3C ARIA 1.3 |
| AI 无法理解屏幕内容 | AI 直接读取语义树 |

---

## 设计哲学 —— *Cellrix Zen*

我们视以下公理为神圣不可侵犯。每一次提交、每一个 PR、每一项设计决策，都必须遵守。

1. **编排优先，拒造实体** — Runtime 是调度引擎，不是渲染器。渲染委托给久经考验的库（`rich`）。
2. **契约至上，模型校验** — 所有组件通过强类型 Pydantic 模型通信。开发模式下遇到未知字段？直接拒绝。
3. **纯净 I/O，异常熔断** — `stdout` 只输出结构化数据；`stderr` 只输出诊断信息。绝不静默吞没错误。
4. **绝对幂等** — 布局求解器是纯函数。相同的 Manifest + 终端尺寸 = 永远相同的 ViewTree。
5. **极简复用，外包生态** — 直接依赖限制在 ≤5 个。每一行新增代码都必须证明其存在的必要性。
6. **安全第一，人机协同** — ANSI 注入在渲染层被阻断。关键操作触发物理确认屏障。

---

## 快速开始

### 安装

```bash
pip install cellrix-core
```

或使用 `uv`：

```bash
uv pip install cellrix-core
```

### 你的第一份 Manifest

创建 `hello.json`：

```json
{
  "version": "2.0",
  "layout": { "direction": "vertical", "slots": [
    { "id": "main", "weight": 1 }
  ]},
  "cells": [
    {
      "id": "greeting",
      "type": "static",
      "slot": "main",
      "content": "你好，Cellrix！"
    }
  ]
}
```

### 渲染它

```bash
cellrix preview hello.json
```

---

## 协议与实现

| 文档 | 用途 |
|:---|:---|
| [**WHITEPAPER.md**](WHITEPAPER.md) | 协议宪法——Manifest Schema、HITL 状态机、语义树、版本治理。 |
| [**ARCHITECTURE.md**](ARCHITECTURE.md) | `cellrix-core` 参考实现的工程决策（环形缓冲区、WASM 沙盒、持久化）。 |
| [**ENGINEERING_GUIDE.md**](ENGINEERING_GUIDE.md) | 代码风格、模块结构、测试策略、发布流程。 |

---

## 仓库结构

```
cellrix/
├── core/                   # 协议引擎（解析器、求解器、安全模块）
├── cli/                    # 薄 CLI 外壳（`cellrix preview`、`cellrix init`）
├── devkit/                 # 模板、协议桥接（MCP/AG-UI）
├── tests/                  # 单元测试 + 一致性测试套件
├── WHITEPAPER.md           # 协议
├── ARCHITECTURE.md         # 参考实现
├── ENGINEERING_GUIDE.md    # 施工手册
└── pyproject.toml
```

---

## 贡献

我们欢迎尊重 Zen 公理的贡献者。

1. Fork 并创建分支（`feat/`、`fix/`、`docs/`）。
2. 代码使用英语，遵循工程指引手册。
3. 确保本地通过 `ruff check`、`mypy strict` 和 `pytest`。
4. 提交 PR——Core Team 成员将进行审查。

完整指引见 [ENGINEERING_GUIDE.md](ENGINEERING_GUIDE.md)。

---

## 许可证

MIT。行善，勿害，保持简单。

---

*若白皮书为魂，此引擎即为体。二者遵循同一套六项法则。*
