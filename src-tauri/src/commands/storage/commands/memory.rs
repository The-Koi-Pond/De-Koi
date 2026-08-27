use super::{canonical_memory, memory_capture, memory_maintenance};
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub fn memory_create(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    canonical_memory::create_memory(&state, body)
}

#[tauri::command]
pub fn memory_get(state: State<'_, AppState>, memory_id: String) -> Result<Value, AppError> {
    canonical_memory::get_memory(&state, &memory_id)
}

#[tauri::command]
pub fn memory_update(
    state: State<'_, AppState>,
    memory_id: String,
    patch: Value,
) -> Result<Value, AppError> {
    canonical_memory::update_memory(&state, &memory_id, patch)
}

#[tauri::command]
pub fn memory_delete(state: State<'_, AppState>, memory_id: String) -> Result<Value, AppError> {
    canonical_memory::delete_memory(&state, &memory_id)
}

#[tauri::command]
pub fn memory_query(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    canonical_memory::query_memories(&state, body)
}

#[tauri::command]
pub fn memory_query_batch(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    canonical_memory::query_memories_batch(&state, body)
}

#[tauri::command]
pub async fn memory_query_semantic(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    canonical_memory::query_memories_semantic(&state, body).await
}

#[tauri::command]
pub fn memory_index_upsert(state: State<'_, AppState>, row: Value) -> Result<Value, AppError> {
    canonical_memory::upsert_memory_index_row(&state, row)
}

#[tauri::command]
pub fn memory_index_delete_for_memory(
    state: State<'_, AppState>,
    memory_id: String,
) -> Result<Value, AppError> {
    canonical_memory::delete_memory_index_rows_for_memory(&state, &memory_id)
}

#[tauri::command]
pub fn memory_index_rebuild_lexical(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    canonical_memory::rebuild_memory_lexical_index(&state, body)
}

#[tauri::command]
pub fn memory_index_health(state: State<'_, AppState>) -> Result<Value, AppError> {
    canonical_memory::memory_index_health(&state)
}

#[tauri::command]
pub fn memory_index_query(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    canonical_memory::query_memory_index(&state, body)
}

#[tauri::command]
pub fn memory_index_query_batch(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    canonical_memory::query_memory_index_batch(&state, body)
}

#[tauri::command]
pub async fn memory_cleanup_apply(
    state: State<'_, AppState>,
    body: Value,
    lease_id: Option<String>,
) -> Result<Value, AppError> {
    memory_maintenance::apply_memory_cleanup(&state, body, lease_id.as_deref()).await
}

#[tauri::command]
pub fn memory_maintenance_worker_acquire(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_maintenance::acquire_memory_maintenance_worker(&state, body)
}

#[tauri::command]
pub fn memory_maintenance_worker_release(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_maintenance::release_memory_maintenance_worker(&state, body)
}

#[tauri::command]
pub fn memory_maintenance_job_update(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_maintenance::update_memory_maintenance_job(&state, body)
}

#[tauri::command]
pub fn memory_capture_worker_acquire(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::acquire_worker(&state, body)
}

#[tauri::command]
pub fn memory_capture_worker_release(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::release_worker(&state, body)
}

#[tauri::command]
pub fn memory_capture_job_update(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::update_job(&state, body)
}

#[tauri::command]
pub fn story_consolidation_job_update(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::update_story_job(&state, body)
}

#[tauri::command]
pub fn story_consolidation_projection_commit(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::commit_story_projection(&state, body)
}

#[tauri::command]
pub fn memory_capture_memory_create(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::create_memory(&state, body)
}

#[tauri::command]
pub fn memory_capture_memory_update(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::update_memory(&state, body)
}

#[tauri::command]
pub fn memory_capture_message_extra_patch(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::patch_message_extra(&state, body)
}

#[tauri::command]
pub fn memory_capture_index_rebuild(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    memory_capture::rebuild_index(&state, body)
}

#[tauri::command]
pub fn memory_cleanup_undo(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    memory_maintenance::undo_memory_cleanup(&state, body)
}
