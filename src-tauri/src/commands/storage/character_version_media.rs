use super::media_uploads::{
    decode_image_payload, extension_for_image_mime, file_path_asset_url, is_inline_image_data_url,
    optimize_avatar_image_bytes,
};
use marinara_core::{new_id, AppError, AppResult};
use marinara_storage::FileStorage;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const INLINE_AVATAR_FIELDS: &[&str] = &["avatarPath", "avatar", "avatarUrl"];
pub(crate) const MAX_CHARACTER_VERSION_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_CHARACTER_VERSION_DATA_URL_BYTES: usize =
    (MAX_CHARACTER_VERSION_IMAGE_BYTES * 4 / 3) + 4096;

pub(crate) fn reject_inline_character_version_media(record: &Value) -> AppResult<()> {
    let Some(object) = record.as_object() else {
        return Ok(());
    };
    for field in INLINE_AVATAR_FIELDS {
        if object
            .get(*field)
            .and_then(Value::as_str)
            .is_some_and(is_inline_image_data_url)
        {
            return Err(AppError::new(
                "inline_character_version_media",
                format!("Character version field {field} must use a managed image reference"),
            ));
        }
    }
    Ok(())
}

pub(crate) fn normalize_character_version_media(
    data_dir: &Path,
    record: &mut Map<String, Value>,
    created_files: &mut Vec<PathBuf>,
) -> AppResult<bool> {
    let Some((source_field, source_value)) = INLINE_AVATAR_FIELDS.iter().find_map(|field| {
        record
            .get(*field)
            .and_then(Value::as_str)
            .filter(|value| is_inline_image_data_url(value))
            .map(|value| (*field, value.to_string()))
    }) else {
        return Ok(false);
    };

    let (mime, bytes) = decode_bounded_image(&source_value, source_field)?;
    let optimized = optimize_avatar_image_bytes(&bytes, &mime)?;
    if optimized.len() > MAX_CHARACTER_VERSION_IMAGE_BYTES {
        return Err(character_version_image_too_large(source_field));
    }

    for field in INLINE_AVATAR_FIELDS {
        let Some(other) = record
            .get(*field)
            .and_then(Value::as_str)
            .filter(|value| is_inline_image_data_url(value))
        else {
            continue;
        };
        if *field == source_field || other == source_value {
            continue;
        }
        let (other_mime, other_bytes) = decode_bounded_image(other, field)?;
        let other_optimized = optimize_avatar_image_bytes(&other_bytes, &other_mime)?;
        if other_optimized != optimized {
            return Err(AppError::new(
                "conflicting_character_version_media",
                format!(
                    "Character version avatar fields {source_field} and {field} contain different images"
                ),
            ));
        }
    }

    let ext = extension_for_image_mime(&mime).unwrap_or("png");
    let digest = Sha256::digest(&optimized);
    let hash = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let filename = format!("version-{hash}.{ext}");
    let target_dir = data_dir.join("avatars").join("characters").join("versions");
    fs::create_dir_all(&target_dir)?;
    let target = target_dir.join(&filename);
    if target.exists() {
        if fs::read(&target)? != optimized {
            return Err(AppError::new(
                "character_version_image_hash_collision",
                "Managed character version image fingerprint matched different bytes",
            ));
        }
    } else {
        let temp = target_dir.join(format!(".{filename}.{}.tmp", new_id()));
        let write_result = (|| -> AppResult<bool> {
            let mut file = fs::File::create(&temp)?;
            file.write_all(&optimized)?;
            file.sync_all()?;
            match fs::hard_link(&temp, &target) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    if fs::read(&target)? != optimized {
                        return Err(AppError::new(
                            "character_version_image_hash_collision",
                            "Managed character version image fingerprint matched different bytes",
                        ));
                    }
                    fs::remove_file(&temp)?;
                    return Ok(false);
                }
                Err(error) => return Err(error.into()),
            }
            fs::remove_file(&temp)?;
            Ok(true)
        })();
        match write_result {
            Ok(true) => created_files.push(target.clone()),
            Ok(false) => {}
            Err(error) => {
                let _ = fs::remove_file(&temp);
                return Err(error);
            }
        }
    }

    let asset_url = file_path_asset_url(&target);
    record.insert("avatarPath".to_string(), Value::String(asset_url.clone()));
    for field in ["avatar", "avatarUrl"] {
        if record.contains_key(field) {
            record.insert(field.to_string(), Value::String(asset_url.clone()));
        }
    }
    record.insert(
        "avatarFilePath".to_string(),
        Value::String(target.to_string_lossy().to_string()),
    );
    record.insert("avatarFilename".to_string(), Value::String(filename));
    Ok(true)
}

