use marinara_core::{AppError, AppResult};
use serde_json::Value;
use std::fs;
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn parse_collection_rows(collection: &str, raw: &str) -> AppResult<Vec<Value>> {
    let parsed: Value = serde_json::from_str(raw)?;
    match parsed {
        Value::Array(rows) => Ok(rows),
        _ => Err(AppError::invalid_input(format!(
            "Collection {collection} did not contain a JSON array"
        ))),
    }
}

pub(crate) fn parse_collection_file(collection: &str, path: &Path) -> AppResult<Vec<Value>> {
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    parse_collection_rows(collection, &raw)
}

pub(crate) fn backup_path_for(path: &Path) -> AppResult<PathBuf> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::invalid_input("Invalid collection path"))?;
    Ok(path.with_file_name(format!("{file_name}.bak")))
}

pub(crate) fn unique_sibling_path(path: &Path, suffix: &str) -> AppResult<PathBuf> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::invalid_input("Invalid collection path"))?;
    let nonce = storage_transaction_id();
    Ok(path.with_file_name(format!("{file_name}.{suffix}-{nonce}")))
}

pub(crate) fn looks_nul_filled(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut byte = [0_u8; 1];
    matches!(file.read(&mut byte), Ok(0)) || matches!(byte.first(), Some(0))
}

pub(crate) fn refresh_collection_backup(path: &Path) -> AppResult<()> {
    if !path.exists() || looks_nul_filled(path) {
        return Ok(());
    }
    let backup = backup_path_for(path)?;
    let backup_tmp = unique_sibling_path(&backup, "tmp")?;
    fs::copy(path, &backup_tmp)?;
    sync_file(&backup_tmp)?;
    fs::rename(&backup_tmp, backup)?;
    Ok(())
}

pub(crate) fn preserve_corrupt_file(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    let target = unique_sibling_path(path, "corrupted")?;
    fs::rename(path, target)?;
    Ok(())
}

pub(crate) fn write_file_atomically(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = unique_sibling_path(path, "tmp")?;
    fs::write(&tmp, bytes)?;
    sync_file(&tmp)?;
    fs::rename(tmp, path)?;
    Ok(())
}

pub(crate) fn stage_append_to_collection_file(
    path: &Path,
    tmp: &Path,
    rows: &[Value],
) -> AppResult<bool> {
    if looks_nul_filled(path) {
        return Ok(false);
    }

    let mut file = fs::File::open(path)?;
    let mut cursor = file.metadata()?.len();
    let mut byte = [0_u8; 1];
    let mut found_non_whitespace = false;
    while cursor > 0 {
        cursor -= 1;
        file.seek(SeekFrom::Start(cursor))?;
        file.read_exact(&mut byte)?;
        if !byte[0].is_ascii_whitespace() {
            found_non_whitespace = true;
            break;
        }
    }
    if !found_non_whitespace || byte[0] != b']' {
        return Ok(false);
    }

    let mut before_close = cursor;
    let mut is_empty = false;
    let mut found_array_prefix = false;
    while before_close > 0 {
        before_close -= 1;
        file.seek(SeekFrom::Start(before_close))?;
        file.read_exact(&mut byte)?;
        if byte[0].is_ascii_whitespace() {
            continue;
        }
        is_empty = byte[0] == b'[';
        found_array_prefix = true;
        break;
    }
    if !found_array_prefix {
        return Ok(false);
    }

    let mut source = fs::File::open(path)?;
    let mut output = fs::File::create(tmp)?;
    std::io::copy(&mut Read::by_ref(&mut source).take(cursor), &mut output)?;
    for (index, row) in rows.iter().enumerate() {
        let serialized = serde_json::to_string_pretty(row)?;
        let indented = serialized
            .lines()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        if is_empty && index == 0 {
            output.write_all(format!("\n{indented}").as_bytes())?;
        } else {
            output.write_all(format!(",\n{indented}").as_bytes())?;
        }
    }
    output.write_all(b"\n]\n")?;
    output.sync_all()?;
    Ok(true)
}

pub(crate) fn sync_file(path: &Path) -> AppResult<()> {
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?
        .sync_all()?;
    Ok(())
}

pub(crate) struct PendingCollectionReplacement {
    pub(crate) path: PathBuf,
    pub(crate) tmp: PathBuf,
    pub(crate) backup: PathBuf,
    pub(crate) existed: bool,
}

pub(crate) fn rollback_collection_replacements(
    pending: &[PendingCollectionReplacement],
    backed_up: &[usize],
    installed: &[usize],
) -> AppResult<()> {
    let mut first_error = None;
    for index in installed.iter().rev() {
        if let Err(error) = remove_path_if_exists(&pending[*index].path) {
            first_error.get_or_insert(error);
        }
    }
    for index in backed_up.iter().rev() {
        let item = &pending[*index];
        match path_exists_no_follow(&item.backup) {
            Ok(true) => {}
            Ok(false) => continue,
            Err(error) => {
                first_error.get_or_insert(error);
                continue;
            }
        }
        if let Err(error) = fs::rename(&item.backup, &item.path) {
            first_error.get_or_insert(AppError::from(error));
        }
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    Ok(())
}

pub(crate) fn cleanup_pending_collection_temps(pending: &[PendingCollectionReplacement]) {
    for item in pending {
        let _ = remove_path_if_exists(&item.tmp);
    }
}

pub(crate) fn cleanup_pending_collection_transaction_files(
    pending: &[PendingCollectionReplacement],
) {
    for item in pending {
        let _ = remove_path_if_exists(&item.tmp);
        let _ = remove_path_if_exists(&item.backup);
    }
}

pub(crate) fn collection_transaction_path(
    path: &Path,
    transaction_id: &str,
    index: usize,
    kind: &str,
) -> AppResult<PathBuf> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::invalid_input("Invalid collection path"))?;
    Ok(path.with_file_name(format!(
        "{file_name}.profile-import-{transaction_id}-{index}.{kind}"
    )))
}

pub(crate) fn storage_transaction_id() -> String {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}-{nonce}", std::process::id())
}

pub(crate) fn path_exists_no_follow(path: &Path) -> AppResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn remove_path_if_exists(path: &Path) -> AppResult<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}
