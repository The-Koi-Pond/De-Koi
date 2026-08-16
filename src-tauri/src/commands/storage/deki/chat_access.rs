use crate::state::AppState;
use autoagents::prelude::{ToolInput, ToolInputT};
use marinara_core::{now_iso, AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

const CHAT_OVERVIEW_DEFAULT_LIMIT: usize = 50;
const CHAT_OVERVIEW_MAX_LIMIT: usize = 100;
const CHAT_MESSAGES_MAX_LIMIT: usize = 200;
const CHAT_PROMPT_CONTEXT_MAX_CHATS: usize = 3;
const CHAT_PROMPT_CONTEXT_MAX_MESSAGES_PER_CHAT: usize = 50;
const CHAT_PROMPT_CONTEXT_MAX_CHARS: usize = 48 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DekiChatAccessGrant {
    pub(super) id: String,
    pub(super) action_message_id: String,
    pub(super) scope: DekiChatAccessScope,
    #[serde(default)]
    pub(super) window: DekiChatAccessWindow,
    pub(super) granted_at: String,
    #[serde(default)]
    pub(super) expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum DekiChatAccessScope {
    SpecificChats {
        #[serde(rename = "chatIds")]
        chat_ids: Vec<String>,
    },
    Character {
        #[serde(default, rename = "characterId")]
        character_id: Option<String>,
        #[serde(default, rename = "characterName")]
        character_name: Option<String>,
    },
    LatestCharacter {
        #[serde(default, rename = "characterId")]
        character_id: Option<String>,
        #[serde(default, rename = "characterName")]
        character_name: Option<String>,
    },
    Mode {
        modes: Vec<String>,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DekiChatAccessWindow {
    #[serde(default)]
    pub(super) message_count: Option<usize>,
}

#[derive(Debug, Deserialize, ToolInput)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadDekiChatsArgs {
    #[input(description = "Optional exact approved chat ids to list.")]
    #[serde(default, alias = "chat_ids")]
    pub(super) chat_ids: Option<Vec<String>>,
    #[input(
        description = "Optional character id; only approved chats involving this character are returned."
    )]
    #[serde(default, alias = "character_id")]
    pub(super) character_id: Option<String>,
    #[input(description = "Optional chat modes to list: conversation, roleplay, or game.")]
    #[serde(default)]
    pub(super) modes: Option<Vec<String>>,
    #[input(
        description = "Maximum overview rows to return. Defaults to 50 and is capped by De-Koi."
    )]
    #[serde(default)]
    pub(super) limit: Option<usize>,
    #[input(description = "Zero-based pagination offset for overview rows.")]
    #[serde(default)]
    pub(super) offset: Option<usize>,
}

#[derive(Debug, Deserialize, ToolInput)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadDekiChatMessagesArgs {
    #[input(description = "Exact approved chat id to read messages from.")]
    #[serde(alias = "chat_id")]
    pub(super) chat_id: String,
    #[input(
        description = "Maximum messages to return. The approved grant window is always enforced."
    )]
    #[serde(default)]
    pub(super) limit: Option<usize>,
    #[input(
        description = "Optional pagination cursor; returns messages before this createdAt|id cursor when supported."
    )]
    #[serde(default)]
    pub(super) before: Option<String>,
}

pub(super) fn overview(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
    args: ReadDekiChatsArgs,
) -> AppResult<Value> {
    let allowed = allowed_chat_ids(state, grants)?;
    require_chat_grant(&allowed)?;
    let requested_ids = normalized_set(args.chat_ids.unwrap_or_default());
    let requested_character_id = normalized_string(args.character_id.as_deref());
    let requested_modes = normalized_set(args.modes.unwrap_or_default());
    let character_names = character_names(state)?;
    let mut items = state
        .storage
        .list("chats")?
        .into_iter()
        .filter(|chat| {
            let id = string_field(chat, "id").unwrap_or_default();
            if !allowed.contains(&id) {
                return false;
            }
            if !requested_ids.is_empty() && !requested_ids.contains(&id) {
                return false;
            }
            if let Some(character_id) = requested_character_id.as_deref() {
                if !chat_character_ids(chat).contains(character_id) {
                    return false;
                }
            }
            if !requested_modes.is_empty() {
                let mode = chat_mode(chat);
                if !requested_modes.contains(&mode) {
                    return false;
                }
            }
            true
        })
        .map(|chat| overview_item(state, &chat, &character_names))
        .collect::<AppResult<Vec<_>>>()?;

    items.sort_by(|left, right| {
        sort_time(right)
            .cmp(&sort_time(left))
            .then_with(|| sort_string(left.get("title")).cmp(&sort_string(right.get("title"))))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });

    let matching_total = items.len();
    let offset = args.offset.unwrap_or(0);
    let limit = bounded_limit(
        args.limit,
        CHAT_OVERVIEW_DEFAULT_LIMIT,
        CHAT_OVERVIEW_MAX_LIMIT,
    );
    let page = items
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let page_count = page.len();
    Ok(json!({
        "items": page,
        "matchingTotal": matching_total,
        "pageCount": page_count,
        "offset": offset,
        "limit": limit,
        "hasMore": offset.saturating_add(limit) < matching_total,
        "contract": {
            "detailTool": "read_deki_chat_messages",
            "note": "Overview rows do not include message bodies. Use read_deki_chat_messages with an approved chat id for bounded message slices."
        }
    }))
}

