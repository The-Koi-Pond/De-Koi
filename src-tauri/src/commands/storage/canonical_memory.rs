use crate::state::AppState;
use marinara_core::{new_id, AppError, AppResult};
use serde_json::{json, Map, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

const MEMORY_COLLECTION: &str = "canonical-memories";
const INDEX_COLLECTION: &str = "memory-index-rows";
const LEXICAL_PROVIDER: &str = "lexical";
const LEXICAL_MODEL: &str = "de-koi-lexical-v1";
const LEXICAL_DIMENSIONS: usize = 64;
const MAX_BATCH_QUERIES: usize = 16;

const MEMORY_KINDS: &[&str] = &[
    "episode",
    "fact",
    "scene_event",
    "relationship_state",
    "preference",
    "promise",
    "plot_state",
    "contradiction",
    "lore",
    "summary",
];
const MEMORY_STATUSES: &[&str] = &["active", "superseded", "stale", "pinned", "deleted"];
const MEMORY_SCOPES: &[&str] = &["user", "character", "chat", "scene", "world", "agent"];
const INDEX_INVALIDATING_FIELDS: &[&str] = &[
    "kind",
    "status",
    "scope",
    "content",
    "confidence",
    "provenance",
    "title",
    "tags",
    "payload",
    "supersedesMemoryId",
    "supersededByMemoryId",
];

fn read_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn require_string(object: &Map<String, Value>, key: &str) -> AppResult<String> {
    let value = read_string(object.get(key));
    if value.is_empty() {
        return Err(AppError::invalid_input(format!("memory {key} is required")));
    }
    Ok(value)
}

fn normalize_string_enum(
    object: &mut Map<String, Value>,
    key: &str,
    allowed: &[&str],
) -> AppResult<String> {
    let value = require_string(object, key)?;
    if !allowed.contains(&value.as_str()) {
        return Err(AppError::invalid_input(format!(
            "Unsupported memory {key}: {value}"
        )));
    }
    object.insert(key.to_string(), Value::String(value.clone()));
    Ok(value)
}

fn normalize_optional_string(object: &mut Map<String, Value>, key: &str) {
    if !object.contains_key(key) {
        return;
    }
    let value = read_string(object.get(key));
    object.insert(
        key.to_string(),
        if value.is_empty() {
            Value::Null
        } else {
            Value::String(value)
        },
    );
}

fn normalize_string_array(object: &mut Map<String, Value>, key: &str) -> AppResult<()> {
    match object.get(key) {
        None | Some(Value::Null) => {
            object.insert(key.to_string(), Value::Array(Vec::new()));
            Ok(())
        }
        Some(Value::Array(values)) => {
            let mut normalized = Vec::new();
            for value in values {
                let Some(text) = value.as_str() else {
                    return Err(AppError::invalid_input(format!(
                        "memory {key} must contain strings"
                    )));
                };
                let text = text.trim();
                if !text.is_empty() {
                    normalized.push(Value::String(text.to_string()));
                }
            }
            object.insert(key.to_string(), Value::Array(normalized));
            Ok(())
        }
        _ => Err(AppError::invalid_input(format!(
            "memory {key} must be an array"
        ))),
    }
}

fn normalize_scope(value: Option<&Value>) -> AppResult<Value> {
    let Some(scope) = value.and_then(Value::as_object) else {
        return Err(AppError::invalid_input("memory scope is required"));
    };
    let kind = read_string(scope.get("kind"));
    let id = read_string(scope.get("id"));
    if !MEMORY_SCOPES.contains(&kind.as_str()) {
        return Err(AppError::invalid_input(format!(
            "Unsupported memory scope: {kind}"
        )));
    }
    if id.is_empty() {
        return Err(AppError::invalid_input("memory scope.id is required"));
    }
    Ok(json!({ "kind": kind, "id": id }))
}

fn normalize_provenance(value: Option<&Value>) -> AppResult<Value> {
    let mut provenance = value
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for key in ["sourceChatId", "sceneId", "characterId", "timestamp"] {
        normalize_optional_string(&mut provenance, key);
    }
    normalize_string_array(&mut provenance, "messageIds")?;
    Ok(Value::Object(provenance))
}

fn normalize_memory_record(mut object: Map<String, Value>, for_create: bool) -> AppResult<Value> {
    normalize_string_enum(&mut object, "kind", MEMORY_KINDS)?;
    if !object.contains_key("status") {
        object.insert("status".to_string(), Value::String("active".to_string()));
    }
    normalize_string_enum(&mut object, "status", MEMORY_STATUSES)?;
    object.insert("scope".to_string(), normalize_scope(object.get("scope"))?);
    object.insert(
        "content".to_string(),
        Value::String(require_string(&object, "content")?),
    );
    let confidence = object
        .get("confidence")
        .and_then(Value::as_f64)
        .ok_or_else(|| {
            AppError::invalid_input("memory confidence must be a number between 0 and 1")
        })?;
    if !(0.0..=1.0).contains(&confidence) {
        return Err(AppError::invalid_input(
            "memory confidence must be between 0 and 1",
        ));
    }
    object.insert("confidence".to_string(), json!(confidence));
    object.insert(
        "provenance".to_string(),
        normalize_provenance(object.get("provenance"))?,
    );
    normalize_string_array(&mut object, "tags")?;
    normalize_optional_string(&mut object, "title");
    normalize_optional_string(&mut object, "supersedesMemoryId");
    normalize_optional_string(&mut object, "supersededByMemoryId");
    if !object.contains_key("payload") || object.get("payload") == Some(&Value::Null) {
        object.insert("payload".to_string(), json!({}));
    }
    if !object.get("payload").is_some_and(Value::is_object) {
        return Err(AppError::invalid_input("memory payload must be an object"));
    }
    if for_create && !object.contains_key("id") {
        object.insert("id".to_string(), Value::String(new_id()));
    }
    Ok(Value::Object(object))
}

fn merge_patch(current: &Value, patch: Value) -> AppResult<Value> {
    let mut object = current
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::invalid_input("Stored memory is not an object"))?;
    for (key, value) in marinara_core::ensure_object(patch)? {
        object.insert(key, value);
    }
    Ok(Value::Object(object))
}

