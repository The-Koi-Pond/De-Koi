use super::fanfic_research;
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn fanfic_web_research(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    fanfic_research::research(&state, body).await
}
