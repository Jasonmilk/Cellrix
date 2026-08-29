//! SAP-xCF14 — Security Attestation Protocol（安全证明协议，演进层）
//!
//! SAP 是 CI-144 协议家族的安全证明层，提供防重放、完整性校验和身份认证。
//! 总长度 28 字节，按需加载（低安全场景可跳过 SAP，仅发送 PFP）。
//!
//! **演进策略**：SAP-xCF14 独立演进，v1、v2 可并行存在。PFP 冻结，SAP 升级。
//!
//! 对齐：BIND-19 v2.0-alpha 参考实现
//! 规范：https://github.com/CommonIntents/SAP-xCF14

/// SAP 总长度（字节）
pub const SAP_SIZE: usize = 28;

/// SAP 子协议 ID
pub const SAP_PROTOCOL_ID: u8 = 0x01;

/// SAP 当前版本（v1 = 0001）
pub const SAP_VERSION: u8 = 0b0001;

/// Physical-Context-Hash 长度（字节）= 112 bits
pub const PAH_SIZE: usize = 14;

/// PAH-Signature 长度（字节）= 64 bits（第一层快速校验）
pub const SIG_SIZE: usize = 8;

/// Seq-Counter 回绕阈值（≥ 此值触发密钥轮换）
pub const SEQ_ROTATION_THRESHOLD: u16 = 65534;

// ─── SAP 核心结构体 ─────────────────────────────────────────

/// SAP-xCF14 — Security Attestation Protocol（28 字节固定偏移结构）
///
/// 内存布局（大端序，网络字节序）：
/// ```text
/// Byte 0-1:   Family-Magic（16 bits）= 0xCF14
/// Byte 2:     Protocol-ID（8 bits）= 0x01（SAP-xCF14）
/// Byte 3:     版本与保留（8 bits）
///   bit 0-3:   SAP-Version（当前 v1 = 0001）
///   bit 4-7:   Reserved（全 0）
/// Byte 4-5:   Seq-Counter（16 bits，大端序）
///   防重放，单调递增，回绕阈值 65534 触发密钥轮换
/// Byte 6-19:  PAH-Hash（112 bits = 14 bytes）
///   SHA-256 截断（高 112 位），物理上下文哈希锁定
/// Byte 20-27: PAH-Signature（64 bits = 8 bytes）
///   ECC 签名截断（第一层快速校验）
/// ```
///
/// **注意**：第二层 512-bit 完整签名放在 INTENT-7 载荷头部扩展区，不在 SAP 中。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SAP {
    bytes: [u8; SAP_SIZE],
}

impl SAP {
    /// 从字节数组创建 SAP（零拷贝）
    pub fn from_bytes(bytes: [u8; SAP_SIZE]) -> Self {
        Self { bytes }
    }

    /// 从切片创建 SAP（拷贝，需确保长度 >= 28）
    pub fn from_slice(slice: &[u8]) -> Option<Self> {
        if slice.len() < SAP_SIZE {
            return None;
        }
        let mut bytes = [0u8; SAP_SIZE];
        bytes.copy_from_slice(&slice[..SAP_SIZE]);
        Some(Self { bytes })
    }

    /// 获取原始字节数组
    pub fn as_bytes(&self) -> &[u8; SAP_SIZE] {
        &self.bytes
    }

    /// 验证家族魔数是否正确（0xCF14）
    pub fn is_valid_magic(&self) -> bool {
        u16::from_be_bytes([self.bytes[0], self.bytes[1]]) == super::pfp::FAMILY_MAGIC
    }

    /// 验证 Protocol-ID 是否正确（0x01）
    pub fn is_valid_protocol_id(&self) -> bool {
        self.bytes[2] == SAP_PROTOCOL_ID
    }

    /// 验证 Reserved 位是否全 0
    pub fn is_reserved_clean(&self) -> bool {
        self.bytes[3] & 0b11110000 == 0
    }

