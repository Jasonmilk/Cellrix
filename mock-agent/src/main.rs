// mock-agent/src/main.rs
//! Mock agent implementing the CI-144 protocol family over STDIO or UDS.
//! 
//! Aligned with:
//! - CIN7: Intent specification (7 core semantic fields)
//! - CIC13: Capability credential (13-byte salt entropy)
//! - CIB19: Binding transmission (19s prime-number anti-resonance heartbeat)

use clap::Parser;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::UnixListener;
use tokio::sync::Mutex;
use tokio::time::Duration;
use cellrix_protocol::{
    CapabilityManifest, Action, SecurityClass,
    SemanticSnapshot, SemanticNode, NodeType,
    ActionRequest, ActionResponse, AgentEvent
};
use rmp_serde::from_slice;
use serde::Serialize;

/// Default BIND-19 (CIB19) heartbeat interval: 19 seconds (prime number to avoid system resonance)
pub const DEFAULT_HEARTBEAT_INTERVAL_SECS: u64 = 19;

/// The CI-144 official MessagePack handshake sub-protocol header
const PREFERRED_FORMAT: &str = "CIB19 MSGPACK\n";

#[derive(Parser)]
#[command(name = "mock-agent")]
#[command(about = "Mock agent for CI-144 protocol family testing")]
struct Cli {
    #[arg(short, long)]
    mode: Mode,
    #[arg(long, help = "UDS socket file path (only for uds mode)")]
    socket: Option<String>,
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum Mode {
    Stdio,
    Uds,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.mode {
        Mode::Stdio => run_stdio().await,
        Mode::Uds => {
            let path = cli.socket
                .ok_or_else(|| anyhow::anyhow!("--socket argument is required for uds mode"))?;
            run_uds(&path).await
        }
    }
}

async fn run_stdio() -> anyhow::Result<()> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let mut reader = BufReader::new(stdin);
    let writer = Arc::new(Mutex::new(BufWriter::new(stdout)));

    // CI-144 CIB19 handshake pipeline
    let mut handshake_line = String::new();
    reader.read_line(&mut handshake_line).await?;
    
    // Tolerant handshake check: support both legacy and official CI-144 CIB19 headers
    if !handshake_line.starts_with("CIB19") && !handshake_line.starts_with("CIB/1.0") {
        anyhow::bail!("Invalid CI-144 handshake header");
    }
    writer.lock().await.write_all(PREFERRED_FORMAT.as_bytes()).await?;
    writer.lock().await.flush().await?;

    // 1. Push manifest/update event (Aligns with CIN7 / CIC13 specs)
    write_event(&writer, AgentEvent::Manifest(make_manifest())).await?;

    // 2. Spawn heartbeat task (strictly aligned with BIND-19 19s prime number interval)
    let heartbeat_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        // Aligned with CIB19 standard default interval
        let mut interval = tokio::time::interval(Duration::from_secs(DEFAULT_HEARTBEAT_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let epoch = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if let Err(e) = write_event(&heartbeat_writer, AgentEvent::Heartbeat { epoch }).await {
                eprintln!("Heartbeat send failed: {}", e);
                break;
            }
        }
    });

    // 3. Spawn snapshot push loop (monastic refresh interval: 200ms)
    let snapshot_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        loop {
            interval.tick().await;
            if let Err(e) = write_event(&snapshot_writer, AgentEvent::Snapshot(make_snapshot())).await {
                eprintln!("Snapshot send failed: {}", e);
                break;
            }
        }
    });

    // 4. Main loop: read incoming ActionRequests
    loop {
        match read_frame(&mut reader).await {
            Ok(Some(Frame::Action(action))) => {
                let response = handle_action(action);
                write_frame(&writer, &response).await?;
            }
            Ok(None) => {
                // Stdin/stream closed, keep agent running to push events natively
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            Err(e) => {
                eprintln!("Read error: {}", e);
                break;
            }
        }
    }
    Ok(())
}

async fn run_uds(path: &str) -> anyhow::Result<()> {
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    println!("Mock agent listening on UDS: {}", path);

    let (stream, _) = listener.accept().await?;
    let (read_half, write_half) = tokio::io::split(stream);
    let mut reader = BufReader::new(read_half);
    let writer = Arc::new(Mutex::new(BufWriter::new(write_half)));

    let mut handshake_line = String::new();
    reader.read_line(&mut handshake_line).await?;
    if !handshake_line.starts_with("CIB19") && !handshake_line.starts_with("CIB/1.0") {
        anyhow::bail!("Invalid CI-144 handshake header");
    }
    writer.lock().await.write_all(PREFERRED_FORMAT.as_bytes()).await?;
    writer.lock().await.flush().await?;

    write_event(&writer, AgentEvent::Manifest(make_manifest())).await?;

    let heartbeat_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(DEFAULT_HEARTBEAT_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let epoch = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if let Err(e) = write_event(&heartbeat_writer, AgentEvent::Heartbeat { epoch }).await {
                eprintln!("Heartbeat send failed: {}", e);
                break;
            }
        }
    });

    let snapshot_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        loop {
            interval.tick().await;
            if let Err(e) = write_event(&snapshot_writer, AgentEvent::Snapshot(make_snapshot())).await {
                eprintln!("Snapshot send failed: {}", e);
                break;
            }
        }
    });

    // 4. Main loop: read incoming ActionRequests
    loop {
        match read_frame(&mut reader).await {
            Ok(Some(Frame::Action(action))) => {
                let response = handle_action(action);
                write_frame(&writer, &response).await?;
            }
            Ok(None) => {
                // Stream closed, keep agent running to push events natively
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            Err(e) => {
                eprintln!("Read error: {}", e);
                break;
            }
        }
    }
    Ok(())
}

