use crate::state::AppState;
use marinara_core::AppResult;
use tauri::AppHandle;

pub fn build_state(app: &AppHandle) -> AppResult<AppState> {
    // Log a rejected SPOTIFY_REDIRECT_URI at startup rather than at the first sign-in.
    crate::storage_commands::integrations::check_spotify_redirect_uri_config();
    let state = AppState::new(app)?;
    // Before the frontend loads, so a moved Spotify sign-in finds the Music Player switched on.
    crate::storage_commands::integrations::migrate_legacy_spotify_sign_in(&state);
    Ok(state)
}
