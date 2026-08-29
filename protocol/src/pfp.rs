//! PFP-xCF14 — Physical Feature Protocol（物理特征协议，冻结层）
//!
//! PFP 是 CI-144 协议家族的物理特征层，提供明文、固定偏移、可被 Tuck 硬实时读取的物理元数据。
//! 总长度 4 字节（32 bits），Tuck 只读这 4 字节做硬实时决策。
//!
//! **冻结策略**：PFP-xCF14 一旦定稿，永远不变。任何修改必须产生新版本（如 PFP-xCF15）。
//!
//! 对齐：BIND-19 v2.0-alpha 参考实现
//! 规范：https://github.com/CommonIntents/PFP-xCF14

/// PFP 总长度（字节）
pub const PFP_SIZE: usize = 4;

/// CI-144 家族魔数（2 字节，大端序 = 0xCF14）
pub const FAMILY_MAGIC: u16 = 0xCF14;

/// PFP 子协议 ID
pub const PFP_PROTOCOL_ID: u8 = 0x00;

// ─── 枚举类型 ───────────────────────────────────────────────

/// 操作模态（PFP Byte2 bit 0-1）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum Modality {
    #[default]
    Cognitive = 0,
    Render = 1,
    Executive = 2,
    SensorFeed = 3,
}

impl Modality {
    pub fn from_bits(bits: u8) -> Self {
        match bits & 0b11 {
            0 => Self::Cognitive,
            1 => Self::Render,
            2 => Self::Executive,
            _ => Self::SensorFeed,
        }
    }

    pub fn to_bits(self) -> u8 {
        self as u8
    }
}

/// 风险等级（PFP Byte2 bit 2-3）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
#[repr(u8)]
pub enum RiskLevel {
    #[default]
    Low = 0,
    Medium = 1,
    Critical = 2,
    Catastrophic = 3,
}

impl RiskLevel {
    pub fn from_bits(bits: u8) -> Self {
        match bits & 0b11 {
            0 => Self::Low,
            1 => Self::Medium,
            2 => Self::Critical,
            _ => Self::Catastrophic,
        }
    }

    pub fn to_bits(self) -> u8 {
        self as u8
    }
}

/// 本体姿态（PFP Byte2 bit 4-5）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum BodyStance {
    #[default]
    Seated = 0,
    Standing = 1,
    Moving = 2,
    Unknown = 3,
}

impl BodyStance {
    pub fn from_bits(bits: u8) -> Self {
        match bits & 0b11 {
            0 => Self::Seated,
            1 => Self::Standing,
            2 => Self::Moving,
            _ => Self::Unknown,
        }
    }

    pub fn to_bits(self) -> u8 {
        self as u8
    }
}

/// 临边/高危环境（PFP Byte2 bit 6-7）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum ProximityEdge {
    #[default]
    Safe = 0,
    Warning = 1,
    Danger = 2,
    CriticalEdge = 3,
}

impl ProximityEdge {
    pub fn from_bits(bits: u8) -> Self {
        match bits & 0b11 {
            0 => Self::Safe,
            1 => Self::Warning,
            2 => Self::Danger,
            _ => Self::CriticalEdge,
        }
    }

    pub fn to_bits(self) -> u8 {
        self as u8
    }
}

/// 输出目的地（PFP Byte3 bit 0）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum OutputDest {
    #[default]
    Internal = 0,
    External = 1,
}

impl OutputDest {
    pub fn from_bit(bit: bool) -> Self {
        if bit { Self::External } else { Self::Internal }
    }

    pub fn to_bit(self) -> bool {
        self == Self::External
    }
}

/// 硬覆盖标志（PFP Byte3 bit 1）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum OverrideFlag {
    #[default]
    Normal = 0,
    HardOverride = 1,
}

impl OverrideFlag {
    pub fn from_bit(bit: bool) -> Self {
        if bit { Self::HardOverride } else { Self::Normal }
    }

    pub fn to_bit(self) -> bool {
        self == Self::HardOverride
    }
}

/// 重放保护使能（PFP Byte3 bit 2）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum ReplayEnable {
    #[default]
    Disabled = 0,
    Enabled = 1,
}

impl ReplayEnable {
    pub fn from_bit(bit: bool) -> Self {
        if bit { Self::Enabled } else { Self::Disabled }
    }

