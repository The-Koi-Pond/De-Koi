use super::lorebook_signals::{detect_category, detect_entry_tag};
use super::normalization::{
    bool_field, number, optional_number, string_array, string_field, unique_nonempty_strings,
};
use super::*;

pub(crate) fn lorebook_entries(value: &Value) -> Vec<Value> {
    match value.get("entries") {
        Some(Value::Array(items)) => items.clone(),
        Some(Value::Object(map)) => map.values().cloned().collect(),
        _ => Vec::new(),
    }
}

pub(super) fn lorebook_entry_count(value: &Value) -> usize {
    lorebook_entries(value).len()
}

// Marinara equivalent: normalizeLorebookScope. Rust keeps snake_case for the import normalizer.
fn normalize_lorebook_scope(value: Option<&Value>) -> Value {
    let raw = match value {
        Some(Value::Object(object)) => Some(object.clone()),
        Some(Value::String(raw)) if !raw.trim().is_empty() => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|parsed| parsed.as_object().cloned()),
        _ => None,
    };
    let mode = raw
        .as_ref()
        .and_then(|object| object.get("mode"))
        .and_then(Value::as_str)
        .filter(|mode| matches!(*mode, "disabled" | "specific"))
        .unwrap_or("all");
    let chat_ids = raw
        .as_ref()
        .and_then(|object| object.get("chatIds"))
        .map(|value| string_array(Some(value)))
        .unwrap_or_default();
    json!({
        "mode": mode,
        "chatIds": unique_nonempty_strings(chat_ids),
    })
}

fn selective_logic_value(value: Option<&Value>) -> &'static str {
    let raw = match value {
        Some(Value::String(raw)) => raw.trim().to_ascii_lowercase(),
        Some(Value::Number(raw)) => raw.as_i64().unwrap_or(0).to_string(),
        _ => String::new(),
    };
    match raw.as_str() {
        "1" | "or" => "or",
        "2" | "not" => "not",
        _ => "and",
    }
}

fn lorebook_entry_role(value: Option<&Value>) -> &'static str {
    let raw = match value {
        Some(Value::String(raw)) => raw.trim().to_ascii_lowercase(),
        Some(Value::Number(raw)) => raw.as_i64().unwrap_or(0).to_string(),
        _ => String::new(),
    };
    match raw.as_str() {
        "1" | "user" => "user",
        "2" | "assistant" => "assistant",
        _ => "system",
    }
}

pub(crate) fn normalize_lorebook_entry(lorebook_id: &str, entry: &Value, index: usize) -> Value {
    let keys = entry.get("key").or_else(|| entry.get("keys"));
    let secondary = entry
        .get("keysecondary")
        .or_else(|| entry.get("secondary_keys"))
        .or_else(|| entry.get("secondaryKeys"));
    let enabled = entry
        .get("disable")
        .and_then(Value::as_bool)
        .map(|disabled| !disabled)
        .unwrap_or_else(|| bool_field(entry.get("enabled"), true));
    let position = match entry.get("position") {
        Some(Value::String(raw)) if raw == "after_char" => 1,
        Some(Value::String(raw)) if raw == "at_depth" || raw == "depth" => 2,
        Some(Value::Number(raw)) => raw.as_i64().unwrap_or(0),
        _ => 0,
    };
    let probability = match entry
        .get("useProbability")
        .or_else(|| entry.get("use_probability"))
        .and_then(Value::as_bool)
    {
        Some(false) => Value::Null,
        _ => optional_number(entry.get("probability")),
    };
    json!({
        "lorebookId": lorebook_id,
        "name": entry.get("comment").or_else(|| entry.get("name")).and_then(Value::as_str).unwrap_or(&format!("Entry {}", index + 1)),
        "content": string_field(entry, "content"),
        "description": string_field(entry, "description"),
        "keys": string_array(keys),
        "secondaryKeys": string_array(secondary),
        "enabled": enabled,
        "constant": bool_field(entry.get("constant"), false),
        "selective": bool_field(entry.get("selective"), false),
        "selectiveLogic": selective_logic_value(entry.get("selectiveLogic").or_else(|| entry.get("selective_logic"))),
        "probability": probability,
        "scanDepth": optional_number(entry.get("scanDepth").or_else(|| entry.get("scan_depth"))),
        "matchWholeWords": bool_field(entry.get("matchWholeWords").or_else(|| entry.get("match_whole_words")), false),
        "caseSensitive": bool_field(entry.get("caseSensitive").or_else(|| entry.get("case_sensitive")), false),
        "useRegex": bool_field(entry.get("useRegex").or_else(|| entry.get("regex")), false),
        "characterFilterMode": "any",
        "characterFilterIds": [],
        "characterTagFilterMode": "any",
        "characterTagFilters": [],
        "generationTriggerFilterMode": "any",
        "generationTriggerFilters": [],
        "additionalMatchingSources": [],
        "position": position,
        "depth": number(entry.get("depth"), 4),
        "order": number(entry.get("order").or_else(|| entry.get("insertion_order")).or_else(|| entry.get("uid")).or_else(|| entry.get("id")), index as i64),
        "role": lorebook_entry_role(entry.get("role")),
        "sticky": optional_number(entry.get("sticky")),
        "cooldown": optional_number(entry.get("cooldown")),
        "delay": optional_number(entry.get("delay")),
        "ephemeral": optional_number(entry.get("ephemeral")),
        "group": string_field(entry, "group"),
        "groupWeight": optional_number(entry.get("groupWeight")),
        "folderId": Value::Null,
        "preventRecursion": bool_field(entry.get("preventRecursion").or_else(|| entry.get("excludeRecursion")), false),
        "locked": bool_field(entry.get("locked"), false),
        "tag": detect_entry_tag(entry),
        "relationships": {},
        "dynamicState": {},
        "activationConditions": [],
        "schedule": Value::Null,
        "excludeFromVectorization": false,
    })
}

