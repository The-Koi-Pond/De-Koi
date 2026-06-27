use super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use super::shared;
use crate::state::AppState;
use autoagents::async_trait;
use autoagents::core::agent::memory::SlidingWindowMemory;
use autoagents::core::agent::prebuilt::executor::ReActAgent;
use autoagents::core::agent::task::Task;
use autoagents::core::agent::{AgentBuilder, DirectAgent};
use autoagents::core::tool::{ToolCallError, ToolRuntime};
use autoagents::llm::chat::{
    ChatMessage, ChatProvider, ChatResponse, ChatRole, MessageType, StructuredOutputFormat, Tool,
};
use autoagents::llm::completion::{CompletionProvider, CompletionRequest, CompletionResponse};
use autoagents::llm::embedding::EmbeddingProvider;
use autoagents::llm::error::LLMError;
use autoagents::llm::models::{ModelListRequest, ModelListResponse, ModelsProvider};
use autoagents::llm::{FunctionCall, LLMProvider, ToolCall};
use autoagents::prelude::{AgentHooks, ToolInput, ToolInputT, ToolT, agent, tool};
use marinara_core::{AppError, AppResult, now_iso};
use marinara_security::{assert_inside_dir, assert_relative_safe_path};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::env;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[path = "deki/library.rs"]
mod library;

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

const CODE_SEARCH_SKIP_DIRS: &[&str] = &[
    ".codex",
    ".git",
    ".next",
    ".pnpm-store",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
];
const CODE_SEARCH_SKIP_PATH_PREFIXES: &[&str] = &["packages/server/data", "src-tauri/gen"];
const CODE_SEARCH_ALLOWED_EXTENSIONS: &[&str] = &[
    "css", "html", "js", "jsx", "json", "md", "rs", "toml", "ts", "tsx", "yml", "yaml",
];
const CODE_SEARCH_MAX_FILE_BYTES: u64 = 512 * 1024;
const CODE_READ_MAX_FILE_BYTES: u64 = 96 * 1024;
const CODE_EDIT_MAX_FILE_BYTES: u64 = 512 * 1024;
const CODE_EDIT_MAX_TEXT_BYTES: usize = 256 * 1024;
const DEKI_ATTACHMENT_MAX_COUNT: usize = 24;
const DEKI_ATTACHMENT_MAX_CHARS: usize = 24 * 1024;
const DEKI_ATTACHMENT_MAX_NAME_CHARS: usize = 160;
const DEKI_ATTACHMENT_MAX_TYPE_CHARS: usize = 120;
const DEKI_ATTACHMENT_TOTAL_MAX_CHARS: usize = 48 * 1024;
const DEKI_TEXT_ATTACHMENT_EXTENSIONS: &[&str] = &[
    "csv", "json", "jsonl", "log", "md", "markdown", "txt", "xml", "yaml", "yml",
];
const DEKI_INITIAL_MAX_TOKENS: u64 = 2048;
const DEKI_POST_TOOL_MAX_TOKENS: u64 = 8192;
const DEKI_REPO_ROOT_ENV: &str = "DE_KOI_REPO_ROOT";
const LEGACY_DEKI_REPO_ROOT_ENV: &str = "MARINARA_REPO_ROOT";
const DEKI_WORKSPACE_TOOLS: &[&str] = &["read", "grep", "find", "ls", "deki_data", "deki_code"];

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

#[derive(Clone, Debug)]
struct DekiLlmProvider {
    connection: marinara_llm::LlmConnection,
}

#[derive(Debug)]
struct DekiChatResponse {
    content: String,
    tool_calls: Vec<ToolCall>,
}

impl fmt::Display for DekiChatResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.content)
    }
}

impl ChatResponse for DekiChatResponse {
    fn text(&self) -> Option<String> {
        Some(self.content.clone())
    }

    fn tool_calls(&self) -> Option<Vec<ToolCall>> {
        Some(self.tool_calls.clone())
    }
}

#[async_trait]
impl ChatProvider for DekiLlmProvider {
    async fn chat_with_tools(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[Tool]>,
        _json_schema: Option<StructuredOutputFormat>,
    ) -> Result<Box<dyn ChatResponse>, LLMError> {
        let request = marinara_llm::LlmRequest {
            connection: self.connection.clone(),
            messages: messages
                .iter()
                .map(autoagents_message_to_marinara)
                .collect(),
            parameters: deki_request_parameters(
                &self.connection,
                messages,
                tools.unwrap_or_default(),
            ),
            tools: tools
                .unwrap_or_default()
                .iter()
                .map(|tool| serde_json::to_value(&tool.function).unwrap_or_else(|_| json!({})))
                .collect(),
        };
        let response = marinara_llm::complete_rich(request)
            .await
            .map_err(|error| LLMError::ProviderError(error.to_string()))?;
        Ok(Box::new(DekiChatResponse {
            content: response.content,
            tool_calls: response
                .tool_calls
                .into_iter()
                .filter_map(marinara_tool_call_to_autoagents)
                .collect(),
        }))
    }
}

fn deki_request_parameters(
    connection: &marinara_llm::LlmConnection,
    messages: &[ChatMessage],
    tools: &[Tool],
) -> Value {
    let has_tool_result = messages
        .iter()
        .any(|message| matches!(message.message_type, MessageType::ToolResult(_)));
    let max_tokens = if has_tool_result {
        DEKI_POST_TOOL_MAX_TOKENS
    } else {
        DEKI_INITIAL_MAX_TOKENS
    };
    let mut parameters = json!({
                "temperature": 0.4,
                "maxTokens": max_tokens,
    });
    let latest_user = messages
        .iter()
        .rev()
        .find(|message| matches!(message.role, ChatRole::User))
        .map(|message| message.content.as_str())
        .unwrap_or_default();
    if !tools.is_empty() && !has_tool_result && looks_like_codebase_question(latest_user) {
        parameters["toolChoice"] = deki_forced_tool_choice(connection, "search_deki_code");
    } else if !tools.is_empty() && !has_tool_result && looks_like_library_question(latest_user) {
        parameters["toolChoice"] = deki_forced_tool_choice(connection, "read_deki_library");
    }
    parameters
}

fn deki_forced_tool_choice(connection: &marinara_llm::LlmConnection, tool_name: &str) -> Value {
    if connection.provider == "custom" {
        return json!("required");
    }
    json!({
        "type": "function",
        "function": { "name": tool_name }
    })
}

#[async_trait]
impl CompletionProvider for DekiLlmProvider {
    async fn complete(
        &self,
        request: &CompletionRequest,
        _json_schema: Option<StructuredOutputFormat>,
    ) -> Result<CompletionResponse, LLMError> {
        let response = self
            .chat(
                &[ChatMessage {
                    role: ChatRole::User,
                    message_type: MessageType::Text,
                    content: request.prompt.clone(),
                }],
                None,
            )
            .await?;
        Ok(CompletionResponse {
            text: response.text().unwrap_or_default(),
        })
    }
}

#[async_trait]
impl EmbeddingProvider for DekiLlmProvider {
    async fn embed(&self, _input: Vec<String>) -> Result<Vec<Vec<f32>>, LLMError> {
        Err(LLMError::ProviderError(
            "Deki-senpai does not expose embeddings in v1".to_string(),
        ))
    }
}

#[async_trait]
impl ModelsProvider for DekiLlmProvider {
    async fn list_models(
        &self,
        _request: Option<&ModelListRequest>,
    ) -> Result<Box<dyn ModelListResponse>, LLMError> {
        Err(LLMError::ProviderError(
            "Deki-senpai model listing is owned by De-Koi connections".to_string(),
        ))
    }
}

impl LLMProvider for DekiLlmProvider {}

