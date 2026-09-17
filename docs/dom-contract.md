# DOM 契约清单

> **在动布局之前读这一页。**
>
> e2e 断言是 **DOM 断言**，而 F13 把「找不到元素」从 **FAIL 改成 SKIP**。
> 布局一改，断言找不到元素 ⇒ **静默 SKIP** ⇒ `49/0/1` 变成 `30/0/20`，
> **依然全绿**。这个陷阱被侥幸躲过一次；这一页是让它**不靠侥幸**。
>
> **本页由 `web/tests/dom_contract_scan.py` 生成**，并与 `dom_contract_test.js`
> 比对 —— 清单与源码不一致即红。手抄一份事实且永不校验，与手工重建 ADR 索引同形。

## 三类，三条规矩（**取最严**）

| 类别 | 规矩 | 判据 |
|---|---|---|
| **跨资产契约** | ❌ **冻结**，改名 = 运行期断链 | 被**声明处之外**的资产读取 |
| **测试判据** | ⚠️ **可改，断言必须同步改** | 出现在 **e2e** 里 |
| **纯样式钩子** | ✅ **随便改** | 无人按名字读取 |

**分类取最严**：同时命中多条时按 **跨资产 > 测试判据 > 纯样式** 归入最严的一档。
（初版分类互斥，`view-prove-track` 被 `prove_track.js` 读取却落进「可改」档。）

**id 与 class 都在册**：初版只扫 `id`，于是 `.foot` 与 `.e-trk-nm`
（**e2e 实际断言的两个 class**）被判成「随便改」—— 一个**没有阳性对照的否定性结论**。

## 一、跨资产契约（冻结）

| 名字 | 声明 / 读取处 |
|---|---|
| `.act` | session_list.js |
| `audit` | base.html, gleam.html |
| `.body` | chat.js |
| `btn-newchat` | session_list.js |
| `.btn:not(` | gleam.html |
| `.chat-input` | chat.html, chat.js |
| `chat-msgs` | chat.html, chat.js, session_list.js |
| `chat-side` | chat.html, session.html |
| `chat-text` | chat.html, chat.js, session.html, session_list.js |
| `conn` | base.html, script.html |
| `cont-banner` | chat.html, session_list.js |
| `eTbody` | prove_track.html, prove_track.view.js |
| `eco` | base.html, script.html |
| `.empty` | base.html, chat.html, chat.js, cockpit.html |
| `entries` | cockpit.html, cockpit.js |
| `episode` | cockpit.html, cockpit.js |
| `.fl-bar` | flows.html |
| `.inp` | chat.html, session_list.js |
| `mode` | base.html, script.html |
| `.nav` | base.html, script.html |
| `nledger` | cockpit.html, cockpit.js |
| `.nm` | flows.html, session_list.js |
| `resume-list` | chat.html, session_list.js |
| `.resume-opt` | session_list.js |
| `s-side` | base.html, prove_track.view.js, session.html |
| `.ses-edit` | session_list.js |
| `sub` | base.html, flows.html, script.html |
| `.t` | prove_track.html, session_list.js |
| `.tbl-scroll` | cockpit.html, gleam.html |
| `.tbl-shell` | cockpit.html, gleam.html |
| `.theme-switch` | base.html, script.html |
| `.think-body` | chat.js |
| `tick` | cockpit.html, cockpit.js |
| `.toast` | script.html |
| `view-flows` | base.html, flows.html |
| `view-prove-track` | base.html, prove_track.js, prove_track.view.js |
| `.who` | chat.js |

**两条非名字的跨资产契约**（同样冻结）：

| 契约 | 说明 |
|---|---|
| `script.html` 调 `__proveTrackLoad` | 占位符拼装后的全局入口名 |
| `selectPeriod` 驱动 `#s-side` | 选中一条经历 ⇒ 侧栏重绘 |

## 二、测试判据（可改，断言必须同步）

| 名字 | 声明处 |
|---|---|
| `.e-trk-nm` | prove_track.html |
| `eHint` | prove_track.html |
| `eInsp` | prove_track.html |
| `eInspX` | prove_track.html |
| `eOvNote` | prove_track.html |
| `eStats` | prove_track.html |
| `eTblVp` | prove_track.html |
| `eTraj` | prove_track.html |
| `.foot` | base.html |
| `v-` | — |
| `view-` | — |

**验证方式**（每次改布局后）：

```bash
./web/tests/ab_verify.sh     # 记下 RESULT 行
# 判据：skip 数不得增加。增加了 ⇒ 有断言被静默绕过，先修断言再继续。
```

## 三、纯样式钩子（随便改）

