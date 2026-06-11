use super::images::percent_encode_component;
use super::llm::llm_connection_from_value;
use super::shared::*;
use super::*;
use std::net::SocketAddr;

const TRANSLATION_TEXT_MAX_CHARS: usize = 50_000;
const DEEPLX_LOCAL_URLS_ENABLED_FLAG: &str = "DEEPLX_LOCAL_URLS_ENABLED";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TranslationProvider {
    Ai,
    DeepLx,
    DeepL,
    Google,
}

impl TranslationProvider {
    fn parse(raw: &str) -> AppResult<Self> {
        match raw.trim() {
            "ai" => Ok(Self::Ai),
            "deeplx" => Ok(Self::DeepLx),
            "deepl" => Ok(Self::DeepL),
            "google" => Ok(Self::Google),
            other => Err(AppError::invalid_input(format!(
                "Unsupported translation provider: {other}. Expected ai, deeplx, deepl, or google."
            ))),
        }
    }
}

#[derive(Debug)]
struct TranslationRequest<'a> {
    text: &'a str,
    provider: TranslationProvider,
    target_language: &'a str,
}

pub(crate) async fn translate_text(state: &AppState, body: Value) -> AppResult<Value> {
    let request = translation_request_from_body(&body)?;
    let translated = match request.provider {
        TranslationProvider::Ai => {
            translate_with_ai(state, request.text, request.target_language, &body).await?
        }
        TranslationProvider::DeepLx => {
            translate_with_deeplx(request.text, request.target_language, &body).await?
        }
        TranslationProvider::DeepL => {
            translate_with_deepl(request.text, request.target_language, &body).await?
        }
        TranslationProvider::Google => {
            translate_with_google(request.text, request.target_language).await?
        }
    };
    Ok(json!({ "translatedText": translated }))
}

fn translation_request_from_body(body: &Value) -> AppResult<TranslationRequest<'_>> {
    let text = required_string(body, "text")?;
    if text.chars().count() > TRANSLATION_TEXT_MAX_CHARS {
        return Err(AppError::invalid_input(format!(
            "text must be {TRANSLATION_TEXT_MAX_CHARS} characters or fewer"
        )));
    }

    let provider = TranslationProvider::parse(required_string(body, "provider")?)?;
    let target_language = required_string(body, "targetLanguage")?.trim();

    Ok(TranslationRequest {
        text,
        provider,
        target_language,
    })
}

async fn translate_with_ai(
    state: &AppState,
    text: &str,
    target_language: &str,
    body: &Value,
) -> AppResult<String> {
    let connection_id = required_string(body, "connectionId")?;
    let connection = connection_secrets::connection_for_runtime(state, connection_id)?;
    let request = marinara_llm::LlmRequest {
        connection: llm_connection_from_value(&connection)?,
        messages: vec![
            marinara_llm::LlmMessage {
                role: "system".to_string(),
                content: "You are a translator. Translate accurately, preserving markdown, formatting, names, and action asterisks. Output only the translated text.".to_string(),
                name: None,
                images: Vec::new(),
                tool_call_id: None,
                tool_calls: None,
                provider_metadata: None,
            },
            marinara_llm::LlmMessage {
                role: "user".to_string(),
                content: format!("Translate the following text to {target_language}:\n\n{text}"),
                name: None,
                images: Vec::new(),
                tool_call_id: None,
                tool_calls: None,
                provider_metadata: None,
            },
        ],
        parameters: json!({ "temperature": 0.3 }),
        tools: Vec::new(),
    };
    marinara_llm::complete(request)
        .await
        .map(|value| value.trim().to_string())
}

