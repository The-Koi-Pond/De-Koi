//! One-time trim of copies that older versions stored on every message, swipe and finished capture job.
//!
//! - A user message's `extra.personaSnapshot` kept the persona's whole card text (description,
//!   personality, backstory, appearance, scenario). Messages now keep only the name and look; nothing
//!   reads the text back, and on a real install it was 4.6 MB of the message stores for 10 KB of data.
//! - A completed memory capture job kept copies of its source and reference messages. A completed job
//!   is never run again (re-queueing the same messages returns it unchanged), so the copies go; the
//!   message ids that identify the job stay.
//! - Saved prompt snapshots are evicted down to the latest assistant message of each chat, as new
//!   replies now do (`PROMPT_SNAPSHOT_KEEP_LAST` in `src/engine/generation/start-generation.ts`).

use super::{chats, message_swipes};
use crate::state::AppState;
use marinara_core::AppResult;
use marinara_storage::FileStorage;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

const PERSONA_SNAPSHOT_TEXT_FIELDS: [&str; 5] = [
    "description",
    "personality",
    "backstory",
    "appearance",
    "scenario",
];
const CAPTURE_JOB_MESSAGE_COPIES: [&str; 2] = ["sourceMessages", "referenceMessages"];
const PROMPT_SNAPSHOT_KEEP_LAST: usize = 1;

#[derive(Debug, Default, Eq, PartialEq)]
pub(crate) struct StoredCopyTrimReport {
    pub persona_snapshots: usize,
    pub capture_jobs: usize,
    pub prompt_snapshot_messages: u64,
}

fn strip_persona_snapshot_text(row: &mut Value) -> bool {
    let Some(snapshot) = row
        .get_mut("extra")
        .and_then(|extra| extra.get_mut("personaSnapshot"))
        .and_then(Value::as_object_mut)
    else {
        return false;
    };
    let mut changed = false;
    for field in PERSONA_SNAPSHOT_TEXT_FIELDS {
        changed |= snapshot.remove(field).is_some();
    }
    changed
}

fn clear_completed_capture_job_copies(row: &mut Value) -> bool {
    if row.get("status").and_then(Value::as_str) != Some("completed") {
        return false;
    }
    let Some(job) = row.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    for field in CAPTURE_JOB_MESSAGE_COPIES {
        if job
            .get(field)
            .and_then(Value::as_array)
            .is_some_and(|copies| !copies.is_empty())
        {
            job.insert(field.to_string(), Value::Array(Vec::new()));
            changed = true;
        }
    }
    changed
}

fn transform_rows(
    storage: &FileStorage,
    collection: &str,
    migration_suffix: &str,
    transform: fn(&mut Value) -> bool,
) -> AppResult<usize> {
    let report = storage.transform_collection_streaming(
        collection,
        migration_suffix,
        |_index, row| Ok(transform(row)),
        |_index, _row| Ok(()),
    )?;
    Ok(report.changed_records)
}

pub(crate) fn trim_stored_copies(state: &AppState) -> AppResult<StoredCopyTrimReport> {
    let storage = &state.storage;
    let mut report = StoredCopyTrimReport::default();
    for collection in ["messages", message_swipes::COLLECTION] {
        report.persona_snapshots += transform_rows(
            storage,
            collection,
            "persona-snapshot-text-v1",
            strip_persona_snapshot_text,
        )?;
    }
    report.capture_jobs = transform_rows(
        storage,
        "memory-capture-jobs",
        "capture-job-copies-v1",
        clear_completed_capture_job_copies,
    )?;
    report.prompt_snapshot_messages = evict_stale_prompt_snapshots(storage)?;
    Ok(report)
}

