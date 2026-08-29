//! Anaphase 数据结构 — 任务 DAG + 认知状态 + HITL + 生命周期
//!
//! # Design Principle
//!
//! **极致解耦**: 本模块只定义数据结构，不依赖 Anaphase crate。
//! 数据结构与 Anaphase 的内部定义兼容，可以直接从 gRPC 响应转换。
//!
//! **白盒可观测**: 将 Anaphase 的"编排过程"（任务 DAG + HITL + 生命周期）
//! 以结构化数据暴露给 Cellrix UI 展示。
//!
//! # Components
//!
//! - `CognitivePhase`: 认知阶段（7 状态 DAG）
//! - `TaskNodeKind`: 任务节点类型（TaskRoot/SubTask/Leaf）
//! - `TaskStatus`: 任务状态（Pending/Running/Completed/Failed/Cancelled）
//! - `TaskNode`: 任务节点
//! - `TaskEdge`: 任务边
//! - `TaskDagSnapshot`: 任务 DAG 快照
//! - `RiskLevel`: 风险等级
//! - `HITLRequestStatus`: HITL 请求状态
//! - `HITLRequest`: HITL 请求
//! - `HITLStatus`: HITL 状态
//! - `LifecyclePhase`: 生命周期阶段
//! - `LifecycleStatus`: 生命周期状态
//! - `AnaphaseState`: 综合状态

use serde::{Deserialize, Serialize};

// ============================================================================
// Cognitive Phase (认知阶段)
// ============================================================================

/// 认知阶段（Anaphase 的 7 状态 DAG）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum CognitivePhase {
    /// 感知阶段（收集环境信息）
    Perception,
    /// 预评估阶段（快速风险评估）
    PreAssessment,
    /// 记忆检索阶段（从 Helix-Mind 检索相关知识）
    MemoryRetrieval,
    /// 推理阶段（LLM 推理/决策）
    Reasoning,
    /// 反射检查阶段（躯体反射弧检查）
    ReflexCheck,
    /// 执行阶段（通过 Tentacle 执行工具）
    Execution,
    /// 反思阶段（结果评估/经验沉淀）
    Reflection,
}

impl CognitivePhase {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Perception" | "perception" => Some(Self::Perception),
            "PreAssessment" | "pre_assessment" => Some(Self::PreAssessment),
            "MemoryRetrieval" | "memory_retrieval" => Some(Self::MemoryRetrieval),
            "Reasoning" | "reasoning" => Some(Self::Reasoning),
            "ReflexCheck" | "reflex_check" => Some(Self::ReflexCheck),
            "Execution" | "execution" => Some(Self::Execution),
            "Reflection" | "reflection" => Some(Self::Reflection),
            _ => None,
        }
    }

    /// 获取阶段标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Perception => "感知 (Perception)",
            Self::PreAssessment => "预评估 (PreAssessment)",
            Self::MemoryRetrieval => "记忆检索 (MemoryRetrieval)",
            Self::Reasoning => "推理 (Reasoning)",
            Self::ReflexCheck => "反射检查 (ReflexCheck)",
            Self::Execution => "执行 (Execution)",
            Self::Reflection => "反思 (Reflection)",
        }
    }

    /// 获取阶段短标签
    pub fn short_label(&self) -> &'static str {
        match self {
            Self::Perception => "感知",
            Self::PreAssessment => "预评估",
            Self::MemoryRetrieval => "记忆检索",
            Self::Reasoning => "推理",
            Self::ReflexCheck => "反射检查",
            Self::Execution => "执行",
            Self::Reflection => "反思",
        }
    }

    /// 获取阶段颜色
    pub fn color(&self) -> &'static str {
        match self {
            Self::Perception => "#88C0D0",     // 浅蓝
            Self::PreAssessment => "#D08770",   // 琥珀
            Self::MemoryRetrieval => "#5B5FC7",  // 靛蓝
            Self::Reasoning => "#A3BE8C",        // 浅绿
            Self::ReflexCheck => "#EBCB8B",      // 浅黄
            Self::Execution => "#BF616A",         // 红
            Self::Reflection => "#B48EAD",        // 紫
        }
    }

    /// 获取阶段序号（0-6）
    pub fn order(&self) -> u8 {
        match self {
            Self::Perception => 0,
            Self::PreAssessment => 1,
            Self::MemoryRetrieval => 2,
            Self::Reasoning => 3,
            Self::ReflexCheck => 4,
            Self::Execution => 5,
            Self::Reflection => 6,
        }
    }

    /// 获取阶段描述
    pub fn description(&self) -> &'static str {
        match self {
            Self::Perception => "收集环境信息和用户输入",
            Self::PreAssessment => "快速风险评估和意图分类",
            Self::MemoryRetrieval => "从 Helix-Mind 检索相关知识",
            Self::Reasoning => "LLM 推理和决策生成",
            Self::ReflexCheck => "躯体反射弧检查（快速响应）",
            Self::Execution => "通过 Tentacle 执行工具调用",
            Self::Reflection => "结果评估和经验沉淀",
        }
    }
}

