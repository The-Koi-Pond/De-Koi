use super::shared::*;
use super::*;
use crate::storage_commands::images::percent_encode_component;
use std::path::{Path, PathBuf};

pub(crate) fn backgrounds_call(
    state: &AppState,
    method: &str,
    rest: &[&str],
    body: Value,
) -> AppResult<Value> {
    match (method, rest) {
        ("GET", []) => list_backgrounds(state),
        ("GET", ["tags"]) => background_tags(state),
        ("GET", ["file-path", encoded]) => {
            Ok(json!({ "path": state.backgrounds.absolute_path_string(&decode_path(encoded))? }))
        }
        ("POST", ["upload"]) => {
            let uploaded = decode_uploaded_image_file(&body)?;
            validate_background_upload(&uploaded)?;
            let filename = write_background_file(state, &uploaded.name, &uploaded.bytes)?;
            let meta = upsert_background_meta(
                state,
                &filename,
                json!({
                    "filename": filename,
                    "originalName": uploaded.name,
                    "contentType": uploaded.content_type,
                    "tags": [],
                    "source": "user"
                }),
            )?;
            Ok(json!({
                "success": true,
                "filename": filename,
                "url": format!("marinara-background:{}", filename),
                "originalName": meta.get("originalName").and_then(Value::as_str).unwrap_or(&filename),
                "tags": [],
                "item": background_item(state, &filename, &meta)?
            }))
        }
        ("PATCH", [id, "rename"]) => rename_background(state, id, body),
        ("PATCH", [id, "tags"]) => patch_background_tags(state, id, body),
        ("DELETE", [id]) => delete_background(state, id),
        _ => Err(AppError::new(
            "route_not_found",
            format!("Unknown backgrounds route: {method} /{}", rest.join("/")),
        )),
    }
}

fn list_backgrounds(state: &AppState) -> AppResult<Value> {
    let meta_rows = state.storage.list("background-metadata")?;
    let mut rows = Vec::new();
    for item in state.backgrounds.list(None)? {
        if item.get("type").and_then(Value::as_str) == Some("folder")
            || item.get("isDirectory").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let filename = item
            .get("name")
            .or_else(|| item.get("path"))
            .and_then(Value::as_str)
            .unwrap_or("background")
            .to_string();
        let meta = meta_rows
            .iter()
            .find(|row| row.get("filename").and_then(Value::as_str) == Some(filename.as_str()))
            .cloned()
            .unwrap_or_else(|| json!({ "filename": filename, "originalName": filename, "tags": [], "source": "user" }));
        rows.push(background_item(state, &filename, &meta)?);
    }
    let manifest = super::game_assets::game_assets_manifest(state)?;
    if let Some(game_backgrounds) = manifest
        .get("byCategory")
        .and_then(|by_category| by_category.get("backgrounds"))
        .and_then(Value::as_array)
    {
        for item in game_backgrounds {
            if let Some(row) = game_asset_background_item(item) {
                rows.push(row);
            }
        }
    }
    Ok(Value::Array(rows))
}

fn background_tags(state: &AppState) -> AppResult<Value> {
    let mut tags = std::collections::BTreeSet::new();
    for row in state.storage.list("background-metadata")? {
        for tag in string_array_from_value(row.get("tags")) {
            tags.insert(tag);
        }
    }
    Ok(Value::Array(tags.into_iter().map(Value::String).collect()))
}

fn patch_background_tags(state: &AppState, id: &str, body: Value) -> AppResult<Value> {
    let filename = decode_path(id);
    require_background_file(state, &filename)?;
    let tags = normalize_background_tags(body.get("tags"));
    let meta = upsert_background_meta(
        state,
        &filename,
        json!({
            "filename": filename,
            "tags": tags,
            "source": "user"
        }),
    )?;
    Ok(
        json!({ "tags": meta.get("tags").cloned().unwrap_or_else(|| json!([])), "item": background_item(state, &filename, &meta)? }),
    )
}

fn require_background_file(state: &AppState, filename: &str) -> AppResult<()> {
    let path = state.backgrounds.absolute_path(filename)?;
    match fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(AppError::not_found("Background was not found")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::not_found("Background was not found"))
        }
        Err(error) => Err(error.into()),
    }
}