/// The same eviction `chats::evict_prompt_snapshots` does for one chat, for every chat at once:
/// each store is read once, so a large install doesn't hold startup for minutes.
fn evict_stale_prompt_snapshots(storage: &FileStorage) -> AppResult<u64> {
    let stale = stale_prompt_snapshot_message_ids(storage)?;
    if stale.is_empty() {
        return Ok(0);
    }
    let mut evicted = HashSet::new();
    storage.transform_collection_streaming(
        "messages",
        "prompt-snapshots-v1",
        |_index, row| {
            let Some(id) = row.get("id").and_then(Value::as_str).map(str::to_string) else {
                return Ok(false);
            };
            let changed = stale.contains(&id) && strip_prompt_snapshots(row);
            if changed {
                evicted.insert(id);
            }
            Ok(changed)
        },
        |_index, _row| Ok(()),
    )?;
    storage.transform_collection_streaming(
        message_swipes::COLLECTION,
        "prompt-snapshots-v1",
        |_index, row| {
            let Some(message_id) = row
                .get("messageId")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                return Ok(false);
            };
            let changed = stale.contains(&message_id) && strip_prompt_snapshots(row);
            if changed {
                evicted.insert(message_id);
            }
            Ok(changed)
        },
        |_index, _row| Ok(()),
    )?;
    Ok(evicted.len() as u64)
}

