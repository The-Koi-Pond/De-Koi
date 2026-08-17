use super::super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::watch;

#[derive(Clone, Debug)]
pub(super) struct DekiRuntimeCancellation {
    id: u64,
    inner: Arc<DekiRuntimeCancellationInner>,
}

#[derive(Debug)]
struct DekiRuntimeCancellationInner {
    cancelled: watch::Sender<bool>,
}

#[derive(Debug)]
pub(super) struct DekiRuntimeGuard {
    scope: DekiRuntimeScope,
    cancellation: DekiRuntimeCancellation,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum DekiRuntimeOwner {
    Embedded,
    Authenticated(String),
    UnauthenticatedRemote,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct DekiRuntimeScope {
    owner: DekiRuntimeOwner,
    session_id: String,
}

static NEXT_RUNTIME_ID: AtomicU64 = AtomicU64::new(1);
static ACTIVE_RUNTIMES: OnceLock<Mutex<HashMap<DekiRuntimeScope, DekiRuntimeCancellation>>> =
    OnceLock::new();

fn active_runtimes() -> &'static Mutex<HashMap<DekiRuntimeScope, DekiRuntimeCancellation>> {
    ACTIVE_RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()))
}

impl DekiRuntimeCancellation {
    fn new() -> Self {
        Self {
            id: NEXT_RUNTIME_ID.fetch_add(1, Ordering::Relaxed),
            inner: Arc::new(DekiRuntimeCancellationInner {
                cancelled: watch::channel(false).0,
            }),
        }
    }

    pub(super) fn ensure_not_cancelled(&self) -> AppResult<()> {
        if *self.inner.cancelled.borrow() {
            Err(AppError::new(
                "deki_workspace_aborted",
                "Deki-senpai's workspace run was cancelled.",
            ))
        } else {
            Ok(())
        }
    }

    pub(super) async fn cancelled(&self) {
        let mut cancelled = self.inner.cancelled.subscribe();
        if *cancelled.borrow_and_update() {
            return;
        }
        while cancelled.changed().await.is_ok() {
            if *cancelled.borrow_and_update() {
                return;
            }
        }
    }

    fn cancel(&self) {
        self.inner.cancelled.send_replace(true);
    }
}

impl DekiRuntimeGuard {
    pub(super) fn cancellation(&self) -> DekiRuntimeCancellation {
        self.cancellation.clone()
    }
}

impl Drop for DekiRuntimeGuard {
    fn drop(&mut self) {
        let Ok(mut active) = active_runtimes().lock() else {
            return;
        };
        if active
            .get(&self.scope)
            .map(|runtime| runtime.id == self.cancellation.id)
            .unwrap_or(false)
        {
            active.remove(&self.scope);
        }
    }
}

pub(super) fn begin_runtime(
    owner: &DekiRuntimeOwner,
    session_id: &str,
) -> AppResult<DekiRuntimeGuard> {
    let scope = runtime_scope(owner, session_id)?;
    let mut active = active_runtimes().lock().map_err(|_| {
        AppError::new(
            "deki_workspace_state_failed",
            "Deki workspace runtime state is unavailable.",
        )
    })?;
    if active.contains_key(&scope) {
        return Err(AppError::new(
            "deki_workspace_busy",
            "Deki-senpai is already running a workspace task.",
        ));
    }
    let cancellation = DekiRuntimeCancellation::new();
    active.insert(scope.clone(), cancellation.clone());
    Ok(DekiRuntimeGuard {
        scope,
        cancellation,
    })
}

fn runtime_is_active(scope: &DekiRuntimeScope) -> bool {
    active_runtimes()
        .lock()
        .map(|active| active.contains_key(scope))
        .unwrap_or(false)
}

fn runtime_scope(owner: &DekiRuntimeOwner, session_id: &str) -> AppResult<DekiRuntimeScope> {
    validate_runtime_owner(owner)?;
    let session_id = session_id.trim();
    if session_id.is_empty() || session_id.chars().count() > 256 {
        return Err(AppError::invalid_input(
            "A valid Deki session id is required for workspace runtime control.",
        ));
    }
    Ok(DekiRuntimeScope {
        owner: owner.clone(),
        session_id: session_id.to_string(),
    })
}

pub(super) fn validate_runtime_owner(owner: &DekiRuntimeOwner) -> AppResult<()> {
    if matches!(owner, DekiRuntimeOwner::UnauthenticatedRemote) {
        return Err(AppError::new(
            "deki_workspace_remote_owner_unavailable",
            "Deki remote workspace commands require De-Koi Basic Auth so prompt, status, and abort share an isolated owner.",
        ));
    }
    Ok(())
}

pub(super) const DEKI_WORKSPACE_TOOLS: &[&str] = &[
    "read",
    "grep",
    "find",
    "ls",
    "deki_data",
    "deki_code",
    "read_deki_library",
    "read_deki_library_items",
    "search_deki_code",
    "read_deki_code_file",
    "read_deki_chats",
    "read_deki_chat_messages",
    "read_deki_memories",
    "search_deki_web",
    "read_deki_web_page",
];

pub(crate) async fn deki_workspace_status(
    state: &AppState,
    owner: &DekiRuntimeOwner,
    session_id: String,
    connection_id: Option<String>,
) -> AppResult<Value> {
    let scope = runtime_scope(owner, &session_id)?;
    let workspace = super::deki_repo_root()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let requested_connection_id = connection_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let (connection, error) = match requested_connection_id {
        Some(connection_id) => match deki_workspace_connection_summary(state, connection_id) {
            Ok(connection) => (connection, None),
            Err(error) => (
                Value::Null,
                Some(format!(
                    "Requested connection {connection_id} could not be summarized: {}",
                    error.message
                )),
            ),
        },
        None => (
            Value::Null,
            Some("Select a connection to run Deki workspace commands.".to_string()),
        ),
    };
    Ok(json!({
        "enabled": true,
        "workspace": workspace,
        "dataDir": state.data_dir.to_string_lossy(),
        "tools": DEKI_WORKSPACE_TOOLS,
        "dataAccess": "server-managed",
        "connection": connection,
        "active": runtime_is_active(&scope),
        "pendingApprovals": [],
        "history": [],
        "error": error,
    }))
}

