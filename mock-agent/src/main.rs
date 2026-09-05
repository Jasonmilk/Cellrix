//! Mock agent implementing the CI-144 protocol family over STDIO or UDS.
//! 
//! Aligned with:
//! - CIN7: Intent specification (7 core semantic fields)
//! - CIC13: Capability credential (13-byte salt entropy)
//! - CIB19: Binding transmission (19s prime-number anti-resonance heartbeat)

use clap::Parser;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tokio::time::Duration;
use cellrix_protocol::{
    CapabilityManifest, Action,
    SemanticSnapshot, SemanticNode, NodeType,
    ActionRequest, ActionResponse, AgentEvent
};
use rmp_serde::from_slice;
use serde::Serialize;

/// Default BIND-19 (CIB19) heartbeat interval: 19 seconds (prime number to avoid system resonance)
pub const DEFAULT_HEARTBEAT_INTERVAL_SECS: u64 = 19;

/// The CI-144 CIB19 handshake format: must be CIB/1.0 to align with the client-side library verifier
const PREFERRED_FORMAT: &str = "CIB/1.0 MSGPACK\n";

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
    
    if !handshake_line.starts_with("CIB/1.0") {
        anyhow::bail!("Invalid CI-144 handshake header");
    }
    writer.lock().await.write_all(PREFERRED_FORMAT.as_bytes()).await?;
    writer.lock().await.flush().await?;

    // 1. Push manifest (stdio contract: little-endian + AgentEvent)
    write_event(&writer, AgentEvent::Manifest(make_manifest()), Endian::Le).await?;

    // 2. Spawn heartbeat task (BIND-19 19s prime number interval)
    let heartbeat_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(DEFAULT_HEARTBEAT_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let epoch = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if let Err(e) = write_event(&heartbeat_writer, AgentEvent::Heartbeat { epoch }, Endian::Le).await {
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
            if let Err(e) = write_event(&snapshot_writer, AgentEvent::Snapshot(make_snapshot()), Endian::Le).await {
                eprintln!("Snapshot send failed: {}", e);
                break;
            }
        }
    });

    // 4. Main loop: read incoming ActionRequests
    loop {
        match read_frame(&mut reader, Endian::Le).await {
            Ok(Some(Frame::Action(action))) => {
                let response = handle_action(action);
                write_frame(&writer, &response, Endian::Le).await?;
            }
            Ok(None) => {
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
    let stream = UnixStream::connect(path).await?;
    let (read_half, write_half) = tokio::io::split(stream);
    let mut reader = BufReader::new(read_half);
    let writer = Arc::new(Mutex::new(BufWriter::new(write_half)));

    // UDS contract (transport/src/uds.rs): first frame is a BARE CapabilityManifest
    // (big-endian length via tokio LengthDelimitedCodec, default rmp encoding),
    // subsequent frames are AgentEvent (big-endian length).
    write_frame(&writer, &make_manifest(), Endian::Be).await?;

    let is_suspended = Arc::new(AtomicBool::new(false));

    let heartbeat_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(DEFAULT_HEARTBEAT_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let epoch = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if let Err(e) = write_event(&heartbeat_writer, AgentEvent::Heartbeat { epoch }, Endian::Be).await {
                eprintln!("Heartbeat send failed: {}", e);
                break;
            }
        }
    });

    let snapshot_writer = Arc::clone(&writer);
    let is_suspended_clone = is_suspended.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        loop {
            interval.tick().await;
            if is_suspended_clone.load(Ordering::Acquire) {
                continue;
            }
            if let Err(e) = write_event(&snapshot_writer, AgentEvent::Snapshot(make_snapshot()), Endian::Be).await {
                eprintln!("Snapshot send failed: {}", e);
                break;
            }
        }
    });

    loop {
        match read_frame(&mut reader, Endian::Be).await {
            Ok(Some(Frame::Action(action))) => {
                match action.action_id.as_str() {
                    "sys_suspend" => {
                        is_suspended.store(true, Ordering::Release);
                        eprintln!("Mock Agent: Throttled to background sleep mode.");
                    }
                    "sys_resume" => {
                        is_suspended.store(false, Ordering::Release);
                        eprintln!("Mock Agent: Resumed to foreground active mode.");
                    }
                    _ => {
                        let response = handle_action(action);
                        write_frame(&writer, &response, Endian::Be).await?;
                    }
                }
            }
            Ok(None) => {
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

/// Wire endianness per transport contract (physical fact, 2026-09-06):
/// - stdio: little-endian (cellrix-transport protocol.rs `send_message`)
/// - uds: big-endian (tokio LengthDelimitedCodec default framing)
#[derive(Clone, Copy, PartialEq, Eq)]
enum Endian {
    Le,
    Be,
}

impl Endian {
    fn encode_len(self, len: u32) -> [u8; 4] {
        match self {
            Endian::Le => len.to_le_bytes(),
            Endian::Be => len.to_be_bytes(),
        }
    }
    fn decode_len(self, buf: [u8; 4]) -> u32 {
        match self {
            Endian::Le => u32::from_le_bytes(buf),
            Endian::Be => u32::from_be_bytes(buf),
        }
    }
}

async fn read_frame<R>(reader: &mut R, endian: Endian) -> anyhow::Result<Option<Frame>>
where
    R: AsyncReadExt + AsyncBufReadExt + Unpin,
{
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => (),
        Err(_) => return Ok(None),
    };

    let len = endian.decode_len(len_buf) as usize;
    let mut data = vec![0u8; len];
    reader.read_exact(&mut data).await?;

    let action: ActionRequest = if let Ok(a) = from_slice(&data) {
        a
    } else {
        serde_json::from_slice(&data)?
    };

    Ok(Some(Frame::Action(action)))
}

/// Map-form rmp encoding (matches transport decode: `rmp_serde::from_slice`
/// expects struct-variant maps; the plain `to_vec` array form is asymmetric).
fn encode_msg<T: Serialize>(msg: &T) -> anyhow::Result<Vec<u8>> {
    let mut data = Vec::new();
    let mut serializer = rmp_serde::Serializer::new(&mut data).with_struct_map();
    msg.serialize(&mut serializer)?;
    Ok(data)
}

async fn write_len_prefixed<W>(
    writer: &Arc<Mutex<BufWriter<W>>>,
    data: &[u8],
    endian: Endian,
) -> anyhow::Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    let len = data.len() as u32;
    let mut guard = writer.lock().await;
    guard.write_all(&endian.encode_len(len)).await?;
    guard.write_all(data).await?;
    guard.flush().await?;
    Ok(())
}

async fn write_frame<W, T>(writer: &Arc<Mutex<BufWriter<W>>>, msg: &T, endian: Endian) -> anyhow::Result<()>
where
    W: AsyncWriteExt + Unpin,
    T: Serialize,
{
    let data = encode_msg(msg)?;
    write_len_prefixed(writer, &data, endian).await
}

async fn write_event<W: AsyncWriteExt + Unpin>(
    writer: &Arc<Mutex<BufWriter<W>>>,
    event: AgentEvent,
    endian: Endian,
) -> anyhow::Result<()> {
    write_frame(writer, &event, endian).await
}

fn make_manifest() -> CapabilityManifest {
    CapabilityManifest {
        agent_name: "mock-agent".into(),
        version: "0.1.0".into(),
        actions: vec![
            Action {
                id: "scrape".into(),
                label: "Scrape URL".into(),
                security_class: cellrix_protocol::SecurityClass::Normal,
                lease_ms: None,
                parameters: serde_json::json!({ "url": { "type": "string" } }),
            },
            Action {
                id: "critical_action".into(),
                label: "Delete File".into(),
                security_class: cellrix_protocol::SecurityClass::Critical,
                lease_ms: Some(30000),
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
        pfp: None,
        sap: None,
    }
}

fn handle_action(action: ActionRequest) -> ActionResponse {
    eprintln!("Received action request: {:?}", action);
    ActionResponse::Success {
        message: format!("Action '{}' executed successfully", action.action_id)
    }
}
