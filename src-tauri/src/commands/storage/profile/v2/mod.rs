mod chunks;
mod export;
mod manifest;
mod reader;
mod sources;

use self::export::export_profile_v2_artifact;
use self::reader::{
    is_profile_v2_archive as reader_is_profile_v2_archive, read_profile_v2_payload,
};
use super::assets::{preview_profile_zip_assets, restore_profile_zip_assets};
use super::{
    finish_profile_import_assets, import_profile_collections_with_restored_assets_with_progress,
    preview_profile_collections_with_restored_assets, with_profile_import_metadata,
    ProfileImportProgress, ProfileImportSourceFormat,
};
use crate::state::AppState;
use base64::{engine::general_purpose, Engine};
use marinara_core::AppResult;
use serde_json::{json, Value};
use std::fs::File;
use std::path::Path;

pub(super) fn export_profile_v2_bytes(state: &AppState) -> AppResult<Vec<u8>> {
    let artifact = export_profile_v2_artifact(state)?;
    std::fs::read(artifact.path()).map_err(Into::into)
}

pub(super) fn export_profile_v2_download(state: &AppState) -> AppResult<Value> {
    Ok(json!({
        "base64": general_purpose::STANDARD.encode(export_profile_v2_bytes(state)?),
        "filename": "de-koi-profile.zip",
        "contentType": "application/zip",
    }))
}

pub(super) fn is_profile_v2_archive(path: &Path) -> bool {
    reader_is_profile_v2_archive(path)
}

pub(super) fn preview_profile_v2(state: &AppState, path: &Path) -> AppResult<Value> {
    let payload = read_profile_v2_payload(path)?;
    let mut archive = zip::ZipArchive::new(File::open(path)?)
        .map_err(|error| marinara_core::AppError::invalid_input(error.to_string()))?;
    let names = archive.file_names().map(str::to_string).collect::<Vec<_>>();
    let (asset_count, warnings) =
        preview_profile_zip_assets(&mut archive, Some(&payload.assets), &names, "assets")?;
    let result =
        preview_profile_collections_with_restored_assets(state, &payload.collections, asset_count)?;
    Ok(with_profile_v2_metadata(
        with_profile_import_metadata(result, ProfileImportSourceFormat::V2),
        &payload,
        warnings,
    ))
}

pub(super) fn import_profile_v2_with_progress(
    state: &AppState,
    path: &Path,
    progress: &mut ProfileImportProgress<'_>,
) -> AppResult<Value> {
    progress.prepare("validate", "Validating profile v2 package")?;
    let payload = read_profile_v2_payload(path)?;
    progress.prepare("assets", "Preparing profile v2 assets")?;
    let mut archive = zip::ZipArchive::new(File::open(path)?)
        .map_err(|error| marinara_core::AppError::invalid_input(error.to_string()))?;
    let names = archive.file_names().map(str::to_string).collect::<Vec<_>>();
    let mut restored =
        restore_profile_zip_assets(state, &mut archive, &names, "assets", Some(&payload.assets))?;
    let restored_count = restored.restored();
    let warnings = restored.warnings().to_vec();
    let result = import_profile_collections_with_restored_assets_with_progress(
        state,
        &payload.collections,
        restored_count,
        progress,
        || restored.install(),
    );
    finish_profile_import_assets(restored, result).map(|value| {
        with_profile_v2_metadata(
            with_profile_import_metadata(value, ProfileImportSourceFormat::V2),
            &payload,
            warnings,
        )
    })
}

