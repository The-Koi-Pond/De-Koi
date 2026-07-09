use crate::providers::sse::{
    ensure_sse_buffer_within_limit, take_sse_block, OpenAiToolCallAccumulator,
};
use crate::*;

pub(crate) async fn complete_openai_compatible_rich(
    request: LlmRequest,
) -> AppResult<LlmCompletion> {
    if should_use_openai_responses(&request) {
        return complete_openai_responses_rich(request).await;
    }
    let url = openai_compatible_chat_endpoint(&request);
    let messages: Vec<Value> = request_messages(&request)
        .iter()
        .map(openai_message)
        .collect();
    let mut body = json!({
        "model": request.connection.model,
        "messages": messages,
        "stream": false,
        "max_tokens": request_max_tokens(&request, 1024),
    });
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(
            request
                .tools
                .iter()
                .map(|tool| json!({ "type": "function", "function": tool }))
                .collect(),
        );
        body["tool_choice"] = json!("auto");
    }
    if should_send_temperature(&request) {
        if let Some(temp) = temperature(&request.parameters) {
            body["temperature"] = json!(temp);
        }
    }
    apply_openai_parameters(&mut body, &request);
    log_prompt_connection_request("openai.chat.completions", &url, &request, &body);
    let client = provider_http_client_for_url(&url).await?;
    let mut req = client.post(url).json(&body);
    if !request.connection.api_key.trim().is_empty() {
        req = req.bearer_auth(request.connection.api_key.trim());
    }
    if request.connection.provider == "openrouter" {
        req = req
            .header("HTTP-Referer", "https://de-koi.local")
            .header("X-Title", "De-Koi");
    }
    let response = send_provider_request(req).await?;
    parse_json_response_rich(response).await
}

pub(crate) async fn stream_openai_compatible(
    request: LlmRequest,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    let url = openai_compatible_chat_endpoint(&request);
    let messages: Vec<Value> = request_messages(&request)
        .iter()
        .map(openai_message)
        .collect();
    let mut body = json!({
        "model": request.connection.model,
        "messages": messages,
        "stream": true,
        "max_tokens": request_max_tokens(&request, 1024),
    });
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(
            request
                .tools
                .iter()
                .map(|tool| json!({ "type": "function", "function": tool }))
                .collect(),
        );
        body["tool_choice"] = json!("auto");
    }
    if should_send_temperature(&request) {
        if let Some(temp) = temperature(&request.parameters) {
            body["temperature"] = json!(temp);
        }
    }
    apply_openai_parameters(&mut body, &request);
    log_prompt_connection_request("openai.chat.completions.stream", &url, &request, &body);
    let client = provider_http_client_for_url(&url).await?;
    let mut req = client.post(url).json(&body);
    if !request.connection.api_key.trim().is_empty() {
        req = req.bearer_auth(request.connection.api_key.trim());
    }
    if request.connection.provider == "openrouter" {
        req = req
            .header("HTTP-Referer", "https://de-koi.local")
            .header("X-Title", "De-Koi");
    }
    let response = send_provider_request(req).await?;
    let status = response.status();
    if !status.is_success() {
        let error_body = read_error_response_details(response).await?;
        return Err(provider_http_error(status, error_body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut decoder = Utf8StreamDecoder::default();
    let mut tool_calls = OpenAiToolCallAccumulator::default();
    let mut completed = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            AppError::new("llm_stream_error", provider_transport_error_message(error))
        })?;
        decoder.push_chunk(&chunk, &mut buffer);
        ensure_sse_buffer_within_limit(&buffer)?;
        while let Some(block) = take_sse_block(&mut buffer) {
            if process_openai_sse_block(&block, emit, &mut tool_calls)? == SseBlockStatus::Complete
            {
                completed = true;
                break;
            }
        }
        if completed {
            break;
        }
    }
    if !completed {
        decoder.finish(&mut buffer);
    }
    if !completed && !buffer.trim().is_empty() {
        process_openai_sse_block(&buffer, emit, &mut tool_calls)?;
    }
    for tool_call in tool_calls.into_tool_calls() {
        emit(json!({ "type": "tool_call", "data": tool_call }))?;
    }
    Ok(())
}

pub(crate) const OPENAI_RESPONSES_ENCRYPTED_REASONING_INCLUDE: &str = "reasoning.encrypted_content";

pub(crate) fn openai_responses_preserve_encrypted_reasoning(request: &LlmRequest) -> bool {
    request.connection.provider != "openai_chatgpt"
}

pub(crate) fn encrypted_reasoning_items_from_metadata(metadata: &Value) -> Vec<Value> {
    [
        "encryptedReasoningItems",
        "openaiResponsesEncryptedReasoningItems",
    ]
    .into_iter()
    .filter_map(|key| metadata.get(key).and_then(Value::as_array))
    .flat_map(|items| items.iter())
    .filter(|item| {
        item.get("type").and_then(Value::as_str) == Some("reasoning")
            && item
                .get("encrypted_content")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
    })
    .cloned()
    .collect()
}

pub(crate) fn encrypted_reasoning_items_from_messages(messages: &[LlmMessage]) -> Vec<Value> {
    messages
        .iter()
        .filter(|message| message.role == "assistant")
        .filter_map(|message| message.provider_metadata.as_ref())
        .flat_map(encrypted_reasoning_items_from_metadata)
        .collect()
}