    pub fn to_bit(self) -> bool {
        self == Self::Enabled
    }
}

// ─── PFP 核心结构体 ─────────────────────────────────────────

/// PFP-xCF14 物理特征协议（4 字节，零拷贝视图）
///
/// 内存布局：
/// ```text
/// Byte 0-1: Family-Magic (0xCF14, 大端序)
/// Byte 2:
///   bit 0-1: Modality
///   bit 2-3: Risk-Level
///   bit 4-5: Body-Stance
///   bit 6-7: Proximity-Edge
/// Byte 3:
///   bit 0:   Output-Dest
///   bit 1:   Override-Flag
///   bit 2:   Replay-Enable
///   bit 3-7: Reserved (must be 0)
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PFP {
    bytes: [u8; PFP_SIZE],
}

impl PFP {
    /// 从字节数组创建 PFP（零拷贝）
    pub fn from_bytes(bytes: [u8; PFP_SIZE]) -> Self {
        Self { bytes }
    }

    /// 从切片创建 PFP（拷贝，需确保长度 >= 4）
    pub fn from_slice(slice: &[u8]) -> Option<Self> {
        if slice.len() < PFP_SIZE {
            return None;
        }
        let mut bytes = [0u8; PFP_SIZE];
        bytes.copy_from_slice(&slice[..PFP_SIZE]);
        Some(Self { bytes })
    }

    /// 获取原始字节数组
    pub fn as_bytes(&self) -> &[u8; PFP_SIZE] {
        &self.bytes
    }

    /// 验证家族魔数是否正确（0xCF14）
    pub fn is_valid_magic(&self) -> bool {
        u16::from_be_bytes([self.bytes[0], self.bytes[1]]) == FAMILY_MAGIC
    }

    /// 验证 Reserved 位是否全 0
    pub fn is_reserved_clean(&self) -> bool {
        self.bytes[3] & 0b11111000 == 0
    }

    /// 完整验证（魔数 + Reserved）
    pub fn is_valid(&self) -> bool {
        self.is_valid_magic() && self.is_reserved_clean()
    }

    /// 获取家族魔数
    pub fn family_magic(&self) -> u16 {
        u16::from_be_bytes([self.bytes[0], self.bytes[1]])
    }

    /// 获取操作模态
    pub fn modality(&self) -> Modality {
        Modality::from_bits(self.bytes[2] & 0b11)
    }

    /// 获取风险等级
    pub fn risk_level(&self) -> RiskLevel {
        RiskLevel::from_bits((self.bytes[2] >> 2) & 0b11)
    }

    /// 获取本体姿态
    pub fn body_stance(&self) -> BodyStance {
        BodyStance::from_bits((self.bytes[2] >> 4) & 0b11)
    }

    /// 获取临边/高危环境
    pub fn proximity_edge(&self) -> ProximityEdge {
        ProximityEdge::from_bits((self.bytes[2] >> 6) & 0b11)
    }

    /// 获取输出目的地
    pub fn output_dest(&self) -> OutputDest {
        OutputDest::from_bit(self.bytes[3] & 0b1 != 0)
    }

    /// 获取硬覆盖标志
    pub fn override_flag(&self) -> OverrideFlag {
        OverrideFlag::from_bit(self.bytes[3] & 0b10 != 0)
    }

    /// 获取重放保护使能
    pub fn replay_enable(&self) -> ReplayEnable {
        ReplayEnable::from_bit(self.bytes[3] & 0b100 != 0)
    }

    /// Rule 6: Replay-Enable=0 时，有效 Risk-Level 强制降级为 MEDIUM
    pub fn effective_risk_level(&self) -> RiskLevel {
        if self.replay_enable() == ReplayEnable::Disabled {
            RiskLevel::Medium
        } else {
            self.risk_level()
        }
    }

    /// 是否为 CATASTROPHIC 硬覆盖（Rule 1）
    pub fn is_catastrophic_override(&self) -> bool {
        self.effective_risk_level() == RiskLevel::Catastrophic
            && self.override_flag() == OverrideFlag::HardOverride
    }
}

// ─── PFP 构建器 ─────────────────────────────────────────────

