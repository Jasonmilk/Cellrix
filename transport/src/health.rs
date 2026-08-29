//! Cellrix 健康检查与监控指标
//!
//! # Design Principle
//!
//! **极致解耦**: 健康检查是可选的，不强制依赖 metrics crate。
//! **按需驱动**: 健康检查按需触发，不轮询。
//! **确定性优先**: 健康状态有明确的枚举值。
//!
//! # Components
//!
//! - `HealthStatus`: 健康状态枚举
//! - `ComponentHealth`: 组件健康状态
//! - `HealthCheckResult`: 健康检查结果
//! - `HealthChecker`: 健康检查 trait
//! - `CompositeHealthChecker`: 组合健康检查器
//! - `MetricsCollector`: 监控指标收集器 trait
//! - `MemoryMetricsCollector`: 内存指标收集器

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ============================================================================
// Health Status
// ============================================================================

/// 健康状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    /// 健康
    Healthy,
    /// 降级（部分功能不可用）
    Degraded,
    /// 不健康
    Unhealthy,
    /// 未知（未检查）
    Unknown,
}

impl HealthStatus {
    /// 获取状态标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Unhealthy => "unhealthy",
            Self::Unknown => "unknown",
        }
    }

    /// 是否健康
    pub fn is_healthy(&self) -> bool {
        matches!(self, Self::Healthy)
    }

    /// 是否严重（不健康）
    pub fn is_critical(&self) -> bool {
        matches!(self, Self::Unhealthy)
    }
}

impl Default for HealthStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

impl std::fmt::Display for HealthStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

// ============================================================================
// Component Health
// ============================================================================

/// 组件类型
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentType {
    /// Tuck（免疫系统）
    Tuck,
    /// Helix-Mind（记忆中枢）
    HelixMind,
    /// Anaphase（编排中枢）
    Anaphase,
    /// Tentacle（工具执行）
    Tentacle,
    /// Cellrix 自身
    Cellrix,
    /// 其他组件
    Other(String),
}

impl ComponentType {
    /// 获取组件名称
    pub fn name(&self) -> &str {
        match self {
            Self::Tuck => "tuck",
            Self::HelixMind => "helix_mind",
            Self::Anaphase => "anaphase",
            Self::Tentacle => "tentacle",
            Self::Cellrix => "cellrix",
            Self::Other(name) => name.as_str(),
        }
    }
}

impl std::fmt::Display for ComponentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name())
    }
}

/// 组件健康状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentHealth {
    /// 组件类型
    pub component: ComponentType,
    /// 健康状态
    pub status: HealthStatus,
    /// 健康消息
    pub message: Option<String>,
    /// 最后检查时间
    pub last_checked: Option<String>,
    /// 响应时间（毫秒）
    pub response_time_ms: Option<u64>,
    /// 版本
    pub version: Option<String>,
}

impl ComponentHealth {
    /// 创建新的组件健康状态
    pub fn new(component: ComponentType, status: HealthStatus) -> Self {
        Self {
            component,
            status,
            message: None,
            last_checked: None,
            response_time_ms: None,
            version: None,
        }
    }

    /// 设置消息
    pub fn with_message(mut self, message: &str) -> Self {
        self.message = Some(message.to_string());
        self
    }

    /// 设置响应时间
    pub fn with_response_time(mut self, ms: u64) -> Self {
        self.response_time_ms = Some(ms);
        self
    }

    /// 设置版本
    pub fn with_version(mut self, version: &str) -> Self {
        self.version = Some(version.to_string());
        self
    }

    /// 标记检查时间
    pub fn mark_checked(&mut self) {
        self.last_checked = Some(now_unix_string());
    }
}

// ============================================================================
// Health Check Result
// ============================================================================

/// 健康检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResult {
    /// 整体健康状态
    pub overall_status: HealthStatus,
    /// 组件健康状态映射
    pub components: HashMap<String, ComponentHealth>,
    /// 检查时间
    pub checked_at: String,
    /// 总检查耗时（毫秒）
    pub total_duration_ms: u64,
}

