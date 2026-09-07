use async_trait::async_trait;
use tokio::process::{Command, ChildStdin};
use tokio::io::{BufReader, BufWriter};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use crate::cap_transport::{CapTransport, TransportStream, TransportError};
use crate::protocol::{WireFormat, handshake_client, recv_message, send_message, DEFAULT_TIMEOUT_MS};
use cellrix_protocol::{CapabilityManifest, ActionRequest, ActionResponse, AgentEvent};
use serde::Deserialize;

pub struct StdioTransport {
    stdin: Option<BufWriter<ChildStdin>>,
    child: Option<tokio::process::Child>,
    format: WireFormat,
    /// ActionResponse channel: the background reader routes response frames
    /// here so they never race with the AgentEvent stream (one reader owns
    /// stdout; `send_action` writes a request, then awaits its response).
    response_rx: Option<mpsc::UnboundedReceiver<Result<ActionResponse, TransportError>>>,
}

/// Untagged dispatch frame: the stream carries AgentEvents (internally
/// tagged `{"event": ...}`) interleaved with ActionResponses (externally
/// tagged `{"Success": ...}`); serde tries Event first, then Response.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Incoming {
    Event(AgentEvent),
    Response(ActionResponse),
}

impl StdioTransport {
    pub async fn new(command: &str, args: &[String]) -> Result<Self, TransportError> {
        if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] Spawning child: {} {:?}", command, args); }
        let child = Command::new(command)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true)
            .spawn()?;
        Ok(Self {
            stdin: None,
            child: Some(child),
            format: WireFormat::MessagePack,
            response_rx: None,
        })
    }
}

#[async_trait]
impl CapTransport for StdioTransport {
    async fn connect(&mut self) -> Result<(CapabilityManifest, TransportStream), TransportError> {
        let mut child = self.child.take()
            .ok_or(TransportError::Protocol("child already taken".to_string()))?;
        let stdin = child.stdin.take()
            .ok_or(TransportError::Protocol("stdin not available".to_string()))?;
        let stdout = child.stdout.take()
            .ok_or(TransportError::Protocol("stdout not available".to_string()))?;

        let mut writer = BufWriter::new(stdin);
        let mut reader = BufReader::new(stdout);

        if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] Starting CIB handshake..."); }
        let chosen = handshake_client(&mut writer, &mut reader, WireFormat::MessagePack)
            .await
            .map_err(|e| {
                if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] Handshake failed: {:?}", e); }
                TransportError::Io(e)
            })?;
        if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] Handshake succeeded, chosen format: {:?}", chosen); }
        self.format = chosen;

        if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] Waiting for first event (must be Manifest)..."); }
        let first_event: AgentEvent = recv_message(&mut reader, chosen, DEFAULT_TIMEOUT_MS)
            .await
            .map_err(|e| {
                if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] Failed to read first event: {:?}", e); }
                TransportError::Io(e)
            })?;
        if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] First event received: {:?}", &first_event); }
        let manifest = match first_event {
            AgentEvent::Manifest(m) => m,
            other => {
                if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] Unexpected first event: {:?}", other); }
                return Err(TransportError::Protocol("First event must be manifest/update".to_string()))
            }
        };

        // Single background reader owns stdout: routes AgentEvents to the
        // event stream and ActionResponses to the response channel. No two
        // tasks ever read the same pipe — deterministic, no frame stealing.
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let (response_tx, response_rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                match recv_message::<Incoming>(&mut reader, chosen, DEFAULT_TIMEOUT_MS).await {
                    Ok(Incoming::Event(event)) => {
                        if event_tx.send(Ok(event)).is_err() { break; }
                    }
                    Ok(Incoming::Response(response)) => {
                        if response_tx.send(Ok(response)).is_err() { break; }
                    }
                    Err(e) => {
                        if std::env::var("CELLRIX_DEBUG").is_ok() { eprintln!("[DEBUG] Background reader error: {:?}", e); }
                        let msg = format!("{e}");
                        let kind = e.kind();
                        let _ = event_tx.send(Err(TransportError::Io(std::io::Error::new(kind, msg.clone()))));
                        let _ = response_tx.send(Err(TransportError::Io(std::io::Error::new(kind, msg))));
                        break;
                    }
                }
            }
        });

        self.stdin = Some(writer);
        self.child = Some(child);
        self.response_rx = Some(response_rx);

        let stream: TransportStream = Box::pin(UnboundedReceiverStream::new(event_rx));
        Ok((manifest, stream))
    }

    async fn send_action(&mut self, request: ActionRequest) -> Result<ActionResponse, TransportError> {
        let writer = self.stdin.as_mut()
            .ok_or(TransportError::Protocol("transport not connected".to_string()))?;
        send_message(writer, self.format, &request)
            .await
            .map_err(TransportError::Io)?;
        let rx = self.response_rx.as_mut()
            .ok_or(TransportError::Protocol("transport not connected".to_string()))?;
        match tokio::time::timeout(
            std::time::Duration::from_millis(DEFAULT_TIMEOUT_MS),
            rx.recv(),
        )
        .await
        {
            Ok(Some(Ok(response))) => Ok(response),
            Ok(Some(Err(e))) => Err(e),
            Ok(None) => Err(TransportError::Protocol("stream ended before response".to_string())),
            Err(_) => Err(TransportError::Io(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "action response timeout",
            ))),
        }
    }
}
