//! Panel configuration: argv → env → protocol defaults.
//!
//! Zero-hardcoding: endpoint defaults are the documented protocol defaults
//! (ADR-0010 / Tuck gateway); `--tuck-limit` default 200 matches the CLI
//! contract; unset tuck -> ProveTrack shows a setup hint.


/// Anaphase cap_http protocol default (ADR-0010).
pub const ANAPHASE_ENDPOINT_DEFAULT: &str = "http://127.0.0.1:50061";

/// FlowModus supplier pool / router protocol default — the port its own
/// `serve` subcommand documents. Same reasoning as the Anaphase default above:
/// a documented protocol default, not a guess. It is a read-only display source
/// for the Flows view, so a service that is down simply yields the honest zero
/// state (`flows: null`) rather than being treated as a security decision —
/// which is why it gets a default while `tuck_endpoint` deliberately does not.
pub const FLOWMODUS_URL_DEFAULT: &str = "http://127.0.0.1:60053";

/// Tuck audit query window default (matches the CLI contract).
pub const TUCK_LIMIT_DEFAULT: usize = 200;

/// Period-list window the `/api/sessions` proxy forwards when the caller names
/// no limit. Matches Anaphase's own `/v1/sessions` default (50), so omitting the
/// parameter behaves exactly as calling the service directly would.
pub const SESSIONS_LIMIT_DEFAULT: usize = 50;

/// Upper bound on a forwarded period-list window. The caller's limit used to be
/// discarded outright (hardcoded 50), which silently truncated lineage chains;
/// it is now honoured, but bounded so a stray value cannot turn a 2 s panel poll
/// into an unbounded directory scan. 500 is what the shell asks for and is well
/// clear of the 130 periods on this machine.
pub const SESSIONS_LIMIT_MAX: usize = 500;

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

        // Protocol default, not None. It used to be flag/env-only, so whichever
        // launcher forgot the flag produced a silently empty Flows view — and
        // `up`, the one-command path, was exactly that launcher (`up.rs` passed
        // it only when the user supplied it), while `start-panel.sh` did pass
        // it. A display source with a documented protocol port should not
        // depend on remembering a flag.
        let flowmodus_url = Some(
            flag("--flowmodus-url")
                .or_else(|| env("FLOWMODUS_URL"))
                .unwrap_or_else(|| FLOWMODUS_URL_DEFAULT.to_string()),
        );

        Self {
            anaphase_endpoint,
            tuck_endpoint,
            tuck_key,
            tuck_limit,
            flowmodus_url,
        }
    }
}
