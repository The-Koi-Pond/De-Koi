use super::chat_access::{self, DekiChatAccessGrant};
use crate::state::AppState;
use crate::storage_commands::{canonical_memory, chat_memory};
use autoagents::prelude::{ToolInput, ToolInputT};
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Map, Value};

const MEMORY_READ_DEFAULT_LIMIT: usize = 50;
const MEMORY_READ_MAX_LIMIT: usize = 100;

#[derive(Debug, Deserialize, ToolInput)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadDekiMemoriesArgs {
    #[input(description = "Memory scope type: character or chat.")]
    #[serde(alias = "scope_type")]
    pub(super) scope_type: String,
    #[input(description = "Exact character id or approved chat id for the selected scope.")]
    #[serde(alias = "scope_id")]
    pub(super) scope_id: String,
    #[input(description = "Optional case-insensitive search within memory content.")]
    #[serde(default)]
    pub(super) query: Option<String>,
    #[input(description = "Maximum memories to return. Defaults to 50 and is capped at 100.")]
    #[serde(default)]
    pub(super) limit: Option<usize>,
}

#[derive(Debug, Deserialize, ToolInput)]
#[serde(rename_all = "camelCase")]
pub(super) struct EditDekiMemoryArgs {
    #[input(description = "Memory scope type: character or chat.")]
    #[serde(alias = "scope_type")]
    pub(super) scope_type: String,
    #[input(description = "Exact character id or approved chat id for the selected scope.")]
    #[serde(alias = "scope_id")]
    pub(super) scope_id: String,
    #[input(description = "Exact memory id returned by read_deki_memories.")]
    #[serde(alias = "memory_id")]
    pub(super) memory_id: String,
    #[input(description = "Complete replacement memory sentence. Must not be empty.")]
    pub(super) content: String,
}

pub(super) fn read(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
    args: ReadDekiMemoriesArgs,
) -> AppResult<Value> {
    let scope_type = args.scope_type.trim();
    let scope_id = args.scope_id.trim();
    if scope_id.is_empty() {
        return Err(AppError::invalid_input(
            "read_deki_memories requires scopeId",
        ));
    }
    let rows = match scope_type {
        "character" => canonical_memory::query_memories(
            state,
            json!({
                "scope": { "kind": "character", "id": scope_id }
            }),
        )?
        .as_array()
        .cloned()
        .unwrap_or_default(),
        "chat" => {
            let chat_id = chat_access::ensure_chat_allowed(state, grants, scope_id)?;
            chat_memory::list_chat_memories_excluding_recent(
                state,
                &chat_id,
                None,
                Some("recent"),
                &[],
                None,
            )?
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(chat_memory::chat_memory_is_retrievable)
            .collect()
        }
        _ => {
            return Err(AppError::invalid_input(
                "read_deki_memories scopeType must be character or chat",
            ));
        }
    };
    Ok(project_page(rows, args.query.as_deref(), args.limit))
}

