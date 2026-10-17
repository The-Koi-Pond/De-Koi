//! One-time removal of data owned by the retired Game mode.
//!
//! Every row removed here is first written, with the gallery images and NPC portraits
//! it points at, to `backups/removed-game-mode-<timestamp>/` so nothing is lost
//! silently. Deletion is then one atomic write that refuses to delete any row the
//! backup does not hold.

use super::media_uploads::managed_record_file_path;
use crate::state::AppState;
use marinara_core::{now_iso, now_millis, AppError, AppResult};
use marinara_storage::{AtomicCollectionRows, FileStorage};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const GAME_MODE: &str = "game";
const GAME_CHECKPOINTS_COLLECTION: &str = "game-checkpoints";
const BACKUP_RECORDS_FILE: &str = "removed-records.json";
const BACKUP_FILES_DIR: &str = "files";
/// Game mode's Lorebook Keeper filed its books under a category the app no longer offers.
const RETIRED_LOREBOOK_CATEGORY: &str = "game";
const REPLACEMENT_LOREBOOK_CATEGORY: &str = "world";

fn row_id(row: &Value) -> Option<String> {
    row.get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn row_str<'a>(row: &'a Value, key: &str) -> &'a str {
    row.get(key).and_then(Value::as_str).unwrap_or("").trim()
}

fn is_game_row(row: &Value) -> bool {
    row_str(row, "mode") == GAME_MODE || row_str(row, "chatMode") == GAME_MODE
}

fn canonical(path: &Path) -> AppResult<PathBuf> {
    Ok(fs::canonicalize(path)?)
}

fn file_digest(path: &Path) -> AppResult<Vec<u8>> {
    Ok(Sha256::digest(fs::read(path)?).to_vec())
}

/// A source file the backup holds, with the content hash of the copy that was backed up.
struct BackedUpFile {
    path: PathBuf,
    digest: Vec<u8>,
}

/// Copies `source` into the staged backup at its path relative to the data folder, so two
/// files with the same name in different folders can never overwrite each other. The copy
/// must match the source byte for byte. Returns that relative path and the content hash.
fn backup_file(data_dir: &Path, staging: &Path, source: &Path) -> AppResult<(String, Vec<u8>)> {
    let source = canonical(source)?;
    let relative = source.strip_prefix(data_dir).map_err(|_| {
        AppError::new(
            "game_mode_backup_failed",
            format!("{} is outside the data folder", source.display()),
        )
    })?;
    let target = staging.join(BACKUP_FILES_DIR).join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&source, &target)?;
    let digest = file_digest(&target)?;
    if digest != file_digest(&source)? {
        return Err(AppError::new(
            "game_mode_backup_failed",
            format!(
                "backup copy of {} does not match the original",
                source.display()
            ),
        ));
    }
    Ok((relative.to_string_lossy().replace('\\', "/"), digest))
}

fn npc_avatar_files_for_chats(
    state: &AppState,
    chat_ids: &HashSet<String>,
) -> AppResult<Vec<PathBuf>> {
    let dir = state.data_dir.join("avatars").join("npc");
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let prefixes: Vec<String> = chat_ids.iter().map(|id| format!("{id}-")).collect();
    let mut files = Vec::new();
    for entry in entries {
        let path = entry?.path();
        let matches = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| prefixes.iter().any(|prefix| name.starts_with(prefix)));
        if matches && path.is_file() {
            files.push(path);
        }
    }
    Ok(files)
}

/// Every collection the removal rewrites. They change together in one atomic write.
const RETIREMENT_COLLECTIONS: [&str; 14] = [
    "chats",
    "messages",
    "message-swipes",
    "game-state-snapshots",
    "gallery",
    "agent-runs",
    "agent-memory",
    "memory-capture-jobs",
    "story-consolidation-jobs",
    "memory-maintenance-jobs",
    "background-jobs",
    GAME_CHECKPOINTS_COLLECTION,
    "chat-presets",
    "lorebooks",
];

fn row_chat_id(row: &Value) -> Option<&str> {
    row.get("chatId")
        .or_else(|| row.get("chat_id"))
        .and_then(Value::as_str)
        .map(str::trim)
}

/// Background and memory jobs name their chat directly or through a chat-scoped target.
fn job_chat_id(job: &Value) -> Option<&str> {
    row_chat_id(job).or_else(|| {
        let scope = job.get("target")?.get("scope")?;
        (scope.get("kind").and_then(Value::as_str) == Some("chat"))
            .then(|| scope.get("id").and_then(Value::as_str))
            .flatten()
    })
}

fn note_mentions_chat(note: &Value, chat_ids: &HashSet<String>) -> bool {
    ["sourceChatId", "targetChatId"]
        .iter()
        .any(|key| chat_ids.contains(row_str(note, key)))
}