/// PFP 构建器（用于构造 PFP 字节）
#[derive(Debug, Clone, Default)]
pub struct PFPBuilder {
    modality: Modality,
    risk_level: RiskLevel,
    body_stance: BodyStance,
    proximity_edge: ProximityEdge,
    output_dest: OutputDest,
    override_flag: OverrideFlag,
    replay_enable: ReplayEnable,
}

impl PFPBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn modality(mut self, m: Modality) -> Self {
        self.modality = m;
        self
    }

    pub fn risk_level(mut self, r: RiskLevel) -> Self {
        self.risk_level = r;
        self
    }

    pub fn body_stance(mut self, b: BodyStance) -> Self {
        self.body_stance = b;
        self
    }

    pub fn proximity_edge(mut self, p: ProximityEdge) -> Self {
        self.proximity_edge = p;
        self
    }

    pub fn output_dest(mut self, o: OutputDest) -> Self {
        self.output_dest = o;
        self
    }

    pub fn override_flag(mut self, o: OverrideFlag) -> Self {
        self.override_flag = o;
        self
    }

    pub fn replay_enable(mut self, r: ReplayEnable) -> Self {
        self.replay_enable = r;
        self
    }

    pub fn build(self) -> PFP {
        let mut bytes = [0u8; PFP_SIZE];
        // Byte 0-1: Family-Magic (0xCF14, 大端序)
        bytes[0..2].copy_from_slice(&FAMILY_MAGIC.to_be_bytes());
        // Byte 2: 物理特征字段
        bytes[2] = self.modality.to_bits()
            | (self.risk_level.to_bits() << 2)
            | (self.body_stance.to_bits() << 4)
            | (self.proximity_edge.to_bits() << 6);
        // Byte 3: 标志位
        bytes[3] = (self.output_dest.to_bit() as u8)
            | ((self.override_flag.to_bit() as u8) << 1)
            | ((self.replay_enable.to_bit() as u8) << 2);
        PFP { bytes }
    }
}

