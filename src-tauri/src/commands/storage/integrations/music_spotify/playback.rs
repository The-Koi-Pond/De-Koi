//! Spotify playback on one of the user's devices: device choice, play on repeat with confirmation,
//! pause/resume, stop, volume, the playback state and the device list.

use super::super::super::images::percent_encode_component;
use super::api::{load_account, no_device_error, not_connected, volume_error, Spotify};
use super::matching;
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use reqwest::Method;
use serde_json::{json, Value};
use std::time::Duration;

pub(super) const CONTROL_SCOPES: &[&str] =
    &["user-modify-playback-state", "user-read-playback-state"];
const READ_SCOPES: &[&str] = &["user-read-playback-state"];
const CONFIRM_ATTEMPTS: u32 = 5;
const CONFIRM_INTERVAL: Duration = Duration::from_secs(1);
const FEATURE: &str = "Playback control";

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Device {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub is_active: bool,
    pub supports_volume: bool,
    pub volume: Option<u64>,
}

impl Device {
    fn from_json(value: &Value) -> Option<Self> {
        Some(Self {
            id: value
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())?
                .to_owned(),
            name: value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Spotify device")
                .to_owned(),
            kind: value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            is_active: value.get("is_active").and_then(Value::as_bool) == Some(true),
            supports_volume: value.get("supports_volume").and_then(Value::as_bool) != Some(false),
            volume: value.get("volume_percent").and_then(Value::as_u64),
        })
    }

    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "type": self.kind,
            "isActive": self.is_active,
            "supportsVolume": self.supports_volume,
            "volumePercent": self.volume,
        })
    }
}

/// The device to play on: the one currently playing, else the one Spotify reports as active, else the
/// preferred device if Spotify lists it.
pub(super) fn choose_device(
    playback: &Value,
    devices: &[Device],
    preferred: Option<&str>,
) -> Option<Device> {
    if playback.get("is_playing").and_then(Value::as_bool) == Some(true) {
        if let Some(device) = playback.get("device").and_then(Device::from_json) {
            return Some(
                devices
                    .iter()
                    .find(|listed| listed.id == device.id)
                    .cloned()
                    .unwrap_or(device),
            );
        }
    }
    if let Some(active) = devices.iter().find(|device| device.is_active) {
        return Some(active.clone());
    }
    if let Some(active) = playback
        .get("device")
        .and_then(Device::from_json)
        .filter(|device| device.is_active)
    {
        return Some(active);
    }
    let preferred = preferred.map(str::trim).filter(|id| !id.is_empty())?;
    devices
        .iter()
        .find(|device| device.id == preferred)
        .cloned()
}

async fn current_playback(spotify: &Spotify) -> AppResult<Value> {
    let reply = spotify
        .api(Method::GET, "/me/player?additional_types=track", None)
        .await?;
    if reply.status == 204 {
        return Ok(Value::Null);
    }
    reply.into_result(FEATURE)
}

async fn device_list(spotify: &Spotify) -> AppResult<Vec<Device>> {
    let body = spotify.get("/me/player/devices", FEATURE).await?;
    Ok(body
        .get("devices")
        .and_then(Value::as_array)
        .map(|devices| devices.iter().filter_map(Device::from_json).collect())
        .unwrap_or_default())
}

