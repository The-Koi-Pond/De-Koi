use super::super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};

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
        "active": false,
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
