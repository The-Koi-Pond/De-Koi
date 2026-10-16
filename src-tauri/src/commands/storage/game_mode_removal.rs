//! One-time removal of data owned by the retired Game mode.
//!
//! Every record removed here is first written, with the gallery images and NPC
//! portraits it points at, to `backups/removed-game-mode-<timestamp>/` so nothing
//! is lost silently. Deletion then goes through the normal chat delete cascade.

use super::chats::{delete_chats_with_messages, messages_for_chat};
use super::media_uploads::managed_record_file_path;
use crate::state::AppState;
use marinara_core::{now_iso, now_millis, AppResult};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const GAME_MODE: &str = "game";
const GAME_CHECKPOINTS_COLLECTION: &str = "game-checkpoints";
const BACKUP_RECORDS_FILE: &str = "removed-records.json";
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

fn copy_into(source: &Path, target_dir: &Path) -> AppResult<()> {
    let Some(name) = source.file_name() else {
        return Ok(());
    };
    fs::create_dir_all(target_dir)?;
    fs::copy(source, target_dir.join(name))?;
    Ok(())
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

fn backup_dir(state: &AppState) -> PathBuf {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S");
    state
        .data_dir
        .join("backups")
        .join(format!("removed-game-mode-{timestamp}-{}", now_millis()))
}

/// Backs up, then deletes, Game chats, Game checkpoints, and Game chat-settings presets,
/// and moves lorebooks out of the retired Game category. Returns the backup folder when
/// anything was removed.
pub(crate) fn remove_game_mode_data(state: &AppState) -> AppResult<Option<PathBuf>> {
    let game_chats: Vec<Value> = state
        .storage
        .list("chats")?
        .into_iter()
        .filter(is_game_row)
        .collect();
    let game_chat_ids: Vec<String> = game_chats.iter().filter_map(row_id).collect();
    let game_chat_id_set: HashSet<String> = game_chat_ids.iter().cloned().collect();
    let checkpoints = state.storage.list(GAME_CHECKPOINTS_COLLECTION)?;
    let game_presets: Vec<Value> = state
        .storage
        .list("chat-presets")?
        .into_iter()
        .filter(is_game_row)
        .collect();
    let game_category_lorebook_ids: Vec<String> = state
        .storage
        .list("lorebooks")?
        .iter()
        .filter(|row| row_str(row, "category") == RETIRED_LOREBOOK_CATEGORY)
        .filter_map(row_id)
        .collect();

    let mut backup = None;
    if !game_chats.is_empty() || !checkpoints.is_empty() || !game_presets.is_empty() {
        let dir = backup_dir(state);
        fs::create_dir_all(&dir)?;

        let mut messages = serde_json::Map::new();
        for chat_id in &game_chat_ids {
            messages.insert(
                chat_id.clone(),
                Value::Array(messages_for_chat(state, chat_id)?),
            );
        }
        let gallery = rows_for_chats(state, "gallery", &game_chat_id_set)?;
        for row in &gallery {
            if let Some(path) =
                managed_record_file_path(state, "gallery", row, "filePath", "filename")?
            {
                if path.is_file() {
                    copy_into(&path, &dir.join("gallery"))?;
                }
            }
        }
        for path in npc_avatar_files_for_chats(state, &game_chat_id_set)? {
            copy_into(&path, &dir.join("avatars").join("npc"))?;
        }
        let records = json!({
            "removedAt": now_iso(),
            "reason": "Game mode was removed from De-Koi. These records were deleted after this backup was written.",
            "chats": game_chats,
            "messages": messages,
            "trackerSnapshots": rows_for_chats(state, "game-state-snapshots", &game_chat_id_set)?,
            "gallery": gallery,
            "gameCheckpoints": checkpoints,
            "chatPresets": game_presets,
        });
        fs::write(
            dir.join(BACKUP_RECORDS_FILE),
            serde_json::to_vec_pretty(&records)?,
        )?;
        backup = Some(dir);
    }

    if !game_chat_ids.is_empty() {
        delete_chats_with_messages(state, &game_chat_ids)?;
    }
    state
        .storage
        .delete_where_matching(GAME_CHECKPOINTS_COLLECTION, |_| true)?;
    state
        .storage
        .delete_where_matching("chat-presets", is_game_row)?;
    for lorebook_id in game_category_lorebook_ids {
        state.storage.patch(
            "lorebooks",
            &lorebook_id,
            json!({ "category": REPLACEMENT_LOREBOOK_CATEGORY }),
        )?;
    }

    if let Some(dir) = &backup {
        log::info!(
            "removed Game mode data: chats={} backup={}",
            game_chat_ids.len(),
            dir.display()
        );
    }
    Ok(backup)
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
        if rows.len() != before || *collection == "chats" {
            if imported.contains_key(*collection) {
                imported.insert((*collection).to_string(), json!(rows.len()));
            }
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
            b"png",
        )
        .unwrap();
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
        assert!(dir
            .join("avatars")
            .join("npc")
            .join("game-1-lio.png")
            .is_file());

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