fn scope_matches(memory: &Value, scope: Option<&Value>) -> bool {
    let Some(scope) = scope.and_then(Value::as_object) else {
        return true;
    };
    memory.get("scope") == Some(&Value::Object(scope.clone()))
}

fn statuses_from_query(body: &Value) -> HashSet<String> {
    if body.get("includeInactive").and_then(Value::as_bool) == Some(true) {
        return MEMORY_STATUSES
            .iter()
            .map(|status| status.to_string())
            .collect();
    }
    if let Some(statuses) = body.get("statuses").and_then(Value::as_array) {
        return statuses
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect();
    }
    ["active".to_string(), "pinned".to_string()]
        .into_iter()
        .collect()
}

fn memory_allowed_by_query(memory: &Value, body: &Value) -> bool {
    let statuses = statuses_from_query(body);
    let status = memory
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    statuses.contains(status) && scope_matches(memory, body.get("scope"))
}

fn batch_queries(body: Value) -> AppResult<Vec<Value>> {
    let body = marinara_core::ensure_object(body)?;
    let queries = body
        .get("queries")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::invalid_input("memory batch queries must be an array"))?;
    if queries.len() > MAX_BATCH_QUERIES {
        return Err(AppError::invalid_input(format!(
            "memory batch queries may include at most {MAX_BATCH_QUERIES} scopes"
        )));
    }
    queries
        .iter()
        .cloned()
        .map(|query| {
            if query.is_object() {
                Ok(query)
            } else {
                Err(AppError::invalid_input("memory batch query entries must be objects"))
            }
        })
        .collect()
}

pub(crate) fn create_memory(state: &AppState, body: Value) -> AppResult<Value> {
    let record = normalize_memory_record(marinara_core::ensure_object(body)?, true)?;
    state.storage.create(MEMORY_COLLECTION, record)
}

pub(crate) fn get_memory(state: &AppState, memory_id: &str) -> AppResult<Value> {
    state
        .storage
        .get(MEMORY_COLLECTION, memory_id)?
        .ok_or_else(|| AppError::not_found(format!("canonical memory {memory_id} was not found")))
}

