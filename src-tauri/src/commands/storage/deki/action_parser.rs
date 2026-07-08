use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};

const DEKI_ACTION_ENTITIES: &[&str] = &[
    "characters",
    "character-groups",
    "personas",
    "persona-groups",
    "lorebooks",
    "lorebook-entries",
    "prompts",
    "prompt-sections",
    "prompt-groups",
    "prompt-variables",
];
const DEKI_ACTION_OPEN_TAG: &str = "<deki_action>";
const DEKI_ACTION_CLOSE_TAG: &str = "</deki_action>";
pub(super) const DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT: u64 = 200;

fn deki_no_action_contract() -> Value {
    json!({
        "type": "none",
        "capability": "read_only",
        "reason": "Deki-senpai returned a plain response with no pending UI approval action.",
    })
}

fn deki_unparseable_action_contract(error: &AppError) -> Value {
    let parser_error = error.to_string();
    json!({
        "type": "none",
        "capability": "read_only",
        "reason": format!(
            "Deki-senpai's approval action could not be parsed, so no change is pending. Ask Deki-senpai to retry with a shorter approval if you wanted to apply it. Parser error: {parser_error}"
        ),
    })
}
pub(super) fn deki_response_content_and_action(raw_content: &str) -> AppResult<(String, Value)> {
    let open_count = raw_content.matches(DEKI_ACTION_OPEN_TAG).count();
    let close_count = raw_content.matches(DEKI_ACTION_CLOSE_TAG).count();
    if open_count == 0 {
        if close_count > 0 {
            return Err(AppError::new(
                "deki_action_invalid",
                "Deki-senpai returned an action close tag without an opening tag.",
            ));
        }
        return Ok((raw_content.trim().to_string(), deki_no_action_contract()));
    }
    if open_count != 1 || close_count != 1 {
        return Err(AppError::new(
            "deki_action_invalid",
            "Deki-senpai must return exactly one action block.",
        ));
    }
    let Some(start) = raw_content.find(DEKI_ACTION_OPEN_TAG) else {
        return Err(AppError::new(
            "deki_action_invalid",
            "Deki-senpai returned an action block without an opening tag.",
        ));
    };
    let after_open = start + DEKI_ACTION_OPEN_TAG.len();
    let Some(relative_end) = raw_content[after_open..].find(DEKI_ACTION_CLOSE_TAG) else {
        return Err(AppError::new(
            "deki_action_invalid",
            "Deki-senpai returned an action block without a closing tag.",
        ));
    };
    let end = after_open + relative_end;
    let trailing = raw_content[end + DEKI_ACTION_CLOSE_TAG.len()..].trim();
    let content_parts = [raw_content[..start].trim(), trailing]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let visible_content = content_parts.join("\n\n");
    let action_json = raw_content[after_open..end].trim();
    let parsed = match parse_deki_action_json(action_json) {
        Ok(parsed) => parsed,
        Err(error) if !visible_content.is_empty() => {
            return Ok((visible_content, deki_unparseable_action_contract(&error)));
        }
        Err(error) => return Err(error),
    };
    let action = normalize_deki_response_action(parsed)?;
    let content = if visible_content.is_empty() {
        "I drafted a creative-library change for review.".to_string()
    } else {
        visible_content
    };
    Ok((content, action))
}

fn parse_deki_action_json(action_json: &str) -> AppResult<Value> {
    match parse_deki_action_json_candidate(action_json) {
        Ok(parsed) => Ok(parsed),
        Err(initial_error) => {
            let Some((start, end)) = first_json_object_bounds(action_json) else {
                return Err(AppError::new(
                    "deki_action_invalid",
                    format!("Deki-senpai returned malformed action JSON: {initial_error}"),
                ));
            };
            parse_deki_action_json_candidate(&action_json[start..end]).map_err(|error| {
                AppError::new(
                    "deki_action_invalid",
                    format!("Deki-senpai returned malformed action JSON: {error}"),
                )
            })
        }
    }
}

