use super::*;

#[path = "integrations/discord.rs"]
mod discord;
#[path = "integrations/music.rs"]
mod music;
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

pub(crate) async fn music_call(
    state: &AppState,
    method: &str,
    rest: &[&str],
    body: Value,
) -> AppResult<Value> {
    music::music_call(state, method, rest, body).await
}

pub(crate) async fn discord_webhook_send(body: Value) -> AppResult<Value> {
    discord::discord_webhook_send(body).await
}

pub(crate) fn is_valid_discord_webhook_url(raw: &str) -> bool {
    discord::is_valid_discord_webhook_url(raw)
}
