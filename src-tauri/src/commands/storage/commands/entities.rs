use super::{
    avatars, characters, chats, connection_secrets, contracts, entity_images, game_state_snapshots,
    integrations, lorebook_images, managed_thumbnails, media_uploads, message_swipes, personas,
    prompts, shared, sprites,
};
use crate::builtins::is_protected_record;
use crate::state::AppState;
use marinara_core::{ensure_object, new_id, now_iso, AppError};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use tauri::State;

type LorebookEntryAtomicRows<'a> = (&'a mut Vec<Value>, &'a mut Vec<Value>);
type LorebookMetadataAtomicRows<'a> = (&'a mut Vec<Value>, &'a mut Vec<Value>, &'a mut Vec<Value>);
type LorebookFolderDeleteAtomicRows<'a> =
    (&'a mut Vec<Value>, &'a mut Vec<Value>, &'a mut Vec<Value>);
type ChatFolderDeleteAtomicRows<'a> = (&'a mut Vec<Value>, &'a mut Vec<Value>);

#[derive(Clone)]
struct LorebookFolderReorderRow {
    lorebook_id: Option<String>,
    parent_id: Option<String>,
    order: i64,
}

struct StorageWhereIn {
    field: String,
    values: HashSet<String>,
}

#[path = "entities/delete.rs"]
mod delete;
#[path = "entities/duplicate.rs"]
mod duplicate;
#[path = "entities/list_helpers.rs"]
mod list_helpers;
#[path = "entities/normalization.rs"]
mod normalization;
#[path = "entities/support.rs"]
mod support;

#[cfg(test)]
use delete::chat_folder_delete_atomic_rows;
pub(crate) use delete::{
    connection_folder_reorder_inner, connection_move_inner, delete_entity,
    lorebook_folder_reorder_inner,
};
pub(crate) use duplicate::duplicate_entity;

use delete::*;
use duplicate::*;
use list_helpers::*;
use normalization::*;
use support::*;

#[tauri::command]
pub async fn storage_list(
    state: State<'_, AppState>,
    entity: String,
    options: Option<Value>,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage_list_inner(&state, entity, options))
        .await
        .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

pub(crate) fn storage_list_inner(
    state: &AppState,
    entity: String,
    options: Option<Value>,
) -> Result<Value, AppError> {
    validate_storage_entity(&entity)?;
    let where_in = storage_where_in(options.as_ref())?;
    let filters = options
        .as_ref()
        .and_then(|value| value.get("filters"))
        .and_then(Value::as_object);
    let projection_fields = shared::projection_fields(options.as_ref());
    let empty_filters = filters.is_none_or(|filters| filters.is_empty());
    if where_in.is_some() && !empty_filters {
        return Err(AppError::invalid_input(
            "storage_list whereIn cannot be combined with filters",
        ));
    }
    let has_search = shared::has_storage_search(options.as_ref());
    let mut rows = match (entity.as_str(), filters, where_in.as_ref()) {
        (_, _, Some(where_in)) if where_in.values.is_empty() => Vec::new(),
        (_, _, Some(where_in))
            if has_search
                && projection_fields
                    .as_ref()
                    .is_some_and(|fields| !fields.is_empty()) =>
        {
            let search_projection_fields = shared::search_projection_fields(options.as_ref());
            let search_projection_field_selections =
                shared::search_projection_field_selections(options.as_ref());
            let read_projection_fields = storage_list_projection_fields_for_read(
                &entity,
                &search_projection_fields,
                options.as_ref(),
            );
            state.storage.list_projected_where_in(
                &entity,
                &where_in.field,
                &where_in.values,
                &read_projection_fields,
                &search_projection_field_selections,
            )?
        }
        (_, _, Some(where_in))
            if projection_fields
                .as_ref()
                .is_some_and(|fields| !fields.is_empty()) =>
        {
            let read_projection_fields = storage_list_projection_fields_for_read(
                &entity,
                projection_fields.as_deref().unwrap_or(&[]),
                options.as_ref(),
            );
            state.storage.list_projected_where_in(
                &entity,
                &where_in.field,
                &where_in.values,
                &read_projection_fields,
                shared::projection_field_selections(options.as_ref()),
            )?
        }
        (_, _, Some(where_in)) => {
            state
                .storage
                .list_where_in(&entity, &where_in.field, &where_in.values)?
        }
        ("messages", Some(filters), None)
            if filters.len() == 1 && filters.get("chatId").and_then(Value::as_str).is_some() =>
        {
            let chat_id = filters
                .get("chatId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !has_search {
                if let Some((limit, before)) = message_page_options(options.as_ref()) {
                    if let Some(fields) = projection_fields
                        .as_ref()
                        .filter(|fields| !fields.is_empty())
                    {
                        state.storage.list_messages_for_chat_page_projected(
                            chat_id,
                            limit,
                            before.as_deref(),
                            &message_projection_fields_for_materialization(
                                fields,
                                options.as_ref(),
                            ),
                            shared::projection_field_selections(options.as_ref()),
                        )?
                    } else {
                        state.storage.list_messages_for_chat_page(
                            chat_id,
                            limit,
                            before.as_deref(),
                        )?
                    }
                } else if message_id_projection_only(options.as_ref()) {
                    state.storage.list_message_ids_for_chat(chat_id)?
                } else if let Some(fields) = projection_fields
                    .as_ref()
                    .filter(|fields| !fields.is_empty())
                {
                    state.storage.list_messages_for_chat_projected(
                        chat_id,
                        &message_projection_fields_for_materialization(fields, options.as_ref()),
                        shared::projection_field_selections(options.as_ref()),
                    )?
                } else {
                    state.storage.list_messages_for_chat(chat_id)?
                }
            } else {
                state.storage.list_messages_for_chat(chat_id)?
            }
        }
        (_, _, None)
            if empty_filters
                && has_search
                && projection_fields
                    .as_ref()
                    .is_some_and(|fields| !fields.is_empty()) =>
        {
            let search_projection_fields = shared::search_projection_fields(options.as_ref());
            let search_projection_field_selections =
                shared::search_projection_field_selections(options.as_ref());
            let read_projection_fields = storage_list_projection_fields_for_read(
                &entity,
                &search_projection_fields,
                options.as_ref(),
            );
            state.storage.list_projected(
                &entity,
                &read_projection_fields,
                &search_projection_field_selections,
            )?
        }
        (_, _, None)
            if empty_filters
                && !has_search
                && projection_fields
                    .as_ref()
                    .is_some_and(|fields| !fields.is_empty()) =>
        {
            let read_projection_fields = storage_list_projection_fields_for_read(
                &entity,
                projection_fields.as_deref().unwrap_or(&[]),
                options.as_ref(),
            );
            state.storage.list_projected(
                &entity,
                &read_projection_fields,
                shared::projection_field_selections(options.as_ref()),
            )?
        }
        (_, Some(filters), None) if !filters.is_empty() => {
            state.storage.list_where(&entity, filters)?
        }
        _ => state.storage.list(&entity)?,
    };
    let message_materialization = message_swipes::MessageSwipeMaterialization::for_message_output(
        options.as_ref(),
        has_search,
    );
    let materialized_message_swipes_for_search = entity == "messages" && has_search;
    if materialized_message_swipes_for_search {
        message_swipes::materialize_messages_for_output(state, &mut rows, message_materialization)?;
    }
    shared::apply_storage_search(&mut rows, options.as_ref());

    let order_by = options
        .as_ref()
        .and_then(|value| value.get("orderBy"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let descending = options
        .as_ref()
        .and_then(|value| value.get("descending"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    rows.sort_by(|a, b| {
        let ordering = match order_by {
            Some(field) => compare_json_values(a.get(field), b.get(field)),
            None => compare_json_values(
                a.get("sortOrder")
                    .or_else(|| a.get("order"))
                    .or_else(|| a.get("createdAt")),
                b.get("sortOrder")
                    .or_else(|| b.get("order"))
                    .or_else(|| b.get("createdAt")),
            ),
        };
        if descending {
            ordering.reverse()
        } else {
            ordering
        }
    });

    if entity == "messages" {
        apply_message_pagination(&mut rows, options.as_ref());
        if !materialized_message_swipes_for_search {
            message_swipes::materialize_messages_for_output(
                state,
                &mut rows,
                message_materialization,
            )?;
        }
        for row in &mut rows {
            if !message_materialization.include_swipes {
                if let Some(object) = row.as_object_mut() {
                    object.remove("swipes");
                }
            }
            shared::synthesize_legacy_prompt_snapshot(row);
        }
        return Ok(Value::Array(shared::project_list_rows(
            rows,
            options.as_ref(),
        )));
    }

    if entity == "connections" {
        connection_secrets::mask_connection_rows_for_read(&mut rows);
    }

    if let Some(limit) = options
        .as_ref()
        .and_then(|value| value.get("limit"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
    {
        rows.truncate(limit);
    }

    Ok(Value::Array(shared::project_list_rows(
        rows,
        options.as_ref(),
    )))
}

#[tauri::command]
pub async fn lorebook_entries_list_by_lorebook_ids(
    state: State<'_, AppState>,
    lorebook_ids: Vec<String>,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        lorebook_entries_list_by_lorebook_ids_inner(&state, lorebook_ids)
    })
    .await
    .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

pub(crate) fn lorebook_entries_list_by_lorebook_ids_inner(
    state: &AppState,
    lorebook_ids: Vec<String>,
) -> Result<Value, AppError> {
    let lorebook_ids: HashSet<String> = lorebook_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    if lorebook_ids.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let mut rows = state
        .storage
        .list_where_in("lorebook-entries", "lorebookId", &lorebook_ids)?;
    rows.sort_by(|a, b| {
        compare_json_values(
            a.get("sortOrder")
                .or_else(|| a.get("order"))
                .or_else(|| a.get("createdAt")),
            b.get("sortOrder")
                .or_else(|| b.get("order"))
                .or_else(|| b.get("createdAt")),
        )
    });
    Ok(Value::Array(rows))
}

#[tauri::command]
pub async fn storage_get(
    state: State<'_, AppState>,
    entity: String,
    id: String,
    options: Option<Value>,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage_get_inner(&state, entity, id, options))
        .await
        .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

pub(crate) fn storage_get_inner(
    state: &AppState,
    entity: String,
    id: String,
    options: Option<Value>,
) -> Result<Value, AppError> {
    validate_storage_entity(&entity)?;
    let projection_fields = shared::projection_fields(options.as_ref());
    let mut value = if let Some(fields) = projection_fields
        .as_ref()
        .filter(|fields| !fields.is_empty())
    {
        let read_fields = storage_get_projection_fields_for_read(&entity, fields, options.as_ref());
        state
            .storage
            .get_projected(
                &entity,
                &id,
                &read_fields,
                shared::projection_field_selections(options.as_ref()),
            )?
            .unwrap_or(Value::Null)
    } else {
        state.storage.get(&entity, &id)?.unwrap_or(Value::Null)
    };
    if entity == "messages" {
        message_swipes::materialize_message_for_output(
            state,
            &mut value,
            message_swipes::MessageSwipeMaterialization::for_message_output(
                options.as_ref(),
                false,
            ),
        )?;
    }
    if entity == "connections" {
        connection_secrets::mask_connection_for_read(&mut value);
    }
    Ok(shared::project_record(value, options.as_ref()))
}

#[tauri::command]
pub async fn storage_create(
    state: State<'_, AppState>,
    entity: String,
    value: Value,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage_create_inner(&state, entity, value))
        .await
        .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

pub(crate) fn storage_create_inner(
    state: &AppState,
    entity: String,
    value: Value,
) -> Result<Value, AppError> {
    validate_storage_entity(&entity)?;
    reject_message_swipe_mutation(&entity)?;
    validate_chat_folder_for_create(state, &entity, &value)?;
    validate_connection_folder_for_create(state, &entity, &value)?;
    validate_lorebook_folder_for_create(state, &entity, &value)?;
    validate_gallery_folder_for_create(state, &entity, &value)?;
    if entity == "messages" {
        return Ok(shared::project_timeline_message(
            message_swipes::create_message(
                state,
                prepare_entity_for_create(state, &entity, value)?,
            )?,
        ));
    }
    if entity == "chat-folders" {
        return create_chat_folder(state, value);
    }
    if entity == "connection-folders" {
        return create_connection_folder(state, value);
    }
    let should_remove_prepared_gallery_file = gallery_create_persists_inline_image(&entity, &value);
    let prepared = prepare_entity_for_create(state, &entity, value)?;
    if entity == "lorebook-entries" {
        return create_lorebook_entry_with_character_book_sync(state, prepared);
    }
    let create_result = if should_remove_prepared_gallery_file {
        state.storage.create_immediate(&entity, prepared.clone())
    } else {
        state.storage.create(&entity, prepared.clone())
    };
    let created = match create_result {
        Ok(created) => created,
        Err(error) => {
            if should_remove_prepared_gallery_file {
                remove_gallery_file(state, &prepared);
            }
            return Err(error);
        }
    };
    if entity == "connections" {
        clear_other_default_connections(state, &created)?;
        clear_other_default_agent_connections(state, &created)?;
        let mut masked = created;
        connection_secrets::mask_connection_for_read(&mut masked);
        return Ok(masked);
    }
    Ok(created)
}

#[tauri::command]
pub async fn storage_update(
    state: State<'_, AppState>,
    entity: String,
    id: String,
    patch: Value,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage_update_inner(&state, entity, id, patch))
        .await
        .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

pub(crate) fn storage_update_inner(
    state: &AppState,
    entity: String,
    id: String,
    patch: Value,
) -> Result<Value, AppError> {
    validate_storage_entity(&entity)?;
    reject_message_swipe_mutation(&entity)?;
    if entity == "messages" {
        let updated = chats::patch_message_update_with_memory_prune(state, &id, patch)?;
        return Ok(shared::project_timeline_message(updated));
    }
    if entity == "characters" {
        return characters::update_character(state, &id, patch);
    }
    if entity == "chat-presets" {
        return patch_chat_preset(state, &id, patch);
    }
    if entity == "chat-folders" {
        return patch_chat_folder(state, &id, patch);
    }
    validate_chat_folder_for_patch(state, &entity, &id, &patch)?;
    validate_connection_folder_for_patch(state, &entity, &patch)?;
    validate_lorebook_folder_for_patch(state, &entity, &id, &patch)?;
    validate_gallery_folder_for_patch(state, &entity, &patch)?;
    let mut normalized_patch =
        normalize_chat_for_update(&entity, shared::normalize_update_patch(&entity, patch)?)?;
    if entity == "chats" {
        validate_chat_metadata_patch(state, &id, &mut normalized_patch)?;
    }
    if entity == "lorebook-entries" {
        return update_lorebook_entry_with_character_book_sync(state, &id, normalized_patch);
    }
    if entity == "lorebooks" {
        return update_lorebook_with_character_book_sync(state, &id, normalized_patch);
    }
    let updated = if entity == "connections" {
        connection_secrets::patch_connection(state, &id, normalized_patch)?
    } else {
        state.storage.patch(&entity, &id, normalized_patch)?
    };
    if entity == "connections" {
        clear_other_default_connections(state, &updated)?;
        clear_other_default_agent_connections(state, &updated)?;
    }
    Ok(updated)
}

pub(crate) fn prepare_entity_for_create(
    state: &AppState,
    entity: &str,
    value: Value,
) -> Result<Value, AppError> {
    if entity == "messages" {
        return shared::with_message_create_defaults(value);
    }
    let value = shared::with_entity_defaults(entity, value)?;
    match entity {
        "connections" => connection_secrets::prepare_connection_for_create(state, value),
        "chats" => normalize_chat_for_create(value),
        "chat-folders" => chat_folder_defaults_for_create(value),
        "connection-folders" => connection_folder_defaults_for_create(state, value),
        "gallery" | "character-gallery" | "persona-gallery" | "global-gallery" => {
            gallery_defaults_for_create(state, value)
        }
        _ => Ok(value),
    }
}

#[tauri::command]
pub async fn storage_delete(
    state: State<'_, AppState>,
    entity: String,
    id: String,
    force: Option<bool>,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        delete_entity(&state, &entity, &id, force.unwrap_or(false))
    })
    .await
    .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

#[tauri::command]
pub fn connection_folder_reorder(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> Result<Value, AppError> {
    connection_folder_reorder_inner(&state, ordered_ids)
}

#[tauri::command]
pub fn lorebook_folder_reorder(
    state: State<'_, AppState>,
    lorebook_id: String,
    ordered_ids: Vec<String>,
    parent_folder_id: Option<String>,
) -> Result<Value, AppError> {
    lorebook_folder_reorder_inner(&state, &lorebook_id, ordered_ids, parent_folder_id)
}

#[tauri::command]
pub fn connection_move(
    state: State<'_, AppState>,
    connection_id: String,
    folder_id: Option<String>,
) -> Result<Value, AppError> {
    connection_move_inner(&state, &connection_id, folder_id)
}

#[tauri::command]
pub async fn storage_duplicate(
    state: State<'_, AppState>,
    entity: String,
    id: String,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || duplicate_entity(&state, &entity, &id))
        .await
        .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-entities-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn ids_for_lorebook(state: &AppState, collection: &str, lorebook_id: &str) -> Vec<String> {
        let mut filters = Map::new();
        filters.insert(
            "lorebookId".to_string(),
            Value::String(lorebook_id.to_string()),
        );
        state
            .storage
            .list_where(collection, &filters)
            .expect("collection should be readable")
            .into_iter()
            .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_string))
            .collect()
    }

    fn default_for_agents(state: &AppState, id: &str) -> bool {
        state
            .storage
            .get("connections", id)
            .expect("connection should read")
            .and_then(|row| row.get("defaultForAgents").and_then(Value::as_bool))
            .unwrap_or(false)
    }

    fn create_record(state: &AppState, collection: &str, value: Value) {
        state
            .storage
            .create(collection, value)
            .expect("record should be created");
    }

    fn read_record(state: &AppState, collection: &str, id: &str) -> Value {
        state
            .storage
            .get(collection, id)
            .expect("record should read")
            .expect("record should exist")
    }

    fn create_lorebook(state: &AppState, id: &str) {
        create_record(state, "lorebooks", json!({ "id": id, "name": id }));
    }

    fn create_lorebook_folder(
        state: &AppState,
        id: &str,
        lorebook_id: &str,
        parent_id: Option<&str>,
        order: Option<i64>,
    ) {
        let mut folder = json!({ "id": id, "lorebookId": lorebook_id, "name": id });
        let folder_object = folder
            .as_object_mut()
            .expect("folder fixture should be an object");
        if let Some(parent_id) = parent_id {
            folder_object.insert("parentFolderId".to_string(), json!(parent_id));
        }
        if let Some(order) = order {
            folder_object.insert("order".to_string(), json!(order));
            folder_object.insert("sortOrder".to_string(), json!(order));
        }
        create_record(state, "lorebook-folders", folder);
    }

    fn lorebook_folder(state: &AppState, id: &str) -> Value {
        read_record(state, "lorebook-folders", id)
    }

    fn assert_lorebook_folder_order(state: &AppState, id: &str, order: i64) {
        let folder = lorebook_folder(state, id);
        assert_eq!(folder["order"], json!(order));
        assert_eq!(folder["sortOrder"], json!(order));
    }

    #[test]
    fn storage_create_message_returns_default_extra_and_persists_initial_swipe() {
        let state = test_state("message-create-default-extra");
        let created = storage_create_inner(
            &state,
            "messages".to_string(),
            json!({
                "chatId": "chat-1",
                "role": "assistant",
                "content": "first"
            }),
        )
        .expect("message should create");
        let expected_extra = json!({
            "displayText": null,
            "isGenerated": true,
            "tokenCount": null,
            "generationInfo": null
        });

        assert_eq!(created["activeSwipeIndex"], json!(0));
        assert_eq!(created["swipeCount"], json!(1));
        assert_eq!(created["extra"], expected_extra);
        let sidecars = state
            .storage
            .list(message_swipes::COLLECTION)
            .expect("message swipe sidecars should list");
        assert_eq!(sidecars.len(), 1);
        assert_eq!(sidecars[0]["content"], json!("first"));
        assert_eq!(sidecars[0]["extra"], expected_extra);
    }

    #[test]
    fn storage_create_message_rejects_malformed_extra_before_defaulting() {
        for (label, extra) in [
            ("array-extra", json!([])),
            ("scalar-extra", json!(42)),
            ("invalid-json-extra", json!("{not-json")),
        ] {
            let state = test_state(label);
            let error = storage_create_inner(
                &state,
                "messages".to_string(),
                json!({
                    "chatId": "chat-1",
                    "role": "assistant",
                    "content": "first",
                    "extra": extra
                }),
            )
            .expect_err("malformed message extra should reject");

            assert_eq!(error.code, "invalid_input");
            assert!(
                error
                    .message
                    .contains("extra must be a JSON object or null"),
                "unexpected error message: {}",
                error.message
            );
        }
    }

    #[test]
    fn chat_metadata_patch_rejects_invalid_discord_webhook_url() {
        let state = test_state("chat-metadata-invalid-discord-webhook");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({ "id": "chat-a", "name": "Chat A", "metadata": {} }),
        )
        .expect("chat should seed");

        let error = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "metadata": { "discordWebhookUrl": "not-a-discord-webhook" } }),
        )
        .expect_err("invalid Discord webhook metadata should reject");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("Invalid Discord webhook URL"));
    }

    #[test]
    fn chat_metadata_create_rejects_invalid_discord_webhook_url() {
        let state = test_state("chat-metadata-create-invalid-webhook");

        let error = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "name": "Chat A",
                "metadata": { "discordWebhookUrl": "not-a-discord-webhook" }
            }),
        )
        .expect_err("invalid Discord webhook metadata should reject on create");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("Invalid Discord webhook URL"));
        assert!(
            state
                .storage
                .get("chats", "chat-a")
                .expect("chat lookup should succeed")
                .is_none(),
            "invalid chat metadata should not persist"
        );
    }

    #[test]
    fn chat_metadata_create_normalizes_discord_webhook_url() {
        let state = test_state("chat-metadata-create-normalize-webhook");

        let created = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "name": "Chat A",
                "metadata": {
                    "discordWebhookUrl": "  https://discord.com/api/webhooks/123456789/token_AB-12  ",
                    "theme": "kept"
                }
            }),
        )
        .expect("valid Discord webhook metadata should create");

        assert_eq!(
            created["metadata"]["discordWebhookUrl"],
            json!("https://discord.com/api/webhooks/123456789/token_AB-12")
        );
        assert_eq!(created["metadata"]["theme"], json!("kept"));

        let cleared = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-b",
                "name": "Chat B",
                "metadata": {
                    "discordWebhookUrl": null,
                    "theme": "kept"
                }
            }),
        )
        .expect("null Discord webhook metadata should clear on create");
        assert!(!cleared["metadata"]
            .as_object()
            .expect("metadata should stay an object")
            .contains_key("discordWebhookUrl"));

        let blank = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-c",
                "name": "Chat C",
                "metadata": { "discordWebhookUrl": "   " }
            }),
        )
        .expect("blank Discord webhook metadata should clear on create");
        assert!(!blank["metadata"]
            .as_object()
            .expect("metadata should stay an object")
            .contains_key("discordWebhookUrl"));
    }

    #[test]
    fn chat_metadata_patch_clears_discord_webhook_url() {
        let state = test_state("chat-metadata-patch-clear-webhook");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "name": "Chat A",
                "metadata": {
                    "discordWebhookUrl": "https://discord.com/api/webhooks/123456789/token_AB-12",
                    "theme": "kept"
                }
            }),
        )
        .expect("chat should seed");

        let updated = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "metadata": { "discordWebhookUrl": null } }),
        )
        .expect("null Discord webhook metadata should clear");

        assert!(!updated["metadata"]
            .as_object()
            .expect("metadata should stay an object")
            .contains_key("discordWebhookUrl"));
        assert_eq!(updated["metadata"]["theme"], json!("kept"));

        let restored = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({
                "metadata": {
                    "discordWebhookUrl": " https://discordapp.com/api/webhooks/123456789/token_AB-12 "
                }
            }),
        )
        .expect("valid Discord webhook metadata should update");
        assert_eq!(
            restored["metadata"]["discordWebhookUrl"],
            json!("https://discordapp.com/api/webhooks/123456789/token_AB-12")
        );

        let cleared = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "metadata": { "discordWebhookUrl": "  " } }),
        )
        .expect("blank Discord webhook metadata should clear");
        assert!(!cleared["metadata"]
            .as_object()
            .expect("metadata should stay an object")
            .contains_key("discordWebhookUrl"));
    }

    #[test]
    fn chat_metadata_create_normalizes_inactive_character_ids() {
        let state = test_state("chat-metadata-create-inactive-characters");

        let created = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "name": "Chat A",
                "characterIds": ["char-a", "char-b"],
                "metadata": {
                    "theme": "kept",
                    "inactiveCharacterIds": [" char-a ", "missing", "char-a", "char-b"]
                }
            }),
        )
        .expect("valid inactive character metadata should create");

        assert_eq!(
            created["metadata"]["inactiveCharacterIds"],
            json!(["char-a", "char-b"])
        );
        assert_eq!(created["metadata"]["theme"], json!("kept"));

        let error = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-b",
                "name": "Chat B",
                "characterIds": ["char-a"],
                "metadata": { "inactiveCharacterIds": ["char-a", 3] }
            }),
        )
        .expect_err("non-string inactive character ids should reject on create");

        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn chat_metadata_patch_normalizes_inactive_character_ids() {
        let state = test_state("chat-metadata-inactive-characters");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "name": "Chat A",
                "characterIds": ["char-a", "char-b"],
                "metadata": { "theme": "kept" }
            }),
        )
        .expect("chat should seed");

        let updated = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "metadata": { "inactiveCharacterIds": [" char-a ", "missing", "char-a", "char-b"] } }),
        )
        .expect("valid inactive character metadata should update");

        assert_eq!(
            updated["metadata"]["inactiveCharacterIds"],
            json!(["char-a", "char-b"])
        );
        assert_eq!(updated["metadata"]["theme"], json!("kept"));

        let error = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "metadata": { "inactiveCharacterIds": ["char-a", 3] } }),
        )
        .expect_err("non-string inactive character ids should reject");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn chat_metadata_patch_prunes_stored_inactive_ids_after_character_patch() {
        let state = test_state("chat-character-patch-prunes-inactive");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "name": "Chat A",
                "characterIds": ["char-a", "char-b"],
                "metadata": {
                    "inactiveCharacterIds": ["char-b"],
                    "theme": "kept"
                }
            }),
        )
        .expect("chat should seed");

        let updated = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "characterIds": ["char-a"] }),
        )
        .expect("character-only patch should prune stale inactive ids");

        assert_eq!(updated["characterIds"], json!(["char-a"]));
        assert_eq!(updated["metadata"]["inactiveCharacterIds"], json!([]));
        assert_eq!(updated["metadata"]["theme"], json!("kept"));
    }

    #[test]
    fn chat_metadata_patch_normalizes_inactive_ids_against_patched_character_ids() {
        let state = test_state("chat-metadata-inactive-patched-characters");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "name": "Chat A",
                "characterIds": ["char-a", "char-b"],
                "metadata": {}
            }),
        )
        .expect("chat should seed");

        let updated = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({
                "characterIds": ["char-c"],
                "metadata": { "inactiveCharacterIds": ["char-a", "char-c"] }
            }),
        )
        .expect("same patch should use the patched chat membership");

        assert_eq!(updated["characterIds"], json!(["char-c"]));
        assert_eq!(
            updated["metadata"]["inactiveCharacterIds"],
            json!(["char-c"])
        );
    }

    #[test]
    fn generic_message_content_update_prunes_stale_chat_memories() {
        let state = test_state("generic-message-edit-memory-prune");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-1",
                "name": "Memory chat",
                "memories": [
                    {
                        "id": "keep-before",
                        "messageIds": ["message-before"],
                        "lastMessageAt": "2026-06-01T09:00:00.000Z"
                    },
                    {
                        "id": "drop-edited",
                        "messageIds": ["message-1"],
                        "lastMessageAt": "2026-06-01T10:00:00.000Z"
                    },
                    {
                        "id": "drop-newer",
                        "lastMessageAt": "2026-06-01T10:01:00.000Z"
                    }
                ]
            }),
        )
        .expect("chat should seed");
        storage_create_inner(
            &state,
            "messages".to_string(),
            json!({
                "id": "message-1",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "old visible text",
                "createdAt": "2026-06-01T10:00:00.000Z",
                "swipes": [{ "content": "old visible text" }]
            }),
        )
        .expect("message should seed");

        storage_update_inner(
            &state,
            "messages".to_string(),
            "message-1".to_string(),
            json!({ "content": "new visible text" }),
        )
        .expect("message edit should update");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memory_ids = chat["memories"]
            .as_array()
            .expect("memories should be an array")
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert_eq!(memory_ids, vec!["keep-before"]);
    }

    #[test]
    fn generic_message_content_update_malformed_memories_fail_before_message_write() {
        let state = test_state("generic-message-edit-malformed-preflight");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": "{not valid json"
                }),
            )
            .expect("chat should seed");
        storage_create_inner(
            &state,
            "messages".to_string(),
            json!({
                "id": "message-1",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "old visible text",
                "createdAt": "2026-06-01T10:00:00.000Z",
                "swipes": [{ "content": "old visible text" }]
            }),
        )
        .expect("message should seed");

        let error = storage_update_inner(
            &state,
            "messages".to_string(),
            "message-1".to_string(),
            json!({ "content": "new visible text" }),
        )
        .expect_err("malformed memories should fail before message write");
        let message = state
            .storage
            .get("messages", "message-1")
            .expect("message should read")
            .expect("message should exist");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(message["content"], json!("old visible text"));
    }

    #[test]
    fn generic_message_content_update_rolls_back_when_memory_cleanup_fails() {
        let state = test_state("generic-message-edit-atomic-failure");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "keep-before",
                            "messageIds": ["message-before"],
                            "lastMessageAt": "2026-06-01T09:00:00.000Z"
                        },
                        {
                            "id": "__fail_after_message_mutation__",
                            "messageIds": ["message-before"],
                            "lastMessageAt": "2026-06-01T09:30:00.000Z"
                        },
                        {
                            "id": "drop-edited",
                            "messageIds": ["message-1"],
                            "lastMessageAt": "2026-06-01T10:00:00.000Z"
                        },
                        {
                            "id": "drop-newer",
                            "lastMessageAt": "2026-06-01T10:01:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");
        storage_create_inner(
            &state,
            "messages".to_string(),
            json!({
                "id": "message-1",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "old visible text",
                "createdAt": "2026-06-01T10:00:00.000Z",
                "swipes": [{ "content": "old visible text" }]
            }),
        )
        .expect("message should seed");

        let error = storage_update_inner(
            &state,
            "messages".to_string(),
            "message-1".to_string(),
            json!({ "content": "new visible text" }),
        )
        .expect_err("cleanup failure should abort generic message edit");
        let message = state
            .storage
            .get("messages", "message-1")
            .expect("message should read")
            .expect("message should exist");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memory_ids = chat["memories"]
            .as_array()
            .expect("memories should be an array")
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert_eq!(error.code, "invalid_input");
        assert_eq!(message["content"], json!("old visible text"));
        assert_eq!(
            memory_ids,
            vec![
                "keep-before",
                "__fail_after_message_mutation__",
                "drop-edited",
                "drop-newer"
            ]
        );
    }

    fn seed_linked_character_book(state: &AppState) {
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "character-1",
                    "name": "Mira",
                    "data": {
                        "name": "Mira",
                        "character_book": {
                            "extensions": {
                                "sillytavern": {
                                    "source": "card",
                                    "preserved": true
                                }
                            },
                            "entries": [
                                {
                                    "name": "Old",
                                    "comment": "Old",
                                    "content": "old text",
                                    "keys": ["old"],
                                    "secondary_keys": []
                                }
                            ]
                        },
                        "extensions": {
                            "importMetadata": {
                                "embeddedLorebook": {
                                    "hasEmbeddedLorebook": true,
                                    "lorebookId": "linked-book",
                                    "entriesImported": 1
                                }
                            }
                        }
                    }
                }),
            )
            .expect("character should seed");
        state
            .storage
            .create(
                "lorebooks",
                json!({
                    "id": "linked-book",
                    "name": "Mira Lorebook",
                    "category": "character",
                    "sourceCharacterId": "character-1"
                }),
            )
            .expect("lorebook should seed");
    }

    fn character_book_entries(state: &AppState) -> Vec<Value> {
        state
            .storage
            .get("characters", "character-1")
            .expect("character should read")
            .and_then(|character| {
                character
                    .pointer("/data/character_book/entries")
                    .and_then(Value::as_array)
                    .cloned()
            })
            .unwrap_or_default()
    }

    fn first_character_book_entry(state: &AppState) -> Value {
        character_book_entries(state)
            .into_iter()
            .next()
            .expect("character book should have an entry")
    }

    fn character_book_header(state: &AppState) -> Value {
        let mut book = state
            .storage
            .get("characters", "character-1")
            .expect("character should read")
            .and_then(|character| {
                character
                    .pointer("/data/character_book")
                    .and_then(Value::as_object)
                    .cloned()
            })
            .expect("character book should exist");
        book.remove("entries");
        Value::Object(book)
    }

    fn entry_exists(state: &AppState, id: &str) -> bool {
        state
            .storage
            .get("lorebook-entries", id)
            .expect("entry lookup should not fail")
            .is_some()
    }

    fn cleanup_registered(collection: &str, cleanup: contracts::DeleteCleanup) -> bool {
        contracts::collection_contract(collection)
            .expect("collection should be registered")
            .delete_cleanup
            .contains(&cleanup)
    }

    #[test]
    fn creating_linked_lorebook_entry_syncs_character_book() {
        let state = test_state("linked-character-book-entry-create");
        seed_linked_character_book(&state);

        storage_create_inner(
            &state,
            "lorebook-entries".to_string(),
            json!({
                "lorebookId": "linked-book",
                "name": "Moon",
                "content": "moon text",
                "keys": ["moon"],
                "secondaryKeys": ["silver"],
                "order": 4,
                "position": "after_char"
            }),
        )
        .expect("entry create should sync");

        let entry = first_character_book_entry(&state);
        assert_eq!(entry.get("name").and_then(Value::as_str), Some("Moon"));
        assert_eq!(
            entry.get("content").and_then(Value::as_str),
            Some("moon text")
        );
        assert_eq!(entry["keys"], json!(["moon"]));
        assert_eq!(entry["secondary_keys"], json!(["silver"]));
        assert_eq!(
            entry.get("insertion_order").and_then(Value::as_i64),
            Some(4)
        );
        assert_eq!(
            entry.get("position").and_then(Value::as_str),
            Some("after_char")
        );
    }

    #[test]
    fn numeric_after_char_position_syncs_to_character_book() {
        let state = test_state("linked-character-book-numeric-position");
        seed_linked_character_book(&state);

        storage_create_inner(
            &state,
            "lorebook-entries".to_string(),
            json!({
                "lorebookId": "linked-book",
                "name": "Depth",
                "content": "numeric position",
                "keys": ["depth"],
                "position": 1
            }),
        )
        .expect("entry create should sync numeric position");

        let entry = first_character_book_entry(&state);
        assert_eq!(
            entry.get("position").and_then(Value::as_str),
            Some("after_char")
        );
    }

    #[test]
    fn linked_lorebook_entry_create_is_atomic_when_character_book_sync_fails() {
        let state = test_state("linked-character-book-entry-create-atomic");
        seed_linked_character_book(&state);
        state
            .storage
            .patch(
                "characters",
                "character-1",
                json!({
                    "data": {
                        "name": "Mira",
                        "character_book": "malformed",
                        "extensions": {
                            "importMetadata": {
                                "embeddedLorebook": {
                                    "hasEmbeddedLorebook": true,
                                    "lorebookId": "linked-book",
                                    "entriesImported": 1
                                }
                            }
                        }
                    }
                }),
            )
            .expect("malformed linked character book should seed");

        let error = storage_create_inner(
            &state,
            "lorebook-entries".to_string(),
            json!({
                "id": "entry-atomic",
                "lorebookId": "linked-book",
                "name": "Atomic",
                "content": "should not persist",
                "keys": ["atomic"]
            }),
        )
        .expect_err("malformed linked character book should reject the entry create");

        assert_eq!(error.code, "invalid_input");
        assert!(!entry_exists(&state, "entry-atomic"));
    }

    #[test]
    fn linked_lorebook_metadata_update_is_atomic_when_character_book_sync_fails() {
        let state = test_state("linked-character-book-metadata-update-atomic");
        seed_linked_character_book(&state);
        state
            .storage
            .patch(
                "characters",
                "character-1",
                json!({
                    "data": {
                        "name": "Mira",
                        "character_book": "malformed",
                        "extensions": {
                            "importMetadata": {
                                "embeddedLorebook": {
                                    "hasEmbeddedLorebook": true,
                                    "lorebookId": "linked-book",
                                    "entriesImported": 1
                                }
                            }
                        }
                    }
                }),
            )
            .expect("malformed linked character book should seed");

        let error = storage_update_inner(
            &state,
            "lorebooks".to_string(),
            "linked-book".to_string(),
            json!({
                "name": "Should Roll Back"
            }),
        )
        .expect_err("malformed linked character book should reject the metadata update");

        assert_eq!(error.code, "invalid_input");
        let lorebook = state
            .storage
            .get("lorebooks", "linked-book")
            .expect("lorebook should read")
            .expect("lorebook should still exist");
        assert_eq!(
            lorebook.get("name").and_then(Value::as_str),
            Some("Mira Lorebook")
        );
    }

    #[test]
    fn updating_linked_lorebook_entry_syncs_character_book() {
        let state = test_state("linked-character-book-entry-update");
        seed_linked_character_book(&state);
        storage_create_inner(
            &state,
            "lorebook-entries".to_string(),
            json!({
                "id": "entry-1",
                "lorebookId": "linked-book",
                "name": "Moon",
                "content": "moon text",
                "keys": ["moon"]
            }),
        )
        .expect("entry should seed through create");

        storage_update_inner(
            &state,
            "lorebook-entries".to_string(),
            "entry-1".to_string(),
            json!({
                "name": "Sun",
                "content": "sun text",
                "keys": ["sun"],
                "enabled": false
            }),
        )
        .expect("entry update should sync");

        let entry = first_character_book_entry(&state);
        assert_eq!(entry.get("name").and_then(Value::as_str), Some("Sun"));
        assert_eq!(
            entry.get("content").and_then(Value::as_str),
            Some("sun text")
        );
        assert_eq!(entry["keys"], json!(["sun"]));
        assert_eq!(entry.get("enabled").and_then(Value::as_bool), Some(false));
    }

    #[test]
    fn updating_linked_lorebook_metadata_syncs_character_book_header() {
        let state = test_state("linked-character-book-metadata-update");
        seed_linked_character_book(&state);
        state
            .storage
            .create(
                "lorebook-entries",
                json!({
                    "id": "entry-1",
                    "lorebookId": "linked-book",
                    "name": "Moon",
                    "content": "moon text",
                    "keys": ["moon"]
                }),
            )
            .expect("entry should seed");
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "character-other",
                    "name": "Other",
                    "data": {
                        "name": "Other",
                        "character_book": {
                            "name": "Other Header",
                            "entries": []
                        },
                        "extensions": {
                            "importMetadata": {
                                "embeddedLorebook": {
                                    "hasEmbeddedLorebook": true,
                                    "lorebookId": "other-book",
                                    "entriesImported": 0
                                }
                            }
                        }
                    }
                }),
            )
            .expect("unrelated linked character should seed");

        storage_update_inner(
            &state,
            "lorebooks".to_string(),
            "linked-book".to_string(),
            json!({
                "name": "Updated Mira Lorebook",
                "description": "Fresh linked header",
                "scanDepth": 7,
                "tokenBudget": 333,
                "recursiveScanning": true
            }),
        )
        .expect("lorebook metadata update should sync");

        assert_eq!(
            character_book_header(&state),
            json!({
                "name": "Updated Mira Lorebook",
                "description": "Fresh linked header",
                "scan_depth": 7,
                "token_budget": 333,
                "recursive_scanning": true,
                "extensions": {
                    "sillytavern": {
                        "source": "card",
                        "preserved": true
                    }
                }
            })
        );
        let entry = first_character_book_entry(&state);
        assert_eq!(entry.get("name").and_then(Value::as_str), Some("Moon"));
        assert_eq!(
            entry.get("content").and_then(Value::as_str),
            Some("moon text")
        );
        let other = state
            .storage
            .get("characters", "character-other")
            .expect("other character should read")
            .expect("other character should exist");
        assert_eq!(
            other
                .pointer("/data/character_book/name")
                .and_then(Value::as_str),
            Some("Other Header")
        );
    }

    #[test]
    fn moving_entry_out_of_linked_lorebook_removes_it_from_character_book() {
        let state = test_state("linked-character-book-entry-move");
        seed_linked_character_book(&state);
        state
            .storage
            .create("lorebooks", json!({ "id": "other-book", "name": "Other" }))
            .expect("target lorebook should seed");
        storage_create_inner(
            &state,
            "lorebook-entries".to_string(),
            json!({
                "id": "entry-1",
                "lorebookId": "linked-book",
                "name": "Moon",
                "content": "moon text",
                "keys": ["moon"]
            }),
        )
        .expect("entry should seed through create");

        storage_update_inner(
            &state,
            "lorebook-entries".to_string(),
            "entry-1".to_string(),
            json!({ "lorebookId": "other-book" }),
        )
        .expect("moving entry should sync source lorebook");

        assert!(character_book_entries(&state).is_empty());
    }

    #[test]
    fn deleting_linked_lorebook_entry_syncs_character_book() {
        let state = test_state("linked-character-book-entry-delete");
        seed_linked_character_book(&state);
        storage_create_inner(
            &state,
            "lorebook-entries".to_string(),
            json!({
                "id": "entry-1",
                "lorebookId": "linked-book",
                "name": "Moon",
                "content": "moon text",
                "keys": ["moon"]
            }),
        )
        .expect("entry should seed through create");

        delete_entity(&state, "lorebook-entries", "entry-1", false)
            .expect("entry delete should sync");

        assert!(character_book_entries(&state).is_empty());
    }

    #[test]
    fn generic_storage_commands_reject_unsupported_entities() {
        let state = test_state("unsupported-entity");

        let create_error = storage_create_inner(
            &state,
            "typo-collection".to_string(),
            json!({ "id": "row-1" }),
        )
        .expect_err("unsupported create should be rejected");
        assert_eq!(create_error.code, "invalid_input");
        assert!(create_error
            .message
            .contains("Unsupported storage entity: typo-collection"));
        assert!(!state
            .data_dir
            .join("data")
            .join("collections")
            .join("typo-collection.json")
            .exists());

        storage_list_inner(&state, "typo-collection".to_string(), None)
            .expect_err("unsupported list should be rejected");
        storage_get_inner(
            &state,
            "typo-collection".to_string(),
            "row-1".to_string(),
            None,
        )
        .expect_err("unsupported get should be rejected");
        storage_update_inner(
            &state,
            "typo-collection".to_string(),
            "row-1".to_string(),
            json!({ "name": "Nope" }),
        )
        .expect_err("unsupported update should be rejected");
        delete_entity(&state, "typo-collection", "row-1", false)
            .expect_err("unsupported delete should be rejected");
    }

    #[test]
    fn generic_storage_commands_still_accept_supported_entities() {
        let state = test_state("supported-entity");

        storage_create_inner(
            &state,
            "characters".to_string(),
            json!({ "id": "char-1", "data": { "name": "Rina" } }),
        )
        .expect("supported create should succeed");

        let read = storage_get_inner(&state, "characters".to_string(), "char-1".to_string(), None)
            .expect("supported get should succeed");
        assert_eq!(read["id"], "char-1");
    }

    #[test]
    fn storage_list_where_in_reads_projected_character_rows() {
        let state = test_state("where-in-character-projection");
        state
            .storage
            .replace_all(
                "characters",
                vec![
                    json!({
                        "id": "char-c",
                        "createdAt": "2026-01-03T00:00:00Z",
                        "data": {
                            "name": "Cora",
                            "description": "not requested",
                            "extensions": { "fav": false, "nameColor": "#abcdef" }
                        }
                    }),
                    json!({
                        "id": "char-b",
                        "createdAt": "2026-01-02T00:00:00Z",
                        "data": { "name": "Bex", "extensions": { "fav": true } }
                    }),
                    json!({
                        "id": "char-a",
                        "createdAt": "2026-01-01T00:00:00Z",
                        "avatarPath": "data:image/png;base64,large-avatar",
                        "avatarFilePath": "C:\\Marinara\\avatars\\characters\\char-a.png",
                        "avatarFilename": "char-a.png",
                        "data": {
                            "name": "Ari",
                            "description": "not requested",
                            "extensions": { "fav": true, "nameColor": "#123456" }
                        }
                    }),
                ],
            )
            .expect("characters should seed");

        let result = storage_list_inner(
            &state,
            "characters".to_string(),
            Some(json!({
                "whereIn": {
                    "field": "id",
                    "values": ["char-c", "char-a", "char-a"]
                },
                "fields": ["id", "data", "avatarPath", "avatarFilePath", "avatarFilename", "createdAt"],
                "fieldSelections": { "data": ["name", "extensions.fav"] },
                "orderBy": "id"
            })),
        )
        .expect("whereIn projected list should succeed");

        let rows = result.as_array().expect("storage_list returns an array");
        let ids: Vec<_> = rows
            .iter()
            .filter_map(|row| row.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(ids, vec!["char-a", "char-c"]);
        assert_eq!(
            rows[0],
            json!({
                "id": "char-a",
                "data": {
                    "name": "Ari",
                    "extensions": { "fav": true }
                },
                "avatarFilePath": "C:\\Marinara\\avatars\\characters\\char-a.png",
                "avatarFilename": "char-a.png",
                "createdAt": "2026-01-01T00:00:00Z"
            })
        );
        assert_eq!(
            rows[1],
            json!({
                "id": "char-c",
                "data": {
                    "name": "Cora",
                    "extensions": { "fav": false }
                },
                "createdAt": "2026-01-03T00:00:00Z"
            })
        );
    }

    #[test]
    fn storage_list_where_in_projected_rows_sort_by_unrequested_field() {
        let state = test_state("where-in-character-sort-projection");
        state
            .storage
            .replace_all(
                "characters",
                vec![
                    json!({
                        "id": "char-c",
                        "createdAt": "2026-01-03T00:00:00Z",
                        "data": { "name": "Cora" }
                    }),
                    json!({
                        "id": "char-a",
                        "createdAt": "2026-01-01T00:00:00Z",
                        "data": { "name": "Ari" }
                    }),
                ],
            )
            .expect("characters should seed");

        let explicit_sort = storage_list_inner(
            &state,
            "characters".to_string(),
            Some(json!({
                "whereIn": {
                    "field": "id",
                    "values": ["char-c", "char-a"]
                },
                "fields": ["id"],
                "orderBy": "createdAt"
            })),
        )
        .expect("projected whereIn list should sort by unrequested orderBy field");

        assert_eq!(
            explicit_sort,
            json!([
                { "id": "char-a" },
                { "id": "char-c" }
            ])
        );

        let default_sort = storage_list_inner(
            &state,
            "characters".to_string(),
            Some(json!({
                "whereIn": {
                    "field": "id",
                    "values": ["char-c", "char-a"]
                },
                "fields": ["id"]
            })),
        )
        .expect("projected whereIn list should sort by unrequested default field");

        assert_eq!(default_sort, explicit_sort);
    }

    #[test]
    fn storage_list_where_in_rejects_non_string_values() {
        let state = test_state("where-in-invalid-values");

        let error = storage_list_inner(
            &state,
            "characters".to_string(),
            Some(json!({
                "whereIn": {
                    "field": "id",
                    "values": ["char-a", 42]
                }
            })),
        )
        .expect_err("non-string whereIn values should reject");

        assert_eq!(error.code, "invalid_input");
        assert!(error
            .message
            .contains("storage_list whereIn.values must contain only strings"));
    }

    #[test]
    fn storage_list_where_in_projected_messages_materializes_swipe_summary() {
        let state = test_state("where-in-message-projection-materialization");
        state
            .storage
            .replace_all(
                "messages",
                vec![json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "activeSwipeIndex": 1,
                    "extra": { "hiddenFromAI": true }
                })],
            )
            .expect("message should seed");
        state
            .storage
            .replace_all(
                message_swipes::COLLECTION,
                vec![
                    json!({
                        "id": "message-1::swipe::0",
                        "chatId": "chat-1",
                        "messageId": "message-1",
                        "index": 0,
                        "content": "first sidecar",
                        "extra": { "thinking": "first sidecar thought" }
                    }),
                    json!({
                        "id": "message-1::swipe::1",
                        "chatId": "chat-1",
                        "messageId": "message-1",
                        "index": 1,
                        "content": "active sidecar",
                        "characterId": "character-1",
                        "extra": { "thinking": "active sidecar thought" }
                    }),
                ],
            )
            .expect("sidecar swipes should seed");

        let result = storage_list_inner(
            &state,
            "messages".to_string(),
            Some(json!({
                "whereIn": {
                    "field": "id",
                    "values": ["message-1"]
                },
                "fields": ["extra", "swipeCount", "swipePreviews"],
                "fieldSelections": { "extra": ["hiddenFromAI", "thinking"] }
            })),
        )
        .expect("projected whereIn message list should materialize sidecars");

        assert_eq!(
            result,
            json!([
                {
                    "extra": {
                        "hiddenFromAI": true,
                        "thinking": "active sidecar thought"
                    },
                    "swipeCount": 2,
                    "swipePreviews": [
                        { "content": "first sidecar" },
                        { "content": "active sidecar", "characterId": "character-1" }
                    ]
                }
            ])
        );
    }

    #[test]
    fn lorebook_entries_list_by_lorebook_ids_reads_matching_books_once() {
        let state = test_state("lorebook-entries-where-in");
        state
            .storage
            .replace_all(
                "lorebook-entries",
                vec![
                    json!({ "id": "entry-b", "lorebookId": "book-b", "content": "B", "order": 2 }),
                    json!({ "id": "entry-a", "lorebookId": "book-a", "content": "A", "order": 1 }),
                    json!({ "id": "entry-c", "lorebookId": "book-c", "content": "C", "order": 3 }),
                ],
            )
            .expect("entries should seed");

        let result = lorebook_entries_list_by_lorebook_ids_inner(
            &state,
            vec!["book-b".to_string(), "book-a".to_string()],
        )
        .expect("batched lorebook entries should read");

        let ids: Vec<_> = result
            .as_array()
            .expect("result should be an array")
            .iter()
            .filter_map(|row| row.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(ids, vec!["entry-a", "entry-b"]);
    }

    #[test]
    fn gallery_create_persists_data_url_as_managed_file() {
        let state = test_state("gallery-create-managed-file");
        let image =
            "DaTa:Image/PNG;BaSe64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lTmZsgAAAABJRU5ErkJggg==";

        let created = storage_create_inner(
            &state,
            "gallery".to_string(),
            json!({
                "chatId": "chat-1",
                "filePath": "generated.png",
                "filename": "generated.png",
                "url": image,
                "prompt": "scene",
            }),
        )
        .expect("gallery row should be created");

        let url = created
            .get("url")
            .and_then(Value::as_str)
            .expect("gallery url should be present");
        assert!(
            !url.to_ascii_lowercase().starts_with("data:image/"),
            "gallery rows should not store inline image data"
        );
        let filename = created
            .get("filename")
            .and_then(Value::as_str)
            .expect("managed filename should be present");
        assert!(
            state.data_dir.join("gallery").join(filename).exists(),
            "managed gallery file should exist"
        );
    }

    #[test]
    fn gallery_create_removes_managed_file_when_row_create_fails() {
        let state = test_state("gallery-create-managed-file-rollback");
        let image =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lTmZsgAAAABJRU5ErkJggg==";

        storage_create_inner(
            &state,
            "gallery".to_string(),
            json!({ "id": "image-1", "chatId": "chat-1", "url": "tauri-api:/gallery/existing.png" }),
        )
        .expect("seed gallery row should be created");

        storage_create_inner(
            &state,
            "gallery".to_string(),
            json!({
                "id": "image-1",
                "chatId": "chat-1",
                "filename": "rollback.png",
                "url": image,
            }),
        )
        .expect_err("duplicate gallery row should fail after persisting the image");

        assert!(
            !state.data_dir.join("gallery").join("rollback.png").exists(),
            "failed gallery create should remove the managed file it wrote"
        );
    }

    #[test]
    fn gallery_create_removes_managed_file_when_collection_write_fails() {
        let state = test_state("gallery-create-managed-file-write-rollback");
        let image =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lTmZsgAAAABJRU5ErkJggg==";
        std::fs::create_dir_all(
            state
                .data_dir
                .join("data")
                .join("collections")
                .join("gallery.json"),
        )
        .expect("collection path should be made unwritable as a file");

        storage_create_inner(
            &state,
            "gallery".to_string(),
            json!({
                "chatId": "chat-1",
                "filename": "rollback.png",
                "url": image,
            }),
        )
        .expect_err("gallery collection write should fail after persisting the image");

        assert!(
            !state.data_dir.join("gallery").join("rollback.png").exists(),
            "failed gallery create should remove the managed file it wrote"
        );
    }

    #[test]
    fn generic_storage_mutations_reject_message_swipe_sidecars() {
        let state = test_state("message-swipe-sidecar-generic-mutation");
        state
            .storage
            .replace_all(
                message_swipes::COLLECTION,
                vec![json!({
                    "id": "message-1::swipe::0",
                    "chatId": "chat-1",
                    "messageId": "message-1",
                    "index": 0,
                    "content": "keep sidecar"
                })],
            )
            .expect("sidecar should seed");

        let create_error = storage_create_inner(
            &state,
            message_swipes::COLLECTION.to_string(),
            json!({
                "id": "message-2::swipe::0",
                "chatId": "chat-1",
                "messageId": "message-2",
                "index": 0,
                "content": "raw create"
            }),
        )
        .expect_err("direct sidecar create should be rejected");
        assert_eq!(create_error.code, "invalid_input");
        assert!(create_error.message.contains("internal sidecar storage"));

        let update_error = storage_update_inner(
            &state,
            message_swipes::COLLECTION.to_string(),
            "message-1::swipe::0".to_string(),
            json!({ "content": "raw update" }),
        )
        .expect_err("direct sidecar update should be rejected");
        assert_eq!(update_error.code, "invalid_input");

        let delete_error = delete_entity(
            &state,
            message_swipes::COLLECTION,
            "message-1::swipe::0",
            false,
        )
        .expect_err("direct sidecar delete should be rejected");
        assert_eq!(delete_error.code, "invalid_input");

        let duplicate_error =
            duplicate_entity(&state, message_swipes::COLLECTION, "message-1::swipe::0")
                .expect_err("direct sidecar duplicate should be rejected");
        assert_eq!(duplicate_error.code, "invalid_input");

        let sidecars = state
            .storage
            .list(message_swipes::COLLECTION)
            .expect("sidecars should list");
        assert_eq!(sidecars.len(), 1);
        assert_eq!(sidecars[0]["content"], "keep sidecar");
    }

    #[test]
    fn generic_message_create_normalizes_parent_contract_fields() {
        let state = test_state("message-create-normalizes-parent-fields");

        storage_create_inner(
            &state,
            "messages".to_string(),
            json!({
                "id": "message-1",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "first",
                "images": "[]",
                "attachments": "[]",
                "extra": "{\"thinking\":\"parent thought\"}",
                "swipes": [{
                    "content": "first",
                    "extra": "{\"thinking\":\"swipe thought\"}"
                }]
            }),
        )
        .expect("message create should normalize parent fields");

        let stored = state
            .storage
            .get("messages", "message-1")
            .expect("message lookup should not fail")
            .expect("message should be stored");
        assert_eq!(stored["images"], json!([]));
        assert_eq!(stored["attachments"], json!([]));
        assert_eq!(stored["extra"], json!({}));
        assert!(stored.get("swipes").is_none());

        let sidecars = message_swipes::swipes_for_message(&state, "message-1")
            .expect("message sidecars should read");
        assert_eq!(sidecars.len(), 1);
        assert_eq!(
            sidecars[0]["extra"],
            json!({
                "displayText": null,
                "isGenerated": true,
                "tokenCount": null,
                "generationInfo": null,
                "thinking": "parent thought"
            })
        );
    }

    #[test]
    fn generic_storage_duplicate_rejects_unsupported_entities() {
        let state = test_state("unsupported-duplicate-entity");

        let error = duplicate_entity(&state, "typo-collection", "row-1")
            .expect_err("unsupported duplicate should be rejected");

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

    #[test]
    fn duplicating_active_persona_resets_active_flags() {
        let state = test_state("persona-duplicate-active-flags");
        storage_create_inner(
            &state,
            "personas".to_string(),
            json!({
                "id": "active-persona",
                "name": "Active Persona",
                "isActive": true,
                "active": true
            }),
        )
        .expect("persona should be created");

        let duplicated = duplicate_entity(&state, "personas", "active-persona")
            .expect("persona duplicate should succeed");

        assert_ne!(duplicated["id"], "active-persona");
        assert_eq!(duplicated["name"], "Active Persona Copy");
        assert_eq!(duplicated["isActive"], false);
        assert_eq!(duplicated["active"], false);

        let original = state
            .storage
            .get("personas", "active-persona")
            .expect("original persona should read")
            .expect("original persona should still exist");
        assert_eq!(original["isActive"], true);
        assert_eq!(original["active"], true);
    }

    #[test]
    fn duplicating_inactive_persona_keeps_duplicate_inactive() {
        let state = test_state("persona-duplicate-inactive-flags");
        storage_create_inner(
            &state,
            "personas".to_string(),
            json!({
                "id": "inactive-persona",
                "name": "Inactive Persona",
                "isActive": false,
                "active": false
            }),
        )
        .expect("persona should be created");

        let duplicated = duplicate_entity(&state, "personas", "inactive-persona")
            .expect("persona duplicate should succeed");

        assert_eq!(duplicated["name"], "Inactive Persona Copy");
        assert_eq!(duplicated["isActive"], false);
        assert_eq!(duplicated["active"], false);
    }

    #[test]
    fn deleting_character_removes_character_gallery_records_and_managed_files() {
        let state = test_state("character-gallery-delete");
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "character-1",
                    "data": { "name": "Gallery Character" }
                }),
            )
            .expect("character should be created");
        let gallery_dir = state.data_dir.join("gallery");
        std::fs::create_dir_all(&gallery_dir).expect("gallery dir should be created");
        let image_path = gallery_dir.join("character.png");
        std::fs::write(&image_path, b"managed").expect("managed image should be written");
        state
            .storage
            .create(
                "character-gallery",
                json!({
                    "id": "character-image-1",
                    "characterId": "character-1",
                    "filePath": "character.png",
                    "filename": "character.png",
                    "url": "data:image/png;base64,bWFuYWdlZA=="
                }),
            )
            .expect("character gallery row should be created");

        delete_entity(&state, "characters", "character-1", false)
            .expect("character delete should succeed");

        let mut filters = Map::new();
        filters.insert(
            "characterId".to_string(),
            Value::String("character-1".to_string()),
        );
        assert!(
            state
                .storage
                .list_where("character-gallery", &filters)
                .expect("character gallery should be readable")
                .is_empty(),
            "character gallery rows should be removed"
        );
        assert!(
            !image_path.exists(),
            "managed gallery file should be removed"
        );
    }

    #[test]
    fn deleting_persona_removes_persona_gallery_records_and_managed_files() {
        let state = test_state("persona-gallery-delete");
        state
            .storage
            .create(
                "personas",
                json!({
                    "id": "persona-1",
                    "data": { "name": "Gallery Persona" }
                }),
            )
            .expect("persona should be created");
        let gallery_dir = state.data_dir.join("gallery");
        std::fs::create_dir_all(&gallery_dir).expect("gallery dir should be created");
        let image_path = gallery_dir.join("persona.png");
        std::fs::write(&image_path, b"managed").expect("managed image should be written");
        state
            .storage
            .create(
                "persona-gallery",
                json!({
                    "id": "persona-image-1",
                    "personaId": "persona-1",
                    "filePath": "persona.png",
                    "filename": "persona.png",
                    "url": "data:image/png;base64,bWFuYWdlZA=="
                }),
            )
            .expect("persona gallery row should be created");

        delete_entity(&state, "personas", "persona-1", false)
            .expect("persona delete should succeed");

        let mut filters = Map::new();
        filters.insert(
            "personaId".to_string(),
            Value::String("persona-1".to_string()),
        );
        assert!(
            state
                .storage
                .list_where("persona-gallery", &filters)
                .expect("persona gallery should be readable")
                .is_empty(),
            "persona gallery rows should be removed"
        );
        assert!(
            !image_path.exists(),
            "managed gallery file should be removed"
        );
    }

    #[test]
    fn deleting_gallery_folder_unfiles_its_images() {
        let state = test_state("gallery-folder-unfile");
        state
            .storage
            .create(
                "gallery-folders",
                json!({ "id": "folder-1", "name": "Reactions" }),
            )
            .expect("gallery folder should be created");
        for id in ["image-1", "image-2"] {
            state
                .storage
                .create(
                    "global-gallery",
                    json!({ "id": id, "folderId": "folder-1", "filePath": "x.png", "filename": "x.png" }),
                )
                .expect("global gallery row should be created");
        }

        delete_entity(&state, "gallery-folders", "folder-1", false)
            .expect("gallery folder delete should succeed");

        let mut folder_filters = Map::new();
        folder_filters.insert("id".to_string(), Value::String("folder-1".to_string()));
        assert!(
            state
                .storage
                .list_where("gallery-folders", &folder_filters)
                .expect("gallery folders should be readable")
                .is_empty(),
            "deleted folder row should be gone"
        );

        let images = state
            .storage
            .list("global-gallery")
            .expect("images should be readable");
        assert_eq!(images.len(), 2, "images must survive folder deletion");
        for image in &images {
            assert_eq!(
                image.get("folderId"),
                Some(&Value::Null),
                "image should be re-filed to the root level"
            );
        }
    }

    #[test]
    fn deleting_chat_reports_cascade_deleted_chat_ids() {
        let state = test_state("chat-delete-ids");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "origin-chat",
                    "name": "Origin",
                    "metadata": { "activeSceneChatId": "scene-chat" }
                }),
            )
            .expect("origin chat should be created");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "scene-chat",
                    "name": "Scene",
                    "metadata": { "sceneOriginChatId": "origin-chat" }
                }),
            )
            .expect("scene chat should be created");

        let result = delete_entity(&state, "chats", "origin-chat", false)
            .expect("chat delete should succeed");
        let deleted_chat_ids: Vec<&str> = result["deletedChatIds"]
            .as_array()
            .expect("deleted chat ids should be returned")
            .iter()
            .map(|id| id.as_str().expect("deleted chat id should be a string"))
            .collect();

        assert_eq!(result.get("deleted").and_then(Value::as_bool), Some(true));
        assert_eq!(deleted_chat_ids, vec!["origin-chat", "scene-chat"]);
        assert!(state.storage.get("chats", "origin-chat").unwrap().is_none());
        assert!(state.storage.get("chats", "scene-chat").unwrap().is_none());
    }

    #[test]
    fn deleting_lorebook_cascades_entries_and_folders_only_for_that_lorebook() {
        let state = test_state("lorebook-delete-cascade");
        state
            .storage
            .create(
                "lorebooks",
                json!({ "id": "book-delete", "name": "Delete me" }),
            )
            .expect("lorebook should be created");
        state
            .storage
            .create("lorebooks", json!({ "id": "book-keep", "name": "Keep me" }))
            .expect("other lorebook should be created");
        state
            .storage
            .create(
                "lorebook-entries",
                json!({ "id": "entry-delete", "lorebookId": "book-delete", "name": "Delete", "content": "x" }),
            )
            .expect("entry should be created");
        state
            .storage
            .create(
                "lorebook-folders",
                json!({ "id": "folder-delete", "lorebookId": "book-delete", "name": "Delete" }),
            )
            .expect("folder should be created");
        state
            .storage
            .create(
                "lorebook-entries",
                json!({ "id": "entry-keep", "lorebookId": "book-keep", "name": "Keep", "content": "x" }),
            )
            .expect("other entry should be created");
        state
            .storage
            .create(
                "lorebook-folders",
                json!({ "id": "folder-keep", "lorebookId": "book-keep", "name": "Keep" }),
            )
            .expect("other folder should be created");

        let result = delete_entity(&state, "lorebooks", "book-delete", false)
            .expect("delete should succeed");

        assert_eq!(result.get("deleted").and_then(Value::as_bool), Some(true));
        assert!(ids_for_lorebook(&state, "lorebook-entries", "book-delete").is_empty());
        assert!(ids_for_lorebook(&state, "lorebook-folders", "book-delete").is_empty());
        assert_eq!(
            ids_for_lorebook(&state, "lorebook-entries", "book-keep"),
            vec!["entry-keep".to_string()]
        );
        assert_eq!(
            ids_for_lorebook(&state, "lorebook-folders", "book-keep"),
            vec!["folder-keep".to_string()]
        );
    }

    #[test]
    fn deleting_lorebook_folder_reparents_entries_with_matching_folder_id() {
        let state = test_state("lorebook-folder-delete-reparent");
        create_lorebook(&state, "book-delete");
        create_lorebook(&state, "book-keep");
        create_lorebook_folder(&state, "folder-delete", "book-delete", None, None);
        create_record(
            &state,
            "lorebook-entries",
            json!({ "id": "entry-reparent", "lorebookId": "book-delete", "folderId": "folder-delete", "name": "Reparent", "content": "x" }),
        );
        create_record(
            &state,
            "lorebook-entries",
            json!({ "id": "entry-stale-cross-lorebook", "lorebookId": "book-keep", "folderId": "folder-delete", "name": "Stale", "content": "x" }),
        );
        create_record(
            &state,
            "lorebook-entries",
            json!({ "id": "entry-other-folder", "lorebookId": "book-keep", "folderId": "folder-keep", "name": "Other", "content": "x" }),
        );

        delete_entity(&state, "lorebook-folders", "folder-delete", false)
            .expect("folder delete should succeed");

        let reparented = read_record(&state, "lorebook-entries", "entry-reparent");
        assert!(reparented.get("folderId").is_none_or(Value::is_null));
        let stale = read_record(&state, "lorebook-entries", "entry-stale-cross-lorebook");
        assert!(stale.get("folderId").is_none_or(Value::is_null));
        let other_folder = read_record(&state, "lorebook-entries", "entry-other-folder");
        assert_eq!(other_folder["folderId"], "folder-keep");
    }

    #[test]
    fn deleting_lorebook_folder_reparents_child_folders_to_root() {
        let state = test_state("lorebook-folder-delete-reparent-children");
        create_lorebook(&state, "book");
        create_lorebook_folder(&state, "parent", "book", None, None);
        create_lorebook_folder(&state, "child", "book", Some("parent"), None);
        create_lorebook_folder(&state, "unrelated", "book", Some("other"), None);

        delete_entity(&state, "lorebook-folders", "parent", false)
            .expect("folder delete should succeed");

        assert!(state
            .storage
            .get("lorebook-folders", "parent")
            .expect("parent should read")
            .is_none());
        let child = lorebook_folder(&state, "child");
        assert!(child.get("parentFolderId").is_none_or(Value::is_null));
        let unrelated = lorebook_folder(&state, "unrelated");
        assert_eq!(unrelated["parentFolderId"], "other");
    }

    #[test]
    fn lorebook_folder_reparent_rejects_cycle_and_cross_lorebook() {
        let state = test_state("lorebook-folder-reparent-validation");
        create_lorebook(&state, "book");
        create_lorebook(&state, "other");
        create_lorebook_folder(&state, "a", "book", None, None);
        create_lorebook_folder(&state, "b", "book", Some("a"), None);
        create_lorebook_folder(&state, "c", "other", None, None);

        assert!(
            storage_update_inner(
                &state,
                "lorebook-folders".to_string(),
                "a".to_string(),
                json!({ "parentFolderId": "b" }),
            )
            .is_err(),
            "nesting a folder under its own descendant should be rejected"
        );

        assert!(
            storage_update_inner(
                &state,
                "lorebook-folders".to_string(),
                "a".to_string(),
                json!({ "parentFolderId": "c" }),
            )
            .is_err(),
            "nesting under a folder in another lorebook should be rejected"
        );

        assert!(
            storage_update_inner(
                &state,
                "lorebook-folders".to_string(),
                "b".to_string(),
                json!({ "lorebookId": "other" }),
            )
            .is_err(),
            "changing a child folder's lorebookId should be rejected"
        );

        assert!(
            storage_update_inner(
                &state,
                "lorebook-folders".to_string(),
                "a".to_string(),
                json!({ "lorebookId": "other" }),
            )
            .is_err(),
            "changing a root folder's lorebookId would strand its children and must be rejected"
        );

        assert!(
            storage_update_inner(
                &state,
                "lorebook-folders".to_string(),
                "b".to_string(),
                json!({ "parentFolderId": null }),
            )
            .is_ok(),
            "moving a folder to the root should be allowed"
        );
    }

    #[test]
    fn lorebook_folder_create_requires_child_ownership_for_parent() {
        let state = test_state("lorebook-folder-create-parent-ownership");
        create_lorebook(&state, "book");
        create_lorebook(&state, "other");
        create_lorebook_folder(&state, "parent", "book", None, None);

        assert!(
            storage_create_inner(
                &state,
                "lorebook-folders".to_string(),
                json!({ "id": "missing-book", "name": "Missing", "parentFolderId": "parent" }),
            )
            .is_err(),
            "a nested folder without lorebookId cannot prove parent ownership"
        );

        assert!(
            storage_create_inner(
                &state,
                "lorebook-folders".to_string(),
                json!({
                    "id": "blank-book",
                    "name": "Blank",
                    "lorebookId": "   ",
                    "parentFolderId": "parent"
                }),
            )
            .is_err(),
            "a nested folder with blank lorebookId cannot prove parent ownership"
        );

        assert!(
            storage_create_inner(
                &state,
                "lorebook-folders".to_string(),
                json!({
                    "id": "other-book",
                    "name": "Other",
                    "lorebookId": "other",
                    "parentFolderId": "parent"
                }),
            )
            .is_err(),
            "a nested folder cannot use a parent from another lorebook"
        );

        let created = storage_create_inner(
            &state,
            "lorebook-folders".to_string(),
            json!({
                "id": "child",
                "name": "Child",
                "lorebookId": "book",
                "parentFolderId": "parent"
            }),
        )
        .expect("matching child ownership should allow nested create");
        assert_eq!(created["parentFolderId"], "parent");
        assert_eq!(created["lorebookId"], "book");
    }

    #[test]
    fn lorebook_folder_reorder_rejects_invalid_batch_without_partial_writes() {
        let state = test_state("lorebook-folder-reorder-atomic-validation");
        create_lorebook(&state, "book");
        create_lorebook(&state, "other");
        create_lorebook_folder(&state, "folder-a", "book", None, Some(0));
        create_lorebook_folder(&state, "folder-b", "book", None, Some(1));
        create_lorebook_folder(&state, "foreign", "other", None, Some(0));

        let error = lorebook_folder_reorder_inner(
            &state,
            "book",
            vec![
                "folder-b".to_string(),
                "folder-a".to_string(),
                "foreign".to_string(),
            ],
            None,
        )
        .expect_err("cross-lorebook batch member should reject the reorder");
        assert_eq!(error.code, "invalid_input");
        assert_lorebook_folder_order(&state, "folder-a", 0);
        assert_lorebook_folder_order(&state, "folder-b", 1);

        lorebook_folder_reorder_inner(
            &state,
            "book",
            vec!["folder-b".to_string(), "folder-a".to_string()],
            None,
        )
        .expect("valid same-lorebook batch should reorder folders");
        assert_lorebook_folder_order(&state, "folder-b", 0);
        assert_lorebook_folder_order(&state, "folder-a", 1);
    }

    #[test]
    fn lorebook_folder_reorder_renumbers_source_and_destination_groups() {
        let state = test_state("lorebook-folder-reorder-source-destination-groups");
        create_lorebook(&state, "book");
        for (id, order) in [
            ("folder-a", 0),
            ("folder-b", 1),
            ("folder-c", 2),
            ("parent", 3),
        ] {
            create_lorebook_folder(&state, id, "book", None, Some(order));
        }
        create_lorebook_folder(&state, "child-a", "book", Some("parent"), Some(0));

        lorebook_folder_reorder_inner(
            &state,
            "book",
            vec!["child-a".to_string(), "folder-b".to_string()],
            Some("parent".to_string()),
        )
        .expect("cross-parent reorder should update both sibling groups");

        assert_lorebook_folder_order(&state, "folder-a", 0);
        assert_lorebook_folder_order(&state, "folder-c", 1);
        assert_lorebook_folder_order(&state, "parent", 2);
        assert_lorebook_folder_order(&state, "child-a", 0);
        assert_lorebook_folder_order(&state, "folder-b", 1);
        assert_eq!(
            lorebook_folder(&state, "folder-b")["parentFolderId"],
            "parent"
        );
    }

    #[test]
    fn deleting_lorebook_folder_reparent_rolls_back_when_character_book_sync_fails() {
        let state = test_state("lorebook-folder-delete-reparent-atomic");
        seed_linked_character_book(&state);
        create_lorebook_folder(&state, "folder-linked", "linked-book", None, None);
        storage_create_inner(
            &state,
            "lorebook-entries".to_string(),
            json!({
                "id": "entry-linked",
                "lorebookId": "linked-book",
                "folderId": "folder-linked",
                "name": "Linked",
                "content": "linked text",
                "keys": ["linked"]
            }),
        )
        .expect("entry should seed through sync path");
        state
            .storage
            .patch(
                "characters",
                "character-1",
                json!({
                    "data": {
                        "name": "Mira",
                        "character_book": "malformed",
                        "extensions": {
                            "importMetadata": {
                                "embeddedLorebook": {
                                    "hasEmbeddedLorebook": true,
                                    "lorebookId": "linked-book",
                                    "entriesImported": 1
                                }
                            }
                        }
                    }
                }),
            )
            .expect("malformed linked character book should seed");

        let error = delete_entity(&state, "lorebook-folders", "folder-linked", false)
            .expect_err("malformed linked character book should reject folder delete");

        assert_eq!(error.code, "invalid_input");
        assert!(state
            .storage
            .get("lorebook-folders", "folder-linked")
            .expect("folder should read")
            .is_some());
        let entry = read_record(&state, "lorebook-entries", "entry-linked");
        assert_eq!(entry["folderId"], "folder-linked");
    }

    #[test]
    fn deleting_lorebook_clears_chat_and_embedded_character_refs() {
        let state = test_state("lorebook-delete-refs");
        state
            .storage
            .create(
                "lorebooks",
                json!({ "id": "book-delete", "name": "Delete me" }),
            )
            .expect("lorebook should be created");
        state
            .storage
            .create("lorebooks", json!({ "id": "book-keep", "name": "Keep me" }))
            .expect("other lorebook should be created");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Chat",
                    "activeLorebookIds": ["book-delete", "book-keep"],
                    "metadata": { "activeLorebookIds": ["book-delete", "book-keep"] }
                }),
            )
            .expect("chat should be created");
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-1",
                    "data": {
                        "name": "Character",
                        "character_book": { "entries": [{ "content": "legacy" }] },
                        "extensions": {
                            "importMetadata": {
                                "embeddedLorebook": {
                                    "hasEmbeddedLorebook": true,
                                    "lorebookId": "book-delete"
                                }
                            }
                        }
                    }
                }),
            )
            .expect("character should be created");

        delete_entity(&state, "lorebooks", "book-delete", false).expect("delete should succeed");

        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should remain");
        assert_eq!(chat["activeLorebookIds"], json!(["book-keep"]));
        assert_eq!(chat["metadata"]["activeLorebookIds"], json!(["book-keep"]));

        let character = state
            .storage
            .get("characters", "char-1")
            .expect("character should read")
            .expect("character should remain");
        assert!(character["data"]["character_book"].is_null());
        assert!(character
            .pointer("/data/extensions/importMetadata/embeddedLorebook")
            .is_none());
    }

    #[test]
    fn deleting_prompt_uses_registered_child_cleanup() {
        assert!(cleanup_registered(
            "prompts",
            contracts::DeleteCleanup::DeletePromptChildren
        ));
        let state = test_state("prompt-delete-children");
        state
            .storage
            .create(
                "prompts",
                json!({ "id": "prompt-delete", "name": "Delete me" }),
            )
            .expect("prompt should be created");
        state
            .storage
            .create("prompts", json!({ "id": "prompt-keep", "name": "Keep me" }))
            .expect("other prompt should be created");
        for (collection, delete_id, keep_id) in [
            ("prompt-groups", "group-delete", "group-keep"),
            ("prompt-sections", "section-delete", "section-keep"),
            ("prompt-variables", "variable-delete", "variable-keep"),
        ] {
            state
                .storage
                .create(
                    collection,
                    json!({ "id": delete_id, "presetId": "prompt-delete", "name": "Delete" }),
                )
                .expect("prompt child should be created");
            state
                .storage
                .create(
                    collection,
                    json!({ "id": keep_id, "presetId": "prompt-keep", "name": "Keep" }),
                )
                .expect("other prompt child should be created");
        }

        delete_entity(&state, "prompts", "prompt-delete", false).expect("delete should succeed");

        for (collection, keep_id) in [
            ("prompt-groups", "group-keep"),
            ("prompt-sections", "section-keep"),
            ("prompt-variables", "variable-keep"),
        ] {
            let mut delete_filters = Map::new();
            delete_filters.insert(
                "presetId".to_string(),
                Value::String("prompt-delete".to_string()),
            );
            assert!(
                state
                    .storage
                    .list_where(collection, &delete_filters)
                    .expect("prompt child collection should be readable")
                    .is_empty(),
                "{collection} rows for deleted prompt should be removed"
            );
            assert!(state
                .storage
                .get(collection, keep_id)
                .expect("kept prompt child should read")
                .is_some());
        }
    }

    #[test]
    fn deleting_active_chat_preset_uses_registered_default_activation() {
        assert!(cleanup_registered(
            "chat-presets",
            contracts::DeleteCleanup::ActivateDefaultChatPreset
        ));
        let state = test_state("chat-preset-delete-activate-default");
        state
            .storage
            .patch(
                "chat-presets",
                "default-chat-preset-roleplay",
                json!({ "isActive": false, "active": false }),
            )
            .expect("seeded default preset should be deactivated");
        state
            .storage
            .create(
                "chat-presets",
                json!({
                    "id": "custom-roleplay",
                    "name": "Custom Roleplay",
                    "mode": "roleplay",
                    "isDefault": false,
                    "default": false,
                    "isActive": true,
                    "active": true
                }),
            )
            .expect("active preset should be created");

        delete_entity(&state, "chat-presets", "custom-roleplay", false)
            .expect("active preset delete should succeed");

        let default = state
            .storage
            .get("chat-presets", "default-chat-preset-roleplay")
            .expect("default preset should read")
            .expect("default preset should remain");
        assert_eq!(default["isActive"], json!(true));
        assert_eq!(default["active"], json!(true));
    }

    #[test]
    fn deleting_gallery_row_uses_registered_managed_media_cleanup() {
        assert!(cleanup_registered(
            "gallery",
            contracts::DeleteCleanup::RemoveOwnedMedia
        ));
        let state = test_state("gallery-delete-managed-file");
        let gallery_dir = state.data_dir.join("gallery");
        std::fs::create_dir_all(&gallery_dir).expect("gallery dir should be created");
        let image_path = gallery_dir.join("gallery.png");
        std::fs::write(&image_path, b"managed").expect("managed image should be written");
        state
            .storage
            .create(
                "gallery",
                json!({
                    "id": "gallery-image",
                    "chatId": "chat-1",
                    "filePath": "gallery.png",
                    "filename": "gallery.png",
                    "url": "tauri-api:/gallery/gallery.png"
                }),
            )
            .expect("gallery row should be created");

        delete_entity(&state, "gallery", "gallery-image", false).expect("delete should succeed");

        assert!(
            !image_path.exists(),
            "managed gallery file should be removed"
        );
    }

    #[test]
    fn deleting_character_version_removes_owned_avatar_copy() {
        assert!(cleanup_registered(
            "character-versions",
            contracts::DeleteCleanup::RemoveOwnedMedia
        ));
        let state = test_state("character-version-delete-managed-avatar");
        let avatar_dir = state.data_dir.join("avatars").join("characters");
        std::fs::create_dir_all(&avatar_dir).expect("avatar dir should be created");
        let avatar_path = avatar_dir.join("version.png");
        std::fs::write(&avatar_path, b"managed").expect("version avatar should be written");
        state
            .storage
            .create(
                "character-versions",
                json!({
                    "id": "version-1",
                    "characterId": "char-1",
                    "avatarPath": "http://asset.localhost/version.png",
                    "avatarFilePath": avatar_path.to_string_lossy().to_string(),
                    "avatarFilename": "version.png"
                }),
            )
            .expect("version row should be created");

        delete_entity(&state, "character-versions", "version-1", false)
            .expect("version delete should succeed");

        assert!(
            !avatar_path.exists(),
            "deleted version should remove its owned avatar copy"
        );
    }

    #[test]
    fn deleting_character_removes_its_sprite_directory() {
        let state = test_state("character-delete-sprites");
        let sprite_dir = state.data_dir.join("sprites").join("char-1");
        std::fs::create_dir_all(&sprite_dir).expect("sprite dir should be created");
        std::fs::write(sprite_dir.join("neutral.png"), b"sprite")
            .expect("sprite should be written");
        state
            .storage
            .create("characters", json!({ "id": "char-1" }))
            .expect("character row should be created");

        delete_entity(&state, "characters", "char-1", false)
            .expect("character delete should succeed");

        assert!(
            !sprite_dir.exists(),
            "deleted character should remove its sprite directory"
        );
    }

    #[test]
    fn deleting_persona_removes_its_sprite_directory() {
        let state = test_state("persona-delete-sprites");
        let sprite_dir = state
            .data_dir
            .join("sprites")
            .join("personas")
            .join("persona-1");
        std::fs::create_dir_all(&sprite_dir).expect("persona sprite dir should be created");
        std::fs::write(sprite_dir.join("happy.png"), b"sprite").expect("sprite should be written");
        state
            .storage
            .create("personas", json!({ "id": "persona-1" }))
            .expect("persona row should be created");

        delete_entity(&state, "personas", "persona-1", false)
            .expect("persona delete should succeed");

        assert!(
            !sprite_dir.exists(),
            "deleted persona should remove its sprite directory"
        );
    }

    #[test]
    fn deleting_persona_removes_namespaced_sprites_and_leaves_legacy_dir() {
        // When both a legacy sprites/<id> and the namespaced sprites/personas/<id> exist, deleting
        // the persona must still remove the namespaced dir (no dependence on legacy migration) and
        // must NOT touch the legacy path, which can belong to a same-id character.
        let state = test_state("persona-delete-sprites-conflict");
        let legacy_dir = state.data_dir.join("sprites").join("persona-1");
        let namespaced_dir = state
            .data_dir
            .join("sprites")
            .join("personas")
            .join("persona-1");
        std::fs::create_dir_all(&legacy_dir).expect("legacy sprite dir should be created");
        std::fs::write(legacy_dir.join("happy.png"), b"legacy")
            .expect("legacy sprite should write");
        std::fs::create_dir_all(&namespaced_dir).expect("namespaced sprite dir should be created");
        std::fs::write(namespaced_dir.join("happy.png"), b"namespaced")
            .expect("sprite should write");
        state
            .storage
            .create("personas", json!({ "id": "persona-1" }))
            .expect("persona row should be created");

        delete_entity(&state, "personas", "persona-1", false)
            .expect("persona delete should succeed");

        assert!(
            !namespaced_dir.exists(),
            "deleted persona should remove its namespaced sprite directory even with a legacy dir present"
        );
        assert!(
            legacy_dir.exists(),
            "deleted persona must not remove the legacy sprite path (it can belong to a same-id character)"
        );
    }

    #[test]
    fn deleting_character_version_preserves_avatar_still_used_by_character() {
        let state = test_state("character-version-delete-live-avatar");
        let avatar_dir = state.data_dir.join("avatars").join("characters");
        std::fs::create_dir_all(&avatar_dir).expect("avatar dir should be created");
        let avatar_path = avatar_dir.join("shared.png");
        std::fs::write(&avatar_path, b"managed").expect("shared avatar should be written");
        let avatar_path_string = avatar_path.to_string_lossy().to_string();
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-1",
                    "avatarPath": "http://asset.localhost/shared.png",
                    "avatarFilePath": avatar_path_string,
                    "avatarFilename": "shared.png"
                }),
            )
            .expect("character row should be created");
        state
            .storage
            .create(
                "character-versions",
                json!({
                    "id": "version-1",
                    "characterId": "char-1",
                    "avatarPath": "http://asset.localhost/shared.png",
                    "avatarFilePath": avatar_path.to_string_lossy().to_string(),
                    "avatarFilename": "shared.png"
                }),
            )
            .expect("version row should be created");

        delete_entity(&state, "character-versions", "version-1", false)
            .expect("version delete should succeed");

        assert!(
            avatar_path.exists(),
            "version delete must not remove an avatar still used by the live character"
        );
    }

    #[test]
    fn deleting_message_uses_registered_tracker_snapshot_cleanup() {
        assert!(cleanup_registered(
            "messages",
            contracts::DeleteCleanup::DeleteMessageTrackerSnapshots
        ));
        let state = test_state("message-delete-tracker-snapshots");
        state
            .storage
            .create("chats", json!({ "id": "chat-1", "name": "Chat" }))
            .expect("chat should be created");
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "role": "assistant",
                    "content": "tracked"
                }),
            )
            .expect("message should be created");
        game_state_snapshots::save_tracker_snapshot(
            &state,
            "chat-1",
            json!({
                "messageId": "message-1",
                "location": "Harbor"
            }),
        )
        .expect("tracker snapshot should save");

        delete_entity(&state, "messages", "message-1", false).expect("delete should succeed");

        let mut filters = Map::new();
        filters.insert("chatId".to_string(), Value::String("chat-1".to_string()));
        filters.insert(
            "messageId".to_string(),
            Value::String("message-1".to_string()),
        );
        assert!(state
            .storage
            .list_where("game-state-snapshots", &filters)
            .expect("snapshots should be readable")
            .is_empty());
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should remain");
        assert!(chat["gameState"].is_null());
    }

    #[test]
    fn deleting_message_prunes_overlapping_chat_memories() {
        let state = test_state("message-delete-memory-prune");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory delete chat",
                    "memories": [
                        {
                            "id": "keep-older",
                            "messageIds": ["message-old"],
                            "lastMessageAt": "2026-01-01T00:00:00.000Z"
                        },
                        {
                            "id": "drop-by-id",
                            "messageIds": ["message-delete"],
                            "lastMessageAt": "2026-01-02T00:00:00.000Z"
                        },
                        {
                            "id": "drop-later-window",
                            "messageIds": ["message-later"],
                            "lastMessageAt": "2026-01-03T00:00:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should be created");
        for (id, created_at) in [
            ("message-old", "2026-01-01T00:00:00.000Z"),
            ("message-delete", "2026-01-02T00:00:00.000Z"),
            ("message-later", "2026-01-03T00:00:00.000Z"),
        ] {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": id,
                        "chatId": "chat-1",
                        "role": "assistant",
                        "content": id,
                        "createdAt": created_at
                    }),
                )
                .expect("message should be created");
        }

        delete_entity(&state, "messages", "message-delete", false)
            .expect("message delete should prune memory recall");

        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should remain");
        let memory_ids = chat["memories"]
            .as_array()
            .expect("memories should stay an array")
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(memory_ids, vec!["keep-older"]);
    }

    #[test]
    fn deleting_message_prunes_created_at_only_chat_memories() {
        let state = test_state("message-delete-created-at-memory-prune");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Created-at memory delete chat",
                    "memories": [
                        { "id": "keep-created-at-old", "createdAt": "2026-01-01T00:00:00.000Z" },
                        { "id": "drop-created-at-new", "createdAt": "2026-01-03T00:00:00.000Z" }
                    ]
                }),
            )
            .expect("chat should be created");
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "message-delete",
                    "chatId": "chat-1",
                    "role": "assistant",
                    "content": "delete me",
                    "createdAt": "2026-01-02T00:00:00.000Z"
                }),
            )
            .expect("message should be created");

        delete_entity(&state, "messages", "message-delete", false)
            .expect("message delete should prune created-at memory recall");

        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should remain");
        let memory_ids = chat["memories"]
            .as_array()
            .expect("memories should stay an array")
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(memory_ids, vec!["keep-created-at-old"]);
    }

    #[test]
    fn deleting_message_prunes_mixed_timestamp_memory_by_shared_precedence() {
        let state = test_state("message-delete-mixed-timestamp-memory-prune");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Mixed timestamp memory delete chat",
                    "memories": [
                        {
                            "id": "drop-created-inside-window",
                            "createdAt": "2026-01-03T00:00:00.000Z",
                            "firstMessageAt": "2026-01-01T00:00:00.000Z"
                        },
                        {
                            "id": "keep-created-before-window",
                            "createdAt": "2026-01-01T00:00:00.000Z",
                            "firstMessageAt": "2026-01-04T00:00:00.000Z"
                        },
                        {
                            "id": "keep-last-message-before-window",
                            "lastMessageAt": "2026-01-01T00:00:00.000Z",
                            "createdAt": "2026-01-04T00:00:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should be created");
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "message-delete",
                    "chatId": "chat-1",
                    "role": "assistant",
                    "content": "delete me",
                    "createdAt": "2026-01-02T00:00:00.000Z"
                }),
            )
            .expect("message should be created");

        delete_entity(&state, "messages", "message-delete", false)
            .expect("message delete should use shared memory timestamp precedence");

        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should remain");
        let memory_ids = chat["memories"]
            .as_array()
            .expect("memories should stay an array")
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(
            memory_ids,
            vec![
                "keep-created-before-window",
                "keep-last-message-before-window"
            ]
        );
    }

    #[test]
    fn deleting_message_keeps_rows_and_memories_when_memory_prune_fails() {
        let state = test_state("message-delete-prune-fails");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Prune failure delete chat",
                    "memories": "{not valid json"
                }),
            )
            .expect("chat should be created");
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "message-delete",
                    "chatId": "chat-1",
                    "role": "assistant",
                    "content": "delete me",
                    "createdAt": "2026-01-02T00:00:00.000Z"
                }),
            )
            .expect("message should be created");

        let error = delete_entity(&state, "messages", "message-delete", false)
            .expect_err("malformed memories should abort atomic delete");
        assert_eq!(error.code, "invalid_input");
        assert!(state
            .storage
            .get("messages", "message-delete")
            .expect("message should read")
            .is_some());
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should remain");
        assert_eq!(chat["memories"], json!("{not valid json"));
    }

    #[test]
    fn deleting_message_rolls_back_rows_memories_and_trackers_when_cleanup_fails() {
        let state = test_state("message-delete-tracker-cleanup-fails");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Tracker rollback delete chat",
                    "gameState": { "location": "before" },
                    "memories": [
                        {
                            "id": "drop-memory",
                            "messageIds": ["message-delete"],
                            "lastMessageAt": "2026-01-02T00:00:00.000Z"
                        },
                        {
                            "id": "__fail_after_delete_mutation__",
                            "lastMessageAt": "2026-01-01T00:00:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should be created");
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "message-delete",
                    "chatId": "chat-1",
                    "role": "assistant",
                    "content": "delete me",
                    "createdAt": "2026-01-02T00:00:00.000Z"
                }),
            )
            .expect("message should be created");
        game_state_snapshots::save_tracker_snapshot(
            &state,
            "chat-1",
            json!({
                "messageId": "message-delete",
                "location": "delete target"
            }),
        )
        .expect("tracker snapshot should seed");

        let error = delete_entity(&state, "messages", "message-delete", false)
            .expect_err("injected cleanup failure should abort atomic delete");
        assert_eq!(error.code, "invalid_input");
        assert!(state
            .storage
            .get("messages", "message-delete")
            .expect("message should read")
            .is_some());
        let snapshots = state
            .storage
            .list("game-state-snapshots")
            .expect("snapshots should read");
        assert_eq!(snapshots.len(), 1);
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should remain");
        let memory_ids = chat["memories"]
            .as_array()
            .expect("memories should stay an array")
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(
            memory_ids,
            vec!["drop-memory", "__fail_after_delete_mutation__"]
        );
        assert_eq!(chat["gameState"]["location"], "before");
    }

    #[test]
    fn deleting_message_converges_rows_snapshots_visible_tracker_and_memories() {
        let state = test_state("message-delete-tracker-success");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Tracker success delete chat",
                    "gameState": { "location": "delete target" },
                    "memories": [
                        {
                            "id": "keep-memory",
                            "messageIds": ["message-keep"],
                            "lastMessageAt": "2026-01-01T00:00:00.000Z"
                        },
                        {
                            "id": "drop-memory",
                            "messageIds": ["message-delete"],
                            "lastMessageAt": "2026-01-02T00:00:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should be created");
        for (id, created_at) in [
            ("message-keep", "2026-01-01T00:00:00.000Z"),
            ("message-delete", "2026-01-02T00:00:00.000Z"),
        ] {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": id,
                        "chatId": "chat-1",
                        "role": "assistant",
                        "content": id,
                        "createdAt": created_at
                    }),
                )
                .expect("message should be created");
            game_state_snapshots::save_tracker_snapshot(
                &state,
                "chat-1",
                json!({
                    "messageId": id,
                    "location": id
                }),
            )
            .expect("tracker snapshot should seed");
        }

        delete_entity(&state, "messages", "message-delete", false)
            .expect("message delete should converge cleanup");

        assert!(state
            .storage
            .get("messages", "message-delete")
            .expect("message should read")
            .is_none());
        let snapshots = state
            .storage
            .list("game-state-snapshots")
            .expect("snapshots should read");
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0]["messageId"], "message-keep");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should remain");
        let memory_ids = chat["memories"]
            .as_array()
            .expect("memories should stay an array")
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(memory_ids, vec!["keep-memory"]);
        assert_eq!(chat["gameState"]["location"], "message-keep");
    }

    #[test]
    fn storage_list_searches_projected_character_fields_without_returning_avatar_payloads() {
        let state = test_state("character-search-projection");
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-match",
                    "comment": "summary",
                    "avatarPath": "data:image/png;base64,large-avatar",
                    "avatarFilePath": "C:\\Marinara\\avatars\\characters\\match.png",
                    "avatarFilename": "match.png",
                    "data": {
                        "name": "Rina",
                        "description": "Frost archive keeper",
                        "personality": "Dry humor",
                        "tags": ["Mage"],
                        "favorite_color": "violet",
                        "extensions": { "fav": true }
                    }
                }),
            )
            .expect("matching character should be created");
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-avatar-only",
                    "avatarPath": "data:image/png;base64,frost-hidden-in-avatar",
                    "data": {
                        "name": "Mira",
                        "description": "No matching text",
                        "tags": []
                    }
                }),
            )
            .expect("non-matching character should be created");

        let result = storage_list_inner(
            &state,
            "characters".to_string(),
            Some(json!({
                "fields": ["id", "data", "comment", "avatarFilePath", "avatarFilename"],
                "fieldSelections": { "data": ["name", "tags", "extensions"] },
                "search": "frost archive"
            })),
        )
        .expect("search list should succeed");
        let rows = result.as_array().expect("storage_list returns an array");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "char-match");
        assert_eq!(
            rows[0],
            json!({
                "id": "char-match",
                "data": {
                    "name": "Rina",
                    "tags": ["Mage"],
                    "extensions": { "fav": true }
                },
                "comment": "summary",
                "avatarFilePath": "C:\\Marinara\\avatars\\characters\\match.png",
                "avatarFilename": "match.png"
            })
        );

        let avatar_payload_result = storage_list_inner(
            &state,
            "characters".to_string(),
            Some(json!({
                "fields": ["id", "data", "comment", "avatarFilePath", "avatarFilename"],
                "fieldSelections": { "data": ["name", "tags", "extensions"] },
                "search": "frost-hidden-in-avatar"
            })),
        )
        .expect("avatar payload search should succeed");

        assert!(
            avatar_payload_result
                .as_array()
                .expect("storage_list returns an array")
                .is_empty(),
            "search should not match embedded avatar payload text"
        );

        let full_data_result = storage_list_inner(
            &state,
            "characters".to_string(),
            Some(json!({
                "fields": ["id", "data"],
                "search": "frost archive"
            })),
        )
        .expect("full data search list should succeed");
        let full_data_rows = full_data_result
            .as_array()
            .expect("storage_list returns an array");
        assert_eq!(full_data_rows.len(), 1);
        assert_eq!(full_data_rows[0]["data"]["favorite_color"], "violet");
    }

    #[test]
    fn storage_list_projected_messages_keeps_default_created_at_order() {
        let state = test_state("message-projection-default-sort");
        state
            .storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "new", "chatId": "chat-1", "createdAt": "2026-01-03T00:00:00Z", "content": "new" }),
                    json!({ "id": "old", "chatId": "chat-1", "createdAt": "2026-01-01T00:00:00Z", "content": "old" }),
                    json!({ "id": "other", "chatId": "chat-2", "createdAt": "2026-01-02T00:00:00Z", "content": "other" }),
                ],
            )
            .expect("messages should be seeded");

        let result = storage_list_inner(
            &state,
            "messages".to_string(),
            Some(json!({
                "filters": { "chatId": "chat-1" },
                "fields": ["id", "content"]
            })),
        )
        .expect("projected message list should succeed");

        assert_eq!(
            result,
            json!([
                { "id": "old", "content": "old" },
                { "id": "new", "content": "new" }
            ])
        );
    }

    #[test]
    fn storage_list_projected_messages_keeps_before_cursor_filter() {
        let state = test_state("message-projection-before-cursor");
        state
            .storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "older", "chatId": "chat-1", "createdAt": "2026-01-01T00:00:00Z", "content": "older" }),
                    json!({ "id": "cursor", "chatId": "chat-1", "createdAt": "2026-01-02T00:00:00Z", "content": "cursor" }),
                    json!({ "id": "newer", "chatId": "chat-1", "createdAt": "2026-01-03T00:00:00Z", "content": "newer" }),
                ],
            )
            .expect("messages should be seeded");

        let result = storage_list_inner(
            &state,
            "messages".to_string(),
            Some(json!({
                "filters": { "chatId": "chat-1" },
                "fields": ["id", "content"],
                "before": "2026-01-02T00:00:00Z|cursor"
            })),
        )
        .expect("projected message list should succeed");

        assert_eq!(result, json!([{ "id": "older", "content": "older" }]));
    }

    #[test]
    fn storage_list_projected_paged_messages_skips_unrequested_payloads_before_parsing() {
        let state = test_state("message-projection-paged-skips-payloads");
        state
            .storage
            .clear_all()
            .expect("storage cache should be cleared");
        let collection = state
            .data_dir
            .join("data")
            .join("collections")
            .join("messages.json");
        let sidecar_collection = state
            .data_dir
            .join("data")
            .join("collections")
            .join(format!("{}.json", message_swipes::COLLECTION));
        std::fs::write(
            &collection,
            r#"[
  {
    "id": "older",
    "chatId": "chat-1",
    "createdAt": "2026-01-01T00:00:01Z",
    "content": "stored older",
    "extra": {
      "thinking": "parent older",
      "large": {
        "unrequested": invalid
      }
    },
    "attachments": [
      {
        "unrequested": invalid
      }
    ]
  },
  {
    "id": "target",
    "chatId": "chat-1",
    "createdAt": "2026-01-01T00:00:02Z",
    "content": "stored target",
    "extra": {
      "thinking": "parent target",
      "large": {
        "unrequested": invalid
      }
    },
    "promptSnapshot": {
      "unrequested": invalid
    }
  },
  {
    "id": "newer",
    "chatId": "chat-1",
    "createdAt": "2026-01-01T00:00:03Z",
    "content": "stored newer",
    "extra": {
      "thinking": "newer",
      "large": {
        "unrequested": invalid
      }
    }
  }
]"#,
        )
        .expect("messages should be written");
        std::fs::write(
            &sidecar_collection,
            r#"[
  {
    "id": "older::swipe::0",
    "chatId": "chat-1",
    "messageId": "older",
    "index": 0,
    "content": "older swipe",
    "extra": {
      "thinking": "older thought",
      "unrequested": "ignored"
    }
  },
  {
    "id": "target::swipe::0",
    "chatId": "chat-1",
    "messageId": "target",
    "index": 0,
    "content": "target swipe",
    "extra": {
      "thinking": "target thought",
      "unrequested": "ignored"
    }
  },
  {
    "id": "newer::swipe::0",
    "chatId": "chat-1",
    "messageId": "newer",
    "index": 0,
    "content": "newer swipe",
    "extra": {
      "unrequested": "ignored"
    }
  }
]"#,
        )
        .expect("message swipe sidecars should be written");

        let result = storage_list_inner(
            &state,
            "messages".to_string(),
            Some(json!({
                "filters": { "chatId": "chat-1" },
                "fields": ["id", "content", "extra", "swipeCount", "swipePreviews"],
                "fieldSelections": { "extra": ["thinking"] },
                "limit": 2,
                "before": "2026-01-01T00:00:03Z|newer"
            })),
        )
        .expect("projected paged message list should skip unrequested payload fields");

        assert_eq!(
            result,
            json!([
                {
                    "id": "older",
                    "content": "stored older",
                    "extra": { "thinking": "parent older" },
                    "swipeCount": 1,
                    "swipePreviews": [{ "content": "older swipe" }]
                },
                {
                    "id": "target",
                    "content": "stored target",
                    "extra": { "thinking": "parent target" },
                    "swipeCount": 1,
                    "swipePreviews": [{ "content": "target swipe" }]
                }
            ])
        );
    }

    #[test]
    fn storage_list_projected_embedded_swipes_materializes_without_swipes_field() {
        let state = test_state("message-projection-embedded-swipe-materialization");
        state
            .storage
            .replace_all(
                "messages",
                vec![json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "content": "parent content",
                    "activeSwipeIndex": 1,
                    "extra": { "thinking": "parent thought" },
                    "swipes": [
                        { "content": "first swipe", "extra": { "thinking": "first thought" } },
                        { "content": "active swipe", "extra": { "thinking": "active thought" } }
                    ]
                })],
            )
            .expect("message should be seeded");
        message_swipes::migrate_nested_message_swipes(&state.storage)
            .expect("embedded message swipes should migrate before projected reads");

        let result = storage_list_inner(
            &state,
            "messages".to_string(),
            Some(json!({
                "filters": { "chatId": "chat-1" },
                "fields": ["id", "content", "extra", "swipeCount", "swipePreviews"],
                "fieldSelections": { "extra": ["thinking"] }
            })),
        )
        .expect("projected message list should materialize embedded swipes");

        assert_eq!(
            result,
            json!([
                {
                    "id": "message-1",
                    "content": "active swipe",
                    "extra": { "thinking": "active thought" },
                    "swipeCount": 2,
                    "swipePreviews": [
                        { "content": "first swipe" },
                        { "content": "active swipe" }
                    ]
                }
            ])
        );
    }

    #[test]
    fn message_projection_materialization_includes_internal_sort_fields() {
        let fields = vec!["content".to_string()];
        let projection = message_projection_fields_for_materialization(
            &fields,
            Some(&json!({ "orderBy": "score" })),
        );

        for field in ["content", "id", "sortOrder", "order", "createdAt", "score"] {
            assert!(
                projection.iter().any(|existing| existing == field),
                "projection should include {field}"
            );
        }
        for field in ["activeSwipeIndex", "swipes"] {
            assert!(
                !projection.iter().any(|existing| existing == field),
                "projection should not include sidecar field {field}"
            );
        }
    }

    #[test]
    fn projected_message_get_materializes_swipe_summary_without_swipes_field() {
        let state = test_state("message-projection-get-swipe-materialization");
        state
            .storage
            .replace_all(
                "messages",
                vec![json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "content": "stored parent content",
                    "activeSwipeIndex": 1,
                    "extra": { "thinking": "parent thought", "large": "parent payload" },
                    "swipes": [
                        { "content": "first swipe", "extra": { "thinking": "first thought" } },
                        { "content": "active swipe", "extra": { "thinking": "active thought", "large": "ignored" } }
                    ],
                    "largePayload": "ignored"
                })],
            )
            .expect("message should be seeded");
        message_swipes::migrate_nested_message_swipes(&state.storage)
            .expect("nested message swipes should migrate");

        let read = storage_get_inner(
            &state,
            "messages".to_string(),
            "message-1".to_string(),
            Some(json!({
                "fields": ["id", "content", "extra", "swipeCount", "swipePreviews"],
                "fieldSelections": { "extra": ["thinking"] }
            })),
        )
        .expect("projected message should read");

        assert_eq!(read["id"], "message-1");
        assert_eq!(read["content"], "active swipe");
        assert_eq!(read["swipeCount"], 2);
        assert_eq!(
            read["swipePreviews"],
            json!([{ "content": "first swipe" }, { "content": "active swipe" }])
        );
        assert_eq!(read["extra"], json!({ "thinking": "active thought" }));
        assert!(read.get("swipes").is_none());
        assert!(read.get("activeSwipeIndex").is_none());
        assert!(read.get("largePayload").is_none());
    }

    #[test]
    fn projected_message_get_reads_parent_active_fields_without_sidecar_payload() {
        let state = test_state("message-projection-parent-active-fields");
        state
            .storage
            .replace_all(
                "messages",
                vec![json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "content": "parent active content",
                    "activeSwipeIndex": 1,
                    "extra": { "thinking": "parent active thought", "large": "parent payload" }
                })],
            )
            .expect("message should be seeded");
        state
            .storage
            .replace_all(
                message_swipes::COLLECTION,
                vec![
                    json!({
                        "id": "message-1::swipe::0",
                        "chatId": "chat-1",
                        "messageId": "message-1",
                        "index": 0,
                        "content": "first sidecar",
                        "extra": { "thinking": "first sidecar thought" }
                    }),
                    json!({
                        "id": "message-1::swipe::1",
                        "chatId": "chat-1",
                        "messageId": "message-1",
                        "index": 1,
                        "content": "stale active sidecar",
                        "extra": { "thinking": "stale sidecar thought" }
                    }),
                ],
            )
            .expect("sidecars should be seeded");

        let read = storage_get_inner(
            &state,
            "messages".to_string(),
            "message-1".to_string(),
            Some(json!({
                "fields": ["id", "content", "extra"],
                "fieldSelections": { "extra": ["thinking"] }
            })),
        )
        .expect("projected message should read");

        assert_eq!(
            read,
            json!({
                "id": "message-1",
                "content": "parent active content",
                "extra": { "thinking": "parent active thought" }
            })
        );
    }

    #[test]
    fn projected_message_list_materializes_swipe_summary_without_sidecar_extra() {
        let state = test_state("message-projection-sidecar-summary");
        state
            .storage
            .replace_all(
                "messages",
                vec![json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "content": "parent active content",
                    "activeSwipeIndex": 1,
                    "extra": { "thinking": "parent active thought", "large": "parent payload" }
                })],
            )
            .expect("message should be seeded");
        state
            .storage
            .replace_all(
                message_swipes::COLLECTION,
                vec![
                    json!({
                        "id": "message-1::swipe::0",
                        "chatId": "chat-1",
                        "messageId": "message-1",
                        "index": 0,
                        "content": "first sidecar",
                        "extra": { "thinking": "first sidecar thought", "large": "ignored" }
                    }),
                    json!({
                        "id": "message-1::swipe::1",
                        "chatId": "chat-1",
                        "messageId": "message-1",
                        "index": 1,
                        "content": "second sidecar",
                        "characterId": "character-1",
                        "extra": { "thinking": "second sidecar thought", "large": "ignored" }
                    }),
                ],
            )
            .expect("sidecars should be seeded");

        let result = storage_list_inner(
            &state,
            "messages".to_string(),
            Some(json!({
                "filters": { "chatId": "chat-1" },
                "fields": ["id", "content", "extra", "swipeCount", "swipePreviews"],
                "fieldSelections": { "extra": ["thinking"] }
            })),
        )
        .expect("projected message list should read");

        assert_eq!(
            result,
            json!([
                {
                    "id": "message-1",
                    "content": "parent active content",
                    "extra": { "thinking": "parent active thought" },
                    "swipeCount": 2,
                    "swipePreviews": [
                        { "content": "first sidecar" },
                        { "content": "second sidecar", "characterId": "character-1" }
                    ]
                }
            ])
        );
    }

    #[test]
    fn storage_list_searches_sidecar_message_swipes_without_returning_unrequested_swipes() {
        let state = test_state("message-search-sidecar-swipes");
        state
            .storage
            .replace_all(
                "messages",
                vec![json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "role": "assistant",
                    "content": "Visible active message.",
                    "activeSwipeIndex": 0,
                    "createdAt": "2026-01-01T00:00:00Z"
                })],
            )
            .expect("message should seed");
        state
            .storage
            .replace_all(
                message_swipes::COLLECTION,
                vec![json!({
                    "id": "message-1::swipe::0",
                    "chatId": "chat-1",
                    "messageId": "message-1",
                    "index": 0,
                    "content": "Alternate route through the moonlit archive."
                })],
            )
            .expect("sidecar swipe should seed");

        let result = storage_list_inner(
            &state,
            "messages".to_string(),
            Some(json!({
                "filters": { "chatId": "chat-1" },
                "fields": ["id", "content", "swipeCount"],
                "search": "moonlit"
            })),
        )
        .expect("message search should succeed");

        assert_eq!(
            result,
            json!([
                {
                    "id": "message-1",
                    "content": "Visible active message.",
                    "swipeCount": 1
                }
            ])
        );
    }

    #[test]
    fn storage_list_search_materializes_active_sidecar_extra_without_returning_swipes() {
        let state = test_state("message-search-sidecar-active-extra");
        state
            .storage
            .replace_all(
                "messages",
                vec![json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "role": "assistant",
                    "content": "Visible active message.",
                    "activeSwipeIndex": 1,
                    "extra": { "hiddenFromAI": true },
                    "createdAt": "2026-01-01T00:00:00Z"
                })],
            )
            .expect("message should seed");
        state
            .storage
            .replace_all(
                message_swipes::COLLECTION,
                vec![
                    json!({
                        "id": "message-1::swipe::0",
                        "chatId": "chat-1",
                        "messageId": "message-1",
                        "index": 0,
                        "content": "Search-only moonlit sidecar.",
                        "extra": { "thinking": "inactive thought" }
                    }),
                    json!({
                        "id": "message-1::swipe::1",
                        "chatId": "chat-1",
                        "messageId": "message-1",
                        "index": 1,
                        "content": "Visible active message.",
                        "extra": { "thinking": "active sidecar thought" }
                    }),
                ],
            )
            .expect("sidecar swipes should seed");

        let result = storage_list_inner(
            &state,
            "messages".to_string(),
            Some(json!({
                "filters": { "chatId": "chat-1" },
                "fields": ["id", "content", "extra", "swipeCount", "swipePreviews"],
                "fieldSelections": { "extra": ["hiddenFromAI", "thinking"] },
                "search": "moonlit"
            })),
        )
        .expect("message search should succeed");

        assert_eq!(
            result,
            json!([
                {
                    "id": "message-1",
                    "content": "Visible active message.",
                    "extra": { "hiddenFromAI": true, "thinking": "active sidecar thought" },
                    "swipeCount": 2,
                    "swipePreviews": [
                        { "content": "Search-only moonlit sidecar." },
                        { "content": "Visible active message." }
                    ]
                }
            ])
        );
    }

    #[test]
    fn enabling_agent_default_connection_clears_previous_language_default() {
        let state = test_state("agent-default-exclusive-update");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "language-a",
                "name": "Language A",
                "provider": "anthropic",
                "defaultForAgents": true
            }),
        )
        .expect("first language connection should be created");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "image-a",
                "name": "Image A",
                "provider": "image_generation",
                "defaultForAgents": true
            }),
        )
        .expect("image connection should be created");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "language-b",
                "name": "Language B",
                "provider": "openai",
                "defaultForAgents": false
            }),
        )
        .expect("second language connection should be created");

        storage_update_inner(
            &state,
            "connections".to_string(),
            "language-b".to_string(),
            json!({ "defaultForAgents": true }),
        )
        .expect("second language connection should become default");

        assert!(!default_for_agents(&state, "language-a"));
        assert!(default_for_agents(&state, "language-b"));
        assert!(default_for_agents(&state, "image-a"));
    }

    #[test]
    fn creating_agent_default_connection_clears_previous_same_scope_default() {
        let state = test_state("agent-default-exclusive-create");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "image-a",
                "name": "Image A",
                "provider": "image_generation",
                "defaultForAgents": true
            }),
        )
        .expect("first image connection should be created");

        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "image-b",
                "name": "Image B",
                "provider": "image_generation",
                "defaultForAgents": "true"
            }),
        )
        .expect("second image connection should be created");

        assert!(!default_for_agents(&state, "image-a"));
        assert!(default_for_agents(&state, "image-b"));
    }

    #[test]
    fn connection_api_key_is_encrypted_masked_and_runtime_decrypted() {
        let state = test_state("connection-secret");
        let created = storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "secure-connection",
                "name": "Secure",
                "provider": "anthropic",
                "model": "claude-opus-4-8",
                "apiKey": "sk-secret"
            }),
        )
        .expect("connection should be created");
        assert_eq!(created["apiKey"], connection_secrets::API_KEY_MASK);
        assert_eq!(created["hasApiKey"], true);

        let raw = state
            .storage
            .get("connections", "secure-connection")
            .expect("connection should read")
            .expect("connection should exist");
        assert!(raw.get("apiKey").is_none());
        assert_ne!(
            raw.get("apiKeyEncrypted").and_then(Value::as_str),
            Some("sk-secret")
        );

        let read = storage_get_inner(
            &state,
            "connections".to_string(),
            "secure-connection".to_string(),
            None,
        )
        .expect("masked connection should read");
        assert_eq!(read["apiKey"], connection_secrets::API_KEY_MASK);
        assert!(read.get("apiKeyEncrypted").is_none());

        let runtime = connection_secrets::connection_for_runtime(&state, "secure-connection")
            .expect("runtime connection should decrypt");
        assert_eq!(runtime["apiKey"], "sk-secret");
    }

    #[test]
    fn projected_connection_get_preserves_secret_mask_fields() {
        let state = test_state("connection-secret-projected-get");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "secure-connection",
                "name": "Secure",
                "provider": "anthropic",
                "model": "claude-opus-4-8",
                "apiKey": "sk-secret"
            }),
        )
        .expect("connection should be created");

        let read = storage_get_inner(
            &state,
            "connections".to_string(),
            "secure-connection".to_string(),
            Some(json!({
                "fields": ["id", "hasApiKey", "apiKey", "apiKeyEncrypted"]
            })),
        )
        .expect("projected masked connection should read");

        assert_eq!(read["id"], "secure-connection");
        assert_eq!(read["hasApiKey"], true);
        assert_eq!(read["apiKey"], connection_secrets::API_KEY_MASK);
        assert!(read.get("apiKeyEncrypted").is_none());
    }

    #[test]
    fn blank_connection_api_key_update_preserves_existing_secret() {
        let state = test_state("connection-secret-preserve");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "secure-connection",
                "name": "Secure",
                "provider": "anthropic",
                "model": "claude-opus-4-8",
                "apiKey": "sk-secret"
            }),
        )
        .expect("connection should be created");

        storage_update_inner(
            &state,
            "connections".to_string(),
            "secure-connection".to_string(),
            json!({ "apiKey": "", "name": "Still Secure" }),
        )
        .expect("blank update should preserve key");
        let runtime = connection_secrets::connection_for_runtime(&state, "secure-connection")
            .expect("runtime connection should decrypt");
        assert_eq!(runtime["apiKey"], "sk-secret");
    }

    #[test]
    fn duplicating_connection_resets_default_flags_and_keeps_secret_masked() {
        let state = test_state("connection-duplicate-defaults");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "default-connection",
                "name": "Default Connection",
                "provider": "anthropic",
                "model": "claude-opus-4-8",
                "isDefault": true,
                "default": true,
                "defaultForAgents": true,
                "apiKey": "sk-secret"
            }),
        )
        .expect("connection should be created");

        let duplicated = duplicate_entity(&state, "connections", "default-connection")
            .expect("connection duplicate should succeed");

        assert_ne!(duplicated["id"], "default-connection");
        assert_eq!(duplicated["name"], "Default Connection Copy");
        assert_eq!(duplicated["isDefault"], false);
        assert_eq!(duplicated["default"], false);
        assert_eq!(duplicated["defaultForAgents"], false);
        assert_eq!(duplicated["apiKey"], connection_secrets::API_KEY_MASK);

        let raw = state
            .storage
            .get("connections", duplicated["id"].as_str().unwrap())
            .expect("duplicate should read")
            .expect("duplicate should exist");
        assert!(raw.get("apiKey").is_none());
        assert!(raw.get("apiKeyEncrypted").is_some());
    }

    #[test]
    fn deleting_connection_folder_unfiles_child_connections() {
        let state = test_state("connection-folder-delete");
        storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A" }),
        )
        .expect("folder should be created");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "connection-a",
                "name": "Connection A",
                "provider": "openai",
                "model": "gpt-4o",
                "folderId": "folder-a"
            }),
        )
        .expect("connection should be created");

        delete_entity(&state, "connection-folders", "folder-a", false)
            .expect("folder delete should succeed");

        let connection = state
            .storage
            .get("connections", "connection-a")
            .expect("connection should read")
            .expect("connection should remain");
        assert!(connection.get("folderId").is_none_or(Value::is_null));
    }

    #[test]
    fn moving_connection_rejects_missing_folder() {
        let state = test_state("connection-folder-missing");
        storage_create_inner(
            &state,
            "connections".to_string(),
            json!({
                "id": "connection-a",
                "name": "Connection A",
                "provider": "openai",
                "model": "gpt-4o"
            }),
        )
        .expect("connection should be created");

        let error =
            connection_move_inner(&state, "connection-a", Some("missing-folder".to_string()))
                .expect_err("missing folders should be rejected");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn creating_connection_folder_defaults_and_shifts_existing_folders() {
        let state = test_state("connection-folder-create-defaults");
        storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({
                "id": "folder-old",
                "name": "Old"
            }),
        )
        .expect("existing folder should be created");

        let created = storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({
                "id": "folder-new",
                "name": "New folder"
            }),
        )
        .expect("new folder should be created");

        assert_eq!(created["color"], "#38bdf8");
        assert_eq!(created["collapsed"], false);
        assert_eq!(created["sortOrder"], 0);
        assert_eq!(created["order"], 0);
        assert!(created.get("createdAt").is_some());
        assert!(created.get("updatedAt").is_some());

        let shifted = state
            .storage
            .get("connection-folders", "folder-old")
            .expect("folder should read")
            .expect("folder should remain");
        assert_eq!(shifted["sortOrder"], 1);
        assert_eq!(shifted["order"], 1);
    }

    #[test]
    fn creating_connection_folder_with_explicit_order_does_not_shift_existing_folders() {
        let state = test_state("connection-folder-create-explicit-order");
        storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({
                "id": "folder-old",
                "name": "Old"
            }),
        )
        .expect("existing folder should be created");

        let created = storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({
                "id": "folder-new",
                "name": "New folder",
                "sortOrder": 4,
                "order": 4
            }),
        )
        .expect("new folder should be created");

        assert_eq!(created["sortOrder"], 4);
        assert_eq!(created["order"], 4);

        let existing = state
            .storage
            .get("connection-folders", "folder-old")
            .expect("folder should read")
            .expect("folder should remain");
        assert_eq!(existing["sortOrder"], 0);
        assert_eq!(existing["order"], 0);
    }

    #[test]
    fn creating_connection_folder_with_explicit_legacy_order_preserves_order() {
        let state = test_state("connection-folder-create-legacy-order");
        storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({
                "id": "folder-old",
                "name": "Old"
            }),
        )
        .expect("existing folder should be created");

        let created = storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({
                "id": "folder-new",
                "name": "New folder",
                "order": 3
            }),
        )
        .expect("new folder should be created");

        assert_eq!(created["sortOrder"], 3);
        assert_eq!(created["order"], 3);

        let existing = state
            .storage
            .get("connection-folders", "folder-old")
            .expect("folder should read")
            .expect("folder should remain");
        assert_eq!(existing["sortOrder"], 0);
        assert_eq!(existing["order"], 0);
    }

    #[test]
    fn creating_chat_folder_defaults_and_shifts_existing_folders() {
        let state = test_state("chat-folder-create-defaults");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({
                "id": "folder-old",
                "name": "Old",
                "mode": "conversation"
            }),
        )
        .expect("existing folder should be created");

        let created = storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({
                "id": "folder-new",
                "name": "  New folder  ",
                "mode": "roleplay"
            }),
        )
        .expect("new folder should be created");

        assert_eq!(created["name"], "New folder");
        assert_eq!(created["color"], "");
        assert_eq!(created["collapsed"], false);
        assert_eq!(created["sortOrder"], 0);
        assert_eq!(created["order"], 0);
        assert!(created.get("createdAt").is_some());
        assert!(created.get("updatedAt").is_some());

        let shifted = state
            .storage
            .get("chat-folders", "folder-old")
            .expect("folder should read")
            .expect("folder should remain");
        assert_eq!(shifted["sortOrder"], 1);
        assert_eq!(shifted["order"], 1);
    }

    #[test]
    fn creating_chat_folder_rejects_invalid_name_and_mode() {
        let state = test_state("chat-folder-create-invalid");
        let blank_name = storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "name": "  ", "mode": "conversation" }),
        )
        .expect_err("blank names should be rejected");
        assert_eq!(blank_name.code, "invalid_input");

        let invalid_mode = storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "name": "Folder", "mode": "unknown" }),
        )
        .expect_err("invalid modes should be rejected");
        assert_eq!(invalid_mode.code, "invalid_input");
    }

    #[test]
    fn creating_chat_folder_canonicalizes_legacy_mode_alias() {
        let state = test_state("chat-folder-create-alias");
        let created = storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "visual_novel" }),
        )
        .expect("legacy mode alias should be accepted");

        assert_eq!(created["mode"], "roleplay");
        let stored = state
            .storage
            .get("chat-folders", "folder-a")
            .expect("folder should read")
            .expect("folder should persist");
        assert_eq!(stored["mode"], "roleplay");
    }

    #[test]
    fn duplicate_chat_folder_create_leaves_existing_order_unchanged() {
        let state = test_state("chat-folder-duplicate-keeps-order");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "conversation" }),
        )
        .expect("folder should be created");

        let error = storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Duplicate", "mode": "conversation" }),
        )
        .expect_err("duplicate folder ids should be rejected");
        assert_eq!(error.code, "invalid_input");

        let folder = state
            .storage
            .get("chat-folders", "folder-a")
            .expect("folder should read")
            .expect("folder should remain");
        assert_eq!(folder["sortOrder"], 0);
        assert_eq!(folder["order"], 0);
    }

    #[test]
    fn deleting_chat_folder_unfiles_child_chats() {
        let state = test_state("chat-folder-delete");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-delete", "name": "Delete", "mode": "conversation" }),
        )
        .expect("folder should be created");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-keep", "name": "Keep", "mode": "conversation" }),
        )
        .expect("negative-control folder should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-reparent",
                "title": "Reparent",
                "mode": "conversation",
                "folderId": "folder-delete"
            }),
        )
        .expect("chat should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-keep",
                "title": "Keep",
                "mode": "conversation",
                "folderId": "folder-keep"
            }),
        )
        .expect("negative-control chat should be created");

        delete_entity(&state, "chat-folders", "folder-delete", false)
            .expect("folder delete should succeed");

        let reparented = state
            .storage
            .get("chats", "chat-reparent")
            .expect("chat should read")
            .expect("chat should remain");
        assert!(reparented.get("folderId").is_none_or(Value::is_null));
        let kept = state
            .storage
            .get("chats", "chat-keep")
            .expect("negative-control chat should read")
            .expect("negative-control chat should remain");
        assert_eq!(kept["folderId"], "folder-keep");
    }

    #[test]
    fn chat_folder_mode_patch_rejects_incompatible_filed_chats() {
        let state = test_state("chat-folder-mode-patch-incompatible");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "conversation" }),
        )
        .expect("folder should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A",
                "mode": "conversation",
                "folderId": "folder-a"
            }),
        )
        .expect("chat should be created");

        let error = storage_update_inner(
            &state,
            "chat-folders".to_string(),
            "folder-a".to_string(),
            json!({ "mode": "game" }),
        )
        .expect_err("incompatible filed chats should block folder mode changes");
        assert_eq!(error.code, "invalid_input");

        let folder = state
            .storage
            .get("chat-folders", "folder-a")
            .expect("folder should read")
            .expect("folder should remain");
        assert_eq!(folder["mode"], "conversation");
    }

    #[test]
    fn chat_folder_mode_patch_canonicalizes_alias_and_rejects_invalid_mode() {
        let state = test_state("chat-folder-mode-patch-alias-invalid");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "conversation" }),
        )
        .expect("folder should be created");

        let updated = storage_update_inner(
            &state,
            "chat-folders".to_string(),
            "folder-a".to_string(),
            json!({ "mode": "visual_novel" }),
        )
        .expect("legacy folder mode alias should be canonicalized");
        assert_eq!(updated["mode"], "roleplay");

        let error = storage_update_inner(
            &state,
            "chat-folders".to_string(),
            "folder-a".to_string(),
            json!({ "mode": "unknown" }),
        )
        .expect_err("invalid folder modes should reject before storage writes");
        assert_eq!(error.code, "invalid_input");

        let folder = state
            .storage
            .get("chat-folders", "folder-a")
            .expect("folder should read")
            .expect("folder should remain");
        assert_eq!(folder["mode"], "roleplay");
    }

    #[test]
    fn chat_folder_name_patch_trims_and_rejects_blank_names() {
        let state = test_state("chat-folder-name-patch");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "conversation" }),
        )
        .expect("folder should be created");

        let updated = storage_update_inner(
            &state,
            "chat-folders".to_string(),
            "folder-a".to_string(),
            json!({ "name": "  Folder B  " }),
        )
        .expect("folder name patch should trim");
        assert_eq!(updated["name"], "Folder B");

        let error = storage_update_inner(
            &state,
            "chat-folders".to_string(),
            "folder-a".to_string(),
            json!({ "name": "   " }),
        )
        .expect_err("blank folder name patch should reject");
        assert_eq!(error.code, "invalid_input");

        let stored = state
            .storage
            .get("chat-folders", "folder-a")
            .expect("folder should read")
            .expect("folder should remain");
        assert_eq!(stored["name"], "Folder B");
    }

    #[test]
    fn filed_chat_alias_mode_create_and_patch_persist_canonical_mode() {
        let state = test_state("chat-folder-filed-chat-mode-alias");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "roleplay-folder", "name": "Roleplay", "mode": "roleplay" }),
        )
        .expect("folder should be created");

        let created = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A",
                "mode": "visual_novel",
                "folderId": "roleplay-folder"
            }),
        )
        .expect("filed chat using legacy mode alias should be accepted");
        assert_eq!(created["mode"], "roleplay");

        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-b",
                "title": "Chat B",
                "mode": "roleplay",
                "folderId": "roleplay-folder"
            }),
        )
        .expect("second filed chat should be created");
        let updated = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-b".to_string(),
            json!({ "mode": "visual_novel" }),
        )
        .expect("filed chat mode alias patch should be accepted");
        assert_eq!(updated["mode"], "roleplay");

        let stored = state
            .storage
            .get("chats", "chat-b")
            .expect("chat should read")
            .expect("chat should remain");
        assert_eq!(stored["mode"], "roleplay");
    }

    #[test]
    fn chat_folder_id_create_and_patch_persist_trimmed_reference() {
        let state = test_state("chat-folder-id-trim");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "conversation" }),
        )
        .expect("folder should be created");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-b", "name": "Folder B", "mode": "conversation" }),
        )
        .expect("second folder should be created");

        let created = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A",
                "mode": "conversation",
                "folderId": " folder-a "
            }),
        )
        .expect("padded folderId create should be accepted and normalized");
        assert_eq!(created["folderId"], "folder-a");

        let updated = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "folderId": " folder-b " }),
        )
        .expect("padded folderId patch should be accepted and normalized");
        assert_eq!(updated["folderId"], "folder-b");

        delete_entity(&state, "chat-folders", "folder-b", false)
            .expect("folder delete should succeed");
        let chat = state
            .storage
            .get("chats", "chat-a")
            .expect("chat should read")
            .expect("chat should remain");
        assert!(chat.get("folderId").is_none_or(Value::is_null));
    }

    #[test]
    fn unfiling_legacy_no_mode_chat_does_not_require_mode() {
        let state = test_state("chat-folder-clear-legacy-no-mode");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "conversation" }),
        )
        .expect("folder should be created");
        state
            .storage
            .replace_all(
                "chats",
                vec![json!({
                    "id": "legacy-chat",
                    "title": "Legacy Chat",
                    "folderId": "folder-a"
                })],
            )
            .expect("legacy chat should seed");

        let updated = storage_update_inner(
            &state,
            "chats".to_string(),
            "legacy-chat".to_string(),
            json!({ "folderId": Value::Null }),
        )
        .expect("clearing folderId should not require mode");
        assert!(updated.get("folderId").is_none_or(Value::is_null));

        let stored = state
            .storage
            .get("chats", "legacy-chat")
            .expect("chat should read")
            .expect("chat should remain");
        assert!(stored.get("folderId").is_none_or(Value::is_null));
    }

    #[test]
    fn filing_legacy_no_mode_chat_still_requires_mode() {
        let state = test_state("chat-folder-assign-legacy-no-mode");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "conversation" }),
        )
        .expect("folder should be created");
        state
            .storage
            .replace_all(
                "chats",
                vec![json!({
                    "id": "legacy-chat",
                    "title": "Legacy Chat"
                })],
            )
            .expect("legacy chat should seed");

        let error = storage_update_inner(
            &state,
            "chats".to_string(),
            "legacy-chat".to_string(),
            json!({ "folderId": "folder-a" }),
        )
        .expect_err("assigning a folder should require provable mode compatibility");
        assert_eq!(error.code, "invalid_input");

        let stored = state
            .storage
            .get("chats", "legacy-chat")
            .expect("chat should read")
            .expect("chat should remain");
        assert!(stored.get("folderId").is_none());
    }

    #[test]
    fn chat_folder_delete_atomic_failure_leaves_folder_and_child_references() {
        let state = test_state("chat-folder-delete-atomic-failure");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A", "mode": "conversation" }),
        )
        .expect("folder should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A",
                "mode": "conversation",
                "folderId": "folder-a"
            }),
        )
        .expect("chat should be created");

        let error = state
            .storage
            .update_collections_atomically(vec!["chat-folders", "chats"], |collections| {
                let (folder_rows, chat_rows) = chat_folder_delete_atomic_rows(collections)?;
                folder_rows.retain(|row| row.get("id").and_then(Value::as_str) != Some("folder-a"));
                if chat_rows
                    .iter()
                    .any(|row| row.get("folderId").and_then(Value::as_str) == Some("folder-a"))
                {
                    return Err(AppError::invalid_input("injected child cleanup failure"));
                }
                Ok(true)
            })
            .expect_err("atomic update failure should roll back both collections");
        assert_eq!(error.code, "invalid_input");

        let folder = state
            .storage
            .get("chat-folders", "folder-a")
            .expect("folder should read")
            .expect("folder should remain after rollback");
        assert_eq!(folder["id"], "folder-a");
        let chat = state
            .storage
            .get("chats", "chat-a")
            .expect("chat should read")
            .expect("chat should remain after rollback");
        assert_eq!(chat["folderId"], "folder-a");
    }

    #[test]
    fn moving_chat_rejects_missing_folder() {
        let state = test_state("chat-folder-missing");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A",
                "mode": "conversation"
            }),
        )
        .expect("chat should be created");

        let error = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "folderId": "missing-folder" }),
        )
        .expect_err("missing folders should be rejected");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn creating_chat_rejects_folder_from_another_mode() {
        let state = test_state("chat-folder-create-mode-mismatch");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "roleplay-folder", "name": "Roleplay", "mode": "roleplay" }),
        )
        .expect("folder should be created");

        let error = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A",
                "mode": "conversation",
                "folderId": "roleplay-folder"
            }),
        )
        .expect_err("folder mode mismatch should reject create");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn creating_folderless_chat_does_not_require_mode_for_folder_validation() {
        let state = test_state("chat-folder-create-folderless-no-mode");
        let created = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A"
            }),
        )
        .expect("folderless chat create should not fail in folder validation");

        assert_eq!(created["id"], "chat-a");
    }

    #[test]
    fn creating_filed_chat_still_requires_mode() {
        let state = test_state("chat-folder-create-filed-no-mode");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "conversation-folder", "name": "Conversation", "mode": "conversation" }),
        )
        .expect("folder should be created");

        let error = storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A",
                "folderId": "conversation-folder"
            }),
        )
        .expect_err("filed chat create should require mode compatibility");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn moving_chat_rejects_folder_from_another_mode() {
        let state = test_state("chat-folder-move-mode-mismatch");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "conversation-folder", "name": "Conversation", "mode": "conversation" }),
        )
        .expect("folder should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "game-chat",
                "title": "Game Chat",
                "mode": "game"
            }),
        )
        .expect("chat should be created");

        let error = storage_update_inner(
            &state,
            "chats".to_string(),
            "game-chat".to_string(),
            json!({ "folderId": "conversation-folder" }),
        )
        .expect_err("folder-only patch should use persisted chat mode");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn moving_chat_accepts_compatible_folder() {
        let state = test_state("chat-folder-move-compatible");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "game-folder", "name": "Game", "mode": "game" }),
        )
        .expect("folder should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "game-chat",
                "title": "Game Chat",
                "mode": "game"
            }),
        )
        .expect("chat should be created");

        let updated = storage_update_inner(
            &state,
            "chats".to_string(),
            "game-chat".to_string(),
            json!({ "folderId": "game-folder" }),
        )
        .expect("compatible folder assignment should succeed");
        assert_eq!(updated["folderId"], "game-folder");
    }

    #[test]
    fn updating_chat_mode_and_folder_validates_post_patch_pair() {
        let state = test_state("chat-folder-mode-folder-patch");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "game-folder", "name": "Game", "mode": "game" }),
        )
        .expect("game folder should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-compatible",
                "title": "Compatible",
                "mode": "conversation"
            }),
        )
        .expect("compatible chat should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-incompatible",
                "title": "Incompatible",
                "mode": "conversation"
            }),
        )
        .expect("incompatible chat should be created");

        let compatible = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-compatible".to_string(),
            json!({ "mode": "game", "folderId": "game-folder" }),
        )
        .expect("post-patch mode and folder should be compatible");
        assert_eq!(compatible["mode"], "game");
        assert_eq!(compatible["folderId"], "game-folder");

        let incompatible = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-incompatible".to_string(),
            json!({ "mode": "roleplay", "folderId": "game-folder" }),
        )
        .expect_err("post-patch mode and folder mismatch should reject");
        assert_eq!(incompatible.code, "invalid_input");
    }

    #[test]
    fn changing_chat_mode_rejects_existing_incompatible_folder() {
        let state = test_state("chat-folder-mode-change-filed");
        storage_create_inner(
            &state,
            "chat-folders".to_string(),
            json!({ "id": "conversation-folder", "name": "Conversation", "mode": "conversation" }),
        )
        .expect("folder should be created");
        storage_create_inner(
            &state,
            "chats".to_string(),
            json!({
                "id": "chat-a",
                "title": "Chat A",
                "mode": "conversation",
                "folderId": "conversation-folder"
            }),
        )
        .expect("chat should be created");

        let error = storage_update_inner(
            &state,
            "chats".to_string(),
            "chat-a".to_string(),
            json!({ "mode": "game" }),
        )
        .expect_err("mode-only patch should validate existing folder");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn reordering_connection_folders_requires_each_folder_once() {
        let state = test_state("connection-folder-reorder-validate");
        storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({ "id": "folder-a", "name": "Folder A" }),
        )
        .expect("first folder should be created");
        storage_create_inner(
            &state,
            "connection-folders".to_string(),
            json!({ "id": "folder-b", "name": "Folder B" }),
        )
        .expect("second folder should be created");

        let duplicate_error = connection_folder_reorder_inner(
            &state,
            vec!["folder-a".to_string(), "folder-a".to_string()],
        )
        .expect_err("duplicate folder ids should reject the reorder");
        assert_eq!(duplicate_error.code, "invalid_input");

        let missing_error = connection_folder_reorder_inner(&state, vec!["folder-a".to_string()])
            .expect_err("omitted folders should reject the reorder");
        assert_eq!(missing_error.code, "invalid_input");

        let folder_b = state
            .storage
            .get("connection-folders", "folder-b")
            .expect("folder should read")
            .expect("folder should exist");
        assert_eq!(folder_b["sortOrder"], 0);
        assert_eq!(folder_b["order"], 0);
    }
}
