# Cellrix 生长记录（GROWTH）

> **版本**：v1.5
> **日期**：2026-09-17
> **所属方法论**：phyt-DNA v1.0
> **性质**：本文件记录 Cellrix 的最近 3 次健康快照。超过 3 条时，最旧的移入 `archive/growth/`。

---

---

---

## [2026-09-17] 三处面板缺陷：FlowModus 接线 / 新经历被并入旧经历 / 顺序错乱的真因（anaphase:ADR-0041）

**变异类型**：接线补齐 + 语义纠正 + 存储身份缺陷定位

- **FlowModus 从未在"一键路径"接线**（人类报告"FlowModus 没有正常启用"）。它**在跑且健康**，
  是面板拿不到 URL：`flowmodus_url` 无默认值，而 `up` 只在用户显式传 flag 时才传 ——
  `start-panel.sh` 却传了。于是测试面板有数据、**人真正用的那个恒空**。修：① `flowmodus_url`
  给协议默认（与 `anaphase_endpoint` 同形；`tuck_endpoint` 故意不给 —— 它是安全闸门，不是
  只读展示源）② `up --restart` 按依赖序启停 FlowModus，且 `up` **始终**接线；必须先
  `cd flowmodus-rs`（它按**相对路径**解析 registry，从工作区根启动会报空池 ——
  `start-panel.sh` 正是为此 chdir，也只因此测试面板才正常）③ 生态探针补 FlowModus
  （此前它连"生态点亮"里都没有）。实测：`/api/flows` 从 `null` 变为真实供应商池
  （openrouter / free+paid 两档），`/api/ecosystem` 六组件全 `ok`。
- **新经历被并入旧经历**（人类报告）。两个原因，都是刻意的、也都错：
  ① `chainJobIds` 从根**广度优先走整棵子树** ⇒ 每个后起分支都落进同一窗口。实测：三棵根各含
  **10 段子树**，两个父节点各有 2 个子 ⇒ 打开任一个都会并入**人从未打开过的周期**；
  ② `sendChat` **无条件采纳回复的 job_id** ⇒ 一次全新对话悄悄变成上一周期的子节点。
  修：窗口改为**血缘路径**（祖先仍包含 ⇒ 续接不丢上下文；不再继承"尚未拥有的未来"）；
  链只在**人显式续接**时延续（`job` 是发送时捕获的锚点）。横幅承诺"**下一句话**延续这段经历"，
  **从未承诺**"新开的对话会悄悄变成一段经历"。
- **顺序错乱的真因不是窗口，是身份**：`job_id` 由输入派生 ⇒ 同问题重问同 id ⇒
  `anaphase` 的 `session_events` 用 `truncate` 覆写 ⇒ **别的周期仍以被覆写的 id 为父**
  ⇒ 父的内容变成后来那次执行。铁证：`run-9e901b965a772d51` 的 `first_ts = 17:01:07`，
  其子 `run-32c4be74a996a40d` 为 `06:19:10` —— **父比子晚 11 小时**；51 条血缘路径中
  **5 条时间戳非单调**。⇒ **`anaphase:ADR-0041`（Proposed）**：周期身份与输入解耦，
  存储键必须唯一（冲突时后缀分配），且唯一键即 trace id。

### 测试改动（说清楚，不塞进夹缝）

`chain_merge_test.js` 原本**故意断言**旧语义（"从中间打开也拿全链"）并带变异守卫 ——
**那条断言正是人类报告缺陷的语义**，故替换为钉住新意图的断言，并补**分支树**用例
（叶子、兄弟、根三种视角）。`prove_track_nodes_test.js` 用的是**根**，其"十段链"只因旧子树
遍历才成立；改为从**叶子**提问，在新语义下仍是那条真实的 10 段 / 80 事件 / 无工具链 ——
判据与数字不变，理由变正确。它的 context 节点断言取"第一个 context 节点"，
而新夹具的根恰好没有记忆命中 ⇒ 改为取**第一个带命中的**（"无命中"另有独立断言覆盖）。

### 验收

- JS 回归网 **8/8 全绿**；Cellrix **350 passed / 0 failed / 4 ignored**
- `verify_live.py` **59-0** · `coupling_audit.py` **0 unresolved**（对实时页面）
- 实时：`/api/flows` 真实数据 · `/api/ecosystem` 六组件 `ok` · 血缘路径实测
  （两个兄弟子节点各自成窗、**互不包含**；真根窗口只含自己）
- **提交树独立验证**：新建 worktree 检出提交点跑 JS 回归网 **8/8 绿**，并确认其中不含
  未提交内容（`parsePlan` 0 处、`session.html` 0 处）⇒ 提交**自洽**，
  不是"靠工作区其它改动才过"

### 未提交（人类的在飞工作，一行未动）

