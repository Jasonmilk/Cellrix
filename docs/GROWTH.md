# Cellrix 生长记录（GROWTH）

> **版本**：v1.1
> **日期**：2026-09-06
> **日期**：2026-08-30
> **所属方法论**：phyt-DNA v1.0
> **性质**：本文件记录 Cellrix 的最近 3 次健康快照。超过 3 条时，最旧的移入 `archive/growth/`。

---

## 健康快照 #10：Web 面板首拉（G2，ADR-0014，2026-09-06）

**变异类型**：浏览器白盒窗口——用户（2026-09-06）"web面板先拉起来,再想优化!"

- 新 crate `cellrix-web`（零依赖 std-only HTTP + 单文件内嵌 HTML + 原生 JS 轮询）
- 同源代理 /api/snapshot → Anaphase /v1/agent/snapshot（规避 CORS，共享 ADR-0010 契约）
- 路由白名单 + 真实状态码（404/502）；端点 --anaphase-endpoint/--port + env（零硬编码）
- 实测全链路：mock reasoning → 真实 Tentacle numbers 执行 → 真实 MET ledger
  （run-8bba24c5ee368a4a#0 三判据全过）→ Web 透传可见
- Cellrix 316 → 319 全绿；React 孤儿组件（HolographicGrid 等）留待优化期

## 健康快照 #11：Engram（印痕）审计面板（2026-09-07）

**变异类型**：全链路审计印痕视图——用户"轨迹改名为 Engram-印痕，因为我们是全链路的审计"；"Cellrix用自己的方式展示面板，二维网格按比例布局，按需加载按需驱动"

- `protocol/src/engram.rs`：真实 `/v1/audit` 链格式（seq/ts/payload/prev_hash/hash，trace_id 派生非 UUID）
- `transport/src/tuck_audit_client.rs`：TuckAuditClient + TuckAuditFetcher trait（Bearer 注入、`#`→reqwest 自动 %23、limit 窗口）
- `ui/src/widgets/engram.rs`：EngramViewState + render_engram 纯函数（概览/时间线/详情三面板比例网格、虚拟列表、本地 trace 过滤）
- `ui/src/app.rs`：attach_engram 轮询 + `state.set_engram`；handler Ctrl+E 切换视图，f/g/↑/↓/Esc
- 物理验证：TCP loopback 端到端（Bearer + %23 + 解析）+ **live 真实网关**（`--ignored live`：链完整性逐条校验 hash==prev_hash）
- 排障记录：std 阻塞 accept 卡死 current_thread runtime（改 tokio::net）；`replace('#','%23')` 双重编码（交 reqwest 自动编码）；header 大小写（hyper 小写化）
- Cellrix 321 → **325** 全绿（`--all-features`，0 failed）；Engram 数据层/状态层纯逻辑，Web 端可同构复用（TUI=Web 单一状态模型）


## 健康快照 #12：WebUI 流式对话根治 + TUI 预聚焦（2026-09-07）

**变异类型**：三处交互根因修复——用户实测 WebUI 发送无回复、TUI 打完字看不到、错误提示位置。

- **WebUI 无回复根因（post_stream 透传 Anaphase 响应头）**：面板字节管道把 Anaphase 的
  `HTTP/1.1 200 OK...` 响应头 + chunked 帧（`19\r\ndata:...`）原样透传——前端 SSE 解析被
  头文本与 chunk 大小行前缀污染，所有事件丢弃 → 无回复。修复：post_stream 升级为完整 HTTP
  中继——剥响应头（面板写自己的头）+ 解码 chunked 传输编码（仅传输层，不解析 SSE 语义），
  浏览器收到干净 `data:` 行。node 浏览器等效测试：18 个 delta + done 行 + 流式累积 == 最终回复。
- **TUI 打字看不到根因（Enter 聚焦被选中按钮拦截）**：Enter 聚焦输入框前先判断
  button_selected——选中 ActionButton 时 Enter 激活按钮而非聚焦。修复：启动即预聚焦
  （chat_focused=true + input_action=Some）——打开就能打字，Tab 仍可移焦。
- **WebUI 错误提示位置 + 时间戳**（学 Cherry Studio/DSH）：错误改居中 toast（系统级提示条，
  不再冒充 Helix 对话气泡）；每条消息带 HH:MM 时间戳。
- transport LogFormat 测试 import 修复（全量 workspace 测试暴露）。
- 测试：+2（prefocused_typing_sends_on_enter / input_fields_start_prefocused）→ 337 全绿。



## 健康快照 #14：chat 输入 = 语义树组件（根治"分层"）（2026-09-07）

**变异类型**：用户再次严肃批评——"你看到没有，上下分层了！`^O Zen` 下面完全是和上面不一样的背景色，操作逻辑也变了！我觉得应该增加一个动态属性的输入框组件！你先把 Cellrix 的哲学与结构搞清楚，否则无法驾驭 Cellrix！"

- **根因链（彻底弄清 Cellrix 内部逻辑后）**：
  1. 上一轮 chat 面板虽从语义树派生数据，但仍是 run_loop 里硬切的 9 行旁路区——背景不同、焦点循环外，即用户看到的"分层"；
  2. 布局引擎的底部槽位默认 active = 槽位第一个节点（status-action），send_message（needs_input）从未被渲染为输入框。
