# 反哺 phyt-DNA v2 · 登记册（BACKFLOW）

> 立册 2026-10-09 ｜ **用途**：Cellrix 是 phyt-DNA v2 的**第一个真实采用者**，
> 使用中撞到的每一条都在此登记（**含证据与真实反例**），供日后回流模板。
> **为什么立此册**：反哺若只存在于会话记忆里，就一定会丢。**登记即不丢。**
>
> **登记顺序**：新条目**追加在末尾**（不要按主题插队）—— 本册已两次因"插在某条前面"而乱序，
故每条**只按编号追加**；顺序错时按编号重排。（第 29 条同族：让顺序不靠人记。）

**纪律**：本册**不改模板**。回流需人类裁决（改共享模板影响所有采用者）。

## 状态图例

| 标记 | 含义 |
|---|---|
| ✅ 已裁决回流 | 人类已判"该回流" |
| ⚠️ 部分 | 人类判"拆开/升级/换真解" |
| ⏸ 缓 | 曾被判低 ROI 或需前置 |
| 🚫 已否决 | 人类判"不回流" |
| 📄 文本已备 | 有可直接采用的文本 |

---

## P1 · ADR 的"双契约"写法 ✅ **已回流**（template/decisions/README.md §BACKFLOW P1）

**症状**：Cellrix 的 pre-commit 钩子要求**首行是 ADR 头**；模板把元数据放**文件开头**的 YAML front-matter
⇒ **首次提交被 REJECT**（`REJECT: 首行不是 ADR 头`）。
**解法（已证明可共存）**：`# ADR-NNNN：标题` 首行 + front-matter **紧随其后**。
`validate.sh` 用 `grep`/`awk` 读取，**不要求元数据在开头** ⇒ 两方都不必改。
**人类裁决**：**提取规则回流**（否则别的项目读不出 `id`）；**标题格式不回流**（本地体例）。
**判例**：`Cellrix/docs/decisions/ADR-0049-asset-parity.md`

---
---
---

## P2 · 路径必须声明式，不得硬编码 ✅ **已回流**（template/tools/validate.sh（DECISIONS_DIR/FIXTURES_DIR/LEDGER_DIR 可覆盖））

**症状**：模板用 `decisions/`（仓库根），Cellrix 用 `docs/decisions/` ⇒ 我**不得不改脚本**。
**人类裁决**：*"改脚本 = 分叉 = 漂移。这正是我们这一个月的老病（ports.json、store 路径、两个 up）。"*
⇒ **模板硬编码路径本身就是缺陷。**（人类同时**撤回**了自己先前"P2 不回流"的判断。）

---
---
---

## P3 · 「零闸门」必须具名 ✅ **已回流**（template/tools/validate.sh（零闸门 ⇒ [BLOCK] + exit 2））

**症状**：`validate.sh` 在**未登记任何 `hard: true` ADR** 的项目上**静默 pass**（`scanned:0`）。
**人类裁决**：*"空集合上的全通过 = 伪证"*。
**已落地（Cellrix）**：`gates` 为空 ⇒ 打印 `[BLOCK] 零闸门 …` 并 **exit 2**（实测生效）。

---
---
---

## P4 · ADR 需要三类，不是过渡期 ✅ 已裁决（换真解）

**症状**：`check-baseline.sh` 把**未登记文件判红** ⇒ 已有 24 份散文 ADR 的项目一上 v2 **全红**。
**我的原提议**：过渡 ADR。
**人类真解**：**ADR 必须有三类 —— 可判 / 灯塔 / 已退役**。
理由（人类）：*"否则 G5 会逼人给不可判的东西编假判据 —— 正是伪证的来源。"*
**⏸ 缓（ROI）**：人类 2026-10-09 判定这是过程工作、不砍树 ⇒ **不排期**。

---
---
---

## P5 · 夹具目录名应由脚本**生成** ✅ **已回流**（template/fixtures/README.md §P5）

**症状**：我把夹具目录命名成 `asset_parity` 而非**闸门 id** ⇒ `--probe` 才报"缺 fixture"。
**我的原提议**：lint 事后报错。
**人类升级**：*"别靠 lint 事后报错，由脚本生成目录名（G9：确定性归脚本）"*。

---
---
---

## P6 · ★ 账本行必须带**环境**，且环境由脚本探测 ✅ **已回流**（template/ledger/README.md §P6（环境由探测得到））

**证据（本会话最硬的一条）**：同一 commit，`proven 55 → 77 → 80`、`held 31 → 1`、`red 2 → 8 → 6`，
**只因为 `panel/cdp` 从 down 变 up** ⇒ **没有环境的计数跨 commit 不可比**（Cellrix ADR-0048 §200 同论）。
**而模板的 ledger schema 没有环境字段。**
**人类裁决**：回流，**但环境必须自动采集** —— *"手写环境与手写 note 同病（会说 up 没起也写 up）"*。
**已落地（Cellrix）**：`env: {cdp, panel, jsdom, siblings:{present,of}}`，全部**由探测得到**。

---
---
---

## P7 · 账本计数应**结构化**，不只放 `note` ✅ **已回流**（template/ledger/README.md §P7（counts 结构化））

