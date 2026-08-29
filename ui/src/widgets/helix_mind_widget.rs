//! Helix-Mind UI 展示组件 — 认知工艺状态 + 记忆代谢状态 + 知识图谱
//!
//! # Design Principle
//!
//! **白盒可观测**: 将 Helix-Mind 的"思考过程"（认知工艺）和"记忆代谢"
//! 以可视化方式展示给用户，让 AI 的内部状态可观测、可理解。
//!
//! **极致解耦**: UI 组件只依赖 cellrix-protocol 的数据结构，不依赖 Helix-Mind crate。
//!
//! # Components
//!
//! - `CognitiveStatusWidget`: 认知工艺状态展示（模式/僵局/工序/建议动作/激活向量）
//! - `MetabolismStatusWidget`: 记忆代谢状态展示（相态/浓度/张力/热度/代数）
//! - `KnowledgeGraphWidget`: 知识图谱展示（节点列表/边列表/高热度节点）
//! - `HelixSnapshotWidget`: 综合快照组件（组合以上三个）

use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, List, ListItem, Paragraph, Widget, Wrap},
};

use cellrix_protocol::helix_mind::{
    ActivationEntry, CognitiveMode, CognitiveStatus, HelixSnapshot, KnowledgeGraph,
    KnowledgeNode, MetabolismStatus, PhaseState, SuggestedAction,
};

/// 将 hex 颜色字符串转换为 ratatui Color
fn hex_to_color(hex: &str) -> Color {
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
    Color::Rgb(r, g, b)
}

// ============================================================================
// Cognitive Status Widget (认知工艺状态)
// ============================================================================

/// 认知工艺状态展示组件
#[derive(Debug, Clone)]
pub struct CognitiveStatusWidget<'a> {
    status: &'a CognitiveStatus,
}

impl<'a> CognitiveStatusWidget<'a> {
    /// 创建新的认知状态组件
    pub fn new(status: &'a CognitiveStatus) -> Self {
        Self { status }
    }

    /// 构建头部信息行
    fn build_header_lines(&self) -> Vec<Line<'a>> {
        let mode_color = hex_to_color(self.status.effective_mode.color());
        let impasse_color = hex_to_color(self.status.impasse_color());

        vec![
            Line::from(vec![
                Span::styled("模式: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    self.status.effective_mode.label(),
                    Style::default().fg(mode_color).add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled("僵局: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    self.status.impasse_label(),
                    Style::default().fg(impasse_color),
                ),
            ]),
            Line::from(vec![
                Span::styled("工序: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{} 次", self.status.stages_attempted),
                    Style::default().fg(Color::White),
                ),
                Span::raw("  "),
                Span::styled("Token: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{}", self.status.tokens_consumed),
                    Style::default().fg(Color::White),
                ),
                Span::raw("  "),
                Span::styled("延迟: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{}ms", self.status.latency_ms),
                    Style::default().fg(Color::White),
                ),
            ]),
            Line::from(vec![
                Span::styled("追踪: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    &self.status.trace_id[..std::cmp::min(16, self.status.trace_id.len())],
                    Style::default().fg(Color::DarkGray),
                ),
                if self.status.is_partial {
                    Span::styled(" [部分结果]", Style::default().fg(Color::Yellow))
                } else {
                    Span::raw("")
                },
            ]),
        ]
    }

    /// 构建建议动作列表
    fn build_suggested_actions(&self) -> Vec<ListItem<'a>> {
        self.status
            .suggested_actions
            .iter()
            .enumerate()
            .map(|(i, action)| {
                let content = format!(
                    "{}. [{}] {} — {}",
                    i + 1,
                    action.action_type,
                    action.reason,
                    if action.parameters.len() > 40 {
                        format!("{}...", &action.parameters[..40])
                    } else {
                        action.parameters.clone()
                    }
                );
                ListItem::new(Line::from(Span::styled(
                    content,
                    Style::default().fg(Color::Cyan),
                )))
            })
            .collect()
    }

    /// 构建激活向量列表
    fn build_activation_vector(&self) -> Vec<ListItem<'a>> {
        self.status
            .activation_vector
            .iter()
            .take(10)
            .map(|entry| {
                let bar_len = (entry.activation * 20.0) as usize;
                let bar = "█".repeat(bar_len) + &"░".repeat(20 - bar_len);
                let color = if entry.activation > 0.7 {
                    Color::Red
                } else if entry.activation > 0.4 {
                    Color::Yellow
                } else {
                    Color::Green
                };
                ListItem::new(Line::from(vec![
                    Span::styled(
                        format!("{:.2} ", entry.activation),
                        Style::default().fg(color),
                    ),
                    Span::styled(bar, Style::default().fg(color)),
                    Span::styled(
                        format!(" {}", &entry.node_id[..std::cmp::min(12, entry.node_id.len())]),
                        Style::default().fg(Color::DarkGray),
                    ),
                ]))
            })
            .collect()
    }
}

