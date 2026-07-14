use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::journal::{apply_collection_mutation, CollectionMutation};
use crate::transaction::{
    backup_path_for, parse_collection_file, preserve_corrupt_file, refresh_collection_backup,
    sync_directory, write_file_atomically,
};
use crate::validate_collection_name;

const APPEND_JOURNAL_VERSION: u8 = 1;
const APPEND_JOURNAL_FILE: &str = ".collection-append-journal.jsonl";
const APPEND_CHECKPOINT_COLLECTIONS: [&str; 2] = ["messages", "message-swipes"];

#[cfg(test)]
pub(crate) type AppendRecoveryTestHook = Box<dyn FnMut() -> AppResult<()> + 'static>;

#[cfg(test)]
std::thread_local! {
    pub(crate) static APPEND_RECOVERY_TEST_HOOK: std::cell::RefCell<Option<AppendRecoveryTestHook>> =
        const { std::cell::RefCell::new(None) };
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AppendJournalCollection {
    collection: String,
    rows: Vec<Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct AppendJournalEntry {
    version: u8,
    appends: Vec<AppendJournalCollection>,
}

fn append_journal_path(collections_dir: &Path) -> PathBuf {
    collections_dir.join(APPEND_JOURNAL_FILE)
}

fn recovery_error(journal: &Path, message: impl Into<String>) -> AppError {
    let message = message.into();
    AppError::with_details(
        "storage_append_journal_recovery_required",
        format!("Collection append journal recovery stopped: {message}"),
        serde_json::json!({
            "journalPath": journal.display().to_string(),
            "reason": message,
        }),
    )
}

fn validate_appends(appends: &[AppendJournalCollection]) -> AppResult<()> {
    if appends.is_empty() {
        return Err(AppError::invalid_input(
            "Collection append transactions require at least one collection",
        ));
    }
    let mut collections = HashSet::new();
    for append in appends {
        validate_collection_name(&append.collection)?;
        if append.rows.is_empty() {
            return Err(AppError::invalid_input(
                "Collection append transactions require non-empty rows",
            ));
        }
        if !collections.insert(append.collection.as_str()) {
            return Err(AppError::invalid_input(format!(
                "Duplicate collection append: {}",
                append.collection
            )));
        }
        apply_collection_mutation(
            &mut Vec::new(),
            &CollectionMutation::UpsertMany {
                records: append.rows.clone(),
            },
        )?;
    }
    Ok(())
}

fn apply_append_rows_idempotently(rows: &mut Vec<Value>, records: Vec<Value>) -> AppResult<()> {
    let mut record_ids = HashSet::new();
    for record in &records {
        let id = record
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| AppError::invalid_input("Append journal records require a non-empty string id"))?;
        if !record_ids.insert(id.to_string()) {
            return Err(AppError::invalid_input(
                "Append journal entries require unique record ids per collection",
            ));
        }
    }
    rows.retain(|row| {
        row.get("id")
            .and_then(Value::as_str)
            .is_none_or(|id| !record_ids.contains(id))
    });
    rows.extend(records);
    Ok(())
}

fn refresh_checkpoint_backup(primary: &Path) -> AppResult<()> {
    let backup = backup_path_for(primary)?;
    match fs::symlink_metadata(primary) {
        Ok(metadata) if metadata.file_type().is_file() && metadata.len() > 0 => {
            refresh_collection_backup(primary)
        }
        Ok(metadata) if metadata.file_type().is_file() => {
            write_file_atomically(&backup, b"[]")
        }
        Ok(_) => Err(AppError::io(std::io::Error::other(format!(
            "Collection path is not a regular file: {}",
            primary.display()
        )))),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            if backup.exists() {
                Ok(())
            } else {
                write_file_atomically(&backup, b"[]")
            }
        }
        Err(error) => Err(error.into()),
    }
}

