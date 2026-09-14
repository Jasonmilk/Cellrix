# ADR-0016: 证轨资产解耦（prove_track.html 955 → 5 资产）

- **状态**: Accepted
- **日期**: 2026-09-14
- **关联**: ADR-0015（D8 资产化拼装 / D9 400 行模块化 / D11 组件资产层 / D14 会话域拆分）、ADR-0037（术语更名 Engram → ProveTrack）、`docs/DNA.md` 铁律 2

## 1. 背景与问题

`web/assets/prove_track.html` 经 ADR-0037 更名后仍为 **955 行**，是 `web/assets/` 下**唯一违反 DNA 铁律 2**（单个文件不超过 400 行）的资产——其余 9 个资产最大 351 行。

该文件是三段式堆叠：样式 283 行（7–289）+ 骨架 79 行（291–369）+ 脚本 585 行（371–955）。脚本内部本身已有清晰的分层分节横幅（数据层 / 状态 / 数据构建 / 统计 / 表格 / 三轨 / 遮挡自证 / 模态性 / 检查器 / 重放 / 事件绑定 / 涟漪 / 对外接口），但全部挤在同一个 IIFE 里。

同时，本轮核对发现一个**独立缺陷**：`web/assets/base.html` 第 1 行残留 `        r#"`。

- 证据：按 `index_html` 的 replace 链确定性重放，输出 141,466 字节，前 40 字节为 `        r#"<!DOCTYPE html>\n<html lang="z`，`<!DOCTYPE html>` 位于**第 11 字符**（不在首位）。
- 根因：`base.html` 是从 `let base = r#"..."#;` 这段 Rust raw string 中抽出的资产，抽取时把 raw string 开定界符 `r#"` 连同行首缩进一并带入了文件；`include_str!` 原样读入，replace 链不触碰首部。
- 后果：① 浏览器收到 DOCTYPE 不在首位 → 进入 **quirks mode**；② 页面顶部渲染出字面量 `r#"`。
- 长期未被发现的原因：`web/src/main.rs` 的 `index_html_contains_both_views_and_prove_track_fields` 只用 `html.contains("…")` 断言，从不断言首字节；此前的 live 验收同样使用 DOM 选择器断言，不覆盖首字节。

## 2. 决策

### D1: 按关注点切分为 5 个资产（而非按行数均分）

| 资产 | 角色 | 来源行 | 行数 |
|---|---|---|---|
| `web/assets/prove_track.css` | 样式层（`e-` 令牌 / 双主题 / 降级阶梯） | 7–289 | ~281 |
| `web/assets/prove_track.html` | 骨架层（`e-wrap` / `e-traj` / `e-insp` / `e-scrim`） | 291–369 | ~79 |
| `web/assets/prove_track.data.js` | 数据层（词表 / 事件→呈现映射 / 格式化 / `buildSession` / `computeRepeats`） | 374–581 | ~208 |
| `web/assets/prove_track.view.js` | 视图层（状态 `S`/`HAS` + 渲染 + 遮挡自证 + 检查器 + 重放） | 583–827 | ~245 |
| `web/assets/prove_track.js` | 控制层（事件绑定 + 涟漪 + 对外接口） | 829–953 | ~125 |

切分依据是**关注点**，不是行数。DNA 铁律 2 的表述是「HTML/CSS/JS 视图内容落入独立资产」——样式与骨架天然属于两个不同关注点，故不合并。

### D2: 跨资产经 `window.CxProveTrack` 命名空间通信

沿用 ADR-0015 D14 已确立的先例（`script.html` 504 → 拆出 `session.html`，跨资产用 `window.CxSession` 桥接各自 IIFE）。每个资产仍是独立 IIFE，以 `window.CxProveTrack = window.CxProveTrack || {}` 递增装配，不引入模块加载器、不引入构建步骤。

**对外接口名保持不变**：`window.__proveTrackLoad` / `window.__proveTrackClear` 一字不改，故 `script.html` 与 `main.rs` 的 `selectPeriod` 调用点**零改动**。

### D3: 加载序硬约束（data → view → ctrl → `__SCRIPT__`）

