use crate::providers::sse::{ensure_sse_buffer_within_limit, take_sse_block};
use crate::*;

pub(crate) fn build_anthropic_body(request: &LlmRequest, stream: bool) -> Value {
    let mut system = Vec::new();
    let mut anthropic_messages = Vec::new();
    let messages = request_messages(request);
    for message in messages {
        if message.role == "system" {
            system.push(message.content);
        } else {
            let role = if message.role == "assistant" {
                "assistant"
            } else {
                "user"
            };
            if message.images.is_empty() {
                anthropic_messages.push(json!({ "role": role, "content": message.content }));
            } else {
                let mut content = Vec::new();
                if !message.content.is_empty() {
                    content.push(json!({ "type": "text", "text": message.content }));
                }
                for image in &message.images {
                    if let Some((media_type, data)) = data_url_image(image) {
                        content.push(json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": data
                            }
                        }));
                    }
                }
                anthropic_messages.push(json!({ "role": role, "content": content }));
            }
        }
    }
    let mut body = json!({
        "model": request.connection.model,
        "messages": anthropic_messages,
        "max_tokens": request_max_tokens(request, 1024),
    });
    if stream {
        body["stream"] = json!(true);
    }
    if !system.is_empty() {
        body["system"] = json!(system.join("\n\n"));
    }
    let sampling_restricted = is_anthropic_sampling_restricted_model(&request.connection.model);
    let thinking_effort = anthropic_thinking_effort(&request.connection.model, &request.parameters);
    let adaptive_thinking = should_use_anthropic_adaptive_thinking(
        &request.connection.model,
        &request.parameters,
        thinking_effort,
    );
    let send_temperature_and_top_k = !sampling_restricted && !adaptive_thinking;
    if send_temperature_and_top_k {
        if let Some(temp) = temperature(&request.parameters) {
            body["temperature"] = json!(temp);
        }
    }
    if !sampling_restricted {
        if let Some(top_p) = param_f64(&request.parameters, &["topP", "top_p"]) {
            if !adaptive_thinking || top_p >= 0.95 {
                body["top_p"] = json!(top_p);
            }
        }
    }
    if send_temperature_and_top_k {
        if let Some(top_k) = param_i64(&request.parameters, &["topK", "top_k"]) {
            body["top_k"] = json!(top_k);
        }
    }
    if adaptive_thinking {
        body["thinking"] = json!({ "type": "adaptive", "display": "summarized" });
        if let Some(effort) = thinking_effort {
            body["output_config"] = json!({ "effort": effort });
        }
    } else if let Some(effort) = thinking_effort {
        let budget_tokens = anthropic_thinking_budget_tokens(effort);
        body["thinking"] = json!({ "type": "enabled", "budget_tokens": budget_tokens });
        body["max_tokens"] = json!(request_max_tokens(request, 1024) + budget_tokens);
    }
    if let Some(service_tier) = param_string(&request.parameters, &["serviceTier", "service_tier"])
        .filter(|value| is_anthropic_service_tier(value))
    {
        body["service_tier"] = json!(service_tier);
    }
    if let Some(stop) = stop_sequences(&request.parameters) {
        body["stop_sequences"] = json!(stop);
    }
    apply_custom_parameters_to_object(
        &mut body,
        &request.parameters,
        sampling_restricted || adaptive_thinking,
        false,
        &[],
    );
    body
}

pub(crate) async fn anthropic_request(
    request: &LlmRequest,
    body: &Value,
    kind: &str,
) -> AppResult<reqwest::Response> {
    let base = base_url(&request.connection.provider, &request.connection.base_url);
    let url = anthropic_endpoint(&base, "messages");
    log_prompt_connection_request(kind, &url, request, body);
    send_provider_request(
        provider_http_client_for_url(&url)
            .await?
            .post(url)
            .header("x-api-key", request.connection.api_key.trim())
            .header("anthropic-version", "2023-06-01")
            .json(body),
    )
    .await
}

