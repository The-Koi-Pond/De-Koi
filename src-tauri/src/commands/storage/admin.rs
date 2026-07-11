use super::shared::*;
use super::*;

pub(crate) fn admin_clear_all(state: &AppState, body: Value) -> AppResult<Value> {
    if body.get("confirm").and_then(Value::as_bool) != Some(true) {
        return Err(AppError::invalid_input("confirm must be true"));
    }
    // Snapshot gallery file refs, clear all rows first, then delete the files so a
    // failed clear can't leave live rows pointing at deleted assets.
    let mut gallery_files = Vec::new();
    for collection in GALLERY_FILE_COLLECTIONS {
        gallery_files.extend(gallery_file_rows_snapshot(state, collection)?);
    }
    state.storage.clear_all()?;
    remove_gallery_files_from_snapshot(state, &gallery_files);
    clear_runtime_media(state)?;
    clear_full_wipe_only_data(state)?;
    Ok(json!({ "success": true, "cleared": "all" }))
}

pub(crate) fn admin_expunge(state: &AppState, body: Value) -> AppResult<Value> {
    if body.get("confirm").and_then(Value::as_bool) != Some(true) {
        return Err(AppError::invalid_input("confirm must be true"));
    }
    let scopes = string_array_from_value(body.get("scopes"));
    if scopes.is_empty() {
        return Err(AppError::invalid_input(
            "At least one expunge scope is required",
        ));
    }
    let mut cleared_collections = Vec::new();
    for scope in scopes {
        match scope.as_str() {
            "chats" => clear_collections(
                state,
                &[
                    "chats",
                    "chat-folders",
                    "messages",
                    "message-swipes",
                    "gallery",
                    "agent-runs",
                    "agent-memory",
                    "memory-capture-jobs",
                    "game-checkpoints",
                    "game-state-snapshots",
                ],
                &mut cleared_collections,
            )?,
            "characters" => {
                let characters = state.storage.list("characters")?;
                let versions = state.storage.list("character-versions")?;
                clear_collections(
                    state,
                    &[
                        "characters",
                        "character-groups",
                        "character-versions",
                        "character-gallery",
                        "sprites",
                    ],
                    &mut cleared_collections,
                )?;
                for record in characters {
                    avatars::remove_character_avatar_file_if_unreferenced(state, &record);
                    if let Some(id) = record.get("id").and_then(Value::as_str) {
                        sprites::remove_owned_sprite_dir(
                            state,
                            sprites::SpriteOwnerKind::Character,
                            id,
                        );
                    }
                }
                for record in versions {
                    characters::remove_character_version_avatar_file(state, &record);
                }
            }
            "personas" => {
                let personas = state.storage.list("personas")?;
                clear_collections(
                    state,
                    &["personas", "persona-groups", "persona-gallery"],
                    &mut cleared_collections,
                )?;
                for record in personas {
                    avatars::remove_avatar_file_preserving_persona_snapshots(
                        state,
                        "personas",
                        &record,
                    );
                    if let Some(id) = record.get("id").and_then(Value::as_str) {
                        sprites::remove_owned_sprite_dir(
                            state,
                            sprites::SpriteOwnerKind::Persona,
                            id,
                        );
                    }
                }
            }
            "lorebooks" => {
                let lorebooks = state.storage.list("lorebooks")?;
                clear_collections(
                    state,
                    &[
                        "lorebooks",
                        "lorebook-library-folders",
                        "lorebook-entries",
                        "lorebook-folders",
                    ],
                    &mut cleared_collections,
                )?;
                for record in lorebooks {
                    lorebook_images::remove_lorebook_image_file(state, &record);
                }
            }
            "presets" => clear_collections(
                state,
                &[
                    "prompts",
                    "preset-folders",
                    "prompt-groups",
                    "prompt-sections",
                    "prompt-variables",
                    "chat-presets",
                ],
                &mut cleared_collections,
            )?,
            "connections" => {
                let connections = state.storage.list("connections")?;
                clear_collections(
                    state,
                    &["connections", "connection-folders"],
                    &mut cleared_collections,
                )?;
                for record in connections {
                    entity_images::remove_entity_image_file(state, "connections", &record);
                }
            }
            "automation" => {
                let agents = state.storage.list("agents")?;
                clear_collections(
                    state,
                    &[
                        "agents",
                        "custom-tools",
                        "regex-scripts",
                        "themes",
                        "extensions",
                    ],
                    &mut cleared_collections,
                )?;
                for record in agents {
                    entity_images::remove_entity_image_file(state, "agents", &record);
                }
            }
            "media" => {
                clear_collections(
                    state,
                    &[
                        "gallery",
                        "character-gallery",
                        "persona-gallery",
                        "global-gallery",
                        "gallery-folders",
                        "background-metadata",
                        "sprites",
                        "knowledge-sources",
                    ],
                    &mut cleared_collections,
                )?;
                clear_runtime_media(state)?;
            }
            other => {
                return Err(AppError::invalid_input(format!(
                    "Unknown expunge scope: {other}"
                )))
            }
        }
    }
    cleared_collections.sort();
    cleared_collections.dedup();
    Ok(json!({ "success": true, "clearedCollections": cleared_collections }))
}

