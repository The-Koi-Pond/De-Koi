use super::super::*;
use super::backgrounds::ST_BACKGROUND_EXTENSIONS;
use super::*;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

pub(super) fn resolve_st_data_dir(root: &Path) -> AppResult<Option<PathBuf>> {
    let default_user = root.join("data").join("default-user");
    if default_user.join("characters").is_dir() {
        return Ok(Some(default_user));
    }

    let data_parent = root.join("data");
    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(&data_parent) {
        for entry in entries.filter_map(Result::ok) {
            let candidate = entry.path();
            if candidate.is_dir() && candidate.join("characters").is_dir() {
                candidates.push(candidate);
            }
        }
    }
    candidates.sort();
    match candidates.len() {
        0 => {}
        1 => return Ok(candidates.pop()),
        _ => {
            return Err(AppError::invalid_input(
                "Multiple SillyTavern user data directories were found. Select data/default-user or a specific user data folder before scanning or importing.",
            ));
        }
    }

    let public = root.join("public");
    if public.join("characters").is_dir() {
        return Ok(Some(public));
    }
    if root.join("characters").is_dir() {
        return Ok(Some(root.to_path_buf()));
    }
    Ok(None)
}

fn path_id(category: &str, data_dir: &Path, path: &Path) -> String {
    let relative = path
        .strip_prefix(data_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    format!("{category}:{relative}")
}

pub(super) fn path_from_id(data_dir: &Path, category: &str, id: &str) -> AppResult<PathBuf> {
    let prefix = format!("{category}:");
    let relative = id
        .strip_prefix(&prefix)
        .ok_or_else(|| AppError::invalid_input(format!("Invalid {category} import id")))?;
    let candidate = Path::new(relative);
    if candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(AppError::invalid_input(
            "Import id must not contain parent path segments",
        ));
    }
    let base = data_dir.canonicalize().map_err(AppError::from)?;
    let path = base
        .join(candidate)
        .canonicalize()
        .map_err(AppError::from)?;
    if path.starts_with(&base) {
        Ok(path)
    } else {
        Err(AppError::invalid_input(
            "Import id resolves outside the SillyTavern data directory",
        ))
    }
}

fn list_files(data_dir: &Path, dir: &Path, extensions: &[&str], recursive: bool) -> Vec<PathBuf> {
    let Ok(base) = data_dir.canonicalize() else {
        return Vec::new();
    };
    list_files_inner(&base, dir, extensions, recursive)
}