- **修复（agent 驱动，零硬编码）**：
  1. 新增 **InputBoxWidget**（动态属性输入框组件）：ActionButton 声明 needs_input → 渲染为输入面板（对话记录 谁+时间戳+文本 / 输入行 / 发送状态），落在自己网格槽位里——背景、边框、焦点循环与所有语义节点一致；
  2. 布局：needs_input 节点获得更高底部槽位（input_bar_height，配置化）；槽位默认 active 优先 needs_input 节点——agent 要输入框，UI 就给输入框；
  3. AppState 新增 manual_slot_overrides：Tab 手动切换的槽位保留选择，未切换槽位每帧跟随布局默认；
  4. run_loop 恢复纯语义树布局（无旁路切片）。
- **桥的确认**：用户提示"桥文件在 Anaphase 那边"——即 LayoutHints/GridDefinition（snapshot layout_overrides / manifest layout_hints）——Anaphase 声明布局与节点属性，Cellrix 执行。本轮 InputBox 属性（needs_input/placeholder/label）全部来自 Anaphase 声明的节点，Cellrix 不臆造。
- 测试：340 全绿（新增 renderer 隔离测试：needs_input 渲染输入面板而非 "Click to execute"；布局双测试：输入面板 vs 普通按钮高度）。
- pty 实测：打字回显、对话记录（你 20:07 ping / Helix 20:07 pong）、真实回复全链路通。

## 健康快照 #13：chat 面板接回语义树 + 对话记录同构（2026-09-07）

**变异类型**：用户严肃批评——"`enter 发送 Esc 退出` 完全与 Cellrix 内部隔离，你需要了解 Cellrix 的内部逻辑"。

- **根因**：我此前加的预聚焦（input_action=Some("send_message") 硬编码）+ 3 行旁路 chat 框，
  绕过 Cellrix 的语义树驱动渲染（Renderer 按 SemanticSnapshot 节点渲染网格）。
- **修复**：启动只设 pending_chat 标记；首个语义快照到达后，UI 查找 agent 声明的
  needs_input ActionButton（send_message）→ 聚焦它 → 打开其输入面板——action id 与
  标题全部从节点派生，零硬编码。chat 框标题 = 聚焦按钮 label（动态）。
- **对话记录**：TUI 新增 chat_history（谁 + HH:MM + 文本），与 WebUI 消息流同构；
  传输错误留在状态行红字（= WebUI toast 语义），不进对话流。
- **同构契约**：README 新增 TUI↔WebUI 同构说明——同一数据源、同一视图语义、
  错误不进对话流；差异仅限渲染介质（stdio 语义树 vs HTTP+SSE）。
- 测试：chat_typing_records_conversation_and_sends（驱动+Helix 历史断言）→ 337 全绿。
- pty 实测：打字回显（p▌i▌n▌g▌）、对话记录（你 19:42 ping / Helix 19:42 pong）、
  真实回复（Helix: pong）全链路通。

## 健康快照 #8：P6 完成 — 生产就绪（配置/日志/监控/部署）🎉 全部阶段完成

**日期**：2026-08-30
**阶段**：P6 完成（P0-P6 全部完成）
**状态**：🌳 大树成材，Cellrix 项目全部规划阶段已完成

### 关键事件
- 配置管理完成（CellrixConfig + LogConfig + ClientConfig + UiConfig + MetricsConfig + 环境变量解析 + TOML加载 + 17 个测试）
- 日志系统完成（init_logging + LoggingGuard + LogError + tracing可选feature + 9 个测试）
- 健康检查与监控指标完成（HealthChecker + CompositeHealthChecker + MetricsCollector + MemoryMetricsCollector + 19 个测试）
- ADR-0008 创建（生产就绪架构决策）
- 测试覆盖率从 262 个提升到 307 个（增长 17%）
- **P0-P6 全部规划阶段完成！**

### P6 完成内容
| 子任务 | 内容 | 测试数 |
|---|---|---|
| T1 | 配置管理（CellrixConfig + LogConfig + ClientConfig + UiConfig + MetricsConfig + 环境变量解析 + TOML加载） | 17 |
| T2 | 日志系统（init_logging + LoggingGuard + LogError + tracing可选feature + Pretty/Json/Compact格式） | 9 |
| T3 | 健康检查与监控指标（HealthChecker + CompositeHealthChecker + MetricsCollector + MemoryMetricsCollector + Counter/Gauge/Histogram） | 19 |

### 核心特性
- **多层配置**: 默认值 < 配置文件(TOML) < 环境变量 < 代码传入
- **环境变量支持**: CELLRIX_LOG_LEVEL/CELLRIX_LOG_FORMAT/CELLRIX_LOG_FILE/CELLRIX_UI_THEME/CELLRIX_UI_REFRESH_MS/CELLRIX_METRICS_ENABLED/CELLRIX_*_ENDPOINT
- **结构化日志**: 支持 Pretty(开发)/Json(生产)/Compact 三种格式，使用 tracing crate（可选 feature）
- **多组件健康检查**: Tuck/Helix-Mind/Anaphase/Tentacle/Cellrix 五组件健康检查，整体状态自动计算
- **监控指标**: Counter(计数器)/Gauge(仪表盘)/Histogram(直方图) 三种指标类型，内存存储默认实现
- **极致解耦**: 配置/日志/监控都是可选的，使用 feature flag 控制，默认不启用额外依赖
- **按需加载**: 只在需要时初始化，不预先加载
- **确定性优先**: 配置和健康状态有明确的默认值和枚举值