fn rename_background(state: &AppState, id: &str, body: Value) -> AppResult<Value> {
    let old_filename = decode_path(id);
    let requested = required_string(&body, "name")?;
    let new_filename = safe_background_rename_filename(&old_filename, requested);
    if new_filename.is_empty() {
        return Err(AppError::invalid_input("Background name is invalid"));
    }
    managed_thumbnails::remove_managed_thumbnail_files(
        state,
        managed_thumbnails::ManagedThumbnailKind::Background,
        &old_filename,
    );
    let old_path = state.backgrounds.absolute_path(&old_filename)?;
    let new_path = unique_background_path(state.backgrounds.absolute_path(&new_filename)?)?;
    fs::rename(&old_path, &new_path)?;
    let actual_name = new_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or(new_filename);
    let old_meta = find_background_meta(state, &old_filename)?
        .unwrap_or_else(|| json!({ "filename": old_filename, "tags": [] }));
    if let Some(id) = old_meta.get("id").and_then(Value::as_str) {
        let _ = state.storage.delete("background-metadata", id);
    }
    let meta = upsert_background_meta(
        state,
        &actual_name,
        json!({
            "filename": actual_name,
            "originalName": old_meta.get("originalName").cloned().unwrap_or_else(|| json!(actual_name)),
            "tags": old_meta.get("tags").cloned().unwrap_or_else(|| json!([])),
            "source": "user"
        }),
    )?;
    Ok(json!({
        "success": true,
        "oldFilename": old_filename,
        "filename": actual_name,
        "url": format!("marinara-background:{}", actual_name),
        "item": background_item(state, &actual_name, &meta)?
    }))
}

fn delete_background(state: &AppState, id: &str) -> AppResult<Value> {
    let filename = decode_path(id);
    managed_thumbnails::remove_managed_thumbnail_files(
        state,
        managed_thumbnails::ManagedThumbnailKind::Background,
        &filename,
    );
    state.backgrounds.remove_file(&filename)?;
    if let Some(meta) = find_background_meta(state, &filename)? {
        if let Some(id) = meta.get("id").and_then(Value::as_str) {
            let _ = state.storage.delete("background-metadata", id);
        }
    }
    Ok(json!({ "deleted": true, "filename": filename }))
}

fn background_item(state: &AppState, filename: &str, meta: &Value) -> AppResult<Value> {
    let path = state.backgrounds.absolute_path(filename)?;
    let metadata = fs::metadata(&path)?;
    Ok(json!({
        "id": filename,
        "filename": filename,
        "name": filename,
        "path": filename,
        "absolutePath": path.to_string_lossy(),
        "url": format!("marinara-background:{}", filename),
        "originalName": meta.get("originalName").and_then(Value::as_str).unwrap_or(filename),
        "tags": meta.get("tags").cloned().unwrap_or_else(|| json!([])),
        "source": meta.get("source").and_then(Value::as_str).unwrap_or("user"),
        "type": "file",
        "isDirectory": false,
        "size": metadata.len(),
        "modified": now_iso()
    }))
}

fn game_asset_background_item(item: &Value) -> Option<Value> {
    let path = item.get("path").and_then(Value::as_str)?.trim();
    if path.is_empty() {
        return None;
    }
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| path.rsplit('/').next())
        .unwrap_or(path);
    let tag = item.get("tag").and_then(Value::as_str);
    let tags = item
        .get("subcategory")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|subcategory| !subcategory.is_empty())
        .map(|subcategory| json!([subcategory]))
        .unwrap_or_else(|| json!([]));
    Some(json!({
        "id": tag.unwrap_or(path),
        "filename": name,
        "name": name,
        "path": path,
        "absolutePath": item.get("absolutePath").cloned().unwrap_or(Value::Null),
        "url": format!("marinara-game-asset:{}", percent_encode_component(path)),
        "originalName": name,
        "tags": tags,
        "source": "game_asset",
        "tag": tag,
        "type": "file",
        "isDirectory": false,
        "ext": item.get("ext").cloned().unwrap_or(Value::Null),
        "editable": false,
        "deletable": false,
        "renameable": false
    }))
}

fn write_background_file(state: &AppState, original_name: &str, bytes: &[u8]) -> AppResult<String> {
    let filename = safe_uploaded_background_filename(original_name)?;
    let path = unique_background_path(state.backgrounds.absolute_path(&filename)?)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, bytes)?;
    Ok(path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or(filename))
}

