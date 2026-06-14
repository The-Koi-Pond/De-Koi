use super::*;

pub(crate) fn delete_entity(
    state: &AppState,
    entity: &str,
    id: &str,
    force: bool,
) -> Result<Value, AppError> {
    validate_storage_entity(entity)?;
    reject_message_swipe_mutation(entity)?;
    if entity == "connections" {
        let existing = state.storage.get("connections", id)?;
        let result = crate::connection_refs::delete_connection(state, id, force)?;
        if result.get("deleted").and_then(Value::as_bool) == Some(true) {
            if let Some(record) = existing.as_ref() {
                remove_owned_media(state, entity, record);
            }
        }
        return Ok(result);
    }
    if entity == "chats" {
        let existed = state.storage.get("chats", id)?.is_some();
        let mut deleted_chat_ids = Vec::new();
        if existed {
            deleted_chat_ids = chats::delete_chat_with_messages(state, id)?;
        }
        return Ok(json!({ "deleted": existed, "deletedChatIds": deleted_chat_ids }));
    }
    if is_protected_record(entity, id) {
        return Err(AppError::invalid_input(
            "Protected records cannot be deleted",
        ));
    }
    if entity == "chat-presets" {
        if chat_preset_is_default_id(state, id)? {
            return Err(AppError::invalid_input(
                "Default chat presets cannot be deleted",
            ));
        }
        let deleted = delete_chat_preset_with_default_activation(state, id)?;
        return Ok(json!({ "deleted": deleted }));
    }
    if entity == "lorebook-entries" {
        let deleted = delete_lorebook_entry_with_character_book_sync(state, id)?;
        return Ok(json!({ "deleted": deleted }));
    }
    if entity == "lorebook-folders" {
        let deleted = delete_lorebook_folder_with_entry_reparent_sync(state, id)?;
        return Ok(json!({ "deleted": deleted }));
    }
    if entity == "chat-folders" {
        let deleted = delete_chat_folder_with_chat_unfile(state, id)?;
        return Ok(json!({ "deleted": deleted }));
    }
    if entity == "lorebooks" {
        let deleted = delete_lorebook_with_children_and_reference_cleanup(state, id)?;
        if let Some(record) = deleted.as_ref() {
            remove_owned_media(state, entity, record);
        }
        return Ok(json!({ "deleted": deleted.is_some() }));
    }
    let existing = owned_record_for_delete(state, entity, id)?;
    let message_chat_id = if entity == "messages" {
        existing
            .as_ref()
            .and_then(|record| record.get("chatId"))
            .and_then(Value::as_str)
            .map(str::to_string)
    } else {
        None
    };
    let deleted = if entity == "messages" {
        if let (Some(chat_id), Some(message)) = (message_chat_id.as_deref(), existing.as_ref()) {
            let (deleted, _) = chats::delete_message_rows_with_memory_prune(
                state,
                chat_id,
                std::slice::from_ref(message),
            )?;
            deleted > 0
        } else {
            false
        }
    } else {
        state.storage.delete(entity, id)?
    };
    if deleted {
        apply_delete_cleanup(
            state,
            entity,
            id,
            existing.as_ref(),
            message_chat_id.as_deref(),
        )?;
    }
    Ok(json!({ "deleted": deleted }))
}