    /// 完整验证（魔数 + Protocol-ID + Reserved）
    pub fn is_valid(&self) -> bool {
        self.is_valid_magic() && self.is_valid_protocol_id() && self.is_reserved_clean()
    }

    /// 获取家族魔数
    pub fn family_magic(&self) -> u16 {
        u16::from_be_bytes([self.bytes[0], self.bytes[1]])
    }

    /// 获取 Protocol-ID
    pub fn protocol_id(&self) -> u8 {
        self.bytes[2]
    }

    /// 获取 SAP 版本
    pub fn version(&self) -> u8 {
        self.bytes[3] & 0b1111
    }

    /// 获取 Seq-Counter（防重放，单调递增）
    pub fn seq_counter(&self) -> u16 {
        u16::from_be_bytes([self.bytes[4], self.bytes[5]])
    }

    /// 获取 PAH-Hash（14 bytes，SHA-256 截断高 112 位）
    pub fn pah_hash(&self) -> &[u8; PAH_SIZE] {
        // 安全：PAH_SIZE = 14，偏移 6，6+14=20 <= 28
        unsafe { &*(&self.bytes[6] as *const u8 as *const [u8; PAH_SIZE]) }
    }

    /// 获取 PAH-Signature（8 bytes，第一层快速校验）
    pub fn pah_signature(&self) -> &[u8; SIG_SIZE] {
        // 安全：SIG_SIZE = 8，偏移 20，20+8=28 <= 28
        unsafe { &*(&self.bytes[20] as *const u8 as *const [u8; SIG_SIZE]) }
    }

    /// 检查 Seq-Counter 是否接近回绕阈值（需要密钥轮换）
    pub fn needs_key_rotation(&self) -> bool {
        self.seq_counter() >= SEQ_ROTATION_THRESHOLD
    }
}

// ─── SAP 构建器 ─────────────────────────────────────────────

/// SAP 构建器（用于构造 SAP 字节）
#[derive(Debug, Clone)]
pub struct SAPBuilder {
    seq_counter: u16,
    pah_hash: [u8; PAH_SIZE],
    pah_signature: [u8; SIG_SIZE],
}

impl SAPBuilder {
    pub fn new() -> Self {
        Self {
            seq_counter: 0,
            pah_hash: [0u8; PAH_SIZE],
            pah_signature: [0u8; SIG_SIZE],
        }
    }

    pub fn seq_counter(mut self, seq: u16) -> Self {
        self.seq_counter = seq;
        self
    }

    pub fn pah_hash(mut self, hash: [u8; PAH_SIZE]) -> Self {
        self.pah_hash = hash;
        self
    }

    pub fn pah_signature(mut self, sig: [u8; SIG_SIZE]) -> Self {
        self.pah_signature = sig;
        self
    }

    pub fn build(self) -> SAP {
        let mut bytes = [0u8; SAP_SIZE];
        // Byte 0-1: Family-Magic = 0xCF14（大端序）
        bytes[0..2].copy_from_slice(&super::pfp::FAMILY_MAGIC.to_be_bytes());
        // Byte 2: Protocol-ID = 0x01
        bytes[2] = SAP_PROTOCOL_ID;
        // Byte 3: SAP-Version（bit 0-3）+ Reserved（bit 4-7，强制 0）
        bytes[3] = SAP_VERSION & 0b1111;
        // Byte 4-5: Seq-Counter（大端序）
        bytes[4..6].copy_from_slice(&self.seq_counter.to_be_bytes());
        // Byte 6-19: PAH-Hash（14 bytes）
        bytes[6..6 + PAH_SIZE].copy_from_slice(&self.pah_hash);
        // Byte 20-27: PAH-Signature（8 bytes）
        bytes[6 + PAH_SIZE..6 + PAH_SIZE + SIG_SIZE].copy_from_slice(&self.pah_signature);
        SAP { bytes }
    }
}

impl Default for SAPBuilder {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 测试 ───────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sap_size() {
        assert_eq!(SAP_SIZE, 28);
        assert_eq!(std::mem::size_of::<SAP>(), 28);
    }