`base.html` / `prove_track.css` / `layout_test.js` / `session.html` / `components.html` /
`flows.html` / `.gitignore` / `panel-geometry-contract.md`，以及 `chat.js` 里的 `parsePlan`
渲染（其测试文件仍写着 "must be RED now"）。提交时用**外科式分块暂存**只取我的 hunk ——
并已验证 `parsePlan` 的调用方与定义方**同属未提交侧**，故提交树里两者皆无、自洽。

---

## [2026-09-17] Web 面板的协议投影开篇：装配数据化（ADR-0021 T0/T1a）+ 五处论证纠错

**变异类型**：根因重定位 —— 不是"缺 slot 系统"，而是 Web 面板未成为协议投影

- **根因（人类指路"了解生态血液"后自查所得）**：Cellrix 协议早已定义
  `GridDefinition` / `GridSlot`（`protocol/src/manifest.rs:36-59`）、`SemanticNode.slot_binding`
  （`snapshot.rs:38`）、`NodeType::Unknown`（`snapshot.rs:45-54`）。使用者实测：
  `protocol` / `layout` / `mock-agent` ✅，而 **`web/src` 零使用**。TUI 走
  「协议网格 → 布局引擎 → `ui`」= 碳硅同构（DNA 原则 3）；**`cellrix-web` 整体绕开协议模型**
  —— 这才是"凭凑式"的可证根因，不是"缺一套 slot 系统"。
- **ADR-0021 v1 的五处错误（留档以免重犯）**：① 论证根基立在"某外部项目这么做"
  （违 DNA「设计理由立在自己的原则与血统上」）；② 自造「格／格谱」，重复发明协议已有的
  `GridSlot` / `GridDefinition`（违「极致复用：不重新发明」）；③ 以"外部项目中文用槽位"为由否决
  `槽位`，而它是 **Cellrix 自己的协议术语** —— 调查不全即下判决；④ 漏掉家族招牌机制
  「扩展保留区」；⑤ 漏掉「冻结／演进分层」。v2 推倒重来，命名为**退役**而非新增。
- **身份重立（本轮的真正收获）**：Cellrix 在 CI-144 家族中是 **INTENT-7 §15 法定参考实现**
  + `CAPABILITY-13` PC-2（SemanticSnapshot + `view_hash`，"what you see is what you sign"）
  的参考实现 = **可视化共识层**。故"让 Web 面板成为协议投影"不是借鉴谁，是自身身份的必然。
- **T1a（装配数据化，纯重构）**：23 次链式 `.replace()` + 24 个 `include_str!` 收敛为
  **`web/assets/boot.json` 起搏图**（顺序 / 映射 / 派生皆为数据）+ `web/src/boot.rs` 机制。
  **不碰 `base.html`**，故与人类在飞的几何工作零冲突。新增依赖 serde / serde_json
  （已在 workspace lock 中，无新下载）。
- **一个会静默炸掉面板的陷阱，被测试拦下**：`script.html` 内含 `__REFRESH__`，老代码靠
  **链式替换作用于已插入内容**才替换得到它；单遍模板替换会把字面量留在页面上。
  ⇒ 派生值必须在全部皮片展开**之后**对整体应用一次；由 `derived_applies_after_its_host_piece`
  守卫（并断言 `script.html` 确实含该占位符——前提消失时要求改换守卫对象，而非静默通过）。
- **诚实约束（不粉饰）**：`include_str!` 需字符串字面量 ⇒ 嵌入清单必然留在 `boot.rs`。
  **图管装配顺序与映射，清单管嵌入内容**；新增资产 = 1 行清单 + 1 条图项，而非"1 处"。

### 验收（三重，全部通过）

- **差分测试**：`boot_output_is_byte_identical_to_the_legacy_mechanism` —— 预言机是旧序列
  **本身**（`#[cfg(test)]` 内逐字保留），不是冻结金标。金标会把测试绑到资产**内容**
  （任何合法资产编辑都会假红），差分则只有**机制**回归才能把两侧分开。
- **HTTP 层端到端**：新二进制页面 vs 改动前**逐字节相同**（244858 B，`cmp` 无差异）。
  先在临时端口验证（不扰动在跑服务），后按人类许可重启 8080。
- **回归网**：`verify_live.py` **59 passed / 0 failed** · `coupling_audit.py` **0 unresolved** ·
  JS 回归网 **8 套全绿** · `cargo test -p cellrix-web` 7+14+2 全绿 · 400 行红线内
  （`main.rs` 279 / `boot.rs` 338）；7 条警告全在 `routes.rs`（既有，非本轮引入）。
- **计数纠错**：此前两份文档写的"21 重 replace"是错的，实测为 **23 次 `.replace()` /
  24 个 `include_str!` / 23 个占位符**（22 资产 + 1 派生）。已改正并附可复算口径。

### 教训

