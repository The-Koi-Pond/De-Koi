use super::{connection_secrets, custom_tools, profile};
use crate::state::AppState;
use base64::{engine::general_purpose, Engine as _};
use marinara_core::{now_millis, AppError, AppResult};
use serde_json::{json, Value};
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const BACKUP_DIRS: &[&str] = &[
    "data",
    "avatars",
    "sprites",
    "backgrounds",
    "entity-images",
    "gallery",
    "game-assets",
    "fonts",
    "knowledge-sources",
    "lorebooks/images",
];

const RESTORE_NOTES: &str = "\
De-Koi backup

This archive contains a managed backup for De-Koi recovery.

Preferred restore path:
1. Open De-Koi Settings -> Import.
2. Use Import Profile and select this zip archive, or select marinara-profile.json if the archive was extracted.

Manual recovery path:
1. Close De-Koi before copying files.
2. Copy the archive folders into your De-Koi app data directory.
3. In the refactor app layout, JSON collections live in data/collections. Keep companion files beside them, including *.json.bak collection backups.
4. Managed asset folders are avatars, sprites, backgrounds, entity-images, gallery, game-assets, fonts, knowledge-sources, and lorebooks/images.
5. Legacy raw backups used storage/ for JSON data; current refactor backups use data/.
";

fn backups_root(state: &AppState) -> PathBuf {
    state.data_dir.join("backups")
}

fn timestamped_backup_name() -> String {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    format!("marinara-backup-{timestamp}-{}", now_millis())
}

fn valid_backup_name(name: &str) -> bool {
    name.starts_with("marinara-backup-")
        && name.len() > "marinara-backup-".len()
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn backup_dir_for_name(state: &AppState, name: &str) -> AppResult<PathBuf> {
    if !valid_backup_name(name) {
        return Err(AppError::invalid_input("Invalid backup name"));
    }
    let root = backups_root(state);
    let candidate = root.join(name);
    let root_canonical = fs::canonicalize(&root)
        .map_err(|_| AppError::not_found("Managed backups directory was not found"))?;
    let candidate_canonical = fs::canonicalize(&candidate)
        .map_err(|_| AppError::not_found("Managed backup was not found"))?;
    if !candidate_canonical.starts_with(&root_canonical) {
        return Err(AppError::invalid_input("Invalid backup path"));
    }
    if !candidate_canonical.is_dir() {
        return Err(AppError::not_found("Managed backup was not found"));
    }
    Ok(candidate_canonical)
}

fn copy_dir_contents(source: &Path, target: &Path) -> AppResult<()> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else if metadata.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            copy_backup_file(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn copy_backup_file(source_path: &Path, target_path: &Path) -> AppResult<()> {
    if is_connections_collection_file(source_path) {
        fs::write(
            target_path,
            masked_connections_collection_bytes(source_path)?,
        )?;
    } else if is_custom_tools_collection_file(source_path) {
        fs::write(
            target_path,
            redacted_custom_tools_collection_bytes(source_path)?,
        )?;
    } else if is_connections_sidecar_file(source_path) || is_custom_tools_sidecar_file(source_path)
    {
        // Durability sidecars (.bak / .corrupted-* / .tmp-*) can duplicate raw
        // credential material; keep them out of portable backups.
    } else {
        fs::copy(source_path, target_path)?;
    }
    Ok(())
}

fn is_connections_collection_file(path: &Path) -> bool {
    path.file_name().and_then(|value| value.to_str()) == Some("connections.json")
        && path
            .parent()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some("collections")
}

fn is_custom_tools_collection_file(path: &Path) -> bool {
    path.file_name().and_then(|value| value.to_str()) == Some("custom-tools.json")
        && path
            .parent()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some("collections")
        && path
            .parent()
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some("data")
}

fn is_backup_profile_json_file(path: &Path, backup_root: &Path) -> bool {
    path.file_name().and_then(|value| value.to_str()) == Some("marinara-profile.json")
        && path.parent() == Some(backup_root)
}

fn is_connections_sidecar_file(path: &Path) -> bool {
    let collections = path.parent();
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with("connections.json."))
        && collections
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some("collections")
        // Scope strictly to the real `data/collections` store; an unrelated
        // managed file like `knowledge-sources/collections/connections.json.notes`
        // must not be dropped from the backup or zip.
        && collections
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some("data")
}

fn is_custom_tools_sidecar_file(path: &Path) -> bool {
    let collections = path.parent();
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with("custom-tools.json."))
        && collections
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some("collections")
        && collections
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some("data")
}

