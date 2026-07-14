mod append_journal;
mod cache;
mod chat_summaries;
mod journal;
mod messages;
mod projection;
mod streaming;
mod transaction;
mod write_gate;

pub use cache::CollectionContentStamp;
use cache::*;
use chat_summaries::*;
use journal::*;
use marinara_core::{ensure_object, new_id, now_iso, AppError, AppResult};
use marinara_security::validate_collection_name;
use messages::*;
use projection::*;
use serde::Deserializer as _;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufReader, ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, RwLock,
};
use std::time::Duration;
pub use streaming::{StreamingFilterReport, StreamingTransformReport};
use transaction::*;
use write_gate::WriteGate;

const STORAGE_SAVE_DEBOUNCE_MS: u64 = 750;
const MAX_CLEAN_COLLECTION_CACHE_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOTAL_CLEAN_COLLECTION_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PROJECTED_LIST_CACHE_SHAPES: usize = 32;

fn next_cache_access(cache: &mut StorageCache) -> u64 {
    cache.access_sequence = cache.access_sequence.saturating_add(1).max(1);
    cache.access_sequence
}

enum CacheEvictionKey {
    Collection(String),
    Projection(ProjectionCacheKey),
}

fn clean_cache_bytes(cache: &StorageCache) -> usize {
    cache
        .collections
        .values()
        .filter(|entry| !entry.dirty)
        .map(|entry| entry.approx_bytes)
        .chain(cache.projected_lists.values().map(|entry| entry.approx_bytes))
        .sum()
}

fn evict_oldest_clean_cache_entry(cache: &mut StorageCache) -> bool {
    let collection = cache
        .collections
        .iter()
        .filter(|(_, entry)| !entry.dirty)
        .min_by_key(|(_, entry)| entry.last_access)
        .map(|(key, entry)| (CacheEvictionKey::Collection(key.clone()), entry.last_access));
    let projection = cache
        .projected_lists
        .iter()
        .min_by_key(|(_, entry)| entry.last_access)
        .map(|(key, entry)| (CacheEvictionKey::Projection(key.clone()), entry.last_access));
    let selected = match (collection, projection) {
        (Some(collection), Some(projection)) => {
            if collection.1 <= projection.1 { collection.0 } else { projection.0 }
        }
        (Some(collection), None) => collection.0,
        (None, Some(projection)) => projection.0,
        (None, None) => return false,
    };
    match selected {
        CacheEvictionKey::Collection(key) => {
            cache.collections.remove(&key);
            cache.id_indexes.remove(&key);
            cache.projected_lists.retain(|projection, _| projection.collection != key);
        }
        CacheEvictionKey::Projection(key) => {
            cache.projected_lists.remove(&key);
        }
    }
    true
}

pub struct AtomicCollectionRows {
    collection: String,
    rows: Vec<Value>,
}

impl AtomicCollectionRows {
    pub fn collection(&self) -> &str {
        &self.collection
    }

    pub fn rows(&self) -> &[Value] {
        &self.rows
    }

    pub fn rows_mut(&mut self) -> &mut Vec<Value> {
        &mut self.rows
    }
}

#[derive(Clone)]
pub struct FileStorage {
    root: PathBuf,
    lock: Arc<RwLock<()>>,
    cache: Arc<RwLock<StorageCache>>,
    flush_scheduled: Arc<AtomicBool>,
    write_gate: Arc<WriteGate>,
}

impl FileStorage {
    pub fn new(root: impl Into<PathBuf>) -> AppResult<Self> {
        let root = root.into();
        let collections = root.join("collections");
        fs::create_dir_all(&collections)?;
        recover_pending_collection_transactions(&collections)?;
        append_journal::recover(&collections)?;
        recover_collection_journals(&collections)?;
        append_journal::prepare_known_checkpoint(&collections)?;
        Ok(Self {
            root,
            lock: Arc::new(RwLock::new(())),
            cache: Arc::new(RwLock::new(StorageCache::default())),
            flush_scheduled: Arc::new(AtomicBool::new(false)),
            write_gate: Arc::new(WriteGate::default()),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn flush(&self) -> AppResult<()> {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.flush_dirty_collections_locked()
    }

    pub fn list(&self, collection: &str) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_collection_no_recovery(collection),
            || self.read_collection(collection),
        )
    }

    pub fn list_where(
        &self,
        collection: &str,
        filters: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_collection_filtered_no_recovery(collection, filters),
            || self.read_collection_filtered(collection, filters),
        )
    }

