//! Moves the Client ID and tokens of a legacy `spotify`-type agent record into the Music Player's Spotify
//! settings, once. Plain tokens are encrypted on the move. When tokens move, Spotify becomes the Music
//! Player source. The legacy record is left as it is.

use super::super::super::connection_secrets;
use super::super::music_settings::{self, SOURCE_SPOTIFY};
use super::api::{account_record, save_account, Account};
use crate::state::AppState;
use marinara_core::AppResult;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, PoisonError};

const MIGRATED_FIELD: &str = "spotifyLegacyMigrated";

/// Runs the migration the first time this process touches the music settings of a data folder.
pub(super) fn ensure(state: &AppState) -> AppResult<()> {
    static CHECKED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    let mut checked = CHECKED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if checked.contains(&state.data_dir) {
        return Ok(());
    }
    migrate(state)?;
    checked.insert(state.data_dir.clone());
    Ok(())
}

fn legacy_settings(record: &Value) -> Map<String, Value> {
    match record.get("settings") {
        Some(Value::Object(settings)) => settings.clone(),
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default(),
        _ => Map::new(),
    }
}

fn text(settings: &Map<String, Value>, key: &str) -> Option<String> {
    settings
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// An encrypted token if it decrypts, else the old plain field.
fn legacy_token(
    state: &AppState,
    settings: &Map<String, Value>,
    encrypted_key: &str,
    plain_key: &str,
) -> Option<String> {
    if let Some(encrypted) = text(settings, encrypted_key) {
        match connection_secrets::decrypt_secret(state, &encrypted) {
            Ok(token) if !token.trim().is_empty() => return Some(token),
            _ => log::warn!("[music] legacy Spotify {encrypted_key} could not be decrypted"),
        }
    }
    text(settings, plain_key)
}

/// Milliseconds since the epoch from a number (seconds or milliseconds) or a date string.
fn legacy_expiry_ms(value: Option<&Value>) -> u64 {
    let from_number = |number: f64| {
        if number <= 0.0 {
            0
        } else if number < 100_000_000_000.0 {
            (number * 1000.0) as u64
        } else {
            number as u64
        }
    };
    match value {
        Some(Value::Number(number)) => number.as_f64().map(from_number).unwrap_or(0),
        Some(Value::String(text)) => text
            .trim()
            .parse::<f64>()
            .map(from_number)
            .ok()
            .or_else(|| {
                chrono::DateTime::parse_from_rfc3339(text.trim())
                    .ok()
                    .map(|date| date.timestamp_millis().max(0) as u64)
            })
            .unwrap_or(0),
        _ => 0,
    }
}

fn migrate(state: &AppState) -> AppResult<()> {
    let current = music_settings::read_raw(state)?;
    if current.get(MIGRATED_FIELD).and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }
    let legacy: Vec<Map<String, Value>> = state
        .storage
        .list("agents")?
        .iter()
        .filter(|record| record.get("type").and_then(Value::as_str) == Some("spotify"))
        .map(legacy_settings)
        .collect();
    if legacy.is_empty() {
        return Ok(());
    }
    let has_refresh = |settings: &&Map<String, Value>| {
        text(settings, "spotifyRefreshTokenEncrypted").is_some()
            || text(settings, "spotifyRefreshToken").is_some()
    };
    let chosen = legacy
        .iter()
        .find(has_refresh)
        .or_else(|| {
            legacy
                .iter()
                .find(|settings| text(settings, "spotifyClientId").is_some())
        })
        .unwrap_or(&legacy[0]);

    let mut patch = Map::new();
    let stored_client_id = text(&current, "spotifyClientId");
    let legacy_client_id = text(chosen, "spotifyClientId");
    if stored_client_id.is_none() {
        if let Some(client_id) = &legacy_client_id {
            patch.insert("spotifyClientId".into(), json!(client_id));
        }
    }

    let refresh_token = legacy_token(
        state,
        chosen,
        "spotifyRefreshTokenEncrypted",
        "spotifyRefreshToken",
    );
    if let (Some(refresh_token), None) = (refresh_token, account_record(state)?) {
        let account = Account {
            client_id: legacy_client_id.or(stored_client_id).unwrap_or_default(),
            access_token: legacy_token(
                state,
                chosen,
                "spotifyAccessTokenEncrypted",
                "spotifyAccessToken",
            ),
            refresh_token,
            expires_at_ms: legacy_expiry_ms(chosen.get("spotifyExpiresAt")),
            scope: text(chosen, "spotifyScope").unwrap_or_default(),
            display_name: None,
            user_id: None,
        };
        save_account(state, &account)?;
        patch.insert("source".into(), json!(SOURCE_SPOTIFY));
        log::info!("[music] moved the legacy Spotify sign-in into Music Player settings");
    }
    patch.insert(MIGRATED_FIELD.into(), json!(true));
    music_settings::write_patch(state, patch)
}