impl<'a> Widget for CognitiveStatusWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title("🧠 认知工艺状态 (Cognitive Status)")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Cyan));

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 5 {
            return;
        }

        // 分割布局：头部 + 建议动作 + 激活向量
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(4),
                Constraint::Min(3),
                Constraint::Min(3),
            ])
            .split(inner);

        // 头部信息
        let header = Paragraph::new(self.build_header_lines())
            .block(Block::default().borders(Borders::NONE));
        header.render(chunks[0], buf);

        // 建议动作
        let actions_block = Block::default()
            .title("建议动作 (Suggested Actions)")
            .borders(Borders::TOP)
            .border_style(Style::default().fg(Color::DarkGray));
        let actions_inner = actions_block.inner(chunks[1]);
        actions_block.render(chunks[1], buf);

        if self.status.suggested_actions.is_empty() {
            Paragraph::new("无建议动作")
                .style(Style::default().fg(Color::DarkGray))
                .render(actions_inner, buf);
        } else {
            List::new(self.build_suggested_actions())
                .block(Block::default())
                .render(actions_inner, buf);
        }

        // 激活向量
        let activation_block = Block::default()
            .title("激活向量 (Activation Vector)")
            .borders(Borders::TOP)
            .border_style(Style::default().fg(Color::DarkGray));
        let activation_inner = activation_block.inner(chunks[2]);
        activation_block.render(chunks[2], buf);

        if self.status.activation_vector.is_empty() {
            Paragraph::new("无激活向量")
                .style(Style::default().fg(Color::DarkGray))
                .render(activation_inner, buf);
        } else {
            List::new(self.build_activation_vector())
                .block(Block::default())
                .render(activation_inner, buf);
        }
    }
}

// ============================================================================
// Metabolism Status Widget (记忆代谢状态)
// ============================================================================

/// 记忆代谢状态展示组件
#[derive(Debug, Clone)]
pub struct MetabolismStatusWidget<'a> {
    status: &'a MetabolismStatus,
}

impl<'a> MetabolismStatusWidget<'a> {
    /// 创建新的代谢状态组件
    pub fn new(status: &'a MetabolismStatus) -> Self {
        Self { status }
    }

    /// 构建相态指示器
    fn build_phase_indicator(&self) -> Line<'a> {
        let phases = [PhaseState::Gas, PhaseState::Liquid, PhaseState::Crystal];
        let spans: Vec<Span> = phases
            .iter()
            .map(|phase| {
                let is_active = *phase == self.status.phase_state;
                let color = hex_to_color(phase.color());
                let label = match phase {
                    PhaseState::Gas => "气态",
                    PhaseState::Liquid => "液态",
                    PhaseState::Crystal => "晶态",
                };
                if is_active {
                    Span::styled(
                        format!("● {} ", label),
                        Style::default().fg(color).add_modifier(Modifier::BOLD),
                    )
                } else {
                    Span::styled(
                        format!("○ {} ", label),
                        Style::default().fg(Color::DarkGray),
                    )
                }
            })
            .collect();
        Line::from(spans)
    }

    /// 构建热度进度条
    fn build_heat_bar(&self) -> Line<'a> {
        let bar_len = (self.status.heat * 30.0) as usize;
        let bar = "█".repeat(bar_len) + &"░".repeat(30 - bar_len);
        let color = hex_to_color(self.status.heat_color());
        Line::from(vec![
            Span::styled("热度: ", Style::default().fg(Color::Gray)),
            Span::styled(bar, Style::default().fg(color)),
            Span::styled(
                format!(" {:.0}%", self.status.heat * 100.0),
                Style::default().fg(color),
            ),
        ])
    }

    /// 构建张力进度条
    fn build_tension_bar(&self) -> Line<'a> {
        let bar_len = (self.status.tension * 30.0) as usize;
        let bar = "█".repeat(bar_len) + &"░".repeat(30 - bar_len);
        let color = hex_to_color(self.status.tension_color());
        Line::from(vec![
            Span::styled("张力: ", Style::default().fg(Color::Gray)),
            Span::styled(bar, Style::default().fg(color)),
            Span::styled(
                format!(" {:.0}%", self.status.tension * 100.0),
                Style::default().fg(color),
            ),
        ])
    }

    /// 构建元数据行
    fn build_metadata_lines(&self) -> Vec<Line<'a>> {
        vec![
            Line::from(vec![
                Span::styled("浓度: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    self.status.concentration.label(),
                    Style::default().fg(Color::White),
                ),
                Span::raw("  "),
                Span::styled("代数: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("第 {} 代", self.status.generation),
                    Style::default().fg(Color::White),
                ),
                Span::raw("  "),
                Span::styled("访问: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{} 次", self.status.access_count),
                    Style::default().fg(Color::White),
                ),
            ]),
            Line::from(vec![
                Span::styled("敏感度: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    &self.status.sensitivity,
                    Style::default().fg(Color::White),
                ),
                Span::raw("  "),
                Span::styled("主体依赖: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    &self.status.subject_dependency,
                    Style::default().fg(Color::White),
                ),
                if self.status.is_hypothetical {
                    Span::styled(" [假设性]", Style::default().fg(Color::Yellow))
                } else {
                    Span::raw("")
                },
                if self.status.is_recessive {
                    Span::styled(" [隐性]", Style::default().fg(Color::DarkGray))
                } else {
                    Span::raw("")
                },
            ]),
        ]
    }
}

