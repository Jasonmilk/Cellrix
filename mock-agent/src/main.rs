//! Mock agent that speaks CIB protocol over STDIO or UDS.
//! Responds to manifest, snapshot, and action requests.

use clap::Parser;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, AsyncReadExt, BufReader, BufWriter};
use tokio::net::UnixListener;
use cellrix_protocol::{CapabilityManifest, Action, SecurityClass, SemanticSnapshot, SemanticNode, NodeType, ActionRequest, ActionResponse};
use rmp_serde::{to_vec, from_slice};
use serde::Serialize;

const PREFERRED_FORMAT: &str = "CIB/1.0 MSGPACK\n";

#[derive(Parser)]
#[command(name = "mock-agent")]
#[command(about = "Mock Anaphase agent for Cellrix testing")]
struct Cli {
    #[arg(short, long)]
    mode: Mode,
    #[arg(long, help = "UDS socket path (for uds mode)")]
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
            let path = cli.socket.ok_or_else(|| anyhow::anyhow!("--socket required for uds mode"))?;
            run_uds(&path).await
        }
    }
}

async fn run_stdio() -> anyhow::Result<()> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin);
    let mut writer = BufWriter::new(stdout);

    // Handshake: read client's preferred format line
    let mut handshake_line = String::new();
    reader.read_line(&mut handshake_line).await?;
    if !handshake_line.starts_with("CIB/1.0") {
        anyhow::bail!("Invalid handshake");
    }
    // Accept the client's format (we support both)
    writer.write_all(PREFERRED_FORMAT.as_bytes()).await?;
    writer.flush().await?;

    loop {
        match read_frame(&mut reader).await? {
            Some(Frame::Manifest) => {
                let manifest = make_manifest();
                write_frame(&mut writer, &manifest).await?;
            }
            Some(Frame::Snapshot) => {
                let snapshot = make_snapshot();
                write_frame(&mut writer, &snapshot).await?;
            }
            Some(Frame::Action(action)) => {
                let response = handle_action(action);
                write_frame(&mut writer, &response).await?;
            }
            None => break,
        }
    }
    Ok(())
}

async fn run_uds(path: &str) -> anyhow::Result<()> {
    // Remove old socket file if exists
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    println!("Listening on UDS: {}", path);
    let (stream, _) = listener.accept().await?;
    let (reader, writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    let mut writer = BufWriter::new(writer);

    // Handshake (same as stdio)
    let mut handshake_line = String::new();
    reader.read_line(&mut handshake_line).await?;
    if !handshake_line.starts_with("CIB/1.0") {
        anyhow::bail!("Invalid handshake");
    }
    writer.write_all(PREFERRED_FORMAT.as_bytes()).await?;
    writer.flush().await?;

    loop {
        match read_frame(&mut reader).await? {
            Some(Frame::Manifest) => {
                write_frame(&mut writer, &make_manifest()).await?;
            }
            Some(Frame::Snapshot) => {
                write_frame(&mut writer, &make_snapshot()).await?;
            }
            Some(Frame::Action(action)) => {
                write_frame(&mut writer, &handle_action(action)).await?;
            }
            None => break,
        }
    }
    Ok(())
}

enum Frame {
    Manifest,
    Snapshot,
    Action(ActionRequest),
}

async fn read_frame<R>(reader: &mut R) -> anyhow::Result<Option<Frame>>
where
    R: AsyncReadExt + AsyncBufReadExt + Unpin,
{
    let mut len_buf = [0u8; 4];
    if let Err(e) = reader.read_exact(&mut len_buf).await {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            return Ok(None);
        }
        return Err(e.into());
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut data = vec![0u8; len];
    reader.read_exact(&mut data).await?;
    // Try to decode as MessagePack first, fallback to JSON
    let msg: serde_json::Value = if let Ok(v) = from_slice(&data) {
        v
    } else {
        serde_json::from_slice(&data)?
    };
    if let Some(s) = msg.as_str() {
        match s {
            "manifest" => Ok(Some(Frame::Manifest)),
            "snapshot" => Ok(Some(Frame::Snapshot)),
            _ => anyhow::bail!("Unknown string command"),
        }
    } else {
        let action: ActionRequest = if let Ok(a) = from_slice(&data) {
            a
        } else {
            serde_json::from_slice(&data)?
        };
        Ok(Some(Frame::Action(action)))
    }
}

async fn write_frame<W, T>(writer: &mut W, msg: &T) -> anyhow::Result<()>
where
    W: AsyncWriteExt + Unpin,
    T: Serialize,
{
    let data = to_vec(msg)?;
    let len = data.len() as u32;
    writer.write_all(&len.to_le_bytes()).await?;
    writer.write_all(&data).await?;
    writer.flush().await?;
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
                parameters: serde_json::json!({ "url": { "type": "string" } }),
            },
            Action {
                id: "critical_action".into(),
                label: "Delete File".into(),
                security_class: SecurityClass::Critical,
                parameters: serde_json::json!({ "path": { "type": "string" } }),
            },
        ],
        layout_hints: None,
    }
}

fn make_snapshot() -> SemanticSnapshot {
    SemanticSnapshot {
        epoch_time: 1717000000,
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
    eprintln!("Received action: {:?}", action);
    ActionResponse::Success { message: format!("Action '{}' executed", action.action_id) }
}
