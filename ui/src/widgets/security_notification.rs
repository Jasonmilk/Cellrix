//! 安全事件通知系统 — Tuck 安全事件的 TUI 通知与交互
//!
//! # Design Principle
//!
//! **白盒可观测**: Cellrix 作为 Helix 生态的"皮肤"，需要将 Tuck（免疫系统）的
//! 安全决策以实时、醒目、可交互的方式通知用户。
//!
//! **零信任**: 所有安全事件都需要用户确认或记录，不允许静默忽略高危事件。
//!
//! **按需驱动**: 事件驱动，无轮询。安全事件到达时触发通知，事件处理后清除。
//!
//! **极致节能**: 通知组件只在有事件时渲染，无事件时不占用屏幕空间。
//!
//! # Components
//!
//! - `SecurityEventType`: 安全事件类型（Reject/HITL/HardOverride/Info）
//! - `SecurityEvent`: 安全事件结构体
//! - `SecurityEventQueue`: 事件队列（优先级排序、去重、确认/忽略）
//! - `NotificationBanner`: 通知横幅（显示最新事件）
//! - `ConfirmDialog`: 确认对话框（HITL 人工确认）
//! - `EmergencyOverlay`: 紧急通知覆盖层（HardOverride 全屏告警）

use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Widget, Wrap},
};

// ============================================================================
// Security Event Types (安全事件类型)
// ============================================================================

/// 安全事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SecurityEventType {
    /// 信息通知（低优先级）
    Info,
    /// Pass 决策（正常放行）
    Pass,
    /// Reject 拦截（中优先级，需要关注）
    Reject,
    /// HITL 人工确认（高优先级，需要用户操作）
    NeedHumanConfirm,
    /// HardOverride 硬覆盖（最高优先级，紧急通知）
    HardOverride,
}

impl SecurityEventType {
    /// 获取事件类型的标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Info => "信息",
            Self::Pass => "放行",
            Self::Reject => "拦截",
            Self::NeedHumanConfirm => "需确认",
            Self::HardOverride => "紧急",
        }
    }

    /// 获取事件类型的颜色
    pub fn color(&self) -> Color {
        match self {
            Self::Info => Color::Cyan,
            Self::Pass => Color::Green,
            Self::Reject => Color::Yellow,
            Self::NeedHumanConfirm => Color::Magenta,
            Self::HardOverride => Color::Red,
        }
    }

    /// 获取事件类型的优先级（数字越大优先级越高）
    pub fn priority(&self) -> u8 {
        match self {
            Self::Info => 0,
            Self::Pass => 1,
            Self::Reject => 2,
            Self::NeedHumanConfirm => 3,
            Self::HardOverride => 4,
        }
    }

    /// 是否需要用户确认
    pub fn needs_confirmation(&self) -> bool {
        matches!(self, Self::NeedHumanConfirm | Self::HardOverride)
    }

    /// 是否为高优先级事件
    pub fn is_high_priority(&self) -> bool {
        matches!(self, Self::Reject | Self::NeedHumanConfirm | Self::HardOverride)
    }

    /// 是否为紧急事件（需要全屏覆盖）
    pub fn is_emergency(&self) -> bool {
        matches!(self, Self::HardOverride)
    }
}

/// 安全事件状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityEventStatus {
    /// 待处理
    Pending,
    /// 已确认
    Confirmed,
    /// 已忽略
    Ignored,
    /// 已过期
    Expired,
}

// ============================================================================
// Security Event (安全事件)
// ============================================================================

/// 安全事件
#[derive(Debug, Clone)]
pub struct SecurityEvent {
    /// 事件唯一 ID
    pub id: u64,
    /// 事件类型
    pub event_type: SecurityEventType,
    /// 事件标题
    pub title: String,
    /// 事件详情
    pub details: String,
    /// 事件时间戳（Unix 秒）
    pub timestamp: u64,
    /// 事件状态
    pub status: SecurityEventStatus,
    /// 关联的审计条目 ID（如果有）
    pub audit_entry_id: Option<String>,
    /// 关联的 PFP 风险等级（如果有）
    pub risk_level: Option<String>,
}

