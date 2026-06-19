use super::*;

pub(super) fn normalize_chat_for_create(value: Value) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    normalize_chat_mode_object(&mut object);
    normalize_chat_folder_id_object(&mut object)?;
    normalize_chat_metadata_for_create(&mut object)?;
    Ok(Value::Object(object))
}

pub(super) fn normalize_chat_for_update(entity: &str, patch: Value) -> Result<Value, AppError> {
    if entity != "chats" {
        return Ok(patch);
    }
    let mut object = ensure_object(patch)?;
    normalize_chat_mode_object(&mut object);
    normalize_chat_folder_id_object(&mut object)?;
    Ok(Value::Object(object))
}

pub(super) fn normalize_chat_metadata_for_create(
    object: &mut Map<String, Value>,
) -> Result<(), AppError> {
    let active_ids = chat_active_character_ids(object.get("characterIds"));
    let Some(metadata) = object.get_mut("metadata") else {
        return Ok(());
    };
    let Some(metadata) = metadata.as_object_mut() else {
        return Err(AppError::invalid_input("Chat metadata must be an object"));
    };
    normalize_chat_metadata_object(metadata, &active_ids)
}

pub(super) fn normalize_chat_mode_object(object: &mut Map<String, Value>) {
    if let Some(mode) = object
        .get("mode")
        .and_then(Value::as_str)
        .and_then(canonical_chat_mode)
    {
        object.insert("mode".to_string(), Value::String(mode.to_string()));
    }
}

pub(super) fn normalize_chat_folder_id_object(
    object: &mut Map<String, Value>,
) -> Result<(), AppError> {
    if !object.contains_key("folderId") {
        return Ok(());
    }
    let normalized = match object.get("folderId") {
        Some(Value::Null) => Value::Null,
        Some(Value::String(folder_id)) => {
            let folder_id = folder_id.trim();
            if folder_id.is_empty() {
                return Err(AppError::invalid_input(
                    "folderId must be a folder id or null",
                ));
            }
            Value::String(folder_id.to_string())
        }
        _ => {
            return Err(AppError::invalid_input(
                "folderId must be a folder id or null",
            ));
        }
    };
    object.insert("folderId".to_string(), normalized);
    Ok(())
}

pub(super) fn normalize_lorebook_entry_for_create(value: Value) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    normalize_lorebook_id_object(&mut object)?;
    normalize_lorebook_entry_folder_id_object(&mut object)?;
    shared::normalize_lorebook_entry_role_field(&mut object, true);
    Ok(Value::Object(object))
}

pub(super) fn normalize_lorebook_entry_for_update(
    entity: &str,
    patch: Value,
) -> Result<Value, AppError> {
    if entity != "lorebook-entries" {
        return Ok(patch);
    }
    let mut object = ensure_object(patch)?;
    normalize_lorebook_id_object(&mut object)?;
    normalize_lorebook_entry_folder_id_object(&mut object)?;
    shared::normalize_lorebook_entry_role_field(&mut object, false);
    Ok(Value::Object(object))
}

pub(super) fn normalize_lorebook_id_object(
    object: &mut Map<String, Value>,
) -> Result<(), AppError> {
    if !object.contains_key("lorebookId") {
        return Ok(());
    }
    let Some(lorebook_id) = object
        .get("lorebookId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(AppError::invalid_input("lorebookId must be a lorebook id"));
    };
    object.insert(
        "lorebookId".to_string(),
        Value::String(lorebook_id.to_string()),
    );
    Ok(())
}

pub(super) fn normalize_lorebook_entry_folder_id_object(
    object: &mut Map<String, Value>,
) -> Result<(), AppError> {
    if !object.contains_key("folderId") {
        return Ok(());
    }
    let normalized = match object.get("folderId") {
        Some(Value::Null) => Value::Null,
        Some(Value::String(folder_id)) => {
            let folder_id = folder_id.trim();
            if folder_id.is_empty() {
                return Err(AppError::invalid_input(
                    "folderId must be a folder id or null",
                ));
            }
            Value::String(folder_id.to_string())
        }
        _ => {
            return Err(AppError::invalid_input(
                "folderId must be a folder id or null",
            ));
        }
    };
    object.insert("folderId".to_string(), normalized);
    Ok(())
}

pub(super) fn validated_chat_folder_name(value: &Value) -> Result<String, AppError> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::invalid_input("Chat folder name is required"))
}

