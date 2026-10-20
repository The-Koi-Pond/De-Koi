use super::updates;
use marinara_core::AppError;
use serde_json::Value;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn updater_configured(app: &tauri::AppHandle) -> bool {
    crate::desktop_updater::is_configured(app.config())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn updater_configured(_app: &tauri::AppHandle) -> bool {
    false
}

#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<Value, AppError> {
    updates::check_updates(updater_configured(&app)).await
}

#[tauri::command]
pub async fn update_apply(app: tauri::AppHandle, input: Option<Value>) -> Result<Value, AppError> {
    let input = input.unwrap_or(Value::Null);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if updater_configured(&app) {
        return crate::desktop_updater::apply_from_command(&app, &input).await;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = app;
    updates::apply_update(input)
}
