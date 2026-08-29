//! Anaphase UI 展示组件 — 任务 DAG + HITL + 生命周期 + 综合快照
//!
//! # Design Principle
//!
//! **白盒可观测**: 将 Anaphase 的"编排过程"（任务 DAG + HITL + 生命周期）
//! 以可视化方式展示给用户。
//!
//! **极致解耦**: UI 组件只依赖 cellrix-protocol 的数据结构，不依赖 Anaphase crate。
//!
//! # Components
//!
//! - `CognitivePhaseIndicator`: 认知阶段指示器（7 状态 DAG）
//! - `TaskDagWidget`: 任务 DAG 可视化（节点列表 + 状态颜色 + 进度条）
//! - `HITLWidget`: HITL 状态展示（待确认请求 + 统计 + 风险等级）
//! - `LifecycleWidget`: 生命周期状态展示（阶段 + 运行时间 + 心跳 + 错误）
//! - `AnaphaseSnapshotWidget`: 综合快照组件（组合以上四个）

use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Widget},
};

use cellrix_protocol::anaphase::{
    AnaphaseState, CognitivePhase, HITLRequest, HITLStatus, LifecycleStatus, RiskLevel,
    TaskDagSnapshot, TaskNode, TaskStatus,
};

/// 将 hex 颜色转换为 ratatui Color
fn hex_to_color(hex: &str) -> Color {
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
    Color::Rgb(r, g, b)
}

// ============================================================================
// Cognitive Phase Indicator (认知阶段指示器)
// ============================================================================

/// 认知阶段指示器
#[derive(Debug, Clone)]
pub struct CognitivePhaseIndicator<'a> {
    current_phase: &'a CognitivePhase,
}

impl<'a> CognitivePhaseIndicator<'a> {
    /// 创建新的认知阶段指示器
    pub fn new(current_phase: &'a CognitivePhase) -> Self {
        Self { current_phase }
    }
}

impl<'a> Widget for CognitivePhaseIndicator<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let phases = [
            CognitivePhase::Perception,
            CognitivePhase::PreAssessment,
            CognitivePhase::MemoryRetrieval,
            CognitivePhase::Reasoning,
            CognitivePhase::ReflexCheck,
            CognitivePhase::Execution,
            CognitivePhase::Reflection,
        ];

        let spans: Vec<Span> = phases
            .iter()
            .enumerate()
            .flat_map(|(i, phase)| {
                let is_current = *phase == *self.current_phase;
                let is_past = phase.order() < self.current_phase.order();
                let color = if is_current {
                    hex_to_color(phase.color())
                } else if is_past {
                    Color::DarkGray
                } else {
                    Color::Gray
                };
                let mut spans = vec![Span::styled(
                    phase.short_label(),
                    Style::default().fg(color).add_modifier(if is_current {
                        Modifier::BOLD
                    } else {
                        Modifier::empty()
                    }),
                )];
                if i < phases.len() - 1 {
                    spans.push(Span::styled(
                        " → ",
                        Style::default().fg(Color::DarkGray),
                    ));
                }
                spans
            })
            .collect();

        Paragraph::new(Line::from(spans))
            .block(
                Block::default()
                    .title("认知阶段 (Cognitive Phase)")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Cyan)),
            )
            .render(area, buf);
    }
}

// ============================================================================
// Task DAG Widget (任务 DAG 可视化)
// ============================================================================

/// 任务 DAG 可视化组件
#[derive(Debug, Clone)]
pub struct TaskDagWidget<'a> {
    dag: &'a TaskDagSnapshot,
}

impl<'a> TaskDagWidget<'a> {
    /// 创建新的任务 DAG 组件
    pub fn new(dag: &'a TaskDagSnapshot) -> Self {
        Self { dag }
    }

