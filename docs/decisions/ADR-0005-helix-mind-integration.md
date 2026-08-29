# ADR-0005：Helix-Mind 联调架构

**状态**：已采纳
**日期**：2026-08-30
**决策者**：Jasonmilk
**关联**：Helix-Mind rs-dev 分支 + Cellrix P2 已完成

---

## 背景

Cellrix P2 已完成 Tuck 对接（审计日志 + 安全事件展示）。现在需要进入 P3：Helix-Mind 联调。

Helix-Mind 是 Helix 生态的"记忆中枢/灵魂"，提供：
- 知识图谱查询（Query/AdvancedQuery/HelixQuery）
- 记忆操作（Remember/Forget）
- 认知工艺（CognitiveMode/ImpasseLevel/StagesAttempted/SuggestedActions）
- 记忆代谢（PhaseState: gas/liquid/crystal, Concentration: dissolved/colloidal, Tension）
- 记忆巩固（HelixConsolidate: digest/crystallize/hibernate）

Helix-Mind 使用 gRPC (tonic) 作为 API，proto 定义在 `crates/helix-mind-api/proto/helix_mind.proto`。

## 决策

### 1. 客户端架构：Trait + gRPC 实现 + Mock 实现

- **HelixMindClient trait**：定义客户端接口（query/remember/forget/helix_query/consolidate）
- **GrpcHelixMindClient**：使用 tonic 的 gRPC 实现
- **MockHelixMindClient**：用于测试和开发的 mock 实现
- **客户端放在 cellrix-transport crate**：保持 cellrix-protocol 的零依赖原则

### 2. 可选 feature：grpc

- gRPC 客户端放在可选的 `grpc` feature 中
- 默认不启用，保持 Cellrix 轻量
- 需要连接真实 Helix-Mind 时启用 `--features grpc`

### 3. UI 组件放在 cellrix-ui crate

- **CognitiveStatusWidget**：认知工艺状态展示（CognitiveMode/ImpasseLevel/StagesAttempted/SuggestedActions）
- **MetabolismStatusWidget**：记忆代谢状态展示（PhaseState/Concentration/Tension/Heat）
- **KnowledgeGraphWidget**：知识图谱可视化（Nodes/Edges，简化的列表视图）
- **HelixSnapshotWidget**：综合快照组件（组合以上三个）

### 4. 数据转换：Helix-Mind Node → Cellrix SemanticNode

- Helix-Mind 的 Node（知识图谱节点）转换为 Cellrix 的 SemanticNode（语义节点）
- 转换规则：
  - Node.content_json → SemanticNode.content
  - Node.node_type → SemanticNode.node_type（映射到 Cellrix 的 NodeType）
  - Node.heat → metrics.heat
  - Node.phase_state → metrics.phase_state
  - 其他元数据（generation/access_count等）→ metrics 字段

### 5. 认知工艺状态映射

Helix-Mind 的 HelixQueryResult 包含：
- effective_mode: SKILLED/ANCHOR/IMAGINATION
- impasse_level: 0-5
- stages_attempted: 尝试的工序数
- suggested_actions: 建议的工具动作
- activation_vector: 激活向量（节点ID + 激活值）
- tokens_consumed: 消耗的 Token 数
- latency_ms: 延迟

Cellrix UI 展示这些字段，让用户能观察 Helix-Mind 的"思考过程"。

## 后果

### 正面
- Cellrix 可以消费和展示 Helix-Mind 的认知状态和记忆代谢
- 用户可以观察 Helix-Mind 的"思考过程"（认知工艺）
- 知识图谱可视化让记忆可观测
- 可选 feature 保持 Cellrix 轻量

### 负面
- gRPC 依赖（tonic/prost）增加编译时间
- 需要维护数据转换逻辑（Helix-Mind Node → Cellrix SemanticNode）

### 风险
- Helix-Mind API 可能变化 → 跟随 Helix-Mind 版本，定期同步
- gRPC 连接可能不稳定 → 实现重连和降级机制

## 替代方案

### 方案 A：直接使用 Helix-Mind 的 proto 生成代码
- 优点：类型安全，自动生成
- 缺点：增加依赖，编译时间长
- 部分采纳：使用 tonic 生成代码，但放在可选 feature 中

### 方案 B：使用 HTTP REST API（如果 Helix-Mind 有）
- 优点：简单，无 gRPC 依赖
- 缺点：Helix-Mind 主要使用 gRPC，HTTP 可能不完整
- 否决：Helix-Mind 的主要 API 是 gRPC

## 参考

- Helix-Mind proto: crates/helix-mind-api/proto/helix_mind.proto
- Helix-Mind API: crates/helix-mind-api/src/
- Cellrix SemanticSnapshot: protocol/src/snapshot.rs
- Cellrix transport: transport/src/

---

*ADR-0005 完。*
