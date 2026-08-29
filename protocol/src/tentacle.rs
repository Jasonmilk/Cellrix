//! Tentacle 数据结构 — 工具执行状态 + 插件审计 + 工具调用链
//!
//! # Design Principle
//!
//! **极致解耦**: 只依赖 serde，不依赖 Tentacle crate。
//! **白盒可观测**: 将 Tentacle 的工具执行过程和插件管理以结构化方式暴露。
//!
//! # Components
//!
//! - `ToolExecutionStatus`: 工具执行状态枚举
//! - `ToolExecution`: 工具执行记录
//! - `PluginStatus`: 插件状态枚举
//! - `PluginInfo`: 插件信息
//! - `PluginAuditEntry`: 插件审计记录
//! - `ToolCallNode`: 工具调用链节点
//! - `ToolCallEdge`: 工具调用链边
//! - `ToolCallChain`: 工具调用链快照
//! - `TentacleState`: 综合状态

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

static EXECUTION_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

// ============================================================================
// Tool Execution
// ============================================================================

/// 工具执行状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ToolExecutionStatus {
    /// 等待执行
    Pending,
    /// 正在执行
    Running,
    /// 执行完成
    Completed,
    /// 执行失败
    Failed,
    /// 执行超时
    TimedOut,
    /// 执行已取消
    Cancelled,
}

impl ToolExecutionStatus {
    /// 获取状态标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Running => "Running",
            Self::Completed => "Completed",
            Self::Failed => "Failed",
            Self::TimedOut => "TimedOut",
            Self::Cancelled => "Cancelled",
        }
    }

    /// 是否为终态
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::TimedOut | Self::Cancelled)
    }

    /// 是否为活跃状态
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Pending | Self::Running)
    }
}

impl std::fmt::Display for ToolExecutionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// 工具执行记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecution {
    /// 执行 ID
    pub id: String,
    /// 工具名称
    pub tool_name: String,
    /// 执行状态
    pub status: ToolExecutionStatus,
    /// 开始时间（Unix 时间戳）
    pub start_time: Option<String>,
    /// 结束时间（Unix 时间戳）
    pub end_time: Option<String>,
    /// 持续时间（毫秒）
    pub duration_ms: Option<u64>,
    /// 执行结果（成功时）
    pub result: Option<String>,
    /// 错误信息（失败时）
    pub error: Option<String>,
    /// 输入参数（JSON）
    pub input: Option<String>,
    /// 输出结果（JSON）
    pub output: Option<String>,
    /// 插件 ID（如果由插件执行）
    pub plugin_id: Option<String>,
    /// 父执行 ID（如果是子任务）
    pub parent_id: Option<String>,
    /// 重试次数
    pub retry_count: u32,
    /// 超时时间（毫秒）
    pub timeout_ms: Option<u64>,
}

impl ToolExecution {
    /// 创建新的工具执行记录
    pub fn new(tool_name: &str) -> Self {
        let id = EXECUTION_ID_COUNTER.fetch_add(1, Ordering::SeqCst);
        Self {
            id: format!("exec-{}", id),
            tool_name: tool_name.to_string(),
            status: ToolExecutionStatus::Pending,
            start_time: None,
            end_time: None,
            duration_ms: None,
            result: None,
            error: None,
            input: None,
            output: None,
            plugin_id: None,
            parent_id: None,
            retry_count: 0,
            timeout_ms: None,
        }
    }

    /// 开始执行
    pub fn start(&mut self) {
        self.status = ToolExecutionStatus::Running;
        self.start_time = Some(now_string());
    }

    /// 完成执行
    pub fn complete(&mut self, result: &str) {
        self.status = ToolExecutionStatus::Completed;
        self.end_time = Some(now_string());
        self.result = Some(result.to_string());
        self.calculate_duration();
    }

    /// 执行失败
    pub fn fail(&mut self, error: &str) {
        self.status = ToolExecutionStatus::Failed;
        self.end_time = Some(now_string());
        self.error = Some(error.to_string());
        self.calculate_duration();
    }