fn preferred_device_id(state: &AppState) -> Option<String> {
    super::super::music_settings::read(state)
        .ok()
        .and_then(|settings| {
            settings
                .get("spotifyPreferredDeviceId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
}

async fn chosen_device(spotify: &Spotify) -> AppResult<Device> {
    let playback = current_playback(spotify).await?;
    let devices = device_list(spotify).await?;
    choose_device(
        &playback,
        &devices,
        preferred_device_id(&spotify.state).as_deref(),
    )
    .ok_or_else(no_device_error)
}

/// The device a control call targets: the one the caller names, else the usual device choice.
async fn target_device_id(spotify: &Spotify, body: &Value) -> AppResult<Option<String>> {
    if let Some(id) = body
        .get("deviceId")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
    {
        return Ok(Some(id.to_owned()));
    }
    match chosen_device(spotify).await {
        Ok(device) => Ok(Some(device.id)),
        Err(error) if error.code == "music_spotify_no_device" => Ok(None),
        Err(error) => Err(error),
    }
}

fn device_query(device_id: Option<&str>, joiner: char) -> String {
    device_id
        .map(|id| format!("{joiner}device_id={}", percent_encode_component(id)))
        .unwrap_or_default()
}

async fn connected(state: &AppState, scopes: &[&str]) -> AppResult<Spotify> {
    let account = load_account(state)?.ok_or_else(not_connected)?;
    account.require_scopes(FEATURE, scopes)?;
    Spotify::new(state)
}

fn track_uri(body: &Value) -> AppResult<String> {
    body.pointer("/track/id")
        .or_else(|| body.get("trackUri"))
        .and_then(Value::as_str)
        .filter(|uri| uri.starts_with("spotify:track:"))
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            AppError::invalid_input("A Spotify track URI is required to play on Spotify")
        })
}

fn validate_volume(value: Option<&Value>) -> AppResult<Option<u8>> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    match value.as_i64() {
        Some(volume) if (0..=100).contains(&volume) => Ok(Some(volume as u8)),
        _ => Err(AppError::invalid_input(
            "music volume must be between 0 and 100",
        )),
    }
}

async fn start_track(spotify: &Spotify, device_id: &str, uri: &str) -> AppResult<()> {
    spotify
        .api(
            Method::PUT,
            &format!("/me/player/play{}", device_query(Some(device_id), '?')),
            Some(json!({ "uris": [uri] })),
        )
        .await?
        .into_result(FEATURE)?;
    // Repeat keeps scene music looping like the YouTube player. Failing to set it doesn't stop playback.
    match spotify
        .api(
            Method::PUT,
            &format!(
                "/me/player/repeat?state=track{}",
                device_query(Some(device_id), '&')
            ),
            None,
        )
        .await
    {
        Ok(reply) if !reply.ok() => {
            log::info!("[music] Spotify repeat was refused (HTTP {})", reply.status)
        }
        Err(error) => log::info!("[music] Spotify repeat failed: {}", error.message),
        Ok(_) => {}
    }
    Ok(())
}

async fn confirm_playing(spotify: &Spotify, uri: &str) -> bool {
    for _ in 0..CONFIRM_ATTEMPTS {
        tokio::time::sleep(CONFIRM_INTERVAL).await;
        if let Ok(playback) = current_playback(spotify).await {
            if playback.pointer("/item/uri").and_then(Value::as_str) == Some(uri)
                && playback.get("is_playing").and_then(Value::as_bool) == Some(true)
            {
                return true;
            }
        }
    }
    false
}

async fn set_device_volume(spotify: &Spotify, device: Option<&str>, volume: u8) -> AppResult<()> {
    spotify
        .api(
            Method::PUT,
            &format!(
                "/me/player/volume?volume_percent={volume}{}",
                device_query(device, '&')
            ),
            None,
        )
        .await?
        .into_result(FEATURE)
        .map(|_| ())
}