**"我知道我的生态"不等于"我读过我的生态"。** 人类一句「了解生态血液」，让我在协议里找到
自己正要发明的东西 —— 并且发现我否决的一个词其实是我方术语。**先读自己的 SSOT，再谈借鉴外部。**

### 顺带发现的既有缺陷（人类批准，**已修**）

1. `docs/archive/growth/010-archive-live-llm-display.md` —— **文件名与内部 `#` 标题双错**，
   双双指向"实时对话显示 LLM"，而实际条目是"证轨检查器入口修复 + FlowModus 接线补齐"
   （体例要求归档名 = 被归档条目标题，007/008/009/011 均相符，唯 010 不符；
   根因是当时有两条 `[2026-09-14]` 条目，归档者写了**另一条**的标题）。
   ⇒ 改名 `010-archive-provetrack-inspector-flowmodus.md` + 修内部标题，三处现已一致。
2. `ECOSYSTEM.md` §5 / §7 把 Cellrix ADR 目录写作 `docs/adr/` —— **该目录不存在**
   （实为 `docs/decisions/`），两处失效路径 ⇒ 已修；§5 并补 `spec/grids.md` 入口。

---

---

## [2026-09-16] 证轨成为 tape 的 target —— 表即行集，一类缺陷变成不可能状态（ADR-0018 批次 4 · 3b-3+4b）

**变异类型**：取数口收口 —— 最后一个自带数据源的视图改为投影同一笔 tape

- **壳层拥有唯一一笔 tape**（`script.html`）：`loadWindow` 把链合并**一次**并喂入；
  对话渲染 `events()`，证轨读 `snapshot().nodes`。证轨的 `stream` 形参与自带的
  `/api/events` 取数**删除** —— 「第二个入口」正是两个投影讲出两套故事的原因。
- **按需驱动落到 target 上**：`onEnter` 激活 / `onLeave` 取消激活；取消即**销毁实例**
  （ADR-0018 D5：不是隐藏元素）。壳层新增 `onLeave`，且仍不点名任何视图（[GENE] 0 硬编码）。
- **表即行集**：`prove_track.node.js` 撞 400 行红线 ⇒ 按**声明/执行**拆出
  `prove_track.render.js`（`LANE_OF` / `SUMMARY` / `KIND_NOTE` / `STATUS_OF` / 校验器）。
  没有 `SUMMARY` 条目 = **不成行**；`NOT_DRAWN` 显式声明例外（metering：被测量，不是一步）。
- **装载期校验把一类缺陷变成不可能状态**：`{slot}` 必须解析（fmt 或契约声明字段），
  且不得与 `opt` 同名 ⇒ 模块**拒绝加载**。守卫带**阳性对照**（给校验器喂坏表必须抛）。
- **切换前对拍**（新旧两层在同一真链上逐字段比对，脚本不入仓）查出 6 类缺陷，全部已修：
  四个模板的游离 `—`（`opt` 键被写成 `{slot}` ⇒ 先填 em dash 再追加真值）、
  check 标签是字面量、tool/result 显示 digest 而非 outcome、context 丢节点命中、
  reply 丢周期总量与可展开正文 / reasoning 丢 gap 时长（`LLM TIME` 恒 `—`）、
  metering 变成行并重定义所有时长。
- `prove_track.data.js` 收敛为**原语**（45 行）：无事件知识、无协议名。
- 「Schema」页签从此是真的：显示该 kind 的**契约声明字段** + 一句话说明；字段集与装载期
  校验**共用同一份推导**，页签无法与契约漂移。

**规模**：`prove_track.node.js` 376 → 224；新增 `prove_track.render.js` 302；
`prove_track.data.js` 283 → 45。

### 验收（A/B：单条命令内起栈 → 探 → 停）

- 独立打开证轨（不选经历）显示**整条链**；期望值由 e2e **自己从 API 重算**，不向应用要数：
  `all_views_test.js` **55 passed / 0 failed**
- 服务端页面逐字等于资产：`verify_live.py` **56 passed / 0 failed**
- 回归网 **7 套件全绿**（`pt_replay.js` 由 SKIP 转为运行）；`coupling_audit.py` 0 unresolved

### 顺带修正的防线

`verify_live.py` 一直被指向**冻结快照**（JS 跑完后的 DOM）⇒「应用自己设过的 inline style」
被读成「烧入坏了」= **两条永久假红**，而永久假红会训练人忽略检查。现在它**拒收冻结快照
并说明该喂哪个文件**；`snapshot.js` 同时写出 `.raw.html`（服务端原页）；并补上它此前
从未覆盖的 `prove_track.node.js`。

### 边界

用户侧还剩 4 项诉求 —— **导出证轨 / 三分布局 / 密码解锁 / Tentacle 搜索**。
架构杠杆已接通（View → tape target 的迁移已完成），这四项**未动**。
