use super::contracts::{CleanupScope, CleanupStore, CleanupTarget};
use crate::state::AppState;
use marinara_core::{now_iso, AppError, AppResult};
use serde_json::{json, Value};

const COLLECTION: &str = "memory-maintenance-jobs";
const POLICY_VERSION: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Trigger {
    Capture,
    Manual,
    Import,
    Correction,
    Command,
    Undo,
}

impl Trigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Capture => "capture",
            Self::Manual => "manual",
            Self::Import => "import",
            Self::Correction => "correction",
            Self::Command => "command",
            Self::Undo => "undo",
        }
    }
}

pub(crate) fn target(store: CleanupStore, kind: &str, id: &str) -> CleanupTarget {
    CleanupTarget {
        store,
        scope: CleanupScope {
            kind: kind.to_string(),
            id: id.to_string(),
        },
    }
}

fn target_key(target: &CleanupTarget) -> String {
    format!(
        "{}:{}:{}",
        match target.store {
            CleanupStore::Chat => "chat",
            CleanupStore::Canonical => "canonical",
        },
        target.scope.kind,
        target.scope.id
    )
}

pub(crate) fn maintenance_job_id(policy_version: u32, target: &CleanupTarget) -> String {
    let seed = format!("{policy_version}:{}", target_key(target));
    let mut hash = 2166136261_u32;
    for byte in seed.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    format!("memory-maintenance-{hash:08x}")
}

pub(crate) fn enqueue_memory_maintenance(
    state: &AppState,
    target: CleanupTarget,
    trigger: Trigger,
) -> AppResult<Value> {
    let id = maintenance_job_id(POLICY_VERSION, &target);
    let key = target_key(&target);
    let now = now_iso();
    let existing = state.storage.get(COLLECTION, &id)?;
    if let Some(existing) = existing {
        if existing.get("targetKey").and_then(Value::as_str) != Some(key.as_str())
            || existing.get("target")
                != Some(&serde_json::to_value(&target).map_err(|error| {
                    AppError::invalid_input(format!("Invalid memory maintenance target: {error}"))
                })?)
        {
            return Err(AppError::invalid_input(
                "Memory maintenance job id collision",
            ));
        }
        let status = existing
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("pending");
        let patch = if trigger == Trigger::Undo {
            json!({
                "status": "suppressed",
                "dirty": false,
                "trigger": trigger.as_str(),
                "nextAttemptAt": null,
                "updatedAt": now,
            })
        } else if status == "processing" {
            json!({
                "dirty": true,
                "trigger": trigger.as_str(),
                "updatedAt": now,
            })
        } else {
            json!({
                "status": "pending",
                "dirty": false,
                "trigger": trigger.as_str(),
                "attempts": 0,
                "totalPasses": 0,
                "recentFingerprints": [],
                "nextAttemptAt": now,
                "lastBatchId": null,
                "lastResult": null,
                "updatedAt": now,
            })
        };
        return state.storage.patch(COLLECTION, &id, patch);
    }

    let status = if trigger == Trigger::Undo {
        "suppressed"
    } else {
        "pending"
    };
    state.storage.create(
        COLLECTION,
        json!({
            "id": id,
            "targetKey": key,
            "target": target,
            "policyVersion": POLICY_VERSION,
            "status": status,
            "dirty": false,
            "trigger": trigger.as_str(),
            "attempts": 0,
            "maxAttempts": 3,
            "totalPasses": 0,
            "recentFingerprints": [],
            "clarityReviewedFingerprints": [],
            "nextAttemptAt": if trigger == Trigger::Undo { Value::Null } else { json!(now) },
            "lastBatchId": null,
            "lastResult": null,
            "createdAt": now,
            "updatedAt": now,
        }),
    )
}