impl Default for CognitivePhase {
    fn default() -> Self {
        Self::Perception
    }
}

// ============================================================================
// Task DAG (任务 DAG)
// ============================================================================

/// 任务节点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum TaskNodeKind {
    /// 任务分支根（dag_branch_create 创建）
    TaskRoot,
    /// 子任务（调研/比价/决策等）
    SubTask,
    /// 附着内容（思考/搜索结果/工具输出）
    Leaf,
}

impl TaskNodeKind {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "TaskRoot" | "task_root" => Some(Self::TaskRoot),
            "SubTask" | "sub_task" => Some(Self::SubTask),
            "Leaf" | "leaf" => Some(Self::Leaf),
            _ => None,
        }
    }

    /// 获取类型标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::TaskRoot => "任务根 (TaskRoot)",
            Self::SubTask => "子任务 (SubTask)",
            Self::Leaf => "叶子 (Leaf)",
        }
    }

    /// 获取类型短标签
    pub fn short_label(&self) -> &'static str {
        match self {
            Self::TaskRoot => "根",
            Self::SubTask => "子任务",
            Self::Leaf => "叶子",
        }
    }

    /// 获取类型颜色
    pub fn color(&self) -> &'static str {
        match self {
            Self::TaskRoot => "#5B5FC7",  // 靛蓝
            Self::SubTask => "#88C0D0",   // 浅蓝
            Self::Leaf => "#A3BE8C",      // 浅绿
        }
    }
}

impl Default for TaskNodeKind {
    fn default() -> Self {
        Self::SubTask
    }
}

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum TaskStatus {
    /// 待执行
    Pending,
    /// 执行中
    Running,
    /// 已完成
    Completed,
    /// 失败
    Failed,
    /// 已取消
    Cancelled,
    /// 等待 HITL 确认
    WaitingHITL,
}

impl TaskStatus {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Pending" | "pending" => Some(Self::Pending),
            "Running" | "running" => Some(Self::Running),
            "Completed" | "completed" => Some(Self::Completed),
            "Failed" | "failed" => Some(Self::Failed),
            "Cancelled" | "cancelled" => Some(Self::Cancelled),
            "WaitingHITL" | "waiting_hitl" => Some(Self::WaitingHITL),
            _ => None,
        }
    }

    /// 获取状态标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Pending => "待执行 (Pending)",
            Self::Running => "执行中 (Running)",
            Self::Completed => "已完成 (Completed)",
            Self::Failed => "失败 (Failed)",
            Self::Cancelled => "已取消 (Cancelled)",
            Self::WaitingHITL => "等待HITL (WaitingHITL)",
        }
    }

    /// 获取状态短标签
    pub fn short_label(&self) -> &'static str {
        match self {
            Self::Pending => "待执行",
            Self::Running => "执行中",
            Self::Completed => "已完成",
            Self::Failed => "失败",
            Self::Cancelled => "已取消",
            Self::WaitingHITL => "等待HITL",
        }
    }

    /// 获取状态颜色
    pub fn color(&self) -> &'static str {
        match self {
            Self::Pending => "#71717A",      // 灰
            Self::Running => "#5B5FC7",       // 靛蓝
            Self::Completed => "#A3BE8C",     // 绿
            Self::Failed => "#BF616A",         // 红
            Self::Cancelled => "#4C566A",      // 深灰
            Self::WaitingHITL => "#D08770",   // 琥珀
        }
    }

    /// 是否终态
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

impl Default for TaskStatus {
    fn default() -> Self {
        Self::Pending
    }
}

/// 任务节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    /// 节点 ID
    pub id: String,
    /// 分支名称
    pub branch_name: String,
    /// 任务意图
    pub intent: String,
    /// 节点类型
    pub kind: TaskNodeKind,
    /// 任务状态
    pub status: TaskStatus,
    /// 进度（0.0-1.0）
    pub progress: f64,
    /// 反向链接至 Helix-Mind 知识库节点（可选）
    pub knowledge_ref: Option<String>,
    /// 创建时间（ISO 8601）
    pub created_at: String,
    /// 开始时间（ISO 8601，可选）
    pub started_at: Option<String>,
    /// 完成时间（ISO 8601，可选）
    pub completed_at: Option<String>,
    /// 错误信息（可选）
    pub error: Option<String>,
    /// 执行耗时（毫秒，可选）
    pub duration_ms: Option<u64>,
}

