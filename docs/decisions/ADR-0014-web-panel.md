# ADR-0014: Web 面板（G2）——cellrix-web，浏览器白盒窗口

- **状态**: Accepted
- **日期**: 2026-09-06
- **关联**: ADR-0009（驾驶舱双端协议）、ADR-0010（snapshot 契约）、用户约束（2026-09-06：**"web面板先拉起来,再想优化!"**）
- **仓库**: Cellrix（web/ crate）

## 1. 背景

驾驶舱 TUI 已真实渲染（G-3），`up` 已交互菜单化（G-6）。用户推进 Web 面板
（G2）：浏览器即开、未来 SaaS 种子（引流/低门槛）。web-ui 目录只有两个
React 孤儿组件（HolographicGrid/Terminal，未进 workspace）。决策：
**先拉起来，再想优化**——本轮交付最小可用 Web 面板，React 组件留待优化期。

## 2. 决策

### D1: 零依赖 std-only HTTP 服务 + 单文件内嵌 HTML

新 crate `cellrix-web`（workspace member），**零 dependencies**：
- HTTP 服务手写（TcpListener + 每连接一线程）——本地工具，连接数少，
  简单胜过连接池
- 页面 = 单文件内嵌 HTML + 原生 JS（每 2s 轮询）——无框架、无构建链、
  确定性、极致节能
- 复用 ADR-0009 决策：Web 与 TUI 同一 snapshot 协议，无第二数据源

### D2: 代理而非直连（规避 CORS）

浏览器 fetch Anaphase :50061 会被 CORS 拦截（Anaphase 无 CORS 头）。
web 面板做同源代理：`GET /api/snapshot` → 手写 HTTP GET 转发
`/v1/agent/snapshot`（ADR-0010 固定协议路径）→ 透传 JSON。
一个 origin、一个端口、零配置。

### D3: 路由白名单 + 真实状态码

`route()` 纯函数（3 单测）：`/` → 页面、`/api/snapshot` → 代理、
其余 → 404（真实状态码，非 200 伪装）。代理失败 → 502 + JSON 错误体。

### D4: 零硬编码

- anaphase 端点：`--anaphase-endpoint` > `ANAPHASE_ENDPOINT` env >
  协议默认 `http://127.0.0.1:50061`（ADR-0010 cap_http 默认）
- web 端口：`--port` > `WEB_PORT` env > 面板协议默认 8080（注释来源）
- 刷新间隔：`REFRESH_SECS` 常量（注释：浏览器轮询协议默认）

## 3. 验证（已通过）

1. `cargo test` Cellrix 319 passed（316 + 3 web 单测，无回归）
2. 端点实测：`/` 200 页面（含标题/api 引用）；`/api/snapshot` 200 真实快照
   （Noop 态 + **全链路态**）；`/nope` 404
3. **全链路真实白盒**：mock reasoning → 真实 Tentacle numbers 执行 →
   真实 MET ledger（`run-8bba24c5ee368a4a#0`，三 check_reports 全过）→
   Web `/api/snapshot` 完整透传——浏览器可见真实 ledger
4. 代理失败路径：anaphase 未起时 502 + 错误 JSON（页面显示"✗ 离线"）

## 4. 后果

**正面**：浏览器即开的白盒窗口（SaaS 种子）；与 TUI 共享数据契约
（数据层零重写）；零新依赖（极致解耦/节能）。

**代价/缺口（优化期待办）**：
- 页面为单文件内嵌（无构建链）——React 组件（HolographicGrid 等）未启用，
  网格/比例布局逻辑尚未在 Web 端投影（优化期接入）
- 每连接一线程（非连接池）——本地工具够用；上量后换 tokio
- 无鉴权（仅监听 127.0.0.1）——本地白盒；对外暴露需 Tuck/CI-144 接入
- 尚未挂入 `up` 菜单（G-6 菜单第 5 项）——优化期按需加