`prove_track` 的三个 JS 资产必须排在 `__SCRIPT__` **之前**。理由：`script.html` 的 `selectPeriod` 会调用 `window.__proveTrackLoad`，若定义晚于 `script.html` 的执行，即复现 ADR-0015 D14 记录过的 noop 时序 bug（当时 `toggleResume` 就栽在这里）。

骨架资产位置不变（仍在 `#s-main` 内），故控制层 IIFE 执行时骨架 DOM 已就绪——原文件在加载期就执行的 `initEdges(...)` 与一批 `addEventListener` 时序语义不变。

### D4: 新资产使用真扩展名 `.css` / `.js`

`include_str!` 与扩展名无关，机制零改动。内容是什么，扩展名就是什么（物理事实优先）。这与目录内既有的 `tokens.html`（实为 CSS）、`gleam.html`（实为 JS）形成命名不一致——该不一致是历史遗留，本轮不回溯改名，仅新增资产按内容命名。

### D5: 同轮修复 `base.html` 首字节残留

删除 `base.html` 第 1 行的 `        r#"` 前缀，并在 `index_html_contains_both_views_and_prove_track_fields` 中补一条 `assert!(html.starts_with("<!DOCTYPE html>"))` 作为首字节回归网。既有 `contains` 断言全部保留。

### D6: 数据层纯函数化

`computeRepeats()` 原隐式消费闭包内的 `S.session`，拆分后改为显式入参 `computeRepeats(session)`。`buildSession(events, meta)` 本已是纯函数，不动。数据层因此成为**零状态纯函数层**，可独立测试、可被其他视图复用（复用性对齐 DNA 原则 6）。

### D7: 本次不做

- 不改任何行为、不改任何视觉、不改任何线协议或 API 契约——纯结构搬迁。
- 不回溯改名 `tokens.html` / `components.html` / `gleam.html` / `script.html` / `session.html`（命名不一致属历史遗留，另议）。
- 不把证轨组件沉淀到 lumtract（ADR-0015 D14 曾把会话组件沉淀为 `lumtact-sessions.css`；证轨组件沉淀是独立议题）。
- 不引入模块加载器 / 打包器 / 构建步骤（DNA 原则 2 极致解耦 + 零构建依赖）。

## 3. 备选方案与拒绝理由

| 备选 | 拒绝理由 |
|---|---|
| 维持 955 行单文件 | 直接违反人类批准的红线（DNA 铁律 2）；后续每次改动都在膨胀 |
| 按行数均分成 3 份（各 ~318 行） | 行数达标但关注点混杂——样式/骨架/逻辑被割裂在同一文件，解耦是形式而非实质 |
| 样式+骨架合一（362 行）+ JS 二分 | 可行且改动面更小，但 362 行贴着红线，加一条样式规则即再越线；且违背「HTML/CSS 各自独立资产」的表述 |
| 引入 ES Module / 打包器做真模块化 | 引入构建期依赖，违背零构建依赖与极致解耦；现有 IIFE + 命名空间桥已足够 |
| `base.html` 首字节缺陷另开一轮 | 本轮本就要改 `base.html` 接线，同轮修复可让提交说明自洽；缺陷影响 quirks mode，不宜久留 |

## 4. 后果

- **正面**：`web/assets/` 全部资产 ≤400 行，红线达成；样式/骨架/数据/视图/控制五层可独立演进与独立测试；数据层纯函数化后具备复用价值；quirks mode 缺陷消除。
- **代价**：资产数量 10 → 13；跨资产调用需经命名空间，比闭包内直呼略长（`PT.renderTable()` vs `renderTable()`）；多一层间接是解耦的必然成本，与 ADR-0015 D14 的取舍一致。
- **不变式（验收条件）**：
  1. `cargo test --no-fail-fast` 341 passed 不变；
  2. live 页面既有 DOM 断言全部继续通过（`id="eTblVp"` / `id="eLaneInput"` / `id="eInsp"` / `__proveTrackLoad` 等）；
  3. `__PROVE_TRACK__` 占位符在输出中计数为 0（装配链成立）；
  4. 输出首字节为 `<!DOCTYPE html>`；
  5. `#view-prove-track` 作用域与 `data-theme` 双主题在样式搬迁后仍生效（令牌未外泄到全局）。

---

*ADR 是记忆不可篡改在工程层的投射。*
