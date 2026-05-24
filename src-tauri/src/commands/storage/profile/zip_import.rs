use super::assets::{normalize_zip_entry_name, restore_profile_zip_assets};
use super::{
    finish_profile_import_assets, import_profile_collections_with_restored_assets,
    legacy::import_legacy_profile_tables_with_restored_assets,
};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::Value;
use std::fs::File;
use std::io::Read;
use std::path::Path;

const PROFILE_JSON_ENTRY: &str = "marinara-profile.json";
const MAX_PROFILE_JSON_BYTES: usize = 128 * 1024 * 1024;

pub(super) fn import_profile_zip(state: &AppState, path: &Path) -> AppResult<Value> {
    let file = File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| AppError::invalid_input(format!("Could not read profile ZIP: {error}")))?;
    let names = zip_entry_names(&mut archive)?;
    let (profile_entry, profile_prefix) = profile_json_entry(&names)?;
    let envelope = read_profile_zip_json(&mut archive, &profile_entry)?;
    let data = envelope
        .get("data")
        .and_then(Value::as_object)
        .filter(|_| envelope.get("type").and_then(Value::as_str) == Some("marinara_profile"))
        .ok_or_else(|| AppError::invalid_input("Invalid Marinara profile export"))?;
    let files = data
        .get("fileStorage")
        .and_then(|value| value.get("files"))
        .or_else(|| data.get("assets"));
    if let Some(collections) = data.get("collections").and_then(Value::as_object) {
        let mut restored_assets =
            restore_profile_zip_assets(state, &mut archive, &names, &profile_prefix, files)?;
        let restored_count = restored_assets.restored();
        let result = import_profile_collections_with_restored_assets(
            state,
            collections,
            restored_count,
            || restored_assets.install(),
        );
        finish_profile_import_assets(restored_assets, result)
    } else {
        let tables = data
            .get("fileStorage")
            .and_then(|value| value.get("tables"))
            .and_then(Value::as_object)
            .ok_or_else(|| {
                AppError::invalid_input(
                    "Profile ZIP must contain data.collections or data.fileStorage.tables",
                )
            })?;
        let mut restored_assets =
            restore_profile_zip_assets(state, &mut archive, &names, &profile_prefix, files)?;
        let restored_count = restored_assets.restored();
        let staging_root = restored_assets.staging_root().map(Path::to_path_buf);
        let result = import_legacy_profile_tables_with_restored_assets(
            state,
            tables,
            restored_count,
            staging_root.as_deref(),
            || restored_assets.install(),
        );
        finish_profile_import_assets(restored_assets, result)
    }
}

fn zip_entry_names<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> AppResult<Vec<String>> {
    let mut names = Vec::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|error| {
            AppError::invalid_input(format!("Could not read profile ZIP entry: {error}"))
        })?;
        names.push(file.name().to_string());
    }
    Ok(names)
}

fn profile_json_entry(names: &[String]) -> AppResult<(String, String)> {
    for name in names {
        let normalized = normalize_zip_entry_name(name);
        if normalized == PROFILE_JSON_ENTRY
            || normalized.ends_with(&format!("/{PROFILE_JSON_ENTRY}"))
        {
            let prefix = normalized
                .strip_suffix(PROFILE_JSON_ENTRY)
                .unwrap_or("")
                .trim_end_matches('/')
                .to_string();
            return Ok((name.clone(), prefix));
        }
    }
    Err(AppError::invalid_input(
        "Profile ZIP is missing marinara-profile.json",
    ))
}

fn read_profile_zip_json<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    entry_name: &str,
) -> AppResult<Value> {
    let entry = archive.by_name(entry_name).map_err(|error| {
        AppError::invalid_input(format!("Could not read marinara-profile.json: {error}"))
    })?;
    let mut raw = Vec::new();
    let mut limited = entry.take(MAX_PROFILE_JSON_BYTES as u64);
    limited.read_to_end(&mut raw)?;
    if raw.len() == MAX_PROFILE_JSON_BYTES {
        return Err(AppError::invalid_input(
            "marinara-profile.json in profile ZIP is too large",
        ));
    }
    Ok(serde_json::from_slice(&raw)?)
}
