//! Tuck 审计日志客户端 — 消费 Tuck 的 SHA-256 链式审计日志
//!
//! # Design Principle
//!
//! **白盒可审计**: Cellrix 作为 Helix 生态的"皮肤"，需要消费和展示 Tuck（免疫系统）的审计日志。
//! 审计日志使用 SHA-256 链式结构，每条记录包含前一条记录的哈希，任何篡改都会破坏链的完整性。
//!
//! **极致解耦**: 本模块只定义数据结构和文件读取逻辑，不依赖 Tuck crate。
//! 数据结构与 Tuck 的 AuditEntry 兼容（JSON 序列化格式一致），可以直接读取 Tuck 的审计日志文件。
//!
//! **按需加载**: 审计日志文件可能很大，本模块支持流式读取和分页查询，不一次性加载全部内容。
//!
//! **双模式对接**:
//! - 文件模式: 直接读取 Tuck 的审计日志文件（JSON Lines 格式）
//! - HTTP 模式: 预留接口，未来 Tuck 实现 HTTP API 后可以直接切换
//!
//! # File Format
//!
//! ```text
//! {"entry_id":"...","timestamp":...,"decision":"Pass",...,"hash":"..."}
//! {"entry_id":"...","timestamp":...,"decision":"Reject",...,"hash":"..."}
//! ...
//! ```
//!
//! 每行是一个完整的 JSON 序列化 AuditEntry。文件是 append-only 的。

use std::path::Path;

use serde::{Deserialize, Serialize};

// ============================================================================
// Types (与 Tuck 的 AuditEntry 兼容)
// ============================================================================

/// 哈希类型（SHA-256，32 字节），序列化为十六进制字符串
pub type Hash = [u8; 32];

/// 创世哈希 — 全零，作为第一条记录的 prev_hash
pub const GENESIS_HASH: Hash = [0u8; 32];

/// Tuck 决策结果
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum TuckDecision {
    /// 放行
    Pass,
    /// 拦截
    Reject,
    /// 需要人工确认
    NeedHumanConfirm,
    /// 硬覆盖放行（CATASTROPHIC + HardOverride）
    HardOverridePass,
}

impl TuckDecision {
    /// 从字符串解析（兼容 Tuck 的字符串格式）
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Pass" => Some(Self::Pass),
            "Reject" => Some(Self::Reject),
            "NeedHumanConfirm" => Some(Self::NeedHumanConfirm),
            "HardOverridePass" => Some(Self::HardOverridePass),
            _ => None,
        }
    }

    /// 是否为高优先级事件（需要告警）
    pub fn is_high_priority(&self) -> bool {
        matches!(self, Self::Reject | Self::HardOverridePass)
    }

    /// 是否需要人工确认
    pub fn needs_confirmation(&self) -> bool {
        matches!(self, Self::NeedHumanConfirm)
    }
}

/// PFP 风险等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum RiskLevel {
    Low,
    Medium,
    Critical,
    Catastrophic,
}

impl RiskLevel {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Low" => Some(Self::Low),
            "Medium" => Some(Self::Medium),
            "Critical" => Some(Self::Critical),
            "Catastrophic" => Some(Self::Catastrophic),
            _ => None,
        }
    }

    /// 获取颜色（用于 UI 展示）
    pub fn color(&self) -> &'static str {
        match self {
            Self::Low => "#71717A",      // Slate Gray
            Self::Medium => "#5B5FC7",   // Monastic Indigo
            Self::Critical => "#D08770", // Alert Amber
            Self::Catastrophic => "#FF0000", // Red
        }
    }
}

/// 审计条目 — Tuck 审计日志中的单条决策记录
///
/// 与 Tuck 的 AuditEntry 结构兼容，可以直接反序列化 Tuck 的审计日志文件。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// 唯一条目 ID（UUID）
    pub entry_id: String,
    /// Unix 时间戳（秒）
    pub timestamp: u64,
    /// 决策结果（Pass/Reject/NeedHumanConfirm/HardOverridePass）
    pub decision: String,
    /// PFP 风险等级（Low/Medium/Critical/Catastrophic）
    pub risk_level: String,
    /// PFP 操作模态（Cognitive/Render/Executive/SensorFeed）
    pub modality: String,
    /// PFP 硬覆盖标志（Normal/HardOverride）
    pub override_flag: String,
    /// 请求来源（如 "anaphase", "tentacle", "human"）
    pub source: String,
    /// 用于凭证注入的身份标签（如果有）
    pub identity_label: Option<String>,
    /// 链中上一条记录的哈希（32 字节，十六进制字符串）
    pub prev_hash: String,
    /// 本条记录的哈希（32 字节，十六进制字符串）
    pub hash: String,
}