pub(super) async fn edit(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
    args: EditDekiMemoryArgs,
) -> AppResult<Value> {
    let scope_type = args.scope_type.trim();
    let scope_id = args.scope_id.trim();
    let memory_id = args.memory_id.trim();
    let content = args.content.trim();
    if scope_id.is_empty() || memory_id.is_empty() {
        return Err(AppError::invalid_input(
            "edit_deki_memory requires scopeId and memoryId",
        ));
    }
    if content.is_empty() {
        return Err(AppError::invalid_input("Memory content is required"));
    }
    match scope_type {
        "character" => {
            let current = canonical_memory::get_memory(state, memory_id)?;
            let scope = current.get("scope").and_then(Value::as_object);
            let current_scope_kind = scope
                .and_then(|value| value.get("kind"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let current_scope_id = scope
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if current_scope_kind != "character" || current_scope_id != scope_id {
                return Err(AppError::invalid_input(format!(
                    "Memory '{memory_id}' does not belong to character '{scope_id}'"
                )));
            }
            let status = current.get("status").and_then(Value::as_str).unwrap_or("");
            if !matches!(status, "active" | "pinned") {
                return Err(AppError::invalid_input(
                    "Only active or pinned character memories can be edited",
                ));
            }
            let updated =
                canonical_memory::update_memory(state, memory_id, json!({ "content": content }))?;
            canonical_memory::rebuild_memory_lexical_index(
                state,
                json!({
                    "scope": { "kind": "character", "id": scope_id },
                    "statuses": ["active", "pinned"]
                }),
            )?;
            Ok(json!({ "memory": project_memory(updated) }))
        }
        "chat" => {
            let chat_id = chat_access::ensure_chat_allowed(state, grants, scope_id)?;
            let current = chat_memory::list_chat_memories_excluding_recent(
                state,
                &chat_id,
                None,
                Some("stored"),
                &[],
                None,
            )?
            .as_array()
            .and_then(|rows| {
                rows.iter()
                    .find(|memory| memory.get("id").and_then(Value::as_str) == Some(memory_id))
            })
            .cloned()
            .ok_or_else(|| {
                AppError::not_found(format!(
                    "Memory '{memory_id}' was not found in approved chat '{chat_id}'"
                ))
            })?;
            if !chat_memory::chat_memory_is_retrievable(&current) {
                return Err(AppError::invalid_input(
                    "Only active chat memories can be edited",
                ));
            }
            let updated_chat = chat_memory::update_chat_memory(
                state,
                &chat_id,
                memory_id,
                json!({ "content": content }),
            )
            .await?;
            let updated = updated_chat
                .get("memories")
                .and_then(Value::as_array)
                .and_then(|rows| {
                    rows.iter()
                        .find(|memory| memory.get("id").and_then(Value::as_str) == Some(memory_id))
                })
                .cloned()
                .ok_or_else(|| {
                    AppError::not_found(format!("Memory '{memory_id}' was not found after update"))
                })?;
            Ok(json!({ "memory": project_memory(updated) }))
        }
        _ => Err(AppError::invalid_input(
            "edit_deki_memory scopeType must be character or chat",
        )),
    }
}

fn project_page(rows: Vec<Value>, query: Option<&str>, limit: Option<usize>) -> Value {
    let query = query.unwrap_or("").trim().to_ascii_lowercase();
    let limit = limit
        .unwrap_or(MEMORY_READ_DEFAULT_LIMIT)
        .clamp(1, MEMORY_READ_MAX_LIMIT);
    let matching = rows
        .into_iter()
        .filter(|row| {
            query.is_empty()
                || row
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .contains(&query)
        })
        .collect::<Vec<_>>();
    let matching_total = matching.len();
    let items = matching
        .into_iter()
        .take(limit)
        .map(project_memory)
        .collect::<Vec<_>>();
    json!({
        "items": items,
        "matchingTotal": matching_total,
        "pageCount": items.len(),
        "limit": limit,
        "hasMore": matching_total > items.len()
    })
}

fn project_memory(row: Value) -> Value {
    let mut projected = Map::new();
    for field in [
        "id",
        "content",
        "kind",
        "memoryKind",
        "status",
        "createdAt",
        "updatedAt",
        "sourceChatId",
        "creationReason",
    ] {
        if let Some(value) = row.get(field) {
            projected.insert(field.to_string(), value.clone());
        }
    }
    Value::Object(projected)
}

#[cfg(test)]
mod tests {
    use super::super::chat_access::{
        DekiChatAccessGrant, DekiChatAccessScope, DekiChatAccessWindow,
    };
    use super::*;
    use crate::state::AppState;
    use crate::storage_commands::canonical_memory;
    use serde_json::{json, Value};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-deki-memory-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn seed_character_memory(state: &AppState, id: &str, character_id: &str, content: &str) {
        canonical_memory::create_memory(
            state,
            json!({
                "id": id,
                "kind": "episode",
                "status": "active",
                "scope": { "kind": "character", "id": character_id },
                "content": content,
                "confidence": 1.0,
                "provenance": { "messageIds": ["message-1"], "characterId": character_id },
                "tags": ["automatic"],
                "payload": {}
            }),
        )
        .expect("character memory should seed");
    }

    fn seed_chat_memory(state: &AppState) {
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-rina",
                    "name": "Rina chat",
                    "mode": "conversation",
                    "memories": [{
                        "id": "chat-memory-1",
                        "chatId": "chat-rina",
                        "content": "Rina keeps the silver key.",
                        "status": "active",
                        "createdAt": "2026-07-22T10:00:00.000Z"
                    }, {
                        "id": "chat-memory-deleted",
                        "chatId": "chat-rina",
                        "content": "Deleted private memory.",
                        "status": "deleted",
                        "deletedAt": "2026-07-22T10:01:00.000Z",
                        "createdAt": "2026-07-22T09:00:00.000Z"
                    }]
                }),
            )
            .expect("chat memory should seed");
    }

    fn chat_grant(chat_id: &str) -> DekiChatAccessGrant {
        DekiChatAccessGrant {
            id: "grant-1".to_string(),
            action_message_id: "action-1".to_string(),
            scope: DekiChatAccessScope::SpecificChats {
                chat_ids: vec![chat_id.to_string()],
            },
            window: DekiChatAccessWindow {
                message_count: Some(5),
            },
            granted_at: "2026-07-22T10:00:00.000Z".to_string(),
            expires_at: None,
        }
    }

    #[test]
    fn character_reads_are_bounded_to_the_requested_scope() {
        let state = test_state("character-read");
        seed_character_memory(
            &state,
            "memory-rina",
            "char-rina",
            "Rina keeps the silver key.",
        );
        seed_character_memory(
            &state,
            "memory-other",
            "char-other",
            "Other private memory.",
        );

        let result = read(
            &state,
            &[],
            ReadDekiMemoriesArgs {
                scope_type: "character".to_string(),
                scope_id: "char-rina".to_string(),
                query: None,
                limit: None,
            },
        )
        .expect("character memory read should succeed");

        assert_eq!(result["items"].as_array().map(Vec::len), Some(1));
        assert_eq!(
            result["items"][0]["id"],
            Value::String("memory-rina".to_string())
        );
        assert_eq!(
            result["items"][0]["content"],
            json!("Rina keeps the silver key.")
        );
        assert!(!result.to_string().contains("Other private memory"));
    }

    #[test]
    fn chat_reads_require_a_covering_grant() {
        let state = test_state("chat-read");
        seed_chat_memory(&state);

        let denied = read(
            &state,
            &[],
            ReadDekiMemoriesArgs {
                scope_type: "chat".to_string(),
                scope_id: "chat-rina".to_string(),
                query: None,
                limit: None,
            },
        );
        assert!(denied.is_err());

        let result = read(
            &state,
            &[chat_grant("chat-rina")],
            ReadDekiMemoriesArgs {
                scope_type: "chat".to_string(),
                scope_id: "chat-rina".to_string(),
                query: None,
                limit: None,
            },
        )
        .expect("covered chat memory should read");

        assert_eq!(result["items"].as_array().map(Vec::len), Some(1));
        assert_eq!(result["items"][0]["id"], json!("chat-memory-1"));
        assert_eq!(
            result["items"][0]["content"],
            json!("Rina keeps the silver key.")
        );
    }

    #[tokio::test]
    async fn character_edits_verify_scope_and_rebuild_the_lexical_index() {
        let state = test_state("character-edit");
        seed_character_memory(
            &state,
            "memory-rina",
            "char-rina",
            "Rina keeps the silver key.",
        );
        seed_character_memory(
            &state,
            "memory-other",
            "char-other",
            "Other private memory.",
        );

        let denied = edit(
            &state,
            &[],
            EditDekiMemoryArgs {
                scope_type: "character".to_string(),
                scope_id: "char-rina".to_string(),
                memory_id: "memory-other".to_string(),
                content: "Changed across scope.".to_string(),
            },
        )
        .await;
        assert!(denied.is_err());

        let deleted = edit(
            &state,
            &[chat_grant("chat-rina")],
            EditDekiMemoryArgs {
                scope_type: "chat".to_string(),
                scope_id: "chat-rina".to_string(),
                memory_id: "chat-memory-deleted".to_string(),
                content: "Deleted memory should remain inaccessible.".to_string(),
            },
        )
        .await;
        assert!(deleted.is_err());

        let updated = edit(
            &state,
            &[],
            EditDekiMemoryArgs {
                scope_type: "character".to_string(),
                scope_id: "char-rina".to_string(),
                memory_id: "memory-rina".to_string(),
                content: "Rina entrusted the silver key to Celia.".to_string(),
            },
        )
        .await
        .expect("in-scope character memory should update");

        assert_eq!(
            updated["memory"]["content"],
            json!("Rina entrusted the silver key to Celia.")
        );
        let stored = canonical_memory::get_memory(&state, "memory-rina")
            .expect("updated memory should read");
        assert_eq!(
            stored["content"],
            json!("Rina entrusted the silver key to Celia.")
        );
        let index_rows = state
            .storage
            .list("memory-index-rows")
            .expect("memory index should list");
        assert!(index_rows.iter().any(|row| {
            row["memoryId"] == json!("memory-rina")
                && row["lexicalTokens"]
                    .as_array()
                    .is_some_and(|tokens| tokens.contains(&json!("entrusted")))
        }));
    }

    #[tokio::test]
    async fn chat_edits_require_a_covering_grant_and_use_the_chat_memory_owner() {
        let state = test_state("chat-edit");
        seed_chat_memory(&state);

        let denied = edit(
            &state,
            &[chat_grant("chat-other")],
            EditDekiMemoryArgs {
                scope_type: "chat".to_string(),
                scope_id: "chat-rina".to_string(),
                memory_id: "chat-memory-1".to_string(),
                content: "Rina entrusted the silver key to Celia.".to_string(),
            },
        )
        .await;
        assert!(denied.is_err());

        let updated = edit(
            &state,
            &[chat_grant("chat-rina")],
            EditDekiMemoryArgs {
                scope_type: "chat".to_string(),
                scope_id: "chat-rina".to_string(),
                memory_id: "chat-memory-1".to_string(),
                content: "Rina entrusted the silver key to Celia.".to_string(),
            },
        )
        .await
        .expect("covered chat memory should update");

        assert_eq!(
            updated["memory"]["content"],
            json!("Rina entrusted the silver key to Celia.")
        );
        let chat = state
            .storage
            .get("chats", "chat-rina")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(
            chat["memories"][0]["content"],
            json!("Rina entrusted the silver key to Celia.")
        );
        assert_eq!(chat["memories"][0]["userEdited"], json!(true));
        assert!(chat["memories"][0]["embedding"].is_array());
    }

    #[tokio::test]
    async fn edits_reject_empty_content_and_inactive_character_memories() {
        let state = test_state("edit-validation");
        seed_character_memory(
            &state,
            "memory-rina",
            "char-rina",
            "Rina keeps the silver key.",
        );

        let empty = edit(
            &state,
            &[],
            EditDekiMemoryArgs {
                scope_type: "character".to_string(),
                scope_id: "char-rina".to_string(),
                memory_id: "memory-rina".to_string(),
                content: "   ".to_string(),
            },
        )
        .await;
        assert!(empty.is_err());

        canonical_memory::update_memory(&state, "memory-rina", json!({ "status": "deleted" }))
            .expect("memory should become inactive");
        let inactive = edit(
            &state,
            &[],
            EditDekiMemoryArgs {
                scope_type: "character".to_string(),
                scope_id: "char-rina".to_string(),
                memory_id: "memory-rina".to_string(),
                content: "Rina entrusted the silver key to Celia.".to_string(),
            },
        )
        .await;
        assert!(inactive.is_err());
    }
}
