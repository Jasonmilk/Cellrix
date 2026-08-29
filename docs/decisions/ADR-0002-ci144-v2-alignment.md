# ADR-0002：CI-144 v2.0 对齐（PFP+SAP）

**状态**：已采纳
**日期**：2026-08-30
**决策者**：Jasonmilk
**关联**：CI-144 v2.0 协议家族 + BIND-19 v2.0-alpha 参考实现

---

## 背景

Cellrix 当前已对齐 CI-144 v1.0（CIN7/CIC13/CIB19），但 CI-144 已升级到 v2.0 协议家族架构：
- **PFP-xCF14**（4 字节）：物理特征协议，冻结层，Tuck 硬实时决策依据
- **SAP-xCF14**（28 字节）：安全证明协议，演进层，防重放+签名验证
- **BIND-19 v2.0-alpha**：已实现 PFP+SAP 的参考实现

Cellrix 作为 Helix 生态的"皮肤"，需要消费 PFP 物理特征并展示给用户和 AI。

---

## 决策

### 1. 在 cellrix-protocol crate 中新增 PFP 解析器

- 文件：`protocol/src/pfp.rs`
- 结构：4 字节零拷贝解析，位运算提取字段
- 对齐：与 BIND-19 v2.0-alpha 的 PFP 实现完全一致
- 字段：Family-Magic/Modality/Risk-Level/Body-Stance/Proximity-Edge/Output-Dest/Override-Flag/Replay-Enable

### 2. 在 cellrix-protocol crate 中新增 SAP 解析器

- 文件：`protocol/src/sap.rs`
- 结构：28 字节可选增强解析
- 对齐：与 BIND-19 v2.0-alpha 的 SAP 实现完全一致
- 字段：Protocol-ID/Seq-Counter/PAH-Hash/PAH-Signature/Full-Signature

### 3. SemanticSnapshot 增加 PFP 字段

- 在 `SemanticSnapshot` 结构体中增加 `pfp: Option<[u8; 4]>` 字段
- 语义快照可携带 PFP 物理特征
- 向后兼容：PFP 为 Option，旧快照不包含 PFP

### 4. 补充测试覆盖率

- 目标：从当前 4 个测试提升到 ≥50 个测试
- 范围：PFP 解析器（≥15 个）、SAP 解析器（≥10 个）、现有模块补充（≥20 个）

---

## 后果

### 正面
- Cellrix 可以消费和展示 PFP 物理特征（Risk-Level/Modality/Stance 等）
- 与 Tuck 的审计日志和安全事件展示对齐
- 与 BIND-19 v2.0-alpha 参考实现互操作
- 测试覆盖率大幅提升

### 负面
- 需要修改 SemanticSnapshot 结构体（向后兼容，Option 字段）
- 需要维护与 BIND-19 的 PFP/SAP 实现同步

### 风险
- BIND-19 v2.0 仍在演进，PFP/SAP 结构可能变化 → 跟随 BIND-19 v2.0-alpha 分支，定期同步

---

## 替代方案

### 方案 A：不做 PFP/SAP 解析，直接依赖 BIND-19 crate
- 优点：代码复用，不重复实现
- 缺点：Cellrix protocol crate 零依赖原则被打破（引入 BIND-19 依赖）
- 否决原因：Cellrix protocol crate 要求 100% WASM 兼容、零依赖，PFP/SAP 解析器只有几百行，自己实现更轻量

### 方案 B：只做 PFP，不做 SAP
- 优点：工作量小
- 缺点：无法展示安全证明信息（Seq-Counter/签名验证状态）
- 否决原因：SAP 是 CI-144 v2.0 的重要组成部分，Cellrix 作为皮肤需要展示完整信息

---

## 参考

- BIND-19 v2.0-alpha：https://github.com/CommonIntents/BIND-19/tree/v2.0-alpha
- CI-144 v2.0 升级计划：helix-mind/docs/vision/ci-144-v2.0-upgrade.md
- PFP-xCF14 规范：https://github.com/CommonIntents/PFP-xCF14
- SAP-xCF14 规范：https://github.com/CommonIntents/SAP-xCF14

---

*ADR-0002 完。*
