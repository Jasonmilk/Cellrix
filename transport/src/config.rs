//! Cellrix 配置管理 — 多层配置（默认值 < 环境变量 < 代码传入）
//!
//! # Design Principle
//!
//! **极致解耦**: 配置是可选的，不强制依赖 config crate。
//! **按需加载**: 只在需要时解析环境变量，不预先加载。
//! **确定性优先**: 配置有明确的默认值，行为可预测。
//!
//! # Components
//!
//! - `CellrixConfig`: 顶层配置
//! - `LogConfig`: 日志配置
//! - `ClientConfig`: 客户端配置（Tuck/Helix-Mind/Anaphase/Tentacle）
//! - `UiConfig`: UI 配置
//! - `MetricsConfig`: 监控配置
//! - `ConfigError`: 配置错误

use serde::{Deserialize, Serialize};
use std::time::Duration;

// ============================================================================
// Config Error
// ============================================================================

/// 配置错误
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// 无效的日志级别
    #[error("无效的日志级别: {0}")]
    InvalidLogLevel(String),

    /// 无效的超时时间
    #[error("无效的超时时间: {0}")]
    InvalidTimeout(String),

    /// 环境变量解析失败
    #[error("环境变量 {0} 解析失败: {1}")]
    EnvParseError(String, String),
}

// ============================================================================
// Log Config
// ============================================================================

/// 日志级别
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// 详细调试信息
    Trace,
    /// 调试信息
    Debug,
    /// 一般信息（默认）
    Info,
    /// 警告
    Warn,
    /// 错误
    Error,
}

impl LogLevel {
    /// 从字符串解析
    pub fn from_str(s: &str) -> Result<Self, ConfigError> {
        match s.to_lowercase().as_str() {
            "trace" => Ok(Self::Trace),
            "debug" => Ok(Self::Debug),
            "info" => Ok(Self::Info),
            "warn" | "warning" => Ok(Self::Warn),
            "error" => Ok(Self::Error),
            _ => Err(ConfigError::InvalidLogLevel(s.to_string())),
        }
    }

    /// 转换为 tracing Level
    #[cfg(feature = "tracing")]
    pub fn to_tracing_level(&self) -> tracing::Level {
        match self {
            Self::Trace => tracing::Level::TRACE,
            Self::Debug => tracing::Level::DEBUG,
            Self::Info => tracing::Level::INFO,
            Self::Warn => tracing::Level::WARN,
            Self::Error => tracing::Level::ERROR,
        }
    }
}

impl Default for LogLevel {
    fn default() -> Self {
        Self::Info
    }
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Trace => write!(f, "trace"),
            Self::Debug => write!(f, "debug"),
            Self::Info => write!(f, "info"),
            Self::Warn => write!(f, "warn"),
            Self::Error => write!(f, "error"),
        }
    }
}

/// 日志格式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    /// 人类可读格式（开发环境）
    Pretty,
    /// JSON 格式（生产环境）
    Json,
    /// 紧凑格式
    Compact,
}

impl Default for LogFormat {
    fn default() -> Self {
        Self::Pretty
    }
}

/// 日志配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogConfig {
    /// 日志级别（默认 Info）
    #[serde(default)]
    pub level: LogLevel,

    /// 日志格式（默认 Pretty）
    #[serde(default)]
    pub format: LogFormat,

    /// 是否输出到 stdout（默认 true）
    #[serde(default = "default_true")]
    pub stdout: bool,

    /// 日志文件路径（可选，None 表示不写文件）
    #[serde(default)]
    pub file_path: Option<String>,

    /// 日志文件最大大小（MB，默认 100）
    #[serde(default = "default_log_file_size")]
    pub file_max_size_mb: u64,

    /// 日志文件保留数量（默认 5）
    #[serde(default = "default_log_file_count")]
    pub file_max_count: u32,

    /// 是否包含时间戳（默认 true）
    #[serde(default = "default_true")]
    pub include_timestamp: bool,

    /// 是否包含模块路径（默认 false）
    #[serde(default)]
    pub include_module_path: bool,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            level: LogLevel::default(),
            format: LogFormat::default(),
            stdout: true,
            file_path: None,
            file_max_size_mb: 100,
            file_max_count: 5,
            include_timestamp: true,
            include_module_path: false,
        }
    }
}

