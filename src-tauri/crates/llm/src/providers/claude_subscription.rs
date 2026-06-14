use crate::*;

pub(crate) fn render_claude_subscription_transcript(
    messages: &[LlmMessage],
) -> (Option<String>, String) {
    let mut system = Vec::new();
    let mut turns = Vec::new();
    for message in messages {
        let content = message.content.trim();
        if message.role == "system" {
            if content.is_empty() {
                continue;
            }
            system.push(content.to_string());
            continue;
        }
        let Some(content) = claude_subscription_visible_message_text(message) else {
            continue;
        };
        let label = if message.role == "assistant" {
            "Assistant"
        } else {
            "User"
        };
        turns.push(format!("{label}: {content}"));
    }
    if turns.is_empty() {
        turns.push("User: [Start]".to_string());
    }
    (
        (!system.is_empty()).then(|| system.join("\n\n")),
        turns.join("\n\n"),
    )
}

#[derive(Debug)]
pub(crate) struct ClaudeSubscriptionPrompt {
    pub(crate) system_prompt: Option<String>,
    pub(crate) prompt: String,
    pub(crate) session_id: Option<String>,
    pub(crate) prompt_shape: &'static str,
}

pub(crate) fn disabled_env_flag(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "0" | "false" | "no" | "off"
    )
}

pub(crate) fn claude_subscription_resume_enabled() -> bool {
    normalize_env_value(env::var("CLAUDE_SUBSCRIPTION_USE_RESUME").ok())
        .as_deref()
        .map(|value| !disabled_env_flag(value))
        .unwrap_or(true)
}

pub(crate) fn marinara_runtime_metadata(
    parameters: &Value,
) -> Option<&serde_json::Map<String, Value>> {
    parameters.get("_marinara")?.as_object()
}

