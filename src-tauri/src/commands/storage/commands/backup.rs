use crate::state::AppState;
use crate::storage_commands::backup;
use marinara_core::{AppError, AppResult};
use serde_json::Value;
use tauri::State;

async fn run_blocking_backup(
    operation: impl FnOnce() -> AppResult<Value> + Send + 'static,
) -> AppResult<Value> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

#[tauri::command]
pub async fn backup_create(state: State<'_, AppState>) -> Result<Value, AppError> {
    let state = state.inner().clone();
    run_blocking_backup(move || backup::create_backup(&state)).await
}

#[tauri::command]
pub fn backup_list(state: State<'_, AppState>) -> Result<Value, AppError> {
    backup::list_backups(&state)
}

#[tauri::command]
pub fn backup_delete(state: State<'_, AppState>, name: String) -> Result<Value, AppError> {
    backup::delete_backup(&state, &name)
}

#[tauri::command]
pub async fn backup_download(
    state: State<'_, AppState>,
    name: Option<String>,
) -> Result<Value, AppError> {
    let state = state.inner().clone();
    run_blocking_backup(move || backup::download_backup(&state, name.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::run_blocking_backup;
    use serde_json::json;
    use std::sync::mpsc;
    use std::time::Duration;

    #[tokio::test(flavor = "current_thread")]
    async fn backup_blocking_work_leaves_tokio_available() {
        const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

        let (started_tx, started_rx) = mpsc::channel();
        let (progress_tx, progress_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let watchdog = std::thread::spawn(move || {
            let started = started_rx.recv_timeout(PROBE_TIMEOUT).is_ok();
            let progressed = started && progress_rx.recv_timeout(PROBE_TIMEOUT).is_ok();
            let _ = release_tx.send(());
            progressed
        });

        let work = tokio::spawn(run_blocking_backup(move || {
            started_tx
                .send(())
                .expect("watchdog should observe the blocking operation");
            entered_tx
                .send(())
                .expect("Tokio test should observe the blocking operation");
            release_rx
                .recv_timeout(PROBE_TIMEOUT)
                .expect("watchdog should release the blocking operation");
            Ok(json!({ "backup": "complete" }))
        }));

        tokio::time::timeout(PROBE_TIMEOUT, entered_rx)
            .await
            .expect("backup operation should enter its blocking body before the deadline")
            .expect("backup operation should notify the Tokio test");
        let unrelated = tokio::spawn(async move {
            let _ = progress_tx.send(());
        });
        tokio::time::timeout(PROBE_TIMEOUT, unrelated)
            .await
            .expect("unrelated Tokio work should complete before the deadline")
            .expect("unrelated Tokio work should not panic");
        assert_eq!(
            tokio::time::timeout(PROBE_TIMEOUT, work)
                .await
                .expect("backup worker should complete before the deadline")
                .expect("backup task should not panic")
                .expect("backup task should succeed"),
            json!({ "backup": "complete" })
        );
        assert!(
            tokio::time::timeout(
                PROBE_TIMEOUT,
                tokio::task::spawn_blocking(move || watchdog.join())
            )
            .await
            .expect("watchdog should join before the deadline")
            .expect("watchdog task should not panic")
            .expect("watchdog thread should not panic"),
            "unrelated Tokio work should progress before the backup operation is released"
        );
    }
}
