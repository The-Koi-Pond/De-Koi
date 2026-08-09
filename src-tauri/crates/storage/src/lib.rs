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
use serde::de::{Error as _, IgnoredAny, SeqAccess, Visitor};
use serde::Deserializer as _;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::io::{BufReader, BufWriter, ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, RwLock,
};
use std::time::{Duration, Instant, SystemTime};
pub use streaming::{StreamingFilterReport, StreamingTransformReport};
use transaction::*;
use write_gate::WriteGate;

const STORAGE_SAVE_DEBOUNCE_MS: u64 = 750;
const FOREGROUND_COMPACTION_GRACE: Duration = Duration::from_secs(30);
const MAX_CLEAN_COLLECTION_CACHE_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOTAL_CLEAN_COLLECTION_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PROJECTED_LIST_CACHE_SHAPES: usize = 32;

type JournalClock = Arc<dyn Fn() -> SystemTime + Send + Sync>;
type DeferredFlushScheduler = Arc<dyn Fn(FileStorage) + Send + Sync>;

struct CompactionActivityState {
    active_foreground_operations: usize,
    deferred_until: Instant,
}

struct CompactionActivity {
    state: Mutex<CompactionActivityState>,
    grace: Duration,
}

impl CompactionActivity {
    fn new(grace: Duration) -> Self {
        Self {
            state: Mutex::new(CompactionActivityState {
                active_foreground_operations: 0,
                deferred_until: Instant::now(),
            }),
            grace,
        }
    }

    fn begin(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.active_foreground_operations = state.active_foreground_operations.saturating_add(1);
    }

    fn end(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.active_foreground_operations == 0 {
            return;
        }
        state.active_foreground_operations -= 1;
        Self::defer_locked(&mut state, self.grace);
    }

    fn defer_for(&self, duration: Duration) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Self::defer_locked(&mut state, duration);
    }

    fn defer_locked(state: &mut CompactionActivityState, duration: Duration) {
        let deadline = Instant::now()
            .checked_add(duration)
            .unwrap_or_else(Instant::now);
        if deadline > state.deferred_until {
            state.deferred_until = deadline;
        }
    }

    fn is_deferred(&self) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.active_foreground_operations > 0 {
            return true;
        }
        Instant::now() < state.deferred_until
    }
}

#[cfg(test)]
type DirtyFlushCloneTestHook = Box<dyn FnMut(&Path, &str) + Send + 'static>;

#[cfg(test)]
static DIRTY_FLUSH_CLONE_TEST_HOOK: std::sync::Mutex<Option<DirtyFlushCloneTestHook>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
type AtomicReplacementPrepareTestHook = Box<dyn FnMut(&Path, &str) + Send + 'static>;

#[cfg(test)]
static ATOMIC_REPLACEMENT_PREPARE_TEST_HOOK: std::sync::Mutex<
    Option<AtomicReplacementPrepareTestHook>,
> = std::sync::Mutex::new(None);

#[cfg(test)]
fn notify_atomic_replacement_prepare(storage_root: &Path, collection: &str) {
    if let Ok(mut hook) = ATOMIC_REPLACEMENT_PREPARE_TEST_HOOK.lock() {
        if let Some(hook) = hook.as_mut() {
            hook(storage_root, collection);
        }
    }
}

#[derive(Clone, Copy)]
enum FlushKind {
    Deferred,
    Shutdown,
}

fn clone_dirty_collection_rows(
    _storage_root: &Path,
    _collection: &str,
    rows: &Arc<Vec<Value>>,
) -> Arc<Vec<Value>> {
    #[cfg(test)]
    if let Ok(mut hook) = DIRTY_FLUSH_CLONE_TEST_HOOK.lock() {
        if let Some(hook) = hook.as_mut() {
            hook(_storage_root, _collection);
        }
    }
    Arc::clone(rows)
}

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
        .chain(
            cache
                .projected_lists
                .values()
                .map(|entry| entry.approx_bytes),
        )
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
            if collection.1 <= projection.1 {
                collection.0
            } else {
                projection.0
            }
        }
        (Some(collection), None) => collection.0,
        (None, Some(projection)) => projection.0,
        (None, None) => return false,
    };
    match selected {
        CacheEvictionKey::Collection(key) => {
            cache.collections.remove(&key);
            cache.id_indexes.remove(&key);
            cache
                .projected_lists
                .retain(|projection, _| projection.collection != key);
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
    write_requested: bool,
}

struct PreparedCollectionReplacements {
    transaction_id: String,
    pending: Vec<PendingCollectionReplacement>,
}

fn take_requested_replacements(entries: Vec<AtomicCollectionRows>) -> Vec<(String, Vec<Value>)> {
    entries
        .into_iter()
        .filter(|entry| entry.write_requested)
        .map(|entry| (entry.collection, entry.rows))
        .collect()
}

fn write_json_rows_pretty<W: Write>(writer: W, rows: &[Value]) -> AppResult<()> {
    serde_json::to_writer_pretty(writer, rows)?;
    Ok(())
}

struct CollectionRowsVisitor<'a> {
    visit: &'a mut dyn FnMut(&Value) -> AppResult<()>,
}

struct CollectionValidationVisitor;

impl<'de> Visitor<'de> for CollectionRowsVisitor<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a storage collection JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while let Some(row) = seq.next_element::<Value>()? {
            (self.visit)(&row).map_err(A::Error::custom)?;
        }
        Ok(())
    }
}

impl<'de> Visitor<'de> for CollectionValidationVisitor {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a storage collection JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(())
    }
}

impl AtomicCollectionRows {
    pub fn collection(&self) -> &str {
        &self.collection
    }

    pub fn rows(&self) -> &[Value] {
        &self.rows
    }

    pub fn rows_mut(&mut self) -> &mut Vec<Value> {
        self.write_requested = true;
        &mut self.rows
    }
}

#[derive(Clone)]
pub struct FileStorage {
    root: PathBuf,
    lock: Arc<RwLock<()>>,
    cache: Arc<RwLock<StorageCache>>,
    flush_scheduled: Arc<AtomicBool>,
    compaction_activity: Arc<CompactionActivity>,
    write_gate: Arc<WriteGate>,
    journal_compaction_policy: JournalCompactionPolicy,
    journal_clock: JournalClock,
    deferred_flush_scheduler: DeferredFlushScheduler,
    #[cfg(feature = "journal-compaction-bench")]
    journal_compaction_counter: Option<Arc<std::sync::atomic::AtomicUsize>>,
}

fn spawn_deferred_flush(storage: FileStorage) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(STORAGE_SAVE_DEBOUNCE_MS));
        if let Err(error) = storage.flush_deferred_writes() {
            eprintln!("[storage] delayed flush failed: {}", error.message);
        }
        storage.flush_scheduled.store(false, Ordering::SeqCst);
        if storage.dirty_collection_count() > 0 {
            storage.schedule_dirty_flush();
        }
    });
}

impl FileStorage {
    pub fn new(root: impl Into<PathBuf>) -> AppResult<Self> {
        Self::new_with_journal_compaction_policy_and_scheduler(
            root.into(),
            JournalCompactionPolicy::default(),
            Arc::new(SystemTime::now),
            FOREGROUND_COMPACTION_GRACE,
            Arc::new(spawn_deferred_flush),
            #[cfg(feature = "journal-compaction-bench")]
            None,
        )
    }

    #[cfg(test)]
    fn new_with_journal_compaction_policy(
        root: PathBuf,
        journal_compaction_policy: JournalCompactionPolicy,
        journal_clock: JournalClock,
    ) -> AppResult<Self> {
        Self::new_with_journal_compaction_policy_and_scheduler(
            root,
            journal_compaction_policy,
            journal_clock,
            Duration::ZERO,
            Arc::new(spawn_deferred_flush),
            #[cfg(feature = "journal-compaction-bench")]
            None,
        )
    }

    fn new_with_journal_compaction_policy_and_scheduler(
        root: PathBuf,
        journal_compaction_policy: JournalCompactionPolicy,
        journal_clock: JournalClock,
        foreground_compaction_grace: Duration,
        deferred_flush_scheduler: DeferredFlushScheduler,
        #[cfg(feature = "journal-compaction-bench")] journal_compaction_counter: Option<
            Arc<std::sync::atomic::AtomicUsize>,
        >,
    ) -> AppResult<Self> {
        let collections = root.join("collections");
        fs::create_dir_all(&collections)?;
        let storage = Self {
            root,
            lock: Arc::new(RwLock::new(())),
            cache: Arc::new(RwLock::new(StorageCache::default())),
            flush_scheduled: Arc::new(AtomicBool::new(false)),
            compaction_activity: Arc::new(CompactionActivity::new(foreground_compaction_grace)),
            write_gate: Arc::new(WriteGate::default()),
            journal_compaction_policy,
            journal_clock,
            deferred_flush_scheduler,
            #[cfg(feature = "journal-compaction-bench")]
            journal_compaction_counter,
        };
        recover_pending_collection_transactions(&collections)?;
        if let Err(error) = append_journal::recover(&collections) {
            storage.write_gate.mark_recovery_required()?;
            return Err(error);
        }
        recover_collection_journals(&collections)?;
        append_journal::prepare_known_checkpoint(&collections)?;
        Ok(storage)
    }

    #[cfg(feature = "journal-compaction-bench")]
    #[doc(hidden)]
    pub fn new_for_journal_compaction_benchmark(
        root: impl Into<PathBuf>,
        journal_compaction_counter: Arc<std::sync::atomic::AtomicUsize>,
    ) -> AppResult<Self> {
        Self::new_with_journal_compaction_policy_and_scheduler(
            root.into(),
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            Arc::new(SystemTime::now),
            Duration::ZERO,
            Arc::new(|_| {}),
            Some(journal_compaction_counter),
        )
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
        append_journal::recover(&self.root.join("collections"))?;
        self.flush_dirty_collections(FlushKind::Shutdown)
    }

    pub fn begin_foreground_activity(&self) {
        self.compaction_activity.begin();
    }

    pub fn end_foreground_activity(&self) {
        self.compaction_activity.end();
    }

    fn flush_deferred_writes(&self) -> AppResult<()> {
        if self.compaction_activity.is_deferred() {
            return Ok(());
        }
        let _write_permit = self.write_gate.begin_write()?;
        if self.compaction_activity.is_deferred() {
            return Ok(());
        }
        // The write permit keeps the dirty cache stable while compaction runs.
        // Reads can continue from that authoritative cache instead of waiting
        // for the slower backup, serialization, sync, and atomic file swap.
        // Avoid checkpointing unrelated pending appends. The dirty flush recovers
        // once up front if its write set contains a checkpoint-tracked collection.
        self.flush_dirty_collections(FlushKind::Deferred)
    }

    pub fn list(&self, collection: &str) -> AppResult<Vec<Value>> {
        self.read_locked_or_recover(
            || self.read_collection_no_recovery(collection),
            || self.read_collection(collection),
        )
    }

    /// Streams rows to the caller without cloning or collecting a collection.
    /// Cached rows are borrowed in place; uncached collections are parsed one row at a time.
    pub fn visit_collection_rows(
        &self,
        collection: &str,
        visit: &mut dyn FnMut(&Value) -> AppResult<()>,
    ) -> AppResult<()> {
        // Validate before invoking the callback. A malformed collection must use
        // the same recovery path as `list`, rather than delivering partial rows.
        self.read_locked_or_recover(
            || self.validate_collection_rows_no_recovery(collection),
            || self.read_collection(collection).map(|_| ()),
        )?;
        self.visit_validated_collection_rows(collection, visit)
    }

