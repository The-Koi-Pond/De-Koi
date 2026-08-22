use super::{canonical_memory, entity_commands};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};

const JOBS_COLLECTION: &str = "memory-capture-jobs";

fn worker_id(body: &Value) -> AppResult<&str> {
    body.get("workerId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| AppError::invalid_input("Memory capture worker id is required"))
}

fn lease_id(body: &Value) -> AppResult<&str> {
    body.get("leaseId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| AppError::invalid_input("Memory capture lease id is required"))
}

pub(crate) fn acquire_worker(state: &AppState, body: Value) -> AppResult<Value> {
    let worker_id = worker_id(&body)?;
    let requested_lease = body.get("leaseId").and_then(Value::as_str);
    let acquired = state.acquire_memory_capture_worker(worker_id, requested_lease)?;
    Ok(json!({ "acquired": acquired.is_some(), "leaseId": acquired }))
}

pub(crate) fn release_worker(state: &AppState, body: Value) -> AppResult<Value> {
    let worker_id = worker_id(&body)?;
    let lease_id = lease_id(&body)?;
    let released = state.release_memory_capture_worker(worker_id, lease_id)?;
    Ok(json!({ "released": released }))
}

pub(crate) fn update_job(state: &AppState, body: Value) -> AppResult<Value> {
    let lease_id = lease_id(&body)?;
    let job_id = body
        .get("jobId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Memory capture job id is required"))?;
    let patch = body
        .get("patch")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| AppError::invalid_input("Memory capture job patch is required"))?;
    state.with_memory_capture_lease(lease_id, || {
        state
            .storage
            .patch(JOBS_COLLECTION, job_id, Value::Object(patch))
    })
}

pub(crate) fn create_memory(state: &AppState, body: Value) -> AppResult<Value> {
    let lease_id = lease_id(&body)?;
    let memory = body
        .get("memory")
        .cloned()
        .ok_or_else(|| AppError::invalid_input("Canonical memory body is required"))?;
    state.with_memory_capture_lease(lease_id, || canonical_memory::create_memory(state, memory))
}

pub(crate) fn update_memory(state: &AppState, body: Value) -> AppResult<Value> {
    let lease_id = lease_id(&body)?;
    let memory_id = body
        .get("memoryId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Canonical memory id is required"))?;
    let patch = body
        .get("patch")
        .cloned()
        .ok_or_else(|| AppError::invalid_input("Canonical memory patch is required"))?;
    state.with_memory_capture_lease(lease_id, || {
        canonical_memory::update_memory(state, memory_id, patch)
    })
}

pub(crate) fn patch_message_extra(state: &AppState, body: Value) -> AppResult<Value> {
    let lease_id = lease_id(&body)?;
    let message_id = body
        .get("messageId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Memory capture message id is required"))?;
    let patch = body
        .get("patch")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| AppError::invalid_input("Memory capture message patch is required"))?;
    state.with_memory_capture_lease(lease_id, || {
        let message = state
            .storage
            .get("messages", message_id)?
            .ok_or_else(|| AppError::not_found("Message not found"))?;
        let mut extra = message
            .get("extra")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        extra.extend(patch);
        entity_commands::storage_update_inner(
            state,
            "messages".to_string(),
            message_id.to_string(),
            json!({ "extra": extra }),
        )
    })
}

pub(crate) fn rebuild_index(state: &AppState, body: Value) -> AppResult<Value> {
    let lease_id = lease_id(&body)?;
    let query = body
        .get("query")
        .cloned()
        .filter(|value| !value.is_null())
        .unwrap_or_else(|| json!({}));
    state.with_memory_capture_lease(lease_id, || {
        canonical_memory::rebuild_memory_lexical_index(state, query)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        AppState::from_data_dir(
            std::env::temp_dir().join(format!("de-koi-memory-capture-{label}-{nonce}")),
            Vec::new(),
        )
        .expect("test state should initialize")
    }

    #[test]
    fn memory_capture_worker_fences_job_updates() {
        let state = test_state("lease-fence");
        state
            .storage
            .create(
                JOBS_COLLECTION,
                json!({ "id": "job-1", "status": "pending" }),
            )
            .expect("job should seed");
        state
            .storage
            .create(
                "messages",
                json!({ "id": "message-1", "chatId": "chat-1", "content": "hello", "extra": {} }),
            )
            .expect("message should seed");
        let first = acquire_worker(&state, json!({ "workerId": "browser-a" })).unwrap();
        assert!(
            acquire_worker(&state, json!({ "workerId": "browser-b" })).unwrap()["leaseId"]
                .is_null()
        );
        let lease_id = first["leaseId"].as_str().expect("lease should exist");
        update_job(
            &state,
            json!({ "leaseId": lease_id, "jobId": "job-1", "patch": { "status": "processing" } }),
        )
        .expect("lease owner should update");
        patch_message_extra(
            &state,
            json!({
                "leaseId": lease_id,
                "messageId": "message-1",
                "patch": { "memoryCapture": { "status": "processing" } }
            }),
        )
        .expect("lease owner should patch message status");
        release_worker(
            &state,
            json!({ "workerId": "browser-a", "leaseId": lease_id }),
        )
        .expect("lease should release");
        let stale = update_job(
            &state,
            json!({ "leaseId": lease_id, "jobId": "job-1", "patch": { "status": "completed" } }),
        )
        .expect_err("released lease must not update");
        assert_eq!(stale.code, "memory_capture_lease_lost");
        let stale_memory = create_memory(&state, json!({ "leaseId": lease_id, "memory": {} }))
            .expect_err("released lease must not create canonical memory");
        assert_eq!(stale_memory.code, "memory_capture_lease_lost");
        let stale_message = patch_message_extra(
            &state,
            json!({ "leaseId": lease_id, "messageId": "message-1", "patch": { "memoryCapture": {} } }),
        )
        .expect_err("released lease must not patch message status");
        assert_eq!(stale_message.code, "memory_capture_lease_lost");
        let stale_index = rebuild_index(&state, json!({ "leaseId": lease_id, "query": {} }))
            .expect_err("released lease must not rebuild the canonical index");
        assert_eq!(stale_index.code, "memory_capture_lease_lost");
    }
}
