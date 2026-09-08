# ADR-0015: WebUI 水之波光化（Lumtact 设计体系）

- **状态**: Accepted
- **日期**: 2026-09-09
- **取代**: ADR-0014（web-panel）的视觉实现（令牌与组件样式整体替换；面板功能与交互协议不变）
- **关联**: ADR-0014（web panel）、ADR-0026（Engram v2 经历时间线）、ADR-0028（会话续接/重命名）、ADR-0029（fold 原语 + think/check/outcome 渲染）、水之波光 · 触境 v10.0.4（Lumtract 设计体系四卷）

## 1. 背景与问题

Cellrix WebUI 此前使用自定义深色令牌（`--bg:#16161a` 等）。用户要求以「水之波光 · 触境」（Lumtract 设计体系）哲学重做 WebUI——所有设计值必须经过卷三推导流程并携带 `[PHYS]/[ENG]/[GENE]/[PURPOSE]` 来源标注（无标注 = 推导无效）。

同时修复两个视觉缺陷（同一哲学裁决，两处落地）：

1. **印痕明细「每列加颜色 + 加粗左边框」**——事件行 badge 10 种类型 10 种颜色 + `font-weight:700`，视觉上每一行都是一条彩色加粗前缀；
2. **根目录水之波光 html 窄屏表格降级**——每列 `::before` 加粗（600）列名 + 语义色，等于每列一条彩色加粗左边框。

两者违反同一组硬边界：[PHYS:D-003]（1px 彩色分割线 / Pentile 彩边）、[PHYS:P-016]（装饰性显著性是噪音）。

## 2. 决策

### D1: 令牌同源 Lumtact

WebUI 全部设计令牌与 `lumtract/web-viewer/src/design/lumtact-tokens.css` 同源（暗/浅双主题，值不另起炉灶）。令牌写入 `web/src/main.rs` 内嵌 CSS 变量（面板是 std-only 单文件服务，无构建期外部依赖）。

- 暗：`--bg-base:#1A1A1A` / `--text-1:#EDEDED` / `--brand:#2B8CBE` 等
- 浅：极性翻转（白底无上升空间，层级靠变暗阴影/波纹反光承担）[PHYS:D-004 推论]
- 时间令牌 120/200/260ms [PHYS:P-004]/[PHYS:P-005]
- 热区 ≥44px [PHYS:P-010]

### D2: 事件类型 badge 单色相中性（核心裁决）

印痕时间线的**事件类型**（START/USER/CONTEXT/THINK/ATTEMPT/TOOL/RESULT/CHECK/VERDICT/END）不再是 10 种颜色——统一为中性 chip（`--chip-bg` + `--text-2`），类型靠文字区分。

依据：
- [PHYS:P-016] 装饰性显著性是噪音——10 种类型 10 种颜色 = 过度显著性，预测误差
- [PHYS:L-001] 层级单调——类型与值必须有可映射层级
- [PHYS:P-013] 同层级外观一致——所有类型同权

**保留语义色的部分**（[PHYS:L-002] 内容强制）：Met/Unmet、PASS/FAIL、ok/fail、在线/离线、伙伴/驾驶/生存模式徽标、记忆层级 chip（单色相 brand 系分级亮度）。唯一例外 `verdict-status` badge 用 danger 色（语义状态本身）。

### D3: 选中态背景高亮，无彩色左边框

`.row.sel` 从 `border-left:3px solid var(--acc)` 改为 `background:var(--row-sel)`。彩色加粗左边框形态在明细中彻底移除 [PHYS:D-003]。

### D4: 主题三段式

`data-theme` 三段式（跟随/日间/暗黑，localStorage 持久化），head 内同步引导脚本防 FOUC [PHYS:D-006 环境融合]。`prefers-color-scheme` 变化时跟随模式实时切换。

### D5: 波纹反馈（果从因的位置长出）

点击按钮/会话项/折叠头时，从点击坐标生成涟漪（升起/扩散/消散/复原四阶段），`--dur-state` 200ms [PHYS:P-004]/[PHYS:P-005]。

### D6: 降级阶梯

- `prefers-reduced-motion`：流转权降级（动画/过渡 1ms），等待可视化保留 [PHYS:C-003]
- `prefers-contrast:more`：半透明剥离，层级靠实色边界（面板/卡片/按钮边框 2px）
- 窄屏 ≤800px：Engram 网格单列、会话侧栏收窄 [PHYS:P-012]

### D7: 状态点纯色静态

生态状态点（在线/离线/启动/错误）为纯色静态圆点，无呼吸动画——面板常开，闲置动画违反 [PHYS:R-003]（GPU 持续合成耗电）。「等待」场景用旋转 loading（确定性可视化 [PHYS:C-003]，reduced-motion 下保留）。

