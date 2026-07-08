use crate::state::AppState;
use crate::storage_commands::{chats, entity_commands, game_state_snapshots, prompts, shared};
use marinara_core::{AppError, AppResult};
use serde_json::{json, Map, Value};

fn required_string<'a>(args: &'a Map<String, Value>, key: &str) -> AppResult<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::invalid_input(format!("{key} is required")))
}

fn required_i64(args: &Map<String, Value>, key: &str) -> AppResult<i64> {
    args.get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| AppError::invalid_input(format!("{key} is required")))
}

fn required_string_vec(args: &Map<String, Value>, key: &str) -> AppResult<Vec<String>> {
    let values = args
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::invalid_input(format!("{key} is required")))?;
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| AppError::invalid_input(format!("{key} must contain strings")))
        })
        .collect()
}

fn required_non_empty_string_vec(args: &Map<String, Value>, key: &str) -> AppResult<Vec<String>> {
    let values = required_string_vec(args, key)?;
    if values.is_empty() {
        return Err(AppError::invalid_input(format!("{key} must not be empty")));
    }
    Ok(values)
}

fn optional_value(args: &Map<String, Value>, key: &str) -> Value {
    args.get(key).cloned().unwrap_or(Value::Null)
}

pub fn tracker_snapshot_latest(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    Ok(
        game_state_snapshots::latest_tracker_snapshot(state, required_string(args, "chatId")?)?
            .unwrap_or(Value::Null),
    )
}

pub fn tracker_snapshot_get(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    Ok(game_state_snapshots::tracker_snapshot_for_target(
        state,
        required_string(args, "chatId")?,
        required_string(args, "messageId")?,
        required_i64(args, "swipeIndex")?,
    )?
    .unwrap_or(Value::Null))
}

pub fn tracker_snapshot_save(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    game_state_snapshots::save_tracker_snapshot(
        state,
        required_string(args, "chatId")?,
        optional_value(args, "snapshot"),
    )
}

pub fn chat_connect(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    let chat_id = required_string(args, "chatId")?;
    let target_chat_id = required_string(args, "targetChatId")?;
    chats::connect_chats(state, chat_id, target_chat_id)
}

pub fn chat_disconnect(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    chats::disconnect_connected_chat(state, required_string(args, "chatId")?)
}

pub fn storage_list(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::storage_list_inner(
        state,
        required_string(args, "entity")?.to_string(),
        args.get("options")
            .filter(|value| !value.is_null())
            .cloned(),
    )
}

pub fn lorebook_entries_list_by_lorebook_ids(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    entity_commands::lorebook_entries_list_by_lorebook_ids_inner(
        state,
        required_string_vec(args, "lorebookIds")?,
    )
}

pub fn storage_get(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::storage_get_inner(
        state,
        required_string(args, "entity")?.to_string(),
        required_string(args, "id")?.to_string(),
        args.get("options")
            .filter(|value| !value.is_null())
            .cloned(),
    )
}

pub fn prompt_preset_bundle(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    prompts::prompt_preset_bundle(state, required_string(args, "presetId")?)
}

pub fn storage_create(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::storage_create_inner(
        state,
        required_string(args, "entity")?.to_string(),
        optional_value(args, "value"),
    )
}

pub fn storage_update(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::storage_update_inner(
        state,
        required_string(args, "entity")?.to_string(),
        required_string(args, "id")?.to_string(),
        optional_value(args, "patch"),
    )
}

pub fn storage_delete(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    let entity = required_string(args, "entity")?;
    let id = required_string(args, "id")?;
    entity_commands::delete_entity(
        state,
        entity,
        id,
        args.get("force").and_then(Value::as_bool).unwrap_or(false),
    )
}

pub fn regex_script_reorder(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::regex_script_reorder_inner(
        state,
        required_non_empty_string_vec(args, "orderedIds")?,
    )
}

