//! Tentacle UI 展示组件 — 工具执行 + 插件审计 + 工具调用链
//!
//! # Design Principle
//!
//! **白盒可观测**: 将 Tentacle 的工具执行过程和插件管理以可视化方式展示。
//! **极致解耦**: 只依赖 cellrix-protocol 数据结构，不依赖 Tentacle crate。
//!
//! # Components
//!
//! - `ToolExecutionWidget`: 工具执行列表
//! - `PluginAuditWidget`: 插件审计列表
//! - `ToolCallChainWidget`: 工具调用链可视化
//! - `TentacleSnapshotWidget`: 综合快照组件

use crate::widgets::Widget;
use cellrix_protocol::tentacle::{
    PluginAuditAction, PluginAuditEntry, PluginInfo, PluginStatus, ToolCallChain,
    ToolCallNode, ToolExecution, ToolExecutionStatus, TentacleState,
};
use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
};

// ============================================================================
// Helper Functions
// ============================================================================

/// 将 hex 颜色字符串转换为 ratatui Color
fn hex_to_color(hex: &str) -> Color {
    if hex.len() != 7 || !hex.starts_with('#') {
        return Color::Gray;
    }
    let r = u8::from_str_radix(&hex[1..3], 16).unwrap_or(128);
    let g = u8::from_str_radix(&hex[3..5], 16).unwrap_or(128);
    let b = u8::from_str_radix(&hex[5..7], 16).unwrap_or(128);
    Color::Rgb(r, g, b)
}

/// 构建进度条
fn build_progress_bar(progress: f64, width: usize) -> String {
    let filled = (progress * width as f64).round() as usize;
    let filled = filled.min(width);
    let empty = width - filled;
    format!("{}{}", "█".repeat(filled), "░".repeat(empty))
}

/// 工具执行状态颜色
fn execution_status_color(status: &ToolExecutionStatus) -> Color {
    match status {
        ToolExecutionStatus::Pending => hex_to_color("#9E9E9E"),
        ToolExecutionStatus::Running => hex_to_color("#2196F3"),
        ToolExecutionStatus::Completed => hex_to_color("#4CAF50"),
        ToolExecutionStatus::Failed => hex_to_color("#F44336"),
        ToolExecutionStatus::TimedOut => hex_to_color("#FF9800"),
        ToolExecutionStatus::Cancelled => hex_to_color("#607D8B"),
    }
}

/// 插件状态颜色
fn plugin_status_color(status: &PluginStatus) -> Color {
    match status {
        PluginStatus::Registered => hex_to_color("#9E9E9E"),
        PluginStatus::Enabled => hex_to_color("#4CAF50"),
        PluginStatus::Disabled => hex_to_color("#FF9800"),
        PluginStatus::Error => hex_to_color("#F44336"),
        PluginStatus::Uninstalled => hex_to_color("#607D8B"),
    }
}

/// 审计动作颜色
fn audit_action_color(action: &PluginAuditAction) -> Color {
    match action {
        PluginAuditAction::Register => hex_to_color("#2196F3"),
        PluginAuditAction::Enable => hex_to_color("#4CAF50"),
        PluginAuditAction::Disable => hex_to_color("#FF9800"),
        PluginAuditAction::Uninstall => hex_to_color("#F44336"),
        PluginAuditAction::Execute => hex_to_color("#9C27B0"),
        PluginAuditAction::PermissionRequest => hex_to_color("#00BCD4"),
        PluginAuditAction::PermissionGrant => hex_to_color("#4CAF50"),
        PluginAuditAction::PermissionDeny => hex_to_color("#F44336"),
        PluginAuditAction::Error => hex_to_color("#F44336"),
    }
}

// ============================================================================
// ToolExecutionWidget
// ============================================================================

/// 工具执行列表组件
pub struct ToolExecutionWidget {
    executions: Vec<ToolExecution>,
    title: String,
}

