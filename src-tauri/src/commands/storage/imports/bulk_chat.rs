use super::super::*;
use super::*;
use chrono::{DateTime, Duration, Local, NaiveDateTime, TimeZone, Utc};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;

pub(crate) fn imported_jsonl_message_role(row: &Value) -> &'static str {
    match row.get("role").and_then(Value::as_str).map(str::trim) {
        Some("user") => "user",
        Some("assistant") => "assistant",
        Some("system") => "system",
        Some("narrator") => "narrator",
        _ if st_message_is_system(row) => "system",
        _ if row.get("is_user").and_then(Value::as_bool).unwrap_or(false) => "user",
        _ => "assistant",
    }
}

pub(super) type CharacterLookup = HashMap<String, Option<String>>;

fn character_record_name(record: &Value) -> Option<String> {
    record
        .get("data")
        .and_then(|data| data.get("name"))
        .or_else(|| record.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn add_character_lookup_alias(
    lookup: &mut CharacterLookup,
    alias: impl AsRef<str>,
    character_id: &str,
) {
    let key = normalized_st_lookup_key(alias.as_ref());
    if !key.is_empty() {
        match lookup.get_mut(&key) {
            Some(existing) if existing.as_deref() == Some(character_id) => {}
            Some(existing) => *existing = None,
            None => {
                lookup.insert(key, Some(character_id.to_string()));
            }
        }
    }
}

pub(super) fn add_character_lookup_record(
    lookup: &mut CharacterLookup,
    record: &Value,
    filename: Option<&str>,
) {
    let Some(character_id) = record.get("id").and_then(Value::as_str) else {
        return;
    };
    if let Some(name) = character_record_name(record) {
        add_character_lookup_alias(lookup, name, character_id);
    }
    if let Some(filename) = filename {
        add_character_lookup_alias(lookup, filename, character_id);
    }
    for field in ["avatarFilename", "avatarPath"] {
        if let Some(value) = record.get(field).and_then(Value::as_str) {
            add_character_lookup_alias(lookup, value, character_id);
        }
    }
}

pub(super) fn character_lookup_from_state(state: &AppState) -> AppResult<CharacterLookup> {
    let mut lookup = HashMap::new();
    for character in state.storage.list("characters")? {
        add_character_lookup_record(&mut lookup, &character, None);
    }
    Ok(lookup)
}

pub(super) fn character_lookup_from_state_for_ids(
    state: &AppState,
    character_ids: &[String],
) -> AppResult<CharacterLookup> {
    let mut lookup = HashMap::new();
    if character_ids.is_empty() {
        return Ok(lookup);
    }
    for character in state.storage.list("characters")? {
        let Some(character_id) = character.get("id").and_then(Value::as_str) else {
            continue;
        };
        if character_ids.iter().any(|id| id == character_id) {
            add_character_lookup_record(&mut lookup, &character, None);
        }
    }
    Ok(lookup)
}

pub(super) fn lookup_character_id(
    lookup: &CharacterLookup,
    alias: impl AsRef<str>,
) -> Option<String> {
    let key = normalized_st_lookup_key(alias.as_ref());
    if key.is_empty() {
        None
    } else {
        lookup.get(&key).and_then(Clone::clone)
    }
}

pub(super) fn resolve_member_character_ids(
    lookup: &CharacterLookup,
    members: impl IntoIterator<Item = impl AsRef<str>>,
) -> Vec<String> {
    let mut character_ids = Vec::new();
    for member in members {
        if let Some(character_id) = lookup_character_id(lookup, member.as_ref()) {
            push_unique_string(&mut character_ids, character_id);
        }
    }
    character_ids
}

fn st_message_speaker_name(row: &Value) -> Option<String> {
    for value in [
        row.get("character_name"),
        row.get("name"),
        row.get("display_name"),
        row.get("extra").and_then(|extra| extra.get("name")),
        row.get("extra")
            .and_then(|extra| extra.get("character_name")),
    ] {
        if let Some(value) = value
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(value.to_string());
        }
    }
    None
}

fn st_message_display_text(row: &Value) -> Option<String> {
    row.get("extra")
        .and_then(|extra| {
            extra
                .get("display_text")
                .or_else(|| extra.get("displayText"))
        })
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .filter(|value| !value.trim().is_empty())
}

fn st_message_datetime(row: &Value) -> Option<DateTime<Utc>> {
    let raw = row
        .get("send_date")
        .or_else(|| row.get("sendDate"))
        .or_else(|| row.get("createdAt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if let Ok(parsed) = DateTime::parse_from_rfc3339(raw) {
        return Some(parsed.with_timezone(&Utc));
    }
    for pattern in [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%B %d, %Y %I:%M%p",
        "%B %d, %Y %I:%M %p",
        "%b %d, %Y %I:%M%p",
        "%b %d, %Y %I:%M %p",
    ] {
        if let Ok(parsed) = NaiveDateTime::parse_from_str(raw, pattern) {
            if let Some(local) = Local.from_local_datetime(&parsed).single() {
                return Some(local.with_timezone(&Utc));
            }
        }
    }
    None
}

fn st_message_is_system(row: &Value) -> bool {
    row.get("is_system")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn st_message_hidden_from_ai(row: &Value) -> bool {
    st_message_is_system(row)
        || bool_option(row.get("extra").and_then(|extra| extra.get("hiddenFromAI")))
            .unwrap_or(false)
        || bool_option(row.get("extra").and_then(|extra| extra.get("hiddenFromAi")))
            .unwrap_or(false)
}

#[derive(Clone, Default)]
pub(super) struct StChatImportContext {
    pub(super) character_lookup: CharacterLookup,
    pub(super) default_character_id: Option<String>,
    pub(super) timestamp_overrides: Option<(String, String)>,
}

fn st_row_character_id(row: &Value, context: &StChatImportContext, role: &str) -> Value {
    if let Some(character_id) = row
        .get("characterId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Value::String(character_id.to_string());
    }
    if role != "assistant" && role != "narrator" {
        return Value::Null;
    }
    if let Some(speaker) = st_message_speaker_name(row) {
        if let Some(character_id) = lookup_character_id(&context.character_lookup, speaker) {
            return Value::String(character_id);
        }
    }
    context
        .default_character_id
        .as_ref()
        .map(|value| Value::String(value.clone()))
        .unwrap_or(Value::Null)
}

fn st_message_extra(row: &Value) -> Value {
    let mut extra = Map::new();
    if let Some(display_text) = st_message_display_text(row) {
        extra.insert("displayText".to_string(), Value::String(display_text));
    }
    if let Some(send_date) = row
        .get("send_date")
        .or_else(|| row.get("sendDate"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        extra.insert(
            "sillyTavernSendDate".to_string(),
            Value::String(send_date.to_string()),
        );
    }
    if let Some(speaker) = st_message_speaker_name(row) {
        extra.insert(
            "sillyTavernSpeaker".to_string(),
            Value::String(speaker.to_string()),
        );
    }
    if st_message_hidden_from_ai(row) {
        extra.insert("hiddenFromAI".to_string(), Value::Bool(true));
        extra.insert("hiddenFromAi".to_string(), Value::Bool(true));
    }
    Value::Object(extra)
}

fn st_datetime_from_rfc3339(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc))
        .ok()
}

fn st_created_timestamp_override(context: &StChatImportContext) -> Option<DateTime<Utc>> {
    context
        .timestamp_overrides
        .as_ref()
        .and_then(|(created_at, _)| st_datetime_from_rfc3339(created_at))
}

fn normalized_st_message_timestamp(
    candidate: DateTime<Utc>,
    previous: &mut Option<DateTime<Utc>>,
) -> String {
    let normalized = if let Some(previous_timestamp) = previous.as_ref() {
        if candidate <= *previous_timestamp {
            *previous_timestamp + Duration::milliseconds(1)
        } else {
            candidate
        }
    } else {
        candidate
    };
    *previous = Some(normalized);
    normalized.to_rfc3339()
}

fn st_message_content(row: &Value) -> Option<String> {
    [row.get("mes"), row.get("content")]
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .find(|content| !content.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn st_file_timestamp_overrides(file: &Value) -> Option<(String, String)> {
    timestamp_overrides_from_value(
        file.get("timestampOverrides")
            .or_else(|| file.get("__timestampOverrides")),
    )
    .or_else(|| {
        timestamp_overrides_from_value(Some(&json!({
            "createdAt": file.get("createdAt").cloned().unwrap_or(Value::Null),
            "updatedAt": file.get("updatedAt").cloned().unwrap_or(Value::Null),
        })))
    })
    .or_else(|| {
        timestamp_overrides_from_value(
            file.get("lastModified")
                .or_else(|| file.get("last_modified")),
        )
    })
}

fn st_timestamp_overrides_from_body_and_file(
    body: &Value,
    file: &Value,
) -> Option<(String, String)> {
    timestamp_overrides_from_value(
        body.get("timestampOverrides")
            .or_else(|| body.get("__timestampOverrides")),
    )
    .or_else(|| {
        timestamp_overrides_from_value(Some(&json!({
            "createdAt": body.get("createdAt").cloned().unwrap_or(Value::Null),
            "updatedAt": body.get("updatedAt").cloned().unwrap_or(Value::Null),
        })))
    })
    .or_else(|| st_file_timestamp_overrides(file))
}

pub(super) fn import_st_chat_text(
    state: &AppState,
    text: &str,
    chat_name: String,
    inherited: Option<Value>,
    context: StChatImportContext,
) -> AppResult<Value> {
    let mut character_name = String::new();
    let mut character_ids = Vec::new();
    let mut parsed_rows = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parsed = parse_json_text(line).map_err(|error| {
            AppError::invalid_input(format!("Invalid chat JSONL at line {}: {error}", index + 1))
        })?;
        let has_importable_content = st_message_content(&parsed).is_some();
        if has_importable_content && character_name.is_empty() {
            if let Some(name) = parsed.get("character_name").and_then(Value::as_str) {
                character_name = name.to_string();
            }
        }
        if has_importable_content {
            if let Some(character_id) = parsed
                .get("characterId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if !character_ids.iter().any(|id| id == character_id) {
                    character_ids.push(character_id.to_string());
                }
            }
            let role = imported_jsonl_message_role(&parsed);
            if role == "assistant" || role == "narrator" {
                if let Some(speaker) = st_message_speaker_name(&parsed) {
                    if let Some(character_id) =
                        lookup_character_id(&context.character_lookup, speaker)
                    {
                        push_unique_string(&mut character_ids, character_id);
                    }
                }
            }
        }
        parsed_rows.push(parsed);
    }
    if let Some(default_character_id) = context.default_character_id.as_ref() {
        push_unique_string(&mut character_ids, default_character_id.clone());
    }
    let has_importable_message = parsed_rows
        .iter()
        .any(|row| st_message_content(row).is_some());
    if !has_importable_message {
        return Err(AppError::invalid_input(
            "Chat import JSONL must contain at least one message",
        ));
    }
    let mut chat = ensure_object(inherited.unwrap_or_else(|| json!({})))?;
    chat.remove("id");
    chat.insert("name".to_string(), Value::String(chat_name));
    chat.entry("mode".to_string())
        .or_insert(Value::String("roleplay".to_string()));
    if character_ids.is_empty() {
        chat.entry("characterIds".to_string())
            .or_insert_with(|| json!([]));
    } else {
        let mut merged_character_ids = shared::string_array_from_value(chat.get("characterIds"));
        for character_id in character_ids {
            if !merged_character_ids.iter().any(|id| id == &character_id) {
                merged_character_ids.push(character_id);
            }
        }
        chat.insert("characterIds".to_string(), json!(merged_character_ids));
    }
    chat.entry("metadata".to_string())
        .or_insert_with(|| json!({}));
    if !character_name.is_empty() {
        chat.entry("importedCharacterName".to_string())
            .or_insert(Value::String(character_name));
    }
    if let Some((created_at, updated_at)) = context.timestamp_overrides.as_ref() {
        chat.insert("createdAt".to_string(), Value::String(created_at.clone()));
        chat.insert("updatedAt".to_string(), Value::String(updated_at.clone()));
    }
    let mut created_chat_id = None;
    let mut created_message_ids = Vec::new();
    let result = (|| -> AppResult<Value> {
        let chat_record = state.storage.create("chats", Value::Object(chat))?;
        let chat_id = created_record_id(&chat_record, "chat")?;
        created_chat_id = Some(chat_id.clone());
        let mut imported = 0usize;
        let fallback_timestamp = st_created_timestamp_override(&context).unwrap_or_else(Utc::now);
        let mut previous_timestamp = None;
        for row in parsed_rows {
            let Some(content) = st_message_content(&row) else {
                continue;
            };
            let role = imported_jsonl_message_role(&row);
            let character_id = st_row_character_id(&row, &context, role);
            let extra = st_message_extra(&row);
            let mut message_payload = json!({
                "chatId": chat_id,
                "role": role,
                "content": content,
                "characterId": character_id,
                "extra": extra,
                "activeSwipeIndex": 0,
                "swipes": [{ "content": content, "extra": extra }]
            });
            let created_at = normalized_st_message_timestamp(
                st_message_datetime(&row).unwrap_or(fallback_timestamp),
                &mut previous_timestamp,
            );
            if let Some(object) = message_payload.as_object_mut() {
                object.insert("createdAt".to_string(), Value::String(created_at.clone()));
                object.insert("updatedAt".to_string(), Value::String(created_at));
            }
            let message =
                crate::storage_commands::message_swipes::create_message(state, message_payload)?;
            created_message_ids.push(created_record_id(&message, "message")?);
            imported += 1;
        }
        flush_import_writes(state)?;
        Ok(
            json!({ "success": true, "chatId": chat_id, "chat": chat_record, "messagesImported": imported }),
        )
    })();

    result.map_err(|error| {
        let mut rollback_errors = Vec::new();
        rollback_created_records(
            state,
            "messages",
            &created_message_ids,
            &mut rollback_errors,
        );
        if let Some(chat_id) = created_chat_id.as_deref() {
            rollback_created_records(state, "chats", &[chat_id.to_string()], &mut rollback_errors);
        }
        append_rollback_errors(error, "chat import", rollback_errors)
    })
}

pub(crate) fn import_st_chat(state: &AppState, body: Value) -> AppResult<Value> {
    let file = body
        .get("file")
        .ok_or_else(|| AppError::invalid_input("file is required"))?;
    let uploaded = decode_uploaded_file_value(file)?;
    let text = String::from_utf8(uploaded.bytes)
        .map_err(|_| AppError::invalid_input("Chat import file must be UTF-8 JSONL"))?;
    let chat_name = Path::new(&uploaded.name)
        .file_stem()
        .map(|name| name.to_string_lossy().replace('_', " "))
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Imported Chat".to_string());
    import_st_chat_text(
        state,
        &text,
        chat_name,
        None,
        StChatImportContext {
            timestamp_overrides: st_timestamp_overrides_from_body_and_file(&body, file),
            ..StChatImportContext::default()
        },
    )
}

pub(crate) fn import_st_chat_into_group(state: &AppState, body: Value) -> AppResult<Value> {
    let target_chat_id = required_string(&body, "chatId")?;
    let target = get_required(state, "chats", target_chat_id)?;
    let file = body
        .get("file")
        .ok_or_else(|| AppError::invalid_input("file is required"))?;
    let uploaded = decode_uploaded_file_value(file)?;
    let text = String::from_utf8(uploaded.bytes)
        .map_err(|_| AppError::invalid_input("Chat import file must be UTF-8 JSONL"))?;
    let target_character_ids = shared::string_array_from_value(target.get("characterIds"));
    let character_lookup = character_lookup_from_state_for_ids(state, &target_character_ids)?;
    let mut inherited = target.clone();
    if let Some(object) = inherited.as_object_mut() {
        let group_id = object
            .get("groupId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(new_id);
        object.insert("groupId".to_string(), Value::String(group_id.clone()));
        state
            .storage
            .patch("chats", target_chat_id, json!({ "groupId": group_id }))?;
    }
    let branch_name = Path::new(&uploaded.name)
        .file_stem()
        .map(|name| name.to_string_lossy().replace('_', " "))
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Imported".to_string());
    let context = StChatImportContext {
        character_lookup,
        default_character_id: None,
        timestamp_overrides: st_timestamp_overrides_from_body_and_file(&body, file),
    };
    import_st_chat_text(state, &text, branch_name, Some(inherited), context).map_err(|error| {
        let mut rollback_errors = Vec::new();
        restore_record(state, "chats", &target, &mut rollback_errors);
        append_rollback_errors(error, "chat branch import", rollback_errors)
    })
}

fn restore_record(
    state: &AppState,
    collection: &str,
    original: &Value,
    rollback_errors: &mut Vec<String>,
) {
    let Some(id) = original.get("id").and_then(Value::as_str) else {
        rollback_errors.push(format!("{collection}: original record is missing an id"));
        return;
    };
    let rows = match state.storage.list(collection) {
        Ok(rows) => rows,
        Err(error) => {
            rollback_errors.push(format!("{collection}/{id}: {error}"));
            return;
        }
    };
    let mut replaced = false;
    let restored = rows
        .into_iter()
        .map(|row| {
            if row.get("id").and_then(Value::as_str) == Some(id) {
                replaced = true;
                original.clone()
            } else {
                row
            }
        })
        .collect::<Vec<_>>();
    if !replaced {
        rollback_errors.push(format!(
            "{collection}/{id}: record was not found for restore"
        ));
        return;
    }
    if let Err(error) = state.storage.replace_all(collection, restored) {
        rollback_errors.push(format!("{collection}/{id}: {error}"));
    }
}
