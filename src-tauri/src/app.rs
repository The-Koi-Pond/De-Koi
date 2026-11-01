use crate::state::AppState;
use marinara_core::AppResult;
use tauri::AppHandle;

pub fn build_state(app: &AppHandle) -> AppResult<AppState> {
    // Log a rejected SPOTIFY_REDIRECT_URI at startup rather than at the first sign-in.
    crate::storage_commands::integrations::check_spotify_redirect_uri_config();
    AppState::new(app)
}
