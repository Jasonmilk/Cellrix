//! Helix-Mind 客户端 — Trait + Mock 实现
//!
//! # Design Principle
//!
//! **极致解耦**: 客户端只依赖 cellrix-protocol 的数据结构，不依赖 Helix-Mind crate。
//! gRPC 实现在可选 feature 中提供，默认使用 mock 实现。
//!
//! **按需加载**: 客户端是惰性的，只有调用方法时才建立连接。
//!
//! # Components
//!
//! - `HelixMindClient`: 客户端 trait（query/remember/forget/helix_query/consolidate）
//! - `MockHelixMindClient`: mock 实现（用于测试和开发）
//! - `ClientError`: 客户端错误类型

use async_trait::async_trait;
use cellrix_protocol::helix_mind::{
    CognitiveMode, CognitiveStatus, HelixSnapshot, KnowledgeGraph, KnowledgeNode,
    MetabolismStatus, PhaseState,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ============================================================================
// Error Type
// ============================================================================

/// 客户端错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClientError {
    /// 连接失败
    ConnectionFailed(String),
    /// 请求超时
    Timeout(String),
    /// 服务端错误
    ServerError(String),
    /// 未找到
    NotFound(String),
    /// 无效参数
    InvalidArgument(String),
    /// 其他错误
    Other(String),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConnectionFailed(msg) => write!(f, "连接失败: {}", msg),
            Self::Timeout(msg) => write!(f, "请求超时: {}", msg),
            Self::ServerError(msg) => write!(f, "服务端错误: {}", msg),
            Self::NotFound(msg) => write!(f, "未找到: {}", msg),
            Self::InvalidArgument(msg) => write!(f, "无效参数: {}", msg),
            Self::Other(msg) => write!(f, "其他错误: {}", msg),
        }
    }
}

impl std::error::Error for ClientError {}

// ============================================================================
// Query Types
// ============================================================================

/// 查询请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRequest {
    /// 查询文本
    pub query: String,
    /// 认知模式（可选，默认 Skilled）
    pub mode: Option<CognitiveMode>,
    /// 返回结果数量（可选，默认 10）
    pub top_k: Option<u32>,
    /// 最大深度（可选，默认 3）
    pub max_depth: Option<u32>,
    /// 是否包含隐性节点（可选，默认 false）
    pub include_recessive: Option<bool>,
}

impl QueryRequest {
    /// 创建新的查询请求
    pub fn new(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            mode: None,
            top_k: None,
            max_depth: None,
            include_recessive: None,
        }
    }
}

/// 查询结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    /// 匹配的节点
    pub nodes: Vec<KnowledgeNode>,
    /// 匹配的边
    pub edges: Vec<cellrix_protocol::helix_mind::KnowledgeEdge>,
    /// 追踪 ID
    pub trace_id: String,
    /// 延迟（毫秒）
    pub latency_ms: u64,
    /// 是否部分结果
    pub is_partial: bool,
    /// 耗尽原因
    pub exhaustion_reason: String,
    /// 认知状态（如果是高级查询）
    pub cognitive: Option<CognitiveStatus>,
}

/// 记忆请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RememberRequest {
    /// 记忆内容
    pub content: String,
    /// 节点类型（可选）
    pub node_type: Option<String>,
    /// 敏感度（可选，默认 Private）
    pub sensitivity: Option<String>,
}

impl RememberRequest {
    /// 创建新的记忆请求
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            node_type: None,
            sensitivity: None,
        }
    }
}

/// 记忆结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RememberResult {
    /// 节点 ID
    pub node_id: String,
    /// 是否成功
    pub success: bool,
}

/// 遗忘请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgetRequest {
    /// 节点 ID
    pub node_id: String,
}

/// 遗忘结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgetResult {
    /// 是否成功
    pub success: bool,
}

/// 巩固类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsolidateType {
    /// 摘要（将气态转为液态）
    Digest,
    /// 结晶（将液态转为晶态）
    Crystallize,
    /// 休眠（压缩旧记忆）
    Hibernate,
}

