//! Spotify as a Music Player source. Reached through the `music_*` commands with `provider: "spotify"`.
//! Tokens stay on the server side; nothing here returns them.

use super::music_settings::{self, SOURCE_SPOTIFY};
use super::*;

#[path = "music_spotify/api.rs"]
mod api;
#[path = "music_spotify/auth.rs"]
mod auth;
#[path = "music_spotify/library.rs"]
mod library;
#[path = "music_spotify/matching.rs"]
mod matching;
#[path = "music_spotify/migration.rs"]
mod migration;
#[path = "music_spotify/playback.rs"]
mod playback;

pub(super) fn is_spotify_request(body: &Value) -> bool {
    body.get("provider").and_then(Value::as_str) == Some(SOURCE_SPOTIFY)
}

/// Logs a rejected `SPOTIFY_REDIRECT_URI` at startup instead of on the first sign-in.
pub(crate) fn check_redirect_uri_config() {
    let _ = auth::redirect_uri();
}

/// The page for `GET /spotify/callback` on the hosted server.
pub(crate) async fn callback_page(state: &AppState, query: &str) -> (u16, String) {
    auth::callback_page(state, query).await
}

fn settings_response(state: &AppState) -> AppResult<Value> {
    let mut settings = music_settings::read(state)?;
    if let Some(object) = settings.as_object_mut() {
        object.insert("spotifyRedirectUri".into(), json!(auth::redirect_uri()));
    }
    Ok(settings)
}

pub(super) fn settings(state: &AppState) -> AppResult<Value> {
    migration::ensure(state)?;
    settings_response(state)
}

/// Saves settings. A different Client ID ends the current sign-in, because its tokens belong to the old app.
pub(super) fn update_settings(state: &AppState, body: Value) -> AppResult<Value> {
    migration::ensure(state)?;
    let patch = music_settings::validated_patch(&body)?;
    if let Some(client_id) = patch.get("spotifyClientId").and_then(Value::as_str) {
        if let Some(account) = api::load_account(state)? {
            if account.client_id != client_id {
                disconnect_account(state)?;
            }
        }
    }
    music_settings::write_patch(state, patch)?;
    settings_response(state)
}

fn disconnect_account(state: &AppState) -> AppResult<()> {
    api::clear_account(state)?;
    library::clear_cache(state);
    Ok(())
}

fn status(state: &AppState) -> AppResult<Value> {
    let settings = music_settings::read(state)?;
    let client_id = settings["spotifyClientId"].as_str().unwrap_or_default();
    let account = api::load_account(state)?;
    let connected = account.is_some();
    let granted: Vec<String> = account
        .as_ref()
        .map(|account| {
            account
                .scope
                .split_whitespace()
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let missing: Vec<&str> = account
        .as_ref()
        .map(|account| account.missing_scopes(auth::SCOPES))
        .unwrap_or_default();
    Ok(json!({
        "provider": "spotify",
        "enabled": true,
        "selected": settings["source"] == SOURCE_SPOTIFY,
        "clientId": client_id,
        "hasClientId": !client_id.is_empty(),
        "connected": connected,
        "renewsAutomatically": account.as_ref().is_some_and(api::Account::access_token_expired),
        "displayName": account.as_ref().and_then(|account| account.display_name.clone()),
        "grantedScopes": granted,
        "missingScopes": missing,
        "redirectUri": auth::redirect_uri(),
        "requiresSetup": !connected,
        "powerModeAvailable": connected,
        "iframeFallbackAvailable": false,
        "searchBackend": "spotify-web-api",
    }))
}

async fn start_sign_in(state: &AppState, body: &Value) -> AppResult<Value> {
    if body.get("clientId").is_some() {
        let patch = json!({ "spotifyClientId": body["clientId"].clone() });
        update_settings(state, patch)?;
    }
    let settings = music_settings::read(state)?;
    let client_id = settings["spotifyClientId"].as_str().unwrap_or_default();
    if client_id.is_empty() {
        return Err(AppError::new(
            "music_spotify_no_client_id",
            "Enter your Spotify app's Client ID in Music Player settings, then press Connect.",
        ));
    }
    auth::start(state, client_id).await
}

fn required_text<'a>(body: &'a Value, key: &str) -> AppResult<&'a str> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input(format!("{key} is required")))
}

