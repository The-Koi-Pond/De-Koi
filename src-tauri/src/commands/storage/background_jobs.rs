//! Durable background work queued after a reply (continuity Director plans and similar).
//!
//! Jobs live in the `background-jobs` collection, so closing the tab that queued one no longer
//! loses it. Any open client can run them: per queue, one worker at a time holds a lease, claims
//! due jobs here, and reports each outcome back. Enqueue, claim and finish all take the same
//! lock, so a trigger that arrives while its job is running is never lost to that run's finish.

use crate::state::AppState;
use marinara_core::{now_iso, now_millis, AppError, AppResult};
use serde_json::{json, Map, Value};

pub(crate) const JOBS_COLLECTION: &str = "background-jobs";
const MAX_ATTEMPTS: u64 = 3;
const RETRY_BACKOFF_MS: [u64; 3] = [60_000, 5 * 60_000, 30 * 60_000];
const MAX_KEY_LEN: usize = 200;
/// How long a hold keeps its job unclaimable unless the client that placed it renews it. A hold
/// from a closed tab lapses within this, so its job still runs.
const HOLD_TTL_MS: u64 = 30_000;

pub(crate) const QUEUES: &[&str] = &[
    "continuity-director",
    "lorebook-keeper",
    "conversation-summary",
    "character-interpretation",
    "post-reply-agents",
];

fn read_text<'a>(body: &'a Value, field: &str, label: &str) -> AppResult<&'a str> {
    body.get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= MAX_KEY_LEN)
        .ok_or_else(|| AppError::invalid_input(format!("Background job {label} is required")))
}

pub(crate) fn queue_name(body: &Value) -> AppResult<&str> {
    let queue = read_text(body, "queue", "queue")?;
    if !QUEUES.contains(&queue) {
        return Err(AppError::invalid_input(format!(
            "Unknown background job queue: {queue}"
        )));
    }
    Ok(queue)
}

fn job_id(queue: &str, key: &str) -> String {
    format!("{queue}:{key}")
}

fn now_ms() -> u64 {
    u64::try_from(now_millis()).unwrap_or(u64::MAX)
}

fn job_text<'a>(job: &'a Value, field: &str) -> &'a str {
    job.get(field).and_then(Value::as_str).unwrap_or_default()
}

fn job_number(job: &Value, field: &str) -> u64 {
    job.get(field).and_then(Value::as_u64).unwrap_or(0)
}

fn optional_text<'a>(body: &'a Value, field: &str, label: &str) -> AppResult<Option<&'a str>> {
    if matches!(body.get(field), None | Some(Value::Null)) {
        return Ok(None);
    }
    read_text(body, field, label).map(Some)
}

/// Holds that have not lapsed yet: hold id -> epoch ms it lapses at.
fn live_holds(job: Option<&Value>, now: u64) -> Map<String, Value> {
    job.and_then(|job| job.get("holds"))
        .and_then(Value::as_object)
        .map(|holds| {
            holds
                .iter()
                .filter(|(_, lapses_at)| lapses_at.as_u64().is_some_and(|at| at > now))
                .map(|(id, lapses_at)| (id.clone(), lapses_at.clone()))
                .collect()
        })
        .unwrap_or_default()
}

/// When the last live hold on `job` lapses, or `None` when nothing holds it.
fn held_until(job: &Value, now: u64) -> Option<u64> {
    live_holds(Some(job), now)
        .values()
        .filter_map(Value::as_u64)
        .max()
}