// ============================================================================
// Client Config
// ============================================================================

/// 单个客户端配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientEndpointConfig {
    /// 端点地址（gRPC/HTTP URL，可选，None 表示使用 mock）
    #[serde(default)]
    pub endpoint: Option<String>,

    /// 连接超时（秒，默认 5）
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_secs: u64,

    /// 请求超时（秒，默认 30）
    #[serde(default = "default_request_timeout")]
    pub request_timeout_secs: u64,

    /// 重试次数（默认 3）
    #[serde(default = "default_retry_count")]
    pub retry_count: u32,

    /// 重试间隔（毫秒，默认 1000）
    #[serde(default = "default_retry_interval")]
    pub retry_interval_ms: u64,

    /// 是否使用 mock 客户端（默认 true，直到真实服务可用）
    #[serde(default = "default_true")]
    pub use_mock: bool,
}

impl Default for ClientEndpointConfig {
    fn default() -> Self {
        Self {
            endpoint: None,
            connect_timeout_secs: 5,
            request_timeout_secs: 30,
            retry_count: 3,
            retry_interval_ms: 1000,
            use_mock: true,
        }
    }
}

impl ClientEndpointConfig {
    /// 获取连接超时 Duration
    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(self.connect_timeout_secs)
    }

    /// 获取请求超时 Duration
    pub fn request_timeout(&self) -> Duration {
        Duration::from_secs(self.request_timeout_secs)
    }

    /// 获取重试间隔 Duration
    pub fn retry_interval(&self) -> Duration {
        Duration::from_millis(self.retry_interval_ms)
    }
}

/// 客户端配置（所有 Helix 组件）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClientConfig {
    /// Tuck 客户端配置
    #[serde(default)]
    pub tuck: ClientEndpointConfig,

    /// Helix-Mind 客户端配置
    #[serde(default)]
    pub helix_mind: ClientEndpointConfig,

    /// Anaphase 客户端配置
    #[serde(default)]
    pub anaphase: ClientEndpointConfig,

    /// Tentacle 客户端配置
    #[serde(default)]
    pub tentacle: ClientEndpointConfig,
}

// ============================================================================
// UI Config
// ============================================================================

/// UI 主题
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiTheme {
    /// 深色主题（默认）
    Dark,
    /// 浅色主题
    Light,
    /// 自动（跟随系统）
    Auto,
}

impl Default for UiTheme {
    fn default() -> Self {
        Self::Dark
    }
}

/// UI 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    /// 主题（默认 Dark）
    #[serde(default)]
    pub theme: UiTheme,

    /// 刷新间隔（毫秒，默认 1000）
    #[serde(default = "default_refresh_interval")]
    pub refresh_interval_ms: u64,

    /// 是否显示帮助栏（默认 true）
    #[serde(default = "default_true")]
    pub show_help: bool,

    /// 是否显示标题栏（默认 true）
    #[serde(default = "default_true")]
    pub show_title: bool,

    /// 最大日志显示行数（默认 1000）
    #[serde(default = "default_max_log_lines")]
    pub max_log_lines: usize,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: UiTheme::default(),
            refresh_interval_ms: 1000,
            show_help: true,
            show_title: true,
            max_log_lines: 1000,
        }
    }
}

impl UiConfig {
    /// 获取刷新间隔 Duration
    pub fn refresh_interval(&self) -> Duration {
        Duration::from_millis(self.refresh_interval_ms)
    }
}

// ============================================================================
// Metrics Config
// ============================================================================

/// 监控配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsConfig {
    /// 是否启用指标收集（默认 true）
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// 指标导出端点（Prometheus，可选）
    #[serde(default)]
    pub prometheus_endpoint: Option<String>,

    /// 健康检查间隔（秒，默认 10）
    #[serde(default = "default_health_check_interval")]
    pub health_check_interval_secs: u64,

    /// 是否启用详细指标（默认 false，启用后会增加开销）
    #[serde(default)]
    pub detailed_metrics: bool,
}

