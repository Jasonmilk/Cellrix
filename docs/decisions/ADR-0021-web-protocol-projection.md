# ADR-0021: Web 面板的协议投影（Protocol Projection）

- **状态**: Proposed（待人类批准）
- **日期**: 2026-09-17
- **提案人**: 会话代理（AI）
- **关联**: `Cellrix:ADR-0015`（水之波光 WebUI）、`Cellrix:ADR-0016`（资产化解耦）、
  `Cellrix:ADR-0018`（事件族装配层）、`Cellrix:DNA` 原则 3（碳硅同构）、
  CI-144 家族（`INTENT-7` §15、`CAPABILITY-13` PC-2、`PFP-xCF14` / `SAP-xCF14`）
- **性质**: 本 ADR 只做**决策与分期**，不含实现。批准前不得动 `web/` 生产资产。
- **引用约定**: 本文中不带仓名的 `ADR-XXXX` **一律指 `Cellrix:ADR-XXXX`**。
  编号与他仓撞车（`anaphase:ADR-0015/0016/0018/0021` 与 Cellrix 同号但不同决策，
  见 `ECOSYSTEM.md` §8），故跨仓引用必带仓名，本仓引用由本约定统一声明。
- **修订记录**: v2（2026-09-17）全面重整。v1 以「对标外部成熟宿主装配实践」立论并自造
  「格／格谱」词汇；人类指出应先了解生态血液（CI-144 协议家族），据此发现 v1 存在
  **五处错误**（见 §2.4），故推倒重来。v1 已退役，不留档于本文件正文，其错误留档
  于 §2.4 以免重犯。
  > 头部采用 `- **状态**:` 项目符号格式，而非引用块——`tools/adr_head.py`
  > 是该事实的唯一解析器，只读此格式（引用块写法会让状态/日期解析为 null）。

---

## 一、背景：可证的物理事实

### 1.1 Web 面板是生态里唯一不成为协议投影的界面

CI-144 协议家族的教义是**定长骨架 + 开放枚举 + 宽容降级**，其中界面侧共识由
`CAPABILITY-13` 的 **PC-2（SemanticSnapshot + view_hash 共识锚点）** 承载，Cellrix
是其**参考实现**（`commonintents/.github/docs/prior-art-ci144.zh-CN.md` §三 PC-2）。

Cellrix 自己的协议 crate 已经定义了网格与槽位：

| 类型 | 位置 | 作用 |
|---|---|---|
| `LayoutHints` | `protocol/src/manifest.rs:36` | 面板偏好 + 网格定义 |
| `GridDefinition` | `protocol/src/manifest.rs:43` | `rows: Vec<GridSlot>` |
| `GridSlot` | `protocol/src/manifest.rs:49` | `{ id, constraint }` |
| `SlotConstraint` | `protocol/src/manifest.rs:56` | `Percentage` / `FixedLines` / `Min` |
| `SemanticNode.slot_binding` | `protocol/src/snapshot.rs:38` | 节点 → 槽位绑定 |
| `NodeType::Unknown` | `protocol/src/snapshot.rs:45-54` | `#[serde(other)]` **宽容降级** |
| `ViewHash.slot_bindings` | `protocol/src/view_hash.rs:14` | 节点→槽位映射的签名基准 |

**使用者统计（实测）**：

| crate | 是否使用协议网格模型 |
|---|---|
| `protocol` | ✅ 定义者 |
| `layout` | ✅ 纯数学布局引擎（`layout/src/layout_engine.rs`） |
| `mock-agent` | ✅ 测试夹具 |
| **`web`** | ❌ **0 个文件** |

**结论**：TUI 路径走的是「协议 `GridDefinition` → 布局引擎 → `ui`」，即
**碳硅同构**（`DNA.md:23-26`：人类看到的视觉布局 = AI 看到的语义拓扑图，
不允许"人类可见但 AI 不可寻址"的元素）。

而 **`cellrix-web` 整体绕开了协议模型**——它是一张手写 HTML 页面外挂上去的。

> **这才是"界面凭凑式"的可证根因**：不是"缺一套 slot 系统"，而是
> **Web 面板没有成为协议的投影**。按 DNA 原则 3，这个面板目前整体违规。

### 1.2 宿主是 23 重字符串替换

`Cellrix/web/src/main.rs` 的 `index_html()` 是当前 Web 面板的**唯一装配点**：

