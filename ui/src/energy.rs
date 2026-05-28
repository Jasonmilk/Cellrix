//! Energy modes: discrete (lowest), reactive, continuous.

use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnergyMode {
    /// Zero heartbeat, only redraw on events. For remote sessions or low-power.
    Discrete,
    /// 150ms fade transitions on focus changes.
    Reactive,
    /// 60fps animations (GPU-accelerated terminal).
    Continuous,
}

impl EnergyMode {
    /// Auto-detect based on environment (simplified heuristic).
    pub fn detect() -> Self {
        if std::env::var("CELLRIX_AESTHETIC").ok().as_deref() == Some("discrete") {
            return EnergyMode::Discrete;
        }
        // Check for SSH or low-color term.
        if std::env::var("TERM").unwrap_or_default().contains("256") {
            EnergyMode::Reactive
        } else {
            EnergyMode::Discrete
        }
    }

    pub fn frame_interval(&self) -> Option<Duration> {
        match self {
            EnergyMode::Discrete => None,
            EnergyMode::Reactive => Some(Duration::from_millis(150)),
            EnergyMode::Continuous => Some(Duration::from_millis(16)),
        }
    }

    pub fn should_animate_transitions(&self) -> bool {
        matches!(self, EnergyMode::Reactive | EnergyMode::Continuous)
    }
}