    /// 执行超时
    pub fn timeout(&mut self) {
        self.status = ToolExecutionStatus::TimedOut;
        self.end_time = Some(now_string());
        self.error = Some("Execution timed out".to_string());
        self.calculate_duration();
    }

    /// 取消执行
    pub fn cancel(&mut self) {
        self.status = ToolExecutionStatus::Cancelled;
        self.end_time = Some(now_string());
        self.calculate_duration();
    }

    /// 计算持续时间
    fn calculate_duration(&mut self) {
        if let (Some(start), Some(end)) = (&self.start_time, &self.end_time) {
            if let (Ok(s), Ok(e)) = (start.parse::<u64>(), end.parse::<u64>()) {
                self.duration_ms = Some(e.saturating_sub(s) * 1000);
            }
        }
    }

    /// 是否为终态
    pub fn is_terminal(&self) -> bool {
        self.status.is_terminal()
    }

    /// 是否为活跃状态
    pub fn is_active(&self) -> bool {
        self.status.is_active()
    }
}

// ============================================================================
// Plugin
// ============================================================================

/// 插件状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PluginStatus {
    /// 已注册
    Registered,
    /// 已启用
    Enabled,
    /// 已禁用
    Disabled,
    /// 错误状态
    Error,
    /// 已卸载
    Uninstalled,
}

impl PluginStatus {
    /// 获取状态标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Registered => "Registered",
            Self::Enabled => "Enabled",
            Self::Disabled => "Disabled",
            Self::Error => "Error",
            Self::Uninstalled => "Uninstalled",
        }
    }

    /// 是否可执行
    pub fn is_executable(&self) -> bool {
        matches!(self, Self::Enabled)
    }
}

impl std::fmt::Display for PluginStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// 插件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    /// 插件 ID
    pub id: String,
    /// 插件名称
    pub name: String,
    /// 插件版本
    pub version: String,
    /// 插件状态
    pub status: PluginStatus,
    /// 权限列表
    pub permissions: Vec<String>,
    /// 最后使用时间
    pub last_used: Option<String>,
    /// 执行次数
    pub execution_count: u64,
    /// 错误次数
    pub error_count: u64,
    /// 描述
    pub description: Option<String>,
    /// 作者
    pub author: Option<String>,
    /// 注册时间
    pub registered_at: String,
    /// 工具列表
    pub tools: Vec<String>,
}

impl PluginInfo {
    /// 创建新的插件信息
    pub fn new(id: &str, name: &str, version: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            version: version.to_string(),
            status: PluginStatus::Registered,
            permissions: Vec::new(),
            last_used: None,
            execution_count: 0,
            error_count: 0,
            description: None,
            author: None,
            registered_at: now_string(),
            tools: Vec::new(),
        }
    }

    /// 启用插件
    pub fn enable(&mut self) {
        self.status = PluginStatus::Enabled;
    }

    /// 禁用插件
    pub fn disable(&mut self) {
        self.status = PluginStatus::Disabled;
    }

    /// 记录执行
    pub fn record_execution(&mut self, success: bool) {
        self.execution_count += 1;
        self.last_used = Some(now_string());
        if !success {
            self.error_count += 1;
        }
    }

    /// 成功率
    pub fn success_rate(&self) -> f64 {
        if self.execution_count == 0 {
            return 1.0;
        }
        (self.execution_count - self.error_count) as f64 / self.execution_count as f64
    }

    /// 是否可执行
    pub fn is_executable(&self) -> bool {
        self.status.is_executable()
    }
}

/// 插件审计动作
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PluginAuditAction {
    /// 注册
    Register,
    /// 启用
    Enable,
    /// 禁用
    Disable,
    /// 卸载
    Uninstall,
    /// 执行工具
    Execute,
    /// 权限请求
    PermissionRequest,
    /// 权限授予
    PermissionGrant,
    /// 权限拒绝
    PermissionDeny,
    /// 错误
    Error,
}

impl PluginAuditAction {
    /// 获取动作标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Register => "Register",
            Self::Enable => "Enable",
            Self::Disable => "Disable",
            Self::Uninstall => "Uninstall",
            Self::Execute => "Execute",
            Self::PermissionRequest => "PermissionRequest",
            Self::PermissionGrant => "PermissionGrant",
            Self::PermissionDeny => "PermissionDeny",
            Self::Error => "Error",
        }
    }
}

