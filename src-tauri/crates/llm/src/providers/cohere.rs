use crate::providers::sse::{
    ensure_sse_buffer_within_limit, take_sse_block, OpenAiToolCallAccumulator,
};
use crate::*;

pub(crate) fn cohere_message(message: &LlmMessage) -> Value {
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

pub(crate) fn cohere_response_format(parameters: &Value) -> Option<Value> {
    let value = parameters
        .get("response_format")
        .or_else(|| parameters.get("responseFormat"))?;
    if let Some(format) = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(json!({ "type": format }));
    }
    value.as_object().map(|_| value.clone())
}

pub(crate) fn apply_cohere_parameters(body: &mut Value, request: &LlmRequest) {
    let parameters = &request.parameters;
    if let Some(temp) = temperature(parameters) {
        body["temperature"] = json!(temp);
    }
    if let Some(top_p) = param_f64(parameters, &["topP", "top_p", "p"]) {
        body["p"] = json!(top_p);
    }
    if let Some(top_k) = param_i64(parameters, &["topK", "top_k", "k"]).filter(|value| *value >= 0)
    {
        body["k"] = json!(top_k);
    }
    if let Some(frequency_penalty) =
        param_f64(parameters, &["frequencyPenalty", "frequency_penalty"])
    {
        body["frequency_penalty"] = json!(frequency_penalty);
    }
    if let Some(presence_penalty) = param_f64(parameters, &["presencePenalty", "presence_penalty"])
    {
        body["presence_penalty"] = json!(presence_penalty);
    }
    if let Some(seed) = param_i64(parameters, &["seed"]) {
        body["seed"] = json!(seed);
    }
    if let Some(stop) = stop_sequences(parameters) {
        body["stop_sequences"] = json!(stop);
    }
    if request.tools.is_empty() {
        if let Some(response_format) = cohere_response_format(parameters) {
            body["response_format"] = response_format;
        }
    }
    if request.tools.is_empty() {
        if let Some(safety_mode) = param_string(parameters, &["safetyMode", "safety_mode"])
            .map(|value| value.to_ascii_uppercase())
            .filter(|value| is_cohere_safety_mode(value))
        {
            body["safety_mode"] = json!(safety_mode);
        }
    }
    if let Some(logprobs) = param_boolish(parameters, &["logprobs", "logProbs"], false) {
        body["logprobs"] = json!(logprobs);
    }
    if !request.tools.is_empty() {
        if let Some(tool_choice) = param_string(parameters, &["toolChoice", "tool_choice"])
            .and_then(|value| cohere_tool_choice(&value))
        {
            body["tool_choice"] = json!(tool_choice);
        }
    }
    if let Some(priority) =
        param_i64(parameters, &["priority"]).filter(|value| (0..=999).contains(value))
    {
        body["priority"] = json!(priority);
    }
    if !request.tools.is_empty() {
        if let Some(strict_tools) =
            param_boolish(parameters, &["strictTools", "strict_tools"], false)
        {
            body["strict_tools"] = json!(strict_tools);
        }
    }
    if let Some(thinking) = cohere_thinking_config(request) {
        body["thinking"] = thinking;
    }
    apply_custom_parameters_to_object(body, parameters, false, false, &[]);
    scrub_cohere_parameter_body(body, !request.tools.is_empty());
}

pub(crate) fn build_cohere_body(request: &LlmRequest, stream: bool) -> Value {
    let messages: Vec<Value> = request_messages(request)
        .iter()
        .map(cohere_message)
        .collect();
    let mut body = json!({
        "model": request.connection.model,
        "messages": messages,
        "stream": stream,
        "max_tokens": request_max_tokens(request, 1024),
    });
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(
            request
                .tools
                .iter()
                .map(|tool| json!({ "type": "function", "function": tool }))
                .collect(),
        );
    }
    apply_cohere_parameters(&mut body, request);
    body
}