impl TaskNode {
    /// 创建新的任务节点
    pub fn new(id: impl Into<String>, branch_name: impl Into<String>, intent: impl Into<String>, kind: TaskNodeKind) -> Self {
        Self {
            id: id.into(),
            branch_name: branch_name.into(),
            intent: intent.into(),
            kind,
            status: TaskStatus::Pending,
            progress: 0.0,
            knowledge_ref: None,
            created_at: chrono_now(),
            started_at: None,
            completed_at: None,
            error: None,
            duration_ms: None,
        }
    }

    /// 是否高优先级（TaskRoot）
    pub fn is_root(&self) -> bool {
        self.kind == TaskNodeKind::TaskRoot
    }

    /// 是否执行中
    pub fn is_running(&self) -> bool {
        self.status == TaskStatus::Running
    }

    /// 是否完成
    pub fn is_completed(&self) -> bool {
        self.status == TaskStatus::Completed
    }

    /// 是否失败
    pub fn is_failed(&self) -> bool {
        self.status == TaskStatus::Failed
    }

    /// 获取意图预览
    pub fn intent_preview(&self, max_chars: usize) -> String {
        let chars: Vec<char> = self.intent.chars().collect();
        if chars.len() <= max_chars {
            self.intent.clone()
        } else {
            format!("{}...", chars[..max_chars].iter().collect::<String>())
        }
    }
}

/// 任务边（依赖关系）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskEdge {
    /// 源节点 ID（前置任务）
    pub source_id: String,
    /// 目标节点 ID（后续任务）
    pub target_id: String,
    /// 边类型（depends_on/contains/related_to）
    pub edge_type: String,
}

impl TaskEdge {
    /// 创建新的任务边
    pub fn new(source_id: impl Into<String>, target_id: impl Into<String>, edge_type: impl Into<String>) -> Self {
        Self {
            source_id: source_id.into(),
            target_id: target_id.into(),
            edge_type: edge_type.into(),
        }
    }
}

/// 任务 DAG 快照
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskDagSnapshot {
    /// 节点列表
    pub nodes: Vec<TaskNode>,
    /// 边列表
    pub edges: Vec<TaskEdge>,
    /// 根节点 ID
    pub root_id: Option<String>,
    /// 快照时间戳（Unix 秒）
    pub timestamp: u64,
}

impl TaskDagSnapshot {
    /// 创建新的 DAG 快照
    pub fn new() -> Self {
        Self {
            timestamp: now_unix(),
            ..Default::default()
        }
    }

    /// 获取节点数
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// 获取边数
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    /// 获取执行中节点数
    pub fn running_count(&self) -> usize {
        self.nodes.iter().filter(|n| n.is_running()).count()
    }

    /// 获取已完成节点数
    pub fn completed_count(&self) -> usize {
        self.nodes.iter().filter(|n| n.is_completed()).count()
    }

    /// 获取失败节点数
    pub fn failed_count(&self) -> usize {
        self.nodes.iter().filter(|n| n.is_failed()).count()
    }

    /// 获取等待 HITL 节点数
    pub fn waiting_hitl_count(&self) -> usize {
        self.nodes.iter().filter(|n| n.status == TaskStatus::WaitingHITL).count()
    }

    /// 获取整体进度（0.0-1.0）
    pub fn overall_progress(&self) -> f64 {
        if self.nodes.is_empty() {
            return 0.0;
        }
        let total: f64 = self.nodes.iter().map(|n| n.progress).sum();
        total / self.nodes.len() as f64
    }

    /// 根据 ID 查找节点
    pub fn find_node(&self, id: &str) -> Option<&TaskNode> {
        self.nodes.iter().find(|n| n.id == id)
    }

    /// 获取节点的子节点（目标节点）
    pub fn children(&self, node_id: &str) -> Vec<&TaskNode> {
        let child_ids: Vec<&str> = self
            .edges
            .iter()
            .filter(|e| e.source_id == node_id)
            .map(|e| e.target_id.as_str())
            .collect();
        self.nodes.iter().filter(|n| child_ids.contains(&n.id.as_str())).collect()
    }

