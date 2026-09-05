# Cellrix 开发导航牌（PLAN）

> **版本**：v1.0
> **日期**：2026-08-30
> **所属方法论**：phyt-DNA v1.0
> **性质**：本文件是 Cellrix 的当前生长阶段导航牌。只含当前阶段 + 下一阶段预览 + 阶段总览。已完成的详细内容移入 GROWTH.md。

---

## 当前阶段：P0-P6 完成 + 驾驶舱（G-2..G-6）+ Web 面板 G2 首拉（cellrix-web，ADR-0014）——下一步 Web 优化（React 组件接入/up 菜单第 5 项）

**状态**：P0-P6 完成 + 候选 G 完成（G-T3 消费层 / G-T4 渲染 / G-T5 live 验证）

**Cellrix 项目已完成所有规划阶段**，包括：
- P0: 方法论初始化 + 现有代码审查
- P1: CI-144 v2.0 对齐（PFP+SAP）
- P2: Tuck 对接（审计日志 + 安全事件展示）
- P3: Helix-Mind 联调（语义快照 + 认知工艺展示）
- P4: Anaphase 联调（编排状态展示 + HITL 交互）
- P5: Tentacle 联调（工具执行状态 + 插件审计展示）
- P6: 生产就绪（配置/日志/监控/部署）

**测试覆盖率**：316 个测试（307 + 候选 G 新增 9：CockpitWidget 3 + AppState 1 + snapshot views 2 + parse 3）

---

## 候选 G：Anaphase 驾驶舱（ADR-0009）

**目标**：Cellrix = Anaphase 意识层的白盒驾驶舱（正名：监控意识层，Helix-Mind 灵魂本体不驾驶）。

| 任务 | 内容 | 状态 |
|---|---|---|
| G-T3 | protocol 快照结构 + AnaphaseClient get_snapshot（一次拉全）+ HttpAnaphaseClient | ✅ |
| G-T4 | CockpitWidget（模式栏+经历+ledger 审查）+ AppState.cockpit + renderer strip + attach_cockpit + cli --anaphase-endpoint | ✅ |
| G-T5 | live 联调（真实 Anaphase 50061 ↔ HttpAnaphaseClient）+ serde 契约修正（snake_case） | ✅ |
| G-T6 | ADR-0009 + PLAN + GROWTH + README | ✅ |
| G-3 | transport 帧契约对齐（mock-agent 双通道字节序/编码/UDS 裸 Manifest，ADR-0010） | ✅ |

**双端策略**：snapshot HTTP JSON 是唯一数据协议（TUI/Web 共享）；TUI 先行，Web 面板（G2）后续低摩擦接入。

**运行方式**：`cellrix-cli run --mode stdio --exec <agent> --anaphase-endpoint http://127.0.0.1:50061`（--mode 为传输模式 stdio/uds，非认知模式；Anaphase 需 cap_http_enabled）

**✅ G-3 已修复（2026-09-06，ADR-0010）**：mock-agent 帧契约对齐双通道字节序
（stdio=LE / uds=BE + map-form rmp + UDS 裸 Manifest）——驾驶舱 TUI 双通道实测渲染通过
（模式栏/经历/真实 MET ledger 投影），316 测试全绿无回归。
**遗留**：transport 两套字节序未统一（物理事实保留，重构项）；transport 真实集成测试未自动化（手动 pty 实测覆盖）。

---

## 阶段总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | 方法论初始化 + 现有代码审查 | ✅ 已完成 |
| **P1** | CI-144 v2.0 对齐（PFP+SAP） | ✅ 已完成 |
| **P2** | Tuck 对接（审计日志 + 安全事件展示） | ✅ 已完成 |
| **P3** | Helix-Mind 联调（语义快照 + 认知工艺展示） | ✅ 已完成 |
| **P4** | Anaphase 联调（编排状态展示 + HITL 交互） | ✅ 已完成 |
| **P5** | Tentacle 联调（工具执行状态 + 插件审计展示） | ✅ 已完成 |
| **P6** | 生产就绪（配置/日志/监控/部署） | ✅ 已完成 |
| **候选 G** | Anaphase 驾驶舱（协议/渲染/live） | ✅ ADR-0009 |

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

*《Cellrix 开发导航牌》v1.1（候选 G 完成：Anaphase 驾驶舱，2026-09-06）。*
