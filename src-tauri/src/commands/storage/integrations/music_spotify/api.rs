//! Spotify Web API transport: the stored account, token refresh (one at a time), 15-second timeouts,
//! one 429 retry, one 401 refresh-and-retry, and the user-facing error messages.

use super::super::super::connection_secrets;
use super::super::super::images::percent_encode_component;
use crate::state::AppState;
use marinara_core::{now_iso, now_millis, AppError, AppResult};
use reqwest::Method;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::Duration;

pub(super) const ACCOUNTS_BASE: &str = "https://accounts.spotify.com";
pub(super) const API_BASE: &str = "https://api.spotify.com/v1";
pub(super) const ACCOUNT_SETTINGS_KEY: &str = "music-spotify-account";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(5);
/// Refresh when the access token has less than this left.
const REFRESH_MARGIN_MS: u64 = 60_000;

pub(super) const NOT_CONNECTED_MESSAGE: &str =
    "Spotify isn't connected. Open Music Player settings to connect it.";
pub(super) const REAUTH_MESSAGE: &str =
    "Spotify sign-in needs renewing. Open Music Player settings and press Connect.";
const TIMEOUT_MESSAGE: &str = "Spotify didn't answer. Check your connection and try again.";
const RATE_LIMITED_MESSAGE: &str = "Spotify is limiting requests right now. Try again in a minute.";
pub(super) const NO_DEVICE_MESSAGE: &str =
    "Open Spotify on the device you want to use, then try again.";
const PREMIUM_MESSAGE: &str = "Playback control needs Spotify Premium.";
pub(super) const VOLUME_MESSAGE: &str =
    "This Spotify device doesn't allow volume control from De-Koi.";

pub(super) fn not_connected() -> AppError {
    AppError::new("music_spotify_not_connected", NOT_CONNECTED_MESSAGE)
}

pub(super) fn reauth_needed() -> AppError {
    AppError::new("music_spotify_reauth", REAUTH_MESSAGE)
}

pub(super) fn timeout_error() -> AppError {
    AppError::new("music_spotify_timeout", TIMEOUT_MESSAGE)
}

pub(super) fn no_device_error() -> AppError {
    AppError::new("music_spotify_no_device", NO_DEVICE_MESSAGE)
}

pub(super) fn volume_error() -> AppError {
    AppError::new("music_spotify_volume_unsupported", VOLUME_MESSAGE)
}

pub(super) fn missing_scope_error(feature: &str, missing: &[&str]) -> AppError {
    AppError::with_details(
        "music_spotify_missing_scope",
        format!(
            "{feature} needs a Spotify permission this sign-in didn't grant. Open Music Player settings and press Connect to sign in again."
        ),
        json!({ "feature": feature, "missingScopes": missing }),
    )
}

/// The stored sign-in. Tokens are decrypted only here, on the server side.
#[derive(Clone, Debug)]
pub(super) struct Account {
    pub client_id: String,
    pub access_token: Option<String>,
    pub refresh_token: String,
    pub expires_at_ms: u64,
    pub scope: String,
    pub display_name: Option<String>,
    pub user_id: Option<String>,
}

impl Account {
    fn usable_access_token(&self, now_ms: u64) -> Option<&str> {
        self.access_token
            .as_deref()
            .filter(|_| self.expires_at_ms > now_ms + REFRESH_MARGIN_MS)
    }

    pub fn access_token_expired(&self) -> bool {
        self.usable_access_token(now_ms()).is_none()
    }

    pub fn missing_scopes<'a>(&self, required: &[&'a str]) -> Vec<&'a str> {
        // Old sign-ins may not have recorded their scopes; let Spotify decide for those.
        if self.scope.trim().is_empty() {
            return Vec::new();
        }
        let granted: Vec<&str> = self.scope.split_whitespace().collect();
        required
            .iter()
            .copied()
            .filter(|scope| !granted.contains(scope))
            .collect()
    }

    pub fn require_scopes(&self, feature: &str, required: &[&str]) -> AppResult<()> {
        let missing = self.missing_scopes(required);
        if missing.is_empty() {
            Ok(())
        } else {
            Err(missing_scope_error(feature, &missing))
        }
    }
}

pub(super) fn now_ms() -> u64 {
    now_millis() as u64
}

