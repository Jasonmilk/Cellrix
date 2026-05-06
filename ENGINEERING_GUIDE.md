# Cellrix 工程指引手册 · v1.0

**对齐白皮书 v2.0 · 遵循 Helix Zen 六项公理**

---

## 第一章 项目概述与架构边界

### 1.1 使命
Cellrix 是一个意图驱动的终端 UI 协议及高性能运行时。开发者通过声明式 Manifest 描述界面，Runtime 确定性地求解布局、数据绑定与交互，单份文件同时适配 GUI 和 TUI。

### 1.2 协议与实现的绝对边界
- **白皮书 (`WHITEPAPER.md`)** 定义协议契约：Manifest Schema、双树输出、HITL 状态机、ANSI 净化命令、版本语义。
- **参考实现 (`cellrix-core`)** 是协议的**一个合规实例**。它选择 Python 作为实现语言，选择 `rich` 作为渲染后端，选择 `pydantic` 作为模型校验。这些是工程决策，**不构成协议要求**。
- **任何实现只要通过 Conformance Suite 的全部测试，即为合法 Runtime**。

### 1.3 项目组件职责
| 组件 | 定位 | 核心职责 |
|:---|:---|:---|
| `cellrix-core` | 协议引擎 | Manifest 解析与校验、布局求解、双树生成、安全净化、HITL 状态机 |
| `cellrix-cli` | 终端客户端 | 加载 Manifest，调用 Core，通过 `rich` 输出 ANSI；提供 `cellrix preview` 等开发命令 |
| `cellrix-devkit` | 开发者工具包 | 模板生成、Manifest 校验工具、MCP/AG-UI 桥接器（远期） |

**边界铁律**：
- Core **不进行任何 I/O 渲染**，只输出结构化的 `ViewTree` 和 `SemanticTree`。
- CLI **不包含业务逻辑**，只是 Core 的薄壳。
- DevKit **不依赖 CLI**，只依赖 Core 的数据模型。

### 1.4 进程模型（Daemon-Client 分离）
Daemon 常驻后台，维护 Manifest 与数据管道，持续更新语义树并暴露 Unix Socket。Client 按需 attach/detach，只负责终端渲染。具体策略参见白皮书 §3。

---

## 第二章 开发环境与工具链

### 2.1 语言与版本
- Python 3.11+
- 使用 `uv` 作为包管理器和虚拟环境工具（替代 pip/poetry，速度更快、锁文件更可靠）。

### 2.2 项目配置
所有项目配置集中在 `pyproject.toml`，以下各节均对应其声明式配置。

### 2.3 代码格式化
- 采用 `ruff` 统一格式化和 lint。
- 配置文件 `pyproject.toml` 中 `[tool.ruff]` 段落预定义规则，严禁个人本地配置覆盖。

### 2.4 静态类型检查
- 使用 `mypy` 严格模式。
- 所有公共函数和类必须包含完整的类型标注。
- 不允许 `typing.Any` 的随意使用，如需动态类型必须显式标注原因。

### 2.5 编辑环境推荐
- Visual Studio Code + 插件 `ms-python.python`, `charliermarsh.ruff`
- 工作区设置 `.vscode/settings.json`：
  ```json
  {
    "python.defaultInterpreterPath": ".venv/bin/python",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.fixAll": true
    },
    "files.exclude": {
      "**/__pycache__": true,
      "**/*.pyc": true
    }
  }
  ```

---

## 第三章 代码风格与注释规范

### 3.1 通用要求
- **所有标识符、注释、文档字符串必须使用英语。**
- 文档与计划类 Markdown 使用中文。

### 3.2 文档字符串
- 使用 Google 风格的 docstring。
- 每个公共模块、类、函数必须包含 docstring。
- 示例：
  ```python
  def solve(manifest: Manifest, width: int, height: int) -> ViewTree:
      """Compute layout and return a render tree.

      Pure function. Given identical inputs, always produces identical outputs.

      Args:
          manifest: Parsed and validated Cell-Manifest.
          width: Available terminal columns.
          height: Available terminal rows.

      Returns:
          A fully computed ViewTree ready for rendering.

      Raises:
          LayoutError: If constraints are unsatisfiable.
      """
  ```

### 3.3 错误处理
- **禁止** `try: ... except: pass`。
- 异常必须显式传播或转换为领域错误重新抛出。
- 底层错误包装为明确的 `CoreError`、`LayoutError`、`SecurityError` 等（遵循白皮书 §4.4 契约）。

### 3.4 注释原则
- 解释 **why**，而非 what。代码应自明 what。
- 有悖常理或性能敏感的代码必须添加注释说明。

---

## 第四章 项目结构与模块设计

### 4.1 工作区布局
```
cellrix/
├── pyproject.toml
├── ENGINEERING_GUIDE.md
├── ARCHITECTURE.md
├── WHITEPAPER.md
├── core/
│   ├── __init__.py
│   ├── manifest/
│   │   ├── __init__.py
│   │   ├── parser.py          # JSON Schema 验证与解析
│   │   └── models.py          # Pydantic 模型
│   ├── layout/
│   │   ├── __init__.py
│   │   └── solver.py          # 纯函数布局求解器
│   ├── security/
│   │   ├── __init__.py
│   │   ├── validator.py       # 网络权限验证
│   │   └── sanitizer.py       # ANSI 净化
│   └── tree.py                # ViewTree / SemanticTree 数据结构
├── cli/
│   ├── __init__.py
│   └── cellrix.py             # CLI 入口（非 main.py）
├── devkit/
│   ├── __init__.py
│   ├── templates.py           # 模板生成
│   └── bridge.py              # 协议桥接（远期）
├── tests/
│   ├── __init__.py
│   ├── test_manifest.py
│   ├── test_layout.py
│   └── test_security.py
└── .github/
    └── workflows/
        └── python.yml
```