pub(super) fn apply_delete_cleanup(
    state: &AppState,
    entity: &str,
    id: &str,
    existing: Option<&Value>,
    message_chat_id: Option<&str>,
) -> Result<(), AppError> {
    let Some(contract) = contracts::collection_contract(entity) else {
        return Ok(());
    };
    for cleanup in contract.delete_cleanup {
        match cleanup {
            contracts::DeleteCleanup::ActivateDefaultChatPreset => {
                if let Some(record) = existing {
                    activate_default_chat_preset_if_needed(state, record)?;
                }
            }
            contracts::DeleteCleanup::ClearChatFolder => unfile_chats_in_folder(state, id)?,
            contracts::DeleteCleanup::ClearConnectionFolder => {
                unfile_connections_in_folder(state, id)?
            }
            contracts::DeleteCleanup::ClearGalleryFolder => {
                unfile_records_in_folder(state, "global-gallery", id)?
            }
            contracts::DeleteCleanup::ClearLorebookReferences => {
                clear_deleted_lorebook_references(state, id)?;
            }
            contracts::DeleteCleanup::DeleteCharacterGallery => {
                delete_character_gallery(state, id)?
            }
            contracts::DeleteCleanup::DeletePersonaGallery => delete_persona_gallery(state, id)?,
            contracts::DeleteCleanup::DeleteLorebookChildren => {
                delete_lorebook_children(state, id)?
            }
            contracts::DeleteCleanup::DeleteMessageTrackerSnapshots => {
                if entity != "messages" {
                    continue;
                }
                if let Some(chat_id) = message_chat_id {
                    game_state_snapshots::delete_tracker_snapshots_for_message(state, chat_id, id)?;
                    game_state_snapshots::sync_chat_game_state_to_visible_tracker(state, chat_id)?;
                }
            }
            contracts::DeleteCleanup::DeletePromptChildren => {
                prompts::delete_prompt_preset_children(state, id)?;
            }
            contracts::DeleteCleanup::RemoveOwnedMedia => {
                if let Some(record) = existing {
                    remove_owned_media(state, entity, record);
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn connection_folder_reorder_inner(
    state: &AppState,
    ordered_ids: Vec<String>,
) -> Result<Value, AppError> {
    validate_connection_folder_reorder(state, &ordered_ids)?;
    let patches = ordered_ids
        .into_iter()
        .enumerate()
        .map(|(index, id)| (id, json!({ "sortOrder": index, "order": index })))
        .collect::<Vec<_>>();
    let rows = state.storage.patch_many("connection-folders", patches)?;
    Ok(Value::Array(rows))
}

pub(super) fn validate_connection_folder_reorder(
    state: &AppState,
    ordered_ids: &[String],
) -> Result<(), AppError> {
    let mut seen = HashSet::with_capacity(ordered_ids.len());
    if ordered_ids
        .iter()
        .any(|id| id.trim().is_empty() || !seen.insert(id.as_str()))
    {
        return Err(AppError::invalid_input(
            "Connection folder reorder must include each folder id exactly once",
        ));
    }

    let existing_ids = state
        .storage
        .list("connection-folders")?
        .into_iter()
        .filter_map(|folder| {
            folder
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect::<HashSet<_>>();
    let ordered_ids = ordered_ids.iter().cloned().collect::<HashSet<_>>();
    if existing_ids != ordered_ids {
        return Err(AppError::invalid_input(
            "Connection folder reorder must include every existing folder exactly once",
        ));
    }
    Ok(())
}

pub(crate) fn lorebook_folder_reorder_inner(
    state: &AppState,
    lorebook_id: &str,
    ordered_ids: Vec<String>,
    parent_folder_id: Option<String>,
) -> Result<Value, AppError> {
    let lorebook_id = lorebook_id.trim().to_string();
    if lorebook_id.is_empty() {
        return Err(AppError::invalid_input("lorebookId is required"));
    }
    let parent_folder_id = normalize_lorebook_reorder_parent_id(parent_folder_id)?;
    let ordered_ids = normalize_lorebook_reorder_ids(ordered_ids)?;

    state
        .storage
        .update_collections_atomically(vec!["lorebook-folders"], move |collections| {
            let [folders] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Lorebook folder reorder expected the lorebook folder collection",
                ));
            };
            if folders.collection() != "lorebook-folders" {
                return Err(AppError::new(
                    "storage_error",
                    "Lorebook folder reorder received an unexpected collection",
                ));
            }
            lorebook_folder_reorder_in_rows(
                folders.rows_mut(),
                &lorebook_id,
                ordered_ids,
                parent_folder_id,
            )
        })
}

pub(super) fn lorebook_folder_reorder_in_rows(
    folder_rows: &mut [Value],
    lorebook_id: &str,
    ordered_ids: Vec<String>,
    parent_folder_id: Option<String>,
) -> Result<Value, AppError> {
    let by_id = folder_rows
        .iter()
        .enumerate()
        .filter_map(|folder| {
            let (index, folder) = folder;
            let id = folder.get("id").and_then(Value::as_str)?.to_string();
            Some((
                id,
                LorebookFolderReorderRow {
                    lorebook_id: lorebook_folder_lorebook_id(folder),
                    parent_id: lorebook_folder_parent_id(folder),
                    order: lorebook_folder_order(folder, index),
                },
            ))
        })
        .collect::<HashMap<_, _>>();
    let ordered_id_set = ordered_ids.iter().cloned().collect::<HashSet<_>>();

    if let Some(parent_id) = parent_folder_id.as_deref() {
        validate_lorebook_folder_parent_in_rows(&by_id, Some(lorebook_id), None, parent_id)?;
    }

    for id in &ordered_ids {
        if by_id
            .get(id)
            .and_then(|folder| folder.lorebook_id.as_deref())
            != Some(lorebook_id)
        {
            return Err(AppError::invalid_input(format!(
                "lorebook-folders/{id} does not belong to lorebook {lorebook_id}"
            )));
        }
        if let Some(parent_id) = parent_folder_id.as_deref() {
            validate_lorebook_folder_parent_in_rows(
                &by_id,
                Some(lorebook_id),
                Some(id),
                parent_id,
            )?;
        }
    }

    for sibling_id in by_id
        .iter()
        .filter(|(_, folder)| {
            folder.lorebook_id.as_deref() == Some(lorebook_id)
                && folder.parent_id.as_deref() == parent_folder_id.as_deref()
        })
        .map(|(id, _)| id.clone())
    {
        if !ordered_id_set.contains(&sibling_id) {
            return Err(AppError::invalid_input(
                "Lorebook folder reorder must include every existing sibling in the target folder",
            ));
        }
    }

    let affected_source_parents = ordered_ids
        .iter()
        .filter_map(|id| by_id.get(id))
        .filter(|folder| folder.parent_id.as_deref() != parent_folder_id.as_deref())
        .map(|folder| folder.parent_id.clone())
        .collect::<HashSet<_>>();
    let source_reorders = affected_source_parents
        .into_iter()
        .map(|source_parent_id| {
            let mut siblings = by_id
                .iter()
                .filter(|(id, folder)| {
                    folder.lorebook_id.as_deref() == Some(lorebook_id)
                        && folder.parent_id.as_deref() == source_parent_id.as_deref()
                        && !ordered_id_set.contains(*id)
                })
                .map(|(id, folder)| (folder.order, id.clone()))
                .collect::<Vec<_>>();
            siblings.sort_by(|(left_order, left_id), (right_order, right_id)| {
                left_order
                    .cmp(right_order)
                    .then_with(|| left_id.cmp(right_id))
            });
            (
                source_parent_id,
                siblings.into_iter().map(|(_, id)| id).collect::<Vec<_>>(),
            )
        })
        .collect::<Vec<_>>();

    let parent_patch = parent_folder_id.map(Value::String).unwrap_or(Value::Null);
    let now = now_iso();
    for (index, id) in ordered_ids.iter().enumerate() {
        patch_lorebook_folder_reorder_row(folder_rows, id, index, Some(&parent_patch), &now)?;
    }
    for (_source_parent_id, sibling_ids) in source_reorders {
        for (index, id) in sibling_ids.iter().enumerate() {
            patch_lorebook_folder_reorder_row(folder_rows, id, index, None, &now)?;
        }
    }

    Ok(Value::Array(
        folder_rows
            .iter()
            .filter(|folder| lorebook_folder_lorebook_id(folder).as_deref() == Some(lorebook_id))
            .cloned()
            .collect(),
    ))
}

pub(super) fn patch_lorebook_folder_reorder_row(
    folder_rows: &mut [Value],
    id: &str,
    index: usize,
    parent_patch: Option<&Value>,
    now: &str,
) -> Result<(), AppError> {
    let row = folder_rows
        .iter_mut()
        .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| AppError::not_found(format!("lorebook-folders/{id} was not found")))?;
    let Some(object) = row.as_object_mut() else {
        return Err(AppError::invalid_input("Stored record is not an object"));
    };
    object.insert("order".to_string(), json!(index));
    object.insert("sortOrder".to_string(), json!(index));
    if let Some(parent_patch) = parent_patch {
        object.insert("parentFolderId".to_string(), parent_patch.clone());
    }
    object.insert("updatedAt".to_string(), Value::String(now.to_string()));
    Ok(())
}

pub(super) fn normalize_lorebook_reorder_parent_id(
    parent_folder_id: Option<String>,
) -> Result<Option<String>, AppError> {
    let Some(parent_folder_id) = parent_folder_id else {
        return Ok(None);
    };
    let parent_folder_id = parent_folder_id.trim();
    if parent_folder_id.is_empty() {
        return Err(AppError::invalid_input(
            "parentFolderId must be a folder id or null",
        ));
    }
    Ok(Some(parent_folder_id.to_string()))
}

pub(super) fn normalize_lorebook_reorder_ids(
    ordered_ids: Vec<String>,
) -> Result<Vec<String>, AppError> {
    if ordered_ids.is_empty() {
        return Err(AppError::invalid_input(
            "Lorebook folder reorder must include at least one folder",
        ));
    }
    let mut seen = HashSet::with_capacity(ordered_ids.len());
    let mut normalized = Vec::with_capacity(ordered_ids.len());
    for raw_id in ordered_ids {
        let id = raw_id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            return Err(AppError::invalid_input(
                "Lorebook folder reorder must include each folder id exactly once",
            ));
        }
        normalized.push(id);
    }
    Ok(normalized)
}

pub(super) fn validate_lorebook_folder_parent_in_rows(
    by_id: &HashMap<String, LorebookFolderReorderRow>,
    lorebook_id: Option<&str>,
    folder_id: Option<&str>,
    parent_id: &str,
) -> Result<(), AppError> {
    if Some(parent_id) == folder_id {
        return Err(AppError::invalid_input(
            "A folder cannot be its own parent.",
        ));
    }
    let parent = by_id.get(parent_id).ok_or_else(|| {
        AppError::invalid_input(format!("lorebook-folders/{parent_id} was not found"))
    })?;
    if let Some(lorebook_id) = lorebook_id {
        if parent.lorebook_id.as_deref() != Some(lorebook_id) {
            return Err(AppError::invalid_input(
                "A folder can only nest under a folder in the same lorebook.",
            ));
        }
    }

    let Some(folder_id) = folder_id else {
        return Ok(());
    };
    let mut seen = HashSet::new();
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
        cursor = by_id
            .get(&current_id)
            .and_then(|node| node.parent_id.clone());
    }
    Ok(())
}

pub(super) fn lorebook_folder_order(folder: &Value, fallback: usize) -> i64 {
    folder
        .get("order")
        .or_else(|| folder.get("sortOrder"))
        .and_then(Value::as_i64)
        .unwrap_or(fallback as i64)
}

pub(super) fn lorebook_folder_parent_id(folder: &Value) -> Option<String> {
    folder
        .get("parentFolderId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn connection_move_inner(
    state: &AppState,
    connection_id: &str,
    folder_id: Option<String>,
) -> Result<Value, AppError> {
    let folder_value = folder_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| Value::String(value.to_string()))
        .unwrap_or(Value::Null);
    validate_connection_folder_id(state, Some(&folder_value))?;
    connection_secrets::patch_connection(state, connection_id, json!({ "folderId": folder_value }))
}

pub(super) fn unfile_connections_in_folder(
    state: &AppState,
    folder_id: &str,
) -> Result<(), AppError> {
    unfile_records_in_folder(state, "connections", folder_id)
}

pub(super) fn unfile_chats_in_folder(state: &AppState, folder_id: &str) -> Result<(), AppError> {
    unfile_records_in_folder(state, "chats", folder_id)
}

pub(super) fn unfile_records_in_folder(
    state: &AppState,
    collection: &str,
    folder_id: &str,
) -> Result<(), AppError> {
    let mut filters = Map::new();
    filters.insert("folderId".to_string(), Value::String(folder_id.to_string()));
    let rows = state.storage.list_where(collection, &filters)?;
    let patches = rows
        .into_iter()
        .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_string))
        .map(|id| (id, json!({ "folderId": Value::Null })))
        .collect::<Vec<_>>();
    if !patches.is_empty() {
        state.storage.patch_many(collection, patches)?;
    }
    Ok(())
}

