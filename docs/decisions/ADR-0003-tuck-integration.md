# ADR-0003：Tuck 对接架构

**状态**：已采纳
**日期**：2026-08-30
**决策者**：Jasonmilk
**关联**：Tuck P0-P7 已完成 + Cellrix P1 已完成

---

## 背景

Cellrix P1 已完成 CI-144 v2.0 对齐（PFP+SAP 解析器）。Tuck P0-P7 已完成（安全闸门 + 审计日志 + 凭证注入）。

现在需要将 Cellrix（皮肤）与 Tuck（免疫）对接，让 Cellrix 能够：
1. 消费 Tuck 的审计日志（SHA-256 链式，防篡改）
2. 展示 Tuck 决策结果（Pass/Reject/HITL/HardOverride）
3. 可视化展示 PFP 物理特征（Risk-Level/Modality/Stance/Proximity-Edge）
4. 安全事件实时通知

## 决策

### 1. 双模式对接：文件读取 + HTTP API 预留

- **当前模式**：直接读取 Tuck 的审计日志文件（JSON Lines 格式）
  - Tuck 目前只有 CLI 模式，没有 HTTP 服务
  - 审计日志文件路径：`/var/log/tuck/audit.log`（可配置）
  - 格式：每行一个 JSON 序列化的 AuditEntry
- **预留模式**：HTTP API 客户端接口
  - 未来 Tuck 实现 HTTP API 后（/audit/query、/health、/metrics），可以直接切换
  - 接口设计与文件读取模式一致，切换时无需修改上层代码

### 2. 审计日志客户端放在 cellrix-protocol crate

- 保持 cellrix-protocol 的零依赖原则（只使用 serde、serde_json）
- 不引入 HTTP 客户端依赖（HTTP 模式放在 cellrix-transport 或独立 crate）
- 文件读取使用标准库 std::fs

### 3. UI 展示组件放在 cellrix-ui crate

- 审计日志列表组件（可滚动、可筛选、可排序）
- PFP 物理特征卡片组件（Risk-Level/Modality/Stance/Proximity-Edge 可视化）
- 安全事件通知组件（Reject 告警/HITL 确认/HardOverride 紧急通知）

### 4. 实时通知使用事件驱动模式

- 审计日志文件监控（inotify/fsevents），新条目到达时触发 UI 更新
- 无轮询，符合"按需驱动"原则
- 高优先级事件（Reject/HardOverride）触发声光告警

## 后果

### 正面
- Cellrix 可以消费和展示 Tuck 的审计日志和安全事件
- PFP 物理特征在 UI 中可视化展示
- 双模式对接（文件+HTTP），未来 Tuck 实现 HTTP API 后可以无缝切换
- 事件驱动，无轮询，符合"按需驱动"原则

### 负面
- 需要维护两套对接模式（文件读取 + HTTP 客户端）
- 文件监控在不同平台上的实现有差异（inotify/fsevents）

### 风险
- Tuck 的审计日志格式可能变化 → 跟随 Tuck 版本，定期同步
- 文件监控在 macOS 上的性能问题 → 使用 kqueue 或轮询降级

## 替代方案

### 方案 A：只实现 HTTP API 客户端，等 Tuck 实现 HTTP 服务
- 优点：代码简洁，只维护一套
- 缺点：Tuck 目前没有 HTTP 服务，无法立即对接
- 否决原因：需要立即对接，不能等 Tuck 实现 HTTP 服务

### 方案 B：在 Tuck 中先实现 HTTP API，再对接
- 优点：架构更清晰
- 缺点：需要先修改 Tuck，增加工作量
- 否决原因：Cellrix P2 的目标是对接，不是修改 Tuck。Tuck 的 HTTP API 可以后续补充

## 参考

- Tuck 审计日志：crates/tuck-core/src/audit.rs
- Tuck WORM 存储：crates/tuck-core/src/audit_store.rs
- Tuck 审计查询：crates/tuck-core/src/audit_query.rs
- Cellrix PFP 解析器：protocol/src/pfp.rs

---

*ADR-0003 完。*