pub(super) fn normalize_chat_folder_name_patch(
    object: &mut Map<String, Value>,
) -> Result<(), AppError> {
    if let Some(name) = object.get("name") {
        let name = validated_chat_folder_name(name)?;
        object.insert("name".to_string(), Value::String(name));
    }
    Ok(())
}

pub(super) fn patch_chat_folder(
    state: &AppState,
    id: &str,
    patch: Value,
) -> Result<Value, AppError> {
    let mut object = ensure_object(shared::normalize_update_patch("chat-folders", patch)?)?;
    normalize_chat_folder_name_patch(&mut object)?;
    if let Some(mode_value) = object.get("mode") {
        let mode = mode_value
            .as_str()
            .and_then(canonical_chat_mode)
            .ok_or_else(|| AppError::invalid_input("Invalid chat folder mode"))?;
        object.insert("mode".to_string(), Value::String(mode.to_string()));
        validate_chat_folder_mode_patch(state, id, mode)?;
    }
    state
        .storage
        .patch("chat-folders", id, Value::Object(object))
}

pub(super) fn validate_chat_folder_mode_patch(
    state: &AppState,
    folder_id: &str,
    folder_mode: &str,
) -> Result<(), AppError> {
    let mut filters = Map::new();
    filters.insert("folderId".to_string(), Value::String(folder_id.to_string()));
    for chat in state.storage.list_where("chats", &filters)? {
        let chat_id = chat
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("<unknown>");
        let chat_mode = chat_mode_for_value(&chat).map_err(|_| {
            AppError::invalid_input(format!(
                "Chat folder {folder_id} contains chat {chat_id} with invalid mode"
            ))
        })?;
        if chat_mode != folder_mode {
            return Err(AppError::invalid_input(format!(
                "Chat folder {folder_id} contains {chat_mode} chat {chat_id}, not {folder_mode} chat"
            )));
        }
    }
    Ok(())
}

pub(super) fn create_chat_folder(state: &AppState, value: Value) -> Result<Value, AppError> {
    let prepared = prepare_entity_for_create(state, "chat-folders", value)?;
    state
        .storage
        .update_collections_atomically(vec!["chat-folders"], move |collections| {
            let [folders] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Chat folder create expected chat-folder collection",
                ));
            };
            if folders.collection() != "chat-folders" {
                return Err(AppError::new(
                    "storage_error",
                    "Chat folder create received unexpected collection",
                ));
            }
            create_chat_folder_in_rows(folders.rows_mut(), prepared)
        })
}

pub(super) fn create_chat_folder_in_rows(
    rows: &mut Vec<Value>,
    value: Value,
) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(new_id);
    if rows
        .iter()
        .any(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
    {
        return Err(AppError::invalid_input(format!(
            "chat-folders/{id} already exists"
        )));
    }

    let now = now_iso();
    object.insert("id".to_string(), Value::String(id));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object
        .entry("updatedAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object.insert("sortOrder".to_string(), json!(0));
    object.insert("order".to_string(), json!(0));

    for folder in rows.iter_mut() {
        let Some(folder) = folder.as_object_mut() else {
            return Err(AppError::invalid_input("Stored record is not an object"));
        };
        let next_order = folder
            .get("sortOrder")
            .or_else(|| folder.get("order"))
            .and_then(Value::as_i64)
            .unwrap_or(0)
            + 1;
        folder.insert("sortOrder".to_string(), json!(next_order));
        folder.insert("order".to_string(), json!(next_order));
        folder.insert("updatedAt".to_string(), Value::String(now.clone()));
    }

    let record = Value::Object(object);
    rows.push(record.clone());
    Ok(record)
}

pub(super) fn chat_folder_defaults_for_create(value: Value) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    let name = validated_chat_folder_name(object.get("name").unwrap_or(&Value::Null))?;
    object.insert("name".to_string(), Value::String(name));

    let mode = object
        .get("mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .and_then(canonical_chat_mode)
        .ok_or_else(|| AppError::invalid_input("Invalid chat folder mode"))?
        .to_string();
    object.insert("mode".to_string(), Value::String(mode));
    object.insert("sortOrder".to_string(), json!(0));
    object.insert("order".to_string(), json!(0));
    Ok(Value::Object(object))
}

pub(super) fn gallery_defaults_for_create(
    state: &AppState,
    value: Value,
) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    let Some(url) = object
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| media_uploads::is_inline_image_data_url(value))
        .map(str::to_string)
    else {
        return Ok(Value::Object(object));
    };

    let (mime, bytes) = media_uploads::decode_image_payload(&url, "url")?;
    let filename_hint = object
        .get("filename")
        .or_else(|| object.get("filePath"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("gallery-image");
    let stored =
        media_uploads::persist_image_bytes(state, "gallery", filename_hint, &bytes, &mime)?;

    object.insert("url".to_string(), Value::String(stored.asset_url));
    object.insert("filePath".to_string(), Value::String(stored.absolute_path));
    object.insert("filename".to_string(), Value::String(stored.filename));
    Ok(Value::Object(object))
}

pub(super) fn gallery_create_persists_inline_image(entity: &str, value: &Value) -> bool {
    matches!(
        entity,
        "gallery" | "character-gallery" | "persona-gallery" | "global-gallery"
    ) && value
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(media_uploads::is_inline_image_data_url)
}

pub(super) fn connection_folder_defaults_for_create(
    _state: &AppState,
    value: Value,
) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    if object
        .get("sortOrder")
        .and_then(Value::as_i64)
        .is_none_or(|value| value <= 0)
    {
        object.insert("sortOrder".to_string(), json!(0));
        object.insert("order".to_string(), json!(0));
    }
    Ok(Value::Object(object))
}

