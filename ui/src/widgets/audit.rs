//! 审计日志 UI 组件 — Tuck 审计日志的 TUI 展示
//!
//! # Design Principle
//!
//! **白盒可观测**: Cellrix 作为 Helix 生态的"皮肤"，需要将 Tuck（免疫系统）的
//! 审计日志以可读、可筛选、可排序的方式展示给用户。
//!
//! **极致解耦**: 本模块只依赖 cellrix-protocol 的 tuck_audit 类型，不依赖 Tuck crate。
//! Widget 是纯展示层，不包含业务逻辑。
//!
//! **按需加载**: 审计日志可能很大，Widget 只渲染可见区域的条目，不一次性渲染全部。
//!
//! # Components
//!
//! - `AuditLogState`: 审计日志的交互状态（滚动位置、筛选条件）
//! - `AuditLogWidget`: 审计日志列表（可滚动、可筛选）
//! - `AuditStatsWidget`: 统计信息卡片（Pass 率、Reject 率等）

use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Widget, Wrap},
};

use cellrix_protocol::tuck_audit::{AuditEntry, AuditStats, RiskLevel, TuckDecision};

// ============================================================================
// Audit Log State (交互状态)
// ============================================================================

/// 审计日志筛选条件
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditFilter {
    /// 显示全部
    All,
    /// 只显示 Pass
    PassOnly,
    /// 只显示 Reject
    RejectOnly,
    /// 只显示需要人工确认
    HitlOnly,
    /// 只显示高优先级事件（Reject + HardOverridePass）
    HighPriorityOnly,
}

impl AuditFilter {
    /// 获取筛选条件的标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::All => "全部",
            Self::PassOnly => "仅 Pass",
            Self::RejectOnly => "仅 Reject",
            Self::HitlOnly => "仅 HITL",
            Self::HighPriorityOnly => "高优先级",
        }
    }

    /// 判断条目是否符合筛选条件
    pub fn matches(&self, entry: &AuditEntry) -> bool {
        match self {
            Self::All => true,
            Self::PassOnly => entry.decision() == Some(TuckDecision::Pass),
            Self::RejectOnly => entry.decision() == Some(TuckDecision::Reject),
            Self::HitlOnly => entry.decision() == Some(TuckDecision::NeedHumanConfirm),
            Self::HighPriorityOnly => entry.is_high_priority(),
        }
    }

    /// 循环切换到下一个筛选条件
    pub fn next(&self) -> Self {
        match self {
            Self::All => Self::PassOnly,
            Self::PassOnly => Self::RejectOnly,
            Self::RejectOnly => Self::HitlOnly,
            Self::HitlOnly => Self::HighPriorityOnly,
            Self::HighPriorityOnly => Self::All,
        }
    }
}

/// 审计日志的交互状态
#[derive(Debug, Clone)]
pub struct AuditLogState {
    /// 列表状态（滚动位置）
    list_state: ListState,
    /// 筛选条件
    filter: AuditFilter,
    /// 筛选后的条目索引（用于滚动）
    filtered_indices: Vec<usize>,
}

impl AuditLogState {
    /// 创建新的审计日志状态
    pub fn new() -> Self {
        Self {
            list_state: ListState::default(),
            filter: AuditFilter::All,
            filtered_indices: Vec::new(),
        }
    }

    /// 获取当前筛选条件
    pub fn filter(&self) -> AuditFilter {
        self.filter
    }

    /// 设置筛选条件并重新计算筛选索引
    pub fn set_filter(&mut self, filter: AuditFilter, entries: &[AuditEntry]) {
        self.filter = filter;
        self.recompute_filtered(entries);
        // 重置选择到第一个
        if !self.filtered_indices.is_empty() {
            self.list_state.select(Some(0));
        } else {
            self.list_state.select(None);
        }
    }

    /// 循环切换筛选条件
    pub fn cycle_filter(&mut self, entries: &[AuditEntry]) {
        let next = self.filter.next();
        self.set_filter(next, entries);
    }