impl ConsolidateType {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "digest" => Some(Self::Digest),
            "crystallize" => Some(Self::Crystallize),
            "hibernate" => Some(Self::Hibernate),
            _ => None,
        }
    }

    /// 获取标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Digest => "摘要 (Digest)",
            Self::Crystallize => "结晶 (Crystallize)",
            Self::Hibernate => "休眠 (Hibernate)",
        }
    }
}

/// 巩固请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolidateRequest {
    /// 巩固类型
    pub consolidate_type: ConsolidateType,
}

/// 巩固结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolidateResult {
    /// 是否成功
    pub success: bool,
    /// 消息
    pub message: String,
}

// ============================================================================
// Client Trait
// ============================================================================

/// Helix-Mind 客户端 trait
#[async_trait]
pub trait HelixMindClient: Send + Sync {
    /// 简单查询（Layer 1）
    async fn query(&self, request: QueryRequest) -> Result<QueryResult, ClientError>;

    /// 记忆新内容（Layer 1）
    async fn remember(&self, request: RememberRequest) -> Result<RememberResult, ClientError>;

    /// 遗忘内容（Layer 1）
    async fn forget(&self, request: ForgetRequest) -> Result<ForgetResult, ClientError>;

    /// 高级认知查询（Layer 3）
    async fn helix_query(&self, request: QueryRequest) -> Result<QueryResult, ClientError>;

    /// 记忆巩固（Layer 3）
    async fn consolidate(
        &self,
        request: ConsolidateRequest,
    ) -> Result<ConsolidateResult, ClientError>;

    /// 获取综合快照
    async fn get_snapshot(&self) -> Result<HelixSnapshot, ClientError>;

    /// 健康检查
    async fn health_check(&self) -> Result<bool, ClientError>;
}

// ============================================================================
// Mock Client
// ============================================================================

/// Mock Helix-Mind 客户端（用于测试和开发）
#[derive(Debug, Clone)]
pub struct MockHelixMindClient {
    /// 模拟的知识图谱
    graph: KnowledgeGraph,
    /// 模拟的认知状态
    cognitive: CognitiveStatus,
    /// 模拟的代谢状态
    metabolism: MetabolismStatus,
    /// 查询延迟（毫秒）
    query_latency_ms: u64,
    /// 是否模拟错误
    simulate_error: bool,
}

impl MockHelixMindClient {
    /// 创建新的 mock 客户端
    pub fn new() -> Self {
        let mut graph = KnowledgeGraph::new();

        // 添加一些模拟节点
        let nodes = vec![
            ("n1", "text", "Helix-Mind 是记忆中枢", 0.9, PhaseState::Liquid),
            ("n2", "text", "认知工艺包括工序编排", 0.7, PhaseState::Liquid),
            ("n3", "text", "记忆代谢包括气态/液态/晶态", 0.5, PhaseState::Crystal),
            ("n4", "text", "Cellrix 是语义投影终端", 0.8, PhaseState::Liquid),
            ("n5", "text", "Tuck 是免疫系统", 0.3, PhaseState::Crystal),
        ];

        for (id, node_type, content, heat, phase) in nodes {
            graph.nodes.push(KnowledgeNode {
                id: id.to_string(),
                node_type: node_type.to_string(),
                content_json: content.to_string(),
                heat,
                is_hypothetical: false,
                is_recessive: false,
                sensitivity: "Public".to_string(),
                generation: 1,
                phase_state: phase,
                concentration: cellrix_protocol::helix_mind::Concentration::Dissolved,
                tension: 0.3,
                access_count: (heat * 20.0) as u64,
            });
        }

        // 添加一些模拟边
        graph.edges.push(cellrix_protocol::helix_mind::KnowledgeEdge {
            source_id: "n1".to_string(),
            target_id: "n4".to_string(),
            weight: 0.8,
            relation_type: "related_to".to_string(),
            is_soft: false,
        });
        graph.edges.push(cellrix_protocol::helix_mind::KnowledgeEdge {
            source_id: "n1".to_string(),
            target_id: "n2".to_string(),
            weight: 0.6,
            relation_type: "contains".to_string(),
            is_soft: false,
        });
        graph.edges.push(cellrix_protocol::helix_mind::KnowledgeEdge {
            source_id: "n1".to_string(),
            target_id: "n3".to_string(),
            weight: 0.5,
            relation_type: "contains".to_string(),
            is_soft: false,
        });

        let cognitive = CognitiveStatus {
            effective_mode: CognitiveMode::Skilled,
            mode_negotiation: "default".to_string(),
            impasse_level: 0,
            stages_attempted: 3,
            suggested_actions: vec![],
            activation_vector: vec![],
            tokens_consumed: 1200,
            latency_ms: 150,
            is_partial: false,
            exhaustion_reason: String::new(),
            trace_id: Uuid::new_v4().to_string(),
        };

        let metabolism = MetabolismStatus {
            phase_state: PhaseState::Liquid,
            concentration: cellrix_protocol::helix_mind::Concentration::Colloidal,
            tension: 0.4,
            heat: 0.6,
            generation: 3,
            initial_impact: 0.5,
            access_count: 150,
            is_hypothetical: false,
            is_recessive: false,
            subject_dependency: "high".to_string(),
            sensitivity: "Private".to_string(),
        };

        Self {
            graph,
            cognitive,
            metabolism,
            query_latency_ms: 50,
            simulate_error: false,
        }
    }