pub(super) fn messages(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
    args: ReadDekiChatMessagesArgs,
) -> AppResult<Value> {
    let chat_id = ensure_chat_allowed(state, grants, &args.chat_id)?;
    let grant_limit = window_limit_for_chat(state, grants, &chat_id)?;
    let requested_limit = args.limit.unwrap_or(grant_limit);
    let limit = requested_limit
        .min(grant_limit)
        .clamp(1, CHAT_MESSAGES_MAX_LIMIT);
    let rows = state
        .storage
        .list_messages_for_chat_page(&chat_id, limit, args.before.as_deref())?
        .into_iter()
        .map(project_message)
        .collect::<Vec<_>>();
    Ok(json!({
        "chatId": chat_id,
        "messages": rows,
        "pageCount": rows.len(),
        "limit": limit,
        "windowLimit": grant_limit,
        "hasMore": rows.len() == limit,
        "before": args.before
    }))
}

pub(super) fn ensure_chat_allowed(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
    chat_id: &str,
) -> AppResult<String> {
    let chat_id = normalized_string(Some(chat_id))
        .ok_or_else(|| AppError::invalid_input("Deki chat access requires chatId"))?;
    let allowed = allowed_chat_ids(state, grants)?;
    require_chat_grant(&allowed)?;
    if !allowed.contains(&chat_id) {
        return Err(AppError::invalid_input(format!(
            "Approved Deki chat access does not include chat '{chat_id}'"
        )));
    }
    Ok(chat_id)
}

pub(super) fn prompt_context(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
) -> AppResult<String> {
    let allowed = allowed_chat_ids(state, grants)?;
    if allowed.is_empty() {
        return Ok(
            "Approved chat context snapshot: no chats matched the approved grant scope."
                .to_string(),
        );
    }

    let character_names = character_names(state)?;
    let mut chats = state
        .storage
        .list("chats")?
        .into_iter()
        .filter(|chat| {
            string_field(chat, "id")
                .as_deref()
                .is_some_and(|id| allowed.contains(id))
        })
        .map(|chat| overview_item(state, &chat, &character_names))
        .collect::<AppResult<Vec<_>>>()?;
    chats.sort_by(|left, right| {
        sort_time(right)
            .cmp(&sort_time(left))
            .then_with(|| sort_string(left.get("title")).cmp(&sort_string(right.get("title"))))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });

    let mut excerpts = Vec::new();
    for chat in chats.into_iter().take(CHAT_PROMPT_CONTEXT_MAX_CHATS) {
        let Some(chat_id) = chat.get("id").and_then(Value::as_str) else {
            continue;
        };
        let grant_limit = window_limit_for_chat(state, grants, chat_id)?;
        let limit = grant_limit
            .min(CHAT_PROMPT_CONTEXT_MAX_MESSAGES_PER_CHAT)
            .clamp(1, CHAT_MESSAGES_MAX_LIMIT);
        let messages = state
            .storage
            .list_messages_for_chat_page(chat_id, limit, None)?
            .into_iter()
            .map(project_message)
            .collect::<Vec<_>>();
        excerpts.push(json!({
            "chat": chat,
            "messages": messages,
        }));
    }

    let payload = json!({
        "note": "Server-injected approved chat context. These excerpts were read only after the user granted scoped access. Use this evidence before drafting interaction-based answers or approval actions.",
        "chatCount": excerpts.len(),
        "chats": excerpts,
    });
    let serialized = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
    Ok(truncate_prompt_context(serialized))
}

