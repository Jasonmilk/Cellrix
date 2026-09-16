# Cellrix 开发导航牌（PLAN）

> **版本**：v1.3
> **日期**：2026-09-17
> **所属方法论**：phyt-DNA v1.0
> **性质**：本文件是 Cellrix 的当前生长阶段导航牌。只含当前阶段 + 下一阶段预览 + 阶段总览。已完成的详细内容移入 GROWTH.md。
> **引用约定**：不带仓名的 `ADR-XXXX` 一律指 `Cellrix:ADR-XXXX`（编号与他仓撞车，跨仓引用必带仓名）。

---

## 当前阶段：**Web 面板的协议投影（ADR-0021）**

**根因（可证，非推测）**：Cellrix 协议早已定义 `GridDefinition` / `GridSlot`
（`protocol/src/manifest.rs:36-59`）、`SemanticNode.slot_binding`（`snapshot.rs:38`）、
`NodeType::Unknown`（`snapshot.rs:45-54`）。使用者实测为 `protocol`（定义）/ `layout`（纯数学引擎）/
`mock-agent`（夹具），而 **`web/src` 零使用**。

TUI 走「协议网格 → 布局引擎 → `ui`」即**碳硅同构**（DNA 原则 3：人类看到的视觉布局 =
AI 看到的语义拓扑图，不允许"人类可见但 AI 不可寻址"的元素）；**`cellrix-web` 整体绕开协议模型**。
**这才是"界面凭凑式"的根因**——不是"缺一套 slot 系统"。

| 期 | 目标 | 状态 |
|---|---|---|
| **T0** | 槽位契约（`docs/spec/grids.md` v2） | ✅ 已交付 |
| **T1a** | 装配数据化：23 次 `replace` → `web/assets/boot.json` 起搏图 + `web/src/boot.rs`；**不碰 `base.html`** | ✅ **已完成并三重验证** |
| **T1b** | 23 洞收敛为单一洞；**投影协议槽位**（`GridSlot.id` ↔ `slot_binding`） | ⬜ 待人类几何工作落地 |
| **T2** | 皮片自注册 + 装配期校验 V1–V9 | ⬜ |
| **T3** | 静照单向流（承接 `ADR-0018` D5） | ⬜ |
| **T4** | 独立失败边界（一槽崩溃只黑一槽） | ⬜ |
| **T5** | 依赖图分层门（防"凭凑"复发，CI 门禁） | ⬜ |

**T1a 判据（三重，全部通过）**

1. 差分测试 `boot_output_is_byte_identical_to_the_legacy_mechanism`（旧序列即预言机，
   非冻结金标——金标会把测试绑到资产**内容**而非装配**机制**）
2. HTTP 层：新二进制页面 vs 改动前**逐字节相同**（244858 B）
3. `verify_live.py` 59/0 · `coupling_audit.py` 0 unresolved · JS 回归网 8/8

红线：`main.rs` 279 行 / `boot.rs` 338 行（均 ≤400）。

**已捕获的陷阱**：`script.html` 内含 `__REFRESH__` ⇒ 派生值必须在宿主皮片展开**之后**
对整体应用一次（链式替换语义承重）；单遍模板替换会把字面量留在页面上。已由
`boot::tests::derived_applies_after_its_host_piece` 守卫。

**诚实约束**：`include_str!` 需字符串字面量 ⇒ 嵌入清单必然留在 `boot.rs`（Rust）。
**图管装配顺序与映射，清单管嵌入内容**；新增资产 = 1 行清单 + 1 条图项。

---

## 下一阶段预览

- **T1b 前置**：`web/tests/layout_test.js:127-129` 的 4a 几何断言（原文
  "Written BEFORE the layout work, so they must be **RED** now"）须先转绿——
  人类几何改动目前在飞（`base.html` / `prove_track.css` 未提交）。
- **T1b 待裁决**：投影深度——只做槽位名对应，还是同时接通 `view_hash.slot_bindings`，
  使 Web 面板与 TUI 共享 `CAPABILITY-13` PC-2 的共识锚点（"所见即所签"）。
- **T5 之外**：E 区缺口（`session-query` 检索 / 崩溃修复 / 子 agent / 沙箱）是否另立 ADR。

**历史候选（均已完成，明细见 GROWTH 与 `docs/archive/growth/`）**：
`ADR-0015` 水之波光 WebUI · `ADR-0016` 证轨资产解耦（400 行红线清零）·
`ADR-0018` 事件族装配层（T0/T1/T2/T3/T4/T6/T7 完成；**T5 阻塞待裁决**——
实时 SSE 是 token 增量非事件族）· 候选 G Anaphase 驾驶舱（`ADR-0009`/`ADR-0010`）。

**候选 G 遗留（活项，非历史）**：transport 两套字节序未统一（物理事实保留，重构项）；
transport 真实集成测试未自动化（手动 pty 实测覆盖）。

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
| **候选 G** | Anaphase 驾驶舱（协议/渲染/live，`ADR-0009`/`ADR-0010`） | ✅ 已完成 |
| **WebUI 资产化** | `ADR-0015` + `ADR-0016`（`web/assets/` 全部 ≤400 行） | ✅ 已完成 |
| **事件族装配层** | `ADR-0018`（T5 待裁决 / T7 已完成） | 🔶 部分 |
| **协议投影** | **`ADR-0021`（本阶段：T0 ✅ / T1a ✅ / T1b–T5 ⬜）** | 🚧 进行中 |

**测试数**：341（2026-09-14 全量实测）；全生态 1563（口径见 `ECOSYSTEM.md` §1）。
**口径陷阱**：`cargo test` 默认 fail-fast，不带 `--no-fail-fast` 不是真实总数。

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
| **spec/grids.md** | ✅ **新增（ADR-0021 T0）** | `docs/spec/grids.md` |
| PLAN.md | ✅ | `docs/PLAN.md` |
| GROWTH.md | ✅ | `docs/GROWTH.md` |
| DEPRECATE.md | ✅ | `docs/DEPRECATE.md` |
| decisions/ | ✅ | `docs/decisions/` |
| archive/ | ✅ | `docs/archive/` |

---

*《Cellrix 开发导航牌》v1.3（Web 面板的协议投影：`ADR-0021` T0 + T1a 达成，2026-09-17）。*
