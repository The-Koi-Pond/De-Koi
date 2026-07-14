use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(test)]
pub(crate) type AppendApplyTestHook = Box<dyn FnMut(&Path) -> AppResult<()> + Send + 'static>;

#[cfg(test)]
pub(crate) static APPEND_APPLY_TEST_HOOK: std::sync::Mutex<Option<AppendApplyTestHook>> =
    std::sync::Mutex::new(None);

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

pub(crate) fn can_append_to_collection_file(path: &Path) -> AppResult<bool> {
    if !path.exists() || fs::metadata(path)?.len() == 0 {
        return Ok(true);
    }
    if looks_nul_filled(path) {
        return Ok(false);
    }
    let mut file = fs::File::open(path)?;
    let mut cursor = file.metadata()?.len();
    let mut byte = [0_u8; 1];
    while cursor > 0 {
        cursor -= 1;
        file.seek(SeekFrom::Start(cursor))?;
        file.read_exact(&mut byte)?;
        if !byte[0].is_ascii_whitespace() {
            return Ok(byte[0] == b']');
        }
    }
    Ok(false)
}

pub(crate) fn append_to_collection_file_in_place(path: &Path, rows: &[Value]) -> AppResult<bool> {
    #[cfg(test)]
    {
        let mut hook = APPEND_APPLY_TEST_HOOK
            .lock()
            .map_err(|_| AppError::new("lock_error", "Append apply test hook lock poisoned"))?;
        if let Some(hook) = hook.as_mut() {
            hook(path)?;
        }
    }
    if rows.is_empty() {
        return Ok(true);
    }
    if !path.exists() || fs::metadata(path)?.len() == 0 {
        fs::write(path, serde_json::to_vec_pretty(rows)?)?;
        sync_file(path)?;
        return Ok(true);
    }
    if looks_nul_filled(path) {
        return Ok(false);
    }

    let mut file = fs::OpenOptions::new().read(true).write(true).open(path)?;
    let mut cursor = file.metadata()?.len();
    let mut byte = [0_u8; 1];
    let mut found_close = false;
    while cursor > 0 {
        cursor -= 1;
        file.seek(SeekFrom::Start(cursor))?;
        file.read_exact(&mut byte)?;
        if !byte[0].is_ascii_whitespace() {
            found_close = byte[0] == b']';
            break;
        }
    }
    if !found_close {
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

    file.seek(SeekFrom::Start(cursor))?;
    for (index, row) in rows.iter().enumerate() {
        let serialized = serde_json::to_string_pretty(row)?;
        let indented = serialized
            .lines()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        if is_empty && index == 0 {
            file.write_all(format!("\n{indented}").as_bytes())?;
        } else {
            file.write_all(format!(",\n{indented}").as_bytes())?;
        }
    }
    file.write_all(b"\n]\n")?;
    let end = file.stream_position()?;
    file.set_len(end)?;
    file.sync_all()?;
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

const COLLECTION_TRANSACTION_MANIFEST_VERSION: u8 = 1;
const COLLECTION_TRANSACTION_MANIFEST_PREFIX: &str = ".collection-transaction-";
const COLLECTION_TRANSACTION_MANIFEST_SUFFIX: &str = ".json";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CollectionTransactionPhase {
    Prepared,
    Committed,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct CollectionTransactionManifest {
    pub(crate) version: u8,
    pub(crate) phase: CollectionTransactionPhase,
    pub(crate) entries: Vec<CollectionTransactionManifestEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct CollectionTransactionManifestEntry {
    pub(crate) primary: String,
    pub(crate) staged: String,
    pub(crate) backup: String,
    pub(crate) existed: bool,
}

struct ResolvedCollectionTransactionEntry {
    primary: PathBuf,
    staged: PathBuf,
    backup: PathBuf,
    existed: bool,
}

fn transaction_recovery_error(message: impl Into<String>, manifest_path: &Path) -> AppError {
    let message = message.into();
    AppError::with_details(
        "storage_transaction_recovery_required",
        message.clone(),
        serde_json::json!({
            "manifestPath": manifest_path.display().to_string(),
            "reason": message,
        }),
    )
}

fn manifest_child_path(
    collections_dir: &Path,
    name: &str,
    manifest_path: &Path,
) -> AppResult<PathBuf> {
    let mut components = Path::new(name).components();
    let valid = matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
        && !name.is_empty();
    if !valid {
        return Err(transaction_recovery_error(
            format!("Transaction manifest contains an invalid collection artifact name: {name}"),
            manifest_path,
        ));
    }
    Ok(collections_dir.join(name))
}

fn manifest_file_name(transaction_id: &str) -> String {
    format!(
        "{COLLECTION_TRANSACTION_MANIFEST_PREFIX}{transaction_id}{COLLECTION_TRANSACTION_MANIFEST_SUFFIX}"
    )
}

fn manifest_transaction_id(manifest_path: &Path) -> AppResult<&str> {
    let name = manifest_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| transaction_recovery_error("Invalid transaction manifest name", manifest_path))?;
    let transaction_id = name
        .strip_prefix(COLLECTION_TRANSACTION_MANIFEST_PREFIX)
        .and_then(|value| value.strip_suffix(COLLECTION_TRANSACTION_MANIFEST_SUFFIX))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| transaction_recovery_error("Invalid transaction manifest name", manifest_path))?;
    Ok(transaction_id)
}

fn resolve_collection_transaction_entries(
    collections_dir: &Path,
    manifest_path: &Path,
    entries: &[CollectionTransactionManifestEntry],
) -> AppResult<Vec<ResolvedCollectionTransactionEntry>> {
    let transaction_id = manifest_transaction_id(manifest_path)?;
    let mut primaries = HashSet::new();
    let mut artifacts = HashSet::new();
    let mut resolved = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        let primary = manifest_child_path(collections_dir, &entry.primary, manifest_path)?;
        let collection = entry.primary.strip_suffix(".json").filter(|value| !value.is_empty()).ok_or_else(|| {
            transaction_recovery_error(
                format!("Transaction manifest primary is not a collection JSON file: {}", entry.primary),
                manifest_path,
            )
        })?;
        marinara_security::validate_collection_name(collection).map_err(|error| {
            transaction_recovery_error(
                format!("Transaction manifest has an invalid collection primary: {}", error.message),
                manifest_path,
            )
        })?;
        let expected_staged = format!(
            "{}.profile-import-{}-{}.tmp",
            entry.primary, transaction_id, index
        );
        let expected_backup = format!(
            "{}.profile-import-{}-{}.backup",
            entry.primary, transaction_id, index
        );
        if entry.staged != expected_staged || entry.backup != expected_backup {
            return Err(transaction_recovery_error(
                format!("Transaction manifest artifacts do not match entry {}", entry.primary),
                manifest_path,
            ));
        }
        if !primaries.insert(entry.primary.clone())
            || !artifacts.insert(entry.staged.clone())
            || !artifacts.insert(entry.backup.clone())
        {
            return Err(transaction_recovery_error(
                "Transaction manifest contains duplicate collection artifacts",
                manifest_path,
            ));
        }
        resolved.push(ResolvedCollectionTransactionEntry {
            primary,
            staged: manifest_child_path(collections_dir, &entry.staged, manifest_path)?,
            backup: manifest_child_path(collections_dir, &entry.backup, manifest_path)?,
            existed: entry.existed,
        });
    }
    Ok(resolved)
}

fn pending_file_name(path: &Path) -> AppResult<String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::invalid_input("Invalid collection transaction artifact path"))
}

