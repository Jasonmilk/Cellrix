//! Welcome demo for Cellrix UI.
//! Connects to a mock-agent (via UDS or STDIO) and renders the semantic snapshot.

use std::path::PathBuf;
use clap::Parser;
use cellrix_ui::App;
use cellrix_transport::{StdioTransport, UdsTransport};

#[derive(Parser)]
#[command(name = "cellrix-welcome")]
#[command(about = "Welcome demo: connect to an agent and render UI")]
struct Cli {
    /// Transport mode: stdio or uds
    #[arg(short, long, value_enum, default_value_t = Mode::Uds)]
    mode: Mode,

    /// Command to execute for stdio mode (e.g., "mock-agent --mode stdio")
    #[arg(long, required_if_eq("mode", "stdio"))]
    exec: Option<String>,

    /// UDS socket path (default: /tmp/mock.sock)
    #[arg(long, default_value = "/tmp/mock.sock")]
    socket: PathBuf,
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum Mode {
    Stdio,
    Uds,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    println!("╔════════════════════════════════════════════════════════════╗");
    println!("║                 Welcome to Cellrix UI Demo                 ║");
    println!("║  ────────────────────────────────────────────────────────  ║");
    println!("║  Press r       → Refresh snapshot                          ║");
    println!("║  Ctrl+C        → Exit                                      ║");
    println!("╚════════════════════════════════════════════════════════════╝");

    let transport = match cli.mode {
        Mode::Stdio => {
            let cmd = cli.exec.expect("--exec required for stdio mode");
            let args: Vec<String> = vec![];
            let transport = StdioTransport::new(&cmd, &args).await?;
            Box::new(transport) as Box<dyn cellrix_transport::CapTransport>
        }
        Mode::Uds => {
            let path = cli.socket.to_str().expect("Invalid socket path");
            let transport = UdsTransport::connect(path).await?;
            Box::new(transport)
        }
    };

    let mut app = App::new(transport).await?;
    app.run().await?;

    Ok(())
}
