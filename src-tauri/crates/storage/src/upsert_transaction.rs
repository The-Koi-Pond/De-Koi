use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::journal::{append_collection_mutation, apply_collection_mutation, CollectionMutation};
use crate::transaction::{sync_directory, write_file_atomically};
use crate::validate_collection_name;

const TRANSACTION_VERSION: u8 = 1;
const TRANSACTION_FILE: &str = ".collection-upsert-transaction.json";

#[derive(Debug, Deserialize, Serialize)]
struct TransactionCollection {
    collection: String,
    /// Rows removed before `records` are upserted. Absent in transactions
    /// written before deletes were supported.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    delete_ids: Vec<String>,
    records: Vec<Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct UpsertTransaction {
    version: u8,
    upserts: Vec<TransactionCollection>,
}

fn transaction_path(collections_dir: &Path) -> PathBuf {
    collections_dir.join(TRANSACTION_FILE)
}

fn recovery_error(path: &Path, message: impl Into<String>) -> AppError {
    let message = message.into();
    AppError::with_details(
        "storage_upsert_transaction_recovery_required",
        format!("Collection upsert transaction recovery stopped: {message}"),
        serde_json::json!({
            "transactionPath": path.display().to_string(),
            "reason": message,
        }),
    )
}

fn validate(transaction: &UpsertTransaction) -> AppResult<()> {
    if transaction.version != TRANSACTION_VERSION {
        return Err(AppError::invalid_input(format!(
            "Unsupported collection upsert transaction version: {}",
            transaction.version
        )));
    }
    if transaction.upserts.is_empty() {
        return Err(AppError::invalid_input(
            "Collection upsert transactions require at least one collection",
        ));
    }
    let mut collections = HashSet::new();
    for upsert in &transaction.upserts {
        validate_collection_name(&upsert.collection)?;
        if !matches!(
            upsert.collection.as_str(),
            "messages"
                | "message-swipes"
                | "chats"
                | "canonical-memories"
                | "story-consolidation-jobs"
                | "memory-knowledge-edges"
                | "memory-index-rows"
        ) {
            return Err(AppError::invalid_input(format!(
                "Collection upsert transactions do not support {}",
                upsert.collection
            )));
        }
        if upsert.records.is_empty() && upsert.delete_ids.is_empty() {
            return Err(AppError::invalid_input(
                "Collection upsert transactions require non-empty records or deletes",
            ));
        }
        if !collections.insert(upsert.collection.as_str()) {
            return Err(AppError::invalid_input(format!(
                "Duplicate collection upsert: {}",
                upsert.collection
            )));
        }
        apply_collection_mutation(
            &mut Vec::new(),
            &CollectionMutation::UpsertMany {
                records: upsert.records.clone(),
            },
        )?;
        // Recovery replays deletes before upserts and may replay both again
        // after a crash, so a deleted id must never be one this transaction
        // writes; the replayed delete would remove the upserted row.
        let mut delete_ids = HashSet::new();
        for id in &upsert.delete_ids {
            if id.trim().is_empty() || id.trim() != id {
                return Err(AppError::invalid_input(
                    "Collection upsert transaction delete ids must be non-empty and trimmed",
                ));
            }
            if !delete_ids.insert(id.as_str()) {
                return Err(AppError::invalid_input(format!(
                    "Duplicate collection delete id: {}/{id}",
                    upsert.collection
                )));
            }
        }
        if upsert.records.iter().any(|record| {
            record
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| delete_ids.contains(id))
        }) {
            return Err(AppError::invalid_input(format!(
                "Collection upsert transactions cannot delete and upsert the same {} id",
                upsert.collection
            )));
        }
    }
    Ok(())
}

/// Durably commits row upserts and deletes for several collections as one
/// transaction. `upserts` and `deletes` each name a collection at most once;
/// a collection may appear in both.
pub(crate) fn commit(
    collections_dir: &Path,
    upserts: &[(&str, Vec<Value>)],
    deletes: &[(&str, Vec<String>)],
) -> AppResult<()> {
    let mut collections = upserts
        .iter()
        .map(|(collection, records)| TransactionCollection {
            collection: (*collection).to_string(),
            delete_ids: Vec::new(),
            records: records.clone(),
        })
        .collect::<Vec<_>>();
    let mut deleted_collections = HashSet::new();
    for (collection, ids) in deletes {
        if !deleted_collections.insert(*collection) {
            return Err(AppError::invalid_input(format!(
                "Duplicate collection delete: {collection}"
            )));
        }
        match collections
            .iter_mut()
            .find(|entry| entry.collection == *collection)
        {
            Some(entry) => entry.delete_ids = ids.clone(),
            None => collections.push(TransactionCollection {
                collection: (*collection).to_string(),
                delete_ids: ids.clone(),
                records: Vec::new(),
            }),
        }
    }
    let transaction = UpsertTransaction {
        version: TRANSACTION_VERSION,
        upserts: collections,
    };
    validate(&transaction)?;
    fs::create_dir_all(collections_dir)?;
    let path = transaction_path(collections_dir);
    if path.exists() {
        return Err(recovery_error(
            &path,
            "a previous committed transaction is still pending",
        ));
    }
    write_file_atomically(&path, &serde_json::to_vec_pretty(&transaction)?)?;
    sync_directory(collections_dir)
}