pub(super) fn create_connection_folder(state: &AppState, value: Value) -> Result<Value, AppError> {
    let explicit_order = explicit_positive_connection_folder_order(&value);
    let mut prepared = prepare_entity_for_create(state, "connection-folders", value)?;
    if let Some(order) = explicit_order {
        let Some(object) = prepared.as_object_mut() else {
            return Err(AppError::invalid_input(
                "Connection folder must be an object",
            ));
        };
        object.insert("sortOrder".to_string(), json!(order));
        object.insert("order".to_string(), json!(order));
        return state.storage.create("connection-folders", prepared);
    }

    state
        .storage
        .update_collections_atomically(vec!["connection-folders"], move |collections| {
            let [folders] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Connection folder create expected connection-folder collection",
                ));
            };
            if folders.collection() != "connection-folders" {
                return Err(AppError::new(
                    "storage_error",
                    "Connection folder create received unexpected collection",
                ));
            }
            create_connection_folder_in_rows(folders.rows_mut(), prepared)
        })
}

pub(super) fn explicit_positive_connection_folder_order(value: &Value) -> Option<i64> {
    ["sortOrder", "order"].into_iter().find_map(|field| {
        value
            .get(field)
            .and_then(Value::as_i64)
            .filter(|order| *order > 0)
    })
}

pub(super) fn create_connection_folder_in_rows(
    rows: &mut Vec<Value>,
    value: Value,
) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(new_id);
    if rows
        .iter()
        .any(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
    {
        return Err(AppError::invalid_input(format!(
            "connection-folders/{id} already exists"
        )));
    }

    let now = now_iso();
    object.insert("id".to_string(), Value::String(id));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object
        .entry("updatedAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object.insert("sortOrder".to_string(), json!(0));
    object.insert("order".to_string(), json!(0));

    for folder in rows.iter_mut() {
        let Some(folder) = folder.as_object_mut() else {
            return Err(AppError::invalid_input("Stored record is not an object"));
        };
        let next_order = folder
            .get("sortOrder")
            .or_else(|| folder.get("order"))
            .and_then(Value::as_i64)
            .unwrap_or(0)
            + 1;
        folder.insert("sortOrder".to_string(), json!(next_order));
        folder.insert("order".to_string(), json!(next_order));
        folder.insert("updatedAt".to_string(), Value::String(now.clone()));
    }

    let record = Value::Object(object);
    rows.push(record.clone());
    Ok(record)
}

pub(super) fn create_lorebook_folder_with_append_order(
    state: &AppState,
    value: Value,
) -> Result<Value, AppError> {
    let explicit_order = explicit_positive_lorebook_folder_order(&value);
    let mut prepared = prepare_entity_for_create(state, "lorebook-folders", value)?;
    let Some(object) = prepared.as_object_mut() else {
        return Err(AppError::invalid_input("Lorebook folder must be an object"));
    };
    normalize_lorebook_id_object(object)?;

    state
        .storage
        .update_collections_atomically(vec!["lorebook-folders"], move |collections| {
            let [folders] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Lorebook folder create expected lorebook-folder collection",
                ));
            };
            if folders.collection() != "lorebook-folders" {
                return Err(AppError::new(
                    "storage_error",
                    "Lorebook folder create received unexpected collection",
                ));
            }
            create_lorebook_folder_in_rows(folders.rows_mut(), prepared, explicit_order)
        })
}

