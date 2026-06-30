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
use autoagents::prelude::{agent, tool, AgentHooks, ToolInput, ToolInputT, ToolT};
use marinara_core::{now_iso, AppError, AppResult};
use marinara_security::{assert_inside_dir, assert_relative_safe_path};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fmt;
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

#[path = "deki/chat_access.rs"]
mod chat_access;
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
const DEKI_AGENT_MAX_TURNS: usize = 10;
const DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT: u64 = 200;
const DEKI_WEB_SEARCH_MAX_RESULTS: usize = 8;
const DEKI_WEB_SEARCH_TIMEOUT_SECS: u64 = 12;
const DEKI_WEB_PAGE_MAX_BYTES: usize = 768 * 1024;
const DEKI_WEB_PAGE_MAX_CHARS: usize = 16 * 1024;
const DEKI_REPO_ROOT_ENV: &str = "DE_KOI_REPO_ROOT";
const LEGACY_DEKI_REPO_ROOT_ENV: &str = "MARINARA_REPO_ROOT";
const DEKI_WORKSPACE_TOOLS: &[&str] = &[
    "read",
    "grep",
    "find",
    "ls",
    "deki_data",
    "deki_code",
    "read_deki_chats",
    "read_deki_chat_messages",
];

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
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DekiWebResearchGrant {
    id: String,
    action_message_id: String,
    scope: DekiWebResearchScope,
    granted_at: String,
    #[serde(default)]
    expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DekiWebResearchScope {
    #[serde(rename = "type")]
    scope_type: String,
    query: String,
    #[serde(default)]
    allowed_domains: Vec<String>,
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
                .flat_map(autoagents_message_to_marinara)
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
        let mut tool_calls = response
            .tool_calls
            .into_iter()
            .filter_map(marinara_tool_call_to_autoagents)
            .collect::<Vec<_>>();
        let synthesized_forced_tool_call = tool_calls.is_empty();
        if synthesized_forced_tool_call {
            tool_calls = deki_forced_chat_tool_call(
                &deki_request_parameters(&self.connection, messages, tools.unwrap_or_default()),
                tools.unwrap_or_default(),
            );
        }
        Ok(Box::new(DekiChatResponse {
            content: if synthesized_forced_tool_call && !tool_calls.is_empty() {
                String::new()
            } else {
                response.content
            },
            tool_calls,
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
    let routing_message = deki_prompt_routing_message(latest_user);
    if !has_tool_result
        && has_deki_tool(tools, "search_deki_web")
        && looks_like_approved_web_research_task(latest_user)
    {
        parameters["toolChoice"] = deki_forced_tool_choice(connection, "search_deki_web");
    } else if !tools.is_empty() && !has_tool_result && looks_like_codebase_question(routing_message)
    {
        parameters["toolChoice"] = deki_forced_tool_choice(connection, "search_deki_code");
    } else if !tools.is_empty()
        && !has_tool_result
        && !looks_like_chat_context_question(routing_message)
        && looks_like_library_question(routing_message)
    {
        parameters["toolChoice"] = deki_forced_tool_choice(connection, "read_deki_library");
    }
    parameters
}

fn has_deki_tool(tools: &[Tool], name: &str) -> bool {
    tools.iter().any(|tool| tool.function.name == name)
}

fn looks_like_approved_web_research_task(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("approved web research grants") && lower.contains("search_deki_web")
}
fn deki_forced_tool_choice(connection: &marinara_llm::LlmConnection, tool_name: &str) -> Value {
    if connection.provider == "custom" {
        return json!("required");
    }
    if connection.provider == "openai_chatgpt" {
        return json!({
            "type": "function",
            "name": tool_name
        });
    }
    json!({
        "type": "function",
        "function": { "name": tool_name }
    })
}

fn deki_requested_tool_choice_name(parameters: &Value) -> Option<&str> {
    let choice = parameters
        .get("toolChoice")
        .or_else(|| parameters.get("tool_choice"))?;
    choice
        .get("function")
        .and_then(|function| function.get("name"))
        .or_else(|| choice.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn deki_forced_chat_tool_call(parameters: &Value, tools: &[Tool]) -> Vec<ToolCall> {
    let Some(tool_name) = deki_requested_tool_choice_name(parameters) else {
        return Vec::new();
    };
    if tool_name != "read_deki_chats" {
        return Vec::new();
    }
    if !tools.iter().any(|tool| tool.function.name == tool_name) {
        return Vec::new();
    }
    vec![ToolCall {
        id: "deki_forced_read_deki_chats".to_string(),
        call_type: "function".to_string(),
        function: FunctionCall {
            name: tool_name.to_string(),
            arguments: "{}".to_string(),
        },
    }]
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
struct SearchDekiWebArgs {
    #[input(description = "Exact approved search query.")]
    query: String,
    #[input(description = "Optional maximum number of search results to return.")]
    #[serde(default)]
    max_results: Option<usize>,
}

#[tool(
    name = "search_deki_web",
    description = "Search the public web for an exact query that the user already approved through a Deki web-research action card. Calls without a matching approved grant are rejected.",
    input = SearchDekiWebArgs,
)]
struct SearchDekiWebTool {
    grants: Vec<DekiWebResearchGrant>,
}

#[async_trait]
impl ToolRuntime for SearchDekiWebTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: SearchDekiWebArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_web_search_invalid_args", error))?;
        search_deki_web(args, &self.grants)
            .await
            .map_err(|error| deki_tool_error("deki_web_search_failed", error))
    }
}
#[derive(Serialize, Deserialize, ToolInput, Debug)]
struct ReadDekiWebPageArgs {
    #[input(description = "Exact approved search query that authorized this page read.")]
    query: String,
    #[input(description = "Public HTTP(S) URL from the approved web research results to read.")]
    url: String,
}

#[tool(
    name = "read_deki_web_page",
    description = "Read readable text from a public web page after the user approved the matching web-research query. The URL must be public and must match the approved grant domains when domains were specified.",
    input = ReadDekiWebPageArgs,
)]
struct ReadDekiWebPageTool {
    grants: Vec<DekiWebResearchGrant>,
}

#[async_trait]
impl ToolRuntime for ReadDekiWebPageTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: ReadDekiWebPageArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_web_page_invalid_args", error))?;
        read_deki_web_page(args, &self.grants)
            .await
            .map_err(|error| deki_tool_error("deki_web_page_read_failed", error))
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

#[tool(
    name = "read_deki_chats",
    description = "List approved chat context as a safe overview. Requires a user-approved Deki chat access grant. Returns chat ids, mode, title, participant hints, timestamps, and message counts. It never returns message bodies; use read_deki_chat_messages with an approved chat id for bounded message slices.",
    input = chat_access::ReadDekiChatsArgs,
)]
struct ReadDekiChatsTool {
    state: AppState,
    grants: Vec<chat_access::DekiChatAccessGrant>,
}