fn rows_named<'a>(lists: &'a [(&str, Vec<Value>)], name: &str) -> &'a [Value] {
    lists
        .iter()
        .find(|(collection, _)| *collection == name)
        .map_or(&[], |(_, rows)| rows.as_slice())
}

/// The Game chats in a set of rows, and the one rule for which rows the removal deletes.
/// The backup, the atomic write, and profile imports all use it, so the backup holds
/// exactly the rows that are deleted.
struct GameChats {
    ids: HashSet<String>,
    message_ids: HashSet<String>,
}

impl GameChats {
    fn new(chats: &[Value], messages: &[Value]) -> Self {
        let ids: HashSet<String> = chats
            .iter()
            .filter(|row| is_game_row(row))
            .filter_map(row_id)
            .collect();
        let message_ids = messages
            .iter()
            .filter(|row| row_chat_id(row).is_some_and(|id| ids.contains(id)))
            .filter_map(row_id)
            .collect();
        Self { ids, message_ids }
    }

    fn owns(&self, chat_id: Option<&str>) -> bool {
        chat_id.is_some_and(|id| self.ids.contains(id))
    }

    /// Whether the removal deletes `row` from `collection`.
    fn removes(&self, collection: &str, row: &Value) -> bool {
        match collection {
            "chats" | "chat-presets" => is_game_row(row),
            "message-swipes" => {
                self.owns(row_chat_id(row)) || self.message_ids.contains(row_str(row, "messageId"))
            }
            "memory-capture-jobs" | "memory-maintenance-jobs" | "background-jobs" => {
                self.owns(job_chat_id(row))
            }
            "story-consolidation-jobs" => {
                self.owns(row_chat_id(row)) || self.owns(Some(row_str(row, "ownerChatId")))
            }
            GAME_CHECKPOINTS_COLLECTION => true,
            "lorebooks" => false,
            _ => self.owns(row_chat_id(row)),
        }
    }

    /// A kept chat the removal edits: connected to a Game chat, or holding notes about one.
    fn edits_kept_chat(&self, chat: &Value) -> bool {
        !is_game_row(chat)
            && (self.ids.contains(row_str(chat, "connectedChatId"))
                || chat
                    .get("notes")
                    .and_then(Value::as_array)
                    .is_some_and(|notes| {
                        notes.iter().any(|note| note_mentions_chat(note, &self.ids))
                    }))
    }

    /// Unlinks a kept chat from Game chats and drops its notes about them.
    fn edit_kept_chat(&self, chat: &mut Value, updated_at: &str) {
        if !self.edits_kept_chat(chat) {
            return;
        }
        let Some(object) = chat.as_object_mut() else {
            return;
        };
        if self.ids.contains(
            object
                .get("connectedChatId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim(),
        ) {
            object.insert("connectedChatId".to_string(), Value::Null);
        }
        if let Some(Value::Array(notes)) = object.get_mut("notes") {
            notes.retain(|note| !note_mentions_chat(note, &self.ids));
        }
        object.insert("updatedAt".to_string(), json!(updated_at));
    }
}

fn retire_lorebook_category(row: &mut Value, updated_at: Option<&str>) {
    if row_str(row, "category") != RETIRED_LOREBOOK_CATEGORY {
        return;
    }
    if let Some(object) = row.as_object_mut() {
        object.insert("category".to_string(), json!(REPLACEMENT_LOREBOOK_CATEGORY));
        if let Some(updated_at) = updated_at {
            object.insert("updatedAt".to_string(), json!(updated_at));
        }
    }
}

/// Fingerprint namespace for kept chats the removal edits.
const EDITED_CHATS: &str = "chats:edited";

/// Identifies a backed-up row by its full contents, so a row that changed after the backup
/// was written does not match.
fn fingerprint(collection: &str, row: &Value) -> String {
    format!("{collection}\u{1f}{row}")
}

/// What the removal will delete or edit, read from storage before anything changes.
struct RemovalPlan {
    chats: GameChats,
    /// Rows to delete, per collection, in full.
    removed: Vec<(&'static str, Vec<Value>)>,
    /// Kept chats as they are before being unlinked from Game chats.
    edited_chats: Vec<Value>,
    retired_category_lorebooks: usize,
}

impl RemovalPlan {
    fn load(storage: &FileStorage) -> AppResult<Self> {
        let lists = RETIREMENT_COLLECTIONS
            .iter()
            .map(|name| Ok((*name, storage.list(name)?)))
            .collect::<AppResult<Vec<_>>>()?;
        let chats = GameChats::new(rows_named(&lists, "chats"), rows_named(&lists, "messages"));
        let edited_chats = rows_named(&lists, "chats")
            .iter()
            .filter(|chat| chats.edits_kept_chat(chat))
            .cloned()
            .collect();
        let retired_category_lorebooks = rows_named(&lists, "lorebooks")
            .iter()
            .filter(|row| row_str(row, "category") == RETIRED_LOREBOOK_CATEGORY)
            .count();
        let removed = lists
            .iter()
            .map(|(name, rows)| {
                let removed = rows
                    .iter()
                    .filter(|row| chats.removes(name, row))
                    .cloned()
                    .collect::<Vec<_>>();
                (*name, removed)
            })
            .filter(|(_, rows)| !rows.is_empty())
            .collect();
        Ok(Self {
            chats,
            removed,
            edited_chats,
            retired_category_lorebooks,
        })
    }

