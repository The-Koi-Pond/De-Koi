use super::*;

pub(crate) fn duplicate_entity(
    state: &AppState,
    entity: &str,
    id: &str,
) -> Result<Value, AppError> {
    validate_storage_entity(entity)?;
    reject_message_swipe_mutation(entity)?;
    if entity == "characters" {
        return characters::duplicate_character(state, id);
    }
    if entity == "personas" {
        return personas::duplicate_persona(state, id);
    }
    if entity == "prompts" {
        return prompts::duplicate_prompt_preset(state, id);
    }
    if entity == "chat-presets" {
        return duplicate_chat_preset(state, id);
    }
    if entity == "agents" {
        return duplicate_agent(state, id);
    }
    if entity == "connections" {
        return duplicate_connection(state, id);
    }
    if entity == "messages" {
        return duplicate_message(state, id);
    }
    let duplicated = shared::duplicate_record(state, entity, id)?;
    Ok(duplicated)
}

pub(super) fn duplicate_message(state: &AppState, id: &str) -> Result<Value, AppError> {
    let mut record = shared::get_required(state, "messages", id)?;
    message_swipes::materialize_message(state, &mut record, true)?;
    let object = record
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Message is not an object"))?;
    object.remove("id");
    let duplicated = message_swipes::create_message(state, record)?;
    Ok(shared::project_timeline_message(duplicated))
}

pub(super) fn duplicate_agent(state: &AppState, id: &str) -> Result<Value, AppError> {
    let mut record = shared::get_required(state, "agents", id)?;
    let duplicate_image =
        entity_images::duplicate_managed_entity_image(state, "agents", id, &record)?;
    let object = record
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Agent is not an object"))?;
    object.remove("id");
    if let Some(name) = object
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
    {
        object.insert("name".to_string(), Value::String(format!("{name} Copy")));
    }
    entity_images::apply_duplicate_entity_image(object, &duplicate_image);
    match state.storage.create("agents", record) {
        Ok(duplicated) => Ok(duplicated),
        Err(error) => {
            entity_images::remove_duplicate_entity_image_copy(
                &duplicate_image,
                "rolled-back duplicated agent image",
            );
            Err(error)
        }
    }
}

pub(super) fn duplicate_connection(state: &AppState, id: &str) -> Result<Value, AppError> {
    let mut record = shared::get_required(state, "connections", id)?;
    let duplicate_image =
        entity_images::duplicate_managed_entity_image(state, "connections", id, &record)?;
    let object = record
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Connection is not an object"))?;
    object.remove("id");
    if let Some(name) = object
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
    {
        object.insert("name".to_string(), Value::String(format!("{name} Copy")));
    }
    object.insert("isDefault".to_string(), Value::Bool(false));
    object.insert("default".to_string(), Value::Bool(false));
    object.insert("defaultForAgents".to_string(), Value::Bool(false));
    entity_images::apply_duplicate_entity_image(object, &duplicate_image);

    let prepared = match connection_secrets::prepare_connection_for_create(state, record) {
        Ok(prepared) => prepared,
        Err(error) => {
            entity_images::remove_duplicate_entity_image_copy(
                &duplicate_image,
                "rolled-back duplicated connection image",
            );
            return Err(error);
        }
    };
    let mut duplicated = match state.storage.create("connections", prepared) {
        Ok(duplicated) => duplicated,
        Err(error) => {
            entity_images::remove_duplicate_entity_image_copy(
                &duplicate_image,
                "rolled-back duplicated connection image",
            );
            return Err(error);
        }
    };
    connection_secrets::mask_connection_for_read(&mut duplicated);
    Ok(duplicated)
}

pub(super) fn patch_chat_preset(
    state: &AppState,
    id: &str,
    patch: Value,
) -> Result<Value, AppError> {
    let existing = shared::get_required(state, "chat-presets", id)?;
    let normalized = shared::normalize_update_patch("chat-presets", patch)?;
    if chat_preset_is_default(&existing) && chat_preset_patch_mutates_default_fields(&normalized) {
        return Err(AppError::invalid_input(
            "Default chat presets cannot be updated",
        ));
    }
    state.storage.patch("chat-presets", id, normalized)
}

