//! Tentacle 客户端 — Trait + Mock 实现
//!
//! # Design Principle
//!
//! **极致解耦**: 客户端只依赖 cellrix-protocol 的数据结构，不依赖 Tentacle crate。
//! gRPC/HTTP 实现在可选 feature 中提供，默认使用 mock 实现。
//!
//! **按需加载**: 客户端是惰性的，只有调用方法时才建立连接。
//!
//! # Components
//!
//! - `TentacleClient`: 客户端 trait
//! - `MockTentacleClient`: mock 实现（用于测试和开发）

use async_trait::async_trait;
use cellrix_protocol::tentacle::{
    PluginAuditAction, PluginAuditEntry, PluginInfo, PluginStatus, ToolCallChain,
    ToolCallEdge, ToolCallNode, ToolCallRelation, ToolExecution, ToolExecutionStatus,
    TentacleState,
};
use crate::helix_mind_client::ClientError;
use std::sync::Mutex;

// ============================================================================
// Client Trait
// ============================================================================

/// Tentacle 客户端 trait
#[async_trait]
pub trait TentacleClient: Send + Sync {
    /// 获取综合状态
    async fn get_state(&self) -> Result<TentacleState, ClientError>;

    /// 获取活跃执行列表
    async fn get_active_executions(&self) -> Result<Vec<ToolExecution>, ClientError>;

    /// 获取最近执行记录
    async fn get_recent_executions(&self) -> Result<Vec<ToolExecution>, ClientError>;

    /// 获取插件列表
    async fn get_plugins(&self) -> Result<Vec<PluginInfo>, ClientError>;

    /// 获取插件审计记录
    async fn get_plugin_audit(&self) -> Result<Vec<PluginAuditEntry>, ClientError>;

    /// 获取工具调用链
    async fn get_call_chain(&self) -> Result<Option<ToolCallChain>, ClientError>;

    /// 取消执行
    async fn cancel_execution(&self, execution_id: &str) -> Result<bool, ClientError>;

    /// 健康检查
    async fn health_check(&self) -> Result<bool, ClientError>;
}

// ============================================================================
// Mock Client
// ============================================================================

/// Mock Tentacle 客户端（用于测试和开发）
#[derive(Debug)]
pub struct MockTentacleClient {
    state: Mutex<TentacleState>,
    simulate_error: bool,
}