### Cellrix 项目完整里程碑
| 阶段 | 内容 | 测试数 | 状态 |
|---|---|---|---|
| P0 | 方法论初始化 + 现有代码审查 | - | ✅ |
| P1 | CI-144 v2.0 对齐（PFP+SAP） | 52 | ✅ |
| P2 | Tuck 对接（审计日志 + 安全事件展示） | 56 | ✅ |
| P3 | Helix-Mind 联调（语义快照 + 认知工艺） | 44 | ✅ |
| P4 | Anaphase 联调（编排状态 + HITL 交互） | 46 | ✅ |
| P5 | Tentacle 联调（工具执行 + 插件审计） | 60 | ✅ |
| P6 | 生产就绪（配置/日志/监控） | 45 | ✅ |
| **总计** | | **307** | **全部完成** |

### Helix 生态完整接入
- **P2 Tuck**（免疫系统）— 审计日志 + 安全事件
- **P3 Helix-Mind**（记忆中枢）— 语义快照 + 认知工艺
- **P4 Anaphase**（编排中枢）— 任务 DAG + HITL + 生命周期
- **P5 Tentacle**（工具执行）— 工具执行 + 插件审计 + 调用链
- **P6 生产就绪** — 配置 + 日志 + 监控 + 健康检查

### 下一步
- Cellrix 项目已完成所有规划阶段
- 后续可根据实际需求进行功能扩展和优化
- 建议：将 Cellrix 集成到 Helix 生态的实际应用中，验证生产环境可用性

---

## 健康快照 #7：P5 完成 — Tentacle 联调（工具执行状态 + 插件审计展示）

**日期**：2026-08-30
**阶段**：P5 完成
**状态**：🌿 幼苗生长，Tentacle 工具执行中枢已接入

### 关键事件
- Tentacle 数据结构完成（ToolExecution + PluginInfo + PluginAuditEntry + ToolCallChain + TentacleState + 33 个测试）
- Tentacle UI 展示组件完成（ToolExecutionWidget + PluginAuditWidget + ToolCallChainWidget + TentacleSnapshotWidget + 15 个测试）
- Tentacle 客户端完成（TentacleClient trait + MockTentacleClient + 12 个测试）
- ADR-0007 创建（Tentacle 联调架构决策）
- ID 生成改进：时间戳 + 计数器组合，保证进程重启后也不重复（响应高并发/多租户需求）
- 测试覆盖率从 202 个提升到 262 个（增长 30%）

### P5 完成内容
| 子任务 | 内容 | 测试数 |
|---|---|---|
| T1 | Tentacle 数据结构（ToolExecutionStatus 6状态 + ToolExecution + PluginStatus 5状态 + PluginInfo + PluginAuditAction 9动作 + PluginAuditEntry + ToolCallNode/Edge/Chain + TentacleMetrics + TentacleState） | 33 |
| T2 | Tentacle UI 展示组件（ToolExecutionWidget + PluginAuditWidget + ToolCallChainWidget + TentacleSnapshotWidget） | 15 |
| T3 | Tentacle 客户端（TentacleClient trait + MockTentacleClient + get_state/get_active_executions/get_recent_executions/get_plugins/get_plugin_audit/get_call_chain/cancel_execution/health_check） | 12 |

### 与 Tentacle 对齐
- 工具执行状态与 Tentacle 的 ToolExecution 一致（6 状态：Pending/Running/Completed/Failed/TimedOut/Cancelled）
- 插件管理与 Tentacle 的 Plugin 一致（5 状态：Registered/Enabled/Disabled/Error/Uninstalled）
- 插件审计与 Tentacle 的 PluginAudit 一致（9 动作：Register/Enable/Disable/Uninstall/Execute/PermissionRequest/PermissionGrant/PermissionDeny/Error）
- 工具调用链与 Tentacle 的 CallChain 一致（4 关系：DependsOn/Triggers/Parallel/ParentOf）
- 双模式对接：Mock 实现（当前）+ gRPC/HTTP 实现（可选 feature，未来接入真实 Tentacle）

### 核心特性
- **白盒可观测**: 将 Tentacle 的工具执行过程和插件管理以可视化方式展示
- **极致解耦**: 数据结构和客户端只依赖 cellrix-protocol，不依赖 Tentacle crate
- **按需加载**: 客户端是惰性的，只有调用方法时才建立连接
- **工具调用链可视化**: 节点 + 边关系，支持依赖/触发/并行/父子关系
- **颜色编码体系**: 覆盖 ToolExecutionStatus(6种)/PluginStatus(5种)/PluginAuditAction(9种)/ToolCallRelation(4种)
- **ID 生成改进**: 时间戳(秒) + 计数器组合，保证进程重启后也不重复，高并发安全，多租户可扩展

### Helix 生态完整接入
- P2: Tuck（免疫系统）— 审计日志 + 安全事件
- P3: Helix-Mind（记忆中枢）— 语义快照 + 认知工艺
- P4: Anaphase（编排中枢）— 任务 DAG + HITL + 生命周期
- P5: Tentacle（工具执行）— 工具执行 + 插件审计 + 调用链
- **Helix 四大组件全部接入 Cellrix 展示层**

### 下一步
- P6：生产就绪（配置/日志/监控/部署）
- 配置管理（环境变量/配置文件/命令行参数）
- 日志系统（结构化日志/日志轮转/日志级别）
- 监控指标（Prometheus metrics/健康检查/性能指标）

---