pub(crate) fn update_memory(state: &AppState, memory_id: &str, patch: Value) -> AppResult<Value> {
    let patch_object = marinara_core::ensure_object(patch.clone())?;
    let current = get_memory(state, memory_id)?;
    let normalized = normalize_memory_record(
        marinara_core::ensure_object(merge_patch(&current, patch)?)?,
        false,
    )?;
    let normalized_object = normalized.as_object().cloned().unwrap_or_default();
    let mut write_patch = Map::new();
    for key in patch_object.keys() {
        if let Some(value) = normalized_object.get(key) {
            write_patch.insert(key.clone(), value.clone());
        }
    }
    let updated = state
        .storage
        .patch(MEMORY_COLLECTION, memory_id, Value::Object(write_patch))?;
    if patch_object
        .keys()
        .any(|key| INDEX_INVALIDATING_FIELDS.contains(&key.as_str()))
    {
        delete_memory_index_rows_for_memory(state, memory_id)?;
    }
    Ok(updated)
}

pub(crate) fn delete_memory(state: &AppState, memory_id: &str) -> AppResult<Value> {
    let deleted = update_memory(state, memory_id, json!({ "status": "deleted" }))?;
    delete_memory_index_rows_for_memory(state, memory_id)?;
    Ok(deleted)
}

pub(crate) fn soft_delete_memories_for_scope(
    state: &AppState,
    scope_kind: &str,
    scope_id: &str,
) -> AppResult<usize> {
    let scope_kind = scope_kind.trim();
    let scope_id = scope_id.trim();
    if scope_kind.is_empty() || scope_id.is_empty() {
        return Ok(0);
    }
    let memory_ids = state
        .storage
        .list(MEMORY_COLLECTION)?
        .into_iter()
        .filter(|memory| {
            let Some(scope) = memory.get("scope").and_then(Value::as_object) else {
                return false;
            };
            read_string(scope.get("kind")) == scope_kind
                && read_string(scope.get("id")) == scope_id
                && read_string(memory.get("status")) != "deleted"
        })
        .filter_map(|memory| {
            let memory_id = read_string(memory.get("id"));
            (!memory_id.is_empty()).then_some(memory_id)
        })
        .collect::<Vec<_>>();
    for memory_id in &memory_ids {
        delete_memory(state, memory_id)?;
    }
    Ok(memory_ids.len())
}

pub(crate) fn query_memories(state: &AppState, body: Value) -> AppResult<Value> {
    let body = if body.is_null() { json!({}) } else { body };
    if !body.is_object() {
        return Err(AppError::invalid_input(
            "memory query body must be an object",
        ));
    }
    let mut memories = state.storage.list(MEMORY_COLLECTION)?;
    memories.retain(|memory| memory_allowed_by_query(memory, &body));
    Ok(Value::Array(memories))
}

pub(crate) fn query_memories_batch(state: &AppState, body: Value) -> AppResult<Value> {
    let queries = batch_queries(body)?;
    if queries.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let memories = state
        .storage
        .list(MEMORY_COLLECTION)?
        .into_iter()
        .filter(|memory| queries.iter().any(|query| memory_allowed_by_query(memory, query)))
        .collect();
    Ok(Value::Array(memories))
}

fn normalize_index_row(state: &AppState, mut object: Map<String, Value>) -> AppResult<Value> {
    let memory_id = require_string(&object, "memoryId")?;
    let memory = get_memory(state, &memory_id)?;
    let provider = require_string(&object, "provider")?;
    let model = require_string(&object, "model")?;
    let dimensions = object
        .get("dimensions")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            AppError::invalid_input("memory index dimensions must be a positive integer")
        })?;
    if dimensions == 0 {
        return Err(AppError::invalid_input(
            "memory index dimensions must be positive",
        ));
    }
    require_string(&object, "contentHash")?;
    let projection_hash = require_string(&object, "projectionHash")?;
    require_string(&object, "canonicalUpdatedAt")?;
    if !object.get("vector").is_some_and(Value::is_array)
        && !object.get("lexicalTokens").is_some_and(Value::is_array)
    {
        return Err(AppError::invalid_input(
            "memory index row must contain vector or lexicalTokens",
        ));
    }
    if !object.contains_key("id") {
        object.insert(
            "id".to_string(),
            Value::String(format!("{memory_id}:{provider}:{model}:{projection_hash}")),
        );
    }
    object.insert("memoryId".to_string(), Value::String(memory_id));
    let _ = memory;
    Ok(Value::Object(object))
}

