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

## 3. 备选方案与拒绝理由

| 备选 | 拒绝理由 |
|---|---|
| 保留 10 色事件 badge | 装饰性显著性是噪音 [PHYS:P-016]；语义色保留原则 [PHYS:L-002] 只覆盖状态不覆盖类型 |
| 选中行保留彩色左边框 | 违反 [PHYS:D-003]（1px 彩色分割线） |
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