## 健康快照 #9：候选 G 完成 — Anaphase 驾驶舱（白盒驾驶舱）✅
**变异类型**：展示器 → 驾驶舱（真实 Anaphase 状态投影）
**关键决策与发现**：
1. **正名**：Anaphase 驾驶舱（非 Helix 驾驶舱）——监控意识层；Helix-Mind 灵魂本体不驾驶
2. **双端策略（ADR-0009 D1）**：snapshot HTTP JSON 唯一数据协议，TUI/Web 共享；TUI 先行（307 资产），Web 面板（G2）后续
3. **协议契约 = serde 形状**：`AgentSnapshot`/`LedgerEntry`/`InteractionMode`（snake_case）/`VerdictStatus`（UPPERCASE）/ledger tag=`record_type`；未知字段忽略（容忍演进）
4. **一次拉全**：`AnaphaseClient::get_snapshot()` 聚合（每 tick 1 次 HTTP）；`attach_cockpit` 按需挂载
5. **CockpitWidget**：模式栏（DRIVE/PARTNER/SURVIVE）+ 认知状态 + 经历时间线（ep- 锚点/步数）+ Ledger 审查视图（MET/UNMET/BLOCKED + trace/retry/parent）；renderer 摘要条（legend 上方）
6. **live 验证**：真实 Anaphase（cap_http 50061）↔ HttpAnaphaseClient 真实 roundtrip 解析成功（anaphase_live.rs #[ignore]）；serde 契约不一致（mode PascalCase vs snake_case）由 live 抓到并修正——物理事实优先
**状态**：✅ 完成（316 tests：307 + 9；cli: `run --mode stdio --exec <agent> --anaphase-endpoint http://127.0.0.1:50061`）
**物理验证（2026-09-06 实测）**：数据链路全真跑通——mock reasoning → 真实 Tentacle（--plugins-dir ./fixtures，numbers 真实执行）→ 真实 MET ledger（check_reports 三判据全过，evidence run-8bba24c5ee368a4a#0）→ /v1/agent/snapshot 真实返回。**发现存量缺口**：StdioTransport 读 Manifest 超时 / UdsTransport decode 失败（transport 无真实集成测试），TUI 渲染被挡 → G-3
**G-3 修复（同日，ADR-0010）**：根因 = mock-agent 字节序（BE）与 transport stdio（LE）错位 + UDS 首帧包装错位 + rmp enum 编码不对称。修复 = mock-agent 参数化 Endian（stdio=LE/uds=BE）+ map-form rmp + UDS 裸 Manifest。**驾驶舱 TUI 双通道实测渲染通过**：`[PARTNER] state=Perception episode: no active episode` + `MET run-8bba24c5ee368a4a (trace=run-8bba24c5ee368a4a)`——真实 ledger 白盒投影成立。316 tests 全绿无回归。

## 记录：CI-144 stdio 闭环——真实 Anaphase 全链路（2026-09-06，ADR-0017 跨仓库）
**变异类型**：接口契约归位——驾驶舱对真实意识层闭环（Anaphase 侧 ADR-0017 传输层 + Cellrix 侧消费端补齐）
**背景**：Anaphase 已实现 CI-144 传输层（vendored 协议 + 握手 + MessagePack 帧 + 1s 快照推流 + Action 响应）。
Cellrix 侧实测发现两个缺口：①`--exec` 启动约定追加 `--mode stdio`，Anaphase 只认 `--stdio`；
②`StdioTransport::send_action` 未实现（"Not implemented"）——写侧是洞。
**关键决策**：
1. **Anaphase 兼容生态启动约定**：main.rs 同时接受 `--stdio` 与 `--mode stdio`（Cellrix 对每个
   stdio agent 说同一套启动参数——一个启动契约，人人会说）
2. **send_action 落地 + 单 reader 分发**：background reader 独占 stdout，用 untagged `Incoming`
   enum 把 AgentEvent 路由到事件流、ActionResponse 路由到专用响应通道——无帧竞争、无二 reader
   （确定性）；send_action 写请求 → 等响应通道（5s 超时）
3. **live 测试资产**：`transport/tests/ci144_anaphase_live.rs`（#[ignore]，ANAPHASE_BIN env 指向
   真实二进制）：handshake → Manifest → 快照推流 → status/send_message/unknown 三动作全闭环
**物理验证（2026-09-06 实测，真实二进制）**：
- `cellrix-cli manifest --mode stdio --exec anaphase --stdio` → CapabilityManifest{anaphase-helix} ✅
- `cellrix-cli snapshot ...` → Status: partner + 布局引擎消费 3 节点（state_tree/text_panel/metrics）✅
- `cellrix-cli action ... --action-id status` → Success{mode=Partner state=Perception...} ✅
- `cellrix-cli action ... --action-id send_message` → Success{真实 run_cycle 输出} ✅
**状态**：✅ 完成（319 tests 全绿保持 + 1 live #[ignore] 新增）
## 记录 29：驾驶舱对话——文本输入 + Helix 真实回复（2026-09-06）

### 触发条件
用户配好 LLM 后驾驶舱无输入框：UI 只渲染 ActionButton（空参数触发），Anaphase 投影无 action 节点、manifest 只暴露 status。驾驶舱无法对话。

### 变更性质
- **Anaphase（协议侧）**：manifest 暴露 `send_message`（声明参数 `message: string`）；snapshot 投影 semantic_tree 增加 ActionButton 节点（`send_message` 带 `needs_input: true` 声明、`status`）——UI 零 manifest 知识即可渲染输入（声明式协议扩展）
- **Cellrix（UI 侧）**：AppState 增加 `input_action/input_buffer/last_response`；Enter 触发 `needs_input` action → 文本输入模式（字符/退格/Enter 发送/Esc 取消）；回复渲染在输入行；输入行动态布局（激活时 1 行）
- **Anaphase（装配修复）**：`ANAPHASE_CONFIG` env 覆盖 config 路径——驾驶舱子进程从任意 cwd 加载同一 config（此前相对路径 → Cellrix 目录下 Noop 无 LLM）
- **真实对话验证**：`send_message` 帧 → run_cycle → deepseek API 真实调用 → 回复 "我是 DeepSeek 的 AI 助手..."（非 mock 非 Noop）
- **测试**：Cellrix 319→321（输入字段生命周期 2 测试）；Anaphase 206 不变；全生态 1420