pub(super) fn delete_character_gallery(
    state: &AppState,
    character_id: &str,
) -> Result<(), AppError> {
    let mut filters = Map::new();
    filters.insert(
        "characterId".to_string(),
        Value::String(character_id.to_string()),
    );
    let rows = state.storage.list_where("character-gallery", &filters)?;
    for row in &rows {
        remove_gallery_file(state, row);
    }
    state.storage.delete_where("character-gallery", &filters)?;
    Ok(())
}

pub(super) fn delete_persona_gallery(state: &AppState, persona_id: &str) -> Result<(), AppError> {
    let mut filters = Map::new();
    filters.insert(
        "personaId".to_string(),
        Value::String(persona_id.to_string()),
    );
    let rows = state.storage.list_where("persona-gallery", &filters)?;
    for row in &rows {
        remove_gallery_file(state, row);
    }
    state.storage.delete_where("persona-gallery", &filters)?;
    Ok(())
}

pub(super) fn delete_lorebook_children(
    state: &AppState,
    lorebook_id: &str,
) -> Result<(), AppError> {
    let mut filters = Map::new();
    filters.insert(
        "lorebookId".to_string(),
        Value::String(lorebook_id.to_string()),
    );
    state.storage.delete_where("lorebook-entries", &filters)?;
    state.storage.delete_where("lorebook-folders", &filters)?;
    Ok(())
}

