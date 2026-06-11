use crate::providers::sse::{ensure_sse_buffer_within_limit, take_sse_block};
use crate::*;

pub(crate) fn google_vertex_endpoint(base: &str, model: &str, endpoint: &str) -> String {
    let base = base
        .trim_end_matches('/')
        .trim_end_matches("/publishers/google/models")
        .to_string();
    format!("{base}/publishers/google/models/{model}:{endpoint}")
}

#[derive(Debug, Clone)]
pub(crate) struct GoogleServiceAccountKey {
    client_email: String,
    private_key: String,
    private_key_id: Option<String>,
    token_uri: String,
}

pub(crate) fn google_vertex_token_cache(
) -> &'static Mutex<BTreeMap<String, GoogleVertexCachedToken>> {
    GOOGLE_VERTEX_TOKEN_CACHE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

pub(crate) fn parse_google_service_account_key(
    credential: &str,
) -> AppResult<Option<GoogleServiceAccountKey>> {
    let trimmed = credential.trim();
    if !trimmed.starts_with('{') {
        return Ok(None);
    }
    let value = serde_json::from_str::<Value>(trimmed).map_err(|error| {
        AppError::invalid_input(format!(
            "Google Vertex service account credential is invalid JSON: {error}"
        ))
    })?;
    let client_email = value
        .get("client_email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::invalid_input(
                "Google Vertex service account credential is missing client_email",
            )
        })?
        .to_string();
    let private_key = value
        .get("private_key")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::invalid_input(
                "Google Vertex service account credential is missing private_key",
            )
        })?
        .replace("\\n", "\n");
    let private_key_id = value
        .get("private_key_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let token_uri = value
        .get("token_uri")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(GOOGLE_OAUTH_TOKEN_URL)
        .to_string();
    Ok(Some(GoogleServiceAccountKey {
        client_email,
        private_key,
        private_key_id,
        token_uri,
    }))
}

pub(crate) fn looks_like_google_bearer_token(credential: &str) -> bool {
    let credential = credential.trim();
    credential.starts_with("ya29.")
        || credential.split('.').count() == 3
            && credential
                .chars()
                .all(|item| item.is_ascii_alphanumeric() || matches!(item, '-' | '_' | '.'))
}

pub(crate) fn google_vertex_cache_key(service_account: &GoogleServiceAccountKey) -> String {
    format!(
        "{}:{}:{}",
        service_account.client_email,
        service_account.token_uri,
        service_account.private_key_id.as_deref().unwrap_or("")
    )
}

pub(crate) fn cached_google_vertex_access_token(cache_key: &str) -> Option<String> {
    let now = Utc::now().timestamp();
    let cache = google_vertex_token_cache().lock().ok()?;
    cache
        .get(cache_key)
        .filter(|token| token.expires_at - now > GOOGLE_VERTEX_TOKEN_REFRESH_SKEW_SECONDS)
        .map(|token| token.access_token.clone())
}

pub(crate) fn store_google_vertex_access_token(
    cache_key: String,
    access_token: String,
    expires_in: i64,
) {
    let expires_in = expires_in.max(60);
    let token = GoogleVertexCachedToken {
        access_token,
        expires_at: Utc::now().timestamp() + expires_in,
    };
    if let Ok(mut cache) = google_vertex_token_cache().lock() {
        cache.insert(cache_key, token);
    }
}

pub(crate) fn base64_url_json(value: &Value) -> AppResult<String> {
    let serialized = serde_json::to_vec(value)
        .map_err(|error| AppError::new("google_vertex_auth_error", error.to_string()))?;
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(serialized))
}

