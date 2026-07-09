use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::transaction::{
    backup_path_for, parse_collection_file, preserve_corrupt_file, refresh_collection_backup,
    sync_directory, sync_file, unique_sibling_path, write_file_atomically,
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

fn unique_record_ids(records: &[Value]) -> AppResult<Vec<&str>> {
    let ids = records.iter().map(record_id).collect::<AppResult<Vec<_>>>()?;
    let mut seen = HashSet::new();
    if ids.iter().any(|id| !seen.insert(*id)) {
        return Err(AppError::invalid_input(
            "Journal upsert mutations require unique record ids",
        ));
    }
    Ok(ids)
}

pub(crate) fn apply_collection_mutation(
    rows: &mut Vec<Value>,
    mutation: &CollectionMutation,
) -> AppResult<()> {
    match mutation {
        CollectionMutation::UpsertMany { records } => {
            let record_ids = unique_record_ids(records)?;
            let record_ids = record_ids.into_iter().collect::<HashSet<_>>();
            rows.retain(|row| {
                row.get("id")
                    .and_then(Value::as_str)
                    .is_none_or(|id| !record_ids.contains(id))
            });
            rows.extend(records.iter().cloned());
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
            unique_record_ids(records)?;
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
    install_recovered_rows_atomically(&primary, &rows, |_| Ok(()))?;
    remove_collection_journal(collections_dir, collection)?;
    Ok(())
}

fn install_recovered_rows_atomically(
    primary: &Path,
    rows: &[Value],
    before_swap: impl FnOnce(&Path) -> AppResult<()>,
) -> AppResult<()> {
    let staged = unique_sibling_path(primary, "journal-recovery")?;
    fs::write(&staged, serde_json::to_vec_pretty(rows)?)?;
    sync_file(&staged)?;
    before_swap(&staged)?;
    fs::rename(&staged, primary)?;
    if let Some(parent) = primary.parent() {
        sync_directory(parent)?;
    }
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
    fn upsert_many_replaces_all_preexisting_rows_with_matching_id() {
        let mutation = CollectionMutation::UpsertMany {
            records: vec![json!({ "id": "duplicate", "name": "Replacement" })],
        };
        let mut rows = vec![
            json!({ "id": "duplicate", "name": "Old A" }),
            json!({ "id": "keep", "name": "Keep" }),
            json!({ "id": "duplicate", "name": "Old B" }),
        ];

        apply_collection_mutation(&mut rows, &mutation).unwrap();

        assert_eq!(
            rows,
            vec![
                json!({ "id": "keep", "name": "Keep" }),
                json!({ "id": "duplicate", "name": "Replacement" }),
            ]
        );
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
    fn upsert_many_rejects_duplicate_mutation_ids_without_changing_rows() {
        let original = vec![json!({ "id": "safe", "name": "Before" })];
        let mut rows = original.clone();
        let error = apply_collection_mutation(
            &mut rows,
            &CollectionMutation::UpsertMany {
                records: vec![
                    json!({ "id": "duplicate", "name": "First" }),
                    json!({ "id": "duplicate", "name": "Second" }),
                ],
            },
        )
        .expect_err("duplicate journal ids must fail closed");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(rows, original);
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

    #[test]
    fn corruption_after_valid_journal_entry_leaves_primary_unchanged() {
        let collections = temp_collections("valid-then-corrupt");
        let primary = collections.join("characters.json");
        let original = serde_json::to_vec_pretty(&json!([{ "id": "safe", "name": "Before" }])).unwrap();
        fs::write(&primary, &original).unwrap();
        append_collection_mutation(
            &collections,
            "characters",
            &CollectionMutation::UpsertMany {
                records: vec![json!({ "id": "safe", "name": "After" })],
            },
        )
        .unwrap();
        let journal = collections.join("characters.pending.jsonl");
        let mut file = fs::OpenOptions::new().append(true).open(&journal).unwrap();
        file.write_all(b"{ corrupt second entry\n").unwrap();
        file.sync_all().unwrap();

        let error = recover_collection_journals(&collections)
            .expect_err("a later corrupt entry must abort before primary replacement");

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert_eq!(fs::read(&primary).unwrap(), original);
        assert!(journal.exists());
        fs::remove_dir_all(collections).unwrap();
    }

    #[test]
    fn failed_recovery_swap_preserves_primary_and_staged_evidence() {
        let collections = temp_collections("failed-swap");
        let primary = collections.join("characters.json");
        let original = serde_json::to_vec_pretty(&json!([{ "id": "safe" }])).unwrap();
        fs::write(&primary, &original).unwrap();
        let mut staged_path = None;

        let error = install_recovered_rows_atomically(
            &primary,
            &[json!({ "id": "replacement" })],
            |staged| {
                staged_path = Some(staged.to_path_buf());
                Err(AppError::io(std::io::Error::other("injected swap failure")))
            },
        )
        .expect_err("swap failure must be returned");

        assert_eq!(error.code, "io_error");
        assert_eq!(fs::read(&primary).unwrap(), original);
        assert!(staged_path.unwrap().exists());
        fs::remove_dir_all(collections).unwrap();
    }
}
