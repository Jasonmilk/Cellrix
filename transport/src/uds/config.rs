use crate::cap_transport::TransportError;

/// Layered configuration resolver for the Cellrix Daemon/Client runtime.
#[derive(Debug, Clone)]
pub struct CellrixDaemonConfig {
    pub socket_permissions: u32,
    pub idle_shutdown_seconds: u64,
    pub enable_peer_verification: bool,
}

impl CellrixDaemonConfig {
    /// Loads configuration dynamically from environment or fallbacks.
    pub fn load_layered() -> Result<Self, TransportError> {
        let mut config = Self::default();

        if let Ok(env_val) = std::env::var("CELLRIX_SOCKET_PERMISSIONS") {
            if let Ok(parsed) = u32::from_str_radix(&env_val, 8) {
                config.socket_permissions = parsed;
            } else {
                return Err(TransportError::Protocol(format!(
                    "Invalid octal format for CELLRIX_SOCKET_PERMISSIONS: {}", env_val
                )));
            }
        }

        if let Ok(env_val) = std::env::var("CELLRIX_IDLE_TIMEOUT") {
            if let Ok(parsed) = env_val.parse::<u64>() {
                config.idle_shutdown_seconds = parsed;
            } else {
                return Err(TransportError::Protocol(format!(
                    "Invalid integer for CELLRIX_IDLE_TIMEOUT: {}", env_val
                )));
            }
        }

        if let Ok(env_val) = std::env::var("CELLRIX_PEER_VERIFY") {
            if env_val.to_lowercase() == "false" || env_val == "0" {
                config.enable_peer_verification = false;
            }
        }

        Ok(config)
    }

    fn default() -> Self {
        Self {
            socket_permissions: 0o600,
            idle_shutdown_seconds: 5,
            enable_peer_verification: true,
        }
    }
}