    /// 重新计算筛选后的索引
    pub fn recompute_filtered(&mut self, entries: &[AuditEntry]) {
        self.filtered_indices = entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| self.filter.matches(entry))
            .map(|(i, _)| i)
            .collect();
    }

    /// 向下移动选择
    pub fn next(&mut self) {
        if self.filtered_indices.is_empty() {
            return;
        }
        let i = match self.list_state.selected() {
            Some(i) => {
                if i >= self.filtered_indices.len() - 1 {
                    0
                } else {
                    i + 1
                }
            }
            None => 0,
        };
        self.list_state.select(Some(i));
    }

    /// 向上移动选择
    pub fn previous(&mut self) {
        if self.filtered_indices.is_empty() {
            return;
        }
        let i = match self.list_state.selected() {
            Some(i) => {
                if i == 0 {
                    self.filtered_indices.len() - 1
                } else {
                    i - 1
                }
            }
            None => self.filtered_indices.len() - 1,
        };
        self.list_state.select(Some(i));
    }

    /// 获取当前选中的条目索引（在原始 entries 中的索引）
    pub fn selected_index(&self) -> Option<usize> {
        self.list_state
            .selected()
            .and_then(|i| self.filtered_indices.get(i).copied())
    }

    /// 获取筛选后的条目数
    pub fn filtered_count(&self) -> usize {
        self.filtered_indices.len()
    }

    /// 获取可变的列表状态（用于渲染）
    pub fn list_state_mut(&mut self) -> &mut ListState {
        &mut self.list_state
    }
}

impl Default for AuditLogState {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Audit Log Widget (审计日志列表)
// ============================================================================

/// 审计日志列表 Widget
pub struct AuditLogWidget<'a> {
    entries: &'a [AuditEntry],
    state: &'a mut AuditLogState,
    title: String,
}

impl<'a> AuditLogWidget<'a> {
    /// 创建新的审计日志列表 Widget
    pub fn new(entries: &'a [AuditEntry], state: &'a mut AuditLogState) -> Self {
        // 确保筛选索引是最新的
        state.recompute_filtered(entries);
        let filter_label = state.filter.label().to_string();
        Self {
            entries,
            state,
            title: format!("审计日志 [{}] (按 Tab 切换筛选)", filter_label),
        }
    }

    /// 将审计条目转换为 ListItem
    fn entry_to_item(entry: &AuditEntry, is_selected: bool) -> ListItem<'a> {
        let decision = entry.decision().unwrap_or(TuckDecision::Pass);
        let risk = entry.risk_level().unwrap_or(RiskLevel::Low);

        // 决策结果的颜色
        let decision_style = match decision {
            TuckDecision::Pass => Style::default().fg(Color::Green),
            TuckDecision::Reject => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            TuckDecision::NeedHumanConfirm => Style::default().fg(Color::Yellow),
            TuckDecision::HardOverridePass => Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
        };

        // 风险等级的颜色
        let risk_color = match risk {
            RiskLevel::Low => Color::Gray,
            RiskLevel::Medium => Color::Blue,
            RiskLevel::Critical => Color::Yellow,
            RiskLevel::Catastrophic => Color::Red,
        };

        let selected_prefix = if is_selected { "▶ " } else { "  " };

        let line = Line::from(vec![
            Span::raw(selected_prefix),
            Span::styled(format!("{:<8}", entry.formatted_time()), Style::default().fg(Color::DarkGray)),
            Span::raw(" "),
            Span::styled(format!("{:<18}", decision_str(decision)), decision_style),
            Span::raw(" "),
            Span::styled(format!("{:<14}", risk_str(risk)), Style::default().fg(risk_color)),
            Span::raw(" "),
            Span::styled(format!("{:<12}", entry.modality), Style::default().fg(Color::Cyan)),
            Span::raw(" "),
            Span::styled(format!("{:<10}", entry.source), Style::default().fg(Color::Gray)),
        ]);

        ListItem::new(line)
    }
}

impl<'a> Widget for AuditLogWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        // 筛选后的条目
        let filtered: Vec<&AuditEntry> = self
            .state
            .filtered_indices
            .iter()
            .filter_map(|&i| self.entries.get(i))
            .collect();

        let selected = self.state.list_state.selected();

        let items: Vec<ListItem> = filtered
            .iter()
            .enumerate()
            .map(|(i, entry)| Self::entry_to_item(entry, Some(i) == selected))
            .collect();

        let list = List::new(items)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(self.title.as_str()),
            )
            .highlight_style(Style::default().add_modifier(Modifier::BOLD));

        // 使用状态化渲染
        let mut state = self.state.list_state.clone();
        ratatui::widgets::StatefulWidget::render(list, area, buf, &mut state);
    }
}

// ============================================================================
// Audit Stats Widget (统计信息卡片)
// ============================================================================

/// 审计统计信息 Widget
pub struct AuditStatsWidget<'a> {
    stats: &'a AuditStats,
}

