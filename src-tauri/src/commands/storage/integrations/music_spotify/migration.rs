//! Moves the Client ID and tokens of a legacy `spotify`-type agent record into the Music Player's Spotify
//! settings, once. Plain tokens are encrypted on the move. When tokens move, Spotify becomes the Music
//! Player source and the Music Player module is switched on. Once the Music Player holds a sign-in,
//! the token fields are removed from the legacy records; the records themselves, with their Client ID,
//! stay (hidden and never run).

use super::super::super::connection_secrets;
use super::super::music_settings::{self, SOURCE_SPOTIFY};
use super::api::{account_record, load_account, save_account, Account};
use crate::state::AppState;
use marinara_core::AppResult;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, PoisonError};

const MIGRATED_FIELD: &str = "spotifyLegacyMigrated";
/// The frontend's core module settings row and the Music Player's module ID
/// (`core-modules-api.ts`, `MUSIC_DJ_MINI_PLAYER_MODULE_ID`).
const CORE_MODULES_SETTINGS_KEY: &str = "core-modules";
const MUSIC_PLAYER_MODULE_ID: &str = "music-dj-mini-player";
const LEGACY_TOKEN_FIELDS: &[&str] = &[
    "spotifyAccessToken",
    "spotifyRefreshToken",
    "spotifyAccessTokenEncrypted",
    "spotifyRefreshTokenEncrypted",
    "spotifyExpiresAt",
    "spotifyScope",
];

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
        .filter(|record| is_legacy_record(record))
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
    let moved = match refresh_token {
        Some(refresh_token) if account_record(state)?.is_none() => {
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
            log::info!("[music] moved the legacy Spotify sign-in into Music Player settings");
            true
        }
        // An earlier run moved this sign-in but stopped before it finished.
        Some(refresh_token) => {
            load_account(state)?.is_some_and(|account| account.refresh_token == refresh_token)
        }
        None => false,
    };
    if moved {
        patch.insert("source".into(), json!(SOURCE_SPOTIFY));
        enable_music_player_module(state)?;
    }
    // Saved before the legacy tokens go: once they are gone, a re-run can't tell that they moved.
    if !patch.is_empty() {
        music_settings::write_patch(state, patch)?;
    }
    if account_record(state)?.is_some() {
        remove_legacy_tokens(state)?;
    }
    let mut done = Map::new();
    done.insert(MIGRATED_FIELD.into(), json!(true));
    music_settings::write_patch(state, done)
}

fn is_legacy_record(record: &Value) -> bool {
    record.get("type").and_then(Value::as_str) == Some("spotify")
}

/// Switches the Music Player module on in the core module settings, keeping every other module's
/// switch, so a moved Spotify sign-in keeps playing. Returns whether the record changed.
fn switch_on_music_player(record: &mut Map<String, Value>) -> bool {
    let object = |value: Option<&Value>| {
        value
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default()
    };
    let mut value = object(record.get("value"));
    let mut enabled = object(value.get("enabled"));
    if enabled.get(MUSIC_PLAYER_MODULE_ID) == Some(&Value::Bool(true)) {
        return false;
    }
    enabled.insert(MUSIC_PLAYER_MODULE_ID.into(), Value::Bool(true));
    value.insert("enabled".into(), Value::Object(enabled));
    record.insert("value".into(), Value::Object(value));
    true
}

fn enable_music_player_module(state: &AppState) -> AppResult<()> {
    if state
        .storage
        .get("app-settings", CORE_MODULES_SETTINGS_KEY)?
        .is_some()
    {
        state
            .storage
            .patch_if("app-settings", CORE_MODULES_SETTINGS_KEY, |record| {
                Ok(switch_on_music_player(record))
            })?;
    } else {
        let mut record = Map::new();
        switch_on_music_player(&mut record);
        state.storage.upsert_with_id(
            "app-settings",
            CORE_MODULES_SETTINGS_KEY,
            Value::Object(record),
        )?;
    }
    Ok(())
}

