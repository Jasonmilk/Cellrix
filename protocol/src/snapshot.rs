use serde::{Deserialize, Serialize};
use crate::LayoutHints;

/// Agent 的状态投影（CAP协议 snapshot端点）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSnapshot {
    pub epoch_time: u64,
    pub status: String,
    pub metrics: serde_json::Value,
    pub semantic_tree: Vec<SemanticNode>,
    pub active_focus: Option<String>,
    pub layout_overrides: Option<LayoutHints>,
    /// PFP-xCF14 物理特征（4 字节，可选）
    ///
    /// CI-144 v2.0 协议家族的物理特征层，携带 Risk-Level/Modality/Stance 等
    /// 物理安全元数据。Cellrix 作为"皮肤"，可以消费并展示这些特征。
    ///
    /// 向后兼容：旧快照不包含此字段，反序列化时为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pfp: Option<[u8; 4]>,
    /// SAP-xCF14 安全证明（28 字节，可选）
    ///
    /// CI-144 v2.0 协议家族的安全证明层，携带 Seq-Counter/PAH-Hash/PAH-Signature。
    /// 低安全场景可省略，仅发送 PFP。
    ///
    /// 向后兼容：旧快照不包含此字段，反序列化时为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sap: Option<[u8; 28]>,
}

/// 语义树中的单个节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticNode {
    pub id: String,
    pub node_type: NodeType,
    pub label: String,
    pub content: serde_json::Value,
    pub slot_binding: Option<String>,
    pub focused: bool,
}

/// 节点类型（未知类型安全降级）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    StateTree,
    TextPanel,
    ActionButton,
    ProgressBar,
    CodeDiff,
    Metrics,
    /// 未知节点类型（容错解析时使用）
    #[serde(other)]
    Unknown,
}

impl SemanticSnapshot {
    /// 创建新的语义快照（默认无 PFP/SAP）
    pub fn new(epoch_time: u64, status: String) -> Self {
        Self {
            epoch_time,
            status,
            metrics: serde_json::Value::Null,
            semantic_tree: Vec::new(),
            active_focus: None,
            layout_overrides: None,
            pfp: None,
            sap: None,
        }
    }

    /// 设置 PFP 物理特征
    pub fn with_pfp(mut self, pfp_bytes: [u8; 4]) -> Self {
        self.pfp = Some(pfp_bytes);
        self
    }

    /// 设置 SAP 安全证明
    pub fn with_sap(mut self, sap_bytes: [u8; 28]) -> Self {
        self.sap = Some(sap_bytes);
        self
    }

    /// 解析 PFP（如果存在且有效）
    pub fn parse_pfp(&self) -> Option<crate::pfp::PFP> {
        self.pfp.and_then(|bytes| {
            let pfp = crate::pfp::PFP::from_bytes(bytes);
            if pfp.is_valid() { Some(pfp) } else { None }
        })
    }

    /// 解析 SAP（如果存在且有效）
    pub fn parse_sap(&self) -> Option<crate::sap::SAP> {
        self.sap.and_then(|bytes| {
            let sap = crate::sap::SAP::from_bytes(bytes);
            if sap.is_valid() { Some(sap) } else { None }
        })
    }