impl SecurityEvent {
    /// 创建新的安全事件
    pub fn new(event_type: SecurityEventType, title: impl Into<String>, details: impl Into<String>) -> Self {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        Self {
            id,
            event_type,
            title: title.into(),
            details: details.into(),
            timestamp,
            status: SecurityEventStatus::Pending,
            audit_entry_id: None,
            risk_level: None,
        }
    }

    /// 创建 Reject 事件
    pub fn reject(title: impl Into<String>, details: impl Into<String>) -> Self {
        Self::new(SecurityEventType::Reject, title, details)
    }

    /// 创建 HITL 事件
    pub fn need_confirm(title: impl Into<String>, details: impl Into<String>) -> Self {
        Self::new(SecurityEventType::NeedHumanConfirm, title, details)
    }

    /// 创建 HardOverride 紧急事件
    pub fn hard_override(title: impl Into<String>, details: impl Into<String>) -> Self {
        Self::new(SecurityEventType::HardOverride, title, details)
    }

    /// 创建 Info 事件
    pub fn info(title: impl Into<String>, details: impl Into<String>) -> Self {
        Self::new(SecurityEventType::Info, title, details)
    }

    /// 关联审计条目
    pub fn with_audit_entry(mut self, entry_id: impl Into<String>) -> Self {
        self.audit_entry_id = Some(entry_id.into());
        self
    }

    /// 关联风险等级
    pub fn with_risk_level(mut self, risk_level: impl Into<String>) -> Self {
        self.risk_level = Some(risk_level.into());
        self
    }

    /// 确认事件
    pub fn confirm(&mut self) {
        self.status = SecurityEventStatus::Confirmed;
    }

    /// 忽略事件
    pub fn ignore(&mut self) {
        self.status = SecurityEventStatus::Ignored;
    }

    /// 标记为已过期
    pub fn expire(&mut self) {
        self.status = SecurityEventStatus::Expired;
    }

    /// 格式化时间戳为 HH:MM:SS
    pub fn formatted_time(&self) -> String {
        let secs = self.timestamp;
        let hours = secs / 3600;
        let minutes = (secs % 3600) / 60;
        let seconds = secs % 60;
        format!("{:02}:{:02}:{:02}", hours % 24, minutes, seconds)
    }
}

// ============================================================================
// Security Event Queue (事件队列)
// ============================================================================

/// 安全事件队列
#[derive(Debug, Clone)]
pub struct SecurityEventQueue {
    /// 待处理事件（按优先级排序，高优先级在前）
    pending: VecDeque<SecurityEvent>,
    /// 已处理事件（最近 N 条）
    history: VecDeque<SecurityEvent>,
    /// 最大历史记录数
    max_history: usize,
    /// 事件过期时间（秒）
    expire_after: u64,
}

impl SecurityEventQueue {
    /// 创建新的事件队列
    pub fn new() -> Self {
        Self {
            pending: VecDeque::new(),
            history: VecDeque::new(),
            max_history: 100,
            expire_after: 300, // 5 分钟
        }
    }

    /// 设置最大历史记录数
    pub fn with_max_history(mut self, max: usize) -> Self {
        self.max_history = max;
        self
    }

    /// 设置事件过期时间（秒）
    pub fn with_expire_after(mut self, seconds: u64) -> Self {
        self.expire_after = seconds;
        self
    }

    /// 添加事件（按优先级插入）
    pub fn push(&mut self, event: SecurityEvent) {
        // 清理过期事件
        self.cleanup_expired();

        // 按优先级插入（高优先级在前）
        let priority = event.event_type.priority();
        let mut insert_pos = self.pending.len();
        for (i, e) in self.pending.iter().enumerate() {
            if e.event_type.priority() < priority {
                insert_pos = i;
                break;
            }
        }
        self.pending.insert(insert_pos, event);
    }

