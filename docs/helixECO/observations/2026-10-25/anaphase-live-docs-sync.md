# 文档面同步 · patch 文本（供人签署；**未改任何既有文件**）· 2026-10-25

> 上游改动：`Cellrix` commit `6d67476` —— `transport/tests/anaphase_live.rs` 摘 `#[ignore]`、端口改从 `anaphase-helix/ecosystem/chain.json` 读（`components[name=anaphase].port`）、三态分流（可达即真跑 / 不可达 `NEEDS-INPUT` / `ANAPHASE_REQUIRED=1` 则红）。
> 本文**只给 patch 文本与事实**；签署后由人逐段应用。**数字全部来自本轮命令，未从任何文档摘抄。**

## 零、本轮实测事实（可复跑）

```bash
cd Cellrix
grep -c '127.0.0.1:50061' transport/tests/anaphase_live.rs   # ⇒ 0
grep -c '#\[ignore'         transport/tests/anaphase_live.rs   # ⇒ 0
grep -c 'ANAPHASE_REQUIRED' transport/tests/anaphase_live.rs   # ⇒ 4
python3 -c "import json;d=json.load(open('../anaphase-helix/ecosystem/chain.json'));print([c['port'] for c in d['components'] if c['name']=='anaphase'])"
# ⇒ [50061]
```
⇒ 测试**不再有 `#[ignore]`、不再有字面端口**；anaphase 端口仍 **50061**（真值源 `chain.json`）。

## 一、三处 patch（blob SHA + 原行 + 建议行）

### 1) `README.md:134` — blob `05e4af4f86280128…`
```diff
-- cockpit live roundtrip: `transport/tests/anaphase_live.rs` (#[ignore], needs live Anaphase)
++ cockpit live roundtrip: `transport/tests/anaphase_live.rs` (三态：可达即真跑；不可达 NEEDS-INPUT；`ANAPHASE_REQUIRED=1` 则红)
```

### 2) `docs/decisions/ADR-0009.md:46` — **该行号不成立**
`sed -n '46p' docs/decisions/ADR-0009.md` **打印为空**，且该文件**不存在**（`git rev-parse HEAD:docs/decisions/ADR-0009.md` 失败）。
**真实文件** = `docs/decisions/ADR-0009-cockpit.md:46`（`sed` 非空；**blob `89623ace6ab669da`**）：
```diff
-- live：`tests/anaphase_live.rs`（#[ignore]，真实 Anaphase cap_http 50061）
++ live：`tests/anaphase_live.rs`（三态：可达即真跑 / 不可达 NEEDS-INPUT / `ANAPHASE_REQUIRED=1` 则红；端口取自 chain.json，非字面 50061）
```
★ 该文件属 `*/decisions/**` ⇒ **本轮只读**，建议文本交人签署。

### 3) `docs/decisions/ADR-0048.md:5198` — **该行号不成立**
`sed -n '5198p' docs/decisions/ADR-0048.md` **打印为空**，且该文件**不存在**。
**真实文件** = `docs/decisions/ADR-0048-panel-state-owner-and-render-contract.md:5198`（`sed` 非空；**blob `187b31475e4af0b1`**）：
```diff
-| `:50061` | `Cellrix/transport/tests/anaphase_live.rs:11`（`ANAPHASE_ENDPOINT` 默认） | ✅ A
+| `:50061`（来自 `anaphase-helix/ecosystem/chain.json` 的 `components[name=anaphase].port`） | `transport/tests/anaphase_live.rs`（`ANAPHASE_ENDPOINT` 可覆盖；`ANAPHASE_REQUIRED=1` 可令断上游必红） | ✅ A
```

## 二、全仓扫描（命令原文 + **全部 25 行**命中）

```bash
cd Cellrix && grep -rn '#\[ignore\]\|50061' --include=*.md .   # ⇒ 25 行
```

