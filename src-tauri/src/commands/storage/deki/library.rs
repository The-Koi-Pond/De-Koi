use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

const OVERVIEW_DEFAULT_LIMIT: usize = 80;
const OVERVIEW_MAX_LIMIT: usize = 200;
const DETAIL_MAX_ITEMS: usize = 10;
const CHILD_DEFAULT_LIMIT: usize = 50;
const CHILD_MAX_LIMIT: usize = 200;
const DETAIL_MAX_BYTES: usize = 512 * 1024;

const LIBRARY_TYPES: &[LibraryType] = &[
    LibraryType {
        overview_type: "character",
        entity: "characters",
        plural: "characters",
        aliases: &["char", "chars"],
    },
    LibraryType {
        overview_type: "character_group",
        entity: "character-groups",
        plural: "characterGroups",
        aliases: &["character_groups"],
    },
    LibraryType {
        overview_type: "persona",
        entity: "personas",
        plural: "personas",
        aliases: &[],
    },
    LibraryType {
        overview_type: "persona_group",
        entity: "persona-groups",
        plural: "personaGroups",
        aliases: &["persona_groups"],
    },
    LibraryType {
        overview_type: "lorebook",
        entity: "lorebooks",
        plural: "lorebooks",
        aliases: &[],
    },
    LibraryType {
        overview_type: "lorebook_entry",
        entity: "lorebook-entries",
        plural: "lorebookEntries",
        aliases: &["lorebook_entries"],
    },
    LibraryType {
        overview_type: "prompt_preset",
        entity: "prompts",
        plural: "promptPresets",
        aliases: &[
            "prompt",
            "prompts",
            "promptPreset",
            "prompt_presets",
            "preset",
            "presets",
        ],
    },
    LibraryType {
        overview_type: "prompt_section",
        entity: "prompt-sections",
        plural: "promptSections",
        aliases: &["prompt_sections"],
    },
    LibraryType {
        overview_type: "prompt_group",
        entity: "prompt-groups",
        plural: "promptGroups",
        aliases: &["prompt_groups"],
    },
    LibraryType {
        overview_type: "prompt_variable",
        entity: "prompt-variables",
        plural: "promptVariables",
        aliases: &["choice_block", "choice_blocks", "prompt_variables"],
    },
];

#[derive(Clone, Copy)]
struct LibraryType {
    overview_type: &'static str,
    entity: &'static str,
    plural: &'static str,
    aliases: &'static [&'static str],
}

pub(super) struct LibraryOverviewQuery {
    pub(super) item_type: Option<String>,
    pub(super) types: Vec<String>,
    pub(super) query: Option<String>,
    pub(super) limit: Option<usize>,
    pub(super) offset: Option<usize>,
}

pub(super) struct LibraryItemRequest {
    pub(super) item_type: String,
    pub(super) id: String,
    pub(super) include_entries: Option<bool>,
    pub(super) entry_query: Option<String>,
    pub(super) entry_limit: Option<usize>,
    pub(super) entry_offset: Option<usize>,
}

pub(super) fn overview(state: &AppState, query: LibraryOverviewQuery) -> AppResult<Value> {
    let selected_types = selected_library_types(query.item_type, query.types)?;
    let needle = normalized_query(query.query.as_deref());
    let limit = bounded_limit(query.limit, OVERVIEW_DEFAULT_LIMIT, OVERVIEW_MAX_LIMIT);
    let offset = query.offset.unwrap_or(0);
    let mut all_items = Vec::new();
    let mut totals = Map::new();

    for library_type in selected_types {
        let rows = state.storage.list(library_type.entity)?;
        let mut matching_count = 0usize;
        for row in rows {
            if matches_library_query(library_type, &row, needle.as_deref()) {
                matching_count += 1;
                let item = overview_item(state, library_type, &row, needle.as_deref())?;
                all_items.push(item);
            }
        }
        totals.insert(
            library_type.overview_type.to_string(),
            json!(matching_count),
        );
    }

    all_items.sort_by(|left, right| {
        let left_name = sort_string(left.get("name"));
        let right_name = sort_string(right.get("name"));
        left.get("type")
            .and_then(Value::as_str)
            .cmp(&right.get("type").and_then(Value::as_str))
            .then_with(|| left_name.cmp(&right_name))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });

    let matching_total = all_items.len();
    let items = all_items
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let page_count = items.len();

    Ok(json!({
        "items": items,
        "matchingTotal": matching_total,
        "pageCount": page_count,
        "offset": offset,
        "limit": limit,
        "hasMore": offset.saturating_add(limit) < matching_total,
        "pagination": {
            "matchingTotal": matching_total,
            "pageCount": page_count,
            "offset": offset,
            "limit": limit,
            "hasMore": offset.saturating_add(limit) < matching_total
        },
        "totalsByType": totals,
        "contract": {
            "detailTool": "read_deki_library_items",
            "countSemantics": "matchingTotal is the full number of matching overview rows before pagination. pageCount is the number of rows returned in items. No ambiguous total field is returned.",
            "statSemantics": "Parent rows expose matching* child counts for the active query and total* child counts for the full backing collection.",
            "note": "Overview rows omit full record bodies. Use read_deki_library_items with exact type/id selections for full content."
        }
    }))
}