### 兼容性
零破坏：needs_input 是声明式扩展（无该字段的 action 行为不变）；ANAPHASE_CONFIG 可选（默认相对路径保持 repo 行为）。

### 验收
README（输入 + 321）｜ GROWTH｜ ECOSYSTEM v1.56

### 状态
🧬 已完成
## 记录 30：输入可发现与反馈——常驻输入框 + WebUI 连接诚实化（2026-09-06）

### 触发条件
用户反馈：①驾驶舱 WebUI 一直显示"连接中…"；②TUI 不知道怎么输入、输入方式奇怪、输入没有单独的框、发送成功与否没有反馈。

### 变更性质
- **TUI 常驻输入框（3 行固定）**：底部始终可见的独立带框输入区（标题行 + 输入行 + 状态行）——不再是隐藏的动态行。标题提示"按 Enter 开始输入"；聚焦后直接打字，Enter 发送、Esc 退出（草稿保留）
- **全局 Enter 聚焦**：任意位置（无 ActionButton 选中时）按 Enter 即打开输入框——无需先找到 Send message 按钮
- **发送反馈**：状态行三态——绿色 ✓ 成功 + 回复内容 / 红色 ✗ 失败 + 原因 / 蓝色 Helix 回复；发送后保持聚焦（连续对话）
- **修复反馈不可见的真 bug**：旧实现发送后 input_area 高度 0（回复行被裁掉）——用户永远看不到结果
- **WebUI 连接诚实化**：代理 502/非 200 时明确显示"Anaphase 未提供快照 + 原因"，不再永远停留在"连接中…"（根因：!snap 分支更新了 mode 却没更新 sub 标题）
- **真实对话验证**：up 全栈 → send_message 帧 → deepseek API → 完整多行回复（"我是 DeepSeek 最新版模型…"）
- **测试**：cellrix-ui 90 passed 不变

### 兼容性
零破坏：needs_input 声明式协议不变；按钮 Enter 激活路径保留；web 无新依赖。

### 验收
README（输入框交互）｜ GROWTH｜ ECOSYSTEM v1.57

### 状态
🧬 已完成

## 记录 31：Web 同构映射——Engram 印痕上 Web（2026-09-07）

### 触发条件
Engram TUI 面板落地后，用户拍板顺序 ②：Web 同构映射（DSH 风格参考，TUI=Web 单一状态模型——"同一个真相的两个投影，硅基/碳基都可参看，无歧义"）。

### 变更性质
- **cellrix-web 双视图**：Cockpit（Anaphase snapshot）/ Engram（Tuck /v1/audit 链）——顶栏按钮切换，镜像 TUI 的 Ctrl+E
- **/api/audit Bearer 代理**：`--tuck-endpoint/--tuck-key/--tuck-limit`（default 200，CLI 契约）+ env（TUCK_*）；身份凭证只留在 server 侧，浏览器永远拿不到
- **同构数据模型**：proxy 透传 Tuck EngramQuery（entries[]: seq/ts/payload{kind,trace_id,data}/prev_hash/hash）——与 TUI TuckAuditFetcher 解析同一响应、同一字段语义
- **Engram 面板**：overview 条（链游标/count/queried_by/错误）+ 比例网格 timeline 2fr / detail 1fr；点击行 → 完整印痕（caller/destination/status/verdicts/prev_hash/hash + 原始 payload JSON）；trace_id 过滤框（Enter 应用/Esc 清）；窄屏单列降级
- **测试**：web 3→5（audit route/config 派生/tuck 未配置/index 双视图字段），Cellrix 325→**327** 全绿
- **真实验证**：cellrix-web 起 8099 → /api/audit 拉真链 count 6、SHA-256 64 位、trace_id join 就位；内嵌 JS `node --check` 语法通过

### 验收
README（§7.3 Web projection）｜ PLAN 当前阶段｜ ECOSYSTEM v1.61（Cellrix 325→327）

### 状态
🧬 已完成（下一步：Web 优化——DSH 风格深化轨迹回放）

## 记录 32：Engram 全文回放——正文上 Web（2026-09-07）

### 触发条件
顺序② Web 同构落地后，用户拍板①（Engram 最后一公里）：点审计条目能看到该轮思考正文。

### 变更性质
- **web `/api/trace` 代理**：透传 `trace_id` query → Anaphase `/v1/trace`（正文在 Anaphase 侧，写入时已脱敏——凭证不经过本条路径）
- **detail 面板"正文回放"区**：点击时间线行 → 异步拉该轮 prompt/response（ts/model 标注）；未配置 trace path / 无正文 → 明确空态（引导 README 配置）
- **测试**：route +1（/api/trace），Cellrix 327 不变
- **真实验证**：cellrix-web → /api/trace?trace_id=run-a430d84680aabd0b → 真实 "hello"→"Hello! How can I help you today?"（全链路物理成立）

### 验收
README（§7.3 full-text replay）｜ GROWTH｜ ECOSYSTEM v1.62

### 状态
🧬 已完成

## 记录 33：Web 时间线按轮分组（2026-09-07）

### 触发条件
顺序② Web 深化（DSH 风格）第一刀：审计时间线散行（request/response 各自一行）读起来像流水账——按 trace_id 合成"一轮"。

