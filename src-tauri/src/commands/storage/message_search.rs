//! Text search over saved chat messages, newest first, for the chat sidebar.
//!
//! The messages collection is one JSON array with no text index, so a search visits every row once
//! through the storage row visitor (borrowed in place when cached, parsed one row at a time when not)
//! and keeps only the newest `limit` matches.

use super::*;
use std::collections::{HashMap, HashSet};

const MAX_QUERY_CHARS: usize = 200;
const MAX_TERMS: usize = 8;
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 100;
const SNIPPET_BEFORE: usize = 40;
const SNIPPET_AFTER: usize = 120;
const SEARCHABLE_MODES: [&str; 3] = ["conversation", "roleplay", "fanfic"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MessageSnippet {
    pub(crate) text: String,
    /// Character offsets of each matched term inside `text`, as (start, length).
    pub(crate) highlights: Vec<(usize, usize)>,
}

/// Lowercased query terms; every term must appear for a message to match.
pub(crate) fn query_terms(query: &str) -> Vec<Vec<char>> {
    let mut seen = HashSet::new();
    query
        .split_whitespace()
        .map(|term| {
            term.chars()
                .flat_map(char::to_lowercase)
                .collect::<Vec<_>>()
        })
        .filter(|term| !term.is_empty() && seen.insert(term.clone()))
        .take(MAX_TERMS)
        .collect()
}

/// Matches `content` against every term (case-insensitive) and returns a snippet around the first hit.
pub(crate) fn match_message(content: &str, terms: &[Vec<char>]) -> Option<MessageSnippet> {
    if terms.is_empty() {
        return None;
    }
    let original = content.chars().collect::<Vec<_>>();
    // Lowercasing can turn one char into several; keep each lowered char's original index.
    let mut lowered = Vec::with_capacity(original.len());
    let mut origin = Vec::with_capacity(original.len());
    for (index, ch) in original.iter().enumerate() {
        for lower in ch.to_lowercase() {
            lowered.push(lower);
            origin.push(index);
        }
    }
    let mut hits = Vec::with_capacity(terms.len());
    for term in terms {
        let at = find_chars(&lowered, term)?;
        let start = origin[at];
        let end = origin[at + term.len() - 1] + 1;
        hits.push((start, end));
    }
    let first = hits.iter().map(|(start, _)| *start).min().unwrap_or(0);
    let window_start = snap_to_word_start(&original, first.saturating_sub(SNIPPET_BEFORE));
    let window_end = snap_to_word_end(&original, (first + SNIPPET_AFTER).min(original.len()));
    let prefix = if window_start > 0 { "…" } else { "" };
    let suffix = if window_end < original.len() {
        "…"
    } else {
        ""
    };
    let body = original[window_start..window_end]
        .iter()
        .map(|ch| if ch.is_whitespace() { ' ' } else { *ch })
        .collect::<String>();
    let offset = prefix.chars().count();
    let mut highlights = hits
        .into_iter()
        .filter(|(start, end)| *start >= window_start && *end <= window_end)
        .map(|(start, end)| (start - window_start + offset, end - start))
        .collect::<Vec<_>>();
    highlights.sort_unstable();
    Some(MessageSnippet {
        text: format!("{prefix}{body}{suffix}"),
        highlights,
    })
}

fn find_chars(haystack: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn snap_to_word_start(chars: &[char], index: usize) -> usize {
    if index == 0 {
        return 0;
    }
    // Move forward to the next word start, but never past more than a short word.
    let limit = (index + 12).min(chars.len());
    (index..limit)
        .find(|&i| chars[i - 1].is_whitespace() && !chars[i].is_whitespace())
        .unwrap_or(index)
}

fn snap_to_word_end(chars: &[char], index: usize) -> usize {
    if index >= chars.len() {
        return chars.len();
    }
    let limit = (index + 12).min(chars.len());
    (index..limit)
        .find(|&i| chars[i].is_whitespace())
        .unwrap_or(index)
}

fn bounded_limit(body: &Map<String, Value>) -> AppResult<usize> {
    match body.get("limit") {
        None | Some(Value::Null) => Ok(DEFAULT_LIMIT),
        Some(value) => {
            let limit = value
                .as_u64()
                .ok_or_else(|| AppError::invalid_input("limit must be a positive integer"))?
                as usize;
            if limit == 0 || limit > MAX_LIMIT {
                return Err(AppError::invalid_input(format!(
                    "limit must be between 1 and {MAX_LIMIT}"
                )));
            }
            Ok(limit)
        }
    }
}

fn row_str<'a>(row: &'a Value, key: &str) -> &'a str {
    row.get(key).and_then(Value::as_str).unwrap_or("")
}

struct ChatInfo {
    name: String,
    mode: String,
}

struct Hit {
    created_at: String,
    message_id: String,
    chat_id: String,
    role: String,
    character_id: Option<String>,
    snippet: MessageSnippet,
}

