//! "Log in with OpenRouter": an OAuth PKCE login that saves an OpenRouter key into a connection.
//!
//! The desktop app catches the browser's redirect on a one-off loopback listener. A hosted server
//! (Pi, VDS) can't receive a redirect meant for the user's own device, so it asks OpenRouter to show
//! a code instead and the user pastes it back. Either way the code is exchanged and the key is
//! encrypted into the connection here; the key never goes back to the page.

use super::connection_secrets;
use super::images::percent_encode_component;
use super::shared::{get_required, normalize_update_patch};
use crate::state::AppState;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use marinara_core::{AppError, AppResult};
use rand::{rngs::SysRng, TryRng};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const OPENROUTER_AUTH_URL: &str = "https://openrouter.ai/auth";
const OPENROUTER_API_BASE: &str = "https://openrouter.ai/api/v1";
const CALLBACK_PATH: &str = "/openrouter/callback";
/// Shown next to the key on the user's OpenRouter keys page.
const KEY_LABEL: &str = "De-Koi";
const LOGIN_TTL: Duration = Duration::from_secs(10 * 60);
/// How long a finished login keeps answering status checks.
const FINISHED_TTL: Duration = Duration::from_secs(2 * 60);
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_HEAD_BYTES: usize = 8 * 1024;
const MAX_CODE_CHARS: usize = 512;

const EXPIRED_MESSAGE: &str =
    "This OpenRouter login timed out or was replaced. Start the login again.";

// Every error from this module uses an `openrouter_login_` code: the messages are written for the person
// logging in and name the next step, so the app shows them as they are (see src/shared/lib/error-message.ts).
fn expired_error() -> AppError {
    AppError::new("openrouter_login_expired", EXPIRED_MESSAGE)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LoginMode {
    /// The browser redirects back to a loopback listener on this machine.
    Callback,
    /// OpenRouter shows a code and the user pastes it into De-Koi.
    Code,
}

impl LoginMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Callback => "callback",
            Self::Code => "code",
        }
    }
}

#[derive(Clone, Debug)]
enum Outcome {
    Waiting,
    Done,
    Failed(String),
}

struct PendingLogin {
    connection_id: String,
    /// Taken by the first exchange attempt, so each login can be used once.
    verifier: Option<String>,
    auth_state: String,
    mode: LoginMode,
    api_base: String,
    started: Instant,
    outcome: Outcome,
    finished: Option<Instant>,
    /// Dropping this stops the login's loopback listener.
    _stop_listener: Option<oneshot::Sender<()>>,
}

fn logins() -> std::sync::MutexGuard<'static, HashMap<String, PendingLogin>> {
    static LOGINS: OnceLock<Mutex<HashMap<String, PendingLogin>>> = OnceLock::new();
    LOGINS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn prune(map: &mut HashMap<String, PendingLogin>) {
    for login in map.values_mut() {
        if matches!(login.outcome, Outcome::Waiting) && login.started.elapsed() > LOGIN_TTL {
            login.outcome = Outcome::Failed(EXPIRED_MESSAGE.to_string());
            login.verifier = None;
            login.finished = Some(Instant::now());
            login._stop_listener = None;
        }
    }
    map.retain(|_, login| {
        login
            .finished
            .is_none_or(|finished| finished.elapsed() <= FINISHED_TTL)
    });
}

pub(crate) async fn start(
    state: &AppState,
    connection_id: &str,
    mode: LoginMode,
) -> AppResult<Value> {
    start_with_api_base(state, connection_id, mode, OPENROUTER_API_BASE).await
}