impl<'a> Widget for MetabolismStatusWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title("🧬 记忆代谢状态 (Metabolism Status)")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Magenta));

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 6 {
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2), // 相态指示器
                Constraint::Length(2), // 热度条
                Constraint::Length(2), // 张力条
                Constraint::Min(2),    // 元数据
            ])
            .split(inner);

        // 相态指示器
        Paragraph::new(vec![
            Line::from(Span::styled(
                "相态 (Phase State):",
                Style::default().fg(Color::Gray),
            )),
            self.build_phase_indicator(),
        ])
        .render(chunks[0], buf);

        // 热度条
        Paragraph::new(self.build_heat_bar()).render(chunks[1], buf);

        // 张力条
        Paragraph::new(self.build_tension_bar()).render(chunks[2], buf);

        // 元数据
        Paragraph::new(self.build_metadata_lines()).render(chunks[3], buf);
    }
}

// ============================================================================
// Knowledge Graph Widget (知识图谱)
// ============================================================================

/// 知识图谱展示组件
#[derive(Debug, Clone)]
pub struct KnowledgeGraphWidget<'a> {
    graph: &'a KnowledgeGraph,
}

impl<'a> KnowledgeGraphWidget<'a> {
    /// 创建新的知识图谱组件
    pub fn new(graph: &'a KnowledgeGraph) -> Self {
        Self { graph }
    }

    /// 构建统计行
    fn build_stats_line(&self) -> Line<'a> {
        let hot_count = self.graph.hot_nodes().len();
        Line::from(vec![
            Span::styled("节点: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.graph.node_count()),
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled("边: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", self.graph.edge_count()),
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled("高热度: ", Style::default().fg(Color::Gray)),
            Span::styled(
                format!("{}", hot_count),
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            ),
        ])
    }

    /// 构建节点列表
    fn build_node_items(&self) -> Vec<ListItem<'a>> {
        self.graph
            .nodes
            .iter()
            .take(20)
            .map(|node| {
                let phase_color = hex_to_color(node.phase_state.color());
                let heat_color = if node.is_hot() {
                    Color::Red
                } else {
                    Color::DarkGray
                };
                ListItem::new(Line::from(vec![
                    Span::styled(
                        format!("{:.1} ", node.heat),
                        Style::default().fg(heat_color),
                    ),
                    Span::styled(
                        format!("[{}] ", node.phase_state.label().chars().take(2).collect::<String>()),
                        Style::default().fg(phase_color),
                    ),
                    Span::styled(
                        format!("{}: ", node.node_type),
                        Style::default().fg(Color::Cyan),
                    ),
                    Span::styled(
                        node.content_preview(50),
                        Style::default().fg(Color::White),
                    ),
                ]))
            })
            .collect()
    }

    /// 构建边列表
    fn build_edge_items(&self) -> Vec<ListItem<'a>> {
        self.graph
            .edges
            .iter()
            .take(10)
            .map(|edge| {
                let weight_color = if edge.weight > 0.7 {
                    Color::Red
                } else if edge.weight > 0.4 {
                    Color::Yellow
                } else {
                    Color::Green
                };
                ListItem::new(Line::from(vec![
                    Span::styled(
                        format!("{:.2} ", edge.weight),
                        Style::default().fg(weight_color),
                    ),
                    Span::styled(
                        &edge.source_id[..std::cmp::min(8, edge.source_id.len())],
                        Style::default().fg(Color::Cyan),
                    ),
                    Span::styled(" → ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        &edge.target_id[..std::cmp::min(8, edge.target_id.len())],
                        Style::default().fg(Color::Magenta),
                    ),
                    Span::styled(
                        format!(" [{}]", edge.relation_type),
                        Style::default().fg(Color::DarkGray),
                    ),
                    if edge.is_soft {
                        Span::styled(" (软)", Style::default().fg(Color::DarkGray))
                    } else {
                        Span::raw("")
                    },
                ]))
            })
            .collect()
    }
}

