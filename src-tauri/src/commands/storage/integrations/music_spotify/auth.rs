//! Spotify sign-in: Authorization Code with PKCE (no client secret). A sign-in finishes through
//! whichever arrives first: the one-time local listener on the redirect URI, the hosted server's
//! `GET /spotify/callback` route, or the address the user pastes back. Each sign-in is valid for
//! 10 minutes and can be used once.

use super::super::super::connection_secrets;
use super::super::super::images::percent_encode_component;
use super::api::{self, form_body, now_ms, save_account, Account, Spotify};
use crate::state::AppState;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use marinara_core::{AppError, AppResult};
use rand::{rngs::SysRng, TryRng};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;

pub(super) const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:8754/spotify/callback";
pub(super) const CALLBACK_PATH: &str = "/spotify/callback";
pub(super) const SCOPES: &[&str] = &[
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-library-read",
    "playlist-read-private",
    "playlist-read-collaborative",
];
const PENDING_KEY_PREFIX: &str = "music-spotify-sign-in-";
const SIGN_IN_TTL_MS: u64 = 10 * 60 * 1000;
/// How long a finished sign-in keeps answering status checks.
const FINISHED_TTL_MS: u64 = 2 * 60 * 1000;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_HEAD_BYTES: usize = 8 * 1024;
const MAX_PASTED_URL_CHARS: usize = 4096;

pub(super) const EXPIRED_MESSAGE: &str =
    "This sign-in has expired or was already used. Press Connect to try again.";

fn expired_error() -> AppError {
    AppError::new("music_spotify_sign_in_expired", EXPIRED_MESSAGE)
}

// ── Redirect URI ──

/// Accepts only `https://` addresses or `http://127.0.0.1` addresses, with no user info, fragment or spaces.
pub(super) fn validate_redirect_uri(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty() || value.chars().any(char::is_whitespace) {
        return Err("it must be one address with no spaces".into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "it isn't a valid address".to_string())?;
    if !url.username().is_empty() || url.password().is_some() || value.contains('@') {
        return Err("it must not contain user info".into());
    }
    if url.fragment().is_some() || value.contains('#') {
        return Err("it must not contain a fragment (#...)".into());
    }
    match (url.scheme(), url.host_str()) {
        ("https", Some(host)) if !host.is_empty() => Ok(value.to_owned()),
        ("http", Some("127.0.0.1")) => Ok(value.to_owned()),
        _ => Err("it must start with https:// or http://127.0.0.1".into()),
    }
}

fn configured_redirect_uri(env_value: Option<String>) -> String {
    let Some(raw) = env_value.filter(|value| !value.trim().is_empty()) else {
        return DEFAULT_REDIRECT_URI.to_owned();
    };
    match validate_redirect_uri(&raw) {
        Ok(value) => value,
        Err(reason) => {
            let message = format!(
                "SPOTIFY_REDIRECT_URI was rejected because {reason}; using {DEFAULT_REDIRECT_URI} instead"
            );
            log::error!("{message}");
            eprintln!("{message}");
            DEFAULT_REDIRECT_URI.to_owned()
        }
    }
}

/// The redirect URI registered in the user's Spotify app. Read once; an invalid override is logged.
pub(super) fn redirect_uri() -> &'static str {
    static VALUE: OnceLock<String> = OnceLock::new();
    VALUE.get_or_init(|| configured_redirect_uri(std::env::var("SPOTIFY_REDIRECT_URI").ok()))
}

// ── Pending sign-ins ──

fn pending_key(sign_in_id: &str) -> String {
    format!("{PENDING_KEY_PREFIX}{sign_in_id}")
}