#[derive(Serialize, Deserialize, ToolInput, Debug)]
#[serde(rename_all = "camelCase")]
struct ReadDekiLibraryArgs {
    #[input(
        description = "Optional library item type to list, such as character, persona, lorebook, lorebook_entry, prompt_preset, prompt_section, prompt_group, or prompt_variable."
    )]
    #[serde(default, alias = "item_type", alias = "type")]
    item_type: Option<String>,
    #[input(
        description = "Optional comma-separated library item types to list. Use this instead of type when multiple kinds are needed."
    )]
    #[serde(default)]
    types: Option<String>,
    #[input(
        description = "Optional case-insensitive text search over documented user-facing fields for each library item type."
    )]
    #[serde(default)]
    query: Option<String>,
    #[input(
        description = "Maximum overview rows to return. Defaults to 80 and is capped by De-Koi."
    )]
    #[serde(default)]
    limit: Option<usize>,
    #[input(description = "Zero-based pagination offset for overview rows.")]
    #[serde(default)]
    offset: Option<usize>,
}

#[tool(
    name = "read_deki_library",
    description = "List Deki-senpai's creative library as a lightweight overview. Returns ids, names, subtitles/comments, grouping fields, and stats for characters, personas, lorebooks, prompt presets, sections, groups, and variables. It does not return full record bodies. Use read_deki_library_items after this when exact selected records are needed. This tool never returns chats, messages, memories, integrations, API keys, or connection secrets.",
    input = ReadDekiLibraryArgs,
)]
struct ReadDekiLibraryTool {
    state: AppState,
}

#[async_trait]
impl ToolRuntime for ReadDekiLibraryTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: ReadDekiLibraryArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_library_read_invalid_args", error))?;
        library::overview(
            &self.state,
            library::LibraryOverviewQuery {
                item_type: args.item_type,
                types: parse_deki_library_types(args.types.as_deref()),
                query: args.query,
                limit: args.limit,
                offset: args.offset,
            },
        )
        .map_err(|error| deki_tool_error("deki_library_read_failed", error))
    }
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

#[derive(Serialize, Deserialize, ToolInput, Debug)]
#[serde(rename_all = "camelCase")]
struct ReadDekiLibraryItemsArgs {
    #[input(
        description = "Library item type, such as character, persona, lorebook, lorebook_entry, prompt_preset, prompt_section, prompt_group, or prompt_variable."
    )]
    #[serde(alias = "item_type", alias = "type")]
    item_type: String,
    #[input(description = "Exact record id to read.")]
    id: String,
    #[input(
        description = "For lorebook selections only. Entries are included by default; omit this or set it to true. False is rejected to avoid returning partial detail records."
    )]
    #[serde(default, alias = "include_entries")]
    include_entries: Option<bool>,
    #[input(
        description = "For lorebook entry expansion, optional case-insensitive search over entry id, name, comment, keys, and content."
    )]
    #[serde(default, alias = "entry_query")]
    entry_query: Option<String>,
    #[input(
        description = "For lorebook entry expansion, maximum entries to return. Defaults to 50 and is capped by De-Koi."
    )]
    #[serde(default, alias = "entry_limit")]
    entry_limit: Option<usize>,
    #[input(description = "For lorebook entry expansion, zero-based entry pagination offset.")]
    #[serde(default, alias = "entry_offset")]
    entry_offset: Option<usize>,
}

#[tool(
    name = "read_deki_library_items",
    description = "Read full content for one explicit selected creative-library record after using read_deki_library to identify its id. Supports selected characters, personas, lorebooks, lorebook entries, prompt presets, prompt sections, prompt groups, and prompt variables. Call this tool again for more selected records. Lorebook entries are included by default and paginated through entryQuery, entryLimit, and entryOffset; includeEntries false is rejected.",
    input = ReadDekiLibraryItemsArgs,
)]
struct ReadDekiLibraryItemsTool {
    state: AppState,
}

#[async_trait]
impl ToolRuntime for ReadDekiLibraryItemsTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: ReadDekiLibraryItemsArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_library_items_invalid_args", error))?;
        library::items(
            &self.state,
            vec![library::LibraryItemRequest {
                item_type: args.item_type,
                id: args.id,
                include_entries: args.include_entries,
                entry_query: args.entry_query,
                entry_limit: args.entry_limit,
                entry_offset: args.entry_offset,
            }],
        )
        .map_err(|error| deki_tool_error("deki_library_items_failed", error))
    }
}

#[derive(Serialize, Deserialize, ToolInput, Debug)]
struct SearchDekiCodeArgs {
    #[input(description = "Literal text to search for.")]
    query: String,
    #[input(description = "Optional repository-relative file or directory to search.")]
    #[serde(default)]
    path: Option<String>,
    #[input(description = "Optional maximum number of matches to return.")]
    #[serde(default)]
    max_results: Option<usize>,
}

#[tool(
    name = "search_deki_code",
    description = "Search De-Koi source files for a literal text query. Use this before answering questions about how the app works. Search concise symbols, file names, or path fragments from the user's question rather than the whole sentence. For example, search AppShell for a question about where AppShell is defined. The optional path must be relative to the repository, for example src/engine, src/features/shell/deki, src-tauri, or AGENTS.md.",
    input = SearchDekiCodeArgs,
)]
struct SearchDekiCodeTool {}

#[async_trait]
impl ToolRuntime for SearchDekiCodeTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: SearchDekiCodeArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_code_search_invalid_args", error))?;
        search_deki_code(args).map_err(|error| deki_tool_error("deki_code_search_failed", error))
    }
}

#[derive(Serialize, Deserialize, ToolInput, Debug)]
struct ReadDekiCodeFileArgs {
    #[input(description = "Repository-relative path to the UTF-8 source or guidance file.")]
    path: String,
}

#[tool(
    name = "read_deki_code_file",
    description = "Read one UTF-8 De-Koi source or guidance file by repository-relative path. Use this after search_deki_code when exact source context is needed.",
    input = ReadDekiCodeFileArgs,
)]
struct ReadDekiCodeFileTool {}

#[async_trait]
impl ToolRuntime for ReadDekiCodeFileTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: ReadDekiCodeFileArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_code_read_invalid_args", error))?;
        read_deki_code_file(&args.path)
            .map_err(|error| deki_tool_error("deki_code_read_failed", error))
    }
}

#[derive(Serialize, Deserialize, ToolInput, Debug)]
struct EditDekiCodeFileArgs {
    #[input(description = "Repository-relative path to the existing source or guidance file.")]
    path: String,
    #[input(description = "Exact text to replace. It must occur exactly once.")]
    old_text: String,
    #[input(description = "Replacement text.")]
    new_text: String,
}

#[tool(
    name = "edit_deki_code_file",
    description = "Edit one existing De-Koi source or guidance file by replacing an exact old_text with new_text. The path must be repository-relative, old_text must occur exactly once, and destructive broad rewrites are rejected.",
    input = EditDekiCodeFileArgs,
)]
struct EditDekiCodeFileTool {}

#[async_trait]
impl ToolRuntime for EditDekiCodeFileTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: EditDekiCodeFileArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_code_edit_invalid_args", error))?;
        edit_deki_code_file(&args.path, &args.old_text, &args.new_text)
            .map_err(|error| deki_tool_error("deki_code_edit_failed", error))
    }
}

#[derive(Serialize, Deserialize, ToolInput, Debug)]
struct CreateDekiExtensionArgs {
    #[input(description = "Extension display name.")]
    name: String,
    #[input(description = "Short user-facing extension description.")]
    #[serde(default)]
    description: String,
    #[input(description = "Optional CSS payload to inject while the extension is enabled.")]
    #[serde(default)]
    css: Option<String>,
    #[input(description = "Optional JavaScript payload to run while the extension is enabled.")]
    #[serde(default)]
    js: Option<String>,
}

#[tool(
    name = "create_deki_extension",
    description = "Create a user-installed De-Koi extension record with optional CSS and JavaScript. Prefer this for user-facing tweaks before editing application source code.",
    input = CreateDekiExtensionArgs,
)]
struct CreateDekiExtensionTool {
    state: AppState,
}

#[async_trait]
impl ToolRuntime for CreateDekiExtensionTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: CreateDekiExtensionArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_extension_invalid_args", error))?;
        create_deki_extension(&self.state, args)
            .map_err(|error| deki_tool_error("deki_extension_create_failed", error))
    }
}

