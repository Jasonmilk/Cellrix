# ADR-0004：CPPC v1.1.0 作为 Cellrix v2.0 北极星愿景

**状态**：已采纳
**日期**：2026-08-30
**决策者**：Jasonmilk
**关联**：docs/vision/cppc-v1.1.0.md

---

## 背景

Cellrix 当前实现（P0-P1）基于 SemanticSnapshot + SSE + Web UI，是"语义投影终端"的基础实现。

随着 Helix 生态的发展（CI-144 v2.0 协议家族、Tuck 安全闸门、PFP 物理特征），Cellrix 需要一个更宏大的愿景来指导未来发展。

《Cellrix 物理协议宪章（CPPC）》提出了"双宇宙架构"（逻辑宇宙 + 物理宇宙）、"三大物理法则"（纯符号契约 + 逻辑态确定性 + 物理层主权）、"补丁代数"（TAKE/PLACE 幂等操作）等核心思想，将 Cellrix 从"语义快照渲染器"升级为"物理协议宪章"。

## 决策

### 1. CPPC v1.1.0 定位为 Cellrix v2.0 北极星愿景

- CPPC 是**愿景文档**，不是立即实现规范
- 当前 P2-P6 继续按原计划进行（Tuck 对接 → Helix-Mind 联调 → Anaphase 联调 → Tentacle 联调 → 生产就绪）
- CPPC 的核心思想（双宇宙、补丁代数、物理降级）在 P3+ 逐步引入

### 2. v1.1.0 修订解决了 4 个关键问题

| 问题 | v1.0 状态 | v1.1.0 解决方案 |
|---|---|---|
| 逻辑/物理状态分离 | ⚠️ 法则 II 与法则 III 矛盾 | ✅ 法则 II 改为"逻辑态确定性"，明确不包含物理输出 |
| MOVE 幂等性 | ⚠️ MOVE 多次执行结果不确定 | ✅ 废除 MOVE，引入 TAKE + PLACE，明确幂等性 |
| 符号字典边界 | ⚠️ 6 个符号不够完整 | ✅ 12 个核心保留字，视觉属性归入 display 映射表 |
| 全量/增量关系 | ⚠️ 与 SemanticSnapshot 关系未定义 | ✅ 新增第五章"全量-增量双轨制" |

### 3. 分阶段落地路线

| 阶段 | 内容 | 对应 Cellrix 阶段 |
|---|---|---|
| Phase 1（当前） | SemanticSnapshot + SSE + Web UI | P0-P1 已完成 |
| Phase 2（进行中） | Tuck 对接 + PFP 物理特征展示 | P2（当前） |
| Phase 3 | 补丁代数（MUTATE）+ 增量更新 | P3-P4 |
| Phase 4 | 双宇宙架构 + 物理降级 + 原生渲染器 | P5+ |

## 后果

### 正面
- Cellrix 有了明确的 v2.0 愿景，未来发展有方向指导
- CPPC 的核心思想（双宇宙、补丁代数、物理降级）与 Helix 生态哲学一致
- 分阶段落地，不阻塞当前 P2 工作

### 负面
- CPPC 范围较大，完整实现需要多个阶段
- 补丁代数（TAKE/PLACE）的实现复杂度较高
- 原生渲染器（Kotlin/Swift）需要额外开发资源

### 风险
- 愿景与实现的差距可能导致"愿景漂移"
- 缓解：每个阶段结束时对照 CPPC 检查，确保方向一致

## 替代方案

### 方案 A：不采纳 CPPC，继续按原计划
- 优点：简单，不需要愿景文档
- 缺点：缺乏长期方向指导，可能导致"技术债"累积
- 否决原因：Cellrix 需要一个宏大愿景来指导未来发展

### 方案 B：立即全面实现 CPPC
- 优点：一步到位
- 缺点：范围过大，当前 P2 工作会被阻塞
- 否决原因：CPPC 是愿景，不是立即实现规范

## 参考

- CPPC v1.1.0 完整文档：docs/vision/cppc-v1.1.0.md
- Cellrix 当前实现：protocol/src/snapshot.rs、transport/src/、ui/src/
- CI-144 v2.0 协议家族：CommonIntents/BIND-19 (v2.0-alpha 分支)

---

*ADR-0004 完。*
