//! Turns a music cue into Spotify candidates: text matching against a loaded library, recent-track
//! avoidance and an evenly spread fill. Pure functions, so the rules can be tested without Spotify.

use serde_json::{json, Value};
use std::collections::HashSet;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Words that say nothing about which track fits, so they never count as a match.
const FILLER_WORDS: &[&str] = &[
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "bit",
    "by",
    "feel",
    "feeling",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "kind",
    "like",
    "little",
    "music",
    "of",
    "on",
    "or",
    "play",
    "playing",
    "playlist",
    "really",
    "scene",
    "some",
    "something",
    "song",
    "songs",
    "sort",
    "style",
    "that",
    "the",
    "this",
    "to",
    "track",
    "tracks",
    "type",
    "very",
    "vibe",
    "vibes",
    "with",
];

/// Mood words and the related words they should also match. Any word in a group matches the group.
const MOOD_GROUPS: &[&[&str]] = &[
    &[
        "battle", "fight", "fighting", "war", "combat", "clash", "boss",
    ],
    &[
        "calm", "peaceful", "peace", "gentle", "quiet", "soft", "serene", "relaxing", "tranquil",
    ],
    &[
        "sad",
        "sorrow",
        "melancholy",
        "tears",
        "cry",
        "grief",
        "lonely",
        "heartbreak",
    ],
    &[
        "happy", "joy", "joyful", "cheerful", "bright", "sunny", "upbeat",
    ],
    &["tense", "tension", "suspense", "dread", "anxious", "uneasy"],
    &["romantic", "romance", "love", "tender", "heart"],
    &["mysterious", "mystery", "enigma", "secret", "secrets"],
    &["dark", "shadow", "shadows", "ominous", "night"],
    &["scary", "horror", "fear", "creepy", "haunted", "terror"],
    &["energetic", "energy", "power", "hype", "drive", "rush"],
    &["dreamy", "dream", "dreams", "sleep", "lullaby"],
    &["adventure", "journey", "quest", "travel", "explore"],
    &["epic", "heroic", "hero", "triumph", "glory"],
];

const TITLE_WEIGHT: u32 = 3;
const ALBUM_WEIGHT: u32 = 2;
const ARTIST_WEIGHT: u32 = 1;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Track {
    pub uri: String,
    pub name: String,
    pub artists: Vec<String>,
    pub album: String,
    pub image: Option<String>,
    pub duration_ms: Option<u64>,
}