// ─── 测试 ───────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pfp_size() {
        assert_eq!(PFP_SIZE, 4);
        assert_eq!(std::mem::size_of::<PFP>(), 4);
    }

    #[test]
    fn test_family_magic() {
        assert_eq!(FAMILY_MAGIC, 0xCF14);
    }

    #[test]
    fn test_from_bytes() {
        // Byte2: bit7-6=00(Safe), bit5-4=10(Moving), bit3-2=01(Medium), bit1-0=11(SensorFeed)
        // Byte3: bit7-3=00000(Reserved), bit2=1(Replay), bit1=1(Override), bit0=1(External)
        let bytes = [0xCF, 0x14, 0b00_10_01_11, 0b00000_1_1_1];
        let pfp = PFP::from_bytes(bytes);
        assert!(pfp.is_valid_magic());
        assert_eq!(pfp.modality(), Modality::SensorFeed);
        assert_eq!(pfp.risk_level(), RiskLevel::Medium);
        assert_eq!(pfp.body_stance(), BodyStance::Moving);
        assert_eq!(pfp.proximity_edge(), ProximityEdge::Safe);
        assert_eq!(pfp.output_dest(), OutputDest::External);
        assert_eq!(pfp.override_flag(), OverrideFlag::HardOverride);
        assert_eq!(pfp.replay_enable(), ReplayEnable::Enabled);
    }

    #[test]
    fn test_from_slice_valid() {
        let data = vec![0xCF, 0x14, 0x00, 0x00, 0xFF];
        let pfp = PFP::from_slice(&data).unwrap();
        assert!(pfp.is_valid_magic());
        assert_eq!(pfp.as_bytes(), &[0xCF, 0x14, 0x00, 0x00]);
    }

    #[test]
    fn test_from_slice_too_short() {
        let data = vec![0xCF, 0x14, 0x00];
        assert!(PFP::from_slice(&data).is_none());
    }

    #[test]
    fn test_invalid_magic() {
        let bytes = [0x00, 0x00, 0x00, 0x00];
        let pfp = PFP::from_bytes(bytes);
        assert!(!pfp.is_valid_magic());
        assert!(!pfp.is_valid());
    }

    #[test]
    fn test_reserved_not_clean() {
        let bytes = [0xCF, 0x14, 0x00, 0b11111000];
        let pfp = PFP::from_bytes(bytes);
        assert!(pfp.is_valid_magic());
        assert!(!pfp.is_reserved_clean());
        assert!(!pfp.is_valid());
    }

    #[test]
    fn test_modality_all_values() {
        for i in 0..4u8 {
            let bytes = [0xCF, 0x14, i, 0x00];
            let pfp = PFP::from_bytes(bytes);
            match i {
                0 => assert_eq!(pfp.modality(), Modality::Cognitive),
                1 => assert_eq!(pfp.modality(), Modality::Render),
                2 => assert_eq!(pfp.modality(), Modality::Executive),
                _ => assert_eq!(pfp.modality(), Modality::SensorFeed),
            }
        }
    }

    #[test]
    fn test_risk_level_all_values() {
        for i in 0..4u8 {
            let bytes = [0xCF, 0x14, i << 2, 0x00];
            let pfp = PFP::from_bytes(bytes);
            match i {
                0 => assert_eq!(pfp.risk_level(), RiskLevel::Low),
                1 => assert_eq!(pfp.risk_level(), RiskLevel::Medium),
                2 => assert_eq!(pfp.risk_level(), RiskLevel::Critical),
                _ => assert_eq!(pfp.risk_level(), RiskLevel::Catastrophic),
            }
        }
    }

    #[test]
    fn test_body_stance_all_values() {
        for i in 0..4u8 {
            let bytes = [0xCF, 0x14, i << 4, 0x00];
            let pfp = PFP::from_bytes(bytes);
            match i {
                0 => assert_eq!(pfp.body_stance(), BodyStance::Seated),
                1 => assert_eq!(pfp.body_stance(), BodyStance::Standing),
                2 => assert_eq!(pfp.body_stance(), BodyStance::Moving),
                _ => assert_eq!(pfp.body_stance(), BodyStance::Unknown),
            }
        }
    }

    #[test]
    fn test_proximity_edge_all_values() {
        for i in 0..4u8 {
            let bytes = [0xCF, 0x14, i << 6, 0x00];
            let pfp = PFP::from_bytes(bytes);
            match i {
                0 => assert_eq!(pfp.proximity_edge(), ProximityEdge::Safe),
                1 => assert_eq!(pfp.proximity_edge(), ProximityEdge::Warning),
                2 => assert_eq!(pfp.proximity_edge(), ProximityEdge::Danger),
                _ => assert_eq!(pfp.proximity_edge(), ProximityEdge::CriticalEdge),
            }
        }
    }

    #[test]
    fn test_output_dest() {
        let internal = PFP::from_bytes([0xCF, 0x14, 0x00, 0b00000000]);
        assert_eq!(internal.output_dest(), OutputDest::Internal);

        let external = PFP::from_bytes([0xCF, 0x14, 0x00, 0b00000001]);
        assert_eq!(external.output_dest(), OutputDest::External);
    }

    #[test]
    fn test_override_flag() {
        let normal = PFP::from_bytes([0xCF, 0x14, 0x00, 0b00000000]);
        assert_eq!(normal.override_flag(), OverrideFlag::Normal);

        let hard = PFP::from_bytes([0xCF, 0x14, 0x00, 0b00000010]);
        assert_eq!(hard.override_flag(), OverrideFlag::HardOverride);
    }

    #[test]
    fn test_replay_enable() {
        let disabled = PFP::from_bytes([0xCF, 0x14, 0x00, 0b00000000]);
        assert_eq!(disabled.replay_enable(), ReplayEnable::Disabled);

        let enabled = PFP::from_bytes([0xCF, 0x14, 0x00, 0b00000100]);
        assert_eq!(enabled.replay_enable(), ReplayEnable::Enabled);
    }

    #[test]
    fn test_rule6_replay_disabled_forces_medium() {
        // Replay-Enable=0, Risk-Level=Catastrophic (bit 3-2 = 11)
        let pfp = PFP::from_bytes([0xCF, 0x14, 0b00_00_11_00, 0b00000000]);
        assert_eq!(pfp.risk_level(), RiskLevel::Catastrophic);
        assert_eq!(pfp.effective_risk_level(), RiskLevel::Medium);
    }

    #[test]
    fn test_rule6_replay_enabled_keeps_original() {
        // Replay-Enable=1, Risk-Level=Critical (bit 3-2 = 10)
        let pfp = PFP::from_bytes([0xCF, 0x14, 0b00_00_10_00, 0b00000100]);
        assert_eq!(pfp.risk_level(), RiskLevel::Critical);
        assert_eq!(pfp.effective_risk_level(), RiskLevel::Critical);
    }

    #[test]
    fn test_catastrophic_override() {
        // Risk-Level=Catastrophic + Override=Hard + Replay=Enabled
        let pfp = PFPBuilder::new()
            .risk_level(RiskLevel::Catastrophic)
            .override_flag(OverrideFlag::HardOverride)
            .replay_enable(ReplayEnable::Enabled)
            .build();
        assert!(pfp.is_catastrophic_override());
    }

    #[test]
    fn test_catastrophic_override_blocked_by_replay_disabled() {
        // Risk-Level=Catastrophic + Override=Hard, but Replay=Disabled
        // Rule 6 强制降级为 Medium，所以不是 CATASTROPHIC 硬覆盖
        let pfp = PFPBuilder::new()
            .risk_level(RiskLevel::Catastrophic)
            .override_flag(OverrideFlag::HardOverride)
            .replay_enable(ReplayEnable::Disabled)
            .build();
        assert!(!pfp.is_catastrophic_override());
        assert_eq!(pfp.effective_risk_level(), RiskLevel::Medium);
    }

    #[test]
    fn test_builder_default() {
        let pfp = PFPBuilder::new().build();
        assert!(pfp.is_valid());
        assert_eq!(pfp.modality(), Modality::Cognitive);
        assert_eq!(pfp.risk_level(), RiskLevel::Low);
        assert_eq!(pfp.body_stance(), BodyStance::Seated);
        assert_eq!(pfp.proximity_edge(), ProximityEdge::Safe);
        assert_eq!(pfp.output_dest(), OutputDest::Internal);
        assert_eq!(pfp.override_flag(), OverrideFlag::Normal);
        assert_eq!(pfp.replay_enable(), ReplayEnable::Disabled);
    }

    #[test]
    fn test_builder_full() {
        let pfp = PFPBuilder::new()
            .modality(Modality::Executive)
            .risk_level(RiskLevel::Critical)
            .body_stance(BodyStance::Moving)
            .proximity_edge(ProximityEdge::Danger)
            .output_dest(OutputDest::External)
            .override_flag(OverrideFlag::HardOverride)
            .replay_enable(ReplayEnable::Enabled)
            .build();

        assert!(pfp.is_valid());
        assert_eq!(pfp.modality(), Modality::Executive);
        assert_eq!(pfp.risk_level(), RiskLevel::Critical);
        assert_eq!(pfp.body_stance(), BodyStance::Moving);
        assert_eq!(pfp.proximity_edge(), ProximityEdge::Danger);
        assert_eq!(pfp.output_dest(), OutputDest::External);
        assert_eq!(pfp.override_flag(), OverrideFlag::HardOverride);
        assert_eq!(pfp.replay_enable(), ReplayEnable::Enabled);
    }

    #[test]
    fn test_builder_roundtrip() {
        let original = PFPBuilder::new()
            .modality(Modality::SensorFeed)
            .risk_level(RiskLevel::Medium)
            .body_stance(BodyStance::Standing)
            .proximity_edge(ProximityEdge::Warning)
            .output_dest(OutputDest::External)
            .override_flag(OverrideFlag::Normal)
            .replay_enable(ReplayEnable::Enabled)
            .build();

        let bytes = original.as_bytes();
        let parsed = PFP::from_bytes(*bytes);

        assert_eq!(original, parsed);
        assert_eq!(original.modality(), parsed.modality());
        assert_eq!(original.risk_level(), parsed.risk_level());
        assert_eq!(original.body_stance(), parsed.body_stance());
        assert_eq!(original.proximity_edge(), parsed.proximity_edge());
        assert_eq!(original.output_dest(), parsed.output_dest());
        assert_eq!(original.override_flag(), parsed.override_flag());
        assert_eq!(original.replay_enable(), parsed.replay_enable());
    }

    #[test]
    fn test_zero_copy_no_allocation() {
        // PFP 是 Copy 类型，不需要堆分配
        let bytes = [0xCF, 0x14, 0x00, 0x00];
        let pfp = PFP::from_bytes(bytes);
        // 验证可以直接使用，不需要 Box 或 Vec
        assert!(pfp.is_valid());
    }
}
