# Cellrix Agent Protocol (CAP) v0.2

**定位：** Cellrix 面向 AI Agent 的运行时接口规范  
**依赖：** [Common Intents Specification (CIS) v0.6.0](https://github.com/CommonIntents/CIS)  
**状态：** 草案

---

## 1. 协议概述

Cellrix Agent Protocol (CAP) 是 Cellrix 守护进程（Daemon）暴露的 HTTP/WebSocket 接口。它使外部 AI Agent 能够：

1. **感知界面状态**：以只读、绝对幂等的方式获取完整的结构化语义树快照。
2. **执行意图操作**：通过标准化的 CIS 请求调用已注册的动作。
3. **受控安全访问**：所有操作都通过严格的参数校验和 HITL 安全网关。

---

## 2. 端点

### 2.1 语义快照
- **方法**：`GET`
- **路径**：`/v1/agent/snapshot`
- **幂等性**：绝对幂等。不产生副作用。
- **响应**：`SnapshotResponse` (Pydantic Strict Model)，包含 `viewport`（视口元数据）和 `cells`（完整语义单元列表）。每个单元都附带 `role`, `summary`, `available_actions` 等字段。

### 2.2 动作执行
- **方法**：`POST`
- **路径**：`/v1/agent/action`
- **请求体**：`ActionRequest`
    - `action` (string)：必须与注册的动作名完全匹配。
    - `payload` (dict, 可选)：对应 CIS 中该意图定义的 `parameters` JSON Schema。
- **响应**：`ActionResponse`
    - 成功时返回 `success: true`。
    - 若触发 HITL 安全网关，返回 `success: false` 及 `error: "confirmation_required"`。

---

## 3. HITL 安全拦截流程

Cellrix 实现了完整的 HITL 状态机，遵循 CIS §4.3 的安全约束。

### 3.1 执行流程
1. Agent 发送 `ActionRequest`。
2. Daemon 解析后，依据 Manifest 中的 `securityClass` 和 `requires_approval` 进行拦截评估。
3. 若动作安全等级为 `safe` 或 `restricted` 但未明确要求审批，则**直接执行**。
4. 若动作安全等级为 `critical` 或明确要求审批，则**挂起执行**，并向 Agent 返回 `confirmation_required` 错误。
5. 在 Agent 获得人类审批后，再次发送相同动作请求完成调用。

### 3.2 错误码映射
| CIS 状态 | HTTP 状态码 | 说明 |
| :--- | :--- | :--- |
| 正常执行 | 200 OK | 动作执行成功 |
| 参数非法 | 422 Unprocessable Entity | 请求格式错误或参数不符合 Schema |
| 未知动作 | 422 Unprocessable Entity | 动作名未在系统中注册 |
| 安全拦截 | 200 OK | Body 中返回 `confirmation_required` 错误码 |

---

## 4. 版本对齐

| CAP 版本 | Cellrix 版本 | CIS 版本 | 主要变更 |
| :--- | :--- | :--- | :--- |
| v0.2 | Phase 1 & 2 | v0.6.0 | 实现快照、动作执行、HITL 拦截器 |

---

## 5. 工程契约

- **严格失败 (Fail Fast)**：任何不符合 Pydantic 严格模式的输入都立即返回 422 拒绝。
- **零副作用发现**：语义快照端点绝不修改内部状态，允许 AI Agent 无限制地轮询。
- **最小权限**：Agent 只能执行在 Manifest 的能力白名单中声明的动作。