async fn start_with_api_base(
    state: &AppState,
    connection_id: &str,
    requested_mode: LoginMode,
    api_base: &str,
) -> AppResult<Value> {
    require_openrouter_connection(state, connection_id)?;
    let verifier = random_token()?;
    let challenge = code_challenge(&verifier);
    let login_id = random_token()?;
    let auth_state = random_token()?;

    // A loopback port that can't be opened still leaves the paste-a-code login, so fall back to it.
    let loopback = match requested_mode {
        LoginMode::Callback => bind_loopback().await.ok(),
        LoginMode::Code => None,
    };
    let mode = if loopback.is_some() {
        LoginMode::Callback
    } else {
        LoginMode::Code
    };
    let callback_url = loopback
        .as_ref()
        .map(|(_, port)| format!("http://localhost:{port}{CALLBACK_PATH}"));
    let auth_url = build_auth_url(&challenge, callback_url.as_deref(), &auth_state);

    let (stop_sender, stop_receiver) = oneshot::channel();
    {
        let mut map = logins();
        prune(&mut map);
        // A new login for the same connection replaces any older one that is still waiting.
        map.retain(|_, login| {
            login.connection_id != connection_id || !matches!(login.outcome, Outcome::Waiting)
        });
        map.insert(
            login_id.clone(),
            PendingLogin {
                connection_id: connection_id.to_string(),
                verifier: Some(verifier),
                auth_state,
                mode,
                api_base: api_base.to_string(),
                started: Instant::now(),
                outcome: Outcome::Waiting,
                finished: None,
                _stop_listener: loopback.is_some().then_some(stop_sender),
            },
        );
    }
    if let Some((listeners, _)) = loopback {
        tokio::spawn(run_callback_listener(
            state.clone(),
            login_id.clone(),
            listeners,
            stop_receiver,
        ));
    }

    Ok(json!({
        "loginId": login_id,
        "authUrl": auth_url,
        "mode": mode.as_str(),
        "expiresInMs": LOGIN_TTL.as_millis() as u64,
    }))
}

/// Where a login stands: `waiting`, `done` or `failed` (with a message that says what to do).
pub(crate) fn status(login_id: &str) -> AppResult<Value> {
    let mut map = logins();
    prune(&mut map);
    let Some(login) = map.get(login_id) else {
        return Ok(json!({ "status": "failed", "message": EXPIRED_MESSAGE }));
    };
    Ok(match &login.outcome {
        Outcome::Waiting => json!({ "status": "waiting", "connectionId": login.connection_id }),
        Outcome::Done => json!({ "status": "done", "connectionId": login.connection_id }),
        Outcome::Failed(message) => {
            json!({ "status": "failed", "connectionId": login.connection_id, "message": message })
        }
    })
}

/// Finishes a paste-a-code login with the code OpenRouter showed the user.
pub(crate) async fn finish(state: &AppState, login_id: &str, code: &str) -> AppResult<Value> {
    let code = code.trim();
    if code.is_empty() {
        return Err(AppError::new(
            "openrouter_login_invalid_code",
            "Paste the code OpenRouter showed you, then press Finish.",
        ));
    }
    if code.len() > MAX_CODE_CHARS || code.chars().any(char::is_whitespace) {
        return Err(AppError::new(
            "openrouter_login_invalid_code",
            "That doesn't look like an OpenRouter login code. Copy the whole code from the OpenRouter page and paste it again.",
        ));
    }
    let connection_id = complete(state, login_id, code, Some(LoginMode::Code)).await?;
    Ok(json!({ "status": "done", "connectionId": connection_id }))
}

/// Exchanges the code once and records the outcome for status checks.
async fn complete(
    state: &AppState,
    login_id: &str,
    code: &str,
    expected_mode: Option<LoginMode>,
) -> AppResult<String> {
    let (connection_id, verifier, api_base) = {
        let mut map = logins();
        prune(&mut map);
        let login = map.get_mut(login_id).ok_or_else(expired_error)?;
        if expected_mode.is_some_and(|mode| mode != login.mode) {
            return Err(AppError::new(
                "openrouter_login_wrong_mode",
                "This login finishes in the browser. Go back to the OpenRouter page and approve it there.",
            ));
        }
        let verifier = login.verifier.take().ok_or_else(expired_error)?;
        (
            login.connection_id.clone(),
            verifier,
            login.api_base.clone(),
        )
    };
    let result = exchange_and_save(state, &connection_id, code, &verifier, &api_base).await;
    let mut map = logins();
    if let Some(login) = map.get_mut(login_id) {
        login.outcome = match &result {
            Ok(()) => Outcome::Done,
            Err(error) => Outcome::Failed(error.message.clone()),
        };
        login.finished = Some(Instant::now());
        login._stop_listener = None;
    }
    result.map(|()| connection_id)
}

async fn exchange_and_save(
    state: &AppState,
    connection_id: &str,
    code: &str,
    verifier: &str,
    api_base: &str,
) -> AppResult<()> {
    let key = exchange_code(api_base, code, verifier).await?;
    // The connection may have been deleted or switched to another provider while the browser was open.
    require_openrouter_connection(state, connection_id)?;
    let patch = normalize_update_patch("connections", json!({ "apiKey": key }))?;
    connection_secrets::patch_connection(state, connection_id, patch)?;
    Ok(())
}

