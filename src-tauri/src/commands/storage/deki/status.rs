use super::super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::Notify;

#[derive(Clone, Debug)]
pub(super) struct DekiRuntimeCancellation {
    id: u64,
    inner: Arc<DekiRuntimeCancellationInner>,
}

#[derive(Debug)]
struct DekiRuntimeCancellationInner {
    cancelled: AtomicBool,
    notify: Notify,
}

#[derive(Debug)]
pub(super) struct DekiRuntimeGuard {
    cancellation: DekiRuntimeCancellation,
}

static NEXT_RUNTIME_ID: AtomicU64 = AtomicU64::new(1);
static ACTIVE_RUNTIME: OnceLock<Mutex<Option<DekiRuntimeCancellation>>> = OnceLock::new();

fn active_runtime() -> &'static Mutex<Option<DekiRuntimeCancellation>> {
    ACTIVE_RUNTIME.get_or_init(|| Mutex::new(None))
}

impl DekiRuntimeCancellation {
    fn new() -> Self {
        Self {
            id: NEXT_RUNTIME_ID.fetch_add(1, Ordering::Relaxed),
            inner: Arc::new(DekiRuntimeCancellationInner {
                cancelled: AtomicBool::new(false),
                notify: Notify::new(),
            }),
        }
    }

    pub(super) fn ensure_not_cancelled(&self) -> AppResult<()> {
        if self.inner.cancelled.load(Ordering::Acquire) {
            Err(AppError::new(
                "deki_workspace_aborted",
                "Deki-senpai's workspace run was cancelled.",
            ))
        } else {
            Ok(())
        }
    }

    pub(super) async fn cancelled(&self) {
        if self.inner.cancelled.load(Ordering::Acquire) {
            return;
        }
        self.inner.notify.notified().await;
    }

    fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::Release);
        self.inner.notify.notify_one();
    }
}

impl DekiRuntimeGuard {
    pub(super) fn cancellation(&self) -> DekiRuntimeCancellation {
        self.cancellation.clone()
    }
}

impl Drop for DekiRuntimeGuard {
    fn drop(&mut self) {
        let Ok(mut active) = active_runtime().lock() else {
            return;
        };
        if active
            .as_ref()
            .map(|runtime| runtime.id == self.cancellation.id)
            .unwrap_or(false)
        {
            *active = None;
        }
    }
}

pub(super) fn begin_runtime() -> AppResult<DekiRuntimeGuard> {
    let mut active = active_runtime().lock().map_err(|_| {
        AppError::new(
            "deki_workspace_state_failed",
            "Deki workspace runtime state is unavailable.",
        )
    })?;
    if active.is_some() {
        return Err(AppError::new(
            "deki_workspace_busy",
            "Deki-senpai is already running a workspace task.",
        ));
    }
    let cancellation = DekiRuntimeCancellation::new();
    *active = Some(cancellation.clone());
    Ok(DekiRuntimeGuard { cancellation })
}

fn runtime_is_active() -> bool {
    active_runtime()
        .lock()
        .map(|active| active.is_some())
        .unwrap_or(false)
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
    connection_id: Option<String>,
) -> AppResult<Value> {
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
        "active": runtime_is_active(),
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

pub(crate) async fn deki_workspace_abort(_state: &AppState) -> AppResult<Value> {
    let runtime = active_runtime()
        .lock()
        .map_err(|_| {
            AppError::new(
                "deki_workspace_state_failed",
                "Deki workspace runtime state is unavailable.",
            )
        })?
        .clone();
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
}