pub(crate) fn upsert_memory_index_row(state: &AppState, row: Value) -> AppResult<Value> {
    let normalized = normalize_index_row(state, marinara_core::ensure_object(row)?)?;
    let id = read_string(normalized.get("id"));
    state
        .storage
        .upsert_with_id(INDEX_COLLECTION, &id, normalized)
}

fn memory_scope_matches_chat(memory: &Value, chat_id: &str) -> bool {
    let Some(scope) = memory.get("scope").and_then(Value::as_object) else {
        return false;
    };
    read_string(scope.get("kind")) == "chat" && read_string(scope.get("id")) == chat_id
}

pub(crate) fn delete_memory_index_rows_for_chat(
    state: &AppState,
    chat_id: &str,
) -> AppResult<Value> {
    let chat_id = chat_id.trim();
    if chat_id.is_empty() {
        return Ok(json!({ "deleted": 0 }));
    }
    let memory_ids = state
        .storage
        .list(MEMORY_COLLECTION)?
        .into_iter()
        .filter(|memory| memory_scope_matches_chat(memory, chat_id))
        .filter_map(|memory| {
            let memory_id = read_string(memory.get("id"));
            (!memory_id.is_empty()).then_some(memory_id)
        })
        .collect::<HashSet<_>>();
    if memory_ids.is_empty() {
        return Ok(json!({ "deleted": 0 }));
    }
    let deleted = state
        .storage
        .delete_where_matching(INDEX_COLLECTION, |row| {
            row.get("memoryId")
                .and_then(Value::as_str)
                .is_some_and(|memory_id| memory_ids.contains(memory_id))
        })?;
    Ok(json!({ "deleted": deleted }))
}
pub(crate) fn delete_memory_index_rows_for_memory(
    state: &AppState,
    memory_id: &str,
) -> AppResult<Value> {
    let deleted = state
        .storage
        .delete_where_matching(INDEX_COLLECTION, |row| {
            row.get("memoryId").and_then(Value::as_str) == Some(memory_id)
        })?;
    Ok(json!({ "deleted": deleted }))
}

fn lexical_tokens(content: &str) -> Vec<String> {
    content
        .split(|character: char| !character.is_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|token| token.len() > 2)
        .collect()
}

