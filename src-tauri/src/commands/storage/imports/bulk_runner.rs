use super::super::*;
use super::backgrounds::copy_background_file;
use super::chat::{
    add_character_lookup_record, character_lookup_from_state, import_st_chat_text,
    lookup_character_id, resolve_member_character_ids, StChatImportContext,
};
use super::personas::{import_persona_avatar_file, import_persona_file};
use super::progress::{
    empty_import_counts, imported_count, push_import_error, push_path_import_error,
    BulkImportProgress,
};
use super::scan::{
    path_from_id, read_st_persona_settings, resolve_st_data_dir, scan_items_for_category,
    st_group_metadata_by_key, st_group_metadata_for_chat,
};
use super::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

struct BulkSelections {
    characters: Vec<String>,
    chats: Vec<String>,
    group_chats: Vec<String>,
    presets: Vec<String>,
    lorebooks: Vec<String>,
    backgrounds: Vec<String>,
    personas: Vec<String>,
}

impl BulkSelections {
    fn from_options(options: &Value, data_dir: &Path) -> Self {
        Self {
            characters: selected_ids(options, "characters", data_dir),
            chats: selected_ids(options, "chats", data_dir),
            group_chats: selected_ids(options, "groupChats", data_dir),
            presets: selected_ids(options, "presets", data_dir),
            lorebooks: selected_ids(options, "lorebooks", data_dir),
            backgrounds: selected_ids(options, "backgrounds", data_dir),
            personas: selected_ids(options, "personas", data_dir),
        }
    }

    fn total(&self) -> usize {
        self.characters.len()
            + self.chats.len()
            + self.group_chats.len()
            + self.presets.len()
            + self.lorebooks.len()
            + self.backgrounds.len()
            + self.personas.len()
    }
}

fn ids_from_items(items: Vec<Value>) -> Vec<String> {
    items
        .into_iter()
        .filter_map(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect()
}

fn selected_ids(options: &Value, key: &str, data_dir: &Path) -> Vec<String> {
    match options.get(key) {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect(),
        Some(Value::Bool(true)) => ids_from_items(scan_items_for_category(data_dir, key)),
        _ => Vec::new(),
    }
}

fn selected_path(
    data_dir: &Path,
    category: &str,
    id: &str,
    errors: &mut Vec<Value>,
) -> Option<PathBuf> {
    match path_from_id(data_dir, category, id) {
        Ok(path) => Some(path),
        Err(error) => {
            push_import_error(errors, id, error);
            None
        }
    }
}

fn bump_imported(imported: &mut Value, key: &str) {
    if let Some(value) = imported.get_mut(key) {
        *value = json!(value.as_i64().unwrap_or(0) + 1);
    }
}

fn preset_payload_has_timestamp_override(payload: &Value) -> bool {
    timestamp_overrides_from_value(
        payload
            .get("timestampOverrides")
            .or_else(|| payload.get("__timestampOverrides")),
    )
    .or_else(|| {
        timestamp_overrides_from_value(Some(&json!({
            "createdAt": payload.get("createdAt").cloned().unwrap_or(Value::Null),
            "updatedAt": payload.get("updatedAt").cloned().unwrap_or(Value::Null),
        })))
    })
    .or_else(|| {
        payload
            .get("metadata")
            .and_then(|metadata| metadata.get("timestamps"))
            .and_then(|timestamps| timestamp_overrides_from_value(Some(timestamps)))
    })
    .is_some()
}

fn attach_st_preset_file_timestamp(mut payload: Value, path: &Path) -> Value {
    if preset_payload_has_timestamp_override(&payload) {
        return payload;
    }
    let modified = modified_at(path);
    if modified.is_null() {
        return payload;
    }
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "__timestampOverrides".to_string(),
            json!({
                "createdAt": modified,
                "updatedAt": modified,
            }),
        );
    }
    payload
}