pub(crate) fn google_service_account_private_key_der(private_key: &str) -> AppResult<Vec<u8>> {
    let pem_body = private_key
        .replace("\\n", "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("-----"))
        .collect::<String>();
    general_purpose::STANDARD.decode(pem_body).map_err(|_| {
        AppError::invalid_input(
            "Google Vertex service account private_key is not a valid PEM private key",
        )
    })
}

pub(crate) fn sign_google_service_account_jwt(
    service_account: &GoogleServiceAccountKey,
) -> AppResult<String> {
    let mut header = json!({ "alg": "RS256", "typ": "JWT" });
    if let Some(private_key_id) = service_account.private_key_id.as_deref() {
        header["kid"] = json!(private_key_id);
    }
    let now = Utc::now().timestamp();
    let claims = json!({
        "iss": service_account.client_email,
        "scope": GOOGLE_CLOUD_PLATFORM_SCOPE,
        "aud": service_account.token_uri,
        "exp": now + 3600,
        "iat": now,
    });
    let unsigned_jwt = format!(
        "{}.{}",
        base64_url_json(&header)?,
        base64_url_json(&claims)?
    );
    let der = google_service_account_private_key_der(&service_account.private_key)?;
    let key_pair = ring::rsa::KeyPair::from_pkcs8(&der)
        .or_else(|_| ring::rsa::KeyPair::from_der(&der))
        .map_err(|_| {
            AppError::invalid_input(
                "Google Vertex service account private_key could not be used for RS256 signing",
            )
        })?;
    let rng = ring::rand::SystemRandom::new();
    let mut signature_bytes = vec![0; key_pair.public().modulus_len()];
    key_pair
        .sign(
            &ring::signature::RSA_PKCS1_SHA256,
            &rng,
            unsigned_jwt.as_bytes(),
            &mut signature_bytes,
        )
        .map_err(|_| {
            AppError::new(
                "google_vertex_auth_error",
                "Failed to sign Google Vertex service account JWT",
            )
        })?;
    Ok(format!(
        "{unsigned_jwt}.{}",
        general_purpose::URL_SAFE_NO_PAD.encode(signature_bytes)
    ))
}

pub(crate) fn google_vertex_auth_error(status: reqwest::StatusCode, details: Value) -> AppError {
    let details = redact_sensitive_json(details);
    let message = provider_error_text(&details)
        .map(|detail| format!("Google Vertex service account auth failed HTTP {status}: {detail}"))
        .unwrap_or_else(|| format!("Google Vertex service account auth failed HTTP {status}"));
    AppError::with_details("google_vertex_auth_error", message, details)
}

pub(crate) async fn fetch_google_vertex_access_token(
    service_account: &GoogleServiceAccountKey,
) -> AppResult<String> {
    let cache_key = google_vertex_cache_key(service_account);
    if let Some(access_token) = cached_google_vertex_access_token(&cache_key) {
        return Ok(access_token);
    }
    let assertion = sign_google_service_account_jwt(service_account)?;
    let response = send_provider_request_with_error_code(
        provider_http_client_for_url(&service_account.token_uri)
            .await?
            .post(&service_account.token_uri)
            .form(&[
                ("grant_type", GOOGLE_JWT_BEARER_GRANT_TYPE),
                ("assertion", assertion.as_str()),
            ]),
        "google_vertex_auth_network_error",
    )
    .await?;
    let (status, json) = read_json_response(response).await?;
    if !status.is_success() {
        return Err(google_vertex_auth_error(status, json));
    }
    let access_token = json
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::with_details(
                "google_vertex_auth_error",
                "Google Vertex service account auth response did not contain access_token",
                redact_sensitive_json(json.clone()),
            )
        })?
        .to_string();
    let expires_in = json
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or(3600);
    store_google_vertex_access_token(cache_key, access_token.clone(), expires_in);
    Ok(access_token)
}

pub async fn google_vertex_auth_headers_for_credential(
    credential: &str,
) -> AppResult<BTreeMap<String, String>> {
    let credential = credential.trim();
    let mut headers = BTreeMap::new();
    if credential.is_empty() {
        return Ok(headers);
    }
    if let Some(service_account) = parse_google_service_account_key(credential)? {
        let access_token = fetch_google_vertex_access_token(&service_account).await?;
        headers.insert(
            "Authorization".to_string(),
            format!("Bearer {access_token}"),
        );
    } else if looks_like_google_bearer_token(credential) {
        headers.insert("Authorization".to_string(), format!("Bearer {credential}"));
    } else {
        headers.insert("x-goog-api-key".to_string(), credential.to_string());
    }
    Ok(headers)
}