fn require_chat_grant(allowed: &HashSet<String>) -> AppResult<()> {
    if allowed.is_empty() {
        return Err(AppError::invalid_input(
            "Deki chat access has not been approved for this session.",
        ));
    }
    Ok(())
}

fn allowed_chat_ids(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
) -> AppResult<HashSet<String>> {
    let now = now_iso();
    let chats = state.storage.list("chats")?;
    let mut allowed = HashSet::new();
    for grant in grants.iter().filter(|grant| !grant_expired(grant, &now)) {
        match &grant.scope {
            DekiChatAccessScope::SpecificChats { chat_ids } => {
                for id in chat_ids {
                    if let Some(id) = normalized_string(Some(id)) {
                        allowed.insert(id);
                    }
                }
            }
            DekiChatAccessScope::Character {
                character_id,
                character_name,
            } => {
                let character_ids =
                    character_scope_ids(state, character_id.as_deref(), character_name.as_deref())?;
                let character_name = normalized_string(character_name.as_deref());
                for chat in &chats {
                    if chat_matches_character_scope(chat, &character_ids, character_name.as_deref())
                    {
                        if let Some(id) = string_field(chat, "id") {
                            allowed.insert(id);
                        }
                    }
                }
            }
            DekiChatAccessScope::LatestCharacter {
                character_id,
                character_name,
            } => {
                if let Some(id) = latest_character_chat_id(
                    state,
                    &chats,
                    character_id.as_deref(),
                    character_name.as_deref(),
                )? {
                    allowed.insert(id);
                }
            }
            DekiChatAccessScope::Mode { modes } => {
                let modes = normalized_set(modes.clone());
                for chat in &chats {
                    if modes.contains(&chat_mode(chat)) {
                        if let Some(id) = string_field(chat, "id") {
                            allowed.insert(id);
                        }
                    }
                }
            }
        }
    }
    Ok(allowed)
}

fn window_limit_for_chat(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
    chat_id: &str,
) -> AppResult<usize> {
    let Some(chat) = state.storage.get("chats", chat_id)? else {
        return Err(AppError::not_found(format!(
            "Chat '{chat_id}' was not found"
        )));
    };
    let now = now_iso();
    let mut limit = 0usize;
    for grant in grants.iter().filter(|grant| !grant_expired(grant, &now)) {
        if grant_allows_chat(state, grant, &chat)? {
            limit = limit.max(
                grant
                    .window
                    .message_count
                    .unwrap_or(CHAT_MESSAGES_MAX_LIMIT)
                    .clamp(1, CHAT_MESSAGES_MAX_LIMIT),
            );
        }
    }
    Ok(limit.max(1))
}

fn grant_allows_chat(
    state: &AppState,
    grant: &DekiChatAccessGrant,
    chat: &Value,
) -> AppResult<bool> {
    let id = string_field(chat, "id").unwrap_or_default();
    match &grant.scope {
        DekiChatAccessScope::SpecificChats { chat_ids } => Ok(chat_ids
            .iter()
            .filter_map(|id| normalized_string(Some(id)))
            .any(|chat_id| chat_id == id)),
        DekiChatAccessScope::Character {
            character_id,
            character_name,
        } => {
            let character_ids =
                character_scope_ids(state, character_id.as_deref(), character_name.as_deref())?;
            Ok(chat_matches_character_scope(
                chat,
                &character_ids,
                normalized_string(character_name.as_deref()).as_deref(),
            ))
        }
        DekiChatAccessScope::LatestCharacter {
            character_id,
            character_name,
        } => {
            let chats = state.storage.list("chats")?;
            Ok(latest_character_chat_id(
                state,
                &chats,
                character_id.as_deref(),
                character_name.as_deref(),
            )?
            .is_some_and(|latest_id| latest_id == id))
        }
        DekiChatAccessScope::Mode { modes } => {
            Ok(normalized_set(modes.clone()).contains(&chat_mode(chat)))
        }
    }
}