    /// 获取有效 Risk-Level（考虑 PFP 和 Rule 6 降级）
    pub fn effective_risk_level(&self) -> Option<crate::pfp::RiskLevel> {
        self.parse_pfp().map(|p| p.effective_risk_level())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pfp::{PFPBuilder, RiskLevel, Modality};
    use crate::sap::SAPBuilder;

    #[test]
    fn test_snapshot_new_default() {
        let snap = SemanticSnapshot::new(12345, "active".to_string());
        assert_eq!(snap.epoch_time, 12345);
        assert_eq!(snap.status, "active");
        assert!(snap.pfp.is_none());
        assert!(snap.sap.is_none());
        assert!(snap.semantic_tree.is_empty());
    }

    #[test]
    fn test_snapshot_with_pfp() {
        let pfp = PFPBuilder::new()
            .modality(Modality::Executive)
            .risk_level(RiskLevel::Critical)
            .build();
        let snap = SemanticSnapshot::new(100, "test".to_string())
            .with_pfp(*pfp.as_bytes());

        assert!(snap.pfp.is_some());
        let parsed = snap.parse_pfp().unwrap();
        assert_eq!(parsed.modality(), Modality::Executive);
        assert_eq!(parsed.risk_level(), RiskLevel::Critical);
    }

    #[test]
    fn test_snapshot_with_sap() {
        let sap = SAPBuilder::new().seq_counter(42).build();
        let snap = SemanticSnapshot::new(100, "test".to_string())
            .with_sap(*sap.as_bytes());

        assert!(snap.sap.is_some());
        let parsed = snap.parse_sap().unwrap();
        assert_eq!(parsed.seq_counter(), 42);
    }

    #[test]
    fn test_snapshot_with_pfp_and_sap() {
        let pfp = PFPBuilder::new()
            .risk_level(RiskLevel::Critical)
            .replay_enable(crate::pfp::ReplayEnable::Enabled)
            .build();
        let sap = SAPBuilder::new().seq_counter(100).build();
        let snap = SemanticSnapshot::new(200, "combined".to_string())
            .with_pfp(*pfp.as_bytes())
            .with_sap(*sap.as_bytes());

        assert!(snap.pfp.is_some());
        assert!(snap.sap.is_some());
        assert_eq!(snap.effective_risk_level(), Some(RiskLevel::Critical));
    }

    #[test]
    fn test_snapshot_invalid_pfp_returns_none() {
        let snap = SemanticSnapshot::new(100, "test".to_string())
            .with_pfp([0x00, 0x00, 0x00, 0x00]); // 无效魔数

        assert!(snap.pfp.is_some());
        assert!(snap.parse_pfp().is_none());
        assert!(snap.effective_risk_level().is_none());
    }

    #[test]
    fn test_snapshot_no_pfp_returns_none() {
        let snap = SemanticSnapshot::new(100, "test".to_string());
        assert!(snap.parse_pfp().is_none());
        assert!(snap.parse_sap().is_none());
        assert!(snap.effective_risk_level().is_none());
    }

    #[test]
    fn test_snapshot_rule6_replay_disabled() {
        // Replay-Enable=0, Risk-Level=Catastrophic → effective=Medium
        let pfp = PFPBuilder::new()
            .risk_level(RiskLevel::Catastrophic)
            .replay_enable(crate::pfp::ReplayEnable::Disabled)
            .build();
        let snap = SemanticSnapshot::new(100, "test".to_string())
            .with_pfp(*pfp.as_bytes());

        assert_eq!(snap.effective_risk_level(), Some(RiskLevel::Medium));
    }

    #[test]
    fn test_snapshot_serde_backward_compat() {
        // 旧格式 JSON（无 pfp/sap 字段）应该能正常反序列化
        let json = r#"{
            "epoch_time": 12345,
            "status": "active",
            "metrics": null,
            "semantic_tree": [],
            "active_focus": null,
            "layout_overrides": null
        }"#;

        let snap: SemanticSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(snap.epoch_time, 12345);
        assert!(snap.pfp.is_none());
        assert!(snap.sap.is_none());
    }

    #[test]
    fn test_snapshot_serde_with_pfp() {
        let pfp = PFPBuilder::new()
            .risk_level(RiskLevel::Critical)
            .replay_enable(crate::pfp::ReplayEnable::Enabled)
            .build();
        let snap = SemanticSnapshot::new(100, "test".to_string())
            .with_pfp(*pfp.as_bytes());

        let json = serde_json::to_string(&snap).unwrap();
        assert!(json.contains("\"pfp\""));

        let parsed: SemanticSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.pfp, snap.pfp);
        assert_eq!(parsed.effective_risk_level(), Some(RiskLevel::Critical));
    }

    #[test]
    fn test_snapshot_serde_skip_none_pfp() {
        // 无 PFP 时，序列化应跳过 pfp 字段
        let snap = SemanticSnapshot::new(100, "test".to_string());
        let json = serde_json::to_string(&snap).unwrap();
        assert!(!json.contains("\"pfp\""));
        assert!(!json.contains("\"sap\""));
    }
}
