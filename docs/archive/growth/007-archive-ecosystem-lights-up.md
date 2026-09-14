# 归档：生态点亮 + 一键重启（up --restart）

> **归档日期**：2026-09-14
> **来源**：`docs/GROWTH.md`
> **原因**：GROWTH.md 恒定只保留最近 3 条健康快照（铁律 4）；本条为当时最旧一条，本次因新增快照而移出。
> **性质**：原文照搬，未作删改。

---

## [2026-09-07] 生态点亮 + 一键重启（up --restart）

### 变更性质
- **WebUI 生态点亮条**：/api/ecosystem 端点（TCP 探测 + HTTP health 双检，
  协议默认端口，0 硬编码）；tentacle/mind/anaphase/tuck/panel 每组件状态点
  （绿=健康 / 黄=启动未联通 / 灰=未运行 / 红=错误）——四色语义对齐自检规范
- **up --restart**：全生态一键重启（停止逆依赖序 → 启动依赖序 → 每步健康检查）。
  修复 SIGTERM 杀不净问题：6s 未释放自动 SIGKILL 兜底，端口释放确认后才继续
- **清理**：删除旧审计链分组渲染（renderAudit/pollAudit/a-*）——ProveTrack v2
  时间线替代；Tuck 审计链仍经 /api/audit 可查（foot 链接）

### 验收
- 实测 `up --restart --no-open`：5 组件全部新 pid（旧 tentacle/mind/tuck
  被 SIGKILL 兜底清掉），生态点亮 5/5 ok
- 重启后端到端：7^9 → calc ok 40353607，新经历 run-35718410f20c6cda（n=8）
- Cellrix 测试 341 passed 全绿
