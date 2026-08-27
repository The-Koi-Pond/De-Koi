use super::canonical_memory;
use crate::state::AppState;
use marinara_core::{now_iso, AppError, AppResult};
use serde_json::{json, Map, Value};

const JOBS_COLLECTION: &str = "memory-capture-jobs";
const STORY_JOBS_COLLECTION: &str = "story-consolidation-jobs";

fn merge_object_patch(target: &mut Map<String, Value>, patch: Map<String, Value>) {
    for (key, value) in patch {
        match (target.get_mut(&key), value) {
            (Some(Value::Object(current)), Value::Object(patch)) => {
                merge_object_patch(current, patch);
            }
            (_, value) => {
                target.insert(key, value);
            }
        }
    }
}

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

pub(crate) fn update_story_job(state: &AppState, body: Value) -> AppResult<Value> {
    let lease_id = lease_id(&body)?;
    let job_id = body
        .get("jobId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Story consolidation job id is required"))?;
    let patch = body
        .get("patch")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| AppError::invalid_input("Story consolidation job patch is required"))?;
    state.with_memory_capture_lease(lease_id, || {
        state
            .storage
            .patch(STORY_JOBS_COLLECTION, job_id, Value::Object(patch))
    })
}

pub(crate) fn commit_story_projection(state: &AppState, body: Value) -> AppResult<Value> {
    let lease_id = lease_id(&body)?;
    let job_id = body
        .get("jobId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Story consolidation job id is required"))?;
    let memory = body
        .get("memory")
        .cloned()
        .ok_or_else(|| AppError::invalid_input("Story projection memory body is required"))?;
    state.with_memory_capture_lease(lease_id, || {
        canonical_memory::commit_story_projection_job(state, job_id, memory)
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
        state
            .storage
            .update_record_journaled("messages", message_id, move |message| {
                let object = message
                    .as_object_mut()
                    .ok_or_else(|| AppError::invalid_input("Stored message is not an object"))?;
                let extra = object
                    .entry("extra".to_string())
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .ok_or_else(|| {
                        AppError::invalid_input("Stored message extra is not an object")
                    })?;
                merge_object_patch(extra, patch);
                object.insert("updatedAt".to_string(), Value::String(now_iso()));
                Ok(message.clone())
            })
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
                STORY_JOBS_COLLECTION,
                json!({ "id": "story-job-1", "status": "pending" }),
            )
            .expect("story job should seed");
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
        let stale_story_job = update_story_job(
            &state,
            json!({ "leaseId": lease_id, "jobId": "story-job-1", "patch": { "status": "processing" } }),
        )
        .expect_err("released lease must not update a story job");
        assert_eq!(stale_story_job.code, "memory_capture_lease_lost");
        let stale_story_commit = commit_story_projection(
            &state,
            json!({ "leaseId": lease_id, "jobId": "story-job-1", "memory": {} }),
        )
        .expect_err("released lease must not commit a story projection");
        assert_eq!(stale_story_commit.code, "memory_capture_lease_lost");
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

    #[test]
    fn memory_capture_message_patch_atomically_preserves_newer_extra_fields() {
        let state = test_state("message-extra-merge");
        state
            .storage
            .create(
                "messages",
                json!({
                    "id": "message-1",
                    "chatId": "chat-1",
                    "content": "hello",
                    "extra": {
                        "foregroundWriter": { "revision": 2 },
                        "memoryCapture": { "jobId": "job-1", "attempts": 2 }
                    }
                }),
            )
            .expect("message should seed");
        let lease = acquire_worker(&state, json!({ "workerId": "browser-a" })).unwrap();
        let lease_id = lease["leaseId"].as_str().expect("lease should exist");

        patch_message_extra(
            &state,
            json!({
                "leaseId": lease_id,
                "messageId": "message-1",
                "patch": { "memoryCapture": { "status": "completed" } }
            }),
        )
        .expect("capture patch should persist");

        let message = state
            .storage
            .get("messages", "message-1")
            .expect("message read should succeed")
            .expect("message should exist");
        assert_eq!(message["extra"]["foregroundWriter"]["revision"], json!(2));
        assert_eq!(message["extra"]["memoryCapture"]["jobId"], json!("job-1"));
        assert_eq!(message["extra"]["memoryCapture"]["attempts"], json!(2));
        assert_eq!(
            message["extra"]["memoryCapture"]["status"],
            json!("completed")
        );
    }

    fn story_episode(id: &str, fingerprint: &str, supersedes: Option<&str>) -> Value {
        json!({
            "id": id,
            "kind": "episode",
            "status": "active",
            "scope": { "kind": "chat", "id": "chat-1" },
            "title": "Episode",
            "content": "A durable episode summary.",
            "confidence": 0.9,
            "provenance": { "sourceChatId": "chat-1", "messageIds": ["message-1", "message-2"] },
            "tags": ["story-continuity", "episode"],
            "supersedesMemoryId": supersedes,
            "payload": {
                "storyProjectionVersion": 1,
                "level": "episode",
                "ownerChatId": "chat-1",
                "coverageId": "coverage-1",
                "sourceFingerprint": fingerprint,
                "messageIds": ["message-1", "message-2"],
                "firstMessageId": "message-1",
                "lastMessageId": "message-2",
                "sourceEpisodeIds": [],
                "sections": {},
                "summarizer": { "version": "story-projection-v1", "completedAt": "2026-08-27T00:00:00Z" }
            }
        })
    }

    #[test]
    fn story_projection_commit_atomically_replaces_and_completes() {
        let state = test_state("story-atomic-commit");
        canonical_memory::create_memory(&state, story_episode("episode-old", "old", None))
            .expect("old projection should seed");
        state
            .storage
            .create(
                STORY_JOBS_COLLECTION,
                json!({
                    "id": "story-job-1",
                    "status": "processing",
                    "level": "episode",
                    "ownerChatId": "chat-1",
                    "coverageId": "coverage-1",
                    "sourceFingerprint": "new",
                    "supersedesMemoryId": "episode-old"
                }),
            )
            .expect("story job should seed");
        let lease = acquire_worker(&state, json!({ "workerId": "story:browser-a" }))
            .expect("lease should be acquired");
        let lease_id = lease["leaseId"].as_str().expect("lease should exist");

        let result = commit_story_projection(
            &state,
            json!({
                "leaseId": lease_id,
                "jobId": "story-job-1",
                "memory": story_episode("episode-new", "new", Some("episode-old"))
            }),
        )
        .expect("story projection should commit");

        assert_eq!(result["memory"]["id"], json!("episode-new"));
        assert_eq!(result["job"]["status"], json!("completed"));
        let old = state
            .storage
            .get("canonical-memories", "episode-old")
            .unwrap()
            .unwrap();
        assert_eq!(old["status"], json!("superseded"));
        assert_eq!(old["supersededByMemoryId"], json!("episode-new"));
    }

    #[test]
    fn failed_story_replacement_keeps_the_last_projection_and_job() {
        let state = test_state("story-atomic-rollback");
        state
            .storage
            .create(
                STORY_JOBS_COLLECTION,
                json!({
                    "id": "story-job-1",
                    "status": "processing",
                    "level": "episode",
                    "ownerChatId": "chat-1",
                    "coverageId": "coverage-1",
                    "sourceFingerprint": "new",
                    "supersedesMemoryId": "missing-episode"
                }),
            )
            .expect("story job should seed");
        let lease = acquire_worker(&state, json!({ "workerId": "story:browser-a" })).unwrap();
        let lease_id = lease["leaseId"].as_str().unwrap();

        commit_story_projection(
            &state,
            json!({
                "leaseId": lease_id,
                "jobId": "story-job-1",
                "memory": story_episode("episode-new", "new", Some("missing-episode"))
            }),
        )
        .expect_err("missing replacement source must abort the transaction");

        assert!(state
            .storage
            .get("canonical-memories", "episode-new")
            .unwrap()
            .is_none());
        assert_eq!(
            state
                .storage
                .get(STORY_JOBS_COLLECTION, "story-job-1")
                .unwrap()
                .unwrap()["status"],
            json!("processing")
        );
    }
}
