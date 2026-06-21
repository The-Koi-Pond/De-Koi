use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::StreamExt;
use marinara_core::{AppError, AppResult};
use marinara_security::{
    is_allowed_provider_url, is_forbidden_provider_resolved_ip, is_loopback_provider_host,
    redact_sensitive_json, redact_sensitive_text,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    env, fs,
    io::Write,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use uuid::Uuid;

mod providers;

use providers::{
    anthropic::{complete_anthropic_rich, stream_anthropic},
    claude_subscription::complete_claude_subscription_rich,
    cohere::{complete_cohere_rich, stream_cohere},
    google::{complete_google_rich, stream_google},
    openai::{complete_openai_compatible_rich, stream_openai_compatible, stream_openai_responses},
};
pub use providers::{
    claude_subscription::{
        check_claude_subscription_available, diagnose_claude_subscription_model,
    },
    google::google_vertex_auth_headers_for_credential,
};

#[cfg(test)]
use providers::{anthropic::*, claude_subscription::*, google::*, openai::*, sse::*};
const OPENAI_CHATGPT_CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const OPENAI_CHATGPT_REFRESH_URL: &str = "https://auth.openai.com/oauth/token";
const OPENAI_CHATGPT_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CHATGPT_TOKEN_REFRESH_INTERVAL_DAYS: i64 = 8;
const OPENAI_CHATGPT_EXPIRY_REFRESH_SKEW_SECONDS: i64 = 60;
const OPENAI_CHATGPT_DEFAULT_MODEL: &str = "gpt-5.4-mini";
const APP_VERSION: &str = "1.6.1";
const CLAUDE_SUBSCRIPTION_1M_SUFFIX: &str = "[1m]";
const CLAUDE_SUBSCRIPTION_1M_BETA: &str = "context-1m-2025-08-07";
const PROVIDER_LOCAL_URLS_ENABLED_FLAG: &str = "PROVIDER_LOCAL_URLS_ENABLED";
const PROVIDER_RESPONSE_MAX_BYTES: usize = 5 * 1024 * 1024;
const PROVIDER_RESPONSE_HEADERS_TIMEOUT_SECS: u64 = 5 * 60;
const GOOGLE_CLOUD_PLATFORM_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";
const GOOGLE_OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_JWT_BEARER_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const GOOGLE_VERTEX_TOKEN_REFRESH_SKEW_SECONDS: i64 = 60;

#[derive(Debug, Clone)]
struct GoogleVertexCachedToken {
    access_token: String,
    expires_at: i64,
}

static GOOGLE_VERTEX_TOKEN_CACHE: OnceLock<Mutex<BTreeMap<String, GoogleVertexCachedToken>>> =
    OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SseBlockStatus {
    Continue,
    Complete,
}

#[derive(Default)]
struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    fn push_chunk(&mut self, chunk: &[u8], output: &mut String) {
        let mut bytes = Vec::with_capacity(self.pending.len() + chunk.len());
        bytes.append(&mut self.pending);
        bytes.extend_from_slice(chunk);
        let mut offset = 0;
        while offset < bytes.len() {
            match std::str::from_utf8(&bytes[offset..]) {
                Ok(valid) => {
                    output.push_str(valid);
                    return;
                }
                Err(error) => {
                    let valid_end = offset + error.valid_up_to();
                    if valid_end > offset {
                        let valid = std::str::from_utf8(&bytes[offset..valid_end])
                            .expect("valid UTF-8 prefix reported by decoder");
                        output.push_str(valid);
                    }
                    if let Some(error_len) = error.error_len() {
                        output.push('\u{FFFD}');
                        offset = valid_end + error_len;
                    } else {
                        self.pending.extend_from_slice(&bytes[valid_end..]);
                        return;
                    }
                }
            }
        }
    }

    fn finish(&mut self, output: &mut String) {
        if !self.pending.is_empty() {
            output.push_str(&String::from_utf8_lossy(&self.pending));
            self.pending.clear();
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Value>,
    #[serde(
        rename = "providerMetadata",
        alias = "provider_metadata",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_metadata: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LlmConnection {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey", default)]
    pub api_key: String,
    #[serde(rename = "baseUrl", default)]
    pub base_url: String,
    #[serde(rename = "openrouterProvider", default)]
    pub openrouter_provider: Option<String>,
    #[serde(rename = "enableCaching", default)]
    pub enable_caching: bool,
    #[serde(rename = "cachingAtDepth", default)]
    pub caching_at_depth: Option<u64>,
    #[serde(rename = "maxTokensOverride", default)]
    pub max_tokens_override: Option<u64>,
    #[serde(rename = "claudeFastMode", default)]
    pub claude_fast_mode: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LlmRequest {
    pub connection: LlmConnection,
    pub messages: Vec<LlmMessage>,
    #[serde(default)]
    pub parameters: Value,
    #[serde(default)]
    pub tools: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LlmCompletion {
    pub content: String,
    #[serde(rename = "toolCalls")]
    pub tool_calls: Vec<Value>,
    #[serde(
        rename = "finishReason",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub finish_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
    #[serde(
        rename = "providerMetadata",
        alias = "provider_metadata",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_metadata: Option<Value>,
}

pub async fn complete(request: LlmRequest) -> AppResult<String> {
    Ok(complete_rich(request).await?.content)
}

pub async fn complete_rich(request: LlmRequest) -> AppResult<LlmCompletion> {
    match request.connection.provider.as_str() {
        "anthropic" => complete_anthropic_rich(request).await,
        "google" | "google_vertex" => complete_google_rich(request).await,
        "claude_subscription" => complete_claude_subscription_rich(request).await,
        "cohere" if should_use_cohere_compatibility(&request) => {
            complete_openai_compatible_rich(request).await
        }
        "cohere" => complete_cohere_rich(request).await,
        _ => complete_openai_compatible_rich(request).await,
    }
}

pub async fn stream_events(
    request: LlmRequest,
    mut emit: impl FnMut(Value) -> AppResult<()> + Send,
) -> AppResult<()> {
    emit(json!({ "type": "start" }))?;
    if should_use_openai_responses(&request) || request.connection.provider == "openai_chatgpt" {
        stream_openai_responses(request, &mut emit).await?;
    } else if request.connection.provider == "google"
        || request.connection.provider == "google_vertex"
    {
        stream_google(request, &mut emit).await?;
    } else if request.connection.provider == "anthropic" {
        stream_anthropic(request, &mut emit).await?;
    } else if request.connection.provider == "cohere" && should_use_cohere_compatibility(&request) {
        stream_openai_compatible(request, &mut emit).await?;
    } else if request.connection.provider == "cohere" {
        stream_cohere(request, &mut emit).await?;
    } else if request.connection.provider != "claude_subscription" {
        stream_openai_compatible(request, &mut emit).await?;
    } else {
        let result = complete_rich(request).await?;
        if !result.content.is_empty() {
            emit(json!({ "type": "token", "text": result.content, "data": result.content }))?;
        }
        for tool_call in result.tool_calls {
            emit(json!({ "type": "tool_call", "data": tool_call }))?;
        }
        if let Some(provider_metadata) = result.provider_metadata {
            emit(json!({ "type": "provider_metadata", "data": provider_metadata }))?;
        }
    }
    emit(json!({ "type": "done" }))?;
    Ok(())
}

fn normalize_env_value(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn enabled_env_flag(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn is_prompt_connection_log_preset_value(value: Option<&str>) -> bool {
    value
        .map(|item| item.trim().to_ascii_lowercase().replace('_', "-"))
        .as_deref()
        == Some("prompt-connections")
}

fn prompt_connection_diagnostics_enabled_values(
    log_preset: Option<&str>,
    explicit: Option<&str>,
) -> bool {
    is_prompt_connection_log_preset_value(log_preset) || explicit.is_some_and(enabled_env_flag)
}

fn prompt_connection_diagnostics_enabled() -> bool {
    let log_preset = normalize_env_value(env::var("LOG_PRESET").ok());
    let explicit = normalize_env_value(env::var("DE_KOI_PROMPT_CONNECTION_DIAGNOSTICS").ok())
        .or_else(|| normalize_env_value(env::var("MARINARA_PROMPT_CONNECTION_DIAGNOSTICS").ok()));
    prompt_connection_diagnostics_enabled_values(log_preset.as_deref(), explicit.as_deref())
}

fn redacted_endpoint(endpoint: &str) -> String {
    endpoint
        .split_once('?')
        .map(|(base, _)| format!("{base}?<redacted>"))
        .unwrap_or_else(|| endpoint.to_string())
}

fn compact_json(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "<unserializable>".to_string())
}

fn log_prompt_connection_request(kind: &str, endpoint: &str, request: &LlmRequest, body: &Value) {
    if !prompt_connection_diagnostics_enabled() {
        return;
    }
    let messages = request_messages(request);
    eprintln!(
        "[prompt-connections] {kind} provider={} model={} endpoint={} messages={} tools={} parameters={}",
        request.connection.provider,
        request.connection.model,
        redacted_endpoint(endpoint),
        messages.len(),
        request.tools.len(),
        compact_json(&redact_sensitive_json(request.parameters.clone())),
    );
    for (index, message) in messages.iter().enumerate() {
        eprintln!(
            "[prompt-connections] message[{index}] role={} images={} chars={}\n{}",
            message.role,
            message.images.len(),
            message.content.chars().count(),
            message.content
        );
    }
    if !request.tools.is_empty() {
        eprintln!(
            "[prompt-connections] tools={}",
            compact_json(&redact_sensitive_json(json!(&request.tools)))
        );
    }
    eprintln!(
        "[prompt-connections] body={}",
        compact_json(&redact_sensitive_json(body.clone()))
    );
}

pub fn unavailable_payload(message: impl Into<String>) -> Value {
    json!({ "type": "error", "error": message.into() })
}

fn base_url(provider: &str, configured: &str) -> String {
    if provider == "openai_chatgpt" {
        return OPENAI_CHATGPT_CODEX_BASE_URL.to_string();
    }
    let configured = configured.trim().trim_end_matches('/');
    if !configured.is_empty() {
        return configured.to_string();
    }
    match provider {
        "anthropic" => "https://api.anthropic.com".to_string(),
        "google" => "https://generativelanguage.googleapis.com".to_string(),
        "google_vertex" => {
            "https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1"
                .to_string()
        }
        "mistral" => "https://api.mistral.ai/v1".to_string(),
        "cohere" => "https://api.cohere.ai/compatibility/v1".to_string(),
        "openrouter" => "https://openrouter.ai/api/v1".to_string(),
        "nanogpt" => "https://nano-gpt.com/api/v1".to_string(),
        "xai" => "https://api.x.ai/v1".to_string(),
        _ => "https://api.openai.com/v1".to_string(),
    }
}

fn cohere_base_url(configured: &str) -> String {
    let base = base_url("cohere", configured);
    if base.ends_with("/v1") && base.contains("api.cohere.") {
        return format!("{}/v2", base.trim_end_matches("/v1"));
    }
    base
}

fn should_use_cohere_compatibility(request: &LlmRequest) -> bool {
    base_url("cohere", &request.connection.base_url).ends_with("/compatibility/v1")
}

fn openai_compatible_chat_endpoint(request: &LlmRequest) -> String {
    let base = base_url(&request.connection.provider, &request.connection.base_url);
    format!("{base}/chat/completions")
}

fn cohere_chat_endpoint(configured: &str) -> String {
    let base = cohere_base_url(configured)
        .trim_end_matches('/')
        .to_string();
    if base.ends_with("/v2/chat") {
        base
    } else if base.ends_with("/v2") {
        format!("{base}/chat")
    } else {
        format!("{base}/v2/chat")
    }
}

fn temperature(parameters: &Value) -> Option<f64> {
    parameters.get("temperature").and_then(Value::as_f64)
}

fn param_f64(parameters: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| parameters.get(*key).and_then(Value::as_f64))
}

fn param_i64(parameters: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| parameters.get(*key).and_then(Value::as_i64))
}

fn param_string(parameters: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        parameters
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn param_boolish(parameters: &Value, keys: &[&str], fallback: bool) -> Option<bool> {
    keys.iter().find_map(|key| {
        let value = parameters.get(*key)?;
        match value {
            Value::Bool(value) => Some(*value),
            Value::Number(value) => value.as_i64().map(|value| value != 0),
            Value::String(value) => {
                let normalized = value.trim().to_ascii_lowercase();
                match normalized.as_str() {
                    "" => Some(fallback),
                    "false" | "0" | "no" | "off" => Some(false),
                    "true" | "1" | "yes" | "on" => Some(true),
                    _ => Some(fallback),
                }
            }
            _ => Some(fallback),
        }
    })
}

fn param_i64_array(parameters: &Value, keys: &[&str]) -> Option<Vec<i64>> {
    keys.iter().find_map(|key| {
        let values = parameters.get(*key)?.as_array()?;
        values.iter().map(Value::as_i64).collect()
    })
}

fn stop_sequences(parameters: &Value) -> Option<Vec<String>> {
    let value = parameters
        .get("stop")
        .or_else(|| parameters.get("stopSequences"))
        .or_else(|| parameters.get("stop_sequences"))?;
    if let Some(stop) = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(vec![stop.to_string()]);
    }
    let stops = value
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    (!stops.is_empty()).then_some(stops)
}

fn data_url_image(value: &str) -> Option<(&str, &str)> {
    let (meta, data) = value.split_once(',')?;
    let mime = meta.strip_prefix("data:")?.split(';').next()?;
    if !meta.to_ascii_lowercase().contains(";base64")
        || !mime.starts_with("image/")
        || data.is_empty()
    {
        return None;
    }
    Some((mime, data))
}

fn max_tokens(parameters: &Value, fallback: u64) -> u64 {
    parameters
        .get("maxTokens")
        .or_else(|| parameters.get("max_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(fallback)
}

fn request_max_tokens(request: &LlmRequest, fallback: u64) -> u64 {
    let value = max_tokens(&request.parameters, fallback);
    request
        .connection
        .max_tokens_override
        .filter(|cap| *cap > 0)
        .map(|cap| value.min(cap))
        .unwrap_or(value)
}

fn provider_local_urls_enabled() -> bool {
    std::env::var(PROVIDER_LOCAL_URLS_ENABLED_FLAG).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

async fn provider_http_client_for_url(url: &str) -> AppResult<reqwest::Client> {
    let parsed = reqwest::Url::parse(url).map_err(|error| {
        AppError::invalid_input(format!(
            "Outbound URL is invalid: {}",
            redact_sensitive_text(&error.to_string())
        ))
    })?;
    let allow_private_or_reserved = provider_local_urls_enabled();
    if !is_allowed_provider_url(parsed.as_str(), allow_private_or_reserved) {
        return Err(provider_url_not_allowed_error(url));
    }
    let resolved = validate_provider_url_resolution(&parsed, allow_private_or_reserved).await?;
    provider_http_client(parsed.host_str(), resolved.as_deref())
}

async fn validate_provider_url_resolution(
    url: &reqwest::Url,
    allow_private_or_reserved: bool,
) -> AppResult<Option<Vec<SocketAddr>>> {
    if allow_private_or_reserved {
        return Ok(None);
    }
    let Some(host) = url.host_str() else {
        return Err(provider_url_not_allowed_error(url.as_str()));
    };
    if is_loopback_provider_host(host) {
        return Ok(None);
    }
    if let Some(address) = provider_host_ip(host) {
        if is_forbidden_provider_resolved_ip(address, allow_private_or_reserved) {
            return Err(provider_url_not_allowed_error(url.as_str()));
        }
        return Ok(None);
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| {
            AppError::invalid_input(format!(
                "Outbound URL host '{}' did not resolve: {}",
                redact_sensitive_text(host),
                redact_sensitive_text(&error.to_string())
            ))
        })?
        .collect::<Vec<_>>();
    validate_provider_resolved_addresses(url, allow_private_or_reserved, addresses)
}

fn validate_provider_resolved_addresses(
    url: &reqwest::Url,
    allow_private_or_reserved: bool,
    addresses: Vec<SocketAddr>,
) -> AppResult<Option<Vec<SocketAddr>>> {
    if addresses.is_empty() {
        Err(AppError::invalid_input(format!(
            "Outbound URL host '{}' did not resolve",
            redact_sensitive_text(url.host_str().unwrap_or("<missing>"))
        )))
    } else if addresses
        .iter()
        .any(|address| is_forbidden_provider_resolved_ip(address.ip(), allow_private_or_reserved))
    {
        Err(provider_url_not_allowed_error(url.as_str()))
    } else {
        Ok(Some(addresses))
    }
}

fn provider_host_ip(host: &str) -> Option<IpAddr> {
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    unbracketed.parse::<IpAddr>().ok()
}

fn provider_url_not_allowed_error(url: &str) -> AppError {
    AppError::invalid_input(format!(
        "Outbound URL points to a private, LAN, metadata, or reserved target: {}. Set {PROVIDER_LOCAL_URLS_ENABLED_FLAG}=true only if you trust that provider target.",
        redact_sensitive_text(url)
    ))
}

fn provider_http_client(
    host: Option<&str>,
    resolved_addresses: Option<&[SocketAddr]>,
) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(provider_response_headers_timeout())
        .redirect(reqwest::redirect::Policy::none());
    if let (Some(host), Some(addresses)) = (host, resolved_addresses) {
        builder = builder.resolve_to_addrs(host, addresses);
    }
    builder
        .build()
        .map_err(|error| AppError::new("llm_client_error", error.to_string()))
}

fn provider_response_headers_timeout() -> Duration {
    Duration::from_secs(PROVIDER_RESPONSE_HEADERS_TIMEOUT_SECS)
}

async fn send_provider_request(request: reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
    send_provider_request_with_error_code(request, "llm_network_error").await
}

async fn send_provider_request_with_error_code(
    request: reqwest::RequestBuilder,
    error_code: &str,
) -> AppResult<reqwest::Response> {
    send_provider_request_with_timeout(request, error_code, provider_response_headers_timeout())
        .await
}

async fn send_provider_request_with_timeout(
    request: reqwest::RequestBuilder,
    error_code: &str,
    timeout: Duration,
) -> AppResult<reqwest::Response> {
    match tokio::time::timeout(timeout, request.send()).await {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(error)) => Err(AppError::new(
            error_code,
            provider_transport_error_message(error),
        )),
        Err(_) => Err(AppError::new(
            error_code,
            format!(
                "LLM provider request timed out while waiting for response headers after {} ms",
                timeout.as_millis()
            ),
        )),
    }
}

fn provider_transport_error_message(error: impl std::fmt::Display) -> String {
    redact_sensitive_text(&error.to_string())
}

fn should_use_openai_responses(request: &LlmRequest) -> bool {
    if request.connection.provider == "openai_chatgpt" {
        return true;
    }
    if request.connection.provider != "openai" {
        return false;
    }
    let model = request.connection.model.to_ascii_lowercase();
    model.starts_with("gpt-5")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
        || model.contains("computer-use")
        || model.contains("codex")
}

pub fn normalize_openai_chatgpt_model(model: &str) -> String {
    let trimmed = model.trim();
    let normalized = trimmed.to_ascii_lowercase();
    if normalized == "chat-latest" || normalized.ends_with("-chat-latest") {
        OPENAI_CHATGPT_DEFAULT_MODEL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn openai_model_id(model: &str) -> String {
    model
        .to_ascii_lowercase()
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}

fn gpt5_minor_version(model: &str) -> Option<u32> {
    let model = openai_model_id(model);
    let tail = model.strip_prefix("gpt-5.")?;
    let digits = tail
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u32>().ok()
}

fn is_openai_legacy_gpt5_pro_model(model: &str) -> bool {
    let model = openai_model_id(model);
    model == "gpt-5-pro" || model.starts_with("gpt-5-pro-")
}

fn is_openai_versioned_gpt5_pro_model(model: &str) -> bool {
    let model = openai_model_id(model);
    let Some(tail) = model.strip_prefix("gpt-5.") else {
        return false;
    };
    let digit_count = tail.chars().take_while(|ch| ch.is_ascii_digit()).count();
    if digit_count == 0 {
        return false;
    }
    let rest = &tail[digit_count..];
    rest == "-pro" || rest.starts_with("-pro-")
}

fn supports_openai_none_reasoning_model(model: &str) -> bool {
    let model_id = openai_model_id(model);
    if model_id.contains("codex")
        || is_openai_legacy_gpt5_pro_model(&model_id)
        || is_openai_versioned_gpt5_pro_model(&model_id)
    {
        return false;
    }
    gpt5_minor_version(model)
        .map(|minor| minor >= 1)
        .unwrap_or(false)
}

fn supports_openai_minimal_reasoning_model(model: &str) -> bool {
    let model = openai_model_id(model);
    !model.contains("codex")
        && !is_openai_legacy_gpt5_pro_model(&model)
        && !is_openai_versioned_gpt5_pro_model(&model)
        && (model == "gpt-5" || model.starts_with("gpt-5-"))
}

fn supports_openai_xhigh_reasoning_model(model: &str) -> bool {
    let model = openai_model_id(model);
    if model == "gpt-5-pro" || model.starts_with("gpt-5-pro-") {
        return false;
    }
    if model == "gpt-5.1-codex-max" || model.starts_with("gpt-5.1-codex-max-") {
        return true;
    }
    gpt5_minor_version(&model)
        .map(|minor| minor >= 2)
        .unwrap_or(false)
}

fn openai_reasoning_effort(request: &LlmRequest) -> Option<String> {
    let effort = param_string(
        &request.parameters,
        &["reasoningEffort", "reasoning_effort"],
    )?
    .to_ascii_lowercase();
    if is_openai_legacy_gpt5_pro_model(&request.connection.model) {
        return Some("high".to_string());
    }
    if is_openai_versioned_gpt5_pro_model(&request.connection.model) {
        return Some(
            match effort.as_str() {
                "maximum" | "xhigh" => "xhigh",
                "high" => "high",
                _ => "medium",
            }
            .to_string(),
        );
    }
    match effort.as_str() {
        "none" if supports_openai_none_reasoning_model(&request.connection.model) => {
            Some("none".to_string())
        }
        "minimal" if supports_openai_minimal_reasoning_model(&request.connection.model) => {
            Some("minimal".to_string())
        }
        "low" | "medium" | "high" => Some(effort),
        "maximum" | "xhigh" if supports_openai_xhigh_reasoning_model(&request.connection.model) => {
            Some("xhigh".to_string())
        }
        "maximum" | "xhigh" => Some("high".to_string()),
        _ => None,
    }
}

fn supports_mistral_adjustable_reasoning(model: &str) -> bool {
    let model = model.to_ascii_lowercase();
    matches!(
        model.as_str(),
        "mistral-small-latest" | "mistral-small-2603" | "mistral-medium-3-5"
    )
}

fn mistral_reasoning_effort(request: &LlmRequest) -> Option<&'static str> {
    if !supports_mistral_adjustable_reasoning(&request.connection.model) {
        return None;
    }
    if let Some(effort) = param_string(
        &request.parameters,
        &["reasoningEffort", "reasoning_effort"],
    )
    .map(|value| value.to_ascii_lowercase())
    {
        return match effort.as_str() {
            "none" | "minimal" | "low" => Some("none"),
            "high" | "maximum" | "xhigh" => Some("high"),
            _ => None,
        };
    }
    param_boolish(
        &request.parameters,
        &["showThoughts", "show_thoughts"],
        false,
    )
    .map(|show| if show { "high" } else { "none" })
}

fn supports_cohere_thinking(model: &str) -> bool {
    let model = model.to_ascii_lowercase();
    model.contains("command-a-reasoning") || model.contains("command-a-plus")
}

fn cohere_thinking_config(request: &LlmRequest) -> Option<Value> {
    if let Some(thinking) = request
        .parameters
        .get("thinking")
        .filter(|value| value.as_object().is_some_and(|object| !object.is_empty()))
    {
        return Some(thinking.clone());
    }
    if !supports_cohere_thinking(&request.connection.model) {
        return None;
    }

    let effort = param_string(
        &request.parameters,
        &["reasoningEffort", "reasoning_effort"],
    )
    .map(|value| value.to_ascii_lowercase());
    if matches!(effort.as_deref(), Some("none" | "minimal" | "low")) {
        return Some(json!({ "type": "disabled" }));
    }

    let budget = param_i64(&request.parameters, &["thinkingBudget", "thinking_budget"])
        .filter(|value| *value > 0);
    let show_thoughts = param_boolish(
        &request.parameters,
        &["showThoughts", "show_thoughts"],
        true,
    );
    if let Some(budget) = budget {
        let mut thinking = json!({ "token_budget": budget });
        if show_thoughts.unwrap_or(true)
            || matches!(
                effort.as_deref(),
                Some("medium" | "high" | "maximum" | "xhigh")
            )
        {
            thinking["type"] = json!("enabled");
        }
        return Some(thinking);
    }
    if let Some(show) = show_thoughts {
        return Some(json!({ "type": if show { "enabled" } else { "disabled" } }));
    }
    if matches!(
        effort.as_deref(),
        Some("medium" | "high" | "maximum" | "xhigh")
    ) {
        return Some(json!({ "type": "enabled" }));
    }
    None
}

fn model_contains(request: &LlmRequest, needle: &str) -> bool {
    request
        .connection
        .model
        .to_ascii_lowercase()
        .contains(needle)
}

fn claude_version_parts(model: &str, family: &str) -> Option<(u32, u32)> {
    let normalized = model.to_ascii_lowercase();
    let marker = format!("claude-{family}-");
    let start = normalized.find(&marker)? + marker.len();
    let tail = &normalized[start..];
    let parts = tail
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u32>().ok())
        .take(2)
        .collect::<Vec<_>>();
    let major = *parts.first()?;
    let minor = parts
        .get(1)
        .copied()
        .filter(|value| *value <= 99)
        .unwrap_or(0);
    Some((major, minor))
}

fn claude_version_at_least(model: &str, family: &str, major: u32, minor: u32) -> bool {
    let Some((model_major, model_minor)) = claude_version_parts(model, family) else {
        return false;
    };
    model_major > major || (model_major == major && model_minor >= minor)
}

fn is_claude_opus_adaptive_only_model(model: &str) -> bool {
    claude_version_at_least(model, "opus", 4, 7)
}

fn is_claude_fable_5_model(model: &str) -> bool {
    model.to_ascii_lowercase().contains("claude-fable-5")
}

fn is_claude_adaptive_only_model(model: &str) -> bool {
    is_claude_opus_adaptive_only_model(model) || is_claude_fable_5_model(model)
}

fn is_anthropic_sampling_restricted_model(model: &str) -> bool {
    is_claude_adaptive_only_model(model)
        || claude_version_at_least(model, "sonnet", 4, 6)
        || claude_version_at_least(model, "haiku", 4, 5)
}

fn supports_anthropic_adaptive_thinking(model: &str) -> bool {
    is_claude_fable_5_model(model)
        || claude_version_at_least(model, "opus", 4, 6)
        || claude_version_at_least(model, "sonnet", 4, 6)
}

fn should_send_openai_sampling_parameters(request: &LlmRequest) -> bool {
    !is_anthropic_sampling_restricted_model(&request.connection.model)
}

fn should_send_temperature(request: &LlmRequest) -> bool {
    should_send_openai_sampling_parameters(request)
}

fn is_sampling_parameter_key(key: &str) -> bool {
    matches!(
        key,
        "temperature"
            | "top_p"
            | "topP"
            | "top_k"
            | "topK"
            | "frequency_penalty"
            | "frequencyPenalty"
            | "presence_penalty"
            | "presencePenalty"
    )
}

fn is_stop_parameter_key(key: &str) -> bool {
    matches!(key, "stop" | "stopSequences" | "stop_sequences")
}

fn is_reserved_custom_parameter_key(key: &str) -> bool {
    matches!(
        key,
        "model" | "messages" | "input" | "contents" | "systemInstruction" | "stream" | "tools"
    )
}

const OPENAI_RESPONSES_UNSUPPORTED_CUSTOM_PARAMETER_KEYS: &[&str] = &[
    "top_k",
    "topK",
    "frequency_penalty",
    "frequencyPenalty",
    "presence_penalty",
    "presencePenalty",
    "stop",
    "stopSequences",
    "stop_sequences",
];

fn is_mistral_unsupported_custom_parameter_key(key: &str) -> bool {
    matches!(
        key,
        "seed"
            | "top_k"
            | "topK"
            | "safePrompt"
            | "randomSeed"
            | "promptCacheKey"
            | "promptMode"
            | "parallelToolCalls"
            | "reasoningEffort"
            | "responseFormat"
            | "service_tier"
            | "serviceTier"
    )
}

fn is_cohere_unsupported_body_parameter_key(key: &str) -> bool {
    matches!(
        key,
        "maxTokens"
            | "maxOutputTokens"
            | "max_output_tokens"
            | "topP"
            | "top_p"
            | "topK"
            | "top_k"
            | "stop"
            | "stopSequences"
            | "frequencyPenalty"
            | "presencePenalty"
            | "responseFormat"
            | "safetyMode"
            | "toolChoice"
            | "strictTools"
            | "reasoningEffort"
            | "reasoning_effort"
            | "showThoughts"
            | "show_thoughts"
            | "thinkingBudget"
            | "thinking_budget"
            | "random_seed"
            | "randomSeed"
            | "safe_prompt"
            | "safePrompt"
            | "prompt_cache_key"
            | "promptCacheKey"
            | "prompt_mode"
            | "promptMode"
            | "parallel_tool_calls"
            | "parallelToolCalls"
            | "service_tier"
            | "serviceTier"
            | "prediction"
    )
}

fn scrub_cohere_parameter_body(body: &mut Value, has_tools: bool) {
    let Some(body) = body.as_object_mut() else {
        return;
    };
    body.retain(|key, _| !is_cohere_unsupported_body_parameter_key(key));
    if has_tools {
        body.remove("response_format");
        body.remove("safety_mode");
    } else {
        body.remove("tool_choice");
        body.remove("strict_tools");
    }
}

fn xai_model_id(model: &str) -> String {
    model.trim().trim_start_matches("xai/").to_ascii_lowercase()
}

fn is_xai_grok_43_model(model: &str) -> bool {
    let id = xai_model_id(model);
    id == "latest" || id == "grok-4.3" || id.starts_with("grok-4.3-")
}

fn is_xai_multi_agent_model(model: &str) -> bool {
    xai_model_id(model).starts_with("grok-4.20-multi-agent")
}

fn is_xai_automatic_reasoning_model(model: &str) -> bool {
    let id = xai_model_id(model);
    if is_xai_grok_43_model(model) || is_xai_multi_agent_model(model) {
        return true;
    }
    if id.starts_with("grok-build") {
        return false;
    }
    id.starts_with("grok-4") && !id.contains("image")
}

fn xai_reasoning_effort(request: &LlmRequest) -> Option<&'static str> {
    if !is_xai_grok_43_model(&request.connection.model) {
        return None;
    }
    let effort = param_string(
        &request.parameters,
        &["reasoningEffort", "reasoning_effort"],
    )?
    .to_ascii_lowercase();
    match effort.as_str() {
        "none" => Some("none"),
        "minimal" => Some("low"),
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" | "maximum" | "xhigh" => Some("high"),
        _ => None,
    }
}

fn xai_reasoning_config(request: &LlmRequest) -> Option<Value> {
    if !is_xai_multi_agent_model(&request.connection.model) {
        return None;
    }
    if let Some(reasoning) = request
        .parameters
        .get("reasoning")
        .filter(|value| value.as_object().is_some())
    {
        return Some(reasoning.clone());
    }
    let effort = param_string(
        &request.parameters,
        &["reasoningEffort", "reasoning_effort"],
    )?
    .to_ascii_lowercase();
    match effort.as_str() {
        "low" | "minimal" => Some(json!({ "effort": "low" })),
        "medium" => Some(json!({ "effort": "medium" })),
        "high" => Some(json!({ "effort": "high" })),
        "xhigh" | "maximum" => Some(json!({ "effort": "xhigh" })),
        _ => None,
    }
}

fn xai_reasoning_active(request: &LlmRequest) -> bool {
    match xai_reasoning_effort(request) {
        Some("none") => false,
        Some(_) => true,
        None => is_xai_automatic_reasoning_model(&request.connection.model),
    }
}

fn is_xai_grok_420_or_newer_model(model: &str) -> bool {
    let id = xai_model_id(model);
    id.starts_with("grok-4.20") || id.starts_with("grok-4.3")
}

fn is_xai_unsupported_custom_parameter_key(key: &str, model: &str, reasoning_active: bool) -> bool {
    if matches!(
        key,
        "top_k"
            | "topK"
            | "reasoningEffort"
            | "reasoning_effort"
            | "serviceTier"
            | "service_tier"
            | "parallelToolCalls"
            | "parallel_tool_calls"
    ) {
        return true;
    }
    if reasoning_active
        && matches!(
            key,
            "frequencyPenalty"
                | "frequency_penalty"
                | "presencePenalty"
                | "presence_penalty"
                | "stop"
                | "stopSequences"
                | "stop_sequences"
        )
    {
        return true;
    }
    is_xai_grok_420_or_newer_model(model)
        && matches!(key, "logprobs" | "topLogprobs" | "top_logprobs")
}

fn apply_xai_custom_parameters_to_object(
    body: &mut Value,
    parameters: &Value,
    strip_sampling: bool,
    strip_stop: bool,
    model: &str,
    reasoning_active: bool,
) {
    let Some(entries) = parameters
        .get("customParameters")
        .or_else(|| parameters.get("custom_params"))
        .and_then(Value::as_object)
    else {
        return;
    };
    let Some(body) = body.as_object_mut() else {
        return;
    };
    for (key, value) in entries {
        if !should_apply_custom_parameter(key, strip_sampling, strip_stop, &[])
            || is_xai_unsupported_custom_parameter_key(key, model, reasoning_active)
        {
            continue;
        }
        if !body.contains_key(key) {
            body.insert(key.clone(), value.clone());
        }
    }
}

fn is_openai_service_tier(value: &str) -> bool {
    matches!(value, "auto" | "default" | "flex" | "scale" | "priority")
}

fn is_openrouter_service_tier(value: &str) -> bool {
    matches!(value, "flex" | "priority")
}

fn is_xai_service_tier(value: &str) -> bool {
    matches!(value, "default" | "priority")
}

fn is_anthropic_service_tier(value: &str) -> bool {
    matches!(value, "auto" | "standard_only")
}

fn is_cohere_safety_mode(value: &str) -> bool {
    matches!(value, "CONTEXTUAL" | "STRICT" | "OFF")
}

fn cohere_tool_choice(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "required" | "any" => Some("REQUIRED"),
        "none" => Some("NONE"),
        _ => None,
    }
}

fn should_apply_custom_parameter(
    key: &str,
    strip_sampling: bool,
    strip_stop: bool,
    skip_keys: &[&str],
) -> bool {
    !(skip_keys.contains(&key)
        || is_reserved_custom_parameter_key(key)
        || strip_sampling && is_sampling_parameter_key(key)
        || strip_stop && is_stop_parameter_key(key))
}

fn apply_custom_parameters_to_object(
    body: &mut Value,
    parameters: &Value,
    strip_sampling: bool,
    strip_stop: bool,
    skip_keys: &[&str],
) {
    let Some(entries) = parameters
        .get("customParameters")
        .or_else(|| parameters.get("custom_params"))
        .and_then(Value::as_object)
    else {
        return;
    };
    let Some(body) = body.as_object_mut() else {
        return;
    };
    for (key, value) in entries {
        if !should_apply_custom_parameter(key, strip_sampling, strip_stop, skip_keys) {
            continue;
        }
        if !body.contains_key(key) {
            body.insert(key.clone(), value.clone());
        }
    }
}

fn is_gemini_3_model(model: &str) -> bool {
    let normalized = model.to_ascii_lowercase();
    normalized.starts_with("gemini-3")
        || normalized.starts_with("google/gemini-3")
        || normalized.contains("/gemini-3")
}

fn is_gemini_3_pro_model(model: &str) -> bool {
    is_gemini_3_model(model) && model.to_ascii_lowercase().contains("-pro")
}

fn is_gemini_25_model(model: &str) -> bool {
    let normalized = model.to_ascii_lowercase();
    normalized.starts_with("gemini-2.5")
        || normalized.starts_with("google/gemini-2.5")
        || normalized.contains("/gemini-2.5")
}

fn is_gemini_25_pro_model(model: &str) -> bool {
    is_gemini_25_model(model) && model.to_ascii_lowercase().contains("-pro")
}

fn google_thinking_level(model: &str, parameters: &Value) -> Option<&'static str> {
    let effort =
        param_string(parameters, &["reasoningEffort", "reasoning_effort"])?.to_ascii_lowercase();
    match effort.as_str() {
        "none" | "minimal" if is_gemini_3_pro_model(model) => Some("low"),
        "none" | "minimal" => Some("minimal"),
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" | "maximum" | "xhigh" => Some("high"),
        _ => None,
    }
}

fn google_thinking_budget(model: &str, parameters: &Value, max_output_tokens: u64) -> Option<i64> {
    let effort =
        param_string(parameters, &["reasoningEffort", "reasoning_effort"])?.to_ascii_lowercase();
    let pro = is_gemini_25_pro_model(model);
    let requested = match effort.as_str() {
        "none" | "minimal" if pro => Some(128),
        "none" | "minimal" => Some(0),
        "low" => Some(1024),
        "medium" => Some(8192),
        "high" | "maximum" | "xhigh" if pro => Some(32768),
        "high" | "maximum" | "xhigh" => Some(24576),
        _ => None,
    }?;
    Some(cap_google_thinking_budget(requested, max_output_tokens))
}

fn cap_google_thinking_budget(requested_budget: i64, max_output_tokens: u64) -> i64 {
    if max_output_tokens == 0 {
        return requested_budget;
    }
    if requested_budget <= 0 {
        return 0;
    }
    if max_output_tokens <= 1024 {
        let max_thinking_budget = (max_output_tokens / 2).max(1) as i64;
        return requested_budget.min(max_thinking_budget).max(1);
    }
    let visible_reserve = (max_output_tokens / 2).clamp(1024, 4096);
    let max_thinking_budget = max_output_tokens.saturating_sub(visible_reserve) as i64;
    requested_budget.clamp(0, max_thinking_budget)
}

fn google_thinking_config(
    model: &str,
    parameters: &Value,
    max_output_tokens: u64,
) -> Option<Value> {
    if is_gemini_3_model(model) {
        return google_thinking_level(model, parameters)
            .map(|level| json!({ "thinkingLevel": level, "includeThoughts": true }));
    }

    if is_gemini_25_model(model) {
        let budget = google_thinking_budget(model, parameters, max_output_tokens)?;
        return Some(json!({ "thinkingBudget": budget, "includeThoughts": true }));
    }

    None
}

fn is_google_gemini_3_unsupported_generation_config_key(key: &str) -> bool {
    matches!(
        key,
        "temperature" | "topP" | "top_p" | "topK" | "top_k" | "candidateCount" | "candidate_count"
    )
}

fn is_google_generation_config_custom_parameter_key(key: &str) -> bool {
    matches!(
        key,
        "stopSequences"
            | "stop_sequences"
            | "responseMimeType"
            | "response_mime_type"
            | "responseModalities"
            | "response_modalities"
            | "thinkingConfig"
            | "thinking_config"
            | "modelConfig"
            | "model_config"
            | "temperature"
            | "topP"
            | "top_p"
            | "topK"
            | "top_k"
            | "candidateCount"
            | "candidate_count"
            | "maxOutputTokens"
            | "max_output_tokens"
            | "responseLogprobs"
            | "response_logprobs"
            | "logprobs"
            | "presencePenalty"
            | "presence_penalty"
            | "frequencyPenalty"
            | "frequency_penalty"
            | "seed"
            | "responseSchema"
            | "response_schema"
            | "responseJsonSchema"
            | "response_json_schema"
            | "routingConfig"
            | "routing_config"
            | "audioTimestamp"
            | "audio_timestamp"
            | "mediaResolution"
            | "media_resolution"
            | "speechConfig"
            | "speech_config"
            | "enableAffectiveDialog"
            | "enable_affective_dialog"
            | "enableEnhancedCivicAnswers"
            | "enable_enhanced_civic_answers"
            | "imageConfig"
            | "image_config"
            | "responseFormat"
            | "response_format"
    )
}

fn anthropic_thinking_effort(model: &str, parameters: &Value) -> Option<&'static str> {
    let effort = param_string(parameters, &["reasoningEffort", "reasoning_effort"])?;
    match effort.as_str() {
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "xhigh" if is_claude_adaptive_only_model(model) => Some("xhigh"),
        "xhigh" => Some("high"),
        "maximum" | "max" => Some("max"),
        _ => None,
    }
}

fn anthropic_thinking_budget_tokens(effort: &str) -> u64 {
    match effort {
        "low" => 1024,
        "medium" => 8192,
        _ => 24576,
    }
}

fn should_use_anthropic_adaptive_thinking(
    model: &str,
    parameters: &Value,
    effort: Option<&str>,
) -> bool {
    if !supports_anthropic_adaptive_thinking(model) {
        return false;
    }
    if is_claude_adaptive_only_model(model) {
        return true;
    }
    if effort.is_some() {
        return true;
    }
    param_boolish(parameters, &["showThoughts", "show_thoughts"], false).unwrap_or(false)
}

fn should_send_top_k(request: &LlmRequest) -> bool {
    if request.connection.provider == "openrouter" {
        return !is_openrouter_openai_model(&request.connection.model);
    }
    !matches!(
        request.connection.provider.as_str(),
        "openai" | "xai" | "mistral" | "cohere"
    )
}

fn is_openrouter_openai_model(model: &str) -> bool {
    let normalized = model.trim().trim_start_matches('~').to_ascii_lowercase();
    if normalized.starts_with("openai/") {
        return true;
    }
    if normalized.contains('/') {
        return false;
    }
    normalized.starts_with("gpt-")
        || normalized.starts_with("o1")
        || normalized.starts_with("o3")
        || normalized.starts_with("o4")
        || normalized.starts_with("codex")
}

fn openrouter_reasoning_effort(parameters: &Value) -> Option<&'static str> {
    let effort =
        param_string(parameters, &["reasoningEffort", "reasoning_effort"])?.to_ascii_lowercase();
    match effort.as_str() {
        "none" => Some("none"),
        "minimal" => Some("minimal"),
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "xhigh" | "maximum" => Some("xhigh"),
        _ => None,
    }
}

