# Cellrix 执行蓝图 · ROADMAP.md

**定位**：Cellrix 白皮书 v2.4 的执行级补充文档  
**状态**：Phase 1 核心已交付 (P1a, P1b, P1e ✅)  
**哲学基石**：编排优先、契约至上、纯净 I/O、绝对幂等、极简复用、安全第一、按需驱动、零硬编码、如无必要勿增实体  
**关联文档**：本文档是 [Cellrix 技术白皮书 v2.4](./WHITEPAPER.md) 的执行级补充，随 Phase 推进持续更新。白皮书定义“是什么”和“为什么”，本文档定义“怎么做”和“何时做”。

---

## 0. 工程铁律 (Iron Laws)

1. **TUI 是最低公共分母** – 所有视觉增强基于 TUI 基线渐进增强。WebUI 是可选扩展，不是替代品。
2. **按需驱动，零浪费** – 组件级：WebSocket 按需激活；架构级：TUI 渲染线程可按需跳过。不做任何预加载。
3. **严格契约，硬失败** – 所有 AI 输出的 JSON 通过 Pydantic Strict 校验。非法字段直接拒绝，回退安全默认值。
4. **UTF-8 Only** – 所有 JSON 文件、所有 I/O 调用显式指定 UTF-8，杜绝跨平台编码崩溃。
5. **零硬编码** – 所有阈值、路径、策略均由配置或环境决定，绝不写入代码。
6. **资源自动管理** – 使用 `contextlib.closing` 等标准库机制，拒绝手动心跳、显式 `weakref`、硬编码超时。
7. **协议与实现分离** – 本文档中的所有任务均为参考实现的工程决策，不构成协议约束。任何通过 Conformance Suite 的实现均为合法 Runtime。

---

## 一、Phase 0：基础验证层 (Foundation Audit)

**目标**：确认已有资产无需修改即可支撑后续 Phase。  
**新增代码量**：0 行  
**风险**：无

**已有资产清单**：

| 资产 | 位置 | 状态 |
|:---|:---|:---|
| 语义树 API | Daemon §5.2 | ✅ 已实现 |
| 动作路由 | `cli/input_router.py` + `cli/actions.py` | ✅ 已实现 |
| ActionInterceptor 状态机 | Manifest §4.2 | ✅ 已定义 (原 HITL) |
| Theme 模型 | `cli/theme.py` | ✅ 已有令牌 |
| 双树输出 | `core/tree.py` | ✅ 已实现 |

---

## 二、Phase 1：Agent 可访问性 + 设计契约层

**目标**：Agent 可读取界面状态并执行操作；AI 可根据任意视觉参考直接输出符合 Cellrix Theme Schema 的 JSON 风格配置。  
**风险**：极低

### ✅ P1a：语义树快照端点
- **交付物**：`GET /v1/agent/snapshot` 端点 + `SemanticSnapshot` JSON Schema
- **功能**：返回标准化结构，包含视口元数据、焦点面板 ID、所有 Cell 的 `role`/`type`/`summary`/`available_actions`

### ✅ P1b：动作执行端点
- **交付物**：`POST /v1/agent/action` 端点
- **功能**：接收 `{"action": "focus_next"}` 或 `{"action": "scroll_down", "payload": {"lines": 5}}`，调用 `actions.dispatch()` 执行

### P1c：设计契约与主题扩展
- **交付物**：
  1. 扩展 `cli/theme.py` 令牌字段
  2. 实现 `TuiFallback` 混入模型
  3. 创建 `style_template.md`
  4. 强制 Pydantic Strict 校验
  5. 强制 UTF-8 编码

### P1d：验证脚本
- **交付物**：`examples/agent_demo.py`
- **功能**：模拟 Agent 连接 Daemon、读取快照、执行动作的完整闭环

### ✅ P1e：Agent 可访问性一致性测试
- **交付物**：`tests/test_agent_accessibility.py`
- **功能**：模拟 Agent 连接，验证快照获取稳定性、动作执行响应正确性、状态一致性。这是后续所有 Agent 功能的兜底校验。
- **新增代码量**：~50 行 Python

---

## 三、Phase 2：参数化操作 + ActionInterceptor 安全网关

**目标**：Agent 可执行参数化操作；所有危险操作须经人类确认。  
**风险**：低

### P2a：参数化 Action Executor
- **交付物**：扩展 `actions.dispatch` 签名 + 参数验证
- **功能**：Agent 传入的 payload 必须通过 Pydantic 参数校验模型，恶意 Shell 逃逸字符直接被拒绝。

### P2b：ActionInterceptor 安全网关适配
- **交付物**：Agent 协议层的拦截器适配
- **功能**：Agent 触发危险操作 → 协议层挂起 → Modal 确认 → 回传事件。复用 Manifest 已有的 `securityClass`、`requiresApproval` 机制。

### P2c：协议规范 v0.2
- **交付物**：`docs/cap.md`（Cellrix Agent Protocol 规范）
- **功能**：参数化动作契约、ActionInterceptor 事件流、错误码。

### P2d：[NEW] ActionInterceptor 状态机一致性测试
- **交付物**：`tests/test_hitl_state_machine.py`
- **功能**：测试高危操作触发 → 状态挂起 → 模态确认 → 超时/回退的完整链路。必须用自动化测试覆盖所有状态迁移。
- **新增代码量**：~60 行 Python

---

## 四、Phase 2.5：按需加载 Web UI 适配器