#[async_trait]
impl ToolRuntime for ReadDekiChatsTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: chat_access::ReadDekiChatsArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_chats_read_invalid_args", error))?;
        chat_access::overview(&self.state, &self.grants, args)
            .map_err(|error| deki_tool_error("deki_chats_read_failed", error))
    }
}

#[tool(
    name = "read_deki_chat_messages",
    description = "Read a bounded page of messages from one approved chat id. Requires a user-approved Deki chat access grant that covers the chat. Use read_deki_chats first to identify the relevant chat id. The server enforces the approved scope and message window.",
    input = chat_access::ReadDekiChatMessagesArgs,
)]
struct ReadDekiChatMessagesTool {
    state: AppState,
    grants: Vec<chat_access::DekiChatAccessGrant>,
}

#[async_trait]
impl ToolRuntime for ReadDekiChatMessagesTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let args: chat_access::ReadDekiChatMessagesArgs = serde_json::from_value(args)
            .map_err(|error| deki_tool_error("deki_chat_messages_read_invalid_args", error))?;
        chat_access::messages(&self.state, &self.grants, args)
            .map_err(|error| deki_tool_error("deki_chat_messages_read_failed", error))
    }
}

#[agent(
    name = "deki",
    description = "You are Deki-senpai, De-Koi's standalone assistant. You can inspect the app's codebase, read files, apply exact source edits, create extension records, create custom agent records, inspect the creative library, and read approved chat context through tools. Use tools for factual answers about De-Koi internals.",
    tools = [
        ReadDekiLibraryTool { state: self.state.clone() },
        ReadDekiLibraryItemsTool { state: self.state.clone() },
        ReadDekiChatsTool { state: self.state.clone(), grants: self.chat_access_grants.clone() },
        ReadDekiChatMessagesTool { state: self.state.clone(), grants: self.chat_access_grants.clone() },
        SearchDekiWebTool { grants: self.web_research_grants.clone() },
        ReadDekiWebPageTool { grants: self.web_research_grants.clone() },
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
    chat_access_grants: Vec<chat_access::DekiChatAccessGrant>,
    web_research_grants: Vec<DekiWebResearchGrant>,
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
    let provider: Arc<dyn LLMProvider> = Arc::new(DekiLlmProvider { connection });
    let memory = Box::new(SlidingWindowMemory::new(12));
    let agent = ReActAgent::with_max_turns(
        DekiAgent {
            state: state.clone(),
            chat_access_grants: input.chat_access_grants.clone(),
            web_research_grants: input.web_research_grants.clone(),
        },
        DEKI_AGENT_MAX_TURNS,
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
            let Some(repaired) = escape_control_chars_in_json_strings(candidate) else {
                return Err(original_error);
            };
            serde_json::from_str::<Value>(&repaired).map_err(|_| original_error)
        }
    }
}