pub(super) fn items(state: &AppState, requests: Vec<LibraryItemRequest>) -> AppResult<Value> {
    if requests.is_empty() {
        return Err(AppError::invalid_input(
            "read_deki_library_items requires at least one item",
        ));
    }
    if requests.len() > DETAIL_MAX_ITEMS {
        return Err(AppError::invalid_input(format!(
            "read_deki_library_items accepts at most {DETAIL_MAX_ITEMS} items per call"
        )));
    }

    let mut response_items = Vec::new();
    for request in requests {
        let library_type = library_type_for(&request.item_type)?;
        let id = request.id.trim();
        if id.is_empty() {
            return Err(AppError::invalid_input("Library item id is required"));
        }
        let Some(record) = state.storage.get(library_type.entity, id)? else {
            return Err(AppError::not_found(format!(
                "{} record '{id}' was not found",
                library_type.overview_type
            )));
        };
        let mut item = Map::new();
        item.insert("type".to_string(), json!(library_type.overview_type));
        item.insert("entity".to_string(), json!(library_type.entity));
        item.insert("id".to_string(), json!(id));
        item.insert("record".to_string(), record);
        add_related_rows(state, library_type, id, &request, &mut item)?;
        response_items.push(Value::Object(item));
    }

    let response = json!({
        "items": response_items,
        "maxItemsPerCall": DETAIL_MAX_ITEMS,
        "maxPayloadBytes": DETAIL_MAX_BYTES
    });
    let payload_size = serde_json::to_vec(&response)
        .map_err(|error| AppError::new("deki_library_serialize_failed", error.to_string()))?
        .len();
    if payload_size > DETAIL_MAX_BYTES {
        return Err(AppError::invalid_input(format!(
            "Selected library records are too large for one Deki tool response ({payload_size} bytes, max {DETAIL_MAX_BYTES}). Select fewer records or page lorebook entries."
        )));
    }
    Ok(response)
}

fn selected_library_types(
    item_type: Option<String>,
    types: Vec<String>,
) -> AppResult<Vec<LibraryType>> {
    let mut requested = Vec::new();
    if let Some(item_type) = item_type {
        requested.push(item_type);
    }
    requested.extend(types);
    if requested.is_empty() {
        return Ok(LIBRARY_TYPES.to_vec());
    }

    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for raw in requested {
        let library_type = library_type_for(&raw)?;
        if seen.insert(library_type.overview_type) {
            selected.push(library_type);
        }
    }
    Ok(selected)
}

fn library_type_for(raw: &str) -> AppResult<LibraryType> {
    let normalized = normalize_type(raw);
    LIBRARY_TYPES
        .iter()
        .find(|library_type| {
            normalized == library_type.overview_type
                || normalized == normalize_type(library_type.entity)
                || normalized == normalize_type(library_type.plural)
                || library_type
                    .aliases
                    .iter()
                    .any(|alias| normalized == normalize_type(alias))
        })
        .copied()
        .ok_or_else(|| {
            AppError::invalid_input(format!(
                "Unsupported Deki library item type '{raw}'. Use character, persona, lorebook, lorebook_entry, prompt_preset, prompt_section, prompt_group, or prompt_variable."
            ))
        })
}

