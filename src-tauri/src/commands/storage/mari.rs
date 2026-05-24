use super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
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
use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;
use std::sync::Arc;

const CREATIVE_LIBRARY_ENTITIES: &[(&str, &str)] = &[
    ("characters", "characters"),
    ("characterGroups", "character-groups"),
    ("personas", "personas"),
    ("personaGroups", "persona-groups"),
    ("lorebooks", "lorebooks"),
    ("lorebookEntries", "lorebook-entries"),
    ("promptPresets", "prompts"),
    ("promptSections", "prompt-sections"),
    ("promptGroups", "prompt-groups"),
    ("promptVariables", "prompt-variables"),
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MariPromptRequest {
    user_message: String,
    #[serde(default)]
    messages: Vec<MariPromptMessage>,
    #[serde(default)]
    connection_id: Option<String>,
    #[serde(default)]
    persona: Option<MariPersonaContext>,
    #[serde(default)]
    attachments: Vec<MariAttachment>,
}

#[derive(Debug, Deserialize)]
struct MariPromptMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MariPersonaContext {
    name: Option<String>,
    comment: Option<String>,
    description: Option<String>,
    personality: Option<String>,
    scenario: Option<String>,
    backstory: Option<String>,
    appearance: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MariAttachment {
    name: String,
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    size: u64,
    content: String,
}

#[derive(Clone, Debug)]
struct MarinaraLlmProvider {
    connection: marinara_llm::LlmConnection,
}

#[derive(Debug)]
struct MarinaraChatResponse {
    content: String,
    tool_calls: Vec<ToolCall>,
}

impl fmt::Display for MarinaraChatResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.content)
    }
}

impl ChatResponse for MarinaraChatResponse {
    fn text(&self) -> Option<String> {
        Some(self.content.clone())
    }

    fn tool_calls(&self) -> Option<Vec<ToolCall>> {
        Some(self.tool_calls.clone())
    }
}

#[async_trait]
impl ChatProvider for MarinaraLlmProvider {
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
            parameters: mari_request_parameters(messages, tools.unwrap_or_default()),
            tools: tools
                .unwrap_or_default()
                .iter()
                .map(|tool| serde_json::to_value(&tool.function).unwrap_or_else(|_| json!({})))
                .collect(),
        };
        let response = marinara_llm::complete_rich(request)
            .await
            .map_err(|error| LLMError::ProviderError(error.to_string()))?;
        Ok(Box::new(MarinaraChatResponse {
            content: response.content,
            tool_calls: response
                .tool_calls
                .into_iter()
                .filter_map(marinara_tool_call_to_autoagents)
                .collect(),
        }))
    }
}

fn mari_request_parameters(messages: &[ChatMessage], tools: &[Tool]) -> Value {
    let mut parameters = json!({
                "temperature": 0.4,
                "maxTokens": 2048,
    });
    let has_tool_result = messages
        .iter()
        .any(|message| matches!(message.message_type, MessageType::ToolResult(_)));
    let latest_user = messages
        .iter()
        .rev()
        .find(|message| matches!(message.role, ChatRole::User))
        .map(|message| message.content.as_str())
        .unwrap_or_default();
    if !tools.is_empty() && !has_tool_result && looks_like_library_question(latest_user) {
        parameters["toolChoice"] = json!({
            "type": "function",
            "function": { "name": "read_marinara_library" }
        });
    }
    parameters
}

#[async_trait]
impl CompletionProvider for MarinaraLlmProvider {
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
impl EmbeddingProvider for MarinaraLlmProvider {
    async fn embed(&self, _input: Vec<String>) -> Result<Vec<Vec<f32>>, LLMError> {
        Err(LLMError::ProviderError(
            "Professor Mari does not expose embeddings in v1".to_string(),
        ))
    }
}

#[async_trait]
impl ModelsProvider for MarinaraLlmProvider {
    async fn list_models(
        &self,
        _request: Option<&ModelListRequest>,
    ) -> Result<Box<dyn ModelListResponse>, LLMError> {
        Err(LLMError::ProviderError(
            "Professor Mari model listing is owned by Marinara connections".to_string(),
        ))
    }
}

impl LLMProvider for MarinaraLlmProvider {}

#[derive(Serialize, Deserialize, ToolInput, Debug)]
struct ReadMarinaraLibraryArgs {}

#[tool(
    name = "read_marinara_library",
    description = "Read Professor Mari's typed, read-only creative library snapshot: characters, personas, lorebooks with entries, prompt presets, prompt sections, prompt groups, prompt variables, and character/persona groups. This tool never returns chats, messages, memories, integrations, API keys, or connection secrets.",
    input = ReadMarinaraLibraryArgs,
)]
struct ReadMarinaraLibraryTool {
    state: AppState,
}

#[async_trait]
impl ToolRuntime for ReadMarinaraLibraryTool {
    async fn execute(&self, _args: Value) -> Result<Value, ToolCallError> {
        creative_library_snapshot(&self.state).map_err(|error| {
            ToolCallError::RuntimeError(Box::new(AppError::new(
                "mari_library_read_failed",
                error.to_string(),
            )))
        })
    }
}