fn latest_character_chat_id(
    state: &AppState,
    chats: &[Value],
    character_id: Option<&str>,
    character_name: Option<&str>,
) -> AppResult<Option<String>> {
    let character_ids = character_scope_ids(state, character_id, character_name)?;
    let character_name = normalized_string(character_name);
    let mut matches = chats
        .iter()
        .filter(|chat| {
            chat_matches_character_scope(chat, &character_ids, character_name.as_deref())
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        sort_time(right)
            .cmp(&sort_time(left))
            .then_with(|| sort_string(left.get("title")).cmp(&sort_string(right.get("title"))))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });
    Ok(matches.first().and_then(|chat| string_field(chat, "id")))
}

fn grant_expired(grant: &DekiChatAccessGrant, now: &str) -> bool {
    grant
        .expires_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|expires_at| expires_at <= now)
}

fn character_scope_ids(
    state: &AppState,
    character_id: Option<&str>,
    character_name: Option<&str>,
) -> AppResult<HashSet<String>> {
    let mut ids = HashSet::new();
    if let Some(character_id) = normalized_string(character_id) {
        ids.insert(character_id);
    }
    let Some(character_name) = normalized_key(character_name) else {
        return Ok(ids);
    };
    for row in state.storage.list("characters")? {
        let Some(id) = string_field(&row, "id") else {
            continue;
        };
        let row_name = string_field(&row, "name")
            .or_else(|| row.get("data").and_then(|data| string_field(data, "name")));
        let id_matches = normalized_key(Some(&id)).is_some_and(|value| value == character_name);
        let name_matches = row_name
            .as_deref()
            .and_then(|name| normalized_key(Some(name)))
            .is_some_and(|value| value == character_name);
        if id_matches || name_matches {
            ids.insert(id);
        }
    }
    Ok(ids)
}

fn chat_matches_character_scope(
    chat: &Value,
    character_ids: &HashSet<String>,
    character_name: Option<&str>,
) -> bool {
    let chat_character_ids = chat_character_ids(chat);
    if !character_ids.is_empty()
        && chat_character_ids
            .iter()
            .any(|character_id| character_ids.contains(character_id))
    {
        return true;
    }
    let Some(character_name) = normalized_key(character_name) else {
        return false;
    };
    [string_field(chat, "name"), string_field(chat, "title")]
        .into_iter()
        .flatten()
        .any(|value| normalized_key(Some(&value)).is_some_and(|value| value == character_name))
}

fn overview_item(
    state: &AppState,
    chat: &Value,
    character_names: &HashMap<String, String>,
) -> AppResult<Value> {
    let id = string_field(chat, "id").unwrap_or_default();
    let character_ids = chat_character_ids(chat);
    let participants = character_ids
        .iter()
        .filter_map(|id| {
            character_names
                .get(id)
                .cloned()
                .or_else(|| Some(id.clone()))
        })
        .take(8)
        .collect::<Vec<_>>();
    Ok(json!({
        "id": id,
        "mode": chat_mode(chat),
        "title": chat_title(chat, &id),
        "characterIds": character_ids,
        "participantHints": participants,
        "createdAt": string_field(chat, "createdAt"),
        "updatedAt": string_field(chat, "updatedAt"),
        "messageCount": state.storage.count_messages_for_chat(&id)?,
    }))
}

fn project_message(message: Value) -> Value {
    let mut item = Map::new();
    copy_field(&message, &mut item, "id");
    copy_field(&message, &mut item, "chatId");
    copy_field(&message, &mut item, "role");
    copy_field(&message, &mut item, "characterId");
    copy_field(&message, &mut item, "content");
    copy_field(&message, &mut item, "createdAt");
    copy_field(&message, &mut item, "updatedAt");
    Value::Object(item)
}

fn copy_field(source: &Value, target: &mut Map<String, Value>, field: &str) {
    if let Some(value) = source.get(field) {
        target.insert(field.to_string(), value.clone());
    }
}

fn character_names(state: &AppState) -> AppResult<HashMap<String, String>> {
    let mut names = HashMap::new();
    for row in state.storage.list("characters")? {
        let Some(id) = string_field(&row, "id") else {
            continue;
        };
        let name = string_field(&row, "name")
            .or_else(|| row.get("data").and_then(|data| string_field(data, "name")))
            .unwrap_or_else(|| id.clone());
        names.insert(id, name);
    }
    Ok(names)
}

fn chat_title(chat: &Value, fallback: &str) -> String {
    string_field(chat, "name")
        .or_else(|| string_field(chat, "title"))
        .unwrap_or_else(|| fallback.to_string())
}

fn chat_mode(chat: &Value) -> String {
    string_field(chat, "mode").unwrap_or_else(|| "conversation".to_string())
}

