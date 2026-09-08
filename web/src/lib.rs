//! Shared plumbing for the cellrix-web panel and the `up` launcher.
//!
//! Thin re-export: transport lives in `http`, one-to-one binding in
//! `identity` — each file < 400 lines (DNA v1.1 400-line red line).

pub mod http;
pub mod identity;

pub use http::{fetch_json, post_json, post_stream, probe, unhealthy_names};
pub use identity::{client_bearer, extract_json_str, load_client_identity, sign_bearer};