fn write_backup_payload(state: &AppState, target: &Path) -> AppResult<()> {
    state.storage.flush()?;
    fs::create_dir_all(target)?;
    let profile = profile::profile_backup_snapshot(state)?;
    fs::write(
        target.join("marinara-profile.json"),
        serde_json::to_vec_pretty(&profile)?,
    )?;
    fs::write(target.join("RESTORE.txt"), RESTORE_NOTES)?;
    for dir in BACKUP_DIRS {
        let source = state.data_dir.join(dir);
        if source.exists() {
            copy_dir_contents(&source, &target.join(dir))?;
        }
    }
    Ok(())
}

fn backup_entry(path: &Path) -> AppResult<Value> {
    let metadata = fs::metadata(path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::invalid_input("Managed backup path is missing a folder name"))?;
    let created_at = metadata
        .created()
        .or_else(|_| metadata.modified())
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|time| time.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    Ok(json!({
        "name": name,
        "createdAt": created_at,
    }))
}

pub(crate) fn create_backup(state: &AppState) -> AppResult<Value> {
    let backup_name = timestamped_backup_name();
    let backup_dir = backups_root(state).join(&backup_name);
    write_backup_payload(state, &backup_dir)?;
    Ok(json!({
        "success": true,
        "backupName": backup_name,
    }))
}

pub(crate) fn list_backups(state: &AppState) -> AppResult<Value> {
    let root = backups_root(state);
    if !root.exists() {
        return Ok(Value::Array(Vec::new()));
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() || !valid_backup_name(&name) {
            continue;
        }
        backups.push(backup_entry(&path)?);
    }
    backups.sort_by(|a, b| {
        let a_created = a.get("createdAt").and_then(Value::as_str).unwrap_or("");
        let b_created = b.get("createdAt").and_then(Value::as_str).unwrap_or("");
        b_created.cmp(a_created)
    });
    Ok(Value::Array(backups))
}

pub(crate) fn delete_backup(state: &AppState, name: &str) -> AppResult<Value> {
    let backup_dir = backup_dir_for_name(state, name)?;
    fs::remove_dir_all(backup_dir)?;
    Ok(json!({ "success": true, "deleted": true }))
}

fn zip_error(error: zip::result::ZipError) -> AppError {
    AppError::new("backup_zip_error", error.to_string())
}

fn zip_io_error(error: std::io::Error) -> AppError {
    AppError::new("backup_zip_error", error.to_string())
}

fn zip_dir_contents(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    source: &Path,
    entry_root: &str,
    options: SimpleFileOptions,
) -> AppResult<()> {
    if !source.exists() {
        return Ok(());
    }
    let mut stack = vec![(source.to_path_buf(), entry_root.to_string())];
    while let Some((current, current_entry)) = stack.pop() {
        zip.add_directory(format!("{current_entry}/"), options)
            .map_err(zip_error)?;
        for entry in fs::read_dir(&current)? {
            let entry = entry?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().replace('\\', "/");
            let zip_entry = format!("{current_entry}/{name}");
            if metadata.is_dir() {
                stack.push((path, zip_entry));
            } else if metadata.is_file() {
                if is_connections_sidecar_file(&path) || is_custom_tools_sidecar_file(&path) {
                    continue;
                }
                zip.start_file(&zip_entry, options).map_err(zip_error)?;
                if is_backup_profile_json_file(&path, source) {
                    let bytes = redacted_profile_json_bytes(&path)?;
                    zip.write_all(&bytes).map_err(zip_io_error)?;
                } else if is_connections_collection_file(&path) {
                    let bytes = masked_connections_collection_bytes(&path)?;
                    zip.write_all(&bytes).map_err(zip_io_error)?;
                } else if is_custom_tools_collection_file(&path) {
                    let bytes = redacted_custom_tools_collection_bytes(&path)?;
                    zip.write_all(&bytes).map_err(zip_io_error)?;
                } else {
                    let mut file = fs::File::open(path)?;
                    std::io::copy(&mut file, zip).map_err(zip_io_error)?;
                }
            }
        }
    }
    Ok(())
}

