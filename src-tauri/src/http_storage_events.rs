//! Live "storage changed" events for hosted clients (`POST /api/events/stream`).
//!
//! The storage crate reports every durable data change by collection name. This module fans those names out to
//! every connected client as a server-sent event stream, coalescing bursts into one event per short window, so a
//! phone and a PC on the same server both refresh a chat when either writes to it.

use axum::response::sse::Event;
use serde_json::json;
use std::collections::BTreeSet;
use std::convert::Infallible;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tokio::time::Instant;

/// How long a burst of changes is gathered into one event.
const COALESCE_WINDOW: Duration = Duration::from_millis(250);
/// Changes buffered per subscriber before it is told to refresh everything ("*").
const BROADCAST_CAPACITY: usize = 512;
const EVENT_CHANNEL_CAPACITY: usize = 16;
/// Sent instead of collection names when a subscriber fell behind.
pub(crate) const ALL_COLLECTIONS: &str = "*";

fn change_sender() -> &'static broadcast::Sender<String> {
    static SENDER: OnceLock<broadcast::Sender<String>> = OnceLock::new();
    SENDER.get_or_init(|| {
        let (sender, _) = broadcast::channel(BROADCAST_CAPACITY);
        let listener_sender = sender.clone();
        // Runs on the storage writer's thread: `send` never blocks, and having no subscribers is fine.
        marinara_storage::set_collection_change_listener(move |collection| {
            let _ = listener_sender.send(collection.to_string());
        });
        sender
    })
}

/// Installs the storage listener. Call once at server start so changes made before the first client connects
/// are not needed (clients load fresh data when they connect).
pub fn install_storage_change_feed() {
    let _ = change_sender();
}

fn storage_changed_event(collections: &BTreeSet<String>) -> Event {
    Event::default().data(
        json!({ "type": "storage_changed", "data": { "collections": collections } }).to_string(),
    )
}

/// Streams `{"type":"ready"}` once, then `{"type":"storage_changed","data":{"collections":[...]}}` for each
/// coalesced burst of writes, until the client disconnects.
pub fn spawn_storage_event_stream() -> mpsc::Receiver<Result<Event, Infallible>> {
    let mut changes = change_sender().subscribe();
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(EVENT_CHANNEL_CAPACITY);
    tokio::spawn(async move {
        let ready = Event::default().data(json!({ "type": "ready" }).to_string());
        if tx.send(Ok(ready)).await.is_err() {
            return;
        }
        loop {
            let mut collections = BTreeSet::new();
            match changes.recv().await {
                Ok(collection) => {
                    collections.insert(collection);
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    collections.insert(ALL_COLLECTIONS.to_string());
                }
                Err(broadcast::error::RecvError::Closed) => return,
            }
            let deadline = Instant::now() + COALESCE_WINDOW;
            loop {
                match tokio::time::timeout_at(deadline, changes.recv()).await {
                    Ok(Ok(collection)) => {
                        collections.insert(collection);
                    }
                    Ok(Err(broadcast::error::RecvError::Lagged(_))) => {
                        collections.insert(ALL_COLLECTIONS.to_string());
                    }
                    Ok(Err(broadcast::error::RecvError::Closed)) => return,
                    Err(_) => break,
                }
            }
            if tx
                .send(Ok(storage_changed_event(&collections)))
                .await
                .is_err()
            {
                return;
            }
        }
    });
    rx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bursts_of_writes_arrive_as_one_event_per_window() {
        let mut stream = spawn_storage_event_stream();
        let ready = stream.recv().await.unwrap().unwrap();
        assert!(format!("{ready:?}").contains("ready"));
        let sender = change_sender();
        sender.send("messages".to_string()).unwrap();
        sender.send("chats".to_string()).unwrap();
        sender.send("messages".to_string()).unwrap();
        let event = tokio::time::timeout(Duration::from_secs(2), stream.recv())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let text = format!("{event:?}");
        assert!(text.contains("storage_changed"), "{text}");
        assert!(
            text.contains("chats") && text.contains("messages"),
            "{text}"
        );
    }
}