pub fn prompt_nested_reorder(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::prompt_nested_reorder_inner(
        state,
        required_string(args, "presetId")?,
        required_string(args, "kind")?,
        required_non_empty_string_vec(args, "orderedIds")?,
    )
}
pub fn storage_duplicate(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::duplicate_entity(
        state,
        required_string(args, "entity")?,
        required_string(args, "id")?,
    )
}

pub fn connection_folder_reorder(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::connection_folder_reorder_inner(
        state,
        required_non_empty_string_vec(args, "orderedIds")?,
    )
}

pub fn lorebook_entry_reorder(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    let folder_id = match args.get("folderId") {
        Some(Value::Null) | None => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(Value::Number(value)) => Some(value.to_string()),
        Some(_) => {
            return Err(AppError::invalid_input(
                "folderId must be a folder id, number, or null",
            ))
        }
    };
    entity_commands::lorebook_entry_reorder_inner(
        state,
        required_string(args, "lorebookId")?,
        required_non_empty_string_vec(args, "orderedIds")?,
        folder_id,
    )
}
pub fn lorebook_folder_reorder(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    let parent_folder_id = match args.get("parentFolderId") {
        Some(Value::Null) | None => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(_) => {
            return Err(AppError::invalid_input(
                "parentFolderId must be a folder id or null",
            ));
        }
    };
    entity_commands::lorebook_folder_reorder_inner(
        state,
        required_string(args, "lorebookId")?,
        required_non_empty_string_vec(args, "orderedIds")?,
        parent_folder_id,
    )
}

pub fn connection_move(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    entity_commands::connection_move_inner(
        state,
        required_string(args, "connectionId")?,
        args.get("folderId")
            .and_then(Value::as_str)
            .map(str::to_string),
    )
}

pub fn chat_message_add_swipe(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    Ok(shared::project_timeline_message(chats::message_swipes(
        state,
        "POST",
        required_string(args, "chatId")?,
        required_string(args, "messageId")?,
        optional_value(args, "body"),
    )?))
}

pub fn chat_message_update_content_if_unchanged(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    chats::update_message_content_if_unchanged(
        state,
        required_string(args, "chatId")?,
        required_string(args, "messageId")?,
        required_string(args, "expectedContent")?,
        required_string(args, "content")?,
    )
}

pub fn chat_message_set_active_swipe(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    Ok(shared::project_timeline_message(chats::set_active_swipe(
        state,
        required_string(args, "chatId")?,
        required_string(args, "messageId")?,
        json!({ "index": optional_value(args, "index") }),
    )?))
}

pub fn chat_message_delete_swipe(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    Ok(shared::project_timeline_message(chats::delete_swipe(
        state,
        required_string(args, "chatId")?,
        required_string(args, "messageId")?,
        required_string(args, "index")?,
    )?))
}

pub fn chat_evict_prompt_snapshots(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let keep_last = args.get("keepLast").and_then(Value::as_u64).unwrap_or(2) as usize;
    chats::evict_prompt_snapshots(state, required_string(args, "chatId")?, keep_last)
}

pub fn chat_autonomous_unread_mark(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    chats::mark_autonomous_unread(
        state,
        required_string(args, "chatId")?,
        optional_value(args, "body"),
    )
}