pub(crate) fn write_prepared_collection_transaction_manifest(
    collections_dir: &Path,
    transaction_id: &str,
    pending: &[PendingCollectionReplacement],
) -> AppResult<PathBuf> {
    let manifest_path = collections_dir.join(manifest_file_name(transaction_id));
    let manifest = CollectionTransactionManifest {
        version: COLLECTION_TRANSACTION_MANIFEST_VERSION,
        phase: CollectionTransactionPhase::Prepared,
        entries: pending
            .iter()
            .map(|item| {
                Ok(CollectionTransactionManifestEntry {
                    primary: pending_file_name(&item.path)?,
                    staged: pending_file_name(&item.tmp)?,
                    backup: pending_file_name(&item.backup)?,
                    existed: item.existed,
                })
            })
            .collect::<AppResult<Vec<_>>>()?,
    };
    write_file_atomically(&manifest_path, &serde_json::to_vec_pretty(&manifest)?)?;
    sync_directory(collections_dir)?;
    Ok(manifest_path)
}

fn read_collection_transaction_manifest(path: &Path) -> AppResult<CollectionTransactionManifest> {
    let bytes = fs::read(path).map_err(|error| {
        transaction_recovery_error(
            format!("Could not read storage transaction manifest: {error}"),
            path,
        )
    })?;
    let manifest: CollectionTransactionManifest = serde_json::from_slice(&bytes).map_err(|error| {
        transaction_recovery_error(
            format!("Storage transaction manifest is invalid: {error}"),
            path,
        )
    })?;
    if manifest.version != COLLECTION_TRANSACTION_MANIFEST_VERSION || manifest.entries.is_empty() {
        return Err(transaction_recovery_error(
            format!(
                "Unsupported or empty storage transaction manifest version {}",
                manifest.version
            ),
            path,
        ));
    }
    Ok(manifest)
}

