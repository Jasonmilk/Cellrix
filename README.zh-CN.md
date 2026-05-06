# Cellrix

**意图驱动的、确定性的、空间-语义化终端 UI 协议与高性能运行时。**

> *Cellrix 不只是一个终端复古工具。它是为后 AGI 时代准备的、跨越碳基与硅基理解鸿沟的操作系统级 UI 协议。*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![Ruff](https://img.shields.io/badge/linter-Ruff-brightgreen)](https://github.com/astral-sh/ruff)
[![Mypy](https://img.shields.io/badge/type--checker-Mypy-blue)](https://mypy-lang.org/)
[![Tests](https://img.shields.io/badge/tests-23%2F23%20passed-green)](#)

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

## 🎯 里程碑：交互式工作台正式上线

布局求解器（纯函数，O(N)，零重排）现已驱动一个完全可交互的终端预览体验，具备：

*   **Nano 风格的自解释界面**：单行状态栏与全屏帮助覆盖层（`F1`），动态展示全局和当前面板的专属快捷键。
*   **解耦的主题与键位系统**：切换色彩风格或重映射按键，零行渲染器代码改动。
*   **焦点追踪**：`Tab` / `Shift+Tab` 在面板间循环切换；激活的面板以醒目的亮绿色边框高亮。
*   **稳健的跨平台输入**：通过 `readchar` 实现非阻塞键盘交互，零延迟、零闪烁。

```bash
cellrix preview examples/hello.json
```

---

## 当前状态

| 门禁 | 状态 |
|:---|:---|
| 协议规范 (WHITEPAPER.md v2.0) | ✅ 定稿 |
| 工程指引手册 (10 章) | ✅ 完成 |
| Manifest 解析器与严格校验 | ✅ 完成 |
| ANSI 净化与网络权限验证 | ✅ 完成 |
| `ruff check` | ✅ 全部通过 |
| `mypy --strict` (18 个源文件) | ✅ 成功，0 错误 |
| 布局求解器 + 交互渲染 | ✅ 交互式工作台已就绪 |

---

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

---

## 设计哲学 —— *Cellrix Zen*

每一次提交、每一个 PR、每一项设计决策，都必须恪守这六条公理：

1. **编排优先，拒造实体** — 运行时是调度引擎，而非渲染器本身。
2. **契约至上，模型校验** — 所有组件通过强类型 Pydantic 模型通信。
3. **纯净 I/O，异常熔断** — `stdout` 传递数据，`stderr` 输送诊断，错误绝不静默吞没。
4. **绝对幂等** — 同一份 Manifest 与终端尺寸，永远产生完全相同的 ViewTree。
5. **极简复用，外包生态** — 直接依赖上限为 ≤5 个；每一行新代码都须证明其存在之必要性。
6. **安全第一，人机协同** — ANSI 注入已在渲染层阻断；关键操作必经物理确认屏障。

---

## 仓库结构

```
cellrix/
├── core/                   # 协议引擎（解析器、求解器、安全模块）
├── cli/                    # 交互式终端客户端 + 主题与键位
├── devkit/                 # 模板、协议桥接 (MCP/AG-UI)
├── tests/                  # 单元测试 + 一致性测试套件
├── WHITEPAPER.md           # 协议宪法
├── ARCHITECTURE.md         # 参考实现决策
├── ENGINEERING_GUIDE.md    # 施工手册 (中文)
└── pyproject.toml
```

---

## 质量门禁

```bash
uv run ruff check .          # 零警告
uv run ruff format . --check # 格式一致
uv run mypy --strict cli/ core/ devkit/  # 零错误
uv run pytest                # 23/23 通过
```

---

## 协议与实现

| 文档 | 用途 |
|:---|:---|
| [**WHITEPAPER.md**](WHITEPAPER.md) | 协议宪法 — Manifest Schema、HITL 状态机、语义树、版本治理。 |
| [**ARCHITECTURE.md**](ARCHITECTURE.md) | `cellrix-core` 参考实现的工程决策记录。 |
| [**ENGINEERING_GUIDE.md**](ENGINEERING_GUIDE.md) | 代码风格、模块结构、测试策略、发布流程。 |

---

## 许可证

MIT。行善，勿害，保持简单。

---

*若白皮书为魂，此引擎即为体。二者遵循同一套六项法则。*

*English version: [README.md](README.md)*
