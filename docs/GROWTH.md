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