impl ToolExecutionWidget {
    /// 创建新的工具执行列表
    pub fn new(executions: Vec<ToolExecution>) -> Self {
        Self {
            executions,
            title: "Tool Executions".to_string(),
        }
    }

    /// 设置标题
    pub fn with_title(mut self, title: &str) -> Self {
        self.title = title.to_string();
        self
    }

    /// 统计行
    fn stats_line(&self) -> Line<'static> {
        let total = self.executions.len();
        let running = self
            .executions
            .iter()
            .filter(|e| e.status == ToolExecutionStatus::Running)
            .count();
        let completed = self
            .executions
            .iter()
            .filter(|e| e.status == ToolExecutionStatus::Completed)
            .count();
        let failed = self
            .executions
            .iter()
            .filter(|e| {
                matches!(
                    e.status,
                    ToolExecutionStatus::Failed | ToolExecutionStatus::TimedOut
                )
            })
            .count();

        Line::from(vec![
            Span::styled(
                format!("Total: {} ", total),
                Style::default().fg(Color::White),
            ),
            Span::styled(
                format!("Running: {} ", running),
                Style::default().fg(hex_to_color("#2196F3")),
            ),
            Span::styled(
                format!("Completed: {} ", completed),
                Style::default().fg(hex_to_color("#4CAF50")),
            ),
            Span::styled(
                format!("Failed: {}", failed),
                Style::default().fg(hex_to_color("#F44336")),
            ),
        ])
    }

    /// 执行项
    fn execution_items(&self) -> Vec<ListItem<'static>> {
        self.executions
            .iter()
            .map(|exec| {
                let status_color = execution_status_color(&exec.status);
                let duration = exec
                    .duration_ms
                    .map(|d| format!("{}ms", d))
                    .unwrap_or_else(|| "-".to_string());

                let mut spans = vec![
                    Span::styled(
                        format!("[{}] ", exec.status.label()),
                        Style::default().fg(status_color).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{} ", exec.tool_name),
                        Style::default().fg(Color::White),
                    ),
                    Span::styled(
                        format!("({}) ", duration),
                        Style::default().fg(Color::Gray),
                    ),
                ];

                if exec.status == ToolExecutionStatus::Running {
                    spans.push(Span::styled(
                        format!("{} ", build_progress_bar(0.5, 10)),
                        Style::default().fg(hex_to_color("#2196F3")),
                    ));
                }

                if let Some(error) = &exec.error {
                    spans.push(Span::styled(
                        format!("Error: {}", error),
                        Style::default().fg(hex_to_color("#F44336")),
                    ));
                }

                ListItem::new(Line::from(spans))
            })
            .collect()
    }
}

impl Widget for ToolExecutionWidget {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title(self.title.as_str())
            .borders(Borders::ALL);

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 3 {
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1), Constraint::Min(0)])
            .split(inner);

        // 统计行
        Paragraph::new(self.stats_line()).render(chunks[0], buf);

        // 执行列表
        let items = self.execution_items();
        List::new(items)
            .block(Block::default())
            .render(chunks[1], buf);
    }
}

// ============================================================================
// PluginAuditWidget
// ============================================================================

/// 插件审计列表组件
pub struct PluginAuditWidget {
    entries: Vec<PluginAuditEntry>,
    plugins: Vec<PluginInfo>,
    title: String,
}

impl PluginAuditWidget {
    /// 创建新的插件审计列表
    pub fn new(entries: Vec<PluginAuditEntry>, plugins: Vec<PluginInfo>) -> Self {
        Self {
            entries,
            plugins,
            title: "Plugin Audit".to_string(),
        }
    }

    /// 设置标题
    pub fn with_title(mut self, title: &str) -> Self {
        self.title = title.to_string();
        self
    }