| 名字 | 声明处 |
|---|---|
| `.'` | flows.html, script.html |
| `.'ok'` | flows.html |
| `.'warn')` | flows.html |
| `.(r.status` | flows.html |
| `.+` | flows.html, script.html |
| `.200` | flows.html |
| `.:` | flows.html |
| `.===` | flows.html |
| `.?` | flows.html |
| `.b` | prove_track.html |
| `.badge` | base.html |
| `.bar` | base.html |
| `.btn` | base.html, chat.html |
| `.btn-ghost` | chat.html |
| `.btn-primary` | chat.html |
| `.c` | script.html |
| `.chat-col` | chat.html |
| `.chat-grid` | chat.html |
| `.chat-panel` | chat.html |
| `.clr` | prove_track.html |
| `cockpit-stats` | cockpit.html |
| `.dot` | script.html |
| `.e-btn` | prove_track.html |
| `.e-btn-primary` | prove_track.html |
| `.e-btn-sm` | prove_track.html |
| `.e-c-dur` | prove_track.html |
| `.e-c-st` | prove_track.html |
| `.e-c-tok` | prove_track.html |
| `.e-c-ty` | prove_track.html |
| `.e-eg` | prove_track.html |
| `.e-empty` | prove_track.html |
| `.e-insp` | prove_track.html |
| `.e-insp-bd` | prove_track.html |
| `.e-insp-hd` | prove_track.html |
| `.e-lane` | prove_track.html |
| `.e-legend` | prove_track.html |
| `.e-mini` | prove_track.html |
| `.e-ov` | prove_track.html |
| `.e-ov-hd` | prove_track.html |
| `.e-ov-t` | prove_track.html |
| `.e-scrim` | prove_track.html |
| `.e-scroll` | prove_track.html |
| `.e-search` | prove_track.html |
| `.e-sr` | prove_track.html |
| `.e-stats` | prove_track.html |
| `.e-tools` | prove_track.html |
| `.e-traj` | prove_track.html |
| `.e-trk` | prove_track.html |
| `.e-vp` | prove_track.html |
| `.e-wrap` | prove_track.html |
| `eCallBtn` | prove_track.html |
| `eDurBtn` | prove_track.html |
| `eDurLbl` | prove_track.html |
| `eEmpty` | prove_track.html |
| `eExportBtn` | prove_track.html |
| `eInspB` | prove_track.html |
| `eInspS` | prove_track.html |
| `eInspT` | prove_track.html |
| `eLaneInput` | prove_track.html |
| `eLaneModel` | prove_track.html |
| `eLaneTool` | prove_track.html |
| `eQ` | prove_track.html |
| `eQClr` | prove_track.html |
| `eReplayBtn` | prove_track.html |
| `eScrim` | prove_track.html |
| `eTblScroll` | prove_track.html |
| `eTurnBtn` | prove_track.html |
| `eWrap` | prove_track.html |
| `.esc(c.state)` | script.html |
| `.fl-badge` | flows.html |
| `.fl-body` | flows.html |
| `.fl-card` | flows.html |
| `.fl-empty` | flows.html |
| `fl-free` | flows.html |
| `fl-free-n` | flows.html |
| `.fl-item` | flows.html |
| `.fl-k` | flows.html |
| `.fl-list` | flows.html |
| `.fl-num` | flows.html |
| `fl-paid` | flows.html |
| `fl-paid-n` | flows.html |
| `.fl-pool` | flows.html |
| `fl-recent` | flows.html |
| `fl-route` | flows.html |
| `fl-route-badge` | flows.html |
| `.fl-row` | flows.html |
| `fl-stat-badge` | flows.html |
| `fl-stats` | flows.html |
| `.fl-v` | flows.html |
| `.head` | base.html, chat.html, cockpit.html, flows.html |
| `.ico` | prove_track.html |
| `.info` | base.html |
| `.input` | prove_track.html |
| `.k` | cockpit.html |
| `.kv` | flows.html |
| `.l` | prove_track.html |
| `.ledger` | cockpit.html |
| `ltScroll` | cockpit.html |
| `ltShell` | cockpit.html |
| `.model` | prove_track.html |
| `.mono` | flows.html |
| `.ok` | base.html, flows.html |
| `.on` | base.html |
| `.orb` | chat.html |
| `.panel` | chat.html, cockpit.html |
| `.prove-track-main` | base.html |
| `.r` | prove_track.html |
| `.row` | flows.html |
| `s-main` | base.html |
| `.sb` | prove_track.html |
| `.ses-side` | base.html, chat.html |
| `.sk` | session.html |
| `.sk-l1` | session.html |
| `.sk-l2` | session.html |
| `.small` | cockpit.html |
| `.sp` | prove_track.html |
| `.stat` | cockpit.html |
| `state` | base.html, script.html |
| `.stats-bar` | cockpit.html |
| `.tag` | base.html |
| `.tool` | prove_track.html |
| `.ts` | flows.html |
| `.v` | cockpit.html |
| `v-chat` | base.html |
| `v-cockpit` | base.html |
| `v-flows` | base.html |
| `v-prove-track` | base.html |
| `view-chat` | base.html |
| `view-cockpit` | base.html |
| `.view-head` | cockpit.html |

## 维护

- **重生成**：`python3 web/tests/dom_contract_scan.py`
- **校验**：`node web/tests/dom_contract_test.js`（清单 ≠ 扫描结果即红）
- **加新名字时**：被别的资产读取 ⇒ 冻结；被 e2e 读取 ⇒ 同步断言