impl std::fmt::Display for PluginAuditAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// 插件审计记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAuditEntry {
    /// 时间戳
    pub timestamp: String,
    /// 插件 ID
    pub plugin_id: String,
    /// 动作
    pub action: PluginAuditAction,
    /// 目标（工具名/权限名等）
    pub target: Option<String>,
    /// 结果（成功/失败）
    pub result: bool,
    /// 错误信息
    pub error: Option<String>,
    /// 执行者（用户/系统）
    pub actor: String,
    /// 详情（JSON）
    pub details: Option<String>,
}

impl PluginAuditEntry {
    /// 创建新的审计记录
    pub fn new(plugin_id: &str, action: PluginAuditAction, actor: &str) -> Self {
        Self {
            timestamp: now_string(),
            plugin_id: plugin_id.to_string(),
            action,
            target: None,
            result: true,
            error: None,
            actor: actor.to_string(),
            details: None,
        }
    }

    /// 标记失败
    pub fn fail(&mut self, error: &str) {
        self.result = false;
        self.error = Some(error.to_string());
    }
}

// ============================================================================
// Tool Call Chain
// ============================================================================

/// 工具调用链节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallNode {
    /// 执行 ID
    pub execution_id: String,
    /// 工具名称
    pub tool_name: String,
    /// 执行状态
    pub status: ToolExecutionStatus,
    /// 持续时间（毫秒）
    pub duration_ms: Option<u64>,
    /// 开始时间
    pub start_time: Option<String>,
    /// 结束时间
    pub end_time: Option<String>,
    /// 结果摘要
    pub result_summary: Option<String>,
}

impl ToolCallNode {
    /// 创建新的调用链节点
    pub fn new(execution_id: &str, tool_name: &str) -> Self {
        Self {
            execution_id: execution_id.to_string(),
            tool_name: tool_name.to_string(),
            status: ToolExecutionStatus::Pending,
            duration_ms: None,
            start_time: None,
            end_time: None,
            result_summary: None,
        }
    }

    /// 从 ToolExecution 创建
    pub fn from_execution(exec: &ToolExecution) -> Self {
        Self {
            execution_id: exec.id.clone(),
            tool_name: exec.tool_name.clone(),
            status: exec.status,
            duration_ms: exec.duration_ms,
            start_time: exec.start_time.clone(),
            end_time: exec.end_time.clone(),
            result_summary: exec.result.as_ref().map(|r| r.chars().take(100).collect()),
        }
    }
}

/// 工具调用链边关系
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ToolCallRelation {
    /// 依赖（前一个完成后才能开始）
    DependsOn,
    /// 触发（前一个触发后一个）
    Triggers,
    /// 并行（同时执行）
    Parallel,
    /// 子任务（前一个是后一个的父任务）
    ParentOf,
}

impl ToolCallRelation {
    /// 获取关系标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::DependsOn => "DependsOn",
            Self::Triggers => "Triggers",
            Self::Parallel => "Parallel",
            Self::ParentOf => "ParentOf",
        }
    }
}

impl std::fmt::Display for ToolCallRelation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// 工具调用链边
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallEdge {
    /// 源执行 ID
    pub from_execution_id: String,
    /// 目标执行 ID
    pub to_execution_id: String,
    /// 关系
    pub relation: ToolCallRelation,
}

impl ToolCallEdge {
    /// 创建新的调用链边
    pub fn new(from: &str, to: &str, relation: ToolCallRelation) -> Self {
        Self {
            from_execution_id: from.to_string(),
            to_execution_id: to.to_string(),
            relation,
        }
    }
}

/// 工具调用链快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallChain {
    /// 节点列表
    pub nodes: Vec<ToolCallNode>,
    /// 边列表
    pub edges: Vec<ToolCallEdge>,
    /// 根节点 ID
    pub root_id: Option<String>,
    /// 总持续时间（毫秒）
    pub total_duration_ms: Option<u64>,
    /// 链名称
    pub name: String,
    /// 创建时间
    pub created_at: String,
}