fn upsert_background_meta(state: &AppState, filename: &str, value: Value) -> AppResult<Value> {
    if let Some(existing) = find_background_meta(state, filename)? {
        if let Some(id) = existing
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
        {
            let mut patch = ensure_object(value)?;
            for (key, old_value) in ensure_object(existing)? {
                patch.entry(key).or_insert(old_value);
            }
            patch.insert("filename".to_string(), Value::String(filename.to_string()));
            normalize_background_meta_tags(&mut patch);
            return state
                .storage
                .patch("background-metadata", &id, Value::Object(patch));
        }
    }
    let mut record = ensure_object(value)?;
    normalize_background_meta_tags(&mut record);
    state
        .storage
        .create("background-metadata", Value::Object(record))
}

fn find_background_meta(state: &AppState, filename: &str) -> AppResult<Option<Value>> {
    let mut filters = Map::new();
    filters.insert("filename".to_string(), Value::String(filename.to_string()));
    Ok(state
        .storage
        .list_where("background-metadata", &filters)?
        .into_iter()
        .next())
}

fn validate_background_upload(uploaded: &UploadedFile) -> AppResult<()> {
    let extension = supported_background_extension(&uploaded.name)
        .ok_or_else(unsupported_background_upload_error)?;
    let declared_extension = supported_background_content_type_extension(&uploaded.content_type)
        .ok_or_else(unsupported_background_upload_error)?;
    if !background_extensions_match(extension, declared_extension) {
        return Err(unsupported_background_upload_error());
    }
    let detected =
        image::guess_format(&uploaded.bytes).map_err(|_| unsupported_background_upload_error())?;
    let detected_extension = supported_background_image_format_extension(detected)
        .ok_or_else(unsupported_background_upload_error)?;
    image::load_from_memory_with_format(&uploaded.bytes, detected)
        .map_err(|_| unsupported_background_upload_error())?;
    if !background_extensions_match(extension, detected_extension)
        || !background_extensions_match(declared_extension, detected_extension)
    {
        return Err(unsupported_background_upload_error());
    }
    Ok(())
}

fn supported_background_content_type_extension(content_type: &str) -> Option<&'static str> {
    match content_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn supported_background_image_format_extension(format: image::ImageFormat) -> Option<&'static str> {
    match format {
        image::ImageFormat::Png => Some("png"),
        image::ImageFormat::Jpeg => Some("jpg"),
        image::ImageFormat::WebP => Some("webp"),
        image::ImageFormat::Gif => Some("gif"),
        _ => None,
    }
}

fn background_extensions_match(left: &str, right: &str) -> bool {
    canonical_background_extension(left) == canonical_background_extension(right)
}

fn canonical_background_extension(extension: &str) -> &str {
    if extension.eq_ignore_ascii_case("jpeg") {
        "jpg"
    } else {
        extension
    }
}

fn safe_uploaded_background_filename(name: &str) -> AppResult<String> {
    let extension =
        supported_background_extension(name).ok_or_else(unsupported_background_upload_error)?;
    let stem = safe_background_stem(name);
    Ok(format!(
        "{}.{}",
        if stem.is_empty() {
            "background"
        } else {
            stem.as_str()
        },
        extension
    ))
}

fn supported_background_extension(name: &str) -> Option<&'static str> {
    Path::new(name).extension().and_then(|ext| {
        match ext.to_string_lossy().to_ascii_lowercase().as_str() {
            "png" => Some("png"),
            "jpg" => Some("jpg"),
            "jpeg" => Some("jpeg"),
            "webp" => Some("webp"),
            "gif" => Some("gif"),
            _ => None,
        }
    })
}

fn unsupported_background_upload_error() -> AppError {
    AppError::invalid_input("Background uploads support PNG, JPEG, GIF, and WebP files")
}

fn safe_background_stem(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "background".to_string())
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ' ') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string()
}

fn safe_background_rename_filename(current_name: &str, requested_name: &str) -> String {
    let stem = safe_background_stem(requested_name);
    let ext = supported_background_extension(requested_name)
        .or_else(|| supported_background_extension(current_name))
        .unwrap_or("png");
    format!(
        "{}.{}",
        if stem.is_empty() {
            "background"
        } else {
            stem.as_str()
        },
        ext
    )
}

