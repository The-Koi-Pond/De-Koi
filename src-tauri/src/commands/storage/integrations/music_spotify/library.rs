//! Spotify library and search: Liked Songs and playlist loading (cached), the playlist picker, catalogue
//! search for the artist and Anything sources, and the best match for the `[spotify: …]` command.

use super::super::super::images::percent_encode_component;
use super::api::{load_account, not_connected, Account, Spotify};
use super::matching::{self, Track};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use rand::{rngs::SysRng, TryRng};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

const MAX_LIBRARY_TRACKS: usize = 2_500;
const LIBRARY_PAGE: usize = 50;
const CACHE_TTL: Duration = Duration::from_secs(20 * 60);
const MAX_CACHED_SOURCES: usize = 24;
const MAX_LIBRARY_CANDIDATES: usize = 50;
const MAX_SEARCH_CANDIDATES: usize = 20;
/// Spotify's search returns at most 10 results per request.
const SEARCH_PAGE: usize = 10;
const MAX_PLAYLISTS: usize = 500;

pub(super) const LIBRARY_SCOPES: &[&str] = &["user-library-read"];
pub(super) const PLAYLIST_SCOPES: &[&str] = &["playlist-read-private"];
pub(super) const UNREADABLE_PLAYLIST_MESSAGE: &str =
    "Spotify won't let De-Koi read this playlist. Pick a playlist this account owns.";

/// Where a chat's Spotify candidates come from.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Source {
    Liked,
    Playlist(String),
    Artist(String),
    Anything,
}

impl Source {
    /// Reads `{ type, playlistId, artist }`. A playlist or artist choice without its value means Liked Songs.
    pub fn from_body(body: &Value) -> Self {
        let source = body.get("source").unwrap_or(&Value::Null);
        let text = |key: &str| {
            source
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        };
        match source
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("liked")
        {
            "playlist" => text("playlistId").map_or(Self::Liked, Self::Playlist),
            "artist" => text("artist").map_or(Self::Liked, Self::Artist),
            "anything" => Self::Anything,
            _ => Self::Liked,
        }
    }

    fn tag(&self) -> &'static str {
        match self {
            Self::Liked => "liked",
            Self::Playlist(_) => "playlist",
            Self::Artist(_) => "artist",
            Self::Anything => "anything",
        }
    }
}

// ── Cache ──

struct CacheEntry {
    loaded: Instant,
    tracks: Arc<Vec<Track>>,
}

type CacheKey = (PathBuf, String, String);

fn cache() -> std::sync::MutexGuard<'static, HashMap<CacheKey, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<CacheKey, CacheEntry>>> = OnceLock::new();
    CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn account_key(account: &Account) -> String {
    account
        .user_id
        .clone()
        .unwrap_or_else(|| account.client_id.clone())
}

fn cached(key: &CacheKey) -> Option<Arc<Vec<Track>>> {
    let mut cache = cache();
    cache.retain(|_, entry| entry.loaded.elapsed() <= CACHE_TTL);
    cache.get(key).map(|entry| entry.tracks.clone())
}

fn remember(key: CacheKey, tracks: Arc<Vec<Track>>) {
    let mut cache = cache();
    cache.retain(|_, entry| entry.loaded.elapsed() <= CACHE_TTL);
    while cache.len() >= MAX_CACHED_SOURCES && !cache.contains_key(&key) {
        let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.loaded)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        cache.remove(&oldest);
    }
    cache.insert(
        key,
        CacheEntry {
            loaded: Instant::now(),
            tracks,
        },
    );
}

/// Forgets every cached library of this data folder (on connect and disconnect).
pub(super) fn clear_cache(state: &AppState) {
    cache().retain(|(data_dir, _, _), _| *data_dir != state.data_dir);
}

// ── Loading ──

fn tracks_from_page(page: &Value) -> Vec<Track> {
    page.get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|entry| {
                    entry
                        .get("item")
                        .filter(|item| !item.is_null())
                        .or_else(|| entry.get("track"))
                })
                .filter_map(matching::track_from_json)
                .collect()
        })
        .unwrap_or_default()
}

async fn load_pages(spotify: &Spotify, base_path: &str, feature: &str) -> AppResult<Vec<Track>> {
    let mut tracks = Vec::new();
    let mut offset = 0;
    while offset < MAX_LIBRARY_TRACKS {
        let separator = if base_path.contains('?') { '&' } else { '?' };
        let path = format!("{base_path}{separator}limit={LIBRARY_PAGE}&offset={offset}");
        let page = spotify.get(&path, feature).await?;
        let page_items = page
            .get("items")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        tracks.extend(tracks_from_page(&page));
        offset += LIBRARY_PAGE;
        if page_items < LIBRARY_PAGE || page.get("next").is_some_and(Value::is_null) {
            break;
        }
    }
    tracks.truncate(MAX_LIBRARY_TRACKS);
    Ok(tracks)
}

