# ADR-0008: 生产就绪架构决策

**状态**：已采纳
**日期**：2026-08-30
**阶段**：P6
**关联**：P6-T1/T2/T3

## 背景

Cellrix 已完成 Helix 生态四大组件（Tuck/Helix-Mind/Anaphase/Tentacle）的联调，需要进入生产就绪阶段，包括配置管理、日志系统、监控指标和部署方案。

## 决策

### 1. 配置管理（P6-T1）

- 使用 `config` crate 支持多层配置（默认值 < 配置文件 < 环境变量 < 命令行参数）
- 配置结构体：`CellrixConfig`（日志配置 + 客户端配置 + UI 配置 + 监控配置）
- 环境变量前缀：`CELLRIX_`
- 配置文件格式：TOML（可选，默认不使用）

### 2. 日志系统（P6-T2）

- 使用 `tracing` crate 提供结构化日志
- 日志级别：TRACE/DEBUG/INFO/WARN/ERROR（默认 INFO）
- 日志输出：stdout（默认）+ 文件（可选，支持轮转）
- 日志格式：JSON（生产）+ 人类可读（开发）
- 集成 `tracing-subscriber` 提供过滤器和格式化

### 3. 监控指标（P6-T3）

- 使用 `metrics` crate 提供指标 trait
- 核心指标：
  - `cellrix_client_requests_total`（客户端请求总数，按组件/方法/结果标签）
  - `cellrix_client_request_duration_seconds`（客户端请求耗时直方图）
  - `cellrix_ui_render_errors_total`（UI 渲染错误总数）
  - `cellrix_health_check_status`（健康检查状态，0=不健康，1=健康）
- 健康检查：`HealthChecker` trait，支持多组件健康检查（Tuck/Helix-Mind/Anaphase/Tentacle）
- 指标导出：Prometheus（可选 feature），默认使用内存存储

### 4. 部署方案（文档）

- 示例二进制：`cellrix-demo`（演示所有组件的集成）
- Dockerfile：多阶段构建，最小镜像
- systemd service：示例配置
- 配置文档：环境变量列表 + 配置文件示例

## 理由

- **极致解耦**：配置/日志/监控都是可选的，不强制依赖
- **按需加载**：使用 feature flag 控制可选依赖（prometheus 等）
- **极致复用**：使用成熟的 Rust 生态 crate（config/tracing/metrics）
- **生产就绪**：结构化日志 + 指标 + 健康检查是生产环境的基本要求

## 后果

### 正面
- Cellrix 可以作为生产级库使用
- 上层应用可以轻松接入配置/日志/监控
- 提供示例二进制和部署文档，降低使用门槛

### 负面
- 增加依赖数量（config/tracing/metrics）
- 需要维护示例二进制和部署文档

## 参考

- ADR-0003: Tuck 对接架构决策
- ADR-0005: Helix-Mind 联调架构决策
- ADR-0006: Anaphase 联调架构决策
- ADR-0007: Tentacle 联调架构决策