    #[test]
    fn test_constants() {
        assert_eq!(SAP_PROTOCOL_ID, 0x01);
        assert_eq!(SAP_VERSION, 0b0001);
        assert_eq!(PAH_SIZE, 14);
        assert_eq!(SIG_SIZE, 8);
        assert_eq!(SEQ_ROTATION_THRESHOLD, 65534);
    }

    #[test]
    fn test_from_bytes_valid() {
        let sap = SAPBuilder::new()
            .seq_counter(42)
            .build();
        assert!(sap.is_valid());
        assert!(sap.is_valid_magic());
        assert!(sap.is_valid_protocol_id());
        assert!(sap.is_reserved_clean());
        assert_eq!(sap.family_magic(), 0xCF14);
        assert_eq!(sap.protocol_id(), 0x01);
        assert_eq!(sap.version(), 0b0001);
        assert_eq!(sap.seq_counter(), 42);
    }

    #[test]
    fn test_from_slice_valid() {
        let data = vec![0u8; 32];
        // 手动构造有效的 SAP 头部
        let mut sap_data = [0u8; SAP_SIZE];
        sap_data[0..2].copy_from_slice(&0xCF14u16.to_be_bytes());
        sap_data[2] = SAP_PROTOCOL_ID;
        sap_data[3] = SAP_VERSION;
        sap_data[4..6].copy_from_slice(&100u16.to_be_bytes());

        let mut full_data = vec![0u8; 32];
        full_data[..SAP_SIZE].copy_from_slice(&sap_data);

        let sap = SAP::from_slice(&full_data).unwrap();
        assert!(sap.is_valid());
        assert_eq!(sap.seq_counter(), 100);
    }

    #[test]
    fn test_from_slice_too_short() {
        let data = vec![0u8; 10];
        assert!(SAP::from_slice(&data).is_none());
    }

    #[test]
    fn test_invalid_magic() {
        let mut bytes = [0u8; SAP_SIZE];
        bytes[0] = 0x00;
        bytes[1] = 0x00;
        let sap = SAP::from_bytes(bytes);
        assert!(!sap.is_valid_magic());
        assert!(!sap.is_valid());
    }

    #[test]
    fn test_invalid_protocol_id() {
        let mut bytes = [0u8; SAP_SIZE];
        bytes[0..2].copy_from_slice(&0xCF14u16.to_be_bytes());
        bytes[2] = 0x99; // 错误的 Protocol-ID
        let sap = SAP::from_bytes(bytes);
        assert!(!sap.is_valid_protocol_id());
        assert!(!sap.is_valid());
    }

    #[test]
    fn test_reserved_not_clean() {
        let mut bytes = [0u8; SAP_SIZE];
        bytes[0..2].copy_from_slice(&0xCF14u16.to_be_bytes());
        bytes[2] = SAP_PROTOCOL_ID;
        bytes[3] = 0b11110000; // Reserved 位非零
        let sap = SAP::from_bytes(bytes);
        assert!(!sap.is_reserved_clean());
        assert!(!sap.is_valid());
    }

    #[test]
    fn test_seq_counter() {
        let sap = SAPBuilder::new().seq_counter(12345).build();
        assert_eq!(sap.seq_counter(), 12345);
    }

    #[test]
    fn test_seq_counter_max() {
        let sap = SAPBuilder::new().seq_counter(u16::MAX).build();
        assert_eq!(sap.seq_counter(), u16::MAX);
    }

    #[test]
    fn test_pah_hash() {
        let mut hash = [0u8; PAH_SIZE];
        for i in 0..PAH_SIZE {
            hash[i] = i as u8;
        }
        let sap = SAPBuilder::new().pah_hash(hash).build();
        assert_eq!(sap.pah_hash(), &hash);
    }

