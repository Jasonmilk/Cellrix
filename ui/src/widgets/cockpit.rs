//! Anaphase Cockpit — the white-box driving window (candidate G).
//!
//! # Design Principle
//!
//! **白盒可观测**: every tool call lands in the ledger (append-only); the
//! cockpit projects it as a reviewable stream — mode / episode / verdicts.
//!
//! **极致解耦**: the widget depends only on cellrix-protocol data structures
//! (`AgentSnapshot`), never on the Anaphase crate or transport internals.
//!
//! # Components
//!
//! - `CockpitWidget`: mode bar + episode timeline + ledger review list.

use cellrix_protocol::anaphase::{AgentSnapshot, InteractionMode, LedgerEntry};
use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Widget},
};

/// Anaphase cockpit widget — renders the agent snapshot projection.
pub struct CockpitWidget<'a> {
    snapshot: &'a AgentSnapshot,
}

impl<'a> CockpitWidget<'a> {
    /// Create the cockpit from a snapshot projection.
    pub fn new(snapshot: &'a AgentSnapshot) -> Self {
        Self { snapshot }
    }

    fn mode_style(&self) -> Style {
        match self.snapshot.mode {
            InteractionMode::Drive => Style::default().fg(Color::Cyan),
            InteractionMode::Partner => Style::default().fg(Color::Green),
            InteractionMode::Survive => Style::default().fg(Color::Magenta),
        }
    }

    fn mode_label(&self) -> &'static str {
        match self.snapshot.mode {
            InteractionMode::Drive => "DRIVE",
            InteractionMode::Partner => "PARTNER",
            InteractionMode::Survive => "SURVIVE",
        }
    }
}

impl Widget for CockpitWidget<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .title(" Anaphase Cockpit ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Blue));
        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height < 3 {
            return;
        }

        // Row 1: mode | state | episode summary
        let ep_text = match &self.snapshot.episode {
            Some(ep) => format!("{} step={} \"{}\"", ep.id, ep.step, ep.first_input),
            None => "no active episode".to_string(),
        };
        let mode_span = Span::styled(
            format!("[{}]", self.mode_label()),
            self.mode_style().add_modifier(Modifier::BOLD),
        );
        let line1 = Line::from(vec![
            mode_span,
            Span::raw(format!("  state={}  ", self.snapshot.state)),
            Span::styled("episode: ", Style::default().fg(Color::DarkGray)),
            Span::raw(ep_text),
        ]);

        // Row 2+: ledger review (latest first, capped to available height)
        let mut lines = vec![line1];
        let max_rows = inner.height.saturating_sub(2).min(6) as usize;
        for entry in self.snapshot.ledger.iter().take(max_rows) {
            lines.push(Span::styled(
                ledger_line(entry),
                ledger_style(entry),
            )
            .into());
        }
        if self.snapshot.ledger.is_empty() {
            lines.push(Line::from(Span::styled(
                "ledger: (empty — no calls executed yet)",
                Style::default().fg(Color::DarkGray),
            )));
        } else if self.snapshot.ledger.len() as u16 > max_rows as u16 {
            lines.push(Line::from(Span::styled(
                format!("... {} more", self.snapshot.ledger.len() - max_rows),
                Style::default().fg(Color::DarkGray),
            )));
        }

        Paragraph::new(lines).render(inner, buf);
    }
}

/// One compact ledger line (white-box review row).
fn ledger_line(entry: &LedgerEntry) -> String {
    match entry {
        LedgerEntry::Verdict {
            status,
            job_id,
            retry_due,
            parent_id,
        } => {
            let retry = retry_due
                .map(|d| format!(" retry_due={d}"))
                .unwrap_or_default();
            let parent = parent_id
                .as_ref()
                .map(|p| format!(" parent={p}"))
                .unwrap_or_default();
            let status_str = match status {
                cellrix_protocol::anaphase::VerdictStatus::Met => "MET",
                cellrix_protocol::anaphase::VerdictStatus::Unmet => "UNMET",
            };
            format!("  {} {} (trace={}){}{}", status_str, job_id, job_id, parent, retry)
        }
        LedgerEntry::Blocked { job_id, tool } => {
            format!("  BLOCKED {} tool={}", job_id, tool)
        }
    }
}

fn ledger_style(entry: &LedgerEntry) -> Style {
    match entry {
        LedgerEntry::Verdict { status, .. } => match status {
            cellrix_protocol::anaphase::VerdictStatus::Met => {
                Style::default().fg(Color::Green)
            }
            cellrix_protocol::anaphase::VerdictStatus::Unmet => {
                Style::default().fg(Color::Yellow)
            }
        },
        LedgerEntry::Blocked { .. } => Style::default().fg(Color::Red),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cellrix_protocol::anaphase::{
        AgentSnapshot, EpisodeView, InteractionMode, LedgerEntry, VerdictStatus,
    };

    fn test_snapshot() -> AgentSnapshot {
        AgentSnapshot {
            mode: InteractionMode::Partner,
            state: "Reflection".to_string(),
            episode: Some(EpisodeView {
                id: "ep-abc".to_string(),
                first_input: "hello".to_string(),
                step: 2,
            }),
            ledger: vec![
                LedgerEntry::Verdict {
                    status: VerdictStatus::Met,
                    job_id: "job-1".to_string(),
                    retry_due: None,
                    parent_id: None,
                },
                LedgerEntry::Blocked {
                    job_id: "job-2".to_string(),
                    tool: "shutdown".to_string(),
                },
            ],
        }
    }

    #[test]
    fn test_cockpit_creation() {
        let snap = test_snapshot();
        let widget = CockpitWidget::new(&snap);
        assert_eq!(widget.mode_label(), "PARTNER");
    }

    #[test]
    fn test_cockpit_renders_mode_episode_ledger() {
        let snap = test_snapshot();
        let mut buf = Buffer::empty(Rect::new(0, 0, 100, 8));
        CockpitWidget::new(&snap).render(Rect::new(0, 0, 100, 8), &mut buf);
        let text = buf.content.iter().map(|c| c.symbol()).collect::<String>();
        assert!(text.contains("PARTNER"), "mode bar missing");
        assert!(text.contains("Reflection"), "state missing");
        assert!(text.contains("ep-abc"), "episode missing");
        assert!(text.contains("hello"), "episode anchor missing");
        assert!(text.contains("MET"), "ledger verdict missing");
        assert!(text.contains("BLOCKED"), "ledger blocked missing");
        assert!(text.contains("shutdown"), "blocked tool missing");
    }

    #[test]
    fn test_cockpit_empty_ledger() {
        let snap = AgentSnapshot {
            mode: InteractionMode::Drive,
            state: "Perception".to_string(),
            episode: None,
            ledger: vec![],
        };
        let mut buf = Buffer::empty(Rect::new(0, 0, 100, 5));
        CockpitWidget::new(&snap).render(Rect::new(0, 0, 100, 5), &mut buf);
        let text = buf.content.iter().map(|c| c.symbol()).collect::<String>();
        assert!(text.contains("DRIVE"), "mode bar missing");
        assert!(text.contains("no active episode"), "episode fallback missing");
        assert!(text.contains("ledger: (empty"), "empty ledger hint missing");
    }
}