pub(super) fn delete_lorebook_with_children_and_reference_cleanup(
    state: &AppState,
    id: &str,
) -> Result<Option<Value>, AppError> {
    let lorebook_id = id.to_string();
    state.storage.update_collections_atomically(
        vec![
            "lorebooks",
            "lorebook-entries",
            "lorebook-folders",
            "chats",
            "characters",
        ],
        move |collections| {
            let (lorebook_rows, entry_rows, folder_rows, chat_rows, character_rows) =
                lorebook_delete_atomic_rows(collections)?;
            let previous = lorebook_rows
                .iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(lorebook_id.as_str()))
                .cloned();
            if previous.is_none() {
                return Ok(None);
            }

            lorebook_rows
                .retain(|row| row.get("id").and_then(Value::as_str) != Some(lorebook_id.as_str()));
            entry_rows.retain(|row| {
                row.get("lorebookId").and_then(Value::as_str) != Some(lorebook_id.as_str())
            });
            folder_rows.retain(|row| {
                row.get("lorebookId").and_then(Value::as_str) != Some(lorebook_id.as_str())
            });
            clear_deleted_lorebook_from_chat_rows_in_place(chat_rows, &lorebook_id)?;
            clear_deleted_lorebook_from_character_rows_in_place(character_rows, &lorebook_id)?;
            Ok(previous)
        },
    )
}

pub(super) fn lorebook_entry_lorebook_id(entry: &Value) -> Option<&str> {
    entry
        .get("lorebookId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(super) fn create_lorebook_entry_with_character_book_sync(
    state: &AppState,
    value: Value,
) -> Result<Value, AppError> {
    let mut object = ensure_object(value)?;
    let had_id = object
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|id| !id.trim().is_empty());
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(new_id);
    let now = now_iso();
    object.insert("id".to_string(), Value::String(id.clone()));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object
        .entry("updatedAt".to_string())
        .or_insert_with(|| Value::String(now));
    let record = Value::Object(object);
    let created = record.clone();
    state.storage.update_collections_atomically(
        vec!["lorebook-entries", "characters"],
        move |collections| {
            let (entry_rows, character_rows) = lorebook_entry_atomic_rows(collections)?;
            if had_id
                && entry_rows
                    .iter()
                    .any(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
            {
                return Err(AppError::invalid_input(format!(
                    "lorebook-entries/{id} already exists"
                )));
            }
            entry_rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(id.as_str()));
            entry_rows.push(record);
            sync_linked_character_books_for_entry_rows_in_place(
                character_rows,
                entry_rows,
                &[&created],
            )?;
            Ok(created)
        },
    )
}

pub(super) fn update_lorebook_entry_with_character_book_sync(
    state: &AppState,
    id: &str,
    patch: Value,
) -> Result<Value, AppError> {
    let patch = ensure_object(patch)?;
    state.storage.update_collections_atomically(
        vec!["lorebook-entries", "characters"],
        move |collections| {
            let (entry_rows, character_rows) = lorebook_entry_atomic_rows(collections)?;
            let previous = entry_rows
                .iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
                .cloned()
                .ok_or_else(|| {
                    AppError::not_found(format!("lorebook-entries/{id} was not found"))
                })?;
            let row = entry_rows
                .iter_mut()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
                .ok_or_else(|| {
                    AppError::not_found(format!("lorebook-entries/{id} was not found"))
                })?;
            let Some(object) = row.as_object_mut() else {
                return Err(AppError::invalid_input("Stored record is not an object"));
            };
            if lorebook_entry_patch_invalidates_embedding(&previous, &patch) {
                clear_lorebook_entry_embedding(object);
            }
            for (key, value) in patch {
                object.insert(key, value);
            }
            object.insert("updatedAt".to_string(), Value::String(now_iso()));
            let updated = Value::Object(object.clone());
            sync_linked_character_books_for_entry_rows_in_place(
                character_rows,
                entry_rows,
                &[&previous, &updated],
            )?;
            Ok(updated)
        },
    )
}

pub(super) fn lorebook_entry_patch_invalidates_embedding(
    previous: &Value,
    patch: &Map<String, Value>,
) -> bool {
    [
        "name",
        "description",
        "content",
        "keys",
        "secondaryKeys",
        "excludeFromVectorization",
    ]
    .into_iter()
    .any(|field| lorebook_entry_embedding_input_changed(previous, patch, field))
}

pub(super) fn lorebook_entry_embedding_input_changed(
    previous: &Value,
    patch: &Map<String, Value>,
    field: &str,
) -> bool {
    let Some(next) = patch.get(field) else {
        return false;
    };
    if field == "excludeFromVectorization" {
        return value_truthy(previous.get(field)) != value_truthy(Some(next));
    }
    previous.get(field).unwrap_or(&Value::Null) != next
}

pub(super) fn clear_lorebook_entry_embedding(object: &mut Map<String, Value>) {
    object.insert("embedding".to_string(), Value::Null);
    object.insert("embeddingModel".to_string(), Value::Null);
    object.insert("embeddingConnectionId".to_string(), Value::Null);
    object.insert("embeddingUpdatedAt".to_string(), Value::Null);
}