fn list_files_inner(base: &Path, dir: &Path, extensions: &[&str], recursive: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if !dir.is_dir() {
        return files;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return files;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() && recursive {
            let Ok(canonical) = path.canonicalize() else {
                continue;
            };
            if canonical.starts_with(base) {
                files.extend(list_files_inner(base, &path, extensions, true));
            }
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        if !canonical.starts_with(base) {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!(".{}", ext.to_ascii_lowercase()))
            .unwrap_or_default();
        if extensions.iter().any(|allowed| *allowed == ext) {
            files.push(path);
        }
    }
    files.sort();
    files
}

pub(super) fn read_st_persona_settings(
    data_dir: &Path,
) -> (HashMap<String, String>, HashMap<String, String>) {
    let settings_path = data_dir.join("settings.json");
    let Ok(raw) = fs::read_to_string(settings_path) else {
        return (HashMap::new(), HashMap::new());
    };
    let Ok(settings) = serde_json::from_str::<Value>(&raw) else {
        return (HashMap::new(), HashMap::new());
    };
    let power_user = settings
        .get("power_user")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let names = power_user
        .get("personas")
        .and_then(Value::as_object)
        .map(|values| {
            values
                .iter()
                .filter_map(|(key, value)| {
                    value
                        .as_str()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|value| (key.to_string(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    let descriptions = power_user
        .get("persona_descriptions")
        .and_then(Value::as_object)
        .map(|values| {
            values
                .iter()
                .filter_map(|(key, value)| {
                    let description = value
                        .as_str()
                        .map(str::to_string)
                        .or_else(|| {
                            value
                                .get("description")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .unwrap_or_default();
                    (!description.trim().is_empty()).then(|| (key.to_string(), description))
                })
                .collect()
        })
        .unwrap_or_default();
    (names, descriptions)
}

fn st_persona_scan_item(
    data_dir: &Path,
    path: &Path,
    names: &HashMap<String, String>,
    descriptions: &HashMap<String, String>,
) -> Value {
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    json!({
        "id": path_id("personas", data_dir, path),
        "path": path.to_string_lossy(),
        "name": names.get(&filename).cloned().unwrap_or_else(|| file_stem(path)),
        "description": descriptions.get(&filename).cloned().unwrap_or_default(),
        "modifiedAt": modified_at(path),
        "media": true,
    })
}

fn scan_item(category: &str, data_dir: &Path, path: &Path) -> Value {
    json!({
        "id": path_id(category, data_dir, path),
        "path": path.to_string_lossy(),
        "name": file_stem(path),
        "modifiedAt": modified_at(path),
    })
}

fn parsed_character_scan_item(data_dir: &Path, path: &Path) -> Option<Value> {
    let filename = path.file_name()?.to_string_lossy().to_string();
    let bytes = fs::read(path).ok()?;
    let payload = parse_character_file_from_path(&filename, path, &bytes).ok()?;
    let data = source_character_data(&payload);
    let name = non_empty_string(vec![
        data.get("name"),
        payload.get("char_name"),
        payload.get("name"),
    ])
    .unwrap_or_else(|| file_stem(path));
    let mut item = scan_item("characters", data_dir, path);
    if let Some(object) = item.as_object_mut() {
        object.insert("name".to_string(), Value::String(name));
        object.insert(
            "format".to_string(),
            Value::String(
                path.extension()
                    .and_then(|ext| ext.to_str())
                    .unwrap_or("json")
                    .to_ascii_lowercase(),
            ),
        );
    }
    Some(item)
}

fn st_preset_scan_item(data_dir: &Path, path: &Path, payload: Option<&Value>) -> Value {
    let mut item = scan_item("presets", data_dir, path);
    if let Some(object) = item.as_object_mut() {
        if let Some(name) = payload.and_then(|payload| {
            non_empty_string(vec![
                payload.get("name"),
                payload.get("preset_name"),
                payload.get("displayName"),
            ])
        }) {
            object.insert("name".to_string(), Value::String(name));
        }
        let name = file_stem(path).to_ascii_lowercase();
        object.insert(
            "isBuiltin".to_string(),
            Value::Bool(matches!(
                name.as_str(),
                "default"
                    | "deterministic"
                    | "neutral"
                    | "universal-creative"
                    | "universal-light"
                    | "universal-super-creative"
            )),
        );
        let folder_name = path
            .parent()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        object.insert("sourceFolder".to_string(), Value::String(folder_name));
    }
    item
}

fn parsed_preset_scan_item(data_dir: &Path, path: &Path) -> Option<Value> {
    let bytes = fs::read(path).ok()?;
    let payload = parse_object(&bytes).ok()?;
    Some(st_preset_scan_item(data_dir, path, Some(&payload)))
}

fn parsed_lorebook_scan_item(data_dir: &Path, path: &Path) -> Option<Value> {
    let bytes = fs::read(path).ok()?;
    let payload = parse_object(&bytes).ok()?;
    let mut item = scan_item("lorebooks", data_dir, path);
    if let Some(name) = non_empty_string(vec![payload.get("name"), payload.get("bookName")]) {
        if let Some(object) = item.as_object_mut() {
            object.insert("name".to_string(), Value::String(name));
        }
    }
    Some(item)
}

#[derive(Clone, Debug, Default)]
pub(super) struct StGroupMetadata {
    pub(super) id: Option<String>,
    pub(super) chat_id: Option<String>,
    pub(super) name: String,
    pub(super) members: Vec<String>,
}

impl StGroupMetadata {
    pub(super) fn display_name(&self, fallback: &Path) -> String {
        if self.name.trim().is_empty() {
            file_stem(fallback).replace('_', " ")
        } else {
            self.name.clone()
        }
    }
}

fn string_array_from_json(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn read_st_group_metadata_file(path: &Path) -> Option<StGroupMetadata> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<Value>(&raw).ok()?;
    let name = parsed
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| file_stem(path));
    Some(StGroupMetadata {
        id: parsed
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        chat_id: parsed
            .get("chat_id")
            .or_else(|| parsed.get("chatId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        name,
        members: string_array_from_json(parsed.get("members")),
    })
}

pub(super) fn st_group_metadata_by_key(data_dir: &Path) -> HashMap<String, StGroupMetadata> {
    let mut metadata_by_key = HashMap::new();
    for path in list_files(data_dir, &data_dir.join("groups"), &[".json"], false) {
        let Some(metadata) = read_st_group_metadata_file(&path) else {
            continue;
        };
        for key in [
            metadata.id.as_deref(),
            metadata.chat_id.as_deref(),
            Some(metadata.name.as_str()),
            path.file_stem().and_then(|stem| stem.to_str()),
        ]
        .into_iter()
        .flatten()
        {
            let normalized = normalized_st_lookup_key(key);
            if !normalized.is_empty() {
                metadata_by_key
                    .entry(normalized)
                    .or_insert_with(|| metadata.clone());
            }
        }
    }
    metadata_by_key
}

pub(super) fn st_group_metadata_for_chat(
    metadata_by_key: &HashMap<String, StGroupMetadata>,
    chat_path: &Path,
) -> Option<StGroupMetadata> {
    let stem = file_stem(chat_path);
    let normalized = normalized_st_lookup_key(&stem);
    metadata_by_key.get(&normalized).cloned()
}

fn scan_characters(data_dir: &Path) -> Vec<Value> {
    list_files(
        data_dir,
        &data_dir.join("characters"),
        &[".json", ".png", ".charx"],
        false,
    )
    .into_iter()
    .filter_map(|path| parsed_character_scan_item(data_dir, &path))
    .collect()
}

fn scan_chats(data_dir: &Path) -> Vec<Value> {
    list_files(data_dir, &data_dir.join("chats"), &[".jsonl"], true)
        .into_iter()
        .map(|path| {
            let mut item = scan_item("chats", data_dir, &path);
            if let Some(object) = item.as_object_mut() {
                let folder_name = path
                    .parent()
                    .and_then(|path| path.file_name())
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default();
                object.insert("folderName".to_string(), Value::String(folder_name.clone()));
                object.insert("characterName".to_string(), Value::String(folder_name));
                object.insert("chatName".to_string(), Value::String(file_stem(&path)));
            }
            item
        })
        .collect()
}

fn scan_group_chats(data_dir: &Path) -> Vec<Value> {
    let group_metadata_by_key = st_group_metadata_by_key(data_dir);
    list_files(
        data_dir,
        &data_dir.join("group chats"),
        &[".jsonl", ".json"],
        true,
    )
    .into_iter()
    .map(|path| {
        let mut item = scan_item("groupChats", data_dir, &path);
        if let Some(object) = item.as_object_mut() {
            let metadata = st_group_metadata_for_chat(&group_metadata_by_key, &path);
            let group_name = metadata
                .as_ref()
                .map(|metadata| metadata.display_name(&path))
                .unwrap_or_else(|| file_stem(&path));
            let members = metadata
                .as_ref()
                .map(|metadata| metadata.members.clone())
                .unwrap_or_default();
            object.insert("groupName".to_string(), Value::String(group_name));
            object.insert("members".to_string(), json!(members));
        }
        item
    })
    .collect()
}

fn scan_presets(data_dir: &Path) -> Vec<Value> {
    let mut preset_files = Vec::new();
    for folder in ["presets", "TextGen Settings", "OpenAI Settings"] {
        preset_files.extend(list_files(
            data_dir,
            &data_dir.join(folder),
            &[".json"],
            false,
        ));
    }
    preset_files.sort();
    preset_files.dedup();
    preset_files
        .into_iter()
        .filter_map(|path| parsed_preset_scan_item(data_dir, &path))
        .collect()
}

fn scan_lorebooks(data_dir: &Path) -> Vec<Value> {
    let mut lorebook_files = list_files(data_dir, &data_dir.join("worlds"), &[".json"], false);
    lorebook_files.extend(list_files(
        data_dir,
        &data_dir.join("world-info"),
        &[".json"],
        false,
    ));
    lorebook_files.sort();
    lorebook_files.dedup();
    lorebook_files
        .into_iter()
        .filter_map(|path| parsed_lorebook_scan_item(data_dir, &path))
        .collect()
}

fn scan_backgrounds(data_dir: &Path) -> Vec<Value> {
    list_files(
        data_dir,
        &data_dir.join("backgrounds"),
        ST_BACKGROUND_EXTENSIONS,
        true,
    )
    .into_iter()
    .map(|path| scan_item("backgrounds", data_dir, &path))
    .collect()
}

fn scan_personas(data_dir: &Path) -> Vec<Value> {
    let (persona_names, persona_descriptions) = read_st_persona_settings(data_dir);
    let mut persona_files = persona_avatar_files(data_dir);
    persona_files.extend(list_files(
        data_dir,
        &data_dir.join("personas"),
        &[".json", ".txt"],
        false,
    ));
    persona_files.sort();
    persona_files.dedup();
    persona_files
        .into_iter()
        .map(|path| {
            let is_media = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| {
                    matches!(
                        ext.to_ascii_lowercase().as_str(),
                        "png" | "jpg" | "jpeg" | "webp"
                    )
                })
                .unwrap_or(false);
            if is_media {
                st_persona_scan_item(data_dir, &path, &persona_names, &persona_descriptions)
            } else {
                let mut item = scan_item("personas", data_dir, &path);
                if let Some(object) = item.as_object_mut() {
                    object.insert("description".to_string(), Value::String(String::new()));
                    object.insert("media".to_string(), Value::Bool(false));
                }
                item
            }
        })
        .collect()
}

fn persona_avatar_files(data_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut seen_dirs = Vec::new();
    let mut seen_files = Vec::new();

    for folder in ["User Avatars", "user avatars"] {
        let avatar_dir = data_dir.join(folder);
        if !avatar_dir.is_dir() {
            continue;
        }

        let dir_key = avatar_dir
            .canonicalize()
            .unwrap_or_else(|_| avatar_dir.clone());
        if seen_dirs.iter().any(|seen| seen == &dir_key) {
            continue;
        }
        seen_dirs.push(dir_key);

        for path in list_files(
            data_dir,
            &avatar_dir,
            &[".png", ".jpg", ".jpeg", ".webp"],
            false,
        ) {
            let file_key = path.canonicalize().unwrap_or_else(|_| path.clone());
            if seen_files.contains(&file_key) {
                continue;
            }
            seen_files.push(file_key);
            files.push(path);
        }
    }

    files
}

pub(super) fn scan_items_for_category(data_dir: &Path, key: &str) -> Vec<Value> {
    match key {
        "characters" => scan_characters(data_dir),
        "chats" => scan_chats(data_dir),
        "groupChats" => scan_group_chats(data_dir),
        "presets" => scan_presets(data_dir),
        "lorebooks" => scan_lorebooks(data_dir),
        "backgrounds" => scan_backgrounds(data_dir),
        "personas" => scan_personas(data_dir),
        _ => Vec::new(),
    }
}

pub(crate) fn scan_st_folder(body: Value) -> AppResult<Value> {
    let root = match resolve_import_folder(&body) {
        Ok(root) => root,
        Err(error) => {
            return Ok(json!({
                "success": false,
                "error": error.message,
                "characters": [],
                "chats": [],
                "groupChats": [],
                "presets": [],
                "lorebooks": [],
                "backgrounds": [],
                "personas": []
            }));
        }
    };
    let data_dir = match resolve_st_data_dir(&root) {
        Ok(Some(data_dir)) => data_dir,
        Ok(None) => {
            return Ok(json!({
                "success": false,
                "error": "Could not find SillyTavern data directory. Make sure the path points to your SillyTavern installation folder.",
                "characters": [],
                "chats": [],
                "groupChats": [],
                "presets": [],
                "lorebooks": [],
                "backgrounds": [],
                "personas": []
            }));
        }
        Err(error) => {
            return Ok(json!({
                "success": false,
                "error": error.message,
                "characters": [],
                "chats": [],
                "groupChats": [],
                "presets": [],
                "lorebooks": [],
                "backgrounds": [],
                "personas": []
            }));
        }
    };

    let characters = scan_characters(&data_dir);
    let chats = scan_chats(&data_dir);
    let group_chats = scan_group_chats(&data_dir);
    let presets = scan_presets(&data_dir);
    let lorebooks = scan_lorebooks(&data_dir);
    let backgrounds = scan_backgrounds(&data_dir);
    let personas = scan_personas(&data_dir);

    Ok(json!({
        "success": true,
        "dataDir": data_dir.to_string_lossy(),
        "characters": characters,
        "chats": chats,
        "groupChats": group_chats,
        "presets": presets,
        "lorebooks": lorebooks,
        "backgrounds": backgrounds,
        "personas": personas,
    }))
}
