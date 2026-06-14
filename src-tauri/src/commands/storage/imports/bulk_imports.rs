use super::*;

#[path = "bulk_backgrounds.rs"]
mod backgrounds;
#[path = "bulk_chat.rs"]
mod chat;
#[path = "bulk_personas.rs"]
mod personas;
#[path = "bulk_progress.rs"]
mod progress;
#[path = "bulk_runner.rs"]
mod runner;
#[path = "bulk_scan.rs"]
mod scan;

pub(crate) use chat::imported_jsonl_message_role;
pub(super) use chat::{import_st_chat, import_st_chat_into_group};
pub(super) use runner::{run_st_bulk_import, run_st_bulk_import_channel};
pub(super) use scan::scan_st_folder;

#[cfg(test)]
use chat::{character_lookup_from_state, import_st_chat_text, StChatImportContext};
#[cfg(test)]
use chrono::{DateTime, Utc};
#[cfg(test)]
use personas::import_persona_avatar_file;
#[cfg(test)]
use runner::run_st_bulk_import_inner;

fn bool_option(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::Number(value)) => value.as_i64().map(|value| value != 0),
        Some(Value::String(raw)) => match raw.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "y" | "on" => Some(true),
            "false" | "0" | "no" | "n" | "off" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn non_empty_string(values: Vec<Option<&Value>>) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn normalized_st_lookup_key(value: &str) -> String {
    let file_stemmed = Path::new(value)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(value);
    file_stemmed
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn push_unique_string(values: &mut Vec<String>, value: impl Into<String>) {
    let value = value.into();
    if !value.trim().is_empty() && !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use base64::engine::general_purpose;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    const TINY_PNG: &str =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    fn temp_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        home_dir().join(".marinara-test-temp").join(format!(
            "marinara-st-bulk-import-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn write_json(path: &Path, value: &Value) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(
            path,
            serde_json::to_vec(value).expect("fixture JSON should serialize"),
        )
        .expect("fixture JSON should be written");
    }

    fn write_bytes(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent should be created");
        }
        fs::write(path, bytes).expect("fixture file should be written");
    }

    #[cfg(unix)]
    fn symlink_file_fixture(source: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(source, link)
    }

    #[cfg(windows)]
    fn symlink_file_fixture(source: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(source, link)
    }

    #[cfg(not(any(unix, windows)))]
    fn symlink_file_fixture(_source: &Path, _link: &Path) -> std::io::Result<()> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "file symlinks are not supported by this test target",
        ))
    }

    fn block_collection_writes(state: &AppState, collection: &str) {
        let collection_path = state
            .storage
            .root()
            .join("collections")
            .join(format!("{collection}.json"));
        if let Some(parent) = collection_path.parent() {
            fs::create_dir_all(parent).expect("collection parent should be created");
        }
        fs::create_dir(collection_path).expect("collection path should block file writes");
    }

    fn uploaded_jsonl_file(name: &str, text: &str) -> Value {
        json!({
            "name": name,
            "type": "application/jsonl",
            "base64": general_purpose::STANDARD.encode(text.as_bytes())
        })
    }

    fn build_sillytavern_fixture(root: &Path) {
        let data_dir = root.join("data").join("default-user");
        for index in 0..80 {
            write_json(
                &data_dir
                    .join("characters")
                    .join(format!("character-{index:02}.json")),
                &json!({
                    "spec": "chara_card_v2",
                    "data": {
                        "name": format!("Character {index:02}"),
                        "description": "Imported test character"
                    }
                }),
            );
        }
        for index in 0..48 {
            write_bytes(
                &data_dir
                    .join("backgrounds")
                    .join(format!("background-{index:02}.png")),
                b"background-bytes",
            );
        }
        for index in 0..2 {
            write_bytes(
                &data_dir
                    .join("User Avatars")
                    .join(format!("persona-{index:02}.png")),
                &general_purpose::STANDARD
                    .decode(TINY_PNG)
                    .expect("fixture PNG should decode"),
            );
        }
    }

    fn folder_access(root: &Path) -> (String, String) {
        let listing = directory_listing(root.to_path_buf(), true)
            .expect("fixture folder should receive an import token");
        let path = listing
            .get("path")
            .and_then(Value::as_str)
            .expect("listing should include canonical path")
            .to_string();
        let token = listing
            .get("folderToken")
            .and_then(Value::as_str)
            .expect("listing should include folder token")
            .to_string();
        (path, token)
    }

    fn scan_ids(scan: &Value, key: &str) -> Vec<String> {
        scan.get(key)
            .and_then(Value::as_array)
            .expect("scan category should be an array")
            .iter()
            .filter_map(|item| item.get("id").and_then(Value::as_str))
            .map(ToOwned::to_owned)
            .collect()
    }

    fn row_with_content<'a>(rows: &'a [Value], content: &str) -> &'a Value {
        rows.iter()
            .find(|row| row.get("content").and_then(Value::as_str) == Some(content))
            .expect("expected imported message content")
    }

    fn character_id_by_name(state: &AppState, name: &str) -> String {
        state
            .storage
            .list("characters")
            .expect("characters should list")
            .into_iter()
            .find(|row| {
                row.get("data")
                    .and_then(|data| data.get("name"))
                    .and_then(Value::as_str)
                    == Some(name)
            })
            .and_then(|row| row.get("id").and_then(Value::as_str).map(ToOwned::to_owned))
            .expect("imported character id should exist")
    }

    #[test]
    fn scan_st_folder_includes_legacy_preset_folders_and_group_metadata() {
        let st_root = temp_path("scan-legacy-folders");
        let data_dir = st_root.join("data").join("default-user");
        write_json(
            &data_dir.join("characters").join("Alice.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Alice" } }),
        );
        write_json(&data_dir.join("presets").join("Default.json"), &json!({}));
        write_json(
            &data_dir.join("TextGen Settings").join("Novel.json"),
            &json!({}),
        );
        write_json(
            &data_dir.join("OpenAI Settings").join("GPT.json"),
            &json!({}),
        );
        write_json(
            &data_dir.join("groups").join("party.json"),
            &json!({
                "id": "group-party",
                "chat_id": "party-chat",
                "name": "Party Chat",
                "members": ["Alice.png", "Bob.png"]
            }),
        );
        write_bytes(
            &data_dir.join("group chats").join("party-chat.jsonl"),
            br#"{"name":"Alice","mes":"hello"}"#,
        );
        let (folder_path, folder_token) = folder_access(&st_root);

        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("scan should succeed");
        let preset_ids = scan_ids(&scan, "presets");
        assert!(
            preset_ids.contains(&"presets:presets/Default.json".to_string()),
            "native presets folder should still scan"
        );
        assert!(
            preset_ids.contains(&"presets:TextGen Settings/Novel.json".to_string()),
            "legacy TextGen Settings folder should scan"
        );
        assert!(
            preset_ids.contains(&"presets:OpenAI Settings/GPT.json".to_string()),
            "legacy OpenAI Settings folder should scan"
        );
        let group_chat = scan
            .get("groupChats")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .expect("group chat should scan");
        assert_eq!(
            group_chat.get("groupName").and_then(Value::as_str),
            Some("Party Chat")
        );
        assert_eq!(
            shared::string_array_from_value(group_chat.get("members")),
            vec!["Alice.png".to_string(), "Bob.png".to_string()]
        );

        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn scan_st_folder_parses_structured_candidates_before_listing() {
        let st_root = temp_path("scan-parsed-candidates");
        let data_dir = st_root.join("data").join("default-user");
        write_json(
            &data_dir.join("characters").join("filename-only.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Parsed Character" } }),
        );
        write_bytes(
            &data_dir.join("characters").join("bad-character.json"),
            b"{not-json}",
        );
        write_json(
            &data_dir.join("characters").join("not-a-character.json"),
            &json!({ "name": "World Book", "entries": [] }),
        );
        write_json(
            &data_dir.join("presets").join("file-preset.json"),
            &json!({ "name": "Parsed Preset" }),
        );
        write_bytes(
            &data_dir.join("presets").join("bad-preset.json"),
            b"{not-json}",
        );
        write_json(
            &data_dir.join("worlds").join("file-lorebook.json"),
            &json!({ "name": "Parsed Lorebook", "entries": [] }),
        );
        write_bytes(
            &data_dir.join("worlds").join("bad-lorebook.json"),
            b"{not-json}",
        );
        let (folder_path, folder_token) = folder_access(&st_root);

        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("scan should succeed");

        assert_eq!(
            scan_ids(&scan, "characters"),
            vec!["characters:characters/filename-only.json".to_string()],
            "malformed JSON and top-level lorebooks must not be advertised as characters"
        );
        assert_eq!(
            scan["characters"][0].get("name").and_then(Value::as_str),
            Some("Parsed Character")
        );
        assert_eq!(
            scan_ids(&scan, "presets"),
            vec!["presets:presets/file-preset.json".to_string()],
            "malformed presets must not be advertised"
        );
        assert_eq!(
            scan["presets"][0].get("name").and_then(Value::as_str),
            Some("Parsed Preset")
        );
        assert_eq!(
            scan_ids(&scan, "lorebooks"),
            vec!["lorebooks:worlds/file-lorebook.json".to_string()],
            "malformed lorebooks must not be advertised"
        );
        assert_eq!(
            scan["lorebooks"][0].get("name").and_then(Value::as_str),
            Some("Parsed Lorebook")
        );

        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn scan_st_folder_rejects_ambiguous_non_default_user_data_dirs() {
        let st_root = temp_path("scan-ambiguous-data-dirs");
        write_json(
            &st_root
                .join("data")
                .join("alice")
                .join("characters")
                .join("Alice.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Alice" } }),
        );
        write_json(
            &st_root
                .join("data")
                .join("bob")
                .join("characters")
                .join("Bob.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Bob" } }),
        );
        let (folder_path, folder_token) = folder_access(&st_root);

        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("ambiguous scan should return a failure response");

        assert_eq!(scan["success"], Value::Bool(false));
        assert!(
            scan.get("error").and_then(Value::as_str).is_some_and(
                |message| message.contains("Multiple SillyTavern user data directories")
            ),
            "ambiguous roots should not silently pick a profile"
        );
        assert!(
            scan_ids(&scan, "characters").is_empty(),
            "ambiguous scans must not advertise arbitrary user records"
        );

        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn run_st_bulk_import_rejects_ambiguous_non_default_user_data_dirs() {
        let app_root = temp_path("ambiguous-data-dirs-app");
        let st_root = temp_path("ambiguous-data-dirs-source");
        write_json(
            &st_root
                .join("data")
                .join("alice")
                .join("characters")
                .join("Alice.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Alice" } }),
        );
        write_json(
            &st_root
                .join("data")
                .join("bob")
                .join("characters")
                .join("Bob.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Bob" } }),
        );
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let (folder_path, folder_token) = folder_access(&st_root);

        let error = run_st_bulk_import_inner(
            &state,
            json!({
                "folderPath": folder_path,
                "folderToken": folder_token,
                "options": {
                    "characters": true
                }
            }),
            None,
        )
        .expect_err("ambiguous import roots must reject before selecting categories");

        assert_eq!(error.code, "invalid_input");
        assert!(
            error
                .message
                .contains("Multiple SillyTavern user data directories"),
            "import should use the same explicit ambiguity rule as scan"
        );
        assert!(
            state.storage.list("characters").unwrap().is_empty(),
            "ambiguous imports must not create records from an arbitrary profile"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn scan_st_folder_includes_lowercase_persona_avatar_alias_after_empty_title_alias() {
        let st_root = temp_path("scan-persona-lowercase-alias");
        let data_dir = st_root.join("data").join("default-user");
        fs::create_dir_all(data_dir.join("characters"))
            .expect("fixture characters directory should mark the ST data root");
        fs::create_dir_all(data_dir.join("User Avatars"))
            .expect("empty title-case avatar alias should be created");
        write_bytes(
            &data_dir.join("user avatars").join("Hidden.png"),
            &general_purpose::STANDARD
                .decode(TINY_PNG)
                .expect("fixture PNG should decode"),
        );
        let (folder_path, folder_token) = folder_access(&st_root);

        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("scan should succeed");
        let persona_ids = scan_ids(&scan, "personas");

        assert_eq!(scan["success"], Value::Bool(true));
        assert_eq!(persona_ids.len(), 1);
        assert!(
            persona_ids.iter().any(|id| id.ends_with("/Hidden.png")),
            "a populated lowercase avatar alias should not be blocked by an empty title-case alias"
        );
        if !cfg!(windows) {
            assert!(
                persona_ids.contains(&"personas:user avatars/Hidden.png".to_string()),
                "case-sensitive installs should expose the lowercase alias path"
            );
        }

        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn scan_st_folder_dedups_overlapping_persona_avatar_aliases() {
        let st_root = temp_path("scan-persona-alias-overlap");
        let data_dir = st_root.join("data").join("default-user");
        fs::create_dir_all(data_dir.join("characters"))
            .expect("fixture characters directory should mark the ST data root");
        let png_bytes = general_purpose::STANDARD
            .decode(TINY_PNG)
            .expect("fixture PNG should decode");
        write_bytes(
            &data_dir.join("User Avatars").join("Shared.png"),
            &png_bytes,
        );
        write_bytes(
            &data_dir.join("user avatars").join("Shared.png"),
            &png_bytes,
        );
        write_bytes(
            &data_dir.join("user avatars").join("Lower Only.png"),
            &png_bytes,
        );
        let (folder_path, folder_token) = folder_access(&st_root);

        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("scan should succeed");
        let persona_ids = scan_ids(&scan, "personas");
        let shared_count = persona_ids
            .iter()
            .filter(|id| id.ends_with("/Shared.png"))
            .count();

        assert_eq!(scan["success"], Value::Bool(true));
        assert_eq!(
            shared_count,
            if cfg!(windows) { 1 } else { 2 },
            "same-named files in distinct alias folders should both scan, while mirrored aliases should not duplicate a physical file"
        );
        assert!(
            persona_ids.iter().any(|id| id.ends_with("/Lower Only.png")),
            "non-overlapping files from later aliases should still be included"
        );

        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn scan_st_folder_skips_symlinked_files_outside_data_dir() {
        let app_root = temp_path("scan-symlink-escape-app");
        let st_root = temp_path("scan-symlink-escape-source");
        let outside_root = temp_path("scan-symlink-escape-outside");
        let data_dir = st_root.join("data").join("default-user");
        let alice_path = data_dir.join("characters").join("Alice.json");
        let escaped_path = outside_root.join("Escaped.json");
        let escaped_link = data_dir.join("characters").join("Escaped.json");
        write_json(
            &alice_path,
            &json!({ "spec": "chara_card_v2", "data": { "name": "Alice" } }),
        );
        write_json(
            &escaped_path,
            &json!({ "spec": "chara_card_v2", "data": { "name": "Escaped" } }),
        );
        let symlink_result = symlink_file_fixture(&escaped_path, &escaped_link);
        if cfg!(windows) && symlink_result.is_err() {
            let _ = fs::remove_dir_all(app_root);
            let _ = fs::remove_dir_all(st_root);
            let _ = fs::remove_dir_all(outside_root);
            return;
        }
        symlink_result.expect("fixture symlink should be created");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let (folder_path, folder_token) = folder_access(&st_root);

        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("scan should succeed");
        let character_ids = scan_ids(&scan, "characters");

        assert_eq!(scan["success"], Value::Bool(true));
        assert_eq!(
            character_ids,
            vec!["characters:characters/Alice.json".to_string()],
            "scan should only mint importable ids under the selected ST data directory"
        );

        let result = run_st_bulk_import_inner(
            &state,
            json!({
                "folderPath": folder_path,
                "folderToken": folder_token,
                "options": {
                    "characters": true
                }
            }),
            None,
        )
        .expect("boolean character import should only use importable scanned files");

        assert_eq!(result["success"], Value::Bool(true));
        assert_eq!(result["imported"]["characters"], json!(1));
        assert!(
            result["errors"]
                .as_array()
                .map(Vec::is_empty)
                .unwrap_or(false),
            "skipped symlink escapes must not become stale selected-item errors"
        );
        assert_eq!(
            state.storage.list("characters").unwrap().len(),
            1,
            "normal in-tree files should still import through scan-generated ids"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn run_st_bulk_import_accepts_legacy_boolean_category_selection() {
        let app_root = temp_path("boolean-selection-app");
        let st_root = temp_path("boolean-selection-source");
        let data_dir = st_root.join("data").join("default-user");
        write_json(
            &data_dir.join("characters").join("Alice.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Alice" } }),
        );
        write_bytes(
            &data_dir.join("characters").join("bad-character.json"),
            b"{not-json}",
        );
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let (folder_path, folder_token) = folder_access(&st_root);

        let result = run_st_bulk_import_inner(
            &state,
            json!({
                "folderPath": folder_path,
                "folderToken": folder_token,
                "options": {
                    "characters": true,
                    "presets": false,
                    "lorebooks": [],
                    "backgrounds": false,
                    "personas": false,
                    "chats": false,
                    "groupChats": false
                }
            }),
            None,
        )
        .expect("legacy boolean selections should import scanned category candidates");

        assert_eq!(result["success"], Value::Bool(true));
        assert_eq!(result["imported"]["characters"], json!(1));
        assert_eq!(
            state.storage.list("characters").unwrap().len(),
            1,
            "boolean true should import parsed scan candidates only"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn run_st_bulk_import_rejects_invalid_character_tag_import_mode() {
        let app_root = temp_path("invalid-tag-mode-app");
        let st_root = temp_path("invalid-tag-mode-source");
        let data_dir = st_root.join("data").join("default-user");
        write_json(
            &data_dir.join("characters").join("Alice.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Alice", "tags": ["hero"] } }),
        );
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let (folder_path, folder_token) = folder_access(&st_root);

        let error = run_st_bulk_import_inner(
            &state,
            json!({
                "folderPath": folder_path,
                "folderToken": folder_token,
                "options": {
                    "characters": true,
                    "characterTagImportMode": "typo"
                }
            }),
            None,
        )
        .expect_err("invalid tag import modes must be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(
            error.message.contains("characterTagImportMode"),
            "error should identify the invalid option"
        );
        assert!(
            state.storage.list("characters").unwrap().is_empty(),
            "invalid options must reject before importing anything"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn run_st_bulk_import_rejects_character_lookup_read_failure() {
        let app_root = temp_path("bulk-chat-lookup-failure-app");
        let st_root = temp_path("bulk-chat-lookup-failure-source");
        let data_dir = st_root.join("data").join("default-user");
        fs::create_dir_all(data_dir.join("characters"))
            .expect("fixture characters directory should mark the ST data root");
        write_bytes(
            &data_dir.join("chats").join("Bot").join("Branch.jsonl"),
            br#"{"character_name":"Bot","mes":"hello"}"#,
        );
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        state
            .storage
            .clear_all()
            .expect("test storage cache should clear");
        block_collection_writes(&state, "characters");
        let (folder_path, folder_token) = folder_access(&st_root);

        let error = state
            .storage
            .update_collections_atomically(vec!["messages"], |_| {
                Ok(run_st_bulk_import_inner(
                    &state,
                    json!({
                        "folderPath": folder_path,
                        "folderToken": folder_token,
                        "options": {
                            "chats": true
                        }
                    }),
                    None,
                )
                .expect_err("character lookup read failure must reject bulk chat import"))
            })
            .expect("atomic read-failure harness should complete");

        assert_eq!(error.code, "io_error");
        assert!(
            state.storage.list("chats").unwrap().is_empty(),
            "lookup failure must not create unlinked chats"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn run_st_bulk_import_links_chat_branches_and_group_speakers() {
        let app_root = temp_path("bulk-chat-parity-app");
        let st_root = temp_path("bulk-chat-parity-source");
        let data_dir = st_root.join("data").join("default-user");
        write_json(
            &data_dir.join("characters").join("Alice.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Alice" } }),
        );
        write_json(
            &data_dir.join("characters").join("Bob.json"),
            &json!({ "spec": "chara_card_v2", "data": { "name": "Bob" } }),
        );
        write_bytes(
            &data_dir.join("chats").join("Alice").join("Branch_One.jsonl"),
            concat!(
                r#"{"is_user":true,"mes":"Hi Alice","send_date":"2026-01-01T12:00:00Z"}"#,
                "\n",
                r#"{"character_name":"Alice","mes":"Raw Alice","send_date":"2026-01-01T12:01:00Z","extra":{"display_text":"Rendered Alice"}}"#
            )
            .as_bytes(),
        );
        write_bytes(
            &data_dir
                .join("chats")
                .join("Alice")
                .join("Branch_Two.jsonl"),
            br#"{"character_name":"Alice","mes":"Second branch"}"#,
        );
        write_json(
            &data_dir.join("groups").join("party.json"),
            &json!({
                "id": "group-party",
                "chat_id": "party-chat",
                "name": "Party Chat",
                "members": ["Alice.png", "Bob.png"]
            }),
        );
        write_bytes(
            &data_dir.join("group chats").join("party-chat.jsonl"),
            concat!(
                r#"{"name":"Alice","mes":"Alice speaks"}"#,
                "\n",
                r#"{"name":"Bob","mes":"Bob speaks"}"#
            )
            .as_bytes(),
        );
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let (folder_path, folder_token) = folder_access(&st_root);
        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("scan should succeed");

        let result = run_st_bulk_import_inner(
            &state,
            json!({
                "folderPath": folder_path,
                "folderToken": folder_token,
                "options": {
                    "characters": scan_ids(&scan, "characters"),
                    "chats": scan_ids(&scan, "chats"),
                    "groupChats": scan_ids(&scan, "groupChats")
                }
            }),
            None,
        )
        .expect("bulk import should succeed");
        assert_eq!(result["success"], Value::Bool(true));
        assert_eq!(result["imported"]["characters"], json!(2));
        assert_eq!(result["imported"]["chats"], json!(2));
        assert_eq!(result["imported"]["groupChats"], json!(1));

        let alice_id = character_id_by_name(&state, "Alice");
        let bob_id = character_id_by_name(&state, "Bob");
        let chats = state.storage.list("chats").expect("chats should list");
        let alice_chats = chats
            .iter()
            .filter(|chat| chat.get("name").and_then(Value::as_str) == Some("Alice"))
            .collect::<Vec<_>>();
        assert_eq!(alice_chats.len(), 2);
        let branch_group_id = alice_chats[0]
            .get("groupId")
            .and_then(Value::as_str)
            .expect("branch chats should share a group id");
        assert!(
            alice_chats
                .iter()
                .all(|chat| chat.get("groupId").and_then(Value::as_str) == Some(branch_group_id)),
            "chat branches from the same ST character folder should be grouped"
        );
        assert!(
            alice_chats
                .iter()
                .all(
                    |chat| shared::string_array_from_value(chat.get("characterIds"))
                        .contains(&alice_id)
                ),
            "one-on-one imported branches should link to the matching imported character"
        );
        assert!(
            alice_chats.iter().any(|chat| {
                chat.get("metadata")
                    .and_then(|metadata| metadata.get("branchName"))
                    .and_then(Value::as_str)
                    == Some("Branch One")
            }),
            "branch metadata should preserve the source file label"
        );

        let party_chat = chats
            .iter()
            .find(|chat| chat.get("name").and_then(Value::as_str) == Some("Party Chat"))
            .expect("group chat should import with ST group name");
        assert_eq!(
            party_chat.get("groupId").and_then(Value::as_str),
            Some("group-party")
        );
        assert_eq!(
            shared::string_array_from_value(party_chat.get("characterIds")),
            vec![alice_id.clone(), bob_id.clone()]
        );
        assert_eq!(
            party_chat
                .get("metadata")
                .and_then(|metadata| metadata.get("groupChatMode"))
                .and_then(Value::as_str),
            Some("individual")
        );

        let mut messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        crate::storage_commands::message_swipes::materialize_messages(&state, &mut messages, true)
            .expect("messages should materialize sidecar swipes");
        let rendered_alice = row_with_content(&messages, "Raw Alice");
        assert_eq!(
            rendered_alice.get("characterId").and_then(Value::as_str),
            Some(alice_id.as_str())
        );
        assert_eq!(
            rendered_alice
                .get("extra")
                .and_then(|extra| extra.get("displayText"))
                .and_then(Value::as_str),
            Some("Rendered Alice")
        );
        assert_eq!(
            rendered_alice.get("createdAt").and_then(Value::as_str),
            Some("2026-01-01T12:01:00+00:00")
        );
        assert_eq!(
            row_with_content(&messages, "Alice speaks")
                .get("characterId")
                .and_then(Value::as_str),
            Some(alice_id.as_str())
        );
        assert_eq!(
            row_with_content(&messages, "Bob speaks")
                .get("characterId")
                .and_then(Value::as_str),
            Some(bob_id.as_str())
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn import_st_chat_text_defaults_to_roleplay_mode() {
        let app_root = temp_path("chat-default-mode");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let result = import_st_chat_text(
            &state,
            r#"{"character_name":"Bot","mes":"hello"}"#,
            "Imported Chat".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect("chat import should succeed");

        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert_eq!(
            chat.get("mode").and_then(Value::as_str),
            Some("roleplay"),
            "single-file SillyTavern JSONL imports should default to roleplay"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_preserves_inherited_mode() {
        let app_root = temp_path("chat-inherited-mode");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let result = import_st_chat_text(
            &state,
            r#"{"character_name":"Bot","mes":"hello"}"#,
            "Imported Chat".to_string(),
            Some(json!({ "mode": "conversation", "metadata": {}, "characterIds": [] })),
            StChatImportContext::default(),
        )
        .expect("chat import should succeed");

        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert_eq!(
            chat.get("mode").and_then(Value::as_str),
            Some("conversation"),
            "inherited/imported mode should not be overwritten by the ST default"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_normalizes_message_timestamps_in_line_order() {
        let app_root = temp_path("chat-st-monotonic-timestamps");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        import_st_chat_text(
            &state,
            concat!(
                r#"{"is_user":true,"mes":"first","send_date":"2026-01-01T12:00:00Z"}"#,
                "\n",
                r#"{"character_name":"Bot","mes":"second","send_date":"2026-01-01T12:00:00Z"}"#,
                "\n",
                r#"{"is_user":true,"mes":"third","send_date":"2026-01-01T11:59:00Z"}"#,
                "\n",
                r#"{"character_name":"Bot","mes":"fourth","send_date":"not a date"}"#
            ),
            "Imported Chat".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect("chat import should succeed");

        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(messages.len(), 4);
        let mut sorted = messages.clone();
        sorted.sort_by_key(|message| {
            message
                .get("createdAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        });
        let sorted_contents = sorted
            .iter()
            .map(|message| {
                message
                    .get("content")
                    .and_then(Value::as_str)
                    .expect("message should include content")
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            sorted_contents,
            vec![
                "first".to_string(),
                "second".to_string(),
                "third".to_string(),
                "fourth".to_string()
            ],
            "createdAt sorting should preserve the original ST JSONL line order"
        );

        let timestamps = sorted
            .iter()
            .map(|message| {
                DateTime::parse_from_rfc3339(
                    message
                        .get("createdAt")
                        .and_then(Value::as_str)
                        .expect("message should include createdAt"),
                )
                .expect("message createdAt should be parseable")
                .with_timezone(&Utc)
            })
            .collect::<Vec<_>>();
        assert!(
            timestamps.windows(2).all(|pair| pair[0] < pair[1]),
            "normalized ST message timestamps should be strictly increasing"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_honors_file_last_modified_timestamp_override() {
        let app_root = temp_path("chat-st-file-last-modified");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let mut file = uploaded_jsonl_file(
            "Override Chat.jsonl",
            concat!(
                r#"{"is_user":true,"mes":"hello"}"#,
                "\n",
                r#"{"character_name":"Bot","mes":"hi"}"#
            ),
        );
        file.as_object_mut()
            .expect("uploaded file should be an object")
            .insert("lastModified".to_string(), json!(1767225600000_i64));

        let result =
            import_st_chat(&state, json!({ "file": file })).expect("chat import should succeed");
        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert_eq!(
            chat.get("createdAt").and_then(Value::as_str),
            Some("2026-01-01T00:00:00+00:00")
        );
        assert_eq!(
            chat.get("updatedAt").and_then(Value::as_str),
            Some("2026-01-01T00:00:00+00:00")
        );

        let mut messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        messages.sort_by_key(|message| {
            message
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        });
        assert_eq!(
            messages[0].get("createdAt").and_then(Value::as_str),
            Some("2026-01-01T00:00:00+00:00"),
            "first row without send_date should use the trusted file timestamp"
        );
        assert_eq!(
            messages[1].get("createdAt").and_then(Value::as_str),
            Some("2026-01-01T00:00:00.001+00:00"),
            "later rows should advance from the trusted timestamp in line order"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_rolls_back_chat_when_message_write_fails() {
        let app_root = temp_path("chat-rollback");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        block_collection_writes(&state, "messages");

        let error = import_st_chat_text(
            &state,
            r#"{"character_name":"Bot","mes":"hello"}"#,
            "Rollback Chat".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect_err("message storage failure should reject chat import");

        assert_eq!(error.code, "io_error");
        assert!(
            state.storage.list("chats").unwrap().is_empty(),
            "failed chat import must remove the created chat"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_into_group_scopes_speaker_lookup_to_target_roster() {
        let app_root = temp_path("chat-st-branch-roster-lookup");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let target_character = state
            .storage
            .create("characters", json!({ "data": { "name": "Target Bot" } }))
            .expect("target character should create");
        let target_character_id = target_character
            .get("id")
            .and_then(Value::as_str)
            .expect("target character should include id")
            .to_string();
        let outside_character = state
            .storage
            .create("characters", json!({ "data": { "name": "Outside Bot" } }))
            .expect("outside character should create");
        let outside_character_id = outside_character
            .get("id")
            .and_then(Value::as_str)
            .expect("outside character should include id")
            .to_string();
        let target_chat = state
            .storage
            .create(
                "chats",
                json!({
                    "name": "Target",
                    "mode": "roleplay",
                    "characterIds": [target_character_id],
                    "createdAt": "2020-01-01T00:00:00Z",
                    "updatedAt": "2020-01-01T00:00:00Z",
                    "metadata": {}
                }),
            )
            .expect("target chat should create");
        let target_chat_id = target_chat
            .get("id")
            .and_then(Value::as_str)
            .expect("target chat should include id")
            .to_string();

        let result = import_st_chat_into_group(
            &state,
            json!({
                "chatId": target_chat_id,
                "timestampOverrides": {
                    "createdAt": "2026-02-03T04:05:06Z",
                    "updatedAt": "2026-02-03T04:06:07Z"
                },
                "file": uploaded_jsonl_file(
                    "Branch.jsonl",
                    concat!(
                        r#"{"name":"Outside Bot","mes":"outside speaker"}"#,
                        "\n",
                        r#"{"name":"Target Bot","mes":"target speaker"}"#,
                        "\n",
                        r#"{"name":"Unknown Bot","mes":"unknown speaker"}"#
                    ),
                )
            }),
        )
        .expect("branch import should succeed");
        let branch_chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let branch = state
            .storage
            .get("chats", branch_chat_id)
            .expect("branch should be readable")
            .expect("branch should exist");
        assert_eq!(
            shared::string_array_from_value(branch.get("characterIds")),
            vec![target_character_id.clone()],
            "branch import should not add globally matched speakers outside the target roster"
        );
        assert_eq!(
            branch.get("createdAt").and_then(Value::as_str),
            Some("2026-02-03T04:05:06+00:00"),
            "branch chat should honor trusted timestamp overrides instead of target chat timestamps"
        );
        assert_eq!(
            branch.get("updatedAt").and_then(Value::as_str),
            Some("2026-02-03T04:06:07+00:00")
        );

        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(
            row_with_content(&messages, "target speaker")
                .get("characterId")
                .and_then(Value::as_str),
            Some(target_character_id.as_str())
        );
        assert!(
            row_with_content(&messages, "outside speaker")
                .get("characterId")
                .is_none_or(Value::is_null),
            "globally known speakers outside the target roster should stay unlinked"
        );
        assert!(
            row_with_content(&messages, "unknown speaker")
                .get("characterId")
                .is_none_or(Value::is_null),
            "unknown branch speakers should not fall back to the first target character"
        );
        assert!(
            !shared::string_array_from_value(branch.get("characterIds"))
                .iter()
                .any(|id| id == &outside_character_id),
            "outside character id must not be added to branch membership"
        );
        assert_eq!(
            row_with_content(&messages, "outside speaker")
                .get("createdAt")
                .and_then(Value::as_str),
            Some("2026-02-03T04:05:06+00:00"),
            "branch messages without send_date should use trusted timestamp overrides"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_preserves_marinara_jsonl_character_ids() {
        let app_root = temp_path("chat-character-ids");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let result = import_st_chat_text(
            &state,
            r#"{"role":"assistant","characterId":"char-a","content":"hello"}"#,
            "Imported Chat".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect("chat import should succeed");

        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert_eq!(
            shared::string_array_from_value(chat.get("characterIds")),
            vec!["char-a".to_string()],
            "chat should link character ids from Marinara JSONL rows"
        );

        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].get("characterId").and_then(Value::as_str),
            Some("char-a"),
            "message should retain its row-level character id"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_ignores_blank_row_character_ids() {
        let app_root = temp_path("chat-blank-row-character-id");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let result = import_st_chat_text(
            &state,
            concat!(
                r#"{"role":"assistant","characterId":"blank-row-character","content":"   "}"#,
                "\n",
                r#"{"role":"assistant","content":"hello"}"#
            ),
            "Imported Chat".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect("chat import should succeed");

        assert_eq!(result.get("messagesImported"), Some(&json!(1)));
        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert!(
            shared::string_array_from_value(chat.get("characterIds")).is_empty(),
            "blank skipped rows must not add explicit row character ids to the parent chat"
        );
        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].get("content").and_then(Value::as_str),
            Some("hello")
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_ignores_blank_row_speaker_links() {
        let app_root = temp_path("chat-blank-row-speaker");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        state
            .storage
            .create("characters", json!({ "data": { "name": "Blank Bot" } }))
            .expect("blank-row character should create");
        let real_character = state
            .storage
            .create("characters", json!({ "data": { "name": "Real Bot" } }))
            .expect("real character should create");
        let real_character_id = real_character
            .get("id")
            .and_then(Value::as_str)
            .expect("real character should include id")
            .to_string();
        let context = StChatImportContext {
            character_lookup: character_lookup_from_state(&state)
                .expect("character lookup should build"),
            default_character_id: None,
            timestamp_overrides: None,
        };

        let result = import_st_chat_text(
            &state,
            concat!(
                r#"{"name":"Blank Bot","mes":"   "}"#,
                "\n",
                r#"{"name":"Real Bot","mes":"hello"}"#
            ),
            "Imported Chat".to_string(),
            None,
            context,
        )
        .expect("chat import should succeed");

        assert_eq!(result.get("messagesImported"), Some(&json!(1)));
        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert_eq!(
            shared::string_array_from_value(chat.get("characterIds")),
            vec![real_character_id.clone()],
            "only persisted assistant/narrator rows should add speaker-derived character ids"
        );
        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(
            row_with_content(&messages, "hello")
                .get("characterId")
                .and_then(Value::as_str),
            Some(real_character_id.as_str())
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_preserves_marinara_jsonl_roles() {
        let app_root = temp_path("chat-message-roles");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        import_st_chat_text(
            &state,
            concat!(
                r#"{"role":"user","content":"hello"}"#,
                "\n",
                r#"{"role":"assistant","content":"hi"}"#,
                "\n",
                r#"{"role":"system","content":"note"}"#,
                "\n",
                r#"{"role":"narrator","content":"scene"}"#,
            ),
            "Imported Chat".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect("chat import should succeed");

        let roles = state
            .storage
            .list("messages")
            .expect("messages should list")
            .into_iter()
            .map(|message| {
                message
                    .get("role")
                    .and_then(Value::as_str)
                    .expect("message should include a role")
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            roles,
            vec![
                "user".to_string(),
                "assistant".to_string(),
                "system".to_string(),
                "narrator".to_string()
            ],
            "Marinara JSONL roles should round-trip without ST is_user flags"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_falls_back_for_unknown_marinara_jsonl_roles() {
        let app_root = temp_path("chat-unknown-message-role");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        import_st_chat_text(
            &state,
            r#"{"role":"tool","content":"internal"}"#,
            "Imported Chat".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect("chat import should succeed");

        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].get("role").and_then(Value::as_str),
            Some("assistant"),
            "unknown JSONL roles should not be persisted verbatim"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn run_st_bulk_import_preserves_st_preset_file_timestamp() {
        let app_root = temp_path("app");
        let st_root = temp_path("source");
        let data_dir = st_root.join("data").join("default-user");
        fs::create_dir_all(data_dir.join("characters"))
            .expect("fixture characters directory should mark the ST data root");
        let preset_path = data_dir.join("presets").join("Timestamped.json");
        write_json(
            &preset_path,
            &json!({
                "name": "Timestamped",
                "prompts": []
            }),
        );
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let (folder_path, folder_token) = folder_access(&st_root);
        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("fixture scan should succeed");
        let presets = scan_ids(&scan, "presets");
        assert_eq!(presets.len(), 1);
        let expected_modified_at = timestamp_overrides_from_value(Some(&modified_at(&preset_path)))
            .map(|(created_at, _)| created_at)
            .expect("fixture preset should expose a parseable file modified timestamp");

        let result = run_st_bulk_import(
            &state,
            json!({
                "folderPath": folder_path,
                "folderToken": folder_token,
                "options": {
                    "presets": presets,
                }
            }),
        )
        .expect("bulk preset import should succeed");
        assert_eq!(result["success"], Value::Bool(true));

        let preset = state
            .storage
            .list("prompts")
            .expect("prompts should list")
            .into_iter()
            .find(|prompt| {
                prompt.get("name").and_then(Value::as_str) == Some("Imported: Timestamped")
            })
            .expect("imported preset should exist");
        assert_eq!(
            preset.get("createdAt").and_then(Value::as_str),
            Some(expected_modified_at.as_str())
        );
        assert_eq!(
            preset.get("updatedAt").and_then(Value::as_str),
            Some(expected_modified_at.as_str())
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn import_st_chat_text_preserves_sillytavern_system_rows_as_hidden_from_ai() {
        let app_root = temp_path("chat-st-system-hidden");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let result = import_st_chat_text(
            &state,
            concat!(
                r#"{"is_system":true,"mes":"hidden note","character_name":"Bot"}"#,
                "\n",
                r#"{"is_user":true,"mes":"visible user"}"#
            ),
            "Imported Chat".to_string(),
            None,
            StChatImportContext {
                character_lookup: HashMap::new(),
                default_character_id: Some("default-bot".to_string()),
                timestamp_overrides: None,
            },
        )
        .expect("ST system transcript rows with content should import");

        assert_eq!(result.get("messagesImported"), Some(&json!(2)));
        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[0].get("content").and_then(Value::as_str),
            Some("hidden note")
        );
        assert_eq!(
            messages[0].get("role").and_then(Value::as_str),
            Some("system")
        );
        assert!(
            messages[0].get("characterId").is_none_or(Value::is_null),
            "ST system rows must not receive the default assistant character id"
        );
        assert_eq!(messages[0]["extra"]["hiddenFromAI"], json!(true));
        assert_eq!(messages[0]["extra"]["hiddenFromAi"], json!(true));
        assert_eq!(
            messages[1].get("role").and_then(Value::as_str),
            Some("user")
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_links_sillytavern_speaker_names_from_context_lookup() {
        let app_root = temp_path("chat-st-speaker-lookup");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let character = state
            .storage
            .create("characters", json!({ "data": { "name": "Bot" } }))
            .expect("character should create");
        let character_id = character
            .get("id")
            .and_then(Value::as_str)
            .expect("character should include id")
            .to_string();
        let context = StChatImportContext {
            character_lookup: character_lookup_from_state(&state)
                .expect("character lookup should build"),
            default_character_id: None,
            timestamp_overrides: None,
        };

        let result = import_st_chat_text(
            &state,
            concat!(
                r#"{"character_name":"Bot","mes":"character name"}"#,
                "\n",
                r#"{"name":"Bot","mes":"name"}"#,
                "\n",
                r#"{"extra":{"name":"Bot"},"mes":"extra name"}"#
            ),
            "Imported Chat".to_string(),
            None,
            context,
        )
        .expect("ST speaker names should import");

        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert_eq!(
            shared::string_array_from_value(chat.get("characterIds")),
            vec![character_id.clone()]
        );
        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(messages.len(), 3);
        assert!(
            messages
                .iter()
                .all(|message| message.get("characterId").and_then(Value::as_str)
                    == Some(character_id.as_str())),
            "each ST speaker field should resolve to the matched character"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_keeps_ambiguous_sillytavern_speaker_names_unlinked() {
        let app_root = temp_path("chat-st-ambiguous-speaker");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        state
            .storage
            .create("characters", json!({ "data": { "name": "Bot" } }))
            .expect("first character should create");
        state
            .storage
            .create("characters", json!({ "data": { "name": "Bot" } }))
            .expect("second character should create");
        let context = StChatImportContext {
            character_lookup: character_lookup_from_state(&state)
                .expect("character lookup should build"),
            default_character_id: None,
            timestamp_overrides: None,
        };

        let result = import_st_chat_text(
            &state,
            r#"{"character_name":"Bot","mes":"ambiguous"}"#,
            "Imported Chat".to_string(),
            None,
            context,
        )
        .expect("ambiguous ST speaker row should still import");

        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert!(
            shared::string_array_from_value(chat.get("characterIds")).is_empty(),
            "ambiguous ST speaker names should not guess a chat character id"
        );
        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(messages.len(), 1);
        assert!(
            messages[0].get("characterId").is_none_or(Value::is_null),
            "ambiguous ST speaker names should keep transcript messages unlinked"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_does_not_link_character_name_only_rows() {
        let app_root = temp_path("chat-character-name-only");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let result = import_st_chat_text(
            &state,
            r#"{"character_name":"Bot","mes":"hello"}"#,
            "Imported Chat".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect("chat import should succeed");

        let chat_id = result
            .get("chatId")
            .and_then(Value::as_str)
            .expect("import result should include chat id");
        let chat = state
            .storage
            .get("chats", chat_id)
            .expect("chat should be readable")
            .expect("chat should exist");
        assert!(
            shared::string_array_from_value(chat.get("characterIds")).is_empty(),
            "ST character_name alone is not a stable local character link"
        );

        let messages = state
            .storage
            .list("messages")
            .expect("messages should list");
        assert_eq!(messages.len(), 1);
        assert!(
            messages[0].get("characterId").is_none_or(Value::is_null),
            "ST character_name alone should keep transcript messages unlinked"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_text_rejects_empty_or_invalid_jsonl_without_creating_chat() {
        let app_root = temp_path("chat-empty-invalid");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let empty_error = import_st_chat_text(
            &state,
            " \n\n",
            "Empty".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect_err("empty JSONL should be rejected");
        assert_eq!(empty_error.code, "invalid_input");
        assert!(
            state.storage.list("chats").unwrap().is_empty(),
            "empty JSONL must not create a chat"
        );

        let invalid_error = import_st_chat_text(
            &state,
            "{not-json}",
            "Invalid".to_string(),
            None,
            StChatImportContext::default(),
        )
        .expect_err("invalid JSONL should be rejected");
        assert_eq!(invalid_error.code, "invalid_input");
        assert!(
            state.storage.list("chats").unwrap().is_empty(),
            "invalid JSONL must not create a chat"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_into_group_restores_target_when_branch_import_fails() {
        let app_root = temp_path("branch-rollback");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "target-chat",
                    "name": "Target Chat",
                    "mode": "conversation",
                    "metadata": {},
                    "characterIds": []
                }),
            )
            .expect("target chat should be created");
        block_collection_writes(&state, "messages");

        let error = import_st_chat_into_group(
            &state,
            json!({
                "chatId": "target-chat",
                "file": uploaded_jsonl_file(
                    "branch.jsonl",
                    r#"{"character_name":"Bot","mes":"hello"}"#
                )
            }),
        )
        .expect_err("message storage failure should reject branch import");

        assert_eq!(error.code, "io_error");
        let target = state
            .storage
            .get("chats", "target-chat")
            .expect("target chat should be readable")
            .expect("target chat should remain");
        assert!(
            target.get("groupId").is_none(),
            "failed branch import must restore the target chat without a generated groupId"
        );
        assert_eq!(
            state.storage.list("chats").unwrap().len(),
            1,
            "failed branch import must remove the created branch chat"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_into_existing_group_preserves_group_id_when_branch_import_fails() {
        let app_root = temp_path("branch-existing-group-rollback");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "target-chat",
                    "name": "Target Chat",
                    "mode": "conversation",
                    "groupId": "existing-group",
                    "metadata": {},
                    "characterIds": []
                }),
            )
            .expect("target chat should be created");
        block_collection_writes(&state, "messages");

        let error = import_st_chat_into_group(
            &state,
            json!({
                "chatId": "target-chat",
                "file": uploaded_jsonl_file(
                    "branch.jsonl",
                    r#"{"character_name":"Bot","mes":"hello"}"#
                )
            }),
        )
        .expect_err("message storage failure should reject branch import");

        assert_eq!(error.code, "io_error");
        let target = state
            .storage
            .get("chats", "target-chat")
            .expect("target chat should be readable")
            .expect("target chat should remain");
        assert_eq!(
            target.get("groupId").and_then(Value::as_str),
            Some("existing-group"),
            "failed branch import must preserve the existing group id"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_st_chat_into_group_rejects_character_lookup_read_failure() {
        let app_root = temp_path("branch-character-lookup-failure");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        state
            .storage
            .clear_all()
            .expect("test storage cache should clear");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "target-chat",
                    "name": "Target Chat",
                    "mode": "roleplay",
                    "metadata": {},
                    "characterIds": ["target-character"]
                }),
            )
            .expect("target chat should be created");
        block_collection_writes(&state, "characters");

        let error = state
            .storage
            .update_collections_atomically(vec!["messages"], |_| {
                Ok(import_st_chat_into_group(
                    &state,
                    json!({
                        "chatId": "target-chat",
                        "file": uploaded_jsonl_file(
                            "branch.jsonl",
                            r#"{"name":"Target","mes":"hello"}"#
                        )
                    }),
                )
                .expect_err("character lookup read failure must reject branch import"))
            })
            .expect("atomic read-failure harness should complete");

        assert_eq!(error.code, "io_error");
        let target = state
            .storage
            .get("chats", "target-chat")
            .expect("target chat should be readable")
            .expect("target chat should remain");
        assert!(
            target.get("groupId").is_none(),
            "lookup failure should reject before mutating the target chat"
        );
        assert_eq!(
            state.storage.list("chats").unwrap().len(),
            1,
            "lookup failure must not create an unlinked branch chat"
        );

        let _ = fs::remove_dir_all(app_root);
    }

    #[test]
    fn import_persona_avatar_file_rolls_back_avatar_when_persona_write_fails() {
        let app_root = temp_path("persona-avatar-rollback");
        let source_root = temp_path("persona-source");
        fs::create_dir_all(&source_root).expect("source dir should be created");
        let source = source_root.join("persona.png");
        fs::write(
            &source,
            general_purpose::STANDARD
                .decode(TINY_PNG)
                .expect("fixture PNG should decode"),
        )
        .expect("source fixture should be written");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        block_collection_writes(&state, "personas");

        let error = import_persona_avatar_file(
            &state,
            &source,
            "Persona".to_string(),
            "description".to_string(),
        )
        .expect_err("persona storage failure should reject persona avatar import");

        assert_eq!(error.code, "io_error");
        assert!(
            !app_root.join("avatars").join("personas").exists(),
            "failed persona avatar import must remove the managed avatar file"
        );
        assert!(
            state.storage.list("personas").unwrap().is_empty(),
            "failed persona avatar import must remove the created persona row"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(source_root);
    }

    #[test]
    fn run_st_bulk_import_continues_after_stale_selected_items() {
        let app_root = temp_path("app");
        let st_root = temp_path("source");
        build_sillytavern_fixture(&st_root);
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let (folder_path, folder_token) = folder_access(&st_root);
        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("fixture scan should succeed");
        let mut characters = scan_ids(&scan, "characters");
        let mut backgrounds = scan_ids(&scan, "backgrounds");
        let mut personas = scan_ids(&scan, "personas");
        characters.push("characters:characters/missing.json".to_string());
        backgrounds.push("backgrounds:backgrounds/missing.png".to_string());
        personas.push("personas:User Avatars/missing.png".to_string());

        let mut events = Vec::new();
        let mut emit = |event| {
            events.push(event);
            Ok(())
        };
        let result = run_st_bulk_import_inner(
            &state,
            json!({
                "folderPath": folder_path,
                "folderToken": folder_token,
                "options": {
                    "characters": characters,
                    "backgrounds": backgrounds,
                    "personas": personas,
                }
            }),
            Some(&mut emit),
        )
        .expect("stale selected items should not abort the import");

        assert_eq!(result["success"], Value::Bool(true));
        assert_eq!(result["imported"]["characters"], json!(80));
        assert_eq!(result["imported"]["backgrounds"], json!(48));
        assert_eq!(result["imported"]["personas"], json!(2));
        assert_eq!(result["errors"].as_array().map(Vec::len), Some(3));
        let progress_events = events
            .iter()
            .filter(|event| event.get("type") == Some(&json!("progress")))
            .collect::<Vec<_>>();
        assert_eq!(progress_events.len(), 133);
        let last_progress = progress_events
            .last()
            .expect("bulk import should emit progress events");
        assert_eq!(last_progress["data"]["current"], json!(133));
        assert_eq!(last_progress["data"]["total"], json!(133));
        let personas = state
            .storage
            .list("personas")
            .expect("personas should be readable");
        let persona = personas.first().expect("a persona should be imported");
        let expected_asset_url_prefix = if cfg!(windows) {
            "http://asset.localhost/"
        } else {
            "asset://localhost/"
        };
        assert!(
            persona
                .get("avatarPath")
                .and_then(Value::as_str)
                .is_some_and(|value| value.starts_with(expected_asset_url_prefix)),
            "persona avatars should be stored as managed asset URLs"
        );
        assert!(
            persona.get("avatar").and_then(Value::as_str).is_none(),
            "persona imports should not duplicate avatar bytes into the avatar field"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn run_st_bulk_import_rejects_unscanned_non_image_background_selection() {
        let app_root = temp_path("app");
        let st_root = temp_path("source");
        let data_dir = st_root.join("data").join("default-user");
        fs::create_dir_all(data_dir.join("characters")).expect("characters dir should be created");
        write_bytes(
            &data_dir.join("backgrounds").join("valid.png"),
            b"valid-background",
        );
        write_bytes(
            &data_dir.join("backgrounds").join("not-image.txt"),
            b"do not import me",
        );
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let (folder_path, folder_token) = folder_access(&st_root);
        let scan = scan_st_folder(json!({
            "folderPath": folder_path,
            "folderToken": folder_token,
        }))
        .expect("fixture scan should succeed");

        assert_eq!(
            scan_ids(&scan, "backgrounds"),
            vec!["backgrounds:backgrounds/valid.png".to_string()],
            "scan must not advertise non-image background files"
        );

        let result = run_st_bulk_import_inner(
            &state,
            json!({
                "folderPath": folder_path,
                "folderToken": folder_token,
                "options": {
                    "backgrounds": [
                        "backgrounds:backgrounds/valid.png",
                        "backgrounds:backgrounds/not-image.txt"
                    ],
                }
            }),
            None,
        )
        .expect("unsupported stale background selection should be reported, not abort the import");

        assert_eq!(result["success"], Value::Bool(true));
        assert_eq!(result["imported"]["backgrounds"], json!(1));
        assert_eq!(result["errors"].as_array().map(Vec::len), Some(1));
        assert!(state.backgrounds.root().join("valid.png").is_file());
        assert!(
            !state.backgrounds.root().join("not-image.txt").exists(),
            "non-image background selections must not be copied into managed backgrounds"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(st_root);
    }

    #[test]
    fn copy_background_file_uses_unique_name_without_overwriting_collision() {
        let app_root = temp_path("background-collision-app");
        let source_root = temp_path("background-collision-source");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let existing = state.backgrounds.root().join("scene.png");
        let source = source_root.join("scene.png");
        write_bytes(&existing, b"existing-background");
        write_bytes(&source, b"new-background");

        let result = super::backgrounds::copy_background_file_with_attempts(&state, &source, 3)
            .expect("background copy should use a numbered collision target");
        let imported_path = PathBuf::from(
            result
                .get("path")
                .and_then(Value::as_str)
                .expect("copy result should include a path"),
        );

        assert_eq!(
            imported_path.file_name().and_then(|name| name.to_str()),
            Some("scene-1.png")
        );
        assert_eq!(
            fs::read(&existing).unwrap(),
            b"existing-background".to_vec()
        );
        assert_eq!(
            fs::read(state.backgrounds.root().join("scene-1.png")).unwrap(),
            b"new-background".to_vec()
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(source_root);
    }

    #[test]
    fn copy_background_file_errors_when_collision_targets_are_exhausted() {
        let app_root = temp_path("background-collision-exhausted-app");
        let source_root = temp_path("background-collision-exhausted-source");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");
        let existing = state.backgrounds.root().join("scene.png");
        let collision = state.backgrounds.root().join("scene-1.png");
        let source = source_root.join("scene.png");
        write_bytes(&existing, b"existing-background");
        write_bytes(&collision, b"existing-collision");
        write_bytes(&source, b"new-background");

        let error = super::backgrounds::copy_background_file_with_attempts(&state, &source, 2)
            .expect_err("exhausted collision targets should reject instead of overwriting");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(
            fs::read(&existing).unwrap(),
            b"existing-background".to_vec()
        );
        assert_eq!(
            fs::read(&collision).unwrap(),
            b"existing-collision".to_vec()
        );
        assert!(
            !state.backgrounds.root().join("scene-2.png").exists(),
            "exhausted helper should not create an unattempted target"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(source_root);
    }
}