enum Loaded {
    Tracks(Arc<Vec<Track>>),
    Unreadable,
}

async fn load_source(spotify: &Spotify, account: &Account, source: &Source) -> AppResult<Loaded> {
    let source_key = match source {
        Source::Playlist(id) => format!("playlist:{id}"),
        _ => "liked".to_owned(),
    };
    let key = (
        spotify.state.data_dir.clone(),
        account_key(account),
        source_key,
    );
    if let Some(tracks) = cached(&key) {
        return Ok(Loaded::Tracks(tracks));
    }
    let tracks = match source {
        Source::Playlist(id) => {
            account.require_scopes("Reading playlists", PLAYLIST_SCOPES)?;
            let path = format!(
                "/playlists/{}/items?market=from_token&additional_types=track",
                percent_encode_component(id)
            );
            match load_pages(spotify, &path, "Reading playlists").await {
                Ok(tracks) => tracks,
                Err(error) if is_unreadable(&error) => return Ok(Loaded::Unreadable),
                Err(error) => return Err(error),
            }
        }
        _ => {
            account.require_scopes("Reading Liked Songs", LIBRARY_SCOPES)?;
            load_pages(
                spotify,
                "/me/tracks?market=from_token",
                "Reading Liked Songs",
            )
            .await?
        }
    };
    let tracks = Arc::new(tracks);
    remember(key, tracks.clone());
    Ok(Loaded::Tracks(tracks))
}

fn is_unreadable(error: &AppError) -> bool {
    error.code == "music_spotify_request_failed"
        && error
            .details
            .as_ref()
            .and_then(|details| details.get("status"))
            .and_then(Value::as_u64)
            .is_some_and(|status| status == 403 || status == 404)
}