**理由**：自由文本 `note` **无法在两行之间比较** ⇒ 账本记了历史却答不出"变了没有"。
**已落地（Cellrix）**：`counts: {proven, red, held, unregistered, aborted, envMissing}`。

---
---
---

## P8 · 被委派的产物必须**存在于仓库** ✅ 已裁决（有前置）

**症状**：VISION v3.1 写 *"机制细节、逐格验收归入 v12 / DAG v5.0"*，而**这两份产物不在仓库里**
⇒ 委派**静默失效** ⇒ 内容只能挤在 VISION 里（人工反馈的"内容太多挤在一起"的真因）。
**人类裁决**：回流，但**先要有结构化引用**，否则扫不出。
**已落地（Cellrix）**：`docs/vision/{architecture-v12.html, dag-v5.0-milestones.md, README.md}`。

---
---
---

## P9 · 契约应当有位置，不只写在注释里 ⏸（本会话新提，待裁决）

**证据**：`all_views_test:237` 那句旧契约（*"conversation shows the WHOLE chain, not one period"*）
写在**注释**里。它**生效了** —— 一次改动被它拦住 —— **但它是靠人读到注释才生效的，不是机器强制的**。
**提议**：`applies-to` 的兄弟（例如 `contract-of`），让"这句契约管什么"有机器可读的位置。
**⏸ 待人类裁决。**

---
---
---

## P10 · ★ gate 的输入必须是**产物**，不得是**活对象** ⏸（本会话新提，待裁决）

**症状（一个烧了我们很多 tokens 的坑）**：anaphase 的 `run_cycle_pipeline` 套件**不确定** ——
同一命令连跑两次，失败集合不同（9 红 vs 3 红）；每条单独跑都绿；**串行也一样**；
**加一行 `eprintln!` 探针就变绿**。

**根因（结构性）**：判据读的是**活对象的内部**，而 `run_cycle` 返回的是**完成信号**：

```rust
:698  pub async fn run_cycle(…) -> Result<CycleOutcome, String>
:102  pub struct CycleOutcome { done, success, impasse, … }      // 不带账本/裁定
测试： agent.pipeline.as_ref().unwrap().ledger.records()          // ← 读活对象
```

⇒ 那个断言测的**不是「结果」，而是「读取时刻」** —— 而「读取时刻」**不是被断言的对象**。

**★ 为什么这是 phyt-DNA 层面的（而不是某个项目的）**

**phyt-DNA 的 gate 天生免疫这一类**：它的 `check` 针对 `$F`（**磁盘上的产物**）跑，
**输入是文件，不是进程内存**。**⇒ 这个坑只在"绕过 gate、在进程内断言活状态"时出现。**
**⇒ 因此它是一条通则，不是一个案例：**

> **gate 的输入必须是「产物」（文件 / 提交 / 快照 / 事件流），不得是「活对象」。**
> 理由不是风格，是**定义**：判据的目的是裁决**结果**；活对象在读取时刻之间会变
> ⇒ 读活对象 = **让判据同时依赖一个未被断言的量**。

**围栏（两个动作，第二个才是围栏）**
1. **修法**：完成物**携带快照**（`CycleOutcome` 加 `ledger: Vec<LedgerRecord>`）⇒ 正确写法成为顺手写法
2. **★ 围栏**：**收紧可见性**（`pub pipeline` → 外部不可读）⇒ **"读活内部"编译不过** —— 不是"记得别写"，是**写不出来**
   （与 `ADR-0018 批次 4` 的 *"表即行集，一类缺陷变成不可能状态"* 同一手法，只换了一层：判据的**输入**）

**机械识别**：判据里凡出现 `x.some_live_field`（而非 `x.outcome().…`），
问一句 **「这字段会在读取时刻之间变吗？会变 ⇒ 它不是判据。」**

**⚠️ 未做**：① ② 的改动**均未落地** ⇒ 那条 flaky 仍在。**登记待做，不阻塞。**
---

## P11 · ★★ 测电仪：裁决需要**第二根轴**（"是否真绿/真红"）✅ **已回流**（4 处：`template/docs/MULTIMETER.md`（主文）· `template/tools/validate.sh`（probe 写账本 / `--probe-all` / `counter.sh`）·
`README.md` §The second axis（含实测：79 proven 中 78 无夹具；同环境 8 次运行 6 种指纹）·
`template/VISION.md`《判断力本身也要被判断》· `docs/PROTECTION.md` §第二根轴（承其"有名、能红"））

**人类原话**：*"用 phyt-DNA 完成类似测电仪的工作，让它可以测量诊断是否真'绿'与真'红'。"*

**问题**：现在的 gate 只报一维 —— `pass | block`。而这一维**无法区分四种状态**：

| | 真 | 假 |
|---|---|---|
| **绿** | **真绿**：过，**且能被证明会红**（有夹具且真的越阈） | **假绿**：过，但**没有夹具**（没人证明过它会不会红） |
| **红** | **真红**：红，且**理由可归因**（就是这个判据） | **假红**：红，但**理由不可归因**（工具用法错 / 缺前置 / **同命令两次不同答案**） |

