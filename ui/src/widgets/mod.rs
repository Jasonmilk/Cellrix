use ratatui::widgets::Widget;
use cellrix_protocol::{SemanticNode, NodeType};
use crate::Theme;
use cellrix_layout::LayoutOutput;
use crate::FocusManager;

mod state_tree;
mod text_panel;
mod action_button;
mod progress_bar;
mod code_diff;
mod metrics;
mod fallback;
mod audit;
mod pfp_widget;
mod security_notification;
mod helix_mind_widget;
mod anaphase_widget;
mod cockpit;
mod tentacle_widget;

pub use state_tree::StateTreeWidget;
pub use text_panel::TextPanelWidget;
pub use action_button::ActionButtonWidget;
pub use progress_bar::ProgressBarWidget;
pub use code_diff::CodeDiffWidget;
pub use metrics::MetricsWidget;
pub use fallback::FallbackWidget;
pub use audit::{AuditLogState, AuditLogWidget, AuditStatsWidget, AuditDetailWidget, AuditFilter};
pub use pfp_widget::{PFPWidget, RiskLevelIndicator, PFPStatusBar};
pub use security_notification::{
    SecurityEvent, SecurityEventType, SecurityEventStatus, SecurityEventQueue,
    NotificationBanner, ConfirmDialog, ConfirmOption, EmergencyOverlay,
};
pub use helix_mind_widget::{
    CognitiveStatusWidget, MetabolismStatusWidget, KnowledgeGraphWidget, HelixSnapshotWidget,
};
pub use anaphase_widget::{
    CognitivePhaseIndicator, TaskDagWidget, HITLWidget, LifecycleWidget, AnaphaseSnapshotWidget,
};
pub use cockpit::CockpitWidget;
pub use tentacle_widget::{
    ToolExecutionWidget, PluginAuditWidget, ToolCallChainWidget, TentacleSnapshotWidget,
};

/// Allow dead code here as these context fields are reserved for 
/// downstream widget rendering modules in the UI lifecycle.
#[allow(dead_code)]
pub struct WidgetContext<'a> {
    pub theme: &'a Theme,
    pub snapshot: &'a cellrix_protocol::SemanticSnapshot,
    pub layout: &'a LayoutOutput,
    pub is_zen: bool,
    pub focus_manager: &'a FocusManager,
}

/// Allow dead code here as this factory function is a public API 
/// designed to be consumed by external widget instantiations.
#[allow(dead_code)]
pub fn create_widget<'a>(node: &'a SemanticNode, ctx: &'a WidgetContext) -> Box<dyn Widget + 'a> {
    match node.node_type {
        NodeType::StateTree => Box::new(StateTreeWidget::new(node, ctx)),
        NodeType::TextPanel => Box::new(TextPanelWidget::new(node, ctx)),
        NodeType::ActionButton => Box::new(ActionButtonWidget::new(node, ctx)),
        NodeType::ProgressBar => Box::new(ProgressBarWidget::new(node, ctx)),
        NodeType::CodeDiff => Box::new(CodeDiffWidget::new(node, ctx)),
        NodeType::Metrics => Box::new(MetricsWidget::new(node, ctx)),
        NodeType::Unknown => Box::new(FallbackWidget::new(node, ctx)),
    }
}