pub(crate) async fn apply_google_vertex_auth_headers(
    mut request: reqwest::RequestBuilder,
    credential: &str,
) -> AppResult<reqwest::RequestBuilder> {
    for (name, value) in google_vertex_auth_headers_for_credential(credential).await? {
        request = request.header(name, value);
    }
    Ok(request)
}

pub(crate) fn normalize_google_base_url(base: String) -> String {
    let trimmed = base.trim_end_matches('/').to_string();
    let Ok(mut url) = reqwest::Url::parse(&trimmed) else {
        return trimmed;
    };
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if matches!(
        host.as_str(),
        "linkapi.ai" | "www.linkapi.ai" | "home.linkapi.ai"
    ) && url.set_host(Some("api.linkapi.ai")).is_ok()
    {
        return url.to_string().trim_end_matches('/').to_string();
    }
    trimmed
}

pub(crate) fn google_api_base(request: &LlmRequest) -> String {
    let base = normalize_google_base_url(base_url(
        &request.connection.provider,
        &request.connection.base_url,
    ));
    if request.connection.provider == "google"
        && (base.ends_with("/v1beta") || base.ends_with("/v1"))
    {
        base
    } else if request.connection.provider == "google" {
        format!("{base}/v1beta")
    } else {
        base
    }
}

pub(crate) fn google_endpoint(request: &LlmRequest, endpoint: &str, streaming: bool) -> String {
    let base = google_api_base(request);
    let url = if request.connection.provider == "google_vertex" {
        google_vertex_endpoint(&base, &request.connection.model, endpoint)
    } else {
        format!(
            "{base}/models/{}:{}?key={}",
            request.connection.model,
            endpoint,
            request.connection.api_key.trim()
        )
    };
    if streaming {
        let separator = if url.contains('?') { '&' } else { '?' };
        format!("{url}{separator}alt=sse")
    } else {
        url
    }
}

pub(crate) fn google_contents(request: &LlmRequest) -> Vec<Value> {
    let contents: Vec<Value> = request_messages(request)
        .into_iter()
        .filter(|message| message.role != "system")
        .filter_map(|message| {
            let role = if message.role == "assistant" {
                "model"
            } else {
                "user"
            };
            let mut parts = Vec::new();
            if !message.content.is_empty() {
                parts.push(json!({ "text": message.content }));
            }
            for image in &message.images {
                if let Some((mime_type, data)) = data_url_image(image) {
                    parts.push(json!({ "inlineData": { "mimeType": mime_type, "data": data } }));
                }
            }
            (!parts.is_empty()).then(|| json!({ "role": role, "parts": parts }))
        })
        .collect();
    if contents.is_empty() {
        vec![json!({ "role": "user", "parts": [{ "text": "Continue." }] })]
    } else {
        contents
    }
}

pub(crate) fn google_system_instruction(request: &LlmRequest) -> Option<Value> {
    let system = request_messages(request)
        .into_iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .collect::<Vec<_>>();
    (!system.is_empty()).then(|| json!({ "parts": [{ "text": system.join("\n\n") }] }))
}

