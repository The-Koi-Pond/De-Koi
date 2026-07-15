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

#[tauri::command]
pub fn extension_remove(
    state: State<'_, AppState>,
    extension_id: String,
    data_policy: String,
) -> Result<Value, AppError> {
    customization::extension_remove(&state, &extension_id, &data_policy)
}

#[tauri::command]
pub fn extension_retained_data_list(state: State<'_, AppState>) -> Result<Value, AppError> {
    customization::extension_retained_data_list(&state)
}

#[tauri::command]
pub fn extension_reconnect_data(
    state: State<'_, AppState>,
    extension_id: String,
    retention_id: String,
) -> Result<Value, AppError> {
    customization::extension_reconnect_data(&state, &extension_id, &retention_id)
}

#[tauri::command]
pub fn extension_retained_data_purge(
    state: State<'_, AppState>,
    retention_id: String,
) -> Result<Value, AppError> {
    customization::extension_retained_data_purge(&state, &retention_id)
}