pub(super) fn normalize_imported_lorebook_entry(
    lorebook_id: &str,
    entry: &Value,
    index: usize,
) -> Value {
    let mut object =
        ensure_object(normalize_lorebook_entry(lorebook_id, entry, index)).unwrap_or_default();
    if let Some(source) = entry.as_object() {
        for (key, value) in source {
            if key != "id" && key != "lorebookId" {
                object.insert(key.clone(), value.clone());
            }
        }
    }
    if !object.contains_key("keys") {
        if let Some(keys) = entry.get("key").or_else(|| entry.get("keys")) {
            object.insert(
                "keys".to_string(),
                Value::Array(
                    string_array(Some(keys))
                        .into_iter()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }
    }
    if !object.contains_key("secondaryKeys") {
        if let Some(keys) = entry
            .get("keysecondary")
            .or_else(|| entry.get("secondary_keys"))
            .or_else(|| entry.get("secondaryKeys"))
        {
            object.insert(
                "secondaryKeys".to_string(),
                Value::Array(
                    string_array(Some(keys))
                        .into_iter()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }
    }
    if let Some(disabled) = entry.get("disable").and_then(Value::as_bool) {
        object.insert("enabled".to_string(), Value::Bool(!disabled));
    }
    if let Some(position) = object.get("position").cloned() {
        let normalized_position = match position {
            Value::String(raw) if raw == "after_char" => Some(1),
            Value::String(raw) if raw == "at_depth" || raw == "depth" => Some(2),
            Value::String(raw) => raw.parse::<i64>().ok(),
            Value::Number(number) => number.as_i64(),
            _ => None,
        };
        if let Some(position) = normalized_position {
            object.insert("position".to_string(), json!(position));
        }
    }
    object.insert(
        "role".to_string(),
        json!(lorebook_entry_role(object.get("role"))),
    );
    object.insert(
        "selectiveLogic".to_string(),
        Value::String(
            selective_logic_value(
                object
                    .get("selectiveLogic")
                    .or_else(|| object.get("selective_logic")),
            )
            .to_string(),
        ),
    );
    if object
        .get("useProbability")
        .or_else(|| object.get("use_probability"))
        .and_then(Value::as_bool)
        == Some(false)
    {
        object.insert("probability".to_string(), Value::Null);
    }
    object.insert(
        "lorebookId".to_string(),
        Value::String(lorebook_id.to_string()),
    );
    for key in [
        "id",
        "key",
        "keysecondary",
        "secondary_keys",
        "selective_logic",
        "disable",
        "uid",
        "useProbability",
        "use_probability",
    ] {
        object.remove(key);
    }
    Value::Object(object)
}

pub(super) fn normalize_lorebook(
    payload: &Value,
    fallback_name: &str,
    character_id: Option<&str>,
) -> (Value, Vec<Value>) {
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(fallback_name);
    let entries = lorebook_entries(payload);
    let lorebook = json!({
        "name": name,
        "description": payload.get("description").and_then(Value::as_str).unwrap_or("Imported from SillyTavern"),
        "category": detect_category(&entries, name),
        "imagePath": Value::Null,
        "scanDepth": number(payload.get("scan_depth").or_else(|| payload.get("scanDepth")), 2),
        "tokenBudget": number(payload.get("token_budget").or_else(|| payload.get("tokenBudget")), 2048),
        "recursiveScanning": bool_field(payload.get("recursive_scanning").or_else(|| payload.get("recursiveScanning")), false),
        "maxRecursionDepth": number(payload.get("max_recursion_depth").or_else(|| payload.get("maxRecursionDepth")), 3),
        "characterId": Value::Null,
        "characterIds": character_id.map(|id| json!([id])).unwrap_or_else(|| json!([])),
        "personaId": Value::Null,
        "personaIds": [],
        "chatId": Value::Null,
        "scope": normalize_lorebook_scope(payload.get("scope")),
        "isGlobal": false,
        "enabled": true,
        "tags": [],
        "generatedBy": "import",
        "sourceAgentId": Value::Null,
    });
    (lorebook, entries)
}
