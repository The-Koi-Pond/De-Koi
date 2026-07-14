mod chunks;
mod export;
mod manifest;
mod reader;
mod sources;

#[cfg(test)]
mod tests {
    use super::export::export_profile_v2_artifact;
    use super::reader::validate_profile_v2_archive;
    use crate::state::AppState;
    use serde_json::json;
    use std::fs::File;
    use std::io::Read;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::ZipArchive;

    #[test]
    fn profile_v2_foundation_exports_then_validates_without_mutation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let data_dir = std::env::temp_dir().join(format!("profile-v2-foundation-{nonce}"));
        let state = AppState::from_data_dir(&data_dir, Vec::new()).unwrap();
        for (collection, rows) in [
            ("chats", vec![json!({ "id": "chat" })]),
            (
                "messages",
                vec![json!({ "id": "message", "chatId": "chat", "content": "hello" })],
            ),
            ("characters", vec![json!({ "id": "character" })]),
            (
                "connections",
                vec![json!({
                    "id": "connection",
                    "apiKey": "plain-secret",
                    "apiKeyEncrypted": "encrypted-secret",
                    "apiKeyHash": "secret-hash"
                })],
            ),
            (
                "custom-tools",
                vec![json!({
                    "id": "tool",
                    "webhookUrl": "https://secret.example/hook"
                })],
            ),
        ] {
            state.storage.replace_all(collection, rows).unwrap();
        }
        std::fs::create_dir_all(data_dir.join("avatars")).unwrap();
        let asset_path = data_dir.join("avatars/koi.png");
        std::fs::write(&asset_path, b"unchanged-asset").unwrap();

        let collection_paths = [
            "chats",
            "messages",
            "characters",
            "connections",
            "custom-tools",
        ]
        .map(|collection| {
            let path = data_dir.join(format!("data/collections/{collection}.json"));
            (path.clone(), std::fs::read(path).unwrap())
        });
        let asset_before = std::fs::read(&asset_path).unwrap();

        let artifact = export_profile_v2_artifact(&state).unwrap();
        let validated = validate_profile_v2_archive(artifact.path()).unwrap();
        assert_eq!(validated.asset_count, 1);
        assert_eq!(validated.asset_bytes, asset_before.len() as u64);
        for table in [
            "chats",
            "messages",
            "characters",
            "connections",
            "custom-tools",
        ] {
            assert!(validated
                .tables
                .iter()
                .any(|value| value.name == table && value.record_count == 1));
        }

        let mut archive = ZipArchive::new(File::open(artifact.path()).unwrap()).unwrap();
        for entry in [
            "tables/connections/000001.jsonl",
            "tables/custom-tools/000001.jsonl",
        ] {
            let mut bytes = String::new();
            archive
                .by_name(entry)
                .unwrap()
                .read_to_string(&mut bytes)
                .unwrap();
            assert!(!bytes.contains("plain-secret"));
            assert!(!bytes.contains("encrypted-secret"));
            assert!(!bytes.contains("secret-hash"));
            assert!(!bytes.contains("secret.example"));
        }
        drop(archive);

        for (path, before) in collection_paths {
            assert_eq!(std::fs::read(path).unwrap(), before);
        }
        assert_eq!(std::fs::read(&asset_path).unwrap(), asset_before);
        drop(artifact);
        std::fs::remove_dir_all(data_dir).unwrap();
    }
}
