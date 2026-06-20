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