impl Default for MetricsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            prometheus_endpoint: None,
            health_check_interval_secs: 10,
            detailed_metrics: false,
        }
    }
}

impl MetricsConfig {
    /// 获取健康检查间隔 Duration
    pub fn health_check_interval(&self) -> Duration {
        Duration::from_secs(self.health_check_interval_secs)
    }
}

// ============================================================================
// Cellrix Config (Top Level)
// ============================================================================

/// Cellrix 顶层配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CellrixConfig {
    /// 日志配置
    #[serde(default)]
    pub log: LogConfig,

    /// 客户端配置
    #[serde(default)]
    pub client: ClientConfig,

    /// UI 配置
    #[serde(default)]
    pub ui: UiConfig,

    /// 监控配置
    #[serde(default)]
    pub metrics: MetricsConfig,
}

impl CellrixConfig {
    /// 创建默认配置
    pub fn new() -> Self {
        Self::default()
    }

    /// 从环境变量加载配置（前缀 CELLRIX_）
    ///
    /// 支持的环境变量：
    /// - CELLRIX_LOG_LEVEL: trace/debug/info/warn/error
    /// - CELLRIX_LOG_FORMAT: pretty/json/compact
    /// - CELLRIX_LOG_FILE: 日志文件路径
    /// - CELLRIX_UI_THEME: dark/light/auto
    /// - CELLRIX_UI_REFRESH_MS: 刷新间隔（毫秒）
    /// - CELLRIX_METRICS_ENABLED: true/false
    /// - CELLRIX_TUCK_ENDPOINT: Tuck 服务地址
    /// - CELLRIX_HELIX_MIND_ENDPOINT: Helix-Mind 服务地址
    /// - CELLRIX_ANAPHase_ENDPOINT: Anaphase 服务地址
    /// - CELLRIX_TENTACLE_ENDPOINT: Tentacle 服务地址
    pub fn from_env() -> Result<Self, ConfigError> {
        let mut config = Self::default();

        // 日志配置
        if let Ok(level) = std::env::var("CELLRIX_LOG_LEVEL") {
            config.log.level = LogLevel::from_str(&level)?;
        }
        if let Ok(format) = std::env::var("CELLRIX_LOG_FORMAT") {
            config.log.format = match format.to_lowercase().as_str() {
                "pretty" => LogFormat::Pretty,
                "json" => LogFormat::Json,
                "compact" => LogFormat::Compact,
                _ => return Err(ConfigError::EnvParseError(
                    "CELLRIX_LOG_FORMAT".to_string(),
                    format!("无效的日志格式: {}", format),
                )),
            };
        }
        if let Ok(file_path) = std::env::var("CELLRIX_LOG_FILE") {
            config.log.file_path = Some(file_path);
        }

        // UI 配置
        if let Ok(theme) = std::env::var("CELLRIX_UI_THEME") {
            config.ui.theme = match theme.to_lowercase().as_str() {
                "dark" => UiTheme::Dark,
                "light" => UiTheme::Light,
                "auto" => UiTheme::Auto,
                _ => return Err(ConfigError::EnvParseError(
                    "CELLRIX_UI_THEME".to_string(),
                    format!("无效的主题: {}", theme),
                )),
            };
        }
        if let Ok(interval) = std::env::var("CELLRIX_UI_REFRESH_MS") {
            config.ui.refresh_interval_ms = interval.parse::<u64>().map_err(|e| {
                ConfigError::EnvParseError("CELLRIX_UI_REFRESH_MS".to_string(), e.to_string())
            })?;
        }

        // 监控配置
        if let Ok(enabled) = std::env::var("CELLRIX_METRICS_ENABLED") {
            config.metrics.enabled = enabled.parse::<bool>().map_err(|e| {
                ConfigError::EnvParseError("CELLRIX_METRICS_ENABLED".to_string(), e.to_string())
            })?;
        }

        // 客户端配置
        if let Ok(endpoint) = std::env::var("CELLRIX_TUCK_ENDPOINT") {
            config.client.tuck.endpoint = Some(endpoint);
            config.client.tuck.use_mock = false;
        }
        if let Ok(endpoint) = std::env::var("CELLRIX_HELIX_MIND_ENDPOINT") {
            config.client.helix_mind.endpoint = Some(endpoint);
            config.client.helix_mind.use_mock = false;
        }
        if let Ok(endpoint) = std::env::var("CELLRIX_ANAPHase_ENDPOINT") {
            config.client.anaphase.endpoint = Some(endpoint);
            config.client.anaphase.use_mock = false;
        }
        if let Ok(endpoint) = std::env::var("CELLRIX_TENTACLE_ENDPOINT") {
            config.client.tentacle.endpoint = Some(endpoint);
            config.client.tentacle.use_mock = false;
        }

        Ok(config)
    }