impl HealthCheckResult {
    /// 创建新的健康检查结果
    pub fn new() -> Self {
        Self {
            overall_status: HealthStatus::Unknown,
            components: HashMap::new(),
            checked_at: now_unix_string(),
            total_duration_ms: 0,
        }
    }

    /// 添加组件健康状态
    pub fn add_component(&mut self, health: ComponentHealth) {
        self.components.insert(health.component.name().to_string(), health);
        self.recalculate_overall();
    }

    /// 重新计算整体健康状态
    fn recalculate_overall(&mut self) {
        if self.components.is_empty() {
            self.overall_status = HealthStatus::Unknown;
            return;
        }

        let mut has_unhealthy = false;
        let mut has_degraded = false;
        let mut all_unknown = true;

        for component in self.components.values() {
            match component.status {
                HealthStatus::Unhealthy => has_unhealthy = true,
                HealthStatus::Degraded => has_degraded = true,
                HealthStatus::Healthy => all_unknown = false,
                HealthStatus::Unknown => {}
            }
        }

        self.overall_status = if has_unhealthy {
            HealthStatus::Unhealthy
        } else if has_degraded {
            HealthStatus::Degraded
        } else if all_unknown {
            HealthStatus::Unknown
        } else {
            HealthStatus::Healthy
        };
    }

    /// 是否健康
    pub fn is_healthy(&self) -> bool {
        self.overall_status.is_healthy()
    }

    /// 获取不健康的组件
    pub fn unhealthy_components(&self) -> Vec<&ComponentHealth> {
        self.components
            .values()
            .filter(|c| c.status.is_critical())
            .collect()
    }
}

impl Default for HealthCheckResult {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Health Checker Trait
// ============================================================================

/// 健康检查器 trait
#[async_trait]
pub trait HealthChecker: Send + Sync {
    /// 组件类型
    fn component_type(&self) -> ComponentType;

    /// 执行健康检查
    async fn check(&self) -> ComponentHealth;
}

/// 组合健康检查器
pub struct CompositeHealthChecker {
    checkers: Vec<Box<dyn HealthChecker>>,
    timeout: Duration,
}

impl CompositeHealthChecker {
    /// 创建新的组合健康检查器
    pub fn new() -> Self {
        Self {
            checkers: Vec::new(),
            timeout: Duration::from_secs(5),
        }
    }

    /// 添加健康检查器
    pub fn add_checker(mut self, checker: Box<dyn HealthChecker>) -> Self {
        self.checkers.push(checker);
        self
    }

    /// 设置超时时间
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// 执行所有健康检查
    pub async fn check_all(&self) -> HealthCheckResult {
        let start = Instant::now();
        let mut result = HealthCheckResult::new();

        for checker in &self.checkers {
            let component_start = Instant::now();
            let mut health = checker.check().await;
            health.response_time_ms = Some(component_start.elapsed().as_millis() as u64);
            health.mark_checked();
            result.add_component(health);
        }

        result.total_duration_ms = start.elapsed().as_millis() as u64;
        result
    }

    /// 检查器数量
    pub fn checker_count(&self) -> usize {
        self.checkers.len()
    }
}

impl Default for CompositeHealthChecker {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Mock Health Checker
// ============================================================================

/// Mock 健康检查器（用于测试）
pub struct MockHealthChecker {
    component: ComponentType,
    status: HealthStatus,
    message: Option<String>,
    version: Option<String>,
}

impl MockHealthChecker {
    /// 创建新的 mock 健康检查器
    pub fn new(component: ComponentType, status: HealthStatus) -> Self {
        Self {
            component,
            status,
            message: None,
            version: None,
        }
    }

    /// 设置消息
    pub fn with_message(mut self, message: &str) -> Self {
        self.message = Some(message.to_string());
        self
    }

