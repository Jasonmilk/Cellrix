//! PFP 物理特征可视化组件 — CI-144 PFP-xCF14 的 TUI 展示
//!
//! # Design Principle
//!
//! **白盒可观测**: Cellrix 作为 Helix 生态的"皮肤"，需要将 PFP（物理特征协议）
//! 的 4 字节物理元数据以可视化、颜色编码的方式展示给用户。
//!
//! **物理事实优先**: PFP 的所有字段都来自物理传感器（姿态/临边/模态/风险等级），
//! UI 展示必须忠实反映物理事实，不做语义推断。
//!
//! **极致节能**: PFP 只有 4 字节，UI 组件只渲染可见字段，不做复杂计算。
//!
//! # Components
//!
//! - `PFPWidget`: PFP 物理特征卡片（展示所有 7 个字段）
//! - `RiskLevelIndicator`: 风险等级指示器（颜色编码 + 进度条）
//! - `PFPStatusBar`: PFP 状态条（紧凑展示关键信息）

use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Gauge, Paragraph, Widget, Wrap},
};

use cellrix_protocol::pfp::{
    BodyStance, Modality, OutputDest, OverrideFlag, PFP, ProximityEdge, ReplayEnable, RiskLevel,
};

// ============================================================================
// PFP Widget (物理特征卡片)
// ============================================================================

/// PFP 物理特征卡片 Widget
pub struct PFPWidget<'a> {
    pfp: Option<&'a PFP>,
    title: String,
}

impl<'a> PFPWidget<'a> {
    /// 创建新的 PFP 卡片
    pub fn new(pfp: Option<&'a PFP>) -> Self {
        Self {
            pfp,
            title: "PFP 物理特征 (4 bytes)".to_string(),
        }
    }

    /// 设置自定义标题
    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = title.into();
        self
    }
}

impl<'a> Widget for PFPWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .borders(Borders::ALL)
            .title(self.title.as_str());

        let inner = block.inner(area);
        block.render(area, buf);

        let pfp = match self.pfp {
            Some(p) => p,
            None => {
                let text = "无 PFP 数据";
                Paragraph::new(text)
                    .style(Style::default().fg(Color::DarkGray))
                    .render(inner, buf);
                return;
            }
        };

        // 分为上下两部分：上半部分字段，下半部分风险指示器
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(6), Constraint::Length(3)])
            .split(inner);

        // 上半部分：字段网格（2列）
        let field_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(chunks[0]);

        // 左列字段
        let left_lines = vec![
            field_line("操作模态", modality_str(pfp.modality()), modality_color(pfp.modality())),
            field_line("风险等级", risk_level_str(pfp.risk_level()), risk_level_color(pfp.risk_level())),
            field_line("本体姿态", body_stance_str(pfp.body_stance()), body_stance_color(pfp.body_stance())),
            field_line("临边环境", proximity_edge_str(pfp.proximity_edge()), proximity_edge_color(pfp.proximity_edge())),
        ];

        // 右列字段
        let right_lines = vec![
            field_line("输出目的地", output_dest_str(pfp.output_dest()), Color::Cyan),
            field_line("覆盖标志", override_flag_str(pfp.override_flag()), override_flag_color(pfp.override_flag())),
            field_line("重放保护", replay_enable_str(pfp.replay_enable()), replay_enable_color(pfp.replay_enable())),
            field_line("有效风险", risk_level_str(pfp.effective_risk_level()), risk_level_color(pfp.effective_risk_level())),
        ];

        Paragraph::new(left_lines)
            .wrap(Wrap { trim: true })
            .render(field_chunks[0], buf);

        Paragraph::new(right_lines)
            .wrap(Wrap { trim: true })
            .render(field_chunks[1], buf);

        // 下半部分：风险等级指示器
        let risk = pfp.effective_risk_level();
        let gauge = Gauge::default()
            .block(Block::default().borders(Borders::ALL).title("风险等级"))
            .gauge_style(Style::default().fg(risk_level_color(risk)))
            .percent(risk_level_percent(risk))
            .label(Span::styled(
                risk_level_str(risk),
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            ));
        gauge.render(chunks[1], buf);
    }
}

// ============================================================================
// Risk Level Indicator (风险等级指示器)
// ============================================================================