/// Serializes take/finish of pending records so a sign-in can't be used twice.
fn pending_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn number(record: &Value, key: &str) -> u64 {
    record.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Removes pending records; `keep_unexpired` keeps the ones that may still answer status checks.
fn prune_pending(state: &AppState, keep_unexpired: bool) -> AppResult<()> {
    let now = now_ms();
    for record in state.storage.list("app-settings")? {
        let Some(id) = record.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !id.starts_with(PENDING_KEY_PREFIX) {
            continue;
        }
        let finished = number(&record, "finishedAtMs");
        let alive = if finished > 0 {
            now.saturating_sub(finished) <= FINISHED_TTL_MS
        } else {
            now.saturating_sub(number(&record, "createdAtMs")) <= SIGN_IN_TTL_MS
        };
        if !(keep_unexpired && alive) {
            let _ = state.storage.delete("app-settings", id)?;
        }
    }
    Ok(())
}

struct TakenSignIn {
    verifier: String,
    client_id: String,
    redirect_uri: String,
}

/// Takes the verifier of a waiting sign-in. A second take, or one after 10 minutes, fails.
fn take_pending(state: &AppState, sign_in_id: &str, now: u64) -> AppResult<TakenSignIn> {
    let _guard = pending_lock();
    let key = pending_key(sign_in_id);
    let record = state
        .storage
        .get("app-settings", &key)?
        .ok_or_else(expired_error)?;
    let verifier_encrypted = record
        .get("verifierEncrypted")
        .and_then(Value::as_str)
        .ok_or_else(expired_error)?;
    if now.saturating_sub(number(&record, "createdAtMs")) > SIGN_IN_TTL_MS {
        finish_pending_locked(state, &key, Err(EXPIRED_MESSAGE))?;
        return Err(expired_error());
    }
    let verifier = connection_secrets::decrypt_secret(state, verifier_encrypted)
        .map_err(|_| expired_error())?;
    let client_id = record
        .get("clientId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let redirect_uri = record
        .get("redirectUri")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_REDIRECT_URI)
        .to_owned();
    state.storage.upsert_with_id(
        "app-settings",
        &key,
        json!({ "createdAtMs": number(&record, "createdAtMs"), "inProgress": true }),
    )?;
    Ok(TakenSignIn {
        verifier,
        client_id,
        redirect_uri,
    })
}

fn finish_pending_locked(state: &AppState, key: &str, outcome: Result<(), &str>) -> AppResult<()> {
    let record = match outcome {
        Ok(()) => json!({ "outcome": "done", "finishedAtMs": now_ms() }),
        Err(message) => {
            json!({ "outcome": "failed", "message": message, "finishedAtMs": now_ms() })
        }
    };
    state.storage.upsert_with_id("app-settings", key, record)?;
    Ok(())
}

fn finish_pending(state: &AppState, sign_in_id: &str, outcome: Result<(), &str>) -> AppResult<()> {
    let _guard = pending_lock();
    finish_pending_locked(state, &pending_key(sign_in_id), outcome)
}

/// Where a sign-in stands: `waiting`, `done` or `failed` (with a message naming the next step).
pub(super) fn sign_in_status(state: &AppState, sign_in_id: &str) -> AppResult<Value> {
    let record = state
        .storage
        .get("app-settings", &pending_key(sign_in_id))?;
    let now = now_ms();
    let Some(record) = record else {
        return Ok(json!({ "status": "failed", "message": EXPIRED_MESSAGE }));
    };
    Ok(match record.get("outcome").and_then(Value::as_str) {
        Some("done") => json!({ "status": "done" }),
        Some(_) => json!({
            "status": "failed",
            "message": record.get("message").and_then(Value::as_str).unwrap_or(EXPIRED_MESSAGE),
        }),
        None if now.saturating_sub(number(&record, "createdAtMs")) > SIGN_IN_TTL_MS => {
            json!({ "status": "failed", "message": EXPIRED_MESSAGE })
        }
        None => json!({
            "status": "waiting",
            "expiresInMs": SIGN_IN_TTL_MS.saturating_sub(now.saturating_sub(number(&record, "createdAtMs"))),
        }),
    })
}

fn random_token() -> AppResult<String> {
    let mut bytes = [0_u8; 32];
    SysRng.try_fill_bytes(&mut bytes).map_err(|_| {
        AppError::new(
            "music_spotify_random",
            "Couldn't start the Spotify sign-in. Press Connect to try again.",
        )
    })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub(super) fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub(super) fn build_auth_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> String {
    let scope = SCOPES.join(" ");
    let params = [
        ("client_id", client_id),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("state", state),
        ("scope", scope.as_str()),
        ("code_challenge_method", "S256"),
        ("code_challenge", challenge),
    ];
    let query = params
        .iter()
        .map(|(key, value)| format!("{key}={}", percent_encode_component(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{}/authorize?{query}", api::ACCOUNTS_BASE)
}

/// Starts a sign-in. Any older sign-in stops being valid.
pub(super) async fn start(state: &AppState, client_id: &str) -> AppResult<Value> {
    let redirect_uri = redirect_uri().to_owned();
    let verifier = random_token()?;
    let sign_in_id = random_token()?;
    {
        let _guard = pending_lock();
        prune_pending(state, false)?;
        state.storage.upsert_with_id(
            "app-settings",
            &pending_key(&sign_in_id),
            json!({
                "verifierEncrypted": connection_secrets::encrypt_secret(state, &verifier)?,
                "clientId": client_id,
                "redirectUri": redirect_uri,
                "createdAtMs": now_ms(),
            }),
        )?;
    }
    let local_listener = ensure_local_listener(state, &redirect_uri).await;
    Ok(json!({
        "provider": "spotify",
        "signInId": sign_in_id,
        "authUrl": build_auth_url(client_id, &redirect_uri, &sign_in_id, &code_challenge(&verifier)),
        "redirectUri": redirect_uri,
        "expiresInMs": SIGN_IN_TTL_MS,
        "localListener": local_listener,
    }))
}

/// Parses `code`, `state` and `error` from a callback query or a pasted address.
pub(super) fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            (!key.is_empty()).then(|| (percent_decode(key), percent_decode(value)))
        })
        .collect()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let high = (bytes[index + 1] as char).to_digit(16);
                let low = (bytes[index + 2] as char).to_digit(16);
                if let (Some(high), Some(low)) = (high, low) {
                    output.push((high * 16 + low) as u8);
                    index += 3;
                } else {
                    output.push(b'%');
                    index += 1;
                }
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

/// Finishes a sign-in from callback parameters. Used by all three completion paths.
pub(super) async fn complete(state: &AppState, params: &HashMap<String, String>) -> AppResult<()> {
    let sign_in_id = params
        .get("state")
        .filter(|value| !value.is_empty())
        .ok_or_else(expired_error)?;
    let taken = take_pending(state, sign_in_id, now_ms())?;
    let result = finish_with_code(state, params, &taken).await;
    let outcome = result
        .as_ref()
        .map(|_| ())
        .map_err(|error| error.message.as_str());
    finish_pending(state, sign_in_id, outcome)?;
    stop_local_listener(state);
    result
}

async fn finish_with_code(
    state: &AppState,
    params: &HashMap<String, String>,
    taken: &TakenSignIn,
) -> AppResult<()> {
    if let Some(error) = params.get("error") {
        let message = if error == "access_denied" {
            "Spotify sign-in was cancelled. Press Connect to try again.".to_owned()
        } else {
            format!("Spotify refused the sign-in ({error}). Check the Client ID and redirect URI in your Spotify app, then press Connect.")
        };
        return Err(AppError::new("music_spotify_sign_in_refused", message));
    }
    let code = params
        .get("code")
        .filter(|code| !code.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "music_spotify_sign_in_refused",
                "Spotify didn't send a sign-in code. Press Connect to try again.",
            )
        })?;
    let spotify = Spotify::new(state)?;
    let reply = spotify
        .token_request(form_body(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &taken.redirect_uri),
            ("client_id", &taken.client_id),
            ("code_verifier", &taken.verifier),
        ]))
        .await?;
    if !reply.ok() {
        return Err(AppError::with_details(
            "music_spotify_sign_in_refused",
            "Spotify didn't accept the sign-in. Check that the redirect URI in your Spotify app matches the one in Music Player settings, then press Connect.",
            json!({ "status": reply.status }),
        ));
    }
    let token = |key: &str| {
        reply
            .body
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };
    let (Some(access_token), Some(refresh_token)) = (token("access_token"), token("refresh_token"))
    else {
        return Err(AppError::new(
            "music_spotify_sign_in_refused",
            "Spotify finished the sign-in but sent no tokens. Press Connect to try again.",
        ));
    };
    let expires_in = reply
        .body
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(3600);
    let mut account = Account {
        client_id: taken.client_id.clone(),
        access_token: Some(access_token),
        refresh_token,
        expires_at_ms: now_ms() + expires_in * 1000,
        scope: token("scope").unwrap_or_default(),
        display_name: None,
        user_id: None,
    };
    save_account(state, &account)?;
    // The display name is optional: a failed profile read still leaves the account connected.
    if let Ok(profile) = spotify.get("/me", "Reading your Spotify profile").await {
        account = api::load_account(state)?.unwrap_or(account);
        account.display_name = profile
            .get("display_name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        account.user_id = profile
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        save_account(state, &account)?;
    }
    super::library::clear_cache(state);
    Ok(())
}

