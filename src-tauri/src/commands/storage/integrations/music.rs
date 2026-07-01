use super::*;
use serde_json::{json, Value};
use std::process::Command;

fn read_string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str).filter(|text| !text.trim().is_empty())
}

fn clamp_volume(value: Option<i64>) -> u8 {
    value.unwrap_or(60).clamp(0, 100) as u8
}

fn youtube_video_id(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.len() == 11 && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Some(text.to_owned());
    }
    for marker in ["v=", "youtu.be/", "embed/", "shorts/"] {
        let Some(start) = text.find(marker) else { continue };
        let rest = &text[start + marker.len()..];
        let id: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(11)
            .collect();
        if id.len() == 11 {
            return Some(id);
        }
    }
    None
}

fn candidate_from_youtube_url(raw: &str, reason: &str) -> Option<Value> {
    let video_id = youtube_video_id(raw)?;
    Some(json!({
        "provider": "youtube",
        "id": format!("youtube:{video_id}"),
        "title": raw,
        "channelOrArtist": null,
        "url": format!("https://www.youtube.com/watch?v={video_id}"),
        "thumbnail": format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"),
        "durationSeconds": null,
        "confidence": 1.0,
        "reasonTags": [reason, "imported-url"]
    }))
}

fn yt_dlp_candidate(entry: &Value, index: usize) -> Option<Value> {
    let video_id = read_string(entry, "id")
        .or_else(|| read_string(entry, "url"))
        .and_then(youtube_video_id)?;
    let title = read_string(entry, "title").unwrap_or("YouTube music result");
    let channel = read_string(entry, "uploader")
        .or_else(|| read_string(entry, "channel"))
        .or_else(|| read_string(entry, "creator"));
    let duration = entry.get("duration").and_then(Value::as_f64).map(|value| value.max(0.0) as u64);
    let thumbnail = read_string(entry, "thumbnail")
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"));
    Some(json!({
        "provider": "youtube",
        "id": format!("youtube:{video_id}"),
        "title": title,
        "channelOrArtist": channel,
        "url": format!("https://www.youtube.com/watch?v={video_id}"),
        "thumbnail": thumbnail,
        "durationSeconds": duration,
        "confidence": (0.92_f64 - (index as f64 * 0.05)).max(0.5),
        "reasonTags": ["yt-dlp", "search"]
    }))
}

fn yt_dlp_search(query: &str, limit: usize) -> AppResult<Vec<Value>> {
    let search = format!("ytsearch{}:{}", limit.clamp(1, 10), query.trim());
    let output = Command::new("yt-dlp")
        .arg("--dump-single-json")
        .arg("--flat-playlist")
        .arg("--playlist-end")
        .arg(limit.clamp(1, 10).to_string())
        .arg(search)
        .output();

    let output = match output {
        Ok(output) => output,
        Err(_) => return Ok(Vec::new()),
    };
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let parsed: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| AppError::new("music_ytdlp_parse_failed", error.to_string()))?;
    let entries = parsed
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| yt_dlp_candidate(entry, index))
        .collect())
}

fn status() -> Value {
    json!({
        "provider": "youtube",
        "enabled": true,
        "requiresSetup": false,
        "powerModeAvailable": false,
        "iframeFallbackAvailable": true,
        "searchBackend": "yt-dlp-if-installed",
        "legacyProviders": ["spotify"]
    })
}

fn search_candidates(body: Value) -> AppResult<Value> {
    let query = read_string(&body, "query").unwrap_or_default().trim().to_owned();
    let limit = body
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 10) as usize)
        .unwrap_or(5);
    let mut candidates = Vec::new();

    if let Some(url) = read_string(&body, "url") {
        if let Some(candidate) = candidate_from_youtube_url(url, "direct-url") {
            candidates.push(candidate);
        }
    }
    if let Some(candidate) = candidate_from_youtube_url(&query, "query-url") {
        candidates.push(candidate);
    }
    if candidates.len() < limit && !query.is_empty() && youtube_video_id(&query).is_none() {
        candidates.extend(yt_dlp_search(&query, limit - candidates.len())?);
    }

    candidates.truncate(limit);
    Ok(json!({
        "provider": "youtube",
        "candidates": candidates,
        "requiresSetup": false,
        "powerModeAvailable": false,
        "iframeFallbackAvailable": true,
        "source": if query.is_empty() { "local" } else { "youtube" }
    }))
}

fn play(body: Value) -> Value {
    json!({
        "provider": read_string(&body, "provider").unwrap_or("youtube"),
        "state": "playing",
        "mode": "iframe",
        "powerModeAvailable": false,
        "iframeFallbackAvailable": true,
        "track": body.get("track").cloned().unwrap_or(Value::Null),
        "volume": clamp_volume(body.get("volume").and_then(Value::as_i64)),
    })
}

fn volume(body: Value) -> Value {
    json!({
        "provider": "youtube",
        "state": "volume",
        "volume": clamp_volume(body.get("volume").and_then(Value::as_i64)),
    })
}

pub(crate) async fn music_call(_state: &AppState, method: &str, rest: &[&str], body: Value) -> AppResult<Value> {
    let action = rest.first().copied().unwrap_or("status");
    match (method, action) {
        ("GET", "status") | ("POST", "status") => Ok(status()),
        ("POST", "search-candidates") => search_candidates(body),
        ("POST", "play") => Ok(play(body)),
        ("POST", "fresh-pick") => search_candidates(body),
        ("POST", "pause") => Ok(json!({ "provider": "youtube", "state": "paused" })),
        ("POST", "stop") => Ok(json!({ "provider": "youtube", "state": "stopped" })),
        ("POST", "volume") => Ok(volume(body)),
        _ => Err(AppError::not_found("Unknown music command")),
    }
}