fn existing_checkpoint_is_usable(
    collections_dir: &Path,
    journal: &Path,
) -> AppResult<bool> {
    let journal_metadata = match fs::symlink_metadata(journal) {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        Ok(_) => {
            return Err(recovery_error(
                journal,
                "append journal path is not a regular file",
            ));
        }
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    let mut refreshed_missing_backup = false;
    for collection in APPEND_CHECKPOINT_COLLECTIONS {
        let primary = collections_dir.join(format!("{collection}.json"));
        let backup = backup_path_for(&primary)?;
        match fs::symlink_metadata(&backup) {
            Ok(metadata) if metadata.file_type().is_file() && metadata.len() > 0 => {}
            Ok(metadata)
                if metadata.file_type().is_file() && journal_metadata.len() == 0 =>
            {
                refresh_checkpoint_backup(&primary)?;
                refreshed_missing_backup = true;
            }
            Ok(metadata) if metadata.file_type().is_file() => {
                return Err(recovery_error(
                    journal,
                    format!("{collection} checkpoint backup is empty while appends are pending"),
                ));
            }
            Ok(_) => {
                return Err(recovery_error(
                    journal,
                    format!("{collection} checkpoint backup is not a regular file"),
                ));
            }
            Err(error) if error.kind() == ErrorKind::NotFound && journal_metadata.len() == 0 => {
                refresh_checkpoint_backup(&primary)?;
                refreshed_missing_backup = true;
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Err(recovery_error(
                    journal,
                    format!("{collection} checkpoint backup is missing while appends are pending"),
                ));
            }
            Err(error) => return Err(error.into()),
        }
    }
    if refreshed_missing_backup {
        sync_directory(collections_dir)?;
    }
    Ok(true)
}

fn initialize_checkpoint(collections_dir: &Path, journal: &Path) -> AppResult<()> {
    if existing_checkpoint_is_usable(collections_dir, journal)? {
        return Ok(());
    }
    for collection in APPEND_CHECKPOINT_COLLECTIONS {
        let primary = collections_dir.join(format!("{collection}.json"));
        refresh_checkpoint_backup(&primary)?;
    }
    let file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(journal)?;
    file.sync_all()?;
    sync_directory(collections_dir)
}

pub(crate) fn prepare_known_checkpoint(collections_dir: &Path) -> AppResult<()> {
    let journal = append_journal_path(collections_dir);
    if existing_checkpoint_is_usable(collections_dir, &journal)? {
        return Ok(());
    }
    for collection in APPEND_CHECKPOINT_COLLECTIONS {
        let primary = collections_dir.join(format!("{collection}.json"));
        refresh_checkpoint_backup(&primary)?;
    }
    let file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&journal)?;
    file.sync_all()?;
    sync_directory(collections_dir)
}