impl ToolCallChain {
    /// 创建新的调用链
    pub fn new(name: &str) -> Self {
        Self {
            nodes: Vec::new(),
            edges: Vec::new(),
            root_id: None,
            total_duration_ms: None,
            name: name.to_string(),
            created_at: now_string(),
        }
    }

    /// 添加节点
    pub fn add_node(&mut self, node: ToolCallNode) {
        if self.root_id.is_none() {
            self.root_id = Some(node.execution_id.clone());
        }
        self.nodes.push(node);
    }

    /// 添加边
    pub fn add_edge(&mut self, edge: ToolCallEdge) {
        self.edges.push(edge);
    }

    /// 节点数量
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// 边数量
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    /// 已完成节点数
    pub fn completed_count(&self) -> usize {
        self.nodes
            .iter()
            .filter(|n| n.status == ToolExecutionStatus::Completed)
            .count()
    }

    /// 运行中节点数
    pub fn running_count(&self) -> usize {
        self.nodes
            .iter()
            .filter(|n| n.status == ToolExecutionStatus::Running)
            .count()
    }

    /// 失败节点数
    pub fn failed_count(&self) -> usize {
        self.nodes
            .iter()
            .filter(|n| matches!(n.status, ToolExecutionStatus::Failed | ToolExecutionStatus::TimedOut))
            .count()
    }

    /// 整体进度（0.0 - 1.0）
    pub fn progress(&self) -> f64 {
        if self.nodes.is_empty() {
            return 0.0;
        }
        self.completed_count() as f64 / self.nodes.len() as f64
    }

    /// 计算总持续时间
    pub fn calculate_total_duration(&mut self) {
        let total: u64 = self
            .nodes
            .iter()
            .filter_map(|n| n.duration_ms)
            .sum();
        if total > 0 {
            self.total_duration_ms = Some(total);
        }
    }
}

// ============================================================================
// Tentacle State
// ============================================================================

/// Tentacle 指标
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TentacleMetrics {
    /// 总执行次数
    pub total_executions: u64,
    /// 成功执行次数
    pub successful_executions: u64,
    /// 失败执行次数
    pub failed_executions: u64,
    /// 平均执行时间（毫秒）
    pub avg_execution_ms: Option<f64>,
    /// 活跃插件数
    pub active_plugins: usize,
    /// 总插件数
    pub total_plugins: usize,
    /// 工具总数
    pub total_tools: usize,
    /// 队列长度
    pub queue_length: usize,
    /// 并发执行数
    pub concurrent_executions: usize,
}

impl TentacleMetrics {
    /// 创建新的指标
    pub fn new() -> Self {
        Self::default()
    }

    /// 成功率
    pub fn success_rate(&self) -> f64 {
        if self.total_executions == 0 {
            return 1.0;
        }
        self.successful_executions as f64 / self.total_executions as f64
    }
}

/// Tentacle 综合状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TentacleState {
    /// 版本
    pub version: String,
    /// 实例 ID
    pub instance_id: String,
    /// 活跃执行列表
    pub active_executions: Vec<ToolExecution>,
    /// 最近执行记录（最多 100 条）
    pub recent_executions: Vec<ToolExecution>,
    /// 插件列表
    pub plugins: Vec<PluginInfo>,
    /// 插件审计记录（最多 100 条）
    pub audit_entries: Vec<PluginAuditEntry>,
    /// 当前工具调用链
    pub call_chain: Option<ToolCallChain>,
    /// 指标
    pub metrics: TentacleMetrics,
    /// 启动时间
    pub started_at: String,
    /// 工具映射（工具名 -> 插件 ID）
    pub tool_map: HashMap<String, String>,
}

impl TentacleState {
    /// 创建新的综合状态
    pub fn new(version: &str, instance_id: &str) -> Self {
        Self {
            version: version.to_string(),
            instance_id: instance_id.to_string(),
            active_executions: Vec::new(),
            recent_executions: Vec::new(),
            plugins: Vec::new(),
            audit_entries: Vec::new(),
            call_chain: None,
            metrics: TentacleMetrics::new(),
            started_at: now_string(),
            tool_map: HashMap::new(),
        }
    }

