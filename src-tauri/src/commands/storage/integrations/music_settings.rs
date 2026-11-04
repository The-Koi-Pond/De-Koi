//! Music Player settings that the server needs: the selected source and the Spotify Client ID and
//! preferred device. Stored in `app-settings` under `music-player`. Spotify tokens live elsewhere.

use super::*;

pub(super) const MUSIC_SETTINGS_KEY: &str = "music-player";
pub(super) const SOURCE_YOUTUBE: &str = "youtube";
pub(super) const SOURCE_SPOTIFY: &str = "spotify";
const MAX_CLIENT_ID_CHARS: usize = 128;
const MAX_DEVICE_FIELD_CHARS: usize = 256;

fn text(record: &Value, key: &str) -> Option<String> {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// The stored row as is (an empty object when nothing is stored yet).
pub(super) fn read_raw(state: &AppState) -> AppResult<Map<String, Value>> {
    Ok(state
        .storage
        .get("app-settings", MUSIC_SETTINGS_KEY)?
        .and_then(|record| record.as_object().cloned())
        .unwrap_or_default())
}

/// Normalized settings; YouTube is the default source.
pub(super) fn read(state: &AppState) -> AppResult<Value> {
    let raw = Value::Object(read_raw(state)?);
    let source = match text(&raw, "source").as_deref() {
        Some(SOURCE_SPOTIFY) => SOURCE_SPOTIFY,
        _ => SOURCE_YOUTUBE,
    };
    Ok(json!({
        "source": source,
        "spotifyClientId": text(&raw, "spotifyClientId").unwrap_or_default(),
        "spotifyPreferredDeviceId": text(&raw, "spotifyPreferredDeviceId"),
        "spotifyPreferredDeviceName": text(&raw, "spotifyPreferredDeviceName"),
    }))
}

/// Merges `patch` into the stored row.
pub(super) fn write_patch(state: &AppState, patch: Map<String, Value>) -> AppResult<()> {
    let mut record = read_raw(state)?;
    record.remove("id");
    for (key, value) in patch {
        record.insert(key, value);
    }
    record.insert("updatedAt".into(), json!(now_iso()));
    state
        .storage
        .upsert_with_id("app-settings", MUSIC_SETTINGS_KEY, Value::Object(record))?;
    Ok(())
}

fn optional_field(body: &Value, key: &str, max_chars: usize) -> AppResult<Option<Value>> {
    match body.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(Value::Null)),
        Some(Value::String(value)) => {
            let value = value.trim();
            if value.chars().count() > max_chars {
                return Err(AppError::invalid_input(format!("{key} is too long")));
            }
            Ok(Some(if value.is_empty() {
                Value::Null
            } else {
                json!(value)
            }))
        }
        Some(_) => Err(AppError::invalid_input(format!("{key} must be text"))),
    }
}

/// Validates an update and returns the patch to store. Unknown keys are ignored.
pub(super) fn validated_patch(body: &Value) -> AppResult<Map<String, Value>> {
    let mut patch = Map::new();
    if let Some(source) = body.get("source") {
        match source.as_str() {
            Some(SOURCE_YOUTUBE) | Some(SOURCE_SPOTIFY) => {
                patch.insert("source".into(), source.clone());
            }
            _ => {
                return Err(AppError::invalid_input(
                    "The Music Player source must be youtube or spotify",
                ))
            }
        }
    }
    if let Some(client_id) = optional_field(body, "spotifyClientId", MAX_CLIENT_ID_CHARS)? {
        if client_id
            .as_str()
            .is_some_and(|id| !id.chars().all(|c| c.is_ascii_alphanumeric()))
        {
            return Err(AppError::new(
                "music_spotify_invalid_client_id",
                "That doesn't look like a Spotify Client ID. Copy it from your app's page in the Spotify developer dashboard.",
            ));
        }
        patch.insert(
            "spotifyClientId".into(),
            if client_id.is_null() {
                json!("")
            } else {
                client_id
            },
        );
    }
    for key in ["spotifyPreferredDeviceId", "spotifyPreferredDeviceName"] {
        if let Some(value) = optional_field(body, key, MAX_DEVICE_FIELD_CHARS)? {
            patch.insert(key.into(), value);
        }
    }
    Ok(patch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_validate_source_and_client_id() {
        let patch = validated_patch(&json!({
            "source": "spotify",
            "spotifyClientId": " abc123 ",
            "spotifyPreferredDeviceId": "",
            "other": true
        }))
        .unwrap();
        assert_eq!(patch["source"], "spotify");
        assert_eq!(patch["spotifyClientId"], "abc123");
        assert!(patch["spotifyPreferredDeviceId"].is_null());
        assert!(!patch.contains_key("other"));
        assert!(validated_patch(&json!({ "source": "local" })).is_err());
        assert!(validated_patch(&json!({ "spotifyClientId": "not an id" })).is_err());
    }
}