impl<'a> AuditStatsWidget<'a> {
    /// 创建新的统计信息 Widget
    pub fn new(stats: &'a AuditStats) -> Self {
        Self { stats }
    }
}

impl<'a> Widget for AuditStatsWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .borders(Borders::ALL)
            .title("审计统计");

        let inner = block.inner(area);
        block.render(area, buf);

        // 分为左右两列
        let chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(inner);

        // 左列：基础统计
        let left_lines = vec![
            Line::from(vec![
                Span::styled("总条目: ", Style::default().fg(Color::Gray)),
                Span::styled(self.stats.total_entries.to_string(), Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
            ]),
            Line::from(vec![
                Span::styled("Pass: ", Style::default().fg(Color::Gray)),
                Span::styled(self.stats.pass_count.to_string(), Style::default().fg(Color::Green)),
                Span::styled(format!(" ({:.1}%)", self.stats.pass_rate()), Style::default().fg(Color::DarkGray)),
            ]),
            Line::from(vec![
                Span::styled("Reject: ", Style::default().fg(Color::Gray)),
                Span::styled(self.stats.reject_count.to_string(), Style::default().fg(Color::Red)),
                Span::styled(format!(" ({:.1}%)", self.stats.reject_rate()), Style::default().fg(Color::DarkGray)),
            ]),
            Line::from(vec![
                Span::styled("HITL: ", Style::default().fg(Color::Gray)),
                Span::styled(self.stats.hitl_count.to_string(), Style::default().fg(Color::Yellow)),
            ]),
        ];

        // 右列：高级统计
        let right_lines = vec![
            Line::from(vec![
                Span::styled("硬覆盖: ", Style::default().fg(Color::Gray)),
                Span::styled(self.stats.hard_override_count.to_string(), Style::default().fg(Color::Magenta)),
            ]),
            Line::from(vec![
                Span::styled("高优先级: ", Style::default().fg(Color::Gray)),
                Span::styled(self.stats.high_priority_count.to_string(), Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)),
            ]),
            Line::from(vec![
                Span::styled("最早时间: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    self.stats.oldest_timestamp.map(|t| format_time(t)).unwrap_or_else(|| "-".to_string()),
                    Style::default().fg(Color::DarkGray),
                ),
            ]),
            Line::from(vec![
                Span::styled("最新时间: ", Style::default().fg(Color::Gray)),
                Span::styled(
                    self.stats.newest_timestamp.map(|t| format_time(t)).unwrap_or_else(|| "-".to_string()),
                    Style::default().fg(Color::DarkGray),
                ),
            ]),
        ];

        let left_text = Text::from(left_lines);
        let right_text = Text::from(right_lines);

        Paragraph::new(left_text)
            .wrap(Wrap { trim: true })
            .render(chunks[0], buf);

        Paragraph::new(right_text)
            .wrap(Wrap { trim: true })
            .render(chunks[1], buf);
    }
}

// ============================================================================
// Audit Detail Widget (单条详情)
// ============================================================================

/// 单条审计条目详情 Widget
pub struct AuditDetailWidget<'a> {
    entry: Option<&'a AuditEntry>,
}

impl<'a> AuditDetailWidget<'a> {
    /// 创建新的详情 Widget
    pub fn new(entry: Option<&'a AuditEntry>) -> Self {
        Self { entry }
    }
}