    /// 获取节点的父节点（源节点）
    pub fn parents(&self, node_id: &str) -> Vec<&TaskNode> {
        let parent_ids: Vec<&str> = self
            .edges
            .iter()
            .filter(|e| e.target_id == node_id)
            .map(|e| e.source_id.as_str())
            .collect();
        self.nodes.iter().filter(|n| parent_ids.contains(&n.id.as_str())).collect()
    }
}

// ============================================================================
// HITL (人在回路)
// ============================================================================

/// 风险等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum RiskLevel {
    /// 低风险（直接放行）
    Low,
    /// 中风险（记录审计）
    Medium,
    /// 高风险（需要 HITL 确认）
    High,
    /// 严重风险（需要 HITL + Tuck 双重确认）
    Critical,
}

impl RiskLevel {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Low" | "low" => Some(Self::Low),
            "Medium" | "medium" => Some(Self::Medium),
            "High" | "high" => Some(Self::High),
            "Critical" | "critical" => Some(Self::Critical),
            _ => None,
        }
    }

    /// 获取风险等级标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Low => "低风险 (Low)",
            Self::Medium => "中风险 (Medium)",
            Self::High => "高风险 (High)",
            Self::Critical => "严重风险 (Critical)",
        }
    }

    /// 获取风险等级短标签
    pub fn short_label(&self) -> &'static str {
        match self {
            Self::Low => "低",
            Self::Medium => "中",
            Self::High => "高",
            Self::Critical => "严重",
        }
    }

    /// 获取风险等级颜色
    pub fn color(&self) -> &'static str {
        match self {
            Self::Low => "#A3BE8C",      // 绿
            Self::Medium => "#EBCB8B",   // 黄
            Self::High => "#D08770",     // 琥珀
            Self::Critical => "#BF616A", // 红
        }
    }

    /// 是否需要 HITL 确认
    pub fn requires_hitl(&self) -> bool {
        matches!(self, Self::High | Self::Critical)
    }
}

impl Default for RiskLevel {
    fn default() -> Self {
        Self::Low
    }
}

/// HITL 请求状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum HITLRequestStatus {
    /// 待确认
    Pending,
    /// 已批准
    Approved,
    /// 已拒绝
    Rejected,
    /// 超时
    TimedOut,
}

impl HITLRequestStatus {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Pending" | "pending" => Some(Self::Pending),
            "Approved" | "approved" => Some(Self::Approved),
            "Rejected" | "rejected" => Some(Self::Rejected),
            "TimedOut" | "timed_out" => Some(Self::TimedOut),
            _ => None,
        }
    }

    /// 获取状态标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Pending => "待确认 (Pending)",
            Self::Approved => "已批准 (Approved)",
            Self::Rejected => "已拒绝 (Rejected)",
            Self::TimedOut => "超时 (TimedOut)",
        }
    }

    /// 获取状态颜色
    pub fn color(&self) -> &'static str {
        match self {
            Self::Pending => "#D08770",   // 琥珀
            Self::Approved => "#A3BE8C",  // 绿
            Self::Rejected => "#BF616A",  // 红
            Self::TimedOut => "#71717A",  // 灰
        }
    }

    /// 是否终态
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Approved | Self::Rejected | Self::TimedOut)
    }
}

impl Default for HITLRequestStatus {
    fn default() -> Self {
        Self::Pending
    }
}

/// HITL 请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HITLRequest {
    /// 请求 ID
    pub id: String,
    /// 要执行的命令
    pub command: String,
    /// 命令参数
    pub args: Vec<String>,
    /// 风险等级
    pub risk_level: RiskLevel,
    /// 请求状态
    pub status: HITLRequestStatus,
    /// 关联的任务节点 ID（可选）
    pub task_id: Option<String>,
    /// 关联的认知阶段（可选）
    pub cognitive_phase: Option<CognitivePhase>,
    /// 创建时间（ISO 8601）
    pub created_at: String,
    /// 解决时间（ISO 8601，可选）
    pub resolved_at: Option<String>,
    /// 超时时间（秒，默认 300）
    pub timeout_seconds: u64,
    /// 审批者（可选）
    pub approver: Option<String>,
    /// 拒绝原因（可选）
    pub reject_reason: Option<String>,
    /// 风险判定原因（为什么判定为高风险）
    pub risk_reason: String,
}