    /// 从 TOML 字符串加载配置
    pub fn from_toml(s: &str) -> Result<Self, ConfigError> {
        toml::from_str(s).map_err(|e| {
            ConfigError::EnvParseError("TOML".to_string(), e.to_string())
        })
    }

    /// 验证配置
    pub fn validate(&self) -> Result<(), ConfigError> {
        // 验证超时时间
        if self.client.tuck.connect_timeout_secs == 0 {
            return Err(ConfigError::InvalidTimeout(
                "Tuck connect_timeout_secs 不能为 0".to_string(),
            ));
        }
        if self.client.tuck.request_timeout_secs == 0 {
            return Err(ConfigError::InvalidTimeout(
                "Tuck request_timeout_secs 不能为 0".to_string(),
            ));
        }
        if self.ui.refresh_interval_ms == 0 {
            return Err(ConfigError::InvalidTimeout(
                "UI refresh_interval_ms 不能为 0".to_string(),
            ));
        }

        Ok(())
    }
}

// ============================================================================
// Default Functions
// ============================================================================

fn default_true() -> bool {
    true
}

fn default_log_file_size() -> u64 {
    100
}

fn default_log_file_count() -> u32 {
    5
}

fn default_connect_timeout() -> u64 {
    5
}

fn default_request_timeout() -> u64 {
    30
}

fn default_retry_count() -> u32 {
    3
}

fn default_retry_interval() -> u64 {
    1000
}

fn default_refresh_interval() -> u64 {
    1000
}

fn default_max_log_lines() -> usize {
    1000
}

