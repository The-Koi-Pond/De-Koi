use super::chat_access::{self, DekiChatAccessGrant};
use crate::state::AppState;
use crate::storage_commands::{canonical_memory, chat_memory};
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Map, Value};

const MEMORY_READ_DEFAULT_LIMIT: usize = 50;
const MEMORY_READ_MAX_LIMIT: usize = 100;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadDekiMemoriesArgs {
    #[serde(alias = "scope_type")]
    pub(super) scope_type: String,
    #[serde(alias = "scope_id")]
    pub(super) scope_id: String,
    #[serde(default)]
    pub(super) query: Option<String>,
    #[serde(default)]
    pub(super) limit: Option<usize>,
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

/// The memory a Deki edit targets, as stored now. It must belong to the named
/// character or chat and still be editable (active or pinned character
/// memories; retrievable chat memories). Chat access was checked when the
/// edit was proposed.
pub(super) fn current_memory(
    state: &AppState,
    scope_type: &str,
    scope_id: &str,
    memory_id: &str,
) -> AppResult<Value> {
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
            Ok(current)
        }
        "chat" => {
            let current = chat_memory::list_chat_memories_excluding_recent(
                state,
                scope_id,
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
                    "Memory '{memory_id}' was not found in chat '{scope_id}'"
                ))
            })?;
            if !chat_memory::chat_memory_is_retrievable(&current) {
                return Err(AppError::invalid_input(
                    "Only active chat memories can be edited",
                ));
            }
            Ok(current)
        }
        _ => Err(AppError::invalid_input(
            "Memory scopeType must be character or chat",
        )),
    }
}

/// Replaces a memory's content through its storage owner: the canonical
/// memory store (and its lexical index) for characters, or the chat memory
/// owner (which re-embeds) for chats.
pub(super) async fn update_memory(
    state: &AppState,
    scope_type: &str,
    scope_id: &str,
    memory_id: &str,
    content: &str,
) -> AppResult<Value> {
    match scope_type {
        "character" => {
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
            let updated_chat = chat_memory::update_chat_memory(
                state,
                scope_id,
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
            "Memory scopeType must be character or chat",
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
    use marinara_core::AppResult;
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
        )
        .expect_err("missing chat grant should reject");
        assert_eq!(denied.code, "invalid_input");

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

    fn edit_scope(label: &str) -> super::super::approvals::DekiApprovalScope {
        super::super::approvals::DekiApprovalScope::new(
            &super::super::status::DekiRuntimeOwner::Embedded,
            &format!("memory-{label}-{}", marinara_core::new_id()),
        )
        .expect("approval scope")
    }

    /// Proposes an edit_memory dry-run the way the command runtime does.
    fn propose_edit(
        state: &AppState,
        scope: &super::super::approvals::DekiApprovalScope,
        grants: &[DekiChatAccessGrant],
        args: Value,
    ) -> AppResult<Value> {
        let mutation = super::super::memory_edit::mutation(
            state,
            grants,
            serde_json::from_value(args).expect("edit_memory args"),
        )?;
        let mut pending = Vec::new();
        super::super::data_cli::execute(
            state,
            scope,
            super::super::data_cli::DekiDataCommand::Mutate(mutation),
            &mut pending,
        )
    }

    fn approve_edit(
        state: &AppState,
        scope: &super::super::approvals::DekiApprovalScope,
        result: &Value,
    ) -> AppResult<Value> {
        let id = result["approval"]["id"]
            .as_str()
            .expect("dry-run should create a pending approval");
        super::super::approvals::approve(
            state,
            &super::super::status::DekiRuntimeOwner::Embedded,
            &scope.session_id,
            id,
        )
    }

    #[test]
    fn character_memory_edits_wait_for_approval_and_rebuild_the_lexical_index() {
        let state = test_state("character-edit");
        let scope = edit_scope("character");
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

        let denied = propose_edit(
            &state,
            &scope,
            &[],
            json!({ "scopeType": "character", "scopeId": "char-rina", "memoryId": "memory-other", "content": "Changed across scope.", "reason": "test" }),
        )
        .expect("dry-run runs");
        assert_eq!(denied["ok"], json!(false), "cross-scope edit is blocked");

        let proposed = propose_edit(
            &state,
            &scope,
            &[],
            json!({ "scopeType": "character", "scopeId": "char-rina", "memoryId": "memory-rina", "content": "Rina entrusted the silver key to Celia.", "reason": "test" }),
        )
        .expect("dry-run runs");
        let stored = canonical_memory::get_memory(&state, "memory-rina").expect("memory reads");
        assert_eq!(
            stored["content"],
            json!("Rina keeps the silver key."),
            "nothing changes before approval"
        );

        approve_edit(&state, &scope, &proposed).expect("approval applies");
        let stored = canonical_memory::get_memory(&state, "memory-rina").expect("memory reads");
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

    #[test]
    fn chat_memory_edits_need_a_covering_grant_and_use_the_chat_memory_owner() {
        let state = test_state("chat-edit");
        let scope = edit_scope("chat");
        seed_chat_memory(&state);

        let denied = propose_edit(
            &state,
            &scope,
            &[chat_grant("chat-other")],
            json!({ "scopeType": "chat", "scopeId": "chat-rina", "memoryId": "chat-memory-1", "content": "Rina entrusted the silver key to Celia.", "reason": "test" }),
        )
        .expect_err("a grant for another chat is refused");
        assert_eq!(denied.code, "invalid_input");

        let deleted = propose_edit(
            &state,
            &scope,
            &[chat_grant("chat-rina")],
            json!({ "scopeType": "chat", "scopeId": "chat-rina", "memoryId": "chat-memory-deleted", "content": "Deleted memory should remain inaccessible.", "reason": "test" }),
        )
        .expect("dry-run runs");
        assert_eq!(
            deleted["ok"],
            json!(false),
            "deleted memories cannot be edited"
        );

        let proposed = propose_edit(
            &state,
            &scope,
            &[chat_grant("chat-rina")],
            json!({ "scopeType": "chat", "scopeId": "chat-rina", "memoryId": "chat-memory-1", "content": "Rina entrusted the silver key to Celia.", "reason": "test" }),
        )
        .expect("dry-run runs");
        approve_edit(&state, &scope, &proposed).expect("approval applies");

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

    #[test]
    fn memory_edits_reject_empty_content_and_inactive_character_memories() {
        let state = test_state("edit-validation");
        let scope = edit_scope("validation");
        seed_character_memory(
            &state,
            "memory-rina",
            "char-rina",
            "Rina keeps the silver key.",
        );

        let empty = propose_edit(
            &state,
            &scope,
            &[],
            json!({ "scopeType": "character", "scopeId": "char-rina", "memoryId": "memory-rina", "content": "   ", "reason": "test" }),
        )
        .expect("dry-run runs");
        assert_eq!(empty["ok"], json!(false));

        canonical_memory::update_memory(&state, "memory-rina", json!({ "status": "deleted" }))
            .expect("memory should become inactive");
        let inactive = propose_edit(
            &state,
            &scope,
            &[],
            json!({ "scopeType": "character", "scopeId": "char-rina", "memoryId": "memory-rina", "content": "Rina entrusted the silver key to Celia.", "reason": "test" }),
        )
        .expect("dry-run runs");
        assert_eq!(inactive["ok"], json!(false));
    }
}