#[derive(Serialize, Deserialize, ToolInput, Debug)]
struct CreateDekiCustomAgentArgs {
    #[input(description = "Custom agent display name.")]
    name: String,
    #[input(
        description = "Optional custom agent type id. Leave empty to derive one from the name."
    )]
    #[serde(default)]
    agent_type: Option<String>,
    #[input(description = "Short description of what the custom agent does.")]
    #[serde(default)]
    description: String,
    #[input(description = "Pipeline phase: pre_generation, parallel, or post_processing.")]
    #[serde(default = "default_agent_phase")]
    phase: String,
    #[input(description = "System prompt template for the custom agent.")]
    prompt_template: String,
    #[input(description = "Optional result type such as context_injection or text_rewrite.")]
    #[serde(default)]
    result_type: Option<String>,
    #[input(description = "Optional connection id for this agent.")]
    #[serde(default)]
    connection_id: Option<String>,
    #[input(description = "Optional JSON object string for additional agent settings.")]
    #[serde(default)]
    settings_json: Option<String>,
}

#[tool(
    name = "create_deki_custom_agent",
    description = "Create a custom De-Koi agent configuration record. Use this when the user asks Deki-senpai to make an agent for conversation, roleplay, game, writing, tracking, or post-processing behavior.",
    input = CreateDekiCustomAgentArgs,
)]
struct CreateDekiCustomAgentTool {
    state: AppState,
}

#[async_trait]
impl ToolRuntime for CreateDekiCustomAgentTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: CreateDekiCustomAgentArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_agent_invalid_args", error))?;
        create_deki_custom_agent(&self.state, args)
            .map_err(|error| deki_tool_error("deki_agent_create_failed", error))
    }
}

#[agent(
    name = "deki",
    description = "You are Deki-senpai, De-Koi's standalone assistant. You can inspect the app's codebase, read files, apply exact source edits, create extension records, create custom agent records, and inspect the creative library through tools. Use tools for factual answers about De-Koi internals.",
    tools = [
        ReadDekiLibraryTool { state: self.state.clone() },
        ReadDekiLibraryItemsTool { state: self.state.clone() },
        SearchDekiCodeTool {},
        ReadDekiCodeFileTool {},
        EditDekiCodeFileTool {},
        CreateDekiExtensionTool { state: self.state.clone() },
        CreateDekiCustomAgentTool { state: self.state.clone() },
    ],
)]
#[derive(Clone, AgentHooks)]
struct DekiAgent {
    state: AppState,
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
    ensure_connection_supports_native_tools(&connection)?;
    let system_prompt = build_system_prompt(input.persona.as_ref());
    let repo_guidance = if looks_like_codebase_question(&input.user_message) {
        repo_guidance_for_prompt().ok()
    } else {
        None
    };
    let task_prompt = build_task_prompt(&input, repo_guidance.as_deref());
    let provider: Arc<dyn LLMProvider> = Arc::new(DekiLlmProvider { connection });
    let memory = Box::new(SlidingWindowMemory::new(12));
    let agent = ReActAgent::with_max_turns(
        DekiAgent {
            state: state.clone(),
        },
        4,
    );
    let agent_handle = AgentBuilder::<_, DirectAgent>::new(agent)
        .llm(provider)
        .memory(memory)
        .build()
        .await
        .map_err(|error| AppError::new("deki_agent_create_failed", error.to_string()))?;
    let task = Task::new(task_prompt).with_system_prompt(system_prompt);
    let response = agent_handle.agent.run(task).await.map_err(|error| {
        AppError::new(
            "deki_agent_failed",
            tool_call_error_message(&error.to_string()),
        )
    })?;

    let (content, action) = deki_response_content_and_action(&response.to_string())?;
    if content.trim().is_empty() {
        return Err(AppError::new(
            "deki_empty_response",
            "Deki-senpai returned an empty response. Try again or select a different tool-capable connection.",
        ));
    }

    Ok(json!({
        "content": content,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "action": action,
    }))
}

pub(crate) async fn deki_workspace_status(
    state: &AppState,
    connection_id: Option<String>,
) -> AppResult<Value> {
    let workspace = deki_repo_root()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let requested_connection_id = connection_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let (connection, error) = match requested_connection_id {
        Some(connection_id) => match deki_workspace_connection_summary(state, connection_id) {
            Ok(connection) => (
                connection,
                "Deki workspace runtime is not implemented yet for the selected connection."
                    .to_string(),
            ),
            Err(error) => (
                Value::Null,
                format!(
                    "Deki workspace runtime is not implemented yet. Requested connection {connection_id} could not be summarized: {}",
                    error.message
                ),
            ),
        },
        None => (
            Value::Null,
            "Deki workspace runtime is not implemented yet.".to_string(),
        ),
    };
    Ok(json!({
        "enabled": false,
        "workspace": workspace,
        "dataDir": state.data_dir.to_string_lossy(),
        "tools": DEKI_WORKSPACE_TOOLS,
        "dataAccess": "server-managed",
        "connection": connection,
        "active": false,
        "pendingApprovals": [],
        "history": [],
        "error": error,
    }))
}

fn deki_workspace_connection_summary(state: &AppState, connection_id: &str) -> AppResult<Value> {
    let connection_value = resolve_llm_connection_for_request(
        state,
        &json!({
            "connectionId": connection_id,
        }),
    )?;
    let connection = llm_connection_from_value(&connection_value)?;
    let name = connection_value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(connection_id);
    Ok(json!({
        "id": connection_id,
        "name": name,
        "provider": connection.provider,
        "model": connection.model,
    }))
}

pub(crate) async fn deki_workspace_abort(_state: &AppState) -> AppResult<Value> {
    Ok(json!({
        "status": "not_running",
        "aborted": false,
        "active": false,
        "reason": "Deki workspace runtime is not running.",
    }))
}

pub(crate) async fn deki_workspace_approve(_state: &AppState, id: String) -> AppResult<Value> {
    validate_workspace_approval_id(&id)?;
    Err(deki_workspace_not_implemented("approval apply"))
}

pub(crate) async fn deki_workspace_reject(_state: &AppState, id: String) -> AppResult<Value> {
    validate_workspace_approval_id(&id)?;
    Err(deki_workspace_not_implemented("approval reject"))
}

fn validate_workspace_approval_id(id: &str) -> AppResult<()> {
    if id.trim().is_empty() {
        return Err(AppError::invalid_input("Workspace approval id is required"));
    }
    Ok(())
}

fn deki_workspace_not_implemented(action: &str) -> AppError {
    AppError::new(
        "deki_workspace_not_implemented",
        format!("Deki workspace {action} is not implemented yet."),
    )
}

fn deki_no_action_contract() -> Value {
    json!({
        "type": "none",
        "capability": "read_only",
        "reason": "Deki-senpai returned a plain response with no pending UI approval action.",
    })
}

fn deki_response_content_and_action(raw_content: &str) -> AppResult<(String, Value)> {
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
    let action_json = raw_content[after_open..end].trim();
    let parsed = parse_deki_action_json(action_json)?;
    let action = normalize_deki_response_action(parsed)?;
    let content_parts = [raw_content[..start].trim(), trailing]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let content = if content_parts.is_empty() {
        "I drafted a creative-library change for review.".to_string()
    } else {
        content_parts.join("\n\n")
    };
    Ok((content, action))
}