### D8: 视图资产化拼装（印痕 v3 · 解耦重构）

`main.rs` 单文件巨型 `format!`（1323 行）是维护瓶颈——每改一处视图都触碰转义规则，违反极致解耦/按需加载。重构为**资产目录 = 唯一渲染源**：

- `web/assets/base.html`（HTML 骨架 + 占位符）、`styles.html`（共享 CSS）、`cockpit.html` / `chat.html`（视图 HTML 片段）、`script.html`（共享 JS IIFE）、`engram.html`（印痕骨架，含自带 JS）
- `index_html` 退化为 **replace 拼装器**（十几行）：`__STYLES__/__COCKPIT__/__CHAT__/__ENGRAM__/__SCRIPT__/__REFRESH__/__TUCK_CONFIGURED__` 逐个替换
- **零 `format!` 转义**：资产内部 `{}` 自由书写，不再双写——消除转义地狱（[ENG] 工程约定，消除心智负担）
- 动态值仅两处（刷新秒数、tuck 配置态），全量 replace 覆盖，无遗漏路径
- 效果：`main.rs` 1323 → 633 行；新增视图 = 新增资产文件 + 一个占位符，不触碰主文件

拒绝备选：
- 引入 Node/框架构建链 → 面板是 std-only 单文件服务，构建依赖违反极致节能/按需加载
- 按 `format!` 分块继续内嵌 → 仍是巨型函数，转义问题不消失

### D8: 印痕 v3 = 水之波光 Harness v11.2.0 轨迹骨架（修订 ADR-0026/0027 的旧卡片形态）

2026-09-09 用户核验了 `水之波光-Harness轨迹.html`（v11.2.0）与 `轨迹-ge1-20260909.html`（v11.0.2 修复验证版），判定旧交付形态（左侧经历列表 + 右侧事件卡片栈）与参照物跑偏，要求按骨架重做。本裁决取代此前「DSH-style turn outline」的旧形态。

**骨架（借骨架、不借皮肤、不借哲学）**：
- 五列事件表：类型/摘要/状态/耗时/Tokens（摘要列常驻，宽屏依次隐藏 Tokens→耗时，识读权 > 流转权 [PHYS:L-001]）
- Overview 三轨时间线：Input/Model/Tools 共用一根横向标尺——每一列在三轨上是同一步，对齐=占位块、离散=gap:1px，两者正交；空白 = 该轨确实空闲
- 三轨色相 + 图案双编码（横纹/实心/45°斜纹）[PHYS:L-001][PHYS:P-002]
- 工具栏：等宽（伪时间轴/实际耗时切换）/折叠轮次/展开调用/重放/搜索
- 底部统计栏（TURNS·STEPS·TOOL CALLS·LLM 耗时·工具耗时·TOKENS·缓存命中·TOK/S；grid gap:1px 生成分隔线）
- 右侧检查器抽屉：Summary/Payload/Result/Schema/Timing 五页签；≥1180px 非模态无遮罩，窄视口模态化（aria-modal 如实反映）
- 遮挡自证：四方向统一，贴在遮罩层（可见边界）不贴内容层
- 卡住判定：连续同名工具连续失败 ≥3 次、只在链尾标一次、模型介入即断链、不用红色（红已被工具失败占用 [PHYS:L-002]）

**实现方式（解耦决策）**：印痕整体为独立资产 `web/assets/engram.html`（e- 前缀令牌与类名全部限定在 `#view-engram` 下，隔离旧样式与驾驶舱/对话视图）。`main.rs` 仅 `include_str!` 拼装 + `selectPeriod` 桥接 `window.__engramLoad(jobId, meta)`。这是「哲学 → 组件资产 → 骨架 → 自动渲染」的第一步——后续驾驶舱/对话视图同样提取为独立资产，`main.rs` 退化为薄壳（路由 + API 代理 + 资产拼装），不重开项目、不引入构建依赖。

**数据映射（物理事实优先）**：真实事件流 10 类型（turn/start·user/message·context/inject·assistant/think·assistant/attempt·tool/call·tool/result·check/status·verdict/status·turn/end）；tool/result 的 outcome 是 JSON 字符串（如 `{"ok":true,"result":"121"}`）非行内 HTML，按纯文本 esc 处理；无 tokens/缓存命中字段时显示 `—`（不猜数）；耗时 = 事件流内时间差（单一入口回合报 0——诚实，不猜测推理何时开始）。

### D9: 400 行解耦红线（main.rs 633 → 220，模块化）