pub(crate) fn claude_subscription_chat_id(parameters: &Value) -> Option<String> {
    marinara_runtime_metadata(parameters)?
        .get("chatId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn claude_subscription_should_use_session(parameters: &Value) -> bool {
    let Some(metadata) = marinara_runtime_metadata(parameters) else {
        return false;
    };
    let regenerate = metadata
        .get("regenerateMessageId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    let impersonate = metadata
        .get("impersonate")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    claude_subscription_resume_enabled() && !regenerate && !impersonate
}

pub(crate) fn claude_subscription_session_id(chat_id: &str) -> String {
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("marinara-engine:claude-subscription:{chat_id}").as_bytes(),
    )
    .to_string()
}

pub(crate) fn claude_subscription_scratch_cwd_in(base: &Path) -> AppResult<PathBuf> {
    let dir = base.join("marinara-claude-subscription-scratch");
    fs::create_dir_all(&dir).map_err(|error| {
        AppError::new(
            "claude_subscription_session_error",
            format!(
                "Claude subscription session scratch directory could not be created: {}",
                redact_sensitive_text(&error.to_string())
            ),
        )
    })?;
    Ok(dir)
}

pub(crate) fn claude_subscription_scratch_cwd() -> AppResult<PathBuf> {
    claude_subscription_scratch_cwd_in(&env::temp_dir())
}

pub(crate) fn claude_subscription_visible_message_text(message: &LlmMessage) -> Option<String> {
    let content = message.content.trim();
    if !content.is_empty() {
        return Some(content.to_string());
    }
    None
}

pub(crate) fn claude_subscription_image_attachment_count(messages: &[LlmMessage]) -> usize {
    messages.iter().map(|message| message.images.len()).sum()
}

pub(crate) fn ensure_claude_subscription_supports_messages(
    messages: &[LlmMessage],
) -> AppResult<()> {
    let count = claude_subscription_image_attachment_count(messages);
    if count == 0 {
        return Ok(());
    }
    Err(AppError::with_details(
        "claude_subscription_unsupported_capability",
        format!(
            "Claude subscription cannot send {count} image attachment(s) through the current Claude Code CLI prompt path. Remove the attachment(s) or use an image-capable provider such as Anthropic API."
        ),
        json!({
            "capability": "image_attachments",
            "imageAttachmentCount": count
        }),
    ))
}

pub(crate) fn render_claude_subscription_history_turn(message: &LlmMessage) -> Option<String> {
    let content = claude_subscription_visible_message_text(message)?;
    let label = match message.role.as_str() {
        "assistant" => "Assistant",
        "tool" => "Tool result",
        _ => "User",
    };
    Some(format!("{label}: {content}"))
}

pub(crate) fn render_claude_subscription_history_context(
    history: &[&LlmMessage],
) -> Option<String> {
    let turns = history
        .iter()
        .filter_map(|message| render_claude_subscription_history_turn(message))
        .collect::<Vec<_>>();
    (!turns.is_empty()).then(|| turns.join("\n\n"))
}

pub(crate) fn claude_subscription_session_prompt_with_history(
    history: &[&LlmMessage],
    current_prompt: &str,
    current_label: Option<&str>,
) -> String {
    let Some(history) = render_claude_subscription_history_context(history) else {
        return current_prompt.to_string();
    };
    let current = current_label
        .map(|label| format!("{label}: {current_prompt}"))
        .unwrap_or_else(|| current_prompt.to_string());
    format!("Previous Marinara conversation:\n{history}\n\nCurrent turn:\n{current}")
}

pub(crate) fn render_claude_subscription_current_prompt(
    messages: &[LlmMessage],
) -> (Option<String>, String, &'static str) {
    let mut system = Vec::new();
    let mut non_system = Vec::new();
    for message in messages {
        let content = message.content.trim();
        if content.is_empty() && message.images.is_empty() {
            continue;
        }
        if message.role == "system" {
            if !content.is_empty() {
                system.push(content.to_string());
            }
        } else {
            non_system.push(message);
        }
    }

    let Some(trailing) = non_system.last() else {
        return (
            (!system.is_empty()).then(|| system.join("\n\n")),
            "[Start]".to_string(),
            "synthetic-start",
        );
    };
    if trailing.role == "assistant" {
        let prompt =
            claude_subscription_session_prompt_with_history(&non_system, "(continue)", None);
        return (
            (!system.is_empty()).then(|| system.join("\n\n")),
            prompt,
            "trailing-assistant-continue",
        );
    }
    let history = &non_system[..non_system.len().saturating_sub(1)];
    let current_text = claude_subscription_visible_message_text(trailing).unwrap_or_default();
    let current_prompt = if trailing.role == "tool" {
        format!("Tool result: {current_text}")
    } else {
        current_text
    };
    let prompt = claude_subscription_session_prompt_with_history(
        history,
        &current_prompt,
        (trailing.role != "tool").then_some("User"),
    );
    (
        (!system.is_empty()).then(|| system.join("\n\n")),
        prompt,
        if trailing.role == "tool" {
            "trailing-tool"
        } else {
            "trailing-user"
        },
    )
}

pub(crate) fn claude_subscription_prompt(request: &LlmRequest) -> AppResult<ClaudeSubscriptionPrompt> {
    let messages = request_messages(request);
    ensure_claude_subscription_supports_messages(&messages)?;
    if claude_subscription_should_use_session(&request.parameters) {
        if let Some(chat_id) = claude_subscription_chat_id(&request.parameters) {
            let (system_prompt, prompt, prompt_shape) =
                render_claude_subscription_current_prompt(&messages);
            return Ok(ClaudeSubscriptionPrompt {
                system_prompt,
                prompt,
                session_id: Some(claude_subscription_session_id(&chat_id)),
                prompt_shape,
            });
        }
    }
    let (system_prompt, prompt) = render_claude_subscription_transcript(&messages);
    Ok(ClaudeSubscriptionPrompt {
        system_prompt,
        prompt,
        session_id: None,
        prompt_shape: "transcript-fold",
    })
}

pub(crate) fn claude_subscription_command() -> String {
    env::var("CLAUDE_CODE_COMMAND")
        .or_else(|_| env::var("CLAUDE_COMMAND"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "claude".to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ClaudeSubscriptionModelSelection {
    pub(crate) configured_model: String,
    pub(crate) cli_model: String,
    pub(crate) long_context_beta: bool,
}

pub(crate) fn claude_subscription_model_selection(model: &str) -> ClaudeSubscriptionModelSelection {
    let configured_model = model.trim().to_string();
    let Some(base_model) = configured_model
        .strip_suffix(CLAUDE_SUBSCRIPTION_1M_SUFFIX)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return ClaudeSubscriptionModelSelection {
            cli_model: configured_model.clone(),
            configured_model,
            long_context_beta: false,
        };
    };
    let cli_model = base_model.to_string();
    ClaudeSubscriptionModelSelection {
        configured_model,
        cli_model,
        long_context_beta: true,
    }
}

pub(crate) fn claude_subscription_model_args(
    selection: &ClaudeSubscriptionModelSelection,
) -> Vec<String> {
    let mut args = vec!["--model".to_string(), selection.cli_model.clone()];
    if selection.long_context_beta {
        args.push("--betas".to_string());
        args.push(CLAUDE_SUBSCRIPTION_1M_BETA.to_string());
    }
    args
}

pub fn check_claude_subscription_available() -> AppResult<String> {
    let command_name = claude_subscription_command();
    let mut command = Command::new(&command_name);
    command
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|error| {
        AppError::new(
            "claude_subscription_unavailable",
            format!(
                "Failed to start Claude Code. Install @anthropic-ai/claude-code, run `claude login`, or set CLAUDE_CODE_COMMAND. Underlying error: {error}"
            ),
        )
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::new(
            "claude_subscription_unavailable",
            if stderr.trim().is_empty() {
                "Claude Code is installed but did not respond to --version.".to_string()
            } else {
                stderr.trim().to_string()
            },
        ));
    }
    let session_state = if claude_subscription_resume_enabled() {
        "chat-scoped Claude Code sessions are enabled"
    } else {
        "chat-scoped Claude Code sessions are disabled by CLAUDE_SUBSCRIPTION_USE_RESUME"
    };
    Ok(format!(
        "Claude Code command is available; {session_state}. The first chat will fail if `claude login` has not been run on this host."
    ))
}

pub(crate) fn claude_subscription_text_from_json(value: &Value) -> Option<String> {
    if let Some(text) = value
        .get("result")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        return Some(text.to_string());
    }
    if let Some(text) = value
        .get("response")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        return Some(text.to_string());
    }
    if let Some(text) = value
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        return Some(text.to_string());
    }
    if let Some(message) = value.get("message") {
        if let Some(content) = message.get("content").and_then(Value::as_array) {
            let text = content
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("");
            if !text.trim().is_empty() {
                return Some(text);
            }
        }
    }
    if let Some(content) = value.get("content").and_then(Value::as_array) {
        let text = content
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("");
        if !text.trim().is_empty() {
            return Some(text);
        }
    }
    None
}

