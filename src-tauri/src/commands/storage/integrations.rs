use super::*;

#[path = "integrations/discord.rs"]
mod discord;
#[path = "integrations/music.rs"]
mod music;
#[path = "integrations/music_settings.rs"]
mod music_settings;
#[path = "integrations/music_spotify.rs"]
mod music_spotify;
#[path = "integrations/tts.rs"]
mod tts;

pub(crate) async fn tts_call(
    state: &AppState,
    method: &str,
    rest: &[&str],
    body: Value,
) -> AppResult<Value> {
    tts::tts_call(state, method, rest, body).await
}

/// Music Player commands. Settings are shared by both sources; `provider: "spotify"` goes to the
/// Spotify source and everything else keeps the YouTube behavior.
pub(crate) async fn music_call(
    state: &AppState,
    method: &str,
    rest: &[&str],
    body: Value,
) -> AppResult<Value> {
    match rest.first().copied() {
        Some("settings") => return music_spotify::settings(state),
        Some("update-settings") => return music_spotify::update_settings(state, body),
        _ => {}
    }
    if music_spotify::is_spotify_request(&body) {
        let action = rest.first().copied().unwrap_or("status");
        return music_spotify::music_call(state, action, body).await;
    }
    music::music_call(state, method, rest, body).await
}

pub(crate) async fn spotify_callback_page(state: &AppState, query: &str) -> (u16, String) {
    music_spotify::callback_page(state, query).await
}

pub(crate) fn check_spotify_redirect_uri_config() {
    music_spotify::check_redirect_uri_config();
}

pub(crate) fn migrate_legacy_spotify_sign_in(state: &AppState) {
    music_spotify::migrate_legacy_sign_in(state);
}

pub(crate) async fn discord_webhook_send(body: Value) -> AppResult<Value> {
    discord::discord_webhook_send(body).await
}

pub(crate) fn is_valid_discord_webhook_url(raw: &str) -> bool {
    discord::is_valid_discord_webhook_url(raw)
}