/// Paste-back: the full address the browser was sent to.
pub(super) async fn finish_pasted(state: &AppState, pasted: &str) -> AppResult<()> {
    let pasted = pasted.trim();
    let invalid = || {
        AppError::new(
            "music_spotify_invalid_callback",
            "That doesn't look like the Spotify sign-in address. Copy the whole address from the browser's address bar and paste it again.",
        )
    };
    if pasted.is_empty() || pasted.len() > MAX_PASTED_URL_CHARS {
        return Err(invalid());
    }
    let query = pasted
        .split_once('?')
        .map(|(_, query)| query)
        .ok_or_else(invalid)?;
    let query = query.split('#').next().unwrap_or_default();
    let params = parse_query(query);
    if !params.contains_key("state")
        || !(params.contains_key("code") || params.contains_key("error"))
    {
        return Err(invalid());
    }
    complete(state, &params).await
}

// ── Callback pages (local listener and server route) ──

/// Handles a browser callback and returns the HTTP status and page to show.
pub(super) async fn callback_page(state: &AppState, query: &str) -> (u16, String) {
    let params = parse_query(query);
    match complete(state, &params).await {
        Ok(()) => (
            200,
            page(
                "Spotify connected",
                "Spotify connected. You can close this tab.",
            ),
        ),
        Err(error) => (
            400,
            page(
                "Spotify connection failed",
                &format!("Spotify connection failed: {}", error.message),
            ),
        ),
    }
}

