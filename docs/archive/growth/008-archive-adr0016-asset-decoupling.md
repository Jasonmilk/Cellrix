# Cellrix 生长记录归档 —— 证轨资产解耦（ADR-0016）

> **归档于 2026-09-15**：`docs/GROWTH.md` 规则为 ≤3 条，补记两处漏记时归档日期最早的两条。
> 历史永不删除 —— 以下为原文完整保留。

---

## [2026-09-14] 证轨资产解耦 —— 955 行红线违例清零 + 首字节缺陷修复（ADR-0016）

**变异类型**：膨胀控制——`web/assets/` 的**最后一个** 400 行红线违例（`prove_track.html` 955 行）按关注点拆为 5 资产

- `prove_track.css`（~281 行，样式层）/ `prove_track.html`（~79 行，骨架层）
- `prove_track.data.js`（~199 行，纯函数零状态）/ `prove_track.view.js`（~294 行，独占 `S`/`HAS`）/ `prove_track.js`（~143 行，事件绑定 + 对外接口）
- 跨资产经 `window.CxProveTrack` 命名空间桥接（沿用 ADR-0015 D14 `window.CxSession` 先例）；加载序 data→view→ctrl→`script.html` 为硬约束；`__proveTrackLoad/Clear` 名不变 → `script.html` 与 `main.rs` 调用点零改动
- 数据层纯函数化：`computeRepeats()` 原隐式消费闭包内 `S.session` → 显式入参 `computeRepeats(session)`（ADR-0016 D6）
- **同轮抓到并修复一个长期潜伏缺陷**：`base.html` 第 1 行残留 `        r#"`——从 Rust raw string 抽取资产时把开定界符连同行首缩进一并带入。后果：DOCTYPE 被挤出首位 → 浏览器 **quirks mode** + 页面顶部渲染字面量 `r#"`。顺带补上缺失的 `</head>`。既有测试只用 `contains` 断言、从不断言首字节，故长期未被发现
- **新增回归网**：`assert!(html.starts_with("<!DOCTYPE html>"))` + `assert!(!html.contains("__PROVE_TRACK"))`（占位符零残留）+ 四个新资产各一条落位断言

### 保真校验（物理事实）
- 逐段 diff 确认：搬移的代码与原文件**仅差那两处意图性改动**，其余全部原样
- `node --check` 三个 JS 资产语法全过；跨资产裸标识符调用扫描确认零未定义（告警均为 `:not(` / `var(--e-warn)` / 注释文本里的正则假阳性）
- 拼装复现：输出 144,728 字节，首字节 `<!DOCTYPE html>`；`__PROVE_TRACK` 占位符残留 **0**；`<style>`/`</style>` 4 对、`<script>`/`</script>` 8 对配平
- 加载序实测：data @69987 → view @79149 → ctrl @92940 → `__proveTrackLoad` **定义** @97786 → `script.html` **调用** @101031（定义早于调用 ✓）
- 既有 DOM 断言全过（`id="eTblVp"` / `id="eLaneInput"` / `id="eInsp"` / `__proveTrackLoad` 等）

### 验收
- `cargo test --no-fail-fast` = **341 passed / 0 failed / 4 ignored**，与解耦前逐项一致（零回归）
- 全部 `web/assets/` 资产 ≤400 行达成（最大 `components.html` 351）
