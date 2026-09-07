//! Engram widget — the full-chain audit imprint panel (ADR-0004 D9/D11/D12).
//!
//! Three panels arranged by ratio (ratatui `Constraint` — the Cellrix
//! "grid by proportion" way):
//!
//! ```text
//! ┌─────────────────────────────────────────────┐
//! │ overview (count / queried_by / filter)  1fr │
//! ├──────────────────────┬──────────────────────┤
//! │ timeline (entries)   │ detail (selected)    │
//! │ 2fr                  │ 1fr                  │
//! └──────────────────────┴──────────────────────┘
//! ```
//!
//! # Design principles
//!
//! - **按需加载**: the timeline is a virtual list (ratatui renders only the
//!   visible rows); detail renders only the selected entry; the query is
//!   always filtered, never a whole-chain pull.
//! - **物理事实优先**: this widget renders exactly what the gateway wrote
//!   (the chain is the source of truth) — no mock shapes.
//! - **白盒可查**: prev_hash/hash are shown so the tamper-evidence link is
//!   inspectable, not just asserted.

use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Widget, Wrap},
};

use cellrix_protocol::engram::EngramEntry;

/// Interactive state for the Engram panel (owned by AppState; the widget is
/// a pure projection of it).
#[derive(Debug, Default, Clone)]
pub struct EngramViewState {
    /// Entries of the last query, chain order (oldest first).
    pub entries: Vec<EngramEntry>,
    /// Index of the selected timeline row.
    pub selected: Option<usize>,
    /// Pending trace_id filter while typing (Some = filter-typing mode).
    pub filter_input: Option<String>,
    /// The applied trace_id filter (empty = none).
    pub applied_filter: Option<String>,
    /// True while a fetch is in flight.
    pub loading: bool,
    /// Last fetch error, if any.
    pub error: Option<String>,
    /// Caller identity returned by the gateway for this query.
    pub queried_by: String,
    /// Scroll state for the timeline list.
    pub list_state: ListState,
}

impl EngramViewState {
    /// Reset everything except the applied filter (used on filter change).
    pub fn reset_entries(&mut self) {
        self.entries.clear();
        self.selected = None;
        self.error = None;
        self.queried_by.clear();
        self.list_state = ListState::default();
    }
}

/// Renders the Engram panel into `area`.
pub fn render_engram(state: &EngramViewState, area: Rect, buf: &mut Buffer) {
    // Grid by proportion: overview strip / timeline+detail row.
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)].as_ref())
        .split(area);

    render_overview(state, chunks[0], buf);
    render_body(state, chunks[1], buf);
}

fn render_overview(state: &EngramViewState, area: Rect, buf: &mut Buffer) {
    let block = Block::default().borders(Borders::ALL).title(" Engram — 全链路审计印痕 ");
    let inner = block.inner(area);

    let mut status = if let Some(e) = &state.error {
        (format!("error: {e}"), Color::Red)
    } else if state.loading {
        ("loading…".to_string(), Color::Yellow)
    } else {
        (format!("{} entries", filtered_len(state)), Color::Green)
    };
    let filter = match &state.applied_filter {
        Some(t) => format!(" trace: {t}"),
        None => String::new(),
    };
    status.0.push_str(&filter);
    if !state.queried_by.is_empty() {
        status.0.push_str(&format!(" | queried_by: {}", state.queried_by));
    }
    status
        .0
        .push_str(" | [f] filter [g] goto [n] newest · Esc 返回驾驶舱");

    buf.set_string(inner.x, inner.y, status.0, Style::default().fg(status.1));
    // block borders
    buf.set_style(area, Style::default());
    block.render(area, buf);
}

fn render_body(state: &EngramViewState, area: Rect, buf: &mut Buffer) {
    if filtered_len(state) == 0 && state.error.is_none() && !state.loading {
        let para = Paragraph::new("no imprints yet — run a governed call (the gateway /v1/audit will record it)")
            .block(Block::default().borders(Borders::ALL).title(" Engram "))
            .wrap(Wrap { trim: true });
        para.render(area, buf);
        return;
    }

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Ratio(2, 3), Constraint::Ratio(1, 3)].as_ref())
        .split(area);

    render_timeline(state, chunks[0], buf);
    render_detail(state, chunks[1], buf);
}