pub(super) fn delete_lorebook_entry_with_character_book_sync(
    state: &AppState,
    id: &str,
) -> Result<bool, AppError> {
    state.storage.update_collections_atomically(
        vec!["lorebook-entries", "characters"],
        move |collections| {
            let (entry_rows, character_rows) = lorebook_entry_atomic_rows(collections)?;
            let previous = entry_rows
                .iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
                .cloned();
            let before = entry_rows.len();
            entry_rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(id));
            let deleted = entry_rows.len() != before;
            if let Some(previous) = previous.as_ref().filter(|_| deleted) {
                sync_linked_character_books_for_entry_rows_in_place(
                    character_rows,
                    entry_rows,
                    &[previous],
                )?;
            }
            Ok(deleted)
        },
    )
}

pub(super) fn update_lorebook_with_character_book_sync(
    state: &AppState,
    id: &str,
    patch: Value,
) -> Result<Value, AppError> {
    let patch = ensure_object(patch)?;
    state.storage.update_collections_atomically(
        vec!["lorebooks", "lorebook-entries", "characters"],
        move |collections| {
            let (lorebook_rows, entry_rows, character_rows) =
                lorebook_metadata_atomic_rows(collections)?;
            let row = lorebook_rows
                .iter_mut()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
                .ok_or_else(|| AppError::not_found(format!("lorebooks/{id} was not found")))?;
            let Some(object) = row.as_object_mut() else {
                return Err(AppError::invalid_input("Stored record is not an object"));
            };
            for (key, value) in patch {
                object.insert(key, value);
            }
            object.insert("updatedAt".to_string(), Value::String(now_iso()));
            let updated = Value::Object(object.clone());
            sync_linked_character_books_for_lorebook_record_in_place(
                character_rows,
                entry_rows,
                &updated,
            )?;
            Ok(updated)
        },
    )
}

pub(super) fn delete_lorebook_folder_with_entry_reparent_sync(
    state: &AppState,
    folder_id: &str,
) -> Result<bool, AppError> {
    state.storage.update_collections_atomically(
        vec!["lorebook-folders", "lorebook-entries", "characters"],
        move |collections| {
            let (folder_rows, entry_rows, character_rows) =
                lorebook_folder_delete_atomic_rows(collections)?;
            let before = folder_rows.len();
            folder_rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(folder_id));
            let deleted = folder_rows.len() != before;
            if !deleted {
                return Ok(false);
            }

            let now = now_iso();
            // Deleted parents promote direct children to root so stored ancestry matches the UI.
            for folder in folder_rows.iter_mut() {
                if folder.get("parentFolderId").and_then(Value::as_str) != Some(folder_id) {
                    continue;
                }
                let Some(object) = folder.as_object_mut() else {
                    return Err(AppError::invalid_input("Stored record is not an object"));
                };
                object.insert("parentFolderId".to_string(), Value::Null);
                object.insert("updatedAt".to_string(), Value::String(now.clone()));
            }
            let mut changed_entries = Vec::new();
            for entry in entry_rows.iter_mut() {
                if entry.get("folderId").and_then(Value::as_str) != Some(folder_id) {
                    continue;
                }
                let Some(object) = entry.as_object_mut() else {
                    return Err(AppError::invalid_input("Stored record is not an object"));
                };
                object.insert("folderId".to_string(), Value::Null);
                object.insert("updatedAt".to_string(), Value::String(now.clone()));
                changed_entries.push(Value::Object(object.clone()));
            }

            if !changed_entries.is_empty() {
                let changed_refs = changed_entries.iter().collect::<Vec<_>>();
                sync_linked_character_books_for_entry_rows_in_place(
                    character_rows,
                    entry_rows,
                    &changed_refs,
                )?;
            }
            Ok(true)
        },
    )
}

pub(super) fn delete_chat_folder_with_chat_unfile(
    state: &AppState,
    folder_id: &str,
) -> Result<bool, AppError> {
    state
        .storage
        .update_collections_atomically(vec!["chat-folders", "chats"], move |collections| {
            delete_chat_folder_in_rows(collections, folder_id)
        })
}

pub(super) fn delete_chat_folder_in_rows(
    collections: &mut [marinara_storage::AtomicCollectionRows],
    folder_id: &str,
) -> Result<bool, AppError> {
    let (folder_rows, chat_rows) = chat_folder_delete_atomic_rows(collections)?;
    let before = folder_rows.len();
    folder_rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(folder_id));
    let deleted = folder_rows.len() != before;
    if !deleted {
        return Ok(false);
    }

    let now = now_iso();
    for chat in chat_rows.iter_mut() {
        if chat.get("folderId").and_then(Value::as_str) != Some(folder_id) {
            continue;
        }
        let Some(object) = chat.as_object_mut() else {
            return Err(AppError::invalid_input("Stored record is not an object"));
        };
        object.insert("folderId".to_string(), Value::Null);
        object.insert("updatedAt".to_string(), Value::String(now.clone()));
    }
    Ok(true)
}

pub(super) fn chat_folder_delete_atomic_rows(
    collections: &mut [marinara_storage::AtomicCollectionRows],
) -> Result<ChatFolderDeleteAtomicRows<'_>, AppError> {
    let [folders, chats] = collections else {
        return Err(AppError::new(
            "storage_error",
            "Chat folder delete expected folder and chat collections",
        ));
    };
    match (folders.collection(), chats.collection()) {
        ("chat-folders", "chats") => Ok((folders.rows_mut(), chats.rows_mut())),
        _ => Err(AppError::new(
            "storage_error",
            "Chat folder delete received unexpected collections",
        )),
    }
}

pub(super) fn lorebook_entry_atomic_rows(
    collections: &mut [marinara_storage::AtomicCollectionRows],
) -> Result<LorebookEntryAtomicRows<'_>, AppError> {
    let [left, right] = collections else {
        return Err(AppError::new(
            "storage_error",
            "Lorebook entry sync expected lorebook and character collections",
        ));
    };
    match (left.collection(), right.collection()) {
        ("lorebook-entries", "characters") => Ok((left.rows_mut(), right.rows_mut())),
        _ => Err(AppError::new(
            "storage_error",
            "Lorebook entry sync received unexpected collections",
        )),
    }
}

