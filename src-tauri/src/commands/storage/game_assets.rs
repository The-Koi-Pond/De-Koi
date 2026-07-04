use super::*;
use std::path::Path;

const USER_BACKGROUND_MANIFEST_PREFIX: &str = "__user_bg__/";

pub(crate) fn game_assets_list(state: &AppState, path: Option<&str>) -> AppResult<Value> {
    Ok(json!({
        "items": state.game_assets.list(path)?,
        "root": state.game_assets.root().to_string_lossy()
    }))
}

pub(crate) fn game_assets_manifest(state: &AppState) -> AppResult<Value> {
    merged_game_assets_manifest(state)
}

pub(crate) fn game_assets_tree(state: &AppState) -> AppResult<Value> {
    state.game_assets.tree()
}

pub(crate) fn game_assets_rescan(state: &AppState) -> AppResult<Value> {
    let manifest = merged_game_assets_manifest(state)?;
    Ok(json!({ "ok": true, "manifest": manifest }))
}

pub(crate) fn game_assets_file_path(state: &AppState, path: &str) -> AppResult<Value> {
    Ok(json!({ "path": state.game_asset_path(path)?.to_string_lossy() }))
}

pub(crate) fn game_assets_file_info(state: &AppState, path: &str) -> AppResult<Value> {
    if state.game_assets.absolute_path(path)?.exists() {
        return state.game_assets.file_info(path);
    }
    let resolved = state.game_asset_path(path)?;
    if !resolved.exists() {
        return state.game_assets.file_info(path);
    }
    let metadata = fs::metadata(&resolved)?;
    let name = resolved
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    Ok(json!({
        "name": name,
        "path": path,
        "absolutePath": resolved.to_string_lossy(),
        "size": if metadata.is_file() { metadata.len() } else { 0 },
        "format": resolved.extension().map(|ext| ext.to_string_lossy().to_ascii_lowercase()),
        "modified": now_iso(),
        "created": now_iso()
    }))
}

#[cfg(feature = "desktop")]
pub(crate) fn game_assets_open_folder(state: &AppState, body: Value) -> AppResult<Value> {
    let subfolder = body.get("subfolder").and_then(Value::as_str).unwrap_or("");
    let path = state.game_assets.absolute_path(subfolder)?;
    if !path.exists() {
        fs::create_dir_all(&path)?;
    }
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|error| AppError::new("open_folder_failed", error.to_string()))?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy() }))
}

pub(crate) fn game_assets_folder_description(state: &AppState, body: Value) -> AppResult<Value> {
    let path = body.get("path").and_then(Value::as_str).unwrap_or("");
    let description = body
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    state.game_assets.set_folder_description(path, description)
}

pub(crate) fn game_assets_upload(state: &AppState, body: Value) -> AppResult<Value> {
    let category = body
        .get("category")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input("category is required"))?;
    let subcategory = body.get("subcategory").and_then(Value::as_str);
    let file = body
        .get("file")
        .ok_or_else(|| AppError::invalid_input("file is required"))?;
    state.game_assets.write_upload(category, subcategory, file)
}

fn merged_game_assets_manifest(state: &AppState) -> AppResult<Value> {
    let mut assets = Map::new();
    for default_data in &state.default_data_roots {
        merge_manifest_assets(&mut assets, &bundled_manifest(default_data)?);
    }
    merge_manifest_assets(
        &mut assets,
        &state
            .game_assets
            .manifest_with_backgrounds(&state.backgrounds)?,
    );
    Ok(manifest_from_assets(
        assets,
        state.game_assets.root(),
        Some(state.backgrounds.root()),
    ))
}

fn bundled_manifest(default_data: &Path) -> AppResult<Value> {
    let manifest_path = default_data.join("game-assets").join("manifest.json");
    if !manifest_path.exists() {
        return Ok(json!({ "assets": {} }));
    }
    let raw = fs::read_to_string(manifest_path)?;
    let manifest: Value = serde_json::from_str(&raw)?;
    let mut assets = Map::new();
    if let Some(source_assets) = manifest.get("assets").and_then(Value::as_object) {
        for (key, value) in source_assets {
            if let Some(entry) = bundled_manifest_entry(default_data, key, value) {
                assets.insert(key.clone(), entry);
            }
        }
    }
    Ok(json!({ "assets": assets }))
}