impl<'a> Widget for KnowledgeGraphWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title("🕸️ 知识图谱 (Knowledge Graph)")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Green));

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 5 {
            return;
        }

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2), // 统计
                Constraint::Min(3),    // 节点列表
                Constraint::Min(3),    // 边列表
            ])
            .split(inner);

        // 统计
        Paragraph::new(vec![
            Line::from(Span::styled(
                "图谱统计:",
                Style::default().fg(Color::Gray),
            )),
            self.build_stats_line(),
        ])
        .render(chunks[0], buf);

        // 节点列表
        let nodes_block = Block::default()
            .title("节点 (Nodes)")
            .borders(Borders::TOP)
            .border_style(Style::default().fg(Color::DarkGray));
        let nodes_inner = nodes_block.inner(chunks[1]);
        nodes_block.render(chunks[1], buf);

        if self.graph.nodes.is_empty() {
            Paragraph::new("无节点")
                .style(Style::default().fg(Color::DarkGray))
                .render(nodes_inner, buf);
        } else {
            List::new(self.build_node_items())
                .block(Block::default())
                .render(nodes_inner, buf);
        }

        // 边列表
        let edges_block = Block::default()
            .title("边 (Edges)")
            .borders(Borders::TOP)
            .border_style(Style::default().fg(Color::DarkGray));
        let edges_inner = edges_block.inner(chunks[2]);
        edges_block.render(chunks[2], buf);

        if self.graph.edges.is_empty() {
            Paragraph::new("无边")
                .style(Style::default().fg(Color::DarkGray))
                .render(edges_inner, buf);
        } else {
            List::new(self.build_edge_items())
                .block(Block::default())
                .render(edges_inner, buf);
        }
    }
}

// ============================================================================
// Helix Snapshot Widget (综合快照)
// ============================================================================

/// Helix-Mind 综合快照组件
#[derive(Debug, Clone)]
pub struct HelixSnapshotWidget<'a> {
    snapshot: &'a HelixSnapshot,
}

impl<'a> HelixSnapshotWidget<'a> {
    /// 创建新的综合快照组件
    pub fn new(snapshot: &'a HelixSnapshot) -> Self {
        Self { snapshot }
    }
}