### 4.2 公开 API 稳定性
- 每个子包通过 `__all__` 显式导出公共接口。
- 内部模块以 `_` 前缀标识，例如 `_internal.py`，不应被外部引用。
- 稳定 API 的变更需在 CHANGELOG 中标注。

### 4.3 依赖管理
- 直接依赖必须在 `pyproject.toml` 的 `dependencies` 中显式声明。
- 新增依赖必须提供充分理由（遵循**极简复用**原则）。
- `cellrix-core` 的直接依赖上限为 **5 个**（`pydantic`, `rich`, `click`, `protobuf`, `anyio` 等）。

---

## 第五章 协议实现规范

### 5.1 Manifest 解析
- 基于 Pydantic 模型进行强类型解析。
- 必须严格遵循白皮书 §4.4 行为表：缺少必填字段、`type` 非法、`slot` 引用不存在均**立即拒绝解析**。
- 未知字段在生产环境忽略并警告，开发环境拒绝。

### 5.2 类型与数据绑定
- `Cell.type` 封闭枚举（`static`, `dynamic`, `realtime`）。
- `source` 管道初始化由 Daemon 负责，Core 只验证字段有效性。

### 5.3 ANSI 净化
- 所有来自外部的内容（Manifest `content`、管道数据）在进入渲染管道前**必须调用 `sanitize()`**。
- 格式需求必须通过 `style` 属性声明，绝不允许字符串夹带转义序列。

### 5.4 能力校验
- `capabilities` 字段作为安全白名单，Core 提供 `validate_capability()` 函数，CLI/Daemon 调用处强制执行。

---

## 第六章 布局求解器开发指引

### 6.1 纯函数契约
- 求解器函数 `solve(manifest, width, height)` 具有 **绝对幂等性**。
- 可使用装饰器 `@pure`（自创）标记，CI 中通过重复执行两次并比较结果来验证确定性。

### 6.2 算法要求
- 时间复杂度 O(N)，N 为 Cell 数量。
- 免回溯：父级空间一旦确定，子级失败绝不影响父级。
- 权重分配算法递归计算各 `slot` 的物理坐标 (x, y, w, h)。

### 6.3 标准终端基准
- 求解器内部假定 xterm-256color 与 Unicode 11 East Asian Width。
- Conformance Suite 中的预期输出均基于此基准。

---

## 第七章 测试策略与质量门禁

### 7.1 覆盖率
- 行覆盖率 ≥ 90%。
- 使用 `pytest-cov` 生成报告，CI 中不达标阻止合并。

### 7.2 测试类型
| 类型 | 工具 | 目标 |
|:---|:---|:---|
| 单元测试 | `pytest` | 每个函数、每个方法 |
| 属性测试 | `hypothesis` | 求解器幂等性、解析器确定性 |
| Conformance Suite | 预定义 Manifest + 预期 ViewTree | 协议合规性 |
| 安全测试 | 恶意 Manifest、ANSI 注入用例 | 安全净化有效性 |

### 7.3 CI 门禁
- `ruff check` 零告警。
- `mypy` strict 模式零错误。
- `pytest` 全部通过。
- `pip-audit` 无已知高危漏洞。

---

## 第八章 安全开发指南

### 8.1 HITL 状态机
- 实现 `requiresApproval` 逻辑时，必须包含超时回退和 `fallbackEmit` 事件回传。
- 确认屏障渲染由 CLI 负责，Core 只提供挂起的事件描述。

### 8.2 禁止的危险模式
- 禁止 `eval()`, `exec()`, `pickle.loads()` 等动态代码执行。
- 禁止直接透传外部输入给系统调用。

### 8.3 审计日志
- 关键操作（重启、删除、权限变更）必须记录 JSONL 格式日志，包含 `trace_id`、时间戳、决策结果。

---

## 第九章 贡献流程与代码评审

### 9.1 工作流
1. Fork 主仓库，创建特性分支。
2. 遵循 conventional commits（`feat:`, `fix:`, `docs:`, `chore:` 等）。
3. 提交 PR，触发 CI。
4. 至少一位 Core Team 成员批准。
5. Squash 合并至 main。

### 9.2 评审检查清单
- [ ] 是否遵守 Zen 公理？
- [ ] 是否新增了依赖？理由充分？
- [ ] 公开 API 是否有 docstring 和类型标注？
- [ ] 测试覆盖是否充足？
- [ ] 是否存在 ANSI 注入风险？
- [ ] 异常是否正确传播，无静默吞没？

---

## 第十章 发布管理与版本号

### 10.1 语义版本
- 使用 `major.minor.patch` 格式。
- 与 Manifest `version` 字段保持兼容：主版本号变更允许 breaking，次版本仅新增可选字段。

### 10.2 发布流程
1. 更新 `pyproject.toml` 版本号。
2. 更新 `CHANGELOG.md`。
3. 创建 annotated tag `vX.Y.Z`。
4. CI 自动构建并发布至 PyPI。

### 10.3 废弃策略
- 废弃字段标记 `deprecated`，至少保留一个主版本周期。
- 文档中明确迁移路径。

---

*本手册随代码一同演进，任何修改必须通过 PR 审查。*