fn masked_connections_collection_bytes(path: &Path) -> AppResult<Vec<u8>> {
    let mut value: Value = serde_json::from_slice(&fs::read(path)?)?;
    match &mut value {
        Value::Array(rows) => {
            for row in rows {
                connection_secrets::mask_connection_for_read(row);
                mask_backup_connection_secret_fields(row);
            }
        }
        Value::Object(_) => {
            connection_secrets::mask_connection_for_read(&mut value);
            mask_backup_connection_secret_fields(&mut value);
        }
        _ => {}
    }
    Ok(serde_json::to_vec_pretty(&value)?)
}

fn redacted_profile_json_bytes(path: &Path) -> AppResult<Vec<u8>> {
    let mut value: Value = serde_json::from_slice(&fs::read(path)?)?;
    redact_profile_custom_tool_webhook_urls(&mut value);
    Ok(serde_json::to_vec_pretty(&value)?)
}

fn redact_profile_custom_tool_webhook_urls(value: &mut Value) {
    if let Some(collections) = value
        .get_mut("data")
        .and_then(Value::as_object_mut)
        .and_then(|data| data.get_mut("collections"))
        .and_then(Value::as_object_mut)
    {
        for key in ["custom-tools", "custom_tools"] {
            if let Some(tools) = collections.get_mut(key) {
                custom_tools::redact_custom_tool_webhook_urls(tools);
            }
        }
    }

    if let Some(tables) = value
        .get_mut("data")
        .and_then(Value::as_object_mut)
        .and_then(|data| data.get_mut("fileStorage"))
        .and_then(Value::as_object_mut)
        .and_then(|file_storage| file_storage.get_mut("tables"))
        .and_then(Value::as_object_mut)
    {
        for key in ["custom_tools", "custom-tools"] {
            if let Some(tools) = tables.get_mut(key) {
                custom_tools::redact_custom_tool_webhook_urls(tools);
            }
        }
    }
}

fn redacted_custom_tools_collection_bytes(path: &Path) -> AppResult<Vec<u8>> {
    let mut value: Value = serde_json::from_slice(&fs::read(path)?)?;
    custom_tools::redact_custom_tool_webhook_urls(&mut value);
    Ok(serde_json::to_vec_pretty(&value)?)
}

fn mask_backup_connection_secret_fields(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                mask_backup_connection_secret_fields(item);
            }
        }
        Value::Object(object) => {
            for (key, value) in object.iter_mut() {
                if is_backup_connection_secret_key(key) {
                    *value = Value::String(String::new());
                } else {
                    mask_backup_connection_secret_fields(value);
                }
            }
        }
        _ => {}
    }
}

fn is_backup_connection_secret_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect();
    matches!(
        normalized.as_str(),
        "accesstoken"
            | "apikey"
            | "apikeyencrypted"
            | "apikeyhash"
            | "apikeymasked"
            | "authorization"
            | "clientsecret"
            | "cookie"
            | "credential"
            | "credentials"
            | "encryptedvalue"
            | "password"
            | "refreshtoken"
            | "secret"
            | "sessionid"
            | "sessiontoken"
            | "token"
    ) || normalized.ends_with("token")
        || normalized.ends_with("secret")
        || normalized.ends_with("password")
        || normalized.contains("credential")
}

fn zip_backup_folder(folder: &Path, backup_name: &str) -> AppResult<Vec<u8>> {
    let cursor = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip_dir_contents(&mut zip, folder, backup_name, options)?;
    let cursor = zip.finish().map_err(zip_error)?;
    Ok(cursor.into_inner())
}