fn parse_deki_action_json(action_json: &str) -> AppResult<Value> {
    match serde_json::from_str::<Value>(action_json) {
        Ok(parsed) => Ok(parsed),
        Err(initial_error) => {
            let Some((start, end)) = first_json_object_bounds(action_json) else {
                return Err(AppError::new(
                    "deki_action_invalid",
                    format!("Deki-senpai returned malformed action JSON: {initial_error}"),
                ));
            };
            serde_json::from_str::<Value>(&action_json[start..end]).map_err(|error| {
                AppError::new(
                    "deki_action_invalid",
                    format!("Deki-senpai returned malformed action JSON: {error}"),
                )
            })
        }
    }
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
    let entity = object
        .get("entity")
        .and_then(Value::as_str)
        .filter(|entity| DEKI_ACTION_ENTITIES.contains(entity))
        .ok_or_else(|| {
            AppError::new(
                "deki_action_invalid",
                "Deki-senpai action entity is not supported.",
            )
        })?;
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
    match action_type {
        "create_record" => {
            let draft = object
                .get("draft")
                .filter(|value| value.is_object())
                .ok_or_else(|| {
                    AppError::new(
                        "deki_action_invalid",
                        "Deki-senpai create action requires a draft object.",
                    )
                })?;
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
        _ => Err(AppError::new(
            "deki_action_invalid",
            "Deki-senpai action type is not supported.",
        )),
    }
}

fn autoagents_message_to_marinara(message: &ChatMessage) -> marinara_llm::LlmMessage {
    let first_tool_result = match &message.message_type {
        MessageType::ToolResult(calls) => calls.first(),
        _ => None,
    };
    let role = match message.role {
        ChatRole::System => "system",
        ChatRole::Assistant => "assistant",
        ChatRole::Tool => "tool",
        ChatRole::User => "user",
    }
    .to_string();
    let tool_calls = match &message.message_type {
        MessageType::ToolUse(calls) => Some(json!(calls)),
        _ => None,
    };
    marinara_llm::LlmMessage {
        role,
        content: first_tool_result
            .map(|call| call.function.arguments.clone())
            .unwrap_or_else(|| message.content.clone()),
        name: None,
        images: Vec::new(),
        tool_call_id: first_tool_result.map(|call| call.id.clone()),
        tool_calls,
        provider_metadata: None,
    }
}

fn marinara_tool_call_to_autoagents(value: Value) -> Option<ToolCall> {
    let function = value.get("function").unwrap_or(&value);
    let name = function
        .get("name")
        .or_else(|| value.get("name"))?
        .as_str()?
        .to_string();
    let arguments = function
        .get("arguments")
        .or_else(|| value.get("arguments"))
        .and_then(Value::as_str)
        .unwrap_or("{}")
        .to_string();
    Some(ToolCall {
        id: value
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .unwrap_or("deki_tool_call")
            .to_string(),
        call_type: value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("function")
            .to_string(),
        function: FunctionCall { name, arguments },
    })
}

fn build_system_prompt(persona: Option<&DekiPersonaContext>) -> String {
    let mut parts = vec![
        "You are Deki-senpai, a standalone assistant inside De-Koi.".to_string(),
        "Personality: helpful, candid, playful, direct, technically sharp, and a little proudly adorable. Explain clearly, nudge users toward practical next steps, and keep your confidence warm rather than formal.".to_string(),
        "You can chat with the user, inspect De-Koi source code with search_deki_code and read_deki_code_file, and apply narrow exact-match code edits with edit_deki_code_file.".to_string(),
        "For questions about De-Koi internals, architecture, UI behavior, agent behavior, storage, imports, providers, or bugs, search the codebase before answering. Prefer AGENTS.md and the relevant owner files over memory. Never cite package-era paths unless search/read tools confirm they exist in the current repository.".to_string(),
        "You can create user extensions with create_deki_extension and custom agent configurations with create_deki_custom_agent. Prefer those record-creation tools when the user asks for an extension or agent.".to_string(),
        "You can inspect the creative library through read_deki_library when the user asks about their characters, personas, lorebooks, prompt presets, or groups. read_deki_library returns only an overview. Use read_deki_library_items with exact ids when you need full selected records. Do not request full item details until the overview identifies likely relevant records.".to_string(),
        "When the user asks you to create or update a character, persona, lorebook, prompt preset, or their groups/sections/entries/variables, draft the record in a single hidden action block instead of calling write tools. Append exactly one <deki_action>{JSON}</deki_action> block after your visible explanation. Supported JSON shapes are {\"type\":\"create_record\",\"entity\":\"characters|character-groups|personas|persona-groups|lorebooks|lorebook-entries|prompts|prompt-sections|prompt-groups|prompt-variables\",\"draft\":{...},\"label\":\"short label\",\"rationale\":\"why this change helps\"} and {\"type\":\"edit_record\",\"entity\":\"...\",\"id\":\"record id\",\"patch\":{...},\"label\":\"short label\",\"rationale\":\"why this change helps\"}. Use De-Koi storage shapes: characters need draft.data.name; personas, lorebooks, and prompts need draft.name; lorebook-entries need lorebookId and name; prompt-sections need presetId, identifier, and name; prompt-groups need presetId and name; prompt-variables need presetId, variableName, question, and options. Do not say the change is saved until the user applies the approval card.".to_string(),
        "For prompt preset review, use read_deki_library when needed and give concise findings. If the user asks you to apply the review, emit an edit_record action for prompts, prompt-sections, prompt-groups, or prompt-variables.".to_string(),
        "When drafting character-card fields, SillyTavern examples, or example dialogue, keep Deki-senpai as the assistant outside the artifact only. Deki-senpai, assistant, user, and raw conversation-history labels must never become a speaker name inside generated card content; use the target character name, {{char}}, {{user}}, or the user's requested format instead.".to_string(),
        "You cannot run shell commands, inspect private chats/messages/memories, access secrets, edit files outside the repository, or perform broad/destructive rewrites. If an edit needs runtime verification, say what should be checked.".to_string(),
    ];
    if let Some(persona) = persona {
        let persona_text = [
            ("Name", persona.name.as_deref()),
            ("Comment", persona.comment.as_deref()),
            ("Description", persona.description.as_deref()),
            ("Personality", persona.personality.as_deref()),
            ("Scenario", persona.scenario.as_deref()),
            ("Backstory", persona.backstory.as_deref()),
            ("Appearance", persona.appearance.as_deref()),
        ]
        .into_iter()
        .filter_map(|(label, value)| {
            let value = value?.trim();
            (!value.is_empty()).then(|| format!("{label}: {value}"))
        })
        .collect::<Vec<_>>()
        .join("\n");
        if !persona_text.is_empty() {
            parts.push(format!("The user's selected persona is:\n{persona_text}"));
        }
    }
    parts.join("\n\n")
}

fn repo_guidance_for_prompt() -> AppResult<String> {
    let root = deki_repo_root()?;
    let guidance = fs::read_to_string(root.join("AGENTS.md")).map_err(|error| {
        AppError::new(
            "deki_repo_guidance_unavailable",
            format!("Could not read AGENTS.md: {error}"),
        )
    })?;
    let current_map = guidance
        .split("### Current Map")
        .nth(1)
        .map(|section| format!("### Current Map{}", section))
        .unwrap_or(guidance);
    let excerpt = truncate_to_chars(&current_map, 5_000).0;
    Ok(excerpt)
}

fn build_task_prompt(input: &DekiPromptRequest, repo_guidance: Option<&str>) -> String {
    let mut sections = Vec::new();
    if let Some(summary) = input
        .compacted_summary
        .as_deref()
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
    {
        sections.push(format!("Compacted conversation so far:\n{summary}"));
    }
    let history = input
        .messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            (!content.is_empty()).then(|| format!("{}: {content}", message.role))
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !history.is_empty() {
        sections.push(format!("Conversation history:\n{history}"));
    }
    if !input.attachments.is_empty() {
        let mut remaining_attachment_chars = DEKI_ATTACHMENT_TOTAL_MAX_CHARS;
        let mut attachment_blocks = input
            .attachments
            .iter()
            .take(DEKI_ATTACHMENT_MAX_COUNT)
            .filter_map(|attachment| {
                attachment_context_block(attachment, &mut remaining_attachment_chars)
            })
            .collect::<Vec<_>>();
        let omitted_count = input
            .attachments
            .len()
            .saturating_sub(DEKI_ATTACHMENT_MAX_COUNT);
        if omitted_count > 0 {
            let omitted_note = format!(
                "[{omitted_count} additional attachment(s) omitted to keep Deki-senpai within the attachment context budget.]"
            );
            if let Some(note) =
                take_attachment_budget(&omitted_note, &mut remaining_attachment_chars)
            {
                attachment_blocks.push(note);
            }
        }
        if !attachment_blocks.is_empty() {
            let attachments = attachment_blocks.join("\n\n---\n\n");
            sections.push(format!(
                "Attached files for the latest user turn:\n{attachments}"
            ));
        }
    }
    if let Some(repo_guidance) = repo_guidance
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!(
            "Current repository guidance from AGENTS.md. Use this as the current source map, then verify exact answers with search_deki_code/read_deki_code_file before citing files:\n{repo_guidance}"
        ));
    }
    sections.push(format!(
        "Latest user message:\n{}",
        input.user_message.trim()
    ));
    sections.join("\n\n")
}

