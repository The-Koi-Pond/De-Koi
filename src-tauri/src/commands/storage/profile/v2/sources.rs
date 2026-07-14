use super::chunks::TableChunkSink;
use super::manifest::ProfileV2Table;
use crate::state::AppState;
use crate::storage_commands::{connection_secrets, contracts, custom_tools};
use marinara_core::AppResult;
use std::fs::File;
use zip::ZipWriter;

pub(super) fn write_profile_v2_tables(
    state: &AppState,
    zip: &mut ZipWriter<File>,
) -> AppResult<Vec<ProfileV2Table>> {
    let mut tables = Vec::new();
    for collection in contracts::profile_collections() {
        let mut sink = TableChunkSink::new(collection, zip)?;
        state
            .storage
            .visit_collection_streaming(collection, |_index, row| {
                let mut row = row.clone();
                match collection {
                    "connections" => connection_secrets::mask_connection_for_read(&mut row),
                    "custom-tools" => custom_tools::redact_custom_tool_webhook_url(&mut row),
                    _ => {}
                }
                sink.push(&row)
            })?;
        tables.push(sink.finish()?);
    }
    Ok(tables)
}

#[cfg(test)]
mod tests {
    use super::super::manifest::ProfileV2Table;
    use super::*;
    use crate::state::AppState;
    use crate::storage_commands::{contracts, profile::assets::visit_profile_export_assets};
    use serde_json::{json, Value};
    use std::fs::File;
    use std::io::Read;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::ZipArchive;

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("profile-v2-sources-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test state should initialize")
    }

    fn temp_zip(state: &AppState, label: &str) -> PathBuf {
        state.data_dir.join(format!("{label}.zip"))
    }

    fn export_tables(state: &AppState, label: &str) -> (PathBuf, Vec<ProfileV2Table>) {
        let path = temp_zip(state, label);
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        let tables = write_profile_v2_tables(state, &mut zip).unwrap();
        zip.finish().unwrap();
        (path, tables)
    }

    fn read_entry(path: &PathBuf, entry: &str) -> String {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut file = archive.by_name(entry).unwrap();
        let mut value = String::new();
        file.read_to_string(&mut value).unwrap();
        value
    }

    #[test]
    fn profile_v2_sources_follow_contract_collection_order() {
        let state = test_state("order");
        let (_path, tables) = export_tables(&state, "order");
        let actual = tables
            .iter()
            .map(|table| table.name.as_str())
            .collect::<Vec<_>>();
        let expected = contracts::profile_collections().collect::<Vec<_>>();
        assert_eq!(actual, expected);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_sources_mask_connection_secrets_per_row() {
        let state = test_state("connections");
        state
            .storage
            .replace_all(
                "connections",
                vec![json!({
                    "id": "secret",
                    "apiKey": "plain-secret",
                    "apiKeyEncrypted": "encrypted-secret",
                    "apiKeyHash": "secret-hash"
                })],
            )
            .unwrap();
        let (path, _tables) = export_tables(&state, "connections");
        let line = read_entry(&path, "tables/connections/000001.jsonl");
        let row: Value = serde_json::from_str(line.trim()).unwrap();

        assert_eq!(row["hasApiKey"], true);
        assert_eq!(
            row["apiKey"],
            crate::storage_commands::connection_secrets::API_KEY_MASK
        );
        assert!(!line.contains("plain-secret"));
        assert!(!line.contains("encrypted-secret"));
        assert!(!line.contains("secret-hash"));
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_sources_redact_custom_tool_webhook_per_row() {
        let state = test_state("custom-tools");
        state
            .storage
            .replace_all(
                "custom-tools",
                vec![json!({ "id": "tool", "webhookUrl": "https://secret.example/hook" })],
            )
            .unwrap();
        let (path, _tables) = export_tables(&state, "custom-tools");
        let line = read_entry(&path, "tables/custom-tools/000001.jsonl");
        let row: Value = serde_json::from_str(line.trim()).unwrap();

        assert_eq!(row["webhookUrl"], Value::Null);
        assert!(!line.contains("secret.example"));
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_assets_are_lexical_and_skip_symlinks_and_markers() {
        let state = test_state("assets");
        let avatars = state.data_dir.join("avatars");
        std::fs::create_dir_all(&avatars).unwrap();
        std::fs::create_dir_all(state.data_dir.join("backgrounds")).unwrap();
        std::fs::create_dir_all(state.data_dir.join("sprites")).unwrap();
        std::fs::write(avatars.join("z.png"), b"z").unwrap();
        std::fs::write(avatars.join("a.png"), b"a").unwrap();
        std::fs::write(avatars.join(".marker"), b"marker").unwrap();
        std::fs::write(state.data_dir.join("backgrounds/b.png"), b"b").unwrap();
        std::fs::write(state.data_dir.join("sprites/s.png"), b"s").unwrap();
        #[cfg(windows)]
        let linked =
            std::os::windows::fs::symlink_file(avatars.join("a.png"), avatars.join("linked.png"))
                .is_ok();
        #[cfg(not(windows))]
        let linked =
            std::os::unix::fs::symlink(avatars.join("a.png"), avatars.join("linked.png")).is_ok();

        let mut paths = Vec::new();
        visit_profile_export_assets(&state, |asset| {
            paths.push(asset.relative);
            Ok(())
        })
        .unwrap();

        assert_eq!(paths[0], PathBuf::from("avatars/a.png"));
        assert_eq!(paths[1], PathBuf::from("avatars/z.png"));
        assert_eq!(paths[2], PathBuf::from("backgrounds/b.png"));
        assert_eq!(paths[3], PathBuf::from("sprites/s.png"));
        assert!(!paths.iter().any(|path| path.ends_with(".marker")));
        if linked {
            assert!(!paths.iter().any(|path| path.ends_with("linked.png")));
        }
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_sources_do_not_populate_clean_collection_cache() {
        let state = test_state("cache");
        let collections = state.data_dir.join("data/collections");
        std::fs::write(
            collections.join("messages.json"),
            b"[{\"id\":\"streamed\"}]",
        )
        .unwrap();
        let (_path, _tables) = export_tables(&state, "cache");
        std::fs::remove_file(collections.join("messages.json")).unwrap();

        assert!(state.storage.list("messages").unwrap().is_empty());
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }
}