    fn needs_backup(&self) -> bool {
        !self.removed.is_empty() || !self.edited_chats.is_empty()
    }

    fn removed_rows(&self, collection: &str) -> &[Value] {
        rows_named(&self.removed, collection)
    }

    /// Every row the backup holds: removed rows, and kept chats as they were before the edit.
    fn fingerprints(&self) -> HashSet<String> {
        self.removed
            .iter()
            .flat_map(|(name, rows)| rows.iter().map(|row| fingerprint(name, row)))
            .chain(
                self.edited_chats
                    .iter()
                    .map(|chat| fingerprint(EDITED_CHATS, chat)),
            )
            .collect()
    }
}

/// Writes every record about to be deleted, plus the files those records point at, into a
/// staging folder, then publishes it with one rename. A failure anywhere leaves no
/// published backup and nothing deleted.
struct PublishedBackup {
    dir: PathBuf,
    /// Image files the backup copied; removed once the records are gone.
    source_files: Vec<BackedUpFile>,
}

fn write_backup(state: &AppState, plan: &RemovalPlan) -> AppResult<PublishedBackup> {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S");
    let name = format!("removed-game-mode-{timestamp}-{}", now_millis());
    let backups = state.data_dir.join("backups");
    let staging = backups.join(format!(".staging-{name}"));
    let published = backups.join(&name);
    let mut source_files = Vec::new();
    let result = (|| -> AppResult<()> {
        fs::create_dir_all(&staging)?;
        let data_dir = canonical(&state.data_dir)?;
        let mut files = Vec::new();
        let mut missing_files = Vec::new();
        for row in plan.removed_rows("gallery") {
            let record = format!("gallery:{}", row_id(row).unwrap_or_default());
            match managed_record_file_path(state, "gallery", row, "filePath", "filename")? {
                Some(path) if path.is_file() => {
                    let (relative, digest) = backup_file(&data_dir, &staging, &path)?;
                    files.push(json!({ "record": record, "path": relative }));
                    source_files.push(BackedUpFile { path, digest });
                }
                Some(path) => missing_files.push(json!({
                    "record": record,
                    "path": path.to_string_lossy(),
                })),
                None => missing_files.push(json!({ "record": record, "path": Value::Null })),
            }
        }
        for path in npc_avatar_files_for_chats(state, &plan.chats.ids)? {
            let (relative, digest) = backup_file(&data_dir, &staging, &path)?;
            files.push(json!({ "record": "npc-avatar", "path": relative }));
            source_files.push(BackedUpFile { path, digest });
        }
        let removed_rows: serde_json::Map<String, Value> = plan
            .removed
            .iter()
            .map(|(name, rows)| ((*name).to_string(), Value::Array(rows.clone())))
            .collect();
        let records = json!({
            "removedAt": now_iso(),
            "reason": "Game mode was removed from De-Koi. These records were deleted after this backup was written.",
            "filesFolder": BACKUP_FILES_DIR,
            "files": files,
            "missingFiles": missing_files,
            "removedRows": removed_rows,
            "editedChats": plan.edited_chats,
        });
        let path = staging.join(BACKUP_RECORDS_FILE);
        fs::write(&path, serde_json::to_vec_pretty(&records)?)?;
        let written: Value = serde_json::from_slice(&fs::read(&path)?)?;
        if written != records {
            return Err(AppError::new(
                "game_mode_backup_failed",
                "the Game mode backup did not read back intact",
            ));
        }
        fs::rename(&staging, &published)?;
        Ok(())
    })();
    if let Err(error) = result {
        if staging.exists() {
            if let Err(cleanup) = fs::remove_dir_all(&staging) {
                log::warn!(
                    "could not remove incomplete Game mode backup {}: {cleanup}",
                    staging.display()
                );
            }
        }
        return Err(error);
    }
    Ok(PublishedBackup {
        dir: published,
        source_files,
    })
}

fn atomic_rows<'a>(collections: &'a [AtomicCollectionRows], name: &str) -> &'a [Value] {
    collections
        .iter()
        .find(|collection| collection.collection() == name)
        .map_or(&[], AtomicCollectionRows::rows)
}

