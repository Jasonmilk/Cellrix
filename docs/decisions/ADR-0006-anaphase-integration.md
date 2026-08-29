# ADR-0006：Anaphase 联调架构

**状态**：已采纳
**日期**：2026-08-30
**决策者**：Jasonmilk
**关联**：Anaphase-Helix + Cellrix P3 已完成

---

## 背景

Cellrix P3 已完成 Helix-Mind 联调（语义快照 + 认知工艺展示）。现在进入 P4：Anaphase 联调。

Anaphase 是 Helix 生态的"编排中枢/躯干"，提供：
- 任务 DAG 编排（TaskDag：TaskRoot/SubTask/Leaf）
- 认知状态机（HelixState：Perception/PreAssessment/MemoryRetrieval/Reasoning/ReflexCheck/Execution/Reflection）
- HITL 人在回路（HITLApprover：高风险动作判定 + 人类确认，fail-closed）
- 生命周期管理（Lifecycle：启动/运行/暂停/恢复/终止）
- Agent 循环（AgentLoop：感知-评估-推理-执行-反思）
- 反射机制（Reflex：躯体反射弧）
- 手套（Gloves：外部系统适配）

Anaphase 使用 petgraph 进行 DAG 管理，使用 gRPC 与 FlowModus/Helix-Mind/Tentacle 通信。

## 决策

### 1. 数据结构：AnaphaseState + TaskDagSnapshot + HITLStatus + LifecycleStatus

- **AnaphaseState**: 综合状态（当前认知状态 + 任务 DAG 摘要 + HITL 状态 + 生命周期状态）
- **TaskNode**: 任务节点（id/branch_name/intent/kind/knowledge_ref/created_at/status/progress）
- **TaskDagSnapshot**: 任务 DAG 快照（节点列表 + 边列表 + 根节点 ID）
- **HITLStatus**: HITL 状态（待确认请求数 + 已批准数 + 已拒绝数 + 当前待确认请求）
- **HITLRequest**: HITL 请求（id/command/args/risk_level/status/created_at/resolved_at）
- **LifecycleStatus**: 生命周期状态（phase/uptime/last_heartbeat/error_count）

### 2. UI 组件：TaskDagWidget + HITLWidget + LifecycleWidget + AnaphaseSnapshotWidget

- **TaskDagWidget**: 任务 DAG 可视化（节点列表 + 状态颜色编码 + 进度条 + 依赖关系）
- **HITLWidget**: HITL 状态展示（待确认请求列表 + 风险等级 + 批准/拒绝按钮 + 统计）
- **LifecycleWidget**: 生命周期状态展示（当前阶段 + 运行时间 + 心跳 + 错误统计）
- **AnaphaseSnapshotWidget**: 综合快照组件（组合以上三个）

### 3. 客户端：AnaphaseClient trait + MockAnaphaseClient

- **AnaphaseClient trait**: 定义客户端接口
  - get_state(): 获取综合状态
  - get_task_dag(): 获取任务 DAG 快照
  - get_hitl_status(): 获取 HITL 状态
  - get_hitl_requests(): 获取待确认请求列表
  - approve_request(): 批准请求
  - reject_request(): 拒绝请求
  - get_lifecycle(): 获取生命周期状态
  - health_check(): 健康检查
- **MockAnaphaseClient**: mock 实现（用于测试和开发）

### 4. 与 Anaphase 对齐

- 任务节点类型与 Anaphase 的 TaskNodeKind 一致（TaskRoot/SubTask/Leaf）
- 认知状态与 Anaphase 的 HelixState 一致（7 个状态）
- HITL 高风险判定逻辑与 Anaphase 的 is_high_risk 一致（写操作/网络请求/凭证使用）
- 生命周期阶段与 Anaphase 的 lifecycle.rs 一致

### 5. 可选 feature：grpc

- gRPC 客户端放在可选的 `grpc` feature 中
- 默认不启用，保持 Cellrix 轻量
- 需要连接真实 Anaphase 时启用 `--features grpc`

## 后果

### 正面
- Cellrix 可以消费和展示 Anaphase 的编排状态
- 用户可以观察任务 DAG 的执行进度和依赖关系
- HITL 待确认请求可以在 Cellrix 中直接审批
- 生命周期状态可观测（运行时间/心跳/错误）

### 负面
- gRPC 依赖（tonic/prost）增加编译时间
- 需要维护数据转换逻辑

### 风险
- Anaphase API 可能变化 → 跟随 Anaphase 版本，定期同步

## 参考

- Anaphase-Helix: /Users/jason/Doubao/chats/2026-08-25/anaphase-helix
- Anaphase task_dag.rs: src/task_dag.rs
- Anaphase states.rs: src/states.rs
- Anaphase hitl.rs: src/hitl.rs
- Anaphase lifecycle.rs: src/lifecycle.rs
- Cellrix P3 (Helix-Mind): ADR-0005

---

*ADR-0006 完。*
