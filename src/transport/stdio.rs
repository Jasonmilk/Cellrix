use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use std::path::Path;
use crate::cap_client::CapTransport;

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

        if !Path::new(cmd).exists() {
            return Err(format!(
                "Executable not found: '{}'. Check path and run cargo build first.",
                cmd
            ));
        }

        let mut process = Command::new(cmd)
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;

        let stdin = process.stdin.take().ok_or("Failed to capture stdin")?;
        let stdout = process.stdout.take().ok_or("Failed to capture stdout")?;
        let reader = BufReader::new(stdout);
        let lines = reader.lines();

        Ok(Self {
            process,
            stdin,
            stdout_lines: lines,
        })
    }
}

#[async_trait]
impl CapTransport for StdioTransport {
    async fn connect(&mut self) -> Result<(), String> {
        self.stdin.write_all(b"{\"type\":\"connect\"}\n").await.map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_snapshot(&mut self) -> Result<Value, String> {
        self.stdin.write_all(b"{\"type\":\"get_snapshot\"}\n").await.map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        
        if let Some(line) = self.stdout_lines.next_line().await.map_err(|e| e.to_string())? {
            let value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            Ok(value)
        } else {
            Err("No response from agent".to_string())
        }
    }

    async fn send_action(&mut self, action: &str, params: Value) -> Result<String, String> {
        let cmd = serde_json::json!({
            "type": "action",
            "action": action,
            "params": params
        });
        let cmd_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
        self.stdin.write_all(cmd_str.as_bytes()).await.map_err(|e| e.to_string())?;
        self.stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        
        if let Some(line) = self.stdout_lines.next_line().await.map_err(|e| e.to_string())? {
            Ok(line)
        } else {
            Err("No response from agent".to_string())
        }
    }
}
