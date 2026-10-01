use super::deki;
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn deki_prompt(state: State<'_, AppState>, request: Value) -> Result<Value, AppError> {
    deki::deki_prompt(&state, request, &deki::DekiRuntimeOwner::Embedded).await
}

/// Embedded streaming variant of `deki_prompt`: live workspace events go to
/// `on_event`; the command resolves with the final response.
#[tauri::command]
pub async fn deki_prompt_events(
    state: State<'_, AppState>,
    request: Value,
    on_event: tauri::ipc::Channel<Value>,
) -> Result<Value, AppError> {
    let events = deki::DekiEventSink::new(move |event| {
        // A closed channel means the webview stopped listening; the run
        // continues and the final response still resolves the command.
        let _ = on_event.send(event);
    });
    deki::deki_prompt_with_events(&state, request, &deki::DekiRuntimeOwner::Embedded, events).await
}

#[tauri::command]
pub async fn professor_mari_prompt(
    state: State<'_, AppState>,
    request: Value,
) -> Result<Value, AppError> {
    deki::deki_prompt(&state, request, &deki::DekiRuntimeOwner::Embedded).await
}

#[tauri::command]
pub async fn deki_workspace_status(
    state: State<'_, AppState>,
    session_id: String,
    connection_id: Option<String>,
) -> Result<Value, AppError> {
    deki::deki_workspace_status(
        &state,
        &deki::DekiRuntimeOwner::Embedded,
        session_id,
        connection_id,
    )
    .await
}

#[tauri::command]
pub async fn deki_workspace_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, AppError> {
    deki::deki_workspace_abort(&state, &deki::DekiRuntimeOwner::Embedded, session_id).await
}

#[tauri::command]
pub async fn deki_workspace_approve(
    state: State<'_, AppState>,
    session_id: String,
    id: String,
) -> Result<Value, AppError> {
    deki::deki_workspace_approve(&state, &deki::DekiRuntimeOwner::Embedded, session_id, id).await
}

#[tauri::command]
pub async fn deki_workspace_reject(
    state: State<'_, AppState>,
    session_id: String,
    id: String,
) -> Result<Value, AppError> {
    deki::deki_workspace_reject(&state, &deki::DekiRuntimeOwner::Embedded, session_id, id).await
}
