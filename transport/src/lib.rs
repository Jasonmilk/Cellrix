mod cap_transport;
mod error;
mod stdio;
mod uds;
mod tcp;
pub mod protocol;

pub use cap_transport::{CapTransport, TransportStream, TransportError};
pub use cellrix_protocol::AgentEvent;  // 统一从协议层对外导出
pub use stdio::StdioTransport;
pub use uds::UdsTransport;
pub use tcp::TcpTransport;
