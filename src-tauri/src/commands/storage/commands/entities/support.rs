use super::*;

pub(super) fn validate_storage_entity(entity: &str) -> Result<(), AppError> {
    if contracts::collection_contract(entity).is_some() {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!(
            "Unsupported storage entity: {entity}"
        )))
    }
}

pub(super) fn reject_message_swipe_mutation(entity: &str) -> Result<(), AppError> {
    if entity == message_swipes::COLLECTION {
        return Err(AppError::invalid_input(
            "message-swipes is internal sidecar storage; mutate swipes through message commands",
        ));
    }
    Ok(())
}

pub(super) fn validate_chat_metadata_patch(
    state: &AppState,
    chat_id: &str,
    patch: &mut Value,
) -> Result<(), AppError> {
    let metadata_patch = match patch.get("metadata") {
        Some(Value::Object(object)) => Some(object.clone()),
        Some(_) => return Err(AppError::invalid_input("Chat metadata must be an object")),
        None => None,
    };
    if metadata_patch.is_none() && patch.get("characterIds").is_none() {
        return Ok(());
    };

    let chat = state
        .storage
        .get("chats", chat_id)?
        .ok_or_else(|| AppError::not_found(format!("Chat {chat_id} was not found")))?;
    let active_ids_source = patch
        .get("characterIds")
        .or_else(|| chat.get("characterIds"));
    let active_ids = chat_active_character_ids(active_ids_source);
    let mut effective_metadata = shared::json_object_value(chat.get("metadata"))
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(metadata_patch) = metadata_patch {
        for (key, value) in metadata_patch {
            effective_metadata.insert(key, value);
        }
    }
    let previous_metadata = effective_metadata.clone();
    normalize_chat_metadata_object(&mut effective_metadata, &active_ids)?;

    if patch.get("metadata").is_some() || effective_metadata != previous_metadata {
        patch["metadata"] = Value::Object(effective_metadata);
    }
    Ok(())
}

pub(super) fn chat_active_character_ids(value: Option<&Value>) -> HashSet<String> {
    shared::string_array_from_value(value).into_iter().collect()
}

pub(super) fn normalize_chat_metadata_object(
    metadata: &mut Map<String, Value>,
    active_ids: &HashSet<String>,
) -> Result<(), AppError> {
    normalize_discord_webhook_metadata(metadata)?;
    normalize_inactive_character_metadata(metadata, active_ids)?;
    Ok(())
}

pub(super) fn normalize_discord_webhook_metadata(
    metadata: &mut Map<String, Value>,
) -> Result<(), AppError> {
    let Some(webhook_url) = metadata.get("discordWebhookUrl") else {
        return Ok(());
    };
    let normalized = if webhook_url.is_null() {
        None
    } else if let Some(raw_url) = webhook_url.as_str() {
        let trimmed_url = raw_url.trim();
        if trimmed_url.is_empty() {
            None
        } else {
            if !integrations::is_valid_discord_webhook_url(trimmed_url) {
                return Err(AppError::invalid_input("Invalid Discord webhook URL"));
            }
            Some(Value::String(trimmed_url.to_string()))
        }
    } else {
        return Err(AppError::invalid_input(
            "Discord webhook URL must be a string",
        ));
    };
    if let Some(value) = normalized {
        metadata.insert("discordWebhookUrl".to_string(), value);
    } else {
        metadata.remove("discordWebhookUrl");
    }
    Ok(())
}

pub(super) fn normalize_inactive_character_metadata(
    metadata: &mut Map<String, Value>,
    active_ids: &HashSet<String>,
) -> Result<(), AppError> {
    let Some(inactive_value) = metadata.get("inactiveCharacterIds") else {
        return Ok(());
    };
    let Some(inactive_ids) = inactive_value.as_array() else {
        return Err(AppError::invalid_input(
            "inactiveCharacterIds must be an array of strings",
        ));
    };
    if inactive_ids.iter().any(|id| !id.is_string()) {
        return Err(AppError::invalid_input(
            "inactiveCharacterIds must be an array of strings",
        ));
    }

    let mut seen = HashSet::new();
    let normalized: Vec<Value> = inactive_ids
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty() && active_ids.contains(*id))
        .filter(|id| seen.insert((*id).to_string()))
        .map(|id| Value::String(id.to_string()))
        .collect();
    metadata.insert("inactiveCharacterIds".to_string(), Value::Array(normalized));
    Ok(())
}