fn library_type_for_entity(entity: &str) -> AppResult<LibraryType> {
    LIBRARY_TYPES
        .iter()
        .find(|library_type| library_type.entity == entity)
        .copied()
        .ok_or_else(|| {
            AppError::invalid_input(format!("Unsupported Deki library entity '{entity}'"))
        })
}

fn normalize_type(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_")
        .to_string()
}

fn overview_item(
    state: &AppState,
    library_type: LibraryType,
    row: &Value,
    needle: Option<&str>,
) -> AppResult<Value> {
    let id = string_field(row, "id").unwrap_or_default();
    let name = display_name(row).unwrap_or_else(|| id.clone());
    let subtitle = first_top_level_text_field(
        row,
        &[
            "subtitle",
            "comment",
            "summary",
            "role",
            "identifier",
            "variableName",
        ],
    )
    .or_else(|| {
        row.get("data")
            .and_then(|data| first_top_level_text_field(data, &["subtitle", "comment", "summary"]))
    });
    let folder_id = first_text_field(row, &["folderId", "folder_id", "groupId", "group_id"]);
    let parent_id = parent_id_for(library_type, row);
    let stats = overview_stats(state, library_type, row, needle)?;
    Ok(json!({
        "type": library_type.overview_type,
        "entity": library_type.entity,
        "id": id,
        "name": name,
        "subtitle": subtitle,
        "folderId": folder_id,
        "parentId": parent_id,
        "stats": stats
    }))
}

fn overview_stats(
    state: &AppState,
    library_type: LibraryType,
    row: &Value,
    needle: Option<&str>,
) -> AppResult<Value> {
    let mut stats = Map::new();
    stats.insert(
        "approxBytes".to_string(),
        json!(serde_json::to_vec(row)
            .map(|bytes| bytes.len())
            .unwrap_or(0)),
    );
    let id = string_field(row, "id").unwrap_or_default();
    match library_type.overview_type {
        "lorebook" if !id.is_empty() => {
            let total = related_count(state, "lorebook-entries", "lorebookId", &id, None)?;
            let matching = related_count(state, "lorebook-entries", "lorebookId", &id, needle)?;
            stats.insert("matchingEntryCount".to_string(), json!(matching));
            stats.insert("totalEntryCount".to_string(), json!(total));
        }
        "prompt_preset" if !id.is_empty() => {
            let section_total = related_count(state, "prompt-sections", "presetId", &id, None)?;
            let group_total = related_count(state, "prompt-groups", "presetId", &id, None)?;
            let variable_total = related_count(state, "prompt-variables", "presetId", &id, None)?;
            let section_matching =
                related_count(state, "prompt-sections", "presetId", &id, needle)?;
            let group_matching = related_count(state, "prompt-groups", "presetId", &id, needle)?;
            let variable_matching =
                related_count(state, "prompt-variables", "presetId", &id, needle)?;
            stats.insert("matchingSectionCount".to_string(), json!(section_matching));
            stats.insert("totalSectionCount".to_string(), json!(section_total));
            stats.insert("matchingGroupCount".to_string(), json!(group_matching));
            stats.insert("totalGroupCount".to_string(), json!(group_total));
            stats.insert(
                "matchingVariableCount".to_string(),
                json!(variable_matching),
            );
            stats.insert("totalVariableCount".to_string(), json!(variable_total));
        }
        _ => {}
    }
    Ok(Value::Object(stats))
}

fn add_related_rows(
    state: &AppState,
    library_type: LibraryType,
    id: &str,
    request: &LibraryItemRequest,
    item: &mut Map<String, Value>,
) -> AppResult<()> {
    match library_type.overview_type {
        "lorebook" => {
            let include_entries = request.include_entries.unwrap_or(true);
            if !include_entries {
                return Err(AppError::invalid_input(
                    "Lorebook detail reads always include the entries page. Omit includeEntries or set it to true; use entryQuery, entryLimit, and entryOffset to narrow the entry page.",
                ));
            }
            let page = related_page(
                state,
                "lorebook-entries",
                "lorebookId",
                id,
                request.entry_query.as_deref(),
                request.entry_limit,
                request.entry_offset,
            )?;
            item.insert("entries".to_string(), page);
        }
        "prompt_preset" => {
            item.insert(
                "sections".to_string(),
                related_page(state, "prompt-sections", "presetId", id, None, None, None)?,
            );
            item.insert(
                "groups".to_string(),
                related_page(state, "prompt-groups", "presetId", id, None, None, None)?,
            );
            item.insert(
                "variables".to_string(),
                related_page(state, "prompt-variables", "presetId", id, None, None, None)?,
            );
        }
        _ => {}
    }
    Ok(())
}