fn stored_string(record: &Value, key: &str) -> Option<String> {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// The raw stored record (encrypted tokens), if any.
pub(super) fn account_record(state: &AppState) -> AppResult<Option<Value>> {
    state.storage.get("app-settings", ACCOUNT_SETTINGS_KEY)
}

/// "Connected" means a refresh token is stored and readable.
pub(super) fn load_account(state: &AppState) -> AppResult<Option<Account>> {
    let Some(record) = account_record(state)? else {
        return Ok(None);
    };
    let Some(refresh_encrypted) = stored_string(&record, "refreshTokenEncrypted") else {
        return Ok(None);
    };
    let Ok(refresh_token) = connection_secrets::decrypt_secret(state, &refresh_encrypted) else {
        log::warn!("[music] stored Spotify refresh token could not be decrypted");
        return Ok(None);
    };
    let access_token = stored_string(&record, "accessTokenEncrypted")
        .and_then(|encrypted| connection_secrets::decrypt_secret(state, &encrypted).ok());
    Ok(Some(Account {
        client_id: stored_string(&record, "clientId").unwrap_or_default(),
        access_token,
        refresh_token,
        expires_at_ms: record
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        scope: stored_string(&record, "scope").unwrap_or_default(),
        display_name: stored_string(&record, "displayName"),
        user_id: stored_string(&record, "userId"),
    }))
}

pub(super) fn save_account(state: &AppState, account: &Account) -> AppResult<()> {
    let mut record = Map::new();
    record.insert("clientId".into(), json!(account.client_id));
    record.insert(
        "refreshTokenEncrypted".into(),
        json!(connection_secrets::encrypt_secret(
            state,
            &account.refresh_token
        )?),
    );
    if let Some(access_token) = &account.access_token {
        record.insert(
            "accessTokenEncrypted".into(),
            json!(connection_secrets::encrypt_secret(state, access_token)?),
        );
    }
    record.insert("expiresAtMs".into(), json!(account.expires_at_ms));
    record.insert("scope".into(), json!(account.scope));
    record.insert("displayName".into(), json!(account.display_name));
    record.insert("userId".into(), json!(account.user_id));
    record.insert("updatedAt".into(), json!(now_iso()));
    state
        .storage
        .upsert_with_id("app-settings", ACCOUNT_SETTINGS_KEY, Value::Object(record))?;
    Ok(())
}

pub(super) fn clear_account(state: &AppState) -> AppResult<()> {
    let _ = state.storage.delete("app-settings", ACCOUNT_SETTINGS_KEY)?;
    Ok(())
}

/// One refresh at a time per data folder: requests that need a refresh together wait for one result.
fn refresh_gate(state: &AppState) -> Arc<tokio::sync::Mutex<()>> {
    static GATES: OnceLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    GATES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .entry(state.data_dir.clone())
        .or_default()
        .clone()
}

pub(super) fn form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{key}={}", percent_encode_component(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// A Spotify answer that wasn't a 401 or 429 (those are handled before callers see them).
pub(super) struct Reply {
    pub status: u16,
    pub body: Value,
}

impl Reply {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn reason(&self) -> &str {
        self.body
            .pointer("/error/reason")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    fn message(&self) -> &str {
        self.body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .or_else(|| self.body.get("error_description").and_then(Value::as_str))
            .unwrap_or_default()
    }

    /// The body of a successful reply, or the matching user-facing error.
    pub fn into_result(self, feature: &str) -> AppResult<Value> {
        if self.ok() {
            return Ok(self.body);
        }
        Err(self.error(feature))
    }

    pub fn error(&self, feature: &str) -> AppError {
        let reason = self.reason();
        let message = self.message().to_ascii_lowercase();
        if reason == "PREMIUM_REQUIRED" || message.contains("premium") {
            return AppError::new("music_spotify_premium_required", PREMIUM_MESSAGE);
        }
        if reason == "NO_ACTIVE_DEVICE" {
            return no_device_error();
        }
        if reason == "VOLUME_CONTROL_DISALLOW" {
            return volume_error();
        }
        if self.status == 403 && message.contains("scope") {
            return AppError::with_details(
                "music_spotify_missing_scope",
                format!(
                    "{feature} needs a Spotify permission this sign-in didn't grant. Open Music Player settings and press Connect to sign in again."
                ),
                json!({ "feature": feature }),
            );
        }
        AppError::with_details(
            "music_spotify_request_failed",
            format!(
                "Spotify couldn't do that right now (HTTP {}). Try again in a moment.",
                self.status
            ),
            json!({ "status": self.status, "reason": reason, "feature": feature }),
        )
    }
}

#[derive(Clone)]
pub(super) struct Spotify {
    pub state: AppState,
    http: reqwest::Client,
    accounts_base: String,
    api_base: String,
}

impl Spotify {
    pub fn new(state: &AppState) -> AppResult<Self> {
        Self::with_bases(state, ACCOUNTS_BASE, API_BASE)
    }

    pub fn with_bases(state: &AppState, accounts_base: &str, api_base: &str) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|error| AppError::new("music_spotify_client", error.to_string()))?;
        Ok(Self {
            state: state.clone(),
            http,
            accounts_base: accounts_base.trim_end_matches('/').to_owned(),
            api_base: api_base.trim_end_matches('/').to_owned(),
        })
    }

    /// Sends a request with the 15-second timeout, and waits out one 429 (at most 5 s) before retrying once.
    async fn send(
        &self,
        build: impl Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    ) -> AppResult<Reply> {
        let mut retried = false;
        loop {
            let response = build(&self.http)
                .send()
                .await
                .map_err(|_| timeout_error())?;
            let status = response.status().as_u16();
            if status == 429 {
                if retried {
                    return Err(AppError::new(
                        "music_spotify_rate_limited",
                        RATE_LIMITED_MESSAGE,
                    ));
                }
                retried = true;
                let wait = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.trim().parse::<u64>().ok())
                    .map(Duration::from_secs)
                    .unwrap_or(Duration::from_secs(1))
                    .min(MAX_RETRY_AFTER);
                tokio::time::sleep(wait).await;
                continue;
            }
            let text = response.text().await.map_err(|_| timeout_error())?;
            let body = if text.trim().is_empty() {
                Value::Null
            } else {
                serde_json::from_str(&text).unwrap_or(Value::String(text))
            };
            return Ok(Reply { status, body });
        }
    }

    /// Posts a form to Spotify's token endpoint.
    pub async fn token_request(&self, form: String) -> AppResult<Reply> {
        let url = format!("{}/api/token", self.accounts_base);
        self.send(|http| {
            http.post(&url)
                .header("content-type", "application/x-www-form-urlencoded")
                .body(form.clone())
        })
        .await
    }

    /// A usable access token, refreshing first when it is missing or about to expire.
    pub async fn access_token(&self) -> AppResult<String> {
        let account = load_account(&self.state)?.ok_or_else(not_connected)?;
        if let Some(token) = account.usable_access_token(now_ms()) {
            return Ok(token.to_owned());
        }
        let gate = refresh_gate(&self.state);
        let _guard = gate.lock().await;
        // Another request may have refreshed while this one waited.
        let account = load_account(&self.state)?.ok_or_else(not_connected)?;
        if let Some(token) = account.usable_access_token(now_ms()) {
            return Ok(token.to_owned());
        }
        self.refresh_locked(account).await
    }

    /// Refreshes after a 401 on `stale`, unless another request already replaced that token.
    async fn refresh_after_rejection(&self, stale: &str) -> AppResult<String> {
        let gate = refresh_gate(&self.state);
        let _guard = gate.lock().await;
        let account = load_account(&self.state)?.ok_or_else(not_connected)?;
        if let Some(token) = account.usable_access_token(now_ms()) {
            if token != stale {
                return Ok(token.to_owned());
            }
        }
        self.refresh_locked(account).await
    }

    /// Must be called with the refresh gate held. A failed refresh keeps the stored tokens.
    async fn refresh_locked(&self, mut account: Account) -> AppResult<String> {
        let reply = self
            .token_request(form_body(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", &account.refresh_token),
                ("client_id", &account.client_id),
            ]))
            .await?;
        if !reply.ok() {
            log::warn!(
                "[music] Spotify token refresh was refused (HTTP {})",
                reply.status
            );
            return Err(reauth_needed());
        }
        let access_token = reply
            .body
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .ok_or_else(reauth_needed)?
            .to_owned();
        let expires_in = reply
            .body
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(3600);
        if let Some(refresh_token) = reply
            .body
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
        {
            account.refresh_token = refresh_token.to_owned();
        }
        if let Some(scope) = reply.body.get("scope").and_then(Value::as_str) {
            account.scope = scope.to_owned();
        }
        account.access_token = Some(access_token.clone());
        account.expires_at_ms = now_ms() + expires_in * 1000;
        save_account(&self.state, &account)?;
        Ok(access_token)
    }

    /// Calls the Web API. A 401 refreshes once and retries once; a second 401 asks for a new sign-in.
    pub async fn api(&self, method: Method, path: &str, body: Option<Value>) -> AppResult<Reply> {
        let url = format!("{}{path}", self.api_base);
        let mut token = self.access_token().await?;
        let mut refreshed = false;
        loop {
            let reply = self
                .send(|http| {
                    let request = http.request(method.clone(), &url).bearer_auth(&token);
                    match &body {
                        Some(body) => request.json(body),
                        // Spotify wants a length on bodiless PUT/POST player calls.
                        None if method != Method::GET => request.header("content-length", "0"),
                        None => request,
                    }
                })
                .await?;
            if reply.status != 401 {
                return Ok(reply);
            }
            if refreshed {
                return Err(reauth_needed());
            }
            refreshed = true;
            token = self.refresh_after_rejection(&token).await?;
        }
    }

    pub async fn get(&self, path: &str, feature: &str) -> AppResult<Value> {
        self.api(Method::GET, path, None)
            .await?
            .into_result(feature)
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    pub(crate) fn test_state(label: &str) -> AppState {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "de-koi-spotify-{label}-{}-{suffix}",
            std::process::id()
        ));
        AppState::from_data_dir(&root, Vec::new()).expect("test state should initialize")
    }

    /// A loopback stand-in for the token endpoint that answers slowly and counts requests.
    async fn slow_token_endpoint(count: Arc<AtomicUsize>) -> String {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let count = count.clone();
                tokio::spawn(async move {
                    let mut buffer = [0_u8; 4096];
                    let _ = stream.read(&mut buffer).await;
                    count.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    let body = r#"{"access_token":"fresh-token","expires_in":3600,"scope":"user-library-read"}"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    fn expired_account() -> Account {
        Account {
            client_id: "client".into(),
            access_token: Some("old-token".into()),
            refresh_token: "refresh-1".into(),
            expires_at_ms: now_ms() + 10_000,
            scope: "user-library-read playlist-read-private".into(),
            display_name: None,
            user_id: None,
        }
    }

    #[tokio::test]
    async fn concurrent_requests_cause_exactly_one_refresh_and_keep_the_refresh_token() {
        let state = test_state("refresh");
        save_account(&state, &expired_account()).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let base = slow_token_endpoint(count.clone()).await;
        let spotify = Spotify::with_bases(&state, &base, &base).unwrap();
        let other = spotify.clone();

        let (first, second, third) = tokio::join!(
            spotify.access_token(),
            other.access_token(),
            spotify.access_token()
        );
        assert_eq!(first.unwrap(), "fresh-token");
        assert_eq!(second.unwrap(), "fresh-token");
        assert_eq!(third.unwrap(), "fresh-token");
        assert_eq!(count.load(Ordering::SeqCst), 1);

        let stored = load_account(&state).unwrap().unwrap();
        // Spotify sent no new refresh token, so the old one stays.
        assert_eq!(stored.refresh_token, "refresh-1");
        assert_eq!(stored.scope, "user-library-read");
        let raw = account_record(&state).unwrap().unwrap().to_string();
        assert!(!raw.contains("fresh-token") && !raw.contains("refresh-1"));
    }

    #[tokio::test]
    async fn a_failed_refresh_keeps_the_stored_tokens() {
        let state = test_state("refresh-fail");
        save_account(&state, &expired_account()).unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer).await;
            let body = r#"{"error":"invalid_grant"}"#;
            let response = format!(
                "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
        });
        let base = format!("http://127.0.0.1:{port}");
        let spotify = Spotify::with_bases(&state, &base, &base).unwrap();
        let error = spotify.access_token().await.unwrap_err();
        assert_eq!(error.code, "music_spotify_reauth");
        assert_eq!(error.message, REAUTH_MESSAGE);
        let stored = load_account(&state).unwrap().unwrap();
        assert_eq!(stored.refresh_token, "refresh-1");
        assert_eq!(stored.access_token.as_deref(), Some("old-token"));
    }

    #[test]
    fn missing_scopes_are_named_and_unknown_scopes_are_not_blocked() {
        let mut account = expired_account();
        assert_eq!(
            account.missing_scopes(&["user-library-read", "user-modify-playback-state"]),
            vec!["user-modify-playback-state"]
        );
        account.scope.clear();
        assert!(account
            .missing_scopes(&["user-modify-playback-state"])
            .is_empty());
    }

    #[test]
    fn premium_and_device_rejections_get_their_messages() {
        let premium = Reply {
            status: 403,
            body: json!({ "error": { "status": 403, "message": "Player command failed: Premium required", "reason": "PREMIUM_REQUIRED" } }),
        };
        assert_eq!(premium.error("Playback").message, PREMIUM_MESSAGE);
        let no_device = Reply {
            status: 404,
            body: json!({ "error": { "reason": "NO_ACTIVE_DEVICE" } }),
        };
        assert_eq!(no_device.error("Playback").message, NO_DEVICE_MESSAGE);
    }
}