pub(super) fn explicit_positive_lorebook_folder_order(value: &Value) -> Option<i64> {
    ["order", "sortOrder"].into_iter().find_map(|field| {
        value
            .get(field)
            .and_then(Value::as_i64)
            .filter(|order| *order > 0)
    })
}

pub(super) fn create_lorebook_folder_in_rows(
    rows: &mut Vec<Value>,
    value: Value,
    explicit_order: Option<i64>,
) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(new_id);
    if rows
        .iter()
        .any(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
    {
        return Err(AppError::invalid_input(format!(
            "lorebook-folders/{id} already exists"
        )));
    }
    let lorebook_id = object
        .get("lorebookId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::invalid_input("lorebookId is required"))?;

    let now = now_iso();
    let order = explicit_order.unwrap_or_else(|| next_lorebook_folder_order(rows, &lorebook_id));
    object.insert("id".to_string(), Value::String(id));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object
        .entry("updatedAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object.insert("order".to_string(), json!(order));
    object.insert("sortOrder".to_string(), json!(order));

    let record = Value::Object(object);
    rows.push(record.clone());
    Ok(record)
}

pub(super) fn next_lorebook_folder_order(rows: &[Value], lorebook_id: &str) -> i64 {
    rows.iter()
        .filter(|row| lorebook_folder_lorebook_id(row).as_deref() == Some(lorebook_id))
        .filter_map(|row| {
            row.get("order")
                .or_else(|| row.get("sortOrder"))
                .and_then(Value::as_i64)
        })
        .max()
        .filter(|order| *order > 0)
        .map(|order| order + 10)
        .unwrap_or(10)
}

pub(crate) fn validate_connection_folder_for_create(
    state: &AppState,
    entity: &str,
    value: &Value,
) -> Result<(), AppError> {
    if entity != "connections" {
        return Ok(());
    }
    validate_connection_folder_id(state, value.get("folderId"))
}

pub(crate) fn validate_connection_folder_for_patch(
    state: &AppState,
    entity: &str,
    patch: &Value,
) -> Result<(), AppError> {
    if entity != "connections"
        || !patch
            .as_object()
            .is_some_and(|object| object.contains_key("folderId"))
    {
        return Ok(());
    }
    validate_connection_folder_id(state, patch.get("folderId"))
}

pub(super) fn validate_connection_folder_id(
    state: &AppState,
    folder_id: Option<&Value>,
) -> Result<(), AppError> {
    let Some(folder_id) = folder_id else {
        return Ok(());
    };
    if folder_id.is_null() {
        return Ok(());
    }
    let Some(folder_id) = folder_id
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(AppError::invalid_input(
            "folderId must be a folder id or null",
        ));
    };
    if state
        .storage
        .get("connection-folders", folder_id)?
        .is_none()
    {
        return Err(AppError::invalid_input(format!(
            "Connection folder {folder_id} does not exist"
        )));
    }
    Ok(())
}

pub(crate) fn validate_chat_folder_for_create(
    state: &AppState,
    entity: &str,
    value: &Value,
) -> Result<(), AppError> {
    if entity != "chats" {
        return Ok(());
    }
    let Some(folder_id) = parse_chat_folder_id(value.get("folderId"))? else {
        return Ok(());
    };
    validate_chat_folder_assignment(state, &folder_id, chat_mode_for_value(value)?)
}

pub(crate) fn validate_chat_folder_for_patch(
    state: &AppState,
    entity: &str,
    id: &str,
    patch: &Value,
) -> Result<(), AppError> {
    if entity != "chats" {
        return Ok(());
    }
    let Some(patch_object) = patch.as_object() else {
        return Err(AppError::invalid_input("Patch must be an object"));
    };
    if !patch_object.contains_key("folderId") && !patch_object.contains_key("mode") {
        return Ok(());
    }

    let existing = state
        .storage
        .get("chats", id)?
        .ok_or_else(|| AppError::not_found(format!("chats/{id} was not found")))?;
    let folder_id = if patch_object.contains_key("folderId") {
        patch.get("folderId")
    } else {
        existing.get("folderId")
    };
    let Some(folder_id) = parse_chat_folder_id(folder_id)? else {
        return Ok(());
    };
    let mode = if patch_object.contains_key("mode") {
        chat_mode_for_value(patch)?
    } else {
        chat_mode_for_value(&existing)?
    };
    validate_chat_folder_assignment(state, &folder_id, mode)
}

pub(super) fn validate_chat_folder_assignment(
    state: &AppState,
    folder_id: &str,
    chat_mode: &str,
) -> Result<(), AppError> {
    let folder = state
        .storage
        .get("chat-folders", folder_id)?
        .ok_or_else(|| {
            AppError::invalid_input(format!("Chat folder {folder_id} does not exist"))
        })?;
    let folder_mode = folder
        .get("mode")
        .and_then(Value::as_str)
        .and_then(canonical_chat_mode)
        .ok_or_else(|| {
            AppError::invalid_input(format!("Chat folder {folder_id} has invalid mode"))
        })?;
    if folder_mode != chat_mode {
        return Err(AppError::invalid_input(format!(
            "Chat folder {folder_id} is for {folder_mode} chats, not {chat_mode} chats"
        )));
    }
    Ok(())
}

pub(crate) fn validate_lorebook_entry_folder_for_create(
    state: &AppState,
    entity: &str,
    value: &Value,
) -> Result<(), AppError> {
    if entity != "lorebook-entries" {
        return Ok(());
    }
    let Some(folder_id) = parse_chat_folder_id(value.get("folderId"))? else {
        return Ok(());
    };
    let lorebook_id = lorebook_entry_lorebook_id_for_validation(value)
        .ok_or_else(|| AppError::invalid_input("lorebookId is required when folderId is set"))?;
    validate_lorebook_entry_folder_assignment(state, &lorebook_id, &folder_id)
}

pub(crate) fn validate_lorebook_entry_folder_for_patch(
    state: &AppState,
    entity: &str,
    id: &str,
    patch: &Value,
) -> Result<(), AppError> {
    if entity != "lorebook-entries" {
        return Ok(());
    }
    let Some(object) = patch.as_object() else {
        return Err(AppError::invalid_input("Patch must be an object"));
    };
    if !object.contains_key("folderId") && !object.contains_key("lorebookId") {
        return Ok(());
    }
    let existing = state
        .storage
        .get("lorebook-entries", id)?
        .ok_or_else(|| AppError::not_found(format!("lorebook-entries/{id} was not found")))?;
    let folder_id = if object.contains_key("folderId") {
        parse_chat_folder_id(patch.get("folderId"))?
    } else {
        parse_chat_folder_id(existing.get("folderId"))?
    };
    let Some(folder_id) = folder_id else {
        return Ok(());
    };
    let lorebook_source = if object.contains_key("lorebookId") {
        patch
    } else {
        &existing
    };
    let lorebook_id = lorebook_entry_lorebook_id_for_validation(lorebook_source)
        .ok_or_else(|| AppError::invalid_input("lorebookId is required when folderId is set"))?;
    validate_lorebook_entry_folder_assignment(state, &lorebook_id, &folder_id)
}

pub(super) fn validate_lorebook_entry_folder_assignment(
    state: &AppState,
    lorebook_id: &str,
    folder_id: &str,
) -> Result<(), AppError> {
    let folder = state
        .storage
        .get("lorebook-folders", folder_id)?
        .ok_or_else(|| {
            AppError::invalid_input(format!("lorebook-folders/{folder_id} was not found"))
        })?;
    let folder_lorebook_id = lorebook_folder_lorebook_id(&folder);
    if folder_lorebook_id.as_deref() != Some(lorebook_id) {
        return Err(AppError::invalid_input(
            "Lorebook entry folderId must belong to the same lorebook.",
        ));
    }
    Ok(())
}

pub(super) fn lorebook_entry_lorebook_id_for_validation(value: &Value) -> Option<String> {
    value
        .get("lorebookId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(str::to_string)
}

/// Storage-level guard for malformed lorebook folder ancestry.
pub(crate) fn validate_lorebook_folder_for_create(
    state: &AppState,
    entity: &str,
    value: &Value,
) -> Result<(), AppError> {
    if entity != "lorebook-folders" {
        return Ok(());
    }
    let Some(parent_id) = parse_chat_folder_id(value.get("parentFolderId"))? else {
        return Ok(());
    };
    let lorebook_id = lorebook_folder_lorebook_id(value).ok_or_else(|| {
        AppError::invalid_input("lorebookId is required when parentFolderId is set")
    })?;
    // New folders have no descendants, so create only checks parent existence and ownership.
    validate_lorebook_folder_parent(state, Some(lorebook_id), None, &parent_id)
}

pub(crate) fn validate_lorebook_folder_for_patch(
    state: &AppState,
    entity: &str,
    id: &str,
    patch: &Value,
) -> Result<(), AppError> {
    if entity != "lorebook-folders" {
        return Ok(());
    }
    let Some(object) = patch.as_object() else {
        return Err(AppError::invalid_input("Patch must be an object"));
    };
    let changes_parent = object.contains_key("parentFolderId");
    let changes_lorebook = object.contains_key("lorebookId");
    if !changes_parent && !changes_lorebook {
        return Ok(());
    }
    let existing = state
        .storage
        .get("lorebook-folders", id)?
        .ok_or_else(|| AppError::not_found(format!("lorebook-folders/{id} was not found")))?;
    // Cross-book folder moves can strand parent/child links, so ownership is immutable.
    if changes_lorebook
        && lorebook_folder_lorebook_id(patch) != lorebook_folder_lorebook_id(&existing)
    {
        return Err(AppError::invalid_input(
            "A folder cannot be moved to a different lorebook.",
        ));
    }
    if !changes_parent {
        return Ok(());
    }
    let Some(parent_id) = parse_chat_folder_id(patch.get("parentFolderId"))? else {
        // Clearing parentFolderId moves the folder to root.
        return Ok(());
    };
    let lorebook_id = lorebook_folder_lorebook_id(&existing).ok_or_else(|| {
        AppError::invalid_input("lorebookId is required when parentFolderId is set")
    })?;
    validate_lorebook_folder_parent(state, Some(lorebook_id), Some(id), &parent_id)
}

pub(super) fn lorebook_folder_lorebook_id(value: &Value) -> Option<String> {
    value
        .get("lorebookId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(str::to_string)
}

pub(super) fn validate_lorebook_folder_parent(
    state: &AppState,
    lorebook_id: Option<String>,
    folder_id: Option<&str>,
    parent_id: &str,
) -> Result<(), AppError> {
    if Some(parent_id) == folder_id {
        return Err(AppError::invalid_input(
            "A folder cannot be its own parent.",
        ));
    }
    let parent = state
        .storage
        .get("lorebook-folders", parent_id)?
        .ok_or_else(|| {
            AppError::invalid_input(format!("lorebook-folders/{parent_id} was not found"))
        })?;
    if let Some(lorebook_id) = lorebook_id.as_deref() {
        if parent.get("lorebookId").and_then(Value::as_str) != Some(lorebook_id) {
            return Err(AppError::invalid_input(
                "A folder can only nest under a folder in the same lorebook.",
            ));
        }
    }
    // Walk target ancestors to reject descendant moves; seen handles pre-existing bad cycles.
    let Some(folder_id) = folder_id else {
        return Ok(());
    };
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut cursor = Some(parent_id.to_string());
    while let Some(current_id) = cursor {
        if current_id == folder_id {
            return Err(AppError::invalid_input(
                "A folder cannot be nested inside one of its own subfolders.",
            ));
        }
        if !seen.insert(current_id.clone()) {
            break;
        }
        cursor = state
            .storage
            .get("lorebook-folders", &current_id)?
            .as_ref()
            .and_then(|node| node.get("parentFolderId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|candidate| !candidate.is_empty())
            .map(str::to_string);
    }
    Ok(())
}

pub(super) fn library_folder_defaults_for_create(value: Value) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    normalize_library_folder_name(&mut object)?;
    if object
        .get("sortOrder")
        .and_then(Value::as_i64)
        .is_none_or(|value| value < 0)
    {
        object.insert("sortOrder".to_string(), json!(0));
    }
    if object
        .get("order")
        .and_then(Value::as_i64)
        .is_none_or(|value| value < 0)
    {
        let order = object
            .get("sortOrder")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        object.insert("order".to_string(), json!(order));
    }
    Ok(Value::Object(object))
}

pub(super) fn normalize_library_folder_name(
    object: &mut Map<String, Value>,
) -> Result<(), AppError> {
    if let Some(name) = object.get("name") {
        let name = name
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::invalid_input("Library folder name is required"))?;
        object.insert("name".to_string(), Value::String(name.to_string()));
    }
    Ok(())
}

pub(super) fn normalize_library_folder_for_update(
    entity: &str,
    patch: Value,
) -> Result<Value, AppError> {
    if !matches!(entity, "lorebook-library-folders" | "preset-folders") {
        return Ok(patch);
    }
    let mut object = ensure_object(patch)?;
    normalize_library_folder_name(&mut object)?;
    Ok(Value::Object(object))
}

pub(crate) fn validate_library_folder_for_create(
    _state: &AppState,
    entity: &str,
    value: &Value,
) -> Result<(), AppError> {
    if !matches!(entity, "lorebook-library-folders" | "preset-folders") {
        return Ok(());
    }
    let object = value
        .as_object()
        .ok_or_else(|| AppError::invalid_input("Library folder must be an object"))?;
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if name.is_none() {
        return Err(AppError::invalid_input("Library folder name is required"));
    }
    Ok(())
}

pub(crate) fn validate_library_folder_for_patch(
    _state: &AppState,
    entity: &str,
    patch: &Value,
) -> Result<(), AppError> {
    if !matches!(entity, "lorebook-library-folders" | "preset-folders") {
        return Ok(());
    }
    let object = patch
        .as_object()
        .ok_or_else(|| AppError::invalid_input("Patch must be an object"))?;
    if let Some(name) = object.get("name") {
        let valid = name
            .as_str()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        if !valid {
            return Err(AppError::invalid_input("Library folder name is required"));
        }
    }
    Ok(())
}

pub(crate) fn validate_library_item_folder_for_create(
    state: &AppState,
    entity: &str,
    value: &Value,
) -> Result<(), AppError> {
    let Some(folder_collection) = library_folder_collection_for_item_entity(entity) else {
        return Ok(());
    };
    validate_library_item_folder_assignment(
        state,
        folder_collection,
        parse_chat_folder_id(value.get("folderId"))?,
    )
}

pub(crate) fn validate_library_item_folder_for_patch(
    state: &AppState,
    entity: &str,
    patch: &Value,
) -> Result<(), AppError> {
    let Some(folder_collection) = library_folder_collection_for_item_entity(entity) else {
        return Ok(());
    };
    let Some(object) = patch.as_object() else {
        return Err(AppError::invalid_input("Patch must be an object"));
    };
    if !object.contains_key("folderId") {
        return Ok(());
    }
    validate_library_item_folder_assignment(
        state,
        folder_collection,
        parse_chat_folder_id(patch.get("folderId"))?,
    )
}

pub(super) fn normalize_library_item_folder_for_create(
    entity: &str,
    value: Value,
) -> Result<Value, AppError> {
    if library_folder_collection_for_item_entity(entity).is_none() {
        return Ok(value);
    }
    let mut object = ensure_object(value)?;
    normalize_folder_id_object(&mut object)?;
    Ok(Value::Object(object))
}

pub(super) fn normalize_library_item_folder_for_update(
    entity: &str,
    patch: Value,
) -> Result<Value, AppError> {
    if library_folder_collection_for_item_entity(entity).is_none() {
        return Ok(patch);
    }
    let mut object = ensure_object(patch)?;
    normalize_folder_id_object(&mut object)?;
    Ok(Value::Object(object))
}

pub(super) fn normalize_folder_id_object(object: &mut Map<String, Value>) -> Result<(), AppError> {
    if !object.contains_key("folderId") {
        return Ok(());
    }
    let normalized = parse_chat_folder_id(object.get("folderId"))?
        .map(Value::String)
        .unwrap_or(Value::Null);
    object.insert("folderId".to_string(), normalized);
    Ok(())
}

pub(super) fn library_folder_collection_for_item_entity(entity: &str) -> Option<&'static str> {
    match entity {
        "lorebooks" => Some("lorebook-library-folders"),
        "prompts" => Some("preset-folders"),
        _ => None,
    }
}

pub(super) fn validate_library_item_folder_assignment(
    state: &AppState,
    folder_collection: &str,
    folder_id: Option<String>,
) -> Result<(), AppError> {
    let Some(folder_id) = folder_id else {
        return Ok(());
    };
    if state.storage.get(folder_collection, &folder_id)?.is_some() {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!(
            "{folder_collection}/{folder_id} was not found"
        )))
    }
}