    pub fn list_where_in(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_collection_where_in_no_recovery(collection, filter_field, filter_values),
            || self.read_collection_where_in(collection, filter_field, filter_values),
        )
    }

    pub fn list_projected(
        &self,
        collection: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_collection_projected_no_recovery(collection, fields, field_selections),
            || self.read_collection_projected(collection, fields, field_selections),
        )
    }

    pub fn list_projected_where(
        &self,
        collection: &str,
        filters: &Map<String, Value>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || {
                self.read_collection_projected_where_no_recovery(
                    collection,
                    filters,
                    fields,
                    field_selections,
                )
            },
            || self.read_collection_projected_where(collection, filters, fields, field_selections),
        )
    }
    pub fn list_chat_summaries(
        &self,
        fields: &[String],
        field_selections: &Map<String, Value>,
        descending: bool,
        limit: Option<usize>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_chat_summaries_no_recovery(fields, field_selections, descending, limit),
            || self.read_chat_summaries(fields, field_selections, descending, limit),
        )
    }

    pub fn list_projected_where_in(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || {
                self.read_collection_projected_where_in_no_recovery(
                    collection,
                    filter_field,
                    filter_values,
                    fields,
                    field_selections,
                )
            },
            || {
                self.read_collection_projected_where_in(
                    collection,
                    filter_field,
                    filter_values,
                    fields,
                    field_selections,
                )
            },
        )
    }

    pub fn list_messages_for_chat(&self, chat_id: &str) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_messages_for_chat_no_recovery(chat_id),
            || self.read_messages_for_chat(chat_id),
        )
    }

    pub fn list_messages_for_chat_projected(
        &self,
        chat_id: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_messages_for_chat_projected_no_recovery(chat_id, fields, field_selections),
            || self.read_messages_for_chat_projected(chat_id, fields, field_selections),
        )
    }

    pub fn list_message_ids_for_chat(&self, chat_id: &str) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_message_ids_for_chat_no_recovery(chat_id),
            || self.read_message_ids_for_chat(chat_id),
        )
    }

    pub fn count_messages_for_chat(&self, chat_id: &str) -> AppResult<usize> {
        self.read_locked_or_recover(
            || self.read_message_count_for_chat_no_recovery(chat_id),
            || self.read_message_count_for_chat(chat_id),
        )
    }

    pub fn list_messages_for_chat_page(
        &self,
        chat_id: &str,
        limit: usize,
        before: Option<&str>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_messages_for_chat_page_no_recovery(chat_id, limit, before),
            || self.read_messages_for_chat_page(chat_id, limit, before),
        )
    }

    pub fn list_messages_for_chat_page_projected(
        &self,
        chat_id: &str,
        limit: usize,
        before: Option<&str>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || {
                self.read_messages_for_chat_page_projected_no_recovery(
                    chat_id,
                    limit,
                    before,
                    fields,
                    field_selections,
                )
            },
            || {
                self.read_messages_for_chat_page_projected(
                    chat_id,
                    limit,
                    before,
                    fields,
                    field_selections,
                )
            },
        )
    }

    pub fn get(&self, collection: &str, id: &str) -> AppResult<Option<Value>> {
        self.read_locked_or_recover(
            || self.read_collection_find_by_id_no_recovery(collection, id),
            || self.read_collection_find_by_id(collection, id),
        )
    }

    pub fn get_projected(
        &self,
        collection: &str,
        id: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Option<Value>> {
        self.read_locked_or_recover(
            || {
                self.read_collection_find_by_id_projected_no_recovery(
                    collection,
                    id,
                    fields,
                    field_selections,
                )
            },
            || self.read_collection_find_by_id_projected(collection, id, fields, field_selections),
        )
    }

    pub fn create(&self, collection: &str, value: Value) -> AppResult<Value> {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.create_locked(collection, value, false)
    }

    pub fn create_immediate(&self, collection: &str, value: Value) -> AppResult<Value> {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.create_locked(collection, value, true)
    }

    fn create_locked(
        &self,
        collection: &str,
        value: Value,
        write_immediately: bool,
    ) -> AppResult<Value> {
        let mut object = ensure_object(value)?;
        let had_id = object
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.trim().is_empty());
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.trim().is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(new_id);
        if had_id && self.read_collection_find_by_id(collection, &id)?.is_some() {
            return Err(AppError::invalid_input(format!(
                "{collection}/{id} already exists"
            )));
        }
        let now = now_iso();
        object.insert("id".to_string(), Value::String(id.clone()));
        object
            .entry("createdAt".to_string())
            .or_insert_with(|| Value::String(now.clone()));
        object
            .entry("updatedAt".to_string())
            .or_insert_with(|| Value::String(now));
        let record = Value::Object(object);
        if !write_immediately
            && matches!(collection, "messages" | "chats")
            && !had_id
            && !self.is_collection_cached(collection)?
        {
            self.append_collection_row(collection, &record)?;
            return Ok(record);
        }
        let mut rows = self.read_collection(collection)?;
        rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(id.as_str()));
        rows.push(record.clone());
        if write_immediately {
            self.write_collection_immediate(collection, &rows)?;
        } else {
            self.write_collection(
                collection,
                &rows,
                CollectionMutation::UpsertMany {
                    records: vec![record.clone()],
                },
            )?;
        }
        Ok(record)
    }

    pub fn upsert_with_id(&self, collection: &str, id: &str, value: Value) -> AppResult<Value> {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let mut rows = self.read_collection(collection)?;
        let mut object = ensure_object(value)?;
        let now = now_iso();
        object.insert("id".to_string(), Value::String(id.to_string()));
        object
            .entry("createdAt".to_string())
            .or_insert_with(|| Value::String(now.clone()));
        object
            .entry("updatedAt".to_string())
            .or_insert_with(|| Value::String(now));
        let record = Value::Object(object);
        rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(id));
        rows.push(record.clone());
        self.write_collection(
            collection,
            &rows,
            CollectionMutation::UpsertMany {
                records: vec![record.clone()],
            },
        )?;
        Ok(record)
    }

    pub fn patch(&self, collection: &str, id: &str, patch: Value) -> AppResult<Value> {
        self.patch_with(collection, id, patch, |_, _| Ok(()))
    }

    pub fn patch_many(
        &self,
        collection: &str,
        patches: Vec<(String, Value)>,
    ) -> AppResult<Vec<Value>> {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let normalized_patches = patches
            .into_iter()
            .map(|(id, patch)| Ok((id, ensure_object(patch)?)))
            .collect::<AppResult<Vec<_>>>()?;
        let mut rows = self.read_collection(collection)?;
        for (id, _) in &normalized_patches {
            if !rows
                .iter()
                .any(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
            {
                return Err(AppError::not_found(format!(
                    "{collection}/{id} was not found"
                )));
            }
        }
        let now = now_iso();
        let mut updated = Vec::with_capacity(normalized_patches.len());
        for (id, patch) in normalized_patches {
            let row = rows
                .iter_mut()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
                .ok_or_else(|| AppError::not_found(format!("{collection}/{id} was not found")))?;
            let Some(object) = row.as_object_mut() else {
                return Err(AppError::invalid_input("Stored record is not an object"));
            };
            for (key, value) in patch {
                object.insert(key, value);
            }
            object.insert("updatedAt".to_string(), Value::String(now.clone()));
            updated.push(Value::Object(object.clone()));
        }
        self.write_collection(
            collection,
            &rows,
            CollectionMutation::UpsertMany {
                records: updated.clone(),
            },
        )?;
        Ok(updated)
    }

    pub fn patch_if<F>(
        &self,
        collection: &str,
        id: &str,
        mut patch_row: F,
    ) -> AppResult<Option<Value>>
    where
        F: FnMut(&mut Map<String, Value>) -> AppResult<bool>,
    {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let mut rows = self.read_collection(collection)?;
        let mut found = false;
        let mut patched = None;
        for row in &mut rows {
            if row.get("id").and_then(Value::as_str) != Some(id) {
                continue;
            }
            found = true;
            let Some(object) = row.as_object_mut() else {
                return Err(AppError::invalid_input("Stored record is not an object"));
            };
            if !patch_row(object)? {
                return Ok(None);
            }
            object.insert("updatedAt".to_string(), Value::String(now_iso()));
            patched = Some(Value::Object(object.clone()));
            break;
        }
        if !found {
            return Err(AppError::not_found(format!(
                "{collection}/{id} was not found"
            )));
        }
        let Some(record) = patched else {
            return Ok(None);
        };
        self.write_collection(
            collection,
            &rows,
            CollectionMutation::UpsertMany {
                records: vec![record.clone()],
            },
        )?;
        Ok(Some(record))
    }

    pub fn patch_with<F>(
        &self,
        collection: &str,
        id: &str,
        patch: Value,
        mut after_patch: F,
    ) -> AppResult<Value>
    where
        F: FnMut(&mut Map<String, Value>, &Map<String, Value>) -> AppResult<()>,
    {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let mut rows = self.read_collection(collection)?;
        let patch = ensure_object(patch)?;
        let mut found = None;
        for row in &mut rows {
            if row.get("id").and_then(Value::as_str) != Some(id) {
                continue;
            }
            let Some(object) = row.as_object_mut() else {
                return Err(AppError::invalid_input("Stored record is not an object"));
            };
            for (key, value) in &patch {
                object.insert(key.clone(), value.clone());
            }
            after_patch(object, &patch)?;
            object.insert("updatedAt".to_string(), Value::String(now_iso()));
            found = Some(Value::Object(object.clone()));
            break;
        }
        let Some(record) = found else {
            return Err(AppError::not_found(format!(
                "{collection}/{id} was not found"
            )));
        };
        self.write_collection(
            collection,
            &rows,
            CollectionMutation::UpsertMany {
                records: vec![record.clone()],
            },
        )?;
        Ok(record)
    }

    pub fn delete(&self, collection: &str, id: &str) -> AppResult<bool> {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let mut rows = self.read_collection(collection)?;
        let before = rows.len();
        rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(id));
        let deleted = rows.len() != before;
        if deleted {
            self.write_collection(
                collection,
                &rows,
                CollectionMutation::DeleteIds {
                    ids: vec![id.to_string()],
                },
            )?;
        }
        Ok(deleted)
    }

    pub fn delete_where(&self, collection: &str, filters: &Map<String, Value>) -> AppResult<usize> {
        self.delete_where_matching(collection, |row| row_matches_filters(row, filters))
    }

    pub fn delete_where_matching<F>(&self, collection: &str, mut predicate: F) -> AppResult<usize>
    where
        F: FnMut(&Value) -> bool,
    {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let mut rows = self.read_collection(collection)?;
        let before = rows.len();
        let mut deleted_ids = Vec::new();
        rows.retain(|row| {
            if !predicate(row) {
                return true;
            }
            if let Some(id) = row.get("id").and_then(Value::as_str) {
                deleted_ids.push(id.to_string());
            }
            false
        });
        let deleted = before.saturating_sub(rows.len());
        if deleted > 0 {
            if deleted_ids.len() != deleted {
                return Err(AppError::invalid_input(format!(
                    "{collection} contains a record without a replayable id"
                )));
            }
            self.write_collection(
                collection,
                &rows,
                CollectionMutation::DeleteIds { ids: deleted_ids },
            )?;
        }
        Ok(deleted)
    }

    pub fn delete_messages_for_chats(&self, chat_ids: &HashSet<String>) -> AppResult<usize> {
        if chat_ids.is_empty() {
            return Ok(0);
        }
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let mut rows = self.read_collection("messages")?;
        let before = rows.len();
        let mut deleted_ids = Vec::new();
        rows.retain(|row| {
            let should_delete = row
                .get("chatId")
                .and_then(Value::as_str)
                .is_some_and(|chat_id| chat_ids.contains(chat_id));
            if should_delete {
                if let Some(id) = row.get("id").and_then(Value::as_str) {
                    deleted_ids.push(id.to_string());
                }
            }
            !should_delete
        });
        let deleted = before.saturating_sub(rows.len());
        if deleted > 0 {
            if deleted_ids.len() != deleted {
                return Err(AppError::invalid_input(
                    "messages contains a record without a replayable id",
                ));
            }
            self.write_collection(
                "messages",
                &rows,
                CollectionMutation::DeleteIds { ids: deleted_ids },
            )?;
        }
        Ok(deleted)
    }

    pub fn replace_all(&self, collection: &str, rows: Vec<Value>) -> AppResult<()> {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.write_collection_immediate(collection, &rows)
    }

    pub fn replace_all_many(&self, replacements: Vec<(&str, Vec<Value>)>) -> AppResult<()> {
        self.replace_all_many_and_then(replacements, || Ok(()))
    }

    pub fn append_many_uncached(&self, appends: Vec<(&str, Vec<Value>)>) -> AppResult<bool> {
        let appends = appends
            .into_iter()
            .filter(|(_, rows)| !rows.is_empty())
            .collect::<Vec<_>>();
        if appends.is_empty() {
            return Ok(true);
        }

        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        if self.any_collection_dirty_cached(appends.iter().map(|(collection, _)| *collection))? {
            return Ok(false);
        }

        self.append_many_uncached_locked(appends)
    }

    pub fn update_collections_atomically<F, T>(
        &self,
        collections: Vec<&str>,
        update: F,
    ) -> AppResult<T>
    where
        F: FnOnce(&mut [AtomicCollectionRows]) -> AppResult<T>,
    {
        let _atomic_update = self.write_gate.begin_atomic_update()?;
        // Load the rows and capture each collection's file stamp under the SAME
        // write lock, so the conflict baseline reflects exactly the bytes the rows
        // were read from. Sampling the stamp after the lock is released would let a
        // concurrent writer slip in between the read and the stamp, baking its change
        // into the baseline and hiding it from the commit-time conflict check.
        let (mut entries, original_stamps) = {
            let _guard = self
                .lock
                .write()
                .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
            self.flush_dirty_collections_locked()?;

            let mut loaded = Vec::with_capacity(collections.len());
            let mut original_stamps = Vec::with_capacity(collections.len());
            let mut seen_paths = HashSet::new();
            for collection in collections {
                let path = self.collection_path(collection)?;
                if !seen_paths.insert(path.clone()) {
                    return Err(AppError::invalid_input(format!(
                        "Duplicate collection update: {collection}"
                    )));
                }
                loaded.push(AtomicCollectionRows {
                    collection: collection.to_string(),
                    rows: self.read_collection_no_recovery(collection)?,
                });
                original_stamps.push((collection.to_string(), collection_content_stamp(&path)?));
            }
            (loaded, original_stamps)
        };

        let output = update(&mut entries)?;

        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.flush_dirty_collections_locked()?;
        for (collection, original_stamp) in &original_stamps {
            let path = self.collection_path(collection)?;
            if collection_content_stamp(&path)? != *original_stamp {
                return Err(AppError::new(
                    "storage_conflict",
                    format!("Collection changed during atomic update: {collection}"),
                ));
            }
        }
        let replacements = entries
            .iter()
            .map(|entry| (entry.collection.as_str(), entry.rows.clone()))
            .collect::<Vec<_>>();
        self.replace_all_many_locked(replacements, || Ok(()))?;
        Ok(output)
    }

    pub fn replace_all_many_and_then<F>(
        &self,
        replacements: Vec<(&str, Vec<Value>)>,
        after_install: F,
    ) -> AppResult<()>
    where
        F: FnOnce() -> AppResult<()>,
    {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.replace_all_many_locked(replacements, after_install)
    }

    pub fn clear_all(&self) -> AppResult<()> {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let collections = self.root.join("collections");
        if collections.exists() {
            fs::remove_dir_all(&collections)?;
        }
        fs::create_dir_all(collections)?;
        self.clear_collection_cache()?;
        Ok(())
    }

    fn collection_path(&self, collection: &str) -> AppResult<PathBuf> {
        validate_collection_name(collection)?;
        Ok(self
            .root
            .join("collections")
            .join(format!("{collection}.json")))
    }

    fn cached_rows(&self, collection: &str) -> AppResult<Option<Vec<Value>>> {
        validate_collection_name(collection)?;
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        let access = next_cache_access(&mut cache);
        Ok(cache.collections.get_mut(collection).map(|cached| {
            cached.last_access = access;
            cached.rows.clone()
        }))
    }

    fn cached_row_by_id(&self, collection: &str, id: &str) -> AppResult<Option<Option<Value>>> {
        validate_collection_name(collection)?;
        let cache = self
            .cache
            .read()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        Ok(cache.collections.get(collection).map(|cached| {
            cached
                .row_indices_by_id
                .get(id)
                .and_then(|index| cached.rows.get(*index))
                .cloned()
        }))
    }

    fn cached_dirty_row_by_id(
        &self,
        collection: &str,
        id: &str,
    ) -> AppResult<Option<Option<Value>>> {
        validate_collection_name(collection)?;
        let cache = self
            .cache
            .read()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        Ok(cache
            .collections
            .get(collection)
            .filter(|cached| cached.dirty)
            .map(|cached| {
                cached
                    .row_indices_by_id
                    .get(id)
                    .and_then(|index| cached.rows.get(*index))
                    .cloned()
            }))
    }

    fn cached_dirty_rows(&self, collection: &str) -> AppResult<Option<Vec<Value>>> {
        validate_collection_name(collection)?;
        let cache = self
            .cache
            .read()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        Ok(cache
            .collections
            .get(collection)
            .filter(|cached| cached.dirty)
            .map(|cached| cached.rows.clone()))
    }

    fn is_collection_cached(&self, collection: &str) -> AppResult<bool> {
        validate_collection_name(collection)?;
        let cache = self
            .cache
            .read()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        Ok(cache.collections.contains_key(collection))
    }

    fn cache_collection(&self, collection: &str, rows: &[Value], dirty: bool) -> AppResult<()> {
        validate_collection_name(collection)?;
        let approx_bytes = rows.iter().map(approximate_json_bytes).sum::<usize>();
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        if dirty {
            cache.id_indexes.remove(collection);
            cache
                .projected_lists
                .retain(|key, _| key.collection != collection);
        } else if approx_bytes > MAX_CLEAN_COLLECTION_CACHE_BYTES {
            cache.collections.remove(collection);
            return Ok(());
        } else {
            cache.collections.remove(collection);
            while clean_cache_bytes(&cache).saturating_add(approx_bytes) > MAX_TOTAL_CLEAN_COLLECTION_CACHE_BYTES {
                if !evict_oldest_clean_cache_entry(&mut cache) {
                    break;
                }
            }
        }
        let last_access = next_cache_access(&mut cache);
        cache.collections.insert(
            collection.to_string(),
            CachedCollection {
                rows: rows.to_vec(),
                row_indices_by_id: row_indices_by_id(rows),
                dirty,
                approx_bytes,
                last_access,
            },
        );
        Ok(())
    }

    fn clear_collection_cache(&self) -> AppResult<()> {
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        cache.collections.clear();
        cache.id_indexes.clear();
        cache.projected_lists.clear();
        Ok(())
    }

    fn any_collection_dirty_cached<'a>(
        &self,
        collections: impl IntoIterator<Item = &'a str>,
    ) -> AppResult<bool> {
        let cache = self
            .cache
            .read()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        for collection in collections {
            validate_collection_name(collection)?;
            if cache
                .collections
                .get(collection)
                .is_some_and(|cached| cached.dirty)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn append_cached_collection_rows(&self, appends: &[(&str, Vec<Value>)]) -> AppResult<()> {
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        for (collection, rows) in appends {
            validate_collection_name(collection)?;
            cache.id_indexes.remove(*collection);
            cache
                .projected_lists
                .retain(|key, _| key.collection != *collection);
            if let Some(cached) = cache.collections.get_mut(*collection) {
                let next_index = cached.rows.len();
                cached.approx_bytes = cached
                    .approx_bytes
                    .saturating_add(rows.iter().map(approximate_json_bytes).sum::<usize>());
                cached.rows.extend(rows.iter().cloned());
                for (offset, row) in rows.iter().enumerate() {
                    let Some(id) = row.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    cached
                        .row_indices_by_id
                        .entry(id.to_string())
                        .or_insert(next_index + offset);
                }
                cached.dirty = false;
            }
        }
        Ok(())
    }

    fn invalidate_read_indexes_for_collection(&self, collection: &str) -> AppResult<()> {
        validate_collection_name(collection)?;
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        cache.id_indexes.remove(collection);
        cache
            .projected_lists
            .retain(|key, _| key.collection != collection);
        Ok(())
    }

    fn dirty_collection_count(&self) -> usize {
        self.cache
            .read()
            .map(|cache| {
                cache
                    .collections
                    .values()
                    .filter(|collection| collection.dirty)
                    .count()
            })
            .unwrap_or(0)
    }

    fn schedule_dirty_flush(&self) {
        if self.flush_scheduled.swap(true, Ordering::SeqCst) {
            return;
        }
        let storage = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(STORAGE_SAVE_DEBOUNCE_MS));
            if let Err(error) = storage.flush() {
                eprintln!("[storage] delayed flush failed: {}", error.message);
            }
            storage.flush_scheduled.store(false, Ordering::SeqCst);
            if storage.dirty_collection_count() > 0 {
                storage.schedule_dirty_flush();
            }
        });
    }

    fn flush_dirty_collections_locked(&self) -> AppResult<()> {
        append_journal::recover(&self.root.join("collections"))?;
        let dirty = {
            let cache = self
                .cache
                .read()
                .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
            cache
                .collections
                .iter()
                .filter(|(_, cached)| cached.dirty)
                .map(|(collection, cached)| (collection.clone(), cached.rows.clone()))
                .collect::<Vec<_>>()
        };
        for (collection, rows) in dirty {
            self.write_collection_file(&collection, &rows)?;
            if collection == "chats" {
                let path = self.collection_path(&collection)?;
                let source_stamp = chat_summary_source_stamp(&path)?;
                rebuild_chat_summary_read_model(&self.root, source_stamp.as_deref(), &rows)?;
            }
            let mut cache = self
                .cache
                .write()
                .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
            remove_collection_journal(&self.root.join("collections"), &collection)?;
            if let Some(cached) = cache.collections.get_mut(&collection) {
                cached.dirty = false;
            }
        }
        Ok(())
    }

    fn read_locked_or_recover<T>(
        &self,
        read_only: impl FnOnce() -> AppResult<T>,
        recover: impl FnOnce() -> AppResult<T>,
    ) -> AppResult<T> {
        let read_result = {
            let _guard = self
                .lock
                .read()
                .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
            self.write_gate.ensure_available()?;
            read_only()
        };

        match read_result {
            Ok(value) => Ok(value),
            Err(error) => {
                if self.write_gate.atomic_update_active()? {
                    return Err(error);
                }
                let _write_permit = self.write_gate.begin_write()?;
                let _guard = self
                    .lock
                    .write()
                    .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
                recover()
            }
        }
    }

    fn read_collection(&self, collection: &str) -> AppResult<Vec<Value>> {
        if let Some(rows) = self.cached_rows(collection)? {
            return Ok(rows);
        }
        let rows = self.read_collection_from_disk(collection)?;
        self.cache_collection(collection, &rows, false)?;
        Ok(rows)
    }

    fn read_collection_no_recovery(&self, collection: &str) -> AppResult<Vec<Value>> {
        if let Some(rows) = self.cached_rows(collection)? {
            return Ok(rows);
        }
        let rows = self.read_collection_from_disk_no_recovery(collection)?;
        self.cache_collection(collection, &rows, false)?;
        Ok(rows)
    }

    fn read_collection_from_disk(&self, collection: &str) -> AppResult<Vec<Value>> {
        let path = self.collection_path(collection)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&path)?;
        if raw.trim().is_empty() {
            return Ok(Vec::new());
        }
        parse_collection_rows(collection, &raw)
            .or_else(|error| self.recover_collection_after_read_error(collection, &path, error))
    }

    fn read_collection_from_disk_no_recovery(&self, collection: &str) -> AppResult<Vec<Value>> {
        let path = self.collection_path(collection)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&path)?;
        if raw.trim().is_empty() {
            return Ok(Vec::new());
        }
        parse_collection_rows(collection, &raw)
    }

    fn read_collection_filtered(
        &self,
        collection: &str,
        filters: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        Ok(self
            .read_collection(collection)?
            .into_iter()
            .filter(|row| row_matches_filters(row, filters))
            .collect())
    }

    fn read_collection_filtered_no_recovery(
        &self,
        collection: &str,
        filters: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        Ok(self
            .read_collection_no_recovery(collection)?
            .into_iter()
            .filter(|row| row_matches_filters(row, filters))
            .collect())
    }

    fn read_collection_where_in(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
    ) -> AppResult<Vec<Value>> {
        self.read_collection_where_in_inner(collection, filter_field, filter_values, true)
    }

    fn read_collection_where_in_no_recovery(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
    ) -> AppResult<Vec<Value>> {
        self.read_collection_where_in_inner(collection, filter_field, filter_values, false)
    }

    fn read_collection_where_in_inner(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if filter_values.is_empty() {
            return Ok(Vec::new());
        }
        if let Some(rows) = self.cached_rows(collection)? {
            return Ok(rows
                .into_iter()
                .filter(|row| row_string_field_matches_in(row, filter_field, filter_values))
                .collect());
        }

        let path = self.collection_path(collection)?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }

        let file = fs::File::open(&path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(FilteredRowsWhereInVisitor {
            filter_field,
            filter_values,
        }) {
            Ok(rows) => Ok(rows),
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_collection(collection)?
                } else {
                    self.read_collection_no_recovery(collection)?
                };
                Ok(rows
                    .into_iter()
                    .filter(|row| row_string_field_matches_in(row, filter_field, filter_values))
                    .collect())
            }
        }
    }

    fn read_collection_projected(
        &self,
        collection: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_collection_projected_inner(collection, fields, field_selections, true)
    }

    fn read_collection_projected_no_recovery(
        &self,
        collection: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_collection_projected_inner(collection, fields, field_selections, false)
    }

    fn read_collection_projected_inner(
        &self,
        collection: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if fields.is_empty() {
            return Ok(Vec::new());
        }
        let field_set: HashSet<String> = fields.iter().cloned().collect();
        let nested_field_sets = selected_nested_fields(field_selections);
        if let Some(rows) = self.cached_dirty_rows(collection)? {
            return Ok(rows
                .into_iter()
                .map(|row| project_row(row, &field_set, &nested_field_sets))
                .collect());
        }

        let cache_key = ProjectionCacheKey {
            collection: collection.to_string(),
            shape: projection_shape(fields, &nested_field_sets),
        };
        let path = self.collection_path(collection)?;
        let stamp = collection_fast_stamp(&path)?;
        if let Some(rows) = self.cached_projected_list_rows(&cache_key, stamp)? {
            return Ok(rows);
        }

        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }

        let file = fs::File::open(&path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(ProjectedRowsVisitor {
            fields: &field_set,
            field_selections: &nested_field_sets,
        }) {
            Ok(rows) => {
                let refreshed_stamp = collection_fast_stamp(&path)?;
                if collection_fast_stamps_share_content_window(stamp, refreshed_stamp) {
                    self.cache_projected_list(&cache_key, &rows, refreshed_stamp)?;
                }
                Ok(rows)
            }
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_collection_from_disk(collection)?
                } else {
                    self.read_collection_from_disk_no_recovery(collection)?
                };
                let projected = rows
                    .into_iter()
                    .map(|row| project_row(row, &field_set, &nested_field_sets))
                    .collect::<Vec<_>>();
                let refreshed_stamp = collection_fast_stamp(&path)?;
                if collection_fast_stamps_share_content_window(stamp, refreshed_stamp) {
                    self.cache_projected_list(&cache_key, &projected, refreshed_stamp)?;
                }
                Ok(projected)
            }
        }
    }

    fn read_collection_projected_where(
        &self,
        collection: &str,
        filters: &Map<String, Value>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_collection_projected_where_inner(
            collection,
            filters,
            fields,
            field_selections,
            true,
        )
    }

    fn read_collection_projected_where_no_recovery(
        &self,
        collection: &str,
        filters: &Map<String, Value>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_collection_projected_where_inner(
            collection,
            filters,
            fields,
            field_selections,
            false,
        )
    }

    fn read_collection_projected_where_inner(
        &self,
        collection: &str,
        filters: &Map<String, Value>,
        fields: &[String],
        field_selections: &Map<String, Value>,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if fields.is_empty() {
            return Ok(Vec::new());
        }
        let field_set: HashSet<String> = fields.iter().cloned().collect();
        let nested_field_sets = selected_nested_fields(field_selections);
        if let Some(rows) = self.cached_dirty_rows(collection)? {
            return Ok(rows
                .into_iter()
                .filter(|row| row_matches_filters(row, filters))
                .map(|row| project_row(row, &field_set, &nested_field_sets))
                .collect());
        }

        let path = self.collection_path(collection)?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }

        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(ProjectedRowsWhereVisitor {
            filters,
            fields: &field_set,
            field_selections: &nested_field_sets,
        }) {
            Ok(rows) => Ok(rows),
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_collection(collection)?
                } else {
                    self.read_collection_no_recovery(collection)?
                };
                Ok(rows
                    .into_iter()
                    .filter(|row| row_matches_filters(row, filters))
                    .map(|row| project_row(row, &field_set, &nested_field_sets))
                    .collect())
            }
        }
    }
    fn read_collection_projected_where_in(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_collection_projected_where_in_inner(
            collection,
            filter_field,
            filter_values,
            fields,
            field_selections,
            true,
        )
    }

    fn read_collection_projected_where_in_no_recovery(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_collection_projected_where_in_inner(
            collection,
            filter_field,
            filter_values,
            fields,
            field_selections,
            false,
        )
    }

    fn read_collection_projected_where_in_inner(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
        fields: &[String],
        field_selections: &Map<String, Value>,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if fields.is_empty() || filter_values.is_empty() {
            return Ok(Vec::new());
        }
        let field_set: HashSet<String> = fields.iter().cloned().collect();
        let nested_field_sets = selected_nested_fields(field_selections);
        if let Some(rows) = self.cached_dirty_rows(collection)? {
            return Ok(rows
                .into_iter()
                .filter(|row| row_string_field_matches_in(row, filter_field, filter_values))
                .map(|row| project_row(row, &field_set, &nested_field_sets))
                .collect());
        }

        let path = self.collection_path(collection)?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }

        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(ProjectedRowsWhereInVisitor {
            filter_field,
            filter_values,
            fields: &field_set,
            field_selections: &nested_field_sets,
        }) {
            Ok(rows) => Ok(rows),
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_collection(collection)?
                } else {
                    self.read_collection_no_recovery(collection)?
                };
                Ok(rows
                    .into_iter()
                    .filter(|row| row_string_field_matches_in(row, filter_field, filter_values))
                    .map(|row| project_row(row, &field_set, &nested_field_sets))
                    .collect())
            }
        }
    }

    fn read_chat_summaries(
        &self,
        fields: &[String],
        field_selections: &Map<String, Value>,
        descending: bool,
        limit: Option<usize>,
    ) -> AppResult<Vec<Value>> {
        self.read_chat_summaries_inner(fields, field_selections, descending, limit, true)
    }

    fn read_chat_summaries_no_recovery(
        &self,
        fields: &[String],
        field_selections: &Map<String, Value>,
        descending: bool,
        limit: Option<usize>,
    ) -> AppResult<Vec<Value>> {
        self.read_chat_summaries_inner(fields, field_selections, descending, limit, false)
    }

    fn read_chat_summaries_inner(
        &self,
        fields: &[String],
        field_selections: &Map<String, Value>,
        descending: bool,
        limit: Option<usize>,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if fields.is_empty() || limit == Some(0) {
            return Ok(Vec::new());
        }
        if let Some(rows) = self.cached_dirty_rows("chats")? {
            return Ok(project_chat_summary_rows(
                rows,
                fields,
                field_selections,
                descending,
                limit,
            ));
        }
        let path = self.collection_path("chats")?;
        let source_stamp = chat_summary_source_stamp(&path)?;
        if source_stamp.is_none() {
            remove_chat_summary_read_model(&self.root)?;
            return Ok(Vec::new());
        }
        if !chat_summary_read_model_current(&self.root, source_stamp.as_deref())? {
            let rows = if recover_on_fallback {
                self.read_collection_from_disk("chats")?
            } else {
                self.read_collection_from_disk_no_recovery("chats")?
            };
            rebuild_chat_summary_read_model(&self.root, source_stamp.as_deref(), &rows)?;
        }
        list_chat_summaries_from_read_model(&self.root, fields, field_selections, descending, limit)
    }

    fn read_collection_find_by_id(&self, collection: &str, id: &str) -> AppResult<Option<Value>> {
        self.read_collection_find_by_id_inner(collection, id, true)
    }

    fn read_collection_find_by_id_no_recovery(
        &self,
        collection: &str,
        id: &str,
    ) -> AppResult<Option<Value>> {
        self.read_collection_find_by_id_inner(collection, id, false)
    }

    fn read_collection_find_by_id_projected(
        &self,
        collection: &str,
        id: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Option<Value>> {
        self.read_collection_find_by_id_projected_inner(
            collection,
            id,
            fields,
            field_selections,
            true,
        )
    }

    fn read_collection_find_by_id_projected_no_recovery(
        &self,
        collection: &str,
        id: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Option<Value>> {
        self.read_collection_find_by_id_projected_inner(
            collection,
            id,
            fields,
            field_selections,
            false,
        )
    }

    fn read_collection_find_by_id_inner(
        &self,
        collection: &str,
        id: &str,
        recover_on_fallback: bool,
    ) -> AppResult<Option<Value>> {
        if let Some(row) = self.cached_row_by_id(collection, id)? {
            return Ok(row);
        }
        let path = self.collection_path(collection)?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(None);
        }
        match self.indexed_row_by_id_from_disk(collection, id, recover_on_fallback) {
            Ok(row) => return Ok(row),
            Err(error)
                if recover_on_fallback && error.code == "storage_collection_recovery_required" =>
            {
                return Err(error);
            }
            Err(_) => {}
        }
        match read_pretty_record_by_id_from_file(&path, id) {
            Ok(Some(row)) => return Ok(Some(row)),
            Ok(None) => {}
            Err(_) => {}
        }
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(FindRowByIdVisitor { id }) {
            Ok(row) => Ok(row),
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_collection(collection)?
                } else {
                    self.read_collection_no_recovery(collection)?
                };
                Ok(rows
                    .into_iter()
                    .find(|row| row.get("id").and_then(Value::as_str) == Some(id)))
            }
        }
    }

    fn read_collection_find_by_id_projected_inner(
        &self,
        collection: &str,
        id: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
        recover_on_fallback: bool,
    ) -> AppResult<Option<Value>> {
        if fields.is_empty() {
            return self.read_collection_find_by_id_inner(collection, id, recover_on_fallback);
        }

        let field_set: HashSet<String> = fields.iter().cloned().collect();
        let nested_field_sets = selected_nested_fields(field_selections);
        if let Some(row) = self.cached_dirty_row_by_id(collection, id)? {
            return Ok(row.map(|row| project_row(row, &field_set, &nested_field_sets)));
        }

        let path = self.collection_path(collection)?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(None);
        }

        match self.indexed_projected_row_by_id_from_disk(
            collection,
            id,
            &field_set,
            &nested_field_sets,
            recover_on_fallback,
        ) {
            Ok(row) => return Ok(row),
            Err(error)
                if recover_on_fallback && error.code == "storage_collection_recovery_required" =>
            {
                return Err(error);
            }
            Err(_) => {}
        }
        match read_pretty_projected_record_by_id_from_file(
            &path,
            id,
            &field_set,
            &nested_field_sets,
        ) {
            Ok(Some(row)) => return Ok(Some(row)),
            Ok(None) => {}
            Err(_) => {}
        }
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(ProjectedRowByIdVisitor {
            id,
            fields: &field_set,
            field_selections: &nested_field_sets,
        }) {
            Ok(row) => Ok(row),
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_collection(collection)?
                } else {
                    self.read_collection_no_recovery(collection)?
                };
                Ok(rows
                    .into_iter()
                    .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
                    .map(|row| project_row(row, &field_set, &nested_field_sets)))
            }
        }
    }

    fn read_messages_for_chat(&self, chat_id: &str) -> AppResult<Vec<Value>> {
        self.read_messages_for_chat_inner(chat_id, true)
    }

    fn read_messages_for_chat_no_recovery(&self, chat_id: &str) -> AppResult<Vec<Value>> {
        self.read_messages_for_chat_inner(chat_id, false)
    }

    fn read_messages_for_chat_projected(
        &self,
        chat_id: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_messages_for_chat_projected_inner(chat_id, fields, field_selections, true)
    }

    fn read_messages_for_chat_projected_no_recovery(
        &self,
        chat_id: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_messages_for_chat_projected_inner(chat_id, fields, field_selections, false)
    }

    fn read_messages_for_chat_projected_inner(
        &self,
        chat_id: &str,
        fields: &[String],
        field_selections: &Map<String, Value>,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if fields.is_empty() {
            return Ok(Vec::new());
        }
        let field_set: HashSet<String> = fields.iter().cloned().collect();
        let nested_field_sets = selected_nested_fields(field_selections);
        if let Some(rows) = self.cached_dirty_rows("messages")? {
            return Ok(rows
                .into_iter()
                .filter(|row| row.get("chatId").and_then(Value::as_str) == Some(chat_id))
                .map(|row| project_row(row, &field_set, &nested_field_sets))
                .collect());
        }

        let path = self.collection_path("messages")?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }

        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(ProjectedMessageRowsForChatVisitor {
            chat_id,
            fields: &field_set,
            field_selections: &nested_field_sets,
        }) {
            Ok(rows) => Ok(rows),
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_messages_for_chat(chat_id)?
                } else {
                    self.read_messages_for_chat_no_recovery(chat_id)?
                };
                Ok(rows
                    .into_iter()
                    .map(|row| project_row(row, &field_set, &nested_field_sets))
                    .collect())
            }
        }
    }

    fn read_messages_for_chat_inner(
        &self,
        chat_id: &str,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if let Some(rows) = self.cached_rows("messages")? {
            return Ok(rows
                .into_iter()
                .filter(|row| row.get("chatId").and_then(Value::as_str) == Some(chat_id))
                .collect());
        }
        let path = self.collection_path("messages")?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(MessageRowsForChatVisitor { chat_id }) {
            Ok(rows) => Ok(rows),
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_collection("messages")?
                } else {
                    self.read_collection_no_recovery("messages")?
                };
                Ok(rows
                    .into_iter()
                    .filter(|row| row.get("chatId").and_then(Value::as_str) == Some(chat_id))
                    .collect())
            }
        }
    }

    fn read_message_ids_for_chat(&self, chat_id: &str) -> AppResult<Vec<Value>> {
        self.read_message_ids_for_chat_inner(chat_id, true)
    }

    fn read_message_ids_for_chat_no_recovery(&self, chat_id: &str) -> AppResult<Vec<Value>> {
        self.read_message_ids_for_chat_inner(chat_id, false)
    }

    fn read_message_ids_for_chat_inner(
        &self,
        chat_id: &str,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if let Some(rows) = self.cached_dirty_rows("messages")? {
            return Ok(rows
                .into_iter()
                .filter(|row| row.get("chatId").and_then(Value::as_str) == Some(chat_id))
                .filter_map(|row| {
                    let id = row.get("id")?.clone();
                    let mut object = Map::new();
                    object.insert("id".to_string(), id);
                    Some(Value::Object(object))
                })
                .collect());
        }
        let path = self.collection_path("messages")?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(MessageIdRowsForChatVisitor { chat_id }) {
            Ok(rows) => Ok(rows),
            Err(_) => {
                let rows = if recover_on_fallback {
                    self.read_collection("messages")?
                } else {
                    self.read_collection_no_recovery("messages")?
                };
                Ok(rows
                    .into_iter()
                    .filter(|row| row.get("chatId").and_then(Value::as_str) == Some(chat_id))
                    .filter_map(|row| {
                        let id = row.get("id")?.clone();
                        let mut object = Map::new();
                        object.insert("id".to_string(), id);
                        Some(Value::Object(object))
                    })
                    .collect())
            }
        }
    }

    fn read_message_count_for_chat(&self, chat_id: &str) -> AppResult<usize> {
        self.read_message_count_for_chat_inner(chat_id, true)
    }

    fn read_message_count_for_chat_no_recovery(&self, chat_id: &str) -> AppResult<usize> {
        self.read_message_count_for_chat_inner(chat_id, false)
    }

    fn read_message_count_for_chat_inner(
        &self,
        chat_id: &str,
        recover_on_fallback: bool,
    ) -> AppResult<usize> {
        if let Some(rows) = self.cached_rows("messages")? {
            return Ok(rows
                .iter()
                .filter(|row| row.get("chatId").and_then(Value::as_str) == Some(chat_id))
                .count());
        }
        let path = self.collection_path("messages")?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(0);
        }
        if let Some(count) = count_pretty_messages_for_chat(&path, chat_id)? {
            return Ok(count);
        }
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(MessageCountForChatVisitor { chat_id }) {
            Ok(count) => Ok(count),
            Err(_) => {
                if recover_on_fallback {
                    Ok(self.read_messages_for_chat(chat_id)?.len())
                } else {
                    Ok(self.read_messages_for_chat_no_recovery(chat_id)?.len())
                }
            }
        }
    }

    fn read_messages_for_chat_page(
        &self,
        chat_id: &str,
        limit: usize,
        before: Option<&str>,
    ) -> AppResult<Vec<Value>> {
        self.read_messages_for_chat_page_inner(chat_id, limit, before, true)
    }

    fn read_messages_for_chat_page_no_recovery(
        &self,
        chat_id: &str,
        limit: usize,
        before: Option<&str>,
    ) -> AppResult<Vec<Value>> {
        self.read_messages_for_chat_page_inner(chat_id, limit, before, false)
    }

    fn read_messages_for_chat_page_inner(
        &self,
        chat_id: &str,
        limit: usize,
        before: Option<&str>,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        if let Some(rows) = self.cached_rows("messages")? {
            let mut rows = rows
                .into_iter()
                .filter(|row| row.get("chatId").and_then(Value::as_str) == Some(chat_id))
                .collect::<Vec<_>>();
            apply_message_page(&mut rows, limit, before);
            return Ok(rows);
        }
        let path = self.collection_path("messages")?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }

        match read_pretty_message_page_from_file(&path, chat_id, limit, before) {
            Ok(Some(rows)) => return Ok(rows),
            Ok(None) => {}
            Err(_) => {}
        }

        let mut rows = if recover_on_fallback {
            self.read_messages_for_chat(chat_id)?
        } else {
            self.read_messages_for_chat_no_recovery(chat_id)?
        };
        apply_message_page(&mut rows, limit, before);
        Ok(rows)
    }

    fn read_messages_for_chat_page_projected(
        &self,
        chat_id: &str,
        limit: usize,
        before: Option<&str>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_messages_for_chat_page_projected_inner(
            chat_id,
            limit,
            before,
            fields,
            field_selections,
            true,
        )
    }

    fn read_messages_for_chat_page_projected_no_recovery(
        &self,
        chat_id: &str,
        limit: usize,
        before: Option<&str>,
        fields: &[String],
        field_selections: &Map<String, Value>,
    ) -> AppResult<Vec<Value>> {
        self.read_messages_for_chat_page_projected_inner(
            chat_id,
            limit,
            before,
            fields,
            field_selections,
            false,
        )
    }

    fn read_messages_for_chat_page_projected_inner(
        &self,
        chat_id: &str,
        limit: usize,
        before: Option<&str>,
        fields: &[String],
        field_selections: &Map<String, Value>,
        recover_on_fallback: bool,
    ) -> AppResult<Vec<Value>> {
        if limit == 0 || fields.is_empty() {
            return Ok(Vec::new());
        }

        let field_set: HashSet<String> = fields.iter().cloned().collect();
        let nested_field_sets = selected_nested_fields(field_selections);
        if let Some(rows) = self.cached_rows("messages")? {
            let mut rows = rows
                .into_iter()
                .filter(|row| row.get("chatId").and_then(Value::as_str) == Some(chat_id))
                .collect::<Vec<_>>();
            apply_message_page(&mut rows, limit, before);
            return Ok(rows
                .into_iter()
                .map(|row| project_row(row, &field_set, &nested_field_sets))
                .collect());
        }

        let path = self.collection_path("messages")?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(Vec::new());
        }

        match read_pretty_projected_message_page_from_file(
            &path,
            chat_id,
            limit,
            before,
            &field_set,
            &nested_field_sets,
        ) {
            Ok(Some(rows)) => return Ok(rows),
            Ok(None) => {}
            Err(_) => {}
        }

        let mut rows = if recover_on_fallback {
            self.read_messages_for_chat(chat_id)?
        } else {
            self.read_messages_for_chat_no_recovery(chat_id)?
        };
        apply_message_page(&mut rows, limit, before);
        Ok(rows
            .into_iter()
            .map(|row| project_row(row, &field_set, &nested_field_sets))
            .collect())
    }

    fn cached_projected_list_rows(
        &self,
        key: &ProjectionCacheKey,
        stamp: Option<CollectionFastStamp>,
    ) -> AppResult<Option<Vec<Value>>> {
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        let access = next_cache_access(&mut cache);
        Ok(cache.projected_lists.get_mut(key).and_then(|cached| {
            if cached.stamp != stamp {
                return None;
            }
            cached.last_access = access;
            Some(cached.rows.clone())
        }))
    }

    fn cache_projected_list(
        &self,
        key: &ProjectionCacheKey,
        rows: &[Value],
        stamp: Option<CollectionFastStamp>,
    ) -> AppResult<()> {
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        let approx_bytes = rows.iter().map(approximate_json_bytes).sum::<usize>();
        if approx_bytes > MAX_TOTAL_CLEAN_COLLECTION_CACHE_BYTES {
            cache.projected_lists.remove(key);
            return Ok(());
        }
        if !cache.projected_lists.contains_key(key)
            && cache.projected_lists.len() >= MAX_PROJECTED_LIST_CACHE_SHAPES
        {
            if let Some(eviction_key) = cache
                .projected_lists
                .iter()
                .min_by_key(|(_, entry)| entry.last_access)
                .map(|(key, _)| key.clone())
            {
                cache.projected_lists.remove(&eviction_key);
            }
        }
        cache.projected_lists.remove(key);
        while clean_cache_bytes(&cache).saturating_add(approx_bytes) > MAX_TOTAL_CLEAN_COLLECTION_CACHE_BYTES {
            if !evict_oldest_clean_cache_entry(&mut cache) {
                break;
            }
        }
        let last_access = next_cache_access(&mut cache);
        cache.projected_lists.insert(
            key.clone(),
            CachedProjectedList {
                rows: rows.to_vec(),
                stamp,
                approx_bytes,
                last_access,
            },
        );
        Ok(())
    }

    fn indexed_row_by_id_from_disk(
        &self,
        collection: &str,
        id: &str,
        recover_on_fallback: bool,
    ) -> AppResult<Option<Value>> {
        let Some((path, record)) =
            self.indexed_record_by_id_from_disk(collection, id, recover_on_fallback)?
        else {
            return Ok(None);
        };
        read_indexed_record_value(&path, &record)
    }

    fn indexed_projected_row_by_id_from_disk(
        &self,
        collection: &str,
        id: &str,
        fields: &HashSet<String>,
        field_selections: &HashMap<String, HashSet<String>>,
        recover_on_fallback: bool,
    ) -> AppResult<Option<Value>> {
        let Some((path, record)) =
            self.indexed_record_by_id_from_disk(collection, id, recover_on_fallback)?
        else {
            return Ok(None);
        };
        read_indexed_record_projected_value(&path, &record, id, fields, field_selections)
    }

    fn indexed_record_by_id_from_disk(
        &self,
        collection: &str,
        id: &str,
        recover_on_fallback: bool,
    ) -> AppResult<Option<(PathBuf, CachedCollectionRecord)>> {
        let path = self.collection_path(collection)?;
        for _ in 0..2 {
            let stamp = collection_content_stamp(&path)?;
            if stamp.is_none() {
                return Ok(None);
            }
            if let Some(row) = self.cached_indexed_row_by_id(collection, id, stamp)? {
                return Ok(row.map(|record| (path, record)));
            }

            let records_by_id = if let Some(ranges) = pretty_record_ranges_by_id(&path)? {
                ranges
                    .into_iter()
                    .map(|(id, range)| (id, CachedCollectionRecord::PrettyRange(range)))
                    .collect()
            } else {
                let rows = if recover_on_fallback {
                    self.read_collection_from_disk(collection)?
                } else {
                    self.read_collection_from_disk_no_recovery(collection)?
                };
                records_by_id(&rows)
            };
            #[cfg(test)]
            run_index_build_test_hook(&path)?;
            let refreshed_stamp = collection_content_stamp(&path)?;
            if refreshed_stamp != stamp {
                continue;
            }
            let record = records_by_id.get(id).cloned();
            self.cache_id_index(collection, records_by_id, refreshed_stamp)?;
            return Ok(record.map(|record| (path, record)));
        }

        self.uncached_record_by_id_from_disk(collection, id, recover_on_fallback)
    }

    fn uncached_record_by_id_from_disk(
        &self,
        collection: &str,
        id: &str,
        recover_on_fallback: bool,
    ) -> AppResult<Option<(PathBuf, CachedCollectionRecord)>> {
        let path = self.collection_path(collection)?;
        let rows = if recover_on_fallback {
            self.read_collection_from_disk(collection)?
        } else {
            self.read_collection_from_disk_no_recovery(collection)?
        };
        Ok(rows
            .into_iter()
            .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
            .map(|row| (path, CachedCollectionRecord::Row(row))))
    }

    fn cached_indexed_row_by_id(
        &self,
        collection: &str,
        id: &str,
        stamp: Option<CollectionContentStamp>,
    ) -> AppResult<Option<Option<CachedCollectionRecord>>> {
        validate_collection_name(collection)?;
        let cache = self
            .cache
            .read()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        Ok(cache
            .id_indexes
            .get(collection)
            .filter(|cached| cached.stamp == stamp)
            .map(|cached| cached.records_by_id.get(id).cloned()))
    }

    fn cache_id_index(
        &self,
        collection: &str,
        records_by_id: HashMap<String, CachedCollectionRecord>,
        stamp: Option<CollectionContentStamp>,
    ) -> AppResult<()> {
        validate_collection_name(collection)?;
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        cache.id_indexes.insert(
            collection.to_string(),
            CachedCollectionIdIndex {
                records_by_id,
                stamp,
            },
        );
        Ok(())
    }

    fn write_collection(
        &self,
        collection: &str,
        rows: &[Value],
        mutation: CollectionMutation,
    ) -> AppResult<()> {
        validate_collection_name(collection)?;
        // Fail before recording a durable mutation if the cache cannot accept it.
        drop(
            self.cache
                .write()
                .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?,
        );
        if collection == "chats" {
            remove_chat_summary_read_model(&self.root)?;
        }
        append_collection_mutation(&self.root.join("collections"), collection, &mutation)?;
        self.cache_collection(collection, rows, true)?;
        self.schedule_dirty_flush();
        Ok(())
    }

    fn write_collection_immediate(&self, collection: &str, rows: &[Value]) -> AppResult<()> {
        self.write_collection_file(collection, rows)?;
        if collection == "chats" {
            let path = self.collection_path(collection)?;
            let source_stamp = chat_summary_source_stamp(&path)?;
            rebuild_chat_summary_read_model(&self.root, source_stamp.as_deref(), rows)?;
        }
        remove_collection_journal(&self.root.join("collections"), collection)?;
        self.invalidate_read_indexes_for_collection(collection)?;
        self.cache_collection(collection, rows, false)?;
        Ok(())
    }

    fn write_collection_file(&self, collection: &str, rows: &[Value]) -> AppResult<()> {
        let path = self.collection_path(collection)?;
        let collections_dir = self.root.join("collections");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if append_journal::checkpoint_tracks(collection) {
            append_journal::recover(&collections_dir)?;
            append_journal::invalidate_checkpoint(&collections_dir)?;
        }
        refresh_collection_backup(&path)?;
        write_file_atomically(&path, &serde_json::to_vec_pretty(rows)?)?;
        Ok(())
    }

    fn append_collection_row(&self, collection: &str, record: &Value) -> AppResult<()> {
        let path = self.collection_path(collection)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if append_journal::checkpoint_tracks(collection) {
            let collections_dir = self.root.join("collections");
            append_journal::recover(&collections_dir)?;
            append_journal::invalidate_checkpoint(&collections_dir)?;
        }
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            self.write_collection_immediate(collection, std::slice::from_ref(record))?;
            return Ok(());
        }

        let mut file = fs::File::open(&path)?;
        let mut cursor = file.metadata()?.len();
        let mut byte = [0_u8; 1];
        while cursor > 0 {
            cursor -= 1;
            file.seek(SeekFrom::Start(cursor))?;
            file.read_exact(&mut byte)?;
            if !byte[0].is_ascii_whitespace() {
                break;
            }
        }
        if byte[0] != b']' {
            let mut rows = self.recover_collection_after_read_error(
                collection,
                &path,
                AppError::invalid_input(format!(
                    "Collection {collection} did not contain a JSON array"
                )),
            )?;
            rows.push(record.clone());
            self.write_collection_immediate(collection, &rows)?;
            return Ok(());
        }

        let mut before_close = cursor;
        let mut is_empty = false;
        while before_close > 0 {
            before_close -= 1;
            file.seek(SeekFrom::Start(before_close))?;
            file.read_exact(&mut byte)?;
            if byte[0].is_ascii_whitespace() {
                continue;
            }
            is_empty = byte[0] == b'[';
            break;
        }

        refresh_collection_backup(&path)?;
        let tmp = unique_sibling_path(&path, "tmp")?;
        let mut source = fs::File::open(&path)?;
        let mut output = fs::File::create(&tmp)?;
        std::io::copy(&mut Read::by_ref(&mut source).take(cursor), &mut output)?;
        let serialized = serde_json::to_string_pretty(record)?;
        let indented = serialized
            .lines()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        if is_empty {
            output.write_all(format!("\n{indented}\n]\n").as_bytes())?;
        } else {
            output.write_all(format!(",\n{indented}\n]\n").as_bytes())?;
        }
        output.sync_all()?;
        fs::rename(tmp, &path)?;
        if collection == "chats" {
            let rows = self.read_collection_from_disk_no_recovery(collection)?;
            let source_stamp = chat_summary_source_stamp(&path)?;
            rebuild_chat_summary_read_model(&self.root, source_stamp.as_deref(), &rows)?;
        }
        Ok(())
    }

    fn append_many_uncached_locked(&self, appends: Vec<(&str, Vec<Value>)>) -> AppResult<bool> {
        if appends
            .iter()
            .any(|(collection, _)| !append_journal::checkpoint_tracks(collection))
        {
            return Ok(false);
        }
        let mut seen_paths = HashSet::new();
        for (collection, _) in &appends {
            let path = self.collection_path(collection)?;
            if !seen_paths.insert(path.clone()) {
                return Err(AppError::invalid_input(format!(
                    "Duplicate collection append: {collection}"
                )));
            }
            if !can_append_to_collection_file(&path)? {
                return Ok(false);
            }
        }

        let collections_dir = self.root.join("collections");
        append_journal::append_transaction(&collections_dir, &appends)?;
        let mut apply_error = None;
        for (collection, rows) in &appends {
            let path = self.collection_path(collection)?;
            match append_to_collection_file_in_place(&path, rows) {
                Ok(true) => {}
                Ok(false) => {
                    apply_error = Some(AppError::invalid_input(format!(
                        "Collection {collection} stopped matching the appendable JSON array format"
                    )));
                    break;
                }
                Err(error) => {
                    apply_error = Some(error);
                    break;
                }
            }
        }
        if let Some(error) = apply_error {
            eprintln!(
                "[storage] committed collection append required synchronous recovery: {}",
                error.message
            );
            if let Err(recovery_error) = append_journal::recover(&collections_dir) {
                self.write_gate.mark_recovery_required()?;
                return Err(recovery_error);
            }
            self.append_cached_collection_rows(&appends)?;
            return Ok(true);
        }
        sync_directory(&collections_dir)?;
        self.append_cached_collection_rows(&appends)?;
        Ok(true)
    }

    fn recover_collection_after_read_error(
        &self,
        collection: &str,
        path: &Path,
        error: AppError,
    ) -> AppResult<Vec<Value>> {
        if append_journal::checkpoint_tracks(collection) {
            append_journal::recover(&self.root.join("collections"))?;
            if let Ok(rows) = parse_collection_file(collection, path) {
                return Ok(rows);
            }
        }
        let backup = backup_path_for(path)?;
        if backup.exists() {
            match parse_collection_file(collection, &backup) {
                Ok(rows) => {
                    eprintln!(
                        "[storage] {collection} collection file is corrupt; recovering from backup. primary={} backup={} error={}",
                        path.display(),
                        backup.display(),
                        error.message
                    );
                    preserve_corrupt_file(path)?;
                    self.write_collection_immediate(collection, &rows)?;
                    return Ok(rows);
                }
                Err(backup_error) => {
                    eprintln!(
                        "[storage] {collection} collection file and backup are corrupt; preserving both and requiring manual recovery. primary={} backup={} primary_error={} backup_error={}",
                        path.display(),
                        backup.display(),
                        error.message,
                        backup_error.message
                    );
                    preserve_corrupt_file(path)?;
                    preserve_corrupt_file(&backup)?;
                    return Err(AppError::with_details(
                        "storage_collection_recovery_required",
                        format!(
                            "{collection} storage is corrupt and its backup could not be recovered. De-Koi preserved the corrupt files and stopped before replacing them with empty data."
                        ),
                        json!({
                            "collection": collection,
                            "primaryPath": path.display().to_string(),
                            "backupPath": backup.display().to_string(),
                            "primaryError": error.message,
                            "backupError": backup_error.message,
                        }),
                    ));
                }
            }
        }

        eprintln!(
            "[storage] {collection} collection file is corrupt and no backup exists; preserving it and requiring manual recovery. primary={} error={}",
            path.display(),
            error.message
        );
        preserve_corrupt_file(path)?;
        Err(AppError::with_details(
            "storage_collection_recovery_required",
            format!(
                "{collection} storage is corrupt and no backup exists. De-Koi preserved the corrupt file and stopped before replacing it with empty data."
            ),
            json!({
                "collection": collection,
                "primaryPath": path.display().to_string(),
                "primaryError": error.message,
            }),
        ))
    }

    fn replace_all_many_locked<F>(
        &self,
        replacements: Vec<(&str, Vec<Value>)>,
        after_install: F,
    ) -> AppResult<()>
    where
        F: FnOnce() -> AppResult<()>,
    {
        self.flush_dirty_collections_locked()?;
        let collections_dir = self.root.join("collections");
        if replacements
            .iter()
            .any(|(collection, _)| append_journal::checkpoint_tracks(collection))
        {
            append_journal::invalidate_checkpoint(&collections_dir)?;
        }
        let transaction_id = storage_transaction_id();
        let mut pending = Vec::new();
        let mut seen_paths = HashSet::new();
        let prepare_result = (|| -> AppResult<()> {
            for (index, (collection, rows)) in replacements.iter().enumerate() {
                let path = self.collection_path(collection)?;
                if !seen_paths.insert(path.clone()) {
                    return Err(AppError::invalid_input(format!(
                        "Duplicate collection replacement: {collection}"
                    )));
                }
                let existed = match fs::symlink_metadata(&path) {
                    Ok(metadata) => {
                        if !metadata.file_type().is_file() {
                            return Err(AppError::io(std::io::Error::other(format!(
                                "Collection path is not a regular file: {}",
                                path.display()
                            ))));
                        }
                        true
                    }
                    Err(error) if error.kind() == ErrorKind::NotFound => false,
                    Err(error) => return Err(error.into()),
                };
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let tmp = collection_transaction_path(&path, &transaction_id, index, "tmp")?;
                let backup = collection_transaction_path(&path, &transaction_id, index, "backup")?;
                pending.push(PendingCollectionReplacement {
                    path,
                    tmp,
                    backup,
                    existed,
                });
                let item = pending
                    .last()
                    .expect("pending collection replacement should exist");
                fs::write(&item.tmp, serde_json::to_vec_pretty(rows)?)?;
                sync_file(&item.tmp)?;
            }
            Ok(())
        })();
        if let Err(error) = prepare_result {
            cleanup_pending_collection_temps(&pending);
            return Err(error);
        }

        let manifest_path = match write_prepared_collection_transaction_manifest(
            &collections_dir,
            &transaction_id,
            &pending,
        ) {
            Ok(path) => path,
            Err(error) => {
                cleanup_pending_collection_temps(&pending);
                return Err(error);
            }
        };

        let mut backed_up = Vec::new();
        let mut installed = Vec::new();
        let result = (|| -> AppResult<()> {
            for (index, item) in pending.iter().enumerate() {
                if !item.existed {
                    continue;
                }
                fs::rename(&item.path, &item.backup)?;
                backed_up.push(index);
            }
            for (index, item) in pending.iter().enumerate() {
                fs::rename(&item.tmp, &item.path)?;
                installed.push(index);
            }
            after_install()?;
            sync_directory(&collections_dir)?;
            Ok(())
        })();

        if let Err(error) = result {
            if let Err(rollback_error) =
                rollback_collection_replacements(&pending, &backed_up, &installed)
            {
                cleanup_pending_collection_temps(&pending);
                return Err(AppError::new(
                    "storage_rollback_failed",
                    format!(
                        "{error}; additionally failed to roll back collection import: {rollback_error}"
                    ),
                ));
            }
            cleanup_pending_collection_transaction_files(&pending);
            remove_collection_transaction_manifest(&manifest_path)?;
            return Err(error);
        }

        if let Err(error) = mark_collection_transaction_committed(&manifest_path) {
            recover_pending_collection_transactions(&collections_dir)?;
            return Err(error);
        }
        if let Err(error) = cleanup_pending_collection_transaction_files_checked(&pending) {
            eprintln!(
                "[storage] committed collection replacement cleanup will resume on startup: {}",
                error.message
            );
        } else {
            remove_collection_transaction_manifest(&manifest_path)?;
        }
        for (collection, rows) in replacements {
            if collection == "chats" {
                let path = self.collection_path(collection)?;
                let source_stamp = chat_summary_source_stamp(&path)?;
                rebuild_chat_summary_read_model(&self.root, source_stamp.as_deref(), &rows)?;
            }
            self.invalidate_read_indexes_for_collection(collection)?;
            self.cache_collection(collection, &rows, false)?;
        }
        Ok(())
    }
}

