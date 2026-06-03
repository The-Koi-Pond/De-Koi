use super::shared::*;
use super::*;
use marinara_security::{is_allowed_outbound_url, is_local_or_reserved_ip};

const WEBHOOK_LOCAL_URLS_ENABLED_FLAG: &str = "WEBHOOK_LOCAL_URLS_ENABLED";
const CUSTOM_TOOL_WEBHOOK_MAX_RESPONSE_BYTES: usize = 512 * 1024;
const CUSTOM_TOOL_WEBHOOK_MAX_REDIRECTS: usize = 5;

pub(crate) fn custom_tool_capabilities() -> Value {
    json!({
        "staticResults": true,
        "webhooks": true,
        "scriptExecutionEnabled": false
    })
}

pub(crate) async fn execute_custom_tool(state: &AppState, body: Value) -> AppResult<Value> {
    let tool_name = required_string(&body, "toolName")?;
    let arguments = body.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let tool = state
        .storage
        .list("custom-tools")?
        .into_iter()
        .find(|row| {
            row.get("name").and_then(Value::as_str) == Some(tool_name)
                && string_bool(row.get("enabled")).unwrap_or(true)
        })
        .ok_or_else(|| {
            AppError::invalid_input(format!("Custom tool not found or disabled: {tool_name}"))
        })?;

    match tool
        .get("executionType")
        .and_then(Value::as_str)
        .unwrap_or("static")
    {
        "static" => Ok(json!({
            "success": true,
            "result": tool
                .get("staticResult")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| AppError::invalid_input(format!("Static result is missing for custom tool: {tool_name}")))?
        })),
        "webhook" => execute_webhook_tool(&tool, tool_name, arguments).await,
        "script" => Err(AppError::with_details(
            "custom_tool_script_unsupported",
            format!(
                "Custom tool '{tool_name}' uses the script executionType. Script custom tools are disabled in this runtime. Convert it to a Webhook or Static result."
            ),
            json!({ "executionType": "script", "migration": "convert-to-webhook-or-static" }),
        )),
        other => Err(AppError::invalid_input(format!(
            "Unsupported custom tool execution type: {other}"
        ))),
    }
}

fn string_bool(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::String(value)) => match value.as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        },
        Some(Value::Number(value)) => value.as_i64().map(|value| value != 0),
        _ => None,
    }
}

async fn execute_webhook_tool(tool: &Value, tool_name: &str, arguments: Value) -> AppResult<Value> {
    execute_webhook_tool_with_policy(tool, tool_name, arguments, webhook_local_urls_enabled()).await
}

async fn execute_webhook_tool_with_policy(
    tool: &Value,
    tool_name: &str,
    arguments: Value,
    allow_local_urls: bool,
) -> AppResult<Value> {
    let url = tool
        .get("webhookUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| {
            AppError::invalid_input(format!(
                "Webhook URL is missing for custom tool: {tool_name}"
            ))
        })?;
    let mut current_url = validate_custom_tool_webhook_url(url, allow_local_urls)?;
    let payload = json!({ "tool": tool_name, "arguments": arguments });

    for redirects_followed in 0..=CUSTOM_TOOL_WEBHOOK_MAX_REDIRECTS {
        let response =
            send_custom_tool_webhook_request(&current_url, &payload, allow_local_urls).await?;
        if response.status().is_redirection()
            && response.headers().contains_key(reqwest::header::LOCATION)
        {
            if redirects_followed == CUSTOM_TOOL_WEBHOOK_MAX_REDIRECTS {
                return Err(AppError::new(
                    "custom_tool_redirect_limit",
                    "Custom tool webhook exceeded redirect limit",
                ));
            }
            current_url =
                redirected_custom_tool_webhook_url(&current_url, &response, allow_local_urls)?;
            continue;
        }

        let status = response.status();
        let text = read_limited_webhook_text(response).await?;
        if !status.is_success() {
            return Err(AppError::with_details(
                "custom_tool_webhook_failed",
                format!("Custom tool webhook returned HTTP {status}"),
                json!({ "body": text.chars().take(1000).collect::<String>() }),
            ));
        }

        return Ok(json!({
            "success": true,
            "result": text
        }));
    }

    Err(AppError::new(
        "custom_tool_redirect_limit",
        "Custom tool webhook exceeded redirect limit",
    ))
}

