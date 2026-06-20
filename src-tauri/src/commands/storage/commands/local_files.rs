use marinara_core::AppError;
use serde_json::{json, Value};

#[tauri::command]
pub fn local_text_file_save(path: String, content: String) -> Result<Value, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("Save path is required"));
    }
    std::fs::write(trimmed, content).map_err(AppError::from)?;
    Ok(json!({ "saved": true, "path": trimmed }))
}