fn escape_control_chars_in_json_strings(input: &str) -> Option<String> {
    let mut output = String::with_capacity(input.len());
    let mut in_string = false;
    let mut escaped = false;
    let mut changed = false;

    for character in input.chars() {
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
                    output.push(character);
                    in_string = false;
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

        output.push(character);
        if character == '"' {
            in_string = true;
        }
    }

    if changed {
        Some(output)
    } else {
        None
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

fn autoagents_message_to_marinara(message: &ChatMessage) -> Vec<marinara_llm::LlmMessage> {
    let role = match message.role {
        ChatRole::System => "system",
        ChatRole::Assistant => "assistant",
        ChatRole::Tool => "tool",
        ChatRole::User => "user",
    }
    .to_string();
    if let MessageType::ToolResult(calls) = &message.message_type {
        return calls
            .iter()
            .map(|call| marinara_llm::LlmMessage {
                role: role.clone(),
                content: call.function.arguments.clone(),
                name: None,
                images: Vec::new(),
                tool_call_id: Some(call.id.clone()),
                tool_calls: None,
                provider_metadata: None,
            })
            .collect();
    }
    let tool_calls = match &message.message_type {
        MessageType::ToolUse(calls) => Some(json!(calls)),
        _ => None,
    };
    vec![marinara_llm::LlmMessage {
        role,
        content: message.content.clone(),
        name: None,
        images: Vec::new(),
        tool_call_id: None,
        tool_calls,
        provider_metadata: None,
    }]
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
        "Treat requests to look at, review, improve, polish, update, or sanity-check characters, personas, lorebooks, lorebook entries, prompt presets, or groups as a creative-library quality audit even when the user does not explicitly ask for one. Use read_deki_library and then read_deki_library_items when current stored fields, linked entries, or neighboring records matter.".to_string(),
        "For character cards and personas, proactively estimate whole-card length and flag anything over the recommended ~3,200 estimated tokens. Warn when an otherwise helpful addition would make a card too long, and prefer tighter, more specific wording over expansion unless the user explicitly chooses the length tradeoff.".to_string(),
        "During creative-library quality audits, check for shallow characterization, overly tropey or generic archetype behavior, repetition, vague traits without behavior, duplicate facts across fields, and lorebook entries that are too broad to activate cleanly. If a character feels shallow or generic, deepen it with concrete motives, contradictions, habits, memories, relationships, sensory details, and situation-specific behaviors. When correcting character-card or persona characterization, phrase the correction as what they are and the behavior to add instead of what they are not; avoid \"(Character) is not ...\" negative framing unless the user explicitly asks for a contrast. For card or persona corrections, place each corrected trait in the single best-fit field. Do not repeat the same trait label across description, personality, scenario, backstory, appearance, creator notes, or example dialogue; replace duplicated trait labels with one concrete behavior, memory, contradiction, or sensory cue where it belongs.".to_string(),
        "Before emitting a create_record, edit_record, or apply_lorebook_redraft action, self-review the proposed additions for length, repetition, specificity, and whether they would push the card over the recommended length. If source-backed canon, fandom/wiki/game-source details, or outside context would provide gold nuggets that remove shallow behavior, request web research instead of guessing.".to_string(),
        "You can inspect chats and messages only after the user grants scoped read access. If the task needs prior chat, roleplay, or game conversation context and no approved grant is available, explain the needed scope and append exactly one hidden <deki_action>{JSON}</deki_action> block with {\"type\":\"request_chat_access\",\"scope\":{\"type\":\"specific_chats\",\"chatIds\":[\"...\"]}|{\"type\":\"character\",\"characterId\":\"optional\",\"characterName\":\"known character name\"}|{\"type\":\"mode\",\"modes\":[\"conversation\"|\"roleplay\"|\"game\"]},\"window\":{\"messageCount\":50},\"label\":\"short label\",\"rationale\":\"why this chat context is needed\"}. Prefer the narrowest scope; for a named character, characterName is acceptable even if you do not know the id. After a grant exists, the backend injects a bounded approved chat context snapshot into the prompt; use that evidence before drafting. Use chat tools only if the snapshot is missing a clearly necessary bounded window. Never claim to have read chats unless the approved snapshot or chat tools returned data.".to_string(),
        "When the user asks for suggestions, edits, summaries, examples, or character/persona/prompt changes that would materially benefit from their prior chats or roleplay interactions, proactively request scoped chat access before giving evidence-based changes. Do not say you can do it without reading conversations when the request depends on how the user and a character interacted.".to_string(),
        "You may search the public web only after the user approves a web-research action card. When the task would benefit from current external facts, fandom/wiki/game-source details, canon checks, source-backed accuracy, real-world product or rules information, or verification that a character/persona/card matches source material, proactively request web research. Ask first by appending exactly one <deki_action>{JSON}</deki_action> block with {\"type\":\"request_web_research\",\"scope\":{\"type\":\"query\",\"query\":\"precise search query\",\"allowedDomains\":[\"optional.example\"]},\"reason\":\"why web research is needed\",\"sources\":[\"expected source names\"],\"label\":\"short label\"}. Do not call search_deki_web unless the latest task prompt lists an approved grant for that exact query.".to_string(),
        "When a web search grant is approved, use search_deki_web for the granted exact query, summarize what the returned sources indicate, and then propose any creative-library edit with a normal create_record or edit_record approval action. Do not imply you searched the web unless search_deki_web returned results.".to_string(),
        "After search_deki_web returns results, use read_deki_web_page to inspect the most relevant result pages before proposing creative-library edits or making source-backed characterization claims.".to_string(),
        "If search_deki_web fails because the provider did not return usable search results, say that clearly, do not fabricate sources, and ask the user to try again later or provide specific URLs/sources to inspect.".to_string(),
        "When the user asks you to create or update a character, persona, lorebook, prompt preset, or their groups/sections/entries/variables, draft the record in a single hidden action block instead of calling write tools. Append exactly one <deki_action>{JSON}</deki_action> block after your visible explanation. Supported JSON shapes are {\"type\":\"create_record\",\"entity\":\"characters|character-groups|personas|persona-groups|lorebooks|lorebook-entries|prompts|prompt-sections|prompt-groups|prompt-variables\",\"draft\":{...},\"label\":\"short label\",\"rationale\":\"why this change helps\"}, {\"type\":\"edit_record\",\"entity\":\"...\",\"id\":\"record id\",\"patch\":{...},\"label\":\"short label\",\"rationale\":\"why this change helps\"}, and {\"type\":\"apply_lorebook_redraft\",\"id\":\"optional existing lorebook id\",\"lorebook\":{...},\"entries\":[{...}],\"label\":\"short label\",\"rationale\":\"why this change helps\"}. Use De-Koi storage shapes: characters need draft.data.name; personas, lorebooks, and prompts need draft.name; apply_lorebook_redraft needs lorebook.name and entries with name/content; lorebook-entries need lorebookId and name; prompt-sections need presetId, identifier, and name; prompt-groups need presetId and name; prompt-variables need presetId, variableName, question, and options. Do not say the change is saved until the user applies the approval card. For lorebook-entry create_record or edit_record approvals, show the entry name, activation keys if present, and full proposed content in your visible answer before the hidden action block; the user should never have to approve an unseen lorebook entry.".to_string(),
        "For full-lorebook creation, overhaul, rewrite, or redraft requests, show the whole lorebook redraft in your visible answer so the user can review the complete structure at once. Prefer apply_lorebook_redraft and one approval card for the whole lorebook-level change; do not make users approve separate lorebook-entries approval actions one entry at a time unless they explicitly ask for entry-by-entry work or only one entry is changing.".to_string(),
        "For lorebook entry content, default to compact, activation-focused entries of 1-3 short paragraphs or about 100-180 words; split larger lore into multiple focused entries instead of drafting one oversized entry, unless the user explicitly asks for a longer reference-style entry.".to_string(),
        "For prompt preset review, use read_deki_library when needed and give concise findings. If the user asks you to apply the review, emit an edit_record action for prompts, prompt-sections, prompt-groups, or prompt-variables.".to_string(),
        "When drafting character-card fields, SillyTavern examples, or example dialogue, keep Deki-senpai as the assistant outside the artifact only. Deki-senpai, assistant, user, and raw conversation-history labels must never become a speaker name inside generated card content. Treat {{char}} and {{user}} as literal artifact placeholders, preserve {{char}} and {{user}} exactly when the target format uses them, and never replace them with Deki-senpai; use the target character name only when the artifact format calls for an actual name.".to_string(),
        "You cannot run shell commands, inspect unapproved private chats/messages/memories, access secrets, edit files outside the repository, or perform broad/destructive rewrites. If an edit needs runtime verification, say what should be checked.".to_string(),
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

fn build_task_prompt(
    input: &DekiPromptRequest,
    repo_guidance: Option<&str>,
    approved_chat_context: Option<&str>,
) -> String {
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
    if input.chat_access_grants.is_empty() {
        sections.push(
            "Approved chat access grants for this prompt: none. Request scoped chat access with a hidden request_chat_access action before using chat read tools if chat context is needed."
                .to_string(),
        );
        if looks_like_chat_context_question(&input.user_message) {
            sections.push(
                "Chat context assessment: the latest user request appears to need or benefit from prior chat/roleplay interaction evidence. You must request scoped chat access before giving interaction-based recommendations; do not invent suggestions from library context alone and do not claim the task can be done without reading conversations."
                    .to_string(),
            );
        }
    } else {
        let grants =
            serde_json::to_string(&input.chat_access_grants).unwrap_or_else(|_| "[]".to_string());
        sections.push(format!(
            "Approved chat access grants for this prompt. The backend has already resolved these grants into the server-injected chat context snapshot below. Use that snapshot before drafting interaction-based answers or approval actions. Use chat tools only if the snapshot is missing a clearly necessary bounded window:\n{grants}"
        ));
        if let Some(chat_context) = approved_chat_context
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            sections.push(format!("Approved chat context snapshot:\n{chat_context}"));
        }
        if looks_like_chat_context_question(&input.user_message) {
            sections.push(
                "Granted chat continuation: this prompt is resuming a task after the user approved chat access. Do not greet the user, ask what to work on, or answer from general knowledge. Continue the original task with evidence from the approved chat context snapshot."
                    .to_string(),
            );
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
    if !input.web_research_grants.is_empty() {
        let grants = input
            .web_research_grants
            .iter()
            .map(|grant| {
                let domains = if grant.scope.allowed_domains.is_empty() {
                    "any public web result".to_string()
                } else {
                    grant.scope.allowed_domains.join(", ")
                };
                format!(
                    "Grant {} from action {}: query=\"{}\"; allowed domains: {}; grantedAt: {}",
                    grant.id, grant.action_message_id, grant.scope.query, domains, grant.granted_at
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        sections.push(format!(
            "Approved web research grants for this turn. search_deki_web may be used only for these exact queries:\n{grants}"
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

fn looks_like_chat_context_question(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let explicit_chat_context = [
        "chat history",
        "conversation history",
        "message history",
        "approved chat context",
        "previous chat",
        "previous chats",
        "past chat",
        "past chats",
        "our chat",
        "our chats",
        "our conversation",
        "our conversations",
        "our roleplay",
        "our rp",
        "my roleplay",
        "my rp",
        "my interactions",
        "our interactions",
        "past interactions",
        "previous interactions",
        "interactions with",
        "how we interacted",
        "how i interacted",
        "how we talk",
        "how i talk",
        "the way we talk",
        "what we talked",
        "what happened in chat",
        "what happened in rp",
        "what happened in roleplay",
    ];
    if explicit_chat_context
        .iter()
        .any(|needle| lower.contains(needle))
    {
        return true;
    }

    let asks_for_user_evidence = ["based on", "draw from", "using", "use", "reflect", "match"]
        .iter()
        .any(|needle| lower.contains(needle));
    let mentions_prior_interaction = [
        "my chats",
        "our chats",
        "messages",
        "roleplay",
        "rp",
        "interactions",
        "interacted",
        "talked",
        "said",
        "relationship",
        "dynamic",
    ]
    .iter()
    .any(|needle| lower.contains(needle));
    let targets_creative_item = [
        "character",
        "persona",
        "card",
        "dialogue",
        "example",
        "profile",
        "lorebook",
        "prompt",
        "preset",
    ]
    .iter()
    .any(|needle| lower.contains(needle));

    asks_for_user_evidence && mentions_prior_interaction && targets_creative_item
}

fn deki_prompt_routing_message(message: &str) -> &str {
    message
        .rsplit_once("Latest user message:\n")
        .map(|(_, latest)| latest.trim())
        .unwrap_or(message)
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

async fn search_deki_web(
    args: SearchDekiWebArgs,
    grants: &[DekiWebResearchGrant],
) -> AppResult<Value> {
    let query = args.query.trim();
    if query.is_empty() {
        return Err(AppError::invalid_input("Web search query is required"));
    }
    let grant = deki_web_grant_for_query(query, grants).ok_or_else(|| {
        AppError::invalid_input(
            "Deki-senpai can only search the web after the user approves the exact search query.",
        )
    })?;
    let max_results = args
        .max_results
        .unwrap_or(DEKI_WEB_SEARCH_MAX_RESULTS)
        .clamp(1, DEKI_WEB_SEARCH_MAX_RESULTS);
    let effective_query = deki_web_effective_query(query, &grant.scope.allowed_domains);
    let url = deki_web_search_url(&effective_query)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DEKI_WEB_SEARCH_TIMEOUT_SECS))
        .user_agent("De-Koi Deki-senpai web research/1.0")
        .redirect(reqwest::redirect::Policy::limited(4))
        .build()
        .map_err(|error| AppError::new("deki_web_search_client_failed", error.to_string()))?;
    let html = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::new("deki_web_search_request_failed", error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::new("deki_web_search_status_failed", error.to_string()))?
        .text()
        .await
        .map_err(|error| AppError::new("deki_web_search_body_failed", error.to_string()))?;
    let results = deki_web_results_or_parse_error(&html, query, max_results)?;
    Ok(json!({
        "query": query,
        "grantId": grant.id,
        "actionMessageId": grant.action_message_id,
        "allowedDomains": grant.scope.allowed_domains,
        "results": results,
    }))
}

async fn read_deki_web_page(
    args: ReadDekiWebPageArgs,
    grants: &[DekiWebResearchGrant],
) -> AppResult<Value> {
    let query = args.query.trim();
    if query.is_empty() {
        return Err(AppError::invalid_input("Web page read query is required"));
    }
    let grant = deki_web_grant_for_query(query, grants).ok_or_else(|| {
        AppError::invalid_input(
            "Deki-senpai can only read web pages after the user approves the matching web research query.",
        )
    })?;
    let url = deki_web_page_url_for_grant(&args.url, grant)?;
    let client = deki_web_page_client()?;
    let (text, truncated) = if let Some(api_url) = deki_fandom_api_url_for_page(&url) {
        match fetch_deki_web_page_body(&client, &api_url).await {
            Ok((api_body, api_truncated)) => {
                match extract_deki_mediawiki_page_text(&api_body, DEKI_WEB_PAGE_MAX_CHARS) {
                    Ok(text) if !text.trim().is_empty() => (text, api_truncated),
                    _ => {
                        let (html_body, html_truncated) =
                            fetch_deki_web_page_body(&client, &url).await?;
                        (
                            extract_deki_fandom_page_text(
                                &api_body,
                                &html_body,
                                DEKI_WEB_PAGE_MAX_CHARS,
                            )?,
                            html_truncated,
                        )
                    }
                }
            }
            Err(_) => {
                let (html_body, html_truncated) = fetch_deki_web_page_body(&client, &url).await?;
                (
                    extract_deki_web_page_text(&html_body, DEKI_WEB_PAGE_MAX_CHARS),
                    html_truncated,
                )
            }
        }
    } else {
        let (body, truncated) = fetch_deki_web_page_body(&client, &url).await?;
        (
            extract_deki_web_page_text(&body, DEKI_WEB_PAGE_MAX_CHARS),
            truncated,
        )
    };
    if text.trim().is_empty() {
        return Err(AppError::new(
            "deki_web_page_no_readable_text",
            format!("No readable text could be extracted from {}", url.as_str()),
        ));
    }
    Ok(json!({
        "query": query,
        "grantId": grant.id,
        "url": url.as_str(),
        "text": text,
        "truncated": truncated,
    }))
}

async fn fetch_deki_web_page_body(
    client: &reqwest::Client,
    url: &reqwest::Url,
) -> AppResult<(String, bool)> {
    let bytes = client
        .get(url.clone())
        .send()
        .await
        .map_err(|error| AppError::new("deki_web_page_request_failed", error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::new("deki_web_page_status_failed", error.to_string()))?
        .bytes()
        .await
        .map_err(|error| AppError::new("deki_web_page_body_failed", error.to_string()))?;
    let truncated = bytes.len() > DEKI_WEB_PAGE_MAX_BYTES;
    let slice_len = bytes.len().min(DEKI_WEB_PAGE_MAX_BYTES);
    let body = String::from_utf8_lossy(&bytes[..slice_len]).to_string();
    Ok((body, truncated))
}
fn deki_web_page_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(DEKI_WEB_SEARCH_TIMEOUT_SECS))
        .user_agent("De-Koi Deki-senpai web research/1.0")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::new("deki_web_page_client_failed", error.to_string()))
}
fn deki_fandom_api_url_for_page(url: &reqwest::Url) -> Option<reqwest::Url> {
    let host = url.host_str()?;
    if !deki_web_domain_matches(host, "fandom.com") {
        return None;
    }
    let title = url.path().strip_prefix("/wiki/")?.trim_matches('/');
    if title.is_empty() {
        return None;
    }
    let mut api = reqwest::Url::parse(&format!("{}://{host}/api.php", url.scheme())).ok()?;
    api.query_pairs_mut()
        .append_pair("action", "query")
        .append_pair("prop", "extracts")
        .append_pair("explaintext", "1")
        .append_pair("redirects", "1")
        .append_pair("format", "json")
        .append_pair("titles", title);
    Some(api)
}

fn extract_deki_fandom_page_text(
    mediawiki_body: &str,
    fallback_html: &str,
    max_chars: usize,
) -> AppResult<String> {
    if let Ok(text) = extract_deki_mediawiki_page_text(mediawiki_body, max_chars) {
        if !text.trim().is_empty() {
            return Ok(text);
        }
    }

    let fallback_text = extract_deki_web_page_text(fallback_html, max_chars);
    if fallback_text.trim().is_empty() {
        return Err(AppError::new(
            "deki_web_page_no_readable_text",
            "Fandom API did not include readable extract text, and no readable text could be extracted from the page HTML.",
        ));
    }
    Ok(fallback_text)
}
fn extract_deki_mediawiki_page_text(body: &str, max_chars: usize) -> AppResult<String> {
    let parsed: Value = serde_json::from_str(body).map_err(|error| {
        AppError::new(
            "deki_web_page_mediawiki_invalid_json",
            format!("MediaWiki response was not valid JSON: {error}"),
        )
    })?;
    let pages = parsed
        .get("query")
        .and_then(|query| query.get("pages"))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::new(
                "deki_web_page_mediawiki_missing_extract",
                "MediaWiki response did not include pages.",
            )
        })?;
    let page = pages.values().next().ok_or_else(|| {
        AppError::new(
            "deki_web_page_mediawiki_missing_extract",
            "MediaWiki response did not include a page.",
        )
    })?;
    let title = page
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let extract = page
        .get("extract")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "deki_web_page_mediawiki_missing_extract",
                "MediaWiki response did not include readable extract text.",
            )
        })?;
    let combined = if title.is_empty() || extract.contains(title) {
        extract.to_string()
    } else {
        format!("{title}\n\n{extract}")
    };
    Ok(truncate_to_chars(&combined, max_chars).0)
}
fn deki_web_page_url_for_grant(url: &str, grant: &DekiWebResearchGrant) -> AppResult<reqwest::Url> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|error| AppError::invalid_input(format!("Web page URL is invalid: {error}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::new(
            "deki_web_page_scheme_not_allowed",
            "Only HTTP and HTTPS web page URLs are allowed.",
        ));
    }
    let host = parsed.host_str().unwrap_or_default();
    if !deki_web_host_is_public(host) {
        return Err(AppError::new(
            "deki_web_page_url_not_public",
            "Deki-senpai can only read public web page URLs.",
        ));
    }
    if !grant.scope.allowed_domains.is_empty()
        && !grant
            .scope
            .allowed_domains
            .iter()
            .any(|domain| deki_web_domain_matches(host, domain))
    {
        return Err(AppError::new(
            "deki_web_page_domain_not_allowed",
            "That URL is outside the domains approved for this web research grant.",
        ));
    }
    Ok(parsed)
}

fn deki_web_host_is_public(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host == "localhost" || host.ends_with(".localhost") {
        return false;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(ip) => {
                !(ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_unspecified()
                    || ip.is_broadcast()
                    || ip.octets()[0] == 0)
            }
            IpAddr::V6(ip) => {
                !(ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local())
            }
        };
    }
    true
}

