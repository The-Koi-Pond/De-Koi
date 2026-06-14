use crate::storage_commands::shared::required_string;
use marinara_core::{AppError, AppResult};
use marinara_security::{is_allowed_outbound_url, redact_sensitive_text};
use reqwest::header::HeaderMap;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::{sleep_until, Instant};

const DISCORD_CONTENT_LIMIT: usize = 2_000;
const DISCORD_USERNAME_LIMIT: usize = 80;
const DISCORD_MIN_INTERVAL: Duration = Duration::from_millis(1_200);
const DISCORD_MAX_RETRY_AFTER: Duration = Duration::from_secs(60);
const DISCORD_MAX_ATTEMPTS: usize = 5;

type DiscordWebhookQueues = StdMutex<HashMap<String, Arc<Mutex<DiscordWebhookQueueState>>>>;

static DISCORD_WEBHOOK_QUEUES: OnceLock<DiscordWebhookQueues> = OnceLock::new();

#[derive(Default)]
struct DiscordWebhookQueueState {
    next_send_at: Option<Instant>,
}

pub(crate) async fn discord_webhook_send(body: Value) -> AppResult<Value> {
    let webhook_url = required_string(&body, "webhookUrl")?.trim();
    if !is_valid_discord_webhook_url(webhook_url) || !is_allowed_outbound_url(webhook_url, false) {
        return Err(AppError::invalid_input("Invalid Discord webhook URL"));
    }

    let payload = build_discord_payload(&body)?;
    let queue = discord_webhook_queue(webhook_url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| AppError::new("discord_webhook_client_error", error.to_string()))?;

    let mut queue_state = queue.lock().await;
    send_discord_webhook_queued(&client, webhook_url, payload, &mut queue_state).await?;

    Ok(json!({ "success": true }))
}

async fn send_discord_webhook_queued(
    client: &reqwest::Client,
    webhook_url: &str,
    payload: Map<String, Value>,
    queue_state: &mut DiscordWebhookQueueState,
) -> AppResult<()> {
    for attempt in 1..=DISCORD_MAX_ATTEMPTS {
        wait_for_webhook_slot(queue_state).await;

        let response = post_discord_webhook_once(client, webhook_url, &payload).await?;

        let status = response.status();
        let retry_after =
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < DISCORD_MAX_ATTEMPTS {
                parse_retry_after(response.headers()).unwrap_or(DISCORD_MIN_INTERVAL)
            } else {
                DISCORD_MIN_INTERVAL
            };
        queue_state.next_send_at = Some(Instant::now() + retry_after);

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < DISCORD_MAX_ATTEMPTS {
            continue;
        }

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::with_details(
                "discord_webhook_failed",
                format!("Discord webhook returned HTTP {status}"),
                json!({ "body": redact_sensitive_text(&body).chars().take(500).collect::<String>() }),
            ));
        }

        return Ok(());
    }

    Err(AppError::new(
        "discord_webhook_failed",
        "Discord webhook retry limit exceeded",
    ))
}

async fn wait_for_webhook_slot(queue_state: &DiscordWebhookQueueState) {
    if let Some(next_send_at) = queue_state.next_send_at {
        sleep_until(next_send_at).await;
    }
}

fn discord_webhook_queue(webhook_url: &str) -> Arc<Mutex<DiscordWebhookQueueState>> {
    let queues = DISCORD_WEBHOOK_QUEUES.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut queues = queues.lock().unwrap_or_else(|error| error.into_inner());
    queues
        .entry(webhook_url.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(DiscordWebhookQueueState::default())))
        .clone()
}

fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let seconds = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<f64>()
        .ok()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some(Duration::from_secs_f64(seconds).min(DISCORD_MAX_RETRY_AFTER))
}

async fn post_discord_webhook_once(
    client: &reqwest::Client,
    webhook_url: &str,
    payload: &Map<String, Value>,
) -> AppResult<reqwest::Response> {
    client
        .post(webhook_url)
        .json(&Value::Object(payload.clone()))
        .send()
        .await
        .map_err(|error| {
            AppError::new(
                "discord_webhook_request_error",
                redact_sensitive_text(&error.to_string()),
            )
        })
}