**⇒ 第二根轴**：

```
verdict:  pass | block
validity: alive | unproven | unattributable | flaky
```

**★ 机械围栏（一句话，且是 P3 的推广）**

> **`pass` 单独不可报告 —— 必须是 `pass + alive`。**
> **"一组 gate 全绿而没有夹具" ⇒ 那不是绿，那是**未测量**。**

**本会话的四个实例（每个都真的烧过时间）**

| 实例 | 若不装测电仪会怎样 |
|---|---|
| harness 的手写 `CRITERIA-INVENTORY` | 计数是**自声明**（它自己都这么打印）⇒ **假绿**（P6/P7 已治） |
| `--probe` 无夹具 | `scanned:0` 却 `pass` ⇒ **假绿**（P3 已治） |
| `hit_targets` 的 `<44px` | **真红**（真发现）⇒ 不得转成 HELD |
| `run_cycle_pipeline` 的 flaky | **假红**（同命令两次不同答案）⇒ **既不是红也不是绿** |
| `layout_test` 的 `metaLines=null` | **不可归因**（没测到）⇒ 与"真红"不同 |

**⇒ 为什么这是 phyt-DNA 层面的（复利所在）**

**它把"信不信这个结果"从**人的判断**变成**gate 的属性**。
没有它，每个采用者都要**手写自己的 `proven/red/held/flaky` roster**（Cellrix 就是手写的，且它自己注明
"a count is not attributable"）。**⇒ 有了它，verdict 自带有效性 ⇒ 跨项目可比、可累积。**

**⚠️ 未做**：本条**只登记**。Cellrix 侧的雏形已存在（`flakyRoster` / `self-declared` 的 YELLOW /
`--probe` 的"闸门已腐化"），但**未统一成第二根轴**。

---

## 待人类裁决 · Cellrix `docs/VISION.md` 加一笔（**受封顶约束，故不由我擅动**）

phyt-DNA 侧已加（`template/VISION.md`）。**Cellrix 侧不同**：其 VISION 头部声明

> *"资产封顶（**〇–七共八节**）…后续新增概念必须采用**等量替换原则**"*

而"测电仪"属**概念层**（不是被豁免的意图层）⇒ **不能直接加节。**
**⇒ 我给等量替换的候选（供你选）**，任选其一：

1. **并入 §一「判据的宪法」**（Ω + A0 + T1 所在）—— 最贴：T1（可拒绝性）与"读数可信"是同族。
   拟加一句：*"T1 保证判据**可以拒绝**；本轴保证它的**拒绝/通过都可信**：`pass` 单独不可报告，必须是 `pass + alive`。"*
2. **并入 §四「判据文化」** —— 那里讲方法，改动最小。
3. **只留指针**（不新增概念）：在 §一 加一行指向 `docs/BACKFLOW-phyt-DNA-v2.md` 的 P11 与 `phyt-DNA/docs/MULTIMETER.md`。

**⇒ 我倾向 1**（并入 T1，是同一族的自然延伸，**不新增概念**）。

## 已回流一览（2026-10-09）

| 条 | 落到模板的哪一处 |
|---|---|
| P1 | `template/decisions/README.md` §双契约写法（H1 首行 + front-matter 紧随） |
| P2 | `template/tools/validate.sh` 顶部（`DECISIONS_DIR`/`FIXTURES_DIR`/`LEDGER_DIR` 可覆盖） |
| P3 | `template/tools/validate.sh`（零闸门 ⇒ `[BLOCK]` + exit 2） |
| P5 | `template/fixtures/README.md` §P5（目录名 = gate-id，脚本定位） |
| P6 | `template/ledger/README.md` §P6（环境由**探测**得到，绝不手写） |
| P7 | `template/ledger/README.md` §P7（`counts` 结构化） |
| **P11** | **`template/docs/MULTIMETER.md`**（第二根轴）+ `validate.sh`（probe 写账本 / `--probe-all` / `counter.sh`） |
| P4 · P8 · P9 · P10 | 未回流（P4 人类判 ⏸ 不排期；P8 需前置结构化引用；P9/P10 待裁决） |

**版本追溯**：`phyt-DNA/` 不是 git 仓 ⇒ 回流的**内容**以本册为准，**时点**以本仓 commit 为准。

---

## 如何进行一次反哺（**照做即可，不必回忆**）

```
1. 用 phyt-DNA 时撞到坑 ⇒ 在「上表」追加一条 P<N>（症状 + 证据 + 真实反例）
2. 标记人类裁决（✅ / ⚠️ / ⏸ / 🚫）—— **未裁决的不改模板**
3. 在 Cellrix 本地先落地并**跑通**（未跑通的不算，例如 claim-check/spec-lint/check-baseline 至今未移植）
4. 人类放行后，把「文本已备」的条目搬进 phyt-DNA 模板，并把本册该条改为 ✅ 已回流（附模板 commit）
```

**为什么这样不丢**：坑**发现时**登记 ⇒ 不必靠任何人记住；模板**回流时**回填 commit ⇒ 可追溯。

---
---
