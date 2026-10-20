//! Signed Tauri auto-updates for release desktop builds.
//!
//! Only release builds carry `plugins.updater` (merged in from
//! `tauri.release.conf.json` by the release workflow). Dev, source and pre-alpha
//! builds never register the plugin and keep the manual GitHub Releases handoff.
//!
//! The updater only installs files whose signature matches the public key in
//! that config, so a tampered download is rejected before anything runs.

use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Give the window and storage time to settle before the first network check.
const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(5);
const RELEASES_URL: &str = "https://github.com/The-Koi-Pond/De-Koi/releases/latest";

static INSTALL_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub(crate) fn is_configured(config: &tauri::Config) -> bool {
    config.plugins.0.contains_key("updater")
}

/// Registers the updater plugin and schedules the startup prompt, but only for
/// builds whose config includes `plugins.updater`. The plugin refuses to start
/// without that config, so unconfigured builds must not register it at all.
pub(crate) fn register(app: &tauri::App) -> tauri::Result<()> {
    if !is_configured(app.config()) {
        return Ok(());
    }
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_CHECK_DELAY).await;
        prompt_for_available_update(handle).await;
    });
    Ok(())
}

async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<Update>> {
    let handle = app.clone();
    app.updater_builder()
        // On Windows the installer path ends with `std::process::exit`, which skips
        // the normal quit cleanup in `lib.rs`. Run the same cleanup here. This hook
        // runs on the blocking thread `install_downloaded` uses, so block_on is safe.
        .on_before_exit(move || {
            crate::flush_pending_storage(&handle);
            if let Err(error) = tauri::async_runtime::block_on(marinara_sidecar::shutdown()) {
                log::error!("failed to stop local model before installing update: {error}");
            }
            handle.cleanup_before_exit();
        })
        .build()?
        .check()
        .await
}

async fn prompt_for_available_update(app: AppHandle) {
    let update = match check(&app).await {
        Ok(Some(update)) => update,
        Ok(None) => return,
        Err(error) => {
            // Offline starts are normal; the manual check in Settings still works.
            log::warn!("startup update check failed: {error}");
            return;
        }
    };

    let message = format!(
        "De-Koi {} is available. You have {}.\n\n\
         Install it now? De-Koi will download the update, close, install it and open again. \
         Your chats and settings stay where they are.",
        update.version, update.current_version
    );
    if !ask(
        &app,
        "Update available",
        message,
        MessageDialogKind::Info,
        Some(("Install and restart", "Later")),
    )
    .await
    {
        return;
    }

    // A successful install never returns (exit into the installer, or restart).
    let Err(error) = install(&app, update).await;
    log::error!("update install failed: {error}");
    ask(
        &app,
        "Update failed",
        format!(
            "De-Koi couldn't install the update: {error}\n\n\
             De-Koi was not updated. You can download the new version yourself from {RELEASES_URL}"
        ),
        MessageDialogKind::Error,
        None,
    )
    .await;
}

async fn ask(
    app: &AppHandle,
    title: &str,
    message: String,
    kind: MessageDialogKind,
    buttons: Option<(&str, &str)>,
) -> bool {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().message(message).title(title).kind(kind);
    if let Some((ok, cancel)) = buttons {
        dialog = dialog.buttons(MessageDialogButtons::OkCancelCustom(
            ok.to_string(),
            cancel.to_string(),
        ));
    }
    dialog.show(move |accepted| {
        let _ = sender.send(accepted);
    });
    receiver.await.unwrap_or(false)
}

/// Downloads, verifies and installs `update`, then restarts De-Koi.
/// On success this does not return: Windows exits into the installer and other
/// platforms restart into the new version.
async fn install(app: &AppHandle, update: Update) -> Result<Infallible, String> {
    if INSTALL_IN_PROGRESS.swap(true, Ordering::AcqRel) {
        return Err("an update is already being installed".to_string());
    }
    let result = download_and_install(app, update).await;
    INSTALL_IN_PROGRESS.store(false, Ordering::Release);
    result
}

async fn download_and_install(app: &AppHandle, update: Update) -> Result<Infallible, String> {
    // `download` checks the signature against the configured public key.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    // Windows never reaches this line. Linux and macOS restart into the new
    // version; the RESTART_EXIT_CODE path in `lib.rs` runs the quit cleanup.
    app.restart();
}

/// `update_apply` for release builds: install the newest signed update.
pub(crate) async fn apply_from_command(app: &AppHandle, input: &Value) -> AppResult<Value> {
    if input.get("confirm").and_then(Value::as_bool) != Some(true) {
        return Err(AppError::invalid_input(
            "Must send { confirm: true } to install the update",
        ));
    }
    let update = check(app)
        .await
        .map_err(|error| AppError::new("update_check_failed", error.to_string()))?;
    let Some(update) = update else {
        return Ok(json!({
            "status": "up_to_date",
            "message": "De-Koi is already on the newest release.",
            "currentVersion": app.package_info().version.to_string(),
        }));
    };
    match install(app, update).await {
        Ok(never) => match never {},
        Err(error) => Err(AppError::new("update_install_failed", error)),
    }
}