    /// 插件统计行
    fn plugin_stats_line(&self) -> Line<'static> {
        let total = self.plugins.len();
        let enabled = self
            .plugins
            .iter()
            .filter(|p| p.status == PluginStatus::Enabled)
            .count();
        let disabled = self
            .plugins
            .iter()
            .filter(|p| p.status == PluginStatus::Disabled)
            .count();
        let errors = self
            .plugins
            .iter()
            .filter(|p| p.status == PluginStatus::Error)
            .count();

        Line::from(vec![
            Span::styled(
                format!("Plugins: {} ", total),
                Style::default().fg(Color::White),
            ),
            Span::styled(
                format!("Enabled: {} ", enabled),
                Style::default().fg(hex_to_color("#4CAF50")),
            ),
            Span::styled(
                format!("Disabled: {} ", disabled),
                Style::default().fg(hex_to_color("#FF9800")),
            ),
            Span::styled(
                format!("Errors: {}", errors),
                Style::default().fg(hex_to_color("#F44336")),
            ),
        ])
    }

    /// 审计项
    fn audit_items(&self) -> Vec<ListItem<'static>> {
        self.entries
            .iter()
            .take(20)
            .map(|entry| {
                let action_color = audit_action_color(&entry.action);
                let result_color = if entry.result {
                    hex_to_color("#4CAF50")
                } else {
                    hex_to_color("#F44336")
                };

                let plugin_name = self
                    .plugins
                    .iter()
                    .find(|p| p.id == entry.plugin_id)
                    .map(|p| p.name.clone())
                    .unwrap_or_else(|| entry.plugin_id.clone());

                let mut spans = vec![
                    Span::styled(
                        format!("{} ", entry.timestamp),
                        Style::default().fg(Color::Gray),
                    ),
                    Span::styled(
                        format!("[{}] ", entry.action.label()),
                        Style::default().fg(action_color).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{} ", plugin_name),
                        Style::default().fg(Color::White),
                    ),
                    Span::styled(
                        format!("by {} ", entry.actor),
                        Style::default().fg(Color::Gray),
                    ),
                    Span::styled(
                        if entry.result { "OK" } else { "FAIL" },
                        Style::default().fg(result_color).add_modifier(Modifier::BOLD),
                    ),
                ];

                if let Some(target) = &entry.target {
                    spans.push(Span::styled(
                        format!(" -> {}", target),
                        Style::default().fg(Color::Cyan),
                    ));
                }

                if let Some(error) = &entry.error {
                    spans.push(Span::styled(
                        format!(" Error: {}", error),
                        Style::default().fg(hex_to_color("#F44336")),
                    ));
                }

                ListItem::new(Line::from(spans))
            })
            .collect()
    }
}

impl Widget for PluginAuditWidget {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title(self.title.as_str())
            .borders(Borders::ALL);

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 3 {
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1), Constraint::Min(0)])
            .split(inner);

        // 插件统计行
        Paragraph::new(self.plugin_stats_line()).render(chunks[0], buf);

        // 审计列表
        let items = self.audit_items();
        List::new(items)
            .block(Block::default())
            .render(chunks[1], buf);
    }
}

// ============================================================================
// ToolCallChainWidget
// ============================================================================

/// 工具调用链可视化组件
pub struct ToolCallChainWidget {
    chain: Option<ToolCallChain>,
    title: String,
}

impl ToolCallChainWidget {
    /// 创建新的工具调用链组件
    pub fn new(chain: Option<ToolCallChain>) -> Self {
        Self {
            chain,
            title: "Tool Call Chain".to_string(),
        }
    }

    /// 设置标题
    pub fn with_title(mut self, title: &str) -> Self {
        self.title = title.to_string();
        self
    }