    /// 添加活跃执行
    pub fn add_active_execution(&mut self, exec: ToolExecution) {
        self.metrics.queue_length = self.active_executions.len() + 1;
        self.active_executions.push(exec);
    }

    /// 完成执行（从活跃列表移到最近列表）
    pub fn complete_execution(&mut self, exec_id: &str) {
        if let Some(pos) = self.active_executions.iter().position(|e| e.id == exec_id) {
            let exec = self.active_executions.remove(pos);
            self.metrics.queue_length = self.active_executions.len();
            self.metrics.total_executions += 1;
            if exec.status == ToolExecutionStatus::Completed {
                self.metrics.successful_executions += 1;
            } else {
                self.metrics.failed_executions += 1;
            }
            self.recent_executions.insert(0, exec);
            if self.recent_executions.len() > 100 {
                self.recent_executions.truncate(100);
            }
        }
    }

    /// 注册插件
    pub fn register_plugin(&mut self, plugin: PluginInfo) {
        self.metrics.total_plugins = self.plugins.len() + 1;
        if plugin.status == PluginStatus::Enabled {
            self.metrics.active_plugins += 1;
        }
        self.plugins.push(plugin);
    }

    /// 添加审计记录
    pub fn add_audit_entry(&mut self, entry: PluginAuditEntry) {
        self.audit_entries.insert(0, entry);
        if self.audit_entries.len() > 100 {
            self.audit_entries.truncate(100);
        }
    }

    /// 活跃执行数
    pub fn active_count(&self) -> usize {
        self.active_executions.len()
    }

    /// 已启用插件数
    pub fn enabled_plugin_count(&self) -> usize {
        self.plugins
            .iter()
            .filter(|p| p.status == PluginStatus::Enabled)
            .count()
    }