pub(crate) fn google_generation_config(request: &LlmRequest) -> Value {
    let is_gemini_3 = is_gemini_3_model(&request.connection.model);
    let mut generation_config = json!({
        "maxOutputTokens": request_max_tokens(request, 1024),
    });
    if !is_gemini_3 {
        generation_config["temperature"] = json!(temperature(&request.parameters).unwrap_or(0.7));
        if let Some(top_p) = param_f64(&request.parameters, &["topP", "top_p"]) {
            generation_config["topP"] = json!(top_p);
        }
        if let Some(top_k) =
            param_i64(&request.parameters, &["topK", "top_k"]).filter(|value| *value > 0)
        {
            generation_config["topK"] = json!(top_k);
        }
    }
    if let Some(frequency_penalty) = param_f64(
        &request.parameters,
        &["frequencyPenalty", "frequency_penalty"],
    ) {
        generation_config["frequencyPenalty"] = json!(frequency_penalty);
    }
    if let Some(presence_penalty) = param_f64(
        &request.parameters,
        &["presencePenalty", "presence_penalty"],
    ) {
        generation_config["presencePenalty"] = json!(presence_penalty);
    }
    if let Some(thinking_config) =
        google_thinking_config(&request.connection.model, &request.parameters)
    {
        generation_config["thinkingConfig"] = thinking_config;
    }
    if let Some(stop) = stop_sequences(&request.parameters) {
        generation_config["stopSequences"] = json!(stop);
    }
    if let Some(entries) = request
        .parameters
        .get("customParameters")
        .or_else(|| request.parameters.get("custom_params"))
        .and_then(Value::as_object)
    {
        if let Some(custom_generation_config) =
            entries.get("generationConfig").and_then(Value::as_object)
        {
            for (key, value) in custom_generation_config {
                if should_apply_custom_parameter(key, false, false, &[])
                    && !(is_gemini_3 && is_google_gemini_3_unsupported_generation_config_key(key))
                {
                    if let Some(config) = generation_config.as_object_mut() {
                        if !config.contains_key(key) {
                            config.insert(key.clone(), value.clone());
                        }
                    }
                }
            }
        }
        for (key, value) in entries {
            if key == "generationConfig"
                || !is_google_generation_config_custom_parameter_key(key)
                || !should_apply_custom_parameter(key, false, false, &[])
                || is_gemini_3 && is_google_gemini_3_unsupported_generation_config_key(key)
            {
                continue;
            }
            if let Some(config) = generation_config.as_object_mut() {
                if !config.contains_key(key) {
                    config.insert(key.clone(), value.clone());
                }
            }
        }
    }
    if is_gemini_3 {
        if let Some(config) = generation_config.as_object_mut() {
            config.retain(|key, _| !is_google_gemini_3_unsupported_generation_config_key(key));
        }
    }
    generation_config
}

pub(crate) fn apply_google_custom_parameters_to_body(body: &mut Value, request: &LlmRequest) {
    let Some(entries) = request
        .parameters
        .get("customParameters")
        .or_else(|| request.parameters.get("custom_params"))
        .and_then(Value::as_object)
    else {
        return;
    };
    let Some(body) = body.as_object_mut() else {
        return;
    };
    for (key, value) in entries {
        if key == "generationConfig"
            || is_google_generation_config_custom_parameter_key(key)
            || !should_apply_custom_parameter(key, false, false, &[])
        {
            continue;
        }
        if !body.contains_key(key) {
            body.insert(key.clone(), value.clone());
        }
    }
}

pub(crate) fn google_generate_body(request: &LlmRequest) -> Value {
    let mut body = json!({
        "contents": google_contents(request),
        "generationConfig": google_generation_config(request),
    });
    if let Some(system_instruction) = google_system_instruction(request) {
        body["systemInstruction"] = system_instruction;
    }
    apply_google_custom_parameters_to_body(&mut body, request);
    body
}

