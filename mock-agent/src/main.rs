//! Mock agent that implements CIB protocol over STDIO or UDS.
//! Actively pushes manifest, snapshot and heartbeat event streams after connection.

use clap::Parser;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::UnixListener;
use tokio::sync::Mutex;
use tokio::time::Duration;
use cellrix_protocol::{
    CapabilityManifest, Action, SecurityClass,
    SemanticSnapshot, SemanticNode, NodeType,
    ActionRequest, ActionResponse
};
use rmp_serde::{to_vec, from_slice};
use serde::Serialize;
use serde_json::json;

const PREFERRED_FORMAT: &str = "CIB/1.0 MSGPACK\n";

#[derive(Parser)]
#[command(name = "mock-agent")]
#[command(about = "Mock Anaphase agent for Cellrix protocol testing")]
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

    // CIB handshake
    let mut handshake_line = String::new();
    reader.read_line(&mut handshake_line).await?;
    if !handshake_line.starts_with("CIB/1.0") {
        anyhow::bail!("Invalid CIB handshake header");
    }
    writer.lock().await.write_all(PREFERRED_FORMAT.as_bytes()).await?;
    writer.lock().await.flush().await?;

    // 1. Push manifest/update immediately
    let manifest = make_manifest();
    write_event(&writer, "manifest/update", &manifest).await?;

    // 2. Spawn heartbeat task (every 5s)
    let heartbeat_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            let epoch = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let heartbeat_data = json!({ "epoch": epoch });
            if let Err(e) = write_event(&heartbeat_writer, "heartbeat", &heartbeat_data).await {
                eprintln!("Heartbeat send failed: {}", e);
                break;
            }
        }
    });

    // 3. Spawn snapshot push loop (every 200ms)
    let snapshot_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        loop {
            interval.tick().await;
            let snapshot = make_snapshot();
            if let Err(e) = write_event(&snapshot_writer, "snapshot/update", &snapshot).await {
                eprintln!("Snapshot send failed: {}", e);
                break;
            }
        }
    });

    // 4. Main loop: read incoming ActionRequests and send responses
    loop {
        match read_frame(&mut reader).await? {
            Some(Frame::Action(action)) => {
                let response = handle_action(action);
                write_frame(&writer, &response).await?;
            }
            None => break,
        }
    }
    Ok(())
}

async fn run_uds(path: &str) -> anyhow::Result<()> {
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    println!("Mock agent listening on UDS: {}", path);

    let (stream, _) = listener.accept().await?;
    let (read_half, write_half) = tokio::io::split(stream);  // split is fine for UnixStream
    let mut reader = BufReader::new(read_half);
    let writer = Arc::new(Mutex::new(BufWriter::new(write_half)));

    let mut handshake_line = String::new();
    reader.read_line(&mut handshake_line).await?;
    if !handshake_line.starts_with("CIB/1.0") {
        anyhow::bail!("Invalid CIB handshake header");
    }
    writer.lock().await.write_all(PREFERRED_FORMAT.as_bytes()).await?;
    writer.lock().await.flush().await?;

    let manifest = make_manifest();
    write_event(&writer, "manifest/update", &manifest).await?;

    let heartbeat_writer = Arc::clone(&writer);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            let epoch = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let heartbeat_data = json!({ "epoch": epoch });
            if let Err(e) = write_event(&heartbeat_writer, "heartbeat", &heartbeat_data).await {
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
            let snapshot = make_snapshot();
            if let Err(e) = write_event(&snapshot_writer, "snapshot/update", &snapshot).await {
                eprintln!("Snapshot send failed: {}", e);
                break;
            }
        }
    });

    loop {
        match read_frame(&mut reader).await? {
            Some(Frame::Action(action)) => {
                let response = handle_action(action);
                write_frame(&writer, &response).await?;
            }
            None => break,
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
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
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

/// Write a raw CIB frame (used for request/response).
async fn write_frame<W, T>(writer: &Arc<Mutex<BufWriter<W>>>, msg: &T) -> anyhow::Result<()>
where
    W: AsyncWriteExt + Unpin,
    T: Serialize,
{
    let data = to_vec(msg)?;
    let len = data.len() as u32;
    let mut guard = writer.lock().await;
    guard.write_all(&len.to_le_bytes()).await?;
    guard.write_all(&data).await?;
    guard.flush().await?;
    Ok(())
}

/// Write a CIB event frame (envelope wrapped).
async fn write_event<W, T>(writer: &Arc<Mutex<BufWriter<W>>>, event_name: &str, payload: &T) -> anyhow::Result<()>
where
    W: AsyncWriteExt + Unpin,
    T: Serialize,
{
    let envelope = json!({
        "type": "event",
        "id": "",
        "body": {
            "event": event_name,
            "data": payload
        }
    });

    let data = to_vec(&envelope)?;
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
    }
}

fn handle_action(action: ActionRequest) -> ActionResponse {
    eprintln!("Received action request: {:?}", action);
    ActionResponse::Success {
        message: format!("Action '{}' executed successfully", action.action_id)
    }
}
