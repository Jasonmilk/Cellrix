# Cellrix 生长记录归档 —— 证轨状态栏真值 + 资产语言统一（ADR-0038 / ADR-0017）

> **归档于 2026-09-15**：`docs/GROWTH.md` 规则为 ≤3 条，补记两处漏记时归档日期最早的两条。
> 历史永不删除 —— 以下为原文完整保留。

---

## [2026-09-14] 证轨状态栏真值 + 资产语言统一（ADR-0038 / ADR-0017）

**变异类型**：①证轨状态栏三个恒 `—` 的计量格（TOKENS / 缓存命中 / 输入 TOK）接入真实数据源；②证轨五资产语言对齐（源码与界面文案一律英文）

- `web/assets/prove_track.data.js`：新增纯函数 `derivePeriodUsage(events)` —— 从事件流派生本周期计量，零状态、可重放、零模型调用。三条口径：①不相交计数 `输入 = prompt − cached`（上游 `prompt_tokens` 含缓存命中，直接展示会重复计数）②可选桶全有或全无 ③缺失即省略，永不折算估算。同时 `fmtTok` 修正为区分「缺失」与「0」（原实现把 `0` 当假值显示成 `—`，本身即造假占位）。
- `web/assets/prove_track.view.js`：`S` 新增 `usage` 槽位；统计栏三格填真值。**不加第 9 格、不碰 CSS** —— `.e-stats` 是 `repeat(8,1fr)` 正好 8 格配平，加格会破坏版式。
- `web/assets/prove_track.js`：装载时算好派生结果写入 `S.usage`，清空时归位 `null`。
- **零渲染成本**：`assistant/usage` 不进 `TYPES` 映射，`buildSession` 自动跳过 → 不污染轨迹表；且 `dur` 改为「相邻**渲染**事件」的时间差（否则计量事件会挤进时间差基准，把既有耗时算塌）。
- **派生结果只留被消费的字段**：`derivePeriodUsage` 初版带 `models` 数组（去重收集本轮调用过的模型名），核查后确认**全仓零消费点** —— 模型名实际由逐事件的 `data.model` 呈现（`summarize` 的 `[model]` 标签、会话/脚本页的 `addReplyMsg(text, model)`），聚合层再存一份是重复真相源，故删除。
- 验证：用真实 live 事件文件在 node 下回放数据层，**28 项断言全绿**（不相交口径 / 全有或全无 / 畸形记录拒收 / `fmtTok` 语义 / 计量事件不扰动 `dur` / REPLY 行承载周期总量 / 已删字段确实不在结果里）。
- `web/assets/prove_track.data.js` 同步转为全英文（注释 + 界面文案），落实「源码与注释用英文」约定；CJK 扫描残留 0。

### 证轨五资产语言统一（ADR-0017）

- **问题**：上一条只落到了 `data.js`。data.js 的 `STATUS.t`（`success/failure/pending/done`）、`SCHEMA_NOTE` 11 条事件说明、`summarize`/`resultOf` 产出全部英文，而 view / ctrl / html / css 仍中文 → **同一屏中英混排**（事件表状态列英文 `success`，紧邻的统计栏标签却是「缓存命中」）。混排比全中文更差：同一界面的两个投影用两套词汇，且无处可作为「证轨该用什么语言」的权威。
- **范围**：证轨**五资产一次改齐**（`css` / `html` / `data.js` / `view.js` / `js`）。**不扩散**到 `base.html` 外壳与 `session.html` / `script.html` / `flows.html` 其他视图 —— 它们的中文是产品既定语言，另行裁决。
- **方向**：向数据层**对齐**，不回退数据层（data.js 的英文产出是先例，保持不动）。
- **方法**：逐条「原串 → 新串」精确替换，**每一对落盘前断言恰好命中一次**（0 次 = 目标已变或写错，>1 次 = 目标不唯一），全部通过才写文件。拒绝 CJK 正则批量替换 —— 会误伤代码与既有英文注释里的中文标点，且无法逐条证伪。
- **术语对照**（跨资产一致）：轮次 turn ｜ 摘要 summary ｜ 状态 status ｜ 耗时 duration ｜ 缓存命中 cache hit ｜ 输入 TOK input TOK ｜ 重放 Replay/Replaying ｜ 等宽·实际耗时 equal width·actual time ｜ 描边·脉冲 outline·pulse ｜ 连续卡住 stuck streak ｜ 占全程 share ｜ 检查器 inspector。
- **验证**：五资产 CJK 行计数 **0**；`node --check` 三个 JS 通过；`cargo test --no-fail-fast` = **341 passed / 0 failed / 4 ignored**（`main.rs` 的 `assert!(html.contains("证轨 ProveTrack"))` 仍成立 —— 该串由 `base.html` 提供，不在本次范围）；数据层回放 28 项断言全绿；对外接口名 `__proveTrackLoad`/`__proveTrackClear` 不变；diff 增删行数对称（124/124，纯替换无结构改动）。
- **边界（刻意，非遗漏）**：证轨视图文案变英文后，与 Cellrix 外壳及其他中文视图形成**跨视图**语言差异。证轨被单独点名，其余待裁决。