/// Removes Game chats and every row they own, unlinks chats that were connected to them,
/// empties Game checkpoints, drops Game chat-settings presets, and moves lorebooks out of the
/// retired Game category, all in one atomic write. The write re-reads every row and refuses
/// to delete one the backup does not hold byte for byte; if it fails, nothing changes.
fn retire_game_rows(storage: &FileStorage, plan: &RemovalPlan) -> AppResult<()> {
    let backed_up = plan.fingerprints();
    storage.update_collections_atomically(RETIREMENT_COLLECTIONS.to_vec(), |collections| {
        let chats = GameChats::new(
            atomic_rows(collections, "chats"),
            atomic_rows(collections, "messages"),
        );
        // The Game chats must be exactly the ones the backup planned for: one that changed
        // mode or appeared since would be skipped or removed without a backup.
        if chats.ids != plan.chats.ids {
            return Err(AppError::new(
                "game_mode_backup_stale",
                "Game chats changed after the Game mode backup was written; the removal runs again on the next start",
            ));
        }
        for collection in collections.iter() {
            let name = collection.collection();
            let unsaved = collection.rows().iter().any(|row| {
                (chats.removes(name, row) && !backed_up.contains(&fingerprint(name, row)))
                    || (name == "chats"
                        && chats.edits_kept_chat(row)
                        && !backed_up.contains(&fingerprint(EDITED_CHATS, row)))
            });
            if unsaved {
                return Err(AppError::new(
                    "game_mode_backup_stale",
                    format!("{name} changed after the Game mode backup was written; the removal runs again on the next start"),
                ));
            }
        }
        let updated_at = now_iso();
        for collection in collections.iter_mut() {
            let name = collection.collection().to_string();
            let touched = collection.rows().iter().any(|row| {
                chats.removes(&name, row)
                    || (name == "chats" && chats.edits_kept_chat(row))
                    || (name == "lorebooks"
                        && row_str(row, "category") == RETIRED_LOREBOOK_CATEGORY)
            });
            if !touched {
                continue;
            }
            let rows = collection.rows_mut();
            rows.retain(|row| !chats.removes(&name, row));
            for row in rows.iter_mut() {
                match name.as_str() {
                    "chats" => chats.edit_kept_chat(row, &updated_at),
                    "lorebooks" => retire_lorebook_category(row, Some(&updated_at)),
                    _ => {}
                }
            }
        }
        Ok(())
    })
}

/// Removes source files the backup holds, keeping any that changed after they were copied.
/// Files that records surviving the removal still point at. Cleanup never deletes these,
/// even when a Game row shared the same file.
fn files_still_in_use(state: &AppState) -> AppResult<HashSet<PathBuf>> {
    let mut paths = HashSet::new();
    for row in state.storage.list("gallery")? {
        if let Some(path) =
            managed_record_file_path(state, "gallery", &row, "filePath", "filename")?
        {
            paths.insert(fs::canonicalize(&path).unwrap_or(path));
        }
    }
    Ok(paths)
}

fn remove_backed_up_files(files: &[BackedUpFile], still_in_use: &HashSet<PathBuf>) {
    for file in files {
        let canonical_path = fs::canonicalize(&file.path).unwrap_or_else(|_| file.path.clone());
        if still_in_use.contains(&canonical_path) {
            log::info!(
                "kept Game file {} because another record still uses it",
                file.path.display()
            );
            continue;
        }
        // Move the file aside first, then check the moved bytes: what gets deleted is exactly
        // what was hashed. A file that changed since it was backed up goes back where it was.
        let mut aside = file.path.clone().into_os_string();
        aside.push(".removing");
        let aside = PathBuf::from(aside);
        if let Err(error) = fs::rename(&file.path, &aside) {
            log::warn!(
                "could not remove backed-up Game file {}: {error}",
                file.path.display()
            );
            continue;
        }
        match file_digest(&aside) {
            Ok(digest) if digest == file.digest => {
                if let Err(error) = fs::remove_file(&aside) {
                    log::warn!(
                        "could not remove backed-up Game file {}: {error}",
                        file.path.display()
                    );
                }
            }
            outcome => {
                if let Err(error) = &outcome {
                    log::warn!(
                        "could not check backed-up Game file {}: {error}",
                        file.path.display()
                    );
                } else {
                    log::warn!(
                        "kept Game file {} because it changed after the backup",
                        file.path.display()
                    );
                }
                if let Err(error) = fs::rename(&aside, &file.path) {
                    log::warn!(
                        "could not put back Game file {}: {error}",
                        file.path.display()
                    );
                }
            }
        }
    }
}

