#[path = "memory_maintenance/canonical.rs"]
mod canonical;
#[path = "memory_maintenance/chat.rs"]
mod chat;
#[path = "memory_maintenance/contracts.rs"]
mod contracts;

use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::Value;

pub(crate) async fn apply_memory_cleanup(state: &AppState, body: Value) -> AppResult<Value> {
    let request = contracts::parse_apply_request(body)?;
    match request.scope.kind.as_str() {
        "chat" | "scene" => chat::apply_chat_cleanup(state, request).await,
        "character" => canonical::apply_canonical_cleanup(state, request),
        _ => Err(AppError::invalid_input("Unsupported memory cleanup scope")),
    }
}

pub(crate) fn undo_memory_cleanup(state: &AppState, body: Value) -> AppResult<Value> {
    let request = contracts::parse_undo_request(body)?;
    match request.scope.kind.as_str() {
        "chat" | "scene" => chat::undo_chat_cleanup(state, request),
        "character" => canonical::undo_canonical_cleanup(state, request),
        _ => Err(AppError::invalid_input("Unsupported memory cleanup scope")),
    }
}