/// 风险等级指示器 Widget
pub struct RiskLevelIndicator {
    risk: RiskLevel,
    show_label: bool,
}

impl RiskLevelIndicator {
    /// 创建新的风险等级指示器
    pub fn new(risk: RiskLevel) -> Self {
        Self {
            risk,
            show_label: true,
        }
    }

    /// 是否显示标签
    pub fn show_label(mut self, show: bool) -> Self {
        self.show_label = show;
        self
    }
}

impl Widget for RiskLevelIndicator {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let color = risk_level_color(self.risk);
        let percent = risk_level_percent(self.risk);
        let label = if self.show_label {
            risk_level_str(self.risk)
        } else {
            ""
        };

        let gauge = Gauge::default()
            .gauge_style(Style::default().fg(color))
            .percent(percent)
            .label(Span::styled(label, Style::default().fg(Color::White).add_modifier(Modifier::BOLD)));
        gauge.render(area, buf);
    }
}

// ============================================================================
// PFP Status Bar (PFP 状态条)
// ============================================================================

/// PFP 状态条（紧凑展示关键信息）
pub struct PFPStatusBar<'a> {
    pfp: Option<&'a PFP>,
}

impl<'a> PFPStatusBar<'a> {
    /// 创建新的 PFP 状态条
    pub fn new(pfp: Option<&'a PFP>) -> Self {
        Self { pfp }
    }
}

impl<'a> Widget for PFPStatusBar<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let pfp = match self.pfp {
            Some(p) => p,
            None => {
                let text = "PFP: 无数据";
                Paragraph::new(text)
                    .style(Style::default().fg(Color::DarkGray))
                    .render(area, buf);
                return;
            }
        };

        let risk = pfp.effective_risk_level();
        let risk_color = risk_level_color(risk);

        let line = Line::from(vec![
            Span::styled("PFP ", Style::default().fg(Color::DarkGray).add_modifier(Modifier::BOLD)),
            Span::styled("[", Style::default().fg(Color::DarkGray)),
            Span::styled(modality_str(pfp.modality()), Style::default().fg(modality_color(pfp.modality()))),
            Span::styled("|", Style::default().fg(Color::DarkGray)),
            Span::styled(risk_level_str(risk), Style::default().fg(risk_color).add_modifier(Modifier::BOLD)),
            Span::styled("|", Style::default().fg(Color::DarkGray)),
            Span::styled(body_stance_str(pfp.body_stance()), Style::default().fg(body_stance_color(pfp.body_stance()))),
            Span::styled("|", Style::default().fg(Color::DarkGray)),
            Span::styled(proximity_edge_str(pfp.proximity_edge()), Style::default().fg(proximity_edge_color(pfp.proximity_edge()))),
            Span::styled("]", Style::default().fg(Color::DarkGray)),
            if pfp.override_flag() == OverrideFlag::HardOverride {
                Span::styled(" ⚠ HARD OVERRIDE", Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD))
            } else {
                Span::raw("")
            },
            if pfp.replay_enable() == ReplayEnable::Disabled {
                Span::styled(" ⚠ REPLAY OFF", Style::default().fg(Color::Yellow))
            } else {
                Span::raw("")
            },
        ]);

        Paragraph::new(line).render(area, buf);
    }
}

// ============================================================================
// Helper Functions (字段字符串 + 颜色)
// ============================================================================

fn field_line(label: &str, value: &str, value_color: Color) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{:<10}", label), Style::default().fg(Color::Gray)),
        Span::styled(value.to_string(), Style::default().fg(value_color).add_modifier(Modifier::BOLD)),
    ])
}

fn modality_str(m: Modality) -> &'static str {
    match m {
        Modality::Cognitive => "认知 (Cognitive)",
        Modality::Render => "渲染 (Render)",
        Modality::Executive => "执行 (Executive)",
        Modality::SensorFeed => "传感 (SensorFeed)",
    }
}

fn modality_color(m: Modality) -> Color {
    match m {
        Modality::Cognitive => Color::Blue,
        Modality::Render => Color::Cyan,
        Modality::Executive => Color::Yellow,
        Modality::SensorFeed => Color::Green,
    }
}

