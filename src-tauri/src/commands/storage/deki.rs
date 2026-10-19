use super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::path::PathBuf;

#[path = "deki/action_parser.rs"]
mod action_parser;
#[path = "deki/approvals.rs"]
mod approvals;
#[path = "deki/automation.rs"]
mod automation;
#[path = "deki/budget.rs"]
mod budget;
#[path = "deki/chat_access.rs"]
mod chat_access;
#[path = "deki/loop.rs"]
mod command_loop;
#[path = "deki/commands/mod.rs"]
mod commands;
#[path = "deki/data_cli.rs"]
mod data_cli;
#[path = "deki/events.rs"]
mod events;
#[path = "deki/library.rs"]
mod library;
#[path = "deki/memory_access.rs"]
mod memory_access;
#[path = "deki/memory_edit.rs"]
mod memory_edit;
#[path = "deki/model_client.rs"]
mod model_client;
#[path = "deki/prompt.rs"]
mod prompt;
#[path = "deki/protocol.rs"]
mod protocol;
#[path = "deki/source_edit.rs"]
mod source_edit;
#[path = "deki/status.rs"]
mod status;

pub(crate) use events::DekiEventSink;
pub(crate) use status::DekiRuntimeOwner;

use self::commands::web::DekiWebResearchGrant;

const DEKI_INITIAL_MAX_TOKENS: u64 = 8192;
const DEKI_POST_TOOL_MAX_TOKENS: u64 = 8192;
const DEKI_REPO_ROOT_ENV: &str = "DE_KOI_REPO_ROOT";
const LEGACY_DEKI_REPO_ROOT_ENV: &str = "MARINARA_REPO_ROOT";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DekiPromptRequest {
    session_id: String,
    user_message: String,
    #[serde(default)]
    messages: Vec<DekiPromptMessage>,
    #[serde(default)]
    compacted_summary: Option<String>,
    #[serde(default)]
    connection_id: Option<String>,
    #[serde(default)]
    persona: Option<DekiPersonaContext>,
    #[serde(default)]
    attachments: Vec<DekiAttachment>,
    #[serde(default)]
    chat_access_grants: Vec<chat_access::DekiChatAccessGrant>,
    #[serde(default)]
    web_research_grants: Vec<DekiWebResearchGrant>,
}

