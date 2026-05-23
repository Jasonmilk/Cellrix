# Cellrix Agent Protocol (CAP) v0.2

**Position:** Runtime interface specification for Cellrix, designed for AI Agents  
**Dependency:** [Common Intents Specification (CIS) v0.6.0](https://github.com/CommonIntents/CIS)  
**Status:** Draft

---

## 1. Overview

The Cellrix Agent Protocol (CAP) is the HTTP/WebSocket interface exposed by the Cellrix Daemon. It enables external AI Agents to:

1. **Perceive Interface State**: Obtain a complete, structured semantic tree snapshot in a read-only, strictly idempotent manner.
2. **Execute Intent Actions**: Invoke registered actions through standardized CIS requests.
3. **Controlled Security Access**: All operations pass through strict parameter validation and the HITL security gateway.

---

## 2. Endpoints

### 2.1 Semantic Snapshot
- **Method**: `GET`
- **Path**: `/v1/agent/snapshot`
- **Idempotency**: Absolutely idempotent. No side effects.
- **Response**: `SnapshotResponse` (Pydantic Strict Model), containing `viewport` (viewport metadata) and `cells` (complete semantic unit list). Each unit carries fields such as `role`, `summary`, `available_actions`.

### 2.2 Action Execution
- **Method**: `POST`
- **Path**: `/v1/agent/action`
- **Request Body**: `ActionRequest`
    - `action` (string): Must exactly match a registered action name.
    - `payload` (dict, optional): Must conform to the `parameters` JSON Schema defined for that intent in CIS.
- **Response**: `ActionResponse`
    - On success, returns `success: true`.
    - If the HITL security gateway is triggered, returns `success: false` with `error: "confirmation_required"`.

---

## 3. HITL Security Interception Flow

Cellrix implements a complete HITL state machine, adhering to the security constraints in CIS §4.3.

### 3.1 Execution Flow
1. Agent sends an `ActionRequest`.
2. Daemon parses the request and performs an interception evaluation based on the Manifest's `securityClass` and `requires_approval` fields.
3. If the action's security class is `safe`, or is `restricted` without explicit approval requirement, it is **executed directly**.
4. If the action's security class is `critical` or explicitly requires approval, execution is **suspended**, and a `confirmation_required` error is returned to the Agent.
5. After obtaining human approval, the Agent may resend the same action request to complete the invocation.

### 3.2 Error Code Mapping
| CIS Status | HTTP Status Code | Description |
| :--- | :--- | :--- |
| Normal execution | 200 OK | Action executed successfully |
| Invalid parameters | 422 Unprocessable Entity | Malformed request or parameters not matching Schema |
| Unknown action | 422 Unprocessable Entity | Action name not registered in the system |
| Security interception | 200 OK | Body returns error code `confirmation_required` |

---

## 4. Version Alignment

| CAP Version | Cellrix Version | CIS Version | Key Changes |
| :--- | :--- | :--- | :--- |
| v0.2 | Phase 1 & 2 | v0.6.0 | Implemented snapshot, action execution, and HITL interceptor |

---

## 5. Engineering Contracts

- **Fail Fast**: Any input that does not conform to the Pydantic strict mode is immediately rejected with a 422 status.
- **Zero Side-Effect Discovery**: The semantic snapshot endpoint never modifies internal state, allowing AI Agents to poll without limit.
- **Least Privilege**: Agents can only execute actions declared in the Manifest's capability whitelist.

## 6. CAP Endpoints (v0.2)

Cellrix exposes the Capability Authentication Protocol endpoints as defined in [CommonIntents/CAP](https://github.com/CommonIntents/CAP).

### 6.1 Capability Manifest
- **Method**: `GET`
- **Path**: `/v1/cap/manifest`
- **Response**: `CapabilityManifest`
  - `runtime`: `"Cellrix"`
  - `version`: current runtime version
  - `capabilities`: map of supported features (`snapshot`, `action`, `hitl`, `decisions`)
  - `trace_id_support`: `true`

### 6.2 Submit Decision
- **Method**: `POST`
- **Path**: `/v1/cap/decisions`
- **Request**: `DecisionRequest`
  - `decision_id`: string (format `decision_{action}_{num}`)
  - `approval`: boolean
  - `trace_id`: optional string
- **Response**: `ActionResponse` indicating execution or rejection.

### 6.3 Query Decision Status
- **Method**: `GET`
- **Path**: `/v1/cap/decisions/{decision_id}`
- **Response**: `DecisionStatusResponse`
  - `decision_id`: string
  - `status`: `"pending"` | `"unknown"`
  - `trace_id`: optional string

The decision queue is in-memory and tied to the daemon lifecycle. See `cli/daemon/interceptor.py` for implementation.