fn related_count(
    state: &AppState,
    collection: &str,
    field: &str,
    id: &str,
    needle: Option<&str>,
) -> AppResult<usize> {
    let mut filters = Map::new();
    filters.insert(field.to_string(), json!(id));
    let library_type = library_type_for_entity(collection)?;
    state.storage.list_where(collection, &filters).map(|rows| {
        rows.into_iter()
            .filter(|row| matches_library_query(library_type, row, needle))
            .count()
    })
}

fn related_page(
    state: &AppState,
    collection: &str,
    field: &str,
    id: &str,
    query: Option<&str>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> AppResult<Value> {
    let mut filters = Map::new();
    filters.insert(field.to_string(), json!(id));
    let needle = normalized_query(query);
    let library_type = library_type_for_entity(collection)?;
    let limit = bounded_limit(limit, CHILD_DEFAULT_LIMIT, CHILD_MAX_LIMIT);
    let offset = offset.unwrap_or(0);
    let mut rows = state
        .storage
        .list_where(collection, &filters)?
        .into_iter()
        .filter(|row| matches_library_query(library_type, row, needle.as_deref()))
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        number_field(left, "position")
            .cmp(&number_field(right, "position"))
            .then_with(|| sort_string(left.get("name")).cmp(&sort_string(right.get("name"))))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });
    let total = rows.len();
    let page_rows = rows
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let page_count = page_rows.len();
    Ok(json!({
        "items": page_rows,
        "matchingTotal": total,
        "pageCount": page_count,
        "offset": offset,
        "limit": limit,
        "hasMore": offset.saturating_add(limit) < total,
        "included": true
    }))
}

fn bounded_limit(value: Option<usize>, default: usize, max: usize) -> usize {
    value.unwrap_or(default).clamp(1, max)
}

fn parent_id_for(library_type: LibraryType, row: &Value) -> Option<String> {
    match library_type.overview_type {
        "lorebook_entry" => {
            string_field(row, "lorebookId").or_else(|| string_field(row, "lorebook_id"))
        }
        "prompt_section" | "prompt_group" | "prompt_variable" => {
            string_field(row, "presetId").or_else(|| string_field(row, "preset_id"))
        }
        _ => None,
    }
}

fn display_name(row: &Value) -> Option<String> {
    first_text_field(
        row,
        &["name", "title", "identifier", "variableName", "type", "id"],
    )
}

fn first_text_field(row: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| string_field(row, key).or_else(|| string_field(row.get("data")?, key)))
}

fn first_top_level_text_field(row: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| string_field(row, key))
}

