use super::canonical_memory;
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
pub fn memory_index_query(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    canonical_memory::query_memory_index(&state, body)
}

#[tauri::command]
pub fn memory_index_query_batch(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    canonical_memory::query_memory_index_batch(&state, body)
}
