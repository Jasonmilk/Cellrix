# Cellrix 执行蓝图 · ROADMAP.md

**定位**：Cellrix 白皮书 v2.4 的执行级补充文档  
**状态**：Phase 1 执行中  
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
| HITL 状态机 | Manifest §4.2 | ✅ 已定义 |
| Theme 模型 | `cli/theme.py` | ✅ 已有令牌 |
| 双树输出 | `core/tree.py` | ✅ 已实现 |

---

## 二、Phase 1：Agent 可访问性 + 设计契约层

**目标**：Agent 可读取界面状态并执行操作；AI 可根据任意视觉参考直接输出符合 Cellrix Theme Schema 的 JSON 风格配置。  
**总新增代码量**：< 430 行 Python + < 50 行 Markdown  
**风险**：极低

### P1a：语义树快照端点
- **交付物**：`GET /v1/agent/snapshot` 端点 + `SemanticSnapshot` JSON Schema
- **功能**：返回标准化结构，包含视口元数据、焦点面板 ID、所有 Cell 的 `role`/`type`/`summary`/`available_actions`
- **新增代码量**：< 100 行 Python
- **风险**：极低

### P1b：动作执行端点
- **交付物**：`POST /v1/agent/action` 端点
- **功能**：接收 `{"action": "focus_next"}` 或 `{"action": "scroll_down", "payload": {"lines": 5}}`，调用 `actions.dispatch()` 执行
- **新增代码量**：< 80 行 Python
- **风险**：极低

### P1c：设计契约与主题扩展
- **交付物**：
  1. 扩展 `cli/theme.py`：`corner_radius`、`spacing_density`、`font_family`、`animation_curve` 等令牌字段
  2. 实现 `TuiFallback` 混入模型：Web 令牌无法映射时自动降级为 TUI 字符集
  3. 创建 `style_template.md`：供 AI 直接输出符合规范的 JSON
  4. 强制 Pydantic Strict 校验：非法值回退 `DEFAULT_THEME`
  5. 强制 UTF-8 编码：所有 JSON 声明编码，所有 I/O 显式指定 `encoding="utf-8"`
- **新增代码量**：< 200 行 Python + < 50 行 Markdown
- **风险**：低

### P1d：验证脚本
- **交付物**：`examples/agent_demo.py`
- **功能**：模拟 Agent 连接 Daemon、读取快照、执行动作的完整闭环
- **新增代码量**：< 50 行 Python
- **风险**：极低

---

## 三、Phase 2：参数化操作 + HITL 安全网关

**目标**：Agent 可执行参数化操作；所有危险操作须经人类确认。  
**总新增代码量**：< 200 行 Python + 文档  
**风险**：低

### P2a：参数化 Action Executor
- **交付物**：扩展 `actions.dispatch` 签名 + 参数验证
- **功能**：支持 `{"action": "scroll_down", "payload": {"lines": 5}}`；Agent 传入的 payload 必须通过 Pydantic 参数校验模型，恶意 Shell 逃逸字符直接被拒绝
- **新增代码量**：< 100 行 Python
- **风险**：低

### P2b：HITL 安全网关适配
- **交付物**：Agent 协议层的 HITL 适配
- **功能**：Agent 触发危险操作 → 协议层挂起 → Modal 确认 → 回传事件。复用 Manifest 已有的 `securityClass`、`requiresApproval`、`timeout`、`fallbackEmit` 机制
- **新增代码量**：< 100 行 Python
- **风险**：低

### P2c：协议规范 v0.2
- **交付物**：`docs/cap.md`（Cellrix Agent Protocol 规范）
- **功能**：参数化动作契约、HITL 事件流、错误码
- **新增代码量**：文档

---

## 四、Phase 2.5：按需加载 Web UI 适配器

**目标**：同一棵 ViewTree 和 SemanticTree 同时驱动终端和浏览器。严格按需加载，零运行时浪费。  
**总新增代码量**：~500 行 Python + ~200 行 Vanilla JS  
**风险**：中

### P2.5a：极简 HTTP/WebSocket 服务
- **交付物**：Python 标准库实现的 HTTP/WS 监听器
- **功能**：启动后监听本地 `:8765` 端口。仅浏览器连接时激活 WebSocket；无连接时自动释放资源。使用 `contextlib.closing` 管理连接生命周期
- **新增代码量**：~200 行 Python
- **风险**：低