    /// 构建统计行
    fn build_stats_line(&self) -> Line<'a> {
        Line::from(vec![
            Span::styled("节点: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.dag.node_count()),
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled("执行中: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.dag.running_count()),
                Style::default().fg(hex_to_color(TaskStatus::Running.color())),
            ),
            Span::raw("  "),
            Span::styled("已完成: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.dag.completed_count()),
                Style::default().fg(hex_to_color(TaskStatus::Completed.color())),
            ),
            Span::raw("  "),
            Span::styled("失败: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.dag.failed_count()),
                Style::default().fg(hex_to_color(TaskStatus::Failed.color())),
            ),
            Span::raw("  "),
            Span::styled("等待HITL: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.dag.waiting_hitl_count()),
                Style::default().fg(hex_to_color(TaskStatus::WaitingHITL.color())),
            ),
            Span::raw("  "),
            Span::styled("进度: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{:.0}%", self.dag.overall_progress() * 100.0),
                Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
            ),
        ])
    }

    /// 构建节点列表项
    fn build_node_items(&self) -> Vec<ListItem<'a>> {
        self.dag
            .nodes
            .iter()
            .map(|node| {
                let status_color = hex_to_color(node.status.color());
                let kind_color = hex_to_color(node.kind.color());
                let progress_bar = build_progress_bar(node.progress, 15);

                ListItem::new(Line::from(vec![
                    Span::styled(
                        format!("[{}] ", node.status.short_label()),
                        Style::default().fg(status_color),
                    ),
                    Span::styled(
                        format!("<{}> ", node.kind.short_label()),
                        Style::default().fg(kind_color),
                    ),
                    Span::styled(
                        format!("{} ", node.intent_preview(30)),
                        Style::default().fg(Color::White),
                    ),
                    Span::styled(progress_bar, Style::default().fg(status_color)),
                    Span::styled(
                        format!(" {:.0}%", node.progress * 100.0),
                        Style::default().fg(status_color),
                    ),
                    if let Some(ref err) = node.error {
                        Span::styled(
                            format!(" ❌ {}", err),
                            Style::default().fg(Color::Red),
                        )
                    } else {
                        Span::raw("")
                    },
                ]))
            })
            .collect()
    }
}

impl<'a> Widget for TaskDagWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title("📋 任务 DAG (Task DAG)")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Cyan));

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 4 {
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(2), Constraint::Min(3)])
            .split(inner);

        // 统计行
        Paragraph::new(self.build_stats_line()).render(chunks[0], buf);

        // 节点列表
        if self.dag.nodes.is_empty() {
            Paragraph::new("无任务节点")
                .style(Style::default().fg(Color::DarkGray))
                .render(chunks[1], buf);
        } else {
            List::new(self.build_node_items())
                .block(Block::default().borders(Borders::TOP).border_style(
                    Style::default().fg(Color::DarkGray),
                ))
                .render(chunks[1], buf);
        }
    }
}

// ============================================================================
// HITL Widget (HITL 状态展示)
// ============================================================================

/// HITL 状态展示组件
#[derive(Debug, Clone)]
pub struct HITLWidget<'a> {
    hitl: &'a HITLStatus,
}

impl<'a> HITLWidget<'a> {
    /// 创建新的 HITL 组件
    pub fn new(hitl: &'a HITLStatus) -> Self {
        Self { hitl }
    }