#[cfg(test)]
mod tests {
    use super::super::api::{load_account, tests::test_state};
    use super::*;

    fn store_agent(state: &AppState, id: &str, settings: Value) {
        state
            .storage
            .upsert_with_id(
                "agents",
                id,
                json!({ "type": "spotify", "name": "Spotify", "phase": "parallel", "settings": settings }),
            )
            .unwrap();
    }

    #[test]
    fn plain_legacy_tokens_are_encrypted_moved_and_select_spotify() {
        let state = test_state("migrate-plain");
        store_agent(
            &state,
            "legacy",
            json!({
                "spotifyClientId": "abc123",
                "spotifyAccessToken": "plain-access",
                "spotifyRefreshToken": "plain-refresh",
                "spotifyExpiresAt": 1_700_000_000_000_u64,
                "spotifyScope": "user-library-read"
            }),
        );
        migrate(&state).unwrap();

        let account = load_account(&state).unwrap().unwrap();
        assert_eq!(account.refresh_token, "plain-refresh");
        assert_eq!(account.access_token.as_deref(), Some("plain-access"));
        assert_eq!(account.client_id, "abc123");
        assert_eq!(account.expires_at_ms, 1_700_000_000_000);
        let raw = account_record(&state).unwrap().unwrap().to_string();
        assert!(!raw.contains("plain-refresh") && !raw.contains("plain-access"));

        let settings = music_settings::read(&state).unwrap();
        assert_eq!(settings["source"], "spotify");
        assert_eq!(settings["spotifyClientId"], "abc123");
        // The legacy record stays.
        assert!(state.storage.get("agents", "legacy").unwrap().is_some());
    }

    #[test]
    fn encrypted_legacy_tokens_move_and_the_migration_runs_once() {
        let state = test_state("migrate-encrypted");
        let encrypted = connection_secrets::encrypt_secret(&state, "secret-refresh").unwrap();
        store_agent(
            &state,
            "legacy",
            json!({ "spotifyClientId": "abc", "spotifyRefreshTokenEncrypted": encrypted, "spotifyExpiresAt": "2024-01-01T00:00:00Z" }),
        );
        migrate(&state).unwrap();
        assert_eq!(
            load_account(&state).unwrap().unwrap().refresh_token,
            "secret-refresh"
        );

        // After a disconnect the legacy tokens must not come back.
        super::super::api::clear_account(&state).unwrap();
        music_settings::write_patch(&state, {
            let mut patch = Map::new();
            patch.insert("source".into(), json!("youtube"));
            patch
        })
        .unwrap();
        migrate(&state).unwrap();
        assert!(load_account(&state).unwrap().is_none());
        assert_eq!(music_settings::read(&state).unwrap()["source"], "youtube");
    }

    #[test]
    fn a_legacy_record_without_tokens_moves_only_the_client_id() {
        let state = test_state("migrate-client");
        store_agent(&state, "legacy", json!(r#"{"spotifyClientId":"onlyid"}"#));
        migrate(&state).unwrap();
        assert!(load_account(&state).unwrap().is_none());
        let settings = music_settings::read(&state).unwrap();
        assert_eq!(settings["spotifyClientId"], "onlyid");
        assert_eq!(settings["source"], "youtube");
    }

    #[test]
    fn expiry_accepts_seconds_milliseconds_and_dates() {
        assert_eq!(
            legacy_expiry_ms(Some(&json!(1_700_000_000))),
            1_700_000_000_000
        );
        assert_eq!(
            legacy_expiry_ms(Some(&json!(1_700_000_000_000_u64))),
            1_700_000_000_000
        );
        assert_eq!(legacy_expiry_ms(Some(&json!("1970-01-01T00:00:01Z"))), 1000);
        assert_eq!(legacy_expiry_ms(None), 0);
    }
}