async fn translate_with_deeplx(
    text: &str,
    target_language: &str,
    body: &Value,
) -> AppResult<String> {
    let endpoint = validated_deeplx_endpoint(
        body,
        provider_local_urls_enabled(DEEPLX_LOCAL_URLS_ENABLED_FLAG),
    )
    .await?;
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none());
    if let (Some(host), Some(addresses)) = (
        endpoint.url.host_str(),
        endpoint.resolved_addresses.as_deref(),
    ) {
        client_builder = client_builder.resolve_to_addrs(host, addresses);
    }
    let response = client_builder
        .build()
        .map_err(|error| AppError::new("translation_client_error", error.to_string()))?
        .post(endpoint.url)
        .json(&json!({
            "text": text,
            "source_lang": "auto",
            "target_lang": target_language.to_ascii_uppercase()
        }))
        .send()
        .await
        .map_err(|error| AppError::new("translation_failed", error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "translation_failed",
            format!("DeepLX returned {}", response.status()),
        ));
    }
    let data = response
        .json::<Value>()
        .await
        .map_err(|error| AppError::new("translation_failed", error.to_string()))?;
    Ok(data
        .get("data")
        .or_else(|| {
            data.get("alternatives")
                .and_then(|value| value.as_array())
                .and_then(|items| items.first())
        })
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

#[derive(Debug)]
struct ValidatedDeepLxEndpoint {
    url: reqwest::Url,
    resolved_addresses: Option<Vec<SocketAddr>>,
}

async fn validated_deeplx_endpoint(
    body: &Value,
    allow_local_urls: bool,
) -> AppResult<ValidatedDeepLxEndpoint> {
    let url = deeplx_translate_endpoint_url(required_string(body, "deeplxUrl")?)?;
    if !marinara_security::is_allowed_outbound_url(url.as_str(), allow_local_urls) {
        return Err(deeplx_url_not_allowed_error(url.as_str()));
    }
    let resolved_addresses = validate_deeplx_url_resolution(&url, allow_local_urls).await?;

    Ok(ValidatedDeepLxEndpoint {
        url,
        resolved_addresses,
    })
}

async fn validate_deeplx_url_resolution(
    url: &reqwest::Url,
    allow_local_urls: bool,
) -> AppResult<Option<Vec<SocketAddr>>> {
    if allow_local_urls {
        return Ok(None);
    }
    let Some(host) = url.host_str() else {
        return Err(deeplx_url_not_allowed_error(url.as_str()));
    };
    if let Some(address) = deeplx_host_ip(host) {
        if marinara_security::is_local_or_reserved_ip(address) {
            return Err(deeplx_url_not_allowed_error(url.as_str()));
        }
        return Ok(None);
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| {
            AppError::invalid_input(format!(
                "DeepLX URL host '{}' did not resolve: {}",
                marinara_security::redact_sensitive_text(host),
                marinara_security::redact_sensitive_text(&error.to_string())
            ))
        })?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(AppError::invalid_input(format!(
            "DeepLX URL host '{}' did not resolve",
            marinara_security::redact_sensitive_text(host)
        )));
    }
    if addresses
        .iter()
        .any(|address| marinara_security::is_local_or_reserved_ip(address.ip()))
    {
        return Err(deeplx_url_not_allowed_error(url.as_str()));
    }
    Ok(Some(addresses))
}

fn deeplx_host_ip(host: &str) -> Option<std::net::IpAddr> {
    host.strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host)
        .parse::<std::net::IpAddr>()
        .ok()
}

fn deeplx_url_not_allowed_error(url: &str) -> AppError {
    AppError::invalid_input(format!(
        "DeepLX URL points to a local, private, metadata, or reserved target: {}. Set {DEEPLX_LOCAL_URLS_ENABLED_FLAG}=true only if you trust that DeepLX target.",
        marinara_security::redact_sensitive_text(url)
    ))
}