/// Reads a Spotify track object. Episodes, local files and unavailable (null) entries are skipped.
pub(super) fn track_from_json(value: &Value) -> Option<Track> {
    if value.get("type").and_then(Value::as_str).unwrap_or("track") != "track"
        || value.get("is_local").and_then(Value::as_bool) == Some(true)
    {
        return None;
    }
    let uri = value.get("uri").and_then(Value::as_str)?;
    if !uri.starts_with("spotify:track:") {
        return None;
    }
    let artists = value
        .get("artists")
        .and_then(Value::as_array)
        .map(|artists| {
            artists
                .iter()
                .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let album = value.get("album");
    Some(Track {
        uri: uri.to_owned(),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Spotify track")
            .to_owned(),
        artists,
        album: album
            .and_then(|album| album.get("name"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        image: album
            .and_then(|album| album.get("images"))
            .and_then(Value::as_array)
            .and_then(|images| images.first())
            .and_then(|image| image.get("url"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        duration_ms: value.get("duration_ms").and_then(Value::as_u64),
    })
}

/// A `MusicCandidate` for the shared ranker.
pub(super) fn candidate(track: &Track, confidence: f64, tags: &[&str]) -> Value {
    let track_id = track.uri.trim_start_matches("spotify:track:");
    json!({
        "provider": "spotify",
        "id": track.uri,
        "title": track.name,
        "channelOrArtist": if track.artists.is_empty() { Value::Null } else { json!(track.artists.join(", ")) },
        "album": if track.album.is_empty() { Value::Null } else { json!(track.album) },
        "url": format!("https://open.spotify.com/track/{track_id}"),
        "thumbnail": track.image,
        "durationSeconds": track.duration_ms.map(|ms| ms / 1000),
        "confidence": (confidence * 100.0).round() / 100.0,
        "reasonTags": tags,
    })
}

/// The search text for a cue: query, mood, setting and constraints, in that order.
pub(super) fn search_text(body: &Value) -> String {
    let mut parts: Vec<String> = ["query", "mood", "setting"]
        .iter()
        .filter_map(|key| body.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if let Some(constraints) = body.get("constraints").and_then(Value::as_array) {
        parts.extend(
            constraints
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(ToOwned::to_owned),
        );
    }
    parts.join(" ")
}

/// Lowercase words with accents and punctuation removed.
pub(super) fn normalized_words(text: &str) -> Vec<String> {
    let folded: String = text
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    folded.split_whitespace().map(ToOwned::to_owned).collect()
}

/// One entry per meaningful search word: the word plus its related mood words.
fn needle_groups(text: &str) -> Vec<Vec<String>> {
    let mut seen = HashSet::new();
    normalized_words(text)
        .into_iter()
        .filter(|word| !FILLER_WORDS.contains(&word.as_str()) && seen.insert(word.clone()))
        .map(|word| {
            let mut group = vec![word.clone()];
            if let Some(related) = MOOD_GROUPS
                .iter()
                .find(|group| group.contains(&word.as_str()))
            {
                group.extend(
                    related
                        .iter()
                        .filter(|related| **related != word)
                        .map(|related| (*related).to_owned()),
                );
            }
            group
        })
        .collect()
}

fn word_matches(field_words: &[String], needle: &str) -> bool {
    field_words
        .iter()
        .any(|word| word == needle || (needle.chars().count() >= 4 && word.starts_with(needle)))
}

struct TrackWords {
    title: Vec<String>,
    album: Vec<String>,
    artist: Vec<String>,
}

fn match_score(words: &TrackWords, groups: &[Vec<String>]) -> u32 {
    groups
        .iter()
        .map(|group| {
            let hit = |field: &[String]| group.iter().any(|needle| word_matches(field, needle));
            if hit(&words.title) {
                TITLE_WEIGHT
            } else if hit(&words.album) {
                ALBUM_WEIGHT
            } else if hit(&words.artist) {
                ARTIST_WEIGHT
            } else {
                0
            }
        })
        .sum()
}

/// Drops `exclude` always and `recent` unless that leaves nothing.
pub(super) fn avoid_recent<'a>(
    tracks: impl IntoIterator<Item = &'a Track>,
    recent: &HashSet<String>,
    exclude: &HashSet<String>,
) -> Vec<&'a Track> {
    let pool: Vec<&Track> = tracks
        .into_iter()
        .filter(|track| !exclude.contains(&track.uri))
        .collect();
    let fresh: Vec<&Track> = pool
        .iter()
        .copied()
        .filter(|track| !recent.contains(&track.uri))
        .collect();
    if fresh.is_empty() {
        pool
    } else {
        fresh
    }
}

/// Picks at most `limit` candidates from a loaded library: matching tracks best first (title over album
/// over artist), then tracks spread evenly across the rest of the library starting at `seed`.
pub(super) fn select_from_library(
    tracks: &[Track],
    text: &str,
    recent: &HashSet<String>,
    exclude: &HashSet<String>,
    limit: usize,
    seed: u64,
    source_tag: &str,
) -> Vec<Value> {
    let pool = avoid_recent(tracks, recent, exclude);
    let groups = needle_groups(text);
    let mut scored: Vec<(u32, usize)> = Vec::new();
    if !groups.is_empty() {
        for (index, track) in pool.iter().enumerate() {
            let words = TrackWords {
                title: normalized_words(&track.name),
                album: normalized_words(&track.album),
                artist: normalized_words(&track.artists.join(" ")),
            };
            let score = match_score(&words, &groups);
            if score > 0 {
                scored.push((score, index));
            }
        }
    }
    scored.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
    scored.truncate(limit);

    let best = scored.first().map(|(score, _)| *score).unwrap_or(1).max(1) as f64;
    let mut picked: Vec<Value> = scored
        .iter()
        .map(|(score, index)| {
            candidate(
                pool[*index],
                0.6 + 0.35 * (*score as f64 / best),
                &["spotify", source_tag, "match"],
            )
        })
        .collect();

    let matched: HashSet<usize> = scored.iter().map(|(_, index)| *index).collect();
    let rest: Vec<&Track> = pool
        .iter()
        .enumerate()
        .filter(|(index, _)| !matched.contains(index))
        .map(|(_, track)| *track)
        .collect();
    for index in spread_indices(rest.len(), limit.saturating_sub(picked.len()), seed) {
        picked.push(candidate(
            rest[index],
            0.4,
            &["spotify", source_tag, "fill"],
        ));
    }
    picked
}

/// `count` distinct indices spread evenly over `0..len`, starting at a point chosen by `seed`.
pub(super) fn spread_indices(len: usize, count: usize, seed: u64) -> Vec<usize> {
    if len == 0 || count == 0 {
        return Vec::new();
    }
    let count = count.min(len);
    let start = (seed % len as u64) as usize;
    let stride = len as f64 / count as f64;
    (0..count)
        .map(|step| (start + (step as f64 * stride) as usize) % len)
        .collect()
}

/// How well a search result fits a requested title and artist, for the `[spotify: …]` command.
pub(super) fn best_match_score(track: &Track, title: &str, artist: &str) -> u32 {
    let wanted_title = normalized_words(title).join(" ");
    let wanted_artist = normalized_words(artist).join(" ");
    let found_title = normalized_words(&track.name).join(" ");
    let mut score = 0;
    if !wanted_title.is_empty() && !found_title.is_empty() {
        if found_title == wanted_title {
            score += 4;
        } else if found_title.contains(&wanted_title) || wanted_title.contains(&found_title) {
            score += 2;
        }
    }
    if !wanted_artist.is_empty() {
        let artists: Vec<String> = track
            .artists
            .iter()
            .map(|name| normalized_words(name).join(" "))
            .filter(|name| !name.is_empty())
            .collect();
        if artists.contains(&wanted_artist) {
            score += 3;
        } else if artists
            .iter()
            .any(|name| name.contains(&wanted_artist) || wanted_artist.contains(name.as_str()))
        {
            score += 1;
        }
    }
    score
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(uri: &str, name: &str, artist: &str, album: &str) -> Track {
        Track {
            uri: format!("spotify:track:{uri}"),
            name: name.to_owned(),
            artists: vec![artist.to_owned()],
            album: album.to_owned(),
            image: None,
            duration_ms: Some(200_000),
        }
    }

    fn ids(candidates: &[Value]) -> Vec<String> {
        candidates
            .iter()
            .map(|candidate| {
                candidate["id"]
                    .as_str()
                    .unwrap()
                    .trim_start_matches("spotify:track:")
                    .to_owned()
            })
            .collect()
    }

    fn none() -> HashSet<String> {
        HashSet::new()
    }

    #[test]
    fn title_matches_rank_above_album_and_artist_matches() {
        let tracks = vec![
            track("artist", "Morning", "Storm Choir", "Plain"),
            track("album", "Evening", "Someone", "Storm Season"),
            track("title", "The Storm", "Someone", "Plain"),
            track("none", "Unrelated", "Someone", "Plain"),
        ];
        let picked = select_from_library(&tracks, "storm", &none(), &none(), 3, 0, "liked");
        assert_eq!(ids(&picked), vec!["title", "album", "artist"]);
        assert_eq!(picked[0]["provider"], "spotify");
        assert_eq!(picked[0]["channelOrArtist"], "Someone");
        assert_eq!(picked[0]["durationSeconds"], 200);
    }

    #[test]
    fn matching_ignores_case_accents_and_filler_words() {
        let tracks = vec![
            track("cafe", "CAFÉ Noir", "A", "B"),
            track("other", "The Song", "A", "B"),
        ];
        let picked = select_from_library(
            &tracks,
            "the song with some cafe music",
            &none(),
            &none(),
            1,
            0,
            "liked",
        );
        assert_eq!(ids(&picked), vec!["cafe"]);
    }

    #[test]
    fn mood_words_match_related_words() {
        let tracks = vec![
            track("war", "Drums of War", "A", "B"),
            track("gentle", "A Gentle Rain", "A", "B"),
            track("none", "Nothing Here", "A", "B"),
        ];
        let battle = select_from_library(&tracks, "battle", &none(), &none(), 1, 0, "liked");
        assert_eq!(ids(&battle), vec!["war"]);
        let calm = select_from_library(&tracks, "calm", &none(), &none(), 1, 0, "liked");
        assert_eq!(ids(&calm), vec!["gentle"]);
    }

    #[test]
    fn recent_tracks_are_avoided_unless_nothing_else_is_left() {
        let tracks = vec![
            track("one", "Storm One", "A", "B"),
            track("two", "Storm Two", "A", "B"),
        ];
        let recent: HashSet<String> = ["spotify:track:one".to_owned()].into();
        let picked = select_from_library(&tracks, "storm", &recent, &none(), 5, 0, "liked");
        assert_eq!(ids(&picked), vec!["two"]);

        let all_recent: HashSet<String> = [
            "spotify:track:one".to_owned(),
            "spotify:track:two".to_owned(),
        ]
        .into();
        let picked = select_from_library(&tracks, "storm", &all_recent, &none(), 5, 0, "liked");
        assert_eq!(ids(&picked), vec!["one", "two"]);
    }

    #[test]
    fn excluded_current_track_is_never_offered() {
        let tracks = vec![track("current", "Storm", "A", "B")];
        let exclude: HashSet<String> = ["spotify:track:current".to_owned()].into();
        let picked = select_from_library(&tracks, "storm", &none(), &exclude, 5, 0, "liked");
        assert!(picked.is_empty());
    }

    #[test]
    fn too_few_matches_fill_evenly_from_a_varying_start() {
        let tracks: Vec<Track> = (0..10)
            .map(|index| track(&index.to_string(), &format!("Song {index}"), "A", "B"))
            .collect();
        let first = select_from_library(&tracks, "nomatch", &none(), &none(), 5, 0, "liked");
        assert_eq!(ids(&first), vec!["0", "2", "4", "6", "8"]);
        assert!(first
            .iter()
            .all(|candidate| candidate["reasonTags"][2] == "fill"));
        let second = select_from_library(&tracks, "nomatch", &none(), &none(), 5, 3, "liked");
        assert_eq!(ids(&second), vec!["3", "5", "7", "9", "1"]);
    }

    #[test]
    fn matches_come_first_then_fill_never_repeats_a_match() {
        let tracks = vec![
            track("a", "Plain A", "X", "Y"),
            track("hit", "Storm", "X", "Y"),
            track("b", "Plain B", "X", "Y"),
        ];
        let picked = select_from_library(&tracks, "storm", &none(), &none(), 3, 0, "playlist");
        let picked_ids = ids(&picked);
        assert_eq!(picked_ids[0], "hit");
        assert_eq!(picked_ids.len(), 3);
        assert_eq!(picked_ids.iter().collect::<HashSet<_>>().len(), 3);
    }

    #[test]
    fn spread_indices_are_distinct_and_capped() {
        assert_eq!(spread_indices(3, 10, 1), vec![1, 2, 0]);
        assert!(spread_indices(0, 5, 0).is_empty());
        let picked = spread_indices(2500, 50, 77);
        assert_eq!(picked.len(), 50);
        assert_eq!(picked.iter().collect::<HashSet<_>>().len(), 50);
    }

    #[test]
    fn best_match_prefers_exact_title_and_artist() {
        let exact = track("exact", "Clair de Lune", "Debussy", "B");
        let cover = track("cover", "Clair de Lune (Piano Cover)", "Someone", "B");
        assert!(
            best_match_score(&exact, "clair de lune", "Debussy")
                > best_match_score(&cover, "clair de lune", "Debussy")
        );
    }

    #[test]
    fn track_parsing_skips_local_files_and_episodes() {
        let local = json!({ "uri": "spotify:local:x", "is_local": true, "name": "x" });
        let episode = json!({ "uri": "spotify:episode:x", "type": "episode", "name": "x" });
        let song = json!({
            "uri": "spotify:track:abc",
            "type": "track",
            "name": "Song",
            "artists": [{ "name": "One" }, { "name": "Two" }],
            "album": { "name": "Album", "images": [{ "url": "https://i.scdn.co/image/x" }] },
            "duration_ms": 61_000
        });
        assert!(track_from_json(&local).is_none());
        assert!(track_from_json(&episode).is_none());
        let parsed = track_from_json(&song).unwrap();
        let value = candidate(&parsed, 0.5, &["spotify"]);
        assert_eq!(value["channelOrArtist"], "One, Two");
        assert_eq!(value["thumbnail"], "https://i.scdn.co/image/x");
        assert_eq!(value["url"], "https://open.spotify.com/track/abc");
    }

    #[test]
    fn search_text_joins_query_mood_setting_and_constraints() {
        let body = json!({
            "query": "rainy jazz",
            "mood": "calm",
            "setting": "",
            "constraints": ["no vocals", 3]
        });
        assert_eq!(search_text(&body), "rainy jazz calm no vocals");
    }
}