impl Drop for FileStorage {
    fn drop(&mut self) {
        if Arc::strong_count(&self.cache) == 1 && self.dirty_collection_count() > 0 {
            let _ = self.flush();
        }
    }
}

fn project_chat_summary_rows(
    mut rows: Vec<Value>,
    fields: &[String],
    field_selections: &Map<String, Value>,
    descending: bool,
    limit: Option<usize>,
) -> Vec<Value> {
    let field_set = fields.iter().cloned().collect::<HashSet<_>>();
    let nested_field_sets = selected_nested_fields(field_selections);
    rows.sort_by(|a, b| {
        let ordering = compare_chat_summary_updated_at(a, b);
        if descending {
            ordering.reverse()
        } else {
            ordering
        }
    });
    if let Some(limit) = limit {
        rows.truncate(limit);
    }
    rows.into_iter()
        .map(|row| project_row(row, &field_set, &nested_field_sets))
        .collect()
}

fn compare_chat_summary_updated_at(a: &Value, b: &Value) -> std::cmp::Ordering {
    let a_updated = a.get("updatedAt").and_then(Value::as_str).unwrap_or("");
    let b_updated = b.get("updatedAt").and_then(Value::as_str).unwrap_or("");
    a_updated.cmp(b_updated)
}

pub fn record_id(value: &Value) -> Option<&str> {
    value.get("id").and_then(Value::as_str)
}

