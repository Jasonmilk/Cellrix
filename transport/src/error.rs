use thiserror::Error;

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Protocol error: {0}")]
    Protocol(String),
    #[error("Remote error: {0}")]
    Remote(String),
    #[error("Not implemented: {0}")]
    NotImplemented(String),
    #[error("Timeout after {0} ms")]
    Timeout(u64),
}
