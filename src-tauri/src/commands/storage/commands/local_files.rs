use base64::{engine::general_purpose, Engine as _};
use marinara_core::AppError;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

fn ensure_save_path(path: &str) -> Result<&str, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("Save path is required"));
    }
    Ok(trimmed)
}

fn ensure_session_id(session_id: &str) -> Result<&str, AppError> {
    let trimmed = session_id.trim();
    if trimmed.is_empty()
        || !trimmed
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AppError::invalid_input("Save session id is invalid"));
    }
    Ok(trimmed)
}

fn temp_save_path(path: &Path, session_id: &str) -> Result<PathBuf, AppError> {
    let filename = path
        .file_name()
        .ok_or_else(|| AppError::invalid_input("Save path must include a file name"))?;
    let mut temp_filename = OsString::from(".");
    temp_filename.push(filename);
    temp_filename.push(".");
    temp_filename.push(session_id);
    temp_filename.push(".tmp");
    Ok(path.with_file_name(temp_filename))
}

fn backup_save_path(path: &Path, session_id: &str) -> Result<PathBuf, AppError> {
    let filename = path
        .file_name()
        .ok_or_else(|| AppError::invalid_input("Save path must include a file name"))?;
    let mut backup_filename = OsString::from(".");
    backup_filename.push(filename);
    backup_filename.push(".");
    backup_filename.push(session_id);
    backup_filename.push(".backup");
    Ok(path.with_file_name(backup_filename))
}

fn commit_temp_save(
    temp_path: &Path,
    target_path: &Path,
    session_id: &str,
) -> Result<(), AppError> {
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(AppError::from)?;
    }

    let backup_path = backup_save_path(target_path, session_id)?;
    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }

    let had_target = target_path.exists();
    if had_target {
        fs::rename(target_path, &backup_path).map_err(AppError::from)?;
    }

    match fs::rename(temp_path, target_path) {
        Ok(()) => {
            if had_target {
                let _ = fs::remove_file(&backup_path);
            }
            Ok(())
        }
        Err(error) => {
            if had_target {
                let _ = fs::rename(&backup_path, target_path);
            }
            Err(AppError::from(error))
        }
    }
}

#[tauri::command]
pub fn local_file_save(
    path: String,
    base64: String,
    session_id: String,
    append: Option<bool>,
    complete: Option<bool>,
) -> Result<Value, AppError> {
    let trimmed = ensure_save_path(&path)?;
    let session_id = ensure_session_id(&session_id)?;
    let target_path = PathBuf::from(trimmed);
    let temp_path = temp_save_path(&target_path, session_id)?;
    let bytes = general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|error| {
            AppError::invalid_input(format!("Saved file content is not valid base64: {error}"))
        })?;
    let should_append = append.unwrap_or(false);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent).map_err(AppError::from)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(should_append)
        .truncate(!should_append)
        .open(&temp_path)
        .map_err(AppError::from)?;
    file.write_all(&bytes).map_err(AppError::from)?;
    file.flush().map_err(AppError::from)?;
    drop(file);
    if complete.unwrap_or(false) {
        commit_temp_save(&temp_path, &target_path, session_id)?;
    }
    Ok(json!({ "saved": true, "path": trimmed }))
}

#[tauri::command]
pub fn local_file_save_cleanup(path: String, session_id: String) -> Result<Value, AppError> {
    let trimmed = ensure_save_path(&path)?;
    let session_id = ensure_session_id(&session_id)?;
    let target_path = PathBuf::from(trimmed);
    let temp_path = temp_save_path(&target_path, session_id)?;
    match fs::remove_file(&temp_path) {
        Ok(()) => Ok(json!({ "cleaned": true })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(json!({ "cleaned": false }))
        }
        Err(error) => Err(AppError::from(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempRoot(PathBuf);

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_root(label: &str) -> TempRoot {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("de-koi-local-file-save-{label}-{nonce}"));
        fs::create_dir_all(&root).expect("temp root should be created");
        TempRoot(root)
    }

    #[test]
    fn chunked_save_commits_exact_bytes_on_final_chunk() {
        let root = temp_root("commit");
        let target = root.0.join("export.bin");
        let target_string = target.to_string_lossy().to_string();

        local_file_save(
            target_string.clone(),
            general_purpose::STANDARD.encode(b"abc"),
            "session-1".to_string(),
            Some(false),
            Some(false),
        )
        .expect("first chunk should write to temp");
        assert!(
            !target.exists(),
            "destination should not exist before commit"
        );

        local_file_save(
            target_string,
            general_purpose::STANDARD.encode(b"def"),
            "session-1".to_string(),
            Some(true),
            Some(true),
        )
        .expect("final chunk should commit");

        assert_eq!(
            fs::read(&target).expect("target should be readable"),
            b"abcdef"
        );
        assert!(
            !temp_save_path(&target, "session-1")
                .expect("temp path should be valid")
                .exists(),
            "temp file should be renamed away"
        );
    }

    #[test]
    fn cleanup_removes_temp_without_touching_existing_destination() {
        let root = temp_root("cleanup");
        let target = root.0.join("export.bin");
        let target_string = target.to_string_lossy().to_string();
        fs::write(&target, b"original").expect("original destination should be written");

        local_file_save(
            target_string.clone(),
            general_purpose::STANDARD.encode(b"partial"),
            "session-2".to_string(),
            Some(false),
            Some(false),
        )
        .expect("partial chunk should write to temp");

        local_file_save_cleanup(target_string, "session-2".to_string())
            .expect("cleanup should remove temp");

        assert_eq!(
            fs::read(&target).expect("target should be readable"),
            b"original"
        );
        assert!(
            !temp_save_path(&target, "session-2")
                .expect("temp path should be valid")
                .exists(),
            "temp file should be removed"
        );
    }

    #[test]
    fn successful_commit_replaces_existing_destination() {
        let root = temp_root("replace");
        let target = root.0.join("export.bin");
        let target_string = target.to_string_lossy().to_string();
        fs::write(&target, b"original").expect("original destination should be written");

        local_file_save(
            target_string,
            general_purpose::STANDARD.encode(b"replacement"),
            "session-3".to_string(),
            Some(false),
            Some(true),
        )
        .expect("complete save should replace existing destination");

        assert_eq!(
            fs::read(&target).expect("target should be readable"),
            b"replacement"
        );
    }
}