pub(crate) fn encrypted_reasoning_items_from_responses_output(json: &Value) -> Vec<Value> {
    json.get("output")
        .or_else(|| json.pointer("/response/output"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| {
            item.get("type").and_then(Value::as_str) == Some("reasoning")
                && item
                    .get("encrypted_content")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
        })
        .cloned()
        .collect()
}

pub(crate) fn openai_responses_provider_metadata(json: &Value) -> Option<Value> {
    let encrypted_reasoning_items = encrypted_reasoning_items_from_responses_output(json);
    if encrypted_reasoning_items.is_empty() {
        None
    } else {
        Some(json!({ "encryptedReasoningItems": encrypted_reasoning_items }))
    }
}

pub(crate) fn ensure_openai_responses_include(body: &mut Value, include: &str) {
    if let Some(items) = body.get_mut("include").and_then(Value::as_array_mut) {
        if !items
            .iter()
            .any(|item| item.as_str().is_some_and(|value| value == include))
        {
            items.push(Value::String(include.to_string()));
        }
        return;
    }
    body["include"] = json!([include]);
}

#[derive(Default)]
pub(crate) struct ResponsesToolCallIdMapper {
    ids: BTreeMap<String, String>,
    counter: usize,
}

impl ResponsesToolCallIdMapper {
    fn ensure(&mut self, id: &str) -> String {
        if id.starts_with("fc_") {
            return id.to_string();
        }
        if let Some(mapped) = self.ids.get(id) {
            return mapped.clone();
        }
        self.counter += 1;
        let mapped = format!("fc_mapped_{}", self.counter);
        self.ids.insert(id.to_string(), mapped.clone());
        mapped
    }
}

pub(crate) fn tool_call_raw_id(call: &Value) -> Option<&str> {
    call.get("id")
        .or_else(|| call.get("call_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(crate) fn tool_call_function_name(call: &Value) -> Option<&str> {
    call.pointer("/function/name")
        .or_else(|| call.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(crate) fn tool_call_arguments(call: &Value) -> String {
    let value = call
        .pointer("/function/arguments")
        .or_else(|| call.get("arguments"));
    match value {
        Some(Value::String(arguments)) => arguments.clone(),
        Some(value) => compact_json(value),
        None => "{}".to_string(),
    }
}

pub(crate) fn responses_tool_call_input_items(
    message: &LlmMessage,
    id_mapper: &mut ResponsesToolCallIdMapper,
) -> Vec<Value> {
    let Some(tool_calls) = message.tool_calls.as_ref().and_then(Value::as_array) else {
        return Vec::new();
    };
    tool_calls
        .iter()
        .enumerate()
        .map(|(index, call)| {
            let raw_id = tool_call_raw_id(call)
                .map(str::to_string)
                .unwrap_or_else(|| format!("call_{}", index + 1));
            let fc_id = id_mapper.ensure(&raw_id);
            json!({
                "type": "function_call",
                "id": fc_id,
                "call_id": fc_id,
                "name": tool_call_function_name(call).unwrap_or(""),
                "arguments": tool_call_arguments(call),
            })
        })
        .collect()
}

pub(crate) fn responses_message_input(
    message: &LlmMessage,
    id_mapper: &mut ResponsesToolCallIdMapper,
) -> Vec<Value> {
    if message.role == "tool" {
        let call_id = message
            .tool_call_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|id| id_mapper.ensure(id))
            .unwrap_or_default();
        return vec![json!({
            "type": "function_call_output",
            "call_id": call_id,
            "output": message.content,
        })];
    }

    let role = if message.role == "assistant" {
        "assistant"
    } else if message.role == "system" {
        "system"
    } else {
        "user"
    };
    let mut items = Vec::new();
    if message.images.is_empty() {
        if !message.content.trim().is_empty() || message.role != "assistant" {
            items.push(json!({ "role": role, "content": message.content }));
        }
    } else {
        let mut content = Vec::new();
        if !message.content.is_empty() {
            content.push(json!({ "type": "input_text", "text": message.content }));
        }
        for image in &message.images {
            content.push(json!({ "type": "input_image", "image_url": image }));
        }
        items.push(json!({ "role": role, "content": content }));
    }
    if message.role == "assistant" {
        items.extend(responses_tool_call_input_items(message, id_mapper));
    }
    items
}

pub(crate) fn is_responses_assistant_input_item(item: &Value) -> bool {
    item.get("role").and_then(Value::as_str) == Some("assistant")
        || item.get("type").and_then(Value::as_str) == Some("function_call")
}

pub(crate) fn responses_input(messages: &[LlmMessage], replay_encrypted_reasoning: bool) -> Value {
    let mut id_mapper = ResponsesToolCallIdMapper::default();
    let mut input = messages
        .iter()
        .flat_map(|message| responses_message_input(message, &mut id_mapper))
        .collect::<Vec<_>>();
    if replay_encrypted_reasoning {
        let encrypted_reasoning_items = encrypted_reasoning_items_from_messages(messages);
        if !encrypted_reasoning_items.is_empty() {
            if let Some(index) = input.iter().rposition(is_responses_assistant_input_item) {
                input.splice(index..index, encrypted_reasoning_items);
            }
        }
    }
    Value::Array(input)
}

pub(crate) fn chatgpt_responses_message_input(
    message: &LlmMessage,
    id_mapper: &mut ResponsesToolCallIdMapper,
) -> Vec<Value> {
    if message.role == "system" {
        return Vec::new();
    }
    if message.role == "tool" {
        let call_id = message
            .tool_call_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|id| id_mapper.ensure(id))
            .unwrap_or_default();
        return vec![json!({
            "type": "function_call_output",
            "call_id": call_id,
            "output": message.content,
        })];
    }

    let role = if message.role == "assistant" {
        "assistant"
    } else {
        "user"
    };
    let text_type = if role == "assistant" {
        "output_text"
    } else {
        "input_text"
    };
    let mut items = Vec::new();
    let mut content = Vec::new();
    if !message.content.trim().is_empty() {
        content.push(json!({ "type": text_type, "text": message.content }));
    }
    for image in &message.images {
        content.push(json!({ "type": "input_image", "image_url": image }));
    }
    if !content.is_empty() {
        items.push(json!({
            "type": "message",
            "role": role,
            "content": content,
        }));
    }
    if message.role == "assistant" {
        items.extend(responses_tool_call_input_items(message, id_mapper));
    }
    items
}

pub(crate) fn chatgpt_responses_input(messages: &[LlmMessage]) -> Value {
    let mut id_mapper = ResponsesToolCallIdMapper::default();
    Value::Array(
        messages
            .iter()
            .flat_map(|message| chatgpt_responses_message_input(message, &mut id_mapper))
            .collect(),
    )
}

pub(crate) fn chatgpt_responses_instructions(messages: &[LlmMessage]) -> String {
    let instructions = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .filter(|content| !content.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if instructions.is_empty() {
        "You are a helpful assistant.".to_string()
    } else {
        instructions
    }
}

pub(crate) fn build_openai_chatgpt_responses_body(request: &LlmRequest, stream: bool) -> Value {
    let messages = request_messages(request);
    let effort = openai_reasoning_effort(request).unwrap_or_else(|| "low".to_string());
    let mut body = json!({
        "model": request.connection.model,
        "instructions": chatgpt_responses_instructions(&messages),
        "input": chatgpt_responses_input(&messages),
        "stream": stream,
        "store": false,
        "include": [],
        "reasoning": { "effort": effort },
    });
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(
            request
                .tools
                .iter()
                .map(|tool| json!({ "type": "function", "name": tool.get("name").cloned().unwrap_or(Value::String("tool".to_string())), "description": tool.get("description").cloned().unwrap_or(Value::Null), "parameters": tool.get("parameters").cloned().unwrap_or_else(|| json!({ "type": "object", "properties": {} })) }))
                .collect(),
        );
        body["tool_choice"] = json!("auto");
    } else {
        body["tools"] = json!([]);
        body["tool_choice"] = json!("none");
        body["parallel_tool_calls"] = json!(false);
    }
    apply_requested_tool_choice(&mut body, &request.parameters);
    body
}

pub(crate) fn build_openai_responses_body(request: &LlmRequest, stream: bool) -> Value {
    if request.connection.provider == "openai_chatgpt" {
        return build_openai_chatgpt_responses_body(request, stream);
    }
    let messages = request_messages(request);
    let preserve_encrypted_reasoning = openai_responses_preserve_encrypted_reasoning(request);
    let send_sampling = should_send_openai_sampling_parameters(request);
    let mut body = json!({
        "model": request.connection.model,
        "input": responses_input(&messages, preserve_encrypted_reasoning),
        "stream": stream,
        "max_output_tokens": request_max_tokens(request, 1024),
    });
    if let Some(effort) = openai_reasoning_effort(request) {
        body["reasoning"] = json!({ "effort": effort, "summary": "auto" });
    }
    if send_sampling {
        if let Some(temperature) = param_f64(&request.parameters, &["temperature"]) {
            body["temperature"] = json!(temperature);
        }
        if let Some(top_p) = param_f64(&request.parameters, &["topP", "top_p"]) {
            body["top_p"] = json!(top_p);
        }
    }
    if let Some(service_tier) = param_string(&request.parameters, &["serviceTier", "service_tier"])
        .filter(|value| is_openai_service_tier(value))
    {
        body["service_tier"] = json!(service_tier);
    }
    if let Some(format) = param_string(&request.parameters, &["responseFormat", "response_format"])
    {
        if format == "json_object" {
            body["text"] = json!({ "format": { "type": "json_object" } });
        }
    }
    if let Some(verbosity) = param_string(&request.parameters, &["verbosity"]) {
        let mut text = body
            .get("text")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        text.insert("verbosity".to_string(), json!(verbosity));
        body["text"] = Value::Object(text);
    }
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(
            request
                .tools
                .iter()
                .map(|tool| json!({ "type": "function", "name": tool.get("name").cloned().unwrap_or(Value::String("tool".to_string())), "description": tool.get("description").cloned().unwrap_or(Value::Null), "parameters": tool.get("parameters").cloned().unwrap_or_else(|| json!({ "type": "object", "properties": {} })) }))
                .collect(),
        );
        body["tool_choice"] = json!("auto");
    }
    apply_custom_parameters_to_object(
        &mut body,
        &request.parameters,
        !send_sampling,
        false,
        OPENAI_RESPONSES_UNSUPPORTED_CUSTOM_PARAMETER_KEYS,
    );
    if preserve_encrypted_reasoning {
        ensure_openai_responses_include(&mut body, OPENAI_RESPONSES_ENCRYPTED_REASONING_INCLUDE);
    }
    body
}

pub(crate) async fn openai_responses_request(
    request: &LlmRequest,
    body: &Value,
) -> AppResult<reqwest::Response> {
    let base = base_url(&request.connection.provider, &request.connection.base_url);
    let url = format!("{base}/responses");
    log_prompt_connection_request("openai.responses", &url, request, body);
    let req = provider_http_client_for_url(&url)
        .await?
        .post(url)
        .json(body);
    let req = if request.connection.provider == "openai_chatgpt" {
        apply_chatgpt_auth_headers(req).await?
    } else {
        apply_openai_auth_headers(req, request)
    };
    send_provider_request(req).await
}

#[derive(Default)]
pub(crate) struct ChatGptResponsesRichCollector {
    content: String,
    tool_calls: Vec<Value>,
    usage: Option<Value>,
    provider_metadata: Option<Value>,
}

impl ChatGptResponsesRichCollector {
    pub(crate) fn ingest_event(&mut self, event: &Value) {
        match event.get("type").and_then(Value::as_str) {
            Some("token") => {
                if let Some(text) = event
                    .get("text")
                    .or_else(|| event.get("data"))
                    .and_then(Value::as_str)
                {
                    self.content.push_str(text);
                }
            }
            Some("tool_call") => {
                if let Some(call) = event.get("data") {
                    self.tool_calls.push(call.clone());
                }
            }
            Some("usage") => {
                self.usage = event.get("data").cloned();
            }
            Some("provider_metadata") => {
                self.provider_metadata = event.get("data").cloned();
            }
            _ => {}
        }
    }

    pub(crate) fn into_completion(self) -> AppResult<LlmCompletion> {
        if self.content.trim().is_empty() && self.tool_calls.is_empty() {
            return Err(AppError::new(
                "llm_response_error",
                "ChatGPT Codex stream did not contain assistant text or tool calls",
            ));
        }
        let finish_reason = if self.tool_calls.is_empty() {
            "completed"
        } else {
            "tool_calls"
        };
        Ok(LlmCompletion {
            content: self.content,
            tool_calls: self.tool_calls,
            finish_reason: Some(finish_reason.to_string()),
            usage: self.usage,
            provider_metadata: self.provider_metadata,
        })
    }
}

pub(crate) async fn complete_openai_chatgpt_responses_rich(
    request: LlmRequest,
) -> AppResult<LlmCompletion> {
    let mut collector = ChatGptResponsesRichCollector::default();
    stream_openai_responses(request, &mut |event| {
        collector.ingest_event(&event);
        Ok(())
    })
    .await?;
    collector.into_completion()
}

pub(crate) async fn complete_openai_responses_rich(
    request: LlmRequest,
) -> AppResult<LlmCompletion> {
    if request.connection.provider == "openai_chatgpt" {
        return complete_openai_chatgpt_responses_rich(request).await;
    }
    let body = build_openai_responses_body(&request, false);
    let response = openai_responses_request(&request, &body).await?;
    let (status, json) = read_json_response(response).await?;
    if !status.is_success() {
        return Err(provider_http_error(status, json));
    }
    let mut content = String::new();
    if let Some(text) = json.get("output_text").and_then(Value::as_str) {
        content.push_str(text);
    }
    if content.is_empty() {
        if let Some(output) = json.get("output").and_then(Value::as_array) {
            for item in output {
                if let Some(parts) = item.get("content").and_then(Value::as_array) {
                    for part in parts {
                        if let Some(text) = part.get("text").and_then(Value::as_str) {
                            content.push_str(text);
                        }
                    }
                }
            }
        }
    }
    let tool_calls = responses_tool_calls(&json);
    let provider_metadata = openai_responses_provider_metadata(&json);
    let usage = json.get("usage").cloned();
    let finish_reason = if !tool_calls.is_empty() {
        Some("tool_calls".to_string())
    } else {
        json.get("status").and_then(Value::as_str).map(|status| {
            if status.eq_ignore_ascii_case("incomplete") {
                "length".to_string()
            } else {
                status.to_string()
            }
        })
    };
    if content.trim().is_empty() && tool_calls.is_empty() {
        return Err(AppError::with_details(
            "llm_response_error",
            "Responses API result did not contain assistant text or tool calls",
            redact_sensitive_json(json),
        ));
    }
    Ok(LlmCompletion {
        content,
        tool_calls,
        finish_reason,
        usage,
        provider_metadata,
    })
}

pub(crate) fn responses_tool_calls(json: &Value) -> Vec<Value> {
    json.get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
        .map(|item| {
            json!({
                "id": item.get("call_id").or_else(|| item.get("id")).and_then(Value::as_str).unwrap_or(""),
                "name": item.get("name").and_then(Value::as_str).unwrap_or(""),
                "arguments": item.get("arguments").and_then(Value::as_str).unwrap_or("{}"),
                "function": {
                    "name": item.get("name").and_then(Value::as_str).unwrap_or(""),
                    "arguments": item.get("arguments").and_then(Value::as_str).unwrap_or("{}")
                }
            })
        })
        .collect()
}

pub(crate) async fn stream_openai_responses(
    request: LlmRequest,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    let body = build_openai_responses_body(&request, true);
    let response = openai_responses_request(&request, &body).await?;
    let status = response.status();
    if !status.is_success() {
        let error_body = read_error_response_details(response).await?;
        return Err(provider_http_error(status, error_body));
    }
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut decoder = Utf8StreamDecoder::default();
    let mut tool_calls = ResponsesToolCallAccumulator::default();
    let mut completed = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            AppError::new("llm_stream_error", provider_transport_error_message(error))
        })?;
        decoder.push_chunk(&chunk, &mut buffer);
        ensure_sse_buffer_within_limit(&buffer)?;
        while let Some(block) = take_sse_block(&mut buffer) {
            if process_openai_responses_sse_block(&block, emit, &mut tool_calls)?
                == SseBlockStatus::Complete
            {
                completed = true;
                break;
            }
        }
        if completed {
            break;
        }
    }
    if !completed {
        decoder.finish(&mut buffer);
    }
    if !completed && !buffer.trim().is_empty() {
        process_openai_responses_sse_block(&buffer, emit, &mut tool_calls)?;
    }
    for tool_call in tool_calls.into_tool_calls() {
        emit(json!({ "type": "tool_call", "data": tool_call }))?;
    }
    Ok(())
}

