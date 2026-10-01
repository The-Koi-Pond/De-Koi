//! Pending Deki app-data approvals and their compact history.
//!
//! State is in memory for the running De-Koi process: pending approvals do not
//! survive a restart, and they expire after [`APPROVAL_TTL_MINUTES`]. Every
//! entry is scoped to the server-owned runtime owner plus the Deki session, so
//! one remote principal can never list, approve, or reject another's changes.
//! Durable history lives with the Deki messages that carry it.

use super::data_cli::{self, DekiDataMutation, DekiDataPlan};
use super::status::{validate_runtime_owner, DekiRuntimeOwner};
use crate::state::AppState;
use chrono::{DateTime, Duration, Utc};
use marinara_core::{new_id, AppError, AppResult};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard, OnceLock};

const APPROVAL_TTL_MINUTES: i64 = 30;
const MAX_PENDING_PER_SESSION: usize = 12;
const MAX_HISTORY_PER_SESSION: usize = 30;
const MAX_HISTORY_TOTAL: usize = 500;
const PROMPT_HISTORY_ROWS: usize = 8;
const APPROVAL_ID_MAX_CHARS: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DekiApprovalScope {
    pub(super) owner: DekiRuntimeOwner,
    pub(super) session_id: String,
}

impl DekiApprovalScope {
    pub(super) fn new(owner: &DekiRuntimeOwner, session_id: &str) -> AppResult<Self> {
        validate_runtime_owner(owner)?;
        let session_id = session_id.trim();
        if session_id.is_empty() || session_id.chars().count() > 256 {
            return Err(AppError::invalid_input(
                "A valid Deki session id is required for workspace approvals.",
            ));
        }
        Ok(Self {
            owner: owner.clone(),
            session_id: session_id.to_string(),
        })
    }
}

#[derive(Debug, Clone)]
struct PendingApproval {
    id: String,
    scope: DekiApprovalScope,
    mutation: DekiDataMutation,
    operation_hash: String,
    requested_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    affected_entities: Map<String, Value>,
    affected_rows: usize,
    validation_status: &'static str,
    preview: Vec<Value>,
    preview_truncated: bool,
}

impl PendingApproval {
    fn to_value(&self) -> Value {
        json!({
            "id": self.id,
            "sessionId": self.scope.session_id,
            "command": self.mutation.command_label(),
            "reason": self.mutation.reason,
            "operationHash": self.operation_hash,
            "requestedAt": self.requested_at.to_rfc3339(),
            "expiresAt": self.expires_at.to_rfc3339(),
            "affectedEntities": self.affected_entities,
            "affectedRows": self.affected_rows,
            "validationStatus": self.validation_status,
            "diffPreview": self.preview,
            "diffTruncated": self.preview_truncated,
        })
    }
}

#[derive(Debug, Clone)]
struct HistoryRecord {
    scope: DekiApprovalScope,
    entry: Map<String, Value>,
}

#[derive(Debug, Default)]
struct ApprovalStore {
    pending: Vec<PendingApproval>,
    history: VecDeque<HistoryRecord>,
}

static STORE: OnceLock<Mutex<ApprovalStore>> = OnceLock::new();

fn store() -> AppResult<MutexGuard<'static, ApprovalStore>> {
    lock_store(STORE.get_or_init(|| Mutex::new(ApprovalStore::default())))
}

fn lock_store(store: &Mutex<ApprovalStore>) -> AppResult<MutexGuard<'_, ApprovalStore>> {
    store.lock().map_err(|_| {
        AppError::new(
            "deki_workspace_state_failed",
            "Deki workspace approval state is unavailable. Restart De-Koi to clear pending approvals.",
        )
    })
}

impl ApprovalStore {
    fn prune_expired(&mut self, now: DateTime<Utc>) {
        let (expired, live): (Vec<_>, Vec<_>) = self
            .pending
            .drain(..)
            .partition(|approval| approval.expires_at <= now);
        self.pending = live;
        for approval in expired {
            self.complete(&approval.scope, &approval.id, "timed_out", now);
        }
    }

    fn push_history(&mut self, scope: &DekiApprovalScope, entry: Map<String, Value>) {
        self.history.push_back(HistoryRecord {
            scope: scope.clone(),
            entry,
        });
        let session_rows = self
            .history
            .iter()
            .filter(|record| &record.scope == scope)
            .count();
        if session_rows > MAX_HISTORY_PER_SESSION {
            if let Some(index) = self
                .history
                .iter()
                .position(|record| &record.scope == scope)
            {
                self.history.remove(index);
            }
        }
        while self.history.len() > MAX_HISTORY_TOTAL {
            self.history.pop_front();
        }
    }

    fn complete(&mut self, scope: &DekiApprovalScope, id: &str, status: &str, now: DateTime<Utc>) {
        if let Some(record) = self.history.iter_mut().rev().find(|record| {
            &record.scope == scope && record.entry.get("id").and_then(Value::as_str) == Some(id)
        }) {
            record.entry.insert("status".to_string(), json!(status));
            record
                .entry
                .insert("completedAt".to_string(), json!(now.to_rfc3339()));
        }
    }

    fn pending_for(&self, scope: &DekiApprovalScope) -> Vec<Value> {
        self.pending
            .iter()
            .filter(|approval| &approval.scope == scope)
            .map(PendingApproval::to_value)
            .collect()
    }