pub(crate) fn recover(collections_dir: &Path) -> AppResult<()> {
    let path = transaction_path(collections_dir);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        Ok(_) => {
            return Err(recovery_error(
                &path,
                "transaction path is not a regular file",
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.len() == 0 {
        return Err(recovery_error(&path, "transaction file is empty"));
    }
    let raw = fs::read(&path).map_err(|error| {
        recovery_error(&path, format!("transaction could not be read: {error}"))
    })?;
    let transaction: UpsertTransaction = serde_json::from_slice(&raw)
        .map_err(|error| recovery_error(&path, format!("transaction is invalid: {error}")))?;
    validate(&transaction).map_err(|error| recovery_error(&path, error.message))?;

    for upsert in transaction.upserts {
        if !upsert.delete_ids.is_empty() {
            append_collection_mutation(
                collections_dir,
                &upsert.collection,
                &CollectionMutation::DeleteIds {
                    ids: upsert.delete_ids,
                },
            )?;
        }
        if !upsert.records.is_empty() {
            append_collection_mutation(
                collections_dir,
                &upsert.collection,
                &CollectionMutation::UpsertMany {
                    records: upsert.records,
                },
            )?;
        }
    }
    fs::remove_file(&path)?;
    sync_directory(collections_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::{pending_collection_record, PendingCollectionRecord};
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_collections(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("marinara-upsert-transaction-{label}-{nonce}"))
    }

    #[test]
    fn partial_application_keeps_commit_marker_and_recovers_idempotently() {
        let collections = temp_collections("partial-apply");
        fs::create_dir_all(&collections).unwrap();
        commit(
            &collections,
            &[
                (
                    "messages",
                    vec![json!({ "id": "message-1", "content": "after" })],
                ),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-1::swipe::1", "messageId": "message-1" })],
                ),
            ],
            &[],
        )
        .unwrap();
        let blocked_journal = collections.join("message-swipes.pending.jsonl");
        fs::create_dir(&blocked_journal).unwrap();

        recover(&collections).expect_err("the blocked second journal should stop recovery");
        assert!(transaction_path(&collections).exists());
        fs::remove_dir(&blocked_journal).unwrap();

        recover(&collections).expect("the committed transaction should replay");
        assert!(!transaction_path(&collections).exists());
        assert!(matches!(
            pending_collection_record(&collections, "messages", "message-1").unwrap(),
            Some(PendingCollectionRecord::Present(record)) if record["content"] == json!("after")
        ));
        assert!(matches!(
            pending_collection_record(&collections, "message-swipes", "message-1::swipe::1")
                .unwrap(),
            Some(PendingCollectionRecord::Present(_))
        ));

        fs::remove_dir_all(collections).unwrap();
    }

    #[test]
    fn deletes_replay_before_upserts_after_partial_recovery() {
        let collections = temp_collections("partial-delete");
        fs::create_dir_all(&collections).unwrap();
        commit(
            &collections,
            &[
                (
                    "memory-index-rows",
                    vec![json!({ "id": "memory-1:semantic:new", "memoryId": "memory-1" })],
                ),
                (
                    "messages",
                    vec![json!({ "id": "message-1", "content": "after" })],
                ),
            ],
            &[("memory-index-rows", vec!["memory-1:semantic:old".to_string()])],
        )
        .unwrap();
        let blocked_journal = collections.join("messages.pending.jsonl");
        fs::create_dir(&blocked_journal).unwrap();

        recover(&collections).expect_err("the blocked second journal should stop recovery");
        assert!(transaction_path(&collections).exists());
        fs::remove_dir(&blocked_journal).unwrap();

        // The index journal now replays its delete and upsert a second time.
        recover(&collections).expect("the committed transaction should replay");
        assert!(!transaction_path(&collections).exists());
        assert!(matches!(
            pending_collection_record(&collections, "memory-index-rows", "memory-1:semantic:old")
                .unwrap(),
            Some(PendingCollectionRecord::Deleted)
        ));
        assert!(matches!(
            pending_collection_record(&collections, "memory-index-rows", "memory-1:semantic:new")
                .unwrap(),
            Some(PendingCollectionRecord::Present(_))
        ));
        assert!(matches!(
            pending_collection_record(&collections, "messages", "message-1").unwrap(),
            Some(PendingCollectionRecord::Present(_))
        ));

        fs::remove_dir_all(collections).unwrap();
    }

    #[test]
    fn commit_rejects_deleting_an_id_it_upserts() {
        let collections = temp_collections("delete-upsert-overlap");
        fs::create_dir_all(&collections).unwrap();

        let error = commit(
            &collections,
            &[("memory-index-rows", vec![json!({ "id": "row-1" })])],
            &[("memory-index-rows", vec!["row-1".to_string()])],
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_input");
        assert!(!transaction_path(&collections).exists());
        fs::remove_dir_all(collections).unwrap();
    }

    #[test]
    fn transactions_written_without_delete_ids_still_recover() {
        let collections = temp_collections("legacy-format");
        fs::create_dir_all(&collections).unwrap();
        fs::write(
            transaction_path(&collections),
            br#"{"version":1,"upserts":[{"collection":"messages","records":[{"id":"message-1","content":"kept"}]}]}"#,
        )
        .unwrap();

        recover(&collections).unwrap();

        assert!(!transaction_path(&collections).exists());
        assert!(matches!(
            pending_collection_record(&collections, "messages", "message-1").unwrap(),
            Some(PendingCollectionRecord::Present(record)) if record["content"] == json!("kept")
        ));
        fs::remove_dir_all(collections).unwrap();
    }
}