pub(crate) fn process_openai_responses_sse_block(
    block: &str,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
    tool_calls: &mut ResponsesToolCallAccumulator,
) -> AppResult<SseBlockStatus> {
    let event_name = block
        .lines()
        .find_map(|line| line.trim_start().strip_prefix("event:"))
        .map(str::trim)
        .unwrap_or("");
    let payload = block
        .lines()
        .filter_map(|line| line.trim_start().strip_prefix("data:"))
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n");
    if payload.is_empty() {
        return Ok(SseBlockStatus::Continue);
    }
    if payload == "[DONE]" {
        return Ok(SseBlockStatus::Complete);
    }
    let value: Value = serde_json::from_str(&payload)
        .map_err(|error| AppError::new("llm_stream_parse_error", error.to_string()))?;
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(event_name);
    match event_type {
        "response.output_text.delta" => {
            if let Some(delta) = value
                .get("delta")
                .and_then(Value::as_str)
                .filter(|delta| !delta.is_empty())
            {
                emit(json!({ "type": "token", "text": delta, "data": delta }))?;
            }
        }
        "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
            if let Some(delta) = value
                .get("delta")
                .and_then(Value::as_str)
                .filter(|delta| !delta.is_empty())
            {
                emit(json!({ "type": "thinking", "text": delta, "data": delta }))?;
            }
        }
        "response.output_item.added" => {
            tool_calls.ingest_output_item_event(&value);
        }
        "response.function_call_arguments.delta" => {
            tool_calls.ingest_arguments_delta(&value);
        }
        "response.function_call_arguments.done" => {
            tool_calls.ingest_arguments_done(&value);
        }
        "response.output_item.done" => {
            tool_calls.ingest_output_item_event(&value);
        }
        "response.completed" => {
            if let Some(output) = value
                .pointer("/response/output")
                .or_else(|| value.get("output"))
                .and_then(Value::as_array)
            {
                for item in output {
                    tool_calls.ingest_output_item(item);
                }
            }
            if let Some(usage) = value
                .pointer("/response/usage")
                .or_else(|| value.get("usage"))
            {
                emit(json!({ "type": "usage", "data": usage }))?;
            }
            if let Some(provider_metadata) = openai_responses_provider_metadata(&value) {
                emit(json!({ "type": "provider_metadata", "data": provider_metadata }))?;
            }
            return Ok(SseBlockStatus::Complete);
        }
        "response.failed" | "response.incomplete" | "error" => {
            return Err(AppError::with_details(
                "llm_provider_error",
                format!("Responses API stream event {event_type}"),
                redact_sensitive_json(value),
            ));
        }
        _ => {}
    }
    Ok(SseBlockStatus::Continue)
}