fn attachment_context_block(
    attachment: &DekiAttachment,
    remaining_chars: &mut usize,
) -> Option<String> {
    let name = attachment.name.trim();
    let name = if name.is_empty() { "attachment" } else { name };
    let (name, name_truncated) = truncate_to_chars(name, DEKI_ATTACHMENT_MAX_NAME_CHARS);
    let mime_type = attachment.r#type.trim();
    let mime_type = if mime_type.is_empty() {
        "application/octet-stream"
    } else {
        mime_type
    };
    let (mime_type, mime_type_truncated) =
        truncate_to_chars(mime_type, DEKI_ATTACHMENT_MAX_TYPE_CHARS);
    let content = attachment.content.trim();
    let metadata_notes = [
        name_truncated.then_some("file name was truncated"),
        mime_type_truncated.then_some("MIME type was truncated"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let content_block = match attachment_omission_reason(attachment, content) {
        Some(reason) => format!("[Attachment omitted: {reason}]"),
        None if content.is_empty() => {
            "[Attachment omitted: no readable text content was provided.]".to_string()
        }
        None if *remaining_chars == 0 => {
            "[Attachment omitted: attachment context budget was already exhausted.]".to_string()
        }
        None => {
            let per_file_limit = DEKI_ATTACHMENT_MAX_CHARS.min(*remaining_chars);
            let (snippet, truncated_for_limit) = truncate_to_chars(content, per_file_limit);
            let truncated_by_client =
                attachment.size > 0 && attachment.size as usize > attachment.content.len();
            if truncated_for_limit || truncated_by_client {
                format!(
                    "{snippet}\n\n[Attachment truncated before prompting to keep Deki-senpai within the context budget.]"
                )
            } else {
                snippet
            }
        }
    };
    let mut block = format!(
        "File: {name}\nType: {mime_type}\nSize: {}\nContent:\n{content_block}",
        attachment.size
    );
    if !metadata_notes.is_empty() {
        block.push_str("\n\n[Attachment metadata truncated: ");
        block.push_str(&metadata_notes.join(", "));
        block.push_str(".]");
    }
    take_attachment_budget(&block, remaining_chars)
}

fn take_attachment_budget(value: &str, remaining_chars: &mut usize) -> Option<String> {
    if *remaining_chars == 0 {
        return None;
    }
    let (snippet, _) = truncate_to_chars(value, *remaining_chars);
    *remaining_chars = remaining_chars.saturating_sub(snippet.chars().count());
    Some(snippet)
}

fn attachment_omission_reason(attachment: &DekiAttachment, content: &str) -> Option<String> {
    let mime_type = attachment.r#type.trim().to_ascii_lowercase();
    if mime_type.starts_with("image/") {
        return Some(
            "image attachments are not sent as raw base64 to Deki-senpai; describe the image or attach text instead"
                .to_string(),
        );
    }
    if !is_readable_deki_attachment(attachment) {
        return Some(format!("{mime_type} is not a readable text attachment"));
    }
    if looks_like_encoded_blob(content) {
        return Some("content looks like encoded binary/base64 data".to_string());
    }
    None
}

fn is_readable_deki_attachment(attachment: &DekiAttachment) -> bool {
    let mime_type = attachment.r#type.trim().to_ascii_lowercase();
    if mime_type.starts_with("text/") {
        return true;
    }
    if matches!(
        mime_type.as_str(),
        "application/json"
            | "application/ld+json"
            | "application/xml"
            | "application/x-yaml"
            | "application/yaml"
    ) {
        return true;
    }
    path_extension(&attachment.name)
        .map(|extension| DEKI_TEXT_ATTACHMENT_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or(false)
}

fn path_extension(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

fn truncate_to_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    let was_truncated = chars.next().is_some();
    (truncated, was_truncated)
}

fn looks_like_library_question(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "character",
        "characters",
        "persona",
        "personas",
        "lorebook",
        "lorebooks",
        "prompt",
        "preset",
        "presets",
        "library",
        "what do i have",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn looks_like_codebase_question(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "agent",
        "agents",
        "architecture",
        "bug",
        "code",
        "codebase",
        "component",
        "custom agent",
        "edit",
        "engine",
        "extension",
        "feature",
        "file",
        "how does",
        "implement",
        "marinara",
        "repo",
        "rust",
        "source",
        "src/",
        "tauri",
        "ui",
        "where",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn ensure_connection_supports_native_tools(
    connection: &marinara_llm::LlmConnection,
) -> AppResult<()> {
    match connection.provider.as_str() {
        "openai" | "openai_chatgpt" | "openrouter" | "custom" | "xai" | "mistral" | "cohere"
        | "nanogpt" => Ok(()),
        provider => Err(AppError::invalid_input(format!(
            "Deki-senpai requires a connection with native tool-call support. The selected provider '{provider}' is not enabled for native tools in De-Koi's Rust LLM transport yet. Use an OpenAI-compatible, OpenRouter, OpenAI, xAI, Mistral, Cohere, NanoGPT, or custom OpenAI-compatible connection with a tool-capable chat model."
        ))),
    }
}

fn tool_call_error_message(message: &str) -> String {
    if message.contains("Provider response did not contain assistant text or tool calls") {
        return "The selected model/provider did not return a native tool call or assistant message. Deki-senpai's read-library path requires native tool calling; choose a tool-capable chat model on the selected connection.".to_string();
    }
    message.to_string()
}

fn deki_tool_error(code: &str, error: impl ToString) -> ToolCallError {
    ToolCallError::RuntimeError(Box::new(AppError::new(code, error.to_string())))
}

fn default_agent_phase() -> String {
    "parallel".to_string()
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

fn resolve_repo_file(path: &str) -> AppResult<(PathBuf, PathBuf, String)> {
    let root = deki_repo_root()?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input(
            "Repository-relative path is required",
        ));
    }
    let relative = assert_relative_safe_path(trimmed)?;
    if relative.as_os_str().is_empty() || is_skipped_relative_path(&relative) {
        return Err(AppError::invalid_input(
            "That path is not available to Deki-senpai",
        ));
    }
    let resolved = assert_inside_dir(&root, &relative)?;
    let display_path = relative.to_string_lossy().replace('\\', "/");
    Ok((root, resolved, display_path))
}

fn search_deki_code(args: SearchDekiCodeArgs) -> AppResult<Value> {
    let query = args.query.trim();
    if query.is_empty() {
        return Err(AppError::invalid_input("Search query is required"));
    }
    let max_results = args.max_results.unwrap_or(32).clamp(1, 80);
    let (root, start, display_root) = match args
        .path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        Some(path) => resolve_repo_file(path)?,
        None => {
            let root = deki_repo_root()?;
            (root.clone(), root, ".".to_string())
        }
    };
    if !start.exists() {
        return Err(AppError::not_found(format!("{display_root} was not found")));
    }

    let mut results = Vec::new();
    let mut searched_files = 0usize;
    let query_lower = query.to_ascii_lowercase();
    if start.is_file() {
        search_code_file(
            &root,
            &start,
            &query_lower,
            max_results,
            &mut searched_files,
            &mut results,
        )?;
    } else {
        search_code_dir(
            &root,
            &start,
            &query_lower,
            max_results,
            &mut searched_files,
            &mut results,
        )?;
    }

    Ok(json!({
        "query": query,
        "path": display_root,
        "searchedFiles": searched_files,
        "truncated": results.len() >= max_results,
        "results": results,
    }))
}

fn read_deki_code_file(path: &str) -> AppResult<Value> {
    let (_root, target, display_path) = resolve_repo_file(path)?;
    if !target.is_file() {
        return Err(AppError::not_found(format!("{display_path} was not found")));
    }
    if !is_code_text_path(Path::new(&display_path)) {
        return Err(AppError::invalid_input(format!(
            "{display_path} is not a readable source or guidance file"
        )));
    }
    let metadata = fs::metadata(&target)?;
    if metadata.len() > CODE_READ_MAX_FILE_BYTES {
        return Err(AppError::invalid_input(format!(
            "{display_path} is too large to read directly; search it first and request a narrower file"
        )));
    }
    let content = fs::read_to_string(&target).map_err(|error| {
        AppError::new(
            "deki_code_read_failed",
            format!("{display_path} is not valid UTF-8: {error}"),
        )
    })?;
    if !is_context_safe_source_text(&content) {
        return Err(AppError::invalid_input(format!(
            "{display_path} appears to contain generated, encoded, or binary-like content; search narrower source files instead"
        )));
    }
    Ok(json!({
        "path": display_path,
        "bytes": content.len(),
        "content": content,
    }))
}

fn edit_deki_code_file(path: &str, old_text: &str, new_text: &str) -> AppResult<Value> {
    let (_root, target, display_path) = resolve_repo_file(path)?;
    if !target.is_file() {
        return Err(AppError::not_found(format!("{display_path} was not found")));
    }
    if !is_code_text_path(Path::new(&display_path)) {
        return Err(AppError::invalid_input(format!(
            "{display_path} is not an editable source or guidance file"
        )));
    }
    if old_text.is_empty() {
        return Err(AppError::invalid_input("old_text must not be empty"));
    }
    if old_text.len() > CODE_EDIT_MAX_TEXT_BYTES || new_text.len() > CODE_EDIT_MAX_TEXT_BYTES {
        return Err(AppError::invalid_input("Edit text is too large"));
    }
    let metadata = fs::metadata(&target)?;
    if metadata.len() > CODE_EDIT_MAX_FILE_BYTES {
        return Err(AppError::invalid_input(format!(
            "{display_path} is too large for an exact edit"
        )));
    }
    let content = fs::read_to_string(&target).map_err(|error| {
        AppError::new(
            "deki_code_edit_failed",
            format!("{display_path} is not valid UTF-8: {error}"),
        )
    })?;
    let matches = content.matches(old_text).count();
    if matches != 1 {
        return Err(AppError::invalid_input(format!(
            "old_text must occur exactly once in {display_path}; found {matches}"
        )));
    }
    let updated = content.replacen(old_text, new_text, 1);
    fs::write(&target, updated.as_bytes())?;
    Ok(json!({
        "path": display_path,
        "replacements": 1,
        "bytes": updated.len(),
    }))
}

fn create_deki_extension(state: &AppState, args: CreateDekiExtensionArgs) -> AppResult<Value> {
    let name = args.name.trim();
    if name.is_empty() {
        return Err(AppError::invalid_input("Extension name is required"));
    }
    let css = args.css.filter(|value| !value.trim().is_empty());
    let js = args.js.filter(|value| !value.trim().is_empty());
    if css.as_ref().map(|value| value.len()).unwrap_or(0) > CODE_EDIT_MAX_TEXT_BYTES {
        return Err(AppError::invalid_input("Extension CSS is too large"));
    }
    if js.as_ref().map(|value| value.len()).unwrap_or(0) > 1024 * 1024 {
        return Err(AppError::invalid_input("Extension JavaScript is too large"));
    }
    let extension = super::shared::normalize_extension_for_create(json!({
            "name": name,
            "description": args.description,
            "css": css,
            "js": js,
            "enabled": false,
            "installedAt": now_iso(),
    }))?;
    state.storage.create(
        "extensions",
        super::shared::with_entity_defaults("extensions", extension)?,
    )
}

fn create_deki_custom_agent(state: &AppState, args: CreateDekiCustomAgentArgs) -> AppResult<Value> {
    let name = args.name.trim();
    let prompt_template = args.prompt_template.trim();
    if name.is_empty() {
        return Err(AppError::invalid_input("Agent name is required"));
    }
    if prompt_template.is_empty() {
        return Err(AppError::invalid_input("Agent prompt_template is required"));
    }
    if !matches!(
        args.phase.as_str(),
        "pre_generation" | "parallel" | "post_processing"
    ) {
        return Err(AppError::invalid_input(
            "Agent phase must be pre_generation, parallel, or post_processing",
        ));
    }

    let agent_type = unique_agent_type(
        state,
        args.agent_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| slugify_agent_type(name)),
    )?;
    let mut settings = match args
        .settings_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(raw) => serde_json::from_str::<Value>(raw)
            .map_err(|error| {
                AppError::invalid_input(format!("settings_json must be valid JSON: {error}"))
            })?
            .as_object()
            .cloned()
            .ok_or_else(|| AppError::invalid_input("settings_json must be a JSON object"))?,
        None => serde_json::Map::new(),
    };
    if let Some(result_type) = args
        .result_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        settings.insert(
            "resultType".to_string(),
            Value::String(result_type.to_string()),
        );
    } else {
        settings
            .entry("resultType".to_string())
            .or_insert(Value::String("context_injection".to_string()));
    }

    let body = shared::with_entity_defaults(
        "agents",
        json!({
            "type": agent_type,
            "name": name,
            "description": args.description,
            "phase": args.phase,
            "enabled": false,
            "connectionId": args.connection_id.filter(|value| !value.trim().is_empty()),
            "promptTemplate": prompt_template,
            "settings": Value::Object(settings),
        }),
    )?;
    state.storage.create("agents", body)
}