fn risk_level_str(r: RiskLevel) -> &'static str {
    match r {
        RiskLevel::Low => "低 (Low)",
        RiskLevel::Medium => "中 (Medium)",
        RiskLevel::Critical => "高 (Critical)",
        RiskLevel::Catastrophic => "灾难 (Catastrophic)",
    }
}

fn risk_level_color(r: RiskLevel) -> Color {
    match r {
        RiskLevel::Low => Color::Gray,
        RiskLevel::Medium => Color::Blue,
        RiskLevel::Critical => Color::Yellow,
        RiskLevel::Catastrophic => Color::Red,
    }
}

fn risk_level_percent(r: RiskLevel) -> u16 {
    match r {
        RiskLevel::Low => 25,
        RiskLevel::Medium => 50,
        RiskLevel::Critical => 75,
        RiskLevel::Catastrophic => 100,
    }
}

fn body_stance_str(b: BodyStance) -> &'static str {
    match b {
        BodyStance::Seated => "坐姿 (Seated)",
        BodyStance::Standing => "站姿 (Standing)",
        BodyStance::Moving => "移动 (Moving)",
        BodyStance::Unknown => "未知 (Unknown)",
    }
}

fn body_stance_color(b: BodyStance) -> Color {
    match b {
        BodyStance::Seated => Color::Green,
        BodyStance::Standing => Color::Cyan,
        BodyStance::Moving => Color::Yellow,
        BodyStance::Unknown => Color::DarkGray,
    }
}

fn proximity_edge_str(p: ProximityEdge) -> &'static str {
    match p {
        ProximityEdge::Safe => "安全 (Safe)",
        ProximityEdge::Warning => "警告 (Warning)",
        ProximityEdge::Danger => "危险 (Danger)",
        ProximityEdge::CriticalEdge => "临界 (CriticalEdge)",
    }
}

fn proximity_edge_color(p: ProximityEdge) -> Color {
    match p {
        ProximityEdge::Safe => Color::Green,
        ProximityEdge::Warning => Color::Yellow,
        ProximityEdge::Danger => Color::Red,
        ProximityEdge::CriticalEdge => Color::Magenta,
    }
}

fn output_dest_str(o: OutputDest) -> &'static str {
    match o {
        OutputDest::Internal => "内部 (Internal)",
        OutputDest::External => "外部 (External)",
    }
}

fn override_flag_str(o: OverrideFlag) -> &'static str {
    match o {
        OverrideFlag::Normal => "正常 (Normal)",
        OverrideFlag::HardOverride => "硬覆盖 (HardOverride)",
    }
}

fn override_flag_color(o: OverrideFlag) -> Color {
    match o {
        OverrideFlag::Normal => Color::Green,
        OverrideFlag::HardOverride => Color::Magenta,
    }
}

fn replay_enable_str(r: ReplayEnable) -> &'static str {
    match r {
        ReplayEnable::Enabled => "启用 (Enabled)",
        ReplayEnable::Disabled => "禁用 (Disabled)",
    }
}