impl<'a> Widget for AuditDetailWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .borders(Borders::ALL)
            .title("条目详情");

        let inner = block.inner(area);
        block.render(area, buf);

        let entry = match self.entry {
            Some(e) => e,
            None => {
                let text = Text::from("未选中条目");
                Paragraph::new(text)
                    .style(Style::default().fg(Color::DarkGray))
                    .render(inner, buf);
                return;
            }
        };

        let decision = entry.decision().unwrap_or(TuckDecision::Pass);
        let risk = entry.risk_level().unwrap_or(RiskLevel::Low);

        let lines = vec![
            Line::from(vec![
                Span::styled("Entry ID: ", Style::default().fg(Color::Gray)),
                Span::raw(&entry.entry_id),
            ]),
            Line::from(vec![
                Span::styled("时间: ", Style::default().fg(Color::Gray)),
                Span::raw(format_time(entry.timestamp)),
            ]),
            Line::from(vec![
                Span::styled("决策: ", Style::default().fg(Color::Gray)),
                Span::styled(decision_str(decision), decision_style(decision)),
            ]),
            Line::from(vec![
                Span::styled("风险等级: ", Style::default().fg(Color::Gray)),
                Span::styled(risk_str(risk), Style::default().fg(risk_color(risk))),
            ]),
            Line::from(vec![
                Span::styled("操作模态: ", Style::default().fg(Color::Gray)),
                Span::raw(&entry.modality),
            ]),
            Line::from(vec![
                Span::styled("覆盖标志: ", Style::default().fg(Color::Gray)),
                Span::raw(&entry.override_flag),
            ]),
            Line::from(vec![
                Span::styled("来源: ", Style::default().fg(Color::Gray)),
                Span::raw(&entry.source),
            ]),
            Line::from(vec![
                Span::styled("身份标签: ", Style::default().fg(Color::Gray)),
                Span::raw(entry.identity_label.clone().unwrap_or_else(|| "-".to_string())),
            ]),
            Line::from(vec![
                Span::styled("哈希: ", Style::default().fg(Color::Gray)),
                Span::styled(&entry.hash[..16.min(entry.hash.len())], Style::default().fg(Color::DarkGray)),
                Span::raw("..."),
            ]),
        ];

        Paragraph::new(Text::from(lines))
            .wrap(Wrap { trim: true })
            .render(inner, buf);
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

fn decision_str(decision: TuckDecision) -> &'static str {
    match decision {
        TuckDecision::Pass => "Pass",
        TuckDecision::Reject => "Reject",
        TuckDecision::NeedHumanConfirm => "Need Human Confirm",
        TuckDecision::HardOverridePass => "Hard Override Pass",
    }
}

fn decision_style(decision: TuckDecision) -> Style {
    match decision {
        TuckDecision::Pass => Style::default().fg(Color::Green),
        TuckDecision::Reject => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        TuckDecision::NeedHumanConfirm => Style::default().fg(Color::Yellow),
        TuckDecision::HardOverridePass => Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
    }
}

fn risk_str(risk: RiskLevel) -> &'static str {
    match risk {
        RiskLevel::Low => "Low",
        RiskLevel::Medium => "Medium",
        RiskLevel::Critical => "Critical",
        RiskLevel::Catastrophic => "Catastrophic",
    }
}

fn risk_color(risk: RiskLevel) -> Color {
    match risk {
        RiskLevel::Low => Color::Gray,
        RiskLevel::Medium => Color::Blue,
        RiskLevel::Critical => Color::Yellow,
        RiskLevel::Catastrophic => Color::Red,
    }
}

