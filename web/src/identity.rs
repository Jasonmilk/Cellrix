//! One-to-one binding client (2026-09-07).
//!
//! The client holds the same secret Anaphase minted at confirm time, in
//! `~/.cellrix/identity.toml` (0600, written once by `up`'s guided bind).
//! Every request is signed fresh: Bearer v1.<id>.<ts>.<nonce>.<hmac> —
//! replay dies on the Anaphase side (window + one-time nonce).

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Read the client identity file (device_id + secret). Missing/empty =
/// unbound — callers then simply send no header (Anaphase is open until
/// bound, honest "not bound" state).
pub fn load_client_identity() -> Option<(String, String)> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home).join(".cellrix/identity.toml");
    let body = std::fs::read_to_string(path).ok()?;
    let mut id = None;
    let mut secret = None;
    for line in body.lines() {
        let line = line.trim();
        let Some((k, v)) = line.split_once('=') else { continue };
        let v = v.trim().trim_matches('"').to_string();
        match k.trim() {
            "device_id" => id = Some(v),
            "secret" => secret = Some(v),
            _ => {}
        }
    }
    match (id, secret) {
        (Some(id), Some(secret)) => Some((id, secret)),
        _ => None,
    }
}

/// Build a fresh signed token for (device_id, secret). The token is the
/// bare `v1.<id>.<ts>.<nonce>.<hmac>` part — `fetch_json` prepends the
/// `Authorization: Bearer ` wrapper (same contract as the Tuck key).
pub fn sign_bearer(device_id: &str, secret: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let ts = now.as_secs().to_string();
    // Nonce: nanosecond clock + pid — unique per request (a same-second
    // repeat would be rejected as a replay by the Anaphase side).
    static NONCE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = NONCE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed) as u128;
    let nonce =
        format!("{:x}", now.as_nanos() ^ (std::process::id() as u128) ^ (seq << 32) ^ 0x5f3759dfu128);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(format!("{device_id}|{ts}|{nonce}").as_bytes());
    let mac = mac.finalize().into_bytes();
    let mac_hex: String = mac.iter().map(|b| format!("{b:02x}")).collect();
    format!("v1.{device_id}.{ts}.{nonce}.{mac_hex}")
}

/// Signed token if bound, else None (unbound → no header → Anaphase open).
pub fn client_bearer() -> Option<String> {
    load_client_identity().map(|(id, secret)| sign_bearer(&id, &secret))
}

/// Minimal JSON string-field extractor (no serde dependency — 极致节能).
/// Finds `"key":"value"` / `"key": "value"` and returns value, else None.
pub fn extract_json_str(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let idx = body.find(&needle)?;
    let rest = &body[idx + needle.len()..];
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_bearer_shape() {
        let secret = "k".repeat(32);
        let tok = sign_bearer("anaphase#abc123", &secret);
        let parts: Vec<&str> = tok.split('.').collect();
        // v1.<id>.<ts>.<nonce>.<hmac> — fetch_json prepends "Bearer ".
        assert_eq!(parts.len(), 5);
        assert_eq!(parts[0], "v1");
        assert!(parts[1].starts_with("anaphase#"));
        assert!(parts[2].parse::<u64>().is_ok());
        assert!(!parts[3].is_empty());
        assert_eq!(parts[4].len(), 64);
    }

    #[test]
    fn sign_bearer_unique_per_call() {
        let secret = "k".repeat(32);
        let a = sign_bearer("anaphase#abc123", &secret);
        let b = sign_bearer("anaphase#abc123", &secret);
        assert_ne!(a, b);
    }

    #[test]
    fn extract_json_str_finds_values() {
        assert_eq!(extract_json_str(r#"{"pairing_code":"123456"}"#, "pairing_code").as_deref(), Some("123456"));
        assert_eq!(extract_json_str(r#"{"bound": true}"#, "bound"), None);
    }
}