    /// 构建统计行
    fn build_stats_line(&self) -> Line<'a> {
        Line::from(vec![
            Span::styled("待确认: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.hitl.pending_count),
                Style::default()
                    .fg(if self.hitl.pending_count > 0 {
                        Color::Yellow
                    } else {
                        Color::DarkGray
                    })
                    .add_modifier(if self.hitl.pending_count > 0 {
                        Modifier::BOLD
                    } else {
                        Modifier::empty()
                    }),
            ),
            Span::raw("  "),
            Span::styled("已批准: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.hitl.approved_count),
                Style::default().fg(Color::Green),
            ),
            Span::raw("  "),
            Span::styled("已拒绝: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.hitl.rejected_count),
                Style::default().fg(Color::Red),
            ),
            Span::raw("  "),
            Span::styled("超时: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.hitl.timed_out_count),
                Style::default().fg(Color::DarkGray),
            ),
            Span::raw("  "),
            Span::styled("批准率: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{:.0}%", self.hitl.approval_rate() * 100.0),
                Style::default().fg(Color::Cyan),
            ),
            Span::raw("  "),
            Span::styled(
                if self.hitl.channel_available {
                    "[通道可用]"
                } else {
                    "[通道不可用]"
                },
                Style::default().fg(if self.hitl.channel_available {
                    Color::Green
                } else {
                    Color::Red
                }),
            ),
            Span::styled(
                if self.hitl.fail_closed {
                    " [fail-closed]"
                } else {
                    " [fail-open]"
                },
                Style::default().fg(Color::DarkGray),
            ),
        ])
    }

    /// 构建待确认请求列表项
    fn build_pending_items(&self) -> Vec<ListItem<'a>> {
        self.hitl
            .pending_requests
            .iter()
            .map(|req| {
                let risk_color = hex_to_color(req.risk_level.color());
                ListItem::new(Line::from(vec![
                    Span::styled(
                        format!("[{}] ", req.risk_level.short_label()),
                        Style::default().fg(risk_color).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{} ", req.command_preview(40)),
                        Style::default().fg(Color::White),
                    ),
                    Span::styled(
                        format!("原因: {}", req.risk_reason),
                        Style::default().fg(Color::DarkGray),
                    ),
                ]))
            })
            .collect()
    }
}

impl<'a> Widget for HITLWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title("🛡️ HITL 人在回路 (Human-in-the-Loop)")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Yellow));

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 4 {
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(2), Constraint::Min(3)])
            .split(inner);

        // 统计行
        Paragraph::new(self.build_stats_line()).render(chunks[0], buf);

        // 待确认请求列表
        let pending_block = Block::default()
            .title("待确认请求 (Pending Requests)")
            .borders(Borders::TOP)
            .border_style(Style::default().fg(Color::DarkGray));
        let pending_inner = pending_block.inner(chunks[1]);
        pending_block.render(chunks[1], buf);

        if self.hitl.pending_requests.is_empty() {
            Paragraph::new("✓ 无待确认请求")
                .style(Style::default().fg(Color::Green))
                .render(pending_inner, buf);
        } else {
            List::new(self.build_pending_items())
                .block(Block::default())
                .render(pending_inner, buf);
        }
    }
}

// ============================================================================
// Lifecycle Widget (生命周期状态展示)
// ============================================================================

/// 生命周期状态展示组件
#[derive(Debug, Clone)]
pub struct LifecycleWidget<'a> {
    lifecycle: &'a LifecycleStatus,
}

impl<'a> LifecycleWidget<'a> {
    /// 创建新的生命周期组件
    pub fn new(lifecycle: &'a LifecycleStatus) -> Self {
        Self { lifecycle }
    }

    /// 构建信息行
    fn build_info_lines(&self) -> Vec<Line<'a>> {
        let phase_color = hex_to_color(self.lifecycle.phase.color());

        vec![
            Line::from(vec![
                Span::styled("阶段: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    self.lifecycle.phase.label(),
                    Style::default().fg(phase_color).add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled("版本: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    &self.lifecycle.version,
                    Style::default().fg(Color::White),
                ),
                Span::raw("  "),
                Span::styled("实例: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    &self.lifecycle.instance_id,
                    Style::default().fg(Color::Cyan),
                ),
            ]),
            Line::from(vec![
                Span::styled("运行时间: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    self.lifecycle.formatted_uptime(),
                    Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled("心跳间隔: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{}s", self.lifecycle.heartbeat_interval_seconds),
                    Style::default().fg(Color::White),
                ),
                Span::raw("  "),
                Span::styled("错误数: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{}", self.lifecycle.error_count),
                    Style::default().fg(if self.lifecycle.error_count > 0 {
                        Color::Red
                    } else {
                        Color::Green
                    }),
                ),
            ]),
            Line::from(vec![
                Span::styled("启动时间: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    &self.lifecycle.started_at,
                    Style::default().fg(Color::DarkGray),
                ),
                Span::raw("  "),
                Span::styled("最近心跳: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    &self.lifecycle.last_heartbeat_at,
                    Style::default().fg(Color::DarkGray),
                ),
            ]),
            if let Some(ref err) = self.lifecycle.last_error {
                Line::from(vec![
                    Span::styled("最近错误: ", Style::default().fg(Color::Gray)),
                    Span::styled(err, Style::default().fg(Color::Red)),
                ])
            } else {
                Line::from(vec![Span::styled(
                    "最近错误: 无",
                    Style::default().fg(Color::Green),
                )])
            },
        ]
    }
}

