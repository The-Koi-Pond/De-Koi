use super::*;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::process::Command;

fn read_string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str).filter(|text| !text.trim().is_empty())
}

fn validate_volume(value: Option<i64>) -> AppResult<u8> {
    let volume = value.unwrap_or(60);
    if !(0..=100).contains(&volume) {
        return Err(AppError::invalid_input("music volume must be between 0 and 100"));
    }
    Ok(volume as u8)
}

fn provider_error(code: &str, message: impl Into<String>) -> Value {
    json!({
        "code": code,
        "message": message.into(),
    })
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

fn push_candidate(candidates: &mut Vec<Value>, seen_ids: &mut HashSet<String>, candidate: Value) {
    let Some(id) = read_string(&candidate, "id") else { return };
    if seen_ids.insert(id.to_owned()) {
        candidates.push(candidate);
    }
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

fn yt_dlp_search(query: &str, limit: usize) -> AppResult<(Vec<Value>, Option<Value>)> {
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
        Err(error) => {
            return Ok((
                Vec::new(),
                Some(provider_error(
                    "music_ytdlp_unavailable",
                    format!("yt-dlp search is unavailable: {error}"),
                )),
            ));
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Ok((
            Vec::new(),
            Some(provider_error(
                "music_ytdlp_failed",
                if stderr.is_empty() { "yt-dlp search failed".to_owned() } else { stderr },
            )),
        ));
    }
    let parsed: Value = match serde_json::from_slice(&output.stdout) {
        Ok(parsed) => parsed,
        Err(error) => {
            return Ok((
                Vec::new(),
                Some(provider_error("music_ytdlp_parse_failed", error.to_string())),
            ));
        }
    };
    let entries = parsed
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok((
        entries
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| yt_dlp_candidate(entry, index))
            .collect(),
        None,
    ))
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
    let mut seen_ids = HashSet::new();
    let mut provider_error = Value::Null;

    if let Some(url) = read_string(&body, "url") {
        if let Some(candidate) = candidate_from_youtube_url(url, "direct-url") {
            push_candidate(&mut candidates, &mut seen_ids, candidate);
        }
    }
    if let Some(candidate) = candidate_from_youtube_url(&query, "query-url") {
        push_candidate(&mut candidates, &mut seen_ids, candidate);
    }

    let query_is_direct_url = youtube_video_id(&query).is_some();
    if candidates.len() < limit && !query.is_empty() && !query_is_direct_url {
        let (found, error) = yt_dlp_search(&query, limit - candidates.len())?;
        if let Some(error) = error {
            provider_error = error;
        }
        for candidate in found {
            push_candidate(&mut candidates, &mut seen_ids, candidate);
        }
    }

    candidates.truncate(limit);
    Ok(json!({
        "provider": "youtube",
        "candidates": candidates,
        "requiresSetup": false,
        "powerModeAvailable": false,
        "iframeFallbackAvailable": true,
        "source": if query.is_empty() { "local" } else { "youtube" },
        "providerError": provider_error,
    }))
}

fn play(body: Value) -> AppResult<Value> {
    let volume = validate_volume(body.get("volume").and_then(Value::as_i64))?;
    Ok(json!({
        "provider": read_string(&body, "provider").unwrap_or("youtube"),
        "state": "playing",
        "mode": "iframe",
        "powerModeAvailable": false,
        "iframeFallbackAvailable": true,
        "track": body.get("track").cloned().unwrap_or(Value::Null),
        "volume": volume,
    }))
}

fn volume(body: Value) -> AppResult<Value> {
    let volume = validate_volume(body.get("volume").and_then(Value::as_i64))?;
    Ok(json!({
        "provider": "youtube",
        "state": "volume",
        "volume": volume,
    }))
}

pub(crate) async fn music_call(_state: &AppState, method: &str, rest: &[&str], body: Value) -> AppResult<Value> {
    let action = rest.first().copied().unwrap_or("status");
    match (method, action) {
        ("GET", "status") | ("POST", "status") => Ok(status()),
        ("POST", "search-candidates") => search_candidates(body),
        ("POST", "play") => play(body),
        ("POST", "fresh-pick") => search_candidates(body),
        ("POST", "pause") => Ok(json!({ "provider": "youtube", "state": "paused" })),
        ("POST", "stop") => Ok(json!({ "provider": "youtube", "state": "stopped" })),
        ("POST", "volume") => volume(body),
        _ => Err(AppError::not_found("Unknown music command")),
    }
}