/// Removes the token fields from a legacy record's settings (an object or a JSON string), keeping
/// the Client ID and everything else. Returns whether there were any.
fn strip_legacy_tokens(record: &mut Map<String, Value>) -> bool {
    let remove = |settings: &mut Map<String, Value>| {
        let before = settings.len();
        for key in LEGACY_TOKEN_FIELDS {
            settings.remove(*key);
        }
        settings.len() != before
    };
    match record.get_mut("settings") {
        Some(Value::Object(settings)) => remove(settings),
        Some(Value::String(raw)) => {
            let Ok(Value::Object(mut settings)) = serde_json::from_str::<Value>(raw) else {
                return false;
            };
            let removed = remove(&mut settings);
            if removed {
                *raw = Value::Object(settings).to_string();
            }
            removed
        }
        _ => false,
    }
}

/// Clears the tokens out of every legacy `spotify` record once the Music Player holds the sign-in,
/// so they don't stay behind in plain text or in profile exports. Records without tokens aren't
/// written, so running it again changes nothing.
fn remove_legacy_tokens(state: &AppState) -> AppResult<()> {
    let ids: Vec<String> = state
        .storage
        .list("agents")?
        .iter()
        .filter(|record| is_legacy_record(record))
        .filter_map(|record| {
            record
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect();
    for id in ids {
        state
            .storage
            .patch_if("agents", &id, |record| Ok(strip_legacy_tokens(record)))?;
    }
    Ok(())
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
        // Nothing moved, so the module switches stay as they were.
        assert!(state
            .storage
            .get("app-settings", CORE_MODULES_SETTINGS_KEY)
            .unwrap()
            .is_none());
    }

    #[test]
    fn moving_tokens_switches_on_the_music_player_and_keeps_other_modules() {
        let state = test_state("migrate-module");
        state
            .storage
            .upsert_with_id(
                "app-settings",
                CORE_MODULES_SETTINGS_KEY,
                json!({ "value": { "enabled": { "me-notes": true, MUSIC_PLAYER_MODULE_ID: false } } }),
            )
            .unwrap();
        store_agent(
            &state,
            "legacy",
            json!({ "spotifyClientId": "abc", "spotifyRefreshToken": "plain-refresh" }),
        );
        migrate(&state).unwrap();
        let modules = state
            .storage
            .get("app-settings", CORE_MODULES_SETTINGS_KEY)
            .unwrap()
            .unwrap();
        assert_eq!(
            modules["value"]["enabled"],
            json!({ "me-notes": true, MUSIC_PLAYER_MODULE_ID: true })
        );
    }

    #[test]
    fn moved_tokens_are_removed_from_the_legacy_record_and_a_rerun_changes_nothing() {
        let state = test_state("migrate-strip");
        let encrypted = connection_secrets::encrypt_secret(&state, "secret-refresh").unwrap();
        let settings = json!({
            "spotifyClientId": "abc",
            "spotifyAccessToken": "plain-access",
            "spotifyRefreshTokenEncrypted": encrypted,
            "spotifyExpiresAt": 1_700_000_000_000_u64,
            "spotifyScope": "user-library-read",
            "other": "kept"
        });
        store_agent(&state, "legacy", json!(settings.to_string()));
        migrate(&state).unwrap();

        let stored_settings = |state: &AppState| -> Value {
            let record = state.storage.get("agents", "legacy").unwrap().unwrap();
            serde_json::from_str(record["settings"].as_str().unwrap()).unwrap()
        };
        assert_eq!(
            stored_settings(&state),
            json!({ "spotifyClientId": "abc", "other": "kept" })
        );
        assert_eq!(
            load_account(&state).unwrap().unwrap().refresh_token,
            "secret-refresh"
        );

        // A run that stopped before writing the done flag is picked up again safely.
        music_settings::write_patch(&state, {
            let mut patch = Map::new();
            patch.insert(MIGRATED_FIELD.into(), json!(false));
            patch
        })
        .unwrap();
        migrate(&state).unwrap();
        assert_eq!(
            stored_settings(&state),
            json!({ "spotifyClientId": "abc", "other": "kept" })
        );
        assert!(load_account(&state).unwrap().is_some());
        assert_eq!(music_settings::read(&state).unwrap()["source"], "spotify");
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
