# 死亡证明前置清单（D1/D2/D3 各自的红与绿）—— 2026-11-05

> 这不是结论，是**前置条件**：`DEATH-CERT-standalone-webui.md:12` 规定三层各自可红。
> 本文件只登记"哪条判据、在哪个文件哪一行、反样本是什么、读数是多少"。

| 层 | 判据文件:行 | 反样本（命令形状） | 实测读数 |
|---|---|---|---|
| **D1 线层** | `tools/d1_d2_check.js:25`（判定在 `:48`） | 从 tape 里删掉 `turn/end` 再跑 | `RED D1: 末条不是 RUN_FINISHED` · rc=1 |
| **D2 语义层** | `tools/d1_d2_check.js:34`（判定在 `:49`）· schema 快照 `docs/observations/agui-1.0-min.schema.json`（pinned `agui-1.0-min/2026-11-05`） | 喂一份 `metadata:{verdict,criteria}` 的 AG-UI 事件（`--agui` 模式） | `RED D2: RUN_FINISHED metadata 出现未钉定键: criteria` · rc=1 |
| **D3 渲染层** | `tools/d3_compare.js:42`（对照物缺失即不可量）· 对照表 `docs/observations/d3-baseline.json`（web sha `269f2b7e`） | 删掉 baseline；以及 L2 案卷删 `unselected_reason` | baseline 缺失 ⇒ `UNMEASURABLE` rc=4 · L2 静默缺项 ⇒ `RED` rc=1 |

## 两条"不是等价"的具名声明（不许读成等价）

```
① D2 的"钉定版本参考 SDK" → 实际用的是 **schema 快照**（官方 SDK 未装）
   替代已具名：能保证"必填键齐 + metadata 只许 verdict"，不能保证"SDK 语义一致"
② D3 的"自家 renderer 逐项对照等价" → 实际比的是 **字段级** 6 项
   （4 项对得上 + 2 项具名缺口），不是像素级等价
```

## D3 的关键一条（t1 已验证）

```
web 源码不可读（mv web/assets/prove_track.js）时：d3_compare 仍 rc=0，6 行对照不变，baseline sha 269f2b7e
baseline 缺失时：UNMEASURABLE rc=4（不允许 L2 自算一份对照物）
⇒ 对照物已离线化 ⇒ "拆掉 web 后 D3 仍可判"成立
```

## 仍未满足的前置（所以证书仍是**预签发**）

```
D1/D2/D3 各有红 ✔ ； 但 D3 的 6 项里 2 项是**具名缺口**（候选边 / 未选原因 tape 未记录）
⇒ 缺口补法走门（给 anaphase 事件加字段 = 改外部契约），本轮不动
```
