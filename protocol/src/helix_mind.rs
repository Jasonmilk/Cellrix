//! Helix-Mind 数据结构 — 认知工艺状态 + 记忆代谢状态 + 知识图谱
//!
//! # Design Principle
//!
//! **极致解耦**: 本模块只定义数据结构，不依赖 Helix-Mind crate。
//! 数据结构与 Helix-Mind 的 proto 定义兼容，可以直接从 gRPC 响应转换。
//!
//! **白盒可观测**: 将 Helix-Mind 的"思考过程"（认知工艺）和"记忆代谢"
//! 以结构化数据暴露给 Cellrix UI 展示。
//!
//! # Components
//!
//! - `CognitiveMode`: 认知模式（Skilled/Anchor/Imagination）
//! - `CognitiveStatus`: 认知工艺状态（模式/僵局等级/工序数/建议动作/激活向量）
//! - `PhaseState`: 记忆相态（Gas/Liquid/Crystal）
//! - `MetabolismStatus`: 记忆代谢状态（相态/浓度/张力/热度/代数）
//! - `KnowledgeNode`: 知识图谱节点
//! - `KnowledgeEdge`: 知识图谱边
//! - `KnowledgeGraph`: 知识图谱（节点 + 边）
//! - `HelixSnapshot`: Helix-Mind 综合快照（认知 + 代谢 + 图谱）

use serde::{Deserialize, Serialize};

// ============================================================================
// Cognitive Status (认知工艺状态)
// ============================================================================

/// 认知模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CognitiveMode {
    /// 熟练模式（默认，深度查询）
    Skilled,
    /// 锚定模式（快速检索，高确定性）
    Anchor,
    /// 想象模式（探索性，可能触及气体痕迹）
    Imagination,
}

impl CognitiveMode {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "SKILLED" => Some(Self::Skilled),
            "ANCHOR" => Some(Self::Anchor),
            "IMAGINATION" => Some(Self::Imagination),
            _ => None,
        }
    }

    /// 获取模式的标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Skilled => "熟练 (Skilled)",
            Self::Anchor => "锚定 (Anchor)",
            Self::Imagination => "想象 (Imagination)",
        }
    }

    /// 获取模式的颜色
    pub fn color(&self) -> &'static str {
        match self {
            Self::Skilled => "#5B5FC7", // Monastic Indigo
            Self::Anchor => "#71717A",  // Slate Gray
            Self::Imagination => "#D08770", // Alert Amber
        }
    }

    /// 获取模式的描述
    pub fn description(&self) -> &'static str {
        match self {
            Self::Skilled => "深度查询，液体 + 胶体",
            Self::Anchor => "快速检索，晶体 + 高相关胶体",
            Self::Imagination => "探索性，可能触及气体痕迹",
        }
    }
}

impl Default for CognitiveMode {
    fn default() -> Self {
        Self::Skilled
    }
}

/// 建议动作（Helix-Mind 建议的工具调用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedAction {
    /// 动作类型（如 "python_interpreter", "web_search", "cli_command"）
    pub action_type: String,
    /// JSON 参数（符合 CIS intent 格式）
    pub parameters: String,
    /// 建议原因
    pub reason: String,
}

/// 激活向量条目（认知周期中节点的激活值）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationEntry {
    /// 节点 ID
    pub node_id: String,
    /// 激活值（0.0-1.0）
    pub activation: f64,
}

/// 认知工艺状态
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CognitiveStatus {
    /// 有效认知模式
    pub effective_mode: CognitiveMode,
    /// 模式协商结果
    pub mode_negotiation: String,
    /// 僵局等级（0-5，0=无僵局，5=深度僵局）
    pub impasse_level: i32,
    /// 尝试的工序数
    pub stages_attempted: i32,
    /// 建议的工具动作
    pub suggested_actions: Vec<SuggestedAction>,
    /// 激活向量（节点ID + 激活值）
    pub activation_vector: Vec<ActivationEntry>,
    /// 消耗的 Token 数
    pub tokens_consumed: u64,
    /// 延迟（毫秒）
    pub latency_ms: u64,
    /// 是否部分结果
    pub is_partial: bool,
    /// 耗尽原因
    pub exhaustion_reason: String,
    /// 追踪 ID
    pub trace_id: String,
}

impl CognitiveStatus {
    /// 创建新的认知状态
    pub fn new() -> Self {
        Self::default()
    }

    /// 是否处于僵局
    pub fn is_in_impasse(&self) -> bool {
        self.impasse_level > 0
    }