fn page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{title}</title><style>body{{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5;color:#1d2433;background:#f5f7fb}}@media (prefers-color-scheme:dark){{body{{color:#e6e9ef;background:#11151c}}}}h1{{font-size:1.25rem}}</style></head><body><h1>{title}</h1><p>{message}</p></body></html>",
        title = html_escape(title),
        message = html_escape(message),
    )
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// ── One-time local listener (desktop) ──

struct ListenerSlot {
    data_dir: PathBuf,
    alive: Arc<AtomicBool>,
    stop: Arc<Notify>,
    deadline: Arc<Mutex<tokio::time::Instant>>,
}

fn listener_slot() -> std::sync::MutexGuard<'static, Option<ListenerSlot>> {
    static SLOT: OnceLock<Mutex<Option<ListenerSlot>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn local_port(redirect_uri: &str) -> Option<u16> {
    let url = reqwest::Url::parse(redirect_uri).ok()?;
    (url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.path() == CALLBACK_PATH)
        .then(|| url.port_or_known_default())
        .flatten()
}

fn extend_running_listener(state: &AppState) -> bool {
    let slot = listener_slot();
    match slot.as_ref() {
        Some(slot) if slot.data_dir == state.data_dir && slot.alive.load(Ordering::SeqCst) => {
            *slot.deadline.lock().unwrap_or_else(PoisonError::into_inner) =
                tokio::time::Instant::now() + Duration::from_millis(SIGN_IN_TTL_MS);
            true
        }
        _ => false,
    }
}

/// Listens on the redirect URI's loopback port until the sign-in finishes or expires. Returns false
/// when the redirect URI isn't local or the port is taken (the server route and paste-back still work).
async fn ensure_local_listener(state: &AppState, redirect_uri: &str) -> bool {
    let Some(port) = local_port(redirect_uri) else {
        return false;
    };
    if extend_running_listener(state) {
        return true;
    }
    let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
        Ok(listener) => listener,
        Err(error) => {
            log::info!("[music] Spotify callback port {port} unavailable: {error}");
            return extend_running_listener(state);
        }
    };
    let alive = Arc::new(AtomicBool::new(true));
    let stop = Arc::new(Notify::new());
    let deadline = Arc::new(Mutex::new(
        tokio::time::Instant::now() + Duration::from_millis(SIGN_IN_TTL_MS),
    ));
    *listener_slot() = Some(ListenerSlot {
        data_dir: state.data_dir.clone(),
        alive: alive.clone(),
        stop: stop.clone(),
        deadline: deadline.clone(),
    });
    tokio::spawn(run_listener(state.clone(), listener, alive, stop, deadline));
    true
}

fn stop_local_listener(state: &AppState) {
    if let Some(slot) = listener_slot().as_ref() {
        if slot.data_dir == state.data_dir {
            slot.stop.notify_one();
        }
    }
}