    /// 统计行
    fn stats_line(&self) -> Line<'static> {
        if let Some(chain) = &self.chain {
            let total = chain.node_count();
            let completed = chain.completed_count();
            let running = chain.running_count();
            let failed = chain.failed_count();
            let progress = (chain.progress() * 100.0) as u32;
            let duration = chain
                .total_duration_ms
                .map(|d| format!("{}ms", d))
                .unwrap_or_else(|| "-".to_string());

            Line::from(vec![
                Span::styled(
                    format!("{}: ", chain.name),
                    Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("Nodes: {} ", total),
                    Style::default().fg(Color::White),
                ),
                Span::styled(
                    format!("Running: {} ", running),
                    Style::default().fg(hex_to_color("#2196F3")),
                ),
                Span::styled(
                    format!("Completed: {} ", completed),
                    Style::default().fg(hex_to_color("#4CAF50")),
                ),
                Span::styled(
                    format!("Failed: {} ", failed),
                    Style::default().fg(hex_to_color("#F44336")),
                ),
                Span::styled(
                    format!("Progress: {}% ", progress),
                    Style::default().fg(Color::Cyan),
                ),
                Span::styled(
                    format!("Duration: {}", duration),
                    Style::default().fg(Color::Gray),
                ),
            ])
        } else {
            Line::from(Span::styled(
                "No active call chain",
                Style::default().fg(Color::Gray),
            ))
        }
    }

    /// 节点项
    fn node_items(&self) -> Vec<ListItem<'static>> {
        if let Some(chain) = &self.chain {
            chain
                .nodes
                .iter()
                .map(|node| {
                    let status_color = execution_status_color(&node.status);
                    let duration = node
                        .duration_ms
                        .map(|d| format!("{}ms", d))
                        .unwrap_or_else(|| "-".to_string());

                    let mut spans = vec![
                        Span::styled(
                            format!("[{}] ", node.status.label()),
                            Style::default().fg(status_color).add_modifier(Modifier::BOLD),
                        ),
                        Span::styled(
                            format!("{} ", node.tool_name),
                            Style::default().fg(Color::White),
                        ),
                        Span::styled(
                            format!("({}) ", duration),
                            Style::default().fg(Color::Gray),
                        ),
                    ];

                    if node.status == ToolExecutionStatus::Running {
                        spans.push(Span::styled(
                            build_progress_bar(0.5, 10),
                            Style::default().fg(hex_to_color("#2196F3")),
                        ));
                    }

                    if let Some(summary) = &node.result_summary {
                        spans.push(Span::styled(
                            format!(" -> {}", summary),
                            Style::default().fg(Color::Cyan),
                        ));
                    }

                    ListItem::new(Line::from(spans))
                })
                .collect()
        } else {
            vec![]
        }
    }

    /// 边关系行
    fn edges_line(&self) -> Line<'static> {
        if let Some(chain) = &self.chain {
            let edges: Vec<String> = chain
                .edges
                .iter()
                .map(|e| {
                    let from_tool = chain
                        .nodes
                        .iter()
                        .find(|n| n.execution_id == e.from_execution_id)
                        .map(|n| n.tool_name.clone())
                        .unwrap_or_else(|| e.from_execution_id.clone());
                    let to_tool = chain
                        .nodes
                        .iter()
                        .find(|n| n.execution_id == e.to_execution_id)
                        .map(|n| n.tool_name.clone())
                        .unwrap_or_else(|| e.to_execution_id.clone());
                    format!("{} --{}--> {}", from_tool, e.relation.label(), to_tool)
                })
                .collect();

            Line::from(Span::styled(
                edges.join(" | "),
                Style::default().fg(Color::Gray),
            ))
        } else {
            Line::from("")
        }
    }
}

impl Widget for ToolCallChainWidget {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title(self.title.as_str())
            .borders(Borders::ALL);

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 4 {
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Length(1),
                Constraint::Min(0),
            ])
            .split(inner);

        // 统计行
        Paragraph::new(self.stats_line()).render(chunks[0], buf);

        // 边关系行
        Paragraph::new(self.edges_line()).render(chunks[1], buf);

        // 节点列表
        let items = self.node_items();
        List::new(items)
            .block(Block::default())
            .render(chunks[2], buf);
    }
}

// ============================================================================
// TentacleSnapshotWidget
// ============================================================================