    /// 设置查询延迟
    pub fn with_query_latency(mut self, latency_ms: u64) -> Self {
        self.query_latency_ms = latency_ms;
        self
    }

    /// 设置是否模拟错误
    pub fn with_simulate_error(mut self, simulate: bool) -> Self {
        self.simulate_error = simulate;
        self
    }

    /// 添加节点
    pub fn add_node(&mut self, node: KnowledgeNode) {
        self.graph.nodes.push(node);
    }

    /// 获取知识图谱引用
    pub fn graph(&self) -> &KnowledgeGraph {
        &self.graph
    }

    /// 获取认知状态引用
    pub fn cognitive(&self) -> &CognitiveStatus {
        &self.cognitive
    }

    /// 获取代谢状态引用
    pub fn metabolism(&self) -> &MetabolismStatus {
        &self.metabolism
    }
}

impl Default for MockHelixMindClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl HelixMindClient for MockHelixMindClient {
    async fn query(&self, request: QueryRequest) -> Result<QueryResult, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }

        // 模拟延迟
        tokio::time::sleep(std::time::Duration::from_millis(self.query_latency_ms)).await;

        // 简单的关键词匹配
        let query_lower = request.query.to_lowercase();
        let matched_nodes: Vec<KnowledgeNode> = self
            .graph
            .nodes
            .iter()
            .filter(|node| {
                node.content_json.to_lowercase().contains(&query_lower)
                    || node.node_type.to_lowercase().contains(&query_lower)
            })
            .cloned()
            .collect();

        let matched_edges: Vec<cellrix_protocol::helix_mind::KnowledgeEdge> = self
            .graph
            .edges
            .iter()
            .filter(|edge| {
                matched_nodes
                    .iter()
                    .any(|n| n.id == edge.source_id || n.id == edge.target_id)
            })
            .cloned()
            .collect();

        Ok(QueryResult {
            nodes: matched_nodes,
            edges: matched_edges,
            trace_id: Uuid::new_v4().to_string(),
            latency_ms: self.query_latency_ms,
            is_partial: false,
            exhaustion_reason: String::new(),
            cognitive: None,
        })
    }

    async fn remember(&self, request: RememberRequest) -> Result<RememberResult, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }

        Ok(RememberResult {
            node_id: Uuid::new_v4().to_string(),
            success: true,
        })
    }

    async fn forget(&self, request: ForgetRequest) -> Result<ForgetResult, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }

        Ok(ForgetResult { success: true })
    }

    async fn helix_query(&self, request: QueryRequest) -> Result<QueryResult, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }

        // 模拟延迟
        tokio::time::sleep(std::time::Duration::from_millis(self.query_latency_ms * 2)).await;

        // 简单的关键词匹配
        let query_lower = request.query.to_lowercase();
        let matched_nodes: Vec<KnowledgeNode> = self
            .graph
            .nodes
            .iter()
            .filter(|node| {
                node.content_json.to_lowercase().contains(&query_lower)
                    || node.node_type.to_lowercase().contains(&query_lower)
            })
            .cloned()
            .collect();

        let matched_edges: Vec<cellrix_protocol::helix_mind::KnowledgeEdge> = self
            .graph
            .edges
            .iter()
            .filter(|edge| {
                matched_nodes
                    .iter()
                    .any(|n| n.id == edge.source_id || n.id == edge.target_id)
            })
            .cloned()
            .collect();

        // 返回认知状态
        let mut cognitive = self.cognitive.clone();
        cognitive.trace_id = Uuid::new_v4().to_string();
        cognitive.latency_ms = self.query_latency_ms * 2;
        cognitive.tokens_consumed = 1500 + (request.query.len() as u64 * 10);

        Ok(QueryResult {
            nodes: matched_nodes,
            edges: matched_edges,
            trace_id: cognitive.trace_id.clone(),
            latency_ms: cognitive.latency_ms,
            is_partial: false,
            exhaustion_reason: String::new(),
            cognitive: Some(cognitive),
        })
    }

    async fn consolidate(
        &self,
        request: ConsolidateRequest,
    ) -> Result<ConsolidateResult, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }

        let message = match request.consolidate_type {
            ConsolidateType::Digest => "已完成摘要：气态记忆转为液态".to_string(),
            ConsolidateType::Crystallize => "已完成结晶：液态记忆转为晶态".to_string(),
            ConsolidateType::Hibernate => "已完成休眠：旧记忆已压缩".to_string(),
        };

        Ok(ConsolidateResult {
            success: true,
            message,
        })
    }

    async fn get_snapshot(&self) -> Result<HelixSnapshot, ClientError> {
        if self.simulate_error {
            return Err(ClientError::ServerError("模拟错误".to_string()));
        }

        Ok(HelixSnapshot {
            cognitive: self.cognitive.clone(),
            metabolism: self.metabolism.clone(),
            graph: self.graph.clone(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        })
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
    async fn test_mock_client_query() {
        let client = MockHelixMindClient::new();
        let result = client
            .query(QueryRequest::new("记忆"))
            .await
            .unwrap();
        assert!(!result.nodes.is_empty());
        assert!(result.trace_id.len() > 0);
    }

    #[tokio::test]
    async fn test_mock_client_query_no_match() {
        let client = MockHelixMindClient::new();
        let result = client
            .query(QueryRequest::new("不存在的关键词xyz"))
            .await
            .unwrap();
        assert!(result.nodes.is_empty());
    }

    #[tokio::test]
    async fn test_mock_client_remember() {
        let client = MockHelixMindClient::new();
        let result = client
            .remember(RememberRequest::new("新的记忆内容"))
            .await
            .unwrap();
        assert!(result.success);
        assert!(!result.node_id.is_empty());
    }

    #[tokio::test]
    async fn test_mock_client_forget() {
        let client = MockHelixMindClient::new();
        let result = client
            .forget(ForgetRequest {
                node_id: "n1".to_string(),
            })
            .await
            .unwrap();
        assert!(result.success);
    }

    #[tokio::test]
    async fn test_mock_client_helix_query() {
        let client = MockHelixMindClient::new();
        let result = client
            .helix_query(QueryRequest::new("认知"))
            .await
            .unwrap();
        assert!(result.cognitive.is_some());
        let cognitive = result.cognitive.unwrap();
        assert_eq!(cognitive.effective_mode, CognitiveMode::Skilled);
    }

    #[tokio::test]
    async fn test_mock_client_consolidate_digest() {
        let client = MockHelixMindClient::new();
        let result = client
            .consolidate(ConsolidateRequest {
                consolidate_type: ConsolidateType::Digest,
            })
            .await
            .unwrap();
        assert!(result.success);
        assert!(result.message.contains("摘要"));
    }

    #[tokio::test]
    async fn test_mock_client_consolidate_crystallize() {
        let client = MockHelixMindClient::new();
        let result = client
            .consolidate(ConsolidateRequest {
                consolidate_type: ConsolidateType::Crystallize,
            })
            .await
            .unwrap();
        assert!(result.success);
        assert!(result.message.contains("结晶"));
    }

    #[tokio::test]
    async fn test_mock_client_consolidate_hibernate() {
        let client = MockHelixMindClient::new();
        let result = client
            .consolidate(ConsolidateRequest {
                consolidate_type: ConsolidateType::Hibernate,
            })
            .await
            .unwrap();
        assert!(result.success);
        assert!(result.message.contains("休眠"));
    }

    #[tokio::test]
    async fn test_mock_client_get_snapshot() {
        let client = MockHelixMindClient::new();
        let snapshot = client.get_snapshot().await.unwrap();
        assert_eq!(snapshot.cognitive.effective_mode, CognitiveMode::Skilled);
        assert_eq!(snapshot.metabolism.phase_state, PhaseState::Liquid);
        assert!(snapshot.graph.node_count() > 0);
        assert!(snapshot.timestamp > 0);
    }

    #[tokio::test]
    async fn test_mock_client_health_check() {
        let client = MockHelixMindClient::new();
        assert!(client.health_check().await.unwrap());
    }

    #[tokio::test]
    async fn test_mock_client_simulate_error() {
        let client = MockHelixMindClient::new().with_simulate_error(true);
        let result = client.query(QueryRequest::new("test")).await;
        assert!(result.is_err());
        assert!(!client.health_check().await.unwrap());
    }

    #[test]
    fn test_consolidate_type_from_str() {
        assert_eq!(ConsolidateType::from_str("digest"), Some(ConsolidateType::Digest));
        assert_eq!(ConsolidateType::from_str("CRYSTALLIZE"), Some(ConsolidateType::Crystallize));
        assert_eq!(ConsolidateType::from_str("Hibernate"), Some(ConsolidateType::Hibernate));
        assert_eq!(ConsolidateType::from_str("unknown"), None);
    }

    #[test]
    fn test_consolidate_type_label() {
        assert_eq!(ConsolidateType::Digest.label(), "摘要 (Digest)");
        assert_eq!(ConsolidateType::Crystallize.label(), "结晶 (Crystallize)");
        assert_eq!(ConsolidateType::Hibernate.label(), "休眠 (Hibernate)");
    }

    #[test]
    fn test_client_error_display() {
        assert_eq!(
            ClientError::ConnectionFailed("test".to_string()).to_string(),
            "连接失败: test"
        );
        assert_eq!(
            ClientError::Timeout("test".to_string()).to_string(),
            "请求超时: test"
        );
        assert_eq!(
            ClientError::ServerError("test".to_string()).to_string(),
            "服务端错误: test"
        );
    }

    #[test]
    fn test_query_request_new() {
        let req = QueryRequest::new("test query");
        assert_eq!(req.query, "test query");
        assert!(req.mode.is_none());
        assert!(req.top_k.is_none());
    }

    #[test]
    fn test_remember_request_new() {
        let req = RememberRequest::new("test content");
        assert_eq!(req.content, "test content");
        assert!(req.node_type.is_none());
    }

    #[test]
    fn test_mock_client_add_node() {
        let mut client = MockHelixMindClient::new();
        let initial_count = client.graph().node_count();
        client.add_node(KnowledgeNode {
            id: "new_node".to_string(),
            node_type: "text".to_string(),
            content_json: "新节点".to_string(),
            heat: 0.5,
            is_hypothetical: false,
            is_recessive: false,
            sensitivity: "Public".to_string(),
            generation: 1,
            phase_state: PhaseState::Liquid,
            concentration: cellrix_protocol::helix_mind::Concentration::Dissolved,
            tension: 0.2,
            access_count: 0,
        });
        assert_eq!(client.graph().node_count(), initial_count + 1);
    }
}