async fn send_custom_tool_webhook_request(
    parsed_url: &reqwest::Url,
    payload: &Value,
    allow_local_urls: bool,
) -> AppResult<reqwest::Response> {
    let resolved_addresses =
        custom_tool_webhook_resolved_addresses(parsed_url, allow_local_urls).await?;

    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none());
    if let (Some(host), Some(addresses)) = (parsed_url.host_str(), resolved_addresses.as_deref()) {
        client_builder = client_builder.resolve_to_addrs(host, addresses);
    }
    client_builder
        .build()
        .map_err(|error| AppError::new("custom_tool_client_error", error.to_string()))?
        .post(parsed_url.clone())
        .json(payload)
        .send()
        .await
        .map_err(|error| AppError::new("custom_tool_webhook_error", error.to_string()))
}

fn redirected_custom_tool_webhook_url(
    current_url: &reqwest::Url,
    response: &reqwest::Response,
    allow_local_urls: bool,
) -> AppResult<reqwest::Url> {
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .ok_or_else(|| {
            AppError::new(
                "custom_tool_redirect_error",
                "Webhook redirect is missing a Location header",
            )
        })?
        .to_str()
        .map_err(|error| AppError::new("custom_tool_redirect_error", error.to_string()))?;
    validate_redirected_custom_tool_webhook_url(current_url, location, allow_local_urls)
}

fn validate_redirected_custom_tool_webhook_url(
    current_url: &reqwest::Url,
    location: &str,
    allow_local_urls: bool,
) -> AppResult<reqwest::Url> {
    let redirected = current_url
        .join(location)
        .map_err(|error| AppError::new("custom_tool_redirect_error", error.to_string()))?;
    validate_custom_tool_webhook_url(redirected.as_str(), allow_local_urls)
}

fn validate_custom_tool_webhook_url(url: &str, allow_local_urls: bool) -> AppResult<reqwest::Url> {
    let parsed = reqwest::Url::parse(url).map_err(|error| {
        AppError::invalid_input(format!("Custom tool webhook URL is invalid: {error}"))
    })?;
    match parsed.scheme() {
        "https" => {}
        "http" if allow_local_urls => {}
        "http" => {
            return Err(AppError::invalid_input(format!(
                "Custom tool webhook URL must use https unless {WEBHOOK_LOCAL_URLS_ENABLED_FLAG}=true is set."
            )));
        }
        scheme => {
            return Err(AppError::invalid_input(format!(
                "Custom tool webhook URL uses unsupported protocol '{scheme}'. Use https, or http only with {WEBHOOK_LOCAL_URLS_ENABLED_FLAG}=true."
            )));
        }
    }
    if !is_allowed_outbound_url(url, allow_local_urls) {
        return Err(AppError::invalid_input(format!(
            "Custom tool webhook URL points to a local, private, or reserved address. Set {WEBHOOK_LOCAL_URLS_ENABLED_FLAG}=true only if you trust that target."
        )));
    }
    Ok(parsed)
}

async fn custom_tool_webhook_resolved_addresses(
    url: &reqwest::Url,
    allow_local_urls: bool,
) -> AppResult<Option<Vec<std::net::SocketAddr>>> {
    let Some(host) = url.host_str() else {
        return Err(AppError::invalid_input(
            "Custom tool webhook URL is missing a hostname",
        ));
    };
    let requires_local_target = url.scheme() == "http" && allow_local_urls;
    if let Some(ip) = custom_tool_webhook_host_ip(host) {
        if requires_local_target && !is_local_or_reserved_ip(ip) {
            return Err(public_http_webhook_error());
        }
        return Ok(None);
    }
    if allow_local_urls && !requires_local_target {
        return Ok(None);
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let mut addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| {
            AppError::invalid_input(format!(
                "Custom tool webhook host '{host}' did not resolve: {error}"
            ))
        })?;
    let mut resolved_addresses = Vec::new();
    for address in addresses.by_ref() {
        let is_local_or_reserved = is_local_or_reserved_ip(address.ip());
        if requires_local_target && !is_local_or_reserved {
            return Err(public_http_webhook_error());
        }
        if !requires_local_target && is_local_or_reserved {
            return Err(AppError::invalid_input(format!(
                "Custom tool webhook URL resolves to a local, private, or reserved address. Set {WEBHOOK_LOCAL_URLS_ENABLED_FLAG}=true only if you trust that target."
            )));
        }
        resolved_addresses.push(address);
    }
    if resolved_addresses.is_empty() {
        return Err(AppError::invalid_input(format!(
            "Custom tool webhook host '{host}' did not resolve"
        )));
    }
    Ok(Some(resolved_addresses))
}

fn custom_tool_webhook_host_ip(host: &str) -> Option<std::net::IpAddr> {
    let unbracketed_host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    unbracketed_host.parse::<std::net::IpAddr>().ok()
}

