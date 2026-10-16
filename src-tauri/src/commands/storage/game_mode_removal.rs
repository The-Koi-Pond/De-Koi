//! One-time removal of data owned by the retired Game mode.
//!
//! Every record removed here is first written, with the gallery images and NPC
//! portraits it points at, to `backups/removed-game-mode-<timestamp>/` so nothing
//! is lost silently. Deletion then goes through one atomic write for the small
//! collections and the normal chat delete cascade for chats.

use super::backgrounds::import_background_file;
use super::chats::{delete_chats_with_messages, messages_for_chat};
use super::media_uploads::managed_record_file_path;
use crate::state::AppState;
use marinara_core::{now_iso, now_millis, AppError, AppResult};
use marinara_storage::FileStorage;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
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

fn rows_for_chats(
    state: &AppState,
    collection: &str,
    chat_ids: &HashSet<String>,
) -> AppResult<Vec<Value>> {
    Ok(state
        .storage
        .list(collection)?
        .into_iter()
        .filter(|row| chat_ids.contains(row_str(row, "chatId")))
        .collect())
}

fn canonical(path: &Path) -> AppResult<PathBuf> {
    Ok(fs::canonicalize(path)?)
}

/// Copies `source` into the staged backup at its path relative to the data folder, so two
/// files with the same name in different folders can never overwrite each other. Returns
/// that relative path.
fn backup_file(data_dir: &Path, staging: &Path, source: &Path) -> AppResult<String> {
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
    if fs::metadata(&target)?.len() != fs::metadata(&source)?.len() {
        return Err(AppError::new(
            "game_mode_backup_failed",
            format!("backup copy of {} is incomplete", source.display()),
        ));
    }
    Ok(relative.to_string_lossy().replace('\\', "/"))
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

struct GameModeData {
    chats: Vec<Value>,
    chat_ids: Vec<String>,
    checkpoints: Vec<Value>,
    presets: Vec<Value>,
    retired_category_lorebooks: usize,
}

impl GameModeData {
    fn load(state: &AppState) -> AppResult<Self> {
        let chats: Vec<Value> = state
            .storage
            .list("chats")?
            .into_iter()
            .filter(is_game_row)
            .collect();
        let chat_ids = chats.iter().filter_map(row_id).collect();
        Ok(Self {
            chats,
            chat_ids,
            checkpoints: state.storage.list(GAME_CHECKPOINTS_COLLECTION)?,
            presets: state
                .storage
                .list("chat-presets")?
                .into_iter()
                .filter(is_game_row)
                .collect(),
            retired_category_lorebooks: state
                .storage
                .list("lorebooks")?
                .iter()
                .filter(|row| row_str(row, "category") == RETIRED_LOREBOOK_CATEGORY)
                .count(),
        })
    }

    fn needs_backup(&self) -> bool {
        !self.chats.is_empty() || !self.checkpoints.is_empty() || !self.presets.is_empty()
    }
}

/// Writes every record about to be deleted, plus the files those records point at, into a
/// staging folder, then publishes it with one rename. A failure anywhere leaves no
/// published backup and nothing deleted.
fn write_backup(state: &AppState, data: &GameModeData) -> AppResult<PathBuf> {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S");
    let name = format!("removed-game-mode-{timestamp}-{}", now_millis());
    let backups = state.data_dir.join("backups");
    let staging = backups.join(format!(".staging-{name}"));
    let published = backups.join(&name);
    let result = (|| -> AppResult<()> {
        fs::create_dir_all(&staging)?;
        let data_dir = canonical(&state.data_dir)?;
        let chat_id_set: HashSet<String> = data.chat_ids.iter().cloned().collect();
        let mut messages = serde_json::Map::new();
        for chat_id in &data.chat_ids {
            messages.insert(
                chat_id.clone(),
                Value::Array(messages_for_chat(state, chat_id)?),
            );
        }
        let gallery = rows_for_chats(state, "gallery", &chat_id_set)?;
        let mut files = Vec::new();
        let mut missing_files = Vec::new();
        for row in &gallery {
            let record = format!("gallery:{}", row_id(row).unwrap_or_default());
            match managed_record_file_path(state, "gallery", row, "filePath", "filename")? {
                Some(path) if path.is_file() => {
                    let relative = backup_file(&data_dir, &staging, &path)?;
                    files.push(json!({ "record": record, "path": relative }));
                }
                Some(path) => missing_files.push(json!({
                    "record": record,
                    "path": path.to_string_lossy(),
                })),
                None => missing_files.push(json!({ "record": record, "path": Value::Null })),
            }
        }
        for path in npc_avatar_files_for_chats(state, &chat_id_set)? {
            let relative = backup_file(&data_dir, &staging, &path)?;
            files.push(json!({ "record": "npc-avatar", "path": relative }));
        }
        let records = json!({
            "removedAt": now_iso(),
            "reason": "Game mode was removed from De-Koi. These records were deleted after this backup was written.",
            "filesFolder": BACKUP_FILES_DIR,
            "files": files,
            "missingFiles": missing_files,
            "chats": data.chats,
            "messages": messages,
            "trackerSnapshots": rows_for_chats(state, "game-state-snapshots", &chat_id_set)?,
            "gallery": gallery,
            "gameCheckpoints": data.checkpoints,
            "chatPresets": data.presets,
        });
        fs::write(
            staging.join(BACKUP_RECORDS_FILE),
            serde_json::to_vec_pretty(&records)?,
        )?;
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
    Ok(published)
}

/// Removes Game checkpoints and Game chat-settings presets and moves lorebooks out of the
/// retired Game category in one atomic write.
fn retire_game_rows(storage: &FileStorage) -> AppResult<()> {
    storage.update_collections_atomically(
        vec![GAME_CHECKPOINTS_COLLECTION, "chat-presets", "lorebooks"],
        |collections| {
            let [checkpoints, presets, lorebooks] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Game mode removal expected checkpoints, presets, and lorebooks",
                ));
            };
            checkpoints.rows_mut().clear();
            presets.rows_mut().retain(|row| !is_game_row(row));
            let updated_at = now_iso();
            for row in lorebooks.rows_mut() {
                if row_str(row, "category") != RETIRED_LOREBOOK_CATEGORY {
                    continue;
                }
                if let Some(object) = row.as_object_mut() {
                    object.insert("category".to_string(), json!(REPLACEMENT_LOREBOOK_CATEGORY));
                    object.insert("updatedAt".to_string(), json!(updated_at));
                }
            }
            Ok(())
        },
    )
}