### P2.5b：Vanilla JS 前端（零框架依赖）
- **交付物**：单个 HTML 文件 + 极简 JS 脚本
- **功能**：使用原生 DOM API 渲染。字符网格 CSS 基准（`font-family: monospace`），确保与 TUI 绝对对齐。响应操作系统明暗主题
- **新增代码量**：~200 行 JS + 1 个 HTML 文件
- **风险**：中（跨浏览器兼容性测试）

### P2.5c：ViewTree 序列化与事件反向冒泡
- **交付物**：ViewTree → JSON 差分帧序列化器
- **功能**：Web 适配器消费与 TUI 完全相同的 ViewTree，通过 JSON 差分帧驱动 DOM 更新。浏览器端的键盘和点击事件统一格式化为标准 Cellrix Action JSON，通过 WebSocket 上行
- **新增代码量**：~300 行 Python
- **风险**：低

### P2.5d：仅 WebUI 模式
- **交付物**：`cellrix serve manifest.json --web-only` 启动模式
- **功能**：不激活 TUI 渲染线程，只监听 WebSocket 端口。完全按需驱动——用户只需要 Web，就只给 Web
- **新增代码量**：< 20 行 Python
- **风险**：极低

---

## 五、Phase 3：几何/拓扑图控件 + 意图桥接

**目标**：AI 可用几何图形对齐人类抽象思想；开发者可注册业务意图让 Agent 直接调用。  
**总新增代码量**：~800 行 Python  
**风险**：中高

### P3a：CIS 扩展：图控件
- **交付物**：`semantic_widget: "canvas"` + `nodes`/`edges` 数据 Schema + `onDrag`/`onConnect` 交互事件
- **新增代码量**：协议定义
- **风险**：中

### P3b：TUI 图渲染
- **交付物**：字符级分层树状布局算法（参考 Dagre 简易实现）
- **功能**：单屏渲染节点上限 ≤ 20 个，超出折叠为子树。放弃动态力导向布局，使用确定性布局，消除闪烁
- **新增代码量**：~300 行 Python
- **风险**：中高

### P3c：Intent Registry + Router
- **交付物**：`intent.yml` 注册格式 + 意图路由 + 安全校验
- **功能**：意图调用受 Manifest `capabilities` 白名单约束，不在白名单中的意图直接被拒绝
- **新增代码量**：~400 行 Python
- **风险**：中高

### P3d：K8s 故障排查演示
- **交付物**：演示脚本
- **功能**：用实际案例证明“意图级交互”可行性
- **新增代码量**：演示脚本
- **风险**：低

---

## 六、Phase 4：多 Agent 协作 + 联邦语义树

**目标**：多 Agent 协作；多 Cellrix 实例形成分布式终端状态网络。  
**总新增代码量**：~1000 行 Python  
**风险**：极高  
**建议**：Phase 3 完成后启动。

### P4a：多 Agent 会话协议
- **交付物**：多 Agent 会话管理 + 并发操作冲突解决
- **功能**：每 Agent 获得唯一 `agent_id`，操作按时间戳排序，按序执行，绝不并发修改同一状态
- **新增代码量**：~500 行 Python
- **风险**：极高

### P4b：联邦语义树
- **交付物**：`StateSyncProvider` 抽象接口 + WebSocket 广播默认实现
- **功能**：网络层抽象化，初期不引入 IPFS/libp2p。最小权限传播——默认只共享公开面板摘要，敏感面板绝不跨实例传播
- **新增代码量**：~500 行 Python
- **风险**：极高

### P4c：声音/音频交互协议
- **交付物**：概念预留
- **功能**：声音作为输入/输出通道的远期研究方向，当前只做概念占位
- **新增代码量**：待定
- **风险**：极高

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

---

## 八、编码安全专项

- 所有 JSON 文件声明 `"encoding": "utf-8"`
- 所有 Python `open()` 调用显式传入 `encoding="utf-8"`
- 所有 JSON 序列化使用 `ensure_ascii=False`

---

## 九、资源管理专项

- HTTP/WebSocket 连接使用 `contextlib.closing` 自动管理生命周期
- 订阅者模式不设全局列表，订阅生命周期与使用者一致
- 不引入手动心跳、显式 `weakref`、硬编码超时阈值

---

*本文档是 Cellrix 白皮书 v2.4 的执行级补充，随 Phase 推进持续更新。白皮书定义“是什么”和“为什么”，本文档定义“怎么做”和“何时做”。*