fn openrouter_reasoning_config(parameters: &Value) -> Option<Value> {
    if let Some(reasoning) = parameters
        .get("reasoning")
        .filter(|value| value.as_object().is_some())
    {
        return Some(reasoning.clone());
    }
    if parameters
        .get("customParameters")
        .or_else(|| parameters.get("custom_params"))
        .and_then(|value| value.get("reasoning"))
        .and_then(Value::as_object)
        .is_some()
    {
        return None;
    }
    if let Some(budget) = param_i64(
        parameters,
        &[
            "thinkingBudget",
            "thinking_budget",
            "reasoningMaxTokens",
            "reasoning_max_tokens",
        ],
    )
    .filter(|value| *value > 0)
    {
        return Some(json!({ "max_tokens": budget }));
    }
    openrouter_reasoning_effort(parameters).map(|effort| json!({ "effort": effort }))
}

fn is_openrouter_verbosity(value: &str) -> bool {
    matches!(value, "low" | "medium" | "high" | "xhigh" | "max")
}

fn nanogpt_reasoning_effort(parameters: &Value) -> Option<&'static str> {
    let effort =
        param_string(parameters, &["reasoningEffort", "reasoning_effort"])?.to_ascii_lowercase();
    match effort.as_str() {
        "none" => Some("none"),
        "minimal" => Some("minimal"),
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "xhigh" | "maximum" => Some("xhigh"),
        _ => None,
    }
}