/// Plays a track on repeat. Confirms for about 5 s, transfers and retries once, and reports
/// `accepted` when Spotify took the request but the device never confirmed it.
pub(super) async fn play(state: &AppState, body: &Value) -> AppResult<Value> {
    let uri = track_uri(body)?;
    let volume = validate_volume(body.get("volume"))?;
    let spotify = connected(state, CONTROL_SCOPES).await?;
    let device = chosen_device(&spotify).await?;

    start_track(&spotify, &device.id, &uri).await?;
    let mut confirmed = confirm_playing(&spotify, &uri).await;
    if !confirmed {
        let transferred = spotify
            .api(
                Method::PUT,
                "/me/player",
                Some(json!({ "device_ids": [device.id], "play": false })),
            )
            .await;
        if let Err(error) = &transferred {
            log::info!("[music] Spotify transfer failed: {}", error.message);
        }
        if start_track(&spotify, &device.id, &uri).await.is_ok() {
            confirmed = confirm_playing(&spotify, &uri).await;
        }
    }

    let mut message =
        (!confirmed).then(|| format!("Spotify accepted the track; waiting for {}.", device.name));
    if let Some(volume) = volume {
        let result = if device.supports_volume {
            set_device_volume(&spotify, Some(&device.id), volume).await
        } else {
            Err(volume_error())
        };
        if let Err(error) = result {
            message = Some(match message {
                Some(existing) => format!("{existing} {}", error.message),
                None => error.message,
            });
        }
    }
    let track = body
        .get("track")
        .filter(|track| track.is_object())
        .cloned()
        .unwrap_or_else(|| json!({ "provider": "spotify", "id": uri, "title": uri }));
    Ok(json!({
        "provider": "spotify",
        "state": if confirmed { "playing" } else { "accepted" },
        "confirmed": confirmed,
        "mode": "remote",
        "powerModeAvailable": true,
        "iframeFallbackAvailable": false,
        "repeat": "track",
        "track": track,
        "device": device.to_json(),
        "volume": volume,
        "message": message,
    }))
}

async fn pause_device(spotify: &Spotify, body: &Value) -> AppResult<()> {
    let device_id = target_device_id(spotify, body).await?;
    let reply = spotify
        .api(
            Method::PUT,
            &format!(
                "/me/player/pause{}",
                device_query(device_id.as_deref(), '?')
            ),
            None,
        )
        .await?;
    // Nothing playing is already the state the caller asked for.
    if reply.ok() || matches!(reply.reason(), "ALREADY_PAUSED" | "NO_ACTIVE_DEVICE") {
        return Ok(());
    }
    Err(reply.error(FEATURE))
}

pub(super) async fn pause(state: &AppState, body: &Value) -> AppResult<Value> {
    let spotify = connected(state, CONTROL_SCOPES).await?;
    pause_device(&spotify, body).await?;
    Ok(json!({ "provider": "spotify", "state": "paused" }))
}

/// Stop pauses on the device; the widget clears its now-playing state.
pub(super) async fn stop(state: &AppState, body: &Value) -> AppResult<Value> {
    let spotify = connected(state, CONTROL_SCOPES).await?;
    pause_device(&spotify, body).await?;
    Ok(json!({ "provider": "spotify", "state": "stopped", "track": null }))
}

pub(super) async fn resume(state: &AppState, body: &Value) -> AppResult<Value> {
    let spotify = connected(state, CONTROL_SCOPES).await?;
    let device_id = target_device_id(&spotify, body)
        .await?
        .ok_or_else(no_device_error)?;
    let reply = spotify
        .api(
            Method::PUT,
            &format!("/me/player/play{}", device_query(Some(&device_id), '?')),
            None,
        )
        .await?;
    if !reply.ok() && reply.reason() != "ALREADY_PLAYING" {
        return Err(reply.error(FEATURE));
    }
    Ok(json!({ "provider": "spotify", "state": "playing" }))
}

pub(super) async fn set_volume(state: &AppState, body: &Value) -> AppResult<Value> {
    let volume = validate_volume(body.get("volume"))?
        .ok_or_else(|| AppError::invalid_input("music volume must be between 0 and 100"))?;
    let spotify = connected(state, CONTROL_SCOPES).await?;
    let device = match body
        .get("deviceId")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
    {
        Some(id) => device_list(&spotify)
            .await?
            .into_iter()
            .find(|device| device.id == id)
            .ok_or_else(no_device_error)?,
        None => chosen_device(&spotify).await?,
    };
    if !device.supports_volume {
        return Err(volume_error());
    }
    set_device_volume(&spotify, Some(&device.id), volume).await?;
    Ok(json!({ "provider": "spotify", "state": "volume", "volume": volume }))
}

