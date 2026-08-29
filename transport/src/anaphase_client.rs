//! Anaphase 客户端 — Trait + Mock 实现
//!
//! # Design Principle
//!
//! **极致解耦**: 客户端只依赖 cellrix-protocol 的数据结构，不依赖 Anaphase crate。
//! gRPC 实现在可选 feature 中提供，默认使用 mock 实现。
//!
//! **按需加载**: 客户端是惰性的，只有调用方法时才建立连接。
//!
//! # Components
//!
//! - `AnaphaseClient`: 客户端 trait
//! - `MockAnaphaseClient`: mock 实现（用于测试和开发）
//! - `ClientError`: 客户端错误类型（复用 helix_mind_client）

use async_trait::async_trait;
use cellrix_protocol::anaphase::{
    AnaphaseState, CognitivePhase, HITLRequest, HITLRequestStatus, HITLStatus, LifecyclePhase,
    LifecycleStatus, RiskLevel, TaskDagSnapshot, TaskEdge, TaskNode, TaskNodeKind, TaskStatus,
};
use crate::helix_mind_client::ClientError;
use std::sync::Mutex;
use uuid::Uuid;

// ============================================================================
// Client Trait
// ============================================================================

/// Anaphase 客户端 trait
#[async_trait]
pub trait AnaphaseClient: Send + Sync {
    /// 获取综合状态
    async fn get_state(&self) -> Result<AnaphaseState, ClientError>;

    /// 获取任务 DAG 快照
    async fn get_task_dag(&self) -> Result<TaskDagSnapshot, ClientError>;

    /// 获取 HITL 状态
    async fn get_hitl_status(&self) -> Result<HITLStatus, ClientError>;

    /// 获取待确认 HITL 请求列表
    async fn get_hitl_requests(&self) -> Result<Vec<HITLRequest>, ClientError>;

    /// 批准 HITL 请求
    async fn approve_request(&self, request_id: &str, approver: &str) -> Result<bool, ClientError>;

    /// 拒绝 HITL 请求
    async fn reject_request(
        &self,
        request_id: &str,
        reason: &str,
        approver: &str,
    ) -> Result<bool, ClientError>;

    /// 获取生命周期状态
    async fn get_lifecycle(&self) -> Result<LifecycleStatus, ClientError>;

    /// 健康检查
    async fn health_check(&self) -> Result<bool, ClientError>;
}

// ============================================================================
// Mock Client
// ============================================================================

/// Mock Anaphase 客户端（用于测试和开发）
#[derive(Debug)]
pub struct MockAnaphaseClient {
    state: Mutex<AnaphaseState>,
    simulate_error: bool,
}

impl MockAnaphaseClient {
    /// 创建新的 mock 客户端
    pub fn new() -> Self {
        let mut state = AnaphaseState::new("1.0.0", "mock-anaphase-01");
        state.current_phase = CognitivePhase::Reasoning;
        state.lifecycle.phase = LifecyclePhase::Running;
        state.lifecycle.uptime_seconds = 7200; // 2小时

        // 添加模拟任务
        let mut task1 = TaskNode::new(
            "task-001",
            "main-branch",
            "研究 CI-144 v2.0 协议规范",
            TaskNodeKind::TaskRoot,
        );
        task1.status = TaskStatus::Completed;
        task1.progress = 1.0;
        task1.duration_ms = Some(15000);

        let mut task2 = TaskNode::new(
            "task-002",
            "main-branch",
            "实现 PFP-xCF14 解析器",
            TaskNodeKind::SubTask,
        );
        task2.status = TaskStatus::Completed;
        task2.progress = 1.0;
        task2.duration_ms = Some(8000);

        let mut task3 = TaskNode::new(
            "task-003",
            "main-branch",
            "实现 SAP-xCF14 解析器",
            TaskNodeKind::SubTask,
        );
        task3.status = TaskStatus::Running;
        task3.progress = 0.6;
        task3.started_at = Some(chrono_now());

        let task4 = TaskNode::new(
            "task-004",
            "main-branch",
            "集成测试与压测",
            TaskNodeKind::SubTask,
        );
        let mut task4 = task4;
        task4.status = TaskStatus::WaitingHITL;

        state.task_dag.nodes.push(task1);
        state.task_dag.nodes.push(task2);
        state.task_dag.nodes.push(task3);
        state.task_dag.nodes.push(task4);
        state.task_dag.root_id = Some("task-001".to_string());

        // 添加任务依赖
        state.task_dag.edges.push(TaskEdge::new("task-001", "task-002", "contains"));
        state.task_dag.edges.push(TaskEdge::new("task-001", "task-003", "contains"));
        state.task_dag.edges.push(TaskEdge::new("task-002", "task-004", "depends_on"));
        state.task_dag.edges.push(TaskEdge::new("task-003", "task-004", "depends_on"));

        // 添加模拟 HITL 请求
        let req1 = HITLRequest::new(
            "hitl-001",
            "cargo test --workspace",
            RiskLevel::Medium,
            "运行完整测试套件",
        );
        let mut req1 = req1;
        req1.task_id = Some("task-004".to_string());
        req1.cognitive_phase = Some(CognitivePhase::Execution);

        let req2 = HITLRequest::new(
            "hitl-002",
            "git push origin rs2",
            RiskLevel::High,
            "网络操作: 推送代码到远程仓库",
        );
        let mut req2 = req2;
        req2.task_id = Some("task-004".to_string());
        req2.cognitive_phase = Some(CognitivePhase::Execution);

        state.hitl.pending_requests.push(req1);
        state.hitl.pending_requests.push(req2);
        state.hitl.pending_count = 2;
        state.hitl.approved_count = 15;
        state.hitl.rejected_count = 3;
        state.hitl.timed_out_count = 1;
        state.hitl.channel_available = true;
        state.hitl.fail_closed = true;

        state.active_task_id = Some("task-003".to_string());

        Self {
            state: Mutex::new(state),
            simulate_error: false,
        }
    }