fn format_time(timestamp: u64) -> String {
    let hours = timestamp / 3600;
    let minutes = (timestamp % 3600) / 60;
    let seconds = timestamp % 60;
    format!("{:02}:{:02}:{:02}", hours % 24, minutes, seconds)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_entries() -> Vec<AuditEntry> {
        vec![
            AuditEntry {
                entry_id: "00000000-0000-0000-0000-000000000001".to_string(),
                timestamp: 1000,
                decision: "Pass".to_string(),
                risk_level: "Low".to_string(),
                modality: "Cognitive".to_string(),
                override_flag: "Normal".to_string(),
                source: "anaphase".to_string(),
                identity_label: None,
                prev_hash: "0".repeat(64),
                hash: "a".repeat(64),
            },
            AuditEntry {
                entry_id: "00000000-0000-0000-0000-000000000002".to_string(),
                timestamp: 2000,
                decision: "Reject".to_string(),
                risk_level: "Critical".to_string(),
                modality: "Executive".to_string(),
                override_flag: "Normal".to_string(),
                source: "tentacle".to_string(),
                identity_label: Some("cred_001".to_string()),
                prev_hash: "a".repeat(64),
                hash: "b".repeat(64),
            },
            AuditEntry {
                entry_id: "00000000-0000-0000-0000-000000000003".to_string(),
                timestamp: 3000,
                decision: "NeedHumanConfirm".to_string(),
                risk_level: "Medium".to_string(),
                modality: "Render".to_string(),
                override_flag: "Normal".to_string(),
                source: "human".to_string(),
                identity_label: None,
                prev_hash: "b".repeat(64),
                hash: "c".repeat(64),
            },
            AuditEntry {
                entry_id: "00000000-0000-0000-0000-000000000004".to_string(),
                timestamp: 4000,
                decision: "HardOverridePass".to_string(),
                risk_level: "Catastrophic".to_string(),
                modality: "SensorFeed".to_string(),
                override_flag: "HardOverride".to_string(),
                source: "anaphase".to_string(),
                identity_label: None,
                prev_hash: "c".repeat(64),
                hash: "d".repeat(64),
            },
        ]
    }

    #[test]
    fn test_audit_filter_matches() {
        let entries = create_test_entries();

        assert_eq!(AuditFilter::All.matches(&entries[0]), true);
        assert_eq!(AuditFilter::All.matches(&entries[1]), true);

        assert_eq!(AuditFilter::PassOnly.matches(&entries[0]), true);
        assert_eq!(AuditFilter::PassOnly.matches(&entries[1]), false);

        assert_eq!(AuditFilter::RejectOnly.matches(&entries[1]), true);
        assert_eq!(AuditFilter::RejectOnly.matches(&entries[0]), false);

        assert_eq!(AuditFilter::HitlOnly.matches(&entries[2]), true);
        assert_eq!(AuditFilter::HitlOnly.matches(&entries[0]), false);

        assert_eq!(AuditFilter::HighPriorityOnly.matches(&entries[1]), true); // Reject
        assert_eq!(AuditFilter::HighPriorityOnly.matches(&entries[3]), true); // HardOverride
        assert_eq!(AuditFilter::HighPriorityOnly.matches(&entries[0]), false);
    }

    #[test]
    fn test_audit_filter_cycle() {
        assert_eq!(AuditFilter::All.next(), AuditFilter::PassOnly);
        assert_eq!(AuditFilter::PassOnly.next(), AuditFilter::RejectOnly);
        assert_eq!(AuditFilter::RejectOnly.next(), AuditFilter::HitlOnly);
        assert_eq!(AuditFilter::HitlOnly.next(), AuditFilter::HighPriorityOnly);
        assert_eq!(AuditFilter::HighPriorityOnly.next(), AuditFilter::All);
    }

    #[test]
    fn test_audit_log_state_new() {
        let state = AuditLogState::new();
        assert_eq!(state.filter(), AuditFilter::All);
        assert_eq!(state.filtered_count(), 0);
        assert_eq!(state.selected_index(), None);
    }

    #[test]
    fn test_audit_log_state_set_filter() {
        let entries = create_test_entries();
        let mut state = AuditLogState::new();

        state.set_filter(AuditFilter::RejectOnly, &entries);
        assert_eq!(state.filter(), AuditFilter::RejectOnly);
        assert_eq!(state.filtered_count(), 1);
        assert_eq!(state.selected_index(), Some(1)); // 第二个条目是 Reject
    }

    #[test]
    fn test_audit_log_state_navigation() {
        let entries = create_test_entries();
        let mut state = AuditLogState::new();
        state.set_filter(AuditFilter::All, &entries);

        assert_eq!(state.selected_index(), Some(0));

        state.next();
        assert_eq!(state.selected_index(), Some(1));

        state.next();
        state.next();
        state.next(); // 循环回第一个
        assert_eq!(state.selected_index(), Some(0));

        state.previous();
        assert_eq!(state.selected_index(), Some(3));
    }

    #[test]
    fn test_audit_log_state_empty() {
        let entries: Vec<AuditEntry> = vec![];
        let mut state = AuditLogState::new();
        state.set_filter(AuditFilter::All, &entries);

        assert_eq!(state.filtered_count(), 0);
        assert_eq!(state.selected_index(), None);

        // 空列表上导航不应该 panic
        state.next();
        state.previous();
    }

    #[test]
    fn test_decision_str() {
        assert_eq!(decision_str(TuckDecision::Pass), "Pass");
        assert_eq!(decision_str(TuckDecision::Reject), "Reject");
        assert_eq!(decision_str(TuckDecision::NeedHumanConfirm), "Need Human Confirm");
        assert_eq!(decision_str(TuckDecision::HardOverridePass), "Hard Override Pass");
    }

    #[test]
    fn test_risk_str() {
        assert_eq!(risk_str(RiskLevel::Low), "Low");
        assert_eq!(risk_str(RiskLevel::Medium), "Medium");
        assert_eq!(risk_str(RiskLevel::Critical), "Critical");
        assert_eq!(risk_str(RiskLevel::Catastrophic), "Catastrophic");
    }

    #[test]
    fn test_format_time() {
        assert_eq!(format_time(0), "00:00:00");
        assert_eq!(format_time(3661), "01:01:01");
        assert_eq!(format_time(86399), "23:59:59");
    }
}
