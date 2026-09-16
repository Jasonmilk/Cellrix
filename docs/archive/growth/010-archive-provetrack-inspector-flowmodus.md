# Cellrix 生长记录归档 —— 证轨检查器入口修复 + FlowModus 接线补齐

> **归档于 2026-09-15**：`docs/GROWTH.md` 规则为 ≤3 条，补记 ADR-0018 时归档日期最早一条。
> 历史永不删除 —— 以下为原文完整保留。

---

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