    /// 获取最高优先级的待处理事件（不移除）
    pub fn peek(&self) -> Option<&SecurityEvent> {
        self.pending.front()
    }

    /// 获取最高优先级的待处理事件（可变引用）
    pub fn peek_mut(&mut self) -> Option<&mut SecurityEvent> {
        self.pending.front_mut()
    }

    /// 弹出最高优先级的待处理事件
    pub fn pop(&mut self) -> Option<SecurityEvent> {
        self.pending.pop_front()
    }

    /// 确认当前最高优先级事件
    pub fn confirm_current(&mut self) -> Option<SecurityEvent> {
        if let Some(mut event) = self.pending.pop_front() {
            event.confirm();
            self.add_to_history(event.clone());
            Some(event)
        } else {
            None
        }
    }

    /// 忽略当前最高优先级事件
    pub fn ignore_current(&mut self) -> Option<SecurityEvent> {
        if let Some(mut event) = self.pending.pop_front() {
            event.ignore();
            self.add_to_history(event.clone());
            Some(event)
        } else {
            None
        }
    }

    /// 获取待处理事件数
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    /// 获取历史事件数
    pub fn history_count(&self) -> usize {
        self.history.len()
    }

    /// 是否有待处理事件
    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// 是否有紧急事件
    pub fn has_emergency(&self) -> bool {
        self.pending
            .iter()
            .any(|e| e.event_type.is_emergency())
    }

    /// 是否有需要确认的事件
    pub fn has_confirmation_needed(&self) -> bool {
        self.pending
            .iter()
            .any(|e| e.event_type.needs_confirmation())
    }

    /// 获取所有待处理事件（只读）
    pub fn pending_events(&self) -> &VecDeque<SecurityEvent> {
        &self.pending
    }

    /// 获取历史事件（只读）
    pub fn history_events(&self) -> &VecDeque<SecurityEvent> {
        &self.history
    }

    /// 清理过期事件
    pub fn cleanup_expired(&mut self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        // 先收集过期事件
        let mut expired_events = Vec::new();
        self.pending.retain(|e| {
            if now - e.timestamp > self.expire_after {
                let mut expired = e.clone();
                expired.expire();
                expired_events.push(expired);
                false
            } else {
                true
            }
        });

        // 再添加到历史记录（避免借用冲突）
        for event in expired_events {
            self.add_to_history(event);
        }
    }

    /// 添加到历史记录
    fn add_to_history(&mut self, event: SecurityEvent) {
        self.history.push_front(event);
        if self.history.len() > self.max_history {
            self.history.pop_back();
        }
    }

    /// 清空所有事件
    pub fn clear(&mut self) {
        self.pending.clear();
        self.history.clear();
    }
}

impl Default for SecurityEventQueue {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Notification Banner (通知横幅)
// ============================================================================

/// 通知横幅 Widget
pub struct NotificationBanner<'a> {
    event: Option<&'a SecurityEvent>,
}

impl<'a> NotificationBanner<'a> {
    /// 创建新的通知横幅
    pub fn new(event: Option<&'a SecurityEvent>) -> Self {
        Self { event }
    }
}

impl<'a> Widget for NotificationBanner<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let event = match self.event {
            Some(e) => e,
            None => return, // 无事件时不渲染
        };

        let color = event.event_type.color();
        let label = event.event_type.label();

        let block = Block::default()
            .borders(Borders::ALL)
            .style(Style::default().fg(color))
            .title(format!("[{}] {}", label, event.title));

        let inner = block.inner(area);
        block.render(area, buf);

        let line = Line::from(vec![
            Span::styled(format!("{} ", event.formatted_time()), Style::default().fg(Color::DarkGray)),
            Span::styled(&event.details, Style::default().fg(Color::White)),
        ]);

        Paragraph::new(line)
            .wrap(Wrap { trim: true })
            .render(inner, buf);
    }
}