    /// 僵局等级的标签
    pub fn impasse_label(&self) -> &'static str {
        match self.impasse_level {
            0 => "无僵局",
            1 => "轻微僵局",
            2 => "中度僵局",
            3 => "显著僵局",
            4 => "严重僵局",
            _ => "深度僵局",
        }
    }

    /// 僵局等级的颜色
    pub fn impasse_color(&self) -> &'static str {
        match self.impasse_level {
            0 => "#71717A", // Slate Gray
            1 => "#5B5FC7", // Monastic Indigo
            2 => "#D08770", // Alert Amber
            3 => "#FF6B6B", // Soft Red
            _ => "#FF0000", // Red
        }
    }
}

// ============================================================================
// Metabolism Status (记忆代谢状态)
// ============================================================================

/// 记忆相态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PhaseState {
    /// 气态（新鲜、易逝、未巩固）
    Gas,
    /// 液态（活跃、可塑、正在处理）
    Liquid,
    /// 晶态（固化、稳定、长期记忆）
    Crystal,
}

impl PhaseState {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "gas" => Some(Self::Gas),
            "liquid" => Some(Self::Liquid),
            "crystal" => Some(Self::Crystal),
            _ => None,
        }
    }

    /// 获取相态的标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Gas => "气态 (Gas)",
            Self::Liquid => "液态 (Liquid)",
            Self::Crystal => "晶态 (Crystal)",
        }
    }

    /// 获取相态的颜色
    pub fn color(&self) -> &'static str {
        match self {
            Self::Gas => "#88C0D0",     // 浅蓝（气体）
            Self::Liquid => "#5B5FC7",  // 靛蓝（液体）
            Self::Crystal => "#D08770", // 琥珀（晶体）
        }
    }

    /// 获取相态的描述
    pub fn description(&self) -> &'static str {
        match self {
            Self::Gas => "新鲜、易逝、未巩固",
            Self::Liquid => "活跃、可塑、正在处理",
            Self::Crystal => "固化、稳定、长期记忆",
        }
    }
}

impl Default for PhaseState {
    fn default() -> Self {
        Self::Liquid
    }
}

/// 浓度（液态元数据）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Concentration {
    /// 溶解态（均匀分散）
    Dissolved,
    /// 胶体态（聚集、高浓度）
    Colloidal,
}

impl Concentration {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "dissolved" => Some(Self::Dissolved),
            "colloidal" => Some(Self::Colloidal),
            _ => None,
        }
    }

    /// 获取浓度的标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Dissolved => "溶解 (Dissolved)",
            Self::Colloidal => "胶体 (Colloidal)",
        }
    }
}

impl Default for Concentration {
    fn default() -> Self {
        Self::Dissolved
    }
}

/// 记忆代谢状态
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MetabolismStatus {
    /// 相态（Gas/Liquid/Crystal）
    pub phase_state: PhaseState,
    /// 浓度（Dissolved/Colloidal，液态元数据）
    pub concentration: Concentration,
    /// 张力（液态元数据，0.0-1.0）
    pub tension: f64,
    /// 热度（激活程度，0.0-1.0）
    pub heat: f64,
    /// 代数（转世次数）
    pub generation: u64,
    /// 初始影响
    pub initial_impact: f64,
    /// 访问次数
    pub access_count: u64,
    /// 是否假设性（未验证）
    pub is_hypothetical: bool,
    /// 是否隐性（被抑制）
    pub is_recessive: bool,
    /// 主体依赖性（high/low）
    pub subject_dependency: String,
    /// 敏感度（Public/Private/Secret）
    pub sensitivity: String,
}

impl MetabolismStatus {
    /// 创建新的代谢状态
    pub fn new() -> Self {
        Self::default()
    }

    /// 是否高热度（活跃）
    pub fn is_high_heat(&self) -> bool {
        self.heat > 0.7
    }

    /// 是否高张力（不稳定）
    pub fn is_high_tension(&self) -> bool {
        self.tension > 0.7
    }

    /// 热度的颜色
    pub fn heat_color(&self) -> &'static str {
        if self.heat > 0.7 {
            "#FF0000" // Red
        } else if self.heat > 0.4 {
            "#D08770" // Alert Amber
        } else {
            "#71717A" // Slate Gray
        }
    }

    /// 张力的颜色
    pub fn tension_color(&self) -> &'static str {
        if self.tension > 0.7 {
            "#FF6B6B" // Soft Red
        } else if self.tension > 0.4 {
            "#D08770" // Alert Amber
        } else {
            "#5B5FC7" // Monastic Indigo
        }
    }
}

// ============================================================================
// Knowledge Graph (知识图谱)
// ============================================================================

