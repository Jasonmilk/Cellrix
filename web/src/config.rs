//! Panel configuration: argv → env → protocol defaults.
//!
//! Zero-hardcoding: endpoint defaults are the documented protocol defaults
//! (ADR-0010 / Tuck gateway); `--tuck-limit` default 200 matches the CLI
//! contract; unset tuck -> Engram shows a setup hint.

/// Web panel listening port when no `--port`/`WEB_PORT` is given (this
/// panel's documented protocol default; unassigned common HTTP port).
pub const WEB_PORT_DEFAULT: u16 = 8080;

/// Anaphase cap_http protocol default (ADR-0010).
pub const ANAPHASE_ENDPOINT_DEFAULT: &str = "http://127.0.0.1:50061";

/// Tuck audit query window default (matches the CLI contract).
pub const TUCK_LIMIT_DEFAULT: usize = 200;

/// Panel auto-refresh seconds (browser polling interval).
pub const REFRESH_SECS: u64 = 2;

/// Runtime panel configuration. All optional parts default to the protocol
/// defaults above — nothing here is guessed or hardcoded ad hoc.
#[derive(Clone)]
pub struct PanelConfig {
    pub anaphase_endpoint: String,
    pub tuck_endpoint: Option<String>,
    pub tuck_key: Option<String>,
    pub tuck_limit: usize,
    pub flowmodus_url: Option<String>,
}

impl PanelConfig {
    /// Derive from argv (flags win), then env, then protocol defaults.
    pub fn derive(args: &[String]) -> Self {
        let flag = |name: &str| {
            args.windows(2)
                .find(|w| w[0] == name)
                .map(|w| w[1].clone())
                .filter(|v| !v.is_empty())
        };
        let env = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());

        let anaphase_endpoint = flag("--anaphase-endpoint")
            .or_else(|| env("ANAPHASE_ENDPOINT"))
            .unwrap_or_else(|| ANAPHASE_ENDPOINT_DEFAULT.to_string());

        let tuck_endpoint = flag("--tuck-endpoint").or_else(|| env("TUCK_ENDPOINT"));
        let tuck_key = flag("--tuck-key").or_else(|| env("TUCK_KEY"));
        let tuck_limit = flag("--tuck-limit")
            .and_then(|v| v.parse::<usize>().ok())
            .or_else(|| env("TUCK_LIMIT").and_then(|v| v.parse().ok()))
            .unwrap_or(TUCK_LIMIT_DEFAULT);

        let flowmodus_url = flag("--flowmodus-url").or_else(|| env("FLOWMODUS_URL"));

        Self {
            anaphase_endpoint,
            tuck_endpoint,
            tuck_key,
            tuck_limit,
            flowmodus_url,
        }
    }
}