fn nanogpt_prompt_caching_config(parameters: &Value) -> Option<Value> {
    let prompt_caching = parameters
        .get("promptCaching")
        .or_else(|| parameters.get("prompt_caching"))?;
    if prompt_caching.as_object().is_some() {
        return Some(prompt_caching.clone());
    }
    param_boolish(parameters, &["promptCaching", "prompt_caching"], false)
        .map(|enabled| json!({ "enabled": enabled }))
}

fn nanogpt_reasoning_config(parameters: &Value) -> Option<Value> {
    if let Some(reasoning) = parameters
        .get("reasoning")
        .filter(|value| value.as_object().is_some())
    {
        return Some(reasoning.clone());
    }
    if parameters
        .get("customParameters")
        .or_else(|| parameters.get("custom_params"))
        .and_then(|value| value.get("reasoning"))
        .and_then(Value::as_object)
        .is_some()
    {
        return None;
    }

    let mut reasoning = serde_json::Map::new();
    if let Some(show_thoughts) =
        param_boolish(parameters, &["showThoughts", "show_thoughts"], false)
    {
        reasoning.insert("exclude".to_string(), json!(!show_thoughts));
    }
    if reasoning.is_empty() {
        None
    } else {
        Some(Value::Object(reasoning))
    }
}

fn provider_error_text(details: &Value) -> Option<String> {
    [
        details.pointer("/error/message").and_then(Value::as_str),
        details.get("message").and_then(Value::as_str),
        details.pointer("/error").and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .find(|message| !message.is_empty())
    .map(|message| redact_sensitive_text(message).chars().take(500).collect())
}

fn provider_http_error(status: reqwest::StatusCode, details: Value) -> AppError {
    let details = redact_sensitive_json(details);
    let message = provider_error_text(&details)
        .map(|detail| format!("Provider returned HTTP {status}: {detail}"))
        .unwrap_or_else(|| format!("Provider returned HTTP {status}"));
    AppError::with_details("llm_provider_error", message, details)
}

fn sanitize_provider_error_text(text: &str) -> String {
    let trimmed = text.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("<html") || lower.contains("<!doctype") {
        return "Provider returned HTML instead of JSON".to_string();
    }
    redact_sensitive_text(trimmed).chars().take(500).collect()
}

fn provider_error_details_from_text(text: &str) -> Value {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return json!({});
    }
    serde_json::from_str::<Value>(trimmed)
        .map(redact_sensitive_json)
        .unwrap_or_else(|_| json!({ "message": sanitize_provider_error_text(trimmed) }))
}

fn assistant_prefill(parameters: &Value) -> Option<String> {
    param_string(parameters, &["assistantPrefill", "assistant_prefill"])
}

fn request_messages(request: &LlmRequest) -> Vec<LlmMessage> {
    let mut messages = request.messages.clone();
    if let Some(prefill) = assistant_prefill(&request.parameters) {
        messages.push(LlmMessage {
            role: "assistant".to_string(),
            content: prefill,
            name: None,
            images: Vec::new(),
            tool_call_id: None,
            tool_calls: None,
            provider_metadata: None,
        });
    }
    messages
}

#[derive(Debug, Clone)]
struct ChatGptAuth {
    access_token: String,
    account_id: Option<String>,
    is_fedramp: bool,
}

fn codex_auth_file_path() -> PathBuf {
    if let Ok(home) = env::var("CODEX_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("auth.json");
        }
    }
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".codex").join("auth.json")
}

fn string_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn bool_metadata_value(value: Option<&Value>) -> Option<bool> {
    match value? {
        Value::Bool(value) => Some(*value),
        Value::String(value) if value.eq_ignore_ascii_case("true") => Some(true),
        Value::String(value) if value.eq_ignore_ascii_case("false") => Some(false),
        _ => None,
    }
}

fn insert_string_metadata(
    map: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<String>,
) {
    if let Some(value) = value {
        map.insert(key.to_string(), Value::String(value));
    }
}

fn insert_bool_metadata(map: &mut serde_json::Map<String, Value>, key: &str, value: Option<bool>) {
    if let Some(value) = value {
        map.insert(key.to_string(), Value::Bool(value));
    }
}

fn openai_chatgpt_auth_missing_message(error: &std::io::Error) -> String {
    format!(
        "No Codex ChatGPT login found in the local Codex auth.json credential file ({error}). Run `codex login` on this host."
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ChatGptAuthMetadata {
    account_id: Option<String>,
    is_fedramp: bool,
}

fn openai_chatgpt_nested_auth_claims(
    claims: Option<&Value>,
) -> Option<&serde_json::Map<String, Value>> {
    claims?
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object)
}

fn normalize_openai_chatgpt_id_token_info(value: Option<&Value>) -> Option<Value> {
    match value? {
        Value::String(token) => {
            let claims = decode_jwt_payload_json(token)?;
            let auth_claims = openai_chatgpt_nested_auth_claims(Some(&claims));
            let mut info = serde_json::Map::new();
            insert_string_metadata(
                &mut info,
                "chatgpt_account_id",
                string_value(auth_claims.and_then(|claims| claims.get("chatgpt_account_id"))),
            );
            insert_bool_metadata(
                &mut info,
                "chatgpt_account_is_fedramp",
                bool_metadata_value(
                    auth_claims.and_then(|claims| claims.get("chatgpt_account_is_fedramp")),
                ),
            );
            Some(Value::Object(info))
        }
        object @ Value::Object(_) => Some(object.clone()),
        _ => None,
    }
}

fn openai_chatgpt_auth_metadata(auth_json: &Value, access_token: &str) -> ChatGptAuthMetadata {
    let tokens = auth_json.get("tokens").and_then(Value::as_object);
    let id_token_info =
        normalize_openai_chatgpt_id_token_info(tokens.and_then(|tokens| tokens.get("id_token")));
    let access_claims = decode_jwt_payload_json(access_token);
    let access_auth_claims = openai_chatgpt_nested_auth_claims(access_claims.as_ref());
    let account_id = tokens
        .and_then(|tokens| string_value(tokens.get("account_id")))
        .or_else(|| {
            string_value(id_token_info.as_ref().and_then(|info| {
                info.get("chatgpt_account_id")
                    .or_else(|| info.get("account_id"))
            }))
        })
        .or_else(|| {
            string_value(access_auth_claims.and_then(|claims| claims.get("chatgpt_account_id")))
        });
    let is_fedramp = bool_metadata_value(
        id_token_info
            .as_ref()
            .and_then(|info| info.get("chatgpt_account_is_fedramp")),
    )
    .or_else(|| {
        bool_metadata_value(
            access_auth_claims.and_then(|claims| claims.get("chatgpt_account_is_fedramp")),
        )
    })
    .unwrap_or(false);

    ChatGptAuthMetadata {
        account_id,
        is_fedramp,
    }
}

async fn load_openai_chatgpt_auth() -> AppResult<ChatGptAuth> {
    let path = codex_auth_file_path();
    let raw = fs::read_to_string(&path).map_err(|error| {
        AppError::new(
            "openai_chatgpt_auth_missing",
            openai_chatgpt_auth_missing_message(&error),
        )
    })?;
    let mut auth_json: Value = serde_json::from_str(&raw)
        .map_err(|error| AppError::new("openai_chatgpt_auth_error", error.to_string()))?;
    let tokens = auth_json
        .get("tokens")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::new(
                "openai_chatgpt_auth_error",
                "Codex auth is not ChatGPT OAuth. Run `codex login`.",
            )
        })?;
    let mut access_token = string_value(tokens.get("access_token")).ok_or_else(|| {
        AppError::new(
            "openai_chatgpt_auth_error",
            "Codex ChatGPT auth does not contain an access token. Run `codex login`.",
        )
    })?;
    let should_refresh = openai_chatgpt_auth_should_refresh(&auth_json, &access_token);
    if should_refresh {
        let tokens = auth_json
            .get_mut("tokens")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                AppError::new(
                    "openai_chatgpt_auth_error",
                    "Codex auth is not ChatGPT OAuth. Run `codex login`.",
                )
            })?;
        let refresh_token = string_value(tokens.get("refresh_token"))
            .ok_or_else(openai_chatgpt_refresh_token_error)?;
        let refreshed = refresh_openai_chatgpt_auth(&refresh_token).await?;
        if let Some(next_access_token) = apply_openai_chatgpt_refreshed_tokens(tokens, &refreshed) {
            access_token = next_access_token;
        }
        auth_json["last_refresh"] = Value::String(chrono_like_now_iso());
        persist_openai_chatgpt_auth(&path, &auth_json)?;
    }
    let metadata = openai_chatgpt_auth_metadata(&auth_json, &access_token);
    Ok(ChatGptAuth {
        access_token,
        account_id: metadata.account_id,
        is_fedramp: metadata.is_fedramp,
    })
}