pub(crate) async fn complete_anthropic_rich(request: LlmRequest) -> AppResult<LlmCompletion> {
    let body = build_anthropic_body(&request, false);
    let response = anthropic_request(&request, &body, "anthropic.messages").await?;
    let (status, json) = read_json_response(response).await?;
    if !status.is_success() {
        return Err(provider_http_error(status, json));
    }
    let content = json
        .get("content")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .find(|text| !text.trim().is_empty())
        })
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            AppError::with_details(
                "llm_response_error",
                "Provider response did not contain assistant text",
                redact_sensitive_json(json.clone()),
            )
        })?;
    Ok(LlmCompletion {
        content,
        tool_calls: Vec::new(),
        finish_reason: json
            .get("stop_reason")
            .and_then(Value::as_str)
            .map(str::to_string),
        usage: json.get("usage").cloned(),
        provider_metadata: None,
    })
}

pub(crate) async fn stream_anthropic(
    request: LlmRequest,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    let body = build_anthropic_body(&request, true);
    let response = anthropic_request(&request, &body, "anthropic.messages.stream").await?;
    let status = response.status();
    if !status.is_success() {
        let error_body = read_error_response_details(response).await?;
        return Err(provider_http_error(status, error_body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut decoder = Utf8StreamDecoder::default();
    let mut completed = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            AppError::new("llm_stream_error", provider_transport_error_message(error))
        })?;
        decoder.push_chunk(&chunk, &mut buffer);
        ensure_sse_buffer_within_limit(&buffer)?;
        while let Some(block) = take_sse_block(&mut buffer) {
            if process_anthropic_sse_block(&block, emit)? == SseBlockStatus::Complete {
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
        process_anthropic_sse_block(&buffer, emit)?;
    }
    Ok(())
}

pub(crate) fn emit_anthropic_usage(
    value: &Value,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    if let Some(usage) = value
        .get("usage")
        .or_else(|| value.pointer("/message/usage"))
        .or_else(|| value.pointer("/delta/usage"))
    {
        emit(json!({ "type": "usage", "data": usage }))?;
    }
    Ok(())
}

pub(crate) fn emit_anthropic_token(
    text: &str,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    if !text.is_empty() {
        emit(json!({ "type": "token", "text": text, "data": text }))?;
    }
    Ok(())
}

pub(crate) fn emit_anthropic_thinking(
    thinking: &str,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    if !thinking.is_empty() {
        emit(json!({ "type": "thinking", "text": thinking, "data": thinking }))?;
    }
    Ok(())
}

pub(crate) fn process_anthropic_sse_block(
    block: &str,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
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
        "message_start" | "message_delta" => {
            emit_anthropic_usage(&value, emit)?;
        }
        "content_block_start" => {
            if let Some(block) = value.get("content_block") {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            emit_anthropic_token(text, emit)?;
                        }
                    }
                    Some("thinking") => {
                        if let Some(thinking) = block.get("thinking").and_then(Value::as_str) {
                            emit_anthropic_thinking(thinking, emit)?;
                        }
                    }
                    _ => {}
                }
            }
        }
        "content_block_delta" => {
            if let Some(delta) = value.get("delta") {
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            emit_anthropic_token(text, emit)?;
                        }
                    }
                    Some("thinking_delta") => {
                        if let Some(thinking) = delta
                            .get("thinking")
                            .or_else(|| delta.get("text"))
                            .and_then(Value::as_str)
                        {
                            emit_anthropic_thinking(thinking, emit)?;
                        }
                    }
                    _ => {
                        if let Some(thinking) = delta.get("thinking").and_then(Value::as_str) {
                            emit_anthropic_thinking(thinking, emit)?;
                        }
                    }
                }
            }
        }
        "error" => {
            let error = value.get("error").cloned().unwrap_or(value);
            return Err(AppError::with_details(
                "llm_provider_error",
                "Anthropic stream error",
                redact_sensitive_json(error),
            ));
        }
        "message_stop" => return Ok(SseBlockStatus::Complete),
        _ => {}
    }
    Ok(SseBlockStatus::Continue)
}

pub(crate) fn anthropic_endpoint(base: &str, path: &str) -> String {
    let base = base.trim_end_matches('/');
    if base.ends_with("/v1") {
        format!("{base}/{path}")
    } else {
        format!("{base}/v1/{path}")
    }
}
