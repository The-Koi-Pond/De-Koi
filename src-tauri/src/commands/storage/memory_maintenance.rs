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

pub(crate) async fn apply_memory_cleanup(
    state: &AppState,
    body: Value,
    lease_id: Option<&str>,
) -> AppResult<Value> {
    let request = contracts::parse_apply_request(body)?;
    if let Some(lease_id) = lease_id {
        state.assert_memory_maintenance_lease(lease_id)?;
    }
    match request.store {
        contracts::CleanupStore::Chat => {
            chat::apply_chat_cleanup_with_lease(state, request, lease_id).await
        }
        contracts::CleanupStore::Canonical => {
            canonical::apply_canonical_cleanup_with_lease(state, request, lease_id)
        }
    }
}

pub(crate) fn acquire_memory_maintenance_worker(state: &AppState, body: Value) -> AppResult<Value> {
    jobs::acquire_memory_maintenance_worker(state, body)
}

pub(crate) fn release_memory_maintenance_worker(state: &AppState, body: Value) -> AppResult<Value> {
    jobs::release_memory_maintenance_worker(state, body)
}

pub(crate) fn update_memory_maintenance_job(state: &AppState, body: Value) -> AppResult<Value> {
    jobs::update_memory_maintenance_job(state, body)
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
