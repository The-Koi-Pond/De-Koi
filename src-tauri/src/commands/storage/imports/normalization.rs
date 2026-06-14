use super::lorebook_normalization::lorebook_entry_count;
use super::*;
pub(super) fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}
pub(super) fn string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect(),
        Some(Value::String(raw)) if !raw.trim().is_empty() => {
            serde_json::from_str::<Vec<String>>(raw).unwrap_or_else(|_| vec![raw.to_string()])
        }
        _ => Vec::new(),
    }
}

pub(super) fn unique_nonempty_strings(values: Vec<String>) -> Vec<String> {
    let mut unique = Vec::new();
    for value in values {
        let value = value.trim();
        if !value.is_empty()
            && !unique
                .iter()
                .any(|existing: &String| existing.as_str() == value)
        {
            unique.push(value.to_string());
        }
    }
    unique
}

pub(super) fn first_string(values: Vec<Option<&Value>>) -> String {
    values
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}
pub(super) fn source_character_data(payload: &Value) -> Value {
    if matches!(
        payload.get("spec").and_then(Value::as_str),
        Some("chara_card_v2" | "chara_card_v3")
    ) {
        return payload
            .get("data")
            .filter(|value| value.is_object())
            .cloned()
            .unwrap_or_else(|| payload.clone());
    }
    if payload.get("type").and_then(Value::as_str) == Some("character") {
        return payload
            .get("data")
            .filter(|value| value.is_object())
            .cloned()
            .unwrap_or_else(|| payload.clone());
    }
    payload.clone()
}
pub(super) fn embedded_lorebook(payload: &Value) -> Option<Value> {
    let wrapped = source_character_data(payload);
    let mut candidates = Vec::new();
    if let Some(book) = payload.get("character_book") {
        candidates.push(book);
    }
    if let Some(book) = wrapped.get("character_book") {
        candidates.push(book);
    }
    if let Some(book) = payload
        .get("data")
        .and_then(|data| data.get("character_book"))
    {
        candidates.push(book);
    }
    candidates
        .into_iter()
        .filter(|book| lorebook_entry_count(book) > 0)
        .max_by_key(|book| lorebook_entry_count(book))
        .cloned()
}
pub(super) fn alt_descriptions(data: &Value) -> Value {
    data.get("extensions")
        .and_then(|extensions| extensions.get("altDescriptions"))
        .or_else(|| {
            data.get("extensions")
                .and_then(|extensions| extensions.get("alt_descriptions"))
        })
        .or_else(|| data.get("altDescriptions"))
        .or_else(|| data.get("alternate_descriptions"))
        .filter(|value| value.is_array())
        .cloned()
        .unwrap_or_else(|| json!([]))
}
pub(super) fn strip_stale_embedded_lorebook_pointer(data: &mut Value) {
    if let Some(book) = data.pointer_mut("/extensions/importMetadata/embeddedLorebook") {
        if let Some(object) = book.as_object_mut() {
            object.remove("lorebookId");
        }
    }
}
pub(super) fn character_import_extensions(
    payload: &Value,
    data: &Value,
    embedded: Option<&Value>,
) -> Value {
    let mut extensions = data
        .get("extensions")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    extensions
        .entry("altDescriptions".to_string())
        .or_insert_with(|| alt_descriptions(data));
    let bot_browser_source = string_field(payload, "_botBrowserSource");
    if !bot_browser_source.trim().is_empty() {
        extensions.insert("botBrowserSource".to_string(), json!(bot_browser_source));
    }
    let import_metadata = extensions
        .entry("importMetadata".to_string())
        .or_insert_with(|| json!({}));
    if let Some(import_metadata) = import_metadata.as_object_mut() {
        import_metadata.insert(
            "card".to_string(),
            json!({
                "spec": payload.get("spec").and_then(Value::as_str).unwrap_or("chara_card_v2"),
                "specVersion": payload.get("spec_version").and_then(Value::as_str).unwrap_or("2.0"),
                "format": payload.get("spec").and_then(Value::as_str).unwrap_or("chara_card_v2")
            }),
        );
        if let Some(book) = embedded {
            import_metadata.insert(
                "embeddedLorebook".to_string(),
                json!({
                    "hasEmbeddedLorebook": true,
                    "entries": lorebook_entry_count(book)
                }),
            );
        }
    }
    Value::Object(extensions)
}

pub(super) fn normalize_character_data(
    payload: &Value,
    tag_mode: &str,
    existing_tags: &[String],
) -> Value {
    let data = source_character_data(payload);
    let embedded = embedded_lorebook(payload);
    let mut tags = string_array(data.get("tags"));
    if tag_mode == "none" {
        tags.clear();
    } else if tag_mode == "existing" {
        let keys: Vec<String> = existing_tags.iter().map(|tag| tag.to_lowercase()).collect();
        tags.retain(|tag| keys.contains(&tag.to_lowercase()));
    }
    let mut normalized = json!({
        "name": first_string(vec![data.get("name"), payload.get("char_name"), payload.get("name")]).if_empty("Imported Character"),
        "description": first_string(vec![data.get("description"), payload.get("char_persona")]),
        "personality": first_string(vec![data.get("personality"), payload.get("personality")]),
        "scenario": first_string(vec![data.get("scenario"), payload.get("world_scenario")]),
        "first_mes": first_string(vec![data.get("first_mes"), data.get("firstMessage"), payload.get("char_greeting"), payload.get("first_mes"), payload.get("firstMessage")]),
        "mes_example": first_string(vec![data.get("mes_example"), data.get("exampleMessage"), payload.get("example_dialogue"), payload.get("mes_example"), payload.get("exampleMessage")]),
        "creator_notes": first_string(vec![data.get("creator_notes"), data.get("creatorNotes"), payload.get("creatorcomment"), payload.get("comment"), payload.get("creator_notes"), payload.get("creatorNotes")]),
        "system_prompt": first_string(vec![data.get("system_prompt"), data.get("systemPrompt"), payload.get("system_prompt"), payload.get("systemPrompt")]),
        "post_history_instructions": first_string(vec![data.get("post_history_instructions"), payload.get("post_history_instructions")]),
        "tags": tags,
        "creator": first_string(vec![data.get("creator"), payload.get("creator")]),
        "character_version": first_string(vec![data.get("character_version"), payload.get("character_version")]).if_empty("1.0"),
        "alternate_greetings": string_array(data.get("alternate_greetings").or_else(|| data.get("alternateGreetings")).or_else(|| payload.get("alternate_greetings")).or_else(|| payload.get("alternateGreetings"))),
        "extensions": character_import_extensions(payload, &data, embedded.as_ref()),
        "character_book": embedded.unwrap_or(Value::Null),
    });
    strip_stale_embedded_lorebook_pointer(&mut normalized);
    normalized
}
trait ImportStringFallback {
    fn if_empty(self, fallback: &str) -> String;
}

impl ImportStringFallback for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.trim().is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

pub(super) fn number(value: Option<&Value>, fallback: i64) -> i64 {
    value
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
        })
        .unwrap_or(fallback)
}

pub(super) fn optional_number(value: Option<&Value>) -> Value {
    value
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
        })
        .map_or(Value::Null, |value| json!(value))
}

pub(super) fn bool_field(value: Option<&Value>, fallback: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(fallback)
}