fn with_profile_v2_metadata(
    mut value: Value,
    payload: &reader::ProfileV2Payload,
    warnings: Vec<Value>,
) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("packageVersion".to_string(), json!(2));
        object.insert(
            "destructiveScopes".to_string(),
            Value::Array(
                payload
                    .validated
                    .manifest
                    .tables
                    .iter()
                    .map(|table| Value::String(table.name.clone()))
                    .chain(
                        (payload.validated.asset_count > 0)
                            .then(|| Value::String("managed assets".to_string())),
                    )
                    .collect(),
            ),
        );
        if !warnings.is_empty() {
            object.insert("warnings".to_string(), Value::Array(warnings));
        }
    }
    value
}

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

    #[test]
    fn profile_v2_preview_and_commit_replace_declared_data_atomically() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let source_dir = std::env::temp_dir().join(format!("profile-v2-source-{nonce}"));
        let source = AppState::from_data_dir(&source_dir, Vec::new()).unwrap();
        source
            .storage
            .replace_all(
                "characters",
                vec![json!({ "id": "imported", "name": "Imported Koi" })],
            )
            .unwrap();
        std::fs::create_dir_all(source_dir.join("avatars")).unwrap();
        std::fs::write(source_dir.join("avatars/imported.png"), b"new-avatar").unwrap();
        let artifact = export_profile_v2_artifact(&source).unwrap();

        let target_dir = std::env::temp_dir().join(format!("profile-v2-target-{nonce}"));
        let target = AppState::from_data_dir(&target_dir, Vec::new()).unwrap();
        target
            .storage
            .replace_all("characters", vec![json!({ "id": "existing" })])
            .unwrap();
        std::fs::create_dir_all(target_dir.join("avatars")).unwrap();
        std::fs::write(target_dir.join("avatars/imported.png"), b"old-avatar").unwrap();

        let preview = super::preview_profile_v2(&target, artifact.path()).unwrap();
        assert_eq!(preview["preview"], true);
        assert_eq!(preview["sourceFormat"], "profile-v2");
        assert_eq!(preview["imported"]["characters"], 1);
        assert!(preview["destructiveScopes"]
            .as_array()
            .is_some_and(|scopes| scopes.iter().any(|scope| scope == "characters")));
        assert!(target
            .storage
            .get("characters", "existing")
            .unwrap()
            .is_some());
        assert_eq!(
            std::fs::read(target_dir.join("avatars/imported.png")).unwrap(),
            b"old-avatar"
        );

        let mut progress = super::super::ProfileImportProgress::disabled();
        let result =
            super::import_profile_v2_with_progress(&target, artifact.path(), &mut progress)
                .unwrap();
        assert_eq!(result["success"], true);
        assert_eq!(result["sourceFormat"], "profile-v2");
        assert!(target
            .storage
            .get("characters", "existing")
            .unwrap()
            .is_none());
        assert!(target
            .storage
            .get("characters", "imported")
            .unwrap()
            .is_some());
        assert_eq!(
            std::fs::read(target_dir.join("avatars/imported.png")).unwrap(),
            b"new-avatar"
        );

        drop(artifact);
        std::fs::remove_dir_all(source_dir).unwrap();
        std::fs::remove_dir_all(target_dir).unwrap();
    }

    #[test]
    fn profile_v2_failed_commit_preserves_existing_records_and_assets() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let source_dir = std::env::temp_dir().join(format!("profile-v2-invalid-source-{nonce}"));
        let source = AppState::from_data_dir(&source_dir, Vec::new()).unwrap();
        source
            .storage
            .replace_all(
                "prompts",
                vec![json!({
                    "id": "conflicting",
                    "name": "Conflicting preset",
                    "isDefault": false,
                    "default": true
                })],
            )
            .unwrap();
        std::fs::create_dir_all(source_dir.join("avatars")).unwrap();
        std::fs::write(source_dir.join("avatars/koi.png"), b"replacement").unwrap();
        let artifact = export_profile_v2_artifact(&source).unwrap();

        let target_dir = std::env::temp_dir().join(format!("profile-v2-invalid-target-{nonce}"));
        let target = AppState::from_data_dir(&target_dir, Vec::new()).unwrap();
        target
            .storage
            .replace_all(
                "prompts",
                vec![json!({ "id": "existing", "name": "Existing preset" })],
            )
            .unwrap();
        std::fs::create_dir_all(target_dir.join("avatars")).unwrap();
        std::fs::write(target_dir.join("avatars/koi.png"), b"original").unwrap();

        let mut progress = super::super::ProfileImportProgress::disabled();
        let error = super::import_profile_v2_with_progress(&target, artifact.path(), &mut progress)
            .expect_err("invalid normalized records must reject the whole v2 import");
        assert_eq!(error.code, "invalid_input");
        assert!(target.storage.get("prompts", "existing").unwrap().is_some());
        assert!(target
            .storage
            .get("prompts", "conflicting")
            .unwrap()
            .is_none());
        assert_eq!(
            std::fs::read(target_dir.join("avatars/koi.png")).unwrap(),
            b"original"
        );

        drop(artifact);
        std::fs::remove_dir_all(source_dir).unwrap();
        std::fs::remove_dir_all(target_dir).unwrap();
    }
}