async fn exchange_code(api_base: &str, code: &str, verifier: &str) -> AppResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| AppError::new("openrouter_login_client", error.to_string()))?;
    let response = client
        .post(format!("{}/auth/keys", api_base.trim_end_matches('/')))
        .json(&json!({
            "code": code,
            "code_verifier": verifier,
            "code_challenge_method": "S256",
        }))
        .send()
        .await
        .map_err(|_| {
            AppError::new(
                "openrouter_login_network",
                "Couldn't reach OpenRouter to finish the login. Check your internet connection, then start the login again.",
            )
        })?;
    let status = response.status();
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(AppError::with_details(
            "openrouter_login_rejected",
            "OpenRouter didn't accept the login. Start the login again.",
            json!({ "status": status.as_u16() }),
        ));
    }
    body.get("key")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::new(
                "openrouter_login_no_key",
                "OpenRouter finished the login but sent no key. Start the login again.",
            )
        })
}

fn require_openrouter_connection(state: &AppState, connection_id: &str) -> AppResult<()> {
    let connection = get_required(state, "connections", connection_id).map_err(|_| {
        AppError::new(
            "openrouter_login_missing_connection",
            "That connection no longer exists. Create a new OpenRouter connection and log in again.",
        )
    })?;
    if connection.get("provider").and_then(Value::as_str) != Some("openrouter") {
        return Err(AppError::new(
            "openrouter_login_wrong_provider",
            "Log in with OpenRouter only works on an OpenRouter connection. Switch the provider to OpenRouter and save first.",
        ));
    }
    Ok(())
}

