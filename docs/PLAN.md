# Cellrix 开发导航牌（PLAN）

> **版本**：v1.0
> **日期**：2026-08-30
> **所属方法论**：phyt-DNA v1.0
> **性质**：本文件是 Cellrix 的当前生长阶段导航牌。只含当前阶段 + 下一阶段预览 + 阶段总览。已完成的详细内容移入 GROWTH.md。

---

## 当前阶段：P0 — 方法论初始化 + 现有代码审查

**状态**：🚧 进行中

**目标**：
1. ✅ 建立 phyt-DNA 方法论（VISION/DNA/RNA/SPEC/PLAN/GROWTH/DEPRECATE）
2. ✅ 创建 spec/ 分卷（哲学/架构/契约/安全/定位）
3. ✅ 创建 ADR-0001（方法论初始化 + Rust 重构决策）
4. ⏳ 审查现有 rs2 分支代码结构
5. ⏳ 确认与 CI-144 v2.0（PFP+SAP）的对齐差距
6. ⏳ 确认与 Tuck 的对接需求

**验收标准**：
- 方法论 10 件套全部就位
- 现有代码结构审查完成，输出差距清单
- CI-144 v2.0 对齐差距明确
- Tuck 对接需求明确

---

## 下一阶段预览：P1 — CI-144 v2.0 对齐

**状态**：⏳ 待启动

**目标**：
1. PFP-xCF14（4 字节）解析与展示
2. SAP-xCF14（28 字节）可选增强展示
3. 与 BIND-19 v2.0-alpha 参考实现对齐
4. 语义快照中嵌入 PFP 物理特征

**依赖**：P0 完成

---

## 阶段总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | 方法论初始化 + 现有代码审查 | 🚧 进行中 |
| **P1** | CI-144 v2.0 对齐（PFP+SAP） | ⏳ 待启动 |
| **P2** | Tuck 对接（审计日志 + 安全事件展示） | ⏳ 待启动 |
| **P3** | Helix-Mind 联调（语义快照 + 认知工艺展示） | ⏳ 待启动 |
| **P4** | Anaphase 联调（编排状态展示 + HITL 交互） | ⏳ 待启动 |
| **P5** | Tentacle 联调（工具执行状态 + 插件审计展示） | ⏳ 待启动 |
| **P6** | 生产就绪（配置/日志/监控/部署） | ⏳ 待启动 |

---

## 方法论检查清单

| 组件 | 状态 | 路径 |
|---|---|---|
| VISION.md | ✅ | `docs/VISION.md` |
| DNA.md | ✅ | `docs/DNA.md` |
| RNA.md | ✅ | `docs/RNA.md` |
| SPEC.md | ✅ | `docs/SPEC.md` |
| spec/philosophy.md | ✅ | `docs/spec/philosophy.md` |
| spec/architecture.md | ✅ | `docs/spec/architecture.md` |
| spec/contract.md | ✅ | `docs/spec/contract.md` |
| spec/safety.md | ✅ | `docs/spec/safety.md` |
| spec/positioning.md | ✅ | `docs/spec/positioning.md` |
| PLAN.md | ✅ | `docs/PLAN.md` |
| GROWTH.md | ✅ | `docs/GROWTH.md` |
| DEPRECATE.md | ✅ | `docs/DEPRECATE.md` |
| decisions/ | ✅ | `docs/decisions/` |
| archive/ | ✅ | `docs/archive/` |

---

*《Cellrix 开发导航牌》v1.0 完。已完成的详细内容移入 GROWTH.md。*