fn unique_agent_type(state: &AppState, preferred: String) -> AppResult<String> {
    let base = sanitize_agent_type(&preferred);
    let existing = state
        .storage
        .list("agents")?
        .into_iter()
        .filter_map(|row| {
            row.get("type")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect::<std::collections::HashSet<_>>();
    if !existing.contains(&base) {
        return Ok(base);
    }
    for index in 2..1000 {
        let candidate = format!("{base}-{index}");
        if !existing.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err(AppError::invalid_input(
        "Could not create a unique agent type",
    ))
}

fn slugify_agent_type(value: &str) -> String {
    sanitize_agent_type(&format!("custom-{value}"))
}

fn sanitize_agent_type(value: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            output.push(ch);
            previous_dash = false;
        } else if !previous_dash {
            output.push('-');
            previous_dash = true;
        }
        if output.len() >= 80 {
            break;
        }
    }
    let trimmed = output.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "custom-deki-agent".to_string()
    } else if trimmed.starts_with("custom-") {
        trimmed
    } else {
        format!("custom-{trimmed}")
    }
}

fn search_code_dir(
    root: &Path,
    dir: &Path,
    query_lower: &str,
    max_results: usize,
    searched_files: &mut usize,
    results: &mut Vec<Value>,
) -> AppResult<()> {
    if results.len() >= max_results {
        return Ok(());
    }
    let mut entries = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        if results.len() >= max_results {
            break;
        }
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let relative = path.strip_prefix(root).unwrap_or(&path);
        if is_skipped_relative_path(relative) {
            continue;
        }
        if file_type.is_dir() {
            search_code_dir(
                root,
                &path,
                query_lower,
                max_results,
                searched_files,
                results,
            )?;
        } else if file_type.is_file() {
            search_code_file(
                root,
                &path,
                query_lower,
                max_results,
                searched_files,
                results,
            )?;
        }
    }
    Ok(())
}

