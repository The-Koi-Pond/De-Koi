use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::time::Duration;

const DEFAULT_RESOLVER_URL: &str = "https://dj-resolver.de-koi.app";

fn resolver_base_url() -> String {
    std::env::var("DE_KOI_MUSIC_DJ_RESOLVER_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_RESOLVER_URL.to_string())
}

fn resolver_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| AppError::new("music_dj_client_failed", error.to_string()))
}

async fn resolver_json(method: &str, path: &str, body: Option<Value>) -> AppResult<Value> {
    let url = format!("{}{}", resolver_base_url(), path);
    let client = resolver_client()?;
    let builder = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url).json(&body.unwrap_or(Value::Null)),
        _ => return Err(AppError::invalid_input("Unsupported Music DJ resolver method")),
    };
    let response = builder
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "De-Koi Music DJ")
        .send()
        .await
        .map_err(|error| AppError::new("music_dj_resolver_unreachable", error.to_string()))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| AppError::new("music_dj_resolver_bad_json", error.to_string()))?;
    if !status.is_success() {
        return Err(AppError::new(
            "music_dj_resolver_error",
            value.get("error")
                .and_then(Value::as_str)
                .unwrap_or("Music DJ resolver returned an error"),
        ));
    }
    Ok(value)
}

pub(crate) async fn music_dj_status(_state: &AppState) -> AppResult<Value> {
    resolver_json("GET", "/v1/dj/health", None)
        .await
        .or_else(|error| Ok(json!({ "ok": false, "provider": "youtube", "error": error.message })))
}

pub(crate) async fn music_dj_resolve(_state: &AppState, input: Value) -> AppResult<Value> {
    resolver_json("POST", "/v1/dj/resolve", Some(input)).await
}

pub(crate) async fn music_dj_feedback(_state: &AppState, input: Value) -> AppResult<Value> {
    resolver_json("POST", "/v1/dj/feedback", Some(input)).await
}