fn deeplx_translate_endpoint_url(raw_base_url: &str) -> AppResult<reqwest::Url> {
    let mut url = reqwest::Url::parse(raw_base_url.trim()).map_err(|error| {
        AppError::invalid_input(format!(
            "DeepLX URL is invalid: {}",
            marinara_security::redact_sensitive_text(&error.to_string())
        ))
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::invalid_input("DeepLX URL must use http or https"));
    }
    if url.host_str().is_none() {
        return Err(AppError::invalid_input(
            "DeepLX URL must include a hostname",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::invalid_input(
            "DeepLX URL must be a base URL without query string or fragment",
        ));
    }
    url.path_segments_mut()
        .map_err(|_| AppError::invalid_input("DeepLX URL cannot be used as a base URL"))?
        .pop_if_empty()
        .push("translate");
    Ok(url)
}

async fn translate_with_deepl(
    text: &str,
    target_language: &str,
    body: &Value,
) -> AppResult<String> {
    let api_key = required_string(body, "deeplApiKey")?;
    let endpoint = if api_key.ends_with(":fx") {
        "https://api-free.deepl.com/v2/translate"
    } else {
        "https://api.deepl.com/v2/translate"
    };
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| AppError::new("translation_client_error", error.to_string()))?
        .post(endpoint)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("DeepL-Auth-Key {api_key}"),
        )
        .json(&json!({
            "text": [text],
            "target_lang": target_language.to_ascii_uppercase()
        }))
        .send()
        .await
        .map_err(|error| AppError::new("translation_failed", error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "translation_failed",
            format!("DeepL returned {}", response.status()),
        ));
    }
    let data = response
        .json::<Value>()
        .await
        .map_err(|error| AppError::new("translation_failed", error.to_string()))?;
    Ok(data
        .get("translations")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

async fn translate_with_google(text: &str, target_language: &str) -> AppResult<String> {
    if text.len() > 5000 {
        return Err(AppError::invalid_input(
            "Text too long for Google Translate. Use DeepL or AI translation for longer text.",
        ));
    }
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={}&dt=t&q={}",
        percent_encode_component(target_language),
        percent_encode_component(text)
    );
    let data = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| AppError::new("translation_client_error", error.to_string()))?
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::new("translation_failed", error.to_string()))?;
    if !data.status().is_success() {
        return Err(AppError::new(
            "translation_failed",
            format!("Google Translate returned {}", data.status()),
        ));
    }
    let data = data
        .json::<Value>()
        .await
        .map_err(|error| AppError::new("translation_failed", error.to_string()))?;
    let mut translated = String::new();
    if let Some(segments) = data.get(0).and_then(Value::as_array) {
        for segment in segments {
            if let Some(text) = segment.get(0).and_then(Value::as_str) {
                translated.push_str(text);
            }
        }
    }
    Ok(translated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translation_contract_rejects_missing_provider() {
        let error = translation_request_from_body(&json!({
            "text": "hello",
            "targetLanguage": "fr"
        }))
        .expect_err("missing provider should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("provider is required"));
    }

    #[test]
    fn translation_contract_rejects_unknown_provider_without_google_fallback() {
        let error = translation_request_from_body(&json!({
            "text": "hello",
            "provider": "bing",
            "targetLanguage": "fr"
        }))
        .expect_err("unknown provider should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error
            .message
            .contains("Unsupported translation provider: bing"));
    }

    #[test]
    fn translation_contract_rejects_blank_target_language() {
        let error = translation_request_from_body(&json!({
            "text": "hello",
            "provider": "google",
            "targetLanguage": "   "
        }))
        .expect_err("blank target language should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("targetLanguage is required"));
    }

    #[test]
    fn translation_contract_rejects_text_over_legacy_cap() {
        let error = translation_request_from_body(&json!({
            "text": "x".repeat(TRANSLATION_TEXT_MAX_CHARS + 1),
            "provider": "google",
            "targetLanguage": "fr"
        }))
        .expect_err("overlong text should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error
            .message
            .contains(&TRANSLATION_TEXT_MAX_CHARS.to_string()));
    }

    #[test]
    fn deeplx_endpoint_appends_translate_path_to_base_url() {
        let url = deeplx_translate_endpoint_url("https://deeplx.example.test/api/")
            .expect("valid DeepLX base URL should parse");

        assert_eq!(url.as_str(), "https://deeplx.example.test/api/translate");
    }

    #[tokio::test]
    async fn deeplx_endpoint_rejects_private_url_without_opt_in() {
        let error =
            validated_deeplx_endpoint(&json!({ "deeplxUrl": "http://192.168.1.20:1188" }), false)
                .await
                .expect_err("private DeepLX URL should require opt-in");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains(DEEPLX_LOCAL_URLS_ENABLED_FLAG));
    }

    #[tokio::test]
    async fn deeplx_endpoint_rejects_loopback_without_opt_in() {
        let error =
            validated_deeplx_endpoint(&json!({ "deeplxUrl": "http://127.0.0.1:1188" }), false)
                .await
                .expect_err("loopback DeepLX URL should require opt-in");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains(DEEPLX_LOCAL_URLS_ENABLED_FLAG));
    }

    #[tokio::test]
    async fn deeplx_endpoint_allows_loopback_with_opt_in() {
        let endpoint =
            validated_deeplx_endpoint(&json!({ "deeplxUrl": "http://127.0.0.1:1188" }), true)
                .await
                .expect("loopback DeepLX URL should be allowed with opt-in");

        assert_eq!(endpoint.url.as_str(), "http://127.0.0.1:1188/translate");
        assert!(endpoint.resolved_addresses.is_none());
    }
}