fn deki_web_domain_matches(host: &str, approved_domain: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let approved = approved_domain
        .trim()
        .trim_end_matches('.')
        .trim_start_matches("*.")
        .to_ascii_lowercase();
    !approved.is_empty() && (host == approved || host.ends_with(&format!(".{approved}")))
}

fn extract_deki_web_page_text(html: &str, max_chars: usize) -> String {
    let without_scripts = remove_deki_html_element_blocks(html, "script");
    let without_styles = remove_deki_html_element_blocks(&without_scripts, "style");
    let without_noscript = remove_deki_html_element_blocks(&without_styles, "noscript");
    let title = html_tag_text(&without_noscript, "title");
    let body = html_tag_text(&without_noscript, "body");
    let source = if body.trim().is_empty() {
        without_noscript.as_str()
    } else {
        body.as_str()
    };
    let text = strip_deki_html(&decode_deki_html_entities(source));
    let combined = if title.trim().is_empty() {
        text
    } else if text.trim().is_empty() || text.contains(title.trim()) {
        title
    } else {
        format!("{}\n\n{}", title.trim(), text.trim())
    };
    truncate_to_chars(&combined, max_chars).0
}

fn html_tag_text(value: &str, tag: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let open_prefix = format!("<{tag}");
    let Some(open_start) = lower.find(&open_prefix) else {
        return String::new();
    };
    let Some(content_start_relative) = value[open_start..].find('>') else {
        return String::new();
    };
    let content_start = open_start + content_start_relative + 1;
    let close = format!("</{tag}>");
    let content_end = lower[content_start..]
        .find(&close)
        .map(|index| content_start + index)
        .unwrap_or(value.len());
    strip_deki_html(&decode_deki_html_entities(
        &value[content_start..content_end],
    ))
}

