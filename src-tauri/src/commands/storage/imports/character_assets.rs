use super::super::media_uploads::{
    decode_image_payload, extension_for_image_mime, is_inline_image_data_url, persist_image_bytes,
    persist_image_file_copy, safe_filename,
};
use super::super::shared::*;
use super::*;

pub(super) struct ImportedAvatarReference {
    pub(super) asset_url: String,
    pub(super) absolute_path: String,
    pub(super) filename: String,
}

pub(super) fn imported_avatar_reference(
    state: &AppState,
    payload: &Value,
    filename: Option<&str>,
    trusted_avatar_source: Option<&Path>,
) -> AppResult<Option<ImportedAvatarReference>> {
    imported_avatar_reference_in_folder(
        state,
        payload,
        filename,
        trusted_avatar_source,
        "avatars/characters",
    )
}

pub(super) fn imported_avatar_reference_in_folder(
    state: &AppState,
    payload: &Value,
    filename: Option<&str>,
    trusted_avatar_source: Option<&Path>,
    folder: &str,
) -> AppResult<Option<ImportedAvatarReference>> {
    if let Some(source) = trusted_avatar_source {
        let filename_hint = source
            .file_name()
            .and_then(|value| value.to_str())
            .or(filename)
            .unwrap_or("avatar.png");
        let stored = persist_image_file_copy(state, folder, filename_hint, source)?;
        return Ok(Some(ImportedAvatarReference {
            asset_url: stored.asset_url,
            absolute_path: stored.absolute_path,
            filename: stored.filename,
        }));
    }
    let Some(value) = payload.get("_avatarDataUrl").and_then(Value::as_str) else {
        return Ok(None);
    };
    if !is_inline_image_data_url(value) {
        return Ok(None);
    }
    let (mime, bytes) = decode_image_payload(value, "avatar")?;
    let fallback = payload
        .get("data")
        .and_then(|data| data.get("name"))
        .or_else(|| payload.get("name"))
        .and_then(Value::as_str)
        .or(filename)
        .unwrap_or("avatar");
    let stored = persist_image_bytes(state, folder, &safe_filename(fallback), &bytes, &mime)?;
    Ok(Some(ImportedAvatarReference {
        asset_url: stored.asset_url,
        absolute_path: stored.absolute_path,
        filename: stored.filename,
    }))
}

fn public_profile_banner_filename(data: &Value, mime: &str) -> String {
    let ext = extension_for_image_mime(mime).unwrap_or("png");
    let name = data
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("character");
    format!("{}-public-profile-banner.{ext}", safe_filename(name))
}

pub(super) fn materialize_imported_public_profile_banner(
    state: &AppState,
    character_id: &str,
    character: &mut Value,
    created_gallery_id: &mut Option<String>,
    gallery_file_path: &mut Option<String>,
) -> AppResult<bool> {
    let Some(data) = character.get("data") else {
        return Ok(false);
    };
    let Some(banner) = data
        .pointer("/extensions/publicProfile/bannerImage")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_inline_image_data_url(value))
        .map(ToOwned::to_owned)
    else {
        return Ok(false);
    };

    let (mime, bytes) = decode_image_payload(&banner, "public profile banner")?;
    let filename = public_profile_banner_filename(data, &mime);
    let gallery = upload_gallery_image(
        state,
        "character-gallery",
        "characterId",
        character_id,
        json!({
            "file": {
                "name": filename,
                "type": mime,
                "base64": general_purpose::STANDARD.encode(bytes)
            }
        }),
    )?;
    *created_gallery_id = gallery
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    *gallery_file_path = gallery
        .get("filePath")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let Some(url) = gallery
        .get("url")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
    else {
        return Err(AppError::new(
            "storage_error",
            "Imported public profile banner gallery row is missing a URL",
        ));
    };

    let mut data = data.clone();
    let data_object = data
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Imported character data must be an object"))?;
    let extensions = data_object
        .entry("extensions".to_string())
        .or_insert_with(|| json!({}));
    let extensions = extensions.as_object_mut().ok_or_else(|| {
        AppError::invalid_input("Imported character extensions must be an object")
    })?;
    let public_profile = extensions
        .entry("publicProfile".to_string())
        .or_insert_with(|| json!({}));
    let public_profile = public_profile
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Imported public profile must be an object"))?;
    public_profile.insert("bannerImage".to_string(), Value::String(url));
    *character = state
        .storage
        .patch("characters", character_id, json!({ "data": data }))?;
    Ok(true)
}
