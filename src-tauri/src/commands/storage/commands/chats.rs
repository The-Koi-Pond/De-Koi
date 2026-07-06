use super::{chat_memory, chats, shared};
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub fn chat_memories_list(
    state: State<'_, AppState>,
    chat_id: String,
    limit: Option<u32>,
    order: Option<String>,
    exclude_recent_message_ids: Option<Vec<String>>,
    exclude_recent_start_at: Option<String>,
) -> Result<Value, AppError> {
    let exclude_recent_message_ids = exclude_recent_message_ids.unwrap_or_default();
    chat_memory::list_chat_memories_excluding_recent(
        &state,
        &chat_id,
        limit.map(|value| value as usize),
        order.as_deref(),
        &exclude_recent_message_ids,
        exclude_recent_start_at.as_deref(),
    )
}

#[tauri::command]
pub fn chat_memory_delete(
    state: State<'_, AppState>,
    chat_id: String,
    memory_id: String,
) -> Result<Value, AppError> {
    chat_memory::delete_chat_memory(&state, &chat_id, &memory_id)
}

#[tauri::command]
pub async fn chat_memory_update(
    state: State<'_, AppState>,
    chat_id: String,
    memory_id: String,
    body: Value,
) -> Result<Value, AppError> {
    chat_memory::update_chat_memory(&state, &chat_id, &memory_id, body).await
}

#[tauri::command]
pub fn chat_memory_soft_delete(
    state: State<'_, AppState>,
    chat_id: String,
    memory_id: String,
) -> Result<Value, AppError> {
    chat_memory::soft_delete_chat_memory(&state, &chat_id, &memory_id)
}

#[tauri::command]
pub async fn chat_memory_restore(
    state: State<'_, AppState>,
    chat_id: String,
    memory_id: String,
) -> Result<Value, AppError> {
    chat_memory::restore_chat_memory(&state, &chat_id, &memory_id).await
}

#[tauri::command]
pub fn chat_memory_pin(
    state: State<'_, AppState>,
    chat_id: String,
    memory_id: String,
    pinned: bool,
) -> Result<Value, AppError> {
    chat_memory::pin_chat_memory(&state, &chat_id, &memory_id, pinned)
}

#[tauri::command]
pub async fn chat_memory_correct(
    state: State<'_, AppState>,
    chat_id: String,
    memory_id: String,
    body: Value,
) -> Result<Value, AppError> {
    chat_memory::correct_chat_memory(&state, &chat_id, &memory_id, body).await
}
#[tauri::command]
pub fn chat_memories_clear(state: State<'_, AppState>, chat_id: String) -> Result<Value, AppError> {
    chat_memory::clear_chat_memories(&state, &chat_id)
}