fn remove_deki_html_element_blocks(value: &str, tag: &str) -> String {
    let mut output = String::new();
    let mut rest = value;
    let open_prefix = format!("<{tag}");
    let close = format!("</{tag}>");
    loop {
        let lower = rest.to_ascii_lowercase();
        let Some(start) = lower.find(&open_prefix) else {
            output.push_str(rest);
            break;
        };
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let after_lower = after_start.to_ascii_lowercase();
        let Some(close_index) = after_lower.find(&close) else {
            break;
        };
        rest = &after_start[close_index + close.len()..];
    }
    output
}
fn deki_web_search_url(query: &str) -> AppResult<reqwest::Url> {
    reqwest::Url::parse_with_params("https://search.brave.com/search", &[("q", query)])
        .map_err(|error| AppError::new("deki_web_search_invalid_url", error.to_string()))
}
fn deki_web_grant_for_query<'a>(
    query: &str,
    grants: &'a [DekiWebResearchGrant],
) -> Option<&'a DekiWebResearchGrant> {
    let normalized_query = normalize_deki_web_query(query);
    grants.iter().find(|grant| {
        grant.scope.scope_type == "query"
            && normalize_deki_web_query(&grant.scope.query) == normalized_query
            && !deki_web_grant_is_expired(grant)
    })
}