fn parse_deki_action_json_candidate(candidate: &str) -> Result<Value, serde_json::Error> {
    match serde_json::from_str::<Value>(candidate) {
        Ok(parsed) => Ok(parsed),
        Err(original_error) => {
            let Some(repaired) = repair_deki_action_json_strings(candidate) else {
                return Err(original_error);
            };
            serde_json::from_str::<Value>(&repaired).map_err(|_| original_error)
        }
    }
}

#[derive(Clone, Copy)]
#[allow(clippy::enum_variant_names)]
enum DekiJsonObjectState {
    KeyOrEnd,
    Colon,
    Value,
    CommaOrEnd,
}

#[derive(Clone, Copy)]
enum DekiJsonArrayState {
    ValueOrEnd,
    CommaOrEnd,
}

#[derive(Clone, Copy)]
enum DekiJsonContainer {
    Object(DekiJsonObjectState),
    Array(DekiJsonArrayState),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DekiJsonStringRole {
    Key,
    Value,
}

fn repair_deki_action_json_strings(input: &str) -> Option<String> {
    let mut output = String::with_capacity(input.len());
    let mut stack = Vec::<DekiJsonContainer>::new();
    let mut in_string = false;
    let mut escaped = false;
    let mut changed = false;
    let mut string_role = DekiJsonStringRole::Value;
    let mut pending_literal_value = false;

    for (index, character) in input.char_indices() {
        if in_string {
            if escaped {
                output.push(character);
                escaped = false;
                continue;
            }
            match character {
                '\\' => {
                    output.push(character);
                    escaped = true;
                }
                '"' => {
                    let next_index = index + character.len_utf8();
                    if deki_json_quote_can_close(input, next_index, string_role, &stack) {
                        output.push(character);
                        in_string = false;
                        deki_json_after_string(&mut stack, string_role);
                    } else {
                        output.push_str("\\\"");
                        changed = true;
                    }
                }
                '\n' => {
                    output.push_str("\\n");
                    changed = true;
                }
                '\r' => {
                    output.push_str("\\r");
                    changed = true;
                }
                '\t' => {
                    output.push_str("\\t");
                    changed = true;
                }
                control if control.is_control() => {
                    output.push_str(&format!("\\u{:04x}", control as u32));
                    changed = true;
                }
                _ => output.push(character),
            }
            continue;
        }

        if pending_literal_value
            && (character.is_whitespace() || matches!(character, ',' | '}' | ']'))
        {
            deki_json_after_value(&mut stack);
            pending_literal_value = false;
        }

        output.push(character);
        if character.is_whitespace() {
            continue;
        }

        match character {
            '{' => stack.push(DekiJsonContainer::Object(DekiJsonObjectState::KeyOrEnd)),
            '[' => stack.push(DekiJsonContainer::Array(DekiJsonArrayState::ValueOrEnd)),
            '"' => {
                string_role = deki_json_next_string_role(&stack);
                in_string = true;
                escaped = false;
            }
            ':' => {
                if let Some(DekiJsonContainer::Object(state)) = stack.last_mut() {
                    if matches!(state, DekiJsonObjectState::Colon) {
                        *state = DekiJsonObjectState::Value;
                    }
                }
            }
            ',' => match stack.last_mut() {
                Some(DekiJsonContainer::Object(state))
                    if matches!(state, DekiJsonObjectState::CommaOrEnd) =>
                {
                    *state = DekiJsonObjectState::KeyOrEnd;
                }
                Some(DekiJsonContainer::Array(state))
                    if matches!(state, DekiJsonArrayState::CommaOrEnd) =>
                {
                    *state = DekiJsonArrayState::ValueOrEnd;
                }
                _ => {}
            },
            '}' => {
                if matches!(stack.last(), Some(DekiJsonContainer::Object(_))) {
                    stack.pop();
                    deki_json_after_value(&mut stack);
                }
            }
            ']' => {
                if matches!(stack.last(), Some(DekiJsonContainer::Array(_))) {
                    stack.pop();
                    deki_json_after_value(&mut stack);
                }
            }
            '-' | '0'..='9' | 't' | 'f' | 'n' => {
                pending_literal_value = true;
            }
            _ => {}
        }
    }

    changed.then_some(output)
}

fn deki_json_next_string_role(stack: &[DekiJsonContainer]) -> DekiJsonStringRole {
    match stack.last() {
        Some(DekiJsonContainer::Object(DekiJsonObjectState::KeyOrEnd)) => DekiJsonStringRole::Key,
        _ => DekiJsonStringRole::Value,
    }
}

fn deki_json_after_string(stack: &mut [DekiJsonContainer], role: DekiJsonStringRole) {
    match role {
        DekiJsonStringRole::Key => {
            if let Some(DekiJsonContainer::Object(state)) = stack.last_mut() {
                *state = DekiJsonObjectState::Colon;
            }
        }
        DekiJsonStringRole::Value => deki_json_after_value(stack),
    }
}

fn deki_json_after_value(stack: &mut [DekiJsonContainer]) {
    match stack.last_mut() {
        Some(DekiJsonContainer::Object(state)) => *state = DekiJsonObjectState::CommaOrEnd,
        Some(DekiJsonContainer::Array(state)) => *state = DekiJsonArrayState::CommaOrEnd,
        None => {}
    }
}

fn deki_json_quote_can_close(
    input: &str,
    next_index: usize,
    role: DekiJsonStringRole,
    stack: &[DekiJsonContainer],
) -> bool {
    let Some((next_position, next)) = next_non_whitespace_char(input, next_index) else {
        return true;
    };
    match role {
        DekiJsonStringRole::Key => next == ':',
        DekiJsonStringRole::Value => match next {
            ',' => deki_json_comma_can_follow_value(input, next_position, stack),
            '}' => matches!(stack.last(), Some(DekiJsonContainer::Object(_))),
            ']' => matches!(stack.last(), Some(DekiJsonContainer::Array(_))),
            _ => false,
        },
    }
}

fn deki_json_comma_can_follow_value(
    input: &str,
    comma_index: usize,
    stack: &[DekiJsonContainer],
) -> bool {
    let Some((_, next)) = next_non_whitespace_char(input, comma_index + 1) else {
        return false;
    };
    match stack.last() {
        Some(DekiJsonContainer::Object(_)) => next == '"',
        Some(DekiJsonContainer::Array(_)) => {
            matches!(next, '"' | '{' | '[' | '-' | '0'..='9' | 't' | 'f' | 'n')
        }
        None => false,
    }
}

fn next_non_whitespace_char(input: &str, start: usize) -> Option<(usize, char)> {
    input[start..]
        .char_indices()
        .find(|(_, character)| !character.is_whitespace())
        .map(|(offset, character)| (start + offset, character))
}

fn first_json_object_bounds(value: &str) -> Option<(usize, usize)> {
    let start = value.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, ch) in value[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' | '[' => depth += 1,
            '}' | ']' => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
                if depth == 0 {
                    return Some((start, start + offset + ch.len_utf8()));
                }
            }
            _ => {}
        }
    }

    None
}