**目标**：同一棵 ViewTree 和 SemanticTree 同时驱动终端和浏览器。严格按需加载，零运行时浪费。  
**风险**：中

### P2.5a：极简 HTTP/WebSocket 服务
- **功能**：启动后监听本地端口。仅浏览器连接时激活 WebSocket；无连接时自动释放资源。

### P2.5b：Vanilla JS 前端（零框架依赖）
- **功能**：使用原生 DOM API 渲染。字符网格 CSS 基准，确保与 TUI 绝对对齐。

### P2.5c：ViewTree 序列化与事件反向冒泡
- **功能**：通过 JSON 差分帧驱动 DOM 更新。浏览器事件格式化为标准 Cellrix Action JSON。

### P2.5d：仅 WebUI 模式
- **功能**：`cellrix serve manifest.json --web-only` 启动模式。完全按需驱动。

### P2.5e：[NEW] Web-TUI 视觉对齐回归测试
- **交付物**：`tests/test_web_tui_alignment.py`
- **功能**：加载同一 Manifest，分别驱动 TUI 和 Web，比对结构描述（布局、关键元素位置、内容），确保绝对对齐。
- **新增代码量**：~80 行 Python

### P2.5f：[NEW] HTMX 渐进增强原型探索（可选）
- **交付物**：`experiments/htmx_prototype/`
- **功能**：在 vanilla JS 版本稳定后，用 HTMX 消费差分帧，纯实验生态复用，不影响主线。
- **新增代码量**：~100 行 Python + 1 个 HTML 文件

---

## 五、Phase 3：几何/拓扑图控件 + 意图桥接

**目标**：AI 可用几何图形对齐人类抽象思想；开发者可注册业务意图让 Agent 直接调用。  
**风险**：中高

### P3a：CIS 扩展：图控件
- **功能**：`semantic_widget: "canvas"` + `nodes`/`edges` 数据 Schema 扩展。

### P3b：TUI 图渲染
- **功能**：字符级分层树状布局算法。使用确定性布局，消除闪烁。

### P3c：Intent Registry + Router
- **功能**：意图调用受 Manifest `capabilities` 白名单约束。不在白名单中的意图直接被拒绝。

### P3d：K8s 故障排查演示
- **交付物**：演示脚本

### P3e：[NEW] canvas 控件 Schema 原型与验证
- **交付物**：`docs/canvas_widget_prototype.md` + `tests/test_canvas_schema.py`
- **功能**：编码前定义 JSON Schema 草案并进行用例验证，锁定契约。
- **新增代码量**：~80 行 Python + 文档

### P3f：[NEW] 意图注册格式原型
- **交付物**：`docs/intent_registry_prototype.yml` + `tests/test_intent_registry.py`
- **功能**：静态 YAML 模拟意图映射格式，编写解析和校验测试。
- **新增代码量**：~60 行 Python + YAML 原型

---

## 六、Phase 4：多 Agent 协作 + 联邦语义树

**目标**：多 Agent 协作；多 Cellrix 实例形成分布式终端状态网络。  
**风险**：极高  

### P4a：多 Agent 会话协议
- **功能**：操作按时间戳排序，按序执行，绝不并发修改同一状态。

### P4b：联邦语义树
- **功能**：最小权限传播——默认只共享公开面板摘要，敏感面板绝不跨实例传播。

### P4c：声音/音频交互协议
- **功能**：远期研究方向概念占位。

### P4d：[NEW] 联邦树极简原型实验
- **交付物**：`experiments/federated_tree_prototype/`
- **功能**：两个实例通过本地 WebSocket 共享语义树摘要，最小化踩坑成本。
- **新增代码量**：~100 行 Python

---

## 七、绝对验收标准

| 校验维度 | 量化指标 |
| :--- | :--- |
| **内存** | Web 适配器无连接时 < 5.5MB |
| **网络** | 浏览器关闭后 WebSocket 资源释放率 100% |
| **视觉** | Web 端与 TUI 端字符网格绝对对齐，布局差异 = 0 |
| **响应** | Web 端 JSON 差分帧 → DOM 更新 < 16ms (60Hz) |
| **生态兼容** | 输入任何旧版本协议 JSON，系统绝不抛出异常，降级渲染 |
| **主题安全** | 所有 AI 主题 JSON 通过 Pydantic Strict 校验，非法字段回退 `DEFAULT_THEME` |
| **编码安全** | 所有 JSON 声明 UTF-8，所有 I/O 显式指定编码，跨平台编码崩溃率 0 |
| **资源管理** | 所有连接使用 `contextlib.closing`，无手动心跳、无硬编码超时 |
| **Agent访问** | **[NEW]** 本地获取快照及动作执行 P99 延迟 < 10ms |
| **安全审计** | **[NEW]** ActionInterceptor 100% 高危操作触发审批，无漏网 |
| **架构演进** | **[NEW]** 旧版 Manifest 兼容降级并抛出 Deprecation Warning，绝不静默忽略 |

---

## 八、编码安全专项
- 所有 JSON 文件声明 `"encoding": "utf-8"`
- 所有 Python `open()` 调用显式传入 `encoding="utf-8"`
- 所有 JSON 序列化使用 `ensure_ascii=False`

## 九、资源管理专项
- HTTP/WebSocket 连接使用 `contextlib.closing` 自动管理生命周期
- 订阅者模式不设全局列表，订阅生命周期与使用者一致
- 不引入手动心跳、显式 `weakref`、硬编码超时阈值