fn deki_web_grant_is_expired(grant: &DekiWebResearchGrant) -> bool {
    let Some(expires_at) = grant
        .expires_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(expires_at)
        .map(|expires_at| expires_at.with_timezone(&chrono::Utc) <= chrono::Utc::now())
        .unwrap_or(true)
}

fn normalize_deki_web_query(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn deki_web_effective_query(query: &str, allowed_domains: &[String]) -> String {
    let domains = allowed_domains
        .iter()
        .map(|domain| domain.trim())
        .filter(|domain| !domain.is_empty())
        .map(|domain| format!("site:{domain}"))
        .collect::<Vec<_>>();
    if domains.is_empty() {
        query.to_string()
    } else {
        format!("{} {}", query, domains.join(" OR "))
    }
}

fn deki_web_results_or_parse_error(
    html: &str,
    query: &str,
    max_results: usize,
) -> AppResult<Vec<Value>> {
    let results = extract_deki_web_results(html, max_results);
    if results.is_empty() {
        return Err(AppError::new(
            "deki_web_search_no_results",
            format!(
                "No parseable web search results were returned for '{query}'. The search provider may have returned an interstitial or changed its HTML."
            ),
        ));
    }
    Ok(results)
}
fn extract_deki_web_results(html: &str, max_results: usize) -> Vec<Value> {
    let mut results = extract_duckduckgo_web_results(html, max_results);
    if results.len() < max_results {
        for result in extract_brave_web_results(html, max_results - results.len()) {
            let url = result
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !results
                .iter()
                .any(|existing| existing.get("url").and_then(Value::as_str) == Some(url))
            {
                results.push(result);
            }
        }
    }
    results.truncate(max_results);
    results
}

fn extract_duckduckgo_web_results(html: &str, max_results: usize) -> Vec<Value> {
    let mut results = Vec::new();
    let mut rest = html;
    while results.len() < max_results {
        let Some(anchor_start) = rest.find("<a") else {
            break;
        };
        rest = &rest[anchor_start..];
        let Some(tag_end) = rest.find('>') else {
            break;
        };
        let anchor_tag = &rest[..tag_end];
        if !anchor_tag.contains("result__a") {
            rest = &rest[tag_end..];
            continue;
        }
        let Some(anchor_close) = rest[tag_end + 1..].find("</a>") else {
            break;
        };
        let title_html = &rest[tag_end + 1..tag_end + 1 + anchor_close];
        let href = html_attr_value(anchor_tag, "href")
            .map(|href| normalize_deki_web_result_url(&href))
            .unwrap_or_default();
        let title = strip_deki_html(&decode_deki_html_entities(title_html));
        let after_anchor = &rest[tag_end + 1 + anchor_close + "</a>".len()..];
        let snippet = deki_web_snippet_after_anchor(after_anchor);
        if !title.trim().is_empty() || !href.trim().is_empty() {
            results.push(json!({
                "title": title.trim(),
                "url": href,
                "snippet": snippet,
            }));
        }
        rest = after_anchor;
    }
    results
}

fn extract_brave_web_results(html: &str, max_results: usize) -> Vec<Value> {
    let mut results = Vec::new();
    let mut rest = html;
    while results.len() < max_results {
        let Some(snippet_start) = rest.find("<div class=\"snippet") else {
            break;
        };
        rest = &rest[snippet_start..];
        let next_snippet = rest["<div class=\"snippet".len()..]
            .find("<div class=\"snippet")
            .map(|index| index + "<div class=\"snippet".len())
            .unwrap_or(rest.len());
        let block = &rest[..next_snippet];
        if !block.contains("data-type=\"web\"") {
            rest = &rest[next_snippet..];
            continue;
        }
        let Some(anchor_start) = block.find("<a") else {
            rest = &rest[next_snippet..];
            continue;
        };
        let anchor = &block[anchor_start..];
        let Some(tag_end) = anchor.find('>') else {
            rest = &rest[next_snippet..];
            continue;
        };
        let anchor_tag = &anchor[..tag_end];
        let href = html_attr_value(anchor_tag, "href")
            .map(|href| normalize_deki_web_result_url(&href))
            .unwrap_or_default();
        let title = html_class_text(block, "search-snippet-title");
        let snippet = html_class_text(block, "generic-snippet");
        if !title.trim().is_empty() || !href.trim().is_empty() {
            results.push(json!({
                "title": title.trim(),
                "url": href,
                "snippet": snippet,
            }));
        }
        rest = &rest[next_snippet..];
    }
    results
}

fn html_class_text(value: &str, class_marker: &str) -> String {
    let Some(class_index) = value.find(class_marker) else {
        return String::new();
    };
    let value = &value[class_index..];
    let Some(start) = value.find('>') else {
        return String::new();
    };
    let after_start = &value[start + 1..];
    let end = after_start.find("</div>").unwrap_or(after_start.len());
    strip_deki_html(&decode_deki_html_entities(&after_start[..end]))
        .trim()
        .to_string()
}
fn deki_web_snippet_after_anchor(value: &str) -> String {
    let Some(snippet_index) = value.find("result__snippet") else {
        return String::new();
    };
    let snippet = &value[snippet_index..];
    let Some(start) = snippet.find('>') else {
        return String::new();
    };
    let after_start = &snippet[start + 1..];
    let end = after_start
        .find("</a>")
        .or_else(|| after_start.find("</div>"))
        .unwrap_or(after_start.len());
    strip_deki_html(&decode_deki_html_entities(&after_start[..end]))
        .trim()
        .to_string()
}

fn html_attr_value(tag: &str, attr: &str) -> Option<String> {
    let double_quote_pattern = format!("{attr}=\"");
    if let Some(start) = tag.find(&double_quote_pattern) {
        let rest = &tag[start + double_quote_pattern.len()..];
        let end = rest.find('"')?;
        return Some(decode_deki_html_entities(&rest[..end]));
    }
    let single_quote_pattern = format!("{attr}='");
    let start = tag.find(&single_quote_pattern)? + single_quote_pattern.len();
    let rest = &tag[start..];
    let end = rest.find('\'')?;
    Some(decode_deki_html_entities(&rest[..end]))
}

fn normalize_deki_web_result_url(href: &str) -> String {
    let href = href.trim();
    let parsed = reqwest::Url::parse(href)
        .or_else(|_| reqwest::Url::parse("https://duckduckgo.com")?.join(href));
    let Ok(parsed) = parsed else {
        return href.to_string();
    };
    if parsed.domain() == Some("duckduckgo.com") && parsed.path().starts_with("/l/") {
        if let Some((_, target)) = parsed.query_pairs().find(|(key, _)| key == "uddg") {
            return target.into_owned();
        }
    }
    parsed.to_string()
}

fn decode_deki_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn strip_deki_html(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
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

    #[test]
    fn deki_tool_result_conversion_preserves_all_tool_outputs() {
        let message = ChatMessage {
            role: ChatRole::Tool,
            message_type: MessageType::ToolResult(vec![
                ToolCall {
                    id: "call_one".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "read_deki_chats".to_string(),
                        arguments: r#"{"items":[{"id":"chat-1"}]}"#.to_string(),
                    },
                },
                ToolCall {
                    id: "call_two".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "read_deki_chat_messages".to_string(),
                        arguments: r#"{"messages":[{"content":"hello"}]}"#.to_string(),
                    },
                },
            ]),
            content: String::new(),
        };

        let converted = autoagents_message_to_marinara(&message);

        assert_eq!(converted.len(), 2);
        assert_eq!(converted[0].role, "tool");
        assert_eq!(converted[0].tool_call_id.as_deref(), Some("call_one"));
        assert!(converted[0].content.contains("chat-1"));
        assert_eq!(converted[1].tool_call_id.as_deref(), Some("call_two"));
        assert!(converted[1].content.contains("hello"));
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
    fn deki_openai_chatgpt_connections_use_responses_tool_choice() {
        let connection = test_connection("openai_chatgpt");
        let messages = [text_message("What does src/app/shell/AppShell.tsx do?")];
        let tools = [test_tool("search_deki_code")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert_eq!(
            parameters["toolChoice"],
            json!({
                "type": "function",
                "name": "search_deki_code"
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
    fn deki_interaction_based_library_prompt_requests_chat_access_before_library_routing() {
        let connection = test_connection("openai");
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
        let messages = [text_message(&task_prompt)];
        let tools = [test_tool("read_deki_library"), test_tool("read_deki_chats")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert!(parameters.get("toolChoice").is_none());
        assert!(task_prompt.contains("Chat context assessment"));
        assert!(task_prompt.contains("must request scoped chat access"));
        assert!(looks_like_chat_context_question(&input.user_message));
    }

    #[test]
    fn deki_interaction_based_prompt_uses_chat_context_snapshot_after_grant() {
        let connection = test_connection("openai");
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
        let messages = [text_message(&task_prompt)];
        let tools = [test_tool("read_deki_library"), test_tool("read_deki_chats")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert!(task_prompt.contains("Granted chat continuation"));
        assert!(task_prompt.contains("Do not greet the user"));
        assert!(task_prompt.contains("Approved chat context snapshot"));
        assert!(task_prompt.contains("Rina mentioned liking piano"));
        assert!(parameters.get("toolChoice").is_none());
    }

    #[test]
    fn deki_resume_prompt_uses_chat_context_snapshot_after_grant() {
        let connection = test_connection("openai_chatgpt");
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
        let messages = [text_message(&task_prompt)];
        let tools = [test_tool("read_deki_library"), test_tool("read_deki_chats")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert!(task_prompt.contains("Approved chat context snapshot"));
        assert!(task_prompt.contains("Makima discussed calm orchestral music"));
        assert!(parameters.get("toolChoice").is_none());
    }

    #[test]
    fn deki_synthesizes_forced_chat_tool_call_when_provider_returns_text() {
        let parameters = json!({
            "toolChoice": {
                "type": "function",
                "name": "read_deki_chats"
            }
        });
        let tools = [test_tool("read_deki_chats")];

        let tool_calls = deki_forced_chat_tool_call(&parameters, &tools);

        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].id, "deki_forced_read_deki_chats");
        assert_eq!(tool_calls[0].function.name, "read_deki_chats");
        assert_eq!(tool_calls[0].function.arguments, "{}");
    }

    #[test]
    fn deki_forced_chat_tool_call_does_not_synthesize_unrelated_tools() {
        let parameters = json!({
            "toolChoice": {
                "type": "function",
                "function": { "name": "search_deki_code" }
            }
        });
        let tools = [test_tool("search_deki_code"), test_tool("read_deki_chats")];

        let tool_calls = deki_forced_chat_tool_call(&parameters, &tools);

        assert!(tool_calls.is_empty());
    }

    #[test]
    fn deki_approved_web_research_grants_force_web_search_tool_choice() {
        let connection = test_connection("openai");
        let messages = [text_message(
            "Approved web research grants for this turn. search_deki_web may be used only for these exact queries:\nGrant grant-1 from action message-1: query=\"Ghostface Dead by Daylight lore personality\"; allowed domains: deadbydaylight.fandom.com; grantedAt: 2026-06-28T12:00:00Z\n\nLatest user message:\nCan you check Ghostface?",
        )];
        let tools = [test_tool("search_deki_web")];

        let parameters = deki_request_parameters(&connection, &messages, &tools);

        assert_eq!(
            parameters["toolChoice"],
            json!({
                "type": "function",
                "function": { "name": "search_deki_web" }
            })
        );
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

<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol","description":"Sunny traveler"},"label":"Create Sol","rationale":"Matches the user's brief."}</deki_action>"#;

        let (content, action) = deki_response_content_and_action(raw).expect("action should parse");

        assert_eq!(content, "I drafted Sol for approval.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["name"], "Sol");
        assert!(!content.contains("deki_action"));
    }

    #[test]
    fn deki_response_repairs_raw_newlines_inside_action_strings() {
        let raw = "I drafted Sol for approval.\n\n<deki_action>{\"type\":\"create_record\",\"entity\":\"personas\",\"draft\":{\"name\":\"Sol\",\"description\":\"Line one
Line two\"},\"label\":\"Create Sol\",\"rationale\":\"Matches the user's brief.\"}</deki_action>";

        let (content, action) = deki_response_content_and_action(raw)
            .expect("action strings with raw newlines should parse");

        assert_eq!(content, "I drafted Sol for approval.");
        assert_eq!(action["type"], "create_record");
        assert_eq!(action["entity"], "personas");
        assert_eq!(action["draft"]["description"], "Line one\nLine two");
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
<deki_action>{"type":"create_record","entity":"personas","draft":{"name":"Sol"}} This draft creates the requested persona.</deki_action>"#;

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
    fn deki_web_page_tool_rejects_reads_without_matching_grant() {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build test runtime")
            .block_on(ReadDekiWebPageTool { grants: Vec::new() }.execute(json!({
                "query": "Ghostface Dead by Daylight lore personality",
                "url": "https://deadbydaylight.fandom.com/wiki/Danny_Johnson_alias_Jed_Olsen"
            })));

        let error = result.expect_err("page reads should require a matching grant");
        let message = format!("{error:?}");

        assert!(message.contains("matching web research query"));
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