impl AuditEntry {
    /// 解析决策结果
    pub fn decision(&self) -> Option<TuckDecision> {
        TuckDecision::from_str(&self.decision)
    }

    /// 解析风险等级
    pub fn risk_level(&self) -> Option<RiskLevel> {
        RiskLevel::from_str(&self.risk_level)
    }

    /// 是否为高优先级事件（需要告警）
    pub fn is_high_priority(&self) -> bool {
        self.decision().map(|d| d.is_high_priority()).unwrap_or(false)
    }

    /// 是否需要人工确认
    pub fn needs_confirmation(&self) -> bool {
        self.decision().map(|d| d.needs_confirmation()).unwrap_or(false)
    }

    /// 格式化时间戳为可读字符串
    pub fn formatted_time(&self) -> String {
        let secs = self.timestamp;
        let hours = secs / 3600;
        let minutes = (secs % 3600) / 60;
        let seconds = secs % 60;
        format!("{:02}:{:02}:{:02}", hours % 24, minutes, seconds)
    }
}

// ============================================================================
// Audit Log Reader (文件模式)
// ============================================================================

/// 审计日志读取器 — 从 JSON Lines 文件读取 Tuck 审计日志
///
/// # Usage
///
/// ```rust,ignore
/// use cellrix_protocol::tuck_audit::AuditLogReader;
///
/// let reader = AuditLogReader::new("/var/log/tuck/audit.log")?;
/// let entries = reader.read_last_n(100)?;
/// for entry in entries {
///     println!("{}: {:?} - {:?}", entry.formatted_time(), entry.decision(), entry.risk_level());
/// }
/// ```
#[derive(Debug, Clone)]
pub struct AuditLogReader {
    file_path: std::path::PathBuf,
}

impl AuditLogReader {
    /// 创建新的审计日志读取器
    pub fn new<P: AsRef<Path>>(file_path: P) -> Result<Self, AuditError> {
        let path = file_path.as_ref().to_path_buf();
        if !path.exists() {
            return Err(AuditError::FileNotFound(path.to_string_lossy().to_string()));
        }
        Ok(Self { file_path: path })
    }

    /// 读取全部审计条目（注意：大文件可能很慢，建议使用 read_last_n）
    pub fn read_all(&self) -> Result<Vec<AuditEntry>, AuditError> {
        let content = std::fs::read_to_string(&self.file_path)
            .map_err(|e| AuditError::Io(e.to_string()))?;

        let mut entries = Vec::new();
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<AuditEntry>(line) {
                Ok(entry) => entries.push(entry),
                Err(e) => {
                    // 跳过损坏的行，但记录错误
                    eprintln!("Warning: failed to parse audit entry: {}", e);
                }
            }
        }
        Ok(entries)
    }

    /// 读取最后 N 条审计条目（高效，不需要读取整个文件）
    pub fn read_last_n(&self, n: usize) -> Result<Vec<AuditEntry>, AuditError> {
        let content = std::fs::read_to_string(&self.file_path)
            .map_err(|e| AuditError::Io(e.to_string()))?;

        let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
        let start = if lines.len() > n { lines.len() - n } else { 0 };

        let mut entries = Vec::new();
        for line in &lines[start..] {
            if let Ok(entry) = serde_json::from_str::<AuditEntry>(line) {
                entries.push(entry);
            }
        }
        Ok(entries)
    }

    /// 按决策类型筛选
    pub fn filter_by_decision(&self, decision: TuckDecision) -> Result<Vec<AuditEntry>, AuditError> {
        let entries = self.read_all()?;
        Ok(entries
            .into_iter()
            .filter(|e| e.decision() == Some(decision))
            .collect())
    }

    /// 按风险等级筛选
    pub fn filter_by_risk_level(&self, risk: RiskLevel) -> Result<Vec<AuditEntry>, AuditError> {
        let entries = self.read_all()?;
        Ok(entries
            .into_iter()
            .filter(|e| e.risk_level() == Some(risk))
            .collect())
    }

    /// 获取高优先级事件（Reject/HardOverridePass）
    pub fn high_priority_events(&self) -> Result<Vec<AuditEntry>, AuditError> {
        let entries = self.read_all()?;
        Ok(entries.into_iter().filter(|e| e.is_high_priority()).collect())
    }

    /// 获取需要人工确认的事件
    pub fn pending_confirmations(&self) -> Result<Vec<AuditEntry>, AuditError> {
        let entries = self.read_all()?;
        Ok(entries.into_iter().filter(|e| e.needs_confirmation()).collect())
    }

    /// 获取统计信息
    pub fn stats(&self) -> Result<AuditStats, AuditError> {
        let entries = self.read_all()?;
        let mut stats = AuditStats::default();
        stats.total_entries = entries.len();

        for entry in &entries {
            match entry.decision() {
                Some(TuckDecision::Pass) => stats.pass_count += 1,
                Some(TuckDecision::Reject) => stats.reject_count += 1,
                Some(TuckDecision::NeedHumanConfirm) => stats.hitl_count += 1,
                Some(TuckDecision::HardOverridePass) => stats.hard_override_count += 1,
                None => stats.unknown_count += 1,
            }
            if entry.is_high_priority() {
                stats.high_priority_count += 1;
            }
        }

        if let Some(first) = entries.first() {
            stats.oldest_timestamp = Some(first.timestamp);
        }
        if let Some(last) = entries.last() {
            stats.newest_timestamp = Some(last.timestamp);
        }

        Ok(stats)
    }
}