pub(crate) fn claude_subscription_output_diagnostic(value: &Value) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(subtype) = value.get("subtype").and_then(Value::as_str) {
        parts.push(format!("subtype={subtype}"));
    }
    if let Some(fast_mode_state) = value.get("fast_mode_state").and_then(Value::as_str) {
        parts.push(format!("fast_mode_state={fast_mode_state}"));
    }
    if let Some(usage) = value.get("usage").and_then(Value::as_object) {
        if let Some(input_tokens) = usage.get("input_tokens").and_then(Value::as_u64) {
            parts.push(format!("input_tokens={input_tokens}"));
        }
        if let Some(output_tokens) = usage.get("output_tokens").and_then(Value::as_u64) {
            parts.push(format!("output_tokens={output_tokens}"));
        }
    }
    if let Some(model_usage) = value.get("modelUsage").and_then(Value::as_object) {
        let models = model_usage.keys().cloned().collect::<Vec<_>>();
        if !models.is_empty() {
            parts.push(format!("billed_models={}", models.join(",")));
        }
    }
    (!parts.is_empty()).then(|| parts.join(", "))
}

pub(crate) fn claude_subscription_json_declares_empty_result(value: &Value) -> bool {
    let has_result_shape = value.get("result").is_some()
        || value.get("response").is_some()
        || value.get("text").is_some()
        || value.get("message").is_some()
        || value.get("content").is_some();
    has_result_shape && claude_subscription_text_from_json(value).is_none()
}