用户哲学（2026-09-09，写入 DNA v1.1 铁律 2 + phyt-DNA 铁律 6）：**代码超 400 行必须解耦**，否则膨胀。`main.rs` 完成资产化拼装后仍 633 行，继续拆：

- `web/src/config.rs`（58 行）：`PanelConfig` + 协议默认常量（argv → env → defaults）
- `web/src/server.rs`（385 行）：`route`/`handle`（10 Route 分支）/`respond`/`health_check`/`panel_already_up`
- `web/src/main.rs`（220 行）：入口 + `index_html` 资产拼装 + 单元测试（测试文件豁免红线）
- 三个文件全部 < 400 行；测试 6 项全绿；live 输出 85KB 级不变

拒绝备选：
- 保持单文件 633 行 → 违反用户批准的红线，后续每加一个 Route 都是膨胀
- 测试段移出为独立文件 → 测试与逻辑同仓更简洁（[ENG]），红线豁免已写明

### D10: 驾驶舱 v2 = 水之波光组件化（统计条 + Ledger 结构化表格）

印痕 v3 新世代后，驾驶舱仍是旧时代（三张大数字卡片 + Ledger 纯文本列表），"一半旧时代一半新世代"。用户指令：**重构整个驾驶舱，全部重新设计，统一水之波光设计血统**（"是重构整个驾驶舱，而不是对话"）。

**组件语言（与印痕事件表同构——碳硅同看同一账本）**：
- 统计条 `.stats-bar`：经历 EPISODE / LEDGER 记录 / 刷新 TICK，grid gap:1px 生成分隔线（同印痕统计栏）
- Ledger 白盒 `.ledger-tbl`：五列结构化表格（状态/时间/trace_id/调用/说明）+ 语义色 chip（e-ok/e-warn/e-bad）+ 点击行展开 raw payload（`.lt-detail` 复用 fold 原语）——不再是一个个纯文本 `<span>` 堆叠
- 视图头 `.view-head` 与印痕 head 同语言；旧 `.cards/.card/.entry/.st` 死代码彻底删除（无幽灵约束）
- 窄屏降级：五列 → 两列堆叠（trace_id/说明 全宽）[卷三 3.5.3]；高对比降级覆盖新组件 [PHYS:D-001]
- 空态自证保留（Noop 模式 ledger 为空——诚实，不猜数）

**解耦纪律**：驾驶舱视图 = `cockpit.html` 资产（视图 HTML）+ `script.html` 渲染函数 + `styles.html` 组件样式，主程序零改动——印证"哲学 → 组件资产 → 骨架 → 自动渲染"路径（D8 的后续步）。

## 3. 备选方案与拒绝理由

| 备选 | 拒绝理由 |
|---|---|
| 保留 10 色事件 badge | 装饰性显著性是噪音 [PHYS:P-016]；语义色保留原则 [PHYS:L-002] 只覆盖状态不覆盖类型 |
| 选中行保留彩色左边框 | 违反 [PHYS:D-003]（1px 彩色分割线） |
| 印痕维持旧卡片栈（v2 形态） | 与用户核验的 v11.2.0 骨架跑偏；卡片栈逐条堆叠，轨迹/判据/时长的结构性关系不可读 |
| 重开新壳/引入前端框架 | 价值在 anaphase/tuck 后端与数据流；独立资产化已解决 main.rs 膨胀；新壳引入构建依赖，违背 std-only 单文件约束 |
| 引入外部 UI 框架（Tailwind 等） | 面板是 std-only 单文件服务；框架违反极致解耦/按需加载 |
| 单一暗色主题 | 昼夜环境不同（[PHYS:D-006]），浅色主题是同一约束集的诚实解 |

## 4. 后果

**正面**：
- 面板与 Lumtact 设计体系同源，所有值可追溯（标注即推导）；
- 事件时间线可读性提升（类型靠文字，状态靠语义色，层级单调）；
- 修复两个「彩色加粗左边框」视觉缺陷（同一裁决，html 与 WebUI 两处落地）；
- 面板跟随系统昼夜，环境融合。

**代价**：
- 内嵌 CSS 体积增大（标注注释）；面板仍无构建期依赖，代价可接受；
- 浅色主题下部分 chip 背景需 contrast 降级补强（已由 D6 覆盖）。

**风险**：
- 浏览器缓存旧面板 → 面板需重启后强刷（本次已处理，`?v=` 参数规避）；
- Lumtact tokens 演进时面板需手动同步 → tokens 以 `lumtact-tokens.css` 为单一事实源，面板内注释指向该路径。

## 5. 一句话总结

> 事件类型靠文字，语义状态靠颜色；选中靠背景，不用彩色边框；
> 令牌与 Lumtact 同源，昼夜与环境同构——每个像素都可追溯到一条标注过的约束。
