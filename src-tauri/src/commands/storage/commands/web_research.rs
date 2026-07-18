use super::web_research;
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn character_web_search(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    web_research::search(&state, body).await
}

#[tauri::command]
pub async fn character_web_read_page(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    web_research::read_page(&state, body).await
}
