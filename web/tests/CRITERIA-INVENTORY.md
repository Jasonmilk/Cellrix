# 判据 ↔ 变异证明 对照表（分母，不是分数）

**为什么存在**：`21 proven` 报告的是**判据结果**,不是**验证覆盖率**。
"规则没被触发"与"规则被满足"**不可分辨**——与 XPASS 那一课同形。
**哨兵证明的是"机械装置会响",不是"每条判据会响"。**

**三档（互斥）**
- **`paired`** —— 有变异证明：**弄坏被断言的对象 ⇒ 该判据必须红**（并记下是哪个变异）。
- **`unpaired`** —— 判据存在但**没有被变异过** ⇒ **欠账**（不是已证）。
- **`document`** —— **文字/设计主张，不可变异** ⇒ **不是判据，不进已证清单**。

> 引工具（Stryker / cargo-mutants）之前必须先有这个分母：不知道分母时引入工具
> 只会得到**无法解读的数字**;且 *equivalent mutant* 会造成**假低分**。

## `paired`（有变异证明）

| 判据 | 变异 | 结果 |
|---|---|---|
| 派生必须真的跑起来 | `chain-env` 整体失效 | 红 ✓ |
| 派生必须吐出**每一个**已声明 env | 丢掉 `ANAPHASE_MIND_ENDPOINT` | 红 ✓ |
| 已提交 manifest 必须最新 | 同上 | 红 ✓ |
| 消费者**零**声明端口字面量 | 塞回 `PORT_TUCK=60052` | 红 ✓ |
| 读取器正例控件（独立 fixture） | 独立 fixture 不可读 | 红 ✓ |
| 集合错 ≠ 读取器坏（两者可分辨） | 套件 `REQUIRES` 全注释 | 红 ✓ |
| deferral 必须声明 `depends_on` | 删掉该字段 | 阻断 ✓ |
| `expiry` 必须可解析且未过期 | 改成 `2020-01-01` | 阻断 ✓ |
| `retirement_plan` 机器可检 | 换成空话 | 阻断 ✓ |
| `requires` 必须有 owner | 删掉 owner | 阻断 ✓ |
| pending 条目结构完整 | 删 `retirement_plan` | exit 3 ✓ |
| 哨兵声明集非空 | 清空 | exit 3 ✓ |
| 哨兵声明 ↔ 目录**双向 join** | ①attach `layout_test.js` ②放 `sneaky.js` | 两向皆红 ✓ |
| SENTINEL_RED 必须被报出 | （对照即证明） | `RED ROSTER` ✓ |
| SENTINEL_RED **不得**改变退出码 | 哨兵失败时整轮仍 exit 0 | ✓ |
| SENTINEL_HELD 不得进红灯名单 | 对照即证明 | ✓ |
| XPASS：deferral 意外通过 ⇒ 红 | 指向会通过的 `pt_replay.js` | exit 3 ✓ |
| XPASS 必须有正证据（缺席≠通过） | 指向**从未被执行**的套件 | 0 条 XPASS ✓ |
| 围栏：**越界**即红 | 改 `README.md` 内容 | 红 ✓ |
| 围栏：**遗漏**只告警不焊门 | 改管辖内文件、ADR 未变 | WARN + exit 0 ✓ |
| 变异夹具：空夹具必须作废 | `touch`（无内容变更） | `MUTATION VOID` ✓ |
| 变异夹具：哨兵自身会死 | 前置守卫改 `if false` | `SENTINEL DEAD` exit 1 ✓ |
| 无条件恢复（`trap`） | assert 故意失败 | 文件仍被恢复 ✓ |
| 前置断言验**目标 sha** 而非数量 | 内容变更 | `[precondition ok]` ✓ |
| oracle 缺失 fail-closed | 仓根不可声明 | `NEEDS-INPUT` exit 3 ✓ |

## `unpaired`（**欠账**，不是已证）

| 判据 | 为什么欠 |
|---|---|
| `prove_track_nodes_test` 的 deferral 分类 | 只证明过它 held；**没有**反向证明"它可用时必须 XPASS"（XPASS 是用**别的**套件证明的） |
| `RED ROSTER` 会列出**真实**测试红（非哨兵） | 哨兵覆盖的是哨兵路径;**真红的名单化未被变异**（当时我明确标了"未配对"） |
| 围栏的 `VACUOUS` 分支 | 未变异 |
| 围栏的**基准 pinned** | **未实现**（基准仍是 `git status`，一次 commit 即抹掉差异、围栏静默失效） |
| 遗漏 WARN 的**排空条件** | 未实现（ADR 冻结时升红） |
| `inputSha` 的**内容**哈希 | 现为"名字+大小",同大小改动看不见;规范化未配 known-bad |
| `pinned:1/22` 的覆盖面 | 只钉住 1 条,其余 21 条**共享可变输入未扫** |

## `document`（**不是判据**）

| 内容 | 为什么不可变异 |
|---|---|
| ADR-0048 §1 的 A/B/C/D 四条不变量 | 设计主张;其中 A 的可执行形态（4a）**尚未实现** |
| ADR-0048 §1.4「同一问题同数字」（4b） | **登记为 held**——需 CDP Accessibility domain,本环境缺席 |
| ADR-0048 §2 管辖权「扩展而非建立」 | 文字裁定 |
| ADR-0048 §1.3 CI-144 的 intent 边界 | 边界声明 |
| 巨人路径（ArchUnit / TanStack / Bazel / Nix …） | 参照，非本仓判据 |
| `_why` 类元说明字段 | 元数据 |


## 裁定（显式，不留隐式默认）

**表不可读 ⇒ exit 3（阻断）。** 理由：**表不可读是 oracle 缺失**,与本门已经阻断的
`git` 不可用**同类**（`an unusable oracle is not an empty change set`）。
**同一类缺失不能有两个相反的默认。**

**本表目前是手写的** ⇒ `unpaired:N` 是**自报数**（结论行已标 `self-declared`）,
结构上**仍是"陈述强于证据"**。
**出路（未做）**：harness 输出 **TAP13 / JUnit XML**,表由**解析器生成** ⇒
**从此不可能与运行结果不一致**,且 `paired` 档**天然不可手填**;
更远一步是 **in-toto / SLSA provenance**——**表即判据的出处证明**。

## 用法

- **`paired` 才可以被称作"已证"**;`unpaired` 一律**欠账**;`document` **不进已证清单**。
- 每次新增判据：**出生即须配对**（`new-criteria-born-paired`）;
  未配对而先落地的，**必须登记进 `unpaired`**。
- 本表**人工维护**（目前如此）;待分母稳定后再考虑工具（Stryker / cargo-mutants）,
  并注意 *equivalent mutant* 的**假低分**。
