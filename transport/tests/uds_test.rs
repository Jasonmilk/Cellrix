// transport/tests/uds_test.rs
//! High-performance integration tests for UdsTransport under BIND-19 and CIC13.
//! 
//! Aligned with the standard Big-Endian network byte order.

use tokio::time::{sleep, Duration};
use tokio_stream::StreamExt;
use tokio::io::AsyncWriteExt;
use tempfile::tempdir;

use cellrix_transport::{CapTransport, UdsTransport};
use cellrix_protocol::{CapabilityManifest, AgentEvent};

/// Helper to generate a dummy capability manifest for client-side bootstrapping.
fn make_test_manifest(name: &str) -> CapabilityManifest {
    CapabilityManifest {
        agent_name: name.to_string(),
        version: "0.1.0".to_string(),
        actions: vec![],
        layout_hints: None,
    }
}

/// Helper to serialize and write a big-endian length-prefixed MessagePack frame to a raw UnixStream.
async fn write_test_frame<T: serde::Serialize>(stream: &mut tokio::net::UnixStream, msg: &T) -> Result<(), Box<dyn std::error::Error>> {
    let mut data = Vec::new();
    let mut serializer = rmp_serde::Serializer::new(&mut data).with_struct_map();
    msg.serialize(&mut serializer)?;

    let len_bytes = (data.len() as u32).to_be_bytes(); // Aligned to Big-Endian Network Byte Order

    stream.write_all(&len_bytes).await?;
    stream.write_all(&data).await?;
    stream.flush().await?;
    Ok(())
}

#[tokio::test]
async fn test_uds_symmetrical_handshake_and_framing() -> Result<(), Box<dyn std::error::Error>> {
    std::env::set_var("CELLRIX_SOCKET_PERMISSIONS", "0600");
    std::env::set_var("CELLRIX_IDLE_TIMEOUT", "5");
    std::env::set_var("CELLRIX_HEARTBEAT_TIMEOUT", "5");
    std::env::set_var("CELLRIX_PEER_VERIFY", "false");

    let tmp_dir = tempdir()?;
    let socket_path = tmp_dir.path().join("cellrix_test.sock");
    let socket_path_clone = socket_path.clone();

    // Spawn the Display Server (UdsRole::Server)
    let server_task = tokio::spawn(async move {
        let mut server = UdsTransport::new_server(socket_path_clone).await.unwrap();
        let (manifest, mut stream) = server.connect().await.unwrap();
        
        assert_eq!(manifest.agent_name, "test-agent-01");
        
        // Read subsequent streaming frames
        if let Some(Ok(AgentEvent::Heartbeat { epoch })) = stream.next().await {
            assert_eq!(epoch, 12345);
        } else {
            panic!("Expected heartbeat event from stream");
        }
    });

    sleep(Duration::from_millis(50)).await;

    // Start the Raw Socket Client (Simulating a real headless MiroFish agent)
    let mut raw_client = tokio::net::UnixStream::connect(&socket_path).await?;

    // Handshake: Write the CapabilityManifest as the first frame
    let client_manifest = make_test_manifest("test-agent-01");
    write_test_frame(&mut raw_client, &client_manifest).await?;

    // Frame 2: Write the Heartbeat event (CIB19 standard)
    let heartbeat = AgentEvent::Heartbeat { epoch: 12345 };
    write_test_frame(&mut raw_client, &heartbeat).await?;

    server_task.await?;
    Ok(())
}

#[tokio::test]
async fn test_cib19_watchdog_self_healing_timeout() -> Result<(), Box<dyn std::error::Error>> {
    std::env::set_var("CELLRIX_SOCKET_PERMISSIONS", "0600");
    std::env::set_var("CELLRIX_IDLE_TIMEOUT", "5");
    std::env::set_var("CELLRIX_HEARTBEAT_TIMEOUT", "1"); // 1-second watchdog budget
    std::env::set_var("CELLRIX_PEER_VERIFY", "false");

    let tmp_dir = tempdir()?;
    let socket_path = tmp_dir.path().join("cellrix_timeout_test.sock");
    let socket_path_clone = socket_path.clone();

    // Spawn Server
    let server_task = tokio::spawn(async move {
        let mut server = UdsTransport::new_server(socket_path_clone).await.unwrap();
        let (_manifest, mut stream) = server.connect().await.unwrap();
        
        // Listen. Watchdog should trigger self-healing in 1s.
        match stream.next().await {
            Some(Ok(AgentEvent::StreamError(e))) => {
                assert!(e.contains("CIB19 heartbeat timeout"));
            }
            other => {
                panic!("Expected a CIB19 timeout StreamError, got: {:?}", other);
            }
        }
    });

    sleep(Duration::from_millis(50)).await;

    // Connect raw client and stay absolutely silent
    let mut raw_client = tokio::net::UnixStream::connect(&socket_path).await?;
    let client_manifest = make_test_manifest("silent-agent");
    write_test_frame(&mut raw_client, &client_manifest).await?;

    server_task.await?;
    Ok(())
}