/// Backs up, then deletes, Game chats, Game checkpoints, and Game chat-settings presets,
/// and moves lorebooks out of the retired Game category. Returns the published backup
/// folder when anything was removed.
///
/// Retry safety: nothing is deleted until a complete backup of everything still present is
/// published. If a later step fails, startup runs this again; that run backs up whatever
/// Game data is left before deleting it, so every removed record is in some backup.
pub(crate) fn remove_game_mode_data(state: &AppState) -> AppResult<Option<PathBuf>> {
    let data = GameModeData::load(state)?;
    if !data.needs_backup() && data.retired_category_lorebooks == 0 {
        return Ok(None);
    }
    let backup = if data.needs_backup() {
        Some(write_backup(state, &data)?)
    } else {
        None
    };
    retire_game_rows(&state.storage)?;
    if !data.chat_ids.is_empty() {
        delete_chats_with_messages(state, &data.chat_ids)?;
    }
    if let Some(dir) = &backup {
        log::info!(
            "removed Game mode data: chats={} backup={}",
            data.chat_ids.len(),
            dir.display()
        );
    }
    Ok(backup)
}

const GAME_ASSETS_DIR: &str = "game-assets";
/// How chat metadata pointed at a background inside the old Game asset library.
const GAME_ASSET_BACKGROUND_PREFIX: &str = "gameAsset:";
/// The Game asset library listed the user's own backgrounds under this folder name.
const USER_BACKGROUND_IN_GAME_LIBRARY: &str = "__user_bg__/";

fn image_files_under(dir: &Path) -> AppResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let path = entry?.path();
        if path.is_dir() {
            files.extend(image_files_under(&path)?);
        } else if path.is_file() && is_background_image(&path) {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn is_background_image(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|ext| matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif"))
}

/// A `gameAsset:` path from chat metadata, resolved inside the old library folder or the
/// bundled Game assets. Paths that try to leave those folders resolve to nothing.
fn game_asset_source(state: &AppState, library: &Path, path: &str) -> Option<PathBuf> {
    let relative = Path::new(path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return None;
    }
    std::iter::once(library.to_path_buf())
        .chain(
            state
                .default_data_roots
                .iter()
                .map(|root| root.join(GAME_ASSETS_DIR)),
        )
        .map(|root| root.join(relative))
        .find(|candidate| candidate.is_file() && is_background_image(candidate))
}

fn chat_metadata_object(row: &Value) -> Option<serde_json::Map<String, Value>> {
    match row.get("metadata") {
        Some(Value::Object(object)) => Some(object.clone()),
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|value| value.as_object().cloned()),
        _ => None,
    }
}