/// Every assistant message of an existing chat except its latest `PROMPT_SNAPSHOT_KEEP_LAST`,
/// ordered by `createdAt` then id as `chats::evict_prompt_snapshots` orders them.
fn stale_prompt_snapshot_message_ids(storage: &FileStorage) -> AppResult<HashSet<String>> {
    let id_field = ["id".to_string()];
    let chat_ids: HashSet<String> = storage
        .list_projected("chats", &id_field, &Map::new())?
        .iter()
        .filter_map(|chat| chat.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();
    let fields = ["id", "chatId", "role", "createdAt"].map(str::to_string);
    let mut by_chat: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for message in storage.list_projected("messages", &fields, &Map::new())? {
        let text = |field: &str| message.get(field).and_then(Value::as_str);
        if text("role") != Some("assistant") {
            continue;
        }
        let (Some(chat_id), Some(id)) = (text("chatId"), text("id")) else {
            continue;
        };
        if !chat_ids.contains(chat_id) {
            continue;
        }
        by_chat
            .entry(chat_id.to_string())
            .or_default()
            .push((text("createdAt").unwrap_or("").to_string(), id.to_string()));
    }
    let mut stale = HashSet::new();
    for mut assistants in by_chat.into_values() {
        assistants.sort();
        let cutoff = assistants.len().saturating_sub(PROMPT_SNAPSHOT_KEEP_LAST);
        stale.extend(assistants.into_iter().take(cutoff).map(|(_, id)| id));
    }
    Ok(stale)
}

/// Clears prompt snapshots from a message or swipe row and from a message's embedded swipes.
fn strip_prompt_snapshots(row: &mut Value) -> bool {
    let mut changed = false;
    if let Some(swipes) = row.get_mut("swipes").and_then(Value::as_array_mut) {
        for swipe in swipes.iter_mut() {
            changed |= strip_extra(swipe);
        }
    }
    changed | strip_extra(row)
}

fn strip_extra(row: &mut Value) -> bool {
    let Some(next) = chats::strip_snapshot_from_extra(row.get("extra")) else {
        return false;
    };
    let Some(object) = row.as_object_mut() else {
        return false;
    };
    object.insert("extra".to_string(), next);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_state(label: &str) -> (AppState, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "de-koi-stored-copy-trim-{label}-{}",
            marinara_core::new_id()
        ));
        let state = AppState::from_data_dir(&path, Vec::new()).unwrap();
        (state, path)
    }

    fn persona_snapshot() -> Value {
        json!({
            "personaId": "persona-1",
            "name": "Chai",
            "description": "A long description",
            "personality": "Warm",
            "backstory": "Grew up by the pond",
            "appearance": "Tall",
            "scenario": "At home",
            "avatarUrl": "/avatars/chai.png",
            "nameColor": "#ff0000"
        })
    }

    fn row_by_id(state: &AppState, collection: &str, id: &str) -> Value {
        state.storage.get(collection, id).unwrap().unwrap()
    }

    #[test]
    fn trim_keeps_persona_look_and_job_identity_but_drops_copied_text() {
        let (state, path) = test_state("copies");
        state
            .storage
            .create(
                "chats",
                json!({ "id": "chat-1", "name": "Chat", "mode": "conversation" }),
            )
            .unwrap();
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "user-1",
                    "chatId": "chat-1",
                    "role": "user",
                    "content": "hi",
                    "createdAt": "2026-11-01T00:00:00Z",
                    "extra": { "personaSnapshot": persona_snapshot(), "displayText": "hi" }
                }),
            )
            .unwrap();
        state
            .storage
            .create(
                message_swipes::COLLECTION,
                json!({
                    "id": "swipe-1",
                    "chatId": "chat-1",
                    "messageId": "user-1",
                    "index": 0,
                    "content": "hi",
                    "extra": { "personaSnapshot": persona_snapshot() }
                }),
            )
            .unwrap();
        for (id, status) in [("job-done", "completed"), ("job-failed", "failed")] {
            state
                .storage
                .create(
                    "memory-capture-jobs",
                    json!({
                        "id": id,
                        "status": status,
                        "chatId": "chat-1",
                        "sourceMessageIds": ["user-1"],
                        "sourceMessages": [{ "id": "user-1", "role": "user", "content": "hi" }],
                        "referenceMessages": [{ "id": "user-0", "role": "user", "content": "earlier" }]
                    }),
                )
                .unwrap();
        }

        let report = trim_stored_copies(&state).unwrap();
        assert_eq!(report.persona_snapshots, 2);
        assert_eq!(report.capture_jobs, 1);

        let kept = json!({
            "personaId": "persona-1",
            "name": "Chai",
            "avatarUrl": "/avatars/chai.png",
            "nameColor": "#ff0000"
        });
        let message = row_by_id(&state, "messages", "user-1");
        assert_eq!(message["extra"]["personaSnapshot"], kept);
        assert_eq!(message["extra"]["displayText"], "hi");
        let swipe = row_by_id(&state, message_swipes::COLLECTION, "swipe-1");
        assert_eq!(swipe["extra"]["personaSnapshot"], kept);

        let done = row_by_id(&state, "memory-capture-jobs", "job-done");
        assert_eq!(done["sourceMessages"], json!([]));
        assert_eq!(done["referenceMessages"], json!([]));
        assert_eq!(done["sourceMessageIds"], json!(["user-1"]));
        // A failed job can still be retried, so it keeps the messages it would run on.
        let failed = row_by_id(&state, "memory-capture-jobs", "job-failed");
        assert_eq!(failed["sourceMessages"].as_array().unwrap().len(), 1);
        assert_eq!(failed["referenceMessages"].as_array().unwrap().len(), 1);

        // Running it again changes nothing.
        assert_eq!(
            trim_stored_copies(&state).unwrap(),
            StoredCopyTrimReport::default()
        );
        drop(state);
        let _ = std::fs::remove_dir_all(path);
    }

    #[test]
    fn trim_keeps_only_each_chats_latest_assistant_prompt_snapshot() {
        let (state, path) = test_state("snapshots");
        let snapshot = json!({ "generationPromptSnapshot": { "messages": [] }, "keep": true });
        for chat in ["chat-1", "chat-2"] {
            state
                .storage
                .create(
                    "chats",
                    json!({ "id": chat, "name": chat, "mode": "roleplay" }),
                )
                .unwrap();
        }
        for (id, chat, at) in [
            ("old", "chat-1", "2026-11-01T00:00:00Z"),
            ("new", "chat-1", "2026-11-02T00:00:00Z"),
            ("only", "chat-2", "2026-11-01T00:00:00Z"),
        ] {
            state
                .storage
                .create(
                    "messages",
                    json!({ "id": id, "chatId": chat, "role": "assistant", "content": "x",
                            "createdAt": at, "extra": snapshot }),
                )
                .unwrap();
        }
        state
            .storage
            .create(
                message_swipes::COLLECTION,
                json!({ "id": "old-swipe", "chatId": "chat-1", "messageId": "old", "index": 0,
                        "content": "x", "extra": snapshot }),
            )
            .unwrap();

        assert_eq!(
            trim_stored_copies(&state).unwrap().prompt_snapshot_messages,
            1
        );
        assert_eq!(
            row_by_id(&state, "messages", "old")["extra"],
            json!({ "keep": true })
        );
        let swipe = row_by_id(&state, message_swipes::COLLECTION, "old-swipe");
        assert_eq!(swipe["extra"], json!({ "keep": true }));
        assert_eq!(row_by_id(&state, "messages", "new")["extra"], snapshot);
        assert_eq!(row_by_id(&state, "messages", "only")["extra"], snapshot);
        drop(state);
        let _ = std::fs::remove_dir_all(path);
    }
}