pub(super) fn run_st_bulk_import_inner(
    state: &AppState,
    body: Value,
    event_sink: Option<&mut dyn FnMut(Value) -> AppResult<()>>,
) -> AppResult<Value> {
    let root = resolve_import_folder(&body)?;
    let data_dir = resolve_st_data_dir(&root)?
        .ok_or_else(|| AppError::invalid_input("Could not find SillyTavern data directory"))?;
    let options = body.get("options").cloned().unwrap_or_else(|| json!({}));
    let selections = BulkSelections::from_options(&options, &data_dir);
    let mut progress = BulkImportProgress::new(event_sink, selections.total());
    let mut imported = empty_import_counts();
    let mut errors: Vec<Value> = Vec::new();
    let tag_mode = options
        .get("characterTagImportMode")
        .and_then(Value::as_str)
        .unwrap_or("all");
    if !matches!(tag_mode, "all" | "existing" | "none") {
        return Err(AppError::invalid_input(
            "Invalid characterTagImportMode. Expected all, existing, or none.",
        ));
    }
    let import_embedded = bool_option(options.get("importEmbeddedLorebook")).unwrap_or(true);
    let (persona_names, persona_descriptions) = read_st_persona_settings(&data_dir);
    let mut character_lookup = character_lookup_from_state(state)?;
    let mut chat_group_ids: HashMap<String, String> = HashMap::new();
    let group_metadata_by_key = st_group_metadata_by_key(&data_dir);

    for id in selections.characters {
        let Some(path) = selected_path(&data_dir, "characters", &id, &mut errors) else {
            progress.emit_skipped("Characters", &id, &imported)?;
            continue;
        };
        progress.emit_item("Characters", &path, &imported)?;
        let filename = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let result = fs::read(&path)
            .map_err(AppError::from)
            .and_then(|bytes| parse_character_file_from_path(&filename, &path, &bytes))
            .and_then(|payload| {
                let trusted_avatar_source = filename
                    .to_ascii_lowercase()
                    .ends_with(".png")
                    .then_some(path.as_path());
                import_st_character_payload(
                    state,
                    payload,
                    Some(filename.clone()),
                    &json!({ "tagImportMode": tag_mode, "importEmbeddedLorebook": import_embedded }),
                    trusted_avatar_source,
                )
            });
        match result {
            Ok(result) => {
                bump_imported(&mut imported, "characters");
                let filename = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(ToOwned::to_owned);
                if let Some(character) = result.get("character") {
                    add_character_lookup_record(
                        &mut character_lookup,
                        character,
                        filename.as_deref(),
                    );
                }
            }
            Err(error) => push_path_import_error(&mut errors, &path, error),
        }
    }

    for id in selections.lorebooks {
        let Some(path) = selected_path(&data_dir, "lorebooks", &id, &mut errors) else {
            progress.emit_skipped("Lorebooks", &id, &imported)?;
            continue;
        };
        progress.emit_item("Lorebooks", &path, &imported)?;
        let result = fs::read(&path)
            .map_err(AppError::from)
            .and_then(|bytes| parse_object(&bytes))
            .and_then(|payload| {
                create_lorebook_from_payload(state, &payload, &file_stem(&path), None)
            });
        match result {
            Ok(_) => bump_imported(&mut imported, "lorebooks"),
            Err(error) => push_path_import_error(&mut errors, &path, error),
        }
    }

    for id in selections.presets {
        let Some(path) = selected_path(&data_dir, "presets", &id, &mut errors) else {
            progress.emit_skipped("Presets", &id, &imported)?;
            continue;
        };
        progress.emit_item("Presets", &path, &imported)?;
        let result = fs::read(&path)
            .map_err(AppError::from)
            .and_then(|bytes| parse_object(&bytes))
            .map(|payload| attach_st_preset_file_timestamp(payload, &path))
            .and_then(|payload| import_st_preset_payload(state, payload, Some(&file_stem(&path))));
        match result {
            Ok(_) => bump_imported(&mut imported, "presets"),
            Err(error) => push_path_import_error(&mut errors, &path, error),
        }
    }

    for id in selections.personas {
        let Some(path) = selected_path(&data_dir, "personas", &id, &mut errors) else {
            progress.emit_skipped("Personas", &id, &imported)?;
            continue;
        };
        progress.emit_item("Personas", &path, &imported)?;
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
        let result = if is_media {
            let filename = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            import_persona_avatar_file(
                state,
                &path,
                persona_names
                    .get(&filename)
                    .cloned()
                    .unwrap_or_else(|| file_stem(&path)),
                persona_descriptions
                    .get(&filename)
                    .cloned()
                    .unwrap_or_default(),
            )
        } else {
            import_persona_file(state, &path)
        };
        match result {
            Ok(_) => bump_imported(&mut imported, "personas"),
            Err(error) => push_path_import_error(&mut errors, &path, error),
        }
    }

    for id in selections.backgrounds {
        let Some(path) = selected_path(&data_dir, "backgrounds", &id, &mut errors) else {
            progress.emit_skipped("Backgrounds", &id, &imported)?;
            continue;
        };
        progress.emit_item("Backgrounds", &path, &imported)?;
        match copy_background_file(state, &path) {
            Ok(_) => bump_imported(&mut imported, "backgrounds"),
            Err(error) => push_path_import_error(&mut errors, &path, error),
        }
    }

    for id in selections.chats {
        let Some(path) = selected_path(&data_dir, "chats", &id, &mut errors) else {
            progress.emit_skipped("Chats", &id, &imported)?;
            continue;
        };
        progress.emit_item("Chats", &path, &imported)?;
        let folder_name = path
            .parent()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let branch_name = file_stem(&path).replace('_', " ");
        let default_character_id = lookup_character_id(&character_lookup, &folder_name);
        let chat_name = if folder_name.trim().is_empty() {
            branch_name.clone()
        } else {
            folder_name.clone()
        };
        let group_key = normalized_st_lookup_key(&folder_name);
        let group_id = if group_key.is_empty() {
            None
        } else {
            Some(
                chat_group_ids
                    .entry(group_key)
                    .or_insert_with(new_id)
                    .clone(),
            )
        };
        let character_ids = default_character_id
            .as_ref()
            .map(|id| vec![id.clone()])
            .unwrap_or_default();
        let mut inherited = json!({
            "name": chat_name,
            "mode": "roleplay",
            "characterIds": character_ids,
            "metadata": {
                "branchName": branch_name,
                "sillyTavernSource": "chat",
                "sillyTavernCharacterFolder": folder_name,
                "sillyTavernFile": path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default()
            }
        });
        if let Some(group_id) = group_id {
            if let Some(object) = inherited.as_object_mut() {
                object.insert("groupId".to_string(), Value::String(group_id));
            }
        }
        let result = fs::read_to_string(&path)
            .map_err(AppError::from)
            .and_then(|text| {
                import_st_chat_text(
                    state,
                    &text,
                    chat_name,
                    Some(inherited),
                    StChatImportContext {
                        character_lookup: character_lookup.clone(),
                        default_character_id,
                        timestamp_overrides: None,
                    },
                )
            });
        match result {
            Ok(_) => bump_imported(&mut imported, "chats"),
            Err(error) => push_path_import_error(&mut errors, &path, error),
        }
    }

    for id in selections.group_chats {
        let Some(path) = selected_path(&data_dir, "groupChats", &id, &mut errors) else {
            progress.emit_skipped("Group chats", &id, &imported)?;
            continue;
        };
        progress.emit_item("Group chats", &path, &imported)?;
        let metadata = st_group_metadata_for_chat(&group_metadata_by_key, &path);
        let chat_name = metadata
            .as_ref()
            .map(|metadata| metadata.display_name(&path))
            .unwrap_or_else(|| file_stem(&path).replace('_', " "));
        let member_names = metadata
            .as_ref()
            .map(|metadata| metadata.members.clone())
            .unwrap_or_default();
        let character_ids = resolve_member_character_ids(&character_lookup, &member_names);
        let group_id = metadata
            .as_ref()
            .and_then(|metadata| metadata.id.clone().or_else(|| metadata.chat_id.clone()))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(new_id);
        let inherited = json!({
            "name": chat_name,
            "mode": "roleplay",
            "groupId": group_id,
            "characterIds": character_ids,
            "metadata": {
                "branchName": file_stem(&path).replace('_', " "),
                "groupChatMode": "individual",
                "groupResponseOrder": "sequential",
                "sillyTavernSource": "groupChat",
                "sillyTavernGroupId": metadata.as_ref().and_then(|metadata| metadata.id.clone()).unwrap_or_default(),
                "sillyTavernChatId": metadata.as_ref().and_then(|metadata| metadata.chat_id.clone()).unwrap_or_default(),
                "sillyTavernMembers": member_names,
                "sillyTavernFile": path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default()
            }
        });
        let result = fs::read_to_string(&path)
            .map_err(AppError::from)
            .and_then(|text| {
                import_st_chat_text(
                    state,
                    &text,
                    chat_name,
                    Some(inherited),
                    StChatImportContext {
                        character_lookup: character_lookup.clone(),
                        default_character_id: None,
                        timestamp_overrides: None,
                    },
                )
            });
        match result {
            Ok(_) => bump_imported(&mut imported, "groupChats"),
            Err(error) => push_path_import_error(&mut errors, &path, error),
        }
    }

    let imported_total = [
        "characters",
        "chats",
        "groupChats",
        "presets",
        "lorebooks",
        "backgrounds",
        "personas",
    ]
    .iter()
    .map(|key| imported_count(&imported, key))
    .sum::<i64>();
    let result = json!({
        "success": imported_total > 0 || errors.is_empty(),
        "imported": imported,
        "errors": errors
    });
    progress.emit_done(&result)?;
    Ok(result)
}

pub(crate) fn run_st_bulk_import(state: &AppState, body: Value) -> AppResult<Value> {
    run_st_bulk_import_inner(state, body, None)
}

pub(crate) fn run_st_bulk_import_channel(
    state: &AppState,
    body: Value,
    mut emit: impl FnMut(Value) -> AppResult<()>,
) -> AppResult<()> {
    match run_st_bulk_import_inner(state, body, Some(&mut emit)) {
        Ok(_) => Ok(()),
        Err(error) => emit(json!({
            "type": "error",
            "data": {
                "error": error.message,
                "code": error.code
            }
        })),
    }
}
