# ADR-0007: Tentacle 联调架构决策

**状态**：已采纳
**日期**：2026-08-30
**阶段**：P5
**关联**：P5-T1/T2/T3

## 背景

Tentacle 是 Helix 生态的"手"，负责工具执行和插件管理。Cellrix 需要消费 Tentacle 的工具执行状态、插件审计和工具调用链，以可视化方式展示给用户。

## 决策

### 1. 数据结构设计

在 `cellrix-protocol` 中新增 `tentacle` 模块，包含：

- **ToolExecutionStatus**：工具执行状态枚举（Pending/Running/Completed/Failed/TimedOut/Cancelled）
- **ToolExecution**：工具执行记录（id/tool_name/status/start_time/end_time/duration_ms/result/error/input/output）
- **PluginStatus**：插件状态枚举（Registered/Enabled/Disabled/Error/Uninstalled）
- **PluginInfo**：插件信息（id/name/version/status/permissions/last_used/execution_count/error_count）
- **PluginAuditEntry**：插件审计记录（timestamp/plugin_id/action/target/result/error）
- **ToolCallNode**：工具调用链节点（execution_id/tool_name/status/duration_ms）
- **ToolCallEdge**：工具调用链边（from_execution_id/to_execution_id/relation）
- **ToolCallChain**：工具调用链快照（nodes/edges/root_id/total_duration_ms）
- **TentacleState**：综合状态（active_executions/recent_executions/plugins/audit_entries/call_chain/metrics）

### 2. UI 展示组件

在 `cellrix-ui` 中新增 `tentacle_widget.rs`，包含：

- **ToolExecutionWidget**：工具执行列表（状态标签 + 工具名 + 持续时间 + 进度条 + 错误信息）
- **PluginAuditWidget**：插件审计列表（时间戳 + 插件名 + 动作 + 目标 + 结果）
- **ToolCallChainWidget**：工具调用链可视化（节点列表 + 边关系 + 总耗时）
- **TentacleSnapshotWidget**：综合快照组件（组合以上三个组件）

### 3. 客户端设计

在 `cellrix-transport` 中新增 `tentacle_client.rs`，包含：

- **TentacleClient trait**：客户端接口
  - get_state(): 获取综合状态
  - get_active_executions(): 获取活跃执行列表
  - get_recent_executions(): 获取最近执行记录
  - get_plugins(): 获取插件列表
  - get_plugin_audit(): 获取插件审计记录
  - get_call_chain(): 获取工具调用链
  - cancel_execution(): 取消执行
  - health_check(): 健康检查
- **MockTentacleClient**：mock 实现（用于测试和开发）

### 4. 与 Tentacle 对齐

- 工具执行状态与 Tentacle 的 ToolExecution 一致
- 插件审计与 Tentacle 的 PluginAudit 一致
- 工具调用链与 Tentacle 的 CallChain 一致
- 双模式对接：Mock 实现（当前）+ gRPC/HTTP 实现（可选 feature，未来接入真实 Tentacle）

## 理由

- **白盒可观测**：将 Tentacle 的工具执行过程和插件管理以可视化方式展示
- **极致解耦**：数据结构和客户端只依赖 cellrix-protocol，不依赖 Tentacle crate
- **按需加载**：客户端是惰性的，只有调用方法时才建立连接
- **与 P2/P3/P4 一致**：遵循相同的架构模式（数据结构 + UI 组件 + 客户端）

## 后果

### 正面
- Cellrix 可以展示 Tentacle 的工具执行状态和插件审计
- 用户可以在 Cellrix 中监控工具调用链和执行进度
- 与 P2/P3/P4 形成完整的 Helix 生态可视化

### 负面
- 需要维护 Tentacle 数据结构的兼容性
- Mock 实现需要模拟真实的工具执行行为

## 参考

- ADR-0003: Tuck 对接架构决策
- ADR-0005: Helix-Mind 联调架构决策
- ADR-0006: Anaphase 联调架构决策