fn string_field(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn number_field(row: &Value, key: &str) -> i64 {
    row.get(key).and_then(Value::as_i64).unwrap_or(i64::MAX)
}

fn sort_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn normalized_query(query: Option<&str>) -> Option<String> {
    query
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .map(|query| query.to_ascii_lowercase())
}

fn matches_library_query(library_type: LibraryType, row: &Value, needle: Option<&str>) -> bool {
    let Some(needle) = needle else {
        return true;
    };
    searchable_library_text(library_type, row).contains(needle)
}

fn searchable_library_text(library_type: LibraryType, row: &Value) -> String {
    let mut values = Vec::new();
    for field in searchable_fields_for(library_type) {
        push_search_field(&mut values, row, field);
    }
    values.join(" ").to_ascii_lowercase()
}

#[derive(Clone, Copy)]
enum SearchField {
    Top(&'static str),
    Data(&'static str),
}

fn searchable_fields_for(library_type: LibraryType) -> &'static [SearchField] {
    match library_type.overview_type {
        "character" => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Data("name"),
            SearchField::Data("title"),
            SearchField::Data("subtitle"),
            SearchField::Data("comment"),
            SearchField::Data("summary"),
            SearchField::Data("description"),
            SearchField::Data("personality"),
            SearchField::Data("scenario"),
            SearchField::Data("backstory"),
            SearchField::Data("firstMessage"),
            SearchField::Data("systemPrompt"),
            SearchField::Data("creatorNotes"),
        ],
        "character_group" | "persona_group" => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Top("title"),
            SearchField::Top("subtitle"),
            SearchField::Top("comment"),
            SearchField::Top("summary"),
            SearchField::Top("description"),
        ],
        "prompt_group" => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Top("title"),
            SearchField::Top("subtitle"),
            SearchField::Top("comment"),
            SearchField::Top("summary"),
            SearchField::Top("description"),
        ],
        "persona" => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Data("name"),
            SearchField::Data("title"),
            SearchField::Data("subtitle"),
            SearchField::Data("comment"),
            SearchField::Data("summary"),
            SearchField::Data("description"),
            SearchField::Data("personality"),
            SearchField::Data("scenario"),
            SearchField::Data("systemPrompt"),
            SearchField::Data("prompt"),
            SearchField::Data("content"),
        ],
        "lorebook" | "prompt_preset" => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Top("title"),
            SearchField::Top("subtitle"),
            SearchField::Top("comment"),
            SearchField::Top("summary"),
            SearchField::Top("description"),
        ],
        "lorebook_entry" => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Top("comment"),
            SearchField::Top("keys"),
            SearchField::Top("content"),
        ],
        "prompt_section" => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Top("identifier"),
            SearchField::Top("comment"),
            SearchField::Top("description"),
            SearchField::Top("content"),
            SearchField::Top("prompt"),
            SearchField::Top("systemPrompt"),
        ],
        "prompt_variable" => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Top("variableName"),
            SearchField::Top("question"),
            SearchField::Top("options"),
            SearchField::Top("comment"),
            SearchField::Top("description"),
        ],
        _ => &[
            SearchField::Top("id"),
            SearchField::Top("name"),
            SearchField::Top("title"),
            SearchField::Top("subtitle"),
            SearchField::Top("comment"),
            SearchField::Top("summary"),
        ],
    }
}

fn push_search_field(values: &mut Vec<String>, row: &Value, field: &SearchField) {
    let value = match field {
        SearchField::Top(key) => row.get(key),
        SearchField::Data(key) => row.get("data").and_then(|data| data.get(key)),
    };
    let Some(value) = value else {
        return;
    };
    push_search_value(values, value);
}