pub(crate) async fn complete_cohere_rich(request: LlmRequest) -> AppResult<LlmCompletion> {
    let url = cohere_chat_endpoint(&request.connection.base_url);
    let body = build_cohere_body(&request, false);
    log_prompt_connection_request("cohere.v2.chat", &url, &request, &body);
    let client = provider_http_client_for_url(&url).await?;
    let mut req = client.post(url).json(&body);
    if !request.connection.api_key.trim().is_empty() {
        req = req.bearer_auth(request.connection.api_key.trim());
    }
    let response = send_provider_request(req).await?;
    parse_cohere_response_rich(response).await
}

pub(crate) async fn stream_cohere(
    request: LlmRequest,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    let url = cohere_chat_endpoint(&request.connection.base_url);
    let body = build_cohere_body(&request, true);
    log_prompt_connection_request("cohere.v2.chat.stream", &url, &request, &body);
    let client = provider_http_client_for_url(&url).await?;
    let mut req = client.post(url).json(&body);
    if !request.connection.api_key.trim().is_empty() {
        req = req.bearer_auth(request.connection.api_key.trim());
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
            if process_cohere_sse_block(&block, emit, &mut tool_calls)? == SseBlockStatus::Complete
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
        process_cohere_sse_block(&buffer, emit, &mut tool_calls)?;
    }
    for tool_call in tool_calls.into_tool_calls() {
        emit(json!({ "type": "tool_call", "data": tool_call }))?;
    }
    Ok(())
}

pub(crate) fn cohere_delta_text(value: &Value) -> Option<String> {
    value
        .pointer("/delta/message/content/text")
        .or_else(|| value.pointer("/delta/message/content/thinking"))
        .or_else(|| value.pointer("/delta/message/content"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(crate) fn cohere_event_thinking_text(value: &Value) -> Option<String> {
    value
        .pointer("/delta/message/content/thinking")
        .or_else(|| value.pointer("/delta/message/thinking"))
        .or_else(|| value.pointer("/delta/message/content/text"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(crate) fn cohere_tool_call_delta(value: &Value) -> Option<Value> {
    let index = value.get("index").and_then(Value::as_u64).unwrap_or(0);
    let tool_call = value
        .pointer("/delta/message/tool_calls")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .or_else(|| value.pointer("/delta/message/tool_calls"))?;
    let id = tool_call
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let function = tool_call.get("function").unwrap_or(tool_call);
    let name = function
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let arguments = function
        .get("arguments")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut call = json!({
        "index": index,
        "type": "function",
        "function": {
            "arguments": arguments,
        }
    });
    if let Some(id) = id {
        call["id"] = json!(id);
    }
    if let Some(name) = name {
        call["function"]["name"] = json!(name);
    }
    Some(json!({ "tool_calls": [call] }))
}

pub(crate) fn process_cohere_sse_block(
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
    let value: Value = serde_json::from_str(&payload)
        .map_err(|error| AppError::new("llm_stream_parse_error", error.to_string()))?;
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    match event_type {
        "content-delta" => {
            if value
                .pointer("/delta/message/content/type")
                .and_then(Value::as_str)
                == Some("thinking")
            {
                if let Some(thinking) =
                    cohere_event_thinking_text(&value).filter(|text| !text.is_empty())
                {
                    emit(json!({ "type": "thinking", "text": thinking, "data": thinking }))?;
                }
            } else if let Some(text) = cohere_delta_text(&value).filter(|text| !text.is_empty()) {
                emit(json!({ "type": "token", "text": text, "data": text }))?;
            }
        }
        "tool-plan-delta" => {
            if let Some(plan) = value
                .pointer("/delta/message/tool_plan")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
            {
                emit(json!({ "type": "thinking", "text": plan, "data": plan }))?;
            }
        }
        "tool-call-start" | "tool-call-delta" => {
            if let Some(delta) = cohere_tool_call_delta(&value) {
                tool_calls.ingest_delta(&delta);
            }
        }
        "message-end" => {
            if let Some(usage) = value
                .pointer("/delta/usage")
                .or_else(|| value.get("usage"))
                .filter(|usage| !usage.is_null())
            {
                emit(json!({ "type": "usage", "data": usage }))?;
            }
            return Ok(SseBlockStatus::Complete);
        }
        _ => {}
    }
    Ok(SseBlockStatus::Continue)
}
