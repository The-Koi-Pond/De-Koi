//! User-facing wording for provider failures.
//!
//! Every message here says what went wrong and what the user can do next
//! (check the key, wait, switch model, check the URL). Raw provider or
//! transport text is kept after it so bug reports still carry the detail.
//! The leading "{label} returned HTTP {status}" and "did not contain
//! assistant text" phrases are matched by the TypeScript engine, so keep them.

use marinara_security::redact_sensitive_text;
use std::time::Duration;

const RETRY_OR_SWITCH: &str = "Retry in a minute, or switch to another model in Connections.";
const RAISE_OUTPUT_LIMIT: &str =
    "Raise Max Output Tokens in this connection's generation controls, then retry.";

/// What the user can do about a provider HTTP status, or `None` when the
/// provider's own detail is the most useful thing to show (most 400s).
pub fn provider_http_next_step(status: u16, detail: Option<&str>) -> Option<&'static str> {
    match status {
        400 if detail.is_some_and(mentions_context_limit) => Some(
            "The prompt is longer than this model accepts. Lower Max Context Window for this connection in Connections, then retry.",
        ),
        401 => Some("Check this connection's API key in Connections."),
        402 => Some("Add credit or check billing on the provider's site, then retry."),
        403 => Some(
            "Check this connection's API key in Connections, and that your account can use this model.",
        ),
        404 => Some("Check this connection's model and base URL in Connections."),
        408 | 504 | 524 => Some("The provider took too long to answer. Retry in a minute."),
        413 => Some(
            "The request is too large. Lower Max Context Window in Connections or remove attachments, then retry.",
        ),
        429 => Some(
            "The provider is rate limiting this key. Wait a minute and retry, or check your plan's limits.",
        ),
        500..=599 => Some(
            "The provider is having trouble. Retry in a minute, or switch to another model in Connections.",
        ),
        _ => None,
    }
}

fn mentions_context_limit(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    (lower.contains("context")
        && ["length", "window", "limit", "maximum"]
            .iter()
            .any(|word| lower.contains(word)))
        || lower.contains("too many tokens")
        || lower.contains("prompt is too long")
}

/// `"{label} returned HTTP {status}: {detail}. {next step}"`.
pub fn provider_http_error_message(
    label: &str,
    status: reqwest::StatusCode,
    detail: Option<&str>,
) -> String {
    let detail = detail.map(str::trim).filter(|detail| !detail.is_empty());
    let mut message = match detail {
        Some(detail) => format!("{label} returned HTTP {status}: {detail}"),
        None => format!("{label} returned HTTP {status}"),
    };
    if let Some(next_step) = provider_http_next_step(status.as_u16(), detail) {
        append_sentence(&mut message, next_step);
    }
    message
}

/// A request that never got a usable HTTP response (DNS, refused, dropped, timed out).
pub fn provider_transport_error_message(error: &reqwest::Error) -> String {
    let lead = if error.is_timeout() {
        "The provider stopped responding. Retry, or check that the provider is up."
    } else if error.is_connect() {
        "Couldn't connect to the provider. Check this connection's base URL and your internet connection, or start your local model server."
    } else if error.is_body() || error.is_decode() {
        "The connection to the provider dropped mid-reply. Retry."
    } else {
        "The request to the provider failed. Check this connection's base URL and your internet connection, then retry."
    };
    format!(
        "{lead} Details: {}",
        redact_sensitive_text(&error.to_string())
    )
}

/// The provider accepted the request but sent no response headers in time.
pub fn provider_headers_timeout_message(timeout: Duration) -> String {
    format!(
        "The model didn't start answering within {}. Retry, or check that the provider is up.",
        human_duration(timeout)
    )
}

/// The provider answered without any reply text.
pub fn provider_empty_reply_message(what: &str) -> String {
    format!(
        "{what}. The model sent back nothing, which can happen when a provider filters a reply. {RETRY_OR_SWITCH}"
    )
}