impl<'a> Widget for HelixSnapshotWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title("🌿 Helix-Mind 综合快照 (Helix Snapshot)")
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

        // 左右分栏：左侧认知+代谢，右侧图谱
        let columns = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(inner);

        // 左侧：认知 + 代谢
        let left_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(columns[0]);

        CognitiveStatusWidget::new(&self.snapshot.cognitive).render(left_chunks[0], buf);
        MetabolismStatusWidget::new(&self.snapshot.metabolism).render(left_chunks[1], buf);

        // 右侧：知识图谱
        KnowledgeGraphWidget::new(&self.snapshot.graph).render(columns[1], buf);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use cellrix_protocol::helix_mind::{Concentration, KnowledgeEdge};

    fn create_test_cognitive_status() -> CognitiveStatus {
        CognitiveStatus {
            effective_mode: CognitiveMode::Skilled,
            mode_negotiation: "default".to_string(),
            impasse_level: 2,
            stages_attempted: 5,
            suggested_actions: vec![SuggestedAction {
                action_type: "web_search".to_string(),
                parameters: "{\"query\": \"test\"}".to_string(),
                reason: "需要搜索信息".to_string(),
            }],
            activation_vector: vec![ActivationEntry {
                node_id: "n1".to_string(),
                activation: 0.85,
            }],
            tokens_consumed: 1500,
            latency_ms: 250,
            is_partial: false,
            exhaustion_reason: String::new(),
            trace_id: "test-trace-id-12345".to_string(),
        }
    }

    fn create_test_metabolism_status() -> MetabolismStatus {
        MetabolismStatus {
            phase_state: PhaseState::Liquid,
            concentration: Concentration::Colloidal,
            tension: 0.6,
            heat: 0.8,
            generation: 3,
            initial_impact: 0.5,
            access_count: 42,
            is_hypothetical: false,
            is_recessive: false,
            subject_dependency: "high".to_string(),
            sensitivity: "Private".to_string(),
        }
    }

    fn create_test_graph() -> KnowledgeGraph {
        let mut graph = KnowledgeGraph::new();
        graph.nodes.push(KnowledgeNode {
            id: "n1".to_string(),
            node_type: "text".to_string(),
            content_json: "测试节点1".to_string(),
            heat: 0.9,
            is_hypothetical: false,
            is_recessive: false,
            sensitivity: "Public".to_string(),
            generation: 1,
            phase_state: PhaseState::Liquid,
            concentration: Concentration::Dissolved,
            tension: 0.3,
            access_count: 10,
        });
        graph.nodes.push(KnowledgeNode {
            id: "n2".to_string(),
            node_type: "text".to_string(),
            content_json: "测试节点2".to_string(),
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
        graph
    }

    #[test]
    fn test_cognitive_widget_creation() {
        let status = create_test_cognitive_status();
        let widget = CognitiveStatusWidget::new(&status);
        assert_eq!(widget.status.impasse_level, 2);
        assert_eq!(widget.status.suggested_actions.len(), 1);
    }

    #[test]
    fn test_cognitive_widget_header_lines() {
        let status = create_test_cognitive_status();
        let widget = CognitiveStatusWidget::new(&status);
        let lines = widget.build_header_lines();
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn test_cognitive_widget_suggested_actions() {
        let status = create_test_cognitive_status();
        let widget = CognitiveStatusWidget::new(&status);
        let items = widget.build_suggested_actions();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn test_cognitive_widget_activation_vector() {
        let status = create_test_cognitive_status();
        let widget = CognitiveStatusWidget::new(&status);
        let items = widget.build_activation_vector();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn test_metabolism_widget_creation() {
        let status = create_test_metabolism_status();
        let widget = MetabolismStatusWidget::new(&status);
        assert_eq!(widget.status.phase_state, PhaseState::Liquid);
        assert_eq!(widget.status.heat, 0.8);
    }

    #[test]
    fn test_metabolism_widget_phase_indicator() {
        let status = create_test_metabolism_status();
        let widget = MetabolismStatusWidget::new(&status);
        let line = widget.build_phase_indicator();
        // 应该有3个相态标记
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_metabolism_widget_heat_bar() {
        let status = create_test_metabolism_status();
        let widget = MetabolismStatusWidget::new(&status);
        let line = widget.build_heat_bar();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_metabolism_widget_tension_bar() {
        let status = create_test_metabolism_status();
        let widget = MetabolismStatusWidget::new(&status);
        let line = widget.build_tension_bar();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_metabolism_widget_metadata_lines() {
        let status = create_test_metabolism_status();
        let widget = MetabolismStatusWidget::new(&status);
        let lines = widget.build_metadata_lines();
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn test_graph_widget_creation() {
        let graph = create_test_graph();
        let widget = KnowledgeGraphWidget::new(&graph);
        assert_eq!(widget.graph.node_count(), 2);
        assert_eq!(widget.graph.edge_count(), 1);
    }

    #[test]
    fn test_graph_widget_stats_line() {
        let graph = create_test_graph();
        let widget = KnowledgeGraphWidget::new(&graph);
        let line = widget.build_stats_line();
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_graph_widget_node_items() {
        let graph = create_test_graph();
        let widget = KnowledgeGraphWidget::new(&graph);
        let items = widget.build_node_items();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn test_graph_widget_edge_items() {
        let graph = create_test_graph();
        let widget = KnowledgeGraphWidget::new(&graph);
        let items = widget.build_edge_items();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn test_snapshot_widget_creation() {
        let snapshot = HelixSnapshot {
            cognitive: create_test_cognitive_status(),
            metabolism: create_test_metabolism_status(),
            graph: create_test_graph(),
            timestamp: 1234567890,
        };
        let widget = HelixSnapshotWidget::new(&snapshot);
        assert_eq!(widget.snapshot.cognitive.impasse_level, 2);
        assert_eq!(widget.snapshot.metabolism.phase_state, PhaseState::Liquid);
        assert_eq!(widget.snapshot.graph.node_count(), 2);
    }
}
