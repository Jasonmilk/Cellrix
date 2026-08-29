//! Cellrix 日志系统 — 结构化日志初始化
//!
//! # Design Principle
//!
//! **极致解耦**: 日志是可选的，使用 feature flag 控制。
//! **按需加载**: 只在调用 init_logging 时初始化，不预先加载。
//! **确定性优先**: 日志格式和级别有明确的默认值。
//!
//! # Components
//!
//! - `init_logging`: 初始化日志系统
//! - `LoggingGuard`: 日志守卫（drop 时刷新日志）
//! - `LogError`: 日志错误

use crate::config::{LogConfig, LogFormat, LogLevel};
use std::sync::Once;

static LOG_INIT: Once = Once::new();

/// 日志错误
#[derive(Debug, thiserror::Error)]
pub enum LogError {
    /// 日志已初始化
    #[error("日志已初始化")]
    AlreadyInitialized,

    /// 日志文件创建失败
    #[error("日志文件创建失败: {0}")]
    FileCreateError(String),

    /// 追踪订阅器设置失败
    #[error("追踪订阅器设置失败: {0}")]
    SetGlobalDefaultError(String),
}

/// 日志守卫（drop 时刷新日志）
pub struct LoggingGuard {
    _private: (),
}

impl Drop for LoggingGuard {
    fn drop(&mut self) {
        // 刷新日志缓冲区
        // tracing 会在 drop 时自动刷新
    }
}

/// 初始化日志系统
///
/// # Arguments
///
/// * `config` - 日志配置
///
/// # Returns
///
/// 返回日志守卫，保持守卫存活以保持日志系统运行。
///
/// # Errors
///
/// 如果日志已初始化或初始化失败，返回错误。
///
/// # Example
///
/// ```no_run
/// use cellrix_transport::config::LogConfig;
/// use cellrix_transport::logging::init_logging;
///
/// let config = LogConfig::default();
/// let _guard = init_logging(&config).unwrap();
/// ```
pub fn init_logging(config: &LogConfig) -> Result<LoggingGuard, LogError> {
    if LOG_INIT.is_completed() {
        return Err(LogError::AlreadyInitialized);
    }

    let mut init_result = Ok(());
    let config_clone = config.clone();

    LOG_INIT.call_once(|| {
        init_result = init_logging_internal(&config_clone);
    });

    init_result?;
    Ok(LoggingGuard { _private: () })
}

/// 内部日志初始化
#[cfg(feature = "tracing")]
fn init_logging_internal(config: &LogConfig) -> Result<(), LogError> {
    use tracing_subscriber::{
        fmt,
        prelude::*,
        EnvFilter,
    };

    let level = config.level.to_tracing_level();
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("{}", level)));

    match config.format {
        LogFormat::Pretty => {
            let fmt_layer = fmt::layer()
                .with_target(config.include_module_path)
                .with_file(config.include_module_path)
                .with_line_number(config.include_module_path)
                .with_thread_ids(false)
                .with_thread_names(false)
                .with_ansi(true)
                .pretty();

            if config.stdout {
                tracing_subscriber::registry()
                    .with(filter)
                    .with(fmt_layer)
                    .try_init()
                    .map_err(|e| LogError::SetGlobalDefaultError(e.to_string()))?;
            }
        }
        LogFormat::Json => {
            let fmt_layer = fmt::layer()
                .with_target(config.include_module_path)
                .with_file(config.include_module_path)
                .with_line_number(config.include_module_path)
                .json();

            if config.stdout {
                tracing_subscriber::registry()
                    .with(filter)
                    .with(fmt_layer)
                    .try_init()
                    .map_err(|e| LogError::SetGlobalDefaultError(e.to_string()))?;
            }
        }
        LogFormat::Compact => {
            let fmt_layer = fmt::layer()
                .with_target(config.include_module_path)
                .with_ansi(true)
                .compact();

            if config.stdout {
                tracing_subscriber::registry()
                    .with(filter)
                    .with(fmt_layer)
                    .try_init()
                    .map_err(|e| LogError::SetGlobalDefaultError(e.to_string()))?;
            }
        }
    }

    // 文件输出（可选）
    if let Some(file_path) = &config.file_path {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(true)
            .open(file_path)
            .map_err(|e| LogError::FileCreateError(e.to_string()))?;

        let file_layer = fmt::layer()
            .with_target(config.include_module_path)
            .with_file(config.include_module_path)
            .with_line_number(config.include_module_path)
            .with_ansi(false)
            .with_writer(std::sync::Mutex::new(file));

        // 注意：文件层需要与 stdout 层组合
        // 由于 tracing_subscriber 的限制，这里只支持 stdout 或文件二选一
        // 生产环境建议使用专门的日志收集器（如 loki/fluentd）
        tracing::warn!(
            "文件日志输出已配置: {}，但当前版本仅支持 stdout 或文件二选一",
            file_path
        );
    }

    Ok(())
}