impl HITLRequest {
    /// 创建新的 HITL 请求
    pub fn new(id: impl Into<String>, command: impl Into<String>, risk_level: RiskLevel, risk_reason: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            command: command.into(),
            args: vec![],
            risk_level,
            status: HITLRequestStatus::Pending,
            task_id: None,
            cognitive_phase: None,
            created_at: chrono_now(),
            resolved_at: None,
            timeout_seconds: 300,
            approver: None,
            reject_reason: None,
            risk_reason: risk_reason.into(),
        }
    }

    /// 是否待确认
    pub fn is_pending(&self) -> bool {
        self.status == HITLRequestStatus::Pending
    }

    /// 是否已批准
    pub fn is_approved(&self) -> bool {
        self.status == HITLRequestStatus::Approved
    }

    /// 是否已拒绝
    pub fn is_rejected(&self) -> bool {
        self.status == HITLRequestStatus::Rejected
    }

    /// 获取命令预览
    pub fn command_preview(&self, max_chars: usize) -> String {
        let chars: Vec<char> = self.command.chars().collect();
        if chars.len() <= max_chars {
            self.command.clone()
        } else {
            format!("{}...", chars[..max_chars].iter().collect::<String>())
        }
    }

    /// 获取完整命令（含参数）
    pub fn full_command(&self) -> String {
        if self.args.is_empty() {
            self.command.clone()
        } else {
            format!("{} {}", self.command, self.args.join(" "))
        }
    }
}

/// HITL 状态
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HITLStatus {
    /// 待确认请求数
    pub pending_count: u32,
    /// 已批准请求数（累计）
    pub approved_count: u32,
    /// 已拒绝请求数（累计）
    pub rejected_count: u32,
    /// 超时请求数（累计）
    pub timed_out_count: u32,
    /// 当前待确认请求列表
    pub pending_requests: Vec<HITLRequest>,
    /// HITL 通道是否可用
    pub channel_available: bool,
    /// fail-closed 模式（无通道时拦截高风险动作）
    pub fail_closed: bool,
    /// 最近一次审批时间（ISO 8601，可选）
    pub last_approval_at: Option<String>,
}

impl HITLStatus {
    /// 创建新的 HITL 状态
    pub fn new() -> Self {
        Self {
            channel_available: true,
            fail_closed: true,
            ..Default::default()
        }
    }

    /// 总请求数
    pub fn total_count(&self) -> u32 {
        self.approved_count + self.rejected_count + self.timed_out_count + self.pending_count
    }

    /// 批准率（0.0-1.0）
    pub fn approval_rate(&self) -> f64 {
        let resolved = self.approved_count + self.rejected_count + self.timed_out_count;
        if resolved == 0 {
            return 0.0;
        }
        self.approved_count as f64 / resolved as f64
    }

    /// 是否有待确认请求
    pub fn has_pending(&self) -> bool {
        self.pending_count > 0
    }
}

// ============================================================================
// Lifecycle (生命周期)
// ============================================================================

/// 生命周期阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum LifecyclePhase {
    /// 初始化中
    Initializing,
    /// 运行中
    Running,
    /// 已暂停
    Paused,
    /// 停止中
    Stopping,
    /// 已停止
    Stopped,
    /// 错误状态
    Error,
}

impl LifecyclePhase {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Initializing" | "initializing" => Some(Self::Initializing),
            "Running" | "running" => Some(Self::Running),
            "Paused" | "paused" => Some(Self::Paused),
            "Stopping" | "stopping" => Some(Self::Stopping),
            "Stopped" | "stopped" => Some(Self::Stopped),
            "Error" | "error" => Some(Self::Error),
            _ => None,
        }
    }

    /// 获取阶段标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Initializing => "初始化中 (Initializing)",
            Self::Running => "运行中 (Running)",
            Self::Paused => "已暂停 (Paused)",
            Self::Stopping => "停止中 (Stopping)",
            Self::Stopped => "已停止 (Stopped)",
            Self::Error => "错误 (Error)",
        }
    }

    /// 获取阶段短标签
    pub fn short_label(&self) -> &'static str {
        match self {
            Self::Initializing => "初始化",
            Self::Running => "运行中",
            Self::Paused => "已暂停",
            Self::Stopping => "停止中",
            Self::Stopped => "已停止",
            Self::Error => "错误",
        }
    }

    /// 获取阶段颜色
    pub fn color(&self) -> &'static str {
        match self {
            Self::Initializing => "#EBCB8B",  // 黄
            Self::Running => "#A3BE8C",       // 绿
            Self::Paused => "#D08770",        // 琥珀
            Self::Stopping => "#88C0D0",      // 浅蓝
            Self::Stopped => "#71717A",       // 灰
            Self::Error => "#BF616A",         // 红
        }
    }

    /// 是否活跃（运行中或初始化中）
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Running | Self::Initializing)
    }
}