pub fn merge_object_field(
    record: &mut Value,
    field: &str,
    patch: Map<String, Value>,
) -> AppResult<()> {
    let object = record
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Stored record is not an object"))?;
    let current = object
        .entry(field.to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input(format!("{field} is not an object")))?;
    for (key, value) in patch {
        current.insert(key, value);
    }
    object.insert("updatedAt".to_string(), Value::String(now_iso()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering as AtomicOrdering},
        Arc as TestArc,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_storage_root(test_name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "marinara-storage-{test_name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temporary storage root should be created");
        path
    }

    fn write_test_collection(path: &Path, rows: Vec<Value>) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
    }

    #[cfg(unix)]
    fn file_identity(path: &Path) -> u128 {
        use std::os::unix::fs::MetadataExt;

        fs::metadata(path).unwrap().ino() as u128
    }

    #[cfg(windows)]
    fn file_identity(path: &Path) -> u128 {
        use std::os::windows::fs::MetadataExt;

        fs::metadata(path).unwrap().creation_time() as u128
    }

    fn write_test_transaction_manifest(
        collections: &Path,
        phase: &str,
        entries: Value,
    ) -> PathBuf {
        let manifest = collections.join(".collection-transaction-test.json");
        fs::write(
            &manifest,
            serde_json::to_vec_pretty(&json!({
                "version": 1,
                "phase": phase,
                "entries": entries,
            }))
            .unwrap(),
        )
        .unwrap();
        manifest
    }

    #[test]
    fn prepared_transaction_restores_old_collection_on_startup() {
        let root = temp_storage_root("prepared-transaction-recovery");
        let collections = root.join("collections");
        let primary = collections.join("messages.json");
        let staged = collections.join("messages.json.profile-import-test-0.tmp");
        let backup = collections.join("messages.json.profile-import-test-0.backup");
        write_test_collection(&primary, vec![json!({ "id": "new-message" })]);
        write_test_collection(&staged, vec![json!({ "id": "new-message" })]);
        write_test_collection(&backup, vec![json!({ "id": "old-message" })]);
        let manifest = write_test_transaction_manifest(
            &collections,
            "prepared",
            json!([{
                "primary": "messages.json",
                "staged": "messages.json.profile-import-test-0.tmp",
                "backup": "messages.json.profile-import-test-0.backup",
                "existed": true,
            }]),
        );

        let storage = FileStorage::new(&root).expect("prepared transaction should recover");

        assert_eq!(storage.list("messages").unwrap(), vec![json!({ "id": "old-message" })]);
        assert!(!manifest.exists());
        assert!(!staged.exists());
        assert!(!backup.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn committed_transaction_keeps_new_collection_and_finishes_cleanup() {
        let root = temp_storage_root("committed-transaction-recovery");
        let collections = root.join("collections");
        let primary = collections.join("messages.json");
        let staged = collections.join("messages.json.profile-import-test-0.tmp");
        let backup = collections.join("messages.json.profile-import-test-0.backup");
        write_test_collection(&primary, vec![json!({ "id": "new-message" })]);
        write_test_collection(&staged, vec![json!({ "id": "new-message" })]);
        write_test_collection(&backup, vec![json!({ "id": "old-message" })]);
        let manifest = write_test_transaction_manifest(
            &collections,
            "committed",
            json!([{
                "primary": "messages.json",
                "staged": "messages.json.profile-import-test-0.tmp",
                "backup": "messages.json.profile-import-test-0.backup",
                "existed": true,
            }]),
        );

        let storage = FileStorage::new(&root).expect("committed transaction should recover");

        assert_eq!(storage.list("messages").unwrap(), vec![json!({ "id": "new-message" })]);
        assert!(!manifest.exists());
        assert!(!staged.exists());
        assert!(!backup.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_transaction_manifest_fails_closed_and_preserves_evidence() {
        let root = temp_storage_root("malformed-transaction-manifest");
        let collections = root.join("collections");
        let primary = collections.join("messages.json");
        let manifest = collections.join(".collection-transaction-broken.json");
        write_test_collection(&primary, vec![json!({ "id": "safe-message" })]);
        fs::write(&manifest, b"{ not valid json").unwrap();

        let error = match FileStorage::new(&root) {
            Ok(_) => panic!("malformed transaction must block startup"),
            Err(error) => error,
        };

        assert_eq!(error.code, "storage_transaction_recovery_required");
        assert!(manifest.exists());
        assert_eq!(
            parse_collection_file("messages", &primary).unwrap(),
            vec![json!({ "id": "safe-message" })]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inconsistent_transaction_manifest_is_rejected_before_any_collection_changes() {
        let root = temp_storage_root("inconsistent-transaction-manifest");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let personas = collections.join("personas.json");
        write_test_collection(&messages, vec![json!({ "id": "safe-message" })]);
        write_test_collection(&personas, vec![json!({ "id": "safe-persona" })]);
        let manifest = write_test_transaction_manifest(
            &collections,
            "prepared",
            json!([
                {
                    "primary": "messages.json",
                    "staged": "personas.json",
                    "backup": "messages.json.profile-import-test-0.backup",
                    "existed": true,
                },
                {
                    "primary": "personas.json",
                    "staged": "personas.json.profile-import-test-1.tmp",
                    "backup": "personas.json.profile-import-test-1.backup",
                    "existed": false,
                }
            ]),
        );

        let error = match FileStorage::new(&root) {
            Ok(_) => panic!("inconsistent transaction must block startup"),
            Err(error) => error,
        };

        assert_eq!(error.code, "storage_transaction_recovery_required");
        assert!(manifest.exists());
        assert_eq!(
            parse_collection_file("messages", &messages).unwrap(),
            vec![json!({ "id": "safe-message" })]
        );
        assert_eq!(
            parse_collection_file("personas", &personas).unwrap(),
            vec![json!({ "id": "safe-persona" })]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inconsistent_prepared_state_is_rejected_before_any_rollback() {
        let root = temp_storage_root("inconsistent-prepared-state");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let message_backup = collections.join("messages.json.profile-import-test-0.backup");
        let personas = collections.join("personas.json");
        let persona_backup = collections.join("personas.json.profile-import-test-1.backup");
        write_test_collection(&messages, vec![json!({ "id": "new-message" })]);
        write_test_collection(&message_backup, vec![json!({ "id": "impossible-backup" })]);
        write_test_collection(&personas, vec![json!({ "id": "new-persona" })]);
        write_test_collection(&persona_backup, vec![json!({ "id": "old-persona" })]);
        let manifest = write_test_transaction_manifest(
            &collections,
            "prepared",
            json!([
                {
                    "primary": "messages.json",
                    "staged": "messages.json.profile-import-test-0.tmp",
                    "backup": "messages.json.profile-import-test-0.backup",
                    "existed": false,
                },
                {
                    "primary": "personas.json",
                    "staged": "personas.json.profile-import-test-1.tmp",
                    "backup": "personas.json.profile-import-test-1.backup",
                    "existed": true,
                }
            ]),
        );

        let error = match FileStorage::new(&root) {
            Ok(_) => panic!("inconsistent prepared state must block startup"),
            Err(error) => error,
        };

        assert_eq!(error.code, "storage_transaction_recovery_required");
        assert!(manifest.exists());
        assert_eq!(
            parse_collection_file("personas", &personas).unwrap(),
            vec![json!({ "id": "new-persona" })]
        );
        assert_eq!(
            parse_collection_file("personas", &persona_backup).unwrap(),
            vec![json!({ "id": "old-persona" })]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_orphan_backup_restores_missing_primary_on_startup() {
        let root = temp_storage_root("legacy-orphan-transaction-backup");
        let collections = root.join("collections");
        let primary = collections.join("characters.json");
        let backup = collections.join("characters.json.profile-import-legacy-0.backup");
        write_test_collection(&backup, vec![json!({ "id": "restored-character" })]);

        let storage = FileStorage::new(&root).expect("unambiguous orphan backup should recover");

        assert_eq!(
            storage.list("characters").unwrap(),
            vec![json!({ "id": "restored-character" })]
        );
        assert!(primary.exists());
        assert!(!backup.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multi_collection_replace_persists_prepared_manifest_before_post_install() {
        let root = temp_storage_root("replace-manifest-before-post-install");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "old-message" })])
            .unwrap();
        storage
            .replace_all("personas", vec![json!({ "id": "old-persona" })])
            .unwrap();
        let collections = root.join("collections");
        let saw_prepared_manifest = std::cell::Cell::new(false);

        storage
            .replace_all_many_and_then(
                vec![
                    ("messages", vec![json!({ "id": "new-message" })]),
                    ("personas", vec![json!({ "id": "new-persona" })]),
                ],
                || {
                    let manifest = fs::read_dir(&collections)?
                        .filter_map(Result::ok)
                        .map(|entry| entry.path())
                        .find(|path| {
                            path.file_name()
                                .and_then(|value| value.to_str())
                                .is_some_and(|name| name.starts_with(".collection-transaction-"))
                        })
                        .ok_or_else(|| AppError::invalid_input("prepared manifest was not visible"))?;
                    let value: Value = serde_json::from_slice(&fs::read(manifest)?)?;
                    saw_prepared_manifest.set(value["phase"] == json!("prepared"));
                    Ok(())
                },
            )
            .unwrap();

        assert!(saw_prepared_manifest.get());
        assert!(fs::read_dir(&collections).unwrap().filter_map(Result::ok).all(|entry| {
            !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".collection-transaction-")
        }));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_replays_acknowledged_collection_journal() {
        let root = temp_storage_root("startup-replays-journal");
        let collections = root.join("collections");
        let primary = collections.join("characters.json");
        write_test_collection(&primary, vec![json!({ "id": "existing", "name": "Before" })]);
        journal::append_collection_mutation(
            &collections,
            "characters",
            &journal::CollectionMutation::UpsertMany {
                records: vec![json!({ "id": "existing", "name": "After" })],
            },
        )
        .unwrap();

        let storage = FileStorage::new(&root).expect("startup should replay valid journal");

        assert_eq!(
            storage.list("characters").unwrap(),
            vec![json!({ "id": "existing", "name": "After" })]
        );
        assert!(!collections.join("characters.pending.jsonl").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn successful_mutation_has_journal_before_return() {
        let root = temp_storage_root("mutation-journal-before-return");
        let storage = FileStorage::new(&root).unwrap();

        let created = storage
            .create("characters", json!({ "id": "character-1", "name": "Koi" }))
            .unwrap();

        let journal_path = root.join("collections").join("characters.pending.jsonl");
        let journal = fs::read_to_string(&journal_path)
            .expect("successful mutation must leave durable replay evidence");
        let entry: Value = serde_json::from_str(journal.lines().last().unwrap()).unwrap();
        assert_eq!(entry["mutation"]["kind"], "upsert_many");
        assert_eq!(entry["mutation"]["records"][0], created);
        storage.flush().unwrap();
        assert!(!journal_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn journal_append_failure_does_not_mutate_cache_or_primary() {
        let root = temp_storage_root("journal-append-failure");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("characters", vec![json!({ "id": "character-1", "name": "Before" })])
            .unwrap();
        let journal_path = root.join("collections").join("characters.pending.jsonl");
        fs::create_dir(&journal_path).unwrap();

        let error = storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .expect_err("journal creation failure must reject the mutation");

        assert_eq!(error.code, "io_error");
        assert_eq!(
            storage.list("characters").unwrap(),
            vec![json!({ "id": "character-1", "name": "Before" })]
        );
        assert_eq!(
            parse_collection_file(
                "characters",
                &root.join("collections").join("characters.json")
            )
            .unwrap(),
            vec![json!({ "id": "character-1", "name": "Before" })]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_replays_journal_after_rolling_back_prepared_transaction() {
        let root = temp_storage_root("transaction-before-journal-recovery");
        let collections = root.join("collections");
        let primary = collections.join("characters.json");
        let staged = collections.join("characters.json.profile-import-test-0.tmp");
        let backup = collections.join("characters.json.profile-import-test-0.backup");
        write_test_collection(&primary, vec![json!({ "id": "character-1", "name": "Interrupted" })]);
        write_test_collection(&staged, vec![json!({ "id": "character-1", "name": "Interrupted" })]);
        write_test_collection(&backup, vec![json!({ "id": "character-1", "name": "Before" })]);
        write_test_transaction_manifest(
            &collections,
            "prepared",
            json!([{
                "primary": "characters.json",
                "staged": "characters.json.profile-import-test-0.tmp",
                "backup": "characters.json.profile-import-test-0.backup",
                "existed": true,
            }]),
        );
        journal::append_collection_mutation(
            &collections,
            "characters",
            &journal::CollectionMutation::UpsertMany {
                records: vec![json!({ "id": "character-1", "name": "Journalled" })],
            },
        )
        .unwrap();

        let storage = FileStorage::new(&root).unwrap();

        assert_eq!(
            storage.list("characters").unwrap(),
            vec![json!({ "id": "character-1", "name": "Journalled" })]
        );
        assert!(!collections.join("characters.pending.jsonl").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_journal_blocks_startup_without_changing_primary() {
        let root = temp_storage_root("corrupt-journal-startup");
        let collections = root.join("collections");
        let primary = collections.join("characters.json");
        let journal_path = collections.join("characters.pending.jsonl");
        write_test_collection(&primary, vec![json!({ "id": "safe" })]);
        fs::write(&journal_path, b"{ not valid json\n").unwrap();

        let error = match FileStorage::new(&root) {
            Ok(_) => panic!("corrupt journal must block startup"),
            Err(error) => error,
        };

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert_eq!(
            parse_collection_file("characters", &primary).unwrap(),
            vec![json!({ "id": "safe" })]
        );
        assert!(journal_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    fn corruption_sentinel_count(root: &Path, file_name: &str) -> usize {
        fs::read_dir(root.join("collections"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&format!("{file_name}.corrupted-"))
            })
            .count()
    }

    fn rewrite_with_modified_time(path: &Path, bytes: &[u8], modified: SystemTime) {
        fs::write(path, bytes).unwrap();
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
    }

    fn set_content_signature_count_hook(target_path: PathBuf, counter: TestArc<AtomicUsize>) {
        *CONTENT_SIGNATURE_TEST_HOOK.lock().unwrap() = Some(Box::new(move |path| {
            if path == target_path {
                counter.fetch_add(1, AtomicOrdering::SeqCst);
            }
        }));
    }

    fn clear_content_signature_test_hook() {
        *CONTENT_SIGNATURE_TEST_HOOK.lock().unwrap() = None;
    }

    #[test]
    fn chat_summary_source_stamp_ignores_access_time_only_changes() {
        let root = temp_storage_root("chat-summary-source-stamp-access-time");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "chats",
                vec![json!({
                    "id": "chat-a",
                    "name": "Access time should not invalidate",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z"
                })],
            )
            .unwrap();
        let chats_path = root.join("collections").join("chats.json");
        let before = chat_summary_source_stamp(&chats_path).unwrap();
        let modified = fs::metadata(&chats_path).unwrap().modified().unwrap();
        let file = fs::File::options().write(true).open(&chats_path).unwrap();
        file.set_times(
            std::fs::FileTimes::new()
                .set_accessed(SystemTime::now() + Duration::from_secs(60))
                .set_modified(modified),
        )
        .unwrap();

        assert_eq!(before, chat_summary_source_stamp(&chats_path).unwrap());

        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn chat_summary_read_model_orders_and_limits_projected_rows() {
        let root = temp_storage_root("chat-summary-read-model-order-limit");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "chats",
                vec![
                    json!({
                        "id": "older",
                        "name": "Older",
                        "mode": "chat",
                        "createdAt": "2026-01-01T00:00:00Z",
                        "updatedAt": "2026-01-02T00:00:00Z",
                        "metadata": { "pinned": false, "tags": ["slow"], "secret": "omit" }
                    }),
                    json!({
                        "id": "newest",
                        "name": "Newest",
                        "mode": "roleplay",
                        "createdAt": "2026-01-01T00:00:00Z",
                        "updatedAt": "2026-01-04T00:00:00Z",
                        "metadata": { "pinned": true, "tags": ["hot"], "secret": "omit" }
                    }),
                    json!({
                        "id": "middle",
                        "name": "Middle",
                        "mode": "game",
                        "createdAt": "2026-01-01T00:00:00Z",
                        "updatedAt": "2026-01-03T00:00:00Z",
                        "metadata": { "pinned": false, "tags": ["warm"], "secret": "omit" }
                    }),
                ],
            )
            .unwrap();
        let fields = vec![
            "id".to_string(),
            "name".to_string(),
            "mode".to_string(),
            "updatedAt".to_string(),
            "metadata".to_string(),
        ];
        let mut field_selections = Map::new();
        field_selections.insert("metadata".to_string(), json!(["pinned", "tags"]));

        let rows = storage
            .list_chat_summaries(&fields, &field_selections, true, Some(2))
            .unwrap();

        assert_eq!(
            rows,
            vec![
                json!({
                    "id": "newest",
                    "name": "Newest",
                    "mode": "roleplay",
                    "updatedAt": "2026-01-04T00:00:00Z",
                    "metadata": { "pinned": true, "tags": ["hot"] }
                }),
                json!({
                    "id": "middle",
                    "name": "Middle",
                    "mode": "game",
                    "updatedAt": "2026-01-03T00:00:00Z",
                    "metadata": { "pinned": false, "tags": ["warm"] }
                })
            ]
        );
        assert!(
            root.join("storage.sqlite3").is_file(),
            "supported chat summary reads should create the SQLite read model"
        );

        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn chat_summary_read_model_rebuilds_after_external_json_change() {
        let root = temp_storage_root("chat-summary-read-model-stale-json");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "chats",
                vec![json!({
                    "id": "chat-a",
                    "name": "Before",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z"
                })],
            )
            .unwrap();
        let fields = vec![
            "id".to_string(),
            "name".to_string(),
            "updatedAt".to_string(),
        ];
        assert_eq!(
            storage
                .list_chat_summaries(&fields, &Map::new(), true, Some(1))
                .unwrap(),
            vec![json!({
                "id": "chat-a",
                "name": "Before",
                "updatedAt": "2026-01-01T00:00:00Z"
            })]
        );

        let chats_path = root.join("collections").join("chats.json");
        rewrite_with_modified_time(
            &chats_path,
            &serde_json::to_vec_pretty(&json!([
                {
                    "id": "chat-a",
                    "name": "Before",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z"
                },
                {
                    "id": "chat-b",
                    "name": "Externally newer",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-02T00:00:00Z"
                }
            ]))
            .unwrap(),
            SystemTime::now() + Duration::from_secs(5),
        );

        assert_eq!(
            storage
                .list_chat_summaries(&fields, &Map::new(), true, Some(1))
                .unwrap(),
            vec![json!({
                "id": "chat-b",
                "name": "Externally newer",
                "updatedAt": "2026-01-02T00:00:00Z"
            })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn chat_summary_read_model_rebuilds_after_corrupt_sqlite_file() {
        let root = temp_storage_root("chat-summary-read-model-corrupt-sqlite");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "chats",
                vec![json!({
                    "id": "chat-a",
                    "name": "Recoverable",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z"
                })],
            )
            .unwrap();
        let fields = vec!["id".to_string(), "name".to_string()];
        fs::write(root.join("storage.sqlite3"), b"not a sqlite database").unwrap();

        assert_eq!(
            storage
                .list_chat_summaries(&fields, &Map::new(), true, Some(1))
                .unwrap(),
            vec![json!({ "id": "chat-a", "name": "Recoverable" })]
        );
        assert!(root.join("storage.sqlite3").is_file());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn chat_summary_read_model_reflects_flushed_chat_patch() {
        let root = temp_storage_root("chat-summary-read-model-flushed-patch");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "chats",
                vec![json!({
                    "id": "chat-a",
                    "name": "Before",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z"
                })],
            )
            .unwrap();
        storage
            .patch("chats", "chat-a", json!({ "name": "After" }))
            .unwrap();
        storage.flush().unwrap();
        let reopened = FileStorage::new(&root).unwrap();
        let fields = vec!["id".to_string(), "name".to_string()];

        assert_eq!(
            reopened
                .list_chat_summaries(&fields, &Map::new(), true, Some(1))
                .unwrap(),
            vec![json!({ "id": "chat-a", "name": "After" })]
        );

        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn projected_list_cache_hit_does_not_rehash_collection_file() {
        let root = temp_storage_root("projected-cache-hit-no-rehash");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "character-1",
                    "name": "Cached",
                    "description": "large payload should not be rehashed on hit"
                })],
            )
            .unwrap();
        let fields = vec!["id".to_string(), "name".to_string()];

        let first = storage
            .list_projected("characters", &fields, &Map::new())
            .unwrap();
        assert_eq!(
            first,
            vec![json!({ "id": "character-1", "name": "Cached" })]
        );

        let signature_count = TestArc::new(AtomicUsize::new(0));
        set_content_signature_count_hook(
            root.join("collections").join("characters.json"),
            TestArc::clone(&signature_count),
        );
        let second = storage
            .list_projected("characters", &fields, &Map::new())
            .unwrap();
        clear_content_signature_test_hook();

        assert_eq!(second, first);
        assert_eq!(
            signature_count.load(AtomicOrdering::SeqCst),
            0,
            "projected-list cache hits should not hash the full collection file"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projected_list_cache_invalidates_after_storage_write() {
        let root = temp_storage_root("projected-cache-internal-write");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let fields = vec!["id".to_string(), "name".to_string()];
        assert_eq!(
            storage
                .list_projected("characters", &fields, &Map::new())
                .unwrap(),
            vec![json!({ "id": "character-1", "name": "Before" })]
        );

        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "After" })],
            )
            .unwrap();

        assert_eq!(
            storage
                .list_projected("characters", &fields, &Map::new())
                .unwrap(),
            vec![json!({ "id": "character-1", "name": "After" })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projected_list_cache_refreshes_after_external_file_change() {
        let root = temp_storage_root("projected-cache-external-change");
        let storage = FileStorage::new(&root).unwrap();
        let collection_path = root.join("collections").join("characters.json");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let fields = vec!["id".to_string(), "name".to_string()];
        assert_eq!(
            storage
                .list_projected("characters", &fields, &Map::new())
                .unwrap(),
            vec![json!({ "id": "character-1", "name": "Before" })]
        );

        rewrite_with_modified_time(
            &collection_path,
            &serde_json::to_vec_pretty(&json!([
                { "id": "character-1", "name": "Externally changed" },
                { "id": "character-2", "name": "New external row" }
            ]))
            .unwrap(),
            SystemTime::now() + Duration::from_secs(5),
        );

        assert_eq!(
            storage
                .list_projected("characters", &fields, &Map::new())
                .unwrap(),
            vec![
                json!({ "id": "character-1", "name": "Externally changed" }),
                json!({ "id": "character-2", "name": "New external row" })
            ]
        );

        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn replace_all_many_updates_multiple_collections() {
        let root = temp_storage_root("replace-many");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all_many(vec![
                ("characters", vec![json!({ "id": "character-1" })]),
                ("personas", vec![json!({ "id": "persona-1" })]),
            ])
            .unwrap();

        assert_eq!(storage.list("characters").unwrap()[0]["id"], "character-1");
        assert_eq!(storage.list("personas").unwrap()[0]["id"], "persona-1");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_many_uncached_appends_multiple_collections() {
        let root = temp_storage_root("append-many-uncached");
        let storage = FileStorage::new(&root).unwrap();
        let collections = root.join("collections");
        fs::write(
            collections.join("messages.json"),
            serde_json::to_vec_pretty(&json!([{ "id": "message-1" }])).unwrap(),
        )
        .unwrap();
        fs::write(
            collections.join("message-swipes.json"),
            serde_json::to_vec_pretty(&json!([
                { "id": "message-1::swipe::0", "messageId": "message-1" }
            ]))
            .unwrap(),
        )
        .unwrap();

        let appended = storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-2" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-2::swipe::0", "messageId": "message-2" })],
                ),
            ])
            .unwrap();

        assert!(appended);
        assert_eq!(
            parse_collection_file("messages", &collections.join("messages.json"))
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            parse_collection_file("message-swipes", &collections.join("message-swipes.json"))
                .unwrap()
                .len(),
            2
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repeated_uncached_appends_reuse_checkpoint_and_write_only_bounded_journal_data() {
        let root = temp_storage_root("append-many-bounded-journal");
        let collections = root.join("collections");
        let historical_messages = (0..1_024)
            .map(|index| {
                json!({
                    "id": format!("historical-message-{index}"),
                    "chatId": "chat-1",
                    "content": "x".repeat(256),
                })
            })
            .collect::<Vec<_>>();
        let historical_swipes = (0..1_024)
            .map(|index| {
                json!({
                    "id": format!("historical-message-{index}::swipe::0"),
                    "messageId": format!("historical-message-{index}"),
                    "content": "x".repeat(256),
                })
            })
            .collect::<Vec<_>>();
        write_test_collection(&collections.join("messages.json"), historical_messages);
        write_test_collection(&collections.join("message-swipes.json"), historical_swipes);
        let storage = FileStorage::new(&root).unwrap();
        let messages = collections.join("messages.json");
        let swipes = collections.join("message-swipes.json");
        let message_identity = file_identity(&messages);
        let swipe_identity = file_identity(&swipes);
        reset_append_primary_bytes_written();

        storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-1" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
                ),
            ])
            .unwrap();
        let message_backup = collections.join("messages.json.bak");
        let swipe_backup = collections.join("message-swipes.json.bak");
        let message_checkpoint = fs::read(&message_backup).unwrap();
        let swipe_checkpoint = fs::read(&swipe_backup).unwrap();

        storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-2" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-2::swipe::0", "messageId": "message-2" })],
                ),
            ])
            .unwrap();

        assert_eq!(fs::read(message_backup).unwrap(), message_checkpoint);
        assert_eq!(fs::read(swipe_backup).unwrap(), swipe_checkpoint);
        assert_eq!(file_identity(&messages), message_identity);
        assert_eq!(file_identity(&swipes), swipe_identity);
        assert!(
            append_primary_bytes_written() < 16 * 1024,
            "two tiny appends should not rewrite historical primary bytes"
        );
        let journal = collections.join(".collection-append-journal.jsonl");
        let journal_bytes = fs::metadata(journal).unwrap().len();
        assert!(
            journal_bytes < 16 * 1024,
            "two tiny appends should not journal historical collection bytes"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_many_uncached_rejects_non_array_outer_shape_before_journaling() {
        let root = temp_storage_root("append-rejects-non-array");
        let storage = FileStorage::new(&root).unwrap();
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let malformed = br#"{"not":"an array"}]"#;
        fs::write(&messages, malformed).unwrap();
        write_test_collection(&collections.join("message-swipes.json"), Vec::new());

        let appended = storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-1" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
                ),
            ])
            .unwrap();

        assert!(!appended);
        assert_eq!(fs::read(messages).unwrap(), malformed);
        assert!(!collections.join(".collection-append-journal.jsonl").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_many_uncached_declines_collections_without_checkpoint_lifecycle_support() {
        let root = temp_storage_root("append-declines-untracked-collection");
        let storage = FileStorage::new(&root).unwrap();
        let collections = root.join("collections");

        let appended = storage
            .append_many_uncached(vec![(
                "characters",
                vec![json!({ "id": "character-1" })],
            )])
            .unwrap();

        assert!(!appended);
        assert!(!collections.join("characters.json").exists());
        assert!(!collections.join(".collection-append-journal.jsonl").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn append_many_uncached_rejects_symlink_collection_before_journaling() {
        use std::os::unix::fs::symlink;

        let root = temp_storage_root("append-rejects-symlink");
        let storage = FileStorage::new(&root).unwrap();
        let collections = root.join("collections");
        let target = root.join("outside-messages.json");
        write_test_collection(&target, vec![json!({ "id": "outside" })]);
        symlink(&target, collections.join("messages.json")).unwrap();
        write_test_collection(&collections.join("message-swipes.json"), Vec::new());

        let appended = storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-1" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
                ),
            ])
            .unwrap();

        assert!(!appended);
        assert_eq!(parse_collection_file("messages", &target).unwrap().len(), 1);
        assert!(!collections.join(".collection-append-journal.jsonl").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_prepares_checkpoint_before_the_first_message_append() {
        let root = temp_storage_root("startup-append-checkpoint");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("messages.json"),
            vec![json!({ "id": "historical-message" })],
        );
        write_test_collection(
            &collections.join("message-swipes.json"),
            vec![json!({ "id": "historical-message::swipe::0", "messageId": "historical-message" })],
        );

        let storage = FileStorage::new(&root).unwrap();
        let message_backup = collections.join("messages.json.bak");
        let swipe_backup = collections.join("message-swipes.json.bak");
        let message_checkpoint = fs::read(&message_backup).unwrap();
        let swipe_checkpoint = fs::read(&swipe_backup).unwrap();
        storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-2" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-2::swipe::0", "messageId": "message-2" })],
                ),
            ])
            .unwrap();

        assert_eq!(fs::read(message_backup).unwrap(), message_checkpoint);
        assert_eq!(fs::read(swipe_backup).unwrap(), swipe_checkpoint);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_invalidates_append_checkpoint_before_later_recovery() {
        let root = temp_storage_root("append-checkpoint-after-replacement");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("messages.json"),
            vec![json!({ "id": "baseline-message" })],
        );
        write_test_collection(
            &collections.join("message-swipes.json"),
            vec![json!({ "id": "baseline-message::swipe::0", "messageId": "baseline-message" })],
        );
        let storage = FileStorage::new(&root).unwrap();
        storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "checkpoint-message" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "checkpoint-message::swipe::0", "messageId": "checkpoint-message" })],
                ),
            ])
            .unwrap();
        storage
            .replace_all_many(vec![
                ("messages", vec![json!({ "id": "replacement-message" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "replacement-message::swipe::0", "messageId": "replacement-message" })],
                ),
            ])
            .unwrap();
        storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "appended-message" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "appended-message::swipe::0", "messageId": "appended-message" })],
                ),
            ])
            .unwrap();
        fs::write(collections.join("messages.json"), b"{ interrupted tail").unwrap();
        drop(storage);

        let recovered = FileStorage::new(&root).unwrap();
        assert_eq!(
            recovered.list("messages").unwrap(),
            vec![
                json!({ "id": "replacement-message" }),
                json!({ "id": "appended-message" }),
            ]
        );
        assert_eq!(recovered.list("message-swipes").unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_recovers_atomic_append_after_only_one_collection_was_applied() {
        let root = temp_storage_root("partial-atomic-append-recovery");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("messages.json"),
            vec![json!({ "id": "message-1" })],
        );
        write_test_collection(
            &collections.join("message-swipes.json"),
            vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
        );
        let appends = vec![
            ("messages", vec![json!({ "id": "message-2" })]),
            (
                "message-swipes",
                vec![json!({ "id": "message-2::swipe::0", "messageId": "message-2" })],
            ),
        ];
        append_journal::append_transaction(&collections, &appends).unwrap();
        append_to_collection_file_in_place(&collections.join("messages.json"), &appends[0].1)
            .unwrap();

        let recovered = FileStorage::new(&root).unwrap();
        assert_eq!(recovered.list("messages").unwrap().len(), 2);
        assert_eq!(recovered.list("message-swipes").unwrap().len(), 2);
        assert_eq!(
            fs::metadata(collections.join(".collection-append-journal.jsonl"))
                .unwrap()
                .len(),
            0
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_replays_duplicate_append_transactions_in_order() {
        let root = temp_storage_root("duplicate-append-replay");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("messages.json"),
            vec![json!({ "id": "message-1", "content": "baseline" })],
        );
        let storage = FileStorage::new(&root).unwrap();
        drop(storage);
        append_journal::append_transaction(
            &collections,
            &[("messages", vec![json!({ "id": "message-2", "content": "first" })])],
        )
        .unwrap();
        append_journal::append_transaction(
            &collections,
            &[("messages", vec![json!({ "id": "message-2", "content": "retry" })])],
        )
        .unwrap();

        let recovered = FileStorage::new(&root).unwrap();

        assert_eq!(recovered.get("messages", "message-2").unwrap().unwrap()["content"], "retry");
        assert_eq!(recovered.list("messages").unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_uses_checkpoint_when_append_primary_is_missing() {
        let root = temp_storage_root("missing-append-primary");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        write_test_collection(&messages, vec![json!({ "id": "message-1" })]);
        let storage = FileStorage::new(&root).unwrap();
        drop(storage);
        append_journal::append_transaction(
            &collections,
            &[("messages", vec![json!({ "id": "message-2" })])],
        )
        .unwrap();
        fs::remove_file(&messages).unwrap();

        let recovered = FileStorage::new(&root).unwrap();

        assert_eq!(recovered.list("messages").unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn committed_append_recovers_synchronously_when_second_collection_apply_fails() {
        let root = temp_storage_root("atomic-append-apply-failure");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("messages.json"),
            vec![json!({ "id": "message-1" })],
        );
        write_test_collection(
            &collections.join("message-swipes.json"),
            vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
        );
        let storage = FileStorage::new(&root).unwrap();
        assert_eq!(storage.list("messages").unwrap().len(), 1);
        assert_eq!(storage.list("message-swipes").unwrap().len(), 1);
        APPEND_APPLY_TEST_HOOK.with(|hook| *hook.borrow_mut() = Some(Box::new(|path| {
            if path.file_name().and_then(|name| name.to_str()) == Some("message-swipes.json") {
                return Err(AppError::io(std::io::Error::other(
                    "injected second collection append failure",
                )));
            }
            Ok(())
        })));

        let result = storage.append_many_uncached(vec![
            ("messages", vec![json!({ "id": "message-2" })]),
            (
                "message-swipes",
                vec![json!({ "id": "message-2::swipe::0", "messageId": "message-2" })],
            ),
        ]);
        APPEND_APPLY_TEST_HOOK.with(|hook| *hook.borrow_mut() = None);

        assert!(result.unwrap());
        assert_eq!(storage.list("messages").unwrap().len(), 2);
        assert_eq!(storage.list("message-swipes").unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_synchronous_append_recovery_blocks_reads_and_writes_until_restart() {
        let root = temp_storage_root("atomic-append-recovery-failure");
        let collections = root.join("collections");
        write_test_collection(&collections.join("messages.json"), vec![json!({ "id": "message-1" })]);
        write_test_collection(
            &collections.join("message-swipes.json"),
            vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
        );
        let storage = FileStorage::new(&root).unwrap();
        APPEND_APPLY_TEST_HOOK.with(|hook| *hook.borrow_mut() = Some(Box::new(|path| {
            if path.file_name().and_then(|name| name.to_str()) == Some("message-swipes.json") {
                return Err(AppError::io(std::io::Error::other("injected append failure")));
            }
            Ok(())
        })));
        append_journal::APPEND_RECOVERY_TEST_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(|| {
                Err(AppError::io(std::io::Error::other("injected recovery failure")))
            }))
        });

        let result = storage.append_many_uncached(vec![
            ("messages", vec![json!({ "id": "message-2" })]),
            (
                "message-swipes",
                vec![json!({ "id": "message-2::swipe::0", "messageId": "message-2" })],
            ),
        ]);
        APPEND_APPLY_TEST_HOOK.with(|hook| *hook.borrow_mut() = None);
        append_journal::APPEND_RECOVERY_TEST_HOOK.with(|hook| *hook.borrow_mut() = None);

        assert!(result.is_err());
        assert_eq!(storage.list("messages").unwrap_err().code, "storage_append_journal_recovery_required");
        assert_eq!(
            storage.replace_all("characters", vec![json!({ "id": "blocked" })]).unwrap_err().code,
            "storage_append_journal_recovery_required"
        );
        drop(storage);

        let recovered = FileStorage::new(&root).unwrap();
        assert_eq!(recovered.list("messages").unwrap().len(), 2);
        assert_eq!(recovered.list("message-swipes").unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_checkpoints_pending_appends_before_installing_new_rows() {
        let root = temp_storage_root("replace-with-pending-append");
        let collections = root.join("collections");
        write_test_collection(&collections.join("messages.json"), vec![json!({ "id": "baseline" })]);
        let storage = FileStorage::new(&root).unwrap();
        storage
            .append_many_uncached(vec![("messages", vec![json!({ "id": "appended" })])])
            .unwrap();

        storage
            .replace_all("messages", vec![json!({ "id": "replacement" })])
            .unwrap();
        drop(storage);
        let restarted = FileStorage::new(&root).unwrap();

        assert_eq!(restarted.list("messages").unwrap(), vec![json!({ "id": "replacement" })]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_many_uncached_updates_clean_cached_collections() {
        let root = temp_storage_root("append-many-cached");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "message-1" })])
            .unwrap();
        storage
            .replace_all(
                "message-swipes",
                vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
            )
            .unwrap();
        assert_eq!(storage.list("messages").unwrap().len(), 1);
        assert_eq!(storage.list("message-swipes").unwrap().len(), 1);

        let appended = storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-2" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-2::swipe::0", "messageId": "message-2" })],
                ),
            ])
            .unwrap();

        assert!(appended);
        assert_eq!(storage.list("messages").unwrap().len(), 2);
        assert_eq!(storage.list("message-swipes").unwrap().len(), 2);
        assert_eq!(
            storage
                .get("messages", "message-2")
                .unwrap()
                .expect("appended clean-cached row should be indexed for get by id"),
            json!({ "id": "message-2" })
        );
        assert_eq!(
            parse_collection_file("messages", &root.join("collections").join("messages.json"))
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            parse_collection_file(
                "message-swipes",
                &root.join("collections").join("message-swipes.json")
            )
            .unwrap()
            .len(),
            2
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_many_uncached_refuses_dirty_cached_collections() {
        let root = temp_storage_root("append-many-dirty-cached");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .cache_collection("messages", &[json!({ "id": "message-1" })], true)
            .unwrap();

        let appended = storage
            .append_many_uncached(vec![("messages", vec![json!({ "id": "message-2" })])])
            .unwrap();

        assert!(!appended);
        assert_eq!(storage.list("messages").unwrap().len(), 1);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_many_uncached_cleans_prepared_temps_on_stage_error() {
        let root = temp_storage_root("append-many-stage-error-cleanup");
        let storage = FileStorage::new(&root).unwrap();
        let collections = root.join("collections");
        fs::write(
            collections.join("messages.json"),
            serde_json::to_vec_pretty(&json!([{ "id": "message-1" }])).unwrap(),
        )
        .unwrap();

        let error = storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-2" })]),
                ("messages", vec![json!({ "id": "message-3" })]),
            ])
            .expect_err("duplicate collection should fail staging");

        assert!(error.message.contains("Duplicate collection append"));
        let leftover_transaction_files = fs::read_dir(&collections)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".profile-import-")
            })
            .collect::<Vec<_>>();
        assert!(
            leftover_transaction_files.is_empty(),
            "stage error should remove pending transaction files"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_collections_atomically_reads_and_replaces_multiple_collections() {
        let root = temp_storage_root("update-collections-atomically");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![json!({ "id": "message-1", "content": "old" })],
            )
            .unwrap();
        storage
            .replace_all(
                "message-swipes",
                vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
            )
            .unwrap();

        let updated = storage
            .update_collections_atomically(vec!["messages", "message-swipes"], |collections| {
                collections[0]
                    .rows_mut()
                    .push(json!({ "id": "message-2", "content": "new" }));
                collections[1]
                    .rows_mut()
                    .push(json!({ "id": "message-2::swipe::0", "messageId": "message-2" }));
                Ok(collections[0].rows().len())
            })
            .unwrap();

        assert_eq!(updated, 2);
        assert_eq!(storage.list("messages").unwrap().len(), 2);
        assert_eq!(storage.list("message-swipes").unwrap().len(), 2);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_collections_atomically_rejects_duplicate_collections_before_update() {
        let root = temp_storage_root("update-collections-duplicate");
        let storage = FileStorage::new(&root).unwrap();
        let mut update_ran = false;

        let error = storage
            .update_collections_atomically(vec!["messages", "messages"], |_| {
                update_ran = true;
                Ok(())
            })
            .expect_err("duplicate collections should reject before update runs");

        assert_eq!(error.code, "invalid_input");
        assert!(!update_ran);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_message_append_waits_for_atomic_update_and_then_succeeds() {
        use std::sync::mpsc::{self, RecvTimeoutError};
        use std::thread;

        let root = temp_storage_root("atomic-update-concurrent-message-append");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![json!({
                    "id": "assistant-1",
                    "chatId": "chat-1",
                    "role": "assistant"
                })],
            )
            .unwrap();
        storage.replace_all("message-swipes", Vec::new()).unwrap();

        let atomic_storage = storage.clone();
        let (atomic_started_tx, atomic_started_rx) = mpsc::channel();
        let (release_atomic_tx, release_atomic_rx) = mpsc::channel();
        let atomic_thread = thread::spawn(move || {
            atomic_storage.update_collections_atomically(
                vec!["messages", "message-swipes"],
                move |collections| {
                    atomic_started_tx.send(()).unwrap();
                    release_atomic_rx.recv().unwrap();
                    collections[0].rows_mut()[0]["extra"] =
                        json!({ "dialogueAttributions": { "version": 1 } });
                    Ok(())
                },
            )
        });
        atomic_started_rx.recv().unwrap();

        let writer_storage = storage.clone();
        let (writer_done_tx, writer_done_rx) = mpsc::channel();
        let writer_thread = thread::spawn(move || {
            let result = writer_storage.append_many_uncached(vec![
                (
                    "messages",
                    vec![json!({
                        "id": "user-1",
                        "chatId": "chat-1",
                        "role": "user",
                        "content": "hello"
                    })],
                ),
                (
                    "message-swipes",
                    vec![json!({
                        "id": "user-1::swipe::0",
                        "messageId": "user-1",
                        "chatId": "chat-1",
                        "index": 0
                    })],
                ),
            ]);
            writer_done_tx.send(result).unwrap();
        });

        assert!(matches!(
            writer_done_rx.recv_timeout(Duration::from_millis(50)),
            Err(RecvTimeoutError::Timeout)
        ));
        release_atomic_tx.send(()).unwrap();
        atomic_thread.join().unwrap().unwrap();
        assert!(writer_done_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap());
        writer_thread.join().unwrap();

        let messages = storage.list("messages").unwrap();
        assert!(messages.iter().any(|row| row["id"] == json!("assistant-1")));
        assert!(messages.iter().any(|row| row["id"] == json!("user-1")));
        assert_eq!(storage.list("message-swipes").unwrap().len(), 1);

        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn update_collections_atomically_rejects_reentrant_writes_without_side_effects() {
        let root = temp_storage_root("update-collections-reentrant");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![json!({ "id": "message-1", "content": "old" })],
            )
            .unwrap();

        let error = storage
            .update_collections_atomically(vec!["messages"], |collections| {
                assert_eq!(collections[0].collection(), "messages");
                assert_eq!(storage.list("messages")?.len(), 1);
                storage.create(
                    "personas",
                    json!({ "id": "persona-1", "name": "reentrant" }),
                )?;
                collections[0]
                    .rows_mut()
                    .push(json!({ "id": "message-2", "content": "callback" }));
                Ok(())
            })
            .expect_err("reentrant writes should reject instead of deadlocking or persisting");

        assert_eq!(error.code, "storage_transaction_active");
        let rows = storage.list("messages").unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows
            .iter()
            .any(|row| row.get("id").and_then(Value::as_str) == Some("message-1")));
        assert!(!rows
            .iter()
            .any(|row| row.get("id").and_then(Value::as_str) == Some("message-2")));
        assert!(storage.list("personas").unwrap().is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_collections_atomically_reads_targets_without_recovery_side_effects() {
        let root = temp_storage_root("update-collections-no-target-recovery");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("messages.json");
        let backup = root.join("collections").join("messages.json.bak");
        fs::write(&collection, b"\0\0\0not-json").unwrap();
        fs::write(
            &backup,
            serde_json::to_vec_pretty(&json!([{ "id": "message-1" }])).unwrap(),
        )
        .unwrap();
        let mut update_ran = false;

        storage
            .update_collections_atomically(vec!["messages"], |_| {
                update_ran = true;
                Ok(())
            })
            .expect_err("atomic target reads should fail instead of recovering in place");

        assert!(!update_ran);
        assert_eq!(fs::read(&collection).unwrap(), b"\0\0\0not-json");
        assert!(backup.exists());
        assert_eq!(corruption_sentinel_count(&root, "messages.json"), 0);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_collections_atomically_reentrant_reads_do_not_recover_collections() {
        let root = temp_storage_root("update-collections-no-read-recovery");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "message-1" })])
            .unwrap();
        let collection = root.join("collections").join("personas.json");
        let backup = root.join("collections").join("personas.json.bak");
        fs::write(&collection, b"\0\0\0not-json").unwrap();
        fs::write(
            &backup,
            serde_json::to_vec_pretty(&json!([{ "id": "persona-1" }])).unwrap(),
        )
        .unwrap();

        storage
            .update_collections_atomically(vec!["messages"], |_| {
                storage.list("personas")?;
                Ok(())
            })
            .expect_err("reentrant read recovery should not write during atomic update");

        assert_eq!(fs::read(&collection).unwrap(), b"\0\0\0not-json");
        assert!(backup.exists());
        assert_eq!(corruption_sentinel_count(&root, "personas.json"), 0);
        assert_eq!(
            storage.list("messages").unwrap(),
            vec![json!({ "id": "message-1" })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_collection_and_backup_are_preserved_for_manual_recovery() {
        let root = temp_storage_root("corrupt-collection-and-backup");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("messages.json");
        let backup = root.join("collections").join("messages.json.bak");
        fs::write(&collection, b"\0\0\0not-json").unwrap();
        fs::write(&backup, b"{ bad backup").unwrap();

        let error = storage
            .list("messages")
            .expect_err("corrupt primary and backup should require manual recovery");

        assert_eq!(error.code, "storage_collection_recovery_required");
        assert!(!collection.exists());
        assert!(!backup.exists());
        assert_eq!(
            fs::read_dir(root.join("collections"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupted-"))
                .count(),
            2
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_collection_recovers_from_valid_backup() {
        let root = temp_storage_root("corrupt-collection-valid-backup");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("messages.json");
        let backup = root.join("collections").join("messages.json.bak");
        fs::write(&collection, b"\0\0\0").unwrap();
        fs::write(
            &backup,
            serde_json::to_vec_pretty(&json!([{ "id": "message-1", "chatId": "chat-1" }])).unwrap(),
        )
        .unwrap();

        let rows = storage.list("messages").unwrap();

        assert_eq!(rows, vec![json!({ "id": "message-1", "chatId": "chat-1" })]);
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&collection).unwrap()).unwrap(),
            json!([{ "id": "message-1", "chatId": "chat-1" }])
        );
        assert!(backup.exists());
        assert_eq!(
            fs::read_dir(root.join("collections"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("messages.json.corrupted-"))
                .count(),
            1
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn valid_collection_does_not_create_corruption_sentinels() {
        let root = temp_storage_root("valid-collection-no-corruption-sentinel");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "message-1" })])
            .unwrap();

        assert_eq!(
            storage.list("messages").unwrap(),
            vec![json!({ "id": "message-1" })]
        );
        assert_eq!(
            fs::read_dir(root.join("collections"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupted-"))
                .count(),
            0
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_refresh_backup_without_copying_nul_corruption() {
        let root = temp_storage_root("write-refreshes-backup");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("messages.json");
        let backup = root.join("collections").join("messages.json.bak");

        storage
            .replace_all("messages", vec![json!({ "id": "old-message" })])
            .unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "new-message" })])
            .unwrap();

        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&backup).unwrap()).unwrap(),
            json!([{ "id": "old-message" }])
        );

        fs::write(&collection, b"\0\0\0").unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "safe-message" })])
            .unwrap();

        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&backup).unwrap()).unwrap(),
            json!([{ "id": "old-message" }])
        );
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&collection).unwrap()).unwrap(),
            json!([{ "id": "safe-message" }])
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repeated_writes_refresh_existing_backup() {
        let root = temp_storage_root("repeated-write-refreshes-backup");
        let storage = FileStorage::new(&root).unwrap();
        let backup = root.join("collections").join("messages.json.bak");

        storage
            .replace_all("messages", vec![json!({ "id": "first" })])
            .unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "second" })])
            .unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "third" })])
            .unwrap();

        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&backup).unwrap()).unwrap(),
            json!([{ "id": "second" }])
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn create_rejects_duplicate_caller_provided_id_without_mutating_existing_row() {
        let root = temp_storage_root("create-rejects-duplicate-id");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .create(
                "characters",
                json!({
                    "id": "duplicate-test",
                    "name": "Original"
                }),
            )
            .expect("initial create should succeed");

        let error = storage
            .create(
                "characters",
                json!({
                    "id": "duplicate-test",
                    "name": "Replacement"
                }),
            )
            .expect_err("duplicate create should fail");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(error.message, "characters/duplicate-test already exists");
        let original = storage
            .get("characters", "duplicate-test")
            .unwrap()
            .expect("original row should remain");
        assert_eq!(original["name"], "Original");
        assert_eq!(original["id"], "duplicate-test");
        assert!(original.get("createdAt").is_some());
        assert!(original.get("updatedAt").is_some());
        assert_eq!(
            storage.list("characters").unwrap(),
            vec![json!({
                "id": original["id"].clone(),
                "name": original["name"].clone(),
                "createdAt": original["createdAt"].clone(),
                "updatedAt": original["updatedAt"].clone()
            })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_consumes_remaining_rows_after_match() {
        let root = temp_storage_root("get-consumes-remaining-rows");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![
                    json!({ "id": "match", "name": "Match" }),
                    json!({ "id": "after-match", "name": "After Match" }),
                ],
            )
            .unwrap();

        let record = storage
            .get("characters", "match")
            .expect("get should not leave unread JSON trailing the first match")
            .expect("matching row should be returned");

        assert_eq!(record["id"], "match");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repeated_get_uses_cached_id_index_after_disk_read() {
        let root = temp_storage_root("get-uses-id-index");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([
                { "id": "first", "name": "First" },
                { "id": "target", "name": "Target" },
                { "id": "last", "name": "Last" }
            ]))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            storage
                .get("characters", "target")
                .expect("get should build id index")
                .expect("target should exist")["name"],
            "Target"
        );
        assert_eq!(
            storage
                .get("characters", "target")
                .expect("cached get should reuse id index")
                .expect("target should still come from id index")["name"],
            "Target"
        );
        assert!(storage
            .get("characters", "missing")
            .expect("missing id should be cached in the same index")
            .is_none());
        let cache = storage.cache.read().expect("cache lock should be readable");
        let id_index = cache
            .id_indexes
            .get("characters")
            .expect("id index should be cached");
        assert!(matches!(
            id_index.records_by_id.get("target"),
            Some(CachedCollectionRecord::PrettyRange(_))
        ));
        assert!(!id_index.records_by_id.contains_key("missing"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repeated_projected_get_uses_cached_id_index_after_disk_read() {
        let root = temp_storage_root("projected-get-uses-id-index");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "target",
                    "data": { "name": "Rina", "description": "large prompt text" },
                    "avatar": "large image payload"
                }
            ]))
            .unwrap(),
        )
        .unwrap();
        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        let record = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("projected get should build id index")
            .expect("target should exist");
        assert_eq!(
            record,
            json!({ "id": "target", "data": { "name": "Rina" } })
        );

        let cached = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("cached projected get should reuse id index")
            .expect("target should still come from id index");
        assert_eq!(
            cached,
            json!({ "id": "target", "data": { "name": "Rina" } })
        );
        let cache = storage.cache.read().expect("cache lock should be readable");
        assert!(cache
            .id_indexes
            .get("characters")
            .is_some_and(|cached| matches!(
                cached.records_by_id.get("target"),
                Some(CachedCollectionRecord::PrettyRange(_))
            )));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projected_get_id_index_avoids_caching_full_pretty_rows() {
        let root = temp_storage_root("projected-get-index-uses-ranges");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "target",
                    "data": { "name": "Rina", "description": "large prompt text" },
                    "avatar": "large image payload"
                }
            ]))
            .unwrap(),
        )
        .unwrap();
        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        let record = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("projected get should build range index")
            .expect("target should exist");
        assert_eq!(
            record,
            json!({ "id": "target", "data": { "name": "Rina" } })
        );

        let cache = storage.cache.read().expect("cache lock should be readable");
        let id_index = cache
            .id_indexes
            .get("characters")
            .expect("id index should be cached");
        assert!(matches!(
            id_index.records_by_id.get("target"),
            Some(CachedCollectionRecord::PrettyRange(_))
        ));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_id_index_invalidates_when_file_stamp_changes() {
        let root = temp_storage_root("get-id-index-invalidates");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([{ "id": "target", "name": "Before" }])).unwrap(),
        )
        .unwrap();

        assert_eq!(
            storage
                .get("characters", "target")
                .expect("get should build id index")
                .expect("target should exist")["name"],
            "Before"
        );
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([{ "id": "target", "name": "After value changed" }]))
                .unwrap(),
        )
        .unwrap();

        assert_eq!(
            storage
                .get("characters", "target")
                .expect("changed file should rebuild id index")
                .expect("target should still exist")["name"],
            "After value changed"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_id_index_detects_same_length_rewrite_with_same_mtime() {
        let root = temp_storage_root("get-id-index-same-metadata-rewrite");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();
        let initial = br#"[
  {
    "id": "target",
    "name": "Alpha"
  },
  {
    "id": "decoy",
    "name": "Omega"
  }
]"#;
        let replacement = br#"[
  {
    "id": "decoy",
    "name": "Omega"
  },
  {
    "id": "target",
    "name": "Bravo"
  }
]"#;
        assert_eq!(initial.len(), replacement.len());
        fs::write(&collection, initial).unwrap();
        let original_modified = fs::metadata(&collection).unwrap().modified().unwrap();

        assert_eq!(
            storage
                .get("characters", "target")
                .expect("get should build id index")
                .expect("target should exist"),
            json!({ "id": "target", "name": "Alpha" })
        );
        rewrite_with_modified_time(&collection, replacement, original_modified);

        assert_eq!(
            storage
                .get("characters", "target")
                .expect("same-metadata rewrite should rebuild id index")
                .expect("target should still exist"),
            json!({ "id": "target", "name": "Bravo" })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_id_index_retries_when_file_changes_during_index_build() {
        let root = temp_storage_root("get-id-index-retries-unstable-scan");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();
        let initial = serde_json::to_vec_pretty(&json!([
            { "id": "target", "name": "Alpha" },
            { "id": "other", "name": "Omega" }
        ]))
        .unwrap();
        let replacement = serde_json::to_vec_pretty(&json!([
            { "id": "target", "name": "Bravo" },
            { "id": "other", "name": "Omega" }
        ]))
        .unwrap();
        fs::write(&collection, initial).unwrap();
        let original_modified = fs::metadata(&collection).unwrap().modified().unwrap();
        let rewrite_path = collection.clone();
        let mut replacement = Some(replacement);
        *INDEX_BUILD_TEST_HOOK.lock().unwrap() = Some(Box::new(move |path| {
            if path == rewrite_path.as_path() {
                if let Some(bytes) = replacement.take() {
                    rewrite_with_modified_time(
                        path,
                        &bytes,
                        original_modified + Duration::from_secs(1),
                    );
                }
            }
        }));

        let row = storage
            .get("characters", "target")
            .expect("scan-time rewrite should retry instead of surfacing instability")
            .expect("target should still exist");
        *INDEX_BUILD_TEST_HOOK.lock().unwrap() = None;

        assert_eq!(row, json!({ "id": "target", "name": "Bravo" }));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_projected_returns_matching_row_without_unrequested_fields() {
        let root = temp_storage_root("get-projected-skips-unrequested-fields");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![
                    json!({
                        "id": "skip-me",
                        "data": { "name": "Skip", "description": "ignore" },
                        "avatar": "ignore"
                    }),
                    json!({
                        "id": "target",
                        "data": {
                            "name": "Rina",
                            "description": "large prompt text",
                            "extensions": { "depth_prompt": { "prompt": "large nested prompt" } }
                        },
                        "avatar": "large image payload"
                    }),
                ],
            )
            .unwrap();
        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        let record = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("projected get should read")
            .expect("target row should exist");

        assert_eq!(
            record,
            json!({ "id": "target", "data": { "name": "Rina" } })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_projected_bypasses_clean_full_row_cache() {
        let root = temp_storage_root("get-projected-bypasses-clean-cache");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "data": { "name": "Cached", "description": "cached prompt" },
                    "avatar": "cached image payload"
                })],
            )
            .unwrap();

        let collection = root.join("collections").join("characters.json");
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "target",
                    "data": { "name": "Disk", "description": "disk prompt" },
                    "avatar": "disk image payload"
                }
            ]))
            .unwrap(),
        )
        .unwrap();

        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        let record = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("projected get should read from disk when cache is clean")
            .expect("target row should exist");

        assert_eq!(
            record,
            json!({ "id": "target", "data": { "name": "Disk" } })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_projected_uses_dirty_cache_before_disk() {
        let root = temp_storage_root("list-projected-uses-dirty-cache");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "data": { "name": "Disk", "description": "disk prompt" },
                    "avatar": "disk image payload"
                })],
            )
            .unwrap();
        storage
            .cache_collection(
                "characters",
                &[json!({
                    "id": "target",
                    "data": { "name": "Dirty", "description": "dirty prompt" },
                    "avatar": "dirty image payload"
                })],
                true,
            )
            .unwrap();

        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        let rows = storage
            .list_projected("characters", &fields, &selections)
            .expect("projected list should honor dirty cache");

        assert_eq!(
            rows,
            vec![json!({ "id": "target", "data": { "name": "Dirty" } })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn flush_persists_pending_debounced_writes_to_disk() {
        // The on-quit RunEvent handler calls storage.flush() to drain writes that are
        // still sitting in the debounce window (#2319). Verify flush() actually lands a
        // pending (dirty, not-yet-written) collection on disk and clears the dirty flag.
        let root = temp_storage_root("flush-persists-pending");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .cache_collection("characters", &[json!({ "id": "pending" })], true)
            .unwrap();
        assert!(
            storage.dirty_collection_count() > 0,
            "write should be pending"
        );

        storage.flush().unwrap();

        assert_eq!(
            storage.dirty_collection_count(),
            0,
            "flush should clear the dirty collections"
        );
        // A fresh instance reads from disk, proving the pending write was persisted.
        let reopened = FileStorage::new(&root).unwrap();
        assert_eq!(reopened.list("characters").unwrap()[0]["id"], "pending");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_projected_caches_clean_projection_shapes_until_file_changes() {
        let root = temp_storage_root("list-projected-caches-clean-shapes");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!( {
                    "id": "target",
                    "data": { "name": "Disk", "description": "large prompt" },
                    "avatar": "large image payload"
                })],
            )
            .unwrap();

        let fields = vec!["id".to_string(), "data".to_string()];
        let reversed_fields = vec!["data".to_string(), "id".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        let first = storage
            .list_projected("characters", &fields, &selections)
            .expect("first projected list should read");
        assert_eq!(
            first,
            vec![json!({ "id": "target", "data": { "name": "Disk" } })]
        );

        let second = storage
            .list_projected("characters", &reversed_fields, &selections)
            .expect("same projection shape should read");
        assert_eq!(second, first);
        let projected_cache_len = storage
            .cache
            .read()
            .expect("cache lock should be readable")
            .projected_lists
            .len();
        assert_eq!(projected_cache_len, 1);

        std::thread::sleep(Duration::from_millis(5));
        let collection = root.join("collections").join("characters.json");
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "target",
                    "data": { "name": "Changed", "description": "changed large prompt" },
                    "avatar": "changed large image payload"
                }
            ]))
            .unwrap(),
        )
        .unwrap();

        let changed = storage
            .list_projected("characters", &fields, &selections)
            .expect("projected list should notice changed collection file");
        assert_eq!(
            changed,
            vec![json!({ "id": "target", "data": { "name": "Changed" } })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_projected_cache_detects_same_length_rewrite_when_mtime_changes() {
        let root = temp_storage_root("list-projected-cache-same-length-rewrite-mtime");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "data": { "name": "Alpha", "description": "large prompt" },
                    "avatar": "large image payload"
                })],
            )
            .unwrap();

        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        let first = storage
            .list_projected("characters", &fields, &selections)
            .expect("first projected list should read");
        assert_eq!(
            first,
            vec![json!({ "id": "target", "data": { "name": "Alpha" } })]
        );

        let collection = root.join("collections").join("characters.json");
        let original_modified = fs::metadata(&collection)
            .unwrap()
            .modified()
            .expect("collection mtime should be readable");
        let replacement = serde_json::to_vec_pretty(&json!([
            {
                "id": "target",
                "data": { "name": "Bravo", "description": "large prompt" },
                "avatar": "large image payload"
            }
        ]))
        .unwrap();
        assert_eq!(
            replacement.len() as u64,
            fs::metadata(&collection)
                .expect("collection should exist")
                .len()
        );
        fs::write(&collection, replacement).unwrap();
        let file = fs::File::options().write(true).open(&collection).unwrap();
        file.set_times(
            std::fs::FileTimes::new().set_modified(original_modified + Duration::from_secs(1)),
        )
        .unwrap();

        let changed = storage
            .list_projected("characters", &fields, &selections)
            .expect("projected list should notice same-length file rewrite with changed mtime");
        assert_eq!(
            changed,
            vec![json!({ "id": "target", "data": { "name": "Bravo" } })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_projected_cache_detects_same_length_rewrite_with_same_mtime() {
        let root = temp_storage_root("list-projected-cache-same-metadata-rewrite");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "data": { "name": "Alpha", "description": "large prompt" },
                    "avatar": "large image payload"
                })],
            )
            .unwrap();

        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));
        assert_eq!(
            storage
                .list_projected("characters", &fields, &selections)
                .expect("first projected list should cache"),
            vec![json!({ "id": "target", "data": { "name": "Alpha" } })]
        );

        let collection = root.join("collections").join("characters.json");
        let original_modified = fs::metadata(&collection).unwrap().modified().unwrap();
        let replacement = serde_json::to_vec_pretty(&json!([
            {
                "id": "target",
                "data": { "name": "Bravo", "description": "large prompt" },
                "avatar": "large image payload"
            }
        ]))
        .unwrap();
        assert_eq!(
            replacement.len() as u64,
            fs::metadata(&collection).unwrap().len()
        );
        rewrite_with_modified_time(&collection, &replacement, original_modified);

        assert_eq!(
            storage
                .list_projected("characters", &fields, &selections)
                .expect("same-metadata rewrite should invalidate projected cache"),
            vec![json!({ "id": "target", "data": { "name": "Bravo" } })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn collection_content_signature_hashes_large_unsampled_bytes() {
        let root = temp_storage_root("collection-content-signature-large");
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();

        let mut bytes = vec![b'a'; 20_000];
        fs::write(&collection, &bytes).unwrap();
        let len = fs::metadata(&collection).unwrap().len();
        let first_signature = collection_content_signature(&collection, len).unwrap();

        bytes[6_000] = b'b';
        fs::write(&collection, &bytes).unwrap();

        assert_eq!(fs::metadata(&collection).unwrap().len(), len);
        assert_ne!(
            collection_content_signature(&collection, len).unwrap(),
            first_signature
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_projected_cache_is_invalidated_by_writes() {
        let root = temp_storage_root("list-projected-cache-invalidated-by-writes");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "data": { "name": "Before", "description": "large prompt" },
                    "avatar": "large image payload"
                })],
            )
            .unwrap();

        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        storage
            .list_projected("characters", &fields, &selections)
            .expect("projected list should read");
        assert_eq!(
            storage
                .cache
                .read()
                .expect("cache lock should be readable")
                .projected_lists
                .len(),
            1
        );

        storage
            .patch(
                "characters",
                "target",
                json!({ "data": { "name": "After", "description": "changed large prompt" } }),
            )
            .expect("patch should update character");

        assert_eq!(
            storage
                .cache
                .read()
                .expect("cache lock should be readable")
                .projected_lists
                .len(),
            0
        );
        let rows = storage
            .list_projected("characters", &fields, &selections)
            .expect("projected list should read updated dirty rows");
        assert_eq!(
            rows,
            vec![json!({ "id": "target", "data": { "name": "After" } })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_projected_cache_is_invalidated_by_replace_all_many() {
        let root = temp_storage_root("list-projected-cache-invalidated-by-replace-many");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "data": { "name": "Before", "description": "large prompt" },
                    "avatar": "large image payload"
                })],
            )
            .unwrap();

        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        storage
            .list_projected("characters", &fields, &selections)
            .expect("projected list should read");
        assert_eq!(
            storage
                .cache
                .read()
                .expect("cache lock should be readable")
                .projected_lists
                .len(),
            1
        );

        storage
            .replace_all_many(vec![(
                "characters",
                vec![json!({
                    "id": "target",
                    "data": { "name": "After", "description": "changed prompt" },
                    "avatar": "large image payload"
                })],
            )])
            .expect("replace_all_many should update character");

        assert_eq!(
            storage
                .cache
                .read()
                .expect("cache lock should be readable")
                .projected_lists
                .len(),
            0
        );
        let rows = storage
            .list_projected("characters", &fields, &selections)
            .expect("projected list should read replaced rows");
        assert_eq!(
            rows,
            vec![json!({ "id": "target", "data": { "name": "After" } })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_projected_applies_dotted_nested_field_selections() {
        let root = temp_storage_root("get-projected-dotted-nested-fields");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "data": {
                        "name": "Rina",
                        "description": "large prompt text",
                        "extensions": {
                            "avatarCrop": { "x": 0.2 },
                            "backstory": "large extension prompt",
                            "fav": true,
                            "importMetadata": {
                                "card": { "spec": "chara_card_v2" },
                                "embeddedLorebook": { "entries": ["large"] }
                            },
                            "nameColor": "#ff99aa"
                        }
                    },
                    "avatar": "large image payload"
                })],
            )
            .unwrap();
        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert(
            "data".to_string(),
            json!([
                "name",
                "extensions.avatarCrop",
                "extensions.fav",
                "extensions.importMetadata.card",
                "extensions.nameColor"
            ]),
        );

        let record = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("projected get should read")
            .expect("target row should exist");

        assert_eq!(
            record,
            json!({
                "id": "target",
                "data": {
                    "name": "Rina",
                    "extensions": {
                        "avatarCrop": { "x": 0.2 },
                        "fav": true,
                        "importMetadata": {
                            "card": { "spec": "chara_card_v2" }
                        },
                        "nameColor": "#ff99aa"
                    }
                }
            })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_projected_pretty_fast_path_returns_deep_dotted_field_from_disk() {
        let root = temp_storage_root("get-projected-pretty-fast-path-deep-dotted-field");
        let storage = FileStorage::new(&root).unwrap();
        let collection_dir = root.join("collections");
        fs::create_dir_all(&collection_dir).unwrap();
        fs::write(
            collection_dir.join("characters.json"),
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "target",
                    "data": {
                        "name": "Rina",
                        "extensions": {
                            "importMetadata": {
                                "card": { "spec": "chara_card_v2" },
                                "embeddedLorebook": { "entries": ["ignore"] }
                            },
                            "backstory": "ignore"
                        }
                    },
                    "avatar": "ignore"
                }
            ]))
            .unwrap(),
        )
        .unwrap();

        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert(
            "data".to_string(),
            json!(["extensions.importMetadata.card"]),
        );

        let record = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("projected get should use pretty fast path")
            .expect("target row should exist");

        assert_eq!(
            record,
            json!({
                "id": "target",
                "data": {
                    "extensions": {
                        "importMetadata": {
                            "card": { "spec": "chara_card_v2" }
                        }
                    }
                }
            })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_projected_uses_pretty_id_fast_path_before_trailing_rows() {
        let root = temp_storage_root("get-projected-pretty-id-fast-path");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::write(
            &collection,
            r#"[
  {
    "id": "target",
    "data": {
      "name": "Rina",
      "description": "large prompt text"
    },
    "avatar": "large image payload"
  },
  {
    "id": "trailing-row",
    "data":
"#,
        )
        .unwrap();
        let fields = vec!["id".to_string(), "data".to_string()];
        let mut selections = Map::new();
        selections.insert("data".to_string(), json!(["name"]));

        let record = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("projected get should use the pretty id fast path")
            .expect("target row should exist");

        assert_eq!(
            record,
            json!({ "id": "target", "data": { "name": "Rina" } })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projected_pretty_range_reads_non_final_record_with_trailing_comma() {
        let root = temp_storage_root("projected-pretty-range-non-final");
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "target",
                    "data": { "name": "Rina", "description": "large prompt text" },
                    "avatar": "large image payload"
                },
                {
                    "id": "other",
                    "data": { "name": "Other", "description": "ignore" },
                    "avatar": "ignore"
                }
            ]))
            .unwrap(),
        )
        .unwrap();
        let ranges = pretty_record_ranges_by_id(&collection)
            .expect("range scan should succeed")
            .expect("pretty ranges should be available");
        let fields = HashSet::from(["id".to_string(), "data".to_string()]);
        let field_selections =
            HashMap::from([("data".to_string(), HashSet::from(["name".to_string()]))]);

        assert_eq!(
            read_pretty_projected_record_range(
                &collection,
                *ranges.get("target").expect("target range should exist"),
                "target",
                &fields,
                &field_selections,
            )
            .expect("non-final projected range should parse")
            .expect("target should be projected"),
            json!({ "id": "target", "data": { "name": "Rina" } })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projected_pretty_range_reads_final_record_without_trailing_comma() {
        let root = temp_storage_root("projected-pretty-range-final");
        let collection = root.join("collections").join("characters.json");
        fs::create_dir_all(collection.parent().unwrap()).unwrap();
        fs::write(
            &collection,
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "other",
                    "data": { "name": "Other", "description": "ignore" },
                    "avatar": "ignore"
                },
                {
                    "id": "target",
                    "data": { "name": "Rina", "description": "large prompt text" },
                    "avatar": "large image payload"
                }
            ]))
            .unwrap(),
        )
        .unwrap();
        let ranges = pretty_record_ranges_by_id(&collection)
            .expect("range scan should succeed")
            .expect("pretty ranges should be available");
        let fields = HashSet::from(["id".to_string(), "data".to_string()]);
        let field_selections =
            HashMap::from([("data".to_string(), HashSet::from(["name".to_string()]))]);

        assert_eq!(
            read_pretty_projected_record_range(
                &collection,
                *ranges.get("target").expect("target range should exist"),
                "target",
                &fields,
                &field_selections,
            )
            .expect("final projected range should parse")
            .expect("target should be projected"),
            json!({ "id": "target", "data": { "name": "Rina" } })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_projected_preserves_selected_array_fields() {
        let root = temp_storage_root("get-projected-preserves-selected-arrays");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "alternateGreetings": [
                        {
                            "content": "hello",
                            "metadata": { "tone": "warm" }
                        }
                    ],
                    "avatar": "large image payload"
                })],
            )
            .unwrap();
        let fields = vec!["id".to_string(), "alternateGreetings".to_string()];
        let mut selections = Map::new();
        selections.insert("alternateGreetings".to_string(), json!(["content"]));

        let record = storage
            .get_projected("characters", "target", &fields, &selections)
            .expect("projected get should read")
            .expect("target row should exist");

        assert_eq!(
            record,
            json!({
                "id": "target",
                "alternateGreetings": [
                    {
                        "content": "hello",
                        "metadata": { "tone": "warm" }
                    }
                ]
            })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_projected_preserves_selected_array_fields() {
        let root = temp_storage_root("list-projected-preserves-selected-arrays");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "characters",
                vec![json!({
                    "id": "target",
                    "alternateGreetings": [
                        {
                            "content": "hello",
                            "metadata": { "tone": "warm" }
                        }
                    ],
                    "avatar": "large image payload"
                })],
            )
            .unwrap();
        let fields = vec!["id".to_string(), "alternateGreetings".to_string()];
        let mut selections = Map::new();
        selections.insert("alternateGreetings".to_string(), json!(["content"]));

        let rows = storage
            .list_projected("characters", &fields, &selections)
            .expect("projected list should read");

        assert_eq!(
            rows,
            vec![json!({
                "id": "target",
                "alternateGreetings": [
                    {
                        "content": "hello",
                        "metadata": { "tone": "warm" }
                    }
                ]
            })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_projected_where_matches_full_filtered_projection() {
        let root = temp_storage_root("list-projected-where");
        let storage = FileStorage::new(&root).unwrap();

        let large_payload = "x".repeat(64 * 1024);
        storage
            .replace_all(
                "characters",
                vec![
                    json!({
                        "id": "target-b",
                        "folderId": "folder-a",
                        "sortOrder": 2,
                        "data": {
                            "name": "Target B",
                            "description": large_payload,
                            "metadata": { "tone": "warm" }
                        },
                        "avatar": "unrequested large avatar payload"
                    }),
                    json!({
                        "id": "skip",
                        "folderId": "folder-b",
                        "sortOrder": 1,
                        "data": {
                            "name": "Skip",
                            "description": large_payload,
                            "metadata": { "tone": "cool" }
                        },
                        "avatar": "unrequested large avatar payload"
                    }),
                    json!({
                        "id": "target-a",
                        "folderId": "folder-a",
                        "sortOrder": 0,
                        "data": {
                            "name": "Target A",
                            "description": large_payload,
                            "metadata": { "tone": "bright" }
                        },
                        "avatar": "unrequested large avatar payload"
                    }),
                ],
            )
            .unwrap();
        storage.flush().expect("rows should flush to disk");

        let filters = Map::from_iter([("folderId".to_string(), json!("folder-a"))]);
        let fields = vec!["id".to_string(), "data".to_string()];
        let selections = Map::from_iter([("data".to_string(), json!(["name"]))]);
        let expected = storage
            .list_where("characters", &filters)
            .expect("full filtered rows should read")
            .into_iter()
            .map(|row| {
                project_row(
                    row,
                    &fields.iter().cloned().collect::<HashSet<_>>(),
                    &selected_nested_fields(&selections),
                )
            })
            .collect::<Vec<_>>();

        let projected = storage
            .list_projected_where("characters", &filters, &fields, &selections)
            .expect("projected filtered rows should read");

        assert_eq!(projected, expected);
        assert_eq!(
            projected,
            vec![
                json!({ "id": "target-b", "data": { "name": "Target B" } }),
                json!({ "id": "target-a", "data": { "name": "Target A" } })
            ]
        );

        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn list_projected_where_in_streams_legacy_sidecar_rows() {
        let root = temp_storage_root("list-projected-where-in");
        FileStorage::new(&root).unwrap();
        let sidecar = root.join("collections").join("message-swipes.json");
        fs::write(
            &sidecar,
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "message-1::swipe::0",
                    "messageId": "message-1",
                    "index": 0,
                    "content": "first",
                    "extra": { "large": "ignored" },
                    "createdAt": "2026-01-01T00:00:00Z"
                },
                {
                    "id": "message-1::swipe::1",
                    "messageId": "message-1",
                    "index": 1,
                    "content": "second",
                    "extra": { "large": "ignored" },
                    "createdAt": "2026-01-01T00:00:01Z"
                },
                {
                    "id": "message-1::swipe::2",
                    "messageId": " message-1 ",
                    "index": 2,
                    "content": "trimmed legacy id",
                    "extra": { "large": "ignored" },
                    "createdAt": "2026-01-01T00:00:02Z"
                },
                {
                    "id": "message-2::swipe::0",
                    "messageId": "message-2",
                    "index": 0,
                    "content": "skip",
                    "extra": { "large": "ignored" },
                    "createdAt": "2026-01-01T00:00:03Z"
                },
                {
                    "id": "missing-message-id",
                    "index": 0,
                    "content": "skip missing parent",
                    "extra": { "large": "ignored" },
                    "createdAt": "2026-01-01T00:00:04Z"
                }
            ]))
            .unwrap(),
        )
        .unwrap();

        let storage = FileStorage::new(&root).unwrap();

        let fields = ["messageId", "index", "content"]
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let values = HashSet::from(["message-1".to_string()]);
        let rows = storage
            .list_projected_where_in("message-swipes", "messageId", &values, &fields, &Map::new())
            .expect("projected filtered rows should read");

        assert_eq!(
            rows,
            vec![
                json!({
                    "messageId": "message-1",
                    "index": 0,
                    "content": "first"
                }),
                json!({
                    "messageId": "message-1",
                    "index": 1,
                    "content": "second"
                }),
                json!({
                    "messageId": " message-1 ",
                    "index": 2,
                    "content": "trimmed legacy id"
                })
            ]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_where_in_streams_full_legacy_sidecar_rows() {
        let root = temp_storage_root("list-where-in-full-sidecars");
        FileStorage::new(&root).unwrap();
        let sidecar = root.join("collections").join("message-swipes.json");
        fs::write(
            &sidecar,
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "message-1::swipe::0",
                    "messageId": "message-1",
                    "index": 0,
                    "content": "first",
                    "extra": { "thinking": "first thought" },
                    "createdAt": "2026-01-01T00:00:00Z",
                    "providerMetadata": { "finishReason": "stop" }
                },
                {
                    "id": "message-2::swipe::0",
                    "messageId": "message-2",
                    "index": 0,
                    "content": "skip",
                    "extra": { "thinking": "skip thought" },
                    "createdAt": "2026-01-01T00:00:01Z"
                },
                {
                    "id": "message-1::swipe::1",
                    "messageId": "message-1",
                    "index": 1,
                    "content": "second",
                    "extra": { "thinking": "second thought" },
                    "createdAt": "2026-01-01T00:00:02Z",
                    "customField": "preserved"
                },
                {
                    "id": "message-1::swipe::2",
                    "messageId": " message-1 ",
                    "index": 2,
                    "content": "trimmed legacy id",
                    "extra": { "thinking": "trimmed thought" },
                    "createdAt": "2026-01-01T00:00:03Z"
                }
            ]))
            .unwrap(),
        )
        .unwrap();

        let storage = FileStorage::new(&root).unwrap();
        let values = HashSet::from(["message-1".to_string()]);
        let rows = storage
            .list_where_in("message-swipes", "messageId", &values)
            .expect("filtered full rows should read");

        assert_eq!(
            rows,
            vec![
                json!({
                    "id": "message-1::swipe::0",
                    "messageId": "message-1",
                    "index": 0,
                    "content": "first",
                    "extra": { "thinking": "first thought" },
                    "createdAt": "2026-01-01T00:00:00Z",
                    "providerMetadata": { "finishReason": "stop" }
                }),
                json!({
                    "id": "message-1::swipe::1",
                    "messageId": "message-1",
                    "index": 1,
                    "content": "second",
                    "extra": { "thinking": "second thought" },
                    "createdAt": "2026-01-01T00:00:02Z",
                    "customField": "preserved"
                }),
                json!({
                    "id": "message-1::swipe::2",
                    "messageId": " message-1 ",
                    "index": 2,
                    "content": "trimmed legacy id",
                    "extra": { "thinking": "trimmed thought" },
                    "createdAt": "2026-01-01T00:00:03Z"
                })
            ]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_messages_for_chat_returns_only_matching_messages() {
        let root = temp_storage_root("list-messages-for-chat");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "a-1", "chatId": "chat-a", "content": "first" }),
                    json!({ "id": "b-1", "chatId": "chat-b", "content": "skip me" }),
                    json!({ "id": "a-2", "chatId": "chat-a", "content": "second" }),
                ],
            )
            .unwrap();

        let rows = storage.list_messages_for_chat("chat-a").unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"], "a-1");
        assert_eq!(rows[1]["id"], "a-2");
        assert_eq!(rows[1]["content"], "second");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn delete_where_removes_all_matching_rows() {
        let root = temp_storage_root("delete-where");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "a-1", "chatId": "chat-a", "content": "first" }),
                    json!({ "id": "b-1", "chatId": "chat-b", "content": "skip me" }),
                    json!({ "id": "a-2", "chatId": "chat-a", "content": "second" }),
                ],
            )
            .unwrap();

        let mut filters = Map::new();
        filters.insert("chatId".to_string(), Value::String("chat-a".to_string()));

        let deleted = storage.delete_where("messages", &filters).unwrap();

        assert_eq!(deleted, 2);
        assert_eq!(
            storage.list("messages").unwrap(),
            vec![json!({ "id": "b-1", "chatId": "chat-b", "content": "skip me" })]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_message_ids_for_chat_projects_ids_without_content() {
        let root = temp_storage_root("list-message-ids-for-chat");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "a-1", "chatId": "chat-a", "content": "first" }),
                    json!({ "id": "b-1", "chatId": "chat-b", "content": "skip me" }),
                    json!({ "id": "a-2", "chatId": "chat-a", "content": "second" }),
                ],
            )
            .unwrap();

        let rows = storage.list_message_ids_for_chat("chat-a").unwrap();

        assert_eq!(rows, vec![json!({ "id": "a-1" }), json!({ "id": "a-2" })]);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_messages_for_chat_projected_skips_unrequested_fields() {
        let root = temp_storage_root("list-messages-for-chat-projected");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![
                    json!({
                        "id": "skip-me",
                        "chatId": "chat-b",
                        "content": "skip",
                        "extra": { "large": "ignored" },
                        "swipes": [{ "content": "skip swipe", "extra": { "thinking": "skip thought" } }]
                    }),
                    json!({
                        "id": "target",
                        "chatId": "chat-a",
                        "content": "stored content",
                        "extra": { "large": "ignored", "hiddenFromAI": true },
                        "swipes": [{ "content": "active swipe", "extra": { "thinking": "visible thought", "large": "ignored" } }]
                    }),
                ],
            )
            .unwrap();
        let fields = vec![
            "id".to_string(),
            "chatId".to_string(),
            "content".to_string(),
            "extra".to_string(),
        ];
        let mut selections = Map::new();
        selections.insert("extra".to_string(), json!(["thinking", "hiddenFromAI"]));

        let rows = storage
            .list_messages_for_chat_projected("chat-a", &fields, &selections)
            .unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "target");
        assert_eq!(rows[0]["chatId"], "chat-a");
        assert_eq!(rows[0]["content"], "stored content");
        assert_eq!(rows[0]["extra"], json!({ "hiddenFromAI": true }));
        assert!(rows[0].get("swipes").is_none());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn count_messages_for_chat_counts_matching_rows_without_projection() {
        let root = temp_storage_root("count-messages-for-chat");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "a-1", "chatId": "chat-a", "content": "first" }),
                    json!({ "id": "b-1", "chatId": "chat-b", "content": "skip me" }),
                    json!({ "id": "a-2", "chatId": "chat-a", "content": "second" }),
                ],
            )
            .unwrap();

        assert_eq!(storage.count_messages_for_chat("chat-a").unwrap(), 2);
        assert_eq!(storage.count_messages_for_chat("chat-b").unwrap(), 1);
        assert_eq!(storage.count_messages_for_chat("missing").unwrap(), 0);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_reads_pretty_record_by_id_when_data_precedes_id() {
        let root = temp_storage_root("get-pretty-record-by-id");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::write(
            &collection,
            r#"[
  {
    "data": {
      "description": "large skipped payload",
      "name": "Skip"
    },
    "id": "skip-me"
  },
  {
    "data": {
      "description": "target payload",
      "name": "Target"
    },
    "id": "target"
  }
]"#,
        )
        .unwrap();

        let row = storage.get("characters", "target").unwrap().unwrap();

        assert_eq!(row["id"], "target");
        assert_eq!(row["data"]["name"], "Target");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_pretty_record_by_id_ignores_nested_id_matches() {
        let root = temp_storage_root("get-pretty-record-ignore-nested-id");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::write(
            &collection,
            r#"[
  {
    "id": "owner",
    "data": {
      "book": {
        "id": "target"
      },
      "name": "Wrong"
    }
  },
  {
    "id": "target",
    "data": {
      "name": "Target"
    }
  }
]"#,
        )
        .unwrap();

        let row = storage.get("characters", "target").unwrap().unwrap();

        assert_eq!(row["id"], "target");
        assert_eq!(row["data"]["name"], "Target");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn get_falls_back_for_compact_collection_json() {
        let root = temp_storage_root("get-compact-record-by-id");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("characters.json");
        fs::write(
            &collection,
            r#"[{"data":{"name":"Skip"},"id":"skip-me"},{"data":{"name":"Target"},"id":"target"}]"#,
        )
        .unwrap();

        let row = storage.get("characters", "target").unwrap().unwrap();

        assert_eq!(row["id"], "target");
        assert_eq!(row["data"]["name"], "Target");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_messages_for_chat_page_returns_latest_matching_messages() {
        let root = temp_storage_root("list-messages-for-chat-page");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "a-1", "chatId": "chat-a", "createdAt": "2026-01-01T00:00:01Z", "content": "first" }),
                    json!({ "id": "b-1", "chatId": "chat-b", "createdAt": "2026-01-01T00:00:02Z", "content": "skip me" }),
                    json!({ "id": "a-2", "chatId": "chat-a", "createdAt": "2026-01-01T00:00:03Z", "content": "second" }),
                    json!({ "id": "a-3", "chatId": "chat-a", "createdAt": "2026-01-01T00:00:04Z", "content": "third" }),
                ],
            )
            .unwrap();

        let rows = storage
            .list_messages_for_chat_page("chat-a", 2, None)
            .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"], "a-2");
        assert_eq!(rows[1]["id"], "a-3");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_messages_for_chat_page_respects_before_cursor() {
        let root = temp_storage_root("list-messages-for-chat-page-before");
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "a-1", "chatId": "chat-a", "createdAt": "2026-01-01T00:00:01Z", "content": "first" }),
                    json!({ "id": "a-2", "chatId": "chat-a", "createdAt": "2026-01-01T00:00:02Z", "content": "second" }),
                    json!({ "id": "a-3", "chatId": "chat-a", "createdAt": "2026-01-01T00:00:03Z", "content": "third" }),
                    json!({ "id": "b-1", "chatId": "chat-b", "createdAt": "2026-01-01T00:00:04Z", "content": "skip me" }),
                ],
            )
            .unwrap();

        let rows = storage
            .list_messages_for_chat_page("chat-a", 2, Some("2026-01-01T00:00:03Z|a-3"))
            .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"], "a-1");
        assert_eq!(rows[1]["id"], "a-2");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replace_all_many_rejects_invalid_collection_before_replacing_anything() {
        let root = temp_storage_root("replace-many-invalid");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("characters", vec![json!({ "id": "old-character" })])
            .unwrap();

        let error = storage
            .replace_all_many(vec![
                ("characters", vec![json!({ "id": "new-character" })]),
                ("../bad", vec![json!({ "id": "bad" })]),
            ])
            .expect_err("invalid collection should reject the batch");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(
            storage.list("characters").unwrap()[0]["id"],
            "old-character"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replace_all_many_rejects_duplicate_collections_before_replacing_anything() {
        let root = temp_storage_root("replace-many-duplicate");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("characters", vec![json!({ "id": "old-character" })])
            .unwrap();

        let error = storage
            .replace_all_many(vec![
                ("characters", vec![json!({ "id": "new-character" })]),
                ("characters", vec![json!({ "id": "duplicate-character" })]),
            ])
            .expect_err("duplicate collection should reject the batch");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(
            storage.list("characters").unwrap()[0]["id"],
            "old-character"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replace_all_many_rejects_non_file_collection_before_replacing_anything() {
        let root = temp_storage_root("replace-many-non-file");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("characters", vec![json!({ "id": "old-character" })])
            .unwrap();
        let message_path = root.join("collections").join("messages.json");
        fs::create_dir(&message_path).unwrap();

        let error = storage
            .replace_all_many(vec![
                ("characters", vec![json!({ "id": "new-character" })]),
                ("messages", vec![json!({ "id": "message-1" })]),
            ])
            .expect_err("non-file collection should reject the batch");

        assert_eq!(error.code, "io_error");
        assert_eq!(
            storage.list("characters").unwrap()[0]["id"],
            "old-character"
        );
        assert!(message_path.is_dir());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replace_all_many_rolls_back_when_after_install_fails() {
        let root = temp_storage_root("replace-many-after-install-fails");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("characters", vec![json!({ "id": "old-character" })])
            .unwrap();

        let error = storage
            .replace_all_many_and_then(
                vec![("characters", vec![json!({ "id": "new-character" })])],
                || {
                    Err(AppError::new(
                        "asset_install_failed",
                        "asset install failed",
                    ))
                },
            )
            .expect_err("after-install failure should reject the batch");

        assert_eq!(error.code, "asset_install_failed");
        assert_eq!(
            storage.list("characters").unwrap()[0]["id"],
            "old-character"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clean_collection_cache_rejects_rows_over_sixteen_mib() {
        let root = temp_storage_root("cache-oversized-clean");
        let storage = FileStorage::new(&root).unwrap();
        let rows = vec![json!({ "id": "large", "payload": "x".repeat(16 * 1024 * 1024) })];

        storage.cache_collection("gallery", &rows, false).unwrap();

        assert!(!storage.is_collection_cached("gallery").unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dirty_collection_cache_preserves_oversized_rows_until_flush() {
        let root = temp_storage_root("cache-oversized-dirty");
        let storage = FileStorage::new(&root).unwrap();
        let rows = vec![json!({ "id": "large", "payload": "x".repeat(16 * 1024 * 1024) })];

        storage.cache_collection("gallery", &rows, true).unwrap();

        assert!(storage.is_collection_cached("gallery").unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projected_list_cache_keeps_at_most_thirty_two_shapes() {
        let root = temp_storage_root("projection-cache-shape-cap");
        let storage = FileStorage::new(&root).unwrap();
        for index in 0..33 {
            let key = ProjectionCacheKey {
                collection: "characters".to_string(),
                shape: ProjectionShape {
                    fields: vec![format!("field-{index}")],
                    field_selections: Vec::new(),
                },
            };
            storage
                .cache_projected_list(&key, &[json!({ "id": index })], None)
                .unwrap();
        }

        assert_eq!(storage.cache.read().unwrap().projected_lists.len(), 32);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clean_cache_evicts_the_least_recently_used_entry_at_total_budget() {
        let root = temp_storage_root("cache-lru-total-budget");
        let storage = FileStorage::new(&root).unwrap();
        storage.cache_collection("characters", &[json!({ "id": "a" })], false).unwrap();
        storage.cache_collection("personas", &[json!({ "id": "b" })], false).unwrap();
        let _ = storage.cached_rows("characters").unwrap();
        {
            let mut cache = storage.cache.write().unwrap();
            assert!(
                cache.collections.get("characters").unwrap().last_access
                    > cache.collections.get("personas").unwrap().last_access
            );
            cache.collections.get_mut("characters").unwrap().approx_bytes = 32 * 1024 * 1024;
            cache.collections.get_mut("personas").unwrap().approx_bytes = 32 * 1024 * 1024;
        }

        storage.cache_collection("gallery", &[json!({ "id": "c" })], false).unwrap();

        assert!(storage.is_collection_cached("characters").unwrap());
        assert!(!storage.is_collection_cached("personas").unwrap());
        assert!(storage.is_collection_cached("gallery").unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projected_payload_bytes_share_the_total_clean_cache_budget() {
        let root = temp_storage_root("projection-cache-byte-budget");
        let storage = FileStorage::new(&root).unwrap();
        for index in 0..2 {
            let key = ProjectionCacheKey {
                collection: format!("projection-{index}"),
                shape: ProjectionShape { fields: vec!["payload".to_string()], field_selections: Vec::new() },
            };
            storage
                .cache_projected_list(&key, &[json!({ "payload": "x".repeat(33 * 1024 * 1024) })], None)
                .unwrap();
        }

        assert_eq!(storage.cache.read().unwrap().projected_lists.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
