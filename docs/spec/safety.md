# Cellrix 安全分卷

> **版本**：v1.0
> **日期**：2026-08-30
> **所属方法论**：phyt-DNA v1.0

---

## 一、资源限制

### 1.1 节点限制
- **256 节点硬限制**：防止恶意智能体创建无限节点导致 OOM
- 超过限制的节点被拒绝，并记录审计日志

### 1.2 内容限制
- **1MB 内容限制**：每节点内容不超过 1MB
- 超过限制的内容被截断，并记录审计日志

### 1.3 超时限制
- **40 秒超时**：无响应客户端自动断开
- 超时后释放所有资源

### 1.4 心跳限制
- **19 秒心跳**：检测僵尸客户端
- 连续 2 次心跳失败后断开连接

---

## 二、能力授权

### 2.1 焦点管理
- CIC13 管理能力授权和确认
- 显示服务器拦截焦点切换，防止后台客户端窃取焦点
- 活动客户端独占输入

### 2.2 自我节流
- `sys_suspend`/`sys_resume` 允许智能体自我节流
- 挂起期间不接收输入事件
- 不允许影响其他客户端

---

## 三、与 Tuck 的对接

Cellrix 作为 Helix 生态的皮肤，需要与 Tuck（免疫系统）对接。

### 3.1 审计日志展示
- 消费 Tuck 的审计日志
- 展示安全事件（Pass/Reject/HITL/HardOverride）
- 展示决策时间、PFP 特征、SAP 验证结果

### 3.2 PFP 物理特征展示
- 展示 PFP-xCF14（4 字节）的物理特征
- Risk-Level（LOW/MEDIUM/CRITICAL/CATASTROPHIC）
- Modality（COGNITIVE/RENDER/EXECUTIVE/SENSOR_FEED）
- Body-Stance（SEATED/STANDING/MOVING/UNKNOWN）
- Proximity-Edge（SAFE/WARNING/DANGER/CRITICAL_EDGE）
- Override-Flag（NORMAL/HARD_OVERRIDE）

### 3.3 安全事件通知
- Tuck 触发 Reject 时，Cellrix 显示告警
- Tuck 触发 HITL 时，Cellrix 显示确认对话框
- Tuck 触发 HardOverride 时，Cellrix 显示紧急通知

---

## 四、传输安全

### 4.1 UDS 安全
- Unix 域套接字文件权限：0600（仅所有者可读写）
- 套接字目录权限：0700

### 4.2 TCP 安全
- 默认绑定 127.0.0.1（仅本地访问）
- 远程访问需显式配置，并建议使用 TLS

### 4.3 客户端认证
- 支持基于文件描述符的客户端认证（UDS）
- 支持基于令牌的客户端认证（TCP）

---

## 五、防篡改

### 5.1 视图哈希
- 每个 Snapshot 包含 view_hash（SHA-256）
- AI 可通过 view_hash 确定性地检测变化
- 防止内容被静默篡改

### 5.2 审计日志
- 所有客户端连接、断开、焦点切换事件记录审计日志
- 审计日志不可篡改（链式哈希）
- 支持审计查询

---

*《Cellrix 安全分卷》v1.0 完。*