    fn history_for(&self, scope: &DekiApprovalScope) -> Vec<Value> {
        self.history
            .iter()
            .rev()
            .filter(|record| &record.scope == scope)
            .map(|record| Value::Object(record.entry.clone()))
            .collect()
    }
}

fn history_entry(
    id: &str,
    scope: &DekiApprovalScope,
    plan: &DekiDataPlan,
    status: &str,
    now: DateTime<Utc>,
) -> Map<String, Value> {
    let entry = json!({
        "id": id,
        "sessionId": scope.session_id,
        "command": plan.command,
        "reason": plan.mutation.reason,
        "status": status,
        "operationHash": plan.operation_hash,
        "affectedEntities": plan.affected_entities,
        "affectedRows": plan.affected_rows,
        "validationStatus": plan.validation.status(),
        "journalPath": Value::Null,
        "createdAt": now.to_rfc3339(),
        "completedAt": if status == "dry-run" { Value::Null } else { json!(now.to_rfc3339()) },
    });
    entry.as_object().cloned().unwrap_or_default()
}

/// Records a dry-run. A plan that passed validation becomes a pending approval
/// (returned as its public JSON shape); a blocked plan is logged as blocked and
/// returns `None`.
pub(super) fn record_dry_run(
    scope: &DekiApprovalScope,
    plan: &DekiDataPlan,
) -> AppResult<Option<Value>> {
    let now = Utc::now();
    let mut store = store()?;
    store.prune_expired(now);
    if plan.validation.blocked() {
        let id = format!("deki-dry-run-{}", new_id());
        store.push_history(scope, history_entry(&id, scope, plan, "blocked", now));
        return Ok(None);
    }
    let pending_in_session = store
        .pending
        .iter()
        .filter(|approval| &approval.scope == scope)
        .count();
    if pending_in_session >= MAX_PENDING_PER_SESSION {
        return Err(AppError::new(
            "deki_workspace_too_many_pending",
            format!(
                "This Deki session already has {MAX_PENDING_PER_SESSION} changes waiting for approval. Ask the user to approve or reject them before proposing more."
            ),
        ));
    }
    let approval = PendingApproval {
        id: format!("deki-approval-{}", new_id()),
        scope: scope.clone(),
        mutation: plan.mutation.clone(),
        operation_hash: plan.operation_hash.clone(),
        requested_at: now,
        expires_at: now + Duration::minutes(APPROVAL_TTL_MINUTES),
        affected_entities: plan.affected_entities.clone(),
        affected_rows: plan.affected_rows,
        validation_status: plan.validation.status(),
        preview: plan.preview.clone(),
        preview_truncated: plan.preview_truncated,
    };
    let value = approval.to_value();
    store.push_history(
        scope,
        history_entry(&approval.id, scope, plan, "dry-run", now),
    );
    store.pending.push(approval);
    Ok(Some(value))
}

pub(super) fn pending_for(scope: &DekiApprovalScope) -> AppResult<Vec<Value>> {
    let mut store = store()?;
    store.prune_expired(Utc::now());
    Ok(store.pending_for(scope))
}

pub(super) fn history_for(scope: &DekiApprovalScope) -> AppResult<Vec<Value>> {
    let mut store = store()?;
    store.prune_expired(Utc::now());
    Ok(store.history_for(scope))
}

