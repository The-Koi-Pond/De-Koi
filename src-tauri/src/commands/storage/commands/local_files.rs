use base64::{engine::general_purpose, Engine as _};
use marinara_core::AppError;
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;

fn ensure_save_path(path: &str) -> Result<&str, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("Save path is required"));
    }
    Ok(trimmed)
}

#[tauri::command]
pub fn local_file_save(path: String, base64: String, append: Option<bool>) -> Result<Value, AppError> {
    let trimmed = ensure_save_path(&path)?;
    let bytes = general_purpose::STANDARD.decode(base64.trim()).map_err(|error| {
        AppError::invalid_input(format!("Saved file content is not valid base64: {error}"))
    })?;
    let should_append = append.unwrap_or(false);
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(should_append)
        .truncate(!should_append)
        .open(trimmed)
        .map_err(AppError::from)?;
    file.write_all(&bytes).map_err(AppError::from)?;
    Ok(json!({ "saved": true, "path": trimmed }))
}