async fn run_listener(
    state: AppState,
    listener: TcpListener,
    alive: Arc<AtomicBool>,
    stop: Arc<Notify>,
    deadline: Arc<Mutex<tokio::time::Instant>>,
) {
    // A finished sign-in (on any path) notifies `stop`; stray or forged requests don't end the wait.
    loop {
        let until = *deadline.lock().unwrap_or_else(PoisonError::into_inner);
        if tokio::time::Instant::now() >= until {
            break;
        }
        tokio::select! {
            _ = stop.notified() => break,
            _ = tokio::time::sleep(Duration::from_secs(1)) => continue,
            accepted = listener.accept() => {
                if let Ok((stream, _)) = accepted {
                    handle_connection(&state, stream).await;
                }
            }
        }
    }
    // Free the port before a new sign-in can see this listener as gone.
    drop(listener);
    alive.store(false, Ordering::SeqCst);
}

/// Answers one request on the loopback port.
async fn handle_connection(state: &AppState, mut stream: TcpStream) {
    let Some(head) = read_request_head(&mut stream).await else {
        return;
    };
    let mut request_line = head.lines().next().unwrap_or_default().split_whitespace();
    let method = request_line.next().unwrap_or_default();
    let target = request_line.next().unwrap_or_default();
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let (status, body) = if path != CALLBACK_PATH {
        (
            404,
            page("Not found", "This page only finishes a Spotify sign-in."),
        )
    } else if method != "GET" {
        (405, page("Not allowed", "This page only accepts GET."))
    } else {
        callback_page(state, query).await
    };
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Bad Request",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn read_request_head(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    let read = async {
        loop {
            let count = stream.read(&mut chunk).await.ok()?;
            if count == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..count]);
            if buffer.windows(4).any(|window| window == b"\r\n\r\n")
                || buffer.len() >= MAX_REQUEST_HEAD_BYTES
            {
                break;
            }
        }
        Some(())
    };
    tokio::time::timeout(REQUEST_READ_TIMEOUT, read)
        .await
        .ok()??;
    (!buffer.is_empty()).then(|| String::from_utf8_lossy(&buffer).into_owned())
}

#[cfg(test)]
mod tests {
    use super::super::api::tests::test_state;
    use super::*;

    fn store_pending(state: &AppState, id: &str, created_at_ms: u64) {
        state
            .storage
            .upsert_with_id(
                "app-settings",
                &pending_key(id),
                json!({
                    "verifierEncrypted": connection_secrets::encrypt_secret(state, "verifier").unwrap(),
                    "clientId": "client",
                    "redirectUri": DEFAULT_REDIRECT_URI,
                    "createdAtMs": created_at_ms,
                }),
            )
            .unwrap();
    }

    #[test]
    fn redirect_uri_accepts_https_and_loopback_only() {
        assert!(validate_redirect_uri("https://music.example.com/spotify/callback").is_ok());
        assert!(validate_redirect_uri("http://127.0.0.1:8754/spotify/callback").is_ok());
        for bad in [
            "http://localhost:8754/spotify/callback",
            "http://example.com/spotify/callback",
            "https://user:pass@example.com/spotify/callback",
            "https://user@example.com/cb",
            "https://example.com/cb#frag",
            "https://example.com/spotify callback",
            "ftp://example.com/cb",
            "not a url",
            "http://127.0.0.1.evil.com/cb",
        ] {
            assert!(
                validate_redirect_uri(bad).is_err(),
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn invalid_override_falls_back_to_the_default() {
        assert_eq!(configured_redirect_uri(None), DEFAULT_REDIRECT_URI);
        assert_eq!(
            configured_redirect_uri(Some("http://evil.example/cb".into())),
            DEFAULT_REDIRECT_URI
        );
        assert_eq!(
            configured_redirect_uri(Some("https://pi.example/spotify/callback".into())),
            "https://pi.example/spotify/callback"
        );
    }

    #[test]
    fn auth_url_uses_pkce_state_and_exact_scopes() {
        let url = build_auth_url("client-id", DEFAULT_REDIRECT_URI, "the-state", "challenge");
        let query = parse_query(url.split_once('?').unwrap().1);
        assert_eq!(query["client_id"], "client-id");
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["redirect_uri"], DEFAULT_REDIRECT_URI);
        assert_eq!(query["state"], "the-state");
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["code_challenge"], "challenge");
        assert_eq!(query["scope"], SCOPES.join(" "));
        assert!(!url.contains("client_secret"));
        // S256: base64url(sha256(verifier)) without padding, checked against Node's crypto.
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mJ0kzaw9WgXcQ1MKoXo8b2MV3QM7Cc"),
            "Q6FopBBMpqJbVMfX5QF97eTl5U6TG0QBo-bP0JXfprc"
        );
    }