fn deki_action_invalid(message: impl Into<String>) -> AppError {
    AppError::new("deki_action_invalid", message.into())
}

fn validate_deki_action_known_fields(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
    owner: &str,
) -> AppResult<()> {
    let unknown = object
        .keys()
        .filter(|key| !allowed.contains(&key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if unknown.is_empty() {
        return Ok(());
    }
    Err(deki_action_invalid(format!(
        "Deki-senpai {owner} contains unsupported field(s): {}.",
        unknown.join(", ")
    )))
}

fn validate_deki_action_required_text_fields(
    object: &serde_json::Map<String, Value>,
    fields: &[&str],
    owner: &str,
) -> AppResult<()> {
    let missing = fields
        .iter()
        .filter(|field| {
            object
                .get(**field)
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
        })
        .copied()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    Err(deki_action_invalid(format!(
        "Deki-senpai {owner} requires {}.",
        missing.join(", ")
    )))
}

fn validate_deki_persona_action_payload(payload: &Value, require_complete: bool) -> AppResult<()> {
    let object = payload.as_object().ok_or_else(|| {
        deki_action_invalid("Deki-senpai persona action payload must be an object.")
    })?;
    const ALLOWED: &[&str] = &[
        "name",
        "comment",
        "description",
        "personality",
        "scenario",
        "backstory",
        "appearance",
        "tags",
    ];
    const REQUIRED: &[&str] = &[
        "name",
        "description",
        "personality",
        "scenario",
        "backstory",
        "appearance",
    ];
    validate_deki_action_known_fields(object, ALLOWED, "persona card")?;
    if require_complete {
        validate_deki_action_required_text_fields(object, REQUIRED, "persona card")?;
    }
    Ok(())
}

fn validate_deki_character_extensions(
    extensions: &serde_json::Map<String, Value>,
    require_complete: bool,
) -> AppResult<()> {
    const ALLOWED: &[&str] = &[
        "talkativeness",
        "fav",
        "world",
        "depth_prompt",
        "publicProfile",
        "backstory",
        "appearance",
        "marinara",
    ];
    validate_deki_action_known_fields(extensions, ALLOWED, "character extensions")?;
    if require_complete {
        validate_deki_action_required_text_fields(
            extensions,
            &["backstory", "appearance"],
            "character card",
        )?;
    }
    Ok(())
}

const DEKI_CHARACTER_DATA_ALLOWED_FIELDS: &[&str] = &[
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
    "creator_notes",
    "system_prompt",
    "post_history_instructions",
    "tags",
    "creator",
    "character_version",
    "alternate_greetings",
    "extensions",
    "character_book",
];

const DEKI_CHARACTER_DATA_REQUIRED_FIELDS: &[&str] = &[
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
    "creator_notes",
    "system_prompt",
];

fn validate_deki_character_data(data: &Value, require_complete: bool) -> AppResult<()> {
    let object = data.as_object().ok_or_else(|| {
        deki_action_invalid("Deki-senpai character action data must be an object.")
    })?;
    validate_deki_action_known_fields(
        object,
        DEKI_CHARACTER_DATA_ALLOWED_FIELDS,
        "character card",
    )?;
    if require_complete {
        validate_deki_action_required_text_fields(
            object,
            DEKI_CHARACTER_DATA_REQUIRED_FIELDS,
            "character card",
        )?;
    }
    if let Some(tags) = object.get("tags") {
        if !tags.is_array() {
            return Err(deki_action_invalid(
                "Deki-senpai character card tags must be an array.",
            ));
        }
    } else if require_complete {
        return Err(deki_action_invalid(
            "Deki-senpai character card requires tags.",
        ));
    }
    let Some(extensions) = object.get("extensions") else {
        if require_complete {
            return Err(deki_action_invalid(
                "Deki-senpai character card requires extensions.backstory and extensions.appearance.",
            ));
        }
        return Ok(());
    };
    let extensions = extensions.as_object().ok_or_else(|| {
        deki_action_invalid("Deki-senpai character card extensions must be an object.")
    })?;
    validate_deki_character_extensions(extensions, require_complete)
}

fn validate_deki_character_action_payload(
    payload: &Value,
    require_complete: bool,
) -> AppResult<()> {
    let object = payload.as_object().ok_or_else(|| {
        deki_action_invalid("Deki-senpai character action payload must be an object.")
    })?;
    validate_deki_action_known_fields(object, &["data"], "character draft")?;
    let Some(data) = object.get("data") else {
        if require_complete {
            return Err(deki_action_invalid(
                "Deki-senpai character action requires data.",
            ));
        }
        return Ok(());
    };
    validate_deki_character_data(data, require_complete)
}

fn normalize_deki_character_action_payload(payload: &Value, require_complete: bool) -> Value {
    if require_complete {
        return payload.clone();
    }
    let Some(object) = payload.as_object() else {
        return payload.clone();
    };
    if object.contains_key("data") {
        return payload.clone();
    }
    if object
        .keys()
        .any(|key| DEKI_CHARACTER_DATA_ALLOWED_FIELDS.contains(&key.as_str()))
    {
        return json!({ "data": payload });
    }
    payload.clone()
}

fn validate_deki_record_action_payload(
    entity: &str,
    payload: &Value,
    require_complete: bool,
) -> AppResult<()> {
    match entity {
        "characters" => validate_deki_character_action_payload(payload, require_complete),
        "personas" => validate_deki_persona_action_payload(payload, require_complete),
        _ => Ok(()),
    }
}

fn normalize_deki_record_action_payload(
    entity: &str,
    payload: &Value,
    require_complete: bool,
) -> AppResult<Value> {
    let normalized = match entity {
        "characters" => normalize_deki_character_action_payload(payload, require_complete),
        _ => payload.clone(),
    };
    validate_deki_record_action_payload(entity, &normalized, require_complete)?;
    Ok(normalized)
}
fn normalize_deki_response_action(action: Value) -> AppResult<Value> {
    let object = action.as_object().ok_or_else(|| {
        AppError::new(
            "deki_action_invalid",
            "Deki-senpai action must be a JSON object.",
        )
    })?;
    let action_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if action_type == "none" {
        return Ok(deki_no_action_contract());
    }
    let label = object
        .get("label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let rationale = object
        .get("rationale")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if action_type == "request_web_research" {
        let scope = object
            .get("scope")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                AppError::new(
                    "deki_action_invalid",
                    "Deki-senpai web research action requires a scope object.",
                )
            })?;
        let scope_type = scope
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if scope_type != "query" {
            return Err(AppError::new(
                "deki_action_invalid",
                "Deki-senpai web research scope must be a query.",
            ));
        }
        let query = scope
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::new(
                    "deki_action_invalid",
                    "Deki-senpai web research action requires a query.",
                )
            })?;
        let reason = object
            .get("reason")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::new(
                    "deki_action_invalid",
                    "Deki-senpai web research action requires a reason.",
                )
            })?;
        let allowed_domains = scope
            .get("allowedDomains")
            .and_then(Value::as_array)
            .map(|domains| {
                domains
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let sources = object
            .get("sources")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut normalized = json!({
            "type": "request_web_research",
            "scope": {
                "type": "query",
                "query": query,
            },
            "reason": reason,
        });
        if !allowed_domains.is_empty() {
            normalized["scope"]["allowedDomains"] = json!(allowed_domains);
        }
        if !sources.is_empty() {
            normalized["sources"] = json!(sources);
        }
        if let Some(label) = label {
            normalized["label"] = json!(label);
        }
        return Ok(normalized);
    }
    match action_type {
        "apply_lorebook_redraft" => {
            let lorebook = object
                .get("lorebook")
                .filter(|value| value.is_object())
                .ok_or_else(|| {
                    AppError::new(
                        "deki_action_invalid",
                        "Deki-senpai lorebook redraft action requires a lorebook object.",
                    )
                })?;
            let entries = object
                .get("entries")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    AppError::new(
                        "deki_action_invalid",
                        "Deki-senpai lorebook redraft action requires entries.",
                    )
                })?
                .iter()
                .filter(|value| value.is_object())
                .cloned()
                .collect::<Vec<_>>();
            if entries.is_empty() {
                return Err(AppError::new(
                    "deki_action_invalid",
                    "Deki-senpai lorebook redraft action requires at least one entry object.",
                ));
            }
            let mut normalized = json!({
                "type": "apply_lorebook_redraft",
                "lorebook": lorebook,
                "entries": entries,
            });
            if let Some(id) = object
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                normalized["id"] = json!(id);
            }
            if let Some(label) = label {
                normalized["label"] = json!(label);
            }
            if let Some(rationale) = rationale {
                normalized["rationale"] = json!(rationale);
            }
            Ok(normalized)
        }
        "create_record" => {
            let entity = deki_action_entity(object)?;
            let draft = object
                .get("draft")
                .filter(|value| value.is_object())
                .ok_or_else(|| {
                    AppError::new(
                        "deki_action_invalid",
                        "Deki-senpai create action requires a draft object.",
                    )
                })?;
            let draft = normalize_deki_record_action_payload(entity, draft, true)?;
            let mut normalized = json!({
                "type": "create_record",
                "entity": entity,
                "draft": draft,
            });
            if let Some(label) = label {
                normalized["label"] = json!(label);
            }
            if let Some(rationale) = rationale {
                normalized["rationale"] = json!(rationale);
            }
            Ok(normalized)
        }
        "edit_record" => {
            let entity = deki_action_entity(object)?;
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::new(
                        "deki_action_invalid",
                        "Deki-senpai edit action requires a record id.",
                    )
                })?;
            let patch = object
                .get("patch")
                .filter(|value| value.is_object())
                .ok_or_else(|| {
                    AppError::new(
                        "deki_action_invalid",
                        "Deki-senpai edit action requires a patch object.",
                    )
                })?;
            let patch = normalize_deki_record_action_payload(entity, patch, false)?;
            let mut normalized = json!({
                "type": "edit_record",
                "entity": entity,
                "id": id,
                "patch": patch,
            });
            if let Some(label) = label {
                normalized["label"] = json!(label);
            }
            if let Some(rationale) = rationale {
                normalized["rationale"] = json!(rationale);
            }
            Ok(normalized)
        }
        "request_chat_access" => {
            let scope = normalize_deki_chat_access_scope(object.get("scope"))?;
            let window = normalize_deki_chat_access_window(object.get("window"))?;
            let mut normalized = json!({
                "type": "request_chat_access",
                "scope": scope,
                "window": window,
            });
            if let Some(label) = label {
                normalized["label"] = json!(label);
            }
            if let Some(rationale) = rationale {
                normalized["rationale"] = json!(rationale);
            }
            Ok(normalized)
        }
        _ => Err(AppError::new(
            "deki_action_invalid",
            "Deki-senpai action type is not supported.",
        )),
    }
}