#[tauri::command]
pub async fn chat_memories_refresh(
    state: State<'_, AppState>,
    chat_id: String,
    source_message_ids: Option<Vec<String>>,
) -> Result<Value, AppError> {
    chat_memory::refresh_chat_memories_for_source_messages(
        &state,
        &chat_id,
        source_message_ids.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
pub async fn chat_memories_migrate(
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<Value, AppError> {
    chat_memory::migrate_chat_memories(&state, &chat_id).await
}

#[tauri::command]
pub async fn chat_memory_indexes_rebuild(
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<Value, AppError> {
    chat_memory::rebuild_chat_memory_indexes(&state, &chat_id).await
}
#[tauri::command]
pub fn chat_memories_export(
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<Value, AppError> {
    chat_memory::export_chat_memories(&state, &chat_id)
}

#[tauri::command]
pub async fn chat_memories_import(
    state: State<'_, AppState>,
    chat_id: String,
    body: Value,
    replace: Option<bool>,
) -> Result<Value, AppError> {
    chat_memory::import_chat_memories(&state, &chat_id, body, replace).await
}

#[tauri::command]
pub fn chat_notes_list(state: State<'_, AppState>, chat_id: String) -> Result<Value, AppError> {
    chats::list_chat_notes(&state, &chat_id)
}

#[tauri::command]
pub fn chat_note_delete(
    state: State<'_, AppState>,
    chat_id: String,
    note_id: String,
) -> Result<Value, AppError> {
    chats::delete_chat_note(&state, &chat_id, &note_id)
}

#[tauri::command]
pub fn chat_notes_clear(state: State<'_, AppState>, chat_id: String) -> Result<Value, AppError> {
    chats::clear_chat_notes(&state, &chat_id)
}

#[tauri::command]
pub async fn chat_group_delete(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || chats::delete_chat_group(&state, &group_id))
        .await
        .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

#[tauri::command]
pub fn chat_autonomous_unread_mark(
    state: State<'_, AppState>,
    chat_id: String,
    body: Value,
) -> Result<Value, AppError> {
    chats::mark_autonomous_unread(&state, &chat_id, body)
}

#[tauri::command]
pub fn chat_autonomous_unread_clear(
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<Value, AppError> {
    chats::clear_autonomous_unread(&state, &chat_id)
}

#[tauri::command]
pub fn chat_messages_bulk_delete(
    state: State<'_, AppState>,
    chat_id: String,
    message_ids: Vec<String>,
) -> Result<Value, AppError> {
    chats::bulk_delete_messages(&state, &chat_id, json!({ "messageIds": message_ids }))
}

#[tauri::command]
pub fn chat_message_count(state: State<'_, AppState>, chat_id: String) -> Result<Value, AppError> {
    Ok(json!({ "count": state.storage.count_messages_for_chat(&chat_id)? }))
}

#[tauri::command]
pub fn chat_branch(
    state: State<'_, AppState>,
    chat_id: String,
    up_to_message_id: Option<String>,
) -> Result<Value, AppError> {
    chats::branch_chat(
        &state,
        &chat_id,
        json!({ "upToMessageId": up_to_message_id }),
    )
}

#[tauri::command]
pub fn chat_message_swipes(
    state: State<'_, AppState>,
    chat_id: String,
    message_id: String,
) -> Result<Value, AppError> {
    chats::message_swipes(&state, "GET", &chat_id, &message_id, Value::Null)
}

#[tauri::command]
pub fn chat_message_add_swipe(
    state: State<'_, AppState>,
    chat_id: String,
    message_id: String,
    body: Value,
) -> Result<Value, AppError> {
    Ok(shared::project_timeline_message(chats::message_swipes(
        &state,
        "POST",
        &chat_id,
        &message_id,
        body,
    )?))
}

#[tauri::command]
pub fn chat_message_update_content_if_unchanged(
    state: State<'_, AppState>,
    chat_id: String,
    message_id: String,
    expected_content: String,
    content: String,
) -> Result<Value, AppError> {
    chats::update_message_content_if_unchanged(
        &state,
        &chat_id,
        &message_id,
        &expected_content,
        &content,
    )
}

#[tauri::command]
pub async fn chat_message_set_active_swipe(
    state: State<'_, AppState>,
    chat_id: String,
    message_id: String,
    index: i64,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(shared::project_timeline_message(chats::set_active_swipe(
            &state,
            &chat_id,
            &message_id,
            json!({ "index": index }),
        )?))
    })
    .await
    .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

#[tauri::command]
pub fn chat_message_delete_swipe(
    state: State<'_, AppState>,
    chat_id: String,
    message_id: String,
    index: String,
) -> Result<Value, AppError> {
    Ok(shared::project_timeline_message(chats::delete_swipe(
        &state,
        &chat_id,
        &message_id,
        &index,
    )?))
}

#[tauri::command]
pub async fn chat_evict_prompt_snapshots(
    state: State<'_, AppState>,
    chat_id: String,
    keep_last: Option<i64>,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let keep_last = keep_last.unwrap_or(2).max(0) as usize;
        chats::evict_prompt_snapshots(&state, &chat_id, keep_last)
    })
    .await
    .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

#[tauri::command]
pub fn chat_connect(
    state: State<'_, AppState>,
    chat_id: String,
    target_chat_id: String,
) -> Result<Value, AppError> {
    chats::connect_chats(&state, &chat_id, &target_chat_id)
}

#[tauri::command]
pub fn chat_disconnect(state: State<'_, AppState>, chat_id: String) -> Result<Value, AppError> {
    chats::disconnect_connected_chat(&state, &chat_id)
}