pub(crate) async fn complete_google_rich(request: LlmRequest) -> AppResult<LlmCompletion> {
    let url = google_endpoint(&request, "generateContent", false);
    let body = google_generate_body(&request);
    log_prompt_connection_request("google.generateContent", &url, &request, &body);
    let mut request_builder = provider_http_client_for_url(&url)
        .await?
        .post(url)
        .json(&body);
    if request.connection.provider == "google_vertex" {
        request_builder =
            apply_google_vertex_auth_headers(request_builder, &request.connection.api_key).await?;
    }
    let response = send_provider_request(request_builder).await?;
    let (status, json) = read_json_response(response).await?;
    if !status.is_success() {
        return Err(provider_http_error(status, json));
    }
    let candidate = json
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(|| {
            AppError::with_details(
                "llm_response_error",
                "Provider response did not contain a completion candidate",
                redact_sensitive_json(json.clone()),
            )
        })?;
    let content = google_candidate_text(candidate)
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
        finish_reason: candidate
            .get("finishReason")
            .and_then(Value::as_str)
            .map(str::to_string),
        usage: json.get("usageMetadata").cloned(),
        provider_metadata: None,
    })
}

pub(crate) fn google_candidate_text(candidate: &Value) -> Option<String> {
    let text = candidate
        .get("content")
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)?
        .iter()
        .filter(|part| {
            !part
                .get("thought")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

pub(crate) async fn stream_google(
    request: LlmRequest,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
) -> AppResult<()> {
    let url = google_endpoint(&request, "streamGenerateContent", true);
    let body = google_generate_body(&request);
    log_prompt_connection_request("google.streamGenerateContent", &url, &request, &body);
    let mut request_builder = provider_http_client_for_url(&url)
        .await?
        .post(url)
        .json(&body);
    if request.connection.provider == "google_vertex" {
        request_builder =
            apply_google_vertex_auth_headers(request_builder, &request.connection.api_key).await?;
    }
    let response = send_provider_request(request_builder).await?;
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
            if process_google_sse_block(&block, emit)? == SseBlockStatus::Complete {
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
    if !completed
        && !buffer.trim().is_empty()
        && process_google_sse_block(&buffer, emit)? == SseBlockStatus::Complete
    {
        completed = true;
    }
    ensure_google_stream_completed(completed)
}

pub(crate) fn ensure_google_stream_completed(completed: bool) -> AppResult<()> {
    if completed {
        return Ok(());
    }
    Err(AppError::new(
        "llm_stream_incomplete",
        "Google/Gemini stream ended before Gemini sent a finish reason. The provider response may be incomplete; retry the request.",
    ))
}

pub(crate) fn process_google_sse_block(
    block: &str,
    emit: &mut (impl FnMut(Value) -> AppResult<()> + Send),
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
    if let Some(error) = value.get("error") {
        return Err(AppError::with_details(
            "llm_provider_error",
            "Gemini API stream error",
            redact_sensitive_json(error.clone()),
        ));
    }
    if let Some(usage) = value.get("usageMetadata") {
        emit(json!({ "type": "usage", "data": usage }))?;
    }
    let Some(candidates) = value.get("candidates").and_then(Value::as_array) else {
        return Ok(SseBlockStatus::Continue);
    };
    for candidate in candidates {
        if let Some(parts) = candidate
            .get("content")
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
        {
            for part in parts {
                let Some(text) = part
                    .get("text")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                else {
                    continue;
                };
                if part
                    .get("thought")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    emit(json!({ "type": "thinking", "text": text, "data": text }))?;
                } else {
                    emit(json!({ "type": "token", "text": text, "data": text }))?;
                }
            }
        }
        if let Some(reason) = candidate
            .get("finishReason")
            .and_then(Value::as_str)
            .filter(|reason| !reason.is_empty())
        {
            ensure_google_finish_reason_allows_complete(reason)?;
            return Ok(SseBlockStatus::Complete);
        }
    }
    Ok(SseBlockStatus::Continue)
}

pub(crate) fn ensure_google_finish_reason_allows_complete(reason: &str) -> AppResult<()> {
    if matches!(
        reason.to_ascii_uppercase().as_str(),
        "STOP" | "MAX_TOKENS"
    ) {
        return Ok(());
    }
    Err(AppError::new(
        "llm_stream_incomplete",
        format!(
            "Google/Gemini stopped before completing the response (finishReason: {reason}). The provider response may be incomplete; retry the request."
        ),
    ))
}
