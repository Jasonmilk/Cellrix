use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use std::path::Path;
use super::super::cap_client::CapTransport;

pub struct StdioTransport {
    process: Child,
    stdin: tokio::process::ChildStdin,
    stdout_lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
}

impl StdioTransport {
    pub async fn new(command: &str) -> Result<Self, String> {
        let mut parts = command.split_whitespace();
        let cmd = parts.next().ok_or("Empty command string".to_string())?;
        let args: Vec<&str> = parts.collect();

        // Validate executable existence with user-friendly error
        if !Path::new(cmd).exists() {
            return Err(format!(
                "Executable not found: '{}'. Make sure the path is correct and the binary is built (try 'cargo build' first).",
                cmd
            ));
        }

        let mut process = Command::new(cmd)
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to start process '{}': {}", cmd, e))?;

        let stdin = process.stdin.take().ok_or("Failed to capture stdin".to_string())?;
        let stdout = process.stdout.take().ok_or("Failed to capture stdout".to_string())?;
        let reader = BufReader::new(stdout);
        let lines = reader.lines();

        Ok(Self {
            process,
            stdin,
            stdout_lines: lines,
        })
    }

    async fn send_command(&mut self, cmd: &str) -> Result<(), String> {
        self.stdin.write_all(format!("{}\n", cmd).as_bytes()).await.map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[async_trait]
impl CapTransport for StdioTransport {
    async fn connect(&mut self) -> Result<(), String> {
        self.send_command("{\"type\":\"connect\"}").await?;
        Ok(())
    }

    async fn get_snapshot(&mut self) -> Result<Value, String> {
        self.send_command("{\"type\":\"get_snapshot\"}").await?;
        if let Some(line) = self.stdout_lines.next_line().await.map_err(|e| e.to_string())? {
            let value: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            return Ok(value);
        }
        Err("No response from stdio agent".to_string())
    }

    async fn send_action(&mut self, action: &str, params: Value) -> Result<(), String> {
        let cmd = serde_json::json!({
            "type": "action",
            "action": action,
            "params": params
        });
        self.send_command(&cmd.to_string()).await?;
        Ok(())
    }
}