fn search_code_file(
    root: &Path,
    path: &Path,
    query_lower: &str,
    max_results: usize,
    searched_files: &mut usize,
    results: &mut Vec<Value>,
) -> AppResult<()> {
    if results.len() >= max_results || !is_code_text_path(path) {
        return Ok(());
    }
    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    if metadata.len() > CODE_SEARCH_MAX_FILE_BYTES {
        return Ok(());
    }
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(());
    };
    if !is_context_safe_source_text(&content) {
        return Ok(());
    }
    *searched_files += 1;
    let display_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    for (index, line) in content.lines().enumerate() {
        if !line.to_ascii_lowercase().contains(query_lower) {
            continue;
        }
        results.push(json!({
            "path": display_path,
            "line": index + 1,
            "preview": truncate_preview(line.trim()),
        }));
        if results.len() >= max_results {
            break;
        }
    }
    Ok(())
}

fn is_code_text_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            let extension = extension.to_ascii_lowercase();
            CODE_SEARCH_ALLOWED_EXTENSIONS.contains(&extension.as_str())
        })
        .unwrap_or_else(|| {
            path.file_name()
                .and_then(|value| value.to_str())
                .map(|name| matches!(name, "AGENTS.md" | "README" | "LICENSE"))
                .unwrap_or(false)
        })
}

fn is_skipped_relative_path(path: &Path) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if CODE_SEARCH_SKIP_PATH_PREFIXES
        .iter()
        .any(|prefix| normalized == *prefix || normalized.starts_with(&format!("{prefix}/")))
    {
        return true;
    }
    path.components().any(|component| {
        let value = component.as_os_str().to_string_lossy();
        CODE_SEARCH_SKIP_DIRS.contains(&value.as_ref())
    })
}

fn truncate_preview(value: &str) -> String {
    const MAX_CHARS: usize = 240;
    let mut chars = value.chars();
    let preview = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn is_context_safe_source_text(content: &str) -> bool {
    let compact_content = content
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    !content.as_bytes().contains(&0)
        && !looks_like_encoded_blob(&compact_content)
        && !content.lines().map(str::trim).any(looks_like_encoded_blob)
}

fn looks_like_encoded_blob(value: &str) -> bool {
    const MIN_BLOB_CHARS: usize = 2048;
    if value.len() < MIN_BLOB_CHARS {
        return false;
    }
    let lower = value
        .chars()
        .take(64)
        .collect::<String>()
        .to_ascii_lowercase();
    if lower.starts_with("data:") || lower.contains(";base64,") {
        return true;
    }
    let mut encoded_chars = 0usize;
    let mut whitespace_chars = 0usize;
    let mut total_chars = 0usize;
    for ch in value.chars() {
        total_chars += 1;
        if ch.is_whitespace() {
            whitespace_chars += 1;
            continue;
        }
        if ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '=' | '-' | '_') {
            encoded_chars += 1;
        }
    }
    let non_whitespace_chars = total_chars.saturating_sub(whitespace_chars);
    non_whitespace_chars >= MIN_BLOB_CHARS
        && whitespace_chars * 100 / total_chars <= 5
        && encoded_chars * 100 / non_whitespace_chars >= 96
}

#[cfg(test)]
mod tests {
    use super::*;

    static DEKI_REPO_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn test_connection(provider: &str) -> marinara_llm::LlmConnection {
        marinara_llm::LlmConnection {
            provider: provider.to_string(),
            model: "test-model".to_string(),
            api_key: String::new(),
            base_url: String::new(),
            openrouter_provider: None,
            enable_caching: false,
            caching_at_depth: None,
            max_tokens_override: None,
            claude_fast_mode: false,
        }
    }

    fn text_message(content: &str) -> ChatMessage {
        ChatMessage {
            role: ChatRole::User,
            message_type: MessageType::Text,
            content: content.to_string(),
        }
    }