/// 知识图谱节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeNode {
    /// 节点 ID
    pub id: String,
    /// 节点类型
    pub node_type: String,
    /// 内容（JSON）
    pub content_json: String,
    /// 热度（0.0-1.0）
    pub heat: f64,
    /// 是否假设性
    pub is_hypothetical: bool,
    /// 是否隐性
    pub is_recessive: bool,
    /// 敏感度
    pub sensitivity: String,
    /// 代数
    pub generation: u64,
    /// 相态
    pub phase_state: PhaseState,
    /// 浓度
    pub concentration: Concentration,
    /// 张力
    pub tension: f64,
    /// 访问次数
    pub access_count: u64,
}

impl KnowledgeNode {
    /// 获取内容的简短预览
    pub fn content_preview(&self, max_chars: usize) -> String {
        let chars: Vec<char> = self.content_json.chars().collect();
        if chars.len() <= max_chars {
            self.content_json.clone()
        } else {
            format!("{}...", chars[..max_chars].iter().collect::<String>())
        }
    }

    /// 是否高热度节点
    pub fn is_hot(&self) -> bool {
        self.heat > 0.7
    }
}

/// 知识图谱边
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEdge {
    /// 源节点 ID
    pub source_id: String,
    /// 目标节点 ID
    pub target_id: String,
    /// 权重（0.0-1.0）
    pub weight: f64,
    /// 关系类型
    pub relation_type: String,
    /// 是否软边（弱关联）
    pub is_soft: bool,
}

/// 知识图谱
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct KnowledgeGraph {
    /// 节点列表
    pub nodes: Vec<KnowledgeNode>,
    /// 边列表
    pub edges: Vec<KnowledgeEdge>,
}

impl KnowledgeGraph {
    /// 创建新的知识图谱
    pub fn new() -> Self {
        Self::default()
    }

    /// 获取节点数
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// 获取边数
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    /// 获取高热度节点
    pub fn hot_nodes(&self) -> Vec<&KnowledgeNode> {
        self.nodes.iter().filter(|n| n.is_hot()).collect()
    }

    /// 获取指定节点的邻居
    pub fn neighbors(&self, node_id: &str) -> Vec<&KnowledgeNode> {
        let neighbor_ids: Vec<&str> = self
            .edges
            .iter()
            .filter(|e| e.source_id == node_id || e.target_id == node_id)
            .map(|e| {
                if e.source_id == node_id {
                    e.target_id.as_str()
                } else {
                    e.source_id.as_str()
                }
            })
            .collect();

        self.nodes
            .iter()
            .filter(|n| neighbor_ids.contains(&n.id.as_str()))
            .collect()
    }
}

// ============================================================================
// Helix Snapshot (综合快照)
// ============================================================================

/// Helix-Mind 综合快照
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HelixSnapshot {
    /// 认知工艺状态
    pub cognitive: CognitiveStatus,
    /// 记忆代谢状态
    pub metabolism: MetabolismStatus,
    /// 知识图谱
    pub graph: KnowledgeGraph,
    /// 快照时间戳（Unix 秒）
    pub timestamp: u64,
}

impl HelixSnapshot {
    /// 创建新的快照
    pub fn new() -> Self {
        Self {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            ..Default::default()
        }
    }

    /// 是否有建议动作
    pub fn has_suggested_actions(&self) -> bool {
        !self.cognitive.suggested_actions.is_empty()
    }

    /// 是否处于僵局
    pub fn is_in_impasse(&self) -> bool {
        self.cognitive.is_in_impasse()
    }

