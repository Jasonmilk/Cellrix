# ADR-0001：方法论初始化 + phyt-DNA 采用

**状态**：已采纳
**日期**：2026-08-30
**决策者**：Jasonmilk
**关联**：phyt-DNA v1.0

---

## 背景

Cellrix 项目已有 rs2 分支的 Rust 实现，包含 protocol/layout/ui/transport/cli 五个 crate，已对齐 CI-144 v1.0（CIN7/CIC13/CIB19）。但项目缺少统一的自生长方法论，存在以下问题：

1. 没有 VISION/DNA/RNA/SPEC/PLAN/GROWTH/DEPRECATE 方法论文件
2. 没有 spec/ 分卷（哲学/架构/契约/安全/定位）
3. 没有 ADR 架构决策记录
4. 与 CI-144 v2.0（PFP+SAP 协议家族）的对齐差距未明确
5. 与 Tuck 的对接需求未明确

---

## 决策

1. **采用 phyt-DNA v1.0 自生长方法论**
   - 建立方法论 10 件套：VISION/DNA/RNA/SPEC/spec/PLAN/GROWTH/DEPRECATE/decisions/archive
   - DNA.md 为不可变宪法，AI 不得修改
   - RNA.md 定义三层加载协议和 AI 协作铁律
   - PLAN.md 只含当前阶段 + 下一阶段预览 + 阶段总览

2. **创建 spec/ 5 个分卷**
   - philosophy.md：碳硅同构、Somatic Monasticism 美学、确定性优先
   - architecture.md：Workspace 架构、分层模型、Wayland 风格多客户端
   - contract.md：CI-144 对齐、AgentEvent 契约、语义节点契约
   - safety.md：资源限制、能力授权、Tuck 对接、传输安全
   - positioning.md：Helix 生态位置、独立价值、适用场景

3. **当前阶段 P0：方法论初始化 + 现有代码审查**
   - 建立方法论文件
   - 审查现有 rs2 分支代码
   - 确认 CI-144 v2.0 对齐差距
   - 确认 Tuck 对接需求

4. **下一阶段 P1：CI-144 v2.0 对齐**
   - PFP-xCF14（4 字节）解析与展示
   - SAP-xCF14（28 字节）可选增强展示
   - 与 BIND-19 v2.0-alpha 参考实现对齐

---

## 后果

### 正面
- 项目有了统一的自生长方法论，避免版本撕裂和歧义漂移
- 哲学/架构/契约/安全/定位有了明确的分卷文档
- 架构决策有了 ADR 记录，可追溯
- 与 CI-144 v2.0 和 Tuck 的对齐有了明确的路线图

### 负面
- 需要投入时间建立方法论文件
- 现有代码需要与方法论对齐，可能需要重构

### 风险
- 方法论文件可能与现有代码不一致 → P0 阶段审查并修正
- CI-144 v2.0 仍在演进 → P1 阶段跟随 BIND-19 v2.0-alpha 参考实现

---

## 替代方案

### 方案 A：不建立方法论，直接开发
- 优点：快速
- 缺点：版本撕裂、歧义漂移、决策不可追溯
- 否决原因：用户明确要求采用 phyt-DNA 方法论

### 方案 B：采用其他方法论（如 ADR-only、SemiSpace）
- 优点：成熟
- 缺点：不匹配 Helix 生态的自生长哲学
- 否决原因：phyt-DNA 是 Helix 生态的统一方法论，已在 Mind/Anaphase/Tentacle/Tuck 中采用

---

## 参考

- phyt-DNA v1.0：https://github.com/Jasonmilk/phyt-DNA
- Helix-Mind 方法论：https://github.com/Jasonmilk/Helix-Mind/tree/rs-dev/docs
- Tuck 方法论：https://github.com/Jasonmilk/Tuck/tree/rs/docs

---

*ADR-0001 完。*