/// Gallery collections whose rows reference managed image files in the shared
/// `gallery` asset folder. Their files must be removed when the rows are cleared,
/// or expunge/clear-all leaves orphaned files behind. Per-row removal (rather
/// than nuking the whole folder) is what lets a per-scope expunge, for example
/// "personas", drop only its own gallery's files without touching the others.
const GALLERY_FILE_COLLECTIONS: &[&str] = &[
    "gallery",
    "character-gallery",
    "persona-gallery",
    "global-gallery",
];

/// Snapshot a gallery collection's rows so their files can be deleted AFTER the
/// rows are cleared. Returns empty for non-gallery collections.
fn gallery_file_rows_snapshot(state: &AppState, collection: &str) -> AppResult<Vec<Value>> {
    if !GALLERY_FILE_COLLECTIONS.contains(&collection) {
        return Ok(Vec::new());
    }
    state.storage.list(collection)
}

fn remove_gallery_files_from_snapshot(state: &AppState, rows: &[Value]) {
    for row in rows {
        media_uploads::remove_managed_record_file(state, "gallery", row, "filePath", "filename");
    }
}

fn clear_collections(
    state: &AppState,
    collections: &[&str],
    cleared: &mut Vec<String>,
) -> AppResult<()> {
    for collection in collections {
        // Snapshot file refs, clear the ROWS first, then delete the files. If the
        // row clear fails, the rows still point at intact files (no broken refs);
        // a later file-removal hiccup only orphans files, the lesser evil.
        let files = gallery_file_rows_snapshot(state, collection)?;
        state.storage.replace_all(collection, Vec::new())?;
        remove_gallery_files_from_snapshot(state, &files);
        cleared.push((*collection).to_string());
    }
    Ok(())
}

fn clear_runtime_media(state: &AppState) -> AppResult<()> {
    for path in [
        state.data_dir.join("avatars"),
        state.data_dir.join("fonts"),
        state.data_dir.join("knowledge-sources"),
        state.data_dir.join("sprites"),
        state.game_assets.root().to_path_buf(),
        state.backgrounds.root().to_path_buf(),
    ] {
        if path.exists() {
            fs::remove_dir_all(&path)?;
        }
        fs::create_dir_all(&path)?;
    }
    Ok(())
}