/// Summarizes this session's approvals for the next model turn, so Deki knows
/// what the user approved or rejected instead of guessing.
pub(super) fn prompt_context(scope: &DekiApprovalScope) -> AppResult<Option<String>> {
    let pending = pending_for(scope)?;
    let history = history_for(scope)?;
    let mut lines = Vec::new();
    for approval in &pending {
        lines.push(format!(
            "- waiting for approval: {} ({})",
            text(approval, "command"),
            text(approval, "reason"),
        ));
    }
    for entry in history
        .iter()
        .filter(|entry| text(entry, "status") != "dry-run")
        .take(PROMPT_HISTORY_ROWS)
    {
        lines.push(format!(
            "- {}: {} ({})",
            text(entry, "status"),
            text(entry, "command"),
            text(entry, "reason"),
        ));
    }
    if lines.is_empty() {
        return Ok(None);
    }
    Ok(Some(format!(
        "Deki app-data approvals in this session (\"approved\" means the change was applied; every other status means it was not):\n{}",
        lines.join("\n")
    )))
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn take_pending(scope: &DekiApprovalScope, id: &str) -> AppResult<Option<PendingApproval>> {
    let mut store = store()?;
    store.prune_expired(Utc::now());
    let Some(index) = store
        .pending
        .iter()
        .position(|approval| approval.id == id && &approval.scope == scope)
    else {
        return Ok(None);
    };
    Ok(Some(store.pending.remove(index)))
}

/// Puts an approval taken by a failed apply back, so the user can retry it.
/// Only called once the failure is known to have written nothing.
fn restore_pending(approval: PendingApproval) -> AppResult<()> {
    let mut store = store()?;
    store.pending.push(approval);
    Ok(())
}

fn complete(scope: &DekiApprovalScope, id: &str, status: &str) -> AppResult<()> {
    let mut store = store()?;
    store.complete(scope, id, status, Utc::now());
    Ok(())
}

fn decision_value(id: &str, status: &str, scope: &DekiApprovalScope) -> AppResult<Value> {
    Ok(json!({
        "id": id,
        "status": status,
        "pendingApprovals": pending_for(scope)?,
        "history": history_for(scope)?,
    }))
}

enum ApplyOutcome {
    Applied,
    Blocked(String),
    StateChanged,
    /// The write failed and storage still matches the approved plan, so
    /// nothing was written and the approval can be retried.
    FailedWithoutWrite(AppError),
    /// The write failed after changing storage (or its effect could not be
    /// checked), so replaying the approval could double-apply part of it.
    FailedAfterWrite(AppError),
}

#[cfg(test)]
type BeforeApplyHook = Box<dyn FnOnce() -> AppResult<()>>;

#[cfg(test)]
thread_local! {
    /// Runs between the final hash check and the write, so a test can race a
    /// competing mutation against an approval or fail the write.
    static BEFORE_APPLY_HOOK: std::cell::RefCell<Option<BeforeApplyHook>> =
        std::cell::RefCell::new(None);
}

fn run_before_apply_hook() -> AppResult<()> {
    #[cfg(test)]
    {
        if let Some(hook) = BEFORE_APPLY_HOOK.with(|hook| hook.borrow_mut().take()) {
            return hook();
        }
    }
    Ok(())
}

/// Re-plans against current storage and applies only if the plan still
/// matches the approved hash, all inside one exclusive storage section so no
/// other writer can change the rows between the check and the write. A failed
/// write is reconciled by planning again: an unchanged hash proves nothing was
/// written.
fn apply_if_unchanged(state: &AppState, pending: &PendingApproval) -> AppResult<ApplyOutcome> {
    state.storage.with_exclusive_writes(|| {
        let plan = data_cli::plan_mutation(state, &pending.mutation)?;
        if plan.validation.blocked() {
            return Ok(ApplyOutcome::Blocked(
                plan.validation
                    .first_error()
                    .unwrap_or("the change no longer passes validation.")
                    .to_string(),
            ));
        }
        if plan.operation_hash != pending.operation_hash {
            return Ok(ApplyOutcome::StateChanged);
        }
        let applied = run_before_apply_hook()
            .and_then(|()| data_cli::apply_mutation(state, &pending.mutation).map(|_| ()));
        let Err(error) = applied else {
            return Ok(ApplyOutcome::Applied);
        };
        let unchanged = data_cli::plan_mutation(state, &pending.mutation)
            .is_ok_and(|replan| replan.operation_hash == pending.operation_hash);
        Ok(if unchanged {
            ApplyOutcome::FailedWithoutWrite(error)
        } else {
            ApplyOutcome::FailedAfterWrite(error)
        })
    })
}

fn sentence(message: &str) -> &str {
    message.trim().trim_end_matches('.')
}

fn validate_approval_id(id: &str) -> AppResult<&str> {
    let id = id.trim();
    if id.is_empty() || id.chars().count() > APPROVAL_ID_MAX_CHARS {
        return Err(AppError::invalid_input(
            "A valid workspace approval id is required.",
        ));
    }
    Ok(id)
}

/// Applies a pending approval from the caller's own owner and session scope.
/// The plan is recomputed and applied inside one exclusive storage section; if
/// validation now fails or the operation hash differs from the one the user
/// saw, nothing is written.
pub(super) fn approve(
    state: &AppState,
    owner: &DekiRuntimeOwner,
    session_id: &str,
    id: &str,
) -> AppResult<Value> {
    let scope = DekiApprovalScope::new(owner, session_id)?;
    let id = validate_approval_id(id)?;
    let Some(pending) = take_pending(&scope, id)? else {
        return decision_value(id, "not_found", &scope);
    };
    match apply_if_unchanged(state, &pending) {
        Ok(ApplyOutcome::FailedWithoutWrite(error)) => {
            restore_pending(pending)?;
            Err(AppError::new(
                "deki_workspace_apply_failed",
                format!(
                    "Nothing was applied: {}. The change is still waiting for approval, so it can be tried again.",
                    sentence(&error.message)
                ),
            ))
        }
        Ok(ApplyOutcome::FailedAfterWrite(error)) => {
            complete(&scope, id, "failed")?;
            Err(AppError::new(
                "deki_workspace_partial_apply",
                format!(
                    "Part of this change may have been saved before it failed: {}. Check the affected records, then ask Deki-senpai for a fresh dry-run.",
                    sentence(&error.message)
                ),
            ))
        }
        Ok(ApplyOutcome::Applied) => {
            complete(&scope, id, "approved")?;
            let mut value = decision_value(id, "approved", &scope)?;
            value["applied"] = json!({
                "entity": pending.mutation.collection,
                "id": pending.mutation.id,
                "command": pending.mutation.command_label(),
            });
            Ok(value)
        }
        Ok(ApplyOutcome::Blocked(reason)) => {
            complete(&scope, id, "blocked")?;
            Err(AppError::new(
                "deki_workspace_approval_blocked",
                format!("Nothing was applied: {reason}"),
            ))
        }
        Ok(ApplyOutcome::StateChanged) => {
            complete(&scope, id, "state_changed")?;
            Err(AppError::new(
                "deki_workspace_state_changed",
                "Nothing was applied because this data changed after Deki-senpai's dry-run. Ask Deki-senpai for a fresh dry-run.",
            ))
        }
        // Planning failed before any write, so the approval stays retryable.
        Err(error) => {
            restore_pending(pending)?;
            Err(error)
        }
    }
}

pub(super) fn reject(owner: &DekiRuntimeOwner, session_id: &str, id: &str) -> AppResult<Value> {
    let scope = DekiApprovalScope::new(owner, session_id)?;
    let id = validate_approval_id(id)?;
    let Some(pending) = take_pending(&scope, id)? else {
        return decision_value(id, "not_found", &scope);
    };
    complete(&pending.scope, id, "rejected")?;
    decision_value(id, "rejected", &scope)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage_commands::{canonical_memory, knowledge_edges};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-deki-approvals-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn scope(owner: DekiRuntimeOwner, session: &str) -> DekiApprovalScope {
        DekiApprovalScope::new(&owner, session).expect("valid scope")
    }

    fn unique_session(label: &str) -> String {
        format!("{label}-{}", new_id())
    }

    fn dry_run(state: &AppState, scope: &DekiApprovalScope, args: Value) -> Value {
        let command = data_cli::parse(args).expect("command should parse");
        let mut pending = Vec::new();
        data_cli::execute(state, scope, command, &mut pending).expect("dry-run should execute")
    }

    fn seed_lorebook(state: &AppState) {
        state
            .storage
            .create(
                "lorebooks",
                json!({ "id": "book-pond", "name": "Pond Notes" }),
            )
            .expect("seed lorebook");
        state
            .storage
            .create(
                "lorebook-entries",
                json!({
                    "id": "entry-koi",
                    "lorebookId": "book-pond",
                    "name": "Koi",
                    "content": "Koi circle the lantern at dusk."
                }),
            )
            .expect("seed entry");
    }

    fn approval_id(result: &Value) -> String {
        result["approval"]["id"]
            .as_str()
            .expect("dry-run should create a pending approval")
            .to_string()
    }

    #[test]
    fn patch_dry_run_does_not_write_and_approval_applies_exactly_the_plan() {
        let state = test_state("patch");
        seed_lorebook(&state);
        let scope = scope(DekiRuntimeOwner::Embedded, &unique_session("patch"));

        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "patch",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "patch": { "content": "Koi circle the lantern at dawn." },
                "reason": "Fix the time of day"
            }),
        );

        assert_eq!(result["mode"], "dry-run");
        assert_eq!(result["summary"]["updatedRows"], 1);
        assert_eq!(
            result["summary"]["preview"][0]["after"]["content"],
            "Koi circle the lantern at dawn."
        );
        let stored = state
            .storage
            .get("lorebook-entries", "entry-koi")
            .expect("read entry")
            .expect("entry exists");
        assert_eq!(stored["content"], "Koi circle the lantern at dusk.");
        assert_eq!(pending_for(&scope).expect("pending approvals").len(), 1);

        let decision = approve(
            &state,
            &DekiRuntimeOwner::Embedded,
            &scope.session_id,
            &approval_id(&result),
        )
        .expect("approval should apply");

        assert_eq!(decision["status"], "approved");
        assert_eq!(
            decision["pendingApprovals"].as_array().map(Vec::len),
            Some(0)
        );
        assert_eq!(decision["history"][0]["status"], "approved");
        let stored = state
            .storage
            .get("lorebook-entries", "entry-koi")
            .expect("read entry")
            .expect("entry exists");
        assert_eq!(stored["content"], "Koi circle the lantern at dawn.");
    }

    #[test]
    fn approval_is_blocked_when_the_record_changed_after_the_dry_run() {
        let state = test_state("state-changed");
        seed_lorebook(&state);
        let scope = scope(DekiRuntimeOwner::Embedded, &unique_session("state-changed"));
        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "patch",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "patch": { "name": "Koi of the Lantern" },
                "reason": "Clearer entry name"
            }),
        );
        state
            .storage
            .patch(
                "lorebook-entries",
                "entry-koi",
                json!({ "content": "Edited by the user." }),
            )
            .expect("user edit");

        let error = approve(
            &state,
            &DekiRuntimeOwner::Embedded,
            &scope.session_id,
            &approval_id(&result),
        )
        .expect_err("changed state must block the approval");

        assert_eq!(error.code, "deki_workspace_state_changed");
        let stored = state
            .storage
            .get("lorebook-entries", "entry-koi")
            .expect("read entry")
            .expect("entry exists");
        assert_eq!(stored["name"], "Koi");
        assert_eq!(
            history_for(&scope).expect("approval history")[0]["status"],
            "state_changed"
        );
        assert!(pending_for(&scope).expect("pending approvals").is_empty());
    }

    #[test]
    fn insert_applies_with_the_previewed_id_and_cannot_apply_twice() {
        let state = test_state("insert");
        seed_lorebook(&state);
        let scope = scope(DekiRuntimeOwner::Embedded, &unique_session("insert"));
        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "insert",
                "collection": "lorebook-entries",
                "value": { "lorebookId": "book-pond", "name": "Lantern", "content": "A paper lantern." },
                "reason": "Add the lantern entry"
            }),
        );
        let previewed_id = result["summary"]["preview"][0]["id"]
            .as_str()
            .expect("preview names the new id")
            .to_string();
        let id = approval_id(&result);

        approve(&state, &DekiRuntimeOwner::Embedded, &scope.session_id, &id)
            .expect("insert should apply");

        let created = state
            .storage
            .get("lorebook-entries", &previewed_id)
            .expect("read entry")
            .expect("entry created with the previewed id");
        assert_eq!(created["name"], "Lantern");
        let second = approve(&state, &DekiRuntimeOwner::Embedded, &scope.session_id, &id)
            .expect("second approve should resolve");
        assert_eq!(second["status"], "not_found");
    }

    #[test]
    fn reject_discards_the_change_and_records_history() {
        let state = test_state("reject");
        seed_lorebook(&state);
        let scope = scope(DekiRuntimeOwner::Embedded, &unique_session("reject"));
        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "delete",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "reason": "Duplicate entry"
            }),
        );

        let decision = reject(
            &DekiRuntimeOwner::Embedded,
            &scope.session_id,
            &approval_id(&result),
        )
        .expect("reject resolves");

        assert_eq!(decision["status"], "rejected");
        assert_eq!(decision["history"][0]["status"], "rejected");
        assert!(state
            .storage
            .get("lorebook-entries", "entry-koi")
            .expect("read entry")
            .is_some());
    }

    #[test]
    fn approvals_are_isolated_by_runtime_owner() {
        let state = test_state("owner");
        seed_lorebook(&state);
        let session = unique_session("owner");
        let alice = scope(
            DekiRuntimeOwner::Authenticated("alice".to_string()),
            &session,
        );
        let result = dry_run(
            &state,
            &alice,
            json!({
                "action": "delete",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "reason": "Remove entry"
            }),
        );
        let bob = DekiRuntimeOwner::Authenticated("bob".to_string());

        let decision = approve(&state, &bob, &session, &approval_id(&result)).expect("resolves");

        assert_eq!(decision["status"], "not_found");
        assert!(pending_for(&scope(bob, &session))
            .expect("pending approvals")
            .is_empty());
        assert_eq!(pending_for(&alice).expect("pending approvals").len(), 1);
        assert!(state
            .storage
            .get("lorebook-entries", "entry-koi")
            .expect("read entry")
            .is_some());
    }

    #[test]
    fn invalid_collections_and_actions_are_rejected() {
        for args in [
            json!({ "action": "delete", "collection": "chats", "id": "chat-1", "reason": "x" }),
            json!({ "action": "patch", "collection": "connections", "id": "c", "patch": {}, "reason": "x" }),
            json!({ "action": "replace", "collection": "personas", "id": "p", "value": {}, "reason": "x" }),
            json!({ "action": "drop", "collection": "personas" }),
            json!({ "collection": "personas" }),
            json!({ "action": "delete", "collection": "personas", "id": "p", "reason": "  " }),
        ] {
            let error = match data_cli::parse(args.clone()) {
                Err(error) => error,
                Ok(_) => panic!("{args} should be rejected"),
            };
            assert_eq!(error.code, "invalid_input", "{args}");
        }
    }

    #[test]
    fn blocked_dry_runs_create_no_pending_approval() {
        let state = test_state("blocked");
        seed_lorebook(&state);
        let scope = scope(DekiRuntimeOwner::Embedded, &unique_session("blocked"));

        let missing_parent = dry_run(
            &state,
            &scope,
            json!({
                "action": "insert",
                "collection": "lorebook-entries",
                "value": { "lorebookId": "book-missing", "name": "Orphan" },
                "reason": "Add entry"
            }),
        );
        let owned_field = dry_run(
            &state,
            &scope,
            json!({
                "action": "patch",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "patch": { "id": "entry-other" },
                "reason": "Rename id"
            }),
        );
        let no_op = dry_run(
            &state,
            &scope,
            json!({
                "action": "patch",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "patch": { "name": "Koi" },
                "reason": "No change"
            }),
        );

        let duplicate = dry_run(
            &state,
            &scope,
            json!({
                "action": "delete",
                "collection": "lorebook-entries",
                "id": "entry-missing",
                "reason": "Remove"
            }),
        );

        for result in [&missing_parent, &owned_field, &no_op, &duplicate] {
            assert_eq!(result["ok"], false, "{result}");
            assert_eq!(result["validation"]["status"], "blocked", "{result}");
            assert!(result.get("approval").is_none(), "{result}");
            let summary = &result["summary"];
            for counter in ["affectedRows", "insertedRows", "updatedRows", "deletedRows"] {
                assert_eq!(summary[counter], 0, "{counter} in {result}");
            }
            assert_eq!(summary["affectedEntities"], json!({}), "{result}");
        }
        assert!(pending_for(&scope).expect("pending approvals").is_empty());
        assert_eq!(
            history_for(&scope).expect("approval history")[0]["status"],
            "blocked"
        );
    }

    #[test]
    fn delete_previews_are_bounded_and_report_cascades() {
        let state = test_state("delete-cascade");
        state
            .storage
            .create("lorebooks", json!({ "id": "book-big", "name": "Big Book" }))
            .expect("seed lorebook");
        for index in 0..9 {
            state
                .storage
                .create(
                    "lorebook-entries",
                    json!({
                        "id": format!("entry-{index}"),
                        "lorebookId": "book-big",
                        "name": format!("Entry {index}"),
                        "content": "x".repeat(5_000),
                    }),
                )
                .expect("seed entry");
        }
        let scope = scope(
            DekiRuntimeOwner::Embedded,
            &unique_session("delete-cascade"),
        );

        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "delete",
                "collection": "lorebooks",
                "id": "book-big",
                "reason": "Retire the book"
            }),
        );

        let summary = &result["summary"];
        assert_eq!(summary["affectedRows"], 10);
        assert_eq!(summary["deletedRows"], 10);
        assert_eq!(summary["affectedEntities"]["lorebook-entries"], 9);
        assert_eq!(summary["truncated"], true);
        let preview = summary["preview"].as_array().expect("preview rows");
        assert_eq!(preview.len(), 1 + 5);
        assert!(preview[1]["before"].get("content").is_none());
        assert_eq!(
            state.storage.list("lorebook-entries").expect("list").len(),
            9
        );
    }

    fn seed_character_with_side_effects(state: &AppState) {
        let rows = [
            (
                "characters",
                json!({ "id": "char-mei", "data": { "name": "Mei" } }),
            ),
            (
                "characters",
                json!({ "id": "char-other", "data": { "name": "Other" } }),
            ),
            (
                "character-gallery",
                json!({ "id": "img-1", "characterId": "char-mei", "filename": "mei-1.png" }),
            ),
            (
                "character-gallery",
                json!({ "id": "img-2", "characterId": "char-other", "filename": "other.png" }),
            ),
            (
                knowledge_edges::COLLECTION,
                json!({ "id": "edge-1", "memoryId": "mem-1", "holder": { "kind": "character", "id": "char-mei" }, "status": "active" }),
            ),
            (
                knowledge_edges::COLLECTION,
                json!({ "id": "edge-old", "memoryId": "mem-1", "holder": { "kind": "character", "id": "char-mei" }, "status": "invalidated" }),
            ),
        ];
        for (collection, row) in rows {
            state.storage.create(collection, row).expect("seed row");
        }
        for (id, status) in [("mem-1", "active"), ("mem-gone", "deleted")] {
            canonical_memory::create_memory(
                state,
                json!({
                    "id": id,
                    "kind": "fact",
                    "status": status,
                    "scope": { "kind": "character", "id": "char-mei" },
                    "title": "Brass key",
                    "content": "Mei keeps a brass key.",
                    "confidence": 0.8,
                    "provenance": { "sourceChatId": "chat-1", "messageIds": ["message-1"], "timestamp": "2026-09-30T12:00:00.000Z" }
                }),
            )
            .expect("seed memory");
        }
    }

    #[test]
    fn character_delete_previews_every_side_effect_it_applies() {
        let state = test_state("character-delete");
        seed_character_with_side_effects(&state);
        let scope = scope(
            DekiRuntimeOwner::Embedded,
            &unique_session("character-delete"),
        );

        let result = dry_run(
            &state,
            &scope,
            json!({ "action": "delete", "collection": "characters", "id": "char-mei", "reason": "Retire Mei" }),
        );

        let summary = &result["summary"];
        assert_eq!(
            summary["affectedEntities"],
            json!({
                "characters": 1,
                "character-gallery": 1,
                (knowledge_edges::COLLECTION): 1,
                (canonical_memory::MEMORY_COLLECTION): 1,
            }),
            "{result}"
        );
        assert_eq!(summary["affectedRows"], 4);
        assert_eq!(summary["deletedRows"], 2);
        assert_eq!(summary["updatedRows"], 2);
        let preview = summary["preview"].as_array().expect("preview rows");
        let side_rows = preview[1..]
            .iter()
            .map(|row| {
                format!("{} {} {}", row["action"], row["entity"], row["id"]).replace('"', "")
            })
            .collect::<Vec<_>>();
        assert_eq!(
            side_rows,
            [
                "delete character-gallery img-1".to_string(),
                format!("update {} edge-1", knowledge_edges::COLLECTION),
                format!("update {} mem-1", canonical_memory::MEMORY_COLLECTION),
            ]
        );
        assert_eq!(preview[3]["effect"], "memory moved to deleted");
        assert_eq!(preview[3]["before"]["title"], "Brass key");

        approve(
            &state,
            &DekiRuntimeOwner::Embedded,
            &scope.session_id,
            &approval_id(&result),
        )
        .expect("delete applies");

        let gallery = state.storage.list("character-gallery").expect("gallery");
        assert_eq!(gallery.len(), 1);
        assert_eq!(gallery[0]["id"], "img-2");
        let edge = state
            .storage
            .get(knowledge_edges::COLLECTION, "edge-1")
            .expect("read edge")
            .expect("edge kept");
        assert_eq!(edge["status"], "invalidated");
        let memory = state
            .storage
            .get(canonical_memory::MEMORY_COLLECTION, "mem-1")
            .expect("read memory")
            .expect("memory kept");
        assert_eq!(memory["status"], "deleted");
    }

    #[test]
    fn a_related_row_change_after_the_dry_run_blocks_the_delete() {
        let state = test_state("character-delete-stale");
        seed_character_with_side_effects(&state);
        let scope = scope(
            DekiRuntimeOwner::Embedded,
            &unique_session("character-delete-stale"),
        );
        let result = dry_run(
            &state,
            &scope,
            json!({ "action": "delete", "collection": "characters", "id": "char-mei", "reason": "Retire Mei" }),
        );
        state
            .storage
            .create(
                "character-gallery",
                json!({ "id": "img-3", "characterId": "char-mei", "filename": "mei-new.png" }),
            )
            .expect("new gallery image after the dry-run");

        let error = approve(
            &state,
            &DekiRuntimeOwner::Embedded,
            &scope.session_id,
            &approval_id(&result),
        )
        .expect_err("the unseen gallery image must block the delete");

        assert_eq!(error.code, "deki_workspace_state_changed");
        assert!(state
            .storage
            .get("characters", "char-mei")
            .expect("read")
            .is_some());
        assert_eq!(
            state
                .storage
                .list("character-gallery")
                .expect("gallery")
                .len(),
            3
        );
    }

    #[test]
    fn lorebook_delete_previews_folders_and_unlinked_references() {
        let state = test_state("lorebook-delete-refs");
        seed_lorebook(&state);
        for (collection, row) in [
            (
                "lorebook-folders",
                json!({ "id": "folder-1", "lorebookId": "book-pond", "name": "Fish" }),
            ),
            (
                "chats",
                json!({ "id": "chat-1", "name": "Pond chat", "metadata": "{\"activeLorebookIds\":[\"book-pond\"]}" }),
            ),
            (
                "chats",
                json!({ "id": "chat-2", "name": "Other chat", "activeLorebookIds": ["book-other"] }),
            ),
            (
                "characters",
                json!({ "id": "char-linked", "data": { "name": "Linked", "extensions": { "importMetadata": { "embeddedLorebook": { "lorebookId": "book-pond" } } } } }),
            ),
        ] {
            state.storage.create(collection, row).expect("seed row");
        }
        let scope = scope(
            DekiRuntimeOwner::Embedded,
            &unique_session("lorebook-delete-refs"),
        );

        let result = dry_run(
            &state,
            &scope,
            json!({ "action": "delete", "collection": "lorebooks", "id": "book-pond", "reason": "Retire" }),
        );

        assert_eq!(
            result["summary"]["affectedEntities"],
            json!({ "lorebooks": 1, "lorebook-entries": 1, "lorebook-folders": 1, "chats": 1, "characters": 1 }),
            "{result}"
        );
        assert_eq!(result["summary"]["deletedRows"], 3);
        assert_eq!(result["summary"]["updatedRows"], 2);
    }

    #[test]
    fn character_patch_preview_shows_only_changed_card_fields() {
        let state = test_state("character-patch");
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-rina",
                    "data": {
                        "name": "Rina",
                        "description": "d".repeat(2_000),
                        "scenario": "Old scenario"
                    }
                }),
            )
            .expect("seed character");
        let scope = scope(
            DekiRuntimeOwner::Embedded,
            &unique_session("character-patch"),
        );

        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "patch",
                "collection": "characters",
                "id": "char-rina",
                "patch": { "data": { "scenario": "New scenario" } },
                "reason": "Sharper scenario"
            }),
        );

        let row = &result["summary"]["preview"][0];
        assert_eq!(
            row["before"],
            json!({ "data": { "scenario": "Old scenario" } })
        );
        assert_eq!(
            row["after"],
            json!({ "data": { "scenario": "New scenario" } })
        );
        approve(
            &state,
            &DekiRuntimeOwner::Embedded,
            &scope.session_id,
            &approval_id(&result),
        )
        .expect("character patch should apply");
        let stored = state
            .storage
            .get("characters", "char-rina")
            .expect("read character")
            .expect("character exists");
        assert_eq!(stored["data"]["scenario"], "New scenario");
        assert_eq!(stored["data"]["name"], "Rina");
    }

    #[test]
    fn prompt_context_reports_outcomes_without_dry_run_noise() {
        let state = test_state("prompt-context");
        seed_lorebook(&state);
        let scope = scope(
            DekiRuntimeOwner::Embedded,
            &unique_session("prompt-context"),
        );
        assert!(prompt_context(&scope).expect("approval context").is_none());
        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "delete",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "reason": "Duplicate entry"
            }),
        );
        let waiting = prompt_context(&scope)
            .expect("approval context")
            .expect("pending approval is reported");
        assert!(
            waiting.contains("waiting for approval: deki data delete lorebook-entries/entry-koi")
        );

        reject(
            &DekiRuntimeOwner::Embedded,
            &scope.session_id,
            &approval_id(&result),
        )
        .expect("reject");

        let context = prompt_context(&scope)
            .expect("approval context")
            .expect("history is reported");
        assert!(context.contains("- rejected: deki data delete lorebook-entries/entry-koi"));
        assert!(!context.contains("waiting for approval"));
    }

    #[test]
    fn approvals_are_isolated_by_session_for_the_same_owner() {
        let state = test_state("session");
        seed_lorebook(&state);
        let first = scope(DekiRuntimeOwner::Embedded, &unique_session("session-a"));
        let second = scope(DekiRuntimeOwner::Embedded, &unique_session("session-b"));
        let result = dry_run(
            &state,
            &first,
            json!({
                "action": "delete",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "reason": "Remove entry"
            }),
        );
        let id = approval_id(&result);

        let approved = approve(&state, &DekiRuntimeOwner::Embedded, &second.session_id, &id)
            .expect("cross-session approve resolves");
        let rejected = reject(&DekiRuntimeOwner::Embedded, &second.session_id, &id)
            .expect("cross-session reject resolves");

        assert_eq!(approved["status"], "not_found");
        assert_eq!(rejected["status"], "not_found");
        assert_eq!(approved["pendingApprovals"], json!([]));
        assert_eq!(pending_for(&first).expect("pending approvals").len(), 1);
        assert!(state
            .storage
            .get("lorebook-entries", "entry-koi")
            .expect("read entry")
            .is_some());
    }

    #[test]
    fn competing_writes_wait_until_the_approved_change_is_applied() {
        let state = test_state("race");
        seed_lorebook(&state);
        let scope = scope(DekiRuntimeOwner::Embedded, &unique_session("race"));
        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "patch",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "patch": { "content": "Deki's approved text." },
                "reason": "Rewrite"
            }),
        );
        let (landed_tx, landed_rx) = std::sync::mpsc::channel();
        let competitor_state = state.clone();
        let competitor = std::sync::Arc::new(std::sync::Mutex::new(None));
        let competitor_handle = competitor.clone();
        BEFORE_APPLY_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                let handle = std::thread::spawn(move || {
                    competitor_state
                        .storage
                        .patch(
                            "lorebook-entries",
                            "entry-koi",
                            json!({ "name": "Renamed meanwhile" }),
                        )
                        .expect("competing write");
                    landed_tx.send(()).expect("signal competing write");
                });
                assert!(
                    landed_rx
                        .recv_timeout(std::time::Duration::from_millis(150))
                        .is_err(),
                    "a competing write must not land between the hash check and the approved write"
                );
                *competitor_handle.lock().expect("competitor slot") = Some((handle, landed_rx));
                Ok(())
            }));
        });

        approve(
            &state,
            &DekiRuntimeOwner::Embedded,
            &scope.session_id,
            &approval_id(&result),
        )
        .expect("approval applies");

        let (handle, landed_rx) = competitor
            .lock()
            .expect("competitor slot")
            .take()
            .expect("hook ran between check and apply");
        landed_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("competing write lands after the approval");
        handle.join().expect("competitor thread");
        let stored = state
            .storage
            .get("lorebook-entries", "entry-koi")
            .expect("read entry")
            .expect("entry exists");
        assert_eq!(stored["content"], "Deki's approved text.");
        assert_eq!(stored["name"], "Renamed meanwhile");
    }

    fn fail_next_apply(write_first: Option<(AppState, Value)>) {
        BEFORE_APPLY_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                if let Some((state, patch)) = write_first {
                    state
                        .storage
                        .patch("lorebook-entries", "entry-koi", patch)
                        .expect("partial write");
                }
                Err(AppError::new("storage_error", "disk unavailable"))
            }));
        });
    }

    #[test]
    fn a_failed_write_that_changed_nothing_keeps_the_approval_retryable() {
        let state = test_state("retry");
        seed_lorebook(&state);
        let scope = scope(DekiRuntimeOwner::Embedded, &unique_session("retry"));
        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "patch",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "patch": { "content": "Koi circle the lantern at dawn." },
                "reason": "Fix the time of day"
            }),
        );
        let id = approval_id(&result);
        fail_next_apply(None);

        let error = approve(&state, &DekiRuntimeOwner::Embedded, &scope.session_id, &id)
            .expect_err("the injected write failure surfaces");

        assert_eq!(error.code, "deki_workspace_apply_failed");
        assert!(
            error
                .message
                .starts_with("Nothing was applied: disk unavailable."),
            "{}",
            error.message
        );
        let pending = pending_for(&scope).expect("pending approvals");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0]["id"], id);
        assert_eq!(
            pending[0]["operationHash"],
            result["approval"]["operationHash"]
        );
        assert_eq!(
            history_for(&scope).expect("history")[0]["status"],
            "dry-run"
        );

        let decision = approve(&state, &DekiRuntimeOwner::Embedded, &scope.session_id, &id)
            .expect("the retry applies");

        assert_eq!(decision["status"], "approved");
        let history = history_for(&scope).expect("history");
        assert_eq!(
            history.len(),
            1,
            "a retry must not add history rows: {history:?}"
        );
        assert_eq!(history[0]["status"], "approved");
        let stored = state
            .storage
            .get("lorebook-entries", "entry-koi")
            .expect("read entry")
            .expect("entry exists");
        assert_eq!(stored["content"], "Koi circle the lantern at dawn.");
    }

    #[test]
    fn a_failed_write_that_changed_storage_is_not_replayable() {
        let state = test_state("partial");
        seed_lorebook(&state);
        let scope = scope(DekiRuntimeOwner::Embedded, &unique_session("partial"));
        let result = dry_run(
            &state,
            &scope,
            json!({
                "action": "patch",
                "collection": "lorebook-entries",
                "id": "entry-koi",
                "patch": { "content": "Koi circle the lantern at dawn." },
                "reason": "Fix the time of day"
            }),
        );
        let id = approval_id(&result);
        fail_next_apply(Some((state.clone(), json!({ "name": "Half-written" }))));

        let error = approve(&state, &DekiRuntimeOwner::Embedded, &scope.session_id, &id)
            .expect_err("the injected write failure surfaces");

        assert_eq!(error.code, "deki_workspace_partial_apply");
        assert!(
            error
                .message
                .starts_with("Part of this change may have been saved"),
            "{}",
            error.message
        );
        assert!(pending_for(&scope).expect("pending approvals").is_empty());
        let history = history_for(&scope).expect("history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0]["status"], "failed");
        let replay = approve(&state, &DekiRuntimeOwner::Embedded, &scope.session_id, &id)
            .expect("a replay resolves");
        assert_eq!(replay["status"], "not_found");
        assert_eq!(history_for(&scope).expect("history").len(), 1);
    }

    #[test]
    fn a_poisoned_approval_store_reports_unavailable_instead_of_empty() {
        let poisoned = std::sync::Arc::new(Mutex::new(ApprovalStore::default()));
        let poisoner = poisoned.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock().expect("lock before poisoning");
            panic!("poison the approval store");
        })
        .join();

        let error = lock_store(&poisoned)
            .map(|_| ())
            .expect_err("poisoned state must not read as empty");

        assert_eq!(error.code, "deki_workspace_state_failed");
    }
}
