use serde::{Serialize, Deserialize};
use crate::{SemanticSnapshot, ProtocolError};

/// View hash: cryptographic fingerprint to anchor displayed content
/// Only type definition here, actual calculation algorithm implemented by upper layer such as cellrix-ui.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ViewHash(pub [u8; 32]);

/// Context for deterministic hash calculation (exclude transient layout data)
#[derive(Debug, Clone)]
pub struct HashContext {
    pub snapshot: SemanticSnapshot,
    /// Mapping from node id to slot id (node_id -> slot_id)
    pub slot_bindings: Vec<(String, String)>,
    pub theme_version: String,
}

/// Trait for view hash calculation, implemented by render backend
pub trait ViewHashCompute {
    fn compute_deterministic_hash(&self, ctx: &HashContext) -> Result<ViewHash, ProtocolError>;
}
