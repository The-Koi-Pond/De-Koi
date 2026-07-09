use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::transaction::{
    backup_path_for, parse_collection_file, preserve_corrupt_file, refresh_collection_backup,
    sync_directory, write_file_atomically,
};
use crate::validate_collection_name;

pub(crate) const COLLECTION_JOURNAL_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum CollectionMutation {
    UpsertMany { records: Vec<Value> },
    DeleteIds { ids: Vec<String> },
    ReplaceAll { rows: Vec<Value> },
}

#[derive(Debug, Deserialize, Serialize)]
struct CollectionJournalEntry {
    version: u8,
    mutation: CollectionMutation,
}

const COLLECTION_JOURNAL_SUFFIX: &str = ".pending.jsonl";

fn collection_journal_path(collections_dir: &Path, collection: &str) -> AppResult<PathBuf> {
    validate_collection_name(collection)?;
    Ok(collections_dir.join(format!("{collection}{COLLECTION_JOURNAL_SUFFIX}")))
}

fn journal_recovery_error(
    collection: &str,
    journal: &Path,
    message: impl Into<String>,
) -> AppError {
    let message = message.into();
    AppError::with_details(
        "storage_journal_recovery_required",
        format!("{collection} journal recovery stopped: {message}"),
        serde_json::json!({
            "collection": collection,
            "journalPath": journal.display().to_string(),
            "reason": message,
        }),
    )
}

fn record_id(record: &Value) -> AppResult<&str> {
    record
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| AppError::invalid_input("Journal records require a non-empty string id"))
}

pub(crate) fn apply_collection_mutation(
    rows: &mut Vec<Value>,
    mutation: &CollectionMutation,
) -> AppResult<()> {
    match mutation {
        CollectionMutation::UpsertMany { records } => {
            let record_ids = records
                .iter()
                .map(record_id)
                .collect::<AppResult<Vec<_>>>()?;
            for (record, id) in records.iter().zip(record_ids) {
                rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(id));
                rows.push(record.clone());
            }
        }
        CollectionMutation::DeleteIds { ids } => {
            let ids = ids
                .iter()
                .map(|id| id.trim())
                .filter(|id| !id.is_empty())
                .collect::<HashSet<_>>();
            rows.retain(|row| {
                row.get("id")
                    .and_then(Value::as_str)
                    .is_none_or(|id| !ids.contains(id))
            });
        }
        CollectionMutation::ReplaceAll { rows: replacement } => {
            for row in replacement {
                record_id(row)?;
            }
            *rows = replacement.clone();
        }
    }
    Ok(())
}

fn validate_collection_mutation(mutation: &CollectionMutation) -> AppResult<()> {
    match mutation {
        CollectionMutation::UpsertMany { records } => {
            for record in records {
                record_id(record)?;
            }
        }
        CollectionMutation::DeleteIds { ids } => {
            if ids.iter().any(|id| id.trim().is_empty()) {
                return Err(AppError::invalid_input(
                    "Journal delete mutations require non-empty ids",
                ));
            }
        }
        CollectionMutation::ReplaceAll { rows } => {
            for row in rows {
                record_id(row)?;
            }
        }
    }
    Ok(())
}

pub(crate) fn append_collection_mutation(
    collections_dir: &Path,
    collection: &str,
    mutation: &CollectionMutation,
) -> AppResult<()> {
    validate_collection_mutation(mutation)?;
    fs::create_dir_all(collections_dir)?;
    let journal = collection_journal_path(collections_dir, collection)?;
    let created = !journal.exists();
    let entry = CollectionJournalEntry {
        version: COLLECTION_JOURNAL_VERSION,
        mutation: mutation.clone(),
    };
    let mut bytes = serde_json::to_vec(&entry)?;
    bytes.push(b'\n');
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .open(&journal)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    if created {
        sync_directory(collections_dir)?;
    }
    Ok(())
}

fn journal_paths(collections_dir: &Path) -> AppResult<Vec<(String, PathBuf)>> {
    let mut journals = Vec::new();
    for entry in fs::read_dir(collections_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(collection) = name.strip_suffix(COLLECTION_JOURNAL_SUFFIX) else {
            continue;
        };
        validate_collection_name(collection)?;
        journals.push((collection.to_string(), entry.path()));
    }
    journals.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(journals)
}

fn base_collection_rows(
    collections_dir: &Path,
    collection: &str,
    journal: &Path,
) -> AppResult<Vec<Value>> {
    let primary = collections_dir.join(format!("{collection}.json"));
    if !primary.exists() {
        return Ok(Vec::new());
    }
    match parse_collection_file(collection, &primary) {
        Ok(rows) => Ok(rows),
        Err(primary_error) => {
            let backup = backup_path_for(&primary)?;
            let backup_rows = parse_collection_file(collection, &backup).map_err(|backup_error| {
                journal_recovery_error(
                    collection,
                    journal,
                    format!(
                        "primary and backup are unreadable: {}; {}",
                        primary_error.message, backup_error.message
                    ),
                )
            })?;
            preserve_corrupt_file(&primary)?;
            write_file_atomically(&primary, &serde_json::to_vec_pretty(&backup_rows)?)?;
            Ok(backup_rows)
        }
    }
}