- 24 个 `include_str!` 常量（含模板 `base.html` 本身）
- **23 次链式 `.replace("__XXX__", ...)`**
- 占位符清单住在 `web/assets/base.html`（83 行，23 个洞 = 22 资产 + 1 派生）

> 口径可复算：`grep -c '^\s*\.replace(' web/src/main.rs` → **23**；
> `grep -c 'include_str!'` → **24**；
> `grep -o '__[A-Z_]\{2,\}__' web/assets/base.html | sort -u | wc -l` → **23**

### 1.3 新增一个视图要改 5 处

| # | 改动点 | 文件 |
|---|---|---|
| 1 | 新建资产文件 | `web/assets/<view>.html` + `.js` |
| 2 | 加 `include_str!` 常量 | `main.rs` |
| 3 | 加 `.replace()` 一行 | `main.rs` |
| 4 | 挖洞 + 写 `<script>` 标签 | `base.html` |
| 5 | 手写视图切换按钮 + 容器 | `base.html` |

**没有任何一处是"一处改动"。**

### 1.4 加载序是硬约束，靠注释与运行期 `throw` 维持

`base.html:67-81` 有 13 个 `<script>`，顺序是**语义硬约束**；正确性由
`assembly.js:21-28` 的运行期 `throw` 与人类注释（`main.rs`）保证。

### 1.5 但数据侧已经到位，且是自主血统

`web/assets/assembly.js`（`ADR-0018`）已是「一条磁带多 target」的增量装配层
（幂等 `upsert`、`deriveCoordinates()`、`digest()` 键排序、target 不读磁带）。
**缺的不是数据层，是 UI 层成为协议投影。**

---

## 二、身份与错误留档

### 2.1 Cellrix 在协议家族中的位置（本 ADR 的立论根基）

家族文档对 Cellrix 的法定定位：

- **`INTENT-7` spec §15 法定参考实现 + 测试床**（语义/能力层消费）
  （`prior-art-ci144.zh-CN.md` §七）
- **`CAPABILITY-13` PC-2 的参考实现**：界面状态以 SemanticSnapshot 对外发布
  （`node_type` 开放枚举 + `status` 开放枚举 + `view_hash` 签名基准），
  消费方按 **"what you see is what you sign"** 共识确认
- **可视化共识层**：`INTENT-7/README.md:7-10` 明确划界——「语义对齐是 Cellrix
  这类可视化共识层的职责」，而「意图→能力的映射是 Anaphase 这类编排层的职责」

`CAPABILITY-13` §3 步骤 2 更是直接要求界面承担协议动作：

> 「**可视化与物理身份质询** —— 界面展示「需共识确认」视觉锁定状态，
> 等待人类创建者对载荷进行物理签名」

**因此：让 Web 面板成为协议投影，不是"借鉴谁"，是 Cellrix 自身身份的必然。**
这是本 ADR 与 v1 的根本差别。

### 2.2 家族教义：三条贯穿全族的机制

| 教义 | 出处 | 表现 |
|---|---|---|
| **定长骨架** | PFP 4B / SAP 28B / BIND-19 8B 帧头 | 定偏移、定长、O(1) 解析、无变长状态机 |
| **扩展保留区** | `PA-2` | INTENT-7 动词 `x-*` 前缀 · CAPABILITY-13 开放枚举 · `custom_scopes` |
| **宽容降级** | `PA-2` + `NodeType::Unknown` | 未知类型 → 降级渲染，**不破坏、不空白** |

外加**冻结层／演进层**分层学说（`PFP` v1.0 冻结"如石不朽"／`SAP` v1.0 演进
"v1/v2 可共存"），以及各层独立版本号（`PA-1`）。

### 2.3 家族法理：参考 ≠ 引用已经法典化

`PFP-xCF14/README.md:162-171`、`SAP-xCF14/README.md:186-196` 原文：

> **"Inspired by" means: we learned the design ideas, implemented independently.
> Ideas are not copyrightable; this is open-source etiquette, not a legal obligation.**

并附**灵感登记表**（EtherType · CAN Bus · PROFIsafe · TLS 1.3 · IP Protocol Number）。
这是生态既有的、已经法典化的处理方式，**本 ADR 采用它**（见 D7）。

### 2.4 v1 的五处错误（留档以免重犯）