impl MockTentacleClient {
    /// 创建新的 mock 客户端
    pub fn new() -> Self {
        let mut state = TentacleState::new("1.0.0", "tentacle-01");

        // 添加模拟插件
        let mut plugin1 = PluginInfo::new("plugin-001", "FileSystem", "1.2.0");
        plugin1.enable();
        plugin1.description = Some("文件系统操作插件".to_string());
        plugin1.tools = vec!["read_file".to_string(), "write_file".to_string(), "list_dir".to_string()];
        plugin1.record_execution(true);
        plugin1.record_execution(true);
        plugin1.record_execution(false);

        let mut plugin2 = PluginInfo::new("plugin-002", "GitHub", "0.9.1");
        plugin2.enable();
        plugin2.description = Some("GitHub API 操作插件".to_string());
        plugin2.tools = vec!["create_issue".to_string(), "create_pr".to_string()];
        plugin2.record_execution(true);

        let plugin3 = PluginInfo::new("plugin-003", "Database", "2.0.0");
        // 保持 Registered 状态

        state.register_plugin(plugin1);
        state.register_plugin(plugin2);
        state.register_plugin(plugin3);

        // 添加模拟执行
        let mut exec1 = ToolExecution::new("read_file");
        exec1.plugin_id = Some("plugin-001".to_string());
        exec1.start();
        exec1.complete("file content");

        let mut exec2 = ToolExecution::new("create_issue");
        exec2.plugin_id = Some("plugin-002".to_string());
        exec2.start();
        exec2.fail("API rate limit exceeded");

        let mut exec3 = ToolExecution::new("write_file");
        exec3.plugin_id = Some("plugin-001".to_string());
        exec3.start();

        state.recent_executions.push(exec1);
        state.recent_executions.push(exec2);
        state.add_active_execution(exec3);

        // 添加模拟审计记录
        let audit1 = PluginAuditEntry::new("plugin-001", PluginAuditAction::Register, "system");
        let mut audit2 = PluginAuditEntry::new("plugin-001", PluginAuditAction::Enable, "user");
        audit2.target = Some("FileSystem".to_string());
        let mut audit3 = PluginAuditEntry::new("plugin-002", PluginAuditAction::Execute, "user");
        audit3.target = Some("create_issue".to_string());
        audit3.fail("API rate limit exceeded");

        state.add_audit_entry(audit1);
        state.add_audit_entry(audit2);
        state.add_audit_entry(audit3);

        // 添加模拟调用链
        let mut chain = ToolCallChain::new("main-workflow");
        let mut node1 = ToolCallNode::new("exec-1", "read_file");
        node1.status = ToolExecutionStatus::Completed;
        node1.duration_ms = Some(150);
        let mut node2 = ToolCallNode::new("exec-2", "parse_data");
        node2.status = ToolExecutionStatus::Completed;
        node2.duration_ms = Some(320);
        let node3 = ToolCallNode::new("exec-3", "write_file");
        chain.add_node(node1);
        chain.add_node(node2);
        chain.add_node(node3);
        chain.add_edge(ToolCallEdge::new("exec-1", "exec-2", ToolCallRelation::Triggers));
        chain.add_edge(ToolCallEdge::new("exec-2", "exec-3", ToolCallRelation::DependsOn));
        chain.calculate_total_duration();
        state.call_chain = Some(chain);

        // 更新指标
        state.metrics.total_executions = 150;
        state.metrics.successful_executions = 142;
        state.metrics.failed_executions = 8;
        state.metrics.avg_execution_ms = Some(245.5);
        state.metrics.queue_length = 1;
        state.metrics.concurrent_executions = 1;

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

impl Default for MockTentacleClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TentacleClient for MockTentacleClient {
    async fn get_state(&self) -> Result<TentacleState, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.clone())
    }

