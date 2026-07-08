use super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::env;
use std::path::PathBuf;

use self::action_parser::deki_response_content_and_action;
use self::prompt::{
    build_system_prompt, build_task_prompt, looks_like_codebase_question, repo_guidance_for_prompt,
};

// Slice 2 runtime shape: docs/deki-json-command-runtime-architecture.md and
// docs/uml/Refactor/deki-json-command-runtime-target.puml.
#[path = "deki/action_parser.rs"]
mod action_parser;
#[path = "deki/budget.rs"]
mod budget;
#[path = "deki/chat_access.rs"]
mod chat_access;
#[path = "deki/loop.rs"]
mod command_loop;
#[path = "deki/commands/mod.rs"]
mod commands;
#[path = "deki/library.rs"]
mod library;
#[path = "deki/model_client.rs"]
mod model_client;
#[path = "deki/prompt.rs"]
mod prompt;
#[path = "deki/protocol.rs"]
mod protocol;
#[path = "deki/status.rs"]
mod status;

const DEKI_INITIAL_MAX_TOKENS: u64 = 8192;
const DEKI_POST_TOOL_MAX_TOKENS: u64 = 8192;
const DEKI_REPO_ROOT_ENV: &str = "DE_KOI_REPO_ROOT";
const LEGACY_DEKI_REPO_ROOT_ENV: &str = "MARINARA_REPO_ROOT";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DekiPromptRequest {
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
    web_research_grants: Vec<commands::web::DekiWebResearchGrant>,
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

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

pub(crate) async fn deki_prompt(state: &AppState, body: Value) -> AppResult<Value> {
    let input: DekiPromptRequest = serde_json::from_value(body.clone())
        .map_err(|error| AppError::invalid_input(error.to_string()))?;
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
    let system_prompt = build_system_prompt(input.persona.as_ref());
    let repo_guidance = if looks_like_codebase_question(&input.user_message) {
        repo_guidance_for_prompt().ok()
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
    let task_prompt = build_task_prompt(
        &input,
        repo_guidance.as_deref(),
        approved_chat_context.as_deref(),
    );
    let response = command_loop::run_json_command_runtime(command_loop::DekiJsonRuntimeInput {
        state,
        connection,
        system_prompt,
        task_prompt,
        chat_access_grants: input.chat_access_grants.clone(),
        web_research_grants: input.web_research_grants.clone(),
    })
    .await?;

    let (content, action) = deki_response_content_and_action(&response.content)?;
    if content.trim().is_empty() {
        return Err(AppError::new(
            "deki_empty_response",
            "Deki-senpai returned an empty response. Try again or select a different connection.",
        ));
    }

    let mut output = json!({
        "content": content,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "action": action,
    });
    if !response.workspace_trace.is_empty() {
        output["workspaceTrace"] = json!(response.workspace_trace);
    }
    Ok(output)
}

pub(crate) async fn deki_workspace_status(
    state: &AppState,
    connection_id: Option<String>,
) -> AppResult<Value> {
    status::deki_workspace_status(state, connection_id).await
}

pub(crate) async fn deki_workspace_abort(state: &AppState) -> AppResult<Value> {
    status::deki_workspace_abort(state).await
}

pub(crate) async fn deki_workspace_approve(state: &AppState, id: String) -> AppResult<Value> {
    status::deki_workspace_approve(state, id).await
}

pub(crate) async fn deki_workspace_reject(state: &AppState, id: String) -> AppResult<Value> {
    status::deki_workspace_reject(state, id).await
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
    use super::action_parser::{
        deki_response_content_and_action, DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT,
    };
    use super::commands::web::{
        deki_fandom_api_url_for_page, deki_web_grant_for_query, deki_web_page_client,
        deki_web_page_url_for_grant, deki_web_results_or_parse_error, deki_web_search_url,
        extract_deki_fandom_page_text, extract_deki_mediawiki_page_text,
        extract_deki_web_page_text, extract_deki_web_results, read_deki_web_page,
        DekiWebResearchGrant, DekiWebResearchScope, ReadDekiWebPageArgs,
    };
    use super::prompt::{
        build_system_prompt, build_task_prompt, looks_like_chat_context_question,
        DEKI_ATTACHMENT_MAX_COUNT,
    };
    use super::*;
    use std::fs;

    static DEKI_REPO_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn deki_library_command_args_accept_schema_field_names() {
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

    fn unique_test_repo_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "de-koi-{name}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).expect("create test repo root");
        fs::write(root.join("AGENTS.md"), "# Test guidance\n").expect("write AGENTS.md");
        fs::write(root.join("package.json"), "{}\n").expect("write package.json");
        root
    }

    fn test_state(name: &str) -> AppState {
        let path = std::env::temp_dir().join(format!(
            "de-koi-deki-{name}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    #[test]
    fn deki_repo_root_prefers_configured_de_koi_repo_root() {
        let _guard = DEKI_REPO_ENV_LOCK.lock().expect("lock repo env");
        let previous_de_koi = std::env::var_os("DE_KOI_REPO_ROOT");
        let previous_marinara = std::env::var_os("MARINARA_REPO_ROOT");
        let root = unique_test_repo_root("configured-root");
        let expected = root.canonicalize().expect("canonical test repo root");

        std::env::set_var("DE_KOI_REPO_ROOT", &root);
        std::env::remove_var("MARINARA_REPO_ROOT");
        let resolved = deki_repo_root();

        match previous_de_koi {
            Some(value) => std::env::set_var("DE_KOI_REPO_ROOT", value),
            None => std::env::remove_var("DE_KOI_REPO_ROOT"),
        }
        match previous_marinara {
            Some(value) => std::env::set_var("MARINARA_REPO_ROOT", value),
            None => std::env::remove_var("MARINARA_REPO_ROOT"),
        }
        fs::remove_dir_all(&root).ok();

        assert_eq!(resolved.expect("resolve configured repo root"), expected);
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

        let status = deki_workspace_status(&state, Some("conn-1".to_string()))
            .await
            .expect("workspace status should return");

        assert_eq!(status["enabled"], json!(true));
        assert_eq!(status["connection"]["id"], json!("conn-1"));
        assert_eq!(status["connection"]["name"], json!("Workspace Test"));
        assert_eq!(status["connection"]["provider"], json!("openai"));
        assert_eq!(status["connection"]["model"], json!("gpt-4.1"));
        assert!(status["error"].is_null());
    }

    #[tokio::test]
    async fn deki_workspace_abort_reports_not_running() {
        let state = test_state("workspace-abort-not-running");

        let result = deki_workspace_abort(&state)
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
    fn deki_system_prompt_prefers_whole_lorebook_redraft_actions() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("whole lorebook"));
        assert!(prompt.contains("one approval card"));
        assert!(prompt.contains("apply_lorebook_redraft"));
        assert!(prompt.contains("lorebook-entries approval actions"));
    }
    #[test]
    fn deki_system_prompt_blocks_assistant_label_leakage_in_character_card_examples() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("character-card"));
        assert!(prompt.contains("example dialogue"));
        assert!(prompt.contains("Deki-senpai"));
        assert!(prompt.contains("must never become a speaker name"));
    }

    #[test]
    fn deki_system_prompt_preserves_literal_character_placeholders() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("literal artifact placeholders"));
        assert!(prompt.contains("preserve {{char}} and {{user}} exactly"));
        assert!(prompt.contains("never replace them with Deki-senpai"));
    }

    #[test]
    fn deki_system_prompt_limits_default_lorebook_entry_draft_length() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("lorebook entry content"));
        assert!(prompt.contains("100-180 words"));
        assert!(prompt.contains("split larger lore"));
        assert!(prompt.contains("explicitly asks"));
    }

    #[test]
    fn deki_system_prompt_requires_creative_library_quality_audits() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("creative-library quality audit"));
        assert!(prompt.contains("read_deki_library"));
        assert!(prompt.contains("~3,200 estimated tokens"));
        assert!(prompt.contains("shallow characterization"));
        assert!(prompt.contains("generic archetype"));
        assert!(prompt.contains("repetition"));
    }

    #[test]
    fn deki_system_prompt_prefers_positive_character_corrections() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("phrase the correction as what they are"));
        assert!(prompt.contains("instead of what they are not"));
    }

    #[test]
    fn deki_system_prompt_discourages_repeated_trait_corrections() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("place each corrected trait in the single best-fit field"));
        assert!(prompt.contains("Do not repeat the same trait label"));
        assert!(prompt.contains("replace duplicated trait labels"));
    }

    #[test]
    fn deki_system_prompt_requires_exact_character_and_persona_card_fields() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("Character/persona card field contract"));
        assert!(prompt.contains("backstory and appearance are required"));
        assert!(prompt.contains("Do not invent separate fields"));
        assert!(prompt.contains("quirks"));
        assert!(prompt.contains("typing style"));
    }
    #[test]
    fn deki_system_prompt_requires_self_review_and_source_backed_depth() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains(
            "Before emitting a create_record, edit_record, or apply_lorebook_redraft action"
        ));
        assert!(prompt.contains("self-review the proposed additions"));
        assert!(prompt.contains("would push the card over"));
        assert!(prompt.contains("request web research"));
        assert!(prompt.contains("gold nuggets"));
    }

    #[test]
    fn deki_system_prompt_explains_web_search_provider_failures() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("search_deki_web fails"));
        assert!(prompt.contains("provider did not return usable search results"));
        assert!(prompt.contains("do not fabricate sources"));
    }

    #[test]
    fn deki_system_prompt_tells_web_research_to_read_source_pages() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("read_deki_web_page"));
        assert!(prompt.contains("inspect the most relevant result pages"));
        assert!(prompt.contains("before proposing creative-library edits"));
    }

    #[test]
    fn deki_system_prompt_proactively_requests_web_research_for_source_accuracy() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("proactively request web research"));
        assert!(prompt.contains("would benefit from current external facts"));
        assert!(prompt.contains("source-backed accuracy"));
        assert!(prompt.contains("canon"));
    }

    #[test]
    fn deki_system_prompt_requires_visible_lorebook_entry_review_before_approval() {
        let prompt = build_system_prompt(None);

        assert!(prompt.contains("lorebook-entry create_record or edit_record approvals"));
        assert!(prompt.contains("show the entry name"));
        assert!(prompt.contains("full proposed content in your visible answer"));
        assert!(prompt.contains("before the hidden action block"));
    }

    #[test]
    fn deki_interaction_based_library_prompt_requests_chat_access_before_library_routing() {
        let input = DekiPromptRequest {
            user_message: "Suggest changes to this character based on my interactions with her."
                .to_string(),
            messages: Vec::new(),
            compacted_summary: None,
            connection_id: Some("connection".to_string()),
            persona: None,
            attachments: Vec::new(),
            chat_access_grants: Vec::new(),
            web_research_grants: Vec::new(),
        };
        let task_prompt = build_task_prompt(&input, None, None);

        assert!(task_prompt.contains("Chat context assessment"));
        assert!(task_prompt.contains("must request scoped chat access"));
        assert!(looks_like_chat_context_question(&input.user_message));
    }

    #[test]
    fn deki_interaction_based_prompt_uses_chat_context_snapshot_after_grant() {
        let input = DekiPromptRequest {
            user_message: "Suggest changes to this character based on my interactions with her."
                .to_string(),
            messages: Vec::new(),
            compacted_summary: None,
            connection_id: Some("connection".to_string()),
            persona: None,
            attachments: Vec::new(),
            chat_access_grants: vec![chat_access::DekiChatAccessGrant {
                id: "grant-1".to_string(),
                action_message_id: "message-1".to_string(),
                scope: chat_access::DekiChatAccessScope::Mode {
                    modes: vec!["roleplay".to_string()],
                },
                window: chat_access::DekiChatAccessWindow {
                    message_count: Some(50),
                },
                granted_at: "2026-06-27T10:00:00.000Z".to_string(),
                expires_at: None,
            }],
            web_research_grants: Vec::new(),
        };
        let task_prompt = build_task_prompt(
            &input,
            None,
            Some("Server-approved excerpt: Rina mentioned liking piano at dusk."),
        );

        assert!(task_prompt.contains("Granted chat continuation"));
        assert!(task_prompt.contains("Do not greet the user"));
        assert!(task_prompt.contains("Approved chat context snapshot"));
        assert!(task_prompt.contains("Rina mentioned liking piano"));
    }

    #[test]
    fn deki_resume_prompt_uses_chat_context_snapshot_after_grant() {
        let input = DekiPromptRequest {
            user_message: [
                "The user approved the requested scoped chat access.",
                "Resume the original task now using the approved chat context.",
                "Do not greet the user, ask what to work on, or repeat the access request.",
                "Original user request:",
                "Can you update Makima's character card with her music tastes, extrapolating from my interactions with her?",
            ]
            .join("\n"),
            messages: Vec::new(),
            compacted_summary: None,
            connection_id: Some("connection".to_string()),
            persona: None,
            attachments: Vec::new(),
            chat_access_grants: vec![chat_access::DekiChatAccessGrant {
                id: "grant-1".to_string(),
                action_message_id: "message-1".to_string(),
                scope: chat_access::DekiChatAccessScope::Character {
                    character_id: None,
                    character_name: Some("Makima".to_string()),
                },
                window: chat_access::DekiChatAccessWindow {
                    message_count: Some(50),
                },
                granted_at: "2026-06-27T10:00:00.000Z".to_string(),
                expires_at: None,
            }],
            web_research_grants: Vec::new(),
        };
        let task_prompt = build_task_prompt(
            &input,
            None,
            Some("Server-approved excerpt: Makima discussed calm orchestral music."),
        );

        assert!(task_prompt.contains("Approved chat context snapshot"));
        assert!(task_prompt.contains("Makima discussed calm orchestral music"));
    }

    #[test]
    fn deki_plain_response_returns_no_pending_action_contract() {
        let (content, action) =
            deki_response_content_and_action("Plain answer.").expect("plain response should parse");

        assert_eq!(content, "Plain answer.");
        assert_eq!(action["type"], "none");
        assert_eq!(action["capability"], "read_only");
        assert!(action["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("no pending UI approval action"));
        assert!(!action["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("source edits"));
    }

    #[test]
    fn deki_none_action_normalizes_to_no_pending_action_contract() {
        let raw = r#"No change needed.<deki_action>{"type":"none"}</deki_action>"#;

        let (content, action) =
            deki_response_content_and_action(raw).expect("none action should parse");

        assert_eq!(content, "No change needed.");
        assert_eq!(action["type"], "none");
        assert!(action["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("no pending UI approval action"));
        assert!(!action["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("source edits"));
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
            json!(DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT)
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
    fn deki_web_search_url_uses_brave_endpoint() {
        let url =
            deki_web_search_url("Ghostface Dead by Daylight").expect("search URL should build");

        assert_eq!(url.domain(), Some("search.brave.com"));
        assert_eq!(url.path(), "/search");
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "q")
                .map(|(_, value)| value.into_owned()),
            Some("Ghostface Dead by Daylight".to_string())
        );
    }

    #[test]
    fn deki_web_result_parser_handles_brave_result_blocks() {
        let html = r#"
            <div class="snippet svelte-jmfu5f" data-pos="0" data-type="web" data-keynav="true">
              <div class="result-content svelte-1rq4ngz">
                <a href="https://deadbydaylight.fandom.com/wiki/Danny_Johnson_alias_Jed_Olsen" target="_self" class="svelte-14r20fy l1">
                  <div class="title search-snippet-title line-clamp-1 svelte-14r20fy" title="Danny Johnson - The Ghost Face - Official Dead by Daylight Wiki">Danny Johnson - The Ghost Face - Official Dead by Daylight Wiki</div>
                </a>
                <div class="generic-snippet svelte-1cwdgg3">
                  <div class="content desktop-default-regular t-primary line-clamp-dynamic svelte-1cwdgg3"><span class="t-secondary">5 days ago -</span> His personal Perks, I&amp;#x27;m All Ears, Thrilling Tremors, and Furtive Chase, make his chases unpredictable.</div>
                </div>
              </div>
            </div>
        "#;

        let results = extract_deki_web_results(html, 4);

        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0]["title"],
            "Danny Johnson - The Ghost Face - Official Dead by Daylight Wiki"
        );
        assert_eq!(
            results[0]["url"],
            "https://deadbydaylight.fandom.com/wiki/Danny_Johnson_alias_Jed_Olsen"
        );
        assert_eq!(
            results[0]["snippet"],
            "5 days ago - His personal Perks, I'm All Ears, Thrilling Tremors, and Furtive Chase, make his chases unpredictable."
        );
    }

    #[test]
    fn deki_web_result_parser_rejects_markerless_response_body() {
        let html = "<html><body>Please wait while we process your request.</body></html>";

        let error = deki_web_results_or_parse_error(html, "Ghostface Dead by Daylight", 4)
            .expect_err("markerless search pages should not look successful");

        assert_eq!(error.code, "deki_web_search_no_results");
    }

    #[test]
    fn deki_web_result_parser_handles_duckduckgo_redirects_and_single_quoted_attrs() {
        let html = r#"
            <div class='result'>
              <a rel='nofollow' class='result__a' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeadbydaylight.fandom.com%2Fwiki%2FDanny_Johnson&amp;rut=abc'>Ghost Face &amp; Danny <b>Johnson</b></a>
              <span class='result__snippet'>A stealth-focused Killer also known as <b>The Ghost Face</b>.</span>
            </div>
        "#;

        let results = extract_deki_web_results(html, 4);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["title"], "Ghost Face & Danny Johnson");
        assert_eq!(
            results[0]["url"],
            "https://deadbydaylight.fandom.com/wiki/Danny_Johnson"
        );
        assert_eq!(
            results[0]["snippet"],
            "A stealth-focused Killer also known as The Ghost Face."
        );
    }

    #[test]
    fn deki_web_page_client_does_not_follow_redirects() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind redirect server");
        let address = listener.local_addr().expect("read listener address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept redirect request");
            let mut buffer = [0u8; 1024];
            let _ = std::io::Read::read(&mut stream, &mut buffer);
            std::io::Write::write_all(
                &mut stream,
                b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .expect("write redirect response");
        });

        let response = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build test runtime")
            .block_on(async {
                deki_web_page_client()
                    .expect("page client should build")
                    .get(format!("http://{address}/redirect"))
                    .send()
                    .await
            })
            .expect("request should return redirect response without following it");
        server.join().expect("redirect server should finish");

        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
    }

    #[test]
    fn deki_web_page_read_rejects_without_matching_grant() {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build test runtime")
            .block_on(read_deki_web_page(
                ReadDekiWebPageArgs {
                    query: "Ghostface Dead by Daylight lore personality".to_string(),
                    url: "https://deadbydaylight.fandom.com/wiki/Danny_Johnson_alias_Jed_Olsen"
                        .to_string(),
                },
                &[],
            ));

        let error = result.expect_err("page reads should require a matching grant");

        assert!(error.message.contains("matching web research query"));
    }

    #[test]
    fn deki_fandom_api_url_uses_mediawiki_extract_endpoint() {
        let page_url = reqwest::Url::parse(
            "https://deadbydaylight.fandom.com/wiki/Danny_Johnson_alias_Jed_Olsen",
        )
        .expect("page URL should parse");

        let api_url = deki_fandom_api_url_for_page(&page_url).expect("fandom API URL should build");

        assert_eq!(api_url.domain(), Some("deadbydaylight.fandom.com"));
        assert_eq!(api_url.path(), "/api.php");
        assert!(api_url.as_str().contains("prop=extracts"));
        assert!(api_url
            .as_str()
            .contains("titles=Danny_Johnson_alias_Jed_Olsen"));
    }

    #[test]
    fn deki_mediawiki_extract_parser_reads_page_extract() {
        let json = r#"{"query":{"pages":{"12531":{"title":"Danny Johnson alias Jed Olsen","extract":"Danny Johnson or \"The Ghost Face\" is a Killer.\nHis personal Perks include I\u0027m All Ears."}}}}"#;

        let text = extract_deki_mediawiki_page_text(json, 400).expect("extract should parse");

        assert!(text.contains("Danny Johnson alias Jed Olsen"));
        assert!(text.contains("The Ghost Face"));
        assert!(text.contains("I'm All Ears"));
    }

    #[test]
    fn deki_fandom_page_text_falls_back_to_html_when_extract_is_missing() {
        let json = r#"{"query":{"pages":{"12531":{"title":"Pierrot","extract":""}}}}"#;
        let html = r#"
            <html>
              <head><title>Pierrot | Freak Circus Wiki</title></head>
              <body>
                <h1>Pierrot</h1>
                <p>Pierrot enjoys music boxes, card tricks, and tending to the circus props.</p>
              </body>
            </html>
        "#;

        let text = extract_deki_fandom_page_text(json, html, 400)
            .expect("Fandom HTML should be readable when the API extract is empty");

        assert!(text.contains("Pierrot | Freak Circus Wiki"));
        assert!(text.contains("music boxes"));
        assert!(text.contains("card tricks"));
    }

    #[test]
    fn deki_web_page_url_requires_matching_approved_domain() {
        let grant = DekiWebResearchGrant {
            id: "grant-1".to_string(),
            action_message_id: "message-1".to_string(),
            scope: DekiWebResearchScope {
                scope_type: "query".to_string(),
                query: "Ghostface Dead by Daylight lore personality".to_string(),
                allowed_domains: vec!["deadbydaylight.fandom.com".to_string()],
            },
            granted_at: "2026-06-28T12:00:00Z".to_string(),
            expires_at: None,
        };

        let allowed = deki_web_page_url_for_grant(
            "https://deadbydaylight.fandom.com/wiki/Danny_Johnson_alias_Jed_Olsen",
            &grant,
        )
        .expect("matching approved domain should be readable");
        let rejected = deki_web_page_url_for_grant("https://example.com/wiki/Danny", &grant)
            .expect_err("unapproved domain should be rejected");
        let local = deki_web_page_url_for_grant("http://127.0.0.1:8080/private", &grant)
            .expect_err("local network URL should be rejected");

        assert_eq!(allowed.domain(), Some("deadbydaylight.fandom.com"));
        assert_eq!(rejected.code, "deki_web_page_domain_not_allowed");
        assert_eq!(local.code, "deki_web_page_url_not_public");
    }

    #[test]
    fn deki_web_page_text_extraction_removes_scripts_and_markup() {
        let html = r#"
            <html>
              <head><title>Danny Johnson - The Ghost Face</title><style>.hidden{display:none}</style></head>
              <body>
                <script>window.secret = "ignore me";</script>
                <h1>Danny Johnson</h1>
                <p>His personal Perks, I&amp;#x27;m All Ears and Thrilling Tremors, reveal his stalking playstyle.</p>
              </body>
            </html>
        "#;

        let text = extract_deki_web_page_text(html, 400);

        assert!(text.contains("Danny Johnson - The Ghost Face"));
        assert!(text.contains("Danny Johnson"));
        assert!(text.contains("I'm All Ears"));
        assert!(!text.contains("window.secret"));
        assert!(!text.contains("hidden"));
        assert!(!text.contains("<p>"));
    }

    #[test]
    fn deki_web_grant_matches_only_exact_normalized_query() {
        let grant = DekiWebResearchGrant {
            id: "grant-1".to_string(),
            action_message_id: "message-1".to_string(),
            scope: DekiWebResearchScope {
                scope_type: "query".to_string(),
                query: "Ghostface Dead by Daylight lore personality".to_string(),
                allowed_domains: vec!["deadbydaylight.fandom.com".to_string()],
            },
            granted_at: "2026-06-28T12:00:00Z".to_string(),
            expires_at: None,
        };
        let grants = vec![grant];

        assert!(deki_web_grant_for_query(
            "  ghostface   dead by daylight lore personality  ",
            &grants
        )
        .is_some());
        assert!(deki_web_grant_for_query("Ghostface build guide", &grants).is_none());
    }

    #[test]
    fn deki_prompt_lists_approved_web_research_grants() {
        let prompt = build_task_prompt(
            &DekiPromptRequest {
                user_message: "Can you check Ghostface?".to_string(),
                messages: Vec::new(),
                compacted_summary: None,
                connection_id: Some("connection".to_string()),
                persona: None,
                attachments: Vec::new(),
                chat_access_grants: Vec::new(),
                web_research_grants: vec![DekiWebResearchGrant {
                    id: "grant-1".to_string(),
                    action_message_id: "message-1".to_string(),
                    scope: DekiWebResearchScope {
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
    fn deki_response_preserves_visible_content_for_malformed_action_json() {
        let raw =
            r#"Draft ready.<deki_action>{"type":"create_record","entity":"personas"</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw)
            .expect("visible content should survive malformed action JSON");

        assert_eq!(content, "Draft ready.");
        assert_eq!(action["type"], "none");
        assert!(action["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("approval action could not be parsed"));
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
    fn deki_response_rejects_unknown_action_entity() {
        let raw = r#"Draft ready.<deki_action>{"type":"create_record","entity":"messages","draft":{}}</deki_action>"#;

        let error = deki_response_content_and_action(raw).expect_err("unknown entity should fail");

        assert_eq!(error.code, "deki_action_invalid");
    }

    fn prompt_with_attachment(attachment: DekiAttachment) -> String {
        prompt_with_attachments(vec![attachment])
    }

    fn prompt_with_attachments(attachments: Vec<DekiAttachment>) -> String {
        build_task_prompt(
            &DekiPromptRequest {
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

    #[test]
    fn deki_prompt_omits_raw_image_attachment_data_urls() {
        let raw_data_url = format!("data:image/png;base64,{}", "A".repeat(4096));
        let prompt = prompt_with_attachment(DekiAttachment {
            name: "screenshot.png".to_string(),
            r#type: "image/png".to_string(),
            size: 4096,
            content: raw_data_url.clone(),
        });

        assert!(!prompt.contains(&raw_data_url));
        assert!(prompt.contains("screenshot.png"));
        assert!(prompt.contains("omitted"));
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
        let attachments = (0..(DEKI_ATTACHMENT_MAX_COUNT + 8))
            .map(|index| DekiAttachment {
                name: format!("{}-{marker}-{index}.txt", "name".repeat(100)),
                r#type: format!("text/plain;{}", "charset=utf-8;".repeat(40)),
                size: 0,
                content: String::new(),
            })
            .collect::<Vec<_>>();

        let prompt = prompt_with_attachments(attachments);

        assert!(!prompt.contains(marker));
        assert!(prompt.matches("File:").count() <= DEKI_ATTACHMENT_MAX_COUNT);
        assert!(prompt.contains("additional attachment(s) omitted"));
    }
}