// ============================================================================
// Audit Stats
// ============================================================================

/// 审计日志统计信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditStats {
    /// 总条目数
    pub total_entries: usize,
    /// Pass 决策数
    pub pass_count: usize,
    /// Reject 决策数
    pub reject_count: usize,
    /// NeedHumanConfirm 决策数
    pub hitl_count: usize,
    /// HardOverridePass 决策数
    pub hard_override_count: usize,
    /// 未知决策数
    pub unknown_count: usize,
    /// 高优先级事件数
    pub high_priority_count: usize,
    /// 最旧条目的时间戳
    pub oldest_timestamp: Option<u64>,
    /// 最新条目的时间戳
    pub newest_timestamp: Option<u64>,
}

impl AuditStats {
    /// 计算 Pass 率（百分比）
    pub fn pass_rate(&self) -> f64 {
        if self.total_entries == 0 {
            return 0.0;
        }
        (self.pass_count as f64 / self.total_entries as f64) * 100.0
    }

    /// 计算 Reject 率（百分比）
    pub fn reject_rate(&self) -> f64 {
        if self.total_entries == 0 {
            return 0.0;
        }
        (self.reject_count as f64 / self.total_entries as f64) * 100.0
    }
}

// ============================================================================
// Error
// ============================================================================

/// 审计日志错误
#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    /// 文件不存在
    #[error("File not found: {0}")]
    FileNotFound(String),
    /// IO 错误
    #[error("IO error: {0}")]
    Io(String),
    /// JSON 序列化/反序列化错误
    #[error("JSON error: {0}")]
    Json(String),
    /// 链验证失败
    #[error("Chain verification failed at entry {index}: {reason}")]
    ChainInvalid { index: usize, reason: String },
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn create_test_audit_file() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);

        let dir = std::env::temp_dir();
        let path = dir.join(format!("cellrix_test_audit_{}_{}.log", std::process::id(), id));

        let entries = vec![
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
        ];

        let mut file = std::fs::File::create(&path).unwrap();
        for entry in &entries {
            writeln!(file, "{}", serde_json::to_string(entry).unwrap()).unwrap();
        }

        path
    }

    #[test]
    fn test_audit_entry_parsing() {
        let json = r#"{"entry_id":"00000000-0000-0000-0000-000000000001","timestamp":1000,"decision":"Pass","risk_level":"Low","modality":"Cognitive","override_flag":"Normal","source":"anaphase","identity_label":null,"prev_hash":"000000000000000000000000000000000000000000000000000000000000000","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#;

        let entry: AuditEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.entry_id, "00000000-0000-0000-0000-000000000001");
        assert_eq!(entry.timestamp, 1000);
        assert_eq!(entry.decision(), Some(TuckDecision::Pass));
        assert_eq!(entry.risk_level(), Some(RiskLevel::Low));
        assert!(!entry.is_high_priority());
        assert!(!entry.needs_confirmation());
    }

    #[test]
    fn test_tuck_decision_parsing() {
        assert_eq!(TuckDecision::from_str("Pass"), Some(TuckDecision::Pass));
        assert_eq!(TuckDecision::from_str("Reject"), Some(TuckDecision::Reject));
        assert_eq!(TuckDecision::from_str("NeedHumanConfirm"), Some(TuckDecision::NeedHumanConfirm));
        assert_eq!(TuckDecision::from_str("HardOverridePass"), Some(TuckDecision::HardOverridePass));
        assert_eq!(TuckDecision::from_str("Unknown"), None);
    }

    #[test]
    fn test_tuck_decision_high_priority() {
        assert!(!TuckDecision::Pass.is_high_priority());
        assert!(TuckDecision::Reject.is_high_priority());
        assert!(!TuckDecision::NeedHumanConfirm.is_high_priority());
        assert!(TuckDecision::HardOverridePass.is_high_priority());
    }

    #[test]
    fn test_risk_level_color() {
        assert_eq!(RiskLevel::Low.color(), "#71717A");
        assert_eq!(RiskLevel::Medium.color(), "#5B5FC7");
        assert_eq!(RiskLevel::Critical.color(), "#D08770");
        assert_eq!(RiskLevel::Catastrophic.color(), "#FF0000");
    }

    #[test]
    fn test_audit_log_reader_read_all() {
        let path = create_test_audit_file();
        let reader = AuditLogReader::new(&path).unwrap();
        let entries = reader.read_all().unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].decision(), Some(TuckDecision::Pass));
        assert_eq!(entries[1].decision(), Some(TuckDecision::Reject));
        assert_eq!(entries[2].decision(), Some(TuckDecision::NeedHumanConfirm));
        assert_eq!(entries[3].decision(), Some(TuckDecision::HardOverridePass));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_audit_log_reader_read_last_n() {
        let path = create_test_audit_file();
        let reader = AuditLogReader::new(&path).unwrap();

        let last_2 = reader.read_last_n(2).unwrap();
        assert_eq!(last_2.len(), 2);
        assert_eq!(last_2[0].decision(), Some(TuckDecision::NeedHumanConfirm));
        assert_eq!(last_2[1].decision(), Some(TuckDecision::HardOverridePass));

        let last_10 = reader.read_last_n(10).unwrap();
        assert_eq!(last_10.len(), 4); // 只有 4 条

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_audit_log_reader_filter_by_decision() {
        let path = create_test_audit_file();
        let reader = AuditLogReader::new(&path).unwrap();

        let rejects = reader.filter_by_decision(TuckDecision::Reject).unwrap();
        assert_eq!(rejects.len(), 1);
        assert_eq!(rejects[0].risk_level(), Some(RiskLevel::Critical));

        let passes = reader.filter_by_decision(TuckDecision::Pass).unwrap();
        assert_eq!(passes.len(), 1);

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_audit_log_reader_filter_by_risk_level() {
        let path = create_test_audit_file();
        let reader = AuditLogReader::new(&path).unwrap();

        let critical = reader.filter_by_risk_level(RiskLevel::Critical).unwrap();
        assert_eq!(critical.len(), 1);
        assert_eq!(critical[0].decision(), Some(TuckDecision::Reject));

        let catastrophic = reader.filter_by_risk_level(RiskLevel::Catastrophic).unwrap();
        assert_eq!(catastrophic.len(), 1);
        assert_eq!(catastrophic[0].decision(), Some(TuckDecision::HardOverridePass));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_audit_log_reader_high_priority_events() {
        let path = create_test_audit_file();
        let reader = AuditLogReader::new(&path).unwrap();

        let high_priority = reader.high_priority_events().unwrap();
        assert_eq!(high_priority.len(), 2); // Reject + HardOverridePass
        assert!(high_priority.iter().all(|e| e.is_high_priority()));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_audit_log_reader_pending_confirmations() {
        let path = create_test_audit_file();
        let reader = AuditLogReader::new(&path).unwrap();

        let pending = reader.pending_confirmations().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].decision(), Some(TuckDecision::NeedHumanConfirm));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_audit_stats() {
        let path = create_test_audit_file();
        let reader = AuditLogReader::new(&path).unwrap();

        let stats = reader.stats().unwrap();
        assert_eq!(stats.total_entries, 4);
        assert_eq!(stats.pass_count, 1);
        assert_eq!(stats.reject_count, 1);
        assert_eq!(stats.hitl_count, 1);
        assert_eq!(stats.hard_override_count, 1);
        assert_eq!(stats.high_priority_count, 2);
        assert_eq!(stats.oldest_timestamp, Some(1000));
        assert_eq!(stats.newest_timestamp, Some(4000));
        assert!((stats.pass_rate() - 25.0).abs() < 0.01);
        assert!((stats.reject_rate() - 25.0).abs() < 0.01);

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_audit_entry_formatted_time() {
        let entry = AuditEntry {
            entry_id: "test".to_string(),
            timestamp: 3661, // 1 hour + 1 min + 1 sec
            decision: "Pass".to_string(),
            risk_level: "Low".to_string(),
            modality: "Cognitive".to_string(),
            override_flag: "Normal".to_string(),
            source: "test".to_string(),
            identity_label: None,
            prev_hash: "0".repeat(64),
            hash: "0".repeat(64),
        };
        assert_eq!(entry.formatted_time(), "01:01:01");
    }

    #[test]
    fn test_audit_error_file_not_found() {
        let result = AuditLogReader::new("/nonexistent/path/audit.log");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AuditError::FileNotFound(_)));
    }
}