/// What Spotify is playing now, for the widget (it may differ from the track De-Koi started).
pub(super) async fn playback_state(state: &AppState) -> AppResult<Value> {
    let spotify = connected(state, READ_SCOPES).await?;
    let playback = current_playback(&spotify).await?;
    if playback.is_null() {
        return Ok(
            json!({ "provider": "spotify", "state": "stopped", "track": null, "device": null }),
        );
    }
    let device = playback.get("device").and_then(Device::from_json);
    let track = playback
        .get("item")
        .and_then(matching::track_from_json)
        .map(|track| matching::candidate(&track, 1.0, &["spotify", "now-playing"]));
    let playing = playback.get("is_playing").and_then(Value::as_bool) == Some(true);
    Ok(json!({
        "provider": "spotify",
        "state": if playing { "playing" } else { "paused" },
        "mode": "remote",
        "track": track,
        "device": device.as_ref().map(Device::to_json),
        "volume": device.as_ref().and_then(|device| device.volume),
        "repeat": playback.get("repeat_state").and_then(Value::as_str),
        "progressSeconds": playback.get("progress_ms").and_then(Value::as_u64).map(|ms| ms / 1000),
    }))
}

/// Devices for the preferred-device setting.
pub(super) async fn devices(state: &AppState) -> AppResult<Value> {
    let spotify = connected(state, READ_SCOPES).await?;
    let devices: Vec<Value> = device_list(&spotify)
        .await?
        .iter()
        .map(Device::to_json)
        .collect();
    Ok(json!({ "provider": "spotify", "devices": devices }))
}

#[cfg(test)]
mod tests {
    use super::super::api::NO_DEVICE_MESSAGE;
    use super::*;

    fn device(id: &str, active: bool) -> Device {
        Device {
            id: id.into(),
            name: id.into(),
            kind: "Computer".into(),
            is_active: active,
            supports_volume: true,
            volume: Some(50),
        }
    }

    #[test]
    fn the_currently_playing_device_wins() {
        let playback = json!({ "is_playing": true, "device": { "id": "phone", "name": "Phone", "is_active": false } });
        let devices = vec![device("laptop", true), device("phone", false)];
        assert_eq!(
            choose_device(&playback, &devices, Some("laptop"))
                .unwrap()
                .id,
            "phone"
        );
    }

    #[test]
    fn then_the_active_device_then_the_listed_preferred_device() {
        let paused =
            json!({ "is_playing": false, "device": { "id": "phone", "is_active": false } });
        let devices = vec![device("speaker", false), device("laptop", true)];
        assert_eq!(
            choose_device(&paused, &devices, Some("speaker"))
                .unwrap()
                .id,
            "laptop"
        );

        let idle = vec![device("speaker", false), device("laptop", false)];
        assert_eq!(
            choose_device(&Value::Null, &idle, Some("speaker"))
                .unwrap()
                .id,
            "speaker"
        );
    }

    #[test]
    fn no_device_when_the_preferred_one_is_not_listed() {
        let idle = vec![device("laptop", false)];
        assert!(choose_device(&Value::Null, &idle, Some("gone")).is_none());
        assert!(choose_device(&Value::Null, &idle, None).is_none());
        assert!(choose_device(&Value::Null, &[], Some("laptop")).is_none());
        assert_eq!(
            NO_DEVICE_MESSAGE,
            "Open Spotify on the device you want to use, then try again."
        );
    }

    #[test]
    fn volume_must_be_between_0_and_100() {
        assert_eq!(validate_volume(Some(&json!(0))).unwrap(), Some(0));
        assert_eq!(validate_volume(Some(&json!(100))).unwrap(), Some(100));
        assert_eq!(validate_volume(None).unwrap(), None);
        assert!(validate_volume(Some(&json!(101))).is_err());
        assert!(validate_volume(Some(&json!(-1))).is_err());
    }
}