### 变更性质
- **renderAudit 分组**：同 trace_id 的条目聚合为一组（组 = 一轮：request+response+重试），组内保持链顺序（request→response）；最新组在上
- **组头**：trace_id + 条目数 + 时间范围；点击折叠/展开（▾/▸）
- **CSS**：grp-head/grp-body（组头浅高亮、行缩进 22px）
- **测试**：web 5 不变；内嵌 JS `node --check` 通过；真实页面分组渲染就位（grp-head/Group by trace_id 字段验证）

### 验收
GROWTH｜ ECOSYSTEM v1.63（数字不变，Cellrix 327）

### 状态
🧬 已完成（下一刀：正文 [REDACTED] 高亮 / 轮动效）

## 记录 34：正文 [REDACTED] 高亮（2026-09-07）

### 触发条件
顺序② 第二刀：正文回放里抹除的凭证不可见也不可知——白盒要"看见抹除"。

### 变更性质
- **hl()**：esc 后把 `[REDACTED]` 包成 `<span class="redact">`——揭示"这里抹掉了一个凭证"与位置，不揭示内容
- **CSS .redact**：警告红 + 浅底（抹除=敏感语义）
- **设计澄清（非 diff）**：脱敏在写入侧——原文从未进入 trace 文件，不存在两版可比；diff 会把原文副本留进审计链（敏感数据湖），违背零信任
- **验证**：node 单元（span 包裹 ✓ / 普通文本转义 ✓）；web 5 全绿；Cellrix 327 全绿

### 验收
GROWTH｜ PLAN

### 状态
🧬 已完成（下一刀：轮动效 / 或切 ③ up 一键 web）

## 记录 35：up 自检——生态级看表 SSOT（2026-09-07）

### 触发条件
用户拍板 ③ up 一键 web（学习 WorkBuddy/DSH 易用性）；并提醒"自检+实时状态 = Helix-Mind 按需看表，可极致复用"。

### 变更性质
- **Anaphase `/v1/health` 自检端点**（src/health.rs）：config 派生 + 物理探测（trace/ledger 父目录可写、六端点 TCP 可达、judge 后端、cap_http、凭证存在性——值永不报告）；空字符串 = 未配置不评判；聚合 ok = 所有 configured 项健康
- **探测确定性修法**：`connect_timeout` 在 macOS 对 loopback 偶发 1.7s 假失败（已实测复现）→ 子线程同步 connect + 主线程 2s 超时（无轮询 bug）
- **Cellrix web 探头升级**：probe `/v1/health`（打印 self-check ok / 失败项名单），tuck `/v1/audit` 照旧；`--open` flag（监听就绪后自动开浏览器）
- **复用点（用户提示）**：同一 `/v1/health` + `/v1/agent/snapshot` 服务三类消费者——Cellrix 面板（碳基/硅基同看）、Helix-Mind 按需看表（决策前才拉，不时刻轮询）、运维 curl——单一权威来源，无第二份状态副本（极致复用/按需驱动）
- **测试**：Anaphase 212→**216**（health 4）；Cellrix web 5→**7**（unhealthy_names 2）→ Cellrix 329
- **真实验证**：`/v1/health` → ok:true（trace 可写/reasoning 可达/空串不评判）；web 启动 banner → `anaphase: ✅ self-check ok / tuck: ✅ audit chain reachable`

### 验收
README（Self-check 节 + --open）｜ GROWTH｜ ECOSYSTEM v1.64（Anaphase 216 / Cellrix 329 / 全生态 1496）

### 状态
🧬 已完成

## 记录 36：up 一键——三件套拉起（2026-09-07）

### 触发条件
用户拍板 ③ 完整化（WorkBuddy/DSH 式易用性）：一个命令起 Anaphase + Tuck + web，之后零命令。

### 变更性质
- **web/src/lib.rs 抽取**：fetch_json/probe/unhealthy_names 从 main.rs 移入共享 lib（up 与面板复用，极致复用；std-only）
- **`up` bin**（web package 第二个 bin）：ensure() 流程——probe 健康 → ✅ 已就绪；down + `--anaphase-cmd/--tuck-cmd`（或 UP_*_CMD env）→ spawn（detached）+ 轮询健康（--wait 默认 30s/500ms 间隔）；down + 无 cmd → **明确引导不静默跳过**（物理事实优先）
- **web 路径确定性派生**：CARGO_BIN_EXE（cargo 环境）→ 回退 current_exe 兄弟（同 build 目录）——无硬编码路径（0 硬编码）
- **解耦边界**：up 不持有 Anaphase/Tuck 的配置（config.toml/key）——启动命令由调用方提供，Cellrix 只编排不猜
- **测试**：lib 4（probe ok/refused + unhealthy_names 2）+ main 5 → web 7→**9**，Cellrix 329→**331**
- **真实验证**：anaphase(50123)+tuck(60052) 健康 → up → `anaphase: ✅ already healthy / tuck: ✅ already healthy / panel launched` + web 真实服务（DOCTYPE）

### 验收
README（§up 一节）｜ GROWTH｜ ECOSYSTEM v1.65（Cellrix 331）

### 状态
🧬 已完成

## 记录 37：up 引导模式——小白一路回车（2026-09-07）

### 触发条件
用户审查：小白能否被正确引导，不打命令，最多选择加回车。

