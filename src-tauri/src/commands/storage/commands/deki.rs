use super::deki;
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn deki_prompt(
    state: State<'_, AppState>,
    request: Value,
) -> Result<Value, AppError> {
    deki::deki_prompt(&state, request).await
}

#[tauri::command]
pub async fn professor_mari_prompt(
    state: State<'_, AppState>,
    request: Value,
) -> Result<Value, AppError> {
    deki::deki_prompt(&state, request).await
}

#[tauri::command]
pub async fn deki_workspace_status(
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Value, AppError> {
    deki::deki_workspace_status(&state, connection_id).await
}

#[tauri::command]
pub async fn deki_workspace_abort(state: State<'_, AppState>) -> Result<Value, AppError> {
    deki::deki_workspace_abort(&state).await
}

#[tauri::command]
pub async fn deki_workspace_approve(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, AppError> {
    deki::deki_workspace_approve(&state, id).await
}

#[tauri::command]
pub async fn deki_workspace_reject(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, AppError> {
    deki::deki_workspace_reject(&state, id).await
}