fn normalize_background_tags(value: Option<&Value>) -> Vec<String> {
    let mut tags = Vec::new();
    for raw in string_array_from_value(value) {
        let tag = raw
            .trim()
            .to_ascii_lowercase()
            .chars()
            .filter(|ch| {
                ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, ' ' | '_' | '-')
            })
            .collect::<String>();
        if !tag.is_empty() && tag.len() <= 40 && !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    tags
}

fn normalize_background_meta_tags(record: &mut Map<String, Value>) {
    if record.contains_key("tags") {
        let tags = normalize_background_tags(record.get("tags"));
        record.insert(
            "tags".to_string(),
            Value::Array(tags.into_iter().map(Value::String).collect()),
        );
    }
}

fn unique_background_path(path: PathBuf) -> AppResult<PathBuf> {
    if !path.exists() {
        return Ok(path);
    }
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "background".to_string());
    let ext = path
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..10_000 {
        let candidate = parent.join(format!("{stem}-{index}{ext}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::invalid_input(
        "Could not find an available background filename",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use base64::engine::general_purpose;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-backgrounds-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn upload_body(name: &str, content_type: &str, bytes: &[u8]) -> Value {
        json!({
            "file": {
                "name": name,
                "type": content_type,
                "size": bytes.len(),
                "base64": base64::Engine::encode(&general_purpose::STANDARD, bytes)
            }
        })
    }

    fn valid_png_bytes() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([255_u8, 0_u8, 0_u8, 255_u8]));
        let mut cursor = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .expect("test PNG should encode");
        cursor.into_inner()
    }

    fn svg_bytes() -> &'static [u8] {
        br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#
    }

    fn avif_magic_bytes() -> &'static [u8] {
        b"\0\0\0\x18ftypavif\0\0\0\0avifmif1"
    }

    fn svg_upload_body(name: &str) -> Value {
        upload_body(name, "image/svg+xml", svg_bytes())
    }

    #[test]
    fn patch_background_tags_rejects_missing_file_without_metadata() {
        let state = test_state("missing-tag-update");
        let result = backgrounds_call(
            &state,
            "PATCH",
            &["missing.png", "tags"],
            json!({ "tags": ["orphan"] }),
        );

        assert!(result.is_err(), "missing background update should fail");
        assert!(
            state
                .storage
                .list("background-metadata")
                .expect("metadata collection should list")
                .is_empty(),
            "failed tag update should not create stale metadata"
        );
    }

    #[test]
    fn patch_background_tags_normalizes_before_persisting_metadata() {
        let state = test_state("normalize-tags");
        std::fs::write(state.backgrounds.root().join("forest.png"), b"png")
            .expect("background fixture should be written");

        let result = backgrounds_call(
            &state,
            "PATCH",
            &["forest.png", "tags"],
            json!({
                "tags": [
                    "  Cozy Forest!!  ",
                    "cozy forest",
                    "Castle-01",
                    "bad/tag",
                    "   ",
                    "abcdefghijklmnopqrstuvwxyzabcdefghijklmno"
                ]
            }),
        )
        .expect("tag update should succeed");

        assert_eq!(
            result.get("tags").cloned(),
            Some(json!(["cozy forest", "castle-01", "badtag"]))
        );
        assert_eq!(
            backgrounds_call(&state, "GET", &["tags"], Value::Null)
                .expect("tags should list")
                .as_array()
                .expect("tags result should be an array"),
            &vec![json!("badtag"), json!("castle-01"), json!("cozy forest")]
        );
    }

    #[test]
    fn rename_background_preserves_existing_extension_when_request_has_none() {
        let state = test_state("rename-preserve-extension");
        for filename in ["forest.jpg", "sky.webp"] {
            std::fs::write(state.backgrounds.root().join(filename), b"image")
                .expect("background fixture should be written");
        }

        let jpg_result = backgrounds_call(
            &state,
            "PATCH",
            &["forest.jpg", "rename"],
            json!({ "name": "forest night" }),
        )
        .expect("jpg rename should succeed");
        let webp_result = backgrounds_call(
            &state,
            "PATCH",
            &["sky.webp", "rename"],
            json!({ "name": "sky morning" }),
        )
        .expect("webp rename should succeed");

        assert_eq!(
            jpg_result.get("filename").and_then(Value::as_str),
            Some("forest night.jpg")
        );
        assert_eq!(
            webp_result.get("filename").and_then(Value::as_str),
            Some("sky morning.webp")
        );
        assert!(state.backgrounds.root().join("forest night.jpg").is_file());
        assert!(state.backgrounds.root().join("sky morning.webp").is_file());
        assert!(!state.backgrounds.root().join("forest night.png").exists());
        assert!(!state.backgrounds.root().join("sky morning.png").exists());
    }

    #[test]
    fn upload_background_rejects_svg_without_writing_png_fallback() {
        let state = test_state("reject-svg-upload");
        let result = backgrounds_call(&state, "POST", &["upload"], svg_upload_body("wall.svg"));

        assert!(result.is_err(), "SVG background upload should fail");
        assert!(
            !state.backgrounds.root().join("wall.png").exists(),
            "unsupported SVG bytes should not be stored with a PNG extension"
        );
        assert!(
            state
                .storage
                .list("background-metadata")
                .expect("metadata collection should list")
                .is_empty(),
            "failed SVG upload should not create background metadata"
        );
    }

    #[test]
    fn upload_background_rejects_disguised_svg_without_writing_png() {
        let state = test_state("reject-disguised-svg-upload");
        let result = backgrounds_call(
            &state,
            "POST",
            &["upload"],
            upload_body("wall.png", "image/png", svg_bytes()),
        );

        assert!(
            result.is_err(),
            "SVG bytes wearing PNG metadata should fail"
        );
        assert!(
            !state.backgrounds.root().join("wall.png").exists(),
            "disguised SVG bytes should not be stored"
        );
        assert!(
            state
                .storage
                .list("background-metadata")
                .expect("metadata collection should list")
                .is_empty(),
            "failed disguised upload should not create background metadata"
        );
    }

    #[test]
    fn upload_background_rejects_mismatched_supported_metadata() {
        let state = test_state("reject-mismatched-upload");
        let result = backgrounds_call(
            &state,
            "POST",
            &["upload"],
            upload_body("wall.jpg", "image/jpeg", &valid_png_bytes()),
        );

        assert!(
            result.is_err(),
            "PNG bytes wearing JPEG metadata should fail"
        );
        assert!(
            !state.backgrounds.root().join("wall.jpg").exists(),
            "mismatched upload should not be stored"
        );
        assert!(
            state
                .storage
                .list("background-metadata")
                .expect("metadata collection should list")
                .is_empty(),
            "failed mismatched upload should not create background metadata"
        );
    }

    #[test]
    fn upload_background_rejects_avif_magic_bytes_without_writing_file_or_metadata() {
        let state = test_state("reject-avif-upload");
        let result = backgrounds_call(
            &state,
            "POST",
            &["upload"],
            upload_body("wall.avif", "image/avif", avif_magic_bytes()),
        );

        assert!(
            result.is_err(),
            "AVIF upload should fail until decoder-backed validation exists"
        );
        assert!(
            !state.backgrounds.root().join("wall.avif").exists(),
            "unsupported AVIF upload should not be stored"
        );
        assert!(
            state
                .storage
                .list("background-metadata")
                .expect("metadata collection should list")
                .is_empty(),
            "failed AVIF upload should not create background metadata"
        );
    }

    #[test]
    fn upload_background_accepts_valid_png_and_creates_metadata() {
        let state = test_state("accept-png-upload");
        let result = backgrounds_call(
            &state,
            "POST",
            &["upload"],
            upload_body("wall.png", "image/png", &valid_png_bytes()),
        )
        .expect("valid PNG upload should succeed");

        assert_eq!(result.get("success").and_then(Value::as_bool), Some(true));
        assert!(state.backgrounds.root().join("wall.png").exists());
        assert_eq!(
            state
                .storage
                .list("background-metadata")
                .expect("metadata collection should list")
                .len(),
            1
        );
    }

    #[test]
    fn list_backgrounds_includes_non_editable_game_asset_backgrounds() {
        let state = test_state("game-asset-list");
        std::fs::write(state.backgrounds.root().join("uploaded.png"), b"user")
            .expect("user background should be written");
        let game_background_path = state
            .game_assets
            .root()
            .join("backgrounds")
            .join("fantasy")
            .join("castle.png");
        std::fs::create_dir_all(
            game_background_path
                .parent()
                .expect("background has parent"),
        )
        .expect("game background folder should be created");
        std::fs::write(&game_background_path, b"game").expect("game background should be written");
        let game_music_path = state.game_assets.root().join("music").join("theme.mp3");
        std::fs::create_dir_all(game_music_path.parent().expect("music has parent"))
            .expect("game music folder should be created");
        std::fs::write(&game_music_path, b"music").expect("game music should be written");

        let rows = backgrounds_call(&state, "GET", &[], Value::Null)
            .expect("background list should be returned");
        let rows = rows.as_array().expect("background list should be an array");

        let user_row = rows
            .iter()
            .find(|row| row.get("filename").and_then(Value::as_str) == Some("uploaded.png"))
            .expect("user background row should still be listed");
        assert_eq!(user_row.get("source").and_then(Value::as_str), Some("user"));

        let game_row = rows
            .iter()
            .find(|row| {
                row.get("path").and_then(Value::as_str) == Some("backgrounds/fantasy/castle.png")
            })
            .expect("game asset background row should be listed");
        assert_eq!(
            game_row.get("source").and_then(Value::as_str),
            Some("game_asset")
        );
        assert_eq!(
            game_row.get("editable").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            game_row.get("deletable").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            game_row.get("renameable").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            game_row.get("url").and_then(Value::as_str),
            Some("marinara-game-asset:backgrounds%2Ffantasy%2Fcastle.png")
        );
        assert_eq!(game_row.get("tags").cloned(), Some(json!(["fantasy"])));
        assert!(
            rows.iter()
                .all(|row| row.get("path").and_then(Value::as_str) != Some("music/theme.mp3")),
            "non-background game assets should not be listed as picker backgrounds"
        );
    }

    #[test]
    fn list_backgrounds_includes_bundled_manifest_backgrounds_without_copying_media() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("marinara-backgrounds-default-list-{nonce}"));
        let defaults = std::env::temp_dir().join(format!("marinara-backgrounds-default-source-{nonce}"));
        let default_background = defaults.join("backgrounds").join("castle.jpg");
        std::fs::create_dir_all(default_background.parent().expect("background parent"))
            .expect("default background folder should be created");
        std::fs::create_dir_all(defaults.join("game-assets"))
            .expect("default game asset folder should be created");
        std::fs::write(&default_background, b"background")
            .expect("default background should be written");
        std::fs::write(
            defaults.join("game-assets").join("manifest.json"),
            serde_json::to_vec(&json!({
                "count": 1,
                "assets": {
                    "backgrounds:user:castle": {
                        "tag": "backgrounds:user:castle",
                        "category": "backgrounds",
                        "subcategory": "user",
                        "name": "castle",
                        "path": "__user_bg__/castle.jpg",
                        "ext": ".jpg"
                    }
                }
            }))
            .expect("manifest should encode"),
        )
        .expect("default manifest should be written");
        let state = AppState::from_data_dir(&root, vec![defaults.clone()])
            .expect("state should initialize");

        let rows = backgrounds_call(&state, "GET", &[], Value::Null)
            .expect("background list should be returned");
        let rows = rows.as_array().expect("background rows should be an array");
        let default_row = rows
            .iter()
            .find(|row| row.get("path").and_then(Value::as_str) == Some("__user_bg__/castle.jpg"))
            .expect("bundled default background should be listed");

        assert_eq!(default_row.get("source").and_then(Value::as_str), Some("game_asset"));
        assert_eq!(
            default_row.get("absolutePath").and_then(Value::as_str).map(PathBuf::from),
            Some(default_background)
        );
        assert!(
            !state.backgrounds.root().join("castle.jpg").exists(),
            "listing default backgrounds should not copy bundled media into the managed background root"
        );

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(defaults);
    }
    #[test]
    fn background_tag_update_rejects_missing_file_without_metadata() {
        let state = test_state("missing-tags");

        let error = backgrounds_call(
            &state,
            "PATCH",
            &["missing.png", "tags"],
            json!({ "tags": ["orphan"] }),
        )
        .expect_err("missing background should reject tag updates");

        assert_eq!(error.code, "not_found");
        assert!(
            state
                .storage
                .list("background-metadata")
                .expect("background metadata should be readable")
                .is_empty(),
            "failed tag update must not create metadata"
        );
    }
}