fn bundled_manifest_entry(default_data: &Path, key: &str, value: &Value) -> Option<Value> {
    let path = value.get("path").and_then(Value::as_str)?.trim();
    if path.is_empty() {
        return None;
    }
    let absolute = if let Some(background) = path.strip_prefix(USER_BACKGROUND_MANIFEST_PREFIX) {
        default_data.join("backgrounds").join(background)
    } else {
        default_data.join("game-assets").join(path)
    };
    if !absolute.is_file() {
        return None;
    }
    let mut object = value.as_object().cloned().unwrap_or_default();
    object
        .entry("tag".to_string())
        .or_insert_with(|| Value::String(key.to_string()));
    object.insert(
        "absolutePath".to_string(),
        Value::String(absolute.to_string_lossy().to_string()),
    );
    object
        .entry("source".to_string())
        .or_insert_with(|| Value::String("default".to_string()));
    if path.starts_with(USER_BACKGROUND_MANIFEST_PREFIX) {
        object
            .entry("managedSource".to_string())
            .or_insert_with(|| Value::String("backgrounds".to_string()));
    }
    Some(Value::Object(object))
}

fn merge_manifest_assets(target: &mut Map<String, Value>, manifest: &Value) {
    let Some(source_assets) = manifest.get("assets").and_then(Value::as_object) else {
        return;
    };
    for (key, value) in source_assets {
        let tag = value
            .get("tag")
            .and_then(Value::as_str)
            .filter(|tag| !tag.trim().is_empty())
            .unwrap_or(key)
            .to_string();
        target.insert(tag, value.clone());
    }
}

fn manifest_from_assets(
    assets: Map<String, Value>,
    root: &Path,
    background_root: Option<&Path>,
) -> Value {
    let mut sorted_assets = assets.into_iter().collect::<Vec<_>>();
    sorted_assets.sort_by(|left, right| left.0.cmp(&right.0));

    let mut asset_map = Map::new();
    let mut by_category: Map<String, Value> = Map::new();
    for (key, value) in sorted_assets {
        if let Some(category) = value.get("category").and_then(Value::as_str) {
            by_category
                .entry(category.to_string())
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .expect("by_category values are arrays")
                .push(value.clone());
        }
        asset_map.insert(key, value);
    }

    json!({
        "scannedAt": now_iso(),
        "count": asset_map.len(),
        "root": root.to_string_lossy(),
        "backgroundRoot": background_root.map(|path| path.to_string_lossy().to_string()),
        "assets": asset_map,
        "byCategory": by_category
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempRoot(PathBuf);

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn temp_root(test_name: &str) -> TempRoot {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        TempRoot(std::env::temp_dir().join(format!("marinara-game-assets-{test_name}-{suffix}")))
    }

    #[test]
    fn manifest_includes_bundled_default_assets_without_copying_media() {
        let root = temp_root("lazy-default-media");
        let defaults = temp_root("lazy-default-media-source");
        let asset_path = defaults
            .0
            .join("game-assets")
            .join("music")
            .join("theme.mp3");
        std::fs::create_dir_all(asset_path.parent().expect("asset parent"))
            .expect("default game asset folder should be created");
        std::fs::write(&asset_path, b"music").expect("default game asset should be written");
        std::fs::write(
            defaults.0.join("game-assets").join("manifest.json"),
            serde_json::to_vec(&json!({
                "count": 1,
                "assets": {
                    "music:theme": {
                        "tag": "music:theme",
                        "category": "music",
                        "subcategory": "",
                        "name": "theme",
                        "path": "music/theme.mp3",
                        "ext": ".mp3"
                    }
                },
                "byCategory": {
                    "music": [{
                        "tag": "music:theme",
                        "category": "music",
                        "subcategory": "",
                        "name": "theme",
                        "path": "music/theme.mp3",
                        "ext": ".mp3"
                    }]
                }
            }))
            .expect("manifest should encode"),
        )
        .expect("default manifest should be written");

        let state = AppState::from_data_dir(&root.0, vec![defaults.0.clone()])
            .expect("state should initialize");
        let manifest = game_assets_manifest(&state).expect("manifest should load");
        let asset = manifest["assets"]["music:theme"]
            .as_object()
            .expect("bundled asset should be present");

        assert_eq!(
            asset.get("path").and_then(Value::as_str),
            Some("music/theme.mp3")
        );
        assert_eq!(
            asset
                .get("absolutePath")
                .and_then(Value::as_str)
                .map(PathBuf::from),
            Some(asset_path.clone())
        );
        assert!(
            !state.game_assets.root().join("music/theme.mp3").exists(),
            "manifest discovery should not copy bundled media into the managed asset root"
        );
    }
}