fn stable_hash(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn lexical_vector(tokens: &[String]) -> Vec<f64> {
    let mut vector = vec![0.0; LEXICAL_DIMENSIONS];
    for token in tokens {
        let mut hasher = DefaultHasher::new();
        token.hash(&mut hasher);
        let index = (hasher.finish() as usize) % LEXICAL_DIMENSIONS;
        vector[index] += 1.0;
    }
    vector
}

pub(crate) fn rebuild_memory_lexical_index(state: &AppState, body: Value) -> AppResult<Value> {
    let memories = query_memories(state, body)?;
    let rows = match memories {
        Value::Array(rows) => rows,
        _ => Vec::new(),
    };
    let mut rebuilt = 0usize;
    for memory in rows {
        let memory_id = read_string(memory.get("id"));
        if memory_id.is_empty() {
            continue;
        }
        delete_memory_index_rows_for_memory(state, &memory_id)?;
        let content = read_string(memory.get("content"));
        let tokens = lexical_tokens(&content);
        let projection_hash = stable_hash(&format!("{}:{}", memory_id, tokens.join(" ")));
        upsert_memory_index_row(
            state,
            json!({
                "id": format!("{memory_id}:lexical:{projection_hash}"),
                "memoryId": memory_id,
                "provider": LEXICAL_PROVIDER,
                "model": LEXICAL_MODEL,
                "dimensions": LEXICAL_DIMENSIONS,
                "contentHash": stable_hash(&content),
                "projectionHash": projection_hash,
                "canonicalUpdatedAt": memory.get("updatedAt").cloned().unwrap_or(Value::Null),
                "lexicalTokens": tokens,
                "vector": lexical_vector(&tokens)
            }),
        )?;
        rebuilt += 1;
    }
    Ok(json!({ "rebuilt": rebuilt }))
}

pub(crate) fn query_memory_index(state: &AppState, body: Value) -> AppResult<Value> {
    let body = if body.is_null() { json!({}) } else { body };
    if !body.is_object() {
        return Err(AppError::invalid_input(
            "memory index query body must be an object",
        ));
    }
    let mut seen = HashSet::new();
    let mut memories = Vec::new();
    for row in state.storage.list(INDEX_COLLECTION)? {
        let memory_id = read_string(row.get("memoryId"));
        if memory_id.is_empty() || !seen.insert(memory_id.clone()) {
            continue;
        }
        let Ok(memory) = get_memory(state, &memory_id) else {
            continue;
        };
        if memory.get("updatedAt") != row.get("canonicalUpdatedAt") {
            continue;
        }
        if memory_allowed_by_query(&memory, &body) {
            memories.push(memory);
        }
    }
    Ok(Value::Array(memories))
}

pub(crate) fn query_memory_index_batch(state: &AppState, body: Value) -> AppResult<Value> {
    let queries = batch_queries(body)?;
    if queries.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let mut seen = HashSet::new();
    let mut memories = Vec::new();
    for row in state.storage.list(INDEX_COLLECTION)? {
        let memory_id = read_string(row.get("memoryId"));
        if memory_id.is_empty() || !seen.insert(memory_id.clone()) {
            continue;
        }
        let Ok(memory) = get_memory(state, &memory_id) else {
            continue;
        };
        if memory.get("updatedAt") != row.get("canonicalUpdatedAt") {
            continue;
        }
        if queries
            .iter()
            .any(|query| memory_allowed_by_query(&memory, query))
        {
            memories.push(memory);
        }
    }
    Ok(Value::Array(memories))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::{json, Value};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-canonical-memory-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).unwrap();
        }
        AppState::from_data_dir(path, Vec::new()).unwrap()
    }

    fn ids(rows: &Value) -> Vec<String> {
        rows.as_array()
            .unwrap()
            .iter()
            .filter_map(|row| row.get("id").and_then(Value::as_str).map(ToOwned::to_owned))
            .collect()
    }

    fn seed_memory(
        state: &AppState,
        id: &str,
        scope_kind: &str,
        scope_id: &str,
        status: &str,
    ) -> Value {
        create_memory(
            state,
            json!({
                "id": id,
                "kind": "fact",
                "status": status,
                "scope": { "kind": scope_kind, "id": scope_id },
                "content": format!("{id} remembers the brass key."),
                "confidence": 0.82,
                "provenance": {
                    "sourceChatId": "chat-1",
                    "messageIds": ["message-1"],
                    "sceneId": "scene-1",
                    "characterId": "character-1",
                    "timestamp": "2026-07-04T12:00:00.000Z"
                }
            }),
        )
        .unwrap()
    }

    #[test]
    fn canonical_memory_crud_soft_delete_and_query_status_defaults() {
        let state = test_state("crud");
        let created = seed_memory(&state, "memory-active", "chat", "chat-1", "active");
        assert_eq!(created["scope"], json!({ "kind": "chat", "id": "chat-1" }));
        assert_eq!(created["provenance"]["messageIds"], json!(["message-1"]));

        upsert_memory_index_row(
            &state,
            json!({
                "id": "index-active",
                "memoryId": "memory-active",
                "provider": "lexical",
                "model": "de-koi-lexical-v1",
                "dimensions": 64,
                "contentHash": "old-content",
                "projectionHash": "old-projection",
                "canonicalUpdatedAt": created["updatedAt"],
                "vector": [0.1, 0.2]
            }),
        )
        .unwrap();

        let updated = update_memory(
            &state,
            "memory-active",
            json!({ "content": "Mira remembers the silver key.", "confidence": 0.91 }),
        )
        .unwrap();
        assert_eq!(updated["content"], json!("Mira remembers the silver key."));
        assert_eq!(state.storage.list("memory-index-rows").unwrap().len(), 0);

        seed_memory(&state, "memory-pinned", "chat", "chat-1", "pinned");
        seed_memory(&state, "memory-stale", "chat", "chat-1", "stale");
        seed_memory(&state, "memory-superseded", "chat", "chat-1", "superseded");
        seed_memory(&state, "memory-deleted", "chat", "chat-1", "deleted");
        let result = query_memories(
            &state,
            json!({ "scope": { "kind": "chat", "id": "chat-1" } }),
        )
        .unwrap();
        assert_eq!(ids(&result), vec!["memory-active", "memory-pinned"]);

        assert_eq!(
            delete_memory(&state, "memory-active").unwrap()["status"],
            json!("deleted")
        );
        assert_eq!(
            get_memory(&state, "memory-active").unwrap()["status"],
            json!("deleted")
        );
    }

    #[test]
    fn batch_queries_return_the_union_of_requested_scopes_once() {
        let state = test_state("batch-query-scopes");
        seed_memory(&state, "memory-chat", "chat", "chat-1", "active");
        seed_memory(&state, "memory-character", "character", "character-1", "active");
        seed_memory(&state, "memory-other", "chat", "chat-2", "active");

        let rows = query_memories_batch(
            &state,
            json!({
                "queries": [
                    { "scope": { "kind": "chat", "id": "chat-1" } },
                    { "scope": { "kind": "character", "id": "character-1" } }
                ]
            }),
        )
        .expect("batch scope query should succeed");

        assert_eq!(ids(&rows), vec!["memory-chat", "memory-character"]);
    }

    #[test]
    fn scoped_query_filters_all_supported_scopes() {
        let state = test_state("scopes");
        for (id, scope_kind, scope_id) in [
            ("memory-user", "user", "user-1"),
            ("memory-character", "character", "character-1"),
            ("memory-chat", "chat", "chat-1"),
            ("memory-scene", "scene", "scene-1"),
            ("memory-world", "world", "world-1"),
            ("memory-agent", "agent", "agent-1"),
        ] {
            seed_memory(&state, id, scope_kind, scope_id, "active");
            let result = query_memories(
                &state,
                json!({ "scope": { "kind": scope_kind, "id": scope_id } }),
            )
            .unwrap();
            assert_eq!(ids(&result), vec![id.to_string()]);
        }
    }

    #[test]
    fn index_query_uses_canonical_status_and_ignores_stale_projection_rows() {
        let state = test_state("index-query");
        let active = seed_memory(&state, "memory-active", "chat", "chat-1", "active");
        let deleted = seed_memory(&state, "memory-deleted", "chat", "chat-1", "deleted");
        let superseded = seed_memory(&state, "memory-superseded", "chat", "chat-1", "superseded");
        seed_memory(&state, "memory-changed", "chat", "chat-1", "active");

        for (id, memory_id, canonical_updated_at) in [
            ("index-active", "memory-active", active["updatedAt"].clone()),
            (
                "index-deleted",
                "memory-deleted",
                deleted["updatedAt"].clone(),
            ),
            (
                "index-superseded",
                "memory-superseded",
                superseded["updatedAt"].clone(),
            ),
            (
                "index-stale",
                "memory-changed",
                json!("stale-canonical-updated-at"),
            ),
        ] {
            upsert_memory_index_row(
                &state,
                json!({
                    "id": id,
                    "memoryId": memory_id,
                    "provider": "lexical",
                    "model": "de-koi-lexical-v1",
                    "dimensions": 64,
                    "contentHash": format!("{id}-content"),
                    "projectionHash": format!("{id}-projection"),
                    "canonicalUpdatedAt": canonical_updated_at,
                    "vector": [0.2, 0.4]
                }),
            )
            .unwrap();
        }
        let result = query_memory_index(
            &state,
            json!({ "scope": { "kind": "chat", "id": "chat-1" } }),
        )
        .unwrap();
        assert_eq!(ids(&result), vec!["memory-active"]);
    }

    #[test]
    fn lexical_rebuild_recreates_projection_rows_from_canonical_records() {
        let state = test_state("lexical-rebuild");
        seed_memory(&state, "memory-one", "chat", "chat-1", "active");
        seed_memory(&state, "memory-two", "chat", "chat-1", "pinned");
        seed_memory(&state, "memory-deleted", "chat", "chat-1", "deleted");
        assert_eq!(
            rebuild_memory_lexical_index(
                &state,
                json!({ "scope": { "kind": "chat", "id": "chat-1" } })
            )
            .unwrap()["rebuilt"],
            json!(2)
        );

        let rows = state.storage.list("memory-index-rows").unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|row| row["provider"] == json!("lexical")));
        assert!(rows
            .iter()
            .all(|row| row["model"] == json!("de-koi-lexical-v1")));
        assert!(rows.iter().all(|row| row["dimensions"] == json!(64)));
        assert!(rows.iter().all(|row| row["memoryId"].as_str().is_some()));
        assert!(rows.iter().all(|row| row["contentHash"].as_str().is_some()));
        assert!(rows
            .iter()
            .all(|row| row["projectionHash"].as_str().is_some()));
    }
}