impl Default for LifecyclePhase {
    fn default() -> Self {
        Self::Initializing
    }
}

/// 生命周期状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleStatus {
    /// 当前阶段
    pub phase: LifecyclePhase,
    /// 运行时间（秒）
    pub uptime_seconds: u64,
    /// 启动时间（ISO 8601）
    pub started_at: String,
    /// 最近心跳时间（ISO 8601）
    pub last_heartbeat_at: String,
    /// 心跳间隔（秒，默认 19，与 CIB19 一致）
    pub heartbeat_interval_seconds: u64,
    /// 累计错误数
    pub error_count: u64,
    /// 最近错误信息（可选）
    pub last_error: Option<String>,
    /// 版本号
    pub version: String,
    /// 实例 ID
    pub instance_id: String,
    /// 配置文件路径
    pub config_path: Option<String>,
}

impl LifecycleStatus {
    /// 创建新的生命周期状态
    pub fn new(version: impl Into<String>, instance_id: impl Into<String>) -> Self {
        let now = chrono_now();
        Self {
            phase: LifecyclePhase::Initializing,
            uptime_seconds: 0,
            started_at: now.clone(),
            last_heartbeat_at: now,
            heartbeat_interval_seconds: 19,
            error_count: 0,
            last_error: None,
            version: version.into(),
            instance_id: instance_id.into(),
            config_path: None,
        }
    }

    /// 是否健康（运行中且心跳正常）
    pub fn is_healthy(&self) -> bool {
        self.phase == LifecyclePhase::Running
    }

    /// 格式化运行时间
    pub fn formatted_uptime(&self) -> String {
        let hours = self.uptime_seconds / 3600;
        let minutes = (self.uptime_seconds % 3600) / 60;
        let seconds = self.uptime_seconds % 60;
        if hours > 0 {
            format!("{}h {}m {}s", hours, minutes, seconds)
        } else if minutes > 0 {
            format!("{}m {}s", minutes, seconds)
        } else {
            format!("{}s", seconds)
        }
    }
}

// ============================================================================
// Anaphase State (综合状态)
// ============================================================================

/// Anaphase 综合状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnaphaseState {
    /// 当前认知阶段
    pub current_phase: CognitivePhase,
    /// 任务 DAG 快照
    pub task_dag: TaskDagSnapshot,
    /// HITL 状态
    pub hitl: HITLStatus,
    /// 生命周期状态
    pub lifecycle: LifecycleStatus,
    /// 当前活动任务 ID（可选）
    pub active_task_id: Option<String>,
    /// 快照时间戳（Unix 秒）
    pub timestamp: u64,
}

impl AnaphaseState {
    /// 创建新的综合状态
    pub fn new(version: impl Into<String>, instance_id: impl Into<String>) -> Self {
        Self {
            current_phase: CognitivePhase::default(),
            task_dag: TaskDagSnapshot::new(),
            hitl: HITLStatus::new(),
            lifecycle: LifecycleStatus::new(version, instance_id),
            active_task_id: None,
            timestamp: now_unix(),
        }
    }

    /// 是否健康
    pub fn is_healthy(&self) -> bool {
        self.lifecycle.is_healthy()
    }

    /// 是否有待确认 HITL 请求
    pub fn has_pending_hitl(&self) -> bool {
        self.hitl.has_pending()
    }

