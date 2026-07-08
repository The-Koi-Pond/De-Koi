use crate::state::AppState;
use marinara_core::AppResult;
use serde_json::Value;

#[cfg(test)]
pub(crate) use marinara_sidecar::SIDECAR_MODEL;
pub(crate) use marinara_sidecar::{
    is_sidecar_connection_id, SidecarInferenceLease, SIDECAR_CONNECTION_ID,
};

fn sidecar_state(state: &AppState) -> marinara_sidecar::LocalSidecarState {
    marinara_sidecar::LocalSidecarState::new(state.data_dir.clone())
}

pub(crate) async fn status(state: &AppState) -> AppResult<Value> {
    marinara_sidecar::status(&sidecar_state(state)).await
}

pub(crate) fn log_tail(state: &AppState, max_lines: usize) -> AppResult<Value> {
    marinara_sidecar::log_tail(&sidecar_state(state), max_lines)
}

pub(crate) async fn update_config(state: &AppState, body: Value) -> AppResult<Value> {
    marinara_sidecar::update_config(&sidecar_state(state), body).await
}

pub(crate) async fn runtime_install(state: &AppState, body: Value) -> AppResult<Value> {
    marinara_sidecar::runtime_install(&sidecar_state(state), body).await
}

pub(crate) async fn download_curated(state: &AppState, body: Value) -> AppResult<Value> {
    marinara_sidecar::download_curated(&sidecar_state(state), body).await
}

pub(crate) async fn list_huggingface_models(state: &AppState, body: Value) -> AppResult<Value> {
    marinara_sidecar::list_huggingface_models(&sidecar_state(state), body).await
}

pub(crate) async fn download_custom(state: &AppState, body: Value) -> AppResult<Value> {
    marinara_sidecar::download_custom(&sidecar_state(state), body).await
}

pub(crate) async fn download_cancel(state: &AppState) -> AppResult<Value> {
    marinara_sidecar::download_cancel(&sidecar_state(state)).await
}

pub(crate) async fn delete_model(state: &AppState) -> AppResult<Value> {
    marinara_sidecar::delete_model(&sidecar_state(state)).await
}

pub(crate) async fn start(state: &AppState) -> AppResult<Value> {
    marinara_sidecar::start(&sidecar_state(state)).await
}

pub(crate) async fn stop(state: &AppState) -> AppResult<Value> {
    marinara_sidecar::stop(&sidecar_state(state)).await
}

pub(crate) async fn restart(state: &AppState) -> AppResult<Value> {
    marinara_sidecar::restart(&sidecar_state(state)).await
}

pub(crate) async fn runtime_connection_value(
    state: &AppState,
    require_enabled: bool,
) -> AppResult<Value> {
    marinara_sidecar::runtime_connection_value(&sidecar_state(state), require_enabled).await
}

pub(crate) async fn begin_inference_request(
    state: &AppState,
    require_enabled: bool,
) -> AppResult<SidecarInferenceLease> {
    marinara_sidecar::begin_inference_request(&sidecar_state(state), require_enabled).await
}

pub(crate) async fn models(state: &AppState) -> AppResult<Value> {
    marinara_sidecar::models(&sidecar_state(state)).await
}

pub(crate) async fn test_message(state: &AppState) -> AppResult<Value> {
    marinara_sidecar::test_message(&sidecar_state(state)).await
}