fn chat_character_ids(chat: &Value) -> HashSet<String> {
    chat.get("characterIds")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|id| normalized_string(Some(id)))
        .collect()
}

fn normalized_set(values: Vec<String>) -> HashSet<String> {
    values
        .iter()
        .filter_map(|value| normalized_string(Some(value)))
        .collect()
}

fn normalized_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalized_key(value: Option<&str>) -> Option<String> {
    normalized_string(value).map(|value| value.to_ascii_lowercase())
}

fn string_field(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .and_then(|value| normalized_string(Some(value)))
}

fn sort_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn sort_time(row: &Value) -> String {
    row.get("updatedAt")
        .or_else(|| row.get("createdAt"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn truncate_prompt_context(value: String) -> String {
    if value.chars().count() <= CHAT_PROMPT_CONTEXT_MAX_CHARS {
        return value;
    }
    let mut truncated = value
        .chars()
        .take(CHAT_PROMPT_CONTEXT_MAX_CHARS)
        .collect::<String>();
    truncated.push_str(
        "\n\n[Approved chat context truncated before prompting to stay within Deki's context budget.]",
    );
    truncated
}

fn bounded_limit(value: Option<usize>, default: usize, max: usize) -> usize {
    value.unwrap_or(default).clamp(1, max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-deki-chat-access-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn seed_chats(state: &AppState) {
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-rina",
                    "data": { "name": "Rina" }
                }),
            )
            .expect("seed character");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-rina",
                    "name": "Rina RP",
                    "mode": "roleplay",
                    "characterIds": ["char-rina"],
                    "createdAt": "2026-06-01T10:00:00.000Z",
                    "updatedAt": "2026-06-01T10:02:00.000Z"
                }),
            )
            .expect("seed chat");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-other",
                    "name": "Other",
                    "mode": "conversation",
                    "characterIds": ["char-other"],
                    "createdAt": "2026-06-01T10:00:00.000Z"
                }),
            )
            .expect("seed chat");
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "message-1",
                    "chatId": "chat-rina",
                    "role": "user",
                    "content": "hello rina",
                    "createdAt": "2026-06-01T10:01:00.000Z",
                    "extra": { "cachedPrompt": [{ "role": "system", "content": "secret prompt" }] }
                }),
            )
            .expect("seed message");
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "message-2",
                    "chatId": "chat-other",
                    "role": "user",
                    "content": "unapproved",
                    "createdAt": "2026-06-01T10:01:00.000Z"
                }),
            )
            .expect("seed message");
    }

    fn character_grant() -> DekiChatAccessGrant {
        DekiChatAccessGrant {
            id: "grant-1".to_string(),
            action_message_id: "message-action".to_string(),
            scope: DekiChatAccessScope::Character {
                character_id: Some("char-rina".to_string()),
                character_name: Some("Rina".to_string()),
            },
            window: DekiChatAccessWindow {
                message_count: Some(5),
            },
            granted_at: "2026-06-01T10:00:00.000Z".to_string(),
            expires_at: None,
        }
    }

    #[test]
    fn overview_requires_an_approved_grant_and_omits_message_bodies() {
        let state = test_state("overview");
        seed_chats(&state);

        let error = overview(
            &state,
            &[],
            ReadDekiChatsArgs {
                chat_ids: None,
                character_id: None,
                modes: None,
                limit: None,
                offset: None,
            },
        )
        .expect_err("missing grant should reject");
        assert_eq!(error.code, "invalid_input");

        let result = overview(
            &state,
            &[character_grant()],
            ReadDekiChatsArgs {
                chat_ids: None,
                character_id: None,
                modes: None,
                limit: None,
                offset: None,
            },
        )
        .expect("approved overview should read");
        assert_eq!(result["matchingTotal"], json!(1));
        assert_eq!(result["items"][0]["id"], json!("chat-rina"));
        let serialized = serde_json::to_string(&result).expect("serialize overview");
        assert!(!serialized.contains("hello rina"));
        assert!(!serialized.contains("secret prompt"));
    }

    #[test]
    fn message_reads_are_bounded_to_the_approved_chat_scope() {
        let state = test_state("messages");
        seed_chats(&state);
        let grants = vec![character_grant()];

        let result = messages(
            &state,
            &grants,
            ReadDekiChatMessagesArgs {
                chat_id: "chat-rina".to_string(),
                limit: Some(50),
                before: None,
            },
        )
        .expect("approved chat messages should read");
        assert_eq!(result["limit"], json!(5));
        assert_eq!(result["messages"][0]["content"], json!("hello rina"));
        assert!(result["messages"][0].get("extra").is_none());

        let error = messages(
            &state,
            &grants,
            ReadDekiChatMessagesArgs {
                chat_id: "chat-other".to_string(),
                limit: None,
                before: None,
            },
        )
        .expect_err("unapproved chat should reject");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn exact_chat_authorization_is_reusable_for_scoped_private_data() {
        let state = test_state("exact-chat-authorization");
        seed_chats(&state);
        let grants = vec![character_grant()];

        assert_eq!(
            ensure_chat_allowed(&state, &grants, "  chat-rina  ")
                .expect("covered chat should authorize"),
            "chat-rina"
        );
        assert!(ensure_chat_allowed(&state, &grants, "chat-other").is_err());
        assert!(ensure_chat_allowed(&state, &[], "chat-rina").is_err());
    }

    #[test]
    fn prompt_context_injects_only_approved_bounded_message_content() {
        let state = test_state("prompt-context");
        seed_chats(&state);

        let context = prompt_context(&state, &[character_grant()])
            .expect("approved prompt context should build");

        assert!(context.contains("Server-injected approved chat context"));
        assert!(context.contains("chat-rina"));
        assert!(context.contains("hello rina"));
        assert!(!context.contains("unapproved"));
        assert!(!context.contains("secret prompt"));
    }

    #[test]
    fn character_name_only_grants_resolve_matching_character_chats() {
        let state = test_state("name-only");
        seed_chats(&state);
        let grants = vec![DekiChatAccessGrant {
            id: "grant-name".to_string(),
            action_message_id: "message-action".to_string(),
            scope: DekiChatAccessScope::Character {
                character_id: None,
                character_name: Some("rina".to_string()),
            },
            window: DekiChatAccessWindow {
                message_count: Some(5),
            },
            granted_at: "2026-06-01T10:00:00.000Z".to_string(),
            expires_at: None,
        }];

        let result = overview(
            &state,
            &grants,
            ReadDekiChatsArgs {
                chat_ids: None,
                character_id: None,
                modes: None,
                limit: None,
                offset: None,
            },
        )
        .expect("name-only character grant should read matching chats");

        assert_eq!(result["matchingTotal"], json!(1));
        assert_eq!(result["items"][0]["id"], json!("chat-rina"));
    }

    #[test]
    fn latest_character_grants_only_resolve_the_newest_matching_chat() {
        let state = test_state("latest-character");
        seed_chats(&state);
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-rina-new",
                    "name": "Rina RP newer",
                    "mode": "roleplay",
                    "characterIds": ["char-rina"],
                    "createdAt": "2026-06-02T10:00:00.000Z",
                    "updatedAt": "2026-06-02T10:02:00.000Z"
                }),
            )
            .expect("seed newer chat");
        let grants = vec![DekiChatAccessGrant {
            id: "grant-latest".to_string(),
            action_message_id: "message-action".to_string(),
            scope: DekiChatAccessScope::LatestCharacter {
                character_id: Some("char-rina".to_string()),
                character_name: Some("Rina".to_string()),
            },
            window: DekiChatAccessWindow {
                message_count: None,
            },
            granted_at: "2026-06-01T10:00:00.000Z".to_string(),
            expires_at: None,
        }];

        let result = overview(
            &state,
            &grants,
            ReadDekiChatsArgs {
                chat_ids: None,
                character_id: None,
                modes: None,
                limit: None,
                offset: None,
            },
        )
        .expect("latest character grant should read one matching chat");

        assert_eq!(result["matchingTotal"], json!(1));
        assert_eq!(result["items"][0]["id"], json!("chat-rina-new"));
        assert_eq!(
            window_limit_for_chat(&state, &grants, "chat-rina-new")
                .expect("window limit should resolve"),
            CHAT_MESSAGES_MAX_LIMIT
        );
        let error = messages(
            &state,
            &grants,
            ReadDekiChatMessagesArgs {
                chat_id: "chat-rina".to_string(),
                limit: None,
                before: None,
            },
        )
        .expect_err("older matching chat should not be covered by latest-character grant");
        assert_eq!(error.code, "invalid_input");
    }
}