pub(crate) fn download_backup(state: &AppState, name: Option<&str>) -> AppResult<Value> {
    let (backup_dir, backup_name, temp_dir) =
        if let Some(name) = name.filter(|value| !value.trim().is_empty()) {
            (backup_dir_for_name(state, name)?, name.to_string(), None)
        } else {
            let backup_name = timestamped_backup_name();
            let temp_dir = state
                .data_dir
                .join(".backup-downloads")
                .join(format!("{backup_name}-staging"));
            if temp_dir.exists() {
                fs::remove_dir_all(&temp_dir)?;
            }
            write_backup_payload(state, &temp_dir)?;
            (temp_dir.clone(), backup_name, Some(temp_dir))
        };

    let bytes = zip_backup_folder(&backup_dir, &backup_name)?;
    if let Some(temp_dir) = temp_dir {
        let _ = fs::remove_dir_all(temp_dir);
    }
    Ok(json!({
        "base64": general_purpose::STANDARD.encode(bytes),
        "filename": format!("{backup_name}.zip"),
        "contentType": "application/zip",
    }))
}

pub(crate) fn download_profile_zip(state: &AppState) -> AppResult<Value> {
    let bytes = download_profile_zip_bytes(state)?;
    Ok(json!({
        "base64": general_purpose::STANDARD.encode(bytes),
        "filename": "marinara-profile.zip",
        "contentType": "application/zip",
    }))
}

