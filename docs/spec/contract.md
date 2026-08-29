# Cellrix 契约分卷

> **版本**：v1.0
> **日期**：2026-08-30
> **所属方法论**：phyt-DNA v1.0

---

## 一、CI-144 协议家族对齐

Cellrix 是 **CommonIntents-144 (CI-144)** 协议家族的官方参考实现。

### 1.1 CIN7 (INTENT-7)
- 定义意图模式，将快照结构化为 7 个核心语义字段
- 强制 **256 节点**硬限制
- 每节点 **1MB 内容**限制
- 防止资源受限设备上的 DDoS 和内存耗尽（OOM）

### 1.2 CIC13 (CAPABILITY-13)
- 管理能力授权和确认
- 显示服务器拦截焦点切换
- 路由下游 `sys_suspend` 和 `sys_resume` 命令
- 允许智能体执行本地自我节流

### 1.3 CIB19 (BIND-19)
- 建立传输绑定
- 强制 **19 秒**质数心跳间隔（防止多智能体网络共振）
- **40 秒**客户端超时阈值

---

## 二、AgentEvent 契约

智能体通过 `AgentEvent` 与 Cellrix 通信。

### 2.1 事件类型

| 事件类型 | 说明 | 优先级 |
|---|---|---|
| `Snapshot` | 完整语义快照 | 高（活动客户端完整反序列化） |
| `Action` | 智能体请求的动作 | 中 |
| `Heartbeat` | 19 秒心跳 | 低（CIB19 看门狗） |
| `Suspend` | 智能体请求挂起 | 中（后台自我节流） |
| `Resume` | 智能体请求恢复 | 中 |

### 2.2 Snapshot 结构

```json
{
  "view_hash": "sha256:...",
  "nodes": [
    {
      "id": "text_1",
      "node_type": "text_panel",
      "slot": "main",
      "content": "...",
      "coords": {"row": 0, "col": 0, "height": 10, "width": 80},
      "interactive": true,
      "metadata": {}
    }
  ],
  "focus": "text_1",
  "manifest": {...}
}
```

---

## 三、语义节点契约

每个语义节点遵循 CIN7 规范。

### 3.1 节点字段

| 字段 | 类型 | 说明 | 必填 |
|---|---|---|---|
| `id` | string | 唯一节点 ID | ✅ |
| `node_type` | string | 节点类型（text_panel/button/input/list/...） | ✅ |
| `slot` | string | 槽位标识（main/sidebar/status/...） | ✅ |
| `content` | string | 节点内容（≤1MB） | ✅ |
| `coords` | object | 物理坐标（row/col/height/width） | ✅ |
| `interactive` | bool | 是否可交互 | ✅ |
| `metadata` | object | 扩展元数据 | ❌ |

### 3.2 节点类型

| 类型 | 说明 | 交互方式 |
|---|---|---|
| `text_panel` | 文本面板 | 只读 |
| `button` | 按钮 | 点击 |
| `input` | 输入框 | 文本输入 |
| `list` | 列表 | 选择 |
| `table` | 表格 | 行列选择 |
| `chart` | 图表 | 数据点查看 |
| `status_bar` | 状态栏 | 只读 |
| `tab_bar` | 标签栏 | 标签切换 |

---

## 四、传输契约

### 4.1 UDS（Unix 域套接字）
- 默认传输方式
- 路径：`/tmp/cellrix.sock`（可配置）
- 支持多路复用

### 4.2 Stdio
- 标准输入输出传输
- 适用于嵌入式场景
- 支持单客户端

### 4.3 TCP
- 网络传输
- 端口：8443（可配置）
- 支持多客户端

---

## 五、能力契约

### 5.1 焦点管理
- 显示服务器拦截焦点切换
- 后台客户端无法窃取焦点
- 活动客户端独占输入

### 5.2 自我节流
- `sys_suspend`：智能体请求挂起（后台模式）
- `sys_resume`：智能体请求恢复（活动模式）
- 挂起期间不接收输入事件

---

*《Cellrix 契约分卷》v1.0 完。*