fn deki_workspace_connection_summary(state: &AppState, connection_id: &str) -> AppResult<Value> {
    let connection_value = resolve_llm_connection_for_request(
        state,
        &json!({
            "connectionId": connection_id,
        }),
    )?;
    let connection = llm_connection_from_value(&connection_value)?;
    let name = connection_value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(connection_id);
    Ok(json!({
        "id": connection_id,
        "name": name,
        "provider": connection.provider,
        "model": connection.model,
    }))
}

pub(crate) async fn deki_workspace_abort(
    _state: &AppState,
    owner: &DekiRuntimeOwner,
    session_id: String,
) -> AppResult<Value> {
    let scope = runtime_scope(owner, &session_id)?;
    let runtime = active_runtimes()
        .lock()
        .map_err(|_| {
            AppError::new(
                "deki_workspace_state_failed",
                "Deki workspace runtime state is unavailable.",
            )
        })?
        .get(&scope)
        .cloned();
    if let Some(runtime) = runtime {
        runtime.cancel();
        return Ok(json!({
            "status": "aborted",
            "aborted": true,
            "active": true,
            "reason": "Deki workspace runtime cancellation was requested; the run remains active until its current operation unwinds.",
        }));
    }
    Ok(json!({
        "status": "not_running",
        "aborted": false,
        "active": false,
        "reason": "Deki workspace runtime is not running.",
    }))
}

pub(crate) async fn deki_workspace_approve(_state: &AppState, id: String) -> AppResult<Value> {
    validate_workspace_approval_id(&id)?;
    Err(deki_workspace_not_implemented("approval apply"))
}

pub(crate) async fn deki_workspace_reject(_state: &AppState, id: String) -> AppResult<Value> {
    validate_workspace_approval_id(&id)?;
    Err(deki_workspace_not_implemented("approval reject"))
}

fn validate_workspace_approval_id(id: &str) -> AppResult<()> {
    if id.trim().is_empty() {
        return Err(AppError::invalid_input("Workspace approval id is required"));
    }
    Ok(())
}

fn deki_workspace_not_implemented(action: &str) -> AppError {
    AppError::new(
        "deki_workspace_not_implemented",
        format!("Deki workspace {action} is not implemented yet."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_wakes_an_in_flight_waiter() {
        let cancellation = DekiRuntimeCancellation::new();
        let waiter = cancellation.clone();
        let waiting = tokio::spawn(async move {
            waiter.cancelled().await;
            waiter.ensure_not_cancelled().expect_err("cancelled run")
        });
        tokio::task::yield_now().await;

        cancellation.cancel();

        let error = waiting.await.expect("waiter should finish");
        assert_eq!(error.code, "deki_workspace_aborted");
    }

    #[test]
    fn runtime_guards_are_isolated_by_session() {
        let owner = DekiRuntimeOwner::Embedded;
        let first =
            begin_runtime(&owner, "status-test-session-a").expect("first session should start");
        let second =
            begin_runtime(&owner, "status-test-session-b").expect("second session should start");

        assert!(runtime_is_active(
            &runtime_scope(&owner, "status-test-session-a").expect("valid scope")
        ));
        assert!(runtime_is_active(
            &runtime_scope(&owner, "status-test-session-b").expect("valid scope")
        ));
        assert_eq!(
            begin_runtime(&owner, "status-test-session-a")
                .expect_err("the same session must not overlap")
                .code,
            "deki_workspace_busy"
        );

        drop(first);
        drop(second);
    }

    #[test]
    fn runtime_guards_are_isolated_by_authenticated_principal() {
        let first_owner = DekiRuntimeOwner::Authenticated("alice".to_string());
        let second_owner = DekiRuntimeOwner::Authenticated("bob".to_string());
        let first =
            begin_runtime(&first_owner, "shared-session").expect("first principal should start");
        let second =
            begin_runtime(&second_owner, "shared-session").expect("second principal should start");

        assert!(runtime_is_active(
            &runtime_scope(&first_owner, "shared-session").expect("valid first scope")
        ));
        assert!(runtime_is_active(
            &runtime_scope(&second_owner, "shared-session").expect("valid second scope")
        ));

        drop(first);
        drop(second);
    }

    #[test]
    fn unauthenticated_remote_runtime_ownership_is_rejected() {
        let error = begin_runtime(&DekiRuntimeOwner::UnauthenticatedRemote, "shared-session")
            .expect_err("remote auth bypass cannot provide an isolated owner");

        assert_eq!(error.code, "deki_workspace_remote_owner_unavailable");
    }

    #[tokio::test]
    async fn cancellation_wakes_all_waiters_without_a_lost_wakeup() {
        let cancellation = DekiRuntimeCancellation::new();
        let first = tokio::spawn({
            let cancellation = cancellation.clone();
            async move { cancellation.cancelled().await }
        });
        let second = tokio::spawn({
            let cancellation = cancellation.clone();
            async move { cancellation.cancelled().await }
        });

        cancellation.cancel();

        first.await.expect("first waiter should finish");
        second.await.expect("second waiter should finish");
        cancellation.cancelled().await;
    }
}