#[derive(Default)]
pub(crate) struct ResponsesToolCallAccumulator {
    calls: BTreeMap<String, ResponsesToolCallParts>,
    item_keys: BTreeMap<String, String>,
}

#[derive(Default)]
pub(crate) struct ResponsesToolCallParts {
    name: Option<String>,
    arguments: String,
}

impl ResponsesToolCallAccumulator {
    fn call_id(value: &Value) -> Option<String> {
        value
            .get("call_id")
            .or_else(|| value.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn item_keys(value: &Value) -> Vec<String> {
        let mut keys = Vec::new();
        for key in ["item_id", "output_item_id", "id"] {
            if let Some(value) = value
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                keys.push(format!("id:{value}"));
            }
        }
        for key in ["output_index", "item_index", "index"] {
            if let Some(value) = value.get(key).and_then(Value::as_u64) {
                keys.push(format!("index:{value}"));
            }
        }
        keys
    }

    fn resolve_call_id(&self, value: &Value) -> Option<String> {
        Self::call_id(value).or_else(|| {
            Self::item_keys(value)
                .into_iter()
                .find_map(|key| self.item_keys.get(&key).cloned())
        })
    }

    fn entry_mut(&mut self, call_id: String) -> &mut ResponsesToolCallParts {
        self.calls.entry(call_id).or_default()
    }

    fn merge_call_id(&mut self, from: String, to: &str) {
        if from == to || !self.calls.contains_key(&from) {
            return;
        }
        for call_id in self.item_keys.values_mut() {
            if call_id == &from {
                *call_id = to.to_string();
            }
        }
        let Some(from_parts) = self.calls.remove(&from) else {
            return;
        };
        let to_parts = self.calls.entry(to.to_string()).or_default();
        if to_parts.name.is_none() {
            to_parts.name = from_parts.name;
        }
        if to_parts.arguments.is_empty() {
            to_parts.arguments = from_parts.arguments;
        } else if !from_parts.arguments.is_empty()
            && !to_parts.arguments.contains(&from_parts.arguments)
        {
            to_parts.arguments = format!("{}{}", from_parts.arguments, to_parts.arguments);
        }
    }

    fn ingest_output_item_event(&mut self, event: &Value) {
        let Some(item) = event.get("item") else {
            return;
        };
        self.ingest_output_item_with_keys(item, Self::item_keys(event));
    }

    fn ingest_output_item(&mut self, item: &Value) {
        self.ingest_output_item_with_keys(item, Vec::new());
    }

    fn ingest_output_item_with_keys(&mut self, item: &Value, mut event_keys: Vec<String>) {
        if item.get("type").and_then(Value::as_str) != Some("function_call") {
            return;
        }
        let Some(call_id) = Self::call_id(item).or_else(|| {
            event_keys
                .iter()
                .find_map(|key| self.item_keys.get(key).cloned())
        }) else {
            return;
        };
        for key in Self::item_keys(item) {
            event_keys.push(key);
        }
        for key in event_keys {
            if let Some(previous) = self.item_keys.insert(key, call_id.clone()) {
                self.merge_call_id(previous, &call_id);
            }
        }
        let entry = self.entry_mut(call_id);
        if let Some(name) = item
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            entry.name = Some(name.to_string());
        }
        if let Some(arguments) = item.get("arguments").and_then(Value::as_str) {
            entry.arguments = arguments.to_string();
        }
    }