fn worker_id(body: &Value) -> AppResult<&str> {
    let worker_id = body
        .get("workerId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| AppError::invalid_input("Memory maintenance worker id is required"))?;
    Ok(worker_id)
}

fn lease_id(body: &Value) -> AppResult<&str> {
    body.get("leaseId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| AppError::invalid_input("Memory maintenance lease id is required"))
}

pub(crate) fn acquire_memory_maintenance_worker(state: &AppState, body: Value) -> AppResult<Value> {
    let worker_id = worker_id(&body)?;
    let requested_lease = body.get("leaseId").and_then(Value::as_str);
    let acquired = state.acquire_memory_maintenance_worker(worker_id, requested_lease)?;
    Ok(json!({
        "acquired": acquired.is_some(),
        "leaseId": acquired,
    }))
}

pub(crate) fn release_memory_maintenance_worker(state: &AppState, body: Value) -> AppResult<Value> {
    let worker_id = worker_id(&body)?;
    let lease_id = lease_id(&body)?;
    let released = state.release_memory_maintenance_worker(worker_id, lease_id)?;
    Ok(json!({ "released": released }))
}

pub(crate) fn update_memory_maintenance_job(state: &AppState, body: Value) -> AppResult<Value> {
    let lease_id = lease_id(&body)?;
    let job_id = body
        .get("jobId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Memory maintenance job id is required"))?;
    let patch = body
        .get("patch")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| AppError::invalid_input("Memory maintenance job patch is required"))?;
    state.with_memory_maintenance_lease(lease_id, || {
        state
            .storage
            .patch(COLLECTION, job_id, Value::Object(patch))
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
        let path = std::env::temp_dir().join(format!("de-koi-maintenance-jobs-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test state should initialize")
    }

    #[test]
    fn maintenance_job_repeated_mutations_coalesce_by_target() {
        let state = test_state("coalesce");
        let target = target(CleanupStore::Canonical, "character", "char-1");
        enqueue_memory_maintenance(&state, target.clone(), Trigger::Manual).unwrap();
        enqueue_memory_maintenance(&state, target, Trigger::Command).unwrap();

        let jobs = state.storage.list(COLLECTION).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0]["status"], json!("pending"));
        assert_eq!(jobs[0]["trigger"], json!("command"));
    }

    #[test]
    fn maintenance_job_id_matches_the_typescript_startup_enqueuer() {
        let target = target(CleanupStore::Chat, "chat", "chat-1");
        assert_eq!(
            maintenance_job_id(POLICY_VERSION, &target),
            "memory-maintenance-a12701b1"
        );
    }

    #[test]
    fn maintenance_job_mutation_during_processing_marks_one_dirty_follow_up() {
        let state = test_state("dirty");
        let target = target(CleanupStore::Canonical, "character", "char-1");
        enqueue_memory_maintenance(&state, target.clone(), Trigger::Manual).unwrap();
        let id = maintenance_job_id(POLICY_VERSION, &target);
        state
            .storage
            .patch(
                COLLECTION,
                &id,
                json!({ "status": "processing", "dirty": false }),
            )
            .unwrap();

        enqueue_memory_maintenance(&state, target, Trigger::Command).unwrap();
        let job = state.storage.get(COLLECTION, &id).unwrap().unwrap();
        assert_eq!(job["status"], json!("processing"));
        assert_eq!(job["dirty"], json!(true));
    }

    #[test]
    fn maintenance_job_undo_suppresses_until_a_material_write() {
        let state = test_state("undo");
        let target = target(CleanupStore::Canonical, "character", "char-1");
        enqueue_memory_maintenance(&state, target.clone(), Trigger::Undo).unwrap();
        let id = maintenance_job_id(POLICY_VERSION, &target);
        assert_eq!(
            state.storage.get(COLLECTION, &id).unwrap().unwrap()["status"],
            json!("suppressed")
        );

        enqueue_memory_maintenance(&state, target, Trigger::Manual).unwrap();
        let pending = state.storage.get(COLLECTION, &id).unwrap().unwrap();
        assert_eq!(pending["status"], json!("pending"));
        assert_eq!(pending["totalPasses"], json!(0));
        assert_eq!(pending["recentFingerprints"], json!([]));
    }

    #[test]
    fn maintenance_worker_lease_excludes_other_runtimes_until_release() {
        let state = test_state("worker-lease");

        let first =
            acquire_memory_maintenance_worker(&state, json!({ "workerId": "browser-a" })).unwrap();
        let first_lease = first["leaseId"].as_str().unwrap().to_string();
        assert_eq!(first["acquired"], json!(true));
        assert_eq!(
            acquire_memory_maintenance_worker(&state, json!({ "workerId": "browser-b" })).unwrap()
                ["acquired"],
            json!(false)
        );
        assert_eq!(
            release_memory_maintenance_worker(
                &state,
                json!({ "workerId": "browser-b", "leaseId": first_lease }),
            )
            .unwrap()["released"],
            json!(false)
        );
        assert_eq!(
            release_memory_maintenance_worker(
                &state,
                json!({ "workerId": "browser-a", "leaseId": first_lease }),
            )
            .unwrap()["released"],
            json!(true)
        );
        assert_eq!(
            acquire_memory_maintenance_worker(&state, json!({ "workerId": "browser-b" })).unwrap()
                ["acquired"],
            json!(true)
        );
    }

    #[test]
    fn stale_worker_token_cannot_mutate_a_maintenance_job_after_takeover() {
        let state = test_state("worker-fence");
        let target = target(CleanupStore::Chat, "chat", "chat-1");
        let job = enqueue_memory_maintenance(&state, target, Trigger::Manual).unwrap();
        let job_id = job["id"].as_str().unwrap().to_string();
        let first =
            acquire_memory_maintenance_worker(&state, json!({ "workerId": "browser-a" })).unwrap();
        let first_lease = first["leaseId"].as_str().unwrap().to_string();
        release_memory_maintenance_worker(
            &state,
            json!({ "workerId": "browser-a", "leaseId": first_lease }),
        )
        .unwrap();
        let second =
            acquire_memory_maintenance_worker(&state, json!({ "workerId": "browser-b" })).unwrap();
        let second_lease = second["leaseId"].as_str().unwrap().to_string();

        let stale = update_memory_maintenance_job(
            &state,
            json!({
                "leaseId": first_lease,
                "jobId": job_id,
                "patch": { "status": "processing" }
            }),
        )
        .expect_err("a stale worker token must be fenced out");
        assert_eq!(stale.code, "memory_maintenance_lease_lost");
        assert_eq!(
            state.storage.get(COLLECTION, &job_id).unwrap().unwrap()["status"],
            json!("pending")
        );

        update_memory_maintenance_job(
            &state,
            json!({
                "leaseId": second_lease,
                "jobId": job_id,
                "patch": { "status": "processing" }
            }),
        )
        .unwrap();
        assert_eq!(
            state.storage.get(COLLECTION, &job_id).unwrap().unwrap()["status"],
            json!("processing")
        );
    }
}