| # | 命中（文件:行） | 分类 |
|---|---|---|
| 1 | `docs/archive/growth/006-record-oldest.md:211`（anaphase_live.rs `#[ignore]`） | **陈旧描述**（历史档案；当时真，现已不真） |
| 2 | `docs/archive/growth/006-record-oldest.md:212`（`50061` 命令行） | 描述现状 |
| 3 | `docs/archive/growth/006-record-oldest.md:227`（**ci144** … `#[ignore]`） | **描述现状**（`ci144_anaphase_live.rs` 本轮未动、仍有 `#[ignore]`） |
| 4 | `docs/archive/growth/006-record-oldest.md:234`（"319 tests + 1 live `#[ignore]` 新增"） | **陈旧描述**（历史档案，指代不明，建议不改） |
| 5 | `docs/archive/growth/006-record-oldest.md:499`（daemon 50061） | 描述现状 |
| 6 | `docs/decisions/ADR-0046-panel-port-must-not-collide-with-llama-cpp.md:35` | 描述现状（端口表） |
| 7 | `docs/decisions/ADR-0048-…-render-contract.md:5198` | **陈旧描述**（称 `anaphase_live.rs:11` 是 `ANAPHASE_ENDPOINT` 默认） |
| 8 | `docs/decisions/ADR-0048-…-render-contract.md:5312` | 描述现状（端口表） |
| 9 | `docs/decisions/ADR-0048-…-render-contract.md:11011` | 描述现状（端口清单） |
| 10 | `docs/decisions/ADR-0009-cockpit.md:46` | **陈旧描述**（称 live 测试 `#[ignore]`） |
| 11 | `docs/decisions/ADR-0009-cockpit.md:69` | 描述现状（live 验证记录） |
| 12 | `docs/decisions/ADR-0009-cockpit.md:71` | 描述现状（CLI 命令） |
| 13 | `docs/decisions/ADR-0047-e2e-sealing-and-controls.md:41` | 描述现状（JSON 样例） |
| 14 | `docs/decisions/ADR-0014-web-panel.md:28` | 描述现状（CORS 事实） |
| 15 | `docs/decisions/ADR-0014-web-panel.md:41` | 描述现状（cap_http **协议**默认） |
| 16 | `README.md:134` | **陈旧描述**（称 `#[ignore]`） |
| 17 | `README.md:135`（`tuck_audit_client.rs live_fetch_from_real_gateway` `#[ignore]`） | **描述现状**（另一个测试仍 `#[ignore]`） |
| 18 | `README.md:303` | 描述现状（CLI 命令） |
| 19 | `README.md:306` | 描述现状（CLI 命令） |
| 20 | `README.md:326`（**ci144** `#[ignore]`） | **描述现状**（ci144 未动） |
| 21 | `README.md:328`（`--anaphase-endpoint` 默认 50061） | 描述现状（**CLI** 默认，非测试字面） |
| 22 | `README.md:350` | 描述现状（同上，注明协议默认） |
| 23 | `README.md:357` | 描述现状（已验证记录） |
| 24 | `README.md:395` | 描述现状（状态点清单） |
| 25 | `README.md:498` | 描述现状（CLI 命令） |

★ **本文件自身**也含 `50061` 与 `#[ignore` 字样（patch 文本）⇒ 复跑该 grep 时会多出本文件的行 ⇒ **分类为"描述现状/元叙述"**（它是在**描述**那些命中，不是声明测试现状）。这是"讲解性引用"的同一族，已在 helix-mind 的目录契约里具名登记。

## 三、两个实数

- **陈旧描述处数 = 5**（#1 archive:211 · #4 archive:234 · #7 ADR-0048:5198 · #10 ADR-0009-cockpit:46 · #16 README:134）
- **描述现状处数 = 20**（其余 20 行；其中 #3/#17/#20 是**另一个仍 `#[ignore]` 的测试**、#15/#21/#22 是**协议/CLI 默认**，都仍然为真）

⇒ 签署建议：**只改 #16（README，本轮可改范围外但仍只读）· #10 · #7** 三处（对应上文三段 patch）；**#1/#4 属历史档案，建议不改**（改历史 = 伪造记录）。
