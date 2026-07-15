use super::customization;
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub fn theme_set_active(
    state: State<'_, AppState>,
    theme_id: Option<String>,
) -> Result<Value, AppError> {
    customization::theme_set_active(&state, theme_id.as_deref())
}