/// `chat_messages_search`: `{ query, mode?, chatId?, limit? }` ->
/// `{ results: [...], totalMatches, truncated }`, newest match first.
pub(crate) fn search_messages(state: &AppState, body: Value) -> AppResult<Value> {
    let body = marinara_core::ensure_object(body)?;
    let query = body
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if query.is_empty() {
        return Err(AppError::invalid_input("query is required"));
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(AppError::invalid_input(format!(
            "query must be at most {MAX_QUERY_CHARS} characters"
        )));
    }
    let mode = body
        .get("mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(mode) = mode {
        if !SEARCHABLE_MODES.contains(&mode) {
            return Err(AppError::invalid_input(format!("unsupported mode: {mode}")));
        }
    }
    let only_chat = body
        .get("chatId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let limit = bounded_limit(&body)?;
    let terms = query_terms(query);

    let mut chats = HashMap::<String, ChatInfo>::new();
    state.storage.visit_collection_rows("chats", &mut |chat| {
        let id = row_str(chat, "id");
        let chat_mode = row_str(chat, "mode");
        if id.is_empty()
            || only_chat.is_some_and(|wanted| wanted != id)
            || mode.is_some_and(|wanted| wanted != chat_mode)
            || !SEARCHABLE_MODES.contains(&chat_mode)
        {
            return Ok(());
        }
        chats.insert(
            id.to_string(),
            ChatInfo {
                name: row_str(chat, "name").to_string(),
                mode: chat_mode.to_string(),
            },
        );
        Ok(())
    })?;

    let mut total_matches = 0usize;
    // Oldest-first; index 0 is the replacement threshold once `limit` hits are held.
    let mut hits: Vec<Hit> = Vec::with_capacity(limit);
    if !chats.is_empty() {
        state
            .storage
            .visit_collection_rows("messages", &mut |message| {
                let chat_id = row_str(message, "chatId");
                if !chats.contains_key(chat_id) {
                    return Ok(());
                }
                let role = row_str(message, "role");
                if role != "user" && role != "assistant" && role != "narrator" {
                    return Ok(());
                }
                let Some(snippet) = match_message(row_str(message, "content"), &terms) else {
                    return Ok(());
                };
                total_matches += 1;
                let created_at = row_str(message, "createdAt");
                let message_id = row_str(message, "id");
                if hits.len() == limit
                    && (created_at, message_id)
                        <= (hits[0].created_at.as_str(), hits[0].message_id.as_str())
                {
                    return Ok(());
                }
                let hit = Hit {
                    created_at: created_at.to_string(),
                    message_id: message_id.to_string(),
                    chat_id: chat_id.to_string(),
                    role: role.to_string(),
                    character_id: message
                        .get("characterId")
                        .and_then(Value::as_str)
                        .filter(|id| !id.trim().is_empty())
                        .map(ToOwned::to_owned),
                    snippet,
                };
                if hits.len() == limit {
                    hits[0] = hit;
                } else {
                    hits.push(hit);
                }
                hits.sort_by(|left, right| {
                    (left.created_at.as_str(), left.message_id.as_str())
                        .cmp(&(right.created_at.as_str(), right.message_id.as_str()))
                });
                Ok(())
            })?;
    }

    let results = hits
        .into_iter()
        .rev()
        .map(|hit| {
            let chat = chats.get(&hit.chat_id);
            json!({
                "chatId": hit.chat_id,
                "chatName": chat.map(|chat| chat.name.as_str()).unwrap_or(""),
                "chatMode": chat.map(|chat| chat.mode.as_str()).unwrap_or(""),
                "messageId": hit.message_id,
                "role": hit.role,
                "characterId": hit.character_id,
                "createdAt": hit.created_at,
                "snippet": hit.snippet.text,
                "highlights": hit
                    .snippet
                    .highlights
                    .iter()
                    .map(|(start, length)| json!([start, length]))
                    .collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    let returned = results.len();
    Ok(json!({
        "results": results,
        "totalMatches": total_matches,
        "truncated": total_matches > returned,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippet(content: &str, query: &str) -> Option<MessageSnippet> {
        match_message(content, &query_terms(query))
    }

    #[test]
    fn every_term_must_match_in_any_case() {
        assert!(snippet("The Lighthouse keeper waved", "lighthouse WAVED").is_some());
        assert!(snippet("The Lighthouse keeper waved", "lighthouse ship").is_none());
    }

    #[test]
    fn highlights_point_at_the_original_text_after_case_folding() {
        // "İ" lowercases to two chars; the highlight must still cover the original word.
        let found = snippet("İstanbul trip with Mira", "mira").unwrap();
        let chars = found.text.chars().collect::<Vec<_>>();
        let (start, length) = found.highlights[0];
        assert_eq!(
            chars[start..start + length].iter().collect::<String>(),
            "Mira"
        );
    }

    #[test]
    fn long_messages_get_a_trimmed_window_around_the_first_hit() {
        let long = format!("{} needle {}", "hay ".repeat(80), "straw ".repeat(80));
        let found = snippet(&long, "needle").unwrap();
        assert!(found.text.starts_with('…') && found.text.ends_with('…'));
        assert!(found.text.chars().count() < 200);
        let chars = found.text.chars().collect::<Vec<_>>();
        let (start, length) = found.highlights[0];
        assert_eq!(
            chars[start..start + length].iter().collect::<String>(),
            "needle"
        );
    }
}