    /// 设置版本
    pub fn with_version(mut self, version: &str) -> Self {
        self.version = Some(version.to_string());
        self
    }
}

#[async_trait]
impl HealthChecker for MockHealthChecker {
    fn component_type(&self) -> ComponentType {
        self.component.clone()
    }

    async fn check(&self) -> ComponentHealth {
        let mut health = ComponentHealth::new(self.component.clone(), self.status);
        if let Some(message) = &self.message {
            health.message = Some(message.clone());
        }
        if let Some(version) = &self.version {
            health.version = Some(version.clone());
        }
        health
    }
}

// ============================================================================
// Metrics Collector
// ============================================================================

/// 指标类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MetricType {
    /// 计数器（单调递增）
    Counter,
    /// 仪表盘（可增可减）
    Gauge,
    /// 直方图（分布）
    Histogram,
}

/// 指标值
#[derive(Debug, Clone)]
pub enum MetricValue {
    /// 计数器值
    Counter(u64),
    /// 仪表盘值
    Gauge(f64),
    /// 直方图值（样本数 + 总和）
    Histogram { count: u64, sum: f64 },
}

/// 指标定义
#[derive(Debug, Clone)]
pub struct MetricDefinition {
    /// 指标名称
    pub name: String,
    /// 指标描述
    pub description: String,
    /// 指标类型
    pub metric_type: MetricType,
    /// 标签（key-value 对）
    pub labels: HashMap<String, String>,
}

/// 监控指标收集器 trait
pub trait MetricsCollector: Send + Sync {
    /// 增加计数器
    fn increment_counter(&self, name: &str, labels: &HashMap<String, String>);

    /// 设置仪表盘值
    fn set_gauge(&self, name: &str, value: f64, labels: &HashMap<String, String>);

    /// 记录直方图值
    fn record_histogram(&self, name: &str, value: f64, labels: &HashMap<String, String>);

    /// 获取指标快照
    fn snapshot(&self) -> HashMap<String, MetricValue>;
}

/// 内存指标收集器（默认实现）
pub struct MemoryMetricsCollector {
    counters: Mutex<HashMap<String, u64>>,
    gauges: Mutex<HashMap<String, f64>>,
    histograms: Mutex<HashMap<String, (u64, f64)>>,
}

impl MemoryMetricsCollector {
    /// 创建新的内存指标收集器
    pub fn new() -> Self {
        Self {
            counters: Mutex::new(HashMap::new()),
            gauges: Mutex::new(HashMap::new()),
            histograms: Mutex::new(HashMap::new()),
        }
    }

    /// 生成指标键（名称 + 标签）
    fn metric_key(name: &str, labels: &HashMap<String, String>) -> String {
        let mut label_parts: Vec<String> = labels
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();
        label_parts.sort();
        format!("{}{{{}}}", name, label_parts.join(","))
    }
}

impl Default for MemoryMetricsCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl MetricsCollector for MemoryMetricsCollector {
    fn increment_counter(&self, name: &str, labels: &HashMap<String, String>) {
        let key = Self::metric_key(name, labels);
        let mut counters = self.counters.lock().unwrap();
        *counters.entry(key).or_insert(0) += 1;
    }

    fn set_gauge(&self, name: &str, value: f64, labels: &HashMap<String, String>) {
        let key = Self::metric_key(name, labels);
        let mut gauges = self.gauges.lock().unwrap();
        gauges.insert(key, value);
    }

    fn record_histogram(&self, name: &str, value: f64, labels: &HashMap<String, String>) {
        let key = Self::metric_key(name, labels);
        let mut histograms = self.histograms.lock().unwrap();
        let entry = histograms.entry(key).or_insert((0, 0.0));
        entry.0 += 1;
        entry.1 += value;
    }