/// Build the Discord webhook JSON payload from a mirror request.
///
/// `allowed_mentions` is always set to `{ "parse": [] }` so mention syntax in the
/// mirrored content (which is model/card output) can never resolve real @everyone /
/// @here / role / user pings on the target server.
fn build_discord_payload(body: &Value) -> AppResult<Map<String, Value>> {
    let content = required_string(body, "content")?.trim();
    let mut payload = Map::new();
    payload.insert(
        "content".to_string(),
        Value::String(truncate_for_discord(content, DISCORD_CONTENT_LIMIT)),
    );

    if let Some(username) = optional_trimmed_string(body, "username") {
        payload.insert(
            "username".to_string(),
            Value::String(truncate_chars(&username, DISCORD_USERNAME_LIMIT)),
        );
    }
    if let Some(avatar_url) = optional_trimmed_string(body, "avatarUrl") {
        if !is_allowed_outbound_url(&avatar_url, false) {
            return Err(AppError::invalid_input("Invalid Discord avatar URL"));
        }
        payload.insert("avatar_url".to_string(), Value::String(avatar_url));
    }

    payload.insert("allowed_mentions".to_string(), json!({ "parse": [] }));

    Ok(payload)
}

fn optional_trimmed_string(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn truncate_for_discord(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let prefix = value
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>();
    format!("{prefix}...")
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

pub(crate) fn is_valid_discord_webhook_url(raw: &str) -> bool {
    let trimmed = raw.trim();
    let Some(rest) = trimmed
        .strip_prefix("https://discord.com/api/webhooks/")
        .or_else(|| trimmed.strip_prefix("https://discordapp.com/api/webhooks/"))
    else {
        return false;
    };
    let mut parts = rest.split('/');
    let id = parts.next().unwrap_or_default();
    let token = parts.next().unwrap_or_default();
    if parts.next().is_some() {
        return false;
    }
    !id.is_empty()
        && id.chars().all(|character| character.is_ascii_digit())
        && !token.is_empty()
        && token.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn validates_legacy_discord_webhook_shapes() {
        assert!(is_valid_discord_webhook_url(
            "https://discord.com/api/webhooks/123456789/token_AB-12"
        ));
        assert!(is_valid_discord_webhook_url(
            "https://discordapp.com/api/webhooks/123456789/token_AB-12"
        ));
        assert!(!is_valid_discord_webhook_url(
            "http://discord.com/api/webhooks/123/token"
        ));
        assert!(!is_valid_discord_webhook_url(
            "https://example.com/api/webhooks/123/token"
        ));
        assert!(!is_valid_discord_webhook_url(
            "https://discord.com/api/webhooks/notnumeric/token"
        ));
    }

    #[test]
    fn truncates_content_with_ellipsis_inside_discord_limit() {
        let value = "x".repeat(DISCORD_CONTENT_LIMIT + 20);
        let truncated = truncate_for_discord(&value, DISCORD_CONTENT_LIMIT);
        assert_eq!(truncated.chars().count(), DISCORD_CONTENT_LIMIT);
        assert!(truncated.ends_with("..."));
    }

    #[test]
    fn payload_always_suppresses_mentions() {
        let payload = build_discord_payload(&json!({ "content": "hey @everyone @here <@&123>" }))
            .expect("payload should build");
        let parse = payload
            .get("allowed_mentions")
            .and_then(|value| value.get("parse"))
            .and_then(Value::as_array)
            .expect("allowed_mentions.parse must be present");
        assert!(parse.is_empty(), "no mention types may be parsed");
        // Suppression is via allowed_mentions, not by mangling the visible text.
        assert_eq!(
            payload.get("content").and_then(Value::as_str),
            Some("hey @everyone @here <@&123>")
        );
    }

    #[test]
    fn payload_rejects_reserved_avatar_url() {
        let error = build_discord_payload(&json!({
            "content": "hi",
            "avatarUrl": "http://169.254.169.254/latest/meta-data/"
        }))
        .expect_err("reserved avatar URL must be rejected");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn retry_after_header_accepts_fractional_seconds() {
        let mut headers = HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "0.25".parse().unwrap());
        assert_eq!(
            parse_retry_after(&headers),
            Some(Duration::from_millis(250))
        );
    }

    #[tokio::test]
    async fn retries_429_before_reporting_webhook_success() {
        let records = Arc::new(StdMutex::new(Vec::new()));
        let webhook_url = serve_discord_responses(
            vec![
                "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 0.01\r\nContent-Length: 16\r\nConnection: close\r\n\r\n{\"retry\":true}\n",
                "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            ],
            records.clone(),
        )
        .await;
        let client = reqwest::Client::new();
        let payload = build_discord_payload(&json!({ "content": "queued" })).unwrap();
        let mut queue_state = DiscordWebhookQueueState::default();

        send_discord_webhook_queued(&client, &webhook_url, payload, &mut queue_state)
            .await
            .expect("429 retry should eventually succeed");

        let records = records.lock().unwrap();
        assert_eq!(records.len(), 2, "the 429 response should be retried");
        assert!(
            records.iter().all(|(_, body)| body.contains("\"queued\"")),
            "each retry should preserve the original Discord payload"
        );
    }

    #[tokio::test]
    async fn serializes_posts_for_the_same_webhook() {
        let records = Arc::new(StdMutex::new(Vec::new()));
        let webhook_url = serve_discord_responses(
            vec![
                "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            ],
            records.clone(),
        )
        .await;
        let client = reqwest::Client::new();
        let queue = Arc::new(Mutex::new(DiscordWebhookQueueState::default()));
        let payload_a = build_discord_payload(&json!({ "content": "first" })).unwrap();
        let payload_b = build_discord_payload(&json!({ "content": "second" })).unwrap();

        let first = async {
            let mut queue_state = queue.lock().await;
            send_discord_webhook_queued(&client, &webhook_url, payload_a, &mut queue_state).await
        };
        let second = async {
            let mut queue_state = queue.lock().await;
            send_discord_webhook_queued(&client, &webhook_url, payload_b, &mut queue_state).await
        };

        let (first, second) = tokio::join!(first, second);
        first.expect("first queued webhook should succeed");
        second.expect("second queued webhook should succeed");

        let records = records.lock().unwrap();
        assert_eq!(records.len(), 2);
        let spacing = records[1].0.duration_since(records[0].0);
        assert!(
            spacing >= DISCORD_MIN_INTERVAL - Duration::from_millis(50),
            "queued webhook posts should be spaced by the legacy interval, got {spacing:?}"
        );
    }

    async fn serve_discord_responses(
        responses: Vec<&'static str>,
        records: Arc<StdMutex<Vec<(Instant, String)>>>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test Discord webhook server should bind");
        let address = listener
            .local_addr()
            .expect("test Discord webhook server address should be readable");

        tokio::spawn(async move {
            for response in responses {
                let (mut stream, _) = listener
                    .accept()
                    .await
                    .expect("test Discord webhook server should accept request");
                let request = read_http_request(&mut stream).await;
                records
                    .lock()
                    .unwrap()
                    .push((Instant::now(), request_body(&request).to_string()));
                stream
                    .write_all(response.as_bytes())
                    .await
                    .expect("test Discord webhook server should write response");
            }
        });

        format!("http://{address}/api/webhooks/123/test")
    }

    async fn read_http_request(stream: &mut tokio::net::TcpStream) -> String {
        let mut buffer = Vec::new();
        let mut chunk = [0; 1024];
        loop {
            let read = stream
                .read(&mut chunk)
                .await
                .expect("test Discord webhook server should read request");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            if request_body_complete(&buffer) {
                break;
            }
        }
        String::from_utf8_lossy(&buffer).to_string()
    }

    fn request_body_complete(buffer: &[u8]) -> bool {
        let request = String::from_utf8_lossy(buffer);
        let Some((headers, body)) = request.split_once("\r\n\r\n") else {
            return false;
        };
        let content_length = headers
            .lines()
            .find_map(|line| line.strip_prefix("content-length: "))
            .or_else(|| {
                headers
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
            })
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        body.as_bytes().len() >= content_length
    }

    fn request_body(request: &str) -> &str {
        request.split_once("\r\n\r\n").map_or("", |(_, body)| body)
    }
}