pub(super) fn duplicate_chat_preset(state: &AppState, id: &str) -> Result<Value, AppError> {
    let mut record = shared::get_required(state, "chat-presets", id)?;
    let object = record
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Chat preset is not an object"))?;
    object.remove("id");
    if let Some(name) = object
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
    {
        object.insert("name".to_string(), Value::String(format!("{name} Copy")));
    }
    object.insert("isDefault".to_string(), Value::Bool(false));
    object.insert("default".to_string(), Value::Bool(false));
    object.insert("isActive".to_string(), Value::Bool(false));
    object.insert("active".to_string(), Value::Bool(false));
    state.storage.create("chat-presets", record)
}

pub(super) fn chat_preset_patch_mutates_default_fields(patch: &Value) -> bool {
    let Some(object) = patch.as_object() else {
        return true;
    };
    object
        .keys()
        .any(|key| !matches!(key.as_str(), "isActive" | "active" | "updatedAt"))
}

pub(super) fn chat_preset_is_default_id(state: &AppState, id: &str) -> Result<bool, AppError> {
    Ok(state
        .storage
        .get("chat-presets", id)?
        .as_ref()
        .is_some_and(chat_preset_is_default))
}

pub(super) fn chat_preset_is_default(record: &Value) -> bool {
    value_truthy(record.get("isDefault")) || value_truthy(record.get("default"))
}

pub(super) fn chat_preset_is_active(record: &Value) -> bool {
    value_truthy(record.get("isActive")) || value_truthy(record.get("active"))
}

pub(super) fn value_truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(value)) => *value,
        Some(Value::String(value)) => {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "1" | "yes" | "on"
            )
        }
        Some(Value::Number(value)) => value.as_i64().is_some_and(|number| number != 0),
        _ => false,
    }
}

pub(super) fn activate_default_chat_preset_if_needed(
    state: &AppState,
    deleted: &Value,
) -> Result<(), AppError> {
    if !chat_preset_is_active(deleted) {
        return Ok(());
    }
    let Some(mode) = deleted.get("mode").and_then(Value::as_str) else {
        return Ok(());
    };
    let default = state.storage.list("chat-presets")?.into_iter().find(|row| {
        row.get("mode").and_then(Value::as_str) == Some(mode) && chat_preset_is_default(row)
    });
    let Some(default_id) = default
        .as_ref()
        .and_then(|row| row.get("id"))
        .and_then(Value::as_str)
    else {
        return Ok(());
    };
    state.storage.patch(
        "chat-presets",
        default_id,
        json!({
            "isActive": true,
            "active": true
        }),
    )?;
    Ok(())
}

pub(super) fn delete_chat_preset_with_default_activation(
    state: &AppState,
    id: &str,
) -> Result<bool, AppError> {
    let preset_id = id.to_string();
    state
        .storage
        .update_collections_atomically(vec!["chat-presets"], move |collections| {
            let [presets] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Chat preset delete expected chat-presets collection",
                ));
            };
            if presets.collection() != "chat-presets" {
                return Err(AppError::new(
                    "storage_error",
                    "Chat preset delete received unexpected collection",
                ));
            }

            let rows = presets.rows_mut();
            let deleted = rows
                .iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(preset_id.as_str()))
                .cloned();
            let Some(deleted) = deleted else {
                return Ok(false);
            };
            if chat_preset_is_default(&deleted) {
                return Err(AppError::invalid_input(
                    "Default chat presets cannot be deleted",
                ));
            }

            let deleted_was_active = chat_preset_is_active(&deleted);
            let deleted_mode = deleted
                .get("mode")
                .and_then(Value::as_str)
                .map(str::to_string);
            rows.retain(|row| row.get("id").and_then(Value::as_str) != Some(preset_id.as_str()));

            if deleted_was_active {
                let default_id = deleted_mode
                    .as_deref()
                    .and_then(|mode| {
                        rows.iter()
                            .find(|row| {
                                row.get("mode").and_then(Value::as_str) == Some(mode)
                                    && chat_preset_is_default(row)
                            })
                            .and_then(|row| row.get("id"))
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .ok_or_else(|| {
                        AppError::invalid_input(
                            "Active chat presets require a same-mode default fallback",
                        )
                    })?;
                if let Some(default) = rows
                    .iter_mut()
                    .find(|row| row.get("id").and_then(Value::as_str) == Some(default_id.as_str()))
                {
                    let Some(object) = default.as_object_mut() else {
                        return Err(AppError::invalid_input("Stored record is not an object"));
                    };
                    object.insert("isActive".to_string(), json!(true));
                    object.insert("active".to_string(), json!(true));
                } else {
                    return Err(AppError::invalid_input(
                        "Active chat presets require a same-mode default fallback",
                    ));
                }
            }
            Ok(true)
        })
}