    async fn get_active_executions(&self) -> Result<Vec<ToolExecution>, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.active_executions.clone())
    }

    async fn get_recent_executions(&self) -> Result<Vec<ToolExecution>, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.recent_executions.clone())
    }

    async fn get_plugins(&self) -> Result<Vec<PluginInfo>, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.plugins.clone())
    }

    async fn get_plugin_audit(&self) -> Result<Vec<PluginAuditEntry>, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.audit_entries.clone())
    }

    async fn get_call_chain(&self) -> Result<Option<ToolCallChain>, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let state = self.state.lock().unwrap();
        Ok(state.call_chain.clone())
    }

    async fn cancel_execution(&self, execution_id: &str) -> Result<bool, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }
        let mut state = self.state.lock().unwrap();
        if let Some(exec) = state
            .active_executions
            .iter_mut()
            .find(|e| e.id == execution_id)
        {
            exec.cancel();
            state.metrics.queue_length = state.active_executions.len();
            Ok(true)
        } else {
            Err(ClientError::NotFound(format!(
                "执行不存在: {}",
                execution_id
            )))
        }
    }

    async fn health_check(&self) -> Result<bool, ClientError> {
        Ok(!self.simulate_error)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_client_get_state() {
        let client = MockTentacleClient::new();
        let state = client.get_state().await.unwrap();
        assert_eq!(state.version, "1.0.0");
        assert_eq!(state.instance_id, "tentacle-01");
        assert_eq!(state.plugins.len(), 3);
        assert_eq!(state.active_count(), 1);
        assert!(state.call_chain.is_some());
    }

    #[tokio::test]
    async fn test_mock_client_get_active_executions() {
        let client = MockTentacleClient::new();
        let executions = client.get_active_executions().await.unwrap();
        assert_eq!(executions.len(), 1);
        assert_eq!(executions[0].tool_name, "write_file");
        assert_eq!(executions[0].status, ToolExecutionStatus::Running);
    }

    #[tokio::test]
    async fn test_mock_client_get_recent_executions() {
        let client = MockTentacleClient::new();
        let executions = client.get_recent_executions().await.unwrap();
        assert_eq!(executions.len(), 2);
        assert_eq!(executions[0].tool_name, "read_file");
        assert_eq!(executions[0].status, ToolExecutionStatus::Completed);
        assert_eq!(executions[1].tool_name, "create_issue");
        assert_eq!(executions[1].status, ToolExecutionStatus::Failed);
    }

    #[tokio::test]
    async fn test_mock_client_get_plugins() {
        let client = MockTentacleClient::new();
        let plugins = client.get_plugins().await.unwrap();
        assert_eq!(plugins.len(), 3);
        assert_eq!(plugins[0].name, "FileSystem");
        assert_eq!(plugins[0].status, PluginStatus::Enabled);
        assert_eq!(plugins[1].name, "GitHub");
        assert_eq!(plugins[1].status, PluginStatus::Enabled);
        assert_eq!(plugins[2].name, "Database");
        assert_eq!(plugins[2].status, PluginStatus::Registered);
    }

    #[tokio::test]
    async fn test_mock_client_get_plugin_audit() {
        let client = MockTentacleClient::new();
        let entries = client.get_plugin_audit().await.unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].action, PluginAuditAction::Execute);
        assert!(!entries[0].result); // 失败的执行
        assert_eq!(entries[1].action, PluginAuditAction::Enable);
        assert_eq!(entries[2].action, PluginAuditAction::Register);
    }

    #[tokio::test]
    async fn test_mock_client_get_call_chain() {
        let client = MockTentacleClient::new();
        let chain = client.get_call_chain().await.unwrap();
        assert!(chain.is_some());
        let chain = chain.unwrap();
        assert_eq!(chain.name, "main-workflow");
        assert_eq!(chain.node_count(), 3);
        assert_eq!(chain.edge_count(), 2);
        assert_eq!(chain.completed_count(), 2);
        assert!(chain.total_duration_ms.is_some());
    }

    #[tokio::test]
    async fn test_mock_client_cancel_execution() {
        let client = MockTentacleClient::new();
        let executions = client.get_active_executions().await.unwrap();
        let exec_id = executions[0].id.clone();

        let result = client.cancel_execution(&exec_id).await.unwrap();
        assert!(result);

        // 验证执行已取消
        let executions = client.get_active_executions().await.unwrap();
        assert_eq!(executions[0].status, ToolExecutionStatus::Cancelled);
    }

    #[tokio::test]
    async fn test_mock_client_cancel_nonexistent_execution() {
        let client = MockTentacleClient::new();
        let result = client.cancel_execution("nonexistent").await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ClientError::NotFound(_)));
    }

    #[tokio::test]
    async fn test_mock_client_health_check() {
        let client = MockTentacleClient::new();
        assert!(client.health_check().await.unwrap());

        let client_error = MockTentacleClient::new().with_simulate_error(true);
        assert!(!client_error.health_check().await.unwrap());
    }

    #[tokio::test]
    async fn test_mock_client_simulate_error() {
        let client = MockTentacleClient::new().with_simulate_error(true);
        assert!(client.get_state().await.is_err());
        assert!(client.get_active_executions().await.is_err());
        assert!(client.get_recent_executions().await.is_err());
        assert!(client.get_plugins().await.is_err());
        assert!(client.get_plugin_audit().await.is_err());
        assert!(client.get_call_chain().await.is_err());
        assert!(client.cancel_execution("test").await.is_err());
    }

    #[test]
    fn test_mock_client_new() {
        let client = MockTentacleClient::new();
        assert!(!client.simulate_error);
    }

    #[test]
    fn test_mock_client_metrics() {
        let client = MockTentacleClient::new();
        let state = client.state.lock().unwrap();
        assert_eq!(state.metrics.total_executions, 150);
        assert_eq!(state.metrics.successful_executions, 142);
        assert_eq!(state.metrics.failed_executions, 8);
        assert!((state.metrics.success_rate() - 142.0 / 150.0).abs() < 0.001);
    }
}
