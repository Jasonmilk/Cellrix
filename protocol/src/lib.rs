//! # cellrix-protocol — CommonIntents 协议栈的物理绑定
//!
//! 本crate为整个Helix生态提供：
//! - CIS (结构化意图描述语言) 的数据类型：`CapabilityManifest`, `SemanticSnapshot`
//! - CAP (共识确认协议) 的数据类型：`ActionRequest`, `ActionResponse`
//! - 视图哈希的接口定义（实际算法由上层实现）
//! - 宽容解析器：单个节点损坏不影响整体快照
//! - 与UI库解耦的通用坐标系（`LayoutRect`, u16精度）

mod manifest;
mod snapshot;
mod action;
mod view_hash;
mod parser;
mod coords;
mod agent_event;

pub use manifest::*;
pub use snapshot::*;
pub use action::*;
pub use view_hash::*;
pub use parser::*;
pub use coords::*;
pub use agent_event::AgentEvent;

/// 本crate统一的错误类型
#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("JSON解析失败: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("节点解析失败，已降级为Unknown: {0}")]
    NodeFallback(String),

    #[error("缺少必要字段: {0}")]
    MissingField(&'static str),

    #[error("视图哈希计算错误: {0}")]
    HashError(String),
}