### 变更性质
- **交互引导**：`up` 无参数运行 → 探测 Anaphase/Tuck → 选择题（[1] 启动 [2] 跳过，回车=推荐默认）；全程回车可走通
- **配置持久化**：`$HOME/.cellrix/up.toml`（0600）——首次运行输入一次启动命令即保存；之后每次运行从配置自动启动，**零输入**
- **来源链**：flags > env > up.toml > 协议默认（0 硬编码；配置文件是约定位置非硬编码路径）
- **凭证卫生**：tuck_key 只进 0600 用户配置（不进 git、不回声）；测试用临时 HOME 不污染真实配置
- **不静默跳过**：无保存命令且 down → 明确引导输入命令或跳过；跳过则面板诚实显示 ❌
- **测试**：config round-trip（含 0600 校验）+ merge → up 测试 0→2，Cellrix 329→**333**
- **真实验证**：场景 A（全健康，回车直达浏览器 ✅）；场景 B（首次输入命令→保存 0600；第二次运行仅回车→自动启动→✅→web 服务）

### 验收
README §up（引导流程）｜ GROWTH｜ ECOSYSTEM v1.66（Cellrix 333）

### 状态
🧬 已完成

## 记录 38：1对1 身份绑定——Anaphase 发起（2026-09-07）

### 触发条件
用户拍板：绑定由 Anaphase 发起（意识层自我认知动作，界面层只转达人类在场证明）。