pub(crate) fn rollback_character_version_media_files(
    storage: &FileStorage,
    paths: &[PathBuf],
) -> AppResult<()> {
    let mut candidates = paths
        .iter()
        .filter_map(|path| path.file_name().and_then(|name| name.to_str()))
        .filter(|filename| is_content_addressed_version_filename(filename))
        .map(str::to_string)
        .collect::<HashSet<_>>();
    if candidates.is_empty() {
        return Ok(());
    }
    storage.visit_collection_streaming("character-versions", |_index, row| {
        if let Some(filename) = row.get("avatarFilename").and_then(Value::as_str) {
            candidates.remove(filename);
        }
        Ok(())
    })?;
    for path in paths {
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|filename| candidates.contains(filename))
        {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(())
}

pub(crate) fn cleanup_orphaned_character_version_media(
    storage: &FileStorage,
    data_dir: &Path,
) -> AppResult<usize> {
    let target_dir = data_dir.join("avatars/characters/versions");
    if !target_dir.is_dir() {
        return Ok(0);
    }
    let mut candidates = fs::read_dir(&target_dir)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|filename| is_content_addressed_version_filename(filename))
        .collect::<HashSet<_>>();
    storage.visit_collection_streaming("character-versions", |_index, row| {
        if let Some(filename) = row.get("avatarFilename").and_then(Value::as_str) {
            candidates.remove(filename);
        }
        Ok(())
    })?;
    let mut removed = 0;
    for filename in candidates {
        fs::remove_file(target_dir.join(filename))?;
        removed += 1;
    }
    Ok(removed)
}