pub(crate) fn mark_collection_transaction_committed(manifest_path: &Path) -> AppResult<()> {
    let mut manifest = read_collection_transaction_manifest(manifest_path)?;
    manifest.phase = CollectionTransactionPhase::Committed;
    write_file_atomically(
        manifest_path,
        &serde_json::to_vec_pretty(&manifest)?,
    )?;
    if let Some(parent) = manifest_path.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

pub(crate) fn remove_collection_transaction_manifest(manifest_path: &Path) -> AppResult<()> {
    remove_path_if_exists(manifest_path)?;
    if let Some(parent) = manifest_path.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

fn recover_prepared_transaction(
    manifest_path: &Path,
    entries: &[ResolvedCollectionTransactionEntry],
) -> AppResult<()> {
    for entry in entries {
        let backup_exists = path_exists_no_follow(&entry.backup)?;
        if backup_exists && !entry.existed {
            return Err(transaction_recovery_error(
                "Prepared transaction has a backup for an originally absent collection",
                manifest_path,
            ));
        }
        if entry.existed && !backup_exists && !path_exists_no_follow(&entry.primary)? {
            return Err(transaction_recovery_error(
                "Prepared transaction lost both primary and backup",
                manifest_path,
            ));
        }
    }
    for entry in entries.iter().rev() {
        if path_exists_no_follow(&entry.backup)? {
            remove_path_if_exists(&entry.primary)?;
            fs::rename(&entry.backup, &entry.primary)?;
        } else if !entry.existed {
            remove_path_if_exists(&entry.primary)?;
        }
        remove_path_if_exists(&entry.staged)?;
    }
    Ok(())
}

fn recover_committed_transaction(
    manifest_path: &Path,
    entries: &[ResolvedCollectionTransactionEntry],
) -> AppResult<()> {
    for entry in entries {
        if !path_exists_no_follow(&entry.primary)? {
            return Err(transaction_recovery_error(
                "Committed transaction is missing a primary collection",
                manifest_path,
            ));
        }
    }
    for entry in entries {
        remove_path_if_exists(&entry.staged)?;
        remove_path_if_exists(&entry.backup)?;
    }
    Ok(())
}

fn transaction_manifest_paths(collections_dir: &Path) -> AppResult<Vec<PathBuf>> {
    let mut manifests = Vec::new();
    for entry in fs::read_dir(collections_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(COLLECTION_TRANSACTION_MANIFEST_PREFIX)
            && name.ends_with(COLLECTION_TRANSACTION_MANIFEST_SUFFIX)
        {
            manifests.push(entry.path());
        }
    }
    manifests.sort();
    Ok(manifests)
}

fn recover_legacy_orphan_backups(collections_dir: &Path) -> AppResult<()> {
    let mut backups = Vec::new();
    for entry in fs::read_dir(collections_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.contains(".profile-import-") && name.ends_with(".backup") {
            backups.push(entry.path());
        }
    }
    backups.sort();
    for backup in backups {
        let Some(name) = backup.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some((primary_name, _)) = name.split_once(".profile-import-") else {
            continue;
        };
        let primary = manifest_child_path(collections_dir, primary_name, &backup)?;
        if !path_exists_no_follow(&primary)? {
            fs::rename(&backup, &primary)?;
        }
    }
    Ok(())
}

pub(crate) fn recover_pending_collection_transactions(collections_dir: &Path) -> AppResult<()> {
    for manifest_path in transaction_manifest_paths(collections_dir)? {
        let manifest = read_collection_transaction_manifest(&manifest_path)?;
        let entries = resolve_collection_transaction_entries(
            collections_dir,
            &manifest_path,
            &manifest.entries,
        )?;
        match manifest.phase {
            CollectionTransactionPhase::Prepared => {
                recover_prepared_transaction(&manifest_path, &entries)?
            }
            CollectionTransactionPhase::Committed => {
                recover_committed_transaction(&manifest_path, &entries)?
            }
        }
        sync_directory(collections_dir)?;
        remove_collection_transaction_manifest(&manifest_path)?;
    }
    recover_legacy_orphan_backups(collections_dir)?;
    sync_directory(collections_dir)?;
    Ok(())
}

#[cfg(unix)]
pub(crate) fn sync_directory(path: &Path) -> AppResult<()> {
    fs::File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(windows)]
pub(crate) fn sync_directory(_path: &Path) -> AppResult<()> {
    // Stable std cannot open Windows directories with the backup-semantics flag
    // required by FlushFileBuffers. File and manifest contents remain fsynced.
    Ok(())
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

pub(crate) fn cleanup_pending_collection_transaction_files_checked(
    pending: &[PendingCollectionReplacement],
) -> AppResult<()> {
    for item in pending {
        remove_path_if_exists(&item.tmp)?;
        remove_path_if_exists(&item.backup)?;
    }
    Ok(())
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