    /// 最近失败数
    pub fn recent_failure_count(&self) -> usize {
        self.recent_executions
            .iter()
            .filter(|e| matches!(e.status, ToolExecutionStatus::Failed | ToolExecutionStatus::TimedOut))
            .count()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// 获取当前时间（Unix 时间戳字符串）
fn now_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- ToolExecutionStatus ---

    #[test]
    fn test_tool_execution_status_label() {
        assert_eq!(ToolExecutionStatus::Pending.label(), "Pending");
        assert_eq!(ToolExecutionStatus::Running.label(), "Running");
        assert_eq!(ToolExecutionStatus::Completed.label(), "Completed");
        assert_eq!(ToolExecutionStatus::Failed.label(), "Failed");
        assert_eq!(ToolExecutionStatus::TimedOut.label(), "TimedOut");
        assert_eq!(ToolExecutionStatus::Cancelled.label(), "Cancelled");
    }

    #[test]
    fn test_tool_execution_status_is_terminal() {
        assert!(!ToolExecutionStatus::Pending.is_terminal());
        assert!(!ToolExecutionStatus::Running.is_terminal());
        assert!(ToolExecutionStatus::Completed.is_terminal());
        assert!(ToolExecutionStatus::Failed.is_terminal());
        assert!(ToolExecutionStatus::TimedOut.is_terminal());
        assert!(ToolExecutionStatus::Cancelled.is_terminal());
    }

    #[test]
    fn test_tool_execution_status_is_active() {
        assert!(ToolExecutionStatus::Pending.is_active());
        assert!(ToolExecutionStatus::Running.is_active());
        assert!(!ToolExecutionStatus::Completed.is_active());
        assert!(!ToolExecutionStatus::Failed.is_active());
    }

    // --- ToolExecution ---

    #[test]
    fn test_tool_execution_new() {
        let exec = ToolExecution::new("test_tool");
        assert_eq!(exec.tool_name, "test_tool");
        assert_eq!(exec.status, ToolExecutionStatus::Pending);
        assert!(!exec.id.is_empty());
        assert_eq!(exec.retry_count, 0);
    }

    #[test]
    fn test_tool_execution_lifecycle() {
        let mut exec = ToolExecution::new("test_tool");
        assert!(exec.is_active());

        exec.start();
        assert_eq!(exec.status, ToolExecutionStatus::Running);
        assert!(exec.start_time.is_some());

        exec.complete("success result");
        assert_eq!(exec.status, ToolExecutionStatus::Completed);
        assert!(exec.end_time.is_some());
        assert_eq!(exec.result, Some("success result".to_string()));
        assert!(exec.is_terminal());
    }

    #[test]
    fn test_tool_execution_fail() {
        let mut exec = ToolExecution::new("test_tool");
        exec.start();
        exec.fail("something went wrong");
        assert_eq!(exec.status, ToolExecutionStatus::Failed);
        assert_eq!(exec.error, Some("something went wrong".to_string()));
        assert!(exec.is_terminal());
    }

    #[test]
    fn test_tool_execution_timeout() {
        let mut exec = ToolExecution::new("test_tool");
        exec.start();
        exec.timeout();
        assert_eq!(exec.status, ToolExecutionStatus::TimedOut);
        assert!(exec.error.is_some());
        assert!(exec.is_terminal());
    }

    #[test]
    fn test_tool_execution_cancel() {
        let mut exec = ToolExecution::new("test_tool");
        exec.start();
        exec.cancel();
        assert_eq!(exec.status, ToolExecutionStatus::Cancelled);
        assert!(exec.is_terminal());
    }

    // --- PluginStatus ---

    #[test]
    fn test_plugin_status_label() {
        assert_eq!(PluginStatus::Registered.label(), "Registered");
        assert_eq!(PluginStatus::Enabled.label(), "Enabled");
        assert_eq!(PluginStatus::Disabled.label(), "Disabled");
        assert_eq!(PluginStatus::Error.label(), "Error");
        assert_eq!(PluginStatus::Uninstalled.label(), "Uninstalled");
    }

    #[test]
    fn test_plugin_status_is_executable() {
        assert!(PluginStatus::Enabled.is_executable());
        assert!(!PluginStatus::Registered.is_executable());
        assert!(!PluginStatus::Disabled.is_executable());
        assert!(!PluginStatus::Error.is_executable());
    }

    // --- PluginInfo ---

    #[test]
    fn test_plugin_info_new() {
        let plugin = PluginInfo::new("plugin-001", "Test Plugin", "1.0.0");
        assert_eq!(plugin.id, "plugin-001");
        assert_eq!(plugin.name, "Test Plugin");
        assert_eq!(plugin.version, "1.0.0");
        assert_eq!(plugin.status, PluginStatus::Registered);
        assert_eq!(plugin.execution_count, 0);
        assert_eq!(plugin.error_count, 0);
    }

    #[test]
    fn test_plugin_info_enable_disable() {
        let mut plugin = PluginInfo::new("plugin-001", "Test", "1.0.0");
        plugin.enable();
        assert_eq!(plugin.status, PluginStatus::Enabled);
        assert!(plugin.is_executable());

        plugin.disable();
        assert_eq!(plugin.status, PluginStatus::Disabled);
        assert!(!plugin.is_executable());
    }

    #[test]
    fn test_plugin_info_record_execution() {
        let mut plugin = PluginInfo::new("plugin-001", "Test", "1.0.0");
        plugin.record_execution(true);
        plugin.record_execution(true);
        plugin.record_execution(false);

        assert_eq!(plugin.execution_count, 3);
        assert_eq!(plugin.error_count, 1);
        assert!((plugin.success_rate() - 2.0 / 3.0).abs() < 0.001);
        assert!(plugin.last_used.is_some());
    }

    #[test]
    fn test_plugin_info_success_rate_no_executions() {
        let plugin = PluginInfo::new("plugin-001", "Test", "1.0.0");
        assert_eq!(plugin.success_rate(), 1.0);
    }

    // --- PluginAuditEntry ---

    #[test]
    fn test_plugin_audit_entry_new() {
        let entry = PluginAuditEntry::new("plugin-001", PluginAuditAction::Register, "system");
        assert_eq!(entry.plugin_id, "plugin-001");
        assert_eq!(entry.action, PluginAuditAction::Register);
        assert_eq!(entry.actor, "system");
        assert!(entry.result);
        assert!(!entry.timestamp.is_empty());
    }

    #[test]
    fn test_plugin_audit_entry_fail() {
        let mut entry = PluginAuditEntry::new("plugin-001", PluginAuditAction::Execute, "user");
        entry.fail("permission denied");
        assert!(!entry.result);
        assert_eq!(entry.error, Some("permission denied".to_string()));
    }

    #[test]
    fn test_plugin_audit_action_label() {
        assert_eq!(PluginAuditAction::Register.label(), "Register");
        assert_eq!(PluginAuditAction::Enable.label(), "Enable");
        assert_eq!(PluginAuditAction::Execute.label(), "Execute");
        assert_eq!(PluginAuditAction::Error.label(), "Error");
    }

    // --- ToolCallChain ---

    #[test]
    fn test_tool_call_chain_new() {
        let chain = ToolCallChain::new("test-chain");
        assert_eq!(chain.name, "test-chain");
        assert_eq!(chain.node_count(), 0);
        assert_eq!(chain.edge_count(), 0);
        assert!(chain.root_id.is_none());
    }

    #[test]
    fn test_tool_call_chain_add_node() {
        let mut chain = ToolCallChain::new("test-chain");
        let node1 = ToolCallNode::new("exec-001", "tool_a");
        let node2 = ToolCallNode::new("exec-002", "tool_b");

        chain.add_node(node1);
        chain.add_node(node2);

        assert_eq!(chain.node_count(), 2);
        assert_eq!(chain.root_id, Some("exec-001".to_string()));
    }

    #[test]
    fn test_tool_call_chain_add_edge() {
        let mut chain = ToolCallChain::new("test-chain");
        chain.add_node(ToolCallNode::new("exec-001", "tool_a"));
        chain.add_node(ToolCallNode::new("exec-002", "tool_b"));
        chain.add_edge(ToolCallEdge::new("exec-001", "exec-002", ToolCallRelation::DependsOn));

        assert_eq!(chain.edge_count(), 1);
        assert_eq!(chain.edges[0].relation, ToolCallRelation::DependsOn);
    }

    #[test]
    fn test_tool_call_chain_progress() {
        let mut chain = ToolCallChain::new("test-chain");
        let mut node1 = ToolCallNode::new("exec-001", "tool_a");
        node1.status = ToolExecutionStatus::Completed;
        let mut node2 = ToolCallNode::new("exec-002", "tool_b");
        node2.status = ToolExecutionStatus::Running;
        let node3 = ToolCallNode::new("exec-003", "tool_c");

        chain.add_node(node1);
        chain.add_node(node2);
        chain.add_node(node3);

        assert_eq!(chain.completed_count(), 1);
        assert_eq!(chain.running_count(), 1);
        assert!((chain.progress() - 1.0 / 3.0).abs() < 0.001);
    }

    #[test]
    fn test_tool_call_chain_failed_count() {
        let mut chain = ToolCallChain::new("test-chain");
        let mut node1 = ToolCallNode::new("exec-001", "tool_a");
        node1.status = ToolExecutionStatus::Failed;
        let mut node2 = ToolCallNode::new("exec-002", "tool_b");
        node2.status = ToolExecutionStatus::TimedOut;

        chain.add_node(node1);
        chain.add_node(node2);

        assert_eq!(chain.failed_count(), 2);
    }

    #[test]
    fn test_tool_call_chain_calculate_total_duration() {
        let mut chain = ToolCallChain::new("test-chain");
        let mut node1 = ToolCallNode::new("exec-001", "tool_a");
        node1.duration_ms = Some(1000);
        let mut node2 = ToolCallNode::new("exec-002", "tool_b");
        node2.duration_ms = Some(2000);

        chain.add_node(node1);
        chain.add_node(node2);
        chain.calculate_total_duration();

        assert_eq!(chain.total_duration_ms, Some(3000));
    }

    #[test]
    fn test_tool_call_node_from_execution() {
        let mut exec = ToolExecution::new("test_tool");
        exec.start();
        exec.complete("result data");

        let node = ToolCallNode::from_execution(&exec);
        assert_eq!(node.execution_id, exec.id);
        assert_eq!(node.tool_name, "test_tool");
        assert_eq!(node.status, ToolExecutionStatus::Completed);
        assert_eq!(node.result_summary, Some("result data".to_string()));
    }

    // --- TentacleState ---

    #[test]
    fn test_tentacle_state_new() {
        let state = TentacleState::new("1.0.0", "tentacle-01");
        assert_eq!(state.version, "1.0.0");
        assert_eq!(state.instance_id, "tentacle-01");
        assert_eq!(state.active_count(), 0);
        assert_eq!(state.plugins.len(), 0);
        assert!(!state.started_at.is_empty());
    }

    #[test]
    fn test_tentacle_state_add_active_execution() {
        let mut state = TentacleState::new("1.0.0", "tentacle-01");
        let exec = ToolExecution::new("test_tool");
        state.add_active_execution(exec);

        assert_eq!(state.active_count(), 1);
        assert_eq!(state.metrics.queue_length, 1);
    }

    #[test]
    fn test_tentacle_state_complete_execution() {
        let mut state = TentacleState::new("1.0.0", "tentacle-01");
        let mut exec = ToolExecution::new("test_tool");
        exec.start();
        exec.complete("success");
        let exec_id = exec.id.clone();

        state.add_active_execution(exec);
        state.complete_execution(&exec_id);

        assert_eq!(state.active_count(), 0);
        assert_eq!(state.recent_executions.len(), 1);
        assert_eq!(state.metrics.total_executions, 1);
        assert_eq!(state.metrics.successful_executions, 1);
        assert_eq!(state.metrics.failed_executions, 0);
    }

    #[test]
    fn test_tentacle_state_register_plugin() {
        let mut state = TentacleState::new("1.0.0", "tentacle-01");
        let mut plugin = PluginInfo::new("plugin-001", "Test", "1.0.0");
        plugin.enable();
        state.register_plugin(plugin);

        assert_eq!(state.plugins.len(), 1);
        assert_eq!(state.enabled_plugin_count(), 1);
        assert_eq!(state.metrics.total_plugins, 1);
        assert_eq!(state.metrics.active_plugins, 1);
    }

    #[test]
    fn test_tentacle_state_add_audit_entry() {
        let mut state = TentacleState::new("1.0.0", "tentacle-01");
        let entry = PluginAuditEntry::new("plugin-001", PluginAuditAction::Register, "system");
        state.add_audit_entry(entry);

        assert_eq!(state.audit_entries.len(), 1);
    }

    #[test]
    fn test_tentacle_state_recent_failure_count() {
        let mut state = TentacleState::new("1.0.0", "tentacle-01");

        let mut exec1 = ToolExecution::new("tool_a");
        exec1.start();
        exec1.complete("success");
        state.recent_executions.push(exec1);

        let mut exec2 = ToolExecution::new("tool_b");
        exec2.start();
        exec2.fail("error");
        state.recent_executions.push(exec2);

        assert_eq!(state.recent_failure_count(), 1);
    }

    #[test]
    fn test_tentacle_metrics_success_rate() {
        let mut metrics = TentacleMetrics::new();
        metrics.total_executions = 10;
        metrics.successful_executions = 8;
        metrics.failed_executions = 2;

        assert!((metrics.success_rate() - 0.8).abs() < 0.001);
    }

    #[test]
    fn test_tentacle_metrics_success_rate_no_executions() {
        let metrics = TentacleMetrics::new();
        assert_eq!(metrics.success_rate(), 1.0);
    }

    #[test]
    fn test_tool_call_relation_label() {
        assert_eq!(ToolCallRelation::DependsOn.label(), "DependsOn");
        assert_eq!(ToolCallRelation::Triggers.label(), "Triggers");
        assert_eq!(ToolCallRelation::Parallel.label(), "Parallel");
        assert_eq!(ToolCallRelation::ParentOf.label(), "ParentOf");
    }
}