    /// Visits only rows whose string field matches one of `filter_values`.
    /// The cached path borrows rows in place; callers decide which matching rows
    /// to clone, so a narrow query never clones the whole cached collection.
    pub fn visit_collection_rows_where_in(
        &self,
        collection: &str,
        filter_field: &str,
        filter_values: &HashSet<String>,
        visit: &mut dyn FnMut(&Value) -> AppResult<()>,
    ) -> AppResult<()> {
        if filter_values.is_empty() {
            return Ok(());
        }
        self.visit_collection_rows(collection, &mut |row| {
            if row_string_field_matches_in(row, filter_field, filter_values) {
                visit(row)?;
            }
            Ok(())
        })
    }

    fn visit_validated_collection_rows(
        &self,
        collection: &str,
        visit: &mut dyn FnMut(&Value) -> AppResult<()>,
    ) -> AppResult<()> {
        validate_collection_name(collection)?;
        let _guard = self
            .lock
            .read()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.write_gate.ensure_available()?;
        let cached_rows = {
            let cache = self
                .cache
                .read()
                .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
            cache
                .collections
                .get(collection)
                .map(|cached| Arc::clone(&cached.rows))
        };
        if let Some(rows) = cached_rows {
            for row in rows.iter() {
                visit(row)?;
            }
            return Ok(());
        }
        if collection_journal_exists(&self.root.join("collections"), collection)? {
            for row in self.read_collection_no_recovery(collection)? {
                visit(&row)?;
            }
            return Ok(());
        }
        let path = self.collection_path(collection)?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(());
        }
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        (&mut deserializer)
            .deserialize_seq(CollectionRowsVisitor { visit })
            .map_err(|error| AppError::new("storage_parse_error", error.to_string()))
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
            && collection == "chats"
            && !had_id
            && !self.is_collection_cached(collection)?
        {
            // Fail before recording a durable mutation if the cache cannot be invalidated.
            drop(
                self.cache
                    .write()
                    .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?,
            );
            let path = self.collection_path(collection)?;
            if !path.exists() || fs::metadata(&path)?.len() == 0 {
                self.append_collection_row(collection, &record)?;
                return Ok(record);
            }
            let source_stamp = chat_summary_source_stamp(&path)?;
            append_collection_mutation(
                &self.root.join("collections"),
                collection,
                &CollectionMutation::UpsertMany {
                    records: vec![record.clone()],
                },
            )?;
            self.invalidate_read_indexes_for_collection(collection)?;
            if let Err(error) =
                upsert_chat_summary_if_current(&self.root, source_stamp.as_deref(), &record)
            {
                eprintln!(
                    "[storage] chat summary update failed after durable chat create; invalidating read model: {}",
                    error.message
                );
                if let Err(invalidation_error) = remove_chat_summary_read_model(&self.root) {
                    eprintln!(
                        "[storage] chat summary read model invalidation failed after durable chat create: {}",
                        invalidation_error.message
                    );
                }
            }
            return Ok(record);
        }
        if !write_immediately
            && collection == "messages"
            && !had_id
            && !self.is_collection_cached(collection)?
            && self.append_many_uncached_locked(vec![(
                collection,
                vec![record.clone()],
            )])?
        {
            return Ok(record);
        }
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

    /// Applies a record-local patch through the durable collection journal without
    /// materializing or replacing the full collection. This is reserved for the
    /// checkpoint-tracked collections whose large histories stay journal-backed
    /// during foreground activity.
    pub fn patch_journaled(&self, collection: &str, id: &str, patch: Value) -> AppResult<Value> {
        validate_collection_name(collection)?;
        if !append_journal::checkpoint_tracks(collection) {
            return Err(AppError::invalid_input(format!(
                "Record-local journal patches are not supported for {collection}"
            )));
        }
        let patch = ensure_object(patch)?;
        if patch.contains_key("id") {
            return Err(AppError::invalid_input(
                "Record-local journal patches cannot change a record id",
            ));
        }

        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        let current = self
            .read_collection_find_by_id_no_recovery(collection, id)?
            .ok_or_else(|| AppError::not_found(format!("{collection}/{id} was not found")))?;
        let mut object = current
            .as_object()
            .cloned()
            .ok_or_else(|| AppError::invalid_input("Stored record is not an object"))?;
        for (key, value) in patch {
            object.insert(key, value);
        }
        object.insert("updatedAt".to_string(), Value::String(now_iso()));
        let record = Value::Object(object);

        // Keep the cache locked from the durability boundary through its update.
        // A dirty cache is authoritative, so it must receive the same record before
        // another reader can observe the journal acknowledgement.
        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        let dirty_cache_index = cache
            .collections
            .get(collection)
            .filter(|cached| cached.dirty)
            .map(|cached| {
                cached.row_indices_by_id.get(id).copied().ok_or_else(|| {
                    AppError::new(
                        "storage_cache_error",
                        format!("Dirty cached record disappeared: {collection}/{id}"),
                    )
                })
            })
            .transpose()?;
        append_collection_mutation(
            &self.root.join("collections"),
            collection,
            &CollectionMutation::UpsertMany {
                records: vec![record.clone()],
            },
        )?;
        cache.id_indexes.remove(collection);
        cache
            .projected_lists
            .retain(|key, _| key.collection != collection);
        let mut updated_dirty_cache = false;
        if let Some(index) = dirty_cache_index {
            let cached = cache
                .collections
                .get_mut(collection)
                .expect("dirty cached collection should still exist");
            let rows = Arc::make_mut(&mut cached.rows);
            let previous_bytes = approximate_json_bytes(&rows[index]);
            let next_bytes = approximate_json_bytes(&record);
            rows[index] = record.clone();
            cached.approx_bytes = cached
                .approx_bytes
                .saturating_sub(previous_bytes)
                .saturating_add(next_bytes);
            updated_dirty_cache = true;
        } else {
            // A clean cache would hide the pending journal entry. Dropping it keeps
            // the large collection cold; targeted reads can resolve the journaled row.
            cache.collections.remove(collection);
        }
        drop(cache);

        self.compaction_activity
            .defer_for(self.compaction_activity.grace);
        if updated_dirty_cache {
            self.schedule_dirty_flush();
        }
        Ok(record)
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
        let mut collection_paths = Vec::with_capacity(collections.len());
        let mut seen_paths = HashSet::new();
        for collection in &collections {
            let path = self.collection_path(collection)?;
            if !seen_paths.insert(path.clone()) {
                return Err(AppError::invalid_input(format!(
                    "Duplicate collection update: {collection}"
                )));
            }
            collection_paths.push(((*collection).to_string(), path));
        }
        let target_collections = collections
            .iter()
            .map(|collection| (*collection).to_string())
            .collect::<HashSet<_>>();
        // The atomic write permit keeps dirty target rows stable while they are
        // materialized. Readers can keep using the authoritative dirty cache,
        // so this potentially slow disk work must stay outside the global lock.
        self.flush_dirty_collections_for(FlushKind::Shutdown, &target_collections)?;
        // Record-local journal patches deliberately keep large cold collections
        // out of the cache. Materialize those journals before an atomic rewrite so
        // its prepared rows include every acknowledged mutation and the replacement
        // retires the earlier journal just like the dirty-cache path does.
        let collections_dir = self.root.join("collections");
        let mut journaled_targets = Vec::new();
        for collection in &target_collections {
            if collection_journal_exists(&collections_dir, collection)? {
                journaled_targets.push(collection);
            }
        }
        if journaled_targets
            .iter()
            .any(|collection| append_journal::checkpoint_tracks(collection))
        {
            append_journal::recover(&collections_dir)?;
        }
        for collection in journaled_targets {
            recover_collection_journal_if_present(&collections_dir, collection)?;
        }
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

            let mut loaded = Vec::with_capacity(collections.len());
            let mut original_stamps = Vec::with_capacity(collections.len());
            for (collection, path) in collection_paths {
                loaded.push(AtomicCollectionRows {
                    collection: collection.clone(),
                    rows: self.read_collection_no_recovery(&collection)?,
                    write_requested: false,
                });
                original_stamps.push((collection, collection_content_stamp(&path)?));
            }
            (loaded, original_stamps)
        };

        let output = update(&mut entries)?;
        if !entries.iter().any(|entry| entry.write_requested) {
            return Ok(output);
        }