    #[test]
    fn a_sign_in_can_be_taken_once() {
        let state = test_state("single-use");
        store_pending(&state, "abc", now_ms());
        let taken = take_pending(&state, "abc", now_ms()).unwrap();
        assert_eq!(taken.verifier, "verifier");
        assert_eq!(taken.client_id, "client");
        let second = take_pending(&state, "abc", now_ms()).err().unwrap();
        assert_eq!(second.message, EXPIRED_MESSAGE);
        assert_eq!(
            take_pending(&state, "unknown", now_ms())
                .err()
                .unwrap()
                .message,
            EXPIRED_MESSAGE
        );
    }

    #[test]
    fn a_sign_in_expires_after_ten_minutes() {
        let state = test_state("expiry");
        let created = now_ms() - SIGN_IN_TTL_MS - 1;
        store_pending(&state, "old", created);
        assert_eq!(sign_in_status(&state, "old").unwrap()["status"], "failed");
        let error = take_pending(&state, "old", now_ms()).err().unwrap();
        assert_eq!(error.code, "music_spotify_sign_in_expired");
        assert_eq!(
            sign_in_status(&state, "old").unwrap()["message"],
            EXPIRED_MESSAGE
        );

        store_pending(&state, "fresh", now_ms() - SIGN_IN_TTL_MS + 5_000);
        assert_eq!(
            sign_in_status(&state, "fresh").unwrap()["status"],
            "waiting"
        );
        assert!(take_pending(&state, "fresh", now_ms()).is_ok());
    }

    #[tokio::test]
    async fn a_cancelled_callback_fails_the_sign_in_and_cannot_be_reused() {
        let state = test_state("cancel");
        store_pending(&state, "cancel-me", now_ms());
        let (status, body) = callback_page(&state, "error=access_denied&state=cancel-me").await;
        assert_eq!(status, 400);
        assert!(body.contains("Spotify connection failed: Spotify sign-in was cancelled."));
        let status = sign_in_status(&state, "cancel-me").unwrap();
        assert_eq!(status["status"], "failed");
        let (_, again) = callback_page(&state, "code=x&state=cancel-me").await;
        assert!(again.contains("expired or was already used"));
        assert!(api::load_account(&state).unwrap().is_none());
    }

    #[tokio::test]
    async fn pasted_addresses_must_carry_state_and_code() {
        let state = test_state("paste");
        let error = finish_pasted(&state, "https://example.com/nothing")
            .await
            .unwrap_err();
        assert_eq!(error.code, "music_spotify_invalid_callback");
        let error = finish_pasted(
            &state,
            "http://127.0.0.1:8754/spotify/callback?code=abc&state=missing",
        )
        .await
        .unwrap_err();
        assert_eq!(error.message, EXPIRED_MESSAGE);
    }

    async fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn the_local_listener_ignores_forged_callbacks_and_stops_after_the_sign_in() {
        let state = test_state("listener");
        let port = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let redirect = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
        assert!(ensure_local_listener(&state, &redirect).await);
        store_pending(&state, "real", now_ms());

        let other = get(port, "/favicon.ico").await;
        assert!(other.starts_with("HTTP/1.1 404"));
        let forged = get(port, "/spotify/callback?code=x&state=forged").await;
        assert!(
            forged.starts_with("HTTP/1.1 400") && forged.contains("expired or was already used")
        );
        assert_eq!(sign_in_status(&state, "real").unwrap()["status"], "waiting");

        let cancelled = get(port, "/spotify/callback?error=access_denied&state=real").await;
        assert!(cancelled.contains("Spotify connection failed: Spotify sign-in was cancelled."));
        for _ in 0..50 {
            if TcpStream::connect((Ipv4Addr::LOCALHOST, port))
                .await
                .is_err()
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("the listener should stop once the sign-in finished");
    }

    #[test]
    fn starting_over_replaces_older_sign_ins() {
        let state = test_state("prune");
        store_pending(&state, "older", now_ms());
        prune_pending(&state, false).unwrap();
        assert_eq!(sign_in_status(&state, "older").unwrap()["status"], "failed");
    }
}