    /// 获取高热度节点数
    pub fn hot_node_count(&self) -> usize {
        self.graph.hot_nodes().len()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cognitive_mode_from_str() {
        assert_eq!(CognitiveMode::from_str("SKILLED"), Some(CognitiveMode::Skilled));
        assert_eq!(CognitiveMode::from_str("anchor"), Some(CognitiveMode::Anchor));
        assert_eq!(CognitiveMode::from_str("Imagination"), Some(CognitiveMode::Imagination));
        assert_eq!(CognitiveMode::from_str("unknown"), None);
    }

    #[test]
    fn test_cognitive_mode_label() {
        assert_eq!(CognitiveMode::Skilled.label(), "熟练 (Skilled)");
        assert_eq!(CognitiveMode::Anchor.label(), "锚定 (Anchor)");
        assert_eq!(CognitiveMode::Imagination.label(), "想象 (Imagination)");
    }

    #[test]
    fn test_cognitive_status_impasse() {
        let mut status = CognitiveStatus::new();
        assert!(!status.is_in_impasse());
        assert_eq!(status.impasse_label(), "无僵局");

        status.impasse_level = 3;
        assert!(status.is_in_impasse());
        assert_eq!(status.impasse_label(), "显著僵局");
    }

    #[test]
    fn test_phase_state_from_str() {
        assert_eq!(PhaseState::from_str("gas"), Some(PhaseState::Gas));
        assert_eq!(PhaseState::from_str("LIQUID"), Some(PhaseState::Liquid));
        assert_eq!(PhaseState::from_str("Crystal"), Some(PhaseState::Crystal));
        assert_eq!(PhaseState::from_str("solid"), None);
    }

    #[test]
    fn test_phase_state_label() {
        assert_eq!(PhaseState::Gas.label(), "气态 (Gas)");
        assert_eq!(PhaseState::Liquid.label(), "液态 (Liquid)");
        assert_eq!(PhaseState::Crystal.label(), "晶态 (Crystal)");
    }

    #[test]
    fn test_concentration_from_str() {
        assert_eq!(Concentration::from_str("dissolved"), Some(Concentration::Dissolved));
        assert_eq!(Concentration::from_str("COLLOIDAL"), Some(Concentration::Colloidal));
        assert_eq!(Concentration::from_str("solid"), None);
    }

    #[test]
    fn test_metabolism_status_heat() {
        let mut status = MetabolismStatus::new();
        assert!(!status.is_high_heat());

        status.heat = 0.8;
        assert!(status.is_high_heat());
        assert_eq!(status.heat_color(), "#FF0000");
    }

    #[test]
    fn test_metabolism_status_tension() {
        let mut status = MetabolismStatus::new();
        assert!(!status.is_high_tension());

        status.tension = 0.8;
        assert!(status.is_high_tension());
    }

    #[test]
    fn test_knowledge_node_content_preview() {
        let node = KnowledgeNode {
            id: "test".to_string(),
            node_type: "text".to_string(),
            content_json: "这是一段很长的内容，用于测试预览功能".to_string(),
            heat: 0.5,
            is_hypothetical: false,
            is_recessive: false,
            sensitivity: "Public".to_string(),
            generation: 1,
            phase_state: PhaseState::Liquid,
            concentration: Concentration::Dissolved,
            tension: 0.3,
            access_count: 10,
        };

        assert_eq!(node.content_preview(10), "这是一段很长的内容，...");
        assert_eq!(node.content_preview(100), node.content_json);
    }

    #[test]
    fn test_knowledge_graph() {
        let mut graph = KnowledgeGraph::new();
        assert_eq!(graph.node_count(), 0);
        assert_eq!(graph.edge_count(), 0);

        graph.nodes.push(KnowledgeNode {
            id: "n1".to_string(),
            node_type: "text".to_string(),
            content_json: "node1".to_string(),
            heat: 0.8,
            is_hypothetical: false,
            is_recessive: false,
            sensitivity: "Public".to_string(),
            generation: 1,
            phase_state: PhaseState::Liquid,
            concentration: Concentration::Dissolved,
            tension: 0.3,
            access_count: 5,
        });

        graph.nodes.push(KnowledgeNode {
            id: "n2".to_string(),
            node_type: "text".to_string(),
            content_json: "node2".to_string(),
            heat: 0.2,
            is_hypothetical: false,
            is_recessive: false,
            sensitivity: "Public".to_string(),
            generation: 1,
            phase_state: PhaseState::Crystal,
            concentration: Concentration::Colloidal,
            tension: 0.1,
            access_count: 20,
        });

        graph.edges.push(KnowledgeEdge {
            source_id: "n1".to_string(),
            target_id: "n2".to_string(),
            weight: 0.7,
            relation_type: "related_to".to_string(),
            is_soft: false,
        });

        assert_eq!(graph.node_count(), 2);
        assert_eq!(graph.edge_count(), 1);
        assert_eq!(graph.hot_nodes().len(), 1);
        assert_eq!(graph.neighbors("n1").len(), 1);
    }

    #[test]
    fn test_helix_snapshot() {
        let snapshot = HelixSnapshot::new();
        assert!(!snapshot.has_suggested_actions());
        assert!(!snapshot.is_in_impasse());
        assert_eq!(snapshot.hot_node_count(), 0);
        assert!(snapshot.timestamp > 0);
    }

    #[test]
    fn test_suggested_action() {
        let action = SuggestedAction {
            action_type: "web_search".to_string(),
            parameters: "{\"query\": \"test\"}".to_string(),
            reason: "需要搜索信息".to_string(),
        };
        assert_eq!(action.action_type, "web_search");
    }

    #[test]
    fn test_activation_entry() {
        let entry = ActivationEntry {
            node_id: "n1".to_string(),
            activation: 0.85,
        };
        assert_eq!(entry.node_id, "n1");
        assert!((entry.activation - 0.85).abs() < 0.001);
    }
}
