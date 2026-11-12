use super::{integrations, translation};
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn tts_config(state: State<'_, AppState>) -> Result<Value, AppError> {
    integrations::tts_call(&state, "GET", &["config"], Value::Null).await
}

#[tauri::command]
pub async fn tts_update_config(
    state: State<'_, AppState>,
    config: Value,
) -> Result<Value, AppError> {
    integrations::tts_call(&state, "PUT", &["config"], config).await
}

#[tauri::command]
pub async fn tts_voices(state: State<'_, AppState>) -> Result<Value, AppError> {
    integrations::tts_call(&state, "GET", &["voices"], Value::Null).await
}

#[tauri::command]
pub async fn tts_speak(state: State<'_, AppState>, input: Value) -> Result<Value, AppError> {
    integrations::tts_call(&state, "POST", &["speak"], input).await
}

/// A character's voice note: speak the text and keep the audio as a managed file of the chat.
#[tauri::command]
pub async fn tts_voice_note(state: State<'_, AppState>, input: Value) -> Result<Value, AppError> {
    integrations::tts_call(&state, "POST", &["voice-note"], input).await
}

#[tauri::command]
pub async fn stt_transcribe(state: State<'_, AppState>, input: Value) -> Result<Value, AppError> {
    integrations::tts_call(&state, "POST", &["transcribe"], input).await
}

#[tauri::command]
pub async fn translate_text_command(
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, AppError> {
    translation::translate_text(&state, input).await
}

#[tauri::command]
pub async fn discord_webhook_send(body: Value) -> Result<Value, AppError> {
    integrations::discord_webhook_send(body).await
}

async fn music_direct(
    state: State<'_, AppState>,
    method: &str,
    rest: &[&str],
    body: Value,
) -> Result<Value, AppError> {
    integrations::music_call(&state, method, rest, body).await
}

#[tauri::command]
pub async fn music_status(
    state: State<'_, AppState>,
    body: Option<Value>,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["status"], body.unwrap_or(Value::Null)).await
}

#[tauri::command]
pub async fn music_search_candidates(
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["search-candidates"], input).await
}

#[tauri::command]
pub async fn music_play(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    music_direct(state, "POST", &["play"], body).await
}

#[tauri::command]
pub async fn music_pause(
    state: State<'_, AppState>,
    body: Option<Value>,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["pause"], body.unwrap_or(Value::Null)).await
}

#[tauri::command]
pub async fn music_stop(
    state: State<'_, AppState>,
    body: Option<Value>,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["stop"], body.unwrap_or(Value::Null)).await
}

#[tauri::command]
pub async fn music_set_volume(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    music_direct(state, "POST", &["volume"], body).await
}

#[tauri::command]
pub async fn music_fresh_pick(state: State<'_, AppState>, input: Value) -> Result<Value, AppError> {
    music_direct(state, "POST", &["fresh-pick"], input).await
}

#[tauri::command]
pub async fn music_resume(
    state: State<'_, AppState>,
    body: Option<Value>,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["resume"], body.unwrap_or(Value::Null)).await
}

#[tauri::command]
pub async fn music_playback_state(
    state: State<'_, AppState>,
    body: Option<Value>,
) -> Result<Value, AppError> {
    music_direct(
        state,
        "POST",
        &["playback-state"],
        body.unwrap_or(Value::Null),
    )
    .await
}

#[tauri::command]
pub async fn music_settings(state: State<'_, AppState>) -> Result<Value, AppError> {
    music_direct(state, "GET", &["settings"], Value::Null).await
}

#[tauri::command]
pub async fn music_update_settings(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["update-settings"], body).await
}

#[tauri::command]
pub async fn music_sign_in_start(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["sign-in-start"], body).await
}

#[tauri::command]
pub async fn music_sign_in_status(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["sign-in-status"], body).await
}

#[tauri::command]
pub async fn music_sign_in_finish(
    state: State<'_, AppState>,
    body: Value,
) -> Result<Value, AppError> {
    music_direct(state, "POST", &["sign-in-finish"], body).await
}

#[tauri::command]
pub async fn music_disconnect(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    music_direct(state, "POST", &["disconnect"], body).await
}

#[tauri::command]
pub async fn music_playlists(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    music_direct(state, "POST", &["playlists"], body).await
}

#[tauri::command]
pub async fn music_devices(state: State<'_, AppState>, body: Value) -> Result<Value, AppError> {
    music_direct(state, "POST", &["devices"], body).await
}