pub(super) fn is_content_addressed_version_filename(filename: &str) -> bool {
    let Some((hash, extension)) = filename
        .strip_prefix("version-")
        .and_then(|value| value.rsplit_once('.'))
    else {
        return false;
    };
    hash.len() == 64
        && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        && !extension.is_empty()
        && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn decode_bounded_image(value: &str, field: &str) -> AppResult<(String, Vec<u8>)> {
    if value.len() > MAX_CHARACTER_VERSION_DATA_URL_BYTES {
        return Err(character_version_image_too_large(field));
    }
    let (mime, bytes) = decode_image_payload(value, field)?;
    if bytes.len() > MAX_CHARACTER_VERSION_IMAGE_BYTES {
        return Err(character_version_image_too_large(field));
    }
    Ok((mime, bytes))
}

fn character_version_image_too_large(field: &str) -> AppError {
    AppError::new(
        "character_version_image_too_large",
        format!(
            "Character version field {field} exceeds the {} byte image limit",
            MAX_CHARACTER_VERSION_IMAGE_BYTES
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose, Engine as _};
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    const TINY_PNG: &str =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should follow the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("de-koi-version-media-{label}-{nonce}"))
    }

    #[test]
    fn character_version_media_externalizes_all_present_avatar_mirrors() {
        let root = temp_dir("mirrors");
        let data_url = format!("data:image/png;base64,{TINY_PNG}");
        let mut record = json!({
            "id": "version-1",
            "avatarPath": data_url,
            "avatar": data_url,
            "avatarUrl": data_url,
            "data": { "description": "keep data:image/plain text unchanged" }
        })
        .as_object()
        .cloned()
        .unwrap();
        let mut created_files = Vec::new();

        let changed = normalize_character_version_media(&root, &mut record, &mut created_files)
            .expect("inline avatar should normalize");

        assert!(changed);
        assert_eq!(created_files.len(), 1);
        let avatar_path = record["avatarPath"].as_str().unwrap();
        assert!(!avatar_path.starts_with("data:image"));
        assert_eq!(record["avatar"], record["avatarPath"]);
        assert_eq!(record["avatarUrl"], record["avatarPath"]);
        assert!(record["avatarFilePath"]
            .as_str()
            .unwrap()
            .contains("versions"));
        assert!(record["avatarFilename"]
            .as_str()
            .unwrap()
            .starts_with("version-"));
        assert_eq!(
            record["data"]["description"],
            "keep data:image/plain text unchanged"
        );
        fs::remove_dir_all(root).expect("temporary directory should clean up");
    }

    #[test]
    fn character_version_media_reuses_identical_content() {
        let root = temp_dir("dedupe");
        let data_url = format!("data:image/png;base64,{TINY_PNG}");
        let mut created_files = Vec::new();
        let mut first = json!({ "avatarPath": data_url })
            .as_object()
            .cloned()
            .unwrap();
        let mut second = first.clone();

        normalize_character_version_media(&root, &mut first, &mut created_files).unwrap();
        normalize_character_version_media(&root, &mut second, &mut created_files).unwrap();

        assert_eq!(first["avatarPath"], second["avatarPath"]);
        assert_eq!(created_files.len(), 1);
        fs::remove_dir_all(root).expect("temporary directory should clean up");
    }

    #[test]
    fn character_version_media_rejects_malformed_and_oversized_payloads() {
        let root = temp_dir("invalid");
        let mut malformed = json!({ "avatarPath": "data:image/png;base64,bm9wZQ==" })
            .as_object()
            .cloned()
            .unwrap();
        let mut created_files = Vec::new();
        let malformed_error =
            normalize_character_version_media(&root, &mut malformed, &mut created_files)
                .expect_err("malformed image should fail");
        assert_eq!(malformed_error.code, "invalid_input");

        let mut bytes = general_purpose::STANDARD.decode(TINY_PNG).unwrap();
        bytes.resize(MAX_CHARACTER_VERSION_IMAGE_BYTES + 1, 0);
        let mut oversized = json!({
            "avatarPath": format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(bytes))
        })
        .as_object()
        .cloned()
        .unwrap();
        let oversized_error =
            normalize_character_version_media(&root, &mut oversized, &mut created_files)
                .expect_err("oversized image should fail");
        assert_eq!(oversized_error.code, "character_version_image_too_large");
        assert!(created_files.is_empty());
    }

    #[test]
    fn character_version_media_rejects_sniffable_but_undecodable_images() {
        let root = temp_dir("undecodable");
        let truncated_png = general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\n");
        let mut record = json!({
            "avatarPath": format!("data:image/png;base64,{truncated_png}")
        })
        .as_object()
        .cloned()
        .unwrap();
        let mut created_files = Vec::new();

        let error = normalize_character_version_media(&root, &mut record, &mut created_files)
            .expect_err("truncated image should fail full decode");

        assert_eq!(error.code, "invalid_input");
        assert!(created_files.is_empty());
    }

    #[test]
    fn direct_character_version_contract_rejects_inline_media_without_echoing_it() {
        let payload = format!("data:image/png;base64,{TINY_PNG}");
        let record = json!({ "avatarUrl": payload });

        let error = reject_inline_character_version_media(&record)
            .expect_err("inline media should be rejected");

        assert_eq!(error.code, "inline_character_version_media");
        assert!(error.message.contains("avatarUrl"));
        assert!(!error.message.contains(TINY_PNG));
    }

    #[test]
    fn orphan_cleanup_removes_only_unreferenced_content_addressed_assets() {
        let root = temp_dir("orphan-cleanup");
        let storage = FileStorage::new(root.join("data")).unwrap();
        let asset_dir = root.join("avatars/characters/versions");
        fs::create_dir_all(&asset_dir).unwrap();
        let kept = format!("version-{}.png", "a".repeat(64));
        let orphan = format!("version-{}.png", "b".repeat(64));
        fs::write(asset_dir.join(&kept), b"kept").unwrap();
        fs::write(asset_dir.join(&orphan), b"orphan").unwrap();
        fs::write(asset_dir.join("user-file.png"), b"unmanaged").unwrap();
        storage
            .replace_all(
                "character-versions",
                vec![json!({"id":"v1","avatarFilename":kept})],
            )
            .unwrap();

        let removed = cleanup_orphaned_character_version_media(&storage, &root).unwrap();

        assert_eq!(removed, 1);
        assert!(asset_dir.join(&kept).is_file());
        assert!(!asset_dir.join(&orphan).exists());
        assert!(asset_dir.join("user-file.png").is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
