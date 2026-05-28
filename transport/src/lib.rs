//! # cellrix-transport — Communication layer for Cellrix
//!
//! Implements CapTransport trait over STDIO (subprocess), UDS, and TCP.
//! Supports CIB format negotiation (MessagePack by default, JSON fallback).

mod cap_transport;
mod stdio;
mod uds;
mod tcp;
mod protocol;

pub use cap_transport::{CapTransport, TransportError};
pub use stdio::StdioTransport;
pub use uds::UdsTransport;
pub use tcp::TcpTransport;