fn deki_action_entity(object: &serde_json::Map<String, Value>) -> AppResult<&str> {
    object
        .get("entity")
        .and_then(Value::as_str)
        .filter(|entity| DEKI_ACTION_ENTITIES.contains(entity))
        .ok_or_else(|| {
            AppError::new(
                "deki_action_invalid",
                "Deki-senpai action entity is not supported.",
            )
        })
}

fn normalize_deki_chat_access_scope(scope: Option<&Value>) -> AppResult<Value> {
    let scope = scope.and_then(Value::as_object).ok_or_else(|| {
        AppError::new(
            "deki_action_invalid",
            "Deki-senpai chat access action requires a scope object.",
        )
    })?;
    let scope_type = scope
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    match scope_type {
        "specific_chats" => {
            let chat_ids = scope
                .get("chatIds")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            if chat_ids.is_empty() {
                return Err(AppError::new(
                    "deki_action_invalid",
                    "Deki-senpai specific chat access requires at least one chat id.",
                ));
            }
            Ok(json!({ "type": "specific_chats", "chatIds": chat_ids }))
        }
        "character" => {
            let character_id = scope
                .get("characterId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let character_name = scope
                .get("characterName")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if character_id.is_none() && character_name.is_none() {
                return Err(AppError::new(
                    "deki_action_invalid",
                    "Deki-senpai character chat access requires a character id or character name.",
                ));
            }
            let mut normalized = json!({
                "type": "character",
            });
            if let Some(character_id) = character_id {
                normalized["characterId"] = json!(character_id);
            }
            if let Some(character_name) = character_name {
                normalized["characterName"] = json!(character_name);
            }
            Ok(normalized)
        }
        "mode" => {
            let modes = scope
                .get("modes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| matches!(*value, "conversation" | "roleplay" | "game"))
                .collect::<Vec<_>>();
            if modes.is_empty() {
                return Err(AppError::new(
                    "deki_action_invalid",
                    "Deki-senpai mode chat access requires conversation, roleplay, or game.",
                ));
            }
            Ok(json!({ "type": "mode", "modes": modes }))
        }
        _ => Err(AppError::new(
            "deki_action_invalid",
            "Deki-senpai chat access scope type is not supported.",
        )),
    }
}

fn normalize_deki_chat_access_window(window: Option<&Value>) -> AppResult<Value> {
    let Some(window) = window else {
        return Ok(json!({ "messageCount": 50 }));
    };
    let window = window.as_object().ok_or_else(|| {
        AppError::new(
            "deki_action_invalid",
            "Deki-senpai chat access window must be an object.",
        )
    })?;
    let message_count = match window.get("messageCount") {
        Some(Value::Null) => DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT,
        Some(value) => value
            .as_u64()
            .map(|value| value.clamp(1, DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT))
            .unwrap_or(50),
        None => 50,
    };
    Ok(json!({ "messageCount": message_count }))
}