pub(crate) fn download_profile_zip_bytes(state: &AppState) -> AppResult<Vec<u8>> {
    let temp_dir = state
        .data_dir
        .join(".profile-export-downloads")
        .join(format!("marinara-profile-{}-staging", now_millis()));
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)?;
    }
    let result = (|| {
        write_backup_payload(state, &temp_dir)?;
        zip_backup_folder(&temp_dir, "marinara-profile")
    })();
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use std::io::Read;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-managed-backup-{label}-{nonce}"));
        if path.exists() {
            fs::remove_dir_all(&path).expect("stale temp backup dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    #[test]
    fn create_list_download_delete_managed_backup() {
        let state = test_state("roundtrip");
        state
            .storage
            .create(
                "characters",
                json!({ "id": "character-1", "data": { "name": "Backup Character" } }),
            )
            .expect("fixture character should write");
        fs::create_dir_all(state.data_dir.join("avatars/characters"))
            .expect("avatar dir should be created");
        fs::write(
            state.data_dir.join("avatars/characters/avatar.png"),
            b"avatar-bytes",
        )
        .expect("avatar fixture should write");

        let created = create_backup(&state).expect("managed backup should be created");
        let name = created["backupName"]
            .as_str()
            .expect("backup name should be returned");
        let backup_dir = state.data_dir.join("backups").join(name);
        assert!(backup_dir.join("marinara-profile.json").is_file());
        assert!(backup_dir.join("RESTORE.txt").is_file());
        assert!(backup_dir
            .join("data/collections/characters.json")
            .is_file());
        assert!(backup_dir.join("avatars/characters/avatar.png").is_file());
        let profile_json: Value = serde_json::from_slice(
            &fs::read(backup_dir.join("marinara-profile.json")).expect("profile json should read"),
        )
        .expect("profile json should parse");
        let asset = profile_json["data"]["assets"]
            .as_array()
            .expect("asset manifest should be an array")
            .iter()
            .find(|asset| asset["path"] == "avatars/characters/avatar.png")
            .expect("avatar asset should be listed");
        assert!(asset.get("base64").is_none());
        assert_eq!(asset["size"], 12);

        let backups = list_backups(&state)
            .expect("managed backups should list")
            .as_array()
            .expect("backup list should be an array")
            .clone();
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0]["name"], name);
        assert!(backups[0].get("path").is_none());

        let downloaded =
            download_backup(&state, Some(name)).expect("managed backup should download");
        assert_eq!(downloaded["filename"], format!("{name}.zip"));
        assert_eq!(downloaded["contentType"], "application/zip");
        assert!(downloaded["base64"].as_str().unwrap_or_default().len() > 16);

        let deleted = delete_backup(&state, name).expect("managed backup should delete");
        assert_eq!(deleted["deleted"], true);
        assert!(!backup_dir.exists());
    }

    #[test]
    fn backups_exclude_connections_secret_sidecars() {
        let state = test_state("connections-sidecars");
        state
            .storage
            .create(
                "connections",
                json!({ "id": "connection-1", "apiKeyEncrypted": "v1:secret" }),
            )
            .expect("fixture connection should write");
        state.storage.flush().expect("storage should flush");
        let collections_dir = state.data_dir.join("data/collections");
        fs::write(
            collections_dir.join("connections.json.bak"),
            br#"[{"id":"connection-1","apiKeyEncrypted":"v1:secret"}]"#,
        )
        .expect("sidecar fixture should write");
        fs::write(
            collections_dir.join("connections.json.corrupted-123"),
            br#"[{"id":"connection-1","apiKeyEncrypted":"v1:secret"}]"#,
        )
        .expect("corrupted sidecar fixture should write");

        let created = create_backup(&state).expect("managed backup should be created");
        let name = created["backupName"].as_str().expect("backup name");
        let backup_collections = state
            .data_dir
            .join("backups")
            .join(name)
            .join("data/collections");
        let masked = fs::read_to_string(backup_collections.join("connections.json"))
            .expect("masked connections should exist");
        assert!(!masked.contains("apiKeyEncrypted"));
        assert!(!backup_collections.join("connections.json.bak").exists());
        assert!(!backup_collections
            .join("connections.json.corrupted-123")
            .exists());

        // Legacy backup folders may still hold raw sidecars; the zip must drop
        // the whole family, not just .bak.
        fs::write(
            backup_collections.join("connections.json.bak"),
            br#"[{"id":"connection-1","apiKeyEncrypted":"v1:secret"}]"#,
        )
        .expect("legacy sidecar fixture should write");
        fs::write(
            backup_collections.join("connections.json.corrupted-456"),
            br#"[{"id":"connection-1","apiKeyEncrypted":"v1:secret"}]"#,
        )
        .expect("legacy corrupted sidecar fixture should write");
        let downloaded = download_backup(&state, Some(name)).expect("backup should download");
        let bytes = general_purpose::STANDARD
            .decode(downloaded["base64"].as_str().expect("zip base64"))
            .expect("zip should decode");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("zip should open");
        let mut masked_archived = false;
        for index in 0..archive.len() {
            let entry = archive.by_index(index).expect("zip entry should read");
            let entry_name = entry.name().to_string();
            assert!(!entry_name.contains("connections.json."));
            if entry_name.ends_with("data/collections/connections.json") {
                masked_archived = true;
            }
        }
        // The sidecar skip must never widen into dropping the masked
        // connections.json itself from downloaded archives.
        assert!(masked_archived);
    }

    #[test]
    fn existing_backup_download_remasks_connections_json() {
        let state = test_state("existing-connections-remask");
        let name = "marinara-backup-existing";
        let backup_dir = state.data_dir.join("backups").join(name);
        let collections_dir = backup_dir.join("data/collections");
        fs::create_dir_all(&collections_dir).expect("collections dir should be created");
        fs::write(
            collections_dir.join("connections.json"),
            serde_json::to_vec_pretty(&json!([
                {
                    "id": "conn-1",
                    "name": "OpenAI",
                    "apiKey": "sk-plain-secret",
                    "apiKeyEncrypted": "ciphertext-secret",
                    "providerMetadata": {
                        "refreshToken": "refresh-secret",
                        "display": "safe metadata"
                    }
                }
            ]))
            .expect("connection fixture should serialize"),
        )
        .expect("raw existing connection backup should be written");
        fs::write(
            collections_dir.join("characters.json"),
            serde_json::to_vec_pretty(&json!([{ "id": "char-1", "name": "Keep Character" }]))
                .expect("character fixture should serialize"),
        )
        .expect("unrelated collection should be written");

        let downloaded =
            download_backup(&state, Some(name)).expect("existing backup should download");
        let bytes = general_purpose::STANDARD
            .decode(
                downloaded["base64"]
                    .as_str()
                    .expect("download should include base64 zip"),
            )
            .expect("downloaded zip base64 should decode");
        let mut archive =
            zip::ZipArchive::new(Cursor::new(bytes)).expect("downloaded zip should open");
        let mut connections = String::new();
        archive
            .by_name(&format!("{name}/data/collections/connections.json"))
            .expect("connections.json should be present")
            .read_to_string(&mut connections)
            .expect("connections.json should read");
        let mut characters = String::new();
        archive
            .by_name(&format!("{name}/data/collections/characters.json"))
            .expect("characters.json should be present")
            .read_to_string(&mut characters)
            .expect("characters.json should read");

        assert!(!connections.contains("sk-plain-secret"));
        assert!(!connections.contains("ciphertext-secret"));
        assert!(!connections.contains("refresh-secret"));
        assert!(connections.contains("OpenAI"));
        assert!(connections.contains("safe metadata"));
        assert!(characters.contains("Keep Character"));
    }

    #[test]
    fn backups_redact_custom_tool_webhook_urls() {
        let state = test_state("custom-tool-webhook-redaction");
        state
            .storage
            .create("custom-tools", custom_tool_fixture())
            .expect("custom tool should write");
        state
            .storage
            .create("custom-tools", legacy_custom_tool_fixture())
            .expect("legacy custom tool should write");
        state.storage.flush().expect("storage should flush");
        let source_collections_dir = state.data_dir.join("data/collections");
        fs::write(
            source_collections_dir.join("custom-tools.json.bak"),
            serde_json::to_vec_pretty(&json!([
                custom_tool_fixture(),
                legacy_custom_tool_fixture()
            ]))
                .expect("custom-tools sidecar fixture should serialize"),
        )
        .expect("custom-tools sidecar fixture should write");

        let created = create_backup(&state).expect("managed backup should be created");
        let name = created["backupName"].as_str().expect("backup name");
        let backup_dir = state.data_dir.join("backups").join(name);

        let profile_json: Value = serde_json::from_slice(
            &fs::read(backup_dir.join("marinara-profile.json")).expect("profile json should read"),
        )
        .expect("profile json should parse");
        assert_custom_tool_webhook_redacted(&profile_json["data"]["collections"]["custom-tools"]);

        let collection_json: Value = serde_json::from_slice(
            &fs::read(backup_dir.join("data/collections/custom-tools.json"))
                .expect("custom-tools collection should read"),
        )
        .expect("custom-tools collection should parse");
        assert_custom_tool_webhook_redacted(&collection_json);
        assert!(!backup_dir
            .join("data/collections/custom-tools.json.bak")
            .exists());

        let downloaded = download_backup(&state, Some(name)).expect("backup should download");
        let bytes = general_purpose::STANDARD
            .decode(downloaded["base64"].as_str().expect("zip base64"))
            .expect("zip should decode");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("zip should open");
        let mut archived_collection = String::new();
        archive
            .by_name(&format!("{name}/data/collections/custom-tools.json"))
            .expect("custom-tools collection should be present")
            .read_to_string(&mut archived_collection)
            .expect("custom-tools collection should read");
        assert!(!archived_collection.contains("live/token"));
        let archived_collection_json: Value =
            serde_json::from_str(&archived_collection).expect("custom-tools JSON should parse");
        assert_custom_tool_webhook_redacted(&archived_collection_json);
        for index in 0..archive.len() {
            let entry = archive.by_index(index).expect("zip entry should read");
            assert!(!entry.name().contains("custom-tools.json."));
        }
    }

    #[test]
    fn existing_backup_download_redacts_custom_tool_webhook_urls_and_skips_sidecars() {
        let state = test_state("existing-custom-tool-webhook-redaction");
        let name = "marinara-backup-existing-custom-tools";
        let backup_dir = state.data_dir.join("backups").join(name);
        let collections_dir = backup_dir.join("data/collections");
        fs::create_dir_all(&collections_dir).expect("collections dir should be created");
        fs::write(
            backup_dir.join("marinara-profile.json"),
            serde_json::to_vec_pretty(&profile_with_custom_tool_fixture())
                .expect("profile fixture should serialize"),
        )
        .expect("profile fixture should write");
        fs::write(
            collections_dir.join("custom-tools.json"),
            serde_json::to_vec_pretty(&json!([
                custom_tool_fixture(),
                legacy_custom_tool_fixture()
            ]))
                .expect("custom tools fixture should serialize"),
        )
        .expect("custom-tools fixture should write");
        fs::write(
            collections_dir.join("custom-tools.json.bak"),
            serde_json::to_vec_pretty(&json!([
                custom_tool_fixture(),
                legacy_custom_tool_fixture()
            ]))
                .expect("custom-tools sidecar fixture should serialize"),
        )
        .expect("custom-tools sidecar fixture should write");
        fs::write(
            collections_dir.join("custom-tools.json.corrupted-123"),
            serde_json::to_vec_pretty(&json!([
                custom_tool_fixture(),
                legacy_custom_tool_fixture()
            ]))
                .expect("custom-tools corrupted fixture should serialize"),
        )
        .expect("custom-tools corrupted fixture should write");

        let downloaded =
            download_backup(&state, Some(name)).expect("existing backup should download");
        let bytes = general_purpose::STANDARD
            .decode(downloaded["base64"].as_str().expect("zip base64"))
            .expect("zip should decode");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("zip should open");
        let mut profile_json = String::new();
        archive
            .by_name(&format!("{name}/marinara-profile.json"))
            .expect("profile JSON should be present")
            .read_to_string(&mut profile_json)
            .expect("profile JSON should read");
        let mut custom_tools_json = String::new();
        archive
            .by_name(&format!("{name}/data/collections/custom-tools.json"))
            .expect("custom-tools collection should be present")
            .read_to_string(&mut custom_tools_json)
            .expect("custom-tools collection should read");

        assert!(!profile_json.contains("live/token"));
        assert!(!custom_tools_json.contains("live/token"));
        let profile_value: Value =
            serde_json::from_str(&profile_json).expect("profile JSON should parse");
        assert_custom_tool_webhook_redacted(&profile_value["data"]["collections"]["custom-tools"]);
        assert_custom_tool_webhook_redacted(
            &profile_value["data"]["fileStorage"]["tables"]["custom_tools"],
        );
        let collection_value: Value =
            serde_json::from_str(&custom_tools_json).expect("custom-tools JSON should parse");
        assert_custom_tool_webhook_redacted(&collection_value);
        for index in 0..archive.len() {
            let entry = archive.by_index(index).expect("zip entry should read");
            assert!(!entry.name().contains("custom-tools.json."));
        }
    }

    #[test]
    fn backups_keep_unrelated_connections_lookalike_files() {
        let state = test_state("connections-lookalike");
        // A managed file that merely shares the basename pattern but lives
        // outside data/collections must be backed up and shipped, not dropped.
        let lookalike_dir = state.data_dir.join("knowledge-sources/collections");
        fs::create_dir_all(&lookalike_dir).expect("lookalike dir should be created");
        fs::write(
            lookalike_dir.join("connections.json.notes"),
            b"not a secret sidecar",
        )
        .expect("lookalike fixture should write");
        fs::write(
            lookalike_dir.join("custom-tools.json.notes"),
            b"not a custom tool sidecar",
        )
        .expect("custom tools lookalike fixture should write");

        let created = create_backup(&state).expect("managed backup should be created");
        let name = created["backupName"].as_str().expect("backup name");
        let backup_lookalike = state
            .data_dir
            .join("backups")
            .join(name)
            .join("knowledge-sources/collections/connections.json.notes");
        let custom_tools_lookalike = state
            .data_dir
            .join("backups")
            .join(name)
            .join("knowledge-sources/collections/custom-tools.json.notes");
        assert!(
            backup_lookalike.exists(),
            "unrelated lookalike must survive the fresh backup"
        );
        assert!(
            custom_tools_lookalike.exists(),
            "unrelated custom-tools lookalike must survive the fresh backup"
        );

        let downloaded = download_backup(&state, Some(name)).expect("backup should download");
        let bytes = general_purpose::STANDARD
            .decode(downloaded["base64"].as_str().expect("zip base64"))
            .expect("zip should decode");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("zip should open");
        let mut lookalike_archived = false;
        let mut custom_tools_lookalike_archived = false;
        for index in 0..archive.len() {
            let entry = archive.by_index(index).expect("zip entry should read");
            if entry
                .name()
                .ends_with("knowledge-sources/collections/connections.json.notes")
            {
                lookalike_archived = true;
            }
            if entry
                .name()
                .ends_with("knowledge-sources/collections/custom-tools.json.notes")
            {
                custom_tools_lookalike_archived = true;
            }
        }
        assert!(
            lookalike_archived,
            "unrelated lookalike must survive the downloaded zip"
        );
        assert!(
            custom_tools_lookalike_archived,
            "unrelated custom-tools lookalike must survive the downloaded zip"
        );
    }

    fn profile_with_custom_tool_fixture() -> Value {
        json!({
            "type": "marinara_profile",
            "version": 1,
            "runtime": "tauri",
            "data": {
                "collections": {
                    "custom-tools": [custom_tool_fixture()]
                },
                "fileStorage": {
                    "tables": {
                        "custom_tools": [legacy_custom_tool_fixture()]
                    }
                },
                "assets": []
            }
        })
    }

    fn custom_tool_fixture() -> Value {
        json!({
            "id": "tool-1",
            "name": "Webhook Tool",
            "executionType": "webhook",
            "webhookUrl": "https://discord.com/api/webhooks/live/token",
            "staticResult": "safe static result",
            "scriptBody": "return input;",
            "enabled": true
        })
    }

    fn legacy_custom_tool_fixture() -> Value {
        json!({
            "id": "tool-legacy",
            "name": "Legacy Webhook Tool",
            "executionType": "webhook",
            "webhook_url": "https://discord.com/api/webhooks/live/token",
            "staticResult": "safe legacy static result",
            "scriptBody": "return legacy_input;",
            "enabled": true
        })
    }

    fn assert_custom_tool_webhook_redacted(collection: &Value) {
        let tools = collection
            .as_array()
            .expect("custom tools should be exported as an array");
        assert!(
            !collection.to_string().contains("live/token"),
            "custom tool export must not contain the live webhook token"
        );
        if tools.iter().any(|tool| tool["id"] == "tool-1") {
            assert!(
                tools.iter().any(|tool| tool["staticResult"] == "safe static result"),
                "camelCase fixture should keep non-secret fields"
            );
        }
        if tools.iter().any(|tool| tool["id"] == "tool-legacy") {
            assert!(
                tools
                    .iter()
                    .any(|tool| tool["staticResult"] == "safe legacy static result"),
                "legacy fixture should keep non-secret fields"
            );
        }
        for tool in tools {
            if tool.get("webhookUrl").is_some() {
                assert_eq!(tool.get("webhookUrl"), Some(&Value::Null));
            }
            if tool.get("webhook_url").is_some() {
                assert_eq!(tool.get("webhook_url"), Some(&Value::Null));
            }
        }
    }

    #[test]
    fn invalid_backup_names_do_not_escape_backups_root() {
        let state = test_state("invalid-name");
        fs::create_dir_all(state.data_dir.join("backups")).expect("backups dir should be created");

        for name in [
            "../marinara-backup-escape",
            "marinara-backup-../escape",
            "not-a-backup",
        ] {
            let error = delete_backup(&state, name).expect_err("invalid backup name should fail");
            assert_eq!(error.code, "invalid_input");
        }
    }
}