| # | 错误 | 纠正 |
|---|---|---|
| E1 | 论证根基立在「某外部项目这么做」 | 违 DNA「设计理由立在自己的原则与血统上」；改为立于 CI-144 身份（§2.1） |
| E2 | 自造「格／格谱」 | 重复发明协议已有的 `GridSlot` / `GridDefinition`（违「极致复用：不重新发明」） |
| E3 | 否决 `槽位` 时调查不全 | 我以"外部项目中文用槽位"为由否决，但 `slot`／槽位**是 Cellrix 自己的协议术语**；撤销否决 |
| E4 | 漏掉扩展保留区 | 家族招牌机制；v1 的 V8 兜底恰巧同向但未意识到其血统 |
| E5 | 漏掉冻结/演进分层 | 契约未声明冻结面 |

---

## 三、决策

### D1：Web 面板必须成为协议的投影

`cellrix-web` 的视图区域与槽位，**必须对应**协议 `LayoutHints.grid`
（`GridDefinition` / `GridSlot`）与 `SemanticNode.slot_binding`，
使 Web 面板首次满足 DNA 原则 3（碳硅同构）。

这是**总决策**，其余决策都是它的实现路径。

### D2：复用协议既有词汇，不发明新名词

| 概念 | **采用** | 位置 | 退役 |
|---|---|---|---|
| 槽位 | **`GridSlot`**（中文：**槽位**） | `protocol/src/manifest.rs:49` | ~~格~~ |
| 网格定义 | **`GridDefinition`**（中文：**网格**） | `protocol/src/manifest.rs:43` | ~~格谱~~ |
| 节点→槽位绑定 | **`slot_binding`** | `protocol/src/snapshot.rs:38` | ~~落格~~ |
| 槽位约束 | **`SlotConstraint`** | `protocol/src/manifest.rs:56` | — |

**保留**（经占位检测无冲突，且属机制而非协议概念）：
**起搏图**（装配图）· **皮片**（宿主送达的能力包）· **静照**（不可变快照）。

> 命名纪律不变：不沿用它方的 `slot` 一词及其框架名号；
> 但**自己的协议名词优先级最高**——复用高于新造。
> **身份红线**：本生态的 `证轨`（ProveTrack）**永不写作「轨迹」**。

### D3：装配成为数据（起搏图）

`index_html()` 的 23 次 `replace` 收敛为**图驱动**：顺序、占位符→资产映射、
派生值全部住在数据文件里，宿主只解析并展开。

**已按此做出 T1a（见 §四）**，并证明输出与旧机制逐字节相同。

### D4：扩展保留区（对齐 `PA-2`）

图谱必须预留三条扩展通道，与家族同构：

1. **未知视图键 → 宽容降级渲染**（不是空白页），对齐 `NodeType::Unknown`
2. **本地扩展优先**：实验性视图先以本地形态落地（MVP），成熟后贡献回契约
3. **契约未冻结时即保证扩展不破坏演进**——不需要 breaking change 通道

### D5：冻结／演进分层（对齐 PFP/SAP）

| 面 | 状态 | 理由 |
|---|---|---|
| 四种槽位形态（单/序列/键控/选举） | **冻结** | 骨架；改动即破坏投影 |
| 外壳槽位名（`root` / `shell.*`） | **冻结** | 协议投影的锚点 |
| 视图键 · 皮片登记 · 派生源 | **演进** | 应用侧增长面 |

冻结面改动须走 DNA 修订流程（人类最终决策）。

### D6：静照单向流（承接 `ADR-0018` D5）

业务态在 `assembly.js` 对象层；视图只读**静照**，禁直写业务态。
这是 `assembly.js:5`「a target never reads the tape itself」的 UI 侧表述。

### D7：法理与体例采用家族既有学理

- **不复制**外部项目的代码、名词、文档措辞
- 论证**不以**"外部项目这么做"为终点（`DNA`：参考 ≠ 引用）
- 该外部实践列入**灵感登记**（§五），体例照 `PFP` / `SAP` 的 "Inspired by" 表
- 因无实质复制，**无需**在 Cellrix 中附带该外部项目的版权声明

---

## 四、T1a：已完成并验证（纯重构）

T1a 把装配机制数据化，**不碰 `base.html`**，输出与旧机制**逐字节相同**。

**交付**：`web/assets/boot.json`（起搏图）· `web/src/boot.rs`（机制）·
`web/Cargo.toml`（+serde/serde_json，均已在 workspace lock 中）· `main.rs`（改用图）

**判据（三重，全部通过）**：