fn default_health_check_interval() -> u64 {
    10
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = CellrixConfig::default();
        assert_eq!(config.log.level, LogLevel::Info);
        assert_eq!(config.log.format, LogFormat::Pretty);
        assert!(config.log.stdout);
        assert!(config.log.file_path.is_none());
        assert_eq!(config.log.file_max_size_mb, 100);
        assert_eq!(config.log.file_max_count, 5);

        assert!(config.client.tuck.use_mock);
        assert!(config.client.helix_mind.use_mock);
        assert!(config.client.anaphase.use_mock);
        assert!(config.client.tentacle.use_mock);

        assert_eq!(config.ui.theme, UiTheme::Dark);
        assert_eq!(config.ui.refresh_interval_ms, 1000);
        assert!(config.ui.show_help);
        assert!(config.ui.show_title);
        assert_eq!(config.ui.max_log_lines, 1000);

        assert!(config.metrics.enabled);
        assert!(config.metrics.prometheus_endpoint.is_none());
        assert_eq!(config.metrics.health_check_interval_secs, 10);
        assert!(!config.metrics.detailed_metrics);
    }

    #[test]
    fn test_log_level_from_str() {
        assert_eq!(LogLevel::from_str("trace").unwrap(), LogLevel::Trace);
        assert_eq!(LogLevel::from_str("debug").unwrap(), LogLevel::Debug);
        assert_eq!(LogLevel::from_str("info").unwrap(), LogLevel::Info);
        assert_eq!(LogLevel::from_str("warn").unwrap(), LogLevel::Warn);
        assert_eq!(LogLevel::from_str("warning").unwrap(), LogLevel::Warn);
        assert_eq!(LogLevel::from_str("error").unwrap(), LogLevel::Error);
        assert!(LogLevel::from_str("invalid").is_err());
    }

    #[test]
    fn test_log_level_display() {
        assert_eq!(LogLevel::Trace.to_string(), "trace");
        assert_eq!(LogLevel::Info.to_string(), "info");
        assert_eq!(LogLevel::Error.to_string(), "error");
    }

    #[test]
    fn test_client_endpoint_config_defaults() {
        let config = ClientEndpointConfig::default();
        assert_eq!(config.connect_timeout_secs, 5);
        assert_eq!(config.request_timeout_secs, 30);
        assert_eq!(config.retry_count, 3);
        assert_eq!(config.retry_interval_ms, 1000);
        assert!(config.use_mock);
        assert!(config.endpoint.is_none());
    }

    #[test]
    fn test_client_endpoint_config_durations() {
        let config = ClientEndpointConfig::default();
        assert_eq!(config.connect_timeout(), Duration::from_secs(5));
        assert_eq!(config.request_timeout(), Duration::from_secs(30));
        assert_eq!(config.retry_interval(), Duration::from_millis(1000));
    }

    #[test]
    fn test_ui_config_defaults() {
        let config = UiConfig::default();
        assert_eq!(config.theme, UiTheme::Dark);
        assert_eq!(config.refresh_interval_ms, 1000);
        assert!(config.show_help);
        assert!(config.show_title);
        assert_eq!(config.max_log_lines, 1000);
    }

    #[test]
    fn test_ui_config_refresh_interval() {
        let config = UiConfig::default();
        assert_eq!(config.refresh_interval(), Duration::from_millis(1000));
    }

    #[test]
    fn test_metrics_config_defaults() {
        let config = MetricsConfig::default();
        assert!(config.enabled);
        assert!(config.prometheus_endpoint.is_none());
        assert_eq!(config.health_check_interval_secs, 10);
        assert!(!config.detailed_metrics);
    }

    #[test]
    fn test_metrics_config_health_check_interval() {
        let config = MetricsConfig::default();
        assert_eq!(config.health_check_interval(), Duration::from_secs(10));
    }

    #[test]
    fn test_config_validate_valid() {
        let config = CellrixConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_config_validate_invalid_timeout() {
        let mut config = CellrixConfig::default();
        config.client.tuck.connect_timeout_secs = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validate_invalid_ui_refresh() {
        let mut config = CellrixConfig::default();
        config.ui.refresh_interval_ms = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_from_toml() {
        let toml_str = r#"
[log]
level = "debug"
format = "json"

[ui]
theme = "light"
refresh_interval_ms = 500

[metrics]
enabled = false
"#;
        let config = CellrixConfig::from_toml(toml_str).unwrap();
        assert_eq!(config.log.level, LogLevel::Debug);
        assert_eq!(config.log.format, LogFormat::Json);
        assert_eq!(config.ui.theme, UiTheme::Light);
        assert_eq!(config.ui.refresh_interval_ms, 500);
        assert!(!config.metrics.enabled);
    }

    #[test]
    fn test_config_new() {
        let config = CellrixConfig::new();
        assert_eq!(config.log.level, LogLevel::Info);
    }

    #[test]
    fn test_log_config_default() {
        let config = LogConfig::default();
        assert_eq!(config.level, LogLevel::Info);
        assert_eq!(config.format, LogFormat::Pretty);
        assert!(config.stdout);
        assert!(config.include_timestamp);
        assert!(!config.include_module_path);
    }

    #[test]
    fn test_client_config_default() {
        let config = ClientConfig::default();
        assert!(config.tuck.use_mock);
        assert!(config.helix_mind.use_mock);
        assert!(config.anaphase.use_mock);
        assert!(config.tentacle.use_mock);
    }

    #[test]
    fn test_config_error_display() {
        let error = ConfigError::InvalidLogLevel("invalid".to_string());
        assert!(error.to_string().contains("invalid"));

        let error = ConfigError::InvalidTimeout("0".to_string());
        assert!(error.to_string().contains("0"));

        let error = ConfigError::EnvParseError("VAR".to_string(), "error".to_string());
        assert!(error.to_string().contains("VAR"));
        assert!(error.to_string().contains("error"));
    }
}