        let replacements = take_requested_replacements(entries);
        let prepared = self.prepare_collection_replacement_files(&replacements)?;
        let _guard = match self.lock.write() {
            Ok(guard) => guard,
            Err(_) => {
                cleanup_pending_collection_temps(&prepared.pending);
                return Err(AppError::new("lock_error", "Storage lock poisoned"));
            }
        };
        let stamp_check = (|| -> AppResult<()> {
            for (collection, original_stamp) in &original_stamps {
                let path = self.collection_path(collection)?;
                if collection_content_stamp(&path)? != *original_stamp {
                    return Err(AppError::new(
                        "storage_conflict",
                        format!("Collection changed during atomic update: {collection}"),
                    ));
                }
            }
            Ok(())
        })();
        if let Err(error) = stamp_check {
            cleanup_pending_collection_temps(&prepared.pending);
            return Err(error);
        }
        self.install_prepared_collection_replacements_locked(replacements, prepared, || Ok(()))?;
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
        self.flush_dirty_collections(FlushKind::Shutdown)?;
        let replacements = replacements
            .into_iter()
            .map(|(collection, rows)| (collection.to_string(), rows))
            .collect();
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
        let rows = {
            let mut cache = self
                .cache
                .write()
                .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
            let access = next_cache_access(&mut cache);
            cache.collections.get_mut(collection).map(|cached| {
                cached.last_access = access;
                Arc::clone(&cached.rows)
            })
        };
        Ok(rows.map(|rows| rows.as_ref().clone()))
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
        let rows = {
            let cache = self
                .cache
                .read()
                .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
            cache
                .collections
                .get(collection)
                .filter(|cached| cached.dirty)
                .map(|cached| Arc::clone(&cached.rows))
        };
        Ok(rows.map(|rows| rows.as_ref().clone()))
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
        let prepared = (dirty || approx_bytes <= MAX_CLEAN_COLLECTION_CACHE_BYTES)
            .then(|| (Arc::new(rows.to_vec()), row_indices_by_id(rows)));
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
            while clean_cache_bytes(&cache).saturating_add(approx_bytes)
                > MAX_TOTAL_CLEAN_COLLECTION_CACHE_BYTES
            {
                if !evict_oldest_clean_cache_entry(&mut cache) {
                    break;
                }
            }
        }
        let last_access = next_cache_access(&mut cache);
        let (cached_rows, row_indices_by_id) =
            prepared.expect("cache rows must be prepared before insertion");
        cache.collections.insert(
            collection.to_string(),
            CachedCollection {
                rows: cached_rows,
                row_indices_by_id,
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
                Arc::make_mut(&mut cached.rows).extend(rows.iter().cloned());
                for (offset, row) in rows.iter().enumerate() {
                    let Some(id) = row.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    cached
                        .row_indices_by_id
                        .entry(id.to_string())
                        .or_insert(next_index + offset);
                }
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
        (self.deferred_flush_scheduler)(self.clone());
    }

    fn flush_dirty_collections(&self, flush_kind: FlushKind) -> AppResult<()> {
        self.flush_dirty_collections_matching(flush_kind, |_| true)
    }

    fn flush_dirty_collections_for(
        &self,
        flush_kind: FlushKind,
        collections: &HashSet<String>,
    ) -> AppResult<()> {
        self.flush_dirty_collections_matching(flush_kind, |collection| {
            collections.contains(collection)
        })
    }

    fn flush_dirty_collections_matching(
        &self,
        flush_kind: FlushKind,
        should_flush: impl Fn(&str) -> bool,
    ) -> AppResult<()> {
        let dirty_collections = {
            let cache = self
                .cache
                .read()
                .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
            cache
                .collections
                .iter()
                .filter(|(_, cached)| cached.dirty)
                .map(|(collection, _)| collection.clone())
                .collect::<Vec<_>>()
        };
        let collections_dir = self.root.join("collections");
        for collection in &dirty_collections {
            validate_collection_journal_before_replacement(&collections_dir, collection)?;
        }
        let compact = dirty_collections
            .into_iter()
            .filter(|collection| should_flush(collection))
            .filter(|collection| {
                // Hot message histories stay journal-backed while the app is running.
                // Shutdown and explicit replacement paths still materialize them.
                matches!(flush_kind, FlushKind::Shutdown)
                    || !matches!(collection.as_str(), "messages" | "message-swipes")
            })
            .filter_map(|collection| {
                let force = matches!(flush_kind, FlushKind::Shutdown);
                let should_compact = collection_journal_needs_compaction(
                    &collections_dir,
                    &collection,
                    self.journal_compaction_policy,
                    (self.journal_clock)(),
                    force,
                );
                match should_compact {
                    Ok(true) => Some(Ok(collection)),
                    Ok(false) => None,
                    Err(error) => Some(Err(error)),
                }
            })
            .collect::<AppResult<Vec<_>>>()?;
        if compact
            .iter()
            .any(|collection| append_journal::checkpoint_tracks(collection))
        {
            append_journal::recover(&collections_dir)?;
        }
        for collection in compact {
            let cached_rows = {
                let cache = self
                    .cache
                    .read()
                    .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
                let cached = cache.collections.get(&collection).ok_or_else(|| {
                    AppError::new(
                        "storage_cache_error",
                        format!("Dirty collection disappeared during flush: {collection}"),
                    )
                })?;
                Arc::clone(&cached.rows)
            };
            let rows = clone_dirty_collection_rows(&self.root, &collection, &cached_rows);
            #[cfg(feature = "journal-compaction-bench")]
            if let Some(counter) = &self.journal_compaction_counter {
                counter.fetch_add(1, Ordering::SeqCst);
            }
            self.write_collection_file(&collection, rows.as_ref())?;
            if collection == "chats" {
                let path = self.collection_path(&collection)?;
                let source_stamp = chat_summary_source_stamp(&path)?;
                rebuild_chat_summary_read_model(
                    &self.root,
                    source_stamp.as_deref(),
                    rows.as_ref(),
                )?;
            }
            let mut cache = self
                .cache
                .write()
                .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
            remove_collection_journal(&collections_dir, &collection)?;
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

    fn pending_collection_rows(
        &self,
        collection: &str,
        recover_on_fallback: bool,
    ) -> AppResult<Option<Vec<Value>>> {
        if !collection_journal_exists(&self.root.join("collections"), collection)? {
            return Ok(None);
        }
        if recover_on_fallback {
            self.read_collection(collection).map(Some)
        } else {
            self.read_collection_no_recovery(collection).map(Some)
        }
    }

    fn validate_collection_rows_no_recovery(&self, collection: &str) -> AppResult<()> {
        if self.is_collection_cached(collection)? {
            return Ok(());
        }
        let path = self.collection_path(collection)?;
        if !path.exists() || fs::metadata(&path)?.len() == 0 {
            return Ok(());
        }
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        (&mut deserializer)
            .deserialize_seq(CollectionValidationVisitor)
            .map_err(|error| AppError::new("storage_parse_error", error.to_string()))?;
        deserializer
            .end()
            .map_err(|error| AppError::new("storage_parse_error", error.to_string()))
    }

    fn read_collection_from_disk(&self, collection: &str) -> AppResult<Vec<Value>> {
        let path = self.collection_path(collection)?;
        let mut rows = if !path.exists() {
            Vec::new()
        } else {
            let raw = fs::read_to_string(&path)?;
            if raw.trim().is_empty() {
                Vec::new()
            } else {
                parse_collection_rows(collection, &raw).or_else(|error| {
                    let collections_dir = self.root.join("collections");
                    if recover_collection_journal_if_present(&collections_dir, collection)? {
                        let recovered = fs::read_to_string(&path)?;
                        parse_collection_rows(collection, &recovered)
                    } else {
                        self.recover_collection_after_read_error(collection, &path, error)
                    }
                })?
            }
        };
        apply_pending_collection_mutations(&self.root.join("collections"), collection, &mut rows)?;
        Ok(rows)
    }

    fn read_collection_from_disk_no_recovery(&self, collection: &str) -> AppResult<Vec<Value>> {
        let path = self.collection_path(collection)?;
        let mut rows = if !path.exists() {
            Vec::new()
        } else {
            let raw = fs::read_to_string(&path)?;
            if raw.trim().is_empty() {
                Vec::new()
            } else {
                parse_collection_rows(collection, &raw)?
            }
        };
        apply_pending_collection_mutations(&self.root.join("collections"), collection, &mut rows)?;
        Ok(rows)
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

        if let Some(rows) = self.pending_collection_rows(collection, recover_on_fallback)? {
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

        if let Some(rows) = self.pending_collection_rows(collection, recover_on_fallback)? {
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

        if let Some(rows) = self.pending_collection_rows(collection, recover_on_fallback)? {
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

        if let Some(rows) = self.pending_collection_rows(collection, recover_on_fallback)? {
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
        match pending_collection_record(&self.root.join("collections"), collection, id)? {
            Some(PendingCollectionRecord::Present(row)) => return Ok(Some(row)),
            Some(PendingCollectionRecord::Deleted) => return Ok(None),
            None => {}
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
        match pending_collection_record(&self.root.join("collections"), collection, id)? {
            Some(PendingCollectionRecord::Present(row)) => {
                return Ok(Some(project_row(row, &field_set, &nested_field_sets)));
            }
            Some(PendingCollectionRecord::Deleted) => return Ok(None),
            None => {}
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
        while clean_cache_bytes(&cache).saturating_add(approx_bytes)
            > MAX_TOTAL_CLEAN_COLLECTION_CACHE_BYTES
        {
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
        if matches!(collection, "messages" | "message-swipes") {
            self.compaction_activity
                .defer_for(self.compaction_activity.grace);
        }
        self.cache_collection(collection, rows, true)?;
        self.schedule_dirty_flush();
        Ok(())
    }

    fn write_collection_immediate(&self, collection: &str, rows: &[Value]) -> AppResult<()> {
        let collections_dir = self.root.join("collections");
        validate_collection_journal_before_replacement(&collections_dir, collection)?;
        self.write_collection_file(collection, rows)?;
        if collection == "chats" {
            let path = self.collection_path(collection)?;
            let source_stamp = chat_summary_source_stamp(&path)?;
            rebuild_chat_summary_read_model(&self.root, source_stamp.as_deref(), rows)?;
        }
        remove_collection_journal(&collections_dir, collection)?;
        if append_journal::checkpoint_tracks(collection) {
            append_journal::prepare_known_checkpoint(&collections_dir)?;
        }
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
        if let Err(error) = append_journal::append_transaction(&collections_dir, &appends) {
            if error.code != "invalid_input" {
                self.write_gate.mark_recovery_required()?;
            }
            return Err(error);
        }
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
        replacements: Vec<(String, Vec<Value>)>,
        after_install: F,
    ) -> AppResult<()>
    where
        F: FnOnce() -> AppResult<()>,
    {
        let prepared = self.prepare_collection_replacement_files(&replacements)?;
        self.install_prepared_collection_replacements_locked(replacements, prepared, after_install)
    }

    fn prepare_collection_replacement_files(
        &self,
        replacements: &[(String, Vec<Value>)],
    ) -> AppResult<PreparedCollectionReplacements> {
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
                #[cfg(test)]
                notify_atomic_replacement_prepare(&self.root, collection);
                {
                    let file = fs::File::create(&item.tmp)?;
                    let mut writer = BufWriter::new(file);
                    write_json_rows_pretty(&mut writer, rows)?;
                    writer.flush()?;
                }
                sync_file(&item.tmp)?;
            }
            Ok(())
        })();
        if let Err(error) = prepare_result {
            cleanup_pending_collection_temps(&pending);
            return Err(error);
        }

        Ok(PreparedCollectionReplacements {
            transaction_id,
            pending,
        })
    }

    fn install_prepared_collection_replacements_locked<F>(
        &self,
        replacements: Vec<(String, Vec<Value>)>,
        prepared: PreparedCollectionReplacements,
        after_install: F,
    ) -> AppResult<()>
    where
        F: FnOnce() -> AppResult<()>,
    {
        let PreparedCollectionReplacements {
            transaction_id,
            pending,
        } = prepared;
        let collections_dir = self.root.join("collections");
        let replaces_append_checkpoint = replacements
            .iter()
            .any(|(collection, _)| append_journal::checkpoint_tracks(collection));
        let journal_result = (|| -> AppResult<()> {
            for (collection, _) in &replacements {
                validate_collection_journal_before_replacement(&collections_dir, collection)?;
            }
            if replaces_append_checkpoint {
                append_journal::recover(&collections_dir)?;
                append_journal::invalidate_checkpoint(&collections_dir)?;
            }
            Ok(())
        })();
        if let Err(error) = journal_result {
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
                let path = self.collection_path(&collection)?;
                let source_stamp = chat_summary_source_stamp(&path)?;
                rebuild_chat_summary_read_model(&self.root, source_stamp.as_deref(), &rows)?;
            }
            self.invalidate_read_indexes_for_collection(&collection)?;
            self.cache_collection(&collection, &rows, false)?;
        }
        if replaces_append_checkpoint {
            append_journal::prepare_known_checkpoint(&collections_dir)?;
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
        mpsc, Arc as TestArc, Mutex as TestMutex,
    };
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    static DIRTY_FLUSH_CLONE_TEST_SERIAL: TestMutex<()> = TestMutex::new(());
    static ATOMIC_REPLACEMENT_PREPARE_TEST_SERIAL: TestMutex<()> = TestMutex::new(());

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

    fn storage_with_journal_compaction_policy(
        root: &Path,
        policy: JournalCompactionPolicy,
        now: SystemTime,
    ) -> FileStorage {
        FileStorage::new_with_journal_compaction_policy(
            root.to_path_buf(),
            policy,
            TestArc::new(move || now),
        )
        .unwrap()
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

    fn write_test_transaction_manifest(collections: &Path, phase: &str, entries: Value) -> PathBuf {
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

        assert_eq!(
            storage.list("messages").unwrap(),
            vec![json!({ "id": "old-message" })]
        );
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

        assert_eq!(
            storage.list("messages").unwrap(),
            vec![json!({ "id": "new-message" })]
        );
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
                        .ok_or_else(|| {
                            AppError::invalid_input("prepared manifest was not visible")
                        })?;
                    let value: Value = serde_json::from_slice(&fs::read(manifest)?)?;
                    saw_prepared_manifest.set(value["phase"] == json!("prepared"));
                    Ok(())
                },
            )
            .unwrap();

        assert!(saw_prepared_manifest.get());
        assert!(fs::read_dir(&collections)
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| {
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
        write_test_collection(
            &primary,
            vec![json!({ "id": "existing", "name": "Before" })],
        );
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
    fn short_generic_mutation_burst_stays_journal_backed_during_deferred_flush() {
        let root = temp_storage_root("short-generic-journal-burst");
        let storage = FileStorage::new(&root).unwrap();
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let primary_before = fs::read(&primary).unwrap();

        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        storage.flush_deferred_writes().unwrap();

        assert_eq!(
            fs::read(&primary).unwrap(),
            primary_before,
            "a short mutation burst must not immediately serialize the whole collection"
        );
        assert!(
            journal.exists(),
            "the acknowledged mutation must remain journal-backed"
        );
        assert_eq!(
            storage.list("characters").unwrap()[0]["name"],
            "After",
            "the live cache must expose the acknowledged journal overlay"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn entry_count_threshold_compacts_a_generic_collection() {
        let root = temp_storage_root("generic-journal-entry-threshold");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), 2, u64::MAX),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let primary_before = fs::read(&primary).unwrap();

        storage
            .patch("characters", "character-1", json!({ "name": "First" }))
            .unwrap();
        storage.flush_deferred_writes().unwrap();
        assert_eq!(fs::read(&primary).unwrap(), primary_before);
        assert!(journal.exists());

        storage
            .patch("characters", "character-1", json!({ "name": "Second" }))
            .unwrap();
        storage.flush_deferred_writes().unwrap();

        assert!(!journal.exists(), "the entry count threshold must compact");
        assert_eq!(
            parse_collection_file("characters", &primary).unwrap()[0]["name"],
            "Second"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deferred_flush_clones_only_collections_selected_for_compaction() {
        let _serial = DIRTY_FLUSH_CLONE_TEST_SERIAL.lock().unwrap();
        let root = temp_storage_root("deferred-flush-selected-clones");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), 2, u64::MAX),
            SystemTime::now(),
        );
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        storage
            .replace_all(
                "personas",
                vec![json!({ "id": "persona-1", "name": "Before" })],
            )
            .unwrap();

        storage
            .patch("personas", "persona-1", json!({ "name": "Still dirty" }))
            .unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "First" }))
            .unwrap();
        storage.flush_deferred_writes().unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "Second" }))
            .unwrap();

        let cloned = TestArc::new(TestMutex::new(Vec::new()));
        let observed = TestArc::clone(&cloned);
        let observed_root = root.clone();
        *DIRTY_FLUSH_CLONE_TEST_HOOK.lock().unwrap() =
            Some(Box::new(move |storage_root, collection| {
                if storage_root == observed_root {
                    observed.lock().unwrap().push(collection.to_string());
                }
            }));
        storage.flush_deferred_writes().unwrap();
        *DIRTY_FLUSH_CLONE_TEST_HOOK.lock().unwrap() = None;

        let mut cloned = cloned.lock().unwrap().clone();
        cloned.sort();
        assert_eq!(
            cloned,
            vec!["characters"],
            "a below-threshold dirty collection must remain journal-backed without cloning rows"
        );
        assert!(
            root.join("collections")
                .join("personas.pending.jsonl")
                .exists(),
            "the below-threshold collection must remain dirty"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_continue_while_deferred_compaction_clones_dirty_rows() {
        let _serial = DIRTY_FLUSH_CLONE_TEST_SERIAL.lock().unwrap();
        let root = temp_storage_root("deferred-flush-readable-during-compaction");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::ZERO, usize::MAX, u64::MAX),
            SystemTime::now() + Duration::from_secs(1),
        );
        storage
            .replace_all(
                "personas",
                vec![json!({
                    "id": "persona-1",
                    "name": "Before"
                })],
            )
            .unwrap();
        storage
            .patch("personas", "persona-1", json!({ "name": "After" }))
            .unwrap();

        let (clone_started_tx, clone_started_rx) = mpsc::sync_channel(1);
        let (release_clone_tx, release_clone_rx) = mpsc::sync_channel(1);
        let observed_root = root.clone();
        *DIRTY_FLUSH_CLONE_TEST_HOOK.lock().unwrap() =
            Some(Box::new(move |storage_root, collection| {
                if storage_root == observed_root && collection == "personas" {
                    clone_started_tx.send(()).unwrap();
                    release_clone_rx.recv().unwrap();
                }
            }));

        let flush_storage = storage.clone();
        let flush = std::thread::spawn(move || flush_storage.flush_deferred_writes());
        clone_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("deferred compaction must reach the dirty row snapshot");

        let (read_tx, read_rx) = mpsc::sync_channel(1);
        let read_storage = storage.clone();
        let read = std::thread::spawn(move || {
            read_tx
                .send(read_storage.get("personas", "persona-1"))
                .unwrap();
        });
        let early_read = read_rx.recv_timeout(Duration::from_millis(250));
        let read_completed_while_compaction_paused = early_read.is_ok();

        release_clone_tx.send(()).unwrap();
        flush.join().unwrap().unwrap();
        *DIRTY_FLUSH_CLONE_TEST_HOOK.lock().unwrap() = None;
        let read_result = match early_read {
            Ok(result) => result,
            Err(_) => read_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("read must finish after deferred compaction resumes"),
        };
        read.join().unwrap();

        assert!(
            read_completed_while_compaction_paused,
            "deferred disk compaction must not hold the global storage lock"
        );
        assert_eq!(
            read_result.unwrap().unwrap()["name"],
            "After",
            "reads during compaction must use the authoritative dirty cache"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cold_cache_reads_continue_while_deferred_compaction_snapshots_dirty_rows() {
        let _serial = DIRTY_FLUSH_CLONE_TEST_SERIAL.lock().unwrap();
        let root = temp_storage_root("deferred-flush-cold-cache-readable");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("characters.json"),
            vec![json!({ "id": "character-1", "name": "Cold cache" })],
        );
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::ZERO, usize::MAX, u64::MAX),
            SystemTime::now() + Duration::from_secs(1),
        );
        storage
            .replace_all(
                "personas",
                vec![json!({
                    "id": "persona-1",
                    "name": "Before"
                })],
            )
            .unwrap();
        storage
            .patch("personas", "persona-1", json!({ "name": "After" }))
            .unwrap();

        let (clone_started_tx, clone_started_rx) = mpsc::sync_channel(1);
        let (release_clone_tx, release_clone_rx) = mpsc::sync_channel(1);
        let observed_root = root.clone();
        *DIRTY_FLUSH_CLONE_TEST_HOOK.lock().unwrap() =
            Some(Box::new(move |storage_root, collection| {
                if storage_root == observed_root && collection == "personas" {
                    clone_started_tx.send(()).unwrap();
                    release_clone_rx.recv().unwrap();
                }
            }));

        let flush_storage = storage.clone();
        let flush = std::thread::spawn(move || flush_storage.flush_deferred_writes());
        clone_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("deferred compaction must reach the dirty row snapshot");

        let (read_tx, read_rx) = mpsc::sync_channel(1);
        let read_storage = storage.clone();
        let read = std::thread::spawn(move || {
            read_tx
                .send(read_storage.get("characters", "character-1"))
                .unwrap();
        });
        let early_read = read_rx.recv_timeout(Duration::from_millis(250));
        let read_completed_while_compaction_paused = early_read.is_ok();

        release_clone_tx.send(()).unwrap();
        flush.join().unwrap().unwrap();
        *DIRTY_FLUSH_CLONE_TEST_HOOK.lock().unwrap() = None;
        let read_result = match early_read {
            Ok(result) => result,
            Err(_) => read_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("cold-cache read must finish after compaction resumes"),
        };
        read.join().unwrap();

        assert!(
            read_completed_while_compaction_paused,
            "deferred compaction must not hold the cache lock while snapshotting rows"
        );
        assert_eq!(
            read_result.unwrap().unwrap()["name"],
            "Cold cache",
            "a concurrent cold-cache read must preserve its indexed result"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn byte_size_threshold_compacts_a_generic_collection() {
        let root = temp_storage_root("generic-journal-byte-threshold");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, 1),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();

        storage
            .patch(
                "characters",
                "character-1",
                json!({ "name": "x".repeat(1024) }),
            )
            .unwrap();
        storage.flush_deferred_writes().unwrap();

        assert!(!journal.exists(), "the byte-size threshold must compact");
        assert_eq!(
            parse_collection_file("characters", &primary).unwrap()[0]["name"]
                .as_str()
                .unwrap()
                .len(),
            1024
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deferred_compaction_rejects_a_corrupt_journal_before_overwriting_the_primary() {
        let root = temp_storage_root("corrupt-generic-journal-before-compaction");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, 1),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let primary_before = fs::read(&primary).unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        let mut file = fs::OpenOptions::new().append(true).open(&journal).unwrap();
        file.write_all(b"{ corrupt threshold entry\\n").unwrap();
        file.sync_all().unwrap();

        let error = storage
            .flush_deferred_writes()
            .expect_err("a corrupt journal must block threshold compaction");

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert_eq!(fs::read(&primary).unwrap(), primary_before);
        assert!(journal.exists(), "recovery evidence must be preserved");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shutdown_flush_rejects_a_corrupt_generic_journal_before_overwriting_the_primary() {
        let root = temp_storage_root("corrupt-generic-journal-shutdown-flush");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let primary_before = fs::read(&primary).unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        let mut file = fs::OpenOptions::new().append(true).open(&journal).unwrap();
        file.write_all(b"{ corrupt shutdown entry\\n").unwrap();
        file.sync_all().unwrap();

        let error = storage
            .flush()
            .expect_err("shutdown must reject corrupt recovery evidence");

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert_eq!(fs::read(&primary).unwrap(), primary_before);
        assert!(journal.exists(), "shutdown must preserve corrupt evidence");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn streaming_boundary_rejects_a_corrupt_generic_journal_before_overwriting_the_primary() {
        let root = temp_storage_root("corrupt-generic-journal-streaming-boundary");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let primary_before = fs::read(&primary).unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        let mut file = fs::OpenOptions::new().append(true).open(&journal).unwrap();
        file.write_all(b"{ corrupt streaming entry\\n").unwrap();
        file.sync_all().unwrap();

        let error = storage
            .visit_collection_streaming("characters", |_, _| Ok(()))
            .expect_err("streaming must reject corrupt recovery evidence");

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert_eq!(fs::read(&primary).unwrap(), primary_before);
        assert!(journal.exists(), "streaming must preserve corrupt evidence");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_boundary_rejects_a_corrupt_generic_journal_before_overwriting_the_primary() {
        let root = temp_storage_root("corrupt-generic-journal-atomic-boundary");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let primary_before = fs::read(&primary).unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        let mut file = fs::OpenOptions::new().append(true).open(&journal).unwrap();
        file.write_all(b"{ corrupt atomic entry\\n").unwrap();
        file.sync_all().unwrap();
        let update_ran = std::cell::Cell::new(false);

        let error = storage
            .update_collections_atomically(vec!["personas"], |_| {
                update_ran.set(true);
                Ok(())
            })
            .expect_err("atomic update must reject corrupt recovery evidence");

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert!(
            !update_ran.get(),
            "the atomic callback must not run after a failed flush"
        );
        assert_eq!(fs::read(&primary).unwrap(), primary_before);
        assert!(
            journal.exists(),
            "atomic update must preserve corrupt evidence"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_boundary_rejects_a_corrupt_generic_journal_before_importing_rows() {
        let root = temp_storage_root("corrupt-generic-journal-replacement-boundary");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let primary_before = fs::read(&primary).unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        let mut file = fs::OpenOptions::new().append(true).open(&journal).unwrap();
        file.write_all(b"{ corrupt replacement entry\\n").unwrap();
        file.sync_all().unwrap();

        let error = storage
            .replace_all("characters", vec![json!({ "id": "imported-character" })])
            .expect_err("replacement must reject corrupt recovery evidence");

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert_eq!(fs::read(&primary).unwrap(), primary_before);
        assert!(
            journal.exists(),
            "replacement must preserve corrupt evidence"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bulk_import_boundary_rejects_a_corrupt_generic_journal_before_installing_rows() {
        let root = temp_storage_root("corrupt-generic-journal-bulk-import-boundary");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let primary_before = fs::read(&primary).unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        let mut file = fs::OpenOptions::new().append(true).open(&journal).unwrap();
        file.write_all(b"{ corrupt bulk import entry\\n").unwrap();
        file.sync_all().unwrap();

        let error = storage
            .replace_all_many(vec![(
                "personas",
                vec![json!({ "id": "imported-persona" })],
            )])
            .expect_err("bulk import must reject corrupt recovery evidence");

        assert_eq!(error.code, "storage_journal_recovery_required");
        assert_eq!(fs::read(&primary).unwrap(), primary_before);
        assert!(!root.join("collections").join("personas.json").exists());
        assert!(
            journal.exists(),
            "bulk import must preserve corrupt evidence"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bulk_import_compacts_and_preserves_a_valid_generic_journal_before_installing_rows() {
        let root = temp_storage_root("valid-generic-journal-bulk-import-boundary");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();

        storage
            .replace_all_many(vec![(
                "personas",
                vec![json!({ "id": "imported-persona" })],
            )])
            .unwrap();

        assert_eq!(
            parse_collection_file("characters", &primary).unwrap()[0]["name"],
            "After"
        );
        assert!(
            !journal.exists(),
            "the valid journal must be compacted before import"
        );
        assert_eq!(
            storage.list("personas").unwrap(),
            vec![json!({ "id": "imported-persona" })]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn age_threshold_compacts_a_generic_collection_with_a_deterministic_clock() {
        let root = temp_storage_root("generic-journal-age-threshold");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(1), usize::MAX, u64::MAX),
            SystemTime::now() + Duration::from_secs(2),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();

        storage.flush_deferred_writes().unwrap();

        assert!(
            !journal.exists(),
            "the injected clock must trigger age compaction"
        );
        assert_eq!(
            parse_collection_file("characters", &primary).unwrap()[0]["name"],
            "After"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shutdown_flush_compacts_an_uncompacted_generic_journal() {
        let root = temp_storage_root("shutdown-compacts-generic-journal");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            SystemTime::now(),
        );
        let primary = root.join("collections").join("characters.json");
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        storage.flush_deferred_writes().unwrap();
        assert!(
            journal.exists(),
            "the policy keeps the short burst journal-backed"
        );

        storage.flush().unwrap();

        assert!(
            !journal.exists(),
            "shutdown flush must compact pending mutations"
        );
        assert_eq!(
            parse_collection_file("characters", &primary).unwrap()[0]["name"],
            "After"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_replays_an_uncompacted_generic_journal() {
        let root = temp_storage_root("startup-replays-uncompacted-generic-journal");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, u64::MAX),
            SystemTime::now(),
        );
        let journal = root.join("collections").join("characters.pending.jsonl");
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        storage.flush_deferred_writes().unwrap();
        assert!(
            journal.exists(),
            "the journal must survive until compaction or restart"
        );
        drop(storage);

        let restarted = FileStorage::new(&root).unwrap();

        assert_eq!(restarted.list("characters").unwrap()[0]["name"], "After");
        assert!(
            !journal.exists(),
            "successful startup replay clears recovered evidence"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn journal_append_failure_does_not_mutate_cache_or_primary() {
        let root = temp_storage_root("journal-append-failure");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
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
        write_test_collection(
            &primary,
            vec![json!({ "id": "character-1", "name": "Interrupted" })],
        );
        write_test_collection(
            &staged,
            vec![json!({ "id": "character-1", "name": "Interrupted" })],
        );
        write_test_collection(
            &backup,
            vec![json!({ "id": "character-1", "name": "Before" })],
        );
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
    fn consecutive_uncached_appends_from_empty_storage_reuse_empty_checkpoint() {
        let root = temp_storage_root("consecutive-appends-empty-storage");
        let storage = FileStorage::new(&root).unwrap();

        for index in 1..=2 {
            assert!(storage
                .append_many_uncached(vec![
                    (
                        "messages",
                        vec![json!({ "id": format!("message-{index}") })]
                    ),
                    (
                        "message-swipes",
                        vec![json!({
                            "id": format!("message-{index}::swipe::0"),
                            "messageId": format!("message-{index}"),
                        })],
                    ),
                ])
                .unwrap());
        }

        assert_eq!(storage.list("messages").unwrap().len(), 2);
        assert_eq!(storage.list("message-swipes").unwrap().len(), 2);
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
        let message_backup = append_journal::checkpoint_backup_path(&collections, "messages");
        let swipe_backup = append_journal::checkpoint_backup_path(&collections, "message-swipes");
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
    fn cold_message_create_reuses_pending_append_checkpoint_without_rewriting_primaries() {
        let root = temp_storage_root("cold-message-create-reuses-append-checkpoint");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let swipes = collections.join("message-swipes.json");
        write_test_collection(
            &messages,
            vec![json!({ "id": "historical-message", "chatId": "chat-1" })],
        );
        write_test_collection(
            &swipes,
            vec![json!({
                "id": "historical-message::swipe::0",
                "messageId": "historical-message",
            })],
        );
        let storage = FileStorage::new(&root).unwrap();
        assert!(storage
            .append_many_uncached(vec![
                (
                    "messages",
                    vec![json!({ "id": "generated-message", "chatId": "chat-1" })],
                ),
                (
                    "message-swipes",
                    vec![json!({
                        "id": "generated-message::swipe::0",
                        "messageId": "generated-message",
                    })],
                ),
            ])
            .unwrap());
        let checkpoint = collections.join(".collection-append-journal.jsonl");
        assert!(fs::metadata(&checkpoint).unwrap().len() > 0);
        let message_identity = file_identity(&messages);
        let swipe_identity = file_identity(&swipes);

        let created = storage
            .create(
                "messages",
                json!({ "chatId": "chat-1", "content": "follow-up" }),
            )
            .unwrap();

        assert_eq!(file_identity(&messages), message_identity);
        assert_eq!(file_identity(&swipes), swipe_identity);
        assert!(fs::metadata(&checkpoint).unwrap().len() > 0);
        drop(storage);

        let recovered = FileStorage::new(&root).unwrap();
        assert!(recovered
            .get("messages", created["id"].as_str().unwrap())
            .unwrap()
            .is_some());
        assert_eq!(fs::metadata(checkpoint).unwrap().len(), 0);
        drop(recovered);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cold_chat_create_journals_without_rewriting_the_primary_collection() {
        let root = temp_storage_root("cold-chat-create-journals");
        let collections = root.join("collections");
        let chats = collections.join("chats.json");
        write_test_collection(
            &chats,
            vec![json!({
                "id": "historical-chat",
                "name": "Historical chat",
                "mode": "conversation",
            })],
        );
        let storage = FileStorage::new(&root).unwrap();
        let summary_fields = vec![
            "id".to_string(),
            "name".to_string(),
            "updatedAt".to_string(),
        ];
        storage
            .list_chat_summaries(&summary_fields, &Map::new(), true, None)
            .unwrap();
        let primary_identity = file_identity(&chats);

        let created = storage
            .create(
                "chats",
                json!({ "name": "New conversation", "mode": "conversation" }),
            )
            .unwrap();

        assert_eq!(
            file_identity(&chats),
            primary_identity,
            "acknowledging a cold chat create must not rewrite historical chat bytes"
        );
        let journal = collections.join("chats.pending.jsonl");
        let journal_bytes = fs::metadata(&journal).unwrap().len();
        assert!(journal_bytes > 0);
        assert!(
            journal_bytes < 16 * 1024,
            "a small chat create must journal only the new row"
        );
        assert!(storage
            .get("chats", created["id"].as_str().unwrap())
            .unwrap()
            .is_some());
        assert!(storage
            .list_chat_summaries(&summary_fields, &Map::new(), true, None)
            .unwrap()
            .iter()
            .any(|chat| chat["id"] == created["id"]));
        storage.clear_collection_cache().unwrap();
        assert!(storage
            .list("chats")
            .unwrap()
            .iter()
            .any(|chat| chat["id"] == created["id"]));
        drop(storage);

        let recovered = FileStorage::new(&root).unwrap();
        assert!(recovered
            .get("chats", created["id"].as_str().unwrap())
            .unwrap()
            .is_some());
        assert!(!journal.exists());
        drop(recovered);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn first_chat_create_materializes_the_primary_collection() {
        let root = temp_storage_root("first-chat-create");
        let collections = root.join("collections");
        let chats = collections.join("chats.json");
        let journal = collections.join("chats.pending.jsonl");
        let storage = FileStorage::new(&root).unwrap();

        let created = storage
            .create(
                "chats",
                json!({ "name": "First conversation", "mode": "conversation" }),
            )
            .unwrap();

        assert!(chats.exists());
        assert!(!journal.exists());
        assert_eq!(
            parse_collection_file("chats", &chats).unwrap()[0]["id"],
            created["id"]
        );
        drop(storage);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn flushing_unrelated_dirty_collection_preserves_pending_message_appends() {
        let root = temp_storage_root("unrelated-flush-preserves-message-appends");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("messages.json"),
            vec![json!({ "id": "historical-message", "chatId": "chat-1" })],
        );
        write_test_collection(
            &collections.join("message-swipes.json"),
            vec![json!({
                "id": "historical-message::swipe::0",
                "messageId": "historical-message",
            })],
        );
        let storage = FileStorage::new(&root).unwrap();

        assert!(storage
            .append_many_uncached(vec![
                (
                    "messages",
                    vec![json!({ "id": "pending-message", "chatId": "fixture-chat" })],
                ),
                (
                    "message-swipes",
                    vec![json!({
                        "id": "pending-message::swipe::0",
                        "messageId": "pending-message",
                    })],
                ),
            ])
            .unwrap());
        let journal = collections.join(".collection-append-journal.jsonl");
        let pending_journal = fs::read(&journal).unwrap();
        assert!(!pending_journal.is_empty());
        let messages_before_flush = fs::read(collections.join("messages.json")).unwrap();
        let swipes_before_flush = fs::read(collections.join("message-swipes.json")).unwrap();

        storage
            .cache_collection("chats", &[json!({ "id": "fixture-chat" })], true)
            .unwrap();
        storage.flush_deferred_writes().unwrap();

        assert_eq!(fs::read(&journal).unwrap(), pending_journal);
        assert_eq!(
            fs::read(collections.join("messages.json")).unwrap(),
            messages_before_flush
        );
        assert_eq!(
            fs::read(collections.join("message-swipes.json")).unwrap(),
            swipes_before_flush
        );
        assert_eq!(
            parse_collection_file("chats", &collections.join("chats.json"))
                .unwrap()
                .len(),
            1
        );

        drop(storage);
        let recovered = FileStorage::new(&root).unwrap();
        assert!(recovered
            .get("messages", "pending-message")
            .unwrap()
            .is_some());
        assert!(recovered
            .get("message-swipes", "pending-message::swipe::0")
            .unwrap()
            .is_some());
        assert_eq!(fs::metadata(journal).unwrap().len(), 0);
        drop(recovered);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn active_generation_window_defers_fresh_tracked_collection_compaction() {
        let root = temp_storage_root("active-generation-defers-tracked-compaction");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        write_test_collection(
            &messages,
            vec![json!({ "id": "baseline-message", "content": "before" })],
        );
        write_test_collection(&collections.join("message-swipes.json"), Vec::new());
        let original_messages = fs::read(&messages).unwrap();
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::default(),
            SystemTime::now() + Duration::from_secs(10),
        );

        storage
            .patch(
                "messages",
                "baseline-message",
                json!({ "content": "during generation" }),
            )
            .unwrap();
        storage.flush_deferred_writes().unwrap();

        assert_eq!(
            fs::read(&messages).unwrap(),
            original_messages,
            "a fresh message journal should not rewrite the large primary during generation"
        );
        assert!(
            collections.join("messages.pending.jsonl").exists(),
            "the durable message journal should remain until the idle threshold"
        );
        assert_eq!(
            storage
                .get("messages", "baseline-message")
                .unwrap()
                .unwrap()["content"],
            "during generation",
            "reads should continue from the authoritative dirty cache"
        );

        drop(storage);
        let restarted = FileStorage::new(&root).unwrap();
        assert_eq!(
            restarted
                .get("messages", "baseline-message")
                .unwrap()
                .unwrap()["content"],
            "during generation",
            "startup recovery should replay a deferred message journal"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn foreground_generation_defers_size_threshold_compaction_until_reply_persistence() {
        let root = temp_storage_root("foreground-generation-defers-size-compaction");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        write_test_collection(
            &messages,
            vec![json!({ "id": "baseline-message", "content": "before" })],
        );
        write_test_collection(&collections.join("message-swipes.json"), Vec::new());
        let original_messages = fs::read(&messages).unwrap();
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::from_secs(60), usize::MAX, 1),
            SystemTime::now(),
        );

        storage.begin_foreground_activity();
        storage
            .patch(
                "messages",
                "baseline-message",
                json!({ "generationPromptSnapshot": "x".repeat(1024) }),
            )
            .unwrap();
        storage.flush_deferred_writes().unwrap();

        assert_eq!(
            fs::read(&messages).unwrap(),
            original_messages,
            "a size-threshold journal must not start a primary rewrite while the model is streaming"
        );
        assert!(
            collections.join("messages.pending.jsonl").exists(),
            "the acknowledged journal remains the durability boundary during generation"
        );

        storage.end_foreground_activity();
        storage.flush().unwrap();
        assert!(
            !collections.join("messages.pending.jsonl").exists(),
            "shutdown must still materialize a deferred foreground mutation"
        );
        assert_eq!(
            storage
                .get("messages", "baseline-message")
                .unwrap()
                .unwrap()["generationPromptSnapshot"]
                .as_str()
                .unwrap()
                .len(),
            1024
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn message_write_arms_grace_before_foreground_stream_registration() {
        let root = temp_storage_root("message-write-arms-foreground-grace");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![json!({ "id": "baseline-message", "content": "before" })],
            )
            .unwrap();
        let original_messages = fs::read(&messages).unwrap();

        storage
            .patch(
                "messages",
                "baseline-message",
                json!({ "generationPromptSnapshot": "x".repeat(300 * 1024) }),
            )
            .unwrap();
        storage.flush_deferred_writes().unwrap();

        assert_eq!(
            fs::read(&messages).unwrap(),
            original_messages,
            "the user-message write must cover the gap before the LLM stream registers"
        );
        assert!(
            collections.join("messages.pending.jsonl").exists(),
            "the pre-stream mutation remains durable in its journal"
        );

        storage.flush().unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deferred_flush_keeps_message_collections_journal_backed_until_shutdown() {
        let root = temp_storage_root("deferred-flush-keeps-message-journals");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let message_swipes = collections.join("message-swipes.json");
        let characters = collections.join("characters.json");
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::ZERO, usize::MAX, u64::MAX),
            SystemTime::now() + Duration::from_secs(1),
        );
        storage
            .replace_all(
                "messages",
                vec![json!({ "id": "message-1", "content": "Before" })],
            )
            .unwrap();
        storage
            .replace_all(
                "message-swipes",
                vec![json!({ "id": "swipe-1", "content": "Before" })],
            )
            .unwrap();
        storage
            .replace_all(
                "characters",
                vec![json!({ "id": "character-1", "name": "Before" })],
            )
            .unwrap();
        let original_messages = fs::read(&messages).unwrap();
        let original_message_swipes = fs::read(&message_swipes).unwrap();

        storage
            .patch("messages", "message-1", json!({ "content": "After" }))
            .unwrap();
        storage
            .patch(
                "message-swipes",
                "swipe-1",
                json!({ "content": "After" }),
            )
            .unwrap();
        storage
            .patch("characters", "character-1", json!({ "name": "After" }))
            .unwrap();
        storage.flush_deferred_writes().unwrap();

        assert_eq!(fs::read(&messages).unwrap(), original_messages);
        assert_eq!(
            fs::read(&message_swipes).unwrap(),
            original_message_swipes
        );
        assert!(collections.join("messages.pending.jsonl").exists());
        assert!(
            collections
                .join("message-swipes.pending.jsonl")
                .exists()
        );
        assert!(
            !collections.join("characters.pending.jsonl").exists(),
            "ordinary collections must retain bounded deferred compaction"
        );
        assert_eq!(
            parse_collection_file("characters", &characters).unwrap()[0]["name"],
            "After"
        );

        storage.flush().unwrap();
        assert!(!collections.join("messages.pending.jsonl").exists());
        assert!(
            !collections
                .join("message-swipes.pending.jsonl")
                .exists()
        );
        assert_eq!(
            parse_collection_file("messages", &messages).unwrap()[0]["content"],
            "After"
        );
        assert_eq!(
            parse_collection_file("message-swipes", &message_swipes).unwrap()[0]["content"],
            "After"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shutdown_flush_checkpoints_pending_appends_before_writing_tracked_collection() {
        let root = temp_storage_root("shutdown-flush-tracked-collection");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("messages.json"),
            vec![json!({ "id": "baseline-message" })],
        );
        write_test_collection(&collections.join("message-swipes.json"), Vec::new());
        let storage = storage_with_journal_compaction_policy(
            &root,
            JournalCompactionPolicy::new(Duration::ZERO, usize::MAX, u64::MAX),
            SystemTime::now() + Duration::from_secs(1),
        );

        assert!(storage
            .append_many_uncached(vec![(
                "messages",
                vec![json!({ "id": "pending-message", "content": "before" })],
            )])
            .unwrap());
        let journal = collections.join(".collection-append-journal.jsonl");
        assert!(fs::metadata(&journal).unwrap().len() > 0);

        storage
            .patch("messages", "pending-message", json!({ "content": "after" }))
            .unwrap();
        storage.flush().unwrap();

        assert!(!journal.exists());
        drop(storage);
        let restarted = FileStorage::new(&root).unwrap();
        let messages = restarted.list("messages").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["id"], "pending-message");
        assert_eq!(messages[1]["content"], "after");

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
        assert_eq!(
            fs::metadata(collections.join(".collection-append-journal.jsonl"))
                .unwrap()
                .len(),
            0
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_many_uncached_declines_collections_without_checkpoint_lifecycle_support() {
        let root = temp_storage_root("append-declines-untracked-collection");
        let storage = FileStorage::new(&root).unwrap();
        let collections = root.join("collections");

        let appended = storage
            .append_many_uncached(vec![("characters", vec![json!({ "id": "character-1" })])])
            .unwrap();

        assert!(!appended);
        assert!(!collections.join("characters.json").exists());
        assert_eq!(
            fs::metadata(collections.join(".collection-append-journal.jsonl"))
                .unwrap()
                .len(),
            0
        );
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
        assert_eq!(
            fs::metadata(collections.join(".collection-append-journal.jsonl"))
                .unwrap()
                .len(),
            0
        );
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
            vec![
                json!({ "id": "historical-message::swipe::0", "messageId": "historical-message" }),
            ],
        );

        let storage = FileStorage::new(&root).unwrap();
        let message_backup = append_journal::checkpoint_backup_path(&collections, "messages");
        let swipe_backup = append_journal::checkpoint_backup_path(&collections, "message-swipes");
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
            &[(
                "messages",
                vec![json!({ "id": "message-2", "content": "first" })],
            )],
        )
        .unwrap();
        append_journal::append_transaction(
            &collections,
            &[(
                "messages",
                vec![json!({ "id": "message-2", "content": "retry" })],
            )],
        )
        .unwrap();

        let recovered = FileStorage::new(&root).unwrap();

        assert_eq!(
            recovered.get("messages", "message-2").unwrap().unwrap()["content"],
            "retry"
        );
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
    fn startup_recovers_a_legacy_pending_checkpoint_backup() {
        let root = temp_storage_root("legacy-append-checkpoint-backup");
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
        let journal = collections.join(".collection-append-journal.jsonl");
        let legacy_journal = fs::read_to_string(&journal)
            .unwrap()
            .replace("\"version\":2", "\"version\":1");
        fs::write(&journal, legacy_journal).unwrap();
        let checkpoint_backup = append_journal::checkpoint_backup_path(&collections, "messages");
        let legacy_backup = backup_path_for(&messages).unwrap();
        fs::copy(&checkpoint_backup, &legacy_backup).unwrap();
        fs::remove_file(checkpoint_backup).unwrap();
        fs::remove_file(&messages).unwrap();

        let recovered = FileStorage::new(&root).unwrap();

        assert_eq!(recovered.list("messages").unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn current_checkpoint_does_not_fall_back_to_an_unrelated_collection_backup() {
        let root = temp_storage_root("current-checkpoint-rejects-legacy-backup");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        write_test_collection(&messages, vec![json!({ "id": "message-1" })]);
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "replacement-message" })])
            .unwrap();
        storage
            .append_many_uncached(vec![("messages", vec![json!({ "id": "message-2" })])])
            .unwrap();
        let checkpoint_backup =
            append_journal::checkpoint_backup_path(&collections, "messages");
        assert!(backup_path_for(&messages).unwrap().exists());
        fs::remove_file(checkpoint_backup).unwrap();
        fs::write(&messages, b"{ damaged primary").unwrap();
        drop(storage);

        let error = FileStorage::new(&root)
            .err()
            .expect("current checkpoints must not trust the normal collection backup");

        assert_eq!(error.code, "storage_append_journal_recovery_required");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_checkpoint_with_missing_tracked_backup_fails_closed_before_new_append() {
        let root = temp_storage_root("pending-checkpoint-missing-backup");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let swipes = collections.join("message-swipes.json");
        let backup = append_journal::checkpoint_backup_path(&collections, "message-swipes");
        write_test_collection(&messages, vec![json!({ "id": "message-1" })]);
        write_test_collection(
            &swipes,
            vec![json!({ "id": "message-1::swipe::0", "messageId": "message-1" })],
        );
        let storage = FileStorage::new(&root).unwrap();
        storage
            .append_many_uncached(vec![
                ("messages", vec![json!({ "id": "message-2" })]),
                (
                    "message-swipes",
                    vec![json!({ "id": "message-2::swipe::0", "messageId": "message-2" })],
                ),
            ])
            .unwrap();
        fs::remove_file(&backup).unwrap();

        let error = storage
            .append_many_uncached(vec![("messages", vec![json!({ "id": "message-3" })])])
            .unwrap_err();

        assert_eq!(error.code, "storage_append_journal_recovery_required");
        assert!(!backup.exists());
        assert_eq!(
            storage.list("messages").unwrap_err().code,
            "storage_append_journal_recovery_required"
        );
        drop(storage);

        let recovered = FileStorage::new(&root).unwrap();
        assert_eq!(recovered.list("messages").unwrap().len(), 2);
        assert!(backup.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_checkpoint_with_empty_backup_fails_closed_without_losing_history() {
        let root = temp_storage_root("pending-checkpoint-empty-backup");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let backup = append_journal::checkpoint_backup_path(&collections, "messages");
        write_test_collection(&messages, vec![json!({ "id": "message-1" })]);
        let storage = FileStorage::new(&root).unwrap();
        storage
            .append_many_uncached(vec![("messages", vec![json!({ "id": "message-2" })])])
            .unwrap();
        fs::write(&backup, b"").unwrap();

        let error = storage
            .append_many_uncached(vec![(
                "message-swipes",
                vec![json!({
                    "id": "message-3::swipe::0",
                    "messageId": "message-3",
                })],
            )])
            .unwrap_err();

        assert_eq!(error.code, "storage_append_journal_recovery_required");
        assert_eq!(fs::metadata(&backup).unwrap().len(), 0);
        fs::write(&messages, b"{ damaged primary").unwrap();
        drop(storage);

        let restart_error = FileStorage::new(&root)
            .err()
            .expect("startup should reject an empty pending checkpoint backup");
        assert_eq!(
            restart_error.code,
            "storage_append_journal_recovery_required"
        );
        assert_eq!(fs::metadata(&backup).unwrap().len(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_recovery_failure_preserves_append_checkpoint_evidence() {
        let root = temp_storage_root("preserve-failed-append-recovery-evidence");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let backup = append_journal::checkpoint_backup_path(&collections, "messages");
        let journal = collections.join(".collection-append-journal.jsonl");
        write_test_collection(&messages, vec![json!({ "id": "checkpoint-message" })]);
        let storage = FileStorage::new(&root).unwrap();
        drop(storage);
        append_journal::append_transaction(
            &collections,
            &[("messages", vec![json!({ "id": "pending-message" })])],
        )
        .unwrap();
        let evidence = fs::read(&backup).unwrap();
        append_journal::APPEND_RECOVERY_TEST_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(|| {
                Err(AppError::io(std::io::Error::other(
                    "injected startup recovery failure",
                )))
            }))
        });

        let result = FileStorage::new(&root);
        append_journal::APPEND_RECOVERY_TEST_HOOK.with(|hook| *hook.borrow_mut() = None);

        assert!(result.is_err());
        assert_eq!(fs::read(&backup).unwrap(), evidence);
        assert!(fs::metadata(journal).unwrap().len() > 0);
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
        APPEND_APPLY_TEST_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(|path| {
                if path.file_name().and_then(|name| name.to_str()) == Some("message-swipes.json") {
                    return Err(AppError::io(std::io::Error::other(
                        "injected second collection append failure",
                    )));
                }
                Ok(())
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

        assert!(result.unwrap());
        assert_eq!(storage.list("messages").unwrap().len(), 2);
        assert_eq!(storage.list("message-swipes").unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_synchronous_append_recovery_blocks_reads_and_writes_until_restart() {
        let root = temp_storage_root("atomic-append-recovery-failure");
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
        APPEND_APPLY_TEST_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(|path| {
                if path.file_name().and_then(|name| name.to_str()) == Some("message-swipes.json") {
                    return Err(AppError::io(std::io::Error::other(
                        "injected append failure",
                    )));
                }
                Ok(())
            }))
        });
        append_journal::APPEND_RECOVERY_TEST_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(|| {
                Err(AppError::io(std::io::Error::other(
                    "injected recovery failure",
                )))
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
        assert_eq!(
            storage.list("messages").unwrap_err().code,
            "storage_append_journal_recovery_required"
        );
        assert_eq!(
            storage
                .replace_all("characters", vec![json!({ "id": "blocked" })])
                .unwrap_err()
                .code,
            "storage_append_journal_recovery_required"
        );
        drop(storage);

        let recovered = FileStorage::new(&root).unwrap();
        assert_eq!(recovered.list("messages").unwrap().len(), 2);
        assert_eq!(recovered.list("message-swipes").unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_prepares_the_next_append_checkpoint_before_foreground_writes() {
        let root = temp_storage_root("replacement-prepares-next-append-checkpoint");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        let message_swipes = collections.join("message-swipes.json");
        write_test_collection(
            &messages,
            vec![json!({ "id": "baseline-message", "chatId": "chat-1" })],
        );
        write_test_collection(
            &message_swipes,
            vec![json!({
                "id": "baseline-message::swipe::0",
                "messageId": "baseline-message",
            })],
        );
        let storage = FileStorage::new(&root).unwrap();

        storage
            .replace_all_many(vec![
                (
                    "messages",
                    vec![json!({ "id": "replacement-message", "chatId": "chat-1" })],
                ),
                (
                    "message-swipes",
                    vec![json!({
                        "id": "replacement-message::swipe::0",
                        "messageId": "replacement-message",
                    })],
                ),
            ])
            .unwrap();

        let checkpoint = collections.join(".collection-append-journal.jsonl");
        assert_eq!(
            fs::metadata(&checkpoint).unwrap().len(),
            0,
            "replacement should leave an empty checkpoint ready for the next append"
        );
        let message_backup = append_journal::checkpoint_backup_path(&collections, "messages");
        let swipe_backup = append_journal::checkpoint_backup_path(&collections, "message-swipes");
        let message_backup_identity = file_identity(&message_backup);
        let swipe_backup_identity = file_identity(&swipe_backup);

        assert!(storage
            .append_many_uncached(vec![
                (
                    "messages",
                    vec![json!({ "id": "appended-message", "chatId": "chat-1" })],
                ),
                (
                    "message-swipes",
                    vec![json!({
                        "id": "appended-message::swipe::0",
                        "messageId": "appended-message",
                    })],
                ),
            ])
            .unwrap());

        assert_eq!(file_identity(&message_backup), message_backup_identity);
        assert_eq!(file_identity(&swipe_backup), swipe_backup_identity);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_checkpoints_pending_appends_before_installing_new_rows() {
        let root = temp_storage_root("replace-with-pending-append");
        let collections = root.join("collections");
        write_test_collection(
            &collections.join("messages.json"),
            vec![json!({ "id": "baseline" })],
        );
        let storage = FileStorage::new(&root).unwrap();
        storage
            .append_many_uncached(vec![("messages", vec![json!({ "id": "appended" })])])
            .unwrap();

        storage
            .replace_all("messages", vec![json!({ "id": "replacement" })])
            .unwrap();
        drop(storage);
        let restarted = FileStorage::new(&root).unwrap();

        assert_eq!(
            restarted.list("messages").unwrap(),
            vec![json!({ "id": "replacement" })]
        );
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
    fn append_many_uncached_preserves_dirty_cache_and_restart_recovery() {
        let root = temp_storage_root("append-many-dirty-cached");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![json!({ "id": "message-1", "content": "before" })],
            )
            .unwrap();
        storage.replace_all("message-swipes", Vec::new()).unwrap();
        storage
            .patch("messages", "message-1", json!({ "content": "after" }))
            .unwrap();

        let appended = storage
            .append_many_uncached(vec![
                (
                    "messages",
                    vec![json!({ "id": "message-2", "content": "new" })],
                ),
                (
                    "message-swipes",
                    vec![json!({
                        "id": "message-2::swipe::0",
                        "messageId": "message-2",
                        "content": "new"
                    })],
                ),
            ])
            .unwrap();

        assert!(appended);
        assert_eq!(storage.list("messages").unwrap().len(), 2);
        assert_eq!(
            storage.get("messages", "message-1").unwrap().unwrap()["content"],
            json!("after")
        );
        assert_eq!(storage.list("message-swipes").unwrap().len(), 1);
        assert!(
            storage
                .cache
                .read()
                .unwrap()
                .collections
                .get("messages")
                .is_some_and(|cached| cached.dirty),
            "the append must not mark earlier journal-backed message mutations clean"
        );

        drop(storage);
        let reopened = FileStorage::new(&root).unwrap();
        assert_eq!(reopened.list("messages").unwrap().len(), 2);
        assert_eq!(
            reopened.get("messages", "message-1").unwrap().unwrap()["content"],
            json!("after")
        );
        assert_eq!(reopened.list("message-swipes").unwrap().len(), 1);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repeated_message_patch_keeps_dirty_collection_allocation_stable() {
        let root = temp_storage_root("record-local-message-patch");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "message-1", "content": "target" }),
                    json!({ "id": "message-2", "content": "x".repeat(512 * 1024) }),
                ],
            )
            .unwrap();
        storage
            .patch(
                "messages",
                "message-1",
                json!({ "extra": { "status": "pending" } }),
            )
            .unwrap();
        let rows_before = {
            let cache = storage.cache.read().unwrap();
            let cached = cache.collections.get("messages").unwrap();
            assert!(cached.dirty);
            Arc::as_ptr(&cached.rows)
        };

        storage
            .patch_journaled(
                "messages",
                "message-1",
                json!({ "extra": { "status": "completed" } }),
            )
            .unwrap();

        let rows_after = {
            let cache = storage.cache.read().unwrap();
            Arc::as_ptr(&cache.collections.get("messages").unwrap().rows)
        };
        assert_eq!(
            rows_before, rows_after,
            "a record-local metadata patch must not replace the full dirty collection"
        );
        assert_eq!(
            storage.get("messages", "message-1").unwrap().unwrap()["extra"]["status"],
            json!("completed")
        );

        drop(storage);
        let reopened = FileStorage::new(&root).unwrap();
        assert_eq!(
            reopened.get("messages", "message-1").unwrap().unwrap()["extra"]["status"],
            json!("completed")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn journaled_message_patch_keeps_uncached_collection_cold() {
        let root = temp_storage_root("record-local-message-patch-cold");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![
                    json!({ "id": "message-1", "content": "target" }),
                    json!({ "id": "message-2", "content": "x".repeat(512 * 1024) }),
                ],
            )
            .unwrap();
        storage.clear_collection_cache().unwrap();

        storage
            .patch_journaled(
                "messages",
                "message-1",
                json!({ "extra": { "status": "completed" } }),
            )
            .unwrap();

        assert!(!storage.is_collection_cached("messages").unwrap());
        assert_eq!(
            storage.get("messages", "message-1").unwrap().unwrap()["extra"]["status"],
            json!("completed")
        );
        assert!(
            fs::metadata(root.join("collections/messages.pending.jsonl"))
                .unwrap()
                .len()
                < 4 * 1024,
            "the target-record journal must not carry an unrelated large sibling"
        );

        drop(storage);
        let reopened = FileStorage::new(&root).unwrap();
        assert_eq!(
            reopened.get("messages", "message-1").unwrap().unwrap()["extra"]["status"],
            json!("completed")
        );
        assert_eq!(
            reopened.get("messages", "message-2").unwrap().unwrap()["content"],
            json!("x".repeat(512 * 1024))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_update_materializes_an_uncached_record_journal_first() {
        let root = temp_storage_root("record-local-before-atomic-update");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![json!({ "id": "message-1", "content": "before" })],
            )
            .unwrap();
        storage.clear_collection_cache().unwrap();
        storage
            .patch_journaled(
                "messages",
                "message-1",
                json!({ "extra": { "status": "completed" } }),
            )
            .unwrap();
        let journal = root.join("collections/messages.pending.jsonl");
        assert!(journal.exists());

        storage
            .update_collections_atomically(vec!["messages"], |collections| {
                let row = collections[0]
                    .rows_mut()
                    .iter_mut()
                    .find(|row| row["id"] == json!("message-1"))
                    .expect("patched message should be present in atomic rows");
                row["content"] = json!("after");
                Ok(())
            })
            .unwrap();

        assert!(!journal.exists());
        drop(storage);
        let reopened = FileStorage::new(&root).unwrap();
        let message = reopened.get("messages", "message-1").unwrap().unwrap();
        assert_eq!(message["content"], json!("after"));
        assert_eq!(message["extra"]["status"], json!("completed"));
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
    fn requested_atomic_replacements_take_ownership_of_rows() {
        let requested_rows = vec![
            json!({ "id": "message-1", "content": "one" }),
            json!({ "id": "message-2", "content": "two" }),
        ];
        let requested_rows_allocation = requested_rows.as_ptr();
        let entries = vec![
            AtomicCollectionRows {
                collection: "messages".to_string(),
                rows: requested_rows,
                write_requested: true,
            },
            AtomicCollectionRows {
                collection: "message-swipes".to_string(),
                rows: vec![json!({ "id": "message-1::swipe::0" })],
                write_requested: false,
            },
        ];

        let replacements = take_requested_replacements(entries);

        assert_eq!(replacements.len(), 1);
        assert_eq!(replacements[0].0, "messages");
        assert_eq!(replacements[0].1.len(), 2);
        assert_eq!(
            replacements[0].1.as_ptr(),
            requested_rows_allocation,
            "the atomic update must move the row allocation instead of cloning it"
        );
    }

    #[test]
    fn staged_collection_json_is_written_incrementally() {
        struct RejectLargeWrites {
            bytes: Vec<u8>,
            max_write_bytes: usize,
        }

        impl Write for RejectLargeWrites {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                if bytes.len() > self.max_write_bytes {
                    return Err(std::io::Error::other(format!(
                        "received a collection-sized write of {} bytes",
                        bytes.len()
                    )));
                }
                self.bytes.extend_from_slice(bytes);
                Ok(bytes.len())
            }

            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let rows = (0..4_096)
            .map(|index| {
                json!({
                    "id": format!("message-{index}"),
                    "content": "a small row repeated enough times to make a large collection"
                })
            })
            .collect::<Vec<_>>();
        let mut writer = RejectLargeWrites {
            bytes: Vec::new(),
            max_write_bytes: 4 * 1024,
        };

        write_json_rows_pretty(&mut writer, &rows).unwrap();

        assert!(
            writer.bytes.len() > writer.max_write_bytes,
            "the complete collection must be larger than the accepted write size"
        );
        assert_eq!(
            serde_json::from_slice::<Vec<Value>>(&writer.bytes).unwrap(),
            rows
        );
    }

    #[test]
    fn update_collections_atomically_skips_replacement_when_rows_are_only_read() {
        let root = temp_storage_root("update-collections-read-only");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "message-1" })])
            .unwrap();
        let path = root.join("collections").join("messages.json");
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        std::thread::sleep(Duration::from_millis(20));

        let row_count = storage
            .update_collections_atomically(vec!["messages"], |collections| {
                Ok(collections[0].rows().len())
            })
            .unwrap();

        assert_eq!(row_count, 1);
        assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), modified);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_continue_while_atomic_replacement_files_are_prepared() {
        let _serial = ATOMIC_REPLACEMENT_PREPARE_TEST_SERIAL.lock().unwrap();
        let root = temp_storage_root("atomic-replacement-preparation-readable");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all(
                "messages",
                vec![json!({ "id": "message-1", "content": "Before" })],
            )
            .unwrap();
        let (prepare_started_tx, prepare_started_rx) = mpsc::sync_channel(1);
        let (release_prepare_tx, release_prepare_rx) = mpsc::sync_channel(1);
        let observed_root = root.clone();
        *ATOMIC_REPLACEMENT_PREPARE_TEST_HOOK.lock().unwrap() =
            Some(Box::new(move |storage_root, collection| {
                if storage_root == observed_root && collection == "messages" {
                    prepare_started_tx.send(()).unwrap();
                    release_prepare_rx.recv().unwrap();
                }
            }));

        let atomic_storage = storage.clone();
        let atomic = std::thread::spawn(move || {
            atomic_storage.update_collections_atomically(vec!["messages"], |collections| {
                collections[0].rows_mut()[0]["content"] = json!("After");
                Ok(())
            })
        });
        prepare_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("atomic replacement must reach file preparation");

        let (read_tx, read_rx) = mpsc::sync_channel(1);
        let read_storage = storage.clone();
        let read = std::thread::spawn(move || {
            read_tx
                .send(read_storage.get("messages", "message-1"))
                .unwrap();
        });
        let early_read = read_rx.recv_timeout(Duration::from_millis(250));
        let read_completed_while_preparation_paused = early_read.is_ok();

        release_prepare_tx.send(()).unwrap();
        atomic.join().unwrap().unwrap();
        *ATOMIC_REPLACEMENT_PREPARE_TEST_HOOK.lock().unwrap() = None;
        let read_result = match early_read {
            Ok(result) => result,
            Err(_) => read_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("read must finish after atomic preparation resumes"),
        };
        read.join().unwrap();

        assert!(
            read_completed_while_preparation_paused,
            "replacement file preparation must not hold the global storage lock"
        );
        assert_eq!(
            read_result.unwrap().unwrap()["content"],
            "Before",
            "reads during preparation must observe the complete pre-commit state"
        );
        assert_eq!(
            storage.get("messages", "message-1").unwrap().unwrap()["content"],
            "After"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_collections_atomically_keeps_unrelated_dirty_collections_deferred() {
        let root = temp_storage_root("update-collections-targeted-flush");
        let storage = FileStorage::new(&root).unwrap();
        storage
            .replace_all("messages", vec![json!({ "id": "message-1" })])
            .unwrap();
        storage.replace_all("message-swipes", Vec::new()).unwrap();
        storage
            .cache_collection(
                "character-versions",
                &[json!({ "id": "large-unrelated-version" })],
                true,
            )
            .unwrap();

        storage
            .update_collections_atomically(vec!["messages", "message-swipes"], |_| Ok(()))
            .unwrap();

        assert!(
            !root
                .join("collections")
                .join("character-versions.json")
                .exists(),
            "an atomic update must not force unrelated dirty collections to disk"
        );
        assert_eq!(storage.dirty_collection_count(), 1);

        storage.flush().unwrap();
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
    fn visit_collection_rows_recovers_before_delivering_partial_rows() {
        let root = temp_storage_root("visit-collection-recovers-before-partial-rows");
        let storage = FileStorage::new(&root).unwrap();
        let collection = root.join("collections").join("messages.json");
        let backup = root.join("collections").join("messages.json.bak");
        fs::write(&collection, b"[{\"id\":\"partial\"},").unwrap();
        fs::write(
            &backup,
            serde_json::to_vec_pretty(&json!([{ "id": "recovered", "chatId": "chat-1" }])).unwrap(),
        )
        .unwrap();

        let mut ids = Vec::new();
        storage
            .visit_collection_rows("messages", &mut |row| {
                ids.push(row["id"].as_str().unwrap().to_string());
                Ok(())
            })
            .unwrap();

        assert_eq!(ids, vec!["recovered"]);
        assert_eq!(
            storage.list("messages").unwrap(),
            vec![json!({ "id": "recovered", "chatId": "chat-1" })]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn visit_collection_rows_replays_pending_append_journal_before_delivery() {
        let root = temp_storage_root("visit-collection-replays-append-journal");
        let collections = root.join("collections");
        let messages = collections.join("messages.json");
        write_test_collection(
            &messages,
            vec![json!({ "id": "baseline", "chatId": "chat-1" })],
        );
        let storage = FileStorage::new(&root).unwrap();
        append_journal::append_transaction(
            &collections,
            &[(
                "messages",
                vec![json!({ "id": "journaled", "chatId": "chat-1" })],
            )],
        )
        .unwrap();
        fs::write(&messages, b"[{\"id\":\"partial\"},").unwrap();

        let mut ids = Vec::new();
        storage
            .visit_collection_rows("messages", &mut |row| {
                ids.push(row["id"].as_str().unwrap().to_string());
                Ok(())
            })
            .unwrap();

        assert_eq!(ids, vec!["baseline", "journaled"]);
        assert_eq!(
            storage.list("messages").unwrap(),
            vec![
                json!({ "id": "baseline", "chatId": "chat-1" }),
                json!({ "id": "journaled", "chatId": "chat-1" }),
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn visit_collection_rows_where_in_filters_cached_rows_without_a_full_result_clone() {
        let root = temp_storage_root("visit-collection-where-in-cached-rows");
        let storage = FileStorage::new(&root).unwrap();
        let mut rows = vec![json!({ "id": "selected", "messageId": "message-selected" })];
        for index in 0..1_024 {
            rows.push(json!({
                "id": format!("unrelated-{index}"),
                "messageId": format!("message-unrelated-{index}"),
                "content": "large cached sidecar payload"
            }));
        }
        storage.replace_all("message-swipes", rows).unwrap();
        let values = HashSet::from(["message-selected".to_string()]);
        let mut matched = Vec::new();

        storage
            .visit_collection_rows_where_in("message-swipes", "messageId", &values, &mut |row| {
                matched.push(row["id"].as_str().unwrap().to_string());
                Ok(())
            })
            .unwrap();

        assert_eq!(matched, vec!["selected"]);
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
        storage
            .cache_collection("characters", &[json!({ "id": "a" })], false)
            .unwrap();
        storage
            .cache_collection("personas", &[json!({ "id": "b" })], false)
            .unwrap();
        let _ = storage.cached_rows("characters").unwrap();
        {
            let mut cache = storage.cache.write().unwrap();
            assert!(
                cache.collections.get("characters").unwrap().last_access
                    > cache.collections.get("personas").unwrap().last_access
            );
            cache
                .collections
                .get_mut("characters")
                .unwrap()
                .approx_bytes = 32 * 1024 * 1024;
            cache.collections.get_mut("personas").unwrap().approx_bytes = 32 * 1024 * 1024;
        }

        storage
            .cache_collection("gallery", &[json!({ "id": "c" })], false)
            .unwrap();

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
                shape: ProjectionShape {
                    fields: vec!["payload".to_string()],
                    field_selections: Vec::new(),
                },
            };
            storage
                .cache_projected_list(
                    &key,
                    &[json!({ "payload": "x".repeat(33 * 1024 * 1024) })],
                    None,
                )
                .unwrap();
        }

        assert_eq!(storage.cache.read().unwrap().projected_lists.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