fn push_search_value(values: &mut Vec<String>, value: &Value) {
    match value {
        Value::Null => {}
        Value::Bool(value) => values.push(value.to_string()),
        Value::Number(value) => values.push(value.to_string()),
        Value::String(value) => values.push(value.clone()),
        Value::Array(items) => {
            for item in items {
                match item {
                    Value::Bool(value) => values.push(value.to_string()),
                    Value::Number(value) => values.push(value.to_string()),
                    Value::String(value) => values.push(value.clone()),
                    Value::Null | Value::Array(_) | Value::Object(_) => {}
                }
            }
        }
        Value::Object(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-deki-library-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn seed_library(state: &AppState) {
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-rina",
                    "data": {
                        "name": "Rina",
                        "description": "Full character body that should not appear in overview",
                        "privateMetadata": {
                            "internalTag": "hidden-nested-marker"
                        }
                    }
                }),
            )
            .expect("seed character");
        state
            .storage
            .create(
                "lorebooks",
                json!({
                    "id": "book-pond",
                    "name": "Pond Notes",
                    "description": "Large private lorebook body"
                }),
            )
            .expect("seed lorebook");
        state
            .storage
            .create(
                "lorebook-entries",
                json!({
                    "id": "entry-koi",
                    "lorebookId": "book-pond",
                    "name": "Koi",
                    "keys": ["pond"],
                    "content": "Koi pond details"
                }),
            )
            .expect("seed lorebook entry");
        state
            .storage
            .create(
                "lorebook-entries",
                json!({
                    "id": "entry-garden",
                    "lorebookId": "book-pond",
                    "name": "Garden",
                    "keys": ["garden"],
                    "content": "Garden details"
                }),
            )
            .expect("seed lorebook entry");
        state
            .storage
            .create(
                "prompts",
                json!({
                    "id": "prompt-main",
                    "name": "Main Preset"
                }),
            )
            .expect("seed prompt");
        state
            .storage
            .create(
                "prompt-sections",
                json!({
                    "id": "section-main",
                    "presetId": "prompt-main",
                    "name": "System",
                    "content": "Full prompt section"
                }),
            )
            .expect("seed prompt section");
    }

    #[test]
    fn overview_returns_metadata_without_full_bodies() {
        let state = test_state("overview");
        seed_library(&state);

        let result = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("character".to_string()),
                types: Vec::new(),
                query: Some("rina".to_string()),
                limit: None,
                offset: None,
            },
        )
        .expect("overview should succeed");

        assert!(result.get("total").is_none());
        assert_eq!(result["matchingTotal"], json!(1));
        assert_eq!(result["pageCount"], json!(1));
        assert_eq!(result["items"][0]["type"], json!("character"));
        assert_eq!(result["items"][0]["name"], json!("Rina"));
        let serialized = serde_json::to_string(&result).expect("serialize overview");
        assert!(!serialized.contains("Full character body"));
    }

    #[test]
    fn overview_reports_related_counts() {
        let state = test_state("overview-counts");
        seed_library(&state);

        let result = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("lorebook".to_string()),
                types: Vec::new(),
                query: None,
                limit: None,
                offset: None,
            },
        )
        .expect("overview should succeed");

        assert_eq!(result["items"][0]["stats"]["matchingEntryCount"], json!(2));
        assert_eq!(result["items"][0]["stats"]["totalEntryCount"], json!(2));
    }

    #[test]
    fn overview_reports_total_matches_and_page_count_separately() {
        let state = test_state("overview-pagination");
        seed_library(&state);
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-zed",
                    "data": {
                        "name": "Zed"
                    }
                }),
            )
            .expect("seed character");

        let result = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("character".to_string()),
                types: Vec::new(),
                query: None,
                limit: Some(1),
                offset: Some(1),
            },
        )
        .expect("overview should succeed");

        assert!(result.get("total").is_none());
        assert_eq!(result["matchingTotal"], json!(2));
        assert_eq!(result["pageCount"], json!(1));
        assert_eq!(result["pagination"]["matchingTotal"], json!(2));
        assert_eq!(result["pagination"]["pageCount"], json!(1));
        assert_eq!(result["items"].as_array().unwrap().len(), 1);
        assert_eq!(
            result["contract"]["countSemantics"],
            json!("matchingTotal is the full number of matching overview rows before pagination. pageCount is the number of rows returned in items. No ambiguous total field is returned.")
        );
    }

    #[test]
    fn overview_searches_whitelisted_user_facing_fields_only() {
        let state = test_state("overview-search");
        seed_library(&state);

        let lorebook_entry = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("lorebook_entry".to_string()),
                types: Vec::new(),
                query: Some("Koi pond details".to_string()),
                limit: None,
                offset: None,
            },
        )
        .expect("lorebook entry content should be searchable");
        assert_eq!(lorebook_entry["matchingTotal"], json!(1));
        assert_eq!(lorebook_entry["items"][0]["id"], json!("entry-koi"));

        let prompt_section = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("prompt_section".to_string()),
                types: Vec::new(),
                query: Some("Full prompt section".to_string()),
                limit: None,
                offset: None,
            },
        )
        .expect("prompt section content should be searchable");
        assert_eq!(prompt_section["matchingTotal"], json!(1));
        assert_eq!(prompt_section["items"][0]["id"], json!("section-main"));

        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-nested",
                    "data": {
                        "name": "Nested Character",
                        "description": {
                            "hidden": "hidden-description-object-marker"
                        }
                    }
                }),
            )
            .expect("seed nested description character");
        let nested_metadata = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("character".to_string()),
                types: Vec::new(),
                query: Some("hidden-description-object-marker".to_string()),
                limit: None,
                offset: None,
            },
        )
        .expect("overview should ignore object values under searchable fields");
        assert_eq!(nested_metadata["matchingTotal"], json!(0));
    }

    #[test]
    fn overview_parent_counts_follow_active_query() {
        let state = test_state("overview-filtered-counts");
        seed_library(&state);

        let lorebook = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("lorebook".to_string()),
                types: Vec::new(),
                query: Some("pond".to_string()),
                limit: None,
                offset: None,
            },
        )
        .expect("lorebook overview should succeed");
        assert_eq!(
            lorebook["items"][0]["stats"]["matchingEntryCount"],
            json!(1)
        );
        assert_eq!(lorebook["items"][0]["stats"]["totalEntryCount"], json!(2));

        let preset = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("prompt_preset".to_string()),
                types: Vec::new(),
                query: Some("Preset".to_string()),
                limit: None,
                offset: None,
            },
        )
        .expect("prompt preset overview should succeed");
        let prompt_main = preset["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == json!("prompt-main"))
            .expect("prompt-main should be returned");
        assert_eq!(prompt_main["stats"]["matchingSectionCount"], json!(0));
        assert_eq!(prompt_main["stats"]["totalSectionCount"], json!(1));
    }

    #[test]
    fn overview_accepts_user_facing_type_aliases() {
        let state = test_state("overview-aliases");
        seed_library(&state);

        let result = overview(
            &state,
            LibraryOverviewQuery {
                item_type: Some("presets".to_string()),
                types: vec!["promptSections".to_string()],
                query: Some("prompt".to_string()),
                limit: None,
                offset: None,
            },
        )
        .expect("overview should accept aliases");

        assert_eq!(result["matchingTotal"], json!(2));
        assert!(result["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["type"] == json!("prompt_preset")));
        assert!(result["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["type"] == json!("prompt_section")));
    }

    #[test]
    fn items_includes_lorebook_entries_by_default() {
        let state = test_state("items-lorebook-default");
        seed_library(&state);

        let result = items(
            &state,
            vec![LibraryItemRequest {
                item_type: "lorebook".to_string(),
                id: "book-pond".to_string(),
                include_entries: None,
                entry_query: None,
                entry_limit: None,
                entry_offset: None,
            }],
        )
        .expect("selected lorebook should read");

        assert_eq!(result["items"][0]["entries"]["included"], json!(true));
        assert_eq!(result["items"][0]["entries"]["matchingTotal"], json!(2));
    }

    #[test]
    fn items_returns_selected_record_and_paged_lorebook_entries() {
        let state = test_state("items-lorebook");
        seed_library(&state);

        let result = items(
            &state,
            vec![LibraryItemRequest {
                item_type: "lorebook".to_string(),
                id: "book-pond".to_string(),
                include_entries: Some(true),
                entry_query: Some("koi".to_string()),
                entry_limit: Some(1),
                entry_offset: None,
            }],
        )
        .expect("selected items should read");

        assert_eq!(result["items"][0]["record"]["name"], json!("Pond Notes"));
        assert_eq!(result["items"][0]["entries"]["matchingTotal"], json!(1));
        assert_eq!(
            result["items"][0]["entries"]["items"][0]["id"],
            json!("entry-koi")
        );
    }

    #[test]
    fn items_returns_prompt_children_for_selected_preset() {
        let state = test_state("items-prompt");
        seed_library(&state);

        let result = items(
            &state,
            vec![LibraryItemRequest {
                item_type: "prompt_preset".to_string(),
                id: "prompt-main".to_string(),
                include_entries: None,
                entry_query: None,
                entry_limit: None,
                entry_offset: None,
            }],
        )
        .expect("selected prompt should read");

        assert_eq!(result["items"][0]["record"]["name"], json!("Main Preset"));
        assert_eq!(result["items"][0]["sections"]["matchingTotal"], json!(1));
        assert_eq!(
            result["items"][0]["sections"]["items"][0]["id"],
            json!("section-main")
        );
    }

    #[test]
    fn items_rejects_too_many_selections() {
        let state = test_state("items-limit");
        let requests = (0..=DETAIL_MAX_ITEMS)
            .map(|index| LibraryItemRequest {
                item_type: "character".to_string(),
                id: format!("char-{index}"),
                include_entries: None,
                entry_query: None,
                entry_limit: None,
                entry_offset: None,
            })
            .collect();

        let error = items(&state, requests).expect_err("too many selections should reject");

        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn items_rejects_lorebook_detail_without_entries() {
        let state = test_state("items-lorebook-reject-partial");
        seed_library(&state);

        let error = items(
            &state,
            vec![LibraryItemRequest {
                item_type: "lorebook".to_string(),
                id: "book-pond".to_string(),
                include_entries: Some(false),
                entry_query: None,
                entry_limit: None,
                entry_offset: None,
            }],
        )
        .expect_err("lorebook detail without entries should reject");

        assert_eq!(error.code, "invalid_input");
    }
}