enum Frame {
    Action(ActionRequest),
}

async fn read_frame<R>(reader: &mut R) -> anyhow::Result<Option<Frame>>
where
    R: AsyncReadExt + AsyncBufReadExt + Unpin,
{
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => (),
        // Broad anti-vibration read error recovery: prevent agent crash on any pipe jitter
        Err(_) => return Ok(None),
    };

    let len = u32::from_le_bytes(len_buf) as usize;
    let mut data = vec![0u8; len];
    reader.read_exact(&mut data).await?;

    let action: ActionRequest = if let Ok(a) = from_slice(&data) {
        a
    } else {
        serde_json::from_slice(&data)?
    };

    Ok(Some(Frame::Action(action)))
}

/// Write a raw CI-144 frame (used for request/response).
async fn write_frame<W, T>(writer: &Arc<Mutex<BufWriter<W>>>, msg: &T) -> anyhow::Result<()>
where
    W: AsyncWriteExt + Unpin,
    T: Serialize,
{
    // Serialize with struct_map to ensure string-keyed dictionary formatting (WASM compatible)
    let mut data = Vec::new();
    let mut serializer = rmp_serde::Serializer::new(&mut data).with_struct_map();
    msg.serialize(&mut serializer)?;

    let len = data.len() as u32;
    let mut guard = writer.lock().await;
    guard.write_all(&len.to_le_bytes()).await?;
    guard.write_all(&data).await?;
    guard.flush().await?;
    Ok(())
}

/// Write a CI-144 event frame: directly serialize AgentEvent (CIB19 standard)
async fn write_event<W: AsyncWriteExt + Unpin>(
    writer: &Arc<Mutex<BufWriter<W>>>,
    event: AgentEvent,
) -> anyhow::Result<()> {
    // Serialize with struct_map to align with the client deserializer constraints
    let mut data = Vec::new();
    let mut serializer = rmp_serde::Serializer::new(&mut data).with_struct_map();
    event.serialize(&mut serializer)?;

    let len = data.len() as u32;
    let mut guard = writer.lock().await;
    guard.write_all(&len.to_le_bytes()).await?;
    guard.write_all(&data).await?;
    guard.flush().await?;
    Ok(())
}

fn make_manifest() -> CapabilityManifest {
    CapabilityManifest {
        agent_name: "mock-agent".into(),
        version: "0.1.0".into(),
        actions: vec![
            Action {
                id: "scrape".into(),
                label: "Scrape URL".into(),
                security_class: SecurityClass::Normal,
                lease_ms: None,
                parameters: serde_json::json!({ "url": { "type": "string" } }),
            },
            Action {
                id: "critical_action".into(),
                label: "Delete File".into(),
                security_class: SecurityClass::Critical,
                lease_ms: Some(30000), // Aligned with CIC13 verification timeout lease
                parameters: serde_json::json!({ "path": { "type": "string" } }),
            },
        ],
        layout_hints: None,
    }
}

fn make_snapshot() -> SemanticSnapshot {
    SemanticSnapshot {
        epoch_time: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        status: "running".into(),
        metrics: serde_json::json!({ "cpu": 12, "mem": 256 }),
        semantic_tree: vec![
            SemanticNode {
                id: "tree_1".into(),
                node_type: NodeType::StateTree,
                label: "System State".into(),
                content: serde_json::json!({"branches": ["cpu", "mem"]}),
                slot_binding: None,
                focused: false,
            },
            SemanticNode {
                id: "text_1".into(),
                node_type: NodeType::TextPanel,
                label: "Instructions".into(),
                content: serde_json::json!({"text": "# Hello from mock agent\n\nThis is a **test** snapshot."}),
                slot_binding: None,
                focused: true,
            },
            SemanticNode {
                id: "button_1".into(),
                node_type: NodeType::ActionButton,
                label: "Scrape".into(),
                content: serde_json::json!({"action_id": "scrape"}),
                slot_binding: None,
                focused: false,
            },
        ],
        active_focus: Some("text_1".into()),
        layout_overrides: None,
    }
}

fn handle_action(action: ActionRequest) -> ActionResponse {
    eprintln!("Received action request: {:?}", action);
    ActionResponse::Success {
        message: format!("Action '{}' executed successfully", action.action_id)
    }
}
