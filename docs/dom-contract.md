# DOM 契约清单

> **在动布局之前读这一页。**
>
> e2e 断言是 **DOM 断言**，而 F13 把「找不到元素」从 **FAIL 改成 SKIP**。
> 布局一改，断言找不到元素 ⇒ **静默 SKIP** ⇒ `49/0/1` 变成 `30/0/20`，
> **依然全绿**。这个陷阱被侥幸躲过一次；这一页是让它**不靠侥幸**。
>
> 本页由 `web/assets/` 与 `web/tests/all_views_test.js` **扫出来**，不是凭记忆写的。

## 三类，三条规矩

| 类别 | 规矩 | 判据 |
|---|---|---|
| **跨资产契约** | ❌ **冻结**，改名 = 运行期断链 | 被**另一个资产**（`script.html` / `*.js`）读取 |
| **测试判据** | ⚠️ **可改，断言必须同步改** | 出现在 **e2e** 里 |
| **纯样式钩子** | ✅ **随便改** | 只服务 CSS，无人读取 |

## 一、跨资产契约（冻结）

**这些 id 被另一个资产读取** —— 改名会让那个资产静默失效（不报错，只是不工作）。

| id | 声明 / 读取处 |
|---|---|
| `audit` | base.html, gleam.html |
| `chat-msgs` | chat.html, chat.js, session.html |
| `chat-side` | chat.html, session.html |
| `chat-text` | chat.html, chat.js, session.html |
| `conn` | base.html, script.html |
| `cont-banner` | chat.html, session.html |
| `eco` | base.html, script.html |
| `entries` | cockpit.html, cockpit.js |
| `episode` | cockpit.html, cockpit.js |
| `fl-free` | flows.html |
| `fl-free-n` | flows.html |
| `fl-paid` | flows.html |
| `fl-paid-n` | flows.html |
| `fl-recent` | flows.html |
| `fl-route` | flows.html |
| `fl-route-badge` | flows.html |
| `fl-stats` | flows.html |
| `mode` | base.html, script.html |
| `nledger` | cockpit.html, cockpit.js |
| `resume-list` | chat.html, session.html |
| `state` | base.html, script.html |
| `sub` | base.html, script.html |
| `tick` | cockpit.html, cockpit.js |
| `view-flows` | base.html, flows.html |

**另有两条非 id 的跨资产契约**（同样冻结）：

| 契约 | 说明 |
|---|---|
| `script.html` 调 `__proveTrackLoad` | 占位符拼装后的全局入口名 |
| `selectPeriod` 驱动 `#s-side` | 选中一条经历 ⇒ 侧栏重绘 |

## 二、测试判据（可改，断言必须同步）

**改这些 id 时，`web/tests/all_views_test.js` 必须一起改。**
**否则它们不会被报红，只会被 SKIP 掉** —— 而 skip 数不增加的话，
`RESULT` 行看起来完全正常。

| id | 声明处 |
|---|---|
| `e-trk-nm` | — |
| `eInsp` | prove_track.html |
| `eInspX` | prove_track.html |
| `eOvNote` | prove_track.html |
| `eStats` | prove_track.html |
| `eTblVp` | prove_track.html |
| `eTbody` | prove_track.html |
| `foot` | — |
| `s-side` | base.html, session.html |
| `view-prove-track` | base.html, prove_track.js |

**验证方式**（每次改布局后）：

```bash
./web/tests/ab_verify.sh          # 记下 RESULT 行
# 判据：skip 数不得增加。增加了 ⇒ 有断言被静默绕过，先修断言再继续。
```

## 三、纯样式钩子（随便改）

只服务 CSS 的 class / id。改这些**不影响任何断言与资产**。

**class 为主**（如 `.ses-item` / `.e-traj` / `.fl-row`）——
它们不进本清单，因为无人按名字读取。

## 维护

**加新 id 时**：若它被另一资产读取 ⇒ 进第一类；若被 e2e 读取 ⇒ 进第二类。
**改布局前**：先跑 `ab_verify.sh` 记下 skip 基线，改完再跑一次对比。