pub(crate) fn log_claude_subscription_status(value: &Value, requested_model: &str) {
    let used_models = value
        .get("modelUsage")
        .and_then(Value::as_object)
        .map(|models| models.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let fast_mode_state = value.get("fast_mode_state").and_then(Value::as_str);
    if !used_models.is_empty() && !used_models.iter().any(|model| model == requested_model) {
        eprintln!(
            "[claude-subscription] requested {requested_model} but Claude Code reported billed models {} (fast_mode_state={})",
            used_models.join(","),
            fast_mode_state.unwrap_or("unknown")
        );
    } else if fast_mode_state.is_some_and(|state| state != "off") {
        eprintln!(
            "[claude-subscription] fast_mode_state={} for {requested_model}; output may come from fast-mode routing",
            fast_mode_state.unwrap_or("unknown")
        );
    }
}

pub(crate) fn claude_subscription_usage_from_json(value: &Value) -> Option<Value> {
    let mut usage = value.get("usage").cloned().unwrap_or_else(|| json!({}));
    let Some(usage_object) = usage.as_object_mut() else {
        return Some(usage);
    };
    if let Some(model_usage) = value.get("modelUsage") {
        usage_object.insert("modelUsage".to_string(), model_usage.clone());
    }
    if let Some(fast_mode_state) = value.get("fast_mode_state") {
        usage_object.insert("fastModeState".to_string(), fast_mode_state.clone());
    }
    (!usage_object.is_empty()).then_some(usage)
}

pub(crate) fn claude_subscription_completion_from_json(
    value: &Value,
    requested_model: &str,
) -> Option<LlmCompletion> {
    let content = claude_subscription_text_from_json(value)?;
    log_claude_subscription_status(value, requested_model);
    Some(LlmCompletion {
        content,
        tool_calls: Vec::new(),
        finish_reason: value
            .get("subtype")
            .or_else(|| value.get("finish_reason"))
            .and_then(Value::as_str)
            .map(str::to_string),
        usage: claude_subscription_usage_from_json(value),
        provider_metadata: None,
    })
}

pub(crate) fn parse_claude_subscription_output_rich(
    raw: &str,
    requested_model: &str,
) -> AppResult<LlmCompletion> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "claude_subscription_empty",
            "Claude Code returned an empty response.",
        ));
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if let Some(completion) = claude_subscription_completion_from_json(&value, requested_model)
        {
            return Ok(completion);
        }
        if claude_subscription_json_declares_empty_result(&value) {
            let diagnostic = claude_subscription_output_diagnostic(&value)
                .unwrap_or_else(|| "no diagnostic fields returned".to_string());
            return Err(AppError::with_details(
                "claude_subscription_empty",
                format!("Claude Code returned no content ({diagnostic})."),
                redact_sensitive_json(value),
            ));
        }
    }
    let mut completion = LlmCompletion {
        content: String::new(),
        tool_calls: Vec::new(),
        finish_reason: None,
        usage: None,
        provider_metadata: None,
    };
    let mut empty_result_diagnostic: Option<Value> = None;
    for line in trimmed.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            if let Some(piece) = claude_subscription_completion_from_json(&value, requested_model) {
                completion.content.push_str(&piece.content);
                if piece.finish_reason.is_some() {
                    completion.finish_reason = piece.finish_reason;
                }
                if piece.usage.is_some() {
                    completion.usage = piece.usage;
                }
            } else if claude_subscription_json_declares_empty_result(&value) {
                empty_result_diagnostic = Some(value);
            }
        }
    }
    if !completion.content.trim().is_empty() {
        return Ok(completion);
    }
    if let Some(value) = empty_result_diagnostic {
        let diagnostic = claude_subscription_output_diagnostic(&value)
            .unwrap_or_else(|| "no diagnostic fields returned".to_string());
        return Err(AppError::with_details(
            "claude_subscription_empty",
            format!("Claude Code returned no content ({diagnostic})."),
            redact_sensitive_json(value),
        ));
    }
    Ok(LlmCompletion {
        content: trimmed.to_string(),
        tool_calls: Vec::new(),
        finish_reason: None,
        usage: None,
        provider_metadata: None,
    })
}

pub(crate) fn parse_claude_subscription_json_output(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Some(value);
    }
    trimmed
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .next_back()
}