pub(crate) fn append_transaction(
    collections_dir: &Path,
    appends: &[(&str, Vec<Value>)],
) -> AppResult<()> {
    let appends = appends
        .iter()
        .map(|(collection, rows)| AppendJournalCollection {
            collection: (*collection).to_string(),
            rows: rows.clone(),
        })
        .collect::<Vec<_>>();
    validate_appends(&appends)?;
    fs::create_dir_all(collections_dir)?;
    let journal = append_journal_path(collections_dir);
    initialize_checkpoint(collections_dir, &journal)?;
    let entry = AppendJournalEntry {
        version: APPEND_JOURNAL_VERSION,
        appends,
    };
    let mut bytes = serde_json::to_vec(&entry)?;
    bytes.push(b'\n');
    let mut file = fs::OpenOptions::new()
        .append(true)
        .read(true)
        .open(&journal)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

fn read_entries(journal: &Path) -> AppResult<Vec<AppendJournalEntry>> {
    let raw = fs::read_to_string(journal)
        .map_err(|error| recovery_error(journal, format!("journal could not be read: {error}")))?;
    let mut entries = Vec::new();
    for (index, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let entry: AppendJournalEntry = serde_json::from_str(line).map_err(|error| {
            recovery_error(journal, format!("entry {} is invalid: {error}", index + 1))
        })?;
        if entry.version != APPEND_JOURNAL_VERSION {
            return Err(recovery_error(
                journal,
                format!(
                    "entry {} has unsupported version {}",
                    index + 1,
                    entry.version
                ),
            ));
        }
        validate_appends(&entry.appends).map_err(|error| {
            recovery_error(
                journal,
                format!("entry {} is not replayable: {}", index + 1, error.message),
            )
        })?;
        entries.push(entry);
    }
    Ok(entries)
}

fn base_rows(collections_dir: &Path, collection: &str, journal: &Path) -> AppResult<Vec<Value>> {
    let primary = collections_dir.join(format!("{collection}.json"));
    if !primary.exists() {
        let backup = backup_path_for(&primary)?;
        let metadata = fs::symlink_metadata(&backup).map_err(|backup_error| {
            recovery_error(
                journal,
                format!(
                    "{collection} primary is missing and checkpoint backup is unavailable: {backup_error}"
                ),
            )
        });
        let metadata = metadata?;
        if !metadata.file_type().is_file() || metadata.len() == 0 {
            return Err(recovery_error(
                journal,
                format!(
                    "{collection} primary is missing and checkpoint backup is not a non-empty regular file"
                ),
            ));
        }
        return parse_collection_file(collection, &backup).map_err(|backup_error| {
            recovery_error(
                journal,
                format!(
                    "{collection} primary is missing and checkpoint backup is unreadable: {}",
                    backup_error.message
                ),
            )
        });
    }
    match parse_collection_file(collection, &primary) {
        Ok(rows) => Ok(rows),
        Err(primary_error) => {
            let backup = backup_path_for(&primary)?;
            let metadata = fs::symlink_metadata(&backup).map_err(|backup_error| {
                recovery_error(
                    journal,
                    format!(
                        "{collection} primary is unreadable and checkpoint backup is unavailable: {}; {backup_error}",
                        primary_error.message
                    ),
                )
            })?;
            if !metadata.file_type().is_file() || metadata.len() == 0 {
                return Err(recovery_error(
                    journal,
                    format!(
                        "{collection} primary is unreadable and checkpoint backup is not a non-empty regular file: {}",
                        primary_error.message
                    ),
                ));
            }
            let rows = parse_collection_file(collection, &backup).map_err(|backup_error| {
                recovery_error(
                    journal,
                    format!(
                        "{collection} primary and checkpoint backup are unreadable: {}; {}",
                        primary_error.message, backup_error.message
                    ),
                )
            })?;
            preserve_corrupt_file(&primary)?;
            Ok(rows)
        }
    }
}

pub(crate) fn recover(collections_dir: &Path) -> AppResult<()> {
    let journal = append_journal_path(collections_dir);
    if !journal.exists() {
        return Ok(());
    }
    let entries = read_entries(&journal)?;
    if entries.is_empty() {
        return Ok(());
    }

    #[cfg(test)]
    APPEND_RECOVERY_TEST_HOOK.with(|hook| {
        if let Some(hook) = hook.borrow_mut().as_mut() {
            hook()?;
        }
        Ok::<(), AppError>(())
    })?;

    let mut mutations: HashMap<String, Vec<Vec<Value>>> = HashMap::new();
    let mut order = Vec::new();
    for entry in entries {
        for append in entry.appends {
            if !mutations.contains_key(&append.collection) {
                order.push(append.collection.clone());
            }
            mutations
                .entry(append.collection)
                .or_default()
                .push(append.rows);
        }
    }

    for collection in &order {
        let mut rows = base_rows(collections_dir, collection, &journal)?;
        for records in mutations.remove(collection).unwrap_or_default() {
            apply_append_rows_idempotently(&mut rows, records)?;
        }
        let primary = collections_dir.join(format!("{collection}.json"));
        write_file_atomically(&primary, &serde_json::to_vec_pretty(&rows)?)?;
    }
    sync_directory(collections_dir)?;
    for collection in &order {
        refresh_collection_backup(&collections_dir.join(format!("{collection}.json")))?;
    }
    sync_directory(collections_dir)?;
    let file = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&journal)?;
    file.sync_all()?;
    Ok(())
}

pub(crate) fn invalidate_checkpoint(collections_dir: &Path) -> AppResult<()> {
    let journal = append_journal_path(collections_dir);
    let metadata = match fs::metadata(&journal) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.len() != 0 {
        return Err(AppError::new(
            "storage_append_journal_pending",
            "Pending collection appends must be checkpointed before invalidation",
        ));
    }
    fs::remove_file(journal)?;
    sync_directory(collections_dir)
}

pub(crate) fn checkpoint_tracks(collection: &str) -> bool {
    APPEND_CHECKPOINT_COLLECTIONS.contains(&collection)
}