fn optional_chat_id(body: &Value) -> Option<String> {
    body.get("chatId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Queue (or re-queue) the job for `queue` + `key`. A job that is already waiting just takes the
/// newer payload; one that is running is asked to run again with it once the current run ends.
///
/// `holdId` places (or renews) a hold: while any hold on a job is live, no worker can claim it.
/// A client holds the job while it is still writing what the job reads, renews the hold while that
/// work goes on, then enqueues again with `releaseHoldId` once it is done. Each piece of work holds
/// under its own id, so one finishing never releases another; a hold nobody renews lapses after
/// `HOLD_TTL_MS`, so the job of a closed tab still runs.
pub(crate) fn enqueue(state: &AppState, body: Value) -> AppResult<Value> {
    let queue = queue_name(&body)?;
    let key = read_text(&body, "key", "key")?;
    let payload = body.get("payload").cloned().unwrap_or(Value::Null);
    let chat_id = optional_chat_id(&body);
    let hold_id = optional_text(&body, "holdId", "hold id")?;
    let release_hold_id = optional_text(&body, "releaseHoldId", "hold id")?;
    let id = job_id(queue, key);
    state.with_background_jobs_lock(|| {
        let existing = state.storage.get(JOBS_COLLECTION, &id)?;
        let now = now_ms();
        let mut holds = live_holds(existing.as_ref(), now);
        if let Some(release_hold_id) = release_hold_id {
            holds.remove(release_hold_id);
        }
        if let Some(hold_id) = hold_id {
            holds.insert(hold_id.to_string(), json!(now + HOLD_TTL_MS));
        }
        if existing
            .as_ref()
            .is_some_and(|job| job_text(job, "status") == "running")
        {
            let mut patch = Map::new();
            patch.insert("rerunRequested".to_string(), Value::Bool(true));
            patch.insert("rerunPayload".to_string(), payload);
            patch.insert("holds".to_string(), Value::Object(holds));
            patch.insert("updatedAt".to_string(), Value::String(now_iso()));
            return state
                .storage
                .patch(JOBS_COLLECTION, &id, Value::Object(patch));
        }
        let created_at = existing
            .as_ref()
            .map(|job| job_text(job, "createdAt").to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(now_iso);
        state.storage.upsert_with_id(
            JOBS_COLLECTION,
            &id,
            json!({
                "queue": queue,
                "key": key,
                "chatId": chat_id,
                "payload": payload,
                "status": "queued",
                "attempts": 0,
                "nextAttemptAt": 0,
                "claimLeaseId": null,
                "rerunRequested": false,
                "rerunPayload": null,
                "holds": holds,
                "lastError": null,
                "createdAt": created_at,
                "updatedAt": now_iso(),
            }),
        )
    })
}

/// When the worker holding `lease_id` may claim `job` (epoch ms), or `None` if it never can.
fn claimable_at(job: &Value, lease_id: &str, now: u64) -> Option<u64> {
    let ready_at = match job_text(job, "status") {
        "queued" => 0,
        "retryable" => job_number(job, "nextAttemptAt"),
        // A run claimed under an older lease belongs to a worker that is gone.
        "running" if job_text(job, "claimLeaseId") != lease_id => 0,
        _ => return None,
    };
    Some(ready_at.max(held_until(job, now).unwrap_or(0)))
}

/// Claim the oldest due job of `queue` for the worker holding `leaseId`. With nothing due,
/// returns when the next job is due (a retry's backoff or a hold lapsing, epoch ms) so the worker
/// can sleep until then.
pub(crate) fn claim(state: &AppState, body: Value) -> AppResult<Value> {
    let queue = queue_name(&body)?;
    let lease_id = read_text(&body, "leaseId", "lease id")?;
    state.with_background_worker_lease(queue, lease_id, || {
        state.with_background_jobs_lock(|| {
            let now = now_ms();
            let jobs = state.storage.list(JOBS_COLLECTION)?;
            let mut queued: Vec<&Value> = jobs
                .iter()
                .filter(|job| job_text(job, "queue") == queue)
                .collect();
            queued.sort_by(|a, b| job_text(a, "createdAt").cmp(job_text(b, "createdAt")));
            let Some(job) = queued
                .iter()
                .find(|job| claimable_at(job, lease_id, now).is_some_and(|at| at <= now))
            else {
                let next_due_at = queued
                    .iter()
                    .filter_map(|job| claimable_at(job, lease_id, now))
                    .min();
                return Ok(json!({ "job": null, "nextDueAt": next_due_at }));
            };
            let id = job_text(job, "id").to_string();
            let claimed = state.storage.patch(
                JOBS_COLLECTION,
                &id,
                json!({
                    "status": "running",
                    "claimLeaseId": lease_id,
                    "attempts": job_number(job, "attempts") + 1,
                    "updatedAt": now_iso(),
                }),
            )?;
            Ok(json!({ "job": claimed, "nextDueAt": null }))
        })
    })
}

/// Record how a claimed run ended: `done`, `retry` (backs off, then fails after the last
/// attempt) or `failed`. A rerun requested during the run re-queues the job instead.
pub(crate) fn finish(state: &AppState, body: Value) -> AppResult<Value> {
    let queue = queue_name(&body)?;
    let lease_id = read_text(&body, "leaseId", "lease id")?;
    let id = read_text(&body, "jobId", "id")?.to_string();
    let outcome = read_text(&body, "outcome", "outcome")?;
    if !matches!(outcome, "done" | "retry" | "failed") {
        return Err(AppError::invalid_input(format!(
            "Unknown background job outcome: {outcome}"
        )));
    }
    let error = body
        .get("error")
        .and_then(Value::as_str)
        .map(|value| value.chars().take(500).collect::<String>());
    state.with_background_worker_lease(queue, lease_id, || {
        state.with_background_jobs_lock(|| {
            let Some(job) = state.storage.get(JOBS_COLLECTION, &id)? else {
                return Ok(json!({ "status": "missing" }));
            };
            if job_text(&job, "queue") != queue || job_text(&job, "claimLeaseId") != lease_id {
                return Err(AppError::new(
                    "background_job_not_claimed",
                    "This background job is not claimed by the current worker",
                ));
            }
            if job.get("rerunRequested").and_then(Value::as_bool) == Some(true) {
                let rerun_payload = job.get("rerunPayload").cloned().unwrap_or(Value::Null);
                state.storage.patch(
                    JOBS_COLLECTION,
                    &id,
                    json!({
                        "status": "queued",
                        "payload": rerun_payload,
                        "attempts": 0,
                        "nextAttemptAt": 0,
                        "claimLeaseId": null,
                        "rerunRequested": false,
                        "rerunPayload": null,
                        "lastError": error,
                        "updatedAt": now_iso(),
                    }),
                )?;
                return Ok(json!({ "status": "queued" }));
            }
            let attempts = job_number(&job, "attempts");
            match outcome {
                "done" => {
                    state.storage.delete(JOBS_COLLECTION, &id)?;
                    Ok(json!({ "status": "done" }))
                }
                "retry" if attempts < MAX_ATTEMPTS => {
                    let index = usize::try_from(attempts.saturating_sub(1)).unwrap_or(0);
                    let delay = RETRY_BACKOFF_MS[index.min(RETRY_BACKOFF_MS.len() - 1)];
                    state.storage.patch(
                        JOBS_COLLECTION,
                        &id,
                        json!({
                            "status": "retryable",
                            "nextAttemptAt": now_ms() + delay,
                            "claimLeaseId": null,
                            "lastError": error,
                            "updatedAt": now_iso(),
                        }),
                    )?;
                    Ok(json!({ "status": "retryable" }))
                }
                _ => {
                    state.storage.patch(
                        JOBS_COLLECTION,
                        &id,
                        json!({
                            "status": "failed",
                            "claimLeaseId": null,
                            "lastError": error,
                            "updatedAt": now_iso(),
                        }),
                    )?;
                    Ok(json!({ "status": "failed" }))
                }
            }
        })
    })
}

fn worker_id(body: &Value) -> AppResult<&str> {
    read_text(body, "workerId", "worker id")
}

pub(crate) fn acquire_worker(state: &AppState, body: Value) -> AppResult<Value> {
    let queue = queue_name(&body)?;
    let worker_id = worker_id(&body)?;
    let requested_lease = body.get("leaseId").and_then(Value::as_str);
    let acquired = state.acquire_background_worker(queue, worker_id, requested_lease)?;
    Ok(json!({ "acquired": acquired.is_some(), "leaseId": acquired }))
}

pub(crate) fn release_worker(state: &AppState, body: Value) -> AppResult<Value> {
    let queue = queue_name(&body)?;
    let worker_id = worker_id(&body)?;
    let lease_id = read_text(&body, "leaseId", "lease id")?;
    let released = state.release_background_worker(queue, worker_id, lease_id)?;
    Ok(json!({ "released": released }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const QUEUE: &str = "continuity-director";

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        AppState::from_data_dir(
            std::env::temp_dir().join(format!("de-koi-background-jobs-{label}-{nonce}")),
            Vec::new(),
        )
        .expect("test state should initialize")
    }

    fn lease(state: &AppState, worker: &str) -> String {
        acquire_worker(state, json!({ "queue": QUEUE, "workerId": worker })).unwrap()["leaseId"]
            .as_str()
            .expect("lease should be granted")
            .to_string()
    }

    fn enqueue_trigger(state: &AppState, key: &str, trigger: &str) {
        enqueue(
            state,
            json!({ "queue": QUEUE, "key": key, "chatId": key, "payload": { "trigger": trigger } }),
        )
        .unwrap();
    }

    fn claim_job(state: &AppState, lease_id: &str) -> Value {
        claim(state, json!({ "queue": QUEUE, "leaseId": lease_id })).unwrap()
    }

    fn finish_job(state: &AppState, lease_id: &str, job_id: &str, outcome: &str) -> Value {
        finish(
            state,
            json!({ "queue": QUEUE, "leaseId": lease_id, "jobId": job_id, "outcome": outcome }),
        )
        .unwrap()
    }

    #[test]
    fn one_worker_per_queue_and_only_its_lease_claims() {
        let state = test_state("lease");
        let first = lease(&state, "tab-a");
        let second =
            acquire_worker(&state, json!({ "queue": QUEUE, "workerId": "tab-b" })).unwrap();
        assert_eq!(second["acquired"], json!(false));
        let error = claim(
            &state,
            json!({ "queue": QUEUE, "leaseId": "not-the-lease" }),
        )
        .expect_err("a stale lease must not claim");
        assert_eq!(error.code, "background_worker_lease_lost");
        assert!(claim_job(&state, &first)["job"].is_null());
    }

    #[test]
    fn a_trigger_during_a_run_queues_one_rerun_with_the_newest_payload() {
        let state = test_state("rerun");
        let lease_id = lease(&state, "tab-a");
        enqueue_trigger(&state, "chat-1", "assistant_saved");
        let job = claim_job(&state, &lease_id)["job"].clone();
        assert_eq!(job["payload"]["trigger"], json!("assistant_saved"));
        // Two more triggers land while the first run is still going.
        enqueue_trigger(&state, "chat-1", "scene_created");
        enqueue_trigger(&state, "chat-1", "scene_concluded");
        assert_eq!(
            finish_job(&state, &lease_id, "continuity-director:chat-1", "done")["status"],
            json!("queued")
        );
        let rerun = claim_job(&state, &lease_id)["job"].clone();
        assert_eq!(rerun["payload"]["trigger"], json!("scene_concluded"));
        assert_eq!(rerun["attempts"], json!(1));
        finish_job(&state, &lease_id, "continuity-director:chat-1", "done");
        assert!(state
            .storage
            .get(JOBS_COLLECTION, "continuity-director:chat-1")
            .unwrap()
            .is_none());
    }

    #[test]
    fn a_run_left_by_a_closed_tab_is_claimed_by_the_next_worker() {
        let state = test_state("abandoned");
        let first = lease(&state, "tab-a");
        enqueue_trigger(&state, "chat-1", "assistant_saved");
        assert!(!claim_job(&state, &first)["job"].is_null());
        // The tab closes mid-run; its lease is released (or expires) without a finish.
        release_worker(
            &state,
            json!({ "queue": QUEUE, "workerId": "tab-a", "leaseId": first }),
        )
        .unwrap();
        let second = lease(&state, "tab-b");
        let reclaimed = claim_job(&state, &second)["job"].clone();
        assert_eq!(reclaimed["id"], json!("continuity-director:chat-1"));
        assert_eq!(reclaimed["attempts"], json!(2));
        let error = finish(
            &state,
            json!({ "queue": QUEUE, "leaseId": first, "jobId": "continuity-director:chat-1", "outcome": "done" }),
        )
        .expect_err("the old worker can no longer finish the job");
        assert_eq!(error.code, "background_worker_lease_lost");
    }

    #[test]
    fn retries_back_off_and_stop_after_the_last_attempt() {
        let state = test_state("retry");
        let lease_id = lease(&state, "tab-a");
        enqueue_trigger(&state, "chat-1", "assistant_saved");
        let id = "continuity-director:chat-1";
        claim_job(&state, &lease_id);
        assert_eq!(
            finish_job(&state, &lease_id, id, "retry")["status"],
            json!("retryable")
        );
        let waiting = claim_job(&state, &lease_id);
        assert!(waiting["job"].is_null());
        assert!(waiting["nextDueAt"].as_u64().unwrap() > now_ms());
        // Make the remaining attempts due now and run them out.
        for _ in 0..2 {
            state
                .storage
                .patch(JOBS_COLLECTION, id, json!({ "nextAttemptAt": 0 }))
                .unwrap();
            assert!(!claim_job(&state, &lease_id)["job"].is_null());
            finish_job(&state, &lease_id, id, "retry");
        }
        let job = state.storage.get(JOBS_COLLECTION, id).unwrap().unwrap();
        assert_eq!(job["status"], json!("failed"));
        assert_eq!(job["attempts"], json!(3));
    }

    fn enqueue_hold(state: &AppState, key: &str, field: &str, hold_id: &str) {
        enqueue(
            state,
            json!({ "queue": QUEUE, "key": key, "chatId": key, "payload": {}, field: hold_id }),
        )
        .unwrap();
    }

    #[test]
    fn a_held_job_waits_until_every_hold_on_it_is_released() {
        let state = test_state("holds");
        let lease_id = lease(&state, "tab-a");
        // Two overlapping turns hold the same chat's job.
        enqueue_hold(&state, "chat-1", "holdId", "turn-a");
        enqueue_hold(&state, "chat-1", "holdId", "turn-b");
        let waiting = claim_job(&state, &lease_id);
        assert!(waiting["job"].is_null(), "no worker may run a held job");
        let lapses_at = waiting["nextDueAt"].as_u64().unwrap();
        assert!(lapses_at > now_ms() && lapses_at <= now_ms() + HOLD_TTL_MS);
        // Turn A finishing must not release turn B's hold.
        enqueue_hold(&state, "chat-1", "releaseHoldId", "turn-a");
        assert!(claim_job(&state, &lease_id)["job"].is_null());
        enqueue_hold(&state, "chat-1", "releaseHoldId", "turn-b");
        assert_eq!(
            claim_job(&state, &lease_id)["job"]["id"],
            json!("continuity-director:chat-1")
        );
    }

    #[test]
    fn a_hold_nobody_renews_lapses_so_a_closed_tab_still_gets_its_job_run() {
        let state = test_state("lapsed-hold");
        let lease_id = lease(&state, "tab-a");
        let id = "continuity-director:chat-1";
        enqueue_hold(&state, "chat-1", "holdId", "turn-a");
        assert!(claim_job(&state, &lease_id)["job"].is_null());
        // The tab that placed it closed: its last renewal runs out.
        state
            .storage
            .patch(
                JOBS_COLLECTION,
                id,
                json!({ "holds": { "turn-a": now_ms() - 1 } }),
            )
            .unwrap();
        assert_eq!(claim_job(&state, &lease_id)["job"]["id"], json!(id));
    }

    #[test]
    fn a_hold_placed_during_a_run_holds_the_rerun() {
        let state = test_state("hold-during-run");
        let lease_id = lease(&state, "tab-a");
        let id = "continuity-director:chat-1";
        enqueue_trigger(&state, "chat-1", "assistant_saved");
        assert!(!claim_job(&state, &lease_id)["job"].is_null());
        // A new turn starts writing while the earlier run is still going.
        enqueue_hold(&state, "chat-1", "holdId", "turn-b");
        assert_eq!(
            finish_job(&state, &lease_id, id, "done")["status"],
            json!("queued")
        );
        assert!(
            claim_job(&state, &lease_id)["job"].is_null(),
            "the rerun waits for turn B"
        );
        enqueue_hold(&state, "chat-1", "releaseHoldId", "turn-b");
        assert_eq!(claim_job(&state, &lease_id)["job"]["id"], json!(id));
    }

    #[test]
    fn rejects_unknown_queues() {
        let state = test_state("unknown");
        let error = enqueue(&state, json!({ "queue": "nope", "key": "chat-1" }))
            .expect_err("unknown queue");
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn accepts_every_queue_the_app_enqueues() {
        let state = test_state("queues");
        for queue in [
            "continuity-director",
            "lorebook-keeper",
            "conversation-summary",
            "character-interpretation",
            "post-reply-agents",
        ] {
            enqueue(
                &state,
                json!({ "queue": queue, "key": "chat-1", "payload": null }),
            )
            .unwrap_or_else(|error| panic!("{queue} rejected: {error:?}"));
        }
    }
}