### 变更性质（Anaphase）
- **src/bind.rs**：配对码（6 位，一次性 10 分钟）→ 人类确认（HITL）→ device_id + secret（32hex）→ 落盘 `~/.cellrix/anaphase-identity.json`（0600）
- **验证四关**：device_id 已知 + ts 窗口 ±60s + nonce 一次性（有界 seen 集，v2 换 Bloom）+ HMAC（手写 RFC2104，复用已有 sha2，零新 crypto 依赖）
- **cap_http 门禁**：绑定后除 /v1/bind/* + /v1/health 全端点验 Bearer；未绑定 = 开放（诚实 not bound，按需驱动）
- **API**：POST /v1/bind/start / confirm + GET /v1/bind/status
- **测试**：+6（RFC2202 向量、round-trip、重放拒绝、坏 HMAC、错码、持久化 0600），Anaphase 219→**225**
- **真实验证**：未绑定 status → start → confirm → 无 auth 401 → 签名 200 → **重放 401** → health 保持 200 → 0600

### 变更性质（Cellrix web）
- **lib.rs**：client identity 读取（~/.cellrix/identity.toml）+ sign_bearer（HMAC，nonce=纳秒+pid 每请求唯一）+ post_json + extract_json_str（无 serde，极致节能）+3 测试
- **main.rs**：Anaphase 三处 fetch 全部带 client_bearer()（绑定后面板仍可用）
- **up**：绑定引导选择题（Anaphase 发起、up 只转达）→ 显示配对码 → 回车 → 落盘客户端 identity.toml（0600）
- **测试**：web 11→**14**，Cellrix 333→**336**
- **真实验证**：up 引导全闭环（选择题→配对码 863954→回车→✅ anaphase#912e...→双 0600→面板签名访问服务正常）

### 验收
README（bind 节）｜ GROWTH｜ ECOSYSTEM v1.68（Anaphase 225 / Cellrix 336）

### 状态
🧬 已完成

## 记录 39：面板对话视图 + up 默认探测 Tuck（2026-09-07）

### 触发条件
小白全流程实测两缺口：①面板无输入框无法对话；②无参数 up 不探测 Tuck（engram off，fail-closed 盲区）。

### 变更性质
- **面板第三视图「对话 Chat」**：消息流 + 输入框（回车发送/Esc 清除）+ /api/chat 代理 → Anaphase /v1/chat（绑定后签名）
- **Anaphase /v1/chat**（同仓库）：POST {message} → gate_ok → build_agent → 单周期 run_cycle → {reply}
- **up Tuck 协议默认**：无参数也探测/启动 Tuck（60052 + tk-local-gate，来源 = Tuck 协议），面板 engram 始终接线
- **真实验证**：首跑（命令一次→绑定→面板）；二次零输入直达；Tuck ✅ + engram 25 条审计；对话 200 真实 LLM 回复 ×2

### 状态
🧬 已完成

## 记录 40：消除 up 重名歧义（2026-09-07）

### 触发条件
用户实测 `cargo run --bin up` 报错：cellrix-cli 与 cellrix-web 两个包各有 `up` bin。

### 变更性质
- 删除 `cli/src/bin/up.rs`（旧转发入口，34 行，转发到不存在的 anaphase-helix/target/debug/up——本就是断的）
- 唯一保留 `cellrix-web` 的完整引导器 up（首跑引导/绑定/面板）
- 验证：`cargo run --bin up` 唯一解析，直达引导器

### 状态
🧬 已完成

## 记录 41：up 幂等启动——面板已在运行则直达（2026-09-07）

### 触发条件
用户重复运行 `cargo run --bin up`（面板已在 8080 跑着）→ AddrInUse 崩溃退出。

### 变更性质
- **panel_already_up(port)**：探测 8080 是否已在服务我们的面板（GET / 查 `view-chat` 标记，诚实区分"我们的面板"vs"外部程序占用"）
- 启动前探测：已在 → 打开浏览器 + "面板已在运行（无需重复启动）" → 正常退出，不叠监听
- bind 失败竞态兜底：再探测一次，是面板 → 直达；不是 → 诚实报错
- 测试 +1（自家面板识别/外部 404 忽略/无监听 false），Cellrix 336→**337**

### 状态
🧬 已完成

## 记录 42：WebUI 状态行修复 + up 界面选择权 + TUI 全链路打通（2026-09-07）

### 触发条件
①用户反馈 WebUI 标题下永远"连接中…"（与绿点在线矛盾），随后报 `TypeError: Cannot read properties of undefined (reading 'toUpperCase')`；②用户要求不强制跳 WebUI，给 TUI 选择权。

### 变更性质
- **sub JS 修复**：成功分支的诚实状态行引用了未声明的 `m`（在 `var m` 前执行）→ TypeError → catch 显示"拉取失败"。移到 `var m` 之后；成功后显示「Anaphase 在线 · PARTNER · 暂无经历」
- **up 界面选择权**：`[1] Web 面板（回车=1） [2] TUI 终端`——回车默认 Web（小白承诺不变），选 2 起 TUI
- **TUI 全链路**：cellrix-cli stdio 模式 + Anaphase 新增 `--config <path>` flag（flags > env > 默认，DNA 11）——TUI 子进程注入同一 config；stdio 模式不开 cap_http（无端口冲突）；握手 + Manifest + 全栈装配验证通过
- **workspace_root 修正**：up 在 Cellrix/web → 工作区根需两级 parent（曾算出 Cellrix/anaphase-helix 错误路径）
- 验证：无头 Chrome sub=「在线 · PARTNER」无 TypeError；TUI Spawning 路径正确

### 状态
🧬 已完成


## 记录 43：WebUI 无法点击根因修复（IIFE 闭包）+ TUI 空消息防护（2026-09-07）

### 触发条件
用户实测：WebUI 与 TUI 均"无法操作，只能 Tab，回车/鼠标无响应"。

### 根因（CDP 实证）
- **Web**：页面 script 是 IIFE（`(function(){...})()`），`showView`/`sendChat`/`applyFilter`/`clearFilter` 全部在闭包内，**不挂 window**。内联 `onclick="showView(...)"` 在全局作用域解析 → `ReferenceError: showView is not defined` → 点击无声失败。此前诊断只 grep 了源码文本（"函数已定义"），未查运行时作用域——CDP `Runtime.evaluate` 打出 `undefined|undefined|undefined` 才实证。
- **修复**：IIFE 末尾显式 `window.showView = showView; ...` 导出 4 个交互入口。
- **验证**：CDP `Input.dispatchMouseEvent` 硬件管道真实点击 v-chat → `chatVisible: true` 视图切换；Tab 聚焦 BUTTON；Enter 正常。
- **TUI**：键盘流正常（Tab 有响应）；Enter 语义 = 聚焦输入框（非直接发送），空消息会发空请求——加空消息防护（保持聚焦 + 提示）。
- **显示差异**：TUI stdio 自带独立 Anaphase 子进程（对话数据源独立），cockpit 看板与 Web 同轮询 daemon 50061——架构事实，非 bug。

### 状态
🧬 已完成

## 记录 44：TUI 日志门控（CELLRIX_DEBUG）+ 空消息防护（2026-09-07）

### 触发条件
TUI 启动时 DEBUG 日志（Spawning child/Handshake/First event）混入终端界面，与 TUI 画面互相污染。

### 修复
- transport stdio 全部 DEBUG eprintln 加 `CELLRIX_DEBUG` 环境变量门控，默认静默（`CELLRIX_DEBUG=1` 才输出）
- 空消息防护：chat 输入框聚焦后空回车不发空请求（保持聚焦 + 提示），已在记录 43 合并

### 验证
- 默认启动：无 DEBUG 行；`CELLRIX_DEBUG=1`：完整日志
- Cellrix 337 全绿

### 状态
🧬 已完成

---
## 记录 45：面板 SSE 字节管道 + 前端打字机 2026-09-07
### 背景
WebUI 偶发 EAGAIN 的真根因是**旧进程残留**（18:20 面板 + 18:32 anaphase 未被 pkill 杀掉，新二进制端口占用启动失败）。强杀后 SSE 全链路打通。
### 变更
- `web/src/lib.rs`：抽 `post_open`（请求构建复用，极致复用）+ 新增 `post_stream`——**字节管道**（不解析 SSE 帧，只透传，极致解耦）；`Accept: text/event-stream` 仅在流式路径发出
- `web/src/main.rs` Route::Chat：浏览器请求含 `Accept: text/event-stream` → 手写流式响应头（无 Content-Length）+ 逐 chunk 透传；错误写为 SSE error 行（浏览器可见，不静默挂起）；JSON 路径保留
- 前端 `sendChat`：fetch ReadableStream + SSE 事件解析（`delta` 增量打字机 / `done` 收尾 / `error` 展示）；按钮禁用期间防重入
### 验证
- curl 面板 SSE：chunked + 逐 delta 流式（"你好"→"，"→"我是"…）✓
- 5 连发全成功
- Cellrix 337 全绿

### 状态
🧬 已完成

## [2026-09-07] Engram 全链路 join 打通 + UI 增强

### 变更性质
- **trace_id 对齐**：Anaphase 推理经 `x-tuck-trace` 头传 derive_job_id（run-xxx）→ Tuck 审计链记录同一 id（缺头回退 live#N）→ 审计链、正文 trace、ledger 三者共用一键
- **正文 trace 开启**：Anaphase config `reasoning_trace_path`（.helix/traces/reasoning.jsonl，redacted + 4096 截断）——Engram 详情"正文回放"展示 prompt/response/model/ts
- **UI 增强**：分组头加组内耗时（RFC3339 差）；最新一组默认展开（DSH 轨迹式）；其余组折叠
- 物理实测：`run-8e2615...` 审计 + 正文回放（configured:True，prompt 2071 chars / response 完整）

### 验收
- curl 全链：/api/chat → 审计 trace_id=run-xxx → /api/trace?trace_id=run-xxx 返回正文 ✓
- Cellrix cargo test 全绿；cellrix-web 重启后 self-check ok

### 待办
- 状态流转（perception→reasoning→execution→reflection）入 Engram 时间线（现链只含 request/response 网关条目）
