use super::super::*;
use super::*;
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io;
use std::path::{Path, PathBuf};

pub(super) const ST_BACKGROUND_EXTENSIONS: &[&str] =
    &[".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"];
const MAX_BACKGROUND_FILENAME_ATTEMPTS: usize = 10_000;

pub(super) fn copy_background_file(state: &AppState, path: &Path) -> AppResult<Value> {
    copy_background_file_with_attempts(state, path, MAX_BACKGROUND_FILENAME_ATTEMPTS)
}

pub(super) fn copy_background_file_with_attempts(
    state: &AppState,
    path: &Path,
    max_attempts: usize,
) -> AppResult<Value> {
    if !has_allowed_extension(path, ST_BACKGROUND_EXTENSIONS) {
        return Err(AppError::invalid_input(
            "Background import only supports image files",
        ));
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| AppError::invalid_input("Background file is missing a filename"))?;
    let root = state.backgrounds.root();
    for attempt in 0..max_attempts {
        let final_target = background_candidate_path(root, &name, attempt);
        let mut target_file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&final_target)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(AppError::from(error)),
        };
        let mut source_file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) => {
                let _ = std::fs::remove_file(&final_target);
                return Err(AppError::from(error));
            }
        };
        if let Err(error) = io::copy(&mut source_file, &mut target_file) {
            let _ = std::fs::remove_file(&final_target);
            return Err(AppError::from(error));
        }
        return Ok(json!({ "success": true, "path": final_target.to_string_lossy() }));
    }
    Err(AppError::invalid_input(
        "Could not find an unused background filename",
    ))
}

fn background_candidate_path(root: &Path, name: &str, attempt: usize) -> PathBuf {
    if attempt == 0 {
        return root.join(name);
    }
    let stem = Path::new(name)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "background".to_string());
    let ext = Path::new(name)
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy()))
        .unwrap_or_default();
    root.join(format!("{stem}-{attempt}{ext}"))
}

fn has_allowed_extension(path: &Path, extensions: &[&str]) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{}", ext.to_ascii_lowercase()))
        .unwrap_or_default();
    extensions.iter().any(|allowed| *allowed == ext)
}
