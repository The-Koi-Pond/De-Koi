use super::shared::*;
use super::*;
use std::collections::HashSet;
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
            Ok(json!({ "path": state.background_path(&decode_path(encoded))?.to_string_lossy() }))
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
    let user_filenames: HashSet<String> = rows
        .iter()
        .filter_map(|row| {
            row.get("filename")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect();
    rows.extend(built_in_background_items(state, &user_filenames)?);
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

/// Backgrounds that ship with the app. They are read-only and listed after the user's
/// own; a user file with the same name hides the built-in one.
fn built_in_background_items(
    state: &AppState,
    user_filenames: &HashSet<String>,
) -> AppResult<Vec<Value>> {
    let mut seen = user_filenames.clone();
    let mut items = Vec::new();
    for default_data in &state.default_data_roots {
        let dir = default_data.join("backgrounds");
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let tags = built_in_background_tags(&dir)?;
        let mut files = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .collect::<Vec<_>>();
        files.sort();
        for path in files {
            let Some(filename) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if supported_background_extension(filename).is_none()
                || !seen.insert(filename.to_string())
            {
                continue;
            }
            let metadata = fs::metadata(&path)?;
            items.push(json!({
                "id": filename,
                "filename": filename,
                "name": filename,
                "path": filename,
                "absolutePath": path.to_string_lossy(),
                "url": format!("marinara-background:{filename}"),
                "originalName": filename,
                "tags": tags.get(filename).cloned().unwrap_or_else(|| json!([])),
                "source": "built_in",
                "type": "file",
                "isDirectory": false,
                "size": metadata.len(),
                "editable": false,
                "deletable": false,
                "renameable": false
            }));
        }
    }
    Ok(items)
}

fn built_in_background_tags(dir: &Path) -> AppResult<Map<String, Value>> {
    let meta_path = dir.join("meta.json");
    if !meta_path.is_file() {
        return Ok(Map::new());
    }
    let meta: Value = serde_json::from_str(&fs::read_to_string(meta_path)?)?;
    Ok(meta
        .as_object()
        .map(|entries| {
            entries
                .iter()
                .map(|(filename, entry)| {
                    let tags = normalize_background_tags(entry.get("tags"));
                    (filename.clone(), json!(tags))
                })
                .collect()
        })
        .unwrap_or_default())
}

fn write_background_file(state: &AppState, original_name: &str, bytes: &[u8]) -> AppResult<String> {
    let filename = safe_uploaded_background_filename(original_name)?;
    let path = unique_background_path(state.backgrounds.absolute_path(&filename)?)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_managed_file_atomically(&path, bytes)?;
    Ok(path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or(filename))
}

/// Copies an image from outside the background library into it as a user background and
/// returns its library filename. Used when retiring the old Game asset library.
pub(crate) fn import_background_file(state: &AppState, source: &Path) -> AppResult<String> {
    let original_name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| AppError::invalid_input("Background source has no file name"))?;
    if supported_background_extension(&original_name).is_none() {
        return Err(AppError::invalid_input(format!(
            "{original_name} is not a supported background image"
        )));
    }
    let bytes = fs::read(source)?;
    let filename = write_background_file(state, &original_name, &bytes)?;
    upsert_background_meta(
        state,
        &filename,
        json!({
            "filename": filename,
            "originalName": original_name,
            "tags": [],
            "source": "user"
        }),
    )?;
    Ok(filename)
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
    fn list_backgrounds_includes_read_only_built_in_backgrounds_without_copying_media() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("marinara-backgrounds-default-list-{nonce}"));
        let defaults =
            std::env::temp_dir().join(format!("marinara-backgrounds-default-source-{nonce}"));
        let default_dir = defaults.join("backgrounds");
        std::fs::create_dir_all(&default_dir).expect("default background folder should be created");
        std::fs::write(default_dir.join("castle.jpg"), b"background")
            .expect("default background should be written");
        std::fs::write(default_dir.join("lake.jpg"), b"lake")
            .expect("second default should be written");
        std::fs::write(
            default_dir.join("meta.json"),
            br#"{ "castle.jpg": { "tags": ["Castle", "fantasy"] } }"#,
        )
        .expect("default meta should be written");
        let state = AppState::from_data_dir(&root, vec![defaults.clone()])
            .expect("state should initialize");
        // A user file with a built-in's name hides the built-in copy.
        std::fs::write(state.backgrounds.root().join("lake.jpg"), b"my lake")
            .expect("user background should be written");

        let rows = backgrounds_call(&state, "GET", &[], Value::Null)
            .expect("background list should be returned");
        let rows = rows.as_array().expect("background rows should be an array");
        let castle = rows
            .iter()
            .find(|row| row.get("filename").and_then(Value::as_str) == Some("castle.jpg"))
            .expect("built-in background should be listed");
        assert_eq!(castle["source"], "built_in");
        assert_eq!(castle["url"], "marinara-background:castle.jpg");
        assert_eq!(castle["tags"], json!(["castle", "fantasy"]));
        assert_eq!(castle["deletable"], false);
        let built_in_castle = std::fs::canonicalize(default_dir.join("castle.jpg")).unwrap();
        assert_eq!(
            castle["absolutePath"]
                .as_str()
                .map(|path| std::fs::canonicalize(path).unwrap()),
            Some(built_in_castle.clone())
        );
        let lakes = rows
            .iter()
            .filter(|row| row.get("filename").and_then(Value::as_str) == Some("lake.jpg"))
            .collect::<Vec<_>>();
        assert_eq!(lakes.len(), 1, "the user's lake.jpg hides the built-in one");
        assert_eq!(lakes[0]["source"], "user");
        assert!(rows.iter().all(|row| row["filename"] != "meta.json"));
        assert!(
            !state.backgrounds.root().join("castle.jpg").exists(),
            "listing built-in backgrounds should not copy them into the user background folder"
        );
        let path = backgrounds_call(&state, "GET", &["file-path", "castle.jpg"], Value::Null)
            .expect("built-in background path should resolve");
        assert_eq!(
            path["path"]
                .as_str()
                .map(|path| std::fs::canonicalize(path).unwrap()),
            Some(built_in_castle)
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