pub async fn check_openai_chatgpt_auth() -> AppResult<String> {
    let auth = load_openai_chatgpt_auth().await?;
    let account = auth
        .account_id
        .as_deref()
        .map(|value| format!(" for account {value}"))
        .unwrap_or_default();
    Ok(format!(
        "ChatGPT login found via Codex auth{account}. Requests will use the local ChatGPT session."
    ))
}

fn decode_jwt_payload_json(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1).filter(|value| !value.is_empty())?;
    let decoded = general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| general_purpose::URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice::<Value>(&decoded).ok()
}

fn openai_chatgpt_access_token_expires_soon(access_token: &str) -> bool {
    let Some(payload) = decode_jwt_payload_json(access_token) else {
        return false;
    };
    let Some(exp) = payload.get("exp").and_then(Value::as_f64) else {
        return false;
    };
    if !exp.is_finite() {
        return false;
    }
    let now = Utc::now().timestamp() as f64;
    exp <= now + OPENAI_CHATGPT_EXPIRY_REFRESH_SKEW_SECONDS as f64
}

fn openai_chatgpt_last_refresh_is_stale(last_refresh: Option<&Value>) -> bool {
    let Some(raw) = string_value(last_refresh) else {
        return false;
    };
    let Ok(parsed) = DateTime::parse_from_rfc3339(&raw) else {
        return false;
    };
    let age = Utc::now().signed_duration_since(parsed.with_timezone(&Utc));
    age > chrono::Duration::days(OPENAI_CHATGPT_TOKEN_REFRESH_INTERVAL_DAYS)
}

fn openai_chatgpt_auth_should_refresh(auth_json: &Value, access_token: &str) -> bool {
    openai_chatgpt_access_token_expires_soon(access_token)
        || openai_chatgpt_last_refresh_is_stale(auth_json.get("last_refresh"))
}

fn openai_chatgpt_refresh_token_error() -> AppError {
    AppError::new(
        "openai_chatgpt_auth_error",
        "Codex ChatGPT access token is stale, but no refresh token is available. Run `codex login`.",
    )
}

fn apply_openai_chatgpt_refreshed_tokens(
    tokens: &mut serde_json::Map<String, Value>,
    refreshed: &Value,
) -> Option<String> {
    let next_access_token = string_value(refreshed.get("access_token"));
    if let Some(next_access_token) = next_access_token.clone() {
        tokens.insert(
            "access_token".to_string(),
            Value::String(next_access_token.clone()),
        );
    }
    if let Some(next_refresh_token) = string_value(refreshed.get("refresh_token")) {
        tokens.insert(
            "refresh_token".to_string(),
            Value::String(next_refresh_token),
        );
    }
    if let Some(next_id_token) = string_value(refreshed.get("id_token")) {
        tokens.insert("id_token".to_string(), Value::String(next_id_token));
    }
    next_access_token
}

fn persist_openai_chatgpt_auth(path: &Path, auth_json: &Value) -> AppResult<()> {
    let serialized = serde_json::to_string_pretty(auth_json).map_err(|error| {
        AppError::new(
            "openai_chatgpt_auth_error",
            format!("Failed to serialize Codex ChatGPT auth refresh: {error}"),
        )
    })?;
    fs::write(path, format!("{serialized}\n")).map_err(|error| {
        AppError::new(
            "openai_chatgpt_auth_error",
            format!("Failed to update local Codex auth.json credential file: {error}"),
        )
    })
}

async fn refresh_openai_chatgpt_auth(refresh_token: &str) -> AppResult<Value> {
    let response = send_provider_request_with_error_code(
        provider_http_client_for_url(OPENAI_CHATGPT_REFRESH_URL)
            .await?
            .post(OPENAI_CHATGPT_REFRESH_URL)
            .json(&json!({
                "client_id": OPENAI_CHATGPT_CLIENT_ID,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            })),
        "openai_chatgpt_auth_refresh_error",
    )
    .await?;
    parse_json_response(response, |json| Some(json.to_string()))
        .await
        .and_then(|raw| {
            serde_json::from_str::<Value>(&raw).map_err(|error| {
                AppError::new("openai_chatgpt_auth_refresh_error", error.to_string())
            })
        })
}

fn chrono_like_now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn apply_openai_auth_headers(
    req: reqwest::RequestBuilder,
    request: &LlmRequest,
) -> reqwest::RequestBuilder {
    let mut req = req;
    if !request.connection.api_key.trim().is_empty() {
        req = req.bearer_auth(request.connection.api_key.trim());
    }
    if request.connection.provider == "openrouter" {
        req = req
            .header("HTTP-Referer", "https://de-koi.local")
            .header("X-Title", "De-Koi");
    }
    req
}

async fn apply_chatgpt_auth_headers(
    req: reqwest::RequestBuilder,
) -> AppResult<reqwest::RequestBuilder> {
    let auth = load_openai_chatgpt_auth().await?;
    Ok(apply_chatgpt_auth_headers_with_auth(req, &auth))
}

fn apply_chatgpt_auth_headers_with_auth(
    req: reqwest::RequestBuilder,
    auth: &ChatGptAuth,
) -> reqwest::RequestBuilder {
    let mut req = req
        .bearer_auth(auth.access_token.as_str())
        .header("version", APP_VERSION)
        .header("originator", "De-Koi")
        .header("OAI-Language", "en")
        .header("User-Agent", format!("DeKoi/{APP_VERSION}"));
    if let Some(account_id) = auth.account_id.as_deref() {
        req = req.header("ChatGPT-Account-ID", account_id);
    }
    if auth.is_fedramp {
        req = req.header("X-OpenAI-Fedramp", "true");
    }
    req
}

fn openai_chatgpt_models_url() -> String {
    format!("{OPENAI_CHATGPT_CODEX_BASE_URL}/models?client_version={APP_VERSION}")
}

fn normalize_openai_chatgpt_models(json: &Value) -> Vec<Value> {
    json.get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = string_value(item.get("slug")).or_else(|| string_value(item.get("id")))?;
            let name = string_value(item.get("display_name"))
                .or_else(|| string_value(item.get("name")))
                .unwrap_or_else(|| id.clone());
            Some(json!({ "id": id, "name": name, "provider": "openai_chatgpt" }))
        })
        .collect()
}

async fn fetch_openai_chatgpt_models_from_url(
    url: &str,
    auth: &ChatGptAuth,
) -> AppResult<Vec<Value>> {
    let response = send_provider_request_with_error_code(
        apply_chatgpt_auth_headers_with_auth(
            provider_http_client_for_url(url).await?.get(url),
            auth,
        ),
        "models_network_error",
    )
    .await?;
    let (status, json) = read_json_response(response).await?;
    if !status.is_success() {
        let details = redact_sensitive_json(json);
        let message = provider_error_text(&details)
            .map(|detail| format!("ChatGPT model catalog returned HTTP {status}: {detail}"))
            .unwrap_or_else(|| format!("ChatGPT model catalog returned HTTP {status}"));
        return Err(AppError::with_details(
            "models_provider_error",
            message,
            details,
        ));
    }
    let models = normalize_openai_chatgpt_models(&json);
    if models.is_empty() {
        return Err(AppError::new(
            "models_provider_error",
            "ChatGPT model catalog returned no models",
        ));
    }
    Ok(models)
}

pub async fn list_openai_chatgpt_models() -> AppResult<Vec<Value>> {
    let auth = load_openai_chatgpt_auth().await?;
    fetch_openai_chatgpt_models_from_url(&openai_chatgpt_models_url(), &auth).await
}

async fn read_error_response_details(response: reqwest::Response) -> AppResult<Value> {
    let text = read_capped_provider_error_text(response).await?;
    Ok(provider_error_details_from_text(&text))
}

async fn read_json_response(
    response: reqwest::Response,
) -> AppResult<(reqwest::StatusCode, Value)> {
    let status = response.status();
    if !status.is_success() {
        let text = read_capped_provider_error_text(response).await?;
        return Ok((status, provider_error_details_from_text(&text)));
    }
    let text = read_limited_provider_text(response).await?;
    let json = serde_json::from_str::<Value>(&text).map_err(|error| {
        AppError::with_details(
            "llm_response_error",
            format!("Provider response was not valid JSON: {error}"),
            json!({ "body": sanitize_provider_error_text(&text) }),
        )
    })?;
    Ok((status, json))
}

async fn read_limited_provider_text(mut response: reqwest::Response) -> AppResult<String> {
    if response
        .content_length()
        .is_some_and(|length| length > PROVIDER_RESPONSE_MAX_BYTES as u64)
    {
        return Err(provider_response_too_large_error());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        AppError::new(
            "llm_response_error",
            provider_transport_error_message(error),
        )
    })? {
        if body.len().saturating_add(chunk.len()) > PROVIDER_RESPONSE_MAX_BYTES {
            return Err(provider_response_too_large_error());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

async fn read_capped_provider_error_text(mut response: reqwest::Response) -> AppResult<String> {
    let mut body = Vec::new();
    let mut truncated = false;

    while let Some(chunk) = response.chunk().await.map_err(|error| {
        AppError::new(
            "llm_response_error",
            provider_transport_error_message(error),
        )
    })? {
        let remaining = PROVIDER_RESPONSE_MAX_BYTES.saturating_sub(body.len());
        if chunk.len() > remaining {
            body.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        body.extend_from_slice(&chunk);
    }

    let mut text = String::from_utf8_lossy(&body).into_owned();
    if truncated {
        text.push_str(" [truncated]");
    }
    Ok(text)
}

fn provider_response_too_large_error() -> AppError {
    AppError::new(
        "llm_response_error",
        format!("Provider response exceeds {PROVIDER_RESPONSE_MAX_BYTES} bytes"),
    )
}

async fn parse_json_response<F>(response: reqwest::Response, extract: F) -> AppResult<String>
where
    F: Fn(&Value) -> Option<String>,
{
    let (status, json) = read_json_response(response).await?;
    if !status.is_success() {
        return Err(provider_http_error(status, json));
    }
    extract(&json).ok_or_else(|| {
        AppError::with_details(
            "llm_response_error",
            "Provider response did not contain assistant text",
            redact_sensitive_json(json),
        )
    })
}

fn content_part_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if value.get("type").and_then(Value::as_str) == Some("thinking") {
        return None;
    }
    value
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| value.get("content").and_then(Value::as_str))
        .map(str::to_string)
}

fn content_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(content_part_text)
            .collect::<Vec<_>>()
            .join(""),
        Value::Object(_) => content_part_text(value).unwrap_or_default(),
        _ => String::new(),
    }
}