    fn ingest_arguments_delta(&mut self, value: &Value) {
        let Some(call_id) = self.resolve_call_id(value) else {
            return;
        };
        let Some(delta) = value.get("delta").and_then(Value::as_str) else {
            return;
        };
        self.entry_mut(call_id).arguments.push_str(delta);
    }

    fn ingest_arguments_done(&mut self, value: &Value) {
        let Some(call_id) = self.resolve_call_id(value) else {
            return;
        };
        if let Some(arguments) = value.get("arguments").and_then(Value::as_str) {
            self.entry_mut(call_id).arguments = arguments.to_string();
        }
    }

    pub(crate) fn into_tool_calls(self) -> Vec<Value> {
        self.calls
            .into_iter()
            .filter_map(|(call_id, parts)| {
                let name = parts.name.unwrap_or_default();
                if name.trim().is_empty() && parts.arguments.trim().is_empty() {
                    return None;
                }
                let arguments = if parts.arguments.trim().is_empty() {
                    "{}".to_string()
                } else {
                    parts.arguments
                };
                Some(json!({
                    "id": call_id,
                    "name": name.clone(),
                    "arguments": arguments.clone(),
                    "function": {
                        "name": name,
                        "arguments": arguments
                    }
                }))
            })
            .collect()
    }
}