#[derive(Debug, Deserialize)]
struct DekiPromptMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DekiPersonaContext {
    name: Option<String>,
    comment: Option<String>,
    description: Option<String>,
    personality: Option<String>,
    scenario: Option<String>,
    backstory: Option<String>,
    appearance: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DekiAttachment {
    name: String,
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    size: u64,
    content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DekiTokenUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    cached_prompt_tokens: Option<u64>,
    cache_write_prompt_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

fn deki_usage_count(value: Option<&Value>) -> Option<u64> {
    value.and_then(Value::as_u64)
}

fn deki_first_usage_count(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| deki_usage_count(value.get(key)))
}

fn deki_nested_usage_count(value: &Value, parent_keys: &[&str], keys: &[&str]) -> Option<u64> {
    parent_keys.iter().find_map(|parent| {
        value
            .get(parent)
            .and_then(|nested| deki_first_usage_count(nested, keys))
    })
}

fn normalize_deki_token_usage(value: &Value) -> DekiTokenUsage {
    let prompt_tokens = deki_first_usage_count(
        value,
        &[
            "promptTokens",
            "prompt_tokens",
            "inputTokens",
            "input_tokens",
            "promptTokenCount",
        ],
    );
    let completion_tokens = deki_first_usage_count(
        value,
        &[
            "completionTokens",
            "completion_tokens",
            "outputTokens",
            "output_tokens",
            "candidatesTokenCount",
        ],
    );
    let cached_prompt_tokens = deki_first_usage_count(
        value,
        &[
            "cachedPromptTokens",
            "cached_prompt_tokens",
            "cacheReadInputTokens",
            "cache_read_input_tokens",
            "cachedContentTokenCount",
        ],
    )
    .or_else(|| {
        deki_nested_usage_count(
            value,
            &[
                "promptTokensDetails",
                "prompt_tokens_details",
                "inputTokensDetails",
                "input_tokens_details",
            ],
            &["cachedTokens", "cached_tokens"],
        )
    });
    let cache_write_prompt_tokens = deki_first_usage_count(
        value,
        &[
            "cacheWritePromptTokens",
            "cache_write_prompt_tokens",
            "cacheCreationInputTokens",
            "cache_creation_input_tokens",
        ],
    );
    let total_tokens =
        deki_first_usage_count(value, &["totalTokens", "total_tokens", "totalTokenCount"]).or_else(
            || {
                prompt_tokens
                    .zip(completion_tokens)
                    .and_then(|(prompt, completion)| prompt.checked_add(completion))
            },
        );
    DekiTokenUsage {
        prompt_tokens,
        completion_tokens,
        cached_prompt_tokens,
        cache_write_prompt_tokens,
        total_tokens,
    }
}

fn sum_complete_deki_usage(values: &[Option<u64>]) -> Option<u64> {
    if values.is_empty() || values.iter().any(Option::is_none) {
        return None;
    }
    values
        .iter()
        .copied()
        .flatten()
        .try_fold(0_u64, u64::checked_add)
}

fn aggregate_deki_token_usage(values: &[Value]) -> DekiTokenUsage {
    let normalized = values
        .iter()
        .map(normalize_deki_token_usage)
        .collect::<Vec<_>>();
    DekiTokenUsage {
        prompt_tokens: sum_complete_deki_usage(
            &normalized
                .iter()
                .map(|usage| usage.prompt_tokens)
                .collect::<Vec<_>>(),
        ),
        completion_tokens: sum_complete_deki_usage(
            &normalized
                .iter()
                .map(|usage| usage.completion_tokens)
                .collect::<Vec<_>>(),
        ),
        cached_prompt_tokens: sum_complete_deki_usage(
            &normalized
                .iter()
                .map(|usage| usage.cached_prompt_tokens)
                .collect::<Vec<_>>(),
        ),
        cache_write_prompt_tokens: sum_complete_deki_usage(
            &normalized
                .iter()
                .map(|usage| usage.cache_write_prompt_tokens)
                .collect::<Vec<_>>(),
        ),
        total_tokens: sum_complete_deki_usage(
            &normalized
                .iter()
                .map(|usage| usage.total_tokens)
                .collect::<Vec<_>>(),
        ),
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ReadDekiLibraryArgs {
    #[serde(default, alias = "item_type", alias = "type")]
    item_type: Option<String>,
    #[serde(default)]
    types: Option<String>,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
}

fn parse_deki_library_types(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or("")
        .split([',', ';', '\n'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ReadDekiLibraryItemsArgs {
    #[serde(alias = "item_type", alias = "type")]
    item_type: String,
    id: String,
    #[serde(default, alias = "include_entries")]
    include_entries: Option<bool>,
    #[serde(default, alias = "entry_query")]
    entry_query: Option<String>,
    #[serde(default, alias = "entry_limit")]
    entry_limit: Option<usize>,
    #[serde(default, alias = "entry_offset")]
    entry_offset: Option<usize>,
}

/// The connection's context window in tokens (`maxContext`, a number or a
/// numeric string), when it records one.
fn deki_connection_max_context(connection: &Value) -> Option<u64> {
    match connection.get("maxContext")? {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

pub(crate) async fn deki_prompt(
    state: &AppState,
    body: Value,
    runtime_owner: &DekiRuntimeOwner,
) -> AppResult<Value> {
    deki_prompt_with_events(state, body, runtime_owner, DekiEventSink::none()).await
}

/// Runs one Deki turn and reports live workspace activity to `events`. The
/// returned value is the same final response `deki_prompt` returns.
pub(crate) async fn deki_prompt_with_events(
    state: &AppState,
    body: Value,
    runtime_owner: &DekiRuntimeOwner,
    events: DekiEventSink,
) -> AppResult<Value> {
    let input: DekiPromptRequest = serde_json::from_value(body.clone())
        .map_err(|error| AppError::invalid_input(error.to_string()))?;
    status::validate_runtime_owner(runtime_owner)?;
    let Some(connection_id) = input
        .connection_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return Err(AppError::invalid_input(
            "No connection set for Deki-senpai! Click the \"chains\" icon in the input box to select one.",
        ));
    };
    let connection_value = resolve_llm_connection_for_request(
        state,
        &json!({
            "connectionId": connection_id,
        }),
    )?;
    let connection = llm_connection_from_value(&connection_value)?;
    let system_prompt = prompt::build_system_prompt(input.persona.as_ref());
    let needs_repo_guidance = prompt::looks_like_codebase_question(&input.user_message);
    let repo_guidance = if needs_repo_guidance {
        prompt::repo_guidance_for_prompt().ok()
    } else {
        None
    };
    let approved_chat_context = if input.chat_access_grants.is_empty() {
        None
    } else {
        Some(chat_access::prompt_context(
            state,
            &input.chat_access_grants,
        )?)
    };
    let task_prompt = prompt::build_task_prompt(
        &input,
        repo_guidance.as_deref(),
        approved_chat_context.as_deref(),
    );
    let runtime_guard = status::begin_runtime(runtime_owner, &input.session_id)?;
    let approval_scope = approvals::DekiApprovalScope::new(runtime_owner, &input.session_id)?;
    let task_prompt = match approvals::prompt_context(&approval_scope)? {
        Some(approval_context) => format!("{approval_context}\n\n{task_prompt}"),
        None => task_prompt,
    };
    let response = command_loop::run_json_command_runtime(command_loop::DekiJsonRuntimeInput {
        state,
        approval_scope,
        connection,
        system_prompt,
        task_prompt,
        task_images: prompt::plan_image_attachments(&input.attachments).images,
        requires_repository_evidence: needs_repo_guidance,
        max_context_tokens: deki_connection_max_context(&connection_value),
        chat_access_grants: input.chat_access_grants.clone(),
        web_research_grants: input.web_research_grants.clone(),
        cancellation: runtime_guard.cancellation(),
        events,
    })
    .await?;
    let (content, action) = action_parser::deki_response_content_and_action(&response.content)?;
    if content.trim().is_empty() {
        return Err(AppError::new(
            "deki_empty_response",
            "Deki-senpai returned an empty response. Try again or select a different connection.",
        ));
    }
    let usage = if response.usage.is_empty() {
        None
    } else {
        Some(aggregate_deki_token_usage(&response.usage))
    };
    Ok(json!({
        "content": content,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "action": action,
        "usage": usage,
        "workspaceTrace": response.workspace_trace,
        "pendingApprovals": response.pending_approvals,
        "incomplete": response.incomplete.map(command_loop::DekiFinalReason::code),
    }))
}

pub(crate) async fn deki_workspace_status(
    state: &AppState,
    runtime_owner: &DekiRuntimeOwner,
    session_id: String,
    connection_id: Option<String>,
) -> AppResult<Value> {
    status::deki_workspace_status(state, runtime_owner, session_id, connection_id).await
}

pub(crate) async fn deki_workspace_abort(
    state: &AppState,
    runtime_owner: &DekiRuntimeOwner,
    session_id: String,
) -> AppResult<Value> {
    status::deki_workspace_abort(state, runtime_owner, session_id).await
}

pub(crate) async fn deki_workspace_approve(
    state: &AppState,
    runtime_owner: &DekiRuntimeOwner,
    session_id: String,
    id: String,
) -> AppResult<Value> {
    // The approval holds an exclusive storage section while it re-checks and
    // writes, so it runs on a blocking thread rather than an async worker.
    let state = state.clone();
    let runtime_owner = runtime_owner.clone();
    tokio::task::spawn_blocking(move || {
        approvals::approve(&state, &runtime_owner, &session_id, &id)
    })
    .await
    .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

pub(crate) async fn deki_workspace_reject(
    _state: &AppState,
    runtime_owner: &DekiRuntimeOwner,
    session_id: String,
    id: String,
) -> AppResult<Value> {
    approvals::reject(runtime_owner, &session_id, &id)
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
fn deki_repo_root() -> AppResult<PathBuf> {
    if let Some((env_name, root)) = configured_deki_repo_root() {
        return validate_deki_repo_root(root, env_name);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let Some(root) = manifest_dir.parent() else {
        return Err(AppError::new(
            "deki_repo_root_unavailable",
            "Could not resolve De-Koi repository root",
        ));
    };
    validate_deki_repo_root(root.to_path_buf(), "Cargo manifest parent")
}

fn configured_deki_repo_root() -> Option<(&'static str, PathBuf)> {
    configured_path(DEKI_REPO_ROOT_ENV)
        .map(|root| (DEKI_REPO_ROOT_ENV, root))
        .or_else(|| {
            configured_path(LEGACY_DEKI_REPO_ROOT_ENV).map(|root| (LEGACY_DEKI_REPO_ROOT_ENV, root))
        })
}

fn configured_path(env_name: &str) -> Option<PathBuf> {
    let value = env::var(env_name).ok()?;
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| PathBuf::from(trimmed))
}

fn validate_deki_repo_root(root: PathBuf, source: &str) -> AppResult<PathBuf> {
    let root = root.canonicalize().map_err(|error| {
        AppError::new(
            "deki_repo_root_unavailable",
            format!("Could not resolve De-Koi repository root from {source}: {error}"),
        )
    })?;
    if root.join("AGENTS.md").is_file() && root.join("package.json").is_file() {
        Ok(root)
    } else {
        Err(AppError::new(
            "deki_repo_root_unavailable",
            format!(
                "Deki-senpai could not find AGENTS.md and package.json at the De-Koi repository root from {source}: {}",
                root.display()
            ),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::action_parser::deki_response_content_and_action;
    use super::*;

    #[test]
    fn deki_usage_aggregates_two_provider_turns() {
        let usage = aggregate_deki_token_usage(&[
            json!({
                "prompt_tokens": 10,
                "completion_tokens": 4,
                "prompt_tokens_details": { "cached_tokens": 3 },
                "cache_creation_input_tokens": 2,
                "total_tokens": 14,
            }),
            json!({
                "inputTokens": 8,
                "outputTokens": 2,
                "cacheReadInputTokens": 1,
                "cacheCreationInputTokens": 5,
            }),
        ]);

        assert_eq!(
            serde_json::to_value(usage).unwrap(),
            json!({
                "promptTokens": 18,
                "completionTokens": 6,
                "cachedPromptTokens": 4,
            "cacheWritePromptTokens": 7,
                "totalTokens": 24,
            })
        );
    }

    #[test]
    fn deki_usage_normalizes_google_gemini_metadata() {
        let usage = normalize_deki_token_usage(&json!({
            "promptTokenCount": 10,
            "candidatesTokenCount": 4,
            "cachedContentTokenCount": 3,
            "totalTokenCount": 14,
        }));

        assert_eq!(
            serde_json::to_value(usage).unwrap(),
            json!({
                "promptTokens": 10,
                "completionTokens": 4,
                "cachedPromptTokens": 3,
                "cacheWritePromptTokens": null,
                "totalTokens": 14,
            })
        );
    }

    #[test]
    fn deki_usage_derivation_rejects_total_overflow() {
        let usage = normalize_deki_token_usage(&json!({
            "promptTokens": u64::MAX,
            "completionTokens": 1,
        }));

        assert_eq!(usage.total_tokens, None);
    }

    #[test]
    fn deki_library_tool_args_accept_schema_field_names() {
        let overview_args: ReadDekiLibraryArgs = serde_json::from_value(json!({
            "item_type": "character",
            "types": "character,lorebook"
        }))
        .expect("overview schema field args");
        assert_eq!(overview_args.item_type.as_deref(), Some("character"));
        assert_eq!(
            parse_deki_library_types(overview_args.types.as_deref()),
            vec!["character".to_string(), "lorebook".to_string()]
        );

        let detail_args: ReadDekiLibraryItemsArgs = serde_json::from_value(json!({
            "item_type": "lorebook",
            "id": "book-1",
            "include_entries": true,
            "entry_query": "makima",
            "entry_limit": 5,
            "entry_offset": 2
        }))
        .expect("detail schema field args");
        assert_eq!(detail_args.item_type, "lorebook");
        assert_eq!(detail_args.id, "book-1");
        assert_eq!(detail_args.include_entries, Some(true));
        assert_eq!(detail_args.entry_query.as_deref(), Some("makima"));
        assert_eq!(detail_args.entry_limit, Some(5));
        assert_eq!(detail_args.entry_offset, Some(2));
    }

    #[test]
    fn deki_library_type_list_accepts_mixed_separators() {
        assert_eq!(
            parse_deki_library_types(Some("character, lorebook; prompt_preset\npersona")),
            vec![
                "character".to_string(),
                "lorebook".to_string(),
                "prompt_preset".to_string(),
                "persona".to_string()
            ]
        );
    }

    fn test_state(name: &str) -> AppState {
        let path = std::env::temp_dir().join(format!(
            "de-koi-deki-{name}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    #[tokio::test]
    async fn deki_workspace_status_reflects_requested_connection() {
        let state = test_state("workspace-status-connection");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "conn-1",
                    "name": "Workspace Test",
                    "provider": "openai",
                    "model": "gpt-4.1",
                    "apiKey": "",
                }),
            )
            .expect("connection should be saved");

        let status = deki_workspace_status(
            &state,
            &DekiRuntimeOwner::Embedded,
            "workspace-status-session".to_string(),
            Some("conn-1".to_string()),
        )
        .await
        .expect("workspace status should return");

        assert_eq!(status["enabled"], json!(true));
        assert_eq!(status["connection"]["id"], json!("conn-1"));
        assert_eq!(status["connection"]["name"], json!("Workspace Test"));
        assert_eq!(status["connection"]["provider"], json!("openai"));
        assert_eq!(status["connection"]["model"], json!("gpt-4.1"));
        assert_eq!(status["active"], json!(false));
        assert_eq!(status["error"], Value::Null);
        assert!(status["tools"]
            .as_array()
            .unwrap()
            .contains(&json!("read_deki_memories")));
    }

    #[tokio::test]
    async fn deki_workspace_abort_reports_not_running() {
        let state = test_state("workspace-abort-not-running");

        let result = deki_workspace_abort(
            &state,
            &DekiRuntimeOwner::Embedded,
            "workspace-abort-session".to_string(),
        )
        .await
        .expect("workspace abort should return");

        assert_eq!(result["status"], json!("not_running"));
        assert_eq!(result["aborted"], json!(false));
        assert_eq!(result["active"], json!(false));
        assert!(result["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("not running"));
    }

    #[test]
    fn deki_response_extracts_pending_create_action_without_visible_json() {
        let raw = r#"I drafted Sol for approval.

<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler","personality":"Bright","scenario":"Roadside inn","backstory":"Raised by caravan cooks.","appearance":"Sun-faded cloak and quick hands."},"label":"Create Sol","rationale":"Matches the user's brief."}</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw).expect("action should parse");

        assert_eq!(content, "I drafted Sol for approval.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["name"], "Sol");
        assert!(!content.contains("deki_action"));
    }

    #[test]
    fn deki_response_rejects_incomplete_persona_create_action() {
        let raw = r#"I drafted Sol for approval.

<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler","personality":"Bright","scenario":"Roadside inn"},"label":"Create Sol","rationale":"Matches the user's brief."}</deki_action>"#;

        let error = deki_response_content_and_action(raw)
            .expect_err("new persona cards should require backstory and appearance");

        assert_eq!(error.code, "deki_action_invalid");
        assert!(error.message.contains("backstory"));
        assert!(error.message.contains("appearance"));
    }

    #[test]
    fn deki_response_rejects_invented_persona_create_fields() {
        let raw = r#"I drafted Sol for approval.

<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler","personality":"Bright","scenario":"Roadside inn","backstory":"Raised by caravan cooks.","appearance":"Sun-faded cloak and quick hands.","quirks":"Collects blue glass."},"label":"Create Sol","rationale":"Matches the user's brief."}</deki_action>"#;

        let error = deki_response_content_and_action(raw)
            .expect_err("persona cards should reject invented template fields");

        assert_eq!(error.code, "deki_action_invalid");
        assert!(error.message.contains("quirks"));
    }

    #[test]
    fn deki_response_rejects_incomplete_character_create_action() {
        let raw = r#"I drafted Mira for approval.

<deki_action>{"type":"create_record","entity":"characters","draft":{"data":{"name":"Mira","description":"Archivist","personality":"Careful","scenario":"A locked library","first_mes":"*Mira looks up.*","mes_example":"<START>\n{{user}}: Hello\n{{char}}: Shh.","creator_notes":"A mystery card.","system_prompt":"Roleplay Mira.","post_history_instructions":"","tags":["mystery"],"extensions":{"backstory":"Raised in the stacks."}}},"label":"Create Mira","rationale":"Matches the user's brief."}</deki_action>"#;

        let error = deki_response_content_and_action(raw)
            .expect_err("new character cards should require appearance");

        assert_eq!(error.code, "deki_action_invalid");
        assert!(error.message.contains("appearance"));
    }

    #[test]
    fn deki_response_normalizes_character_edit_card_fields_into_data_patch() {
        let raw = r#"I drafted Rook's scenario update for approval.

<deki_action>{"type":"edit_record","entity":"characters","id":"character-rook","patch":{"scenario":"Rook now guards the chapel after the midnight bargain."},"label":"Update Rook scenario"}</deki_action>"#;

        let (_content, action) =
            deki_response_content_and_action(raw).expect("character scenario edit should parse");

        assert_eq!(action["type"], "edit_record");
        assert_eq!(action["entity"], "characters");
        assert_eq!(action["id"], "character-rook");
        assert_eq!(
            action["patch"]["data"]["scenario"],
            "Rook now guards the chapel after the midnight bargain."
        );
        assert!(action["patch"].get("scenario").is_none());
    }

    #[test]
    fn deki_response_repairs_raw_newlines_inside_action_strings() {
        let raw = "I drafted Sol for approval.\n\n<deki_action>{\"type\":\"create_record\",\"entity\":\"personas\",\"draft\":{\"name\":\"Sol\",\"description\":\"Line one
Line two\",\"personality\":\"Bright\",\"scenario\":\"Roadside inn\",\"backstory\":\"Raised by caravan cooks.\",\"appearance\":\"Sun-faded cloak and quick hands.\"},\"label\":\"Create Sol\",\"rationale\":\"Matches the user's brief.\"}</deki_action>";

        let (content, action) = deki_response_content_and_action(raw)
            .expect("action strings with raw newlines should parse");

        assert_eq!(content, "I drafted Sol for approval.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["description"], "Line one\nLine two");
    }
    #[test]
    fn deki_response_repairs_unescaped_quotes_inside_action_strings() {
        let raw = r#"I drafted Sol for approval.

<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"She says "go deeper" before acting.","personality":"Bright","scenario":"Roadside inn","backstory":"Raised by caravan cooks.","appearance":"Sun-faded cloak and quick hands."},"label":"Create Sol","rationale":"Matches the user's brief."}</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw)
            .expect("action strings with raw quotes should parse");

        assert_eq!(content, "I drafted Sol for approval.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(
            action["draft"]["description"],
            "She says \"go deeper\" before acting."
        );
    }

    #[test]
    fn deki_response_preserves_visible_content_when_action_json_is_incomplete() {
        let raw = r#"I drafted Sol for approval.

<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler"}</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw)
            .expect("visible content should survive an incomplete action block");

        assert_eq!(content, "I drafted Sol for approval.");
        assert_eq!(action["type"], "none");
        assert_eq!(action["capability"], "read_only");
        assert!(action["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("approval action could not be parsed"));
    }

    #[test]
    fn deki_response_extracts_action_from_fenced_json_block() {
        let raw = r#"Draft ready.
<deki_action>```json
{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler","personality":"Bright","scenario":"Roadside inn","backstory":"Raised by caravan cooks.","appearance":"Sun-faded cloak and quick hands."}}
```</deki_action>"#;

        let (content, action) =
            deki_response_content_and_action(raw).expect("fenced action should parse");

        assert_eq!(content, "Draft ready.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["name"], "Sol");
    }

    #[test]
    fn deki_response_accepts_chat_access_request_action() {
        let raw = r#"I need permission to read the relevant roleplay chats.
<deki_action>{"type":"request_chat_access","scope":{"type":"character","characterId":"char-rina","characterName":"Rina"},"window":{"messageCount":25},"label":"Read Rina chats","rationale":"Compare the character card against prior roleplay behavior."}</deki_action>"#;

        let (content, action) =
            deki_response_content_and_action(raw).expect("chat access action should parse");

        assert_eq!(
            content,
            "I need permission to read the relevant roleplay chats."
        );
        assert_eq!(action["type"], "request_chat_access");
        assert_eq!(action["scope"]["type"], "character");
        assert_eq!(action["scope"]["characterId"], "char-rina");
        assert_eq!(action["window"]["messageCount"], json!(25));
    }

    #[test]
    fn deki_response_normalizes_null_chat_access_window_to_maximum() {
        let raw = r#"I need permission to read the relevant roleplay chats.
<deki_action>{"type":"request_chat_access","scope":{"type":"character","characterId":"char-rina","characterName":"Rina"},"window":{"messageCount":null},"label":"Read Rina chats"}</deki_action>"#;

        let (_content, action) =
            deki_response_content_and_action(raw).expect("chat access action should parse");

        assert_eq!(
            action["window"]["messageCount"],
            json!(action_parser::DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT)
        );
    }

    #[test]
    fn deki_response_extracts_lorebook_redraft_action_without_visible_json() {
        let raw = r#"I drafted the whole lorebook for approval.

<deki_action>{"type":"apply_lorebook_redraft","id":"lorebook-1","lorebook":{"name":"Ravenloft Gazetteer","description":"A rewritten gothic setting guide."},"entries":[{"id":"entry-1","name":"Castle Ravenloft","content":"A hungry silhouette above the valley."},{"name":"Barovia","content":"Mist, hunger, and old roads."}],"label":"Apply Ravenloft redraft","rationale":"One review for the whole lorebook."}</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw).expect("action should parse");

        assert_eq!(content, "I drafted the whole lorebook for approval.");
        assert_eq!(action["type"], "apply_lorebook_redraft");
        assert_eq!(action["id"], "lorebook-1");
        assert_eq!(action["lorebook"]["name"], "Ravenloft Gazetteer");
        assert_eq!(action["entries"][0]["id"], "entry-1");
        assert_eq!(action["entries"][1]["name"], "Barovia");
        assert_eq!(action["label"], "Apply Ravenloft redraft");
        assert!(!content.contains("deki_action"));
    }
    #[test]
    fn deki_response_extracts_web_research_request_action() {
        let raw = r#"I should check current sources first.

<deki_action>{"type":"request_web_research","scope":{"type":"query","query":"Ghostface Dead by Daylight lore personality","allowedDomains":["deadbydaylight.fandom.com"]},"reason":"Verify card characterization against current wiki sources.","sources":["Dead by Daylight Wiki"],"label":"Check Ghostface sources"}</deki_action>"#;

        let (content, action) =
            deki_response_content_and_action(raw).expect("web action should parse");

        assert_eq!(content, "I should check current sources first.");
        assert_eq!(action["type"], "request_web_research");
        assert_eq!(action["scope"]["type"], "query");
        assert_eq!(
            action["scope"]["query"],
            "Ghostface Dead by Daylight lore personality"
        );
        assert_eq!(
            action["scope"]["allowedDomains"][0],
            "deadbydaylight.fandom.com"
        );
        assert_eq!(
            action["reason"],
            "Verify card characterization against current wiki sources."
        );
    }

    #[test]
    fn deki_response_accepts_character_name_only_chat_access_request() {
        let raw = r#"I need permission to read the relevant Makima chats.
<deki_action>{"type":"request_chat_access","scope":{"type":"character","characterName":"Makima"},"window":{"messageCount":50},"label":"Read Makima chats"}</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw)
            .expect("name-only chat access action should parse");

        assert_eq!(
            content,
            "I need permission to read the relevant Makima chats."
        );
        assert_eq!(action["type"], "request_chat_access");
        assert_eq!(action["scope"]["type"], "character");
        assert!(action["scope"].get("characterId").is_none());
        assert_eq!(action["scope"]["characterName"], "Makima");
    }

    #[test]
    fn deki_response_extracts_action_when_hidden_block_has_trailing_text() {
        let raw = r#"Draft ready.
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler","personality":"Bright","scenario":"Roadside inn","backstory":"Raised by caravan cooks.","appearance":"Sun-faded cloak and quick hands."}} This draft creates the requested persona.</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw)
            .expect("action with hidden trailing text should parse");

        assert_eq!(content, "Draft ready.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["name"], "Sol");
    }

    #[test]
    fn deki_response_rejects_multiple_action_blocks() {
        let raw = r#"Draft ready.
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler","personality":"Bright","scenario":"Roadside inn","backstory":"Raised by caravan cooks.","appearance":"Sun-faded cloak and quick hands."}}</deki_action>
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Luna"}}</deki_action>"#;

        let error =
            deki_response_content_and_action(raw).expect_err("duplicate actions should fail");

        assert_eq!(error.code, "deki_action_invalid");
    }

    #[test]
    fn deki_response_preserves_visible_text_after_action_block() {
        let raw = r#"Draft ready.
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler","personality":"Bright","scenario":"Roadside inn","backstory":"Raised by caravan cooks.","appearance":"Sun-faded cloak and quick hands."}}</deki_action>
Extra visible text."#;

        let (content, action) =
            deki_response_content_and_action(raw).expect("trailing visible text should parse");

        assert_eq!(content, "Draft ready.\n\nExtra visible text.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
    }

    #[test]
    fn deki_prompt_lists_approved_web_research_grants() {
        let prompt = prompt::build_task_prompt(
            &DekiPromptRequest {
                session_id: "test-session".to_string(),
                user_message: "Can you check Ghostface?".to_string(),
                messages: Vec::new(),
                compacted_summary: None,
                connection_id: Some("connection".to_string()),
                persona: None,
                attachments: Vec::new(),
                chat_access_grants: Vec::new(),
                web_research_grants: vec![commands::web::DekiWebResearchGrant {
                    id: "grant-1".to_string(),
                    action_message_id: "message-1".to_string(),
                    scope: commands::web::DekiWebResearchScope {
                        scope_type: "query".to_string(),
                        query: "Ghostface Dead by Daylight lore personality".to_string(),
                        allowed_domains: vec!["deadbydaylight.fandom.com".to_string()],
                    },
                    granted_at: "2026-06-28T12:00:00Z".to_string(),
                    expires_at: None,
                }],
            },
            None,
            None,
        );

        assert!(prompt.contains("Approved web research grants"));
        assert!(prompt.contains("Ghostface Dead by Daylight lore personality"));
        assert!(prompt.contains("deadbydaylight.fandom.com"));
    }

    #[test]
    fn deki_json_runtime_sends_image_attachments_as_images_not_prompt_text() {
        let image = |name: &str, content: String, size: u64| DekiAttachment {
            name: name.to_string(),
            r#type: "image/png".to_string(),
            size,
            content,
        };
        let ok = format!("data:image/png;base64,{}", "A".repeat(4096));
        let too_large = format!("data:image/png;base64,{}", "A".repeat(8 * 1024 * 1024));
        let mut attachments = vec![
            image("screenshot.png", ok.clone(), 3072),
            image("huge.png", too_large, 6 * 1024 * 1024),
            image("skipped-by-browser.png", String::new(), 9 * 1024 * 1024),
            image("broken.png", "not a data url".to_string(), 10),
        ];
        attachments
            .extend((0..4).map(|index| image(&format!("extra-{index}.png"), ok.clone(), 3072)));
        let input = DekiPromptRequest {
            session_id: "test-session".to_string(),
            user_message: "What does this show?".to_string(),
            messages: Vec::new(),
            compacted_summary: None,
            connection_id: Some("connection".to_string()),
            persona: None,
            attachments,
            chat_access_grants: Vec::new(),
            web_research_grants: Vec::new(),
        };

        let plan = prompt::plan_image_attachments(&input.attachments);
        assert_eq!(plan.images.len(), 4, "four images per message at most");
        assert_eq!(plan.images[0], ok);

        let text = prompt::build_task_prompt(&input, None, None);
        assert!(
            !text.contains(&ok),
            "image data never enters the prompt text"
        );
        assert!(text.contains("screenshot.png"));
        assert!(text.contains("Image sent with this message"));
        assert!(text.contains(
            "huge.png\nType: image/png\nSize: 6291456\nContent:\n[Image not sent: image is larger than 5 MB.]"
        ));
        assert!(text.contains(
            "skipped-by-browser.png\nType: image/png\nSize: 9437184\nContent:\n[Image not sent: image is larger than 5 MB.]"
        ));
        assert!(text.contains("[Image not sent: the image could not be read.]"));
        assert!(text.contains("[Image not sent: Deki-senpai takes up to 4 images per message.]"));
    }

    #[test]
    fn deki_prompt_truncates_large_text_attachments() {
        let marker = "tail-that-should-not-enter-context";
        let content = format!("{}{}", "safe text\n".repeat(20_000), marker);
        let prompt = prompt_with_attachment(DekiAttachment {
            name: "debug.log".to_string(),
            r#type: "text/plain".to_string(),
            size: content.len() as u64,
            content,
        });

        assert!(prompt.contains("debug.log"));
        assert!(prompt.contains("Attachment truncated"));
        assert!(!prompt.contains(marker));
    }

    #[test]
    fn deki_prompt_bounds_attachment_metadata() {
        let marker = "metadata-tail-that-should-not-enter-context";
        let attachments = (0..(prompt::DEKI_ATTACHMENT_MAX_COUNT + 8))
            .map(|index| DekiAttachment {
                name: format!("{}-{marker}-{index}.txt", "name".repeat(100)),
                r#type: format!("text/plain;{}", "charset=utf-8;".repeat(40)),
                size: 0,
                content: String::new(),
            })
            .collect::<Vec<_>>();

        let prompt = prompt_with_attachments(attachments);

        assert!(!prompt.contains(marker));
        assert!(prompt.matches("File:").count() <= prompt::DEKI_ATTACHMENT_MAX_COUNT);
        assert!(prompt.contains("additional attachment(s) omitted"));
    }

    #[test]
    fn deki_system_prompt_documents_scoped_memory_access() {
        let prompt = prompt::build_system_prompt(None);

        assert!(prompt.contains("read_deki_memories"));
        assert!(prompt.contains("edit_memory"));
        assert!(prompt.contains("approved chat access"));
    }

    fn prompt_with_attachments(attachments: Vec<DekiAttachment>) -> String {
        prompt::build_task_prompt(
            &DekiPromptRequest {
                session_id: "test-session".to_string(),
                user_message: "Please inspect this attachment.".to_string(),
                messages: Vec::new(),
                compacted_summary: None,
                connection_id: Some("connection".to_string()),
                persona: None,
                attachments,
                chat_access_grants: Vec::new(),
                web_research_grants: Vec::new(),
            },
            None,
            None,
        )
    }

    fn prompt_with_attachment(attachment: DekiAttachment) -> String {
        prompt_with_attachments(vec![attachment])
    }
}