/// Tentacle 综合快照组件
pub struct TentacleSnapshotWidget {
    state: TentacleState,
    title: String,
}

impl TentacleSnapshotWidget {
    /// 创建新的综合快照组件
    pub fn new(state: TentacleState) -> Self {
        Self {
            state,
            title: "Tentacle Snapshot".to_string(),
        }
    }

    /// 设置标题
    pub fn with_title(mut self, title: &str) -> Self {
        self.title = title.to_string();
        self
    }

    /// 顶部信息行
    fn header_line(&self) -> Line<'static> {
        Line::from(vec![
            Span::styled(
                format!("Tentacle v{} ", self.state.version),
                Style::default()
                    .fg(hex_to_color("#9C27B0"))
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("({}) ", self.state.instance_id),
                Style::default().fg(Color::Gray),
            ),
            Span::styled(
                format!("Active: {} ", self.state.active_count()),
                Style::default().fg(hex_to_color("#2196F3")),
            ),
            Span::styled(
                format!("Plugins: {} ", self.state.enabled_plugin_count()),
                Style::default().fg(hex_to_color("#4CAF50")),
            ),
            Span::styled(
                format!(
                    "Success Rate: {:.1}%",
                    self.state.metrics.success_rate() * 100.0
                ),
                Style::default().fg(Color::Cyan),
            ),
        ])
    }
}