/// Retires the old Game asset library. Images the user put in its backgrounds folder are
/// copied into the background library, chats that used a Game asset background are pointed
/// at the matching background (or cleared when none exists), and the library folder is moved
/// into `backups/` rather than deleted. Returns where the folder was moved.
pub(crate) fn retire_game_asset_library(state: &AppState) -> AppResult<Option<PathBuf>> {
    let library = state.data_dir.join(GAME_ASSETS_DIR);
    let mut imported: HashMap<PathBuf, String> = HashMap::new();
    let mut import = |source: PathBuf| -> AppResult<String> {
        if let Some(filename) = imported.get(&source) {
            return Ok(filename.clone());
        }
        let filename = import_background_file(state, &source)?;
        imported.insert(source, filename.clone());
        Ok(filename)
    };

    for source in image_files_under(&library.join("backgrounds"))? {
        import(source)?;
    }

    let mut background_updates: HashMap<String, Value> = HashMap::new();
    for chat in state.storage.list("chats")? {
        let (Some(id), Some(metadata)) = (row_id(&chat), chat_metadata_object(&chat)) else {
            continue;
        };
        let Some(path) = metadata
            .get("background")
            .and_then(Value::as_str)
            .and_then(|value| value.trim().strip_prefix(GAME_ASSET_BACKGROUND_PREFIX))
            .map(|path| path.trim_start_matches('/').to_string())
        else {
            continue;
        };
        let next = match path.strip_prefix(USER_BACKGROUND_IN_GAME_LIBRARY) {
            Some(filename) if !filename.is_empty() => json!(filename),
            Some(_) => Value::Null,
            None => match game_asset_source(state, &library, &path) {
                Some(source) => json!(import(source)?),
                None => Value::Null,
            },
        };
        background_updates.insert(id, next);
    }
    if !background_updates.is_empty() {
        state
            .storage
            .update_collections_atomically(vec!["chats"], |collections| {
                let [chats] = collections else {
                    return Err(AppError::new(
                        "storage_error",
                        "Game asset retirement expected the chats collection",
                    ));
                };
                for row in chats.rows_mut() {
                    let Some(next) = row_id(row).and_then(|id| background_updates.get(&id)) else {
                        continue;
                    };
                    let Some(mut metadata) = chat_metadata_object(row) else {
                        continue;
                    };
                    metadata.insert("background".to_string(), next.clone());
                    if let Some(object) = row.as_object_mut() {
                        object.insert("metadata".to_string(), Value::Object(metadata));
                    }
                }
                Ok(())
            })?;
    }

    let thumbnails = state.data_dir.join(".managed-thumbnails").join("game");
    if thumbnails.exists() {
        fs::remove_dir_all(&thumbnails)?;
    }
    if !library.exists() {
        return Ok(None);
    }
    let backups = state.data_dir.join("backups");
    fs::create_dir_all(&backups)?;
    let timestamp = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S");
    let destination = backups.join(format!("removed-game-assets-{timestamp}-{}", now_millis()));
    fs::rename(&library, &destination)?;
    log::info!(
        "retired Game asset library: imported_backgrounds={} chat_backgrounds={} moved_to={}",
        imported.len(),
        background_updates.len(),
        destination.display()
    );
    Ok(Some(destination))
}

/// Collections whose rows belong to one chat through `chatId`.
const CHAT_OWNED_PROFILE_COLLECTIONS: &[&str] = &[
    "messages",
    "gallery",
    "game-state-snapshots",
    "agent-runs",
    "agent-memory",
    "memory-capture-jobs",
    "story-consolidation-jobs",
    "memory-maintenance-jobs",
    "background-jobs",
];