fn track_ids(value: Option<&Value>) -> HashSet<String> {
    value
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| match entry {
                    Value::String(id) => Some(id.clone()),
                    Value::Object(object) => object
                        .get("provider")
                        .and_then(Value::as_str)
                        .is_none_or(|provider| provider == "spotify")
                        .then(|| object.get("id").and_then(Value::as_str))
                        .flatten()
                        .map(ToOwned::to_owned),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn random_seed() -> u64 {
    let mut bytes = [0_u8; 8];
    if SysRng.try_fill_bytes(&mut bytes).is_err() {
        return marinara_core::now_millis() as u64;
    }
    u64::from_le_bytes(bytes)
}

async fn search_tracks(spotify: &Spotify, query: &str, wanted: usize) -> AppResult<Vec<Track>> {
    let mut tracks = Vec::new();
    let mut offset = 0;
    while tracks.len() < wanted {
        let path = format!(
            "/search?type=track&market=from_token&limit={SEARCH_PAGE}&offset={offset}&q={}",
            percent_encode_component(query)
        );
        let page = spotify.get(&path, "Searching Spotify").await?;
        let items = page.pointer("/tracks/items").and_then(Value::as_array);
        let count = items.map_or(0, Vec::len);
        tracks.extend(
            items
                .into_iter()
                .flatten()
                .filter_map(matching::track_from_json),
        );
        offset += SEARCH_PAGE;
        if count < SEARCH_PAGE {
            break;
        }
    }
    tracks.truncate(wanted);
    Ok(tracks)
}

fn quoted(value: &str) -> String {
    value.replace('"', " ").trim().to_owned()
}

fn response(source: &Source, candidates: Vec<Value>, provider_error: Value) -> Value {
    json!({
        "provider": "spotify",
        "candidates": candidates,
        "requiresSetup": false,
        "powerModeAvailable": true,
        "iframeFallbackAvailable": false,
        "source": source.tag(),
        "providerError": provider_error,
    })
}

/// Candidates for a cue. Input: `source`, `query`, `mood`, `setting`, `constraints`, `recentIds`,
/// `currentTrackId`, `fresh` and an optional `limit`.
pub(super) async fn candidates(state: &AppState, body: &Value, fresh: bool) -> AppResult<Value> {
    let spotify = Spotify::new(state)?;
    let account = load_account(state)?.ok_or_else(not_connected)?;
    let text = matching::search_text(body);
    let recent = track_ids(body.get("recentIds"));
    let fresh = fresh || body.get("fresh").and_then(Value::as_bool) == Some(true);
    let mut exclude = HashSet::new();
    if fresh {
        if let Some(current) = body.get("currentTrackId").and_then(Value::as_str) {
            exclude.insert(current.to_owned());
        }
    }
    let requested = body
        .get("limit")
        .and_then(Value::as_u64)
        .map(|limit| limit.max(1) as usize);
    let mut source = Source::from_body(body);

    if let Source::Artist(_) | Source::Anything = source {
        let limit = requested
            .unwrap_or(MAX_SEARCH_CANDIDATES)
            .min(MAX_SEARCH_CANDIDATES);
        let query = match &source {
            Source::Artist(artist) if text.is_empty() => format!("artist:\"{}\"", quoted(artist)),
            Source::Artist(artist) => format!("{text} artist:\"{}\"", quoted(artist)),
            _ => text.clone(),
        };
        if query.trim().is_empty() {
            return Err(AppError::new(
                "music_spotify_empty_cue",
                "Give the Music Player a mood or a few search words to look for on Spotify.",
            ));
        }
        let found = search_tracks(&spotify, &query, MAX_SEARCH_CANDIDATES).await?;
        let pool = matching::avoid_recent(&found, &recent, &exclude);
        let candidates = pool
            .iter()
            .take(limit)
            .enumerate()
            .map(|(index, track)| {
                matching::candidate(
                    track,
                    (0.9 - index as f64 * 0.02).max(0.5),
                    &["spotify", source.tag(), "search"],
                )
            })
            .collect();
        return Ok(response(&source, candidates, Value::Null));
    }

    let limit = requested
        .unwrap_or(MAX_LIBRARY_CANDIDATES)
        .min(MAX_LIBRARY_CANDIDATES);
    let mut provider_error = Value::Null;
    let tracks = match load_source(&spotify, &account, &source).await? {
        Loaded::Tracks(tracks) => tracks,
        Loaded::Unreadable => {
            provider_error = json!({
                "code": "music_spotify_playlist_unreadable",
                "message": UNREADABLE_PLAYLIST_MESSAGE,
            });
            source = Source::Liked;
            match load_source(&spotify, &account, &source).await? {
                Loaded::Tracks(tracks) => tracks,
                Loaded::Unreadable => Arc::new(Vec::new()),
            }
        }
    };
    let candidates = matching::select_from_library(
        &tracks,
        &text,
        &recent,
        &exclude,
        limit,
        random_seed(),
        source.tag(),
    );
    Ok(response(&source, candidates, provider_error))
}

/// The best catalogue match for a title and artist, or "Spotify didn't find …".
pub(super) async fn find_track(state: &AppState, body: &Value) -> AppResult<Value> {
    let read = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };
    let (Some(title), Some(artist)) = (read("title"), read("artist")) else {
        return Err(AppError::invalid_input(
            "title and artist are both required",
        ));
    };
    let spotify = Spotify::new(state)?;
    load_account(state)?.ok_or_else(not_connected)?;
    let fielded = format!(
        "track:\"{}\" artist:\"{}\"",
        quoted(&title),
        quoted(&artist)
    );
    let mut found = search_tracks(&spotify, &fielded, SEARCH_PAGE).await?;
    if found.is_empty() {
        found = search_tracks(&spotify, &format!("{title} {artist}"), SEARCH_PAGE).await?;
    }
    let best = found
        .iter()
        .enumerate()
        .max_by(|(left_index, left), (right_index, right)| {
            matching::best_match_score(left, &title, &artist)
                .cmp(&matching::best_match_score(right, &title, &artist))
                .then(right_index.cmp(left_index))
        })
        .map(|(_, track)| track);
    match best {
        Some(track) => Ok(json!({
            "provider": "spotify",
            "track": matching::candidate(track, 0.95, &["spotify", "command"]),
        })),
        None => Err(AppError::with_details(
            "music_spotify_track_not_found",
            format!("Spotify didn't find '{title}' by {artist}."),
            json!({ "title": title, "artist": artist }),
        )),
    }
}

/// The user's playlists for the chat source picker, flagged with whether De-Koi can read them.
pub(super) async fn playlists(state: &AppState) -> AppResult<Value> {
    let spotify = Spotify::new(state)?;
    let account = load_account(state)?.ok_or_else(not_connected)?;
    account.require_scopes("Listing playlists", PLAYLIST_SCOPES)?;
    let user_id = match account.user_id.clone() {
        Some(id) => Some(id),
        None => spotify
            .get("/me", "Reading your Spotify profile")
            .await
            .ok()
            .and_then(|profile| {
                profile
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            }),
    };
    let mut playlists = Vec::new();
    let mut offset = 0;
    while offset < MAX_PLAYLISTS {
        let page = spotify
            .get(
                &format!("/me/playlists?limit={LIBRARY_PAGE}&offset={offset}"),
                "Listing playlists",
            )
            .await?;
        let items = page.get("items").and_then(Value::as_array);
        let count = items.map_or(0, Vec::len);
        for playlist in items.into_iter().flatten() {
            let Some(id) = playlist.get("id").and_then(Value::as_str) else {
                continue;
            };
            let owner_id = playlist.pointer("/owner/id").and_then(Value::as_str);
            let collaborative =
                playlist.get("collaborative").and_then(Value::as_bool) == Some(true);
            // Spotify only lets an app read the items of playlists the account owns or collaborates on.
            let readable = collaborative || (owner_id.is_some() && owner_id == user_id.as_deref());
            playlists.push(json!({
                "id": id,
                "name": playlist.get("name").and_then(Value::as_str).unwrap_or("Untitled playlist"),
                "ownerName": playlist.pointer("/owner/display_name").and_then(Value::as_str),
                "trackCount": playlist
                    .pointer("/items/total")
                    .or_else(|| playlist.pointer("/tracks/total"))
                    .and_then(Value::as_u64),
                "image": playlist.pointer("/images/0/url").and_then(Value::as_str),
                "readable": readable,
            }));
        }
        offset += LIBRARY_PAGE;
        if count < LIBRARY_PAGE {
            break;
        }
    }
    Ok(json!({ "provider": "spotify", "playlists": playlists }))
}

#[cfg(test)]
mod tests {
    use super::super::api::tests::test_state;
    use super::*;

    fn track(id: &str) -> Track {
        Track {
            uri: format!("spotify:track:{id}"),
            name: id.to_owned(),
            artists: Vec::new(),
            album: String::new(),
            image: None,
            duration_ms: None,
        }
    }

    #[test]
    fn missing_source_values_mean_liked_songs() {
        assert_eq!(Source::from_body(&json!({})), Source::Liked);
        assert_eq!(
            Source::from_body(&json!({ "source": { "type": "playlist" } })),
            Source::Liked
        );
        assert_eq!(
            Source::from_body(&json!({ "source": { "type": "artist", "artist": "  " } })),
            Source::Liked
        );
        assert_eq!(
            Source::from_body(&json!({ "source": { "type": "playlist", "playlistId": "p1" } })),
            Source::Playlist("p1".into())
        );
        assert_eq!(
            Source::from_body(&json!({ "source": { "type": "anything" } })),
            Source::Anything
        );
    }

    #[test]
    fn recent_ids_accept_strings_and_spotify_entries_only() {
        let ids = track_ids(Some(&json!([
            "spotify:track:a",
            { "provider": "spotify", "id": "spotify:track:b" },
            { "provider": "youtube", "id": "youtube:xyz" },
        ])));
        assert!(ids.contains("spotify:track:a") && ids.contains("spotify:track:b"));
        assert!(!ids.contains("youtube:xyz"));
    }

    #[test]
    fn cache_holds_at_most_24_sources_and_clears_per_data_folder() {
        let state = test_state("cache");
        let other = test_state("cache-other");
        for index in 0..30 {
            remember(
                (
                    state.data_dir.clone(),
                    "me".into(),
                    format!("playlist:{index}"),
                ),
                Arc::new(vec![track(&index.to_string())]),
            );
        }
        remember(
            (other.data_dir.clone(), "me".into(), "liked".into()),
            Arc::new(vec![track("other")]),
        );
        let own = cache()
            .keys()
            .filter(|(data_dir, _, _)| *data_dir == state.data_dir)
            .count();
        assert!(own <= MAX_CACHED_SOURCES);
        assert!(cache().len() <= MAX_CACHED_SOURCES);
        clear_cache(&state);
        assert!(cache()
            .keys()
            .all(|(data_dir, _, _)| *data_dir != state.data_dir));
    }

    #[test]
    fn playlist_pages_read_item_or_legacy_track_fields() {
        let page = json!({ "items": [
            { "item": { "uri": "spotify:track:new", "name": "New" } },
            { "track": { "uri": "spotify:track:old", "name": "Old" } },
            { "item": null },
        ]});
        let uris: Vec<String> = tracks_from_page(&page).into_iter().map(|t| t.uri).collect();
        assert_eq!(uris, vec!["spotify:track:new", "spotify:track:old"]);
    }
}