/// Backs up, then deletes, Game chats and the rows they own, Game checkpoints, and Game
/// chat-settings presets, and moves lorebooks out of the retired Game category. Returns
/// the published backup folder when anything was removed.
///
/// Order: publish a backup holding every row the removal deletes (and every kept chat it
/// edits), then one atomic write for every record change, then remove the image files that
/// backup already holds. A failure before the write leaves the profile unchanged, and the
/// next start tries again. Gallery rows whose image was already missing are kept in the
/// backup and listed under `missingFiles`; there is no file left to save, and refusing to
/// continue would leave the Game chats stuck forever.
pub(crate) fn remove_game_mode_data(state: &AppState) -> AppResult<Option<PathBuf>> {
    let plan = RemovalPlan::load(&state.storage)?;
    if !plan.needs_backup() && plan.retired_category_lorebooks == 0 {
        return Ok(None);
    }
    let backup = if plan.needs_backup() {
        Some(write_backup(state, &plan)?)
    } else {
        None
    };
    retire_game_rows(&state.storage, &plan)?;
    if let Some(backup) = &backup {
        remove_backed_up_files(&backup.source_files, &files_still_in_use(state)?);
    }
    if let Some(backup) = &backup {
        log::info!(
            "removed Game mode data: chats={} backup={}",
            plan.chats.ids.len(),
            backup.dir.display()
        );
    }
    Ok(backup.map(|backup| backup.dir))
}