pub(super) fn lorebook_metadata_atomic_rows(
    collections: &mut [marinara_storage::AtomicCollectionRows],
) -> Result<LorebookMetadataAtomicRows<'_>, AppError> {
    let [lorebooks, entries, characters] = collections else {
        return Err(AppError::new(
            "storage_error",
            "Lorebook metadata sync expected lorebook, entry, and character collections",
        ));
    };
    match (
        lorebooks.collection(),
        entries.collection(),
        characters.collection(),
    ) {
        ("lorebooks", "lorebook-entries", "characters") => Ok((
            lorebooks.rows_mut(),
            entries.rows_mut(),
            characters.rows_mut(),
        )),
        _ => Err(AppError::new(
            "storage_error",
            "Lorebook metadata sync received unexpected collections",
        )),
    }
}

pub(super) fn lorebook_delete_atomic_rows(
    collections: &mut [marinara_storage::AtomicCollectionRows],
) -> Result<LorebookDeleteAtomicRows<'_>, AppError> {
    let [lorebooks, entries, folders, chats, characters] = collections else {
        return Err(AppError::new(
            "storage_error",
            "Lorebook delete expected lorebook, entry, folder, chat, and character collections",
        ));
    };
    match (
        lorebooks.collection(),
        entries.collection(),
        folders.collection(),
        chats.collection(),
        characters.collection(),
    ) {
        ("lorebooks", "lorebook-entries", "lorebook-folders", "chats", "characters") => Ok((
            lorebooks.rows_mut(),
            entries.rows_mut(),
            folders.rows_mut(),
            chats.rows_mut(),
            characters.rows_mut(),
        )),
        _ => Err(AppError::new(
            "storage_error",
            "Lorebook delete received unexpected collections",
        )),
    }
}

pub(super) fn lorebook_folder_delete_atomic_rows(
    collections: &mut [marinara_storage::AtomicCollectionRows],
) -> Result<LorebookFolderDeleteAtomicRows<'_>, AppError> {
    let [folders, entries, characters] = collections else {
        return Err(AppError::new(
            "storage_error",
            "Lorebook folder delete expected folder, entry, and character collections",
        ));
    };
    match (
        folders.collection(),
        entries.collection(),
        characters.collection(),
    ) {
        ("lorebook-folders", "lorebook-entries", "characters") => Ok((
            folders.rows_mut(),
            entries.rows_mut(),
            characters.rows_mut(),
        )),
        _ => Err(AppError::new(
            "storage_error",
            "Lorebook folder delete received unexpected collections",
        )),
    }
}

pub(super) fn sync_linked_character_books_for_entry_rows_in_place(
    character_rows: &mut [Value],
    all_entry_rows: &[Value],
    entries: &[&Value],
) -> Result<(), AppError> {
    let lorebook_ids = entries
        .iter()
        .filter_map(|entry| lorebook_entry_lorebook_id(entry))
        .collect::<HashSet<_>>();
    for lorebook_id in lorebook_ids {
        sync_linked_character_books_for_lorebook_in_place(
            character_rows,
            all_entry_rows,
            lorebook_id,
        )?;
    }
    Ok(())
}

pub(super) fn sync_linked_character_books_for_lorebook_in_place(
    character_rows: &mut [Value],
    all_entry_rows: &[Value],
    lorebook_id: &str,
) -> Result<(), AppError> {
    let mut entries = all_entry_rows
        .iter()
        .filter(|entry| lorebook_entry_lorebook_id(entry) == Some(lorebook_id))
        .cloned()
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        compare_json_values(
            left.get("sortOrder").or_else(|| left.get("order")),
            right.get("sortOrder").or_else(|| right.get("order")),
        )
        .then_with(|| compare_json_values(left.get("createdAt"), right.get("createdAt")))
    });

    for character in character_rows {
        let Some(character_id) = character.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mut data = character.get("data").cloned().unwrap_or_else(|| json!({}));
        if embedded_lorebook_id(&data) != Some(lorebook_id) {
            continue;
        }
        let Some(data_object) = data.as_object_mut() else {
            continue;
        };
        let mut book = match data_object.get("character_book") {
            Some(Value::Null) | None => Map::new(),
            Some(Value::Object(book)) => book.clone(),
            Some(_) => {
                return Err(AppError::invalid_input(format!(
                    "Character {character_id} has a malformed embedded lorebook"
                )));
            }
        };
        book.insert(
            "entries".to_string(),
            Value::Array(
                entries
                    .iter()
                    .enumerate()
                    .map(|(index, entry)| linked_character_book_entry(entry, index))
                    .collect(),
            ),
        );
        data_object.insert("character_book".to_string(), Value::Object(book));

        if let Some(import_metadata) = data
            .pointer_mut("/extensions/importMetadata/embeddedLorebook")
            .and_then(Value::as_object_mut)
        {
            import_metadata.insert("entriesImported".to_string(), json!(entries.len()));
            import_metadata.insert("hasEmbeddedLorebook".to_string(), Value::Bool(true));
        }
        let Some(character_object) = character.as_object_mut() else {
            return Err(AppError::invalid_input(
                "Stored character record is not an object",
            ));
        };
        character_object.insert("data".to_string(), data);
        character_object.insert("updatedAt".to_string(), Value::String(now_iso()));
    }
    Ok(())
}