/// Reject a `global-gallery` row whose `folderId` points at a `gallery-folders`
/// row that does not exist. The dedicated upload command coerces a missing
/// folder to root, but the generic create/update path (used by the lightbox
/// move and any remote caller) must guard the reference itself so a stale UI
/// race or remote write can't strand an image under a ghost folder.
pub(crate) fn validate_gallery_folder_for_create(
    state: &AppState,
    entity: &str,
    value: &Value,
) -> Result<(), AppError> {
    if entity != "global-gallery" {
        return Ok(());
    }
    validate_gallery_folder_assignment(state, parse_chat_folder_id(value.get("folderId"))?)
}

pub(crate) fn validate_gallery_folder_for_patch(
    state: &AppState,
    entity: &str,
    patch: &Value,
) -> Result<(), AppError> {
    if entity != "global-gallery" {
        return Ok(());
    }
    let Some(object) = patch.as_object() else {
        return Err(AppError::invalid_input("Patch must be an object"));
    };
    if !object.contains_key("folderId") {
        return Ok(());
    }
    validate_gallery_folder_assignment(state, parse_chat_folder_id(patch.get("folderId"))?)
}

pub(super) fn validate_gallery_folder_assignment(
    state: &AppState,
    folder_id: Option<String>,
) -> Result<(), AppError> {
    let Some(folder_id) = folder_id else {
        return Ok(());
    };
    if state.storage.get("gallery-folders", &folder_id)?.is_some() {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!(
            "gallery-folders/{folder_id} was not found"
        )))
    }
}