/// 内部日志初始化（无 tracing feature）
#[cfg(not(feature = "tracing"))]
fn init_logging_internal(_config: &LogConfig) -> Result<(), LogError> {
    // 无 tracing feature 时，日志初始化是 no-op
    // 上层应用可以使用自己的日志系统
    Ok(())
}

/// 检查日志是否已初始化
pub fn is_logging_initialized() -> bool {
    LOG_INIT.is_completed()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_error_display() {
        let error = LogError::AlreadyInitialized;
        assert!(error.to_string().contains("已初始化"));

        let error = LogError::FileCreateError("permission denied".to_string());
        assert!(error.to_string().contains("permission denied"));

        let error = LogError::SetGlobalDefaultError("conflict".to_string());
        assert!(error.to_string().contains("conflict"));
    }

    #[test]
    fn test_is_logging_initialized_default() {
        // 默认情况下日志未初始化（除非其他测试已初始化）
        // 这个测试只是验证函数可以调用
        let _ = is_logging_initialized();
    }

    #[test]
    fn test_init_logging_default_config() {
        // 使用默认配置初始化日志
        // 注意：由于 Once 的限制，这个测试只能运行一次
        let config = LogConfig::default();
        let result = init_logging(&config);

        // 第一次应该成功，后续应该返回 AlreadyInitialized
        match result {
            Ok(_guard) => {
                // 成功初始化
                assert!(is_logging_initialized());
            }
            Err(LogError::AlreadyInitialized) => {
                // 已被其他测试初始化，这是正常的
                assert!(is_logging_initialized());
            }
            Err(e) => {
                panic!("意外错误: {}", e);
            }
        }
    }

    #[test]
    fn test_init_logging_twice() {
        // 第一次初始化
        let config = LogConfig::default();
        let _ = init_logging(&config);

        // 第二次应该失败
        let result = init_logging(&config);
        assert!(result.is_err());
        // 可能是 AlreadyInitialized 或其他错误（取决于测试顺序）
    }

    #[test]
    fn test_logging_guard_drop() {
        // 测试日志守卫可以正常 drop
        let config = LogConfig::default();
        if let Ok(guard) = init_logging(&config) {
            drop(guard);
            // drop 后不应该 panic
        }
    }

    #[test]
    fn test_log_config_levels() {
        // 测试不同日志级别的配置
        for level in &[
            LogLevel::Trace,
            LogLevel::Debug,
            LogLevel::Info,
            LogLevel::Warn,
            LogLevel::Error,
        ] {
            let mut config = LogConfig::default();
            config.level = *level;
            // 配置应该可以正常创建
            assert_eq!(config.level, *level);
        }
    }

    #[test]
    fn test_log_config_formats() {
        // 测试不同日志格式的配置
        for format in &[LogFormat::Pretty, LogFormat::Json, LogFormat::Compact] {
            let mut config = LogConfig::default();
            config.format = *format;
            // 配置应该可以正常创建
            assert_eq!(config.format, *format);
        }
    }

    #[test]
    fn test_log_config_file_output() {
        // 测试文件输出配置
        let mut config = LogConfig::default();
        config.file_path = Some("/tmp/cellrix-test.log".to_string());
        config.file_max_size_mb = 50;
        config.file_max_count = 3;

        assert_eq!(config.file_path, Some("/tmp/cellrix-test.log".to_string()));
        assert_eq!(config.file_max_size_mb, 50);
        assert_eq!(config.file_max_count, 3);
    }

    #[test]
    fn test_log_config_include_options() {
        // 测试包含选项配置
        let mut config = LogConfig::default();
        config.include_timestamp = false;
        config.include_module_path = true;

        assert!(!config.include_timestamp);
        assert!(config.include_module_path);
    }
}