pub(super) fn sync_linked_character_books_for_lorebook_record_in_place(
    character_rows: &mut [Value],
    all_entry_rows: &[Value],
    lorebook: &Value,
) -> Result<(), AppError> {
    let Some(lorebook_id) = lorebook.get("id").and_then(Value::as_str) else {
        return Ok(());
    };
    let mut entries = all_entry_rows
        .iter()
        .filter(|entry| lorebook_entry_lorebook_id(entry) == Some(lorebook_id))
        .cloned()
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        compare_json_values(
            left.get("sortOrder").or_else(|| left.get("order")),
            right.get("sortOrder").or_else(|| right.get("order")),
        )
        .then_with(|| compare_json_values(left.get("createdAt"), right.get("createdAt")))
    });

    for character in character_rows {
        let Some(character_id) = character.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mut data = character.get("data").cloned().unwrap_or_else(|| json!({}));
        if embedded_lorebook_id(&data) != Some(lorebook_id) {
            continue;
        }
        let Some(data_object) = data.as_object_mut() else {
            continue;
        };
        let mut book = match data_object.get("character_book") {
            Some(Value::Null) | None => Map::new(),
            Some(Value::Object(book)) => book.clone(),
            Some(_) => {
                return Err(AppError::invalid_input(format!(
                    "Character {character_id} has a malformed embedded lorebook"
                )));
            }
        };
        sync_linked_character_book_fields(&mut book, lorebook, &entries);
        data_object.insert("character_book".to_string(), Value::Object(book));

        if let Some(import_metadata) = data
            .pointer_mut("/extensions/importMetadata/embeddedLorebook")
            .and_then(Value::as_object_mut)
        {
            import_metadata.insert("entriesImported".to_string(), json!(entries.len()));
            import_metadata.insert("hasEmbeddedLorebook".to_string(), Value::Bool(true));
        }
        let Some(character_object) = character.as_object_mut() else {
            return Err(AppError::invalid_input(
                "Stored character record is not an object",
            ));
        };
        character_object.insert("data".to_string(), data);
        character_object.insert("updatedAt".to_string(), Value::String(now_iso()));
    }
    Ok(())
}

pub(super) fn sync_linked_character_book_fields(
    book: &mut Map<String, Value>,
    lorebook: &Value,
    entries: &[Value],
) {
    book.insert(
        "name".to_string(),
        json!(lorebook
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Character Lorebook")),
    );
    book.insert(
        "description".to_string(),
        json!(lorebook
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")),
    );
    book.insert(
        "scan_depth".to_string(),
        linked_character_book_number(lorebook.get("scanDepth"), 2),
    );
    book.insert(
        "token_budget".to_string(),
        linked_character_book_number(lorebook.get("tokenBudget"), 2048),
    );
    book.insert(
        "recursive_scanning".to_string(),
        json!(lorebook
            .get("recursiveScanning")
            .and_then(Value::as_bool)
            .unwrap_or(false)),
    );
    if !book.contains_key("extensions") {
        book.insert("extensions".to_string(), json!({}));
    }
    book.insert(
        "entries".to_string(),
        json!(entries
            .iter()
            .enumerate()
            .map(|(index, entry)| linked_character_book_entry(entry, index))
            .collect::<Vec<_>>()),
    );
}

pub(super) fn linked_character_book_number(value: Option<&Value>, fallback: i64) -> Value {
    match value {
        Some(Value::Number(number)) => Value::Number(number.clone()),
        _ => json!(fallback),
    }
}

pub(super) fn linked_character_book_entry(entry: &Value, index: usize) -> Value {
    let name = entry
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Entry");
    json!({
        "keys": shared::string_array_from_value(entry.get("keys")),
        "content": entry.get("content").and_then(Value::as_str).unwrap_or(""),
        "extensions": entry.get("extensions").cloned().unwrap_or_else(|| json!({})),
        "enabled": entry.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        "insertion_order": entry.get("order").or_else(|| entry.get("sortOrder")).and_then(Value::as_i64).unwrap_or(index as i64),
        "case_sensitive": entry.get("caseSensitive").and_then(Value::as_bool).unwrap_or(false),
        "name": name,
        "priority": entry.get("priority").and_then(Value::as_i64).unwrap_or(100),
        "id": index as i64,
        "comment": entry.get("comment").and_then(Value::as_str).unwrap_or(name),
        "selective": entry.get("selective").and_then(Value::as_bool).unwrap_or(false),
        "secondary_keys": shared::string_array_from_value(entry.get("secondaryKeys")),
        "constant": entry.get("constant").and_then(Value::as_bool).unwrap_or(false),
        "position": linked_character_book_position(entry.get("position")),
    })
}

pub(super) fn linked_character_book_position(value: Option<&Value>) -> &'static str {
    match value {
        Some(Value::String(raw)) if raw == "after_char" => "after_char",
        Some(Value::Number(raw)) if raw.as_i64() == Some(1) => "after_char",
        _ => "before_char",
    }
}

pub(super) fn remove_string_from_json_array(
    value: Option<&Value>,
    removed_id: &str,
) -> Option<Value> {
    let array = value?.as_array()?;
    let filtered = array
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| *id != removed_id)
        .map(|id| Value::String(id.to_string()))
        .collect::<Vec<_>>();
    (filtered.len() != array.len()).then_some(Value::Array(filtered))
}

pub(super) fn clear_deleted_lorebook_from_chats(
    state: &AppState,
    lorebook_id: &str,
) -> Result<(), AppError> {
    for chat in state.storage.list("chats")? {
        let Some(chat_id) = chat.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mut patch = Map::new();
        if let Some(active_ids) =
            remove_string_from_json_array(chat.get("activeLorebookIds"), lorebook_id)
        {
            patch.insert("activeLorebookIds".to_string(), active_ids);
        }

        let mut metadata = chat
            .get("metadata")
            .and_then(|value| shared::json_object_value(Some(value)))
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        if let Some(active_ids) =
            remove_string_from_json_array(metadata.get("activeLorebookIds"), lorebook_id)
        {
            metadata.insert("activeLorebookIds".to_string(), active_ids);
            patch.insert("metadata".to_string(), Value::Object(metadata));
        }

        if !patch.is_empty() {
            state
                .storage
                .patch("chats", chat_id, Value::Object(patch))?;
        }
    }
    Ok(())
}

