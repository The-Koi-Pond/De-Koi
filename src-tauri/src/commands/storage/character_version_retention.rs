use crate::state::AppState;
use chrono::{DateTime, Utc};
use marinara_core::AppResult;
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

#[cfg(test)]
static FORCE_PRUNE_FAILURE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

pub(crate) const CHARACTER_VERSION_UNPINNED_LIMIT: usize = 50;

#[derive(Debug, Default, Eq, PartialEq)]
pub(crate) struct CharacterVersionPruneReport {
    pub affected_characters: usize,
    pub retained_unpinned: usize,
    pub retained_pinned: usize,
    pub pruned_rows: usize,
    pub cleaned_media: usize,
    pub preserved_shared_media: usize,
    pub malformed_ownerless_rows: usize,
}

struct VersionRetentionMeta {
    id: String,
    character_id: Option<String>,
    pinned: bool,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    version_parts: Vec<u64>,
    source_index: usize,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct VersionRetentionIdentity {
    source_index: usize,
    id: String,
    character_id: Option<String>,
    pinned: bool,
}

fn retention_identity(row: &VersionRetentionMeta) -> VersionRetentionIdentity {
    VersionRetentionIdentity {
        source_index: row.source_index,
        id: row.id.clone(),
        character_id: row.character_id.clone(),
        pinned: row.pinned,
    }
}

fn select_pruned_rows(
    rows: &[VersionRetentionMeta],
    limit: usize,
) -> HashSet<VersionRetentionIdentity> {
    let mut by_character: HashMap<&str, Vec<&VersionRetentionMeta>> = HashMap::new();
    for row in rows.iter().filter(|row| !row.pinned) {
        if let Some(character_id) = row.character_id.as_deref() {
            by_character.entry(character_id).or_default().push(row);
        }
    }

    let mut pruned = HashSet::new();
    for rows in by_character.values_mut() {
        rows.sort_by(|left, right| compare_newest_first(left, right));
        pruned.extend(rows.iter().skip(limit).map(|row| retention_identity(row)));
    }
    pruned
}

#[cfg(test)]
fn select_pruned_ids(rows: &[VersionRetentionMeta], limit: usize) -> HashSet<String> {
    select_pruned_rows(rows, limit)
        .into_iter()
        .map(|row| row.id)
        .collect()
}

fn compare_newest_first(left: &VersionRetentionMeta, right: &VersionRetentionMeta) -> Ordering {
    right
        .created_at
        .cmp(&left.created_at)
        .then_with(|| right.updated_at.cmp(&left.updated_at))
        .then_with(|| right.version_parts.cmp(&left.version_parts))
        .then_with(|| left.source_index.cmp(&right.source_index))
}

pub(crate) fn prune_character_versions(
    state: &AppState,
    character_ids: Option<&HashSet<String>>,
) -> AppResult<CharacterVersionPruneReport> {
    #[cfg(test)]
    if FORCE_PRUNE_FAILURE
        .lock()
        .expect("forced prune failure should lock")
        .take_if(|data_dir| data_dir == &state.data_dir)
        .is_some()
    {
        return Err(marinara_core::AppError::new(
            "forced_character_version_prune_failure",
            "forced character version prune failure",
        ));
    }
    let mut rows = Vec::new();
    let mut malformed_ownerless_rows = 0;
    state
        .storage
        .visit_collection_streaming("character-versions", |source_index, row| {
            let character_id = non_empty_string(row, "characterId");
            if character_id.is_none() {
                malformed_ownerless_rows += 1;
                return Ok(());
            }
            if character_ids.is_some_and(|ids| !ids.contains(character_id.as_deref().unwrap())) {
                return Ok(());
            }
            let Some(id) = non_empty_string(row, "id") else {
                return Ok(());
            };
            rows.push(VersionRetentionMeta {
                id,
                character_id,
                pinned: row.get("pinned").and_then(Value::as_bool).unwrap_or(false),
                created_at: parse_date(row, "createdAt"),
                updated_at: parse_date(row, "updatedAt"),
                version_parts: parse_version_parts(
                    row.get("version")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                ),
                source_index,
            });
            Ok(())
        })?;

    let pruned_rows = select_pruned_rows(&rows, CHARACTER_VERSION_UNPINNED_LIMIT);
    let affected_characters = rows
        .iter()
        .filter(|row| pruned_rows.contains(&retention_identity(row)))
        .filter_map(|row| row.character_id.as_deref())
        .collect::<HashSet<_>>()
        .len();
    let retained_pinned = rows.iter().filter(|row| row.pinned).count();
    let retained_unpinned = rows.iter().filter(|row| !row.pinned).count() - pruned_rows.len();
    let mut media_candidates = HashSet::new();
    let filter_report = state.storage.filter_collection_streaming(
        "character-versions",
        "retention-prune",
        |source_index, row| {
            let selected = filter_identity(source_index, row)
                .is_some_and(|identity| pruned_rows.contains(&identity));
            if selected {
                media_candidates.extend(managed_media_paths(state, row));
            }
            Ok(!selected)
        },
    )?;

    let (cleaned_media, preserved_shared_media) = cleanup_pruned_media(state, media_candidates)?;
    Ok(CharacterVersionPruneReport {
        affected_characters,
        retained_unpinned,
        retained_pinned,
        pruned_rows: filter_report.deleted_records,
        cleaned_media,
        preserved_shared_media,
        malformed_ownerless_rows,
    })
}

pub(crate) fn preview_character_version_pruning(rows: &[Value]) -> CharacterVersionPruneReport {
    let metadata = rows
        .iter()
        .enumerate()
        .filter_map(|(source_index, row)| {
            Some(VersionRetentionMeta {
                id: non_empty_string(row, "id")?,
                character_id: non_empty_string(row, "characterId"),
                pinned: row.get("pinned").and_then(Value::as_bool).unwrap_or(false),
                created_at: parse_date(row, "createdAt"),
                updated_at: parse_date(row, "updatedAt"),
                version_parts: parse_version_parts(
                    row.get("version")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                ),
                source_index,
            })
        })
        .collect::<Vec<_>>();
    let selected = select_pruned_rows(&metadata, CHARACTER_VERSION_UNPINNED_LIMIT);
    CharacterVersionPruneReport {
        affected_characters: metadata
            .iter()
            .filter_map(|row| row.character_id.as_deref())
            .collect::<HashSet<_>>()
            .len(),
        retained_unpinned: metadata.iter().filter(|row| !row.pinned).count() - selected.len(),
        retained_pinned: metadata.iter().filter(|row| row.pinned).count(),
        pruned_rows: selected.len(),
        malformed_ownerless_rows: rows
            .iter()
            .filter(|row| non_empty_string(row, "characterId").is_none())
            .count(),
        ..Default::default()
    }
}

#[cfg(test)]
pub(crate) fn force_character_version_prune_failure(state: &AppState) {
    *FORCE_PRUNE_FAILURE
        .lock()
        .expect("forced prune failure should lock") = Some(state.data_dir.clone());
}

fn filter_identity(source_index: usize, row: &Value) -> Option<VersionRetentionIdentity> {
    Some(VersionRetentionIdentity {
        source_index,
        id: non_empty_string(row, "id")?,
        character_id: non_empty_string(row, "characterId"),
        pinned: row.get("pinned").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn non_empty_string(row: &Value, field: &str) -> Option<String> {
    row.get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_date(row: &Value, field: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(row.get(field)?.as_str()?)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    version
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn managed_media_paths(state: &AppState, row: &Value) -> Vec<PathBuf> {
    let target_dir = state.data_dir.join("avatars/characters/versions");
    let Ok(target) = fs::canonicalize(&target_dir) else {
        return Vec::new();
    };
    let mut paths = ["avatarFilePath", "bannerImageFilePath"]
        .iter()
        .filter_map(|field| row.get(*field).and_then(Value::as_str))
        .filter_map(|path| fs::canonicalize(path).ok())
        .filter(|path| path.starts_with(&target))
        .collect::<Vec<_>>();
    paths.extend(
        ["avatarFilename", "bannerImageFilename"]
            .iter()
            .filter_map(|field| row.get(*field).and_then(Value::as_str))
            .filter(|filename| {
                PathBuf::from(filename)
                    .file_name()
                    .and_then(|value| value.to_str())
                    == Some(*filename)
            })
            .filter_map(|filename| fs::canonicalize(target_dir.join(filename)).ok())
            .filter(|path| path.starts_with(&target)),
    );
    paths.sort();
    paths.dedup();
    paths
}

fn cleanup_pruned_media(
    state: &AppState,
    candidates: HashSet<PathBuf>,
) -> AppResult<(usize, usize)> {
    if candidates.is_empty() {
        return Ok((0, 0));
    }
    let mut referenced_paths = HashSet::new();
    let mut referenced_urls = HashSet::new();
    for collection in ["character-versions", "characters"] {
        state
            .storage
            .visit_collection_streaming(collection, |_index, row| {
                referenced_paths.extend(managed_media_paths(state, row));
                collect_media_urls(row, &mut referenced_urls);
                Ok(())
            })?;
    }

    let mut cleaned = 0;
    let mut preserved = 0;
    for path in candidates {
        if referenced_paths.contains(&path)
            || referenced_urls.contains(&super::media_uploads::file_path_asset_url(&path))
        {
            preserved += 1;
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => cleaned += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok((cleaned, preserved))
}

fn collect_media_urls(row: &Value, urls: &mut HashSet<String>) {
    for field in ["avatarPath", "avatar", "avatarUrl"] {
        if let Some(value) = row.get(field).and_then(Value::as_str) {
            urls.insert(value.to_string());
        }
    }
    if let Some(value) = row
        .pointer("/data/extensions/publicProfile/bannerImage")
        .and_then(Value::as_str)
    {
        urls.insert(value.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-retention-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn seed_versions(state: &AppState, character_id: &str, count: usize, pinned: &[&str]) {
        for index in 0..count {
            let id = format!("version-{index}");
            state
                .storage
                .create(
                    "character-versions",
                    json!({
                        "id": id,
                        "characterId": character_id,
                        "version": format!("1.{index}"),
                        "createdAt": format!("2026-01-{:02}T00:00:00Z", (index % 28) + 1),
                        "pinned": pinned.contains(&id.as_str()),
                        "data": { "name": format!("Version {index}") }
                    }),
                )
                .expect("version should seed");
        }
    }

    fn version_meta(
        id: impl Into<String>,
        character_id: impl Into<String>,
        created_at: impl AsRef<str>,
        pinned: bool,
        source_index: usize,
    ) -> VersionRetentionMeta {
        VersionRetentionMeta {
            id: id.into(),
            character_id: Some(character_id.into()),
            pinned,
            created_at: DateTime::parse_from_rfc3339(created_at.as_ref())
                .ok()
                .map(|value| value.with_timezone(&Utc)),
            updated_at: None,
            version_parts: Vec::new(),
            source_index,
        }
    }

    fn ownerless_meta(id: impl Into<String>, source_index: usize) -> VersionRetentionMeta {
        VersionRetentionMeta {
            id: id.into(),
            character_id: None,
            pinned: false,
            created_at: None,
            updated_at: None,
            version_parts: Vec::new(),
            source_index,
        }
    }

    #[test]
    fn selector_keeps_newest_fifty_unpinned_and_all_pinned() {
        let rows = (0..55)
            .map(|index| {
                version_meta(
                    format!("v-{index}"),
                    "char-1",
                    format!("2026-01-{:02}T00:00:00Z", (index % 28) + 1),
                    index == 0,
                    index,
                )
            })
            .collect::<Vec<_>>();

        let selection = select_pruned_ids(&rows, 50);

        assert!(!selection.contains("v-0"));
        assert_eq!(selection.len(), 4);
    }

    #[test]
    fn selector_isolates_characters_and_preserves_ownerless_rows() {
        let rows = vec![
            version_meta("a-old", "a", "2026-01-01T00:00:00Z", false, 0),
            version_meta("a-new", "a", "2026-01-02T00:00:00Z", false, 1),
            version_meta("b-only", "b", "2026-01-01T00:00:00Z", false, 2),
            ownerless_meta("unknown", 3),
        ];
        assert!(select_pruned_ids(&rows, 1).contains("a-old"));
        assert!(!select_pruned_ids(&rows, 1).contains("b-only"));
        assert!(!select_pruned_ids(&rows, 1).contains("unknown"));
    }

    #[test]
    fn selector_observes_forty_nine_fifty_and_fifty_one_boundaries() {
        for (count, expected) in [(49, 0), (50, 0), (51, 1)] {
            let rows = (0..count)
                .map(|index| {
                    version_meta(
                        format!("v-{index}"),
                        "char",
                        "2026-01-01T00:00:00Z",
                        false,
                        index,
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(select_pruned_ids(&rows, 50).len(), expected);
        }
    }

    #[test]
    fn selector_never_prunes_pinned_rows() {
        let rows = (0..60)
            .map(|index| {
                version_meta(
                    format!("v-{index}"),
                    "char",
                    "2026-01-01T00:00:00Z",
                    true,
                    index,
                )
            })
            .collect::<Vec<_>>();
        assert!(select_pruned_ids(&rows, 1).is_empty());
    }

    #[test]
    fn selector_uses_updated_at_after_invalid_created_dates() {
        let mut old = version_meta("old", "char", "invalid", false, 0);
        old.updated_at = DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
            .ok()
            .map(|value| value.with_timezone(&Utc));
        let mut new = version_meta("new", "char", "invalid", false, 1);
        new.updated_at = DateTime::parse_from_rfc3339("2026-01-02T00:00:00Z")
            .ok()
            .map(|value| value.with_timezone(&Utc));
        assert_eq!(
            select_pruned_ids(&[old, new], 1),
            ["old".to_string()].into()
        );
    }

    #[test]
    fn selector_orders_semver_like_labels_numerically() {
        let mut v2 = version_meta("v2", "char", "invalid", false, 0);
        v2.version_parts = vec![1, 2];
        let mut v10 = version_meta("v10", "char", "invalid", false, 1);
        v10.version_parts = vec![1, 10];
        assert_eq!(select_pruned_ids(&[v2, v10], 1), ["v2".to_string()].into());
    }

    #[test]
    fn selector_exact_ties_keep_stable_source_order() {
        let rows = vec![
            version_meta("first", "char", "invalid", false, 0),
            version_meta("second", "char", "invalid", false, 1),
        ];
        assert_eq!(select_pruned_ids(&rows, 1), ["second".to_string()].into());
    }

    #[test]
    fn duplicate_id_does_not_select_pinned_row_identity() {
        let rows = vec![
            version_meta("duplicate", "char", "2026-01-01T00:00:00Z", false, 0),
            version_meta("new", "char", "2026-01-02T00:00:00Z", false, 1),
            version_meta("duplicate", "char", "2026-01-03T00:00:00Z", true, 2),
        ];

        let selection = select_pruned_rows(&rows, 1);

        assert!(selection.contains(&retention_identity(&rows[0])));
        assert!(!selection.contains(&retention_identity(&rows[2])));
    }

    #[test]
    fn duplicate_id_does_not_select_ownerless_row_identity() {
        let rows = vec![
            version_meta("duplicate", "char", "2026-01-01T00:00:00Z", false, 0),
            version_meta("new", "char", "2026-01-02T00:00:00Z", false, 1),
            ownerless_meta("duplicate", 2),
        ];

        let selection = select_pruned_rows(&rows, 1);

        assert!(selection.contains(&retention_identity(&rows[0])));
        assert!(!selection.contains(&retention_identity(&rows[2])));
    }

    #[test]
    fn duplicate_id_does_not_select_other_character_row_identity() {
        let rows = vec![
            version_meta("duplicate", "scoped", "2026-01-01T00:00:00Z", false, 0),
            version_meta("new", "scoped", "2026-01-02T00:00:00Z", false, 1),
            version_meta("duplicate", "unscoped", "2026-01-03T00:00:00Z", false, 2),
        ];

        let selection = select_pruned_rows(&rows[..2], 1);

        assert!(selection.contains(&retention_identity(&rows[0])));
        assert!(!selection.contains(&retention_identity(&rows[2])));
    }

    #[test]
    fn pruning_filters_rows_without_loading_payload_collection() {
        let state = test_state("retention-bounded-filter");
        seed_versions(&state, "char-1", 55, &["version-0"]);

        let report = prune_character_versions(&state, None).unwrap();
        let retained = state.storage.list("character-versions").unwrap();

        assert_eq!(report.pruned_rows, 4);
        assert_eq!(retained.len(), 51);
        assert!(retained.iter().any(|row| row["id"] == "version-0"));
    }

    #[test]
    fn pruning_preserves_media_referenced_by_surviving_filename() {
        let state = test_state("retention-shared-media");
        let media_dir = state.data_dir.join("avatars/characters/versions");
        std::fs::create_dir_all(&media_dir).unwrap();
        let media_path = media_dir.join("shared.png");
        std::fs::write(&media_path, b"shared").unwrap();
        state
            .storage
            .create(
                "character-versions",
                json!({
                    "id": "old", "characterId": "char-1", "createdAt": "2025-01-01T00:00:00Z",
                    "avatarFilePath": media_path.to_string_lossy(), "avatarFilename": "shared.png"
                }),
            )
            .unwrap();
        seed_versions(&state, "char-1", 50, &[]);
        state
            .storage
            .create(
                "character-versions",
                json!({
                    "id": "shared-pinned", "characterId": "char-1", "pinned": true,
                    "avatarFilename": "shared.png"
                }),
            )
            .unwrap();

        let report = prune_character_versions(&state, None).unwrap();

        assert!(media_path.is_file());
        assert_eq!(report.preserved_shared_media, 1);
        assert_eq!(report.cleaned_media, 0);
    }
}