pub(super) fn parse_chat_folder_id(folder_id: Option<&Value>) -> Result<Option<String>, AppError> {
    let Some(folder_id) = folder_id else {
        return Ok(None);
    };
    if folder_id.is_null() {
        return Ok(None);
    }
    let Some(folder_id) = folder_id
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(AppError::invalid_input(
            "folderId must be a folder id or null",
        ));
    };
    Ok(Some(folder_id.to_string()))
}

pub(super) fn chat_mode_for_value(value: &Value) -> Result<&'static str, AppError> {
    let Some(mode) = value
        .get("mode")
        .and_then(Value::as_str)
        .and_then(canonical_chat_mode)
    else {
        return Err(AppError::invalid_input("Chat mode is required"));
    };
    Ok(mode)
}

pub(super) fn canonical_chat_mode(mode: &str) -> Option<&'static str> {
    match mode.trim() {
        "conversation" => Some("conversation"),
        "roleplay" | "visual_novel" => Some("roleplay"),
        "game" => Some("game"),
        _ => None,
    }
}

pub(super) fn connection_default_agent_scope(connection: &Value) -> Option<&'static str> {
    let provider = connection.get("provider").and_then(Value::as_str)?.trim();
    Some(if provider == "image_generation" {
        "image"
    } else {
        "language"
    })
}