pub(crate) fn emit_openai_content_delta(
    content: &Value,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    match content {
        Value::String(text) if !text.is_empty() => {
            emit(json!({ "type": "token", "text": text, "data": text }))?;
        }
        Value::Array(parts) => {
            for part in parts {
                emit_openai_content_delta(part, emit)?;
            }
        }
        Value::Object(_) if content.get("type").and_then(Value::as_str) == Some("thinking") => {
            let thinking = content
                .get("thinking")
                .map(content_text)
                .filter(|text| !text.trim().is_empty())
                .or_else(|| {
                    content
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_default();
            if !thinking.is_empty() {
                emit(json!({ "type": "thinking", "text": thinking, "data": thinking }))?;
            }
        }
        Value::Object(_) => {
            if let Some(text) = content_part_text(content).filter(|text| !text.is_empty()) {
                emit(json!({ "type": "token", "text": text, "data": text }))?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(crate) fn process_openai_sse_block(
    block: &str,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
    tool_calls: &mut OpenAiToolCallAccumulator,
) -> AppResult<SseBlockStatus> {
    let payload = block
        .lines()
        .filter_map(|line| line.trim_start().strip_prefix("data:"))
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n");
    if payload.is_empty() {
        return Ok(SseBlockStatus::Continue);
    }
    if payload == "[DONE]" {
        return Ok(SseBlockStatus::Complete);
    }
    let value: Value = serde_json::from_str(&payload)
        .map_err(|error| AppError::new("llm_stream_parse_error", error.to_string()))?;
    if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
        emit(json!({ "type": "usage", "data": usage }))?;
    }
    let Some(choices) = value.get("choices").and_then(Value::as_array) else {
        return Ok(SseBlockStatus::Continue);
    };
    for choice in choices {
        let delta = choice.get("delta").unwrap_or(choice);
        tool_calls.ingest_delta(delta);
        for key in ["reasoning_content", "reasoning", "thinking"] {
            if let Some(thinking) = delta.get(key).and_then(Value::as_str) {
                if !thinking.is_empty() {
                    emit(json!({ "type": "thinking", "text": thinking, "data": thinking }))?;
                }
            }
        }
        if let Some(content) = delta.get("content") {
            emit_openai_content_delta(content, emit)?;
        }
        if choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .filter(|reason| !reason.is_empty())
            .is_some()
        {
            return Ok(SseBlockStatus::Complete);
        }
    }
    Ok(SseBlockStatus::Continue)
}

pub(crate) fn openai_message(message: &LlmMessage) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("role".to_string(), json!(message.role));
    if message.images.is_empty() {
        object.insert("content".to_string(), json!(message.content));
    } else {
        let mut content = Vec::new();
        if !message.content.is_empty() {
            content.push(json!({ "type": "text", "text": message.content }));
        }
        for image in &message.images {
            content.push(json!({ "type": "image_url", "image_url": { "url": image } }));
        }
        object.insert("content".to_string(), Value::Array(content));
    }
    if let Some(name) = message
        .name
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        object.insert("name".to_string(), json!(name));
    }
    if let Some(tool_call_id) = message
        .tool_call_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        object.insert("tool_call_id".to_string(), json!(tool_call_id));
    }
    if let Some(tool_calls) = message.tool_calls.as_ref() {
        object.insert("tool_calls".to_string(), tool_calls.clone());
    }
    Value::Object(object)
}

pub(crate) fn apply_openai_parameters(body: &mut Value, request: &LlmRequest) {
    let parameters = &request.parameters;
    let xai_reasoning_active =
        request.connection.provider == "xai" && xai_reasoning_active(request);
    if should_send_openai_sampling_parameters(request) {
        if let Some(top_p) = param_f64(parameters, &["topP", "top_p"]) {
            body["top_p"] = json!(top_p);
        }
        if should_send_top_k(request) {
            if let Some(top_k) =
                param_i64(parameters, &["topK", "top_k"]).filter(|value| *value > 0)
            {
                body["top_k"] = json!(top_k);
            }
        }
        if let Some(frequency_penalty) =
            param_f64(parameters, &["frequencyPenalty", "frequency_penalty"])
                .filter(|_| !xai_reasoning_active)
        {
            body["frequency_penalty"] = json!(frequency_penalty);
        }
        if let Some(presence_penalty) =
            param_f64(parameters, &["presencePenalty", "presence_penalty"])
                .filter(|_| !xai_reasoning_active)
        {
            body["presence_penalty"] = json!(presence_penalty);
        }
        if request.connection.provider == "openrouter" || request.connection.provider == "nanogpt" {
            if let Some(min_p) = param_f64(parameters, &["minP", "min_p"])
                .filter(|value| (0.0..=1.0).contains(value))
            {
                body["min_p"] = json!(min_p);
            }
            if let Some(top_a) = param_f64(parameters, &["topA", "top_a"])
                .filter(|value| (0.0..=1.0).contains(value))
            {
                body["top_a"] = json!(top_a);
            }
            if let Some(repetition_penalty) =
                param_f64(parameters, &["repetitionPenalty", "repetition_penalty"])
                    .filter(|value| (0.0..=2.0).contains(value))
            {
                body["repetition_penalty"] = json!(repetition_penalty);
            }
            if request.connection.provider == "nanogpt" {
                if let Some(tfs) =
                    param_f64(parameters, &["tfs"]).filter(|value| (0.0..=1.0).contains(value))
                {
                    body["tfs"] = json!(tfs);
                }
                if let Some(eta_cutoff) = param_f64(parameters, &["etaCutoff", "eta_cutoff"]) {
                    body["eta_cutoff"] = json!(eta_cutoff);
                }
                if let Some(epsilon_cutoff) =
                    param_f64(parameters, &["epsilonCutoff", "epsilon_cutoff"])
                {
                    body["epsilon_cutoff"] = json!(epsilon_cutoff);
                }
                if let Some(typical_p) = param_f64(parameters, &["typicalP", "typical_p"])
                    .filter(|value| (0.0..=1.0).contains(value))
                {
                    body["typical_p"] = json!(typical_p);
                }
                if let Some(mirostat_mode) =
                    param_i64(parameters, &["mirostatMode", "mirostat_mode"])
                        .filter(|value| (0..=2).contains(value))
                {
                    body["mirostat_mode"] = json!(mirostat_mode);
                }
                if let Some(mirostat_tau) = param_f64(parameters, &["mirostatTau", "mirostat_tau"])
                {
                    body["mirostat_tau"] = json!(mirostat_tau);
                }
                if let Some(mirostat_eta) = param_f64(parameters, &["mirostatEta", "mirostat_eta"])
                {
                    body["mirostat_eta"] = json!(mirostat_eta);
                }
            }
        }
    }
    if let Some(seed) = param_i64(parameters, &["seed"]) {
        if request.connection.provider == "mistral" {
            body["random_seed"] = json!(seed);
        } else {
            body["seed"] = json!(seed);
        }
    }
    let send_sampling = should_send_openai_sampling_parameters(request);
    if send_sampling {
        if let Some(stop) = stop_sequences(parameters).filter(|_| !xai_reasoning_active) {
            body["stop"] = json!(stop);
        }
    }
    let response_format = param_string(parameters, &["responseFormat", "response_format"]);
    if let Some(format) = response_format.as_deref() {
        body["response_format"] = json!({ "type": format });
    }
    if request.connection.provider == "custom" && is_gemini_model(&request.connection.model) {
        let effort = openrouter_reasoning_effort(parameters).or_else(|| {
            matches!(response_format.as_deref(), Some("json_object")).then_some("none")
        });
        if let Some(effort) = effort {
            body["reasoning_effort"] = json!(effort);
        }
    }
    if request.connection.provider == "openrouter" {
        if let Some(reasoning) = openrouter_reasoning_config(parameters) {
            body["reasoning"] = reasoning;
        }
        if let Some(openrouter_provider) = request
            .connection
            .openrouter_provider
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            body["provider"] = json!({ "order": [openrouter_provider] });
        }
        if request.connection.enable_caching && model_contains(request, "claude") {
            body["cache_control"] = json!({ "type": "ephemeral" });
        }
        if let Some(service_tier) = param_string(parameters, &["serviceTier", "service_tier"])
            .filter(|value| is_openrouter_service_tier(value))
        {
            body["service_tier"] = json!(service_tier);
        }
        if let Some(verbosity) =
            param_string(parameters, &["verbosity"]).filter(|value| is_openrouter_verbosity(value))
        {
            body["verbosity"] = json!(verbosity);
        }
        if !request.tools.is_empty() {
            if let Some(parallel_tool_calls) = param_boolish(
                parameters,
                &["parallelToolCalls", "parallel_tool_calls"],
                true,
            ) {
                body["parallel_tool_calls"] = json!(parallel_tool_calls);
            }
        }
    } else if request.connection.provider == "xai" {
        if let Some(effort) = xai_reasoning_effort(request) {
            body["reasoning_effort"] = json!(effort);
        }
        if let Some(reasoning) = xai_reasoning_config(request) {
            body["reasoning"] = reasoning;
        }
        if let Some(service_tier) = param_string(parameters, &["serviceTier", "service_tier"])
            .filter(|value| is_xai_service_tier(value))
        {
            body["service_tier"] = json!(service_tier);
        }
        if !request.tools.is_empty() {
            if let Some(parallel_tool_calls) = param_boolish(
                parameters,
                &["parallelToolCalls", "parallel_tool_calls"],
                true,
            ) {
                body["parallel_tool_calls"] = json!(parallel_tool_calls);
            }
        }
    } else if request.connection.provider == "nanogpt" {
        if let Some(effort) = nanogpt_reasoning_effort(parameters) {
            body["reasoning_effort"] = json!(effort);
        }
        if let Some(reasoning) = nanogpt_reasoning_config(parameters) {
            body["reasoning"] = reasoning;
        }
        if let Some(prompt_caching) = nanogpt_prompt_caching_config(parameters) {
            body["prompt_caching"] = prompt_caching;
        }
        if let Some(caching) = param_boolish(parameters, &["caching"], false)
            .or(request.connection.enable_caching.then_some(true))
        {
            body["caching"] = json!(caching);
        }
        if let Some(sticky_provider) =
            param_boolish(parameters, &["stickyProvider", "stickyprovider"], true)
        {
            body["stickyProvider"] = json!(sticky_provider);
        }
        if let Some(provider) = parameters
            .get("nanoGptProvider")
            .or_else(|| parameters.get("nano_gpt_provider"))
            .or_else(|| parameters.get("provider"))
            .filter(|value| !value.is_null())
        {
            body["provider"] = provider.clone();
        }
        if let Some(billing_mode) = param_string(parameters, &["billingMode", "billing_mode"]) {
            body["billing_mode"] = json!(billing_mode);
        }
        if let Some(min_tokens) =
            param_i64(parameters, &["minTokens", "min_tokens"]).filter(|value| *value >= 0)
        {
            body["min_tokens"] = json!(min_tokens);
        }
        if let Some(include_stop) = param_boolish(
            parameters,
            &["includeStopStrInOutput", "include_stop_str_in_output"],
            false,
        ) {
            body["include_stop_str_in_output"] = json!(include_stop);
        }
        if let Some(ignore_eos) = param_boolish(parameters, &["ignoreEos", "ignore_eos"], false) {
            body["ignore_eos"] = json!(ignore_eos);
        }
        if let Some(no_repeat_ngram_size) =
            param_i64(parameters, &["noRepeatNgramSize", "no_repeat_ngram_size"])
                .filter(|value| *value >= 0)
        {
            body["no_repeat_ngram_size"] = json!(no_repeat_ngram_size);
        }
        if let Some(stop_token_ids) =
            param_i64_array(parameters, &["stopTokenIds", "stop_token_ids"])
        {
            body["stop_token_ids"] = json!(stop_token_ids);
        }
        if let Some(custom_token_bans) =
            param_i64_array(parameters, &["customTokenBans", "custom_token_bans"])
        {
            body["custom_token_bans"] = json!(custom_token_bans);
        }
        if let Some(logit_bias) = parameters
            .get("logitBias")
            .or_else(|| parameters.get("logit_bias"))
            .filter(|value| value.as_object().is_some())
        {
            body["logit_bias"] = logit_bias.clone();
        }
        if let Some(logprobs) = parameters.get("logprobs").filter(|value| !value.is_null()) {
            body["logprobs"] = logprobs.clone();
        }
        if let Some(prompt_logprobs) =
            param_boolish(parameters, &["promptLogprobs", "prompt_logprobs"], false)
        {
            body["prompt_logprobs"] = json!(prompt_logprobs);
        }
        if let Some(reasoning_delta_field) = param_string(
            parameters,
            &["reasoningDeltaField", "reasoning_delta_field"],
        )
        .filter(|value| value == "reasoning_content")
        {
            body["reasoning_delta_field"] = json!(reasoning_delta_field);
        }
        if let Some(reasoning_content_compat) = param_boolish(
            parameters,
            &["reasoningContentCompat", "reasoning_content_compat"],
            false,
        ) {
            body["reasoning_content_compat"] = json!(reasoning_content_compat);
        }
    } else if request.connection.provider == "openai" {
        if let Some(service_tier) = param_string(parameters, &["serviceTier", "service_tier"])
            .filter(|value| is_openai_service_tier(value))
        {
            body["service_tier"] = json!(service_tier);
        }
    } else if request.connection.provider == "mistral" {
        if let Some(effort) = mistral_reasoning_effort(request) {
            body["reasoning_effort"] = json!(effort);
        }
        if let Some(safe_prompt) = param_boolish(parameters, &["safePrompt", "safe_prompt"], false)
        {
            body["safe_prompt"] = json!(safe_prompt);
        }
        if let Some(prompt_cache_key) =
            param_string(parameters, &["promptCacheKey", "prompt_cache_key"])
        {
            body["prompt_cache_key"] = json!(prompt_cache_key);
        }
        if let Some(prompt_mode) = param_string(parameters, &["promptMode", "prompt_mode"])
            .filter(|value| value == "reasoning")
        {
            body["prompt_mode"] = json!(prompt_mode);
        }
        if let Some(parallel_tool_calls) = param_boolish(
            parameters,
            &["parallelToolCalls", "parallel_tool_calls"],
            true,
        ) {
            body["parallel_tool_calls"] = json!(parallel_tool_calls);
        }
        if let Some(prediction) = parameters
            .get("prediction")
            .filter(|value| !value.is_null())
        {
            body["prediction"] = prediction.clone();
        }
    }
    if request.connection.provider == "xai" {
        apply_xai_custom_parameters_to_object(
            body,
            parameters,
            !send_sampling,
            !send_sampling,
            &request.connection.model,
            xai_reasoning_active,
        );
    } else {
        let skip_keys = if request.connection.provider == "nanogpt"
            && is_nanogpt_glm_model(&request.connection.model)
        {
            &["top_k", "topK"][..]
        } else {
            &[]
        };
        apply_custom_parameters_to_object(
            body,
            parameters,
            !send_sampling,
            !send_sampling,
            skip_keys,
        );
    }
    if request.connection.provider == "mistral" {
        if let Some(body) = body.as_object_mut() {
            body.retain(|key, _| !is_mistral_unsupported_custom_parameter_key(key));
        }
    }
    if let Some(openrouter) = parameters
        .get("openrouter")
        .or_else(|| parameters.get("openRouter"))
    {
        if !openrouter.is_null() {
            body["provider"] = openrouter.clone();
        }
    }
    if let Some(tool_choice) = parameters
        .get("toolChoice")
        .or_else(|| parameters.get("tool_choice"))
        .filter(|value| !value.is_null())
    {
        body["tool_choice"] = tool_choice.clone();
    }
}

fn apply_requested_tool_choice(body: &mut Value, parameters: &Value) {
    if let Some(tool_choice) = parameters
        .get("toolChoice")
        .or_else(|| parameters.get("tool_choice"))
        .filter(|value| !value.is_null())
    {
        body["tool_choice"] = tool_choice.clone();
    }
}