/// Drops Game chats, the rows they own, and Game chat-settings presets from a profile
/// restore, unlinks kept chats from them, and moves lorebooks out of the retired Game
/// category, so an older backup or a Marinara profile cannot bring Game mode data back.
/// Keeps `imported` counts accurate and returns how many Game chats were skipped.
pub(crate) fn drop_game_mode_rows_from_profile_import(
    replacements: &mut [(&'static str, Vec<Value>)],
    imported: &mut serde_json::Map<String, Value>,
) -> usize {
    let chats = {
        let rows = |name: &str| {
            replacements
                .iter()
                .find(|(collection, _)| *collection == name)
                .map_or(&[][..], |(_, rows)| rows.as_slice())
        };
        GameChats::new(rows("chats"), rows("messages"))
    };
    let updated_at = now_iso();
    for (collection, rows) in replacements.iter_mut() {
        let before = rows.len();
        rows.retain(|row| !chats.removes(collection, row));
        for row in rows.iter_mut() {
            match *collection {
                "chats" => chats.edit_kept_chat(row, &updated_at),
                "lorebooks" => retire_lorebook_category(row, None),
                _ => {}
            }
        }
        if (rows.len() != before || *collection == "chats") && imported.contains_key(*collection) {
            imported.insert((*collection).to_string(), json!(rows.len()));
        }
    }
    if !chats.ids.is_empty() {
        imported.insert("skippedGameChats".to_string(), json!(chats.ids.len()));
    }
    chats.ids.len()
}

/// A single exported Game chat imports as a Roleplay chat: its messages stay readable.
pub(crate) fn retire_game_chat_mode(chat: &mut serde_json::Map<String, Value>) {
    for key in ["mode", "chatMode"] {
        if chat.get(key).and_then(Value::as_str).map(str::trim) == Some(GAME_MODE) {
            chat.insert(key.to_string(), json!("roleplay"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-game-removal-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn seed(state: &AppState) {
        let storage = &state.storage;
        storage
            .create(
                "chats",
                json!({ "id": "game-1", "name": "Quest", "mode": "game", "characterIds": [] }),
            )
            .unwrap();
        storage
            .create(
                "chats",
                json!({ "id": "rp-1", "name": "Scene", "mode": "roleplay", "characterIds": [] }),
            )
            .unwrap();
        storage
            .create(
                "messages",
                json!({ "id": "m-game", "chatId": "game-1", "role": "assistant", "content": "The GM speaks." }),
            )
            .unwrap();
        storage
            .create(
                "messages",
                json!({ "id": "m-rp", "chatId": "rp-1", "role": "assistant", "content": "Still here." }),
            )
            .unwrap();
        storage
            .create(
                GAME_CHECKPOINTS_COLLECTION,
                json!({ "id": "cp-1", "chatId": "gone-chat" }),
            )
            .unwrap();
        storage
            .create(
                "chat-presets",
                json!({ "id": "preset-game", "name": "Default", "mode": "game" }),
            )
            .unwrap();
        storage
            .create(
                "lorebooks",
                json!({ "id": "lb-game", "name": "Keeper", "category": "game" }),
            )
            .unwrap();
        fs::create_dir_all(state.data_dir.join("avatars").join("npc")).unwrap();
        fs::write(
            state
                .data_dir
                .join("avatars")
                .join("npc")
                .join("game-1-lio.png"),
            b"npc portrait",
        )
        .unwrap();
        // A gallery image with the same file name as the NPC portrait must not overwrite it.
        fs::create_dir_all(state.data_dir.join("gallery")).unwrap();
        fs::write(
            state.data_dir.join("gallery").join("game-1-lio.png"),
            b"gallery image",
        )
        .unwrap();
        storage
            .create(
                "gallery",
                json!({ "id": "g-1", "chatId": "game-1", "filename": "game-1-lio.png", "filePath": "game-1-lio.png" }),
            )
            .unwrap();
        storage
            .create(
                "gallery",
                json!({ "id": "g-missing", "chatId": "game-1", "filename": "gone.png", "filePath": "gone.png" }),
            )
            .unwrap();
    }

    fn game_data_still_present(state: &AppState) -> bool {
        state.storage.get("chats", "game-1").unwrap().is_some()
            && state
                .storage
                .list_messages_for_chat("game-1")
                .unwrap()
                .len()
                == 1
            && state
                .storage
                .list(GAME_CHECKPOINTS_COLLECTION)
                .unwrap()
                .len()
                == 1
            && state
                .storage
                .get("chat-presets", "preset-game")
                .unwrap()
                .is_some()
            && state.storage.get("lorebooks", "lb-game").unwrap().unwrap()["category"] == "game"
            && state
                .data_dir
                .join("gallery")
                .join("game-1-lio.png")
                .is_file()
    }

    #[test]
    fn backs_up_then_removes_only_game_data() {
        let state = test_state("removes-game");
        seed(&state);

        let dir = remove_game_mode_data(&state)
            .expect("migration should succeed")
            .expect("a backup should be written when game data exists");

        let records: Value =
            serde_json::from_slice(&fs::read(dir.join(BACKUP_RECORDS_FILE)).unwrap()).unwrap();
        assert_eq!(records["removedRows"]["chats"][0]["id"], "game-1");
        assert_eq!(
            records["removedRows"]["messages"][0]["content"],
            "The GM speaks."
        );
        assert_eq!(records["removedRows"]["game-checkpoints"][0]["id"], "cp-1");
        assert_eq!(
            records["removedRows"]["chat-presets"][0]["id"],
            "preset-game"
        );
        let files = dir.join(BACKUP_FILES_DIR);
        assert_eq!(
            fs::read(files.join("avatars").join("npc").join("game-1-lio.png")).unwrap(),
            b"npc portrait"
        );
        assert_eq!(
            fs::read(files.join("gallery").join("game-1-lio.png")).unwrap(),
            b"gallery image"
        );
        assert_eq!(records["files"].as_array().unwrap().len(), 2);
        assert_eq!(records["missingFiles"][0]["record"], "gallery:g-missing");
        assert!(
            !fs::read_dir(state.data_dir.join("backups"))
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".staging-")),
            "the staging folder should be published, not left behind"
        );

        assert!(state.storage.get("chats", "game-1").unwrap().is_none());
        assert!(state
            .storage
            .list_messages_for_chat("game-1")
            .unwrap()
            .is_empty());
        assert!(state
            .storage
            .list(GAME_CHECKPOINTS_COLLECTION)
            .unwrap()
            .is_empty());
        assert!(state
            .storage
            .get("chat-presets", "preset-game")
            .unwrap()
            .is_none());
        assert_eq!(
            state.storage.get("lorebooks", "lb-game").unwrap().unwrap()["category"],
            "world"
        );

        assert!(state.storage.get("chats", "rp-1").unwrap().is_some());
        assert_eq!(
            state.storage.list_messages_for_chat("rp-1").unwrap().len(),
            1
        );
    }

    #[test]
    fn failed_backup_deletes_nothing() {
        let state = test_state("failed-backup");
        seed(&state);
        // A plain file where the backups folder should be makes the backup fail.
        fs::write(state.data_dir.join("backups"), b"not a folder").unwrap();

        remove_game_mode_data(&state).expect_err("a backup that cannot be written must abort");

        assert!(game_data_still_present(&state));
    }

    #[test]
    fn removal_refuses_rows_the_backup_does_not_hold() {
        let state = test_state("stale-backup");
        seed(&state);
        let plan = RemovalPlan::load(&state.storage).unwrap();
        state
            .storage
            .create(
                "messages",
                json!({ "id": "m-late", "chatId": "game-1", "role": "user", "content": "late" }),
            )
            .unwrap();

        let error = retire_game_rows(&state.storage, &plan).unwrap_err();

        assert_eq!(error.code, "game_mode_backup_stale");
        assert!(state.storage.get("chats", "game-1").unwrap().is_some());
        assert!(state.storage.get("messages", "m-late").unwrap().is_some());
        assert!(state.storage.get("messages", "m-game").unwrap().is_some());
    }

    #[test]
    fn removal_refuses_a_kept_chat_edited_after_the_backup() {
        let state = test_state("stale-kept-chat");
        seed(&state);
        state
            .storage
            .create(
                "chats",
                json!({ "id": "convo-1", "name": "OOC", "mode": "conversation", "characterIds": [], "connectedChatId": "game-1" }),
            )
            .unwrap();
        let plan = RemovalPlan::load(&state.storage).unwrap();
        state
            .storage
            .patch("chats", "convo-1", json!({ "name": "OOC renamed" }))
            .unwrap();

        let error = retire_game_rows(&state.storage, &plan).unwrap_err();

        assert_eq!(error.code, "game_mode_backup_stale");
        let convo = state.storage.get("chats", "convo-1").unwrap().unwrap();
        assert_eq!(convo["connectedChatId"], "game-1");
        assert!(state.storage.get("chats", "game-1").unwrap().is_some());
    }

    #[test]
    fn a_file_changed_after_the_backup_is_kept() {
        let dir = std::env::temp_dir().join(format!(
            "marinara-game-removal-digest-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let same = dir.join("same.png");
        let changed = dir.join("changed.png");
        fs::write(&same, b"aaaa").unwrap();
        fs::write(&changed, b"bbbb").unwrap();
        let files = vec![
            BackedUpFile {
                path: same.clone(),
                digest: file_digest(&same).unwrap(),
            },
            BackedUpFile {
                path: changed.clone(),
                digest: file_digest(&changed).unwrap(),
            },
        ];
        fs::write(&changed, b"cccc").unwrap();

        remove_backed_up_files(&files, &HashSet::new());

        assert!(!same.exists(), "an unchanged backed-up file is removed");
        assert!(
            changed.exists(),
            "a file with new bytes of the same size is kept"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_another_record_still_uses_is_kept() {
        let dir = std::env::temp_dir().join(format!(
            "marinara-game-removal-shared-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let shared = dir.join("shared.png");
        fs::write(&shared, b"aaaa").unwrap();
        let files = vec![BackedUpFile {
            path: shared.clone(),
            digest: file_digest(&shared).unwrap(),
        }];
        let in_use = HashSet::from([fs::canonicalize(&shared).unwrap()]);

        remove_backed_up_files(&files, &in_use);

        assert!(shared.exists(), "a file a surviving record points at stays");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn removal_refuses_when_a_planned_game_chat_changed_mode() {
        let state = test_state("game-chat-changed-mode");
        seed(&state);
        let plan = RemovalPlan::load(&state.storage).unwrap();
        state
            .storage
            .patch("chats", "game-1", json!({ "mode": "roleplay" }))
            .unwrap();

        let error = retire_game_rows(&state.storage, &plan).unwrap_err();

        assert_eq!(error.code, "game_mode_backup_stale");
        assert!(state.storage.get("messages", "m-game").unwrap().is_some());
    }

    #[test]
    fn second_run_is_a_no_op() {
        let state = test_state("second-run");
        seed(&state);
        remove_game_mode_data(&state)
            .unwrap()
            .expect("first run backs up");

        assert!(remove_game_mode_data(&state).unwrap().is_none());
        let backups = fs::read_dir(state.data_dir.join("backups"))
            .unwrap()
            .count();
        assert_eq!(backups, 1);
        assert!(state.storage.get("chats", "rp-1").unwrap().is_some());
    }

    #[test]
    fn removal_clears_every_row_a_game_chat_owns_and_unlinks_partners() {
        let state = test_state("owned-rows");
        seed(&state);
        let storage = &state.storage;
        storage
            .create(
                "chats",
                json!({
                    "id": "convo-1",
                    "name": "OOC",
                    "mode": "conversation",
                    "characterIds": [],
                    "connectedChatId": "game-1",
                    "notes": [
                        { "id": "n-game", "type": "note", "sourceChatId": "convo-1", "targetChatId": "game-1", "content": "x" },
                        { "id": "n-keep", "type": "note", "sourceChatId": "convo-1", "targetChatId": "rp-1", "content": "y" }
                    ]
                }),
            )
            .unwrap();
        storage
            .create(
                "message-swipes",
                json!({ "id": "m-game::swipe::0", "messageId": "m-game" }),
            )
            .unwrap();
        storage
            .create(
                "game-state-snapshots",
                json!({ "id": "s-game", "chatId": "game-1", "messageId": "m-game" }),
            )
            .unwrap();
        storage
            .create(
                "agent-runs",
                json!({ "id": "run-game", "chatId": "game-1" }),
            )
            .unwrap();
        storage
            .create("background-jobs", json!({ "id": "job-game", "target": { "scope": { "kind": "chat", "id": "game-1" } } }))
            .unwrap();
        storage
            .create(
                "background-jobs",
                json!({ "id": "job-rp", "chatId": "rp-1" }),
            )
            .unwrap();
        storage
            .create(
                "story-consolidation-jobs",
                json!({ "id": "story-game", "ownerChatId": "game-1", "status": "pending" }),
            )
            .unwrap();
        storage
            .create(
                "story-consolidation-jobs",
                json!({ "id": "story-rp", "ownerChatId": "rp-1", "status": "pending" }),
            )
            .unwrap();

        let backup = remove_game_mode_data(&state).unwrap().expect("backup");
        let records: Value =
            serde_json::from_slice(&fs::read(backup.join(BACKUP_RECORDS_FILE)).unwrap()).unwrap();
        let removed = &records["removedRows"];
        for (collection, id) in [
            ("message-swipes", "m-game::swipe::0"),
            ("game-state-snapshots", "s-game"),
            ("agent-runs", "run-game"),
            ("background-jobs", "job-game"),
            ("story-consolidation-jobs", "story-game"),
        ] {
            assert!(
                removed[collection]
                    .as_array()
                    .is_some_and(|rows| rows.iter().any(|row| row["id"] == id)),
                "backup holds {collection}/{id}"
            );
        }
        assert_eq!(records["editedChats"][0]["id"], "convo-1");
        assert_eq!(records["editedChats"][0]["connectedChatId"], "game-1");
        assert!(storage
            .get("story-consolidation-jobs", "story-game")
            .unwrap()
            .is_none());
        assert!(storage
            .get("story-consolidation-jobs", "story-rp")
            .unwrap()
            .is_some());

        let convo = storage.get("chats", "convo-1").unwrap().unwrap();
        assert!(convo["connectedChatId"].is_null());
        let notes = convo["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0]["id"], "n-keep");
        assert!(storage
            .get("message-swipes", "m-game::swipe::0")
            .unwrap()
            .is_none());
        assert!(storage
            .get("game-state-snapshots", "s-game")
            .unwrap()
            .is_none());
        assert!(storage.get("agent-runs", "run-game").unwrap().is_none());
        assert!(storage
            .get("background-jobs", "job-game")
            .unwrap()
            .is_none());
        assert!(storage.get("background-jobs", "job-rp").unwrap().is_some());
        assert!(storage.get("gallery", "g-1").unwrap().is_none());
        assert!(
            !state
                .data_dir
                .join("gallery")
                .join("game-1-lio.png")
                .exists(),
            "backed-up gallery files are removed after the records are gone"
        );
        assert!(!state
            .data_dir
            .join("avatars")
            .join("npc")
            .join("game-1-lio.png")
            .exists());
    }

    #[test]
    fn profile_import_skips_game_chats_and_their_rows() {
        let mut replacements: Vec<(&'static str, Vec<Value>)> = vec![
            (
                "chats",
                vec![
                    json!({ "id": "game-1", "mode": "game" }),
                    json!({ "id": "rp-1", "mode": "roleplay" }),
                ],
            ),
            (
                "messages",
                vec![
                    json!({ "id": "m-game", "chatId": "game-1" }),
                    json!({ "id": "m-rp", "chatId": "rp-1" }),
                ],
            ),
            (
                "message-swipes",
                vec![
                    json!({ "id": "m-game::swipe::0", "messageId": "m-game" }),
                    json!({ "id": "m-rp::swipe::0", "messageId": "m-rp" }),
                ],
            ),
            (
                "game-state-snapshots",
                vec![json!({ "id": "s-game", "chatId": "game-1" })],
            ),
            (
                "chat-presets",
                vec![
                    json!({ "id": "p-game", "mode": "game" }),
                    json!({ "id": "p-rp", "mode": "roleplay" }),
                ],
            ),
            ("lorebooks", vec![json!({ "id": "lb", "category": "game" })]),
        ];
        let mut imported = serde_json::Map::new();
        for (name, rows) in &replacements {
            imported.insert((*name).to_string(), json!(rows.len()));
        }

        assert_eq!(
            drop_game_mode_rows_from_profile_import(&mut replacements, &mut imported),
            1
        );

        let ids = |name: &str| -> Vec<String> {
            replacements
                .iter()
                .find(|(collection, _)| *collection == name)
                .map(|(_, rows)| rows.iter().filter_map(row_id).collect())
                .unwrap_or_default()
        };
        assert_eq!(ids("chats"), vec!["rp-1"]);
        assert_eq!(ids("messages"), vec!["m-rp"]);
        assert_eq!(ids("message-swipes"), vec!["m-rp::swipe::0"]);
        assert!(ids("game-state-snapshots").is_empty());
        assert_eq!(ids("chat-presets"), vec!["p-rp"]);
        let lorebooks = &replacements
            .iter()
            .find(|(name, _)| *name == "lorebooks")
            .unwrap()
            .1;
        assert_eq!(lorebooks[0]["category"], "world");
        assert_eq!(imported["chats"], 1);
        assert_eq!(imported["messages"], 1);
        assert_eq!(imported["skippedGameChats"], 1);
    }

    #[test]
    fn single_game_chat_import_becomes_roleplay() {
        let mut chat = serde_json::Map::new();
        chat.insert("mode".to_string(), json!("game"));
        retire_game_chat_mode(&mut chat);
        assert_eq!(chat["mode"], "roleplay");
    }

    #[test]
    fn writes_no_backup_when_there_is_no_game_data() {
        let state = test_state("no-game");
        state
            .storage
            .create(
                "chats",
                json!({ "id": "rp-1", "name": "Scene", "mode": "roleplay", "characterIds": [] }),
            )
            .unwrap();

        assert!(remove_game_mode_data(&state).unwrap().is_none());
        assert!(state.storage.get("chats", "rp-1").unwrap().is_some());
    }
}