impl Widget for TentacleSnapshotWidget {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title(self.title.as_str())
            .borders(Borders::ALL);

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 10 {
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Length(3),
                Constraint::Min(0),
            ])
            .split(inner);

        // 顶部信息行
        Paragraph::new(self.header_line()).render(chunks[0], buf);

        // 中间：工具调用链
        let chain_widget = ToolCallChainWidget::new(self.state.call_chain.clone())
            .with_title("Call Chain");
        chain_widget.render(chunks[1], buf);

        // 底部：左右分栏
        let bottom_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(chunks[2]);

        // 左下：工具执行列表
        let exec_widget =
            ToolExecutionWidget::new(self.state.active_executions.clone()).with_title("Active Executions");
        exec_widget.render(bottom_chunks[0], buf);

        // 右下：插件审计列表
        let audit_widget = PluginAuditWidget::new(
            self.state.audit_entries.clone(),
            self.state.plugins.clone(),
        )
        .with_title("Plugin Audit");
        audit_widget.render(bottom_chunks[1], buf);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use cellrix_protocol::tentacle::{
        PluginAuditAction, PluginInfo, PluginStatus, ToolCallChain, ToolCallEdge,
        ToolCallNode, ToolCallRelation, ToolExecution, ToolExecutionStatus, TentacleState,
    };

    fn create_test_execution() -> ToolExecution {
        let mut exec = ToolExecution::new("test_tool");
        exec.start();
        exec
    }

    fn create_test_plugin() -> PluginInfo {
        let mut plugin = PluginInfo::new("plugin-001", "Test Plugin", "1.0.0");
        plugin.enable();
        plugin
    }

    fn create_test_audit_entry() -> PluginAuditEntry {
        PluginAuditEntry::new("plugin-001", PluginAuditAction::Execute, "user")
    }

    fn create_test_chain() -> ToolCallChain {
        let mut chain = ToolCallChain::new("test-chain");
        let mut node1 = ToolCallNode::new("exec-1", "tool_a");
        node1.status = ToolExecutionStatus::Completed;
        node1.duration_ms = Some(1000);
        let node2 = ToolCallNode::new("exec-2", "tool_b");
        chain.add_node(node1);
        chain.add_node(node2);
        chain.add_edge(ToolCallEdge::new(
            "exec-1",
            "exec-2",
            ToolCallRelation::DependsOn,
        ));
        chain
    }

    #[test]
    fn test_tool_execution_widget_creation() {
        let executions = vec![create_test_execution()];
        let widget = ToolExecutionWidget::new(executions);
        assert_eq!(widget.title, "Tool Executions");
        assert_eq!(widget.executions.len(), 1);
    }

    #[test]
    fn test_tool_execution_widget_with_title() {
        let widget = ToolExecutionWidget::new(vec![]).with_title("Custom Title");
        assert_eq!(widget.title, "Custom Title");
    }

    #[test]
    fn test_tool_execution_widget_stats_line() {
        let mut exec1 = ToolExecution::new("tool_a");
        exec1.start();
        let mut exec2 = ToolExecution::new("tool_b");
        exec2.start();
        exec2.complete("done");
        let executions = vec![exec1, exec2];
        let widget = ToolExecutionWidget::new(executions);
        let line = widget.stats_line();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_tool_execution_widget_execution_items() {
        let executions = vec![create_test_execution()];
        let widget = ToolExecutionWidget::new(executions);
        let items = widget.execution_items();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn test_plugin_audit_widget_creation() {
        let entries = vec![create_test_audit_entry()];
        let plugins = vec![create_test_plugin()];
        let widget = PluginAuditWidget::new(entries, plugins);
        assert_eq!(widget.title, "Plugin Audit");
        assert_eq!(widget.entries.len(), 1);
        assert_eq!(widget.plugins.len(), 1);
    }

    #[test]
    fn test_plugin_audit_widget_stats_line() {
        let plugins = vec![create_test_plugin()];
        let widget = PluginAuditWidget::new(vec![], plugins);
        let line = widget.plugin_stats_line();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_plugin_audit_widget_audit_items() {
        let entries = vec![create_test_audit_entry()];
        let plugins = vec![create_test_plugin()];
        let widget = PluginAuditWidget::new(entries, plugins);
        let items = widget.audit_items();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn test_tool_call_chain_widget_creation() {
        let chain = create_test_chain();
        let widget = ToolCallChainWidget::new(Some(chain));
        assert_eq!(widget.title, "Tool Call Chain");
        assert!(widget.chain.is_some());
    }

    #[test]
    fn test_tool_call_chain_widget_none() {
        let widget = ToolCallChainWidget::new(None);
        assert!(widget.chain.is_none());
        let line = widget.stats_line();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_tool_call_chain_widget_stats_line() {
        let chain = create_test_chain();
        let widget = ToolCallChainWidget::new(Some(chain));
        let line = widget.stats_line();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_tool_call_chain_widget_node_items() {
        let chain = create_test_chain();
        let widget = ToolCallChainWidget::new(Some(chain));
        let items = widget.node_items();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn test_tentacle_snapshot_widget_creation() {
        let state = TentacleState::new("1.0.0", "tentacle-01");
        let widget = TentacleSnapshotWidget::new(state);
        assert_eq!(widget.title, "Tentacle Snapshot");
    }

    #[test]
    fn test_tentacle_snapshot_widget_header_line() {
        let state = TentacleState::new("1.0.0", "tentacle-01");
        let widget = TentacleSnapshotWidget::new(state);
        let line = widget.header_line();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_hex_to_color() {
        let color = hex_to_color("#FF0000");
        assert_eq!(color, Color::Rgb(255, 0, 0));

        let color = hex_to_color("#00FF00");
        assert_eq!(color, Color::Rgb(0, 255, 0));

        let color = hex_to_color("invalid");
        assert_eq!(color, Color::Gray);
    }

    #[test]
    fn test_build_progress_bar() {
        let bar = build_progress_bar(0.5, 10);
        assert_eq!(bar.chars().count(), 10);
        assert!(bar.contains('█'));
        assert!(bar.contains('░'));

        let bar = build_progress_bar(1.0, 10);
        assert_eq!(bar.chars().count(), 10);
        assert!(bar.chars().all(|c| c == '█'));

        let bar = build_progress_bar(0.0, 10);
        assert_eq!(bar.chars().count(), 10);
        assert!(bar.chars().all(|c| c == '░'));
    }
}
