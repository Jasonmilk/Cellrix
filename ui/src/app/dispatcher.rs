use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_stream::StreamExt;
use std::time::Duration;
use cellrix_transport::{AgentEvent, TransportStream};
use cellrix_protocol::ActionResponse;

pub struct EventDispatcher;

impl EventDispatcher {
    /// Asynchronously dispatches events from raw transport stream to App receiver channel.
    pub async fn background_dispatch(
        mut stream: TransportStream,
        event_tx: mpsc::Sender<AgentEvent>,
        _req_map: Arc<Mutex<HashMap<String, oneshot::Sender<ActionResponse>>>>,
    ) {
        while let Some(event) = stream.next().await {
            match event {
                Ok(agent_event) => {
                    let _ = event_tx.send(agent_event).await;
                }
                Err(e) => {
                    // Symmetrically forwards error as a StreamError instead of breaking,
                    // allowing the display server to show notifications and self-heal!
                    let _ = event_tx.send(AgentEvent::StreamError(e.to_string())).await;
                }
            }
        }
        let _ = event_tx.send(AgentEvent::StreamError("Transport stream closed".into())).await;
    }

    /// Background task to capture hardware input events.
    pub async fn capture_key_events(key_tx: mpsc::Sender<crossterm::event::Event>) {
        loop {
            if crossterm::event::poll(Duration::from_millis(50)).unwrap_or(false) {
                if let Ok(evt) = crossterm::event::read() {
                    let _ = key_tx.send(evt).await;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}
