# Cellrix 生长记录（GROWTH）

> **版本**：v1.3
> **日期**：2026-09-14
> **所属方法论**：phyt-DNA v1.0
> **性质**：本文件记录 Cellrix 的最近 3 次健康快照。超过 3 条时，最旧的移入 `archive/growth/`。

---

## [2026-09-14] 实时对话显示所调用的 LLM（ADR-0036 消费侧收口）

**变异类型**：补齐一条漏掉的路径 —— 同一事实此前只有 3 条路径显示

- **现象**：侧栏经历列表、历史回放、证轨三处都显示模型名，**只有实时对话那条漏了**
  —— SSE 终局行不带 `model`，而实时路径走的 `addStreamMsg()` 连槽位都没用上，
  用户看不出自己在跟哪个 LLM 对话。
- **修复**：抽出 `helixWho(model)` 作为**唯一 sender 槽位**，两个来源填同一个槽 ——
  历史回放从事件流读，实时路径从 SSE 终局行读。
- **口径**：模型名一律来自**上游响应**（ADR-0036 physical model），不是 config 声明；
  **拿不到就不显示**（不猜、不填占位）。

### 教训

「半截实现」比没实现更难查：同一事实 3/4 条路径已有，
查这类缺陷要**按路径列表盘**，不能只看有没有实现。

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

## [2026-09-14] 证轨检查器入口修复 + FlowModus 接线补齐

**变异类型**：①修复一个长期潜伏的既有缺陷（点事件行/轨道块打不开检查器）；②补齐一块整块未接线的生态（FlowModus）

### 证轨检查器入口（既有缺陷，非近期引入）

- **现象**：鼠标点击事件行 / 轨道块**打不开检查器**（证轨视图的核心交互），且**无任何报错**——静默早退。
- **根因**：HTML 的 dataset 把 `data-e-ev` 映射为 **`eEv`**（去 `data-` 前缀 + 余下 camelCase），代码却读 `dataset.ev` → `openInsp(undefined)` → 早退。同类：`data-e-turntoggle` → `eTurntoggle`。
- **修复（5 处）**：`prove_track.js` 三处 `dataset.ev` → `dataset.eEv`、一处 `dataset.turntoggle` → `dataset.eTurntoggle`；`prove_track.view.js` 的 `S.lastFocusEv` 取值同步修正。另在绑定处加一行英文注释固化该映射（此映射正是踩坑点）。
- **溯源**：`git show 195f383^:web/assets/prove_track.html`（ADR-0016 拆分**之前**）已同时存在 `data-e-ev="` 与 `dataset.ev` ⇒ 早于 ADR-0016 / ADR-0017，**非近期引入**。既有测试只做字符串级 `contains` 断言，故从未捕获。
- **反证**：只补 `data-ev` / `data-turntoggle` 属性即可让三项交互全恢复 ⇒ 纯命名错配，处理逻辑本身正确。

### 派生式不变量（方法论）

不硬编码期望值，而是**从资产自身推导**不变量：

- 「每个 `dataset.X` **读取**都必须能被某个 `data-*` 属性提供（按 HTML 映射 `data-a-b` → `aB`），或由运行期赋值 `dataset.X =` 产生」——判别读取 vs 写入：`.dataset.X` 后面**不是** `=` 就是读取。
- 同法推广到 id / class / 全局引用：三条不变量在真实资产上 0 项；**阴性对照**（注入一个不存在的 id 引用 + 一个不存在的类名）两个都被抓到 ⇒ 证明审计非空转。
- 结论：这一整类「A 处字符串必须与 B 处对齐」的耦合缺陷，在前端**只有那一个实例**（已修）。

### FlowModus 接线补齐（此前整块未接线）

排查发现三处同时缺失，缺一不可：

- **服务没人起**：`flowmodus serve`（协议默认端口 60053，std HTTP）从未被启动。注意其 registry 走**相对路径** `registry` ⇒ 必须在 `flowmodus-rs/` 目录下启动，否则报告空池。
- **面板没人告知**：面板配置的 `flowmodus_url` **无默认值**（仅 `--flowmodus-url` / 环境变量，不传即 `None`）⇒ `/api/flows` 恒返回 `flows: null`，检定台永远零态。
- **anaphase 端点为空**：`config.toml` 的 `flowmodus_endpoint = ""` ⇒ 生态点亮投影判 `Unavailable`。
- **修复**：config 填 `http://127.0.0.1:60053`；启动脚本拉起 `flowmodus serve --port 60053` 并给面板传 `--flowmodus-url`。
- **安全边界**：`flowmodus_endpoint` 仅被 **Priority 2** 推理适配器消费，而本地 `reasoning_endpoint` 非空 ⇒ Priority 1 恒命中，Priority 2 永不执行 ⇒ **推理链路不受影响**；填它只影响生态点亮与健康检查。

### 验收（物理事实）

- `anaphase /v1/health`：`flowmodus  configured=True  ok=True  reachable`；12 项检查 `overall ok: True`
- 面板 `/api/flows` 携带真实供应商池（`current.supplier_id = openrouter`）
- 面板生态条 5/5 `ok`；适配器 `tentacle adapter active` + `mind adapter active`
- 回归网 A/B：旧二进制 **44 passed / 4 failed** → 重建后 **50 passed / 0 failed**
- Cellrix `cargo test --no-fail-fast` = **341 passed / 0 failed / 4 ignored**；离线快照自检 17/0
