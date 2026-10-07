use super::background_jobs;
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub fn background_job_enqueue(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    background_jobs::enqueue(&state, body)
}

#[tauri::command]
pub fn background_job_claim(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    background_jobs::claim(&state, body)
}

#[tauri::command]
pub fn background_job_finish(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    background_jobs::finish(&state, body)
}

#[tauri::command]
pub fn background_worker_acquire(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    background_jobs::acquire_worker(&state, body)
}

#[tauri::command]
pub fn background_worker_release(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    background_jobs::release_worker(&state, body)
}