    fn snapshot(&self) -> HashMap<String, MetricValue> {
        let mut snapshot = HashMap::new();

        let counters = self.counters.lock().unwrap();
        for (key, value) in counters.iter() {
            snapshot.insert(key.clone(), MetricValue::Counter(*value));
        }

        let gauges = self.gauges.lock().unwrap();
        for (key, value) in gauges.iter() {
            snapshot.insert(key.clone(), MetricValue::Gauge(*value));
        }

        let histograms = self.histograms.lock().unwrap();
        for (key, (count, sum)) in histograms.iter() {
            snapshot.insert(
                key.clone(),
                MetricValue::Histogram {
                    count: *count,
                    sum: *sum,
                },
            );
        }

        snapshot
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// 获取当前 Unix 时间戳字符串
fn now_unix_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_status_label() {
        assert_eq!(HealthStatus::Healthy.label(), "healthy");
        assert_eq!(HealthStatus::Degraded.label(), "degraded");
        assert_eq!(HealthStatus::Unhealthy.label(), "unhealthy");
        assert_eq!(HealthStatus::Unknown.label(), "unknown");
    }

    #[test]
    fn test_health_status_is_healthy() {
        assert!(HealthStatus::Healthy.is_healthy());
        assert!(!HealthStatus::Degraded.is_healthy());
        assert!(!HealthStatus::Unhealthy.is_healthy());
    }

    #[test]
    fn test_health_status_is_critical() {
        assert!(HealthStatus::Unhealthy.is_critical());
        assert!(!HealthStatus::Healthy.is_critical());
        assert!(!HealthStatus::Degraded.is_critical());
    }

    #[test]
    fn test_health_status_default() {
        assert_eq!(HealthStatus::default(), HealthStatus::Unknown);
    }

    #[test]
    fn test_component_type_name() {
        assert_eq!(ComponentType::Tuck.name(), "tuck");
        assert_eq!(ComponentType::HelixMind.name(), "helix_mind");
        assert_eq!(ComponentType::Anaphase.name(), "anaphase");
        assert_eq!(ComponentType::Tentacle.name(), "tentacle");
        assert_eq!(ComponentType::Cellrix.name(), "cellrix");
        assert_eq!(ComponentType::Other("custom".to_string()).name(), "custom");
    }

    #[test]
    fn test_component_health_new() {
        let health = ComponentHealth::new(ComponentType::Tuck, HealthStatus::Healthy);
        assert_eq!(health.component, ComponentType::Tuck);
        assert_eq!(health.status, HealthStatus::Healthy);
        assert!(health.message.is_none());
        assert!(health.last_checked.is_none());
    }

    #[test]
    fn test_component_health_builders() {
        let health = ComponentHealth::new(ComponentType::Tuck, HealthStatus::Healthy)
            .with_message("OK")
            .with_response_time(50)
            .with_version("1.0.0");

        assert_eq!(health.message, Some("OK".to_string()));
        assert_eq!(health.response_time_ms, Some(50));
        assert_eq!(health.version, Some("1.0.0".to_string()));
    }

    #[test]
    fn test_component_health_mark_checked() {
        let mut health = ComponentHealth::new(ComponentType::Tuck, HealthStatus::Healthy);
        assert!(health.last_checked.is_none());
        health.mark_checked();
        assert!(health.last_checked.is_some());
    }

    #[test]
    fn test_health_check_result_new() {
        let result = HealthCheckResult::new();
        assert_eq!(result.overall_status, HealthStatus::Unknown);
        assert!(result.components.is_empty());
        assert!(!result.checked_at.is_empty());
    }

    #[test]
    fn test_health_check_result_add_component() {
        let mut result = HealthCheckResult::new();
        result.add_component(ComponentHealth::new(ComponentType::Tuck, HealthStatus::Healthy));
        assert_eq!(result.components.len(), 1);
        assert_eq!(result.overall_status, HealthStatus::Healthy);
        assert!(result.is_healthy());
    }

    #[test]
    fn test_health_check_result_unhealthy() {
        let mut result = HealthCheckResult::new();
        result.add_component(ComponentHealth::new(ComponentType::Tuck, HealthStatus::Healthy));
        result.add_component(ComponentHealth::new(ComponentType::Tentacle, HealthStatus::Unhealthy));
        assert_eq!(result.overall_status, HealthStatus::Unhealthy);
        assert!(!result.is_healthy());
        assert_eq!(result.unhealthy_components().len(), 1);
    }

    #[test]
    fn test_health_check_result_degraded() {
        let mut result = HealthCheckResult::new();
        result.add_component(ComponentHealth::new(ComponentType::Tuck, HealthStatus::Healthy));
        result.add_component(ComponentHealth::new(ComponentType::Tentacle, HealthStatus::Degraded));
        assert_eq!(result.overall_status, HealthStatus::Degraded);
    }

    #[tokio::test]
    async fn test_mock_health_checker() {
        let checker = MockHealthChecker::new(ComponentType::Tuck, HealthStatus::Healthy)
            .with_message("OK")
            .with_version("1.0.0");

        assert_eq!(checker.component_type(), ComponentType::Tuck);
        let health = checker.check().await;
        assert_eq!(health.status, HealthStatus::Healthy);
        assert_eq!(health.message, Some("OK".to_string()));
        assert_eq!(health.version, Some("1.0.0".to_string()));
    }

    #[tokio::test]
    async fn test_composite_health_checker() {
        let checker = CompositeHealthChecker::new()
            .add_checker(Box::new(MockHealthChecker::new(
                ComponentType::Tuck,
                HealthStatus::Healthy,
            )))
            .add_checker(Box::new(MockHealthChecker::new(
                ComponentType::Tentacle,
                HealthStatus::Degraded,
            )));

        assert_eq!(checker.checker_count(), 2);
        let result = checker.check_all().await;
        assert_eq!(result.components.len(), 2);
        assert_eq!(result.overall_status, HealthStatus::Degraded);
        assert!(result.total_duration_ms >= 0);
    }

    #[test]
    fn test_memory_metrics_collector_counter() {
        let collector = MemoryMetricsCollector::new();
        let labels = HashMap::new();

        collector.increment_counter("test_counter", &labels);
        collector.increment_counter("test_counter", &labels);

        let snapshot = collector.snapshot();
        if let Some(MetricValue::Counter(value)) = snapshot.get("test_counter{}") {
            assert_eq!(*value, 2);
        } else {
            panic!("Expected counter metric");
        }
    }

    #[test]
    fn test_memory_metrics_collector_gauge() {
        let collector = MemoryMetricsCollector::new();
        let labels = HashMap::new();

        collector.set_gauge("test_gauge", 42.5, &labels);

        let snapshot = collector.snapshot();
        if let Some(MetricValue::Gauge(value)) = snapshot.get("test_gauge{}") {
            assert!((*value - 42.5).abs() < 0.001);
        } else {
            panic!("Expected gauge metric");
        }
    }

    #[test]
    fn test_memory_metrics_collector_histogram() {
        let collector = MemoryMetricsCollector::new();
        let labels = HashMap::new();

        collector.record_histogram("test_histogram", 1.0, &labels);
        collector.record_histogram("test_histogram", 2.0, &labels);

        let snapshot = collector.snapshot();
        if let Some(MetricValue::Histogram { count, sum }) = snapshot.get("test_histogram{}") {
            assert_eq!(*count, 2);
            assert!((*sum - 3.0).abs() < 0.001);
        } else {
            panic!("Expected histogram metric");
        }
    }

    #[test]
    fn test_metric_key_with_labels() {
        let mut labels = HashMap::new();
        labels.insert("component".to_string(), "tuck".to_string());
        labels.insert("method".to_string(), "get".to_string());

        let key = MemoryMetricsCollector::metric_key("test", &labels);
        assert!(key.contains("test{"));
        assert!(key.contains("component=tuck"));
        assert!(key.contains("method=get"));
    }
}
