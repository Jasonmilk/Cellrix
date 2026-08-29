mod cap_transport;
mod error;
mod stdio;
mod uds;
mod tcp;
pub mod protocol;
pub mod helix_mind_client;
pub mod anaphase_client;

pub use cap_transport::{CapTransport, TransportStream, TransportError};
pub use cellrix_protocol::AgentEvent;  // Unified export from protocol layer
pub use stdio::StdioTransport;
pub use uds::{UdsTransport, UdsRole}; // Unified export of both Transport and its Role
pub use tcp::TcpTransport;
pub use helix_mind_client::{
    HelixMindClient, MockHelixMindClient, ClientError,
    QueryRequest, QueryResult, RememberRequest, RememberResult,
    ForgetRequest, ForgetResult, ConsolidateRequest, ConsolidateResult, ConsolidateType,
};
pub use anaphase_client::{AnaphaseClient, MockAnaphaseClient};