    /// 获取当前活动任务
    pub fn active_task(&self) -> Option<&TaskNode> {
        self.active_task_id.as_ref().and_then(|id| self.task_dag.find_node(id))
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// 获取当前时间（ISO 8601 格式）
fn chrono_now() -> String {
    // 使用 std::time 避免 chrono 依赖
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", now)
}

/// 获取当前 Unix 时间戳（秒）
fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cognitive_phase_from_str() {
        assert_eq!(CognitivePhase::from_str("Perception"), Some(CognitivePhase::Perception));
        assert_eq!(CognitivePhase::from_str("Reasoning"), Some(CognitivePhase::Reasoning));
        assert_eq!(CognitivePhase::from_str("Execution"), Some(CognitivePhase::Execution));
        assert_eq!(CognitivePhase::from_str("unknown"), None);
    }

    #[test]
    fn test_cognitive_phase_label() {
        assert_eq!(CognitivePhase::Perception.label(), "感知 (Perception)");
        assert_eq!(CognitivePhase::Reasoning.label(), "推理 (Reasoning)");
        assert_eq!(CognitivePhase::Execution.label(), "执行 (Execution)");
    }

    #[test]
    fn test_cognitive_phase_order() {
        assert_eq!(CognitivePhase::Perception.order(), 0);
        assert_eq!(CognitivePhase::Reflection.order(), 6);
    }

    #[test]
    fn test_task_node_kind_from_str() {
        assert_eq!(TaskNodeKind::from_str("TaskRoot"), Some(TaskNodeKind::TaskRoot));
        assert_eq!(TaskNodeKind::from_str("SubTask"), Some(TaskNodeKind::SubTask));
        assert_eq!(TaskNodeKind::from_str("Leaf"), Some(TaskNodeKind::Leaf));
        assert_eq!(TaskNodeKind::from_str("unknown"), None);
    }

    #[test]
    fn test_task_status_from_str() {
        assert_eq!(TaskStatus::from_str("Pending"), Some(TaskStatus::Pending));
        assert_eq!(TaskStatus::from_str("Running"), Some(TaskStatus::Running));
        assert_eq!(TaskStatus::from_str("Completed"), Some(TaskStatus::Completed));
        assert_eq!(TaskStatus::from_str("Failed"), Some(TaskStatus::Failed));
        assert_eq!(TaskStatus::from_str("WaitingHITL"), Some(TaskStatus::WaitingHITL));
        assert_eq!(TaskStatus::from_str("unknown"), None);
    }

    #[test]
    fn test_task_status_is_terminal() {
        assert!(TaskStatus::Completed.is_terminal());
        assert!(TaskStatus::Failed.is_terminal());
        assert!(TaskStatus::Cancelled.is_terminal());
        assert!(!TaskStatus::Running.is_terminal());
        assert!(!TaskStatus::Pending.is_terminal());
    }

    #[test]
    fn test_task_node_new() {
        let node = TaskNode::new("t1", "branch1", "测试任务", TaskNodeKind::SubTask);
        assert_eq!(node.id, "t1");
        assert_eq!(node.branch_name, "branch1");
        assert_eq!(node.intent, "测试任务");
        assert_eq!(node.kind, TaskNodeKind::SubTask);
        assert_eq!(node.status, TaskStatus::Pending);
        assert_eq!(node.progress, 0.0);
    }

    #[test]
    fn test_task_node_intent_preview() {
        let node = TaskNode::new("t1", "b1", "这是一个很长的任务意图描述用于测试预览功能", TaskNodeKind::SubTask);
        assert_eq!(node.intent_preview(10), "这是一个很长的任务意...");
        assert_eq!(node.intent_preview(100), node.intent);
    }

    #[test]
    fn test_task_dag_snapshot() {
        let mut dag = TaskDagSnapshot::new();
        assert_eq!(dag.node_count(), 0);
        assert_eq!(dag.edge_count(), 0);

        dag.nodes.push(TaskNode::new("t1", "b1", "任务1", TaskNodeKind::TaskRoot));
        dag.nodes.push(TaskNode::new("t2", "b1", "任务2", TaskNodeKind::SubTask));
        dag.edges.push(TaskEdge::new("t1", "t2", "contains"));

        assert_eq!(dag.node_count(), 2);
        assert_eq!(dag.edge_count(), 1);
        assert_eq!(dag.running_count(), 0);
        assert_eq!(dag.completed_count(), 0);
        assert_eq!(dag.overall_progress(), 0.0);
        assert!(dag.find_node("t1").is_some());
        assert!(dag.find_node("nonexistent").is_none());
        assert_eq!(dag.children("t1").len(), 1);
        assert_eq!(dag.parents("t2").len(), 1);
    }

    #[test]
    fn test_risk_level_from_str() {
        assert_eq!(RiskLevel::from_str("Low"), Some(RiskLevel::Low));
        assert_eq!(RiskLevel::from_str("Medium"), Some(RiskLevel::Medium));
        assert_eq!(RiskLevel::from_str("High"), Some(RiskLevel::High));
        assert_eq!(RiskLevel::from_str("Critical"), Some(RiskLevel::Critical));
        assert_eq!(RiskLevel::from_str("unknown"), None);
    }

    #[test]
    fn test_risk_level_requires_hitl() {
        assert!(!RiskLevel::Low.requires_hitl());
        assert!(!RiskLevel::Medium.requires_hitl());
        assert!(RiskLevel::High.requires_hitl());
        assert!(RiskLevel::Critical.requires_hitl());
    }

    #[test]
    fn test_risk_level_ordering() {
        assert!(RiskLevel::Low < RiskLevel::Medium);
        assert!(RiskLevel::Medium < RiskLevel::High);
        assert!(RiskLevel::High < RiskLevel::Critical);
    }

    #[test]
    fn test_hitl_request_status_from_str() {
        assert_eq!(HITLRequestStatus::from_str("Pending"), Some(HITLRequestStatus::Pending));
        assert_eq!(HITLRequestStatus::from_str("Approved"), Some(HITLRequestStatus::Approved));
        assert_eq!(HITLRequestStatus::from_str("Rejected"), Some(HITLRequestStatus::Rejected));
        assert_eq!(HITLRequestStatus::from_str("TimedOut"), Some(HITLRequestStatus::TimedOut));
        assert_eq!(HITLRequestStatus::from_str("unknown"), None);
    }

    #[test]
    fn test_hitl_request_new() {
        let req = HITLRequest::new("r1", "rm -rf /", RiskLevel::Critical, "删除操作");
        assert_eq!(req.id, "r1");
        assert_eq!(req.command, "rm -rf /");
        assert_eq!(req.risk_level, RiskLevel::Critical);
        assert_eq!(req.status, HITLRequestStatus::Pending);
        assert_eq!(req.risk_reason, "删除操作");
        assert!(req.is_pending());
    }

    #[test]
    fn test_hitl_request_full_command() {
        let mut req = HITLRequest::new("r1", "curl", RiskLevel::High, "网络请求");
        req.args = vec!["-X".to_string(), "POST".to_string(), "http://example.com".to_string()];
        assert_eq!(req.full_command(), "curl -X POST http://example.com");
    }

    #[test]
    fn test_hitl_status() {
        let mut status = HITLStatus::new();
        assert_eq!(status.pending_count, 0);
        assert_eq!(status.total_count(), 0);
        assert_eq!(status.approval_rate(), 0.0);
        assert!(!status.has_pending());

        status.pending_count = 3;
        status.approved_count = 10;
        status.rejected_count = 2;
        status.timed_out_count = 1;
        assert_eq!(status.total_count(), 16);
        assert!((status.approval_rate() - 10.0 / 13.0).abs() < 0.001);
        assert!(status.has_pending());
    }

    #[test]
    fn test_lifecycle_phase_from_str() {
        assert_eq!(LifecyclePhase::from_str("Running"), Some(LifecyclePhase::Running));
        assert_eq!(LifecyclePhase::from_str("Paused"), Some(LifecyclePhase::Paused));
        assert_eq!(LifecyclePhase::from_str("Error"), Some(LifecyclePhase::Error));
        assert_eq!(LifecyclePhase::from_str("unknown"), None);
    }

    #[test]
    fn test_lifecycle_phase_is_active() {
        assert!(LifecyclePhase::Running.is_active());
        assert!(LifecyclePhase::Initializing.is_active());
        assert!(!LifecyclePhase::Paused.is_active());
        assert!(!LifecyclePhase::Stopped.is_active());
    }

    #[test]
    fn test_lifecycle_status_new() {
        let status = LifecycleStatus::new("1.0.0", "instance-1");
        assert_eq!(status.phase, LifecyclePhase::Initializing);
        assert_eq!(status.version, "1.0.0");
        assert_eq!(status.instance_id, "instance-1");
        assert_eq!(status.heartbeat_interval_seconds, 19);
        assert_eq!(status.error_count, 0);
    }

    #[test]
    fn test_lifecycle_status_formatted_uptime() {
        let mut status = LifecycleStatus::new("1.0.0", "i1");
        status.uptime_seconds = 3661;
        assert_eq!(status.formatted_uptime(), "1h 1m 1s");

        status.uptime_seconds = 65;
        assert_eq!(status.formatted_uptime(), "1m 5s");

        status.uptime_seconds = 30;
        assert_eq!(status.formatted_uptime(), "30s");
    }

    #[test]
    fn test_anaphase_state_new() {
        let state = AnaphaseState::new("1.0.0", "i1");
        assert_eq!(state.current_phase, CognitivePhase::Perception);
        assert_eq!(state.lifecycle.version, "1.0.0");
        assert!(state.task_dag.nodes.is_empty());
        assert!(!state.has_pending_hitl());
        assert!(state.active_task().is_none());
    }

    #[test]
    fn test_task_edge_new() {
        let edge = TaskEdge::new("t1", "t2", "depends_on");
        assert_eq!(edge.source_id, "t1");
        assert_eq!(edge.target_id, "t2");
        assert_eq!(edge.edge_type, "depends_on");
    }
}