fn recover_collection_journal(
    collections_dir: &Path,
    collection: &str,
    journal: &Path,
) -> AppResult<()> {
    let raw = fs::read_to_string(journal).map_err(|error| {
        journal_recovery_error(collection, journal, format!("journal could not be read: {error}"))
    })?;
    let mut mutations = Vec::new();
    for (index, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let entry: CollectionJournalEntry = serde_json::from_str(line).map_err(|error| {
            journal_recovery_error(
                collection,
                journal,
                format!("entry {} is invalid: {error}", index + 1),
            )
        })?;
        if entry.version != COLLECTION_JOURNAL_VERSION {
            return Err(journal_recovery_error(
                collection,
                journal,
                format!("entry {} has unsupported version {}", index + 1, entry.version),
            ));
        }
        validate_collection_mutation(&entry.mutation).map_err(|error| {
            journal_recovery_error(
                collection,
                journal,
                format!("entry {} is not replayable: {}", index + 1, error.message),
            )
        })?;
        mutations.push(entry.mutation);
    }
    if mutations.is_empty() {
        return Err(journal_recovery_error(
            collection,
            journal,
            "journal contains no replayable entries",
        ));
    }

    let mut rows = base_collection_rows(collections_dir, collection, journal)?;
    for mutation in &mutations {
        apply_collection_mutation(&mut rows, mutation)?;
    }
    let primary = collections_dir.join(format!("{collection}.json"));
    refresh_collection_backup(&primary)?;
    write_file_atomically(&primary, &serde_json::to_vec_pretty(&rows)?)?;
    remove_collection_journal(collections_dir, collection)?;
    Ok(())
}

pub(crate) fn recover_collection_journals(collections_dir: &Path) -> AppResult<()> {
    for (collection, journal) in journal_paths(collections_dir)? {
        recover_collection_journal(collections_dir, &collection, &journal)?;
    }
    Ok(())
}

pub(crate) fn remove_collection_journal(
    collections_dir: &Path,
    collection: &str,
) -> AppResult<()> {
    let journal = collection_journal_path(collections_dir, collection)?;
    match fs::remove_file(&journal) {
        Ok(()) => sync_directory(collections_dir),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_collections(test_name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "marinara-storage-journal-{test_name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn upsert_many_is_idempotent() {
        let mutation = CollectionMutation::UpsertMany {
            records: vec![
                json!({ "id": "existing", "name": "After" }),
                json!({ "id": "new", "name": "New" }),
            ],
        };
        let mut rows = vec![json!({ "id": "existing", "name": "Before" })];

        apply_collection_mutation(&mut rows, &mutation).unwrap();
        let once = rows.clone();
        apply_collection_mutation(&mut rows, &mutation).unwrap();

        assert_eq!(rows, once);
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row == &json!({ "id": "existing", "name": "After" })));
        assert!(rows.iter().any(|row| row == &json!({ "id": "new", "name": "New" })));
    }

    #[test]
    fn delete_ids_is_idempotent() {
        let mutation = CollectionMutation::DeleteIds {
            ids: vec!["remove".to_string()],
        };
        let mut rows = vec![json!({ "id": "keep" }), json!({ "id": "remove" })];

        apply_collection_mutation(&mut rows, &mutation).unwrap();
        apply_collection_mutation(&mut rows, &mutation).unwrap();

        assert_eq!(rows, vec![json!({ "id": "keep" })]);
    }

    #[test]
    fn mutation_rejects_records_without_non_empty_ids() {
        let mut rows = Vec::new();
        let error = apply_collection_mutation(
            &mut rows,
            &CollectionMutation::UpsertMany {
                records: vec![json!({ "name": "missing" })],
            },
        )
        .expect_err("journal records must be replayable by id");

        assert_eq!(error.code, "invalid_input");
        assert!(rows.is_empty());
    }

    #[test]
    fn append_and_recover_collection_journal_replays_in_order() {
        let collections = temp_collections("append-recover");
        fs::write(
            collections.join("characters.json"),
            serde_json::to_vec_pretty(&json!([{ "id": "existing", "name": "Before" }])).unwrap(),
        )
        .unwrap();
        append_collection_mutation(
            &collections,
            "characters",
            &CollectionMutation::UpsertMany {
                records: vec![json!({ "id": "existing", "name": "After" })],
            },
        )
        .unwrap();
        append_collection_mutation(
            &collections,
            "characters",
            &CollectionMutation::UpsertMany {
                records: vec![json!({ "id": "new", "name": "New" })],
            },
        )
        .unwrap();
        let journal = collections.join("characters.pending.jsonl");
        assert_eq!(fs::read_to_string(&journal).unwrap().lines().count(), 2);

        recover_collection_journals(&collections).unwrap();

        let rows: Value = serde_json::from_slice(&fs::read(collections.join("characters.json")).unwrap()).unwrap();
        assert_eq!(
            rows,
            json!([
                { "id": "existing", "name": "After" },
                { "id": "new", "name": "New" }
            ])
        );
        assert!(!journal.exists());
        fs::remove_dir_all(collections).unwrap();
    }

    #[test]
    fn corrupt_collection_journal_fails_closed_and_preserves_primary() {
        let collections = temp_collections("corrupt");
        let primary = collections.join("characters.json");
        let journal = collections.join("characters.pending.jsonl");
        let original = serde_json::to_vec_pretty(&json!([{ "id": "safe" }])).unwrap();
        fs::write(&primary, &original).unwrap();
        fs::write(&journal, b"{ not valid json\n").unwrap();

        let error = recover_collection_journals(&collections)
            .expect_err("corrupt journal must block recovery");

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert_eq!(fs::read(&primary).unwrap(), original);
        assert!(journal.exists());
        fs::remove_dir_all(collections).unwrap();
    }
}