fn content_thinking_text(value: &Value) -> String {
    match value {
        Value::Array(parts) => parts
            .iter()
            .map(content_thinking_text)
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join(""),
        Value::Object(_) if value.get("type").and_then(Value::as_str) == Some("thinking") => value
            .get("thinking")
            .map(content_text)
            .filter(|text| !text.trim().is_empty())
            .or_else(|| {
                value
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn assistant_message_text(message: &Value) -> String {
    let content = message.get("content").map(content_text).unwrap_or_default();
    if !content.trim().is_empty() {
        return content;
    }
    message
        .get("refusal")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn response_reasoning_text(choice: &Value, message: &Value) -> String {
    if let Some(content_reasoning) = message
        .get("content")
        .map(content_thinking_text)
        .filter(|text| !text.trim().is_empty())
    {
        return content_reasoning;
    }
    [
        message.get("reasoning"),
        message.get("reasoning_content"),
        message.get("thinking"),
        choice.get("reasoning"),
        choice.get("reasoning_content"),
    ]
    .into_iter()
    .flatten()
    .map(content_text)
    .find(|text| !text.trim().is_empty())
    .unwrap_or_default()
}

async fn parse_cohere_response_rich(response: reqwest::Response) -> AppResult<LlmCompletion> {
    let (status, json) = read_json_response(response).await?;
    if !status.is_success() {
        return Err(provider_http_error(status, json));
    }
    let message = json.get("message").unwrap_or(&json);
    let content = assistant_message_text(message);
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(normalize_tool_call)
        .collect::<Vec<_>>();
    if content.trim().is_empty() && tool_calls.is_empty() {
        let reasoning = message
            .get("content")
            .map(content_thinking_text)
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_default();
        if !reasoning.trim().is_empty() {
            return Err(AppError::with_details(
                "llm_response_error",
                "Provider returned reasoning but no final assistant text. Increase Max Output Tokens or lower Reasoning Effort in this connection's generation controls.",
                redact_sensitive_json(json),
            ));
        }
        return Err(AppError::with_details(
            "llm_response_error",
            "Provider response did not contain assistant text or tool calls",
            redact_sensitive_json(json),
        ));
    }
    Ok(LlmCompletion {
        content,
        tool_calls,
        finish_reason: message
            .get("finish_reason")
            .or_else(|| json.get("finish_reason"))
            .and_then(Value::as_str)
            .map(str::to_string),
        usage: json.get("usage").cloned(),
        provider_metadata: None,
    })
}

async fn parse_json_response_rich(response: reqwest::Response) -> AppResult<LlmCompletion> {
    let (status, json) = read_json_response(response).await?;
    if !status.is_success() {
        return Err(provider_http_error(status, json));
    }
    let choice = json
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| {
            AppError::with_details(
                "llm_response_error",
                "Provider response did not contain a completion choice",
                redact_sensitive_json(json.clone()),
            )
        })?;
    let message = choice.get("message").unwrap_or(choice);
    let mut content = assistant_message_text(message);
    if content.trim().is_empty() {
        content = choice.get("text").map(content_text).unwrap_or_default();
    }
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(normalize_tool_call)
        .collect::<Vec<_>>();
    let tool_calls = if tool_calls.is_empty() {
        message
            .get("function_call")
            .filter(|value| value.is_object())
            .cloned()
            .map(normalize_tool_call)
            .into_iter()
            .collect::<Vec<_>>()
    } else {
        tool_calls
    };
    if content.trim().is_empty() && tool_calls.is_empty() {
        let reasoning = response_reasoning_text(choice, message);
        if !reasoning.trim().is_empty() {
            return Err(AppError::with_details(
                "llm_response_error",
                "Provider returned reasoning but no final assistant text. Increase Max Output Tokens or lower Reasoning Effort in this connection's generation controls.",
                redact_sensitive_json(json),
            ));
        }
        return Err(AppError::with_details(
            "llm_response_error",
            "Provider response did not contain assistant text or tool calls",
            redact_sensitive_json(json),
        ));
    }
    Ok(LlmCompletion {
        content,
        tool_calls,
        finish_reason: choice
            .get("finish_reason")
            .or_else(|| message.get("finish_reason"))
            .and_then(Value::as_str)
            .map(str::to_string),
        usage: json.get("usage").cloned(),
        provider_metadata: None,
    })
}

fn normalize_tool_call(call: Value) -> Value {
    let function = call.get("function").cloned().unwrap_or_else(|| json!({}));
    let name = function
        .get("name")
        .or_else(|| call.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let arguments = function
        .get("arguments")
        .or_else(|| call.get("arguments"))
        .and_then(Value::as_str)
        .unwrap_or("{}")
        .to_string();
    json!({
        "id": call.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
        "name": name,
        "arguments": arguments,
        "function": {
            "name": name,
            "arguments": arguments
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn test_connection() -> LlmConnection {
        LlmConnection {
            provider: "claude_subscription".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            api_key: String::new(),
            base_url: String::new(),
            openrouter_provider: None,
            enable_caching: false,
            caching_at_depth: None,
            max_tokens_override: None,
            claude_fast_mode: false,
        }
    }

    fn request_for(provider: &str, model: &str, parameters: Value) -> LlmRequest {
        LlmRequest {
            connection: LlmConnection {
                provider: provider.to_string(),
                model: model.to_string(),
                api_key: String::new(),
                base_url: String::new(),
                openrouter_provider: None,
                enable_caching: false,
                caching_at_depth: None,
                max_tokens_override: None,
                claude_fast_mode: false,
            },
            messages: Vec::new(),
            parameters,
            tools: Vec::new(),
        }
    }

    fn test_message(role: &str, content: &str) -> LlmMessage {
        LlmMessage {
            role: role.to_string(),
            content: content.to_string(),
            name: None,
            images: Vec::new(),
            tool_call_id: None,
            tool_calls: None,
            provider_metadata: None,
        }
    }

    fn unsigned_jwt_with_payload(payload: Value) -> String {
        let header = general_purpose::URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string());
        format!("{header}.{payload}.signature")
    }

    fn unsigned_jwt_with_exp(exp: i64) -> String {
        unsigned_jwt_with_payload(json!({ "exp": exp }))
    }

    async fn serve_response(
        status: &'static str,
        content_type: &'static str,
        body: Vec<u8>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test LLM server should bind");
        let address = listener
            .local_addr()
            .expect("test LLM server address should be readable");
        tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("test LLM server should accept one request");
            let mut buffer = [0_u8; 1024];
            let _ = stream
                .read(&mut buffer)
                .await
                .expect("test LLM server should read request");
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("test LLM server should write response headers");
            stream
                .write_all(&body)
                .await
                .expect("test LLM server should write response body");
        });
        format!("http://{address}")
    }

    async fn serve_chatgpt_models_response(
        status: &'static str,
        body: &'static str,
        assert_headers: bool,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test ChatGPT model server should bind");
        let address = listener
            .local_addr()
            .expect("test ChatGPT model server address should be readable");
        tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("test ChatGPT model server should accept one request");
            let mut buffer = [0_u8; 4096];
            let bytes = stream
                .read(&mut buffer)
                .await
                .expect("test ChatGPT model server should read request");
            let request = String::from_utf8_lossy(&buffer[..bytes]);
            assert!(request
                .lines()
                .next()
                .is_some_and(|line| line.starts_with("GET /models?client_version=1.6.1 ")));
            if assert_headers {
                let headers = request.to_ascii_lowercase();
                assert!(headers.contains("authorization: bearer access-secret"));
                assert!(headers.contains("chatgpt-account-id: account-1"));
                assert!(headers.contains("x-openai-fedramp: true"));
                assert!(headers.contains("originator: de-koi"));
                assert!(headers.contains("oai-language: en"));
            }
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("test ChatGPT model server should write response");
        });
        format!("http://{address}/models?client_version=1.6.1")
    }

    async fn serve_chunked_response(
        status: &'static str,
        content_type: &'static str,
        chunks: Vec<Vec<u8>>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test LLM server should bind");
        let address = listener
            .local_addr()
            .expect("test LLM server address should be readable");
        tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("test LLM server should accept one request");
            let mut buffer = [0_u8; 1024];
            let _ = stream
                .read(&mut buffer)
                .await
                .expect("test LLM server should read request");
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("test LLM server should write response headers");
            for chunk in chunks {
                let header = format!("{:x}\r\n", chunk.len());
                stream
                    .write_all(header.as_bytes())
                    .await
                    .expect("test LLM server should write chunk header");
                stream
                    .write_all(&chunk)
                    .await
                    .expect("test LLM server should write chunk body");
                stream
                    .write_all(b"\r\n")
                    .await
                    .expect("test LLM server should write chunk terminator");
            }
            stream
                .write_all(b"0\r\n\r\n")
                .await
                .expect("test LLM server should write final chunk");
        });
        format!("http://{address}")
    }

    async fn serve_delayed_response_headers(delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test LLM server should bind");
        let address = listener
            .local_addr()
            .expect("test LLM server address should be readable");
        tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("test LLM server should accept one request");
            let mut buffer = [0_u8; 1024];
            let _ = stream
                .read(&mut buffer)
                .await
                .expect("test LLM server should read request");
            tokio::time::sleep(delay).await;
            let _ = stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                )
                .await;
        });
        format!("http://{address}")
    }

    async fn response_from_url(url: String) -> reqwest::Response {
        reqwest::Client::new()
            .get(url)
            .send()
            .await
            .expect("test LLM response should arrive")
    }

    #[test]
    fn prompt_connection_diagnostics_follow_legacy_preset_and_explicit_flag() {
        assert!(is_prompt_connection_log_preset_value(Some(
            "prompt-connections"
        )));
        assert!(is_prompt_connection_log_preset_value(Some(
            "prompt_connections"
        )));
        assert!(prompt_connection_diagnostics_enabled_values(
            Some("prompt-connections"),
            None
        ));
        assert!(prompt_connection_diagnostics_enabled_values(
            None,
            Some("true")
        ));
        assert!(prompt_connection_diagnostics_enabled_values(
            None,
            Some("1")
        ));
        assert!(!prompt_connection_diagnostics_enabled_values(
            Some("default"),
            Some("false")
        ));
        assert!(!prompt_connection_diagnostics_enabled_values(None, None));
    }

    #[test]
    fn prompt_connection_endpoint_redaction_removes_query_secrets() {
        assert_eq!(
            redacted_endpoint("https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=secret"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?<redacted>"
        );
        assert_eq!(
            redacted_endpoint("https://api.openai.com/v1/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn openai_chat_stream_accumulates_tool_call_deltas() {
        let mut emitted = Vec::new();
        let mut tool_calls = OpenAiToolCallAccumulator::default();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let first_status = process_openai_sse_block(
            r#"data: {"choices":[{"delta":{"content":"Rolling...","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"roll_dice","arguments":"{\"notation\""}}]}}]}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("first chunk should parse");
        let status = process_openai_sse_block(
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"1d20\"}"}}]}}]}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("second chunk should parse");

        let calls = tool_calls.into_tool_calls();
        assert_eq!(emitted[0]["type"], "token");
        assert_eq!(emitted[0]["text"], "Rolling...");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], "call_1");
        assert_eq!(calls[0]["function"]["name"], "roll_dice");
        assert_eq!(calls[0]["function"]["arguments"], r#"{"notation":"1d20"}"#);
        assert_eq!(first_status, SseBlockStatus::Continue);
        assert_eq!(status, SseBlockStatus::Continue);
    }

    #[test]
    fn openai_chat_stream_done_block_is_terminal() {
        let mut emitted = Vec::new();
        let mut tool_calls = OpenAiToolCallAccumulator::default();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_openai_sse_block("data: [DONE]", &mut emit, &mut tool_calls)
            .expect("DONE chunk should parse");

        assert_eq!(status, SseBlockStatus::Complete);
        assert!(emitted.is_empty());
    }

    #[test]
    fn openai_chat_stream_finish_reason_is_terminal() {
        let mut emitted = Vec::new();
        let mut tool_calls = OpenAiToolCallAccumulator::default();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_openai_sse_block(
            r#"data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("finish_reason chunk should parse");

        assert_eq!(status, SseBlockStatus::Complete);
        assert_eq!(
            emitted[0],
            json!({ "type": "token", "text": "done", "data": "done" })
        );
    }

    #[test]
    fn openai_responses_completed_event_is_terminal() {
        let mut emitted = Vec::new();
        let mut tool_calls = ResponsesToolCallAccumulator::default();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_openai_responses_sse_block(
            r#"event: response.completed
data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("response.completed should parse");

        assert_eq!(status, SseBlockStatus::Complete);
        assert_eq!(emitted[0]["type"], json!("usage"));
    }

    #[test]
    fn openai_responses_completed_event_emits_encrypted_reasoning_metadata() {
        let mut emitted = Vec::new();
        let mut tool_calls = ResponsesToolCallAccumulator::default();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_openai_responses_sse_block(
            r#"event: response.completed
data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2},"output":[{"type":"reasoning","id":"rs_1","encrypted_content":"encrypted-payload"},{"type":"message","content":[{"type":"output_text","text":"done"}]}]}}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("response.completed should parse");

        assert_eq!(status, SseBlockStatus::Complete);
        assert_eq!(
            emitted[0],
            json!({ "type": "usage", "data": { "input_tokens": 1, "output_tokens": 2 } })
        );
        assert_eq!(emitted[1]["type"], json!("provider_metadata"));
        assert_eq!(
            emitted[1]["data"]["encryptedReasoningItems"][0],
            json!({ "type": "reasoning", "id": "rs_1", "encrypted_content": "encrypted-payload" })
        );
    }

    #[test]
    fn openai_responses_body_requests_and_replays_encrypted_reasoning() {
        let mut request = request_for(
            "openai",
            "gpt-5",
            json!({ "customParameters": { "include": ["web_search_call.action.sources"] } }),
        );
        let mut assistant = test_message("assistant", "Earlier answer.");
        assistant.provider_metadata = Some(json!({
            "encryptedReasoningItems": [
                { "type": "reasoning", "id": "rs_1", "encrypted_content": "encrypted-payload" }
            ]
        }));
        request.messages = vec![
            test_message("user", "Earlier question."),
            assistant,
            test_message("user", "Next question."),
        ];

        let body = build_openai_responses_body(&request, false);
        let includes = body["include"]
            .as_array()
            .expect("include should be an array");
        assert!(includes
            .iter()
            .any(|item| item.as_str() == Some("web_search_call.action.sources")));
        assert!(includes
            .iter()
            .any(|item| { item.as_str() == Some(OPENAI_RESPONSES_ENCRYPTED_REASONING_INCLUDE) }));
        let input = body["input"].as_array().expect("input should be an array");
        assert_eq!(input[0]["role"], json!("user"));
        assert_eq!(
            input[1],
            json!({ "type": "reasoning", "id": "rs_1", "encrypted_content": "encrypted-payload" })
        );
        assert_eq!(input[2]["role"], json!("assistant"));
        assert_eq!(input[3]["role"], json!("user"));
    }

    #[test]
    fn openai_responses_body_preserves_tool_roundtrip_shape() {
        let mut request = request_for("openai", "gpt-5", json!({}));
        let mut assistant = test_message("assistant", "I should use a tool.");
        assistant.tool_calls = Some(json!([
            {
                "id": "call_roll",
                "function": {
                    "name": "roll_dice",
                    "arguments": "{\"notation\":\"1d20\"}"
                }
            }
        ]));
        let mut tool = test_message("tool", "17");
        tool.tool_call_id = Some("call_roll".to_string());
        request.messages = vec![
            test_message("user", "Roll please."),
            assistant,
            tool,
            test_message("user", "What happened?"),
        ];

        let body = build_openai_responses_body(&request, false);
        let input = body["input"].as_array().expect("input should be an array");

        assert_eq!(
            input[0],
            json!({ "role": "user", "content": "Roll please." })
        );
        assert_eq!(
            input[1],
            json!({ "role": "assistant", "content": "I should use a tool." })
        );
        assert_eq!(
            input[2],
            json!({
                "type": "function_call",
                "id": "fc_mapped_1",
                "call_id": "fc_mapped_1",
                "name": "roll_dice",
                "arguments": "{\"notation\":\"1d20\"}"
            })
        );
        assert_eq!(
            input[3],
            json!({ "type": "function_call_output", "call_id": "fc_mapped_1", "output": "17" })
        );
        assert_eq!(
            input[4],
            json!({ "role": "user", "content": "What happened?" })
        );
    }

    #[test]
    fn openai_responses_stream_accumulates_function_call_deltas() {
        let mut emitted = Vec::new();
        let mut tool_calls = ResponsesToolCallAccumulator::default();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        process_openai_responses_sse_block(
            r#"event: response.output_item.added
data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"fc_1","name":"roll_dice","arguments":""}}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("function_call item should parse");
        process_openai_responses_sse_block(
            r#"event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","call_id":"fc_1","delta":"{\"notation\""}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("function_call argument delta should parse");
        process_openai_responses_sse_block(
            r#"event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","call_id":"fc_1","delta":":\"1d20\"}"}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("function_call argument delta should parse");
        process_openai_responses_sse_block(
            r#"event: response.function_call_arguments.done
data: {"type":"response.function_call_arguments.done","call_id":"fc_1","arguments":"{\"notation\":\"1d20\"}"}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("function_call arguments done should parse");
        process_openai_responses_sse_block(
            r#"event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"fc_1","name":"roll_dice"}}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("function_call item done should parse");

        assert!(emitted.is_empty());
        assert_eq!(
            tool_calls.into_tool_calls(),
            vec![json!({
                "id": "fc_1",
                "name": "roll_dice",
                "arguments": "{\"notation\":\"1d20\"}",
                "function": {
                    "name": "roll_dice",
                    "arguments": "{\"notation\":\"1d20\"}"
                }
            })]
        );
    }

    #[test]
    fn openai_responses_stream_binds_item_id_argument_deltas() {
        let mut emitted = Vec::new();
        let mut tool_calls = ResponsesToolCallAccumulator::default();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        process_openai_responses_sse_block(
            r#"event: response.output_item.added
data: {"type":"response.output_item.added","output_index":2,"item":{"type":"function_call","id":"item_1","call_id":"fc_1","name":"roll_dice","arguments":""}}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("function_call item should parse");
        process_openai_responses_sse_block(
            r#"event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","item_id":"item_1","delta":"{\"notation\""}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("item_id argument delta should parse");
        process_openai_responses_sse_block(
            r#"event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","output_index":2,"delta":":\"1d20\"}"}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("output_index argument delta should parse");
        process_openai_responses_sse_block(
            r#"event: response.function_call_arguments.done
data: {"type":"response.function_call_arguments.done","item_id":"item_1","arguments":"{\"notation\":\"1d20\"}"}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("item_id arguments done should parse");

        assert!(emitted.is_empty());
        assert_eq!(
            tool_calls.into_tool_calls(),
            vec![json!({
                "id": "fc_1",
                "name": "roll_dice",
                "arguments": "{\"notation\":\"1d20\"}",
                "function": {
                    "name": "roll_dice",
                    "arguments": "{\"notation\":\"1d20\"}"
                }
            })]
        );
    }

    #[test]
    fn openai_responses_stream_merges_stale_item_aliases() {
        let mut emitted = Vec::new();
        let mut tool_calls = ResponsesToolCallAccumulator::default();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        process_openai_responses_sse_block(
            r#"event: response.output_item.added
data: {"type":"response.output_item.added","output_index":2,"item":{"type":"function_call","id":"item_1","name":"roll_dice","arguments":""}}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("function_call item should parse");
        process_openai_responses_sse_block(
            r#"event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","item_id":"item_1","delta":"{\"notation\""}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("item_id argument delta should parse");
        process_openai_responses_sse_block(
            r#"event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"function_call","id":"item_1","call_id":"fc_1","name":"roll_dice"}}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("function_call item done should merge ids");
        process_openai_responses_sse_block(
            r#"event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","output_index":2,"delta":":\"1d20\"}"}"#,
            &mut emit,
            &mut tool_calls,
        )
        .expect("output_index argument delta should resolve to merged call id");

        assert!(emitted.is_empty());
        assert_eq!(
            tool_calls.into_tool_calls(),
            vec![json!({
                "id": "fc_1",
                "name": "roll_dice",
                "arguments": "{\"notation\":\"1d20\"}",
                "function": {
                    "name": "roll_dice",
                    "arguments": "{\"notation\":\"1d20\"}"
                }
            })]
        );
    }

    #[test]
    fn openai_chatgpt_responses_body_does_not_replay_encrypted_reasoning() {
        let mut request = request_for("openai_chatgpt", "gpt-5-codex", json!({}));
        let mut assistant = test_message("assistant", "Earlier answer.");
        assistant.provider_metadata = Some(json!({
            "encryptedReasoningItems": [
                { "type": "reasoning", "encrypted_content": "encrypted-payload" }
            ]
        }));
        request.messages = vec![test_message("user", "Earlier question."), assistant];

        let body = build_openai_responses_body(&request, false);
        assert_eq!(body["include"], json!([]));
        let input = body["input"].as_array().expect("input should be an array");
        assert!(input
            .iter()
            .all(|item| item.get("encrypted_content").is_none()));
    }

    #[test]
    fn openai_chatgpt_responses_body_uses_codex_endpoint_shape() {
        let mut request = request_for(
            "openai_chatgpt",
            "gpt-5.4-mini",
            json!({
                "maxTokens": 4096,
                "temperature": 0.7,
                "topP": 0.9
            }),
        );
        request.messages = vec![test_message("user", "hi")];

        let body = build_openai_responses_body(&request, false);

        assert_eq!(body["model"], json!("gpt-5.4-mini"));
        assert_eq!(body["stream"], json!(false));
        assert_eq!(body["store"], json!(false));
        assert_eq!(body["include"], json!([]));
        assert_eq!(body["instructions"], json!("You are a helpful assistant."));
        assert_eq!(body["reasoning"], json!({ "effort": "low" }));
        assert_eq!(body["tools"], json!([]));
        assert_eq!(body["tool_choice"], json!("none"));
        assert_eq!(body["parallel_tool_calls"], json!(false));
        assert!(body.get("max_output_tokens").is_none());
        assert!(body.get("temperature").is_none());
        assert!(body.get("top_p").is_none());
        assert_eq!(
            body["input"],
            json!([
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": "hi" }
                    ]
                }
            ])
        );
    }

    #[test]
    fn openai_chatgpt_legacy_chat_latest_aliases_normalize_to_default_model() {
        assert_eq!(
            normalize_openai_chatgpt_model("chat-latest"),
            "gpt-5.4-mini"
        );
        assert_eq!(
            normalize_openai_chatgpt_model("gpt-5.2-chat-latest"),
            "gpt-5.4-mini"
        );
        assert_eq!(
            normalize_openai_chatgpt_model(" gpt-5.4-mini "),
            "gpt-5.4-mini"
        );
    }

    #[test]
    fn openai_chatgpt_responses_body_moves_system_messages_to_instructions() {
        let mut request = request_for("openai_chatgpt", "gpt-5.4-mini", json!({}));
        request.messages = vec![
            test_message("system", "Use terse replies."),
            test_message("user", "hi"),
        ];

        let body = build_openai_responses_body(&request, true);

        assert_eq!(body["instructions"], json!("Use terse replies."));
        assert_eq!(
            body["input"],
            json!([
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": "hi" }
                    ]
                }
            ])
        );
    }

    #[test]
    fn openai_chatgpt_base_url_ignores_configured_endpoint() {
        assert_eq!(
            base_url("openai_chatgpt", "https://api.example.com/v1"),
            OPENAI_CHATGPT_CODEX_BASE_URL
        );
    }

    #[tokio::test]
    async fn openai_chatgpt_models_live_success_normalizes_slug_and_name() {
        let url = serve_chatgpt_models_response(
            "200 OK",
            r#"{"models":[{"slug":"gpt-5-codex","display_name":"GPT-5 Codex"},{"id":"o3","name":"o3"}]}"#,
            true,
        )
        .await;
        let auth = ChatGptAuth {
            access_token: "access-secret".to_string(),
            account_id: Some("account-1".to_string()),
            is_fedramp: true,
        };

        let models = fetch_openai_chatgpt_models_from_url(&url, &auth)
            .await
            .expect("live ChatGPT model discovery should succeed");

        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["id"], "gpt-5-codex");
        assert_eq!(models[0]["name"], "GPT-5 Codex");
        assert_eq!(models[0]["provider"], "openai_chatgpt");
        assert_eq!(models[1]["id"], "o3");
        assert_eq!(models[1]["name"], "o3");
    }

    #[tokio::test]
    async fn openai_chatgpt_models_headers_include_id_token_claim_metadata() {
        let id_token = unsigned_jwt_with_payload(json!({
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "account-1",
                "chatgpt_account_is_fedramp": true
            }
        }));
        let auth_json = json!({
            "tokens": {
                "access_token": "access-secret",
                "id_token": id_token
            }
        });
        let metadata = openai_chatgpt_auth_metadata(&auth_json, "access-secret");
        let url =
            serve_chatgpt_models_response("200 OK", r#"{"models":[{"slug":"gpt-5-codex"}]}"#, true)
                .await;
        let auth = ChatGptAuth {
            access_token: "access-secret".to_string(),
            account_id: metadata.account_id,
            is_fedramp: metadata.is_fedramp,
        };

        let models = fetch_openai_chatgpt_models_from_url(&url, &auth)
            .await
            .expect("claim-derived ChatGPT metadata should be sent as headers");

        assert_eq!(models[0]["id"], "gpt-5-codex");
    }

    #[test]
    fn openai_chatgpt_auth_metadata_uses_access_token_account_fallback() {
        let access_token = unsigned_jwt_with_payload(json!({
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "account-from-access",
                "chatgpt_account_is_fedramp": true
            }
        }));
        let auth_json = json!({
            "tokens": {
                "access_token": access_token
            }
        });

        let metadata = openai_chatgpt_auth_metadata(
            &auth_json,
            auth_json
                .pointer("/tokens/access_token")
                .and_then(Value::as_str)
                .expect("access token should be present"),
        );

        assert_eq!(metadata.account_id.as_deref(), Some("account-from-access"));
        assert!(metadata.is_fedramp);
    }

    #[tokio::test]
    async fn openai_chatgpt_models_headers_include_access_token_claim_metadata() {
        let access_token = unsigned_jwt_with_payload(json!({
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "account-1",
                "chatgpt_account_is_fedramp": true
            }
        }));
        let auth_json = json!({
            "tokens": {
                "access_token": access_token
            }
        });
        let metadata = openai_chatgpt_auth_metadata(
            &auth_json,
            auth_json
                .pointer("/tokens/access_token")
                .and_then(Value::as_str)
                .expect("access token should be present"),
        );
        let url =
            serve_chatgpt_models_response("200 OK", r#"{"models":[{"slug":"gpt-5-codex"}]}"#, true)
                .await;
        let auth = ChatGptAuth {
            access_token: "access-secret".to_string(),
            account_id: metadata.account_id,
            is_fedramp: metadata.is_fedramp,
        };

        let models = fetch_openai_chatgpt_models_from_url(&url, &auth)
            .await
            .expect("access-token claim-derived metadata should be sent as headers");

        assert_eq!(models[0]["id"], "gpt-5-codex");
    }

    #[test]
    fn openai_chatgpt_auth_metadata_prefers_direct_account_id() {
        let id_token = unsigned_jwt_with_payload(json!({
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "account-from-id-token",
                "chatgpt_account_is_fedramp": "true"
            }
        }));
        let auth_json = json!({
            "tokens": {
                "access_token": "access-secret",
                "account_id": "direct-account",
                "id_token": id_token
            }
        });

        let metadata = openai_chatgpt_auth_metadata(&auth_json, "access-secret");

        assert_eq!(metadata.account_id.as_deref(), Some("direct-account"));
        assert!(metadata.is_fedramp);
    }

    #[tokio::test]
    async fn openai_chatgpt_models_empty_live_result_returns_fallback_error() {
        let url = serve_chatgpt_models_response("200 OK", r#"{"models":[]}"#, false).await;
        let auth = ChatGptAuth {
            access_token: "access-secret".to_string(),
            account_id: None,
            is_fedramp: false,
        };

        let error = fetch_openai_chatgpt_models_from_url(&url, &auth)
            .await
            .expect_err("empty live ChatGPT catalog should trigger curated fallback");

        assert_eq!(error.code, "models_provider_error");
        assert!(error.message.contains("returned no models"));
    }

    #[tokio::test]
    async fn openai_chatgpt_models_provider_error_returns_fallback_error() {
        let url = serve_chatgpt_models_response(
            "401 Unauthorized",
            r#"{"error":{"message":"bad key sk-test-secret"}}"#,
            false,
        )
        .await;
        let auth = ChatGptAuth {
            access_token: "access-secret".to_string(),
            account_id: None,
            is_fedramp: false,
        };

        let error = fetch_openai_chatgpt_models_from_url(&url, &auth)
            .await
            .expect_err("provider error should trigger curated fallback");

        assert_eq!(error.code, "models_provider_error");
        assert!(error
            .message
            .contains("ChatGPT model catalog returned HTTP 401 Unauthorized"));
        assert!(!error.message.contains("sk-test-secret"));
        let details = serde_json::to_string(&error.details).expect("details should serialize");
        assert!(!details.contains("sk-test-secret"));
    }

    #[test]
    fn openai_chatgpt_auth_skips_fresh_recent_token() {
        let token = unsigned_jwt_with_exp(Utc::now().timestamp() + 3600);
        let auth = json!({
            "tokens": { "access_token": token },
            "last_refresh": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
        });

        assert!(!openai_chatgpt_auth_should_refresh(
            &auth,
            auth.pointer("/tokens/access_token")
                .and_then(Value::as_str)
                .expect("token should be present")
        ));
    }

    #[test]
    fn openai_chatgpt_auth_refreshes_for_near_expiry_token() {
        let token = unsigned_jwt_with_exp(
            Utc::now().timestamp() + OPENAI_CHATGPT_EXPIRY_REFRESH_SKEW_SECONDS,
        );
        let auth = json!({
            "tokens": { "access_token": token },
            "last_refresh": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
        });

        assert!(openai_chatgpt_auth_should_refresh(
            &auth,
            auth.pointer("/tokens/access_token")
                .and_then(Value::as_str)
                .expect("token should be present")
        ));
    }

    #[test]
    fn openai_chatgpt_auth_refreshes_for_stale_last_refresh() {
        let token = unsigned_jwt_with_exp(Utc::now().timestamp() + 3600);
        let auth = json!({
            "tokens": { "access_token": token },
            "last_refresh": (Utc::now()
                - chrono::Duration::days(OPENAI_CHATGPT_TOKEN_REFRESH_INTERVAL_DAYS + 1))
            .to_rfc3339_opts(SecondsFormat::Millis, true)
        });

        assert!(openai_chatgpt_auth_should_refresh(
            &auth,
            auth.pointer("/tokens/access_token")
                .and_then(Value::as_str)
                .expect("token should be present")
        ));
    }

    #[test]
    fn openai_chatgpt_missing_refresh_token_error_is_secret_safe() {
        let error = openai_chatgpt_refresh_token_error();

        assert_eq!(error.code, "openai_chatgpt_auth_error");
        assert!(error.message.contains("no refresh token is available"));
        assert!(!error.message.contains("sk-"));
        assert!(!error.message.contains("refresh-secret"));
    }

    #[test]
    fn openai_chatgpt_refresh_response_updates_tokens_for_persistence() {
        let mut auth = json!({
            "tokens": {
                "access_token": "old-access-secret",
                "refresh_token": "old-refresh-secret",
                "id_token": "old-id-secret"
            },
            "last_refresh": "2026-01-01T00:00:00.000Z"
        });
        let tokens = auth
            .get_mut("tokens")
            .and_then(Value::as_object_mut)
            .expect("tokens should be mutable");

        let access = apply_openai_chatgpt_refreshed_tokens(
            tokens,
            &json!({
                "access_token": "new-access-secret",
                "refresh_token": "new-refresh-secret",
                "id_token": "new-id-secret"
            }),
        )
        .expect("refreshed access token should be returned");
        auth["last_refresh"] = Value::String("2026-06-06T00:00:00.000Z".to_string());
        let serialized = serde_json::to_string_pretty(&auth).expect("auth should serialize");

        assert_eq!(access, "new-access-secret");
        assert!(serialized.contains("new-access-secret"));
        assert!(serialized.contains("new-refresh-secret"));
        assert!(serialized.contains("new-id-secret"));
        assert!(!serialized.contains("old-access-secret"));
        assert!(!serialized.contains("old-refresh-secret"));
        assert!(!serialized.contains("old-id-secret"));
    }

    #[test]
    fn cohere_default_base_uses_openai_compatible_endpoint() {
        let mut request = request_for("cohere", "command-a", json!({}));

        assert_eq!(
            base_url("cohere", ""),
            "https://api.cohere.ai/compatibility/v1"
        );
        assert!(should_use_cohere_compatibility(&request));
        assert_eq!(
            openai_compatible_chat_endpoint(&request),
            "https://api.cohere.ai/compatibility/v1/chat/completions"
        );

        request.connection.base_url = "https://api.cohere.com/v2".to_string();
        assert!(!should_use_cohere_compatibility(&request));
        assert_eq!(
            cohere_chat_endpoint(&request.connection.base_url),
            "https://api.cohere.com/v2/chat"
        );
    }

    #[test]
    fn openai_chatgpt_missing_auth_message_hides_local_path() {
        let error = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let message = openai_chatgpt_auth_missing_message(&error);

        assert!(message.contains("local Codex auth.json credential file"));
        assert!(!message.contains(":\\"));
        assert!(!message.contains("/Users/"));
        assert!(!message.contains("/home/"));
    }

    #[test]
    fn openai_responses_body_preserves_xhigh_for_supported_models() {
        let request = request_for(
            "openai",
            "gpt-5.2",
            json!({
                "reasoningEffort": "xhigh",
                "responseFormat": "json_object",
                "verbosity": "high",
                "customParameters": {
                    "metadata": { "surface": "preset-proof" }
                }
            }),
        );
        let body = build_openai_responses_body(&request, false);

        assert_eq!(
            body["reasoning"],
            json!({ "effort": "xhigh", "summary": "auto" })
        );
        assert_eq!(
            body["text"],
            json!({ "format": { "type": "json_object" }, "verbosity": "high" })
        );
        assert_eq!(body["metadata"], json!({ "surface": "preset-proof" }));
    }

    #[test]
    fn openai_responses_body_resolves_maximum_to_supported_xhigh() {
        let request = request_for(
            "openai",
            "gpt-5.2-codex",
            json!({ "reasoningEffort": "maximum" }),
        );
        let body = build_openai_responses_body(&request, false);

        assert_eq!(body["reasoning"]["effort"], json!("xhigh"));
    }

    #[test]
    fn openai_responses_body_preserves_xhigh_aliases_for_gpt51_codex_max() {
        let xhigh_request = request_for(
            "openai",
            "gpt-5.1-codex-max",
            json!({ "reasoningEffort": "xhigh" }),
        );
        let maximum_request = request_for(
            "openai",
            "gpt-5.1-codex-max",
            json!({ "reasoningEffort": "maximum" }),
        );

        assert_eq!(
            build_openai_responses_body(&xhigh_request, false)["reasoning"]["effort"],
            json!("xhigh")
        );
        assert_eq!(
            build_openai_responses_body(&maximum_request, false)["reasoning"]["effort"],
            json!("xhigh")
        );
    }

    #[test]
    fn openai_responses_body_downgrades_xhigh_for_unsupported_models() {
        let xhigh_request = request_for("openai", "gpt-5.1", json!({ "reasoningEffort": "xhigh" }));
        let maximum_request = request_for(
            "openai",
            "gpt-5-pro",
            json!({ "reasoningEffort": "maximum" }),
        );

        assert_eq!(
            build_openai_responses_body(&xhigh_request, false)["reasoning"]["effort"],
            json!("high")
        );
        assert_eq!(
            build_openai_responses_body(&maximum_request, false)["reasoning"]["effort"],
            json!("high")
        );
    }

    #[test]
    fn openrouter_reasoning_uses_unified_xhigh_effort() {
        let request = request_for(
            "openrouter",
            "anthropic/claude-3.7-sonnet",
            json!({ "reasoningEffort": "xhigh" }),
        );
        let mut body = json!({});
        apply_openai_parameters(&mut body, &request);

        assert_eq!(body["reasoning"], json!({ "effort": "xhigh" }));
    }

    #[tokio::test]
    async fn provider_http_client_redacts_query_secret() {
        let error = provider_http_client_for_url("ftp://example.test/models?key=sk-test-secret")
            .await
            .expect_err("disallowed URL should fail");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("[REDACTED]"));
        assert!(!error.message.contains("sk-test-secret"));
    }

    #[test]
    fn provider_http_client_policy_blocks_private_dns_answers() {
        let url = reqwest::Url::parse("https://public-looking.example.test/v1/chat/completions")
            .expect("test URL should parse");
        let error = validate_provider_resolved_addresses(
            &url,
            false,
            vec![
                "10.0.0.1:443".parse().expect("private address parses"),
                "[::ffff:10.0.0.1]:443"
                    .parse()
                    .expect("mapped private address parses"),
            ],
        )
        .expect_err("private DNS answers should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains(PROVIDER_LOCAL_URLS_ENABLED_FLAG));
    }

    #[test]
    fn provider_http_client_policy_blocks_loopback_dns_answers() {
        let url = reqwest::Url::parse("https://public-looking.example.test/v1/chat/completions")
            .expect("test URL should parse");
        let error = validate_provider_resolved_addresses(
            &url,
            false,
            vec![
                "127.0.0.1:443".parse().expect("loopback address parses"),
                "[::1]:443".parse().expect("IPv6 loopback address parses"),
                "[::ffff:127.0.0.1]:443"
                    .parse()
                    .expect("mapped loopback address parses"),
            ],
        )
        .expect_err("loopback DNS answers should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains(PROVIDER_LOCAL_URLS_ENABLED_FLAG));
    }

    #[tokio::test]
    async fn provider_http_client_policy_keeps_literal_loopback_allowed() {
        for url in [
            "http://127.0.0.1:11434/api/chat",
            "http://localhost:11434/api/chat",
            "http://[::ffff:127.0.0.1]:11434/api/chat",
        ] {
            let url = reqwest::Url::parse(url).expect("test URL should parse");
            let allowed = validate_provider_url_resolution(&url, false)
                .await
                .expect("literal loopback host should keep local provider allowance");

            assert!(allowed.is_none());
        }
    }

    #[tokio::test]
    async fn provider_request_times_out_waiting_for_response_headers() {
        let url = serve_delayed_response_headers(Duration::from_millis(250)).await;
        let request = provider_http_client_for_url(&url)
            .await
            .expect("loopback test provider URL should be allowed")
            .get(&url);

        let error = send_provider_request_with_timeout(
            request,
            "llm_network_error",
            Duration::from_millis(25),
        )
        .await
        .expect_err("slow provider headers should time out");

        assert_eq!(error.code, "llm_network_error");
        assert!(error.message.contains("timed out"));
        assert!(error.message.contains("response headers"));
    }

    #[tokio::test]
    async fn openai_compatible_complete_rich_preserves_result_metadata() {
        let url = serve_response(
            "200 OK",
            "application/json",
            br#"{"choices":[{"finish_reason":"tool_calls","message":{"content":"Need a roll.","tool_calls":[{"id":"call_1","function":{"name":"roll_dice","arguments":"{\"notation\":\"1d20\"}"}}]}}],"usage":{"prompt_tokens":11,"completion_tokens":7}}"#.to_vec(),
        )
        .await;
        let mut request = request_for("openai", "gpt-4o", json!({}));
        request.connection.base_url = url;
        request.messages = vec![test_message("user", "Roll.")];

        let completion = complete_openai_compatible_rich(request)
            .await
            .expect("rich completion should parse");

        assert_eq!(completion.content, "Need a roll.");
        assert_eq!(completion.finish_reason.as_deref(), Some("tool_calls"));
        assert_eq!(
            completion.usage.as_ref().unwrap()["prompt_tokens"],
            json!(11)
        );
        assert_eq!(completion.tool_calls[0]["id"], json!("call_1"));
        assert_eq!(
            completion.tool_calls[0]["function"]["name"],
            json!("roll_dice")
        );
    }

    #[test]
    fn claude_subscription_output_rich_preserves_usage_metadata() {
        let completion = parse_claude_subscription_output_rich(
            r#"{"type":"result","subtype":"success","result":"OK","usage":{"input_tokens":10,"output_tokens":2},"fast_mode_state":"off","modelUsage":{"claude-sonnet-4-5":{"input_tokens":10,"output_tokens":2}}}"#,
            "claude-sonnet-4-5",
        )
        .expect("Claude subscription result should parse");

        assert_eq!(completion.content, "OK");
        assert_eq!(completion.finish_reason.as_deref(), Some("success"));
        let usage = completion.usage.expect("usage should be preserved");
        assert_eq!(usage["input_tokens"], json!(10));
        assert_eq!(
            usage["modelUsage"]["claude-sonnet-4-5"]["output_tokens"],
            json!(2)
        );
        assert_eq!(usage["fastModeState"], json!("off"));
    }

    #[test]
    fn google_vertex_default_base_uses_aiplatform_endpoint() {
        assert_eq!(
            base_url("google_vertex", ""),
            "https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1"
        );
        assert_eq!(
            google_vertex_endpoint(
                "https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/publishers/google/models",
                "gemini-2.5-pro",
                "generateContent",
            ),
            "https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent"
        );
    }

    #[test]
    fn google_linkapi_console_hosts_normalize_to_api_host() {
        assert_eq!(
            normalize_google_base_url("https://home.linkapi.ai".to_string()),
            "https://api.linkapi.ai"
        );
        assert_eq!(
            normalize_google_base_url("https://www.linkapi.ai/v1beta".to_string()),
            "https://api.linkapi.ai/v1beta"
        );
    }

    #[test]
    fn google_stream_endpoint_uses_sse_stream_generate_content() {
        let request = request_for("google", "gemini-3.5-flash", json!({}));

        assert_eq!(
            google_endpoint(&request, "streamGenerateContent", true),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?key=&alt=sse"
        );
    }

    #[test]
    fn google_linkapi_stream_endpoint_uses_api_host_and_sse() {
        let mut request = request_for("google", "gemini-3.5-flash", json!({}));
        request.connection.base_url = "https://home.linkapi.ai".to_string();

        assert_eq!(
            google_endpoint(&request, "streamGenerateContent", true),
            "https://api.linkapi.ai/v1beta/models/gemini-3.5-flash:streamGenerateContent?key=&alt=sse"
        );
    }

    #[test]
    fn provider_http_error_preserves_text_error_body() {
        let details = provider_error_details_from_text("error code: 1033");
        let error = provider_http_error(
            reqwest::StatusCode::from_u16(530).expect("530 should be a valid status"),
            details,
        );

        assert_eq!(error.code, "llm_provider_error");
        assert!(error.message.contains("error code: 1033"));
    }

    #[test]
    fn provider_http_error_redacts_sensitive_error_body() {
        let details = provider_error_details_from_text(
            r#"{"error":{"message":"Invalid API key sk-test-secret"},"api_key":"sk-test-secret","usage":{"input_tokens":12}}"#,
        );
        let error = provider_http_error(reqwest::StatusCode::UNAUTHORIZED, details);

        assert_eq!(error.code, "llm_provider_error");
        assert!(error.message.contains("[REDACTED]"));
        assert!(!error.message.contains("sk-test-secret"));
        let details = error.details.expect("provider details should be attached");
        assert_eq!(details["api_key"], "[REDACTED]");
        assert_eq!(details["usage"]["input_tokens"], 12);
        assert!(!details.to_string().contains("sk-test-secret"));
    }

    #[tokio::test]
    async fn oversized_llm_error_body_preserves_provider_status() {
        let url = serve_response(
            "429 Too Many Requests",
            "text/plain",
            vec![b'x'; PROVIDER_RESPONSE_MAX_BYTES + 1024],
        )
        .await;
        let response = response_from_url(url).await;
        let error = parse_json_response(response, |json| Some(json.to_string()))
            .await
            .expect_err("oversized provider error should stay status-bearing");

        assert_eq!(error.code, "llm_provider_error");
        assert!(error
            .message
            .contains("Provider returned HTTP 429 Too Many Requests"));
        assert!(!error.message.contains("exceeds"));
        assert!(error.message.len() < 700);
    }

    #[tokio::test]
    async fn chunked_llm_error_body_is_bounded_redacted_and_status_bearing() {
        let url = serve_chunked_response(
            "401 Unauthorized",
            "text/plain",
            vec![
                b"bad key sk-test-secret ".to_vec(),
                vec![b'x'; PROVIDER_RESPONSE_MAX_BYTES + 1024],
            ],
        )
        .await;
        let response = response_from_url(url).await;
        let error_body = read_error_response_details(response)
            .await
            .expect("chunked provider error details should read bounded diagnostic");
        let error = provider_http_error(reqwest::StatusCode::UNAUTHORIZED, error_body);

        assert_eq!(error.code, "llm_provider_error");
        assert!(error
            .message
            .contains("Provider returned HTTP 401 Unauthorized"));
        assert!(error.message.contains("[REDACTED]"));
        assert!(!error.message.contains("sk-test-secret"));
        assert!(!error.message.contains("exceeds"));
        assert!(error.message.len() < 700);
    }

    #[test]
    fn google_top_k_zero_is_not_sent() {
        let mut request = request_for("google", "gemini-2.5-flash", json!({ "topK": 0 }));
        assert!(should_send_top_k(&request));
        assert!(param_i64(&request.parameters, &["topK", "top_k"])
            .filter(|value| *value > 0)
            .is_none());
        request.parameters = json!({ "topK": 40 });
        assert_eq!(
            param_i64(&request.parameters, &["topK", "top_k"]).filter(|value| *value > 0),
            Some(40)
        );
    }

    #[test]
    fn gemini_3_thinking_config_sends_thinking_only_shape() {
        let config = google_thinking_config(
            "gemini-3-pro",
            &json!({ "reasoningEffort": "medium" }),
            4096,
        )
        .expect("Gemini 3 reasoning effort should create thinking config");
        assert_eq!(config["thinkingLevel"], json!("medium"));
        assert_eq!(config["includeThoughts"], json!(true));

        let flash_config = google_thinking_config(
            "gemini-3.5-flash",
            &json!({ "reasoningEffort": "minimal" }),
            4096,
        )
        .expect("Gemini 3.5 Flash minimal effort should create thinking config");
        assert_eq!(flash_config["thinkingLevel"], json!("minimal"));

        let pro_config = google_thinking_config(
            "gemini-3.1-pro-preview",
            &json!({ "reasoningEffort": "minimal" }),
            4096,
        )
        .expect("Gemini 3.1 Pro should clamp minimal effort to a supported level");
        assert_eq!(pro_config["thinkingLevel"], json!("low"));
    }

    #[test]
    fn gemini_25_thinking_budget_is_capped_by_visible_output_tokens() {
        let config = google_thinking_config(
            "gemini-2.5-flash",
            &json!({ "reasoningEffort": "high" }),
            4096,
        )
        .expect("Gemini 2.5 reasoning effort should create thinking config");

        assert_eq!(config["thinkingBudget"], json!(2048));
        assert_eq!(config["includeThoughts"], json!(true));
    }

    #[test]
    fn gemini_25_thinking_budget_keeps_reasoning_for_low_output_caps() {
        let pro_minimal = google_thinking_config(
            "gemini-2.5-pro",
            &json!({ "reasoningEffort": "minimal" }),
            512,
        )
        .expect("Gemini 2.5 Pro minimal effort should create thinking config");
        assert_eq!(pro_minimal["thinkingBudget"], json!(128));

        let high = google_thinking_config(
            "gemini-2.5-flash",
            &json!({ "reasoningEffort": "high" }),
            512,
        )
        .expect("Gemini 2.5 high effort should retain a nonzero thinking budget");
        assert_eq!(high["thinkingBudget"], json!(256));
    }

    #[test]
    fn gemini_35_flash_uses_gemini_3_rules() {
        assert!(is_gemini_3_model("gemini-3.5-flash"));
        assert!(is_gemini_3_model("google/gemini-3.5-flash"));
    }

    #[test]
    fn google_gemini_3_generation_config_keeps_max_tokens_and_strips_sampling() {
        let request = request_for(
            "google",
            "gemini-3.5-flash",
            json!({
                "maxTokens": 4096,
                "reasoningEffort": "high",
                "temperature": 0.8,
                "topP": 0.9,
                "topK": 40,
                "frequencyPenalty": 0.2,
                "presencePenalty": 0.3,
                "stop": ["</END>"],
                "customParameters": {
                    "generationConfig": {
                        "candidateCount": 2,
                        "topP": 0.4,
                        "responseMimeType": "application/json"
                    },
                    "safetySettings": [
                        {
                            "category": "HARM_CATEGORY_HARASSMENT",
                            "threshold": "BLOCK_ONLY_HIGH"
                        }
                    ]
                }
            }),
        );
        let body = google_generate_body(&request);
        let config = &body["generationConfig"];

        assert_eq!(config["maxOutputTokens"], json!(4096));
        assert_eq!(config["thinkingConfig"]["thinkingLevel"], json!("high"));
        assert_eq!(config["thinkingConfig"]["includeThoughts"], json!(true));
        assert!(config.get("temperature").is_none());
        assert!(config.get("topP").is_none());
        assert!(config.get("topK").is_none());
        assert!(config.get("candidateCount").is_none());
        assert_eq!(config["frequencyPenalty"], json!(0.2));
        assert_eq!(config["presencePenalty"], json!(0.3));
        assert_eq!(config["stopSequences"], json!(["</END>"]));
        assert_eq!(config["responseMimeType"], json!("application/json"));
        assert_eq!(
            body["safetySettings"][0]["category"],
            json!("HARM_CATEGORY_HARASSMENT")
        );
    }

    #[test]
    fn openai_responses_body_strips_sampling_for_restricted_models() {
        let request = request_for(
            "openai",
            "anthropic/claude-opus-4-7",
            json!({
                "reasoningEffort": "high",
                "temperature": 0.8,
                "topP": 0.9,
                "customParameters": {
                    "temperature": 0.4,
                    "top_p": 0.5
                }
            }),
        );

        let body = build_openai_responses_body(&request, false);

        assert!(body.get("temperature").is_none());
        assert!(body.get("top_p").is_none());
        assert_eq!(body["reasoning"]["effort"], json!("high"));
    }

    #[test]
    fn openai_responses_body_keeps_temperature_for_supported_models() {
        let request = request_for(
            "openai",
            "gpt-4o",
            json!({
                "temperature": 0.8,
                "topP": 0.9
            }),
        );

        let body = build_openai_responses_body(&request, false);

        assert_eq!(body["temperature"], json!(0.8));
        assert_eq!(body["top_p"], json!(0.9));
    }

    #[test]
    fn google_candidate_text_preserves_all_visible_parts() {
        let candidate = json!({
            "content": {
                "parts": [
                    { "text": "visible " },
                    { "text": "private thought", "thought": true },
                    { "text": "answer" }
                ]
            }
        });

        assert_eq!(
            google_candidate_text(&candidate).as_deref(),
            Some("visible answer")
        );
    }

    #[test]
    fn google_stream_sse_emits_thinking_tokens_and_usage() {
        let mut emitted = Vec::new();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_google_sse_block(
            r#"data: {"candidates":[{"content":{"parts":[{"text":"pondering","thought":true},{"text":"hello"}]}}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2,"totalTokenCount":3}}"#,
            &mut emit,
        )
        .expect("Gemini stream block should parse");

        assert_eq!(emitted[0]["type"], json!("usage"));
        assert_eq!(
            emitted[1],
            json!({ "type": "thinking", "text": "pondering", "data": "pondering" })
        );
        assert_eq!(
            emitted[2],
            json!({ "type": "token", "text": "hello", "data": "hello" })
        );
        assert_eq!(status, SseBlockStatus::Continue);
    }

    #[test]
    fn google_stream_finish_reason_is_terminal_after_tokens() {
        let mut emitted = Vec::new();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_google_sse_block(
            r#"data: {"candidates":[{"content":{"parts":[{"text":"hello"}]},"finishReason":"STOP"}]}"#,
            &mut emit,
        )
        .expect("Gemini terminal block should parse");

        assert_eq!(status, SseBlockStatus::Complete);
        assert_eq!(
            emitted[0],
            json!({ "type": "token", "text": "hello", "data": "hello" })
        );
    }

    #[test]
    fn google_stream_finish_reason_is_terminal_without_parts() {
        let mut emitted = Vec::new();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_google_sse_block(
            r#"data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"totalTokenCount":3}}"#,
            &mut emit,
        )
        .expect("Gemini terminal metadata block should parse");

        assert_eq!(status, SseBlockStatus::Complete);
        assert_eq!(
            emitted[0],
            json!({ "type": "usage", "data": { "totalTokenCount": 3 } })
        );
    }

    #[test]
    fn google_stream_max_tokens_finish_reason_is_terminal_after_tokens() {
        let mut emitted = Vec::new();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_google_sse_block(
            r#"data: {"candidates":[{"content":{"parts":[{"text":"Above the Skyport, the great brass heating lens lets out a wet,"}]},"finishReason":"MAX_TOKENS"}]}"#,
            &mut emit,
        )
        .expect("Gemini MAX_TOKENS finish reason should complete after delivered text");

        assert_eq!(status, SseBlockStatus::Complete);
        assert_eq!(
            emitted[0],
            json!({ "type": "token", "text": "Above the Skyport, the great brass heating lens lets out a wet,", "data": "Above the Skyport, the great brass heating lens lets out a wet," })
        );
    }

    #[test]
    fn google_stream_requires_terminal_event() {
        let error = ensure_google_stream_completed(false)
            .expect_err("abrupt Gemini stream close should fail");

        assert_eq!(error.code, "llm_stream_incomplete");
        assert!(error
            .message
            .contains("ended before Gemini sent a finish reason"));
    }

    #[test]
    fn sse_stream_buffer_cap_rejects_boundaryless_stream() {
        let at_limit = "x".repeat(PROVIDER_RESPONSE_MAX_BYTES);
        assert!(ensure_sse_buffer_within_limit(&at_limit).is_ok());

        let over_limit = "x".repeat(PROVIDER_RESPONSE_MAX_BYTES + 1);
        let error = ensure_sse_buffer_within_limit(&over_limit)
            .expect_err("un-terminated SSE buffer over the cap should abort the stream");
        assert_eq!(error.code, "llm_stream_error");
    }

    #[test]
    fn sse_block_splitter_handles_lf_and_crlf_boundaries() {
        let mut buffer = "data: {\"a\":1}\r\n\r\ndata: {\"b\":2}\n\npartial".to_string();

        assert_eq!(
            take_sse_block(&mut buffer),
            Some("data: {\"a\":1}".to_string())
        );
        assert_eq!(
            take_sse_block(&mut buffer),
            Some("data: {\"b\":2}".to_string())
        );
        assert_eq!(take_sse_block(&mut buffer), None);
        assert_eq!(buffer, "partial");
    }

    #[test]
    fn openrouter_claude_opus_adaptive_model_strips_sampling_parameters() {
        let request = request_for(
            "openrouter",
            "anthropic/claude-opus-4-7",
            json!({
                "temperature": 0.8,
                "topP": 0.9,
                "topK": 40,
                "frequencyPenalty": 0.2,
                "presencePenalty": 0.3,
                "customParameters": { "top_p": 0.5, "temperature": 0.4 }
            }),
        );
        let mut body = json!({});
        apply_openai_parameters(&mut body, &request);

        assert!(!should_send_temperature(&request));
        assert!(body.get("top_p").is_none());
        assert!(body.get("top_k").is_none());
        assert!(body.get("frequency_penalty").is_none());
        assert!(body.get("presence_penalty").is_none());
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn anthropic_adaptive_thinking_model_detection_matches_main_branch_rules() {
        assert!(supports_anthropic_adaptive_thinking("claude-fable-5"));
        assert!(supports_anthropic_adaptive_thinking(
            "anthropic/claude-fable-5"
        ));
        assert!(supports_anthropic_adaptive_thinking("claude-opus-4-8"));
        assert!(supports_anthropic_adaptive_thinking("claude-opus-4-7"));
        assert!(supports_anthropic_adaptive_thinking("claude-opus-4-6"));
        assert!(supports_anthropic_adaptive_thinking("claude-opus-5-6"));
        assert!(supports_anthropic_adaptive_thinking("claude-sonnet-4-6"));
        assert!(is_anthropic_sampling_restricted_model(
            "anthropic/claude-fable-5"
        ));
        assert!(!supports_anthropic_adaptive_thinking("claude-sonnet-4-5"));
        assert!(!supports_anthropic_adaptive_thinking(
            "claude-opus-4-20250514"
        ));
    }

    #[test]
    fn anthropic_fable_5_body_uses_adaptive_thinking_and_strips_sampling() {
        let request = request_for(
            "anthropic",
            "claude-fable-5",
            json!({
                "maxTokens": 4096,
                "reasoningEffort": "xhigh",
                "temperature": 0.8,
                "topP": 0.9,
                "topK": 40
            }),
        );
        let body = build_anthropic_body(&request, false);

        assert_eq!(body["model"], json!("claude-fable-5"));
        assert_eq!(body["max_tokens"], json!(4096));
        assert_eq!(
            body["thinking"],
            json!({ "type": "adaptive", "display": "summarized" })
        );
        assert_eq!(body["output_config"]["effort"], json!("xhigh"));
        assert!(body.get("temperature").is_none());
        assert!(body.get("top_p").is_none());
        assert!(body.get("top_k").is_none());
    }

    #[test]
    fn anthropic_adaptive_thinking_respects_max_tokens_override() {
        let mut request = request_for(
            "anthropic",
            "claude-fable-5",
            json!({
                "maxTokens": 64000,
                "reasoningEffort": "maximum"
            }),
        );
        request.connection.max_tokens_override = Some(4096);
        let body = build_anthropic_body(&request, false);

        assert_eq!(body["max_tokens"], json!(4096));
        assert_eq!(
            body["thinking"],
            json!({ "type": "adaptive", "display": "summarized" })
        );
    }

    #[test]
    fn anthropic_opus_48_body_uses_adaptive_maximum_and_strips_sampling() {
        let request = request_for(
            "anthropic",
            "claude-opus-4-8",
            json!({
                "maxTokens": 64000,
                "reasoningEffort": "maximum",
                "temperature": 0.8,
                "topP": 0.9,
                "topK": 40,
                "showThoughts": true
            }),
        );
        let body = build_anthropic_body(&request, false);

        assert_eq!(body["model"], json!("claude-opus-4-8"));
        assert_eq!(body["max_tokens"], json!(64000));
        assert_eq!(
            body["thinking"],
            json!({ "type": "adaptive", "display": "summarized" })
        );
        assert_eq!(body["output_config"]["effort"], json!("max"));
        assert!(body.get("temperature").is_none());
        assert!(body.get("top_p").is_none());
        assert!(body.get("top_k").is_none());
    }

    #[test]
    fn anthropic_opus_48_body_requests_adaptive_thinking_without_effort() {
        let request = request_for(
            "anthropic",
            "claude-opus-4-8",
            json!({
                "maxTokens": 16000
            }),
        );
        let body = build_anthropic_body(&request, false);

        assert_eq!(body["max_tokens"], json!(16000));
        assert_eq!(
            body["thinking"],
            json!({ "type": "adaptive", "display": "summarized" })
        );
        assert!(body.get("output_config").is_none());
    }

    #[test]
    fn anthropic_opus_48_body_ignores_stale_show_thoughts_false() {
        let request = request_for(
            "anthropic",
            "claude-opus-4-8",
            json!({
                "maxTokens": 16000,
                "showThoughts": false
            }),
        );
        let body = build_anthropic_body(&request, false);

        assert_eq!(body["max_tokens"], json!(16000));
        assert_eq!(
            body["thinking"],
            json!({ "type": "adaptive", "display": "summarized" })
        );
        assert!(body.get("output_config").is_none());
    }

    #[test]
    fn anthropic_opus_48_stream_body_sets_stream_true() {
        let request = request_for(
            "anthropic",
            "claude-opus-4-8",
            json!({
                "reasoningEffort": "xhigh",
                "showThoughts": false
            }),
        );
        let body = build_anthropic_body(&request, true);

        assert_eq!(body["stream"], json!(true));
        assert_eq!(body["max_tokens"], json!(1024));
        assert_eq!(
            body["thinking"],
            json!({ "type": "adaptive", "display": "summarized" })
        );
        assert_eq!(body["output_config"]["effort"], json!("xhigh"));
    }

    #[test]
    fn anthropic_opus_48_stream_body_requests_summarized_thinking_by_default() {
        let request = request_for(
            "anthropic",
            "claude-opus-4-8",
            json!({
                "reasoningEffort": "high"
            }),
        );
        let body = build_anthropic_body(&request, true);

        assert_eq!(
            body["thinking"],
            json!({ "type": "adaptive", "display": "summarized" })
        );
    }

    #[test]
    fn anthropic_text_content_preserves_multiple_text_blocks() {
        let items = vec![
            json!({ "type": "thinking", "thinking": "hidden" }),
            json!({ "type": "text", "text": "First paragraph." }),
            json!({ "type": "redacted_thinking" }),
            json!({ "type": "text", "text": "Second paragraph." }),
        ];

        assert_eq!(
            anthropic_text_content(&items).as_deref(),
            Some("First paragraph.\n\nSecond paragraph.")
        );
    }

    #[test]
    fn anthropic_stream_sse_emits_usage_thinking_and_text_tokens() {
        let mut emitted = Vec::new();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        process_anthropic_sse_block(
            r#"event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":0}}}"#,
            &mut emit,
        )
        .expect("message_start should parse");
        process_anthropic_sse_block(
            r#"event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"pondering"}}"#,
            &mut emit,
        )
        .expect("thinking delta should parse");
        let status = process_anthropic_sse_block(
            r#"event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"hello"}}"#,
            &mut emit,
        )
        .expect("text delta should parse");

        assert_eq!(emitted[0]["type"], json!("usage"));
        assert_eq!(
            emitted[1],
            json!({ "type": "thinking", "text": "pondering", "data": "pondering" })
        );
        assert_eq!(
            emitted[2],
            json!({ "type": "token", "text": "hello", "data": "hello" })
        );
        assert_eq!(status, SseBlockStatus::Continue);
    }

    #[test]
    fn anthropic_stream_message_stop_is_terminal() {
        let mut emitted = Vec::new();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        let status = process_anthropic_sse_block(
            r#"event: message_stop
data: {"type":"message_stop"}"#,
            &mut emit,
        )
        .expect("message_stop should parse");

        assert_eq!(status, SseBlockStatus::Complete);
        assert!(emitted.is_empty());
    }

    #[test]
    fn anthropic_stream_sse_emits_summarized_thinking_shape() {
        let mut emitted = Vec::new();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        process_anthropic_sse_block(
            r#"event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}"#,
            &mut emit,
        )
        .expect("empty thinking block start should parse");
        process_anthropic_sse_block(
            r#"event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"summary chunk"}}"#,
            &mut emit,
        )
        .expect("summarized thinking delta should parse");
        process_anthropic_sse_block(
            r#"event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"opaque"}}"#,
            &mut emit,
        )
        .expect("signature delta should parse");
        process_anthropic_sse_block(
            r#"event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}"#,
            &mut emit,
        )
        .expect("text delta should parse");

        assert_eq!(emitted.len(), 2);
        assert_eq!(
            emitted[0],
            json!({ "type": "thinking", "text": "summary chunk", "data": "summary chunk" })
        );
        assert_eq!(
            emitted[1],
            json!({ "type": "token", "text": "answer", "data": "answer" })
        );
    }

    #[test]
    fn anthropic_stream_sse_emits_thinking_when_delta_text_shape_varies() {
        let mut emitted = Vec::new();
        let mut emit = |value: Value| {
            emitted.push(value);
            Ok(())
        };

        process_anthropic_sse_block(
            r#"event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","text":"summary fallback"}}"#,
            &mut emit,
        )
        .expect("thinking delta text fallback should parse");
        process_anthropic_sse_block(
            r#"event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"thinking":"summary without type"}}"#,
            &mut emit,
        )
        .expect("thinking field without delta type should parse");

        assert_eq!(
            emitted,
            vec![
                json!({ "type": "thinking", "text": "summary fallback", "data": "summary fallback" }),
                json!({ "type": "thinking", "text": "summary without type", "data": "summary without type" })
            ]
        );
    }

    #[test]
    fn claude_subscription_without_runtime_chat_uses_transcript_fold() {
        let request = LlmRequest {
            connection: test_connection(),
            messages: vec![
                LlmMessage {
                    role: "system".to_string(),
                    content: "Rules.".to_string(),
                    name: None,
                    images: Vec::new(),
                    tool_call_id: None,
                    tool_calls: None,
                    provider_metadata: None,
                },
                LlmMessage {
                    role: "user".to_string(),
                    content: "Hello.".to_string(),
                    name: None,
                    images: Vec::new(),
                    tool_call_id: None,
                    tool_calls: None,
                    provider_metadata: None,
                },
            ],
            parameters: json!({}),
            tools: Vec::new(),
        };
        let prompt = claude_subscription_prompt(&request).expect("prompt should be supported");
        assert_eq!(prompt.system_prompt.as_deref(), Some("Rules."));
        assert_eq!(prompt.prompt, "User: Hello.");
        assert_eq!(prompt.session_id, None);
        assert_eq!(prompt.prompt_shape, "transcript-fold");
    }

    #[test]
    fn claude_subscription_runtime_chat_uses_stable_session_prompt() {
        let request = LlmRequest {
            connection: test_connection(),
            messages: vec![
                LlmMessage {
                    role: "system".to_string(),
                    content: "Rules.".to_string(),
                    name: None,
                    images: Vec::new(),
                    tool_call_id: None,
                    tool_calls: None,
                    provider_metadata: None,
                },
                LlmMessage {
                    role: "assistant".to_string(),
                    content: "Earlier reply.".to_string(),
                    name: None,
                    images: Vec::new(),
                    tool_call_id: None,
                    tool_calls: None,
                    provider_metadata: None,
                },
                LlmMessage {
                    role: "user".to_string(),
                    content: "Next turn.".to_string(),
                    name: None,
                    images: Vec::new(),
                    tool_call_id: None,
                    tool_calls: None,
                    provider_metadata: None,
                },
            ],
            parameters: json!({ "_marinara": { "chatId": "chat-1", "mode": "roleplay" } }),
            tools: Vec::new(),
        };
        let prompt = claude_subscription_prompt(&request).expect("prompt should be supported");
        assert_eq!(prompt.system_prompt.as_deref(), Some("Rules."));
        assert!(prompt
            .prompt
            .contains("Previous Marinara conversation:\nAssistant: Earlier reply."));
        assert!(prompt.prompt.contains("Current turn:\nUser: Next turn."));
        assert_eq!(prompt.prompt_shape, "trailing-user");
        let expected_session_id = claude_subscription_session_id("chat-1");
        assert_eq!(
            prompt.session_id.as_deref(),
            Some(expected_session_id.as_str())
        );
        assert!(Uuid::parse_str(prompt.session_id.as_deref().unwrap()).is_ok());
    }

    #[test]
    fn claude_subscription_regeneration_uses_transcript_fold() {
        let request = LlmRequest {
            connection: test_connection(),
            messages: vec![LlmMessage {
                role: "user".to_string(),
                content: "Regenerate from here.".to_string(),
                name: None,
                images: Vec::new(),
                tool_call_id: None,
                tool_calls: None,
                provider_metadata: None,
            }],
            parameters: json!({
                "_marinara": {
                    "chatId": "chat-1",
                    "regenerateMessageId": "message-1"
                }
            }),
            tools: Vec::new(),
        };
        let prompt = claude_subscription_prompt(&request).expect("prompt should be supported");
        assert_eq!(prompt.prompt, "User: Regenerate from here.");
        assert_eq!(prompt.session_id, None);
        assert_eq!(prompt.prompt_shape, "transcript-fold");
    }

    #[test]
    fn claude_subscription_transcript_rejects_image_turns() {
        let mut image_only = test_message("user", "");
        image_only.images = vec!["data:image/png;base64,abc".to_string()];
        let request = LlmRequest {
            connection: test_connection(),
            messages: vec![image_only],
            parameters: json!({
                "_marinara": {
                    "chatId": "chat-1",
                    "regenerateMessageId": "message-1"
                }
            }),
            tools: Vec::new(),
        };

        let error = claude_subscription_prompt(&request)
            .expect_err("Claude subscription should reject unsupported image attachments");

        assert_eq!(error.code, "claude_subscription_unsupported_capability");
        assert!(error.message.contains("1 image attachment(s)"));
        assert_eq!(
            error.details.as_ref().unwrap()["capability"],
            "image_attachments"
        );
        assert_eq!(error.details.as_ref().unwrap()["imageAttachmentCount"], 1);
    }

    #[test]
    fn claude_subscription_runtime_chat_rejects_image_current_turn() {
        let mut image_only = test_message("user", "");
        image_only.images = vec!["data:image/png;base64,abc".to_string()];
        let request = LlmRequest {
            connection: test_connection(),
            messages: vec![test_message("assistant", "Earlier reply."), image_only],
            parameters: json!({ "_marinara": { "chatId": "chat-1", "mode": "roleplay" } }),
            tools: Vec::new(),
        };

        let error = claude_subscription_prompt(&request)
            .expect_err("Claude subscription should reject unsupported current-turn images");

        assert_eq!(error.code, "claude_subscription_unsupported_capability");
        assert!(error.message.contains("1 image attachment(s)"));
    }

    #[test]
    fn claude_subscription_scratch_cwd_failure_is_explicit() {
        let base = env::temp_dir().join(format!(
            "de-koi-claude-subscription-file-{}",
            Uuid::new_v4()
        ));
        fs::write(&base, b"not a directory").expect("scratch blocker file should be writable");

        let error = claude_subscription_scratch_cwd_in(&base)
            .expect_err("file parent should block scratch directory creation");
        let _ = fs::remove_file(&base);

        assert_eq!(error.code, "claude_subscription_session_error");
        assert!(error
            .message
            .contains("scratch directory could not be created"));
    }

    #[test]
    fn claude_subscription_impersonation_uses_transcript_fold() {
        let request = LlmRequest {
            connection: test_connection(),
            messages: vec![
                LlmMessage {
                    role: "assistant".to_string(),
                    content: "Existing reply.".to_string(),
                    name: None,
                    images: Vec::new(),
                    tool_call_id: None,
                    tool_calls: None,
                    provider_metadata: None,
                },
                LlmMessage {
                    role: "user".to_string(),
                    content: "Impersonated turn.".to_string(),
                    name: None,
                    images: Vec::new(),
                    tool_call_id: None,
                    tool_calls: None,
                    provider_metadata: None,
                },
            ],
            parameters: json!({
                "_marinara": {
                    "chatId": "chat-1",
                    "impersonate": true
                }
            }),
            tools: Vec::new(),
        };
        let prompt = claude_subscription_prompt(&request).expect("prompt should be supported");
        assert!(prompt.prompt.contains("Assistant: Existing reply."));
        assert!(prompt.prompt.contains("User: Impersonated turn."));
        assert_eq!(prompt.session_id, None);
        assert_eq!(prompt.prompt_shape, "transcript-fold");
    }

    #[test]
    fn claude_subscription_1m_suffix_maps_to_beta_arg_and_base_model() {
        let selection = claude_subscription_model_selection("claude-opus-4-8[1m]");

        assert_eq!(selection.configured_model, "claude-opus-4-8[1m]");
        assert_eq!(selection.cli_model, "claude-opus-4-8");
        assert!(selection.long_context_beta);
        assert_eq!(
            claude_subscription_model_args(&selection),
            vec![
                "--model".to_string(),
                "claude-opus-4-8".to_string(),
                "--betas".to_string(),
                "context-1m-2025-08-07".to_string(),
            ]
        );
    }

    #[test]
    fn claude_subscription_plain_model_does_not_add_beta_arg() {
        let selection = claude_subscription_model_selection("claude-sonnet-4-6");

        assert_eq!(selection.cli_model, "claude-sonnet-4-6");
        assert!(!selection.long_context_beta);
        assert_eq!(
            claude_subscription_model_args(&selection),
            vec!["--model".to_string(), "claude-sonnet-4-6".to_string()]
        );
    }

    #[test]
    fn claude_subscription_empty_json_result_is_an_error() {
        let error = parse_claude_subscription_output_rich(
            r#"{"type":"result","subtype":"success","result":"","usage":{"input_tokens":10,"output_tokens":0},"fast_mode_state":"off","modelUsage":{"claude-sonnet-4-5":{}}}"#,
            "claude-sonnet-4-5",
        )
        .expect_err("empty result JSON should fail");
        assert_eq!(error.code, "claude_subscription_empty");
        assert!(error.message.contains("output_tokens=0"));
        assert!(error.details.is_some());
    }
}