pub(super) async fn music_call(state: &AppState, action: &str, body: Value) -> AppResult<Value> {
    migration::ensure(state)?;
    match action {
        "status" => status(state),
        "search-candidates" if body.get("match").is_some_and(Value::is_object) => {
            let found = library::find_track(state, &body["match"]).await?;
            Ok(json!({
                "provider": "spotify",
                "candidates": [found["track"].clone()],
                "track": found["track"].clone(),
                "requiresSetup": false,
                "powerModeAvailable": true,
                "iframeFallbackAvailable": false,
                "source": "match",
                "providerError": null,
            }))
        }
        "search-candidates" => library::candidates(state, &body, false).await,
        "fresh-pick" => library::candidates(state, &body, true).await,
        "play" => playback::play(state, &body).await,
        "pause" => playback::pause(state, &body).await,
        "resume" => playback::resume(state, &body).await,
        "stop" => playback::stop(state, &body).await,
        "volume" => playback::set_volume(state, &body).await,
        "playback-state" => playback::playback_state(state).await,
        "devices" => playback::devices(state).await,
        "playlists" => library::playlists(state).await,
        "sign-in-start" => start_sign_in(state, &body).await,
        "sign-in-status" => auth::sign_in_status(state, required_text(&body, "signInId")?),
        "sign-in-finish" => {
            auth::finish_pasted(state, required_text(&body, "callbackUrl")?).await?;
            status(state)
        }
        "disconnect" => {
            disconnect_account(state)?;
            status(state)
        }
        _ => Err(AppError::not_found("Unknown music command")),
    }
}

#[cfg(test)]
mod tests {
    use super::api::tests::test_state;
    use super::*;

    #[tokio::test]
    async fn status_without_a_sign_in_is_not_connected_and_lists_the_redirect_uri() {
        let state = test_state("status");
        let value = music_call(&state, "status", json!({ "provider": "spotify" }))
            .await
            .unwrap();
        assert_eq!(value["connected"], false);
        assert_eq!(value["selected"], false);
        assert_eq!(value["redirectUri"], auth::redirect_uri());
        let error = music_call(&state, "playlists", json!({ "provider": "spotify" }))
            .await
            .unwrap_err();
        assert_eq!(error.message, api::NOT_CONNECTED_MESSAGE);
    }

    #[tokio::test]
    async fn sign_in_needs_a_client_id_and_disconnect_keeps_it() {
        let state = test_state("sign-in");
        let error = music_call(&state, "sign-in-start", json!({ "provider": "spotify" }))
            .await
            .unwrap_err();
        assert_eq!(error.code, "music_spotify_no_client_id");

        api::save_account(
            &state,
            &api::Account {
                client_id: "abc".into(),
                access_token: None,
                refresh_token: "r".into(),
                expires_at_ms: 0,
                scope: String::new(),
                display_name: Some("Xel".into()),
                user_id: None,
            },
        )
        .unwrap();
        update_settings(&state, json!({ "spotifyClientId": "abc" })).unwrap();
        let status = music_call(&state, "status", json!({ "provider": "spotify" }))
            .await
            .unwrap();
        assert_eq!(status["connected"], true);
        assert_eq!(status["renewsAutomatically"], true);
        assert_eq!(status["displayName"], "Xel");
        assert!(!status.to_string().contains("refreshToken"));

        let after = music_call(&state, "disconnect", json!({ "provider": "spotify" }))
            .await
            .unwrap();
        assert_eq!(after["connected"], false);
        assert_eq!(after["clientId"], "abc");
    }

    #[test]
    fn changing_the_client_id_ends_the_sign_in() {
        let state = test_state("client-change");
        api::save_account(
            &state,
            &api::Account {
                client_id: "old".into(),
                access_token: None,
                refresh_token: "r".into(),
                expires_at_ms: 0,
                scope: String::new(),
                display_name: None,
                user_id: None,
            },
        )
        .unwrap();
        update_settings(&state, json!({ "spotifyClientId": "new" })).unwrap();
        assert!(api::load_account(&state).unwrap().is_none());
    }
}
