//! Which lorebooks and entries a character card export carries.
//!
//! A card uses its own embedded lorebook plus any shared lorebook that lists
//! the character in `characterIds` (or names it as `characterId`). Shared
//! books often scope entries to some of their characters, so each entry is
//! checked against this character before it is written into the card.

use super::*;

/// The character's own embedded lorebook first, then shared lorebooks linked
/// to it, in a stable name order. Disabled shared lorebooks are left out
/// because chats never use them.
pub(super) fn linked_character_lorebooks(
    state: &AppState,
    character_id: &str,
    source: &Value,
) -> AppResult<Vec<Value>> {
    let mut books = Vec::new();
    let embedded_id = linked_embedded_lorebook_id(state, character_id, source)?;
    if let Some(id) = embedded_id.as_deref() {
        if let Some(book) = state.storage.get("lorebooks", id)? {
            books.push(book);
        }
    }
    let mut shared = state
        .storage
        .list("lorebooks")?
        .into_iter()
        .filter(|book| {
            let id = book.get("id").and_then(Value::as_str);
            id.is_some()
                && id != embedded_id.as_deref()
                && book.get("enabled").and_then(Value::as_bool) != Some(false)
                && shares_lorebook_with_character(book, character_id)
        })
        .collect::<Vec<_>>();
    shared.sort_by(|left, right| {
        let key = |book: &Value| {
            (
                book.get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_lowercase(),
                book.get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            )
        };
        key(left).cmp(&key(right))
    });
    books.extend(shared);
    Ok(books)
}

fn shares_lorebook_with_character(book: &Value, character_id: &str) -> bool {
    book.get("characterId").and_then(Value::as_str) == Some(character_id)
        || string_array_for_export(book.get("characterIds"))
            .iter()
            .any(|id| id == character_id)
}

/// Mirrors the character id and tag filters in
/// `src/engine/generation-core/lorebooks/keyword-scanner.ts` for a chat with
/// only this character in it. Generation-trigger filters have no card
/// equivalent and are not applied.
pub(super) fn entry_visible_to_character(
    entry: &Value,
    character_id: &str,
    character_tags: &HashSet<String>,
) -> bool {
    let ids = HashSet::from([normalize_filter_value(character_id)]);
    passes_value_filter(
        entry.get("characterFilterMode"),
        entry.get("characterFilterIds"),
        &ids,
    ) && passes_value_filter(
        entry.get("characterTagFilterMode"),
        entry.get("characterTagFilters"),
        character_tags,
    )
}

pub(super) fn character_filter_tags(source: &Value) -> HashSet<String> {
    string_array_for_export(source.get("tags"))
        .iter()
        .map(|tag| normalize_filter_value(tag))
        .filter(|tag| !tag.is_empty())
        .collect()
}

fn passes_value_filter(
    mode: Option<&Value>,
    filters: Option<&Value>,
    active: &HashSet<String>,
) -> bool {
    let mode = mode.and_then(Value::as_str).unwrap_or("any");
    let filters = string_array_for_export(filters)
        .iter()
        .map(|value| normalize_filter_value(value))
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    if mode == "any" || filters.is_empty() {
        return true;
    }
    let matched = filters.iter().any(|value| active.contains(value));
    if mode == "include" {
        matched
    } else {
        !matched
    }
}

fn normalize_filter_value(value: &str) -> String {
    value.trim().to_lowercase()
}