pub fn diagnose_claude_subscription_model(model: &str, fast_mode: bool) -> AppResult<Value> {
    let selection = claude_subscription_model_selection(model);
    if selection.configured_model.is_empty() {
        return Err(AppError::invalid_input(
            "No model configured. Pick a model first.",
        ));
    }
    let started = std::time::Instant::now();
    let mut command = Command::new(claude_subscription_command());
    command
        .arg("-p")
        .arg("--output-format")
        .arg("json")
        .arg("--permission-mode")
        .arg("bypassPermissions")
        .arg("--settings")
        .arg(json!({ "fastMode": fast_mode }).to_string())
        .arg("--tools")
        .arg("")
        .arg("--disable-slash-commands")
        .arg("--no-session-persistence")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.args(claude_subscription_model_args(&selection));
    command.env("ENABLE_CLAUDEAI_MCP_SERVERS", "false");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|error| {
        AppError::new(
            "claude_subscription_unavailable",
            format!(
                "Failed to start Claude Code. Install @anthropic-ai/claude-code, run `claude login`, or set CLAUDE_CODE_COMMAND. Underlying error: {error}"
            ),
        )
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(b"Reply with exactly: OK")
            .map_err(|error| AppError::new("claude_subscription_io_error", error.to_string()))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| AppError::new("claude_subscription_io_error", error.to_string()))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(AppError::with_details(
            "claude_subscription_failed",
            if stderr.trim().is_empty() {
                "Claude Code routing diagnosis failed.".to_string()
            } else {
                redact_sensitive_text(stderr.trim())
            },
            redact_sensitive_json(json!({
                "status": output.status.code(),
                "stdout": stdout.chars().take(1000).collect::<String>(),
            })),
        ));
    }
    let value = parse_claude_subscription_json_output(&stdout).ok_or_else(|| {
        AppError::with_details(
            "claude_subscription_response_error",
            "Claude Code did not return diagnostic JSON.",
            redact_sensitive_json(
                json!({ "stdout": stdout.chars().take(1000).collect::<String>() }),
            ),
        )
    })?;
    let model_usage = value
        .get("modelUsage")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let models_billed = model_usage.keys().cloned().collect::<Vec<_>>();
    let model_usage_detail = model_usage
        .iter()
        .map(|(model, usage)| {
            json!({
                "model": model,
                "inputTokens": usage.get("input_tokens").and_then(Value::as_u64),
                "outputTokens": usage.get("output_tokens").and_then(Value::as_u64),
                "role": if model == &selection.cli_model { "requested" } else { "auxiliary" },
            })
        })
        .collect::<Vec<_>>();
    let response = claude_subscription_text_from_json(&value).unwrap_or_default();
    let downgraded = !model_usage.is_empty() && !model_usage.contains_key(&selection.cli_model);
    Ok(json!({
        "success": !downgraded,
        "requestedModel": selection.cli_model,
        "configuredModel": selection.configured_model,
        "longContextBeta": selection.long_context_beta,
        "modelsBilled": models_billed,
        "modelUsageDetail": model_usage_detail,
        "fastModeState": value.get("fast_mode_state").and_then(Value::as_str),
        "downgraded": downgraded,
        "response": response,
        "latencyMs": started.elapsed().as_millis(),
    }))
}

pub(crate) async fn complete_claude_subscription_rich(
    request: LlmRequest,
) -> AppResult<LlmCompletion> {
    let prompt_selection = claude_subscription_prompt(&request)?;
    let model_selection = claude_subscription_model_selection(&request.connection.model);
    let mut command = Command::new(claude_subscription_command());
    command
        .arg("-p")
        .arg("--output-format")
        .arg("json")
        .arg("--permission-mode")
        .arg("bypassPermissions")
        .arg("--settings")
        .arg(json!({ "fastMode": request.connection.claude_fast_mode }).to_string())
        .arg("--tools")
        .arg("")
        .arg("--disable-slash-commands")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.args(claude_subscription_model_args(&model_selection));
    if let Some(system_prompt) = prompt_selection.system_prompt.as_ref() {
        command.arg("--append-system-prompt").arg(system_prompt);
    }
    if let Some(session_id) = prompt_selection.session_id.as_ref() {
        let cwd = claude_subscription_scratch_cwd()?;
        command.arg("--session-id").arg(session_id);
        command.current_dir(cwd);
    } else {
        command.arg("--no-session-persistence");
    }
    if !request.connection.api_key.trim().is_empty() {
        command.env("ANTHROPIC_API_KEY", request.connection.api_key.trim());
    }
    command.env("ENABLE_CLAUDEAI_MCP_SERVERS", "false");
    log_prompt_connection_request(
        "claude_subscription",
        "claude-code://local",
        &request,
        &json!({
            "model": model_selection.cli_model.clone(),
            "configuredModel": model_selection.configured_model.clone(),
            "longContextBeta": model_selection.long_context_beta,
            "outputFormat": "json",
            "permissionMode": "bypassPermissions",
            "fastMode": request.connection.claude_fast_mode,
            "sessionId": prompt_selection.session_id.as_deref(),
            "promptShape": prompt_selection.prompt_shape
        }),
    );
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| {
            AppError::new(
                "claude_subscription_unavailable",
                format!(
                    "Failed to start Claude Code. Install @anthropic-ai/claude-code, run `claude login`, or set CLAUDE_CODE_COMMAND. Underlying error: {error}"
                ),
            )
        })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt_selection.prompt.as_bytes())
            .map_err(|error| AppError::new("claude_subscription_io_error", error.to_string()))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| AppError::new("claude_subscription_io_error", error.to_string()))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(AppError::with_details(
            "claude_subscription_failed",
            if stderr.trim().is_empty() {
                "Claude Code request failed.".to_string()
            } else {
                redact_sensitive_text(stderr.trim())
            },
            redact_sensitive_json(json!({
                "status": output.status.code(),
                "stdout": stdout.chars().take(1000).collect::<String>(),
            })),
        ));
    }
    parse_claude_subscription_output_rich(&stdout, &model_selection.cli_model)
}