    fn tool_result_message() -> ChatMessage {
        ChatMessage {
            role: ChatRole::Tool,
            message_type: MessageType::ToolResult(vec![ToolCall {
                id: "call_test".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "read_deki_library".to_string(),
                    arguments: "{}".to_string(),
                },
            }]),
            content: "{}".to_string(),
        }
    }

    fn test_tool(name: &str) -> Tool {
        Tool {
            tool_type: "function".to_string(),
            function: autoagents::llm::chat::FunctionTool {
                name: name.to_string(),
                description: "Test tool".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {},
                    "required": []
                }),
            },
        }
    }

    #[test]
    fn deki_library_tool_schema_uses_supported_primitive_fields() {
        let overview_schema: Value =
            serde_json::from_str(ReadDekiLibraryArgs::io_schema()).expect("overview schema json");
        assert_eq!(
            overview_schema["properties"]["types"]["type"],
            json!("string")
        );

        let detail_schema: Value = serde_json::from_str(ReadDekiLibraryItemsArgs::io_schema())
            .expect("detail schema json");
        assert_eq!(
            detail_schema["properties"]["item_type"]["type"],
            json!("string")
        );
        assert_eq!(detail_schema["properties"]["id"]["type"], json!("string"));
        assert!(detail_schema["properties"].get("items").is_none());
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

        assert_eq!(status["enabled"], json!(false));
        assert_eq!(status["connection"]["id"], json!("conn-1"));
        assert_eq!(status["connection"]["name"], json!("Workspace Test"));
        assert_eq!(status["connection"]["provider"], json!("openai"));
        assert_eq!(status["connection"]["model"], json!("gpt-4.1"));
        assert!(status["error"]
            .as_str()
            .unwrap_or_default()
            .contains("selected connection"));
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
    fn deki_edit_tool_applies_exact_source_edits() {
        let _guard = DEKI_REPO_ENV_LOCK.lock().expect("lock repo env");
        let previous_de_koi = std::env::var_os("DE_KOI_REPO_ROOT");
        let previous_marinara = std::env::var_os("MARINARA_REPO_ROOT");
        let root = unique_test_repo_root("edit-tool");
        fs::create_dir_all(root.join("src")).expect("create src");
        let source_path = root.join("src").join("sample.ts");
        fs::write(&source_path, "export const label = 'before';\n").expect("write source");

        std::env::set_var("DE_KOI_REPO_ROOT", &root);
        std::env::remove_var("MARINARA_REPO_ROOT");
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build test runtime")
            .block_on(EditDekiCodeFileTool {}.execute(json!({
                "path": "src/sample.ts",
                "old_text": "before",
                "new_text": "after"
            })));

        match previous_de_koi {
            Some(value) => std::env::set_var("DE_KOI_REPO_ROOT", value),
            None => std::env::remove_var("DE_KOI_REPO_ROOT"),
        }
        match previous_marinara {
            Some(value) => std::env::set_var("MARINARA_REPO_ROOT", value),
            None => std::env::remove_var("MARINARA_REPO_ROOT"),
        }
        let updated = fs::read_to_string(&source_path).expect("read updated source");
        fs::remove_dir_all(&root).ok();

        let payload = result.expect("edit tool should apply exact source edit");
        assert_eq!(payload["path"], "src/sample.ts");
        assert_eq!(payload["replacements"], 1);
        assert_eq!(updated, "export const label = 'after';\n");
    }

    #[test]
    fn deki_edit_tool_leaves_file_unchanged_when_old_text_is_absent() {
        let _guard = DEKI_REPO_ENV_LOCK.lock().expect("lock repo env");
        let previous_de_koi = std::env::var_os("DE_KOI_REPO_ROOT");
        let previous_marinara = std::env::var_os("MARINARA_REPO_ROOT");
        let root = unique_test_repo_root("edit-tool-missing-text");
        fs::create_dir_all(root.join("src")).expect("create src");
        let source_path = root.join("src").join("sample.ts");
        let original = "export const label = 'before';\n";
        fs::write(&source_path, original).expect("write source");

        std::env::set_var("DE_KOI_REPO_ROOT", &root);
        std::env::remove_var("MARINARA_REPO_ROOT");
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build test runtime")
            .block_on(EditDekiCodeFileTool {}.execute(json!({
                "path": "src/sample.ts",
                "old_text": "missing",
                "new_text": "after"
            })));

        match previous_de_koi {
            Some(value) => std::env::set_var("DE_KOI_REPO_ROOT", value),
            None => std::env::remove_var("DE_KOI_REPO_ROOT"),
        }
        match previous_marinara {
            Some(value) => std::env::set_var("MARINARA_REPO_ROOT", value),
            None => std::env::remove_var("MARINARA_REPO_ROOT"),
        }
        let updated = fs::read_to_string(&source_path).expect("read source after failed edit");
        fs::remove_dir_all(&root).ok();

        assert!(result.is_err(), "missing old_text should reject the edit");
        assert_eq!(updated, original);
    }

    #[test]
    fn deki_edit_tool_leaves_file_unchanged_when_old_text_is_duplicated() {
        let _guard = DEKI_REPO_ENV_LOCK.lock().expect("lock repo env");
        let previous_de_koi = std::env::var_os("DE_KOI_REPO_ROOT");
        let previous_marinara = std::env::var_os("MARINARA_REPO_ROOT");
        let root = unique_test_repo_root("edit-tool-duplicate-text");
        fs::create_dir_all(root.join("src")).expect("create src");
        let source_path = root.join("src").join("sample.ts");
        let original = "export const first = 'same';\nexport const second = 'same';\n";
        fs::write(&source_path, original).expect("write source");

        std::env::set_var("DE_KOI_REPO_ROOT", &root);
        std::env::remove_var("MARINARA_REPO_ROOT");
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build test runtime")
            .block_on(EditDekiCodeFileTool {}.execute(json!({
                "path": "src/sample.ts",
                "old_text": "same",
                "new_text": "after"
            })));

        match previous_de_koi {
            Some(value) => std::env::set_var("DE_KOI_REPO_ROOT", value),
            None => std::env::remove_var("DE_KOI_REPO_ROOT"),
        }
        match previous_marinara {
            Some(value) => std::env::set_var("MARINARA_REPO_ROOT", value),
            None => std::env::remove_var("MARINARA_REPO_ROOT"),
        }
        let updated = fs::read_to_string(&source_path).expect("read source after failed edit");
        fs::remove_dir_all(&root).ok();

        assert!(result.is_err(), "duplicate old_text should reject the edit");
        assert_eq!(updated, original);
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
    fn deki_custom_connections_use_string_tool_choice() {
        let connection = test_connection("custom");
        let messages = [text_message("What does src/app/shell/AppShell.tsx do?")];
        let tools = [test_tool("search_deki_code")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert_eq!(parameters["toolChoice"], json!("required"));
    }

    #[test]
    fn deki_known_openai_connections_keep_exact_tool_choice() {
        let connection = test_connection("openai");
        let messages = [text_message("What does src/app/shell/AppShell.tsx do?")];
        let tools = [test_tool("search_deki_code")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert_eq!(
            parameters["toolChoice"],
            json!({
                "type": "function",
                "function": { "name": "search_deki_code" }
            })
        );
    }

    #[test]
    fn deki_custom_library_questions_use_string_tool_choice() {
        let connection = test_connection("custom");
        let messages = [text_message("What personas are in my library?")];
        let tools = [test_tool("read_deki_library")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert_eq!(parameters["toolChoice"], json!("required"));
    }

    #[test]
    fn deki_plain_response_returns_no_pending_action_contract() {
        let (content, action) =
            deki_response_content_and_action("Plain answer.").expect("plain response should parse");

        assert_eq!(content, "Plain answer.");
        assert_eq!(action["type"], "none");
        assert_eq!(action["capability"], "read_only");
        assert!(
            action["reason"]
                .as_str()
                .unwrap_or_default()
                .contains("no pending UI approval action")
        );
        assert!(
            !action["reason"]
                .as_str()
                .unwrap_or_default()
                .contains("source edits")
        );
    }

    #[test]
    fn deki_none_action_normalizes_to_no_pending_action_contract() {
        let raw = r#"No change needed.<deki_action>{"type":"none"}</deki_action>"#;

        let (content, action) =
            deki_response_content_and_action(raw).expect("none action should parse");

        assert_eq!(content, "No change needed.");
        assert_eq!(action["type"], "none");
        assert!(
            action["reason"]
                .as_str()
                .unwrap_or_default()
                .contains("no pending UI approval action")
        );
        assert!(
            !action["reason"]
                .as_str()
                .unwrap_or_default()
                .contains("source edits")
        );
    }

    #[test]
    fn deki_response_extracts_pending_create_action_without_visible_json() {
        let raw = r#"I drafted Sol for approval.

<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler"},"label":"Create Sol","rationale":"Matches the user's brief."}</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw).expect("action should parse");

        assert_eq!(content, "I drafted Sol for approval.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["name"], "Sol");
        assert!(!content.contains("deki_action"));
    }

    #[test]
    fn deki_response_extracts_action_from_fenced_json_block() {
        let raw = r#"Draft ready.
<deki_action>```json
{"type":"create_record","entity":"personas","draft":{"name":"Sol"}}
```</deki_action>"#;

        let (content, action) =
            deki_response_content_and_action(raw).expect("fenced action should parse");

        assert_eq!(content, "Draft ready.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["name"], "Sol");
    }

    #[test]
    fn deki_response_extracts_action_when_hidden_block_has_trailing_text() {
        let raw = r#"Draft ready.
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol"}} This draft creates the requested persona.</deki_action>"#;

        let (content, action) =
            deki_response_content_and_action(raw).expect("action with hidden trailing text should parse");

        assert_eq!(content, "Draft ready.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["name"], "Sol");
    }

    #[test]
    fn deki_response_rejects_malformed_action_json() {
        let raw =
            r#"Draft ready.<deki_action>{"type":"create_record","entity":"personas"</deki_action>"#;

        let error =
            deki_response_content_and_action(raw).expect_err("malformed action should fail");

        assert_eq!(error.code, "deki_action_invalid");
    }

    #[test]
    fn deki_response_rejects_multiple_action_blocks() {
        let raw = r#"Draft ready.
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol"}}</deki_action>
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Luna"}}</deki_action>"#;

        let error =
            deki_response_content_and_action(raw).expect_err("duplicate actions should fail");

        assert_eq!(error.code, "deki_action_invalid");
    }

    #[test]
    fn deki_response_preserves_visible_text_after_action_block() {
        let raw = r#"Draft ready.
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol"}}</deki_action>
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

    #[test]
    fn deki_initial_tool_request_uses_compact_output_budget() {
        let connection = test_connection("custom");
        let messages = [text_message("What lorebooks are in my library?")];
        let tools = [test_tool("read_deki_library")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert_eq!(parameters["maxTokens"], json!(2048));
    }

    #[test]
    fn deki_post_tool_response_uses_larger_output_budget() {
        let connection = test_connection("custom");
        let messages = [
            text_message("Can you make me a dead by daylight lorebook?"),
            tool_result_message(),
        ];
        let tools = [test_tool("read_deki_library")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert_eq!(parameters["maxTokens"], json!(8192));
        assert!(parameters.get("toolChoice").is_none());
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
            },
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

    #[test]
    fn deki_code_tools_reject_encoded_source_payloads() {
        assert!(is_context_safe_source_text(
            "export function usefulSource() {\n  return 'readable code';\n}\n"
        ));
        assert!(!is_context_safe_source_text(&format!(
            "{{\"image\":\"data:image/png;base64,{}\"}}",
            "A".repeat(4096)
        )));
    }

    #[test]
    fn deki_code_tools_reject_wrapped_encoded_source_payloads() {
        let payload = "A"
            .repeat(4096)
            .as_bytes()
            .chunks(76)
            .map(|chunk| std::str::from_utf8(chunk).expect("ASCII test payload"))
            .collect::<Vec<_>>()
            .join("\n");
        let source = format!("export const embeddedImage = `\n{payload}\n`;");

        assert!(!is_context_safe_source_text(&source));
    }
}
