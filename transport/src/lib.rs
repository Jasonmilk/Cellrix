mod cap_transport;
mod error;
mod stdio;
mod uds;
mod tcp;
pub mod protocol;

pub use cap_transport::{CapTransport, TransportStream, TransportError};
pub use cellrix_protocol::AgentEvent;  // Unified export from protocol layer
pub use stdio::StdioTransport;
pub use uds::{UdsTransport, UdsRole}; // Unified export of both Transport and its Role
pub use tcp::TcpTransport;
