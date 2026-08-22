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
    }
}