// ============================================================================
// Confirm Dialog (确认对话框)
// ============================================================================

/// 确认对话框 Widget
pub struct ConfirmDialog<'a> {
    event: &'a SecurityEvent,
    selected: ConfirmOption,
}

/// 确认选项
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmOption {
    Confirm,
    Ignore,
}

impl<'a> ConfirmDialog<'a> {
    /// 创建新的确认对话框
    pub fn new(event: &'a SecurityEvent) -> Self {
        Self {
            event,
            selected: ConfirmOption::Confirm,
        }
    }

    /// 切换选中选项
    pub fn toggle(&mut self) {
        self.selected = match self.selected {
            ConfirmOption::Confirm => ConfirmOption::Ignore,
            ConfirmOption::Ignore => ConfirmOption::Confirm,
        };
    }

    /// 获取当前选中选项
    pub fn selected(&self) -> ConfirmOption {
        self.selected
    }
}

impl<'a> Widget for ConfirmDialog<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        // 居中显示对话框
        let dialog_area = centered_rect(60, 40, area);

        // 清除背景
        Clear.render(dialog_area, buf);

        let color = self.event.event_type.color();
        let label = self.event.event_type.label();

        let block = Block::default()
            .borders(Borders::ALL)
            .style(Style::default().fg(color).add_modifier(Modifier::BOLD))
            .title(format!("[{}] {}", label, self.event.title));

        let inner = block.inner(dialog_area);
        block.render(dialog_area, buf);

        // 详情
        let details = Paragraph::new(self.event.details.as_str())
            .wrap(Wrap { trim: true })
            .style(Style::default().fg(Color::White));

        // 按钮区域
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(2), Constraint::Length(3)])
            .split(inner);

        details.render(chunks[0], buf);

        // 按钮
        let button_area = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(chunks[1]);

        let confirm_style = if self.selected == ConfirmOption::Confirm {
            Style::default().fg(Color::Green).add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(Color::Green)
        };

        let ignore_style = if self.selected == ConfirmOption::Ignore {
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(Color::Red)
        };

        Paragraph::new("[确认] (Enter)")
            .style(confirm_style)
            .alignment(ratatui::layout::Alignment::Center)
            .render(button_area[0], buf);

        Paragraph::new("[忽略] (Tab/Esc)")
            .style(ignore_style)
            .alignment(ratatui::layout::Alignment::Center)
            .render(button_area[1], buf);
    }
}

// ============================================================================
// Emergency Overlay (紧急通知覆盖层)
// ============================================================================

/// 紧急通知覆盖层 Widget
pub struct EmergencyOverlay<'a> {
    event: &'a SecurityEvent,
}

impl<'a> EmergencyOverlay<'a> {
    /// 创建新的紧急覆盖层
    pub fn new(event: &'a SecurityEvent) -> Self {
        Self { event }
    }
}