#[agent(
    name = "professor_mari",
    description = "You are Professor Mari, Marinara's standalone assistant. You answer the user's question clearly and can inspect Marinara's creative library by calling read_marinara_library. You must not claim to edit data, run shell commands, or access chats/messages/memories. If the user asks what library data is available, call the tool.",
    tools = [ReadMarinaraLibraryTool { state: self.state.clone() }],
)]
#[derive(Clone, AgentHooks)]
struct ProfessorMariAgent {
    state: AppState,
}

pub(crate) async fn professor_mari_prompt(state: &AppState, body: Value) -> AppResult<Value> {
    let input: MariPromptRequest = serde_json::from_value(body.clone())
        .map_err(|error| AppError::invalid_input(error.to_string()))?;
    let connection_value = resolve_llm_connection_for_request(
        state,
        &json!({
            "connectionId": input.connection_id,
        }),
    )?;
    let connection = llm_connection_from_value(&connection_value)?;
    ensure_connection_supports_native_tools(&connection)?;
    let system_prompt = build_system_prompt(input.persona.as_ref());
    let task_prompt = build_task_prompt(&input);
    let provider: Arc<dyn LLMProvider> = Arc::new(MarinaraLlmProvider { connection });
    let memory = Box::new(SlidingWindowMemory::new(12));
    let agent = ReActAgent::with_max_turns(
        ProfessorMariAgent {
            state: state.clone(),
        },
        4,
    );
    let agent_handle = AgentBuilder::<_, DirectAgent>::new(agent)
        .llm(provider)
        .memory(memory)
        .build()
        .await
        .map_err(|error| AppError::new("mari_agent_create_failed", error.to_string()))?;
    let task = Task::new(task_prompt).with_system_prompt(system_prompt);
    let response = agent_handle.agent.run(task).await.map_err(|error| {
        AppError::new(
            "mari_agent_failed",
            tool_call_error_message(&error.to_string()),
        )
    })?;

    Ok(json!({
        "content": response.to_string(),
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "action": read_only_mari_action_contract(),
    }))
}

fn read_only_mari_action_contract() -> Value {
    json!({
        "type": "none",
        "capability": "read_only",
        "reason": "Professor Mari v1 can inspect the creative library but cannot create or edit records.",
    })
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
            .unwrap_or("mari_tool_call")
            .to_string(),
        call_type: value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("function")
            .to_string(),
        function: FunctionCall { name, arguments },
    })
}

fn build_system_prompt(persona: Option<&MariPersonaContext>) -> String {
    let mut parts = vec![
        "You are Professor Mari, a standalone assistant inside Marinara Engine.".to_string(),
        "You can chat with the user and read the creative library through read_marinara_library.".to_string(),
        "The read-only library tool returns typed JSON objects. Do not invent data if the tool is needed.".to_string(),
        "You cannot mutate records, run shell commands, inspect private chats, or access secrets in v1.".to_string(),
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

fn build_task_prompt(input: &MariPromptRequest) -> String {
    let mut sections = Vec::new();
    let history = input
        .messages
        .iter()
        .rev()
        .take(16)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
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
        let attachments = input
            .attachments
            .iter()
            .map(|attachment| {
                format!(
                    "File: {}\nType: {}\nSize: {}\nContent:\n{}",
                    attachment.name, attachment.r#type, attachment.size, attachment.content
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");
        sections.push(format!(
            "Attached files for the latest user turn:\n{attachments}"
        ));
    }
    sections.push(format!(
        "Latest user message:\n{}",
        input.user_message.trim()
    ));
    sections.join("\n\n")
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

fn ensure_connection_supports_native_tools(
    connection: &marinara_llm::LlmConnection,
) -> AppResult<()> {
    match connection.provider.as_str() {
        "openai" | "openai_chatgpt" | "openrouter" | "custom" | "xai" | "mistral" | "cohere" | "nanogpt" => Ok(()),
        provider => Err(AppError::invalid_input(format!(
            "Professor Mari requires a connection with native tool-call support. The selected provider '{provider}' is not enabled for native tools in Marinara's Rust LLM transport yet. Use an OpenAI-compatible, OpenRouter, OpenAI, xAI, Mistral, Cohere, NanoGPT, or custom OpenAI-compatible connection with a tool-capable chat model."
        ))),
    }
}

fn tool_call_error_message(message: &str) -> String {
    if message.contains("Provider response did not contain assistant text or tool calls") {
        return "The selected model/provider did not return a native tool call or assistant message. Professor Mari's read-library path requires native tool calling; choose a tool-capable chat model on the selected connection.".to_string();
    }
    message.to_string()
}

fn creative_library_snapshot(state: &AppState) -> AppResult<Value> {
    let mut snapshot = serde_json::Map::new();
    for (key, entity) in CREATIVE_LIBRARY_ENTITIES {
        let rows = state.storage.list(entity)?;
        snapshot.insert((*key).to_string(), Value::Array(rows));
    }
    Ok(Value::Object(snapshot))
}
