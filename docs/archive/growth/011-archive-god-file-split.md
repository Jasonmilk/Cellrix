# 归档：GROWTH 第 3 条（2026-09-14）

> 由 `docs/GROWTH.md` 于 2026-09-16 移入：本文件只保留最近 3 次快照。

## [2026-09-14] 消除上帝文件 —— 四视图共用逻辑按域拆分（阶段 1）

**变异类型**：膨胀控制 —— `script.html`（323 行，四视图共用的上帝文件）按域拆分。
本轮只做「消除上帝文件」，不动视图划分与视觉。

- **视图清单数据驱动**：`showView` 遍历 `.nav [data-view]`，删掉硬编码的视图清单
- **进入钩子自注册**：`Cx.onEnter(name, fn)`，视图资产不再被 `script.html` 反向依赖
- **按需驱动**：`tick` 只更新状态行，渲染交给 `Cx.Cockpit.render`
- 新增资产 `chat.js`（对话域，从 `script.html` 逐字搬出）、`cockpit.js`（态势域）；
  `base.html` 去 inline onclick 改 `data-view`，script 序接入两新资产；
  `main.rs` 补两个 `include_str!` 与 replace
- **拼装测试升级为派生式占位符扫描**：从 `base.html` 扫 `__NAME__` 逐个断言未残留，
  并断言 `checked >= 16` **防空转**

**规模**：`script.html` 323 → 145 行。

### 验收（A/B 全绿，与拆分前逐项一致）

- `cargo test` 108 passed / 0 failed
- `all_views_test.js` 50 passed ／ `verify_live.py` 50 passed
- `coupling_audit.py` 0 unresolved coupling

**边界**：标为「阶段 1」，后续阶段未做。