fn replay_enable_color(r: ReplayEnable) -> Color {
    match r {
        ReplayEnable::Enabled => Color::Green,
        ReplayEnable::Disabled => Color::Yellow,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use cellrix_protocol::pfp::PFPBuilder;

    #[test]
    fn test_modality_str() {
        assert_eq!(modality_str(Modality::Cognitive), "认知 (Cognitive)");
        assert_eq!(modality_str(Modality::Render), "渲染 (Render)");
        assert_eq!(modality_str(Modality::Executive), "执行 (Executive)");
        assert_eq!(modality_str(Modality::SensorFeed), "传感 (SensorFeed)");
    }

    #[test]
    fn test_risk_level_str() {
        assert_eq!(risk_level_str(RiskLevel::Low), "低 (Low)");
        assert_eq!(risk_level_str(RiskLevel::Medium), "中 (Medium)");
        assert_eq!(risk_level_str(RiskLevel::Critical), "高 (Critical)");
        assert_eq!(risk_level_str(RiskLevel::Catastrophic), "灾难 (Catastrophic)");
    }

    #[test]
    fn test_risk_level_color() {
        assert_eq!(risk_level_color(RiskLevel::Low), Color::Gray);
        assert_eq!(risk_level_color(RiskLevel::Medium), Color::Blue);
        assert_eq!(risk_level_color(RiskLevel::Critical), Color::Yellow);
        assert_eq!(risk_level_color(RiskLevel::Catastrophic), Color::Red);
    }

    #[test]
    fn test_risk_level_percent() {
        assert_eq!(risk_level_percent(RiskLevel::Low), 25);
        assert_eq!(risk_level_percent(RiskLevel::Medium), 50);
        assert_eq!(risk_level_percent(RiskLevel::Critical), 75);
        assert_eq!(risk_level_percent(RiskLevel::Catastrophic), 100);
    }

    #[test]
    fn test_body_stance_str() {
        assert_eq!(body_stance_str(BodyStance::Seated), "坐姿 (Seated)");
        assert_eq!(body_stance_str(BodyStance::Standing), "站姿 (Standing)");
        assert_eq!(body_stance_str(BodyStance::Moving), "移动 (Moving)");
        assert_eq!(body_stance_str(BodyStance::Unknown), "未知 (Unknown)");
    }

    #[test]
    fn test_proximity_edge_str() {
        assert_eq!(proximity_edge_str(ProximityEdge::Safe), "安全 (Safe)");
        assert_eq!(proximity_edge_str(ProximityEdge::Warning), "警告 (Warning)");
        assert_eq!(proximity_edge_str(ProximityEdge::Danger), "危险 (Danger)");
        assert_eq!(proximity_edge_str(ProximityEdge::CriticalEdge), "临界 (CriticalEdge)");
    }

    #[test]
    fn test_output_dest_str() {
        assert_eq!(output_dest_str(OutputDest::Internal), "内部 (Internal)");
        assert_eq!(output_dest_str(OutputDest::External), "外部 (External)");
    }

    #[test]
    fn test_override_flag_str() {
        assert_eq!(override_flag_str(OverrideFlag::Normal), "正常 (Normal)");
        assert_eq!(override_flag_str(OverrideFlag::HardOverride), "硬覆盖 (HardOverride)");
    }

    #[test]
    fn test_replay_enable_str() {
        assert_eq!(replay_enable_str(ReplayEnable::Enabled), "启用 (Enabled)");
        assert_eq!(replay_enable_str(ReplayEnable::Disabled), "禁用 (Disabled)");
    }

    #[test]
    fn test_pfp_widget_new_with_none() {
        let widget = PFPWidget::new(None);
        assert_eq!(widget.title, "PFP 物理特征 (4 bytes)");
    }

    #[test]
    fn test_pfp_widget_with_custom_title() {
        let widget = PFPWidget::new(None).title("自定义标题");
        assert_eq!(widget.title, "自定义标题");
    }

    #[test]
    fn test_risk_level_indicator_new() {
        let indicator = RiskLevelIndicator::new(RiskLevel::Critical);
        assert_eq!(indicator.risk, RiskLevel::Critical);
        assert!(indicator.show_label);
    }

    #[test]
    fn test_risk_level_indicator_hide_label() {
        let indicator = RiskLevelIndicator::new(RiskLevel::Low).show_label(false);
        assert!(!indicator.show_label);
    }

    #[test]
    fn test_pfp_status_bar_new() {
        let pfp = PFPBuilder::new().risk_level(RiskLevel::Critical).build();
        let bar = PFPStatusBar::new(Some(&pfp));
        assert!(bar.pfp.is_some());
    }

    #[test]
    fn test_pfp_status_bar_none() {
        let bar = PFPStatusBar::new(None);
        assert!(bar.pfp.is_none());
    }

    #[test]
    fn test_field_line() {
        let line = field_line("测试", "值", Color::Red);
        // 验证 line 包含正确的 spans
        assert_eq!(line.spans.len(), 2);
        assert_eq!(line.spans[1].content, "值");
    }

    #[test]
    fn test_all_colors_distinct() {
        // 验证不同风险等级有不同颜色
        assert_ne!(risk_level_color(RiskLevel::Low), risk_level_color(RiskLevel::Critical));
        assert_ne!(risk_level_color(RiskLevel::Medium), risk_level_color(RiskLevel::Catastrophic));
    }
}