    #[test]
    fn test_pah_signature() {
        let mut sig = [0u8; SIG_SIZE];
        for i in 0..SIG_SIZE {
            sig[i] = (i + 100) as u8;
        }
        let sap = SAPBuilder::new().pah_signature(sig).build();
        assert_eq!(sap.pah_signature(), &sig);
    }

    #[test]
    fn test_needs_key_rotation_false() {
        let sap = SAPBuilder::new().seq_counter(100).build();
        assert!(!sap.needs_key_rotation());
    }

    #[test]
    fn test_needs_key_rotation_true() {
        let sap = SAPBuilder::new().seq_counter(65534).build();
        assert!(sap.needs_key_rotation());
    }

    #[test]
    fn test_needs_key_rotation_max() {
        let sap = SAPBuilder::new().seq_counter(u16::MAX).build();
        assert!(sap.needs_key_rotation());
    }

    #[test]
    fn test_builder_default() {
        let sap = SAPBuilder::new().build();
        assert!(sap.is_valid());
        assert_eq!(sap.seq_counter(), 0);
        assert_eq!(sap.pah_hash(), &[0u8; PAH_SIZE]);
        assert_eq!(sap.pah_signature(), &[0u8; SIG_SIZE]);
    }

    #[test]
    fn test_builder_full() {
        let mut hash = [0u8; PAH_SIZE];
        hash[0] = 0xAA;
        hash[13] = 0xBB;
        let mut sig = [0u8; SIG_SIZE];
        sig[0] = 0xCC;
        sig[7] = 0xDD;

        let sap = SAPBuilder::new()
            .seq_counter(50000)
            .pah_hash(hash)
            .pah_signature(sig)
            .build();

        assert!(sap.is_valid());
        assert_eq!(sap.seq_counter(), 50000);
        assert_eq!(sap.pah_hash(), &hash);
        assert_eq!(sap.pah_signature(), &sig);
    }

    #[test]
    fn test_builder_roundtrip() {
        let original = SAPBuilder::new()
            .seq_counter(9999)
            .pah_hash([1u8; PAH_SIZE])
            .pah_signature([2u8; SIG_SIZE])
            .build();

        let bytes = original.as_bytes();
        let parsed = SAP::from_bytes(*bytes);

        assert_eq!(original, parsed);
        assert_eq!(original.seq_counter(), parsed.seq_counter());
        assert_eq!(original.pah_hash(), parsed.pah_hash());
        assert_eq!(original.pah_signature(), parsed.pah_signature());
    }

    #[test]
    fn test_zero_copy_no_allocation() {
        // SAP 是 Copy 类型，不需要堆分配
        let bytes = [0u8; SAP_SIZE];
        let sap = SAP::from_bytes(bytes);
        // 验证可以直接使用，不需要 Box 或 Vec
        assert!(!sap.is_valid()); // 全零不是有效的 SAP
    }

    #[test]
    fn test_pfp_sap_combination() {
        // 验证 PFP 和 SAP 可以组合使用（完整帧 = PFP(4) + SAP(28) = 32 bytes）
        use super::super::pfp::{PFP, PFPBuilder, RiskLevel, Modality};

        let pfp = PFPBuilder::new()
            .modality(Modality::Executive)
            .risk_level(RiskLevel::Critical)
            .build();

        let sap = SAPBuilder::new()
            .seq_counter(1)
            .build();

        // 组合帧
        let mut frame = Vec::with_capacity(32);
        frame.extend_from_slice(pfp.as_bytes());
        frame.extend_from_slice(sap.as_bytes());

        assert_eq!(frame.len(), 32); // 4 + 28

        // 解析回 PFP 和 SAP
        let parsed_pfp = PFP::from_slice(&frame[..4]).unwrap();
        let parsed_sap = SAP::from_slice(&frame[4..32]).unwrap();

        assert_eq!(parsed_pfp.modality(), Modality::Executive);
        assert_eq!(parsed_pfp.risk_level(), RiskLevel::Critical);
        assert_eq!(parsed_sap.seq_counter(), 1);
    }
}