fn public_http_webhook_error() -> AppError {
    AppError::invalid_input(
        "Custom tool webhook URL uses public http. Use https for public webhooks; WEBHOOK_LOCAL_URLS_ENABLED=true only allows http for local or reserved targets.",
    )
}

fn webhook_local_urls_enabled() -> bool {
    std::env::var(WEBHOOK_LOCAL_URLS_ENABLED_FLAG).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

async fn read_limited_webhook_text(mut response: reqwest::Response) -> AppResult<String> {
    if response
        .content_length()
        .is_some_and(|length| length > CUSTOM_TOOL_WEBHOOK_MAX_RESPONSE_BYTES as u64)
    {
        return Err(webhook_response_too_large_error());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| AppError::new("custom_tool_response_error", error.to_string()))?
    {
        if body.len().saturating_add(chunk.len()) > CUSTOM_TOOL_WEBHOOK_MAX_RESPONSE_BYTES {
            return Err(webhook_response_too_large_error());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn webhook_response_too_large_error() -> AppError {
    AppError::new(
        "custom_tool_response_too_large",
        format!(
            "Custom tool webhook response exceeds {} bytes",
            CUSTOM_TOOL_WEBHOOK_MAX_RESPONSE_BYTES
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::Map;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-custom-tools-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn insert_tool(state: &AppState, row: Map<String, Value>) {
        state
            .storage
            .create("custom-tools", Value::Object(row))
            .expect("storage create should succeed");
    }

    fn webhook_tool(url: &str) -> Value {
        json!({
            "name": "webhook_tool",
            "description": "test webhook",
            "executionType": "webhook",
            "webhookUrl": url,
            "enabled": true
        })
    }

    async fn serve_single_webhook_response(body: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test webhook server should bind");
        let address = listener
            .local_addr()
            .expect("test webhook server address should be readable");
        tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("test webhook server should accept one request");
            let mut buffer = [0_u8; 2048];
            let _ = stream
                .read(&mut buffer)
                .await
                .expect("test webhook server should read request");
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("test webhook server should write response");
        });
        format!("http://{address}/hook")
    }

    #[test]
    fn capabilities_report_script_execution_disabled() {
        let capabilities = custom_tool_capabilities();
        assert_eq!(
            capabilities
                .get("scriptExecutionEnabled")
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[tokio::test]
    async fn script_execution_type_returns_actionable_error() {
        let state = test_state("script-unsupported");
        let mut row = Map::new();
        row.insert("name".to_string(), json!("legacy_script_tool"));
        row.insert("description".to_string(), json!("legacy"));
        row.insert("executionType".to_string(), json!("script"));
        row.insert("scriptBody".to_string(), json!("return 1 + 1;"));
        row.insert("enabled".to_string(), json!(true));
        insert_tool(&state, row);

        let body = json!({ "toolName": "legacy_script_tool", "arguments": {} });
        let result = execute_custom_tool(&state, body).await;
        let error = result.expect_err("script tools must not execute in refactor runtime");
        assert_eq!(error.code, "custom_tool_script_unsupported");
        assert!(
            error.message.contains("legacy_script_tool"),
            "error should name the tool, got: {}",
            error.message
        );
        assert!(
            error.message.contains("script executionType") && error.message.contains("disabled"),
            "error should identify the legacy script issue, got: {}",
            error.message
        );
        assert!(
            error.message.contains("Webhook") || error.message.contains("webhook"),
            "error should point at the webhook migration path, got: {}",
            error.message
        );
    }

    #[tokio::test]
    async fn unknown_execution_type_still_rejected() {
        let state = test_state("unknown-type");
        let mut row = Map::new();
        row.insert("name".to_string(), json!("alien_tool"));
        row.insert("description".to_string(), json!("?"));
        row.insert("executionType".to_string(), json!("quantum"));
        row.insert("enabled".to_string(), json!(true));
        insert_tool(&state, row);

        let body = json!({ "toolName": "alien_tool", "arguments": {} });
        let error = execute_custom_tool(&state, body)
            .await
            .expect_err("unknown executionType must reject");
        assert!(
            error
                .message
                .contains("Unsupported custom tool execution type"),
            "unknown types must keep the generic message, got: {}",
            error.message
        );
    }

    #[test]
    fn webhook_policy_rejects_local_urls_without_legacy_opt_in() {
        let error = validate_custom_tool_webhook_url("https://127.0.0.1:32123/hook", false)
            .expect_err("local custom tool webhook should require explicit opt-in");
        assert_eq!(error.code, "invalid_input");
        assert!(
            error.message.contains(WEBHOOK_LOCAL_URLS_ENABLED_FLAG),
            "error should name the legacy opt-in flag, got: {}",
            error.message
        );
        assert!(
            error.message.contains("local, private, or reserved"),
            "error should identify local/private policy, got: {}",
            error.message
        );

        validate_custom_tool_webhook_url("http://127.0.0.1:32123/hook", true)
            .expect("legacy local opt-in should allow loopback http webhook URLs");
    }

    #[test]
    fn webhook_policy_rejects_private_https_urls_without_legacy_opt_in() {
        let error = validate_custom_tool_webhook_url("https://192.168.1.20/hook", false)
            .expect_err("private custom tool webhook should require explicit opt-in");
        assert_eq!(error.code, "invalid_input");
        assert!(
            error.message.contains("local, private, or reserved"),
            "error should identify local/private policy, got: {}",
            error.message
        );
    }

    #[tokio::test]
    async fn webhook_local_opt_in_does_not_allow_public_http_targets() {
        let public_http =
            reqwest::Url::parse("http://93.184.216.34/hook").expect("test URL should parse");
        let error = custom_tool_webhook_resolved_addresses(&public_http, true)
            .await
            .expect_err("public http target should stay rejected with local opt-in");
        assert!(
            error.message.contains("public http"),
            "error should identify insecure public http, got: {}",
            error.message
        );

        let local_http =
            reqwest::Url::parse("http://127.0.0.1:32123/hook").expect("test URL should parse");
        custom_tool_webhook_resolved_addresses(&local_http, true)
            .await
            .expect("local http target should be allowed with local opt-in");

        let bracketed_local_http =
            reqwest::Url::parse("http://[::1]:32123/hook").expect("test URL should parse");
        custom_tool_webhook_resolved_addresses(&bracketed_local_http, true)
            .await
            .expect("bracketed local IPv6 http target should be allowed with local opt-in");

        let bracketed_public_http =
            reqwest::Url::parse("http://[2606:2800:220:1:248:1893:25c8:1946]/hook")
                .expect("test URL should parse");
        let error = custom_tool_webhook_resolved_addresses(&bracketed_public_http, true)
            .await
            .expect_err("bracketed public IPv6 http target should stay rejected");
        assert!(
            error.message.contains("public http"),
            "error should identify insecure public http, got: {}",
            error.message
        );
    }

    #[test]
    fn webhook_redirect_policy_rejects_private_locations_without_legacy_opt_in() {
        let current_url = reqwest::Url::parse("https://webhook.example.test/hook")
            .expect("test URL should parse");
        for location in [
            "http://169.254.169.254/latest/meta-data",
            "https://169.254.169.254/latest/meta-data",
        ] {
            let error = validate_redirected_custom_tool_webhook_url(&current_url, location, false)
                .expect_err("redirected private target should require explicit opt-in");

            assert_eq!(error.code, "invalid_input");
            assert!(
                error.message.contains(WEBHOOK_LOCAL_URLS_ENABLED_FLAG),
                "error should name the legacy opt-in flag, got: {}",
                error.message
            );
            assert!(
                error.message.contains("https")
                    || error.message.contains("local, private, or reserved"),
                "error should identify redirected URL policy, got: {}",
                error.message
            );
        }
    }

    #[test]
    fn webhook_redirect_policy_allows_public_relative_locations() {
        let current_url = reqwest::Url::parse("https://webhook.example.test/hook")
            .expect("test URL should parse");
        let redirected = validate_redirected_custom_tool_webhook_url(&current_url, "/next", false)
            .expect("public same-origin relative redirect should remain allowed");

        assert_eq!(redirected.as_str(), "https://webhook.example.test/next");
    }

    #[tokio::test]
    async fn webhook_response_body_is_capped_to_legacy_limit() {
        let url =
            serve_single_webhook_response("x".repeat(CUSTOM_TOOL_WEBHOOK_MAX_RESPONSE_BYTES + 1))
                .await;
        let error = execute_webhook_tool_with_policy(
            &webhook_tool(&url),
            "webhook_tool",
            json!({ "input": "oversized" }),
            true,
        )
        .await
        .expect_err("oversized custom tool webhook response must be rejected");

        assert_eq!(error.code, "custom_tool_response_too_large");
        assert!(
            error
                .message
                .contains(&CUSTOM_TOOL_WEBHOOK_MAX_RESPONSE_BYTES.to_string()),
            "error should include the response byte limit, got: {}",
            error.message
        );
    }
}