    /// 设置是否模拟错误
    pub fn with_simulate_error(mut self, simulate: bool) -> Self {
        self.simulate_error = simulate;
        self
    }
}

impl Default for MockAnaphaseClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AnaphaseClient for MockAnaphaseClient {
    async fn get_state(&self) -> Result<AnaphaseState, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.clone())
    }

    async fn get_task_dag(&self) -> Result<TaskDagSnapshot, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.task_dag.clone())
    }

    async fn get_hitl_status(&self) -> Result<HITLStatus, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.hitl.clone())
    }

    async fn get_hitl_requests(&self) -> Result<Vec<HITLRequest>, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.hitl.pending_requests.clone())
    }

    async fn approve_request(&self, request_id: &str, approver: &str) -> Result<bool, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let mut state = self.state.lock().unwrap();

        // 找到请求的位置索引
        let req_index = state
            .hitl
            .pending_requests
            .iter()
            .position(|r| r.id == request_id);

        if let Some(index) = req_index {
            // 修改请求
            let req = &mut state.hitl.pending_requests[index];
            req.status = HITLRequestStatus::Approved;
            req.approver = Some(approver.to_string());
            req.resolved_at = Some(chrono_now());
            let task_id = req.task_id.clone();

            state.hitl.pending_count -= 1;
            state.hitl.approved_count += 1;
            state.hitl.last_approval_at = Some(chrono_now());

            // 如果关联任务在 WaitingHITL，改为 Running
            if let Some(task_id) = task_id {
                if let Some(task) = state
                    .task_dag
                    .nodes
                    .iter_mut()
                    .find(|t| t.id == task_id && t.status == TaskStatus::WaitingHITL)
                {
                    task.status = TaskStatus::Running;
                    task.started_at = Some(chrono_now());
                }
            }

            Ok(true)
        } else {
            Err(ClientError::NotFound(format!(
                "HITL 请求不存在: {}",
                request_id
            )))
        }
    }

    async fn reject_request(
        &self,
        request_id: &str,
        reason: &str,
        approver: &str,
    ) -> Result<bool, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let mut state = self.state.lock().unwrap();

        // 找到请求的位置索引
        let req_index = state
            .hitl
            .pending_requests
            .iter()
            .position(|r| r.id == request_id);

        if let Some(index) = req_index {
            // 修改请求
            let req = &mut state.hitl.pending_requests[index];
            req.status = HITLRequestStatus::Rejected;
            req.approver = Some(approver.to_string());
            req.reject_reason = Some(reason.to_string());
            req.resolved_at = Some(chrono_now());
            let task_id = req.task_id.clone();

            state.hitl.pending_count -= 1;
            state.hitl.rejected_count += 1;

            // 如果关联任务在 WaitingHITL，改为 Failed
            if let Some(task_id) = task_id {
                if let Some(task) = state
                    .task_dag
                    .nodes
                    .iter_mut()
                    .find(|t| t.id == task_id && t.status == TaskStatus::WaitingHITL)
                {
                    task.status = TaskStatus::Failed;
                    task.error = Some(format!("HITL 拒绝: {}", reason));
                    task.completed_at = Some(chrono_now());
                }
            }

            Ok(true)
        } else {
            Err(ClientError::NotFound(format!(
                "HITL 请求不存在: {}",
                request_id
            )))
        }
    }

    async fn get_lifecycle(&self) -> Result<LifecycleStatus, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.lifecycle.clone())
    }

    async fn health_check(&self) -> Result<bool, ClientError> {
        Ok(!self.simulate_error)
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// 获取当前时间（ISO 8601 格式，简化为 Unix 时间戳字符串）
fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", now)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_client_get_state() {
        let client = MockAnaphaseClient::new();
        let state = client.get_state().await.unwrap();
        assert_eq!(state.current_phase, CognitivePhase::Reasoning);
        assert_eq!(state.lifecycle.phase, LifecyclePhase::Running);
        assert_eq!(state.task_dag.node_count(), 4);
        assert_eq!(state.hitl.pending_count, 2);
    }

    #[tokio::test]
    async fn test_mock_client_get_task_dag() {
        let client = MockAnaphaseClient::new();
        let dag = client.get_task_dag().await.unwrap();
        assert_eq!(dag.node_count(), 4);
        assert_eq!(dag.edge_count(), 4);
        assert_eq!(dag.running_count(), 1);
        assert_eq!(dag.completed_count(), 2);
        assert_eq!(dag.waiting_hitl_count(), 1);
        assert_eq!(dag.root_id, Some("task-001".to_string()));
    }

    #[tokio::test]
    async fn test_mock_client_get_hitl_status() {
        let client = MockAnaphaseClient::new();
        let status = client.get_hitl_status().await.unwrap();
        assert_eq!(status.pending_count, 2);
        assert_eq!(status.approved_count, 15);
        assert_eq!(status.rejected_count, 3);
        assert_eq!(status.timed_out_count, 1);
        assert!(status.channel_available);
        assert!(status.fail_closed);
        assert!(status.has_pending());
    }

    #[tokio::test]
    async fn test_mock_client_get_hitl_requests() {
        let client = MockAnaphaseClient::new();
        let requests = client.get_hitl_requests().await.unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].id, "hitl-001");
        assert_eq!(requests[1].id, "hitl-002");
        assert_eq!(requests[1].risk_level, RiskLevel::High);
    }

    #[tokio::test]
    async fn test_mock_client_approve_request() {
        let client = MockAnaphaseClient::new();
        let result = client.approve_request("hitl-001", "test-user").await.unwrap();
        assert!(result);

        // 验证状态更新
        let status = client.get_hitl_status().await.unwrap();
        assert_eq!(status.pending_count, 1);
        assert_eq!(status.approved_count, 16);

        // 验证请求状态
        let requests = client.get_hitl_requests().await.unwrap();
        // hitl-001 已不在 pending 列表中（但 mock 中 pending_requests 仍包含，只是状态变了）
        let req1 = requests.iter().find(|r| r.id == "hitl-001").unwrap();
        assert_eq!(req1.status, HITLRequestStatus::Approved);
        assert_eq!(req1.approver, Some("test-user".to_string()));
    }

    #[tokio::test]
    async fn test_mock_client_reject_request() {
        let client = MockAnaphaseClient::new();
        let result = client
            .reject_request("hitl-002", "安全风险", "test-user")
            .await
            .unwrap();
        assert!(result);

        // 验证状态更新
        let status = client.get_hitl_status().await.unwrap();
        assert_eq!(status.pending_count, 1);
        assert_eq!(status.rejected_count, 4);

        // 验证请求状态
        let requests = client.get_hitl_requests().await.unwrap();
        let req2 = requests.iter().find(|r| r.id == "hitl-002").unwrap();
        assert_eq!(req2.status, HITLRequestStatus::Rejected);
        assert_eq!(req2.reject_reason, Some("安全风险".to_string()));
    }

    #[tokio::test]
    async fn test_mock_client_approve_nonexistent_request() {
        let client = MockAnaphaseClient::new();
        let result = client.approve_request("nonexistent", "test-user").await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ClientError::NotFound(_)));
    }

    #[tokio::test]
    async fn test_mock_client_get_lifecycle() {
        let client = MockAnaphaseClient::new();
        let lifecycle = client.get_lifecycle().await.unwrap();
        assert_eq!(lifecycle.phase, LifecyclePhase::Running);
        assert_eq!(lifecycle.version, "1.0.0");
        assert_eq!(lifecycle.instance_id, "mock-anaphase-01");
        assert_eq!(lifecycle.uptime_seconds, 7200);
        assert_eq!(lifecycle.heartbeat_interval_seconds, 19);
    }

    #[tokio::test]
    async fn test_mock_client_health_check() {
        let client = MockAnaphaseClient::new();
        assert!(client.health_check().await.unwrap());

        let client_error = MockAnaphaseClient::new().with_simulate_error(true);
        assert!(!client_error.health_check().await.unwrap());
    }

    #[tokio::test]
    async fn test_mock_client_simulate_error() {
        let client = MockAnaphaseClient::new().with_simulate_error(true);
        assert!(client.get_state().await.is_err());
        assert!(client.get_task_dag().await.is_err());
        assert!(client.get_hitl_status().await.is_err());
        assert!(client.get_hitl_requests().await.is_err());
        assert!(client.get_lifecycle().await.is_err());
    }

    #[test]
    fn test_mock_client_new() {
        let client = MockAnaphaseClient::new();
        assert!(!client.simulate_error);
    }

    #[test]
    fn test_chrono_now() {
        let now = chrono_now();
        assert!(!now.is_empty());
        assert!(now.parse::<u64>().is_ok());
    }
}
