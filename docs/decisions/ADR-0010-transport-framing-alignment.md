# ADR-0010: transport 帧契约对齐（G-3）——mock-agent 对齐双通道字节序

- **状态**: Accepted
- **日期**: 2026-09-06
- **关联**: ADR-0009（驾驶舱）、候选 G、transport/src/protocol.rs、transport/src/uds.rs
- **仓库**: Cellrix

## 1. 背景

候选 G 物理验证（2026-09-06 实测驾驶舱）发现：Cellrix 的 mock-agent 与 transport
**从未真实端到端联调**（transport 只有 mock 级单元测试；mock-agent 是独立实现），
两个真实通道均失败：

| 通道 | 现象 | 根因 |
|---|---|---|
| stdio | 握手成功，读 Manifest 帧超时 | mock-agent 用 big-endian 长度前缀，transport stdio 用 little-endian（protocol.rs `send_message`）→ 4 字节 `00 00 01 12` 被读成 LE 302MB → 超时 |
| uds | `Manifest decode failed: missing field 'agent_name'` | mock-agent 发 `AgentEvent::Manifest`（struct_map 编码），transport uds 第一帧期待**裸 CapabilityManifest**（`rmp_serde::from_slice`） |

## 2. 决策

### D1: transport 契约是门面标准，mock-agent 对齐（勿增实体）

transport 是 Cellrix 所有客户端的门面（90 测试锁定其协议）；mock-agent 是测试替身。
改 mock-agent 而非 transport——最小改动面，不碰 90 测试。

### D2: 双通道字节序是物理事实，参数化而非统一

- stdio: little-endian（protocol.rs `send_message` 自写帧）
- uds: big-endian（tokio `LengthDelimitedCodec` 默认）
transport 内部两套字节序是历史事实；统一需要动 transport（风险>收益）。mock-agent
以 `Endian::{Le, Be}` 参数显式对齐各自契约，杜绝隐式假设。

### D3: 编码用 map-form rmp（与 transport decode 对称）

`rmp_serde::encode::to_vec` 对 enum 编码为数组形式，而 transport 的
`from_slice`/`from_read` 期待 struct-variant map 形式（不对称）——恢复
`Serializer::with_struct_map()`（mock-agent 原始编码即 map 形式，根因只有字节序）。

### D4: UDS 第一帧 = 裸 CapabilityManifest（transport uds 契约）

uds 通道握手后第一帧是**裸 Manifest**（非 AgentEvent 包装），后续帧才是 AgentEvent
（UdsSession 用 `from_slice::<AgentEvent>` 解码）。mock-agent `run_uds` 对齐此契约。

## 3. 验证（已通过）

1. `cargo test` Cellrix 全绿（316 passed，无回归）
2. **stdio 驾驶舱实测**：握手 → Manifest 收到 → TUI 全帧渲染（18040 字节）→
   Cockpit 面板显示 `[PARTNER] state=Perception` + `MET run-8bba24c5ee368a4a (trace=...)`
3. **uds 驾驶舱实测**：裸 Manifest 解码通过 → TUI 全帧渲染 → Cockpit 真实 ledger 投影
4. 完整数据链路（mock reasoning → 真实 Tentacle numbers 执行 → 真实 MET ledger →
   snapshot 端点 → 驾驶舱渲染）全通

## 4. 后果

**正面**：驾驶舱 TUI 真正可坐进去（stdio/uds 双通道）；transport↔agent 协议契约
首次被真实联调锁定；验证性白盒（ledger 投影）在真实渲染中成立。

**代价/缺口**：transport 两套字节序（LE stdio / BE uds）作为物理事实保留，未统一
（统一列入未来 transport 重构项，不阻塞）；UDS 与 stdio 的帧首帧语义差异
（裸 Manifest vs AgentEvent）同样保留，契约由本 ADR 显式记录。

**遗留**：`StdioTransport`/`UdsTransport` 仍缺真实集成测试——G-3 的修复以
`tests/anaphase_live.rs`（HTTP）与手动 pty 实测覆盖，自动化回归测试列入后续候选。