fn render_timeline(state: &EngramViewState, area: Rect, buf: &mut Buffer) {
    let items: Vec<ListItem> = filtered(state)
        .iter()
        .map(|e| {
            let style = if e.payload.kind == "response" {
                Style::default().fg(Color::DarkGray)
            } else {
                Style::default()
            };
            ListItem::new(e.summary()).style(style)
        })
        .collect();

    let mut list_state = state.list_state.clone();
    if let Some(idx) = state.selected {
        list_state.select(Some(idx.min(filtered_len(state).saturating_sub(1))));
    }

    let title = format!(
        " Timeline ({}{} — visible rows only, virtual list) ",
        filtered_len(state),
        if state.applied_filter.is_some() { " filtered" } else { "" },
    );
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(title))
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▸ ");
    ratatui::widgets::StatefulWidget::render(list, area, buf, &mut list_state);
}

fn render_detail(state: &EngramViewState, area: Rect, buf: &mut Buffer) {
    let block = Block::default().borders(Borders::ALL).title(" Detail ");
    let inner = block.inner(area);
    block.render(area, buf);

    let list = filtered(state);
    let Some(idx) = state.selected.and_then(|i| list.get(i)) else {
        let para = Paragraph::new("select a timeline row (↑/↓)").wrap(Wrap { trim: true });
        para.render(inner, buf);
        return;
    };

    let mut lines: Vec<Line> = Vec::new();
    let key_style = Style::default().fg(Color::Cyan);
    let dim = Style::default().fg(Color::DarkGray);

    lines.push(Line::from(vec![
        Span::styled("kind: ", key_style),
        Span::raw(idx.payload.kind.clone()),
    ]));
    lines.push(Line::from(vec![
        Span::styled("trace: ", key_style),
        Span::raw(idx.payload.trace_id.clone()),
    ]));
    if let Some(c) = idx.caller() {
        lines.push(Line::from(vec![Span::styled("caller: ", key_style), Span::raw(c)]));
    }
    if let Some(d) = idx.destination() {
        lines.push(Line::from(vec![
            Span::styled("dest: ", key_style),
            Span::raw(d),
        ]));
    }
    if let Some(s) = idx.status() {
        lines.push(Line::from(vec![
            Span::styled("status: ", key_style),
            Span::raw(s.to_string()),
        ]));
    }
    let verdicts = idx.verdicts();
    if !verdicts.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("verdicts: ", key_style),
            Span::raw(verdicts.join(", ")),
        ]));
    }
    lines.push(Line::from(""));
    // Chain integrity — the tamper-evidence link.
    lines.push(Line::from(Span::styled("chain", key_style)));
    lines.push(Line::from(vec![
        Span::styled("  prev: ", dim),
        Span::raw(short_hash(&idx.prev_hash)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("  hash: ", dim),
        Span::raw(short_hash(&idx.hash)),
    ]));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("data", key_style)));
    let data_text = serde_json::to_string_pretty(&idx.payload.data)
        .unwrap_or_else(|_| "<unserializable>".to_string());
    for l in data_text.lines().take(24) {
        lines.push(Line::from(Span::raw(l.to_string())));
    }

    let para = Paragraph::new(lines).wrap(Wrap { trim: true });
    para.render(inner, buf);
}

/// Entries after applying the local trace filter (empty filter = all).
fn filtered(state: &EngramViewState) -> Vec<&EngramEntry> {
    match &state.applied_filter {
        Some(f) => state
            .entries
            .iter()
            .filter(|e| e.payload.trace_id.contains(f))
            .collect(),
        None => state.entries.iter().collect(),
    }
}

fn filtered_len(state: &EngramViewState) -> usize {
    filtered(state).len()
}

/// First 16 hex chars — enough to identify a link, short enough to read.
fn short_hash(h: &str) -> String {
    if h.len() > 16 {
        format!("{}…", &h[..16])
    } else {
        h.to_string()
    }
}
