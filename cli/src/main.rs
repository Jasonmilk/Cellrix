//! CLI debug tool for Cellrix pipeline.
//! Tests transport, layout, and protocol end-to-end.

use clap::{Parser, Subcommand};
use std::collections::HashMap;
use cellrix_protocol::{ActionRequest, ViewHash};
use cellrix_layout::{LayoutEngine, LayoutRequest, FocusManager};
use cellrix_transport::{CapTransport, StdioTransport, UdsTransport};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "cellrix-cli")]
#[command(about = "Debug tool for Cellrix pipeline", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Test manifest fetch (via connect)
    Manifest {
        #[arg(short, long)]
        mode: TransportMode,
        #[arg(long, help = "Command to execute for stdio mode")]
        exec: Option<String>,
        #[arg(long, help = "UDS socket path")]
        socket: Option<PathBuf>,
    },
    /// Test snapshot fetch and layout (via connect)
    Snapshot {
        #[arg(short, long)]
        mode: TransportMode,
        #[arg(long, help = "Command to execute for stdio mode")]
        exec: Option<String>,
        #[arg(long, help = "UDS socket path")]
        socket: Option<PathBuf>,
        #[arg(long, default_value = "80", help = "Terminal width for layout")]
        width: u16,
        #[arg(long, default_value = "24", help = "Terminal height for layout")]
        height: u16,
    },
    /// Test action sending (via connect then send_action)
    Action {
        #[arg(short, long)]
        mode: TransportMode,
        #[arg(long, help = "Command to execute for stdio mode")]
        exec: Option<String>,
        #[arg(long, help = "UDS socket path")]
        socket: Option<PathBuf>,
        #[arg(long, help = "Action ID")]
        action_id: String,
        #[arg(long, help = "Parameters as JSON string")]
        params: String,
        #[arg(long, help = "Optional view hash (hex)")]
        view_hash: Option<String>,
    },
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum TransportMode {
    Stdio,
    Uds,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::Manifest { mode, exec, socket } => {
            let mut transport = create_transport(mode, exec, socket).await?;
            let (manifest, _stream) = transport.connect().await?;
            println!("{:#?}", manifest);
        }
        Command::Snapshot { mode, exec, socket, width, height } => {
            let mut transport = create_transport(mode, exec, socket).await?;
            let (_manifest, mut stream) = transport.connect().await?;

            // Try to read the first Snapshot event from the stream
            use tokio_stream::StreamExt;
            let snapshot = loop {
                match stream.next().await {
                    Some(Ok(cellrix_transport::AgentEvent::Snapshot(snap))) => break snap,
                    Some(Ok(_)) => continue, // skip heartbeats, etc.
                    Some(Err(e)) => anyhow::bail!("Stream error: {}", e),
                    None => anyhow::bail!("Stream ended before snapshot"),
                }
            };

            println!("=== Snapshot ===");
            println!("Status: {}", snapshot.status);
            println!("Epoch: {}", snapshot.epoch_time);
            println!("Nodes: {}", snapshot.semantic_tree.len());

            // Run layout engine
            let mut layout_engine = LayoutEngine::new();
            let req = LayoutRequest {
                snapshot: snapshot.clone(),
                manifest: None,
                terminal_width: width,
                terminal_height: height,
                zen_focus_node_id: None,
                active_overrides: HashMap::new(),
            };
            let layout_output = layout_engine.compute(&req)?;
            println!("\n=== Layout ===");
            for (node_id, rect) in &layout_output.node_rects {
                println!("  {} -> x={}, y={}, w={}, h={}", node_id, rect.x, rect.y, rect.width, rect.height);
            }
            println!("\nSlot active nodes:");
            for (slot_id, active) in &layout_output.active_node_per_slot {
                println!("  {}: {}", slot_id, active);
            }

            // Test focus manager
            let mut focus = FocusManager::new();
            let node_ids: Vec<String> = snapshot.semantic_tree.iter().map(|n| n.id.clone()).collect();
            focus.rebuild_order(&node_ids);
            if let Some(focused) = focus.current_focus() {
                println!("\nFocus: {}", focused);
            }
        }
        Command::Action { mode, exec, socket, action_id, params, view_hash } => {
            let mut transport = create_transport(mode, exec, socket).await?;
            let (_manifest, _stream) = transport.connect().await?;

            let params_value: serde_json::Value = serde_json::from_str(&params)?;
            let view_hash_bytes = if let Some(hash_hex) = view_hash {
                let bytes = hex::decode(&hash_hex)
                    .map_err(|e| anyhow::anyhow!("Invalid hex for view_hash: {}", e))?;
                if bytes.len() != 32 {
                    anyhow::bail!("view_hash must be 32 bytes");
                }
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&bytes);
                Some(ViewHash(arr))
            } else {
                None
            };
            let action = ActionRequest {
                action_id,
                parameters: params_value,
                view_hash: view_hash_bytes,
            };
            let response = transport.send_action(action).await?;
            println!("{:#?}", response);
        }
    }
    Ok(())
}

async fn create_transport(
    mode: TransportMode,
    exec: Option<String>,
    socket: Option<PathBuf>,
) -> Result<Box<dyn CapTransport>, anyhow::Error> {
    match mode {
        TransportMode::Stdio => {
            let cmd = exec.ok_or_else(|| anyhow::anyhow!("--exec required for stdio mode"))?;
            let args: Vec<String> = vec![];
            let transport = StdioTransport::new(&cmd, &args).await?;
            Ok(Box::new(transport))
        }
        TransportMode::Uds => {
            let path = socket.ok_or_else(|| anyhow::anyhow!("--socket required for uds mode"))?;
            let transport = UdsTransport::connect(path.to_str().unwrap()).await?;
            Ok(Box::new(transport))
        }
    }
}