pub(super) fn clear_deleted_lorebook_from_chat_rows_in_place(
    chat_rows: &mut [Value],
    lorebook_id: &str,
) -> Result<(), AppError> {
    for chat in chat_rows.iter_mut() {
        let mut patch = Map::new();
        if let Some(active_ids) =
            remove_string_from_json_array(chat.get("activeLorebookIds"), lorebook_id)
        {
            patch.insert("activeLorebookIds".to_string(), active_ids);
        }

        let mut metadata = chat
            .get("metadata")
            .and_then(|value| shared::json_object_value(Some(value)))
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        if let Some(active_ids) =
            remove_string_from_json_array(metadata.get("activeLorebookIds"), lorebook_id)
        {
            metadata.insert("activeLorebookIds".to_string(), active_ids);
            patch.insert("metadata".to_string(), Value::Object(metadata));
        }

        if patch.is_empty() {
            continue;
        }
        let Some(object) = chat.as_object_mut() else {
            return Err(AppError::invalid_input("Stored record is not an object"));
        };
        for (key, value) in patch {
            object.insert(key, value);
        }
    }
    Ok(())
}

pub(super) fn embedded_lorebook_id(data: &Value) -> Option<&str> {
    data.pointer("/extensions/importMetadata/embeddedLorebook/lorebookId")
        .and_then(Value::as_str)
}

pub(super) fn clear_deleted_lorebook_from_characters(
    state: &AppState,
    lorebook_id: &str,
) -> Result<(), AppError> {
    for character in state.storage.list("characters")? {
        let Some(character_id) = character.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mut data = character.get("data").cloned().unwrap_or_else(|| json!({}));
        if embedded_lorebook_id(&data) != Some(lorebook_id) {
            continue;
        }
        let Some(data_object) = data.as_object_mut() else {
            continue;
        };
        data_object.insert("character_book".to_string(), Value::Null);
        if let Some(import_metadata) = data
            .pointer_mut("/extensions/importMetadata")
            .and_then(Value::as_object_mut)
        {
            import_metadata.remove("embeddedLorebook");
        }
        state
            .storage
            .patch("characters", character_id, json!({ "data": data }))?;
    }
    Ok(())
}

pub(super) fn clear_deleted_lorebook_from_character_rows_in_place(
    character_rows: &mut [Value],
    lorebook_id: &str,
) -> Result<(), AppError> {
    for character in character_rows.iter_mut() {
        let mut data = character.get("data").cloned().unwrap_or_else(|| json!({}));
        if embedded_lorebook_id(&data) != Some(lorebook_id) {
            continue;
        }
        let Some(data_object) = data.as_object_mut() else {
            continue;
        };
        data_object.insert("character_book".to_string(), Value::Null);
        if let Some(import_metadata) = data
            .pointer_mut("/extensions/importMetadata")
            .and_then(Value::as_object_mut)
        {
            import_metadata.remove("embeddedLorebook");
        }
        let Some(object) = character.as_object_mut() else {
            return Err(AppError::invalid_input("Stored record is not an object"));
        };
        object.insert("data".to_string(), data);
    }
    Ok(())
}

pub(super) fn clear_deleted_lorebook_references(
    state: &AppState,
    lorebook_id: &str,
) -> Result<(), AppError> {
    clear_deleted_lorebook_from_chats(state, lorebook_id)?;
    clear_deleted_lorebook_from_characters(state, lorebook_id)?;
    Ok(())
}

pub(super) fn owned_record_for_delete(
    state: &AppState,
    entity: &str,
    id: &str,
) -> Result<Option<Value>, AppError> {
    let Some(contract) = contracts::collection_contract(entity) else {
        return Ok(None);
    };
    if contract
        .delete_cleanup
        .iter()
        .any(delete_cleanup_needs_existing_record)
    {
        state.storage.get(entity, id)
    } else {
        Ok(None)
    }
}

pub(super) fn delete_cleanup_needs_existing_record(cleanup: &contracts::DeleteCleanup) -> bool {
    matches!(
        cleanup,
        contracts::DeleteCleanup::ActivateDefaultChatPreset
            | contracts::DeleteCleanup::DeleteMessageTrackerSnapshots
            | contracts::DeleteCleanup::RemoveOwnedMedia
    )
}

pub(super) fn remove_owned_media(state: &AppState, entity: &str, record: &Value) {
    match entity {
        "characters" => {
            avatars::remove_character_avatar_file_if_unreferenced(state, record);
            if let Some(id) = record.get("id").and_then(Value::as_str) {
                sprites::remove_owned_sprite_dir(state, sprites::SpriteOwnerKind::Character, id);
            }
        }
        "character-versions" => characters::remove_character_version_avatar_file(state, record),
        "personas" => {
            avatars::remove_avatar_file_preserving_persona_snapshots(state, entity, record);
            if let Some(id) = record.get("id").and_then(Value::as_str) {
                sprites::remove_owned_sprite_dir(state, sprites::SpriteOwnerKind::Persona, id);
            }
        }
        "lorebooks" => lorebook_images::remove_lorebook_image_file(state, record),
        "agents" | "connections" => entity_images::remove_entity_image_file(state, entity, record),
        "gallery" | "character-gallery" | "persona-gallery" | "global-gallery" => {
            remove_gallery_file(state, record)
        }
        _ => {}
    }
}

pub(super) fn remove_gallery_file(state: &AppState, record: &Value) {
    if let Some(filename) = record.get("filename").and_then(Value::as_str) {
        managed_thumbnails::remove_managed_thumbnail_files(
            state,
            managed_thumbnails::ManagedThumbnailKind::Gallery,
            filename,
        );
    }
    media_uploads::remove_managed_record_file(state, "gallery", record, "filePath", "filename");
}
