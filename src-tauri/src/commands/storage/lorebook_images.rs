use super::images::percent_encode_component;
use super::media_uploads::{
    managed_record_file_path, persist_image_file_copy, persist_image_upload,
    remove_managed_record_file, safe_filename,
};
use super::shared::decode_path;
use super::*;

const LOREBOOK_IMAGE_PREFIX: &str = "marinara-lorebook-image:";

pub(crate) fn update_lorebook_image(
    state: &AppState,
    lorebook_id: &str,
    body: Value,
) -> AppResult<Value> {
    let previous = get_required_lorebook(state, lorebook_id)?;
    let stored = persist_image_upload(state, "lorebooks/images", lorebook_id, &body, "image")?;
    let updated = state.storage.patch(
        "lorebooks",
        lorebook_id,
        json!({
            "imagePath": format!("{LOREBOOK_IMAGE_PREFIX}{}", percent_encode_component(&stored.filename)),
            "imageFilePath": stored.absolute_path,
            "imageFilename": stored.filename,
            "imageUpdatedAt": now_iso()
        }),
    )?;
    remove_lorebook_image_file(state, &previous);
    Ok(updated)
}

pub(crate) fn remove_lorebook_image_file(state: &AppState, record: &Value) {
    if let Some(filename) = record.get("imageFilename").and_then(Value::as_str) {
        managed_thumbnails::remove_managed_thumbnail_files(
            state,
            managed_thumbnails::ManagedThumbnailKind::Lorebook,
            filename,
        );
    }
    remove_managed_record_file(
        state,
        "lorebooks/images",
        record,
        "imageFilePath",
        "imageFilename",
    )
}

pub(crate) fn lorebook_image_file_path(
    state: &AppState,
    encoded_filename: &str,
) -> AppResult<Value> {
    let filename = safe_filename(&decode_path(encoded_filename));
    let path = state
        .data_dir
        .join("lorebooks")
        .join("images")
        .join(filename);
    if !path.exists() || !path.is_file() {
        return Err(AppError::not_found("Lorebook image was not found"));
    }
    Ok(json!({ "path": path.to_string_lossy() }))
}

/// The picture fields for a copied lorebook (`duplicate_lorebook`), plus the copied file so a failed copy
/// can remove it again.
pub(crate) struct DuplicatedLorebookImage {
    pub(crate) fields: Option<Value>,
    pub(crate) copied_file: Option<String>,
}

/// Copies a lorebook's managed picture for its copy. No picture: nothing to set. A picture whose file is
/// gone: the copy gets no picture rather than pointing at the original's missing file.
pub(crate) fn duplicate_lorebook_image(
    state: &AppState,
    record: &Value,
) -> AppResult<DuplicatedLorebookImage> {
    let source = managed_record_file_path(
        state,
        "lorebooks/images",
        record,
        "imageFilePath",
        "imageFilename",
    )?;
    let Some(source) = source else {
        let had_picture = ["imagePath", "imageFilePath", "imageFilename"]
            .iter()
            .any(|key| record.get(*key).is_some_and(|value| !value.is_null()));
        return Ok(DuplicatedLorebookImage {
            fields: had_picture.then(|| {
                json!({ "imagePath": Value::Null, "imageFilePath": Value::Null, "imageFilename": Value::Null })
            }),
            copied_file: None,
        });
    };
    let hint = record
        .get("imageFilename")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("lorebook-copy");
    let stored = persist_image_file_copy(state, "lorebooks/images", hint, &source)?;
    Ok(DuplicatedLorebookImage {
        fields: Some(json!({
            "imagePath": format!("{LOREBOOK_IMAGE_PREFIX}{}", percent_encode_component(&stored.filename)),
            "imageFilePath": stored.absolute_path,
            "imageFilename": stored.filename,
            "imageUpdatedAt": now_iso()
        })),
        copied_file: Some(stored.absolute_path),
    })
}

fn get_required_lorebook(state: &AppState, lorebook_id: &str) -> AppResult<Value> {
    state
        .storage
        .get("lorebooks", lorebook_id)?
        .ok_or_else(|| AppError::not_found(format!("lorebooks/{lorebook_id} was not found")))
}
