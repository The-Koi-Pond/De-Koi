use super::contracts::{CleanupScope, CleanupStore, CleanupTarget};
use crate::state::AppState;
use marinara_core::{now_iso, AppError, AppResult};
use serde_json::{json, Value};

const COLLECTION: &str = "memory-maintenance-jobs";
const POLICY_VERSION: u32 = 1;

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
            "nextAttemptAt": if trigger == Trigger::Undo { Value::Null } else { json!(now) },
            "lastBatchId": null,
            "lastResult": null,
            "createdAt": now,
            "updatedAt": now,
        }),
    )
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
            "memory-maintenance-41f80f86"
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
}