| # | 判据 | 结果 |
|---|---|---|
| 1 | `boot_output_is_byte_identical_to_the_legacy_mechanism`（差分测试，旧序列即预言机） | ✅ |
| 2 | HTTP 层：新二进制页面 vs 改动前**逐字节**（244858 B） | ✅ |
| 3 | `verify_live.py` 59/0 · `coupling_audit.py` 0 unresolved · JS 回归网 8/8 | ✅ |

**一个被捕获的陷阱**：`script.html` 内含 `__REFRESH__`，故派生值必须在宿主皮片
展开**之后**对整体应用一次——链式替换语义是承重的。单遍模板替换会把字面量留在
页面上。已由 `derived_applies_after_its_host_piece` 守卫。

**约束（诚实记录）**：`include_str!` 要求字符串字面量，故"资产名→字节"的嵌入清单
必然留在 `boot.rs`（Rust），无法由图动态取。**图管装配顺序与映射，清单管嵌入内容。**
新增资产 = 1 行清单 + 1 条图项。若要消除清单行，需引入 `include_dir!` 类宏（另议）。

---

## 五、灵感登记（按家族体例）

本 ADR 与 T1a 为**独立实现**；以下项目的设计理念**启发了**本方案，但未复制其代码、
名词或文档措辞。原始概念见各项目文档。

| 来源 | 借鉴的**理念** | 本项目实现 |
|---|---|---|
| **外部成熟宿主装配实践**（开放许可） | 宿主产出装配图、能力包按需送达、槽位注册而非改宿主、不可变快照单向流 | 起搏图（`boot.json`）+ 皮片送达 + 协议 `GridSlot` 投影 + 静照 |
| **CI-144 家族**（自有） | 定长骨架、扩展保留区、宽容降级、冻结/演进分层 | D4 / D5 |
| **`Cellrix:ADR-0018`**（自有） | 一条磁带多 target、target 不读磁带 | D6 |

> 体例依 `PFP-xCF14/README.md:186-196`：「we learned the design ideas,
> implemented independently. Ideas are not copyrightable; this is open-source
> etiquette, not a legal obligation.」
>
> **该外部实践不构成本方案的论证依据**，仅登记为灵感来源（纠正 v1 的 E1）。
>
> **为何不留名号**：`ECOSYSTEM.md` v1.94 立规——活文档**当前态正文**去除外部项目名号，
> **保留「借鉴成熟实践」这一事实**（参考 ≠ 引用，设计理由立在自己的 DNA 上）。
> 该政策把**带日期的 ADR 划入"原文保全"类**（共 38 处，不动）；本条属**新写当前态正文**，
> 故**由人类裁决从严适用**：同样不留名号，只写实践类别。
> `PFP` / `SAP` 的灵感表列的是**协议前身**（既有工业标准），性质不同 ——
> 故**体例照搬、名号从严**。

---

## 六、分期计划

原则：每期独立可交付、独立可回退、每期结束红线自检。

| 期 | 目标 | 状态 |
|---|---|---|
| **T0** | 槽位契约（`docs/spec/grids.md`）：形态、契约、图谱格式、校验规则 | ✅ 已交付，待随本 ADR 改名 |
| **T1a** | 装配数据化；输出与旧机制逐字节相同；**不碰 `base.html`** | ✅ **已完成并三重验证** |
| **T1b** | `base.html` 的 23 洞收敛为单一 `__GRID_BOOT__` 洞；**投影协议槽位** | ⬜ 待人类几何工作落地 |
| **T2** | 皮片自注册 + 装配期校验（消除运行期 `throw`） | ⬜ |
| **T3** | 静照单向流（D6） | ⬜ |
| **T4** | 独立失败边界（一格崩溃只黑一格） | ⬜ |
| **T5** | 依赖图分层门（防"凭凑"复发，CI 门禁） | ⬜ |

### 6.1 T1b 的额外要求（v2 新增）

T1b 不只是搬洞，必须**同时**建立协议投影：

- 槽位名取自 `GridSlot.id`，并由 `slot_binding` 与语义节点对应
- `view_hash.slot_bindings` 可在 Web 面板侧计算，使 TUI 与 Web 面板共享同一
  共识锚点（PC-2 的"所见即所签"）
- 未知 `node_type` / 未知视图键 → **宽容降级渲染**（D4）

### 6.2 不做（明确拒绝）