/// Drops Game chats, the rows they own, and Game chat-settings presets from a profile
/// restore, and moves lorebooks out of the retired Game category, so an older backup or a
/// Marinara profile cannot bring Game mode data back. Keeps `imported` counts accurate and
/// returns how many Game chats were skipped.
pub(crate) fn drop_game_mode_rows_from_profile_import(
    replacements: &mut [(&'static str, Vec<Value>)],
    imported: &mut serde_json::Map<String, Value>,
) -> usize {
    let mut game_chat_ids = HashSet::new();
    if let Some((_, chats)) = replacements.iter_mut().find(|(name, _)| *name == "chats") {
        chats.retain(|row| {
            if !is_game_row(row) {
                return true;
            }
            if let Some(id) = row_id(row) {
                game_chat_ids.insert(id);
            }
            false
        });
    }
    let game_message_ids: HashSet<String> = replacements
        .iter()
        .filter(|(name, _)| *name == "messages")
        .flat_map(|(_, rows)| rows.iter())
        .filter(|row| game_chat_ids.contains(row_str(row, "chatId")))
        .filter_map(row_id)
        .collect();
    for (collection, rows) in replacements.iter_mut() {
        let before = rows.len();
        match *collection {
            "message-swipes" if !game_chat_ids.is_empty() => rows.retain(|row| {
                !game_chat_ids.contains(row_str(row, "chatId"))
                    && !game_message_ids.contains(row_str(row, "messageId"))
            }),
            "chat-presets" => rows.retain(|row| !is_game_row(row)),
            "lorebooks" => {
                for row in rows.iter_mut() {
                    if row_str(row, "category") == RETIRED_LOREBOOK_CATEGORY {
                        if let Some(object) = row.as_object_mut() {
                            object.insert(
                                "category".to_string(),
                                json!(REPLACEMENT_LOREBOOK_CATEGORY),
                            );
                        }
                    }
                }
            }
            name if !game_chat_ids.is_empty() && CHAT_OWNED_PROFILE_COLLECTIONS.contains(&name) => {
                rows.retain(|row| !game_chat_ids.contains(row_str(row, "chatId")));
            }
            _ => {}
        }
        if (rows.len() != before || *collection == "chats") && imported.contains_key(*collection) {
            imported.insert((*collection).to_string(), json!(rows.len()));
        }
    }
    if !game_chat_ids.is_empty() {
        imported.insert("skippedGameChats".to_string(), json!(game_chat_ids.len()));
    }
    game_chat_ids.len()
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
        assert_eq!(records["chats"][0]["id"], "game-1");
        assert_eq!(
            records["messages"]["game-1"][0]["content"],
            "The GM speaks."
        );
        assert_eq!(records["gameCheckpoints"][0]["id"], "cp-1");
        assert_eq!(records["chatPresets"][0]["id"], "preset-game");
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
    fn retry_after_a_partial_run_backs_up_what_is_left() {
        let state = test_state("partial-run");
        seed(&state);
        // Simulate an earlier run that already retired the small collections before failing.
        retire_game_rows(&state.storage).unwrap();

        let dir = remove_game_mode_data(&state)
            .unwrap()
            .expect("remaining Game chats still need a backup");
        let records: Value =
            serde_json::from_slice(&fs::read(dir.join(BACKUP_RECORDS_FILE)).unwrap()).unwrap();
        assert_eq!(records["chats"][0]["id"], "game-1");
        assert!(records["gameCheckpoints"].as_array().unwrap().is_empty());
        assert!(state.storage.get("chats", "game-1").unwrap().is_none());
    }

    #[test]
    fn retiring_the_game_asset_library_keeps_backgrounds_and_moves_the_folder() {
        let state = test_state("retire-game-assets");
        let library = state.data_dir.join(GAME_ASSETS_DIR);
        let custom = library.join("backgrounds").join("custom");
        fs::create_dir_all(&custom).unwrap();
        fs::write(custom.join("mine.png"), b"my picture").unwrap();
        fs::create_dir_all(library.join("music")).unwrap();
        fs::write(library.join("music").join("theme.mp3"), b"music").unwrap();
        for (id, background) in [
            ("chat-user-bg", "gameAsset:__user_bg__/castle.jpg"),
            ("chat-custom", "gameAsset:backgrounds/custom/mine.png"),
            ("chat-missing", "gameAsset:sprites/gone.png"),
            ("chat-plain", "lake.jpg"),
        ] {
            state
                .storage
                .create(
                    "chats",
                    json!({ "id": id, "name": id, "mode": "roleplay", "characterIds": [], "metadata": { "background": background } }),
                )
                .unwrap();
        }

        let moved = retire_game_asset_library(&state)
            .unwrap()
            .expect("the old library folder should be moved into backups");

        assert!(!library.exists());
        assert!(moved.join("music").join("theme.mp3").is_file());
        let background = |id: &str| {
            state.storage.get("chats", id).unwrap().unwrap()["metadata"]["background"].clone()
        };
        assert_eq!(background("chat-user-bg"), "castle.jpg");
        let imported = background("chat-custom");
        let imported = imported
            .as_str()
            .expect("custom background should be imported");
        assert_eq!(
            fs::read(state.backgrounds.root().join(imported)).unwrap(),
            b"my picture"
        );
        assert_eq!(
            fs::read_dir(state.backgrounds.root()).unwrap().count(),
            1,
            "an image referenced by a chat and found in the folder is imported once"
        );
        assert!(background("chat-missing").is_null());
        assert_eq!(background("chat-plain"), "lake.jpg");

        assert!(retire_game_asset_library(&state).unwrap().is_none());
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