fn clear_full_wipe_only_data(state: &AppState) -> AppResult<()> {
    for relative in [
        "backups",
        ".backup-downloads",
        ".profile-export-downloads",
        "secrets",
        ".avatar-thumbnails",
        ".managed-thumbnails",
        "entity-images",
        "gallery",
        "lorebooks/images",
    ] {
        let path = state.data_dir.join(relative);
        if path.exists() {
            fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-admin-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp admin dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn seed_character(state: &AppState, id: &str) {
        state
            .storage
            .upsert_with_id(
                "characters",
                id,
                json!({
                    "id": id,
                    "name": "Seed Character"
                }),
            )
            .expect("character should write");
    }

    fn character_exists(state: &AppState, id: &str) -> bool {
        state
            .storage
            .get("characters", id)
            .expect("characters should be readable")
            .is_some()
    }

    #[test]
    fn admin_clear_all_rejects_missing_confirmation_without_clearing_storage() {
        let state = test_state("clear-all-missing-confirm");
        seed_character(&state, "character-1");

        let error = admin_clear_all(&state, json!({}))
            .expect_err("clear all should reject missing confirmation");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("confirm must be true"));
        assert!(character_exists(&state, "character-1"));
    }

    #[test]
    fn admin_clear_all_rejects_false_confirmation_without_clearing_storage() {
        let state = test_state("clear-all-false-confirm");
        seed_character(&state, "character-1");

        let error = admin_clear_all(&state, json!({ "confirm": false }))
            .expect_err("clear all should reject false confirmation");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("confirm must be true"));
        assert!(character_exists(&state, "character-1"));
    }

    #[test]
    fn admin_clear_all_clears_storage_when_confirmed() {
        let state = test_state("clear-all-confirmed");
        seed_character(&state, "character-1");

        let result =
            admin_clear_all(&state, json!({ "confirm": true })).expect("clear all should succeed");

        assert_eq!(result["success"], true);
        assert_eq!(result["cleared"], "all");
        assert!(!character_exists(&state, "character-1"));
    }

    #[test]
    fn admin_clear_all_removes_every_de_koi_managed_user_data_copy() {
        let state = test_state("clear-all-managed-data");
        seed_character(&state, "character-1");

        let managed_files = [
            "backups/marinara-backup-test/.de-koi-backup-complete",
            ".backup-downloads/staging/archive.zip",
            ".profile-export-downloads/staging/profile.zip",
            "secrets/connection-master.key",
            ".avatar-thumbnails/128/characters/avatar.png",
            ".managed-thumbnails/128/gallery/image.png",
            "entity-images/agents/agent.png",
            "gallery/image.png",
            "lorebooks/images/entry.png",
        ];
        for relative in managed_files {
            let path = state.data_dir.join(relative);
            std::fs::create_dir_all(path.parent().expect("managed file should have a parent"))
                .expect("managed parent should be created");
            std::fs::write(&path, b"private data").expect("managed test file should be written");
        }

        admin_clear_all(&state, json!({ "confirm": true }))
            .expect("confirmed clear all should succeed");

        assert!(!character_exists(&state, "character-1"));
        for relative in managed_files {
            assert!(
                !state.data_dir.join(relative).exists(),
                "full wipe should remove {relative}"
            );
        }
    }

    #[test]
    fn admin_expunge_connections_clears_connection_folders() {
        let state = test_state("connection-folders");
        state
            .storage
            .upsert_with_id(
                "connection-folders",
                "folder-1",
                json!({
                    "id": "folder-1",
                    "name": "Providers",
                    "color": "#38bdf8",
                    "sortOrder": 1,
                    "collapsed": false
                }),
            )
            .expect("connection folder should write");
        state
            .storage
            .upsert_with_id(
                "connections",
                "conn-1",
                json!({
                    "id": "conn-1",
                    "name": "Provider",
                    "provider": "openai",
                    "model": "gpt-4.1",
                    "folderId": "folder-1"
                }),
            )
            .expect("connection should write");

        let result = admin_expunge(
            &state,
            json!({ "confirm": true, "scopes": ["connections"] }),
        )
        .expect("connection expunge should succeed");

        assert_eq!(
            result["clearedCollections"],
            json!(["connection-folders", "connections"])
        );
        assert!(state
            .storage
            .list("connection-folders")
            .expect("connection folders should be readable")
            .is_empty());
        assert!(state
            .storage
            .list("connections")
            .expect("connections should be readable")
            .is_empty());
    }

    #[test]
    fn admin_expunge_characters_removes_owned_avatar_and_sprite_files() {
        let state = test_state("character-owned-files");
        let avatar = state.data_dir.join("avatars/characters/character-1.png");
        let sprite = state.data_dir.join("sprites/character-1/happy.png");
        for path in [&avatar, &sprite] {
            std::fs::create_dir_all(path.parent().expect("owned file should have a parent"))
                .expect("owned file parent should be created");
            std::fs::write(path, b"private image").expect("owned test file should be written");
        }
        state
            .storage
            .upsert_with_id(
                "characters",
                "character-1",
                json!({
                    "id": "character-1",
                    "name": "Private Character",
                    "avatarFilename": "character-1.png",
                    "avatarFilePath": avatar.to_string_lossy()
                }),
            )
            .expect("character should write");

        admin_expunge(&state, json!({ "confirm": true, "scopes": ["characters"] }))
            .expect("character expunge should succeed");

        assert!(!avatar.exists(), "character avatar should be removed");
        assert!(!sprite.exists(), "character sprite should be removed");
    }

    #[test]
    fn admin_expunge_connections_removes_owned_entity_image_files() {
        let state = test_state("connection-owned-files");
        let image = state.data_dir.join("entity-images/connections/connection-1.png");
        std::fs::create_dir_all(image.parent().expect("entity image should have a parent"))
            .expect("entity image parent should be created");
        std::fs::write(&image, b"private image").expect("entity image should be written");
        state
            .storage
            .upsert_with_id(
                "connections",
                "connection-1",
                json!({
                    "id": "connection-1",
                    "name": "Private Provider",
                    "imageFilename": "connection-1.png",
                    "imageFilePath": image.to_string_lossy()
                }),
            )
            .expect("connection should write");

        admin_expunge(&state, json!({ "confirm": true, "scopes": ["connections"] }))
            .expect("connection expunge should succeed");

        assert!(!image.exists(), "connection image should be removed");
    }

    #[test]
    fn admin_expunge_chats_clears_chat_runtime_collections_without_knowledge_sources() {
        let state = test_state("chat-runtime-scope");
        for (collection, id) in [
            ("chats", "chat-1"),
            ("chat-folders", "folder-1"),
            ("messages", "message-1"),
            ("message-swipes", "swipe-1"),
            ("gallery", "gallery-1"),
            ("agent-runs", "run-1"),
            ("agent-memory", "memory-1"),
            ("memory-capture-jobs", "memory-job-1"),
            ("game-checkpoints", "checkpoint-1"),
            ("game-state-snapshots", "snapshot-1"),
            ("knowledge-sources", "knowledge-1"),
        ] {
            state
                .storage
                .upsert_with_id(
                    collection,
                    id,
                    json!({ "id": id, "chatId": "chat-1", "name": collection }),
                )
                .expect("seed row should write");
        }

        let result = admin_expunge(&state, json!({ "confirm": true, "scopes": ["chats"] }))
            .expect("chat expunge should succeed");

        assert_eq!(
            result["clearedCollections"],
            json!([
                "agent-memory",
                "agent-runs",
                "chat-folders",
                "chats",
                "gallery",
                "game-checkpoints",
                "game-state-snapshots",
                "memory-capture-jobs",
                "message-swipes",
                "messages"
            ])
        );
        for collection in [
            "chats",
            "chat-folders",
            "messages",
            "message-swipes",
            "gallery",
            "agent-runs",
            "agent-memory",
            "memory-capture-jobs",
            "game-checkpoints",
            "game-state-snapshots",
        ] {
            assert!(
                state
                    .storage
                    .list(collection)
                    .expect("cleared collection should be readable")
                    .is_empty(),
                "{collection} should be cleared"
            );
        }
        assert_eq!(
            state
                .storage
                .list("knowledge-sources")
                .expect("knowledge sources should be readable")
                .len(),
            1
        );
    }
}