pub fn chat_autonomous_unread_clear(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    chats::clear_autonomous_unread(state, required_string(args, "chatId")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http_dispatch::{dispatch, InvokeRequest};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("marinara-http-storage-dispatch-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dispatch dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn default_for_agents(state: &AppState, id: &str) -> bool {
        state
            .storage
            .get("connections", id)
            .expect("connection should read")
            .and_then(|row| row.get("defaultForAgents").and_then(Value::as_bool))
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn dispatch_storage_create_rejects_unsupported_entity() {
        let state = test_state("storage-create-unsupported-entity");

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "storage_create".to_string(),
                args: Some(json!({
                    "entity": "typo-collection",
                    "value": { "id": "row-1" }
                })),
            },
        )
        .await
        .expect_err("remote storage_create should reject unsupported entities");

        assert_eq!(error.code, "invalid_input");
        assert!(error
            .message
            .contains("Unsupported storage entity: typo-collection"));
        assert!(!state
            .data_dir
            .join("data")
            .join("collections")
            .join("typo-collection.json")
            .exists());
    }

    #[tokio::test]
    async fn dispatch_reorder_rejects_empty_ordered_ids() {
        let state = test_state("reorder-empty-ordered-ids");

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "regex_script_reorder".to_string(),
                args: Some(json!({ "orderedIds": [] })),
            },
        )
        .await
        .expect_err("empty orderedIds should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("orderedIds must not be empty"));
    }

    #[tokio::test]
    async fn dispatch_lorebook_entry_reorder_accepts_numeric_folder_id() {
        let state = test_state("lorebook-entry-reorder-numeric-folder-id");
        state
            .storage
            .create(
                "lorebook-folders",
                json!({ "id": "7", "lorebookId": "book-1", "name": "Folder" }),
            )
            .expect("folder should seed");
        state
            .storage
            .create(
                "lorebook-entries",
                json!({ "id": "entry-1", "lorebookId": "book-1", "key": ["entry"] }),
            )
            .expect("entry should seed");

        dispatch(
            &state,
            InvokeRequest {
                command: "lorebook_entry_reorder".to_string(),
                args: Some(json!({
                    "lorebookId": "book-1",
                    "folderId": 7,
                    "orderedIds": ["entry-1"]
                })),
            },
        )
        .await
        .expect("numeric folderId should dispatch");

        let entry = state
            .storage
            .get("lorebook-entries", "entry-1")
            .expect("entry should read")
            .expect("entry should exist");
        assert_eq!(entry["folderId"], json!("7"));
        assert_eq!(entry["order"], json!(0));
    }
    #[tokio::test]
    async fn dispatch_chat_disconnect_clears_partner_and_connected_notes() {
        let state = test_state("chat-disconnect-connected-notes");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "conversation-1",
                    "name": "Conversation",
                    "connectedChatId": "game-1"
                }),
            )
            .unwrap();
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "game-1",
                    "name": "Game",
                    "connectedChatId": "conversation-1",
                    "notes": [
                        {
                            "id": "stale-influence",
                            "type": "influence",
                            "content": "Remove stale influence",
                            "sourceChatId": "conversation-1",
                            "targetChatId": "game-1",
                            "consumed": false
                        },
                        {
                            "id": "other-note",
                            "type": "note",
                            "content": "Keep unrelated note",
                            "sourceChatId": "other-chat",
                            "targetChatId": "other-target"
                        }
                    ]
                }),
            )
            .unwrap();

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "chat_disconnect".to_string(),
                args: Some(json!({ "chatId": "conversation-1" })),
            },
        )
        .await
        .expect("remote chat disconnect should dispatch");

        assert_eq!(result["disconnected"], true);
        assert_eq!(result["chatIds"], json!(["conversation-1", "game-1"]));
        let conversation = state
            .storage
            .get("chats", "conversation-1")
            .unwrap()
            .unwrap();
        let game = state.storage.get("chats", "game-1").unwrap().unwrap();
        assert!(conversation
            .get("connectedChatId")
            .is_some_and(Value::is_null));
        assert!(game.get("connectedChatId").is_some_and(Value::is_null));
        let notes = game["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(
            notes[0].get("id").and_then(Value::as_str),
            Some("other-note")
        );
    }

    #[tokio::test]
    async fn dispatch_storage_list_uses_projected_message_reads() {
        let state = test_state("storage-list-projected-messages");
        state
            .storage
            .replace_all(
                "messages",
                vec![
                    json!({
                        "id": "skip-me",
                        "chatId": "chat-b",
                        "content": "skip",
                        "extra": { "large": "ignored" },
                        "swipes": [{ "content": "skip swipe", "extra": { "thinking": "skip thought" } }]
                    }),
                    json!({
                        "id": "message-1",
                        "chatId": "chat-a",
                        "content": "stored content",
                        "extra": { "thinking": "visible thought", "large": "ignored" },
                        "swipes": [{ "content": "active swipe", "extra": { "thinking": "swipe thought", "large": "ignored" } }]
                    }),
                ],
            )
            .expect("messages should be installed");
        crate::storage_commands::message_swipes::migrate_nested_message_swipes(&state.storage)
            .expect("nested message swipes should migrate");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "storage_list".to_string(),
                args: Some(json!({
                    "entity": "messages",
                    "options": {
                        "filters": { "chatId": "chat-a" },
                        "fields": ["id", "chatId", "content", "extra"],
                        "fieldSelections": { "extra": ["thinking"] },
                        "limit": 25
                    }
                })),
            },
        )
        .await
        .expect("remote storage_list should dispatch");

        assert_eq!(
            result,
            json!([{
                "id": "message-1",
                "chatId": "chat-a",
                "content": "active swipe",
                "extra": { "thinking": "swipe thought" }
            }])
        );
    }

    #[tokio::test]
    async fn dispatch_lorebook_entries_list_by_lorebook_ids_reads_matching_books() {
        let state = test_state("remote-lorebook-entries-where-in");
        state
            .storage
            .replace_all(
                "lorebook-entries",
                vec![
                    json!({ "id": "entry-a", "lorebookId": "book-a", "content": "A" }),
                    json!({ "id": "entry-b", "lorebookId": "book-b", "content": "B" }),
                    json!({ "id": "entry-c", "lorebookId": "book-c", "content": "C" }),
                ],
            )
            .expect("entries should seed");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "lorebook_entries_list_by_lorebook_ids".to_string(),
                args: Some(json!({ "lorebookIds": ["book-a", "book-c"] })),
            },
        )
        .await
        .expect("remote batched lorebook entries should dispatch");

        let ids: Vec<_> = result
            .as_array()
            .expect("result should be an array")
            .iter()
            .filter_map(|row| row.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(ids, vec!["entry-a", "entry-c"]);
    }

    #[tokio::test]
    async fn dispatch_prompt_preset_bundle_reads_preset_children_together() {
        let state = test_state("remote-prompt-preset-bundle");
        state
            .storage
            .create(
                "prompts",
                json!({
                    "id": "preset-1",
                    "name": "Preset",
                    "sectionOrder": ["section-2", "section-1"],
                    "groupOrder": ["group-1"],
                    "variableOrder": ["choice-1"]
                }),
            )
            .expect("prompt preset should seed");
        state
            .storage
            .replace_all(
                "prompt-sections",
                vec![
                    json!({ "id": "other-section", "presetId": "other-preset", "name": "Other" }),
                    json!({ "id": "section-1", "presetId": "preset-1", "sortOrder": 20 }),
                    json!({ "id": "section-2", "presetId": "preset-1", "sortOrder": 10 }),
                ],
            )
            .expect("prompt sections should seed");
        state
            .storage
            .replace_all(
                "prompt-groups",
                vec![
                    json!({ "id": "group-1", "presetId": "preset-1" }),
                    json!({ "id": "other-group", "presetId": "other-preset" }),
                ],
            )
            .expect("prompt groups should seed");
        state
            .storage
            .replace_all(
                "prompt-variables",
                vec![
                    json!({ "id": "choice-1", "presetId": "preset-1" }),
                    json!({ "id": "other-choice", "presetId": "other-preset" }),
                ],
            )
            .expect("prompt variables should seed");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "prompt_preset_bundle".to_string(),
                args: Some(json!({ "presetId": "preset-1" })),
            },
        )
        .await
        .expect("remote prompt preset bundle should dispatch");

        assert_eq!(result["preset"]["id"], json!("preset-1"));
        assert_eq!(
            result["sections"]
                .as_array()
                .expect("sections should be an array")
                .iter()
                .filter_map(|row| row.get("id").and_then(Value::as_str))
                .collect::<Vec<_>>(),
            vec!["section-2", "section-1"]
        );
        assert_eq!(result["groups"][0]["id"], json!("group-1"));
        assert_eq!(result["choiceBlocks"][0]["id"], json!("choice-1"));
    }

    #[tokio::test]
    async fn dispatch_prompt_preset_bundle_returns_null_for_missing_preset() {
        let state = test_state("remote-prompt-preset-bundle-missing");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "prompt_preset_bundle".to_string(),
                args: Some(json!({ "presetId": "missing-preset" })),
            },
        )
        .await
        .expect("missing prompt preset bundle should dispatch");

        assert!(result.is_null());
    }

    #[tokio::test]
    async fn dispatch_storage_create_connection_clears_previous_agent_default() {
        let state = test_state("storage-create-connection-agent-default");
        for (id, provider) in [("language-a", "anthropic"), ("language-b", "openai")] {
            dispatch(
                &state,
                InvokeRequest {
                    command: "storage_create".to_string(),
                    args: Some(json!({
                        "entity": "connections",
                        "value": {
                            "id": id,
                            "name": id,
                            "provider": provider,
                            "defaultForAgents": true
                        }
                    })),
                },
            )
            .await
            .expect("remote connection create should dispatch");
        }

        assert!(!default_for_agents(&state, "language-a"));
        assert!(default_for_agents(&state, "language-b"));
    }

    #[tokio::test]
    async fn dispatch_storage_update_connection_clears_previous_agent_default() {
        let state = test_state("storage-update-connection-agent-default");
        for (id, default_for_agents) in [("language-a", true), ("language-b", false)] {
            state
                .storage
                .create(
                    "connections",
                    json!({
                        "id": id,
                        "name": id,
                        "provider": "openai",
                        "defaultForAgents": default_for_agents
                    }),
                )
                .expect("connection should be seeded");
        }

        dispatch(
            &state,
            InvokeRequest {
                command: "storage_update".to_string(),
                args: Some(json!({
                    "entity": "connections",
                    "id": "language-b",
                    "patch": { "defaultForAgents": true }
                })),
            },
        )
        .await
        .expect("remote connection update should dispatch");

        assert!(!default_for_agents(&state, "language-a"));
        assert!(default_for_agents(&state, "language-b"));
    }

    #[tokio::test]
    async fn dispatch_storage_update_protects_default_chat_preset_fields() {
        let state = test_state("storage-update-default-chat-preset");
        state
            .storage
            .create(
                "chat-presets",
                json!({
                    "id": "default-chat-preset",
                    "name": "Default Chat",
                    "mode": "chat",
                    "isDefault": true,
                    "isActive": true
                }),
            )
            .expect("default chat preset should be seeded");

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "storage_update".to_string(),
                args: Some(json!({
                    "entity": "chat-presets",
                    "id": "default-chat-preset",
                    "patch": { "name": "Mutated Default" }
                })),
            },
        )
        .await
        .expect_err("default chat preset field mutations should be rejected remotely");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(error.message, "Default chat presets cannot be updated");
        let preset = state
            .storage
            .get("chat-presets", "default-chat-preset")
            .expect("chat preset should read")
            .expect("chat preset should still exist");
        assert_eq!(preset["name"], "Default Chat");
    }

    #[tokio::test]
    async fn dispatch_chat_connect_rejects_self_links() {
        let state = test_state("chat-connect-self");
        state
            .storage
            .create(
                "chats",
                json!({ "id": "chat-1", "name": "Chat", "mode": "conversation" }),
            )
            .unwrap();

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "chat_connect".to_string(),
                args: Some(json!({ "chatId": "chat-1", "targetChatId": "chat-1" })),
            },
        )
        .await
        .expect_err("self connections should be rejected");

        assert_eq!(error.code, "invalid_input");
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert!(chat.get("connectedChatId").is_none());
    }

    #[tokio::test]
    async fn dispatch_chat_connect_rejects_missing_targets_without_partial_link() {
        let state = test_state("chat-connect-missing-target");
        state
            .storage
            .create(
                "chats",
                json!({ "id": "chat-1", "name": "Chat", "mode": "conversation" }),
            )
            .unwrap();

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "chat_connect".to_string(),
                args: Some(json!({ "chatId": "chat-1", "targetChatId": "missing-chat" })),
            },
        )
        .await
        .expect_err("missing target should be rejected before writing");

        assert_eq!(error.code, "not_found");
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert!(chat.get("connectedChatId").is_none());
    }

    #[tokio::test]
    async fn dispatch_chat_connect_links_existing_chats_reciprocally() {
        let state = test_state("chat-connect-valid");
        for chat_id in ["chat-1", "chat-2"] {
            state
                .storage
                .create(
                    "chats",
                    json!({ "id": chat_id, "name": chat_id, "mode": "conversation" }),
                )
                .unwrap();
        }

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "chat_connect".to_string(),
                args: Some(json!({ "chatId": "chat-1", "targetChatId": "chat-2" })),
            },
        )
        .await
        .expect("valid connection should be written");

        assert_eq!(result["connected"], true);
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        let target = state.storage.get("chats", "chat-2").unwrap().unwrap();
        assert_eq!(
            chat.get("connectedChatId").and_then(Value::as_str),
            Some("chat-2")
        );
        assert_eq!(
            target.get("connectedChatId").and_then(Value::as_str),
            Some("chat-1")
        );
    }

    #[tokio::test]
    async fn dispatch_storage_delete_message_cleans_tracker_snapshots() {
        let state = test_state("message-delete-tracker-cleanup");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Tracker chat",
                    "gameState": { "kind": "tracker", "chatId": "chat-1", "messageId": "message-2", "swipeIndex": 0 }
                }),
            )
            .unwrap();
        for (message_id, created_at) in [
            ("message-1", "2026-05-26T10:00:00Z"),
            ("message-2", "2026-05-26T10:01:00Z"),
        ] {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": message_id,
                        "chatId": "chat-1",
                        "role": "assistant",
                        "content": "turn",
                        "createdAt": created_at
                    }),
                )
                .unwrap();
            state
                .storage
                .create(
                    "game-state-snapshots",
                    json!({
                        "id": format!("snapshot-{message_id}"),
                        "kind": "tracker",
                        "chatId": "chat-1",
                        "messageId": message_id,
                        "swipeIndex": 0,
                        "createdAt": created_at,
                        "location": message_id
                    }),
                )
                .unwrap();
        }

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "storage_delete".to_string(),
                args: Some(json!({ "entity": "messages", "id": "message-2" })),
            },
        )
        .await
        .expect("remote message delete should dispatch");

        assert_eq!(result["deleted"], true);
        assert!(state
            .storage
            .get("messages", "message-2")
            .unwrap()
            .is_none());
        assert!(state
            .storage
            .get("game-state-snapshots", "snapshot-message-2")
            .unwrap()
            .is_none());
        assert!(state
            .storage
            .get("game-state-snapshots", "snapshot-message-1")
            .unwrap()
            .is_some());
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert_eq!(
            chat["gameState"].get("messageId").and_then(Value::as_str),
            Some("message-1")
        );
    }

    #[tokio::test]
    async fn dispatch_storage_delete_non_message_keeps_tracker_snapshots() {
        let state = test_state("non-message-delete-tracker-control");
        state
            .storage
            .create(
                "personas",
                json!({ "id": "persona-1", "name": "Keep tracker snapshots" }),
            )
            .unwrap();
        state
            .storage
            .create(
                "game-state-snapshots",
                json!({
                    "id": "snapshot-message-1",
                    "kind": "tracker",
                    "chatId": "chat-1",
                    "messageId": "message-1",
                    "swipeIndex": 0
                }),
            )
            .unwrap();

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "storage_delete".to_string(),
                args: Some(json!({ "entity": "personas", "id": "persona-1" })),
            },
        )
        .await
        .expect("remote non-message delete should dispatch");

        assert_eq!(result["deleted"], true);
        assert!(state
            .storage
            .get("game-state-snapshots", "snapshot-message-1")
            .unwrap()
            .is_some());
    }
}
