# ADR-0009: Anaphase 驾驶舱（候选 G）——双端协议 + TUI 先行

- **状态**: Accepted
- **日期**: 2026-09-06
- **关联**: Anaphase ADR-0010（快照投影端点）、ADR-0023（CI-144 全局治理）、候选 F（经历时间线）
- **仓库**: Cellrix（消费端/渲染端）/ Anaphase（服务端）

## 1. 背景

P0-P6 后 Cellrix 是生态展示器（多 widget 独立组件，未接入真实 Anaphase 状态）。
候选 G 把 Cellrix 升级为 **Anaphase 驾驶舱**——监控意识层（编排/认知/执行）的全链路白盒。
正名约束：驾驶舱监控 Anaphase（意识层）；Helix-Mind 是灵魂本体，不驾驶。

用户目标：降低使用门槛，借鉴 DeepSeek Harness（DSH）"会话日志驱动界面"的白盒思路，
但**机制借鉴、命名零借用**——Helix 的 ledger 是字节级确定性的验证性白盒（M1 验收②），
DSH 的 session log 是展示性白盒。

## 2. 决策

### D1: 双端按需驱动——数据协议双端共享，TUI 先行

snapshot HTTP JSON（mode/state/episode/ledger）是唯一数据协议；TUI（Ratatui，307 测试资产）
与未来 Web 面板（G2）消费同一协议，渲染层可替换（极致解耦）。本轮交付 TUI；Web 面板
列为候选 G 之后的独立轨道（G2），不阻塞。

### D2: 协议契约 = Anaphase 的 serde 形状

消费端 `AgentSnapshot`/`LedgerEntry`/`InteractionMode` 用与 Anaphase 相同的 serde 形状
反序列化（mode snake_case、ledger tag=`record_type`）；未知字段忽略，容忍内部演进。
live 联调抓到 mode 大小写不一致后修正——物理事实优先。

### D3: 一次拉全（极致节能）

`AnaphaseClient::get_snapshot()` 聚合方法一次 HTTP 拉全（非三个独立调用）；
poller 每 tick 一次 fetch；`attach_cockpit` 按需挂载（无端点不轮询）。

### D4: CockpitWidget——白盒投影渲染

模式栏（DRIVE/PARTNER/SURVIVE）+ 认知状态 + 经历时间线（episode id/锚点/步数）+
Ledger 审查视图（MET/UNMET/BLOCKED + trace + retry_due + parent）。渲染条固定在
legend 上方（终端过小自动隐藏）。Ledger 是唯一事实源，widget 只是投影。

### D5: 验证分层

- 单元：Mock 客户端确定性数据 + `parse_snapshot_body` 纯函数解析（协议契约测试）
- live：`tests/anaphase_live.rs`（#[ignore]，真实 Anaphase cap_http 50061）
  ——真实 HTTP roundtrip 解析（mock server 模拟不稳定，真实通道为准）

## 3. 备选与拒绝

| 备选 | 拒绝理由 |
|---|---|
| 驾驶舱叫 "Helix 驾驶舱" | 语义错误——Helix=Mind 灵魂本体，不被驾驶；被驾驶/被监控的是意识层 Anaphase |
| Web 面板先行 | web-ui 仅 2 个孤儿组件（无入口），TUI 是 307 测试生产资产；双端共享协议后 Web 是低摩擦后续 |
| 事件推送（EventSeq） | 如无必要勿增实体——快照轮询已覆盖白盒需求；DSH 的 EventSeq 是展示机制，Helix ledger 更硬 |
| 三客户端三调用 | 每 tick 3 次 HTTP，违背极致节能；聚合 `get_snapshot` 一次拉全 |

## 4. 后果

**正面**：白盒可审查（真实 ledger 投影）、双端就绪（协议共享）、TUI 全绿（316 tests，
307→316 +9）、live 验证通过（真实 Anaphase ↔ HttpAnaphaseClient）。

**代价**：快照是轮询语义（2s 延迟）；Web 面板未做（G2）；驾驶舱数据依赖
Anaphase cap_http 开启。

## 5. 验收（已通过）

1. `cargo test` Cellrix 全绿（316 passed）
2. live：真实 Anaphase（cap_http 50061）→ `HttpAnaphaseClient::get_snapshot` 解析成功
3. 驾驶舱渲染测试：CockpitWidget 模式栏/经历/ledger 断言通过
4. `cellrix-cli run --anaphase-endpoint http://127.0.0.1:50061` 挂载轮询（2s）