fn build_auth_url(challenge: &str, callback_url: Option<&str>, auth_state: &str) -> String {
    let mut params = vec![
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("key_label", KEY_LABEL),
    ];
    if let Some(callback_url) = callback_url {
        params.push(("callback_url", callback_url));
        params.push(("state", auth_state));
    }
    let query = params
        .iter()
        .map(|(key, value)| format!("{key}={}", percent_encode_component(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{OPENROUTER_AUTH_URL}?{query}")
}

fn random_token() -> AppResult<String> {
    let mut bytes = [0_u8; 32];
    SysRng.try_fill_bytes(&mut bytes).map_err(|_| {
        AppError::new(
            "openrouter_login_random",
            "Couldn't start the OpenRouter login. Try again.",
        )
    })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// ── Loopback callback (desktop) ──

/// Browsers may resolve `localhost` to either loopback address, so listen on both when possible.
async fn bind_loopback() -> std::io::Result<(Vec<TcpListener>, u16)> {
    let v4 = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let port = v4.local_addr()?.port();
    let mut listeners = vec![v4];
    if let Ok(v6) = TcpListener::bind((Ipv6Addr::LOCALHOST, port)).await {
        listeners.push(v6);
    }
    Ok((listeners, port))
}

async fn run_callback_listener(
    state: AppState,
    login_id: String,
    listeners: Vec<TcpListener>,
    mut stop: oneshot::Receiver<()>,
) {
    let deadline = tokio::time::Instant::now() + LOGIN_TTL;
    loop {
        let stream = tokio::select! {
            _ = &mut stop => return,
            _ = tokio::time::sleep_until(deadline) => return,
            accepted = accept_any(&listeners) => match accepted {
                Ok(stream) => stream,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    continue;
                }
            },
        };
        if handle_callback_connection(&state, &login_id, stream).await {
            return;
        }
    }
}

async fn accept_any(listeners: &[TcpListener]) -> std::io::Result<TcpStream> {
    match listeners {
        [only] => only.accept().await.map(|(stream, _)| stream),
        [first, second, ..] => tokio::select! {
            accepted = first.accept() => accepted.map(|(stream, _)| stream),
            accepted = second.accept() => accepted.map(|(stream, _)| stream),
        },
        [] => std::future::pending().await,
    }
}

struct CallbackReply {
    status: &'static str,
    title: &'static str,
    message: String,
    finished: bool,
}

/// Answers one request on the loopback port. Returns true once the login is finished either way.
async fn handle_callback_connection(
    state: &AppState,
    login_id: &str,
    mut stream: TcpStream,
) -> bool {
    let Some(head) = read_request_head(&mut stream).await else {
        return false;
    };
    let reply = callback_reply(state, login_id, &head).await;
    let page = callback_page(reply.title, &reply.message);
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        reply.status,
        page.len(),
        page
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
    reply.finished
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

async fn callback_reply(state: &AppState, login_id: &str, head: &str) -> CallbackReply {
    let not_found = || CallbackReply {
        status: "404 Not Found",
        title: "Not found",
        message: "This page is only for finishing an OpenRouter login.".to_string(),
        finished: false,
    };
    let mut request_line = head.lines().next().unwrap_or_default().split_whitespace();
    let (Some("GET"), Some(target)) = (request_line.next(), request_line.next()) else {
        return not_found();
    };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return not_found();
    }
    let params = parse_query(query);

    let expected_state = logins().get(login_id).map(|login| login.auth_state.clone());
    let Some(expected_state) = expected_state else {
        return CallbackReply {
            status: "400 Bad Request",
            title: "Login expired",
            message: format!("{EXPIRED_MESSAGE} You can close this tab."),
            finished: true,
        };
    };
    // Only the browser De-Koi sent to OpenRouter knows this value, so a stray or forged request
    // can't finish (or cancel) the login.
    if params.get("state").map(String::as_str) != Some(expected_state.as_str()) {
        return CallbackReply {
            status: "400 Bad Request",
            title: "Wrong login link",
            message: "This link doesn't belong to the login De-Koi started. Go back to De-Koi and start the login again.".to_string(),
            finished: false,
        };
    }
    if params.contains_key("error") {
        let message = "OpenRouter login was cancelled. Go back to De-Koi and start it again if you want to connect.";
        record_failure(login_id, message);
        return CallbackReply {
            status: "400 Bad Request",
            title: "Login cancelled",
            message: message.to_string(),
            finished: true,
        };
    }
    let Some(code) = params.get("code").filter(|code| !code.is_empty()) else {
        let message =
            "OpenRouter didn't send a login code. Go back to De-Koi and start the login again.";
        record_failure(login_id, message);
        return CallbackReply {
            status: "400 Bad Request",
            title: "Login failed",
            message: message.to_string(),
            finished: true,
        };
    };
    match complete(state, login_id, code, Some(LoginMode::Callback)).await {
        Ok(_) => CallbackReply {
            status: "200 OK",
            title: "Logged in to OpenRouter",
            message: "Your OpenRouter key is saved in De-Koi. You can close this tab and go back to De-Koi.".to_string(),
            finished: true,
        },
        Err(error) => CallbackReply {
            status: "400 Bad Request",
            title: "Login failed",
            message: error.message,
            finished: true,
        },
    }
}

fn record_failure(login_id: &str, message: &str) {
    let mut map = logins();
    if let Some(login) = map.get_mut(login_id) {
        login.outcome = Outcome::Failed(message.to_string());
        login.verifier = None;
        login.finished = Some(Instant::now());
        login._stop_listener = None;
    }
}

fn parse_query(query: &str) -> HashMap<String, String> {
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

fn callback_page(title: &str, message: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> (AppState, std::path::PathBuf) {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "de-koi-openrouter-login-{label}-{}-{suffix}",
            std::process::id()
        ));
        let state =
            AppState::from_data_dir(&root, Vec::new()).expect("test state should initialize");
        (state, root)
    }

    fn store_connection(state: &AppState, id: &str, provider: &str) {
        state
            .storage
            .upsert_with_id(
                "connections",
                id,
                json!({ "name": "OpenRouter", "provider": provider, "model": "" }),
            )
            .expect("connection should be stored");
    }

    /// A stand-in for OpenRouter's key exchange that answers once and hands back the request body.
    async fn serve_key_exchange(
        status: u16,
        body: &'static str,
    ) -> (String, oneshot::Receiver<Value>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("mock should bind");
        let port = listener
            .local_addr()
            .expect("mock should have a port")
            .port();
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("mock should accept");
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            loop {
                let count = stream.read(&mut chunk).await.expect("mock should read");
                request.extend_from_slice(&chunk[..count]);
                let text = String::from_utf8_lossy(&request).to_string();
                if let Some((head, rest)) = text.split_once("\r\n\r\n") {
                    let length = head
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            if name.eq_ignore_ascii_case("content-length") {
                                value.trim().parse::<usize>().ok()
                            } else {
                                None
                            }
                        })
                        .unwrap_or(0);
                    if rest.len() >= length {
                        assert!(head.starts_with("POST /api/v1/auth/keys "), "{head}");
                        let _ = sender.send(serde_json::from_str(rest).unwrap_or(Value::Null));
                        break;
                    }
                }
                if count == 0 {
                    break;
                }
            }
            let response = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("mock should reply");
        });
        (format!("http://127.0.0.1:{port}/api/v1"), receiver)
    }

    async fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .expect("callback listener should accept");
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes())
            .await
            .expect("request should send");
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .await
            .expect("response should read");
        response
    }

    fn auth_params(auth_url: &str) -> HashMap<String, String> {
        let (base, query) = auth_url
            .split_once('?')
            .expect("auth URL should have a query");
        assert_eq!(base, OPENROUTER_AUTH_URL);
        parse_query(query)
    }

    fn saved_key(state: &AppState, id: &str) -> Option<String> {
        connection_secrets::connection_for_runtime(state, id)
            .expect("connection should load")
            .get("apiKey")
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    fn login_id(started: &Value) -> String {
        started["loginId"].as_str().expect("login id").to_string()
    }

    #[test]
    fn auth_url_sends_pkce_and_only_sends_state_with_a_callback() {
        let callback = auth_params(&build_auth_url(
            "challenge-123",
            Some("http://localhost:5000/openrouter/callback"),
            "state-456",
        ));
        assert_eq!(callback["code_challenge"], "challenge-123");
        assert_eq!(callback["code_challenge_method"], "S256");
        assert_eq!(callback["key_label"], "De-Koi");
        assert_eq!(
            callback["callback_url"],
            "http://localhost:5000/openrouter/callback"
        );
        assert_eq!(callback["state"], "state-456");

        let code = auth_params(&build_auth_url("challenge-123", None, "state-456"));
        assert_eq!(code["code_challenge"], "challenge-123");
        assert!(!code.contains_key("callback_url"));
        assert!(!code.contains_key("state"));
    }

    #[tokio::test]
    async fn start_refuses_a_connection_that_is_not_openrouter() {
        let (state, root) = test_state("not-openrouter");
        store_connection(&state, "openai-conn", "openai");

        let error = start(&state, "openai-conn", LoginMode::Code)
            .await
            .expect_err("only OpenRouter connections can log in");
        assert!(error
            .message
            .contains("only works on an OpenRouter connection"));
        let missing = start(&state, "missing-conn", LoginMode::Code)
            .await
            .expect_err("missing connections can't log in");
        assert!(missing.message.contains("no longer exists"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn callback_login_ignores_stray_and_forged_requests_then_saves_the_key_encrypted() {
        let (state, root) = test_state("callback");
        store_connection(&state, "or-callback", "openrouter");
        let (api_base, exchange_body) =
            serve_key_exchange(200, r#"{"key":"sk-or-v1-callback"}"#).await;

        let started = start_with_api_base(&state, "or-callback", LoginMode::Callback, &api_base)
            .await
            .expect("login should start");
        assert_eq!(started["mode"], "callback");
        let login_id = login_id(&started);
        let params = auth_params(started["authUrl"].as_str().expect("auth URL"));
        let port: u16 = params["callback_url"]
            .strip_prefix("http://localhost:")
            .and_then(|rest| rest.strip_suffix(CALLBACK_PATH))
            .and_then(|port| port.parse().ok())
            .expect("callback URL should name a localhost port");

        let stray = get(port, "/favicon.ico").await;
        assert!(stray.starts_with("HTTP/1.1 404"), "{stray}");
        let forged = get(
            port,
            &format!("{CALLBACK_PATH}?code=attacker&state=guessed"),
        )
        .await;
        assert!(forged.starts_with("HTTP/1.1 400"), "{forged}");
        let forged_cancel = get(port, &format!("{CALLBACK_PATH}?error=access_denied")).await;
        assert!(forged_cancel.starts_with("HTTP/1.1 400"), "{forged_cancel}");
        assert_eq!(status(&login_id).expect("status")["status"], "waiting");

        let finished = get(
            port,
            &format!("{CALLBACK_PATH}?code=real-code&state={}", params["state"]),
        )
        .await;
        assert!(finished.starts_with("HTTP/1.1 200"), "{finished}");
        assert!(finished.contains("Logged in to OpenRouter"));

        let sent = exchange_body
            .await
            .expect("exchange should have been called");
        assert_eq!(sent["code"], "real-code");
        assert_eq!(sent["code_challenge_method"], "S256");
        let verifier = sent["code_verifier"].as_str().expect("verifier");
        assert_eq!(code_challenge(verifier), params["code_challenge"]);

        let done = status(&login_id).expect("status");
        assert_eq!(done["status"], "done");
        assert!(!done.to_string().contains("sk-or-v1-callback"));
        assert_eq!(
            saved_key(&state, "or-callback").as_deref(),
            Some("sk-or-v1-callback")
        );
        let stored = state
            .storage
            .get("connections", "or-callback")
            .expect("read")
            .expect("connection");
        assert!(stored.get("apiKey").is_none());
        assert!(stored["apiKeyEncrypted"]
            .as_str()
            .is_some_and(|value| value.starts_with("v1:")));

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn code_login_finishes_once_and_refuses_a_reused_login() {
        let (state, root) = test_state("code");
        store_connection(&state, "or-code", "openrouter");
        let (api_base, exchange_body) = serve_key_exchange(200, r#"{"key":"sk-or-v1-code"}"#).await;

        let started = start_with_api_base(&state, "or-code", LoginMode::Code, &api_base)
            .await
            .expect("login should start");
        assert_eq!(started["mode"], "code");
        let login_id = login_id(&started);
        assert!(!auth_params(started["authUrl"].as_str().expect("auth URL"))
            .contains_key("callback_url"));

        let blank = finish(&state, &login_id, "   ")
            .await
            .expect_err("blank code");
        assert!(blank.message.contains("Paste the code"));
        let done = finish(&state, &login_id, " pasted-code \n")
            .await
            .expect("pasted code should finish the login");
        assert_eq!(done["status"], "done");
        assert_eq!(
            exchange_body.await.expect("exchange")["code"],
            "pasted-code"
        );
        assert_eq!(
            saved_key(&state, "or-code").as_deref(),
            Some("sk-or-v1-code")
        );

        let reused = finish(&state, &login_id, "pasted-code")
            .await
            .expect_err("a login can only finish once");
        assert!(reused.message.contains("Start the login again"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn callback_login_cannot_be_finished_with_a_pasted_code() {
        let (state, root) = test_state("wrong-mode");
        store_connection(&state, "or-wrong-mode", "openrouter");

        let started = start(&state, "or-wrong-mode", LoginMode::Callback)
            .await
            .expect("login should start");
        let login_id = login_id(&started);
        let error = finish(&state, &login_id, "some-code")
            .await
            .expect_err("callback logins finish in the browser");
        assert!(error.message.contains("finishes in the browser"));
        assert_eq!(status(&login_id).expect("status")["status"], "waiting");

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn rejected_exchange_fails_the_login_without_saving_a_key() {
        let (state, root) = test_state("rejected");
        store_connection(&state, "or-rejected", "openrouter");
        let (api_base, _) = serve_key_exchange(400, r#"{"error":"invalid code"}"#).await;

        let started = start_with_api_base(&state, "or-rejected", LoginMode::Code, &api_base)
            .await
            .expect("login should start");
        let login_id = login_id(&started);
        let error = finish(&state, &login_id, "bad-code")
            .await
            .expect_err("rejected codes fail");
        assert!(error.message.contains("didn't accept the login"));
        assert_eq!(status(&login_id).expect("status")["status"], "failed");
        assert!(saved_key(&state, "or-rejected").is_none());

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_new_login_replaces_one_still_waiting_for_the_same_connection() {
        let (state, root) = test_state("replace");
        store_connection(&state, "or-replace", "openrouter");

        let first = start(&state, "or-replace", LoginMode::Code)
            .await
            .expect("first");
        let second = start(&state, "or-replace", LoginMode::Code)
            .await
            .expect("second");
        let (first_id, second_id) = (login_id(&first), login_id(&second));
        assert_ne!(first_id, second_id);
        assert_eq!(status(&first_id).expect("status")["status"], "failed");
        assert_eq!(status(&second_id).expect("status")["status"], "waiting");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn query_parsing_decodes_percent_escapes_and_pages_escape_html() {
        let params = parse_query("code=a%2Bb%3D&state=x+y&flag");
        assert_eq!(params["code"], "a+b=");
        assert_eq!(params["state"], "x y");
        assert_eq!(params["flag"], "");
        assert_eq!(percent_decode("100%"), "100%");
        assert!(callback_page("<b>", "<script>").contains("&lt;script&gt;"));
    }
}