| 拒绝项 | 理由 |
|---|---|
| 引入 React / 插件运行时 / npm 运行时依赖 | 违反零构建依赖（`ADR-0016` D7）与 DNA 铁律 2 |
| 复制外部项目代码或名号 | 违反 DNA「参考 ≠ 引用」 |
| 自造与协议重复的词汇 | 违反 DNA「极致复用：不重新发明」 |
| 在 T1b 之前动 `base.html` | 人类 `layout_test.js:127-129` 的几何 TDD（"must be RED now"）尚未落地 |

### 6.3 待确认的观察（不作决策依据）

`INTENT-7` 的 `autonomy_level`（`AGENT` / `OPEN` / `SURVIVAL`）与 Anaphase 的
三模式（Drive / Partner / Survive）**结构同形**，`impasse_depth`（0-5）与
Anaphase 的 `impasse_level` 亦同形。**家族文档未作官方映射**（映射指南已弃用，
见 `INTENT-7/guides/mapping-guide.zh-CN.md`）。此观察仅登记，供后续核对。

---

## 七、后果

### 正面
- Web 面板首次满足 DNA 原则 3（碳硅同构），不再是协议投影之外的孤岛
- 新增视图从 **5 处改动 → 1 处**（T1b 后）
- 加载序从**运行期 `throw` + 人肉注释** → **装配期校验**（T2）
- 词汇与协议一致，无双份名词（`GridSlot` 只有一个意思）
- **零新依赖、零构建步骤、零新语言**（T1a 仅用已在 lock 中的 serde）

### 代价与风险
- **T1b 触及人类在飞的几何工作**：必须等 `layout_test.js` 的 4a 转绿后再动
- **装配期校验是新增机器**，需自检（对齐 `/v1/health` 既有做法）
- **槽位名冻结**后改名成本高 → T2 前必须一次想清
- **T3 触及业务态归属**，最易改出回归，须带 grep 断言回归网
- 不引 React ⇒ 拿不到类型级槽位契约。**自觉取舍**，换零依赖与 400 行红线

---

## 八、替代方案

| 方案 | 一句话否决理由 |
|---|---|
| 维持 23 重 `replace`，只加注释约束 | 根因（未成为协议投影）不动；加视图仍改 5 处 |
| 整体照搬该外部项目的客户端形态（插件运行时 + React + 构建步骤） | 同时违反四条 DNA；且把"凭凑"换成"重基建" |
| 引入现成 SPA 框架替掉裸 DOM | 违反零构建依赖；**且不解决投影问题**——框架不等于协议投影 |
| 保留 v1 的自造词汇（格/格谱） | 与协议 `GridSlot`/`GridDefinition` 重复，违反极致复用 |
| 只做 T0+T1a，T1b 无限期延后 | 可接受的最小方案；但 Web 面板将持续停留于碳硅同构之外 |

---

## 九、人类决策记录

| # | 事项 | 决议 | 日期 |
|---|---|---|---|
| 1 | 命名（v1：格/格谱/开格/落格/起搏图/皮片/静照） | ✅ 批准 | 2026-09-17 |
| 2 | T0 启动 | ✅ 批准，已交付 | 2026-09-17 |
| 3 | ADR 就地修正命名，状态保持 Proposed | ✅ 批准 | 2026-09-17 |
| 4 | T1a（字节等价重构，不碰 `base.html`） | ✅ 批准，已完成并验证 | 2026-09-17 |
| 5 | 起搏图格式 = `boot.json` + serde_json | ✅ 批准 | 2026-09-17 |
| 6 | **退役「格/格谱」，复用协议 `GridSlot`/`GridDefinition`** | ✅ 批准 | 2026-09-17 |
| 7 | **ADR-0021 全面重整（论证立于 CI-144 血统）** | ✅ 批准（本版） | 2026-09-17 |
| 8 | `PLAN.md` 门面同步 | ✅ 批准，待本 ADR 定稿后记录 | 2026-09-17 |

**仍待决策**：

1. **分期**：T1b 是否等 `layout_test.js` 4a 转绿（人类几何工作落地）后再开工？
2. **范围**：E 区之外的缺口（`session-query` 检索、崩溃修复、子 agent、沙箱、
   依赖图分层门 T5）是否另立 ADR？
3. **T1b 的投影深度**：只做槽位名对应，还是同时接通 `view_hash.slot_bindings`
   使 Web 面板与 TUI 共享共识锚点？
4. **状态**：本 ADR 定稿后转 Accepted，方可动 `web/` 生产资产。

---

*参考 ≠ 引用。本 ADR 借的是理念，立的是 Cellrix 自己的身份与血统。*