impl<'a> Widget for LifecycleWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title("⚙️ 生命周期 (Lifecycle)")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Green));

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 4 {
            return;
        }

        Paragraph::new(self.build_info_lines()).render(inner, buf);
    }
}

// ============================================================================
// Anaphase Snapshot Widget (综合快照)
// ============================================================================

/// Anaphase 综合快照组件
#[derive(Debug, Clone)]
pub struct AnaphaseSnapshotWidget<'a> {
    state: &'a AnaphaseState,
}

impl<'a> AnaphaseSnapshotWidget<'a> {
    /// 创建新的综合快照组件
    pub fn new(state: &'a AnaphaseState) -> Self {
        Self { state }
    }
}

impl<'a> Widget for AnaphaseSnapshotWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title("🌿 Anaphase 综合快照 (Anaphase Snapshot)")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Cyan));

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 10 {
            Paragraph::new("空间不足，无法显示完整快照")
                .style(Style::default().fg(Color::DarkGray))
                .render(inner, buf);
            return;
        }

        // 顶部：认知阶段指示器
        // 中间：左右分栏（任务 DAG + HITL）
        // 底部：生命周期
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3), // 认知阶段
                Constraint::Min(8),    // 任务 DAG + HITL
                Constraint::Length(6), // 生命周期
            ])
            .split(inner);

        // 认知阶段指示器
        CognitivePhaseIndicator::new(&self.state.current_phase).render(chunks[0], buf);

        // 中间：左右分栏
        let middle = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
            .split(chunks[1]);

        TaskDagWidget::new(&self.state.task_dag).render(middle[0], buf);
        HITLWidget::new(&self.state.hitl).render(middle[1], buf);

        // 生命周期
        LifecycleWidget::new(&self.state.lifecycle).render(chunks[2], buf);
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// 构建进度条
fn build_progress_bar(progress: f64, width: usize) -> String {
    let filled = (progress * width as f64) as usize;
    let filled = filled.min(width);
    let empty = width - filled;
    format!("{}{}", "█".repeat(filled), "░".repeat(empty))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use cellrix_protocol::anaphase::{
        HITLRequestStatus, LifecyclePhase, TaskNodeKind,
    };

    fn create_test_state() -> AnaphaseState {
        let mut state = AnaphaseState::new("1.0.0", "test-instance");
        state.current_phase = CognitivePhase::Reasoning;

        // 添加测试任务
        let mut task1 = TaskNode::new("t1", "branch1", "调研任务", TaskNodeKind::TaskRoot);
        task1.status = TaskStatus::Completed;
        task1.progress = 1.0;

        let mut task2 = TaskNode::new("t2", "branch1", "执行任务", TaskNodeKind::SubTask);
        task2.status = TaskStatus::Running;
        task2.progress = 0.5;

        let task3 = TaskNode::new("t3", "branch1", "等待确认", TaskNodeKind::SubTask);
        let mut task3 = task3;
        task3.status = TaskStatus::WaitingHITL;

        state.task_dag.nodes.push(task1);
        state.task_dag.nodes.push(task2);
        state.task_dag.nodes.push(task3);
        state.task_dag.edges.push(cellrix_protocol::anaphase::TaskEdge::new(
            "t1", "t2", "contains",
        ));

        // 添加 HITL 请求
        let req = HITLRequest::new("r1", "rm -rf /tmp/test", RiskLevel::High, "删除操作");
        state.hitl.pending_requests.push(req);
        state.hitl.pending_count = 1;
        state.hitl.approved_count = 10;
        state.hitl.rejected_count = 2;

        // 设置生命周期
        state.lifecycle.phase = LifecyclePhase::Running;
        state.lifecycle.uptime_seconds = 3661;

        state
    }

    #[test]
    fn test_cognitive_phase_indicator_creation() {
        let phase = CognitivePhase::Reasoning;
        let widget = CognitivePhaseIndicator::new(&phase);
        // 只是测试创建，不测试渲染
        assert_eq!(*widget.current_phase, CognitivePhase::Reasoning);
    }

    #[test]
    fn test_task_dag_widget_creation() {
        let state = create_test_state();
        let widget = TaskDagWidget::new(&state.task_dag);
        assert_eq!(widget.dag.node_count(), 3);
        assert_eq!(widget.dag.running_count(), 1);
        assert_eq!(widget.dag.completed_count(), 1);
        assert_eq!(widget.dag.waiting_hitl_count(), 1);
    }

    #[test]
    fn test_task_dag_widget_stats_line() {
        let state = create_test_state();
        let widget = TaskDagWidget::new(&state.task_dag);
        let line = widget.build_stats_line();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_task_dag_widget_node_items() {
        let state = create_test_state();
        let widget = TaskDagWidget::new(&state.task_dag);
        let items = widget.build_node_items();
        assert_eq!(items.len(), 3);
    }

    #[test]
    fn test_hitl_widget_creation() {
        let state = create_test_state();
        let widget = HITLWidget::new(&state.hitl);
        assert_eq!(widget.hitl.pending_count, 1);
        assert_eq!(widget.hitl.approved_count, 10);
        assert_eq!(widget.hitl.rejected_count, 2);
        assert!(widget.hitl.has_pending());
    }

    #[test]
    fn test_hitl_widget_stats_line() {
        let state = create_test_state();
        let widget = HITLWidget::new(&state.hitl);
        let line = widget.build_stats_line();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_hitl_widget_pending_items() {
        let state = create_test_state();
        let widget = HITLWidget::new(&state.hitl);
        let items = widget.build_pending_items();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn test_lifecycle_widget_creation() {
        let state = create_test_state();
        let widget = LifecycleWidget::new(&state.lifecycle);
        assert_eq!(widget.lifecycle.phase, LifecyclePhase::Running);
        assert_eq!(widget.lifecycle.uptime_seconds, 3661);
        assert_eq!(widget.lifecycle.version, "1.0.0");
    }

    #[test]
    fn test_lifecycle_widget_info_lines() {
        let state = create_test_state();
        let widget = LifecycleWidget::new(&state.lifecycle);
        let lines = widget.build_info_lines();
        assert_eq!(lines.len(), 4);
    }

    #[test]
    fn test_anaphase_snapshot_widget_creation() {
        let state = create_test_state();
        let widget = AnaphaseSnapshotWidget::new(&state);
        assert_eq!(widget.state.current_phase, CognitivePhase::Reasoning);
        assert_eq!(widget.state.task_dag.node_count(), 3);
        assert_eq!(widget.state.hitl.pending_count, 1);
        assert_eq!(widget.state.lifecycle.phase, LifecyclePhase::Running);
    }

    #[test]
    fn test_build_progress_bar() {
        assert_eq!(build_progress_bar(0.0, 10), "░░░░░░░░░░");
        assert_eq!(build_progress_bar(1.0, 10), "██████████");
        assert_eq!(build_progress_bar(0.5, 10), "█████░░░░░");
        assert_eq!(build_progress_bar(1.5, 10), "██████████"); // 超过1.0截断
    }

    #[test]
    fn test_hex_to_color() {
        let color = hex_to_color("#FF0000");
        assert_eq!(color, Color::Rgb(255, 0, 0));

        let color = hex_to_color("#00FF00");
        assert_eq!(color, Color::Rgb(0, 255, 0));

        let color = hex_to_color("#0000FF");
        assert_eq!(color, Color::Rgb(0, 0, 255));
    }
}