pub(super) fn connection_default_for_agents_enabled(connection: &Value) -> bool {
    connection
        .get("defaultForAgents")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(super) fn connection_is_default(connection: &Value) -> bool {
    value_truthy(connection.get("isDefault")) || value_truthy(connection.get("default"))
}

pub(super) fn clear_other_default_connections(
    state: &AppState,
    selected_connection: &Value,
) -> Result<(), AppError> {
    if !connection_is_default(selected_connection) {
        return Ok(());
    }
    let Some(selected_id) = selected_connection
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
    else {
        return Ok(());
    };
    for connection in state.storage.list("connections")? {
        let Some(id) = connection
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| *id != selected_id)
        else {
            continue;
        };
        if !connection_is_default(&connection) {
            continue;
        }
        state.storage.patch(
            "connections",
            id,
            json!({ "isDefault": false, "default": false }),
        )?;
    }
    Ok(())
}

pub(super) fn clear_other_default_agent_connections(
    state: &AppState,
    selected_connection: &Value,
) -> Result<(), AppError> {
    if !connection_default_for_agents_enabled(selected_connection) {
        return Ok(());
    }
    let Some(selected_id) = selected_connection
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
    else {
        return Ok(());
    };
    let Some(selected_scope) = connection_default_agent_scope(selected_connection) else {
        return Ok(());
    };
    for connection in state.storage.list("connections")? {
        let Some(id) = connection
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| *id != selected_id)
        else {
            continue;
        };
        if !connection_default_for_agents_enabled(&connection) {
            continue;
        }
        if connection_default_agent_scope(&connection) != Some(selected_scope) {
            continue;
        }
        state
            .storage
            .patch("connections", id, json!({ "defaultForAgents": false }))?;
    }
    Ok(())
}
