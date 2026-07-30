#[path = "memory_maintenance/canonical.rs"]
mod canonical;
#[path = "memory_maintenance/chat.rs"]
mod chat;
#[path = "memory_maintenance/contracts.rs"]
pub(crate) mod contracts;
#[path = "memory_maintenance/jobs.rs"]
pub(crate) mod jobs;

use crate::state::AppState;
use marinara_core::AppResult;
use serde_json::Value;

pub(crate) async fn apply_memory_cleanup(state: &AppState, body: Value) -> AppResult<Value> {
    let request = contracts::parse_apply_request(body)?;
    match request.store {
        contracts::CleanupStore::Chat => chat::apply_chat_cleanup(state, request).await,
        contracts::CleanupStore::Canonical => canonical::apply_canonical_cleanup(state, request),
    }
}

pub(crate) fn undo_memory_cleanup(state: &AppState, body: Value) -> AppResult<Value> {
    let request = contracts::parse_undo_request(body)?;
    let target = jobs::target(request.store, &request.scope.kind, &request.scope.id);
    let result = match request.store {
        contracts::CleanupStore::Chat => chat::undo_chat_cleanup(state, request),
        contracts::CleanupStore::Canonical => canonical::undo_canonical_cleanup(state, request),
    }?;
    jobs::enqueue_memory_maintenance(state, target, jobs::Trigger::Undo)?;
    Ok(result)
}