/// The provider sent something De-Koi could not parse.
pub fn provider_unreadable_reply_message(error: impl std::fmt::Display) -> String {
    format!(
        "The provider sent a reply De-Koi couldn't read ({error}). Retry, or check this connection's provider type and base URL in Connections."
    )
}

/// The provider streamed an error event after the reply had started.
pub fn provider_stream_error_message(provider: &str, detail: Option<&str>) -> String {
    let detail = detail.map(str::trim).filter(|detail| !detail.is_empty());
    let lower = detail.unwrap_or_default().to_ascii_lowercase();
    let next_step = if lower.contains("max_output_tokens") || lower.contains("max_tokens") {
        Some(RAISE_OUTPUT_LIMIT)
    } else if lower.contains("rate limit") || lower.contains("rate_limit") {
        provider_http_next_step(429, None)
    } else if lower.contains("overloaded") || lower.contains("unavailable") {
        provider_http_next_step(503, None)
    } else {
        None
    }
    .unwrap_or(RETRY_OR_SWITCH);
    let mut message = match detail {
        Some(detail) => format!("{provider} sent an error mid-reply: {detail}"),
        None => format!("{provider} sent an error mid-reply"),
    };
    append_sentence(&mut message, next_step);
    message
}

fn append_sentence(message: &mut String, sentence: &str) {
    if !message.ends_with(['.', '!', '?']) {
        message.push('.');
    }
    message.push(' ');
    message.push_str(sentence);
}

fn human_duration(duration: Duration) -> String {
    let seconds = duration.as_secs();
    if seconds == 0 {
        "a second".to_string()
    } else if seconds >= 60 && seconds % 60 == 0 {
        let minutes = seconds / 60;
        format!("{minutes} minute{}", if minutes == 1 { "" } else { "s" })
    } else {
        format!("{seconds} second{}", if seconds == 1 { "" } else { "s" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_errors_keep_the_status_prefix_and_name_a_next_step() {
        let message = provider_http_error_message(
            "Provider",
            reqwest::StatusCode::UNAUTHORIZED,
            Some("Invalid API key"),
        );
        assert_eq!(
            message,
            "Provider returned HTTP 401 Unauthorized: Invalid API key. Check this connection's API key in Connections."
        );

        let rate_limited =
            provider_http_error_message("Provider", reqwest::StatusCode::TOO_MANY_REQUESTS, None);
        assert!(rate_limited.starts_with("Provider returned HTTP 429 Too Many Requests. "));
        assert!(rate_limited.contains("Wait a minute"));
    }

    #[test]
    fn plain_bad_requests_show_only_the_provider_detail() {
        let message = provider_http_error_message(
            "Provider",
            reqwest::StatusCode::BAD_REQUEST,
            Some("temperature must be <= 2"),
        );
        assert_eq!(
            message,
            "Provider returned HTTP 400 Bad Request: temperature must be <= 2"
        );

        let too_long = provider_http_error_message(
            "Provider",
            reqwest::StatusCode::BAD_REQUEST,
            Some("This model's maximum context length is 8192 tokens."),
        );
        assert!(too_long
            .ends_with("Lower Max Context Window for this connection in Connections, then retry."));
    }

    #[test]
    fn timeouts_read_in_minutes() {
        assert_eq!(
            provider_headers_timeout_message(Duration::from_secs(300)),
            "The model didn't start answering within 5 minutes. Retry, or check that the provider is up."
        );
        assert_eq!(human_duration(Duration::from_secs(90)), "90 seconds");
    }

    #[test]
    fn stream_errors_carry_the_provider_detail() {
        assert_eq!(
            provider_stream_error_message("Anthropic", Some("Overloaded")),
            "Anthropic sent an error mid-reply: Overloaded. The provider is having trouble. Retry in a minute, or switch to another model in Connections."
        );
        assert!(provider_stream_error_message("Gemini", None).ends_with(RETRY_OR_SWITCH));
    }
}