impl<'a> Widget for EmergencyOverlay<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        // 全屏红色背景
        for y in area.top()..area.bottom() {
            for x in area.left()..area.right() {
                let cell = buf.get_mut(x, y);
                cell.set_style(Style::default().bg(Color::Red).fg(Color::White).add_modifier(Modifier::BOLD));
            }
        }

        // 居中显示紧急信息
        let center = centered_rect(80, 50, area);

        let lines = vec![
            Line::from(""),
            Line::from(Span::styled(
                "⚠ 紧急安全事件 ⚠",
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD | Modifier::SLOW_BLINK),
            )),
            Line::from(""),
            Line::from(Span::styled(
                self.event.title.as_str(),
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from(Span::styled(
                self.event.details.as_str(),
                Style::default().fg(Color::White),
            )),
            Line::from(""),
            Line::from(Span::styled(
                format!("时间: {}", self.event.formatted_time()),
                Style::default().fg(Color::Yellow),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "按 Enter 确认并继续 | 按 Esc 忽略",
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            )),
        ];

        Paragraph::new(lines)
            .alignment(ratatui::layout::Alignment::Center)
            .wrap(Wrap { trim: true })
            .render(center, buf);
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// 创建居中的矩形
fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_security_event_type_label() {
        assert_eq!(SecurityEventType::Info.label(), "信息");
        assert_eq!(SecurityEventType::Pass.label(), "放行");
        assert_eq!(SecurityEventType::Reject.label(), "拦截");
        assert_eq!(SecurityEventType::NeedHumanConfirm.label(), "需确认");
        assert_eq!(SecurityEventType::HardOverride.label(), "紧急");
    }

    #[test]
    fn test_security_event_type_priority() {
        assert!(SecurityEventType::HardOverride.priority() > SecurityEventType::NeedHumanConfirm.priority());
        assert!(SecurityEventType::NeedHumanConfirm.priority() > SecurityEventType::Reject.priority());
        assert!(SecurityEventType::Reject.priority() > SecurityEventType::Pass.priority());
        assert!(SecurityEventType::Pass.priority() > SecurityEventType::Info.priority());
    }

    #[test]
    fn test_security_event_type_needs_confirmation() {
        assert!(!SecurityEventType::Info.needs_confirmation());
        assert!(!SecurityEventType::Pass.needs_confirmation());
        assert!(!SecurityEventType::Reject.needs_confirmation());
        assert!(SecurityEventType::NeedHumanConfirm.needs_confirmation());
        assert!(SecurityEventType::HardOverride.needs_confirmation());
    }

    #[test]
    fn test_security_event_type_is_emergency() {
        assert!(!SecurityEventType::Info.is_emergency());
        assert!(!SecurityEventType::Reject.is_emergency());
        assert!(!SecurityEventType::NeedHumanConfirm.is_emergency());
        assert!(SecurityEventType::HardOverride.is_emergency());
    }

    #[test]
    fn test_security_event_new() {
        let event = SecurityEvent::new(SecurityEventType::Reject, "测试标题", "测试详情");
        assert_eq!(event.event_type, SecurityEventType::Reject);
        assert_eq!(event.title, "测试标题");
        assert_eq!(event.details, "测试详情");
        assert_eq!(event.status, SecurityEventStatus::Pending);
        assert!(event.audit_entry_id.is_none());
        assert!(event.risk_level.is_none());
    }

    #[test]
    fn test_security_event_constructors() {
        let reject = SecurityEvent::reject("拒绝", "详情");
        assert_eq!(reject.event_type, SecurityEventType::Reject);

        let hitl = SecurityEvent::need_confirm("需确认", "详情");
        assert_eq!(hitl.event_type, SecurityEventType::NeedHumanConfirm);

        let emergency = SecurityEvent::hard_override("紧急", "详情");
        assert_eq!(emergency.event_type, SecurityEventType::HardOverride);

        let info = SecurityEvent::info("信息", "详情");
        assert_eq!(info.event_type, SecurityEventType::Info);
    }

    #[test]
    fn test_security_event_with_audit_and_risk() {
        let event = SecurityEvent::reject("测试", "详情")
            .with_audit_entry("audit-001")
            .with_risk_level("Critical");

        assert_eq!(event.audit_entry_id, Some("audit-001".to_string()));
        assert_eq!(event.risk_level, Some("Critical".to_string()));
    }

    #[test]
    fn test_security_event_confirm_ignore_expire() {
        let mut event = SecurityEvent::reject("测试", "详情");
        assert_eq!(event.status, SecurityEventStatus::Pending);

        event.confirm();
        assert_eq!(event.status, SecurityEventStatus::Confirmed);

        event.ignore();
        assert_eq!(event.status, SecurityEventStatus::Ignored);

        event.expire();
        assert_eq!(event.status, SecurityEventStatus::Expired);
    }

    #[test]
    fn test_security_event_queue_push_and_peek() {
        let mut queue = SecurityEventQueue::new();
        assert!(queue.peek().is_none());

        let event1 = SecurityEvent::info("低优先级", "详情");
        let event2 = SecurityEvent::hard_override("高优先级", "详情");

        queue.push(event1);
        queue.push(event2);

        // 高优先级应该在前面
        assert_eq!(queue.peek().unwrap().event_type, SecurityEventType::HardOverride);
        assert_eq!(queue.pending_count(), 2);
    }

    #[test]
    fn test_security_event_queue_pop() {
        let mut queue = SecurityEventQueue::new();
        queue.push(SecurityEvent::reject("拒绝", "详情"));
        queue.push(SecurityEvent::info("信息", "详情"));

        let popped = queue.pop().unwrap();
        assert_eq!(popped.event_type, SecurityEventType::Reject);
        assert_eq!(queue.pending_count(), 1);
    }

    #[test]
    fn test_security_event_queue_confirm_current() {
        let mut queue = SecurityEventQueue::new();
        queue.push(SecurityEvent::need_confirm("需确认", "详情"));

        let confirmed = queue.confirm_current().unwrap();
        assert_eq!(confirmed.status, SecurityEventStatus::Confirmed);
        assert_eq!(queue.pending_count(), 0);
        assert_eq!(queue.history_count(), 1);
    }

    #[test]
    fn test_security_event_queue_ignore_current() {
        let mut queue = SecurityEventQueue::new();
        queue.push(SecurityEvent::reject("拒绝", "详情"));

        let ignored = queue.ignore_current().unwrap();
        assert_eq!(ignored.status, SecurityEventStatus::Ignored);
        assert_eq!(queue.pending_count(), 0);
        assert_eq!(queue.history_count(), 1);
    }

    #[test]
    fn test_security_event_queue_has_emergency() {
        let mut queue = SecurityEventQueue::new();
        assert!(!queue.has_emergency());

        queue.push(SecurityEvent::reject("拒绝", "详情"));
        assert!(!queue.has_emergency());

        queue.push(SecurityEvent::hard_override("紧急", "详情"));
        assert!(queue.has_emergency());
    }

    #[test]
    fn test_security_event_queue_has_confirmation_needed() {
        let mut queue = SecurityEventQueue::new();
        assert!(!queue.has_confirmation_needed());

        queue.push(SecurityEvent::reject("拒绝", "详情"));
        assert!(!queue.has_confirmation_needed());

        queue.push(SecurityEvent::need_confirm("需确认", "详情"));
        assert!(queue.has_confirmation_needed());
    }

    #[test]
    fn test_security_event_queue_clear() {
        let mut queue = SecurityEventQueue::new();
        queue.push(SecurityEvent::reject("拒绝", "详情"));
        queue.confirm_current();

        assert_eq!(queue.pending_count(), 0);
        assert_eq!(queue.history_count(), 1);

        queue.clear();
        assert_eq!(queue.pending_count(), 0);
        assert_eq!(queue.history_count(), 0);
    }

    #[test]
    fn test_confirm_option_toggle() {
        let event = SecurityEvent::need_confirm("测试", "详情");
        let mut dialog = ConfirmDialog::new(&event);
        assert_eq!(dialog.selected(), ConfirmOption::Confirm);

        dialog.toggle();
        assert_eq!(dialog.selected(), ConfirmOption::Ignore);

        dialog.toggle();
        assert_eq!(dialog.selected(), ConfirmOption::Confirm);
    }

    #[test]
    fn test_event_ids_unique() {
        let event1 = SecurityEvent::info("1", "详情");
        let event2 = SecurityEvent::info("2", "详情");
        assert_ne!(event1.id, event2.id);
    }
}
