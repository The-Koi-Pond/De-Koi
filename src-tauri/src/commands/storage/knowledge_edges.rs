use crate::state::AppState;
use marinara_core::{now_iso, AppError, AppResult};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub(crate) const COLLECTION: &str = "memory-knowledge-edges";

const HOLDER_KINDS: &[&str] = &["character", "persona", "group", "world"];
const STANCES: &[&str] = &["knows", "believes", "suspects", "disbelieves", "unknown"];
const STATUSES: &[&str] = &["active", "proposed", "invalidated"];
const EVIDENCE_KINDS: &[&str] = &[
    "user_edit",
    "targeted_disclosure",
    "scene_witness",
    "import",
    "supersession",
];

pub(crate) fn capabilities() -> Value {
    json!({ "knowledge_edges_v1": true })
}

fn string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn required(object: &Map<String, Value>, key: &str) -> AppResult<String> {
    let value = string(object.get(key));
    if value.is_empty() {
        Err(AppError::invalid_input(format!(
            "knowledge edge {key} is required"
        )))
    } else {
        Ok(value)
    }
}

fn allowed(object: &Map<String, Value>, key: &str, values: &[&str]) -> AppResult<String> {
    let value = required(object, key)?;
    if values.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(AppError::invalid_input(format!(
            "Unsupported knowledge edge {key}: {value}"
        )))
    }
}

fn normalize_holder(value: Option<&Value>) -> AppResult<Value> {
    let holder = value
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::invalid_input("knowledge edge holder is required"))?;
    let kind = allowed(holder, "kind", HOLDER_KINDS)?;
    let id = required(holder, "id")?;
    if kind == "world" && id != "world" {
        return Err(AppError::invalid_input(
            "world knowledge holder id must be world",
        ));
    }
    Ok(json!({ "kind": kind, "id": id }))
}

fn normalize_message_ids(value: Option<&Value>) -> AppResult<Value> {
    let values = value.and_then(Value::as_array).ok_or_else(|| {
        AppError::invalid_input("knowledge edge provenance messageIds must be an array")
    })?;
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for value in values {
        let id = value.as_str().unwrap_or_default().trim();
        if !id.is_empty() && seen.insert(id.to_string()) {
            ids.push(Value::String(id.to_string()));
        }
    }
    Ok(Value::Array(ids))
}

fn normalize_provenance(value: Option<&Value>) -> AppResult<Vec<Value>> {
    let rows = value
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::invalid_input("knowledge edge provenance must be an array"))?;
    if rows.is_empty() {
        return Err(AppError::invalid_input(
            "knowledge edge provenance is required",
        ));
    }
    let mut normalized = Vec::new();
    for row in rows {
        let object = row.as_object().ok_or_else(|| {
            AppError::invalid_input("knowledge edge provenance entries must be objects")
        })?;
        let kind = allowed(object, "kind", EVIDENCE_KINDS)?;
        let author = allowed(object, "author", &["user", "system"])?;
        let created_at = required(object, "createdAt")?;
        let mut result = json!({
            "kind": kind,
            "author": author,
            "messageIds": normalize_message_ids(object.get("messageIds"))?,
            "createdAt": created_at,
        });
        for key in ["sourceChatId", "sceneId"] {
            let value = string(object.get(key));
            if !value.is_empty() {
                result[key] = Value::String(value);
            }
        }
        if !normalized.contains(&result) {
            normalized.push(result);
        }
    }
    Ok(normalized)
}

pub(crate) fn deterministic_edge_id(memory_id: &str, holder_kind: &str, holder_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"knowledge-edge\0");
    hasher.update(memory_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(holder_kind.as_bytes());
    hasher.update(b"\0");
    hasher.update(holder_id.as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("knowledge-edge-{hex}")
}

fn normalize_input(value: Value) -> AppResult<Value> {
    let object = marinara_core::ensure_object(value)?;
    let memory_id = required(&object, "memoryId")?;
    let holder = normalize_holder(object.get("holder"))?;
    let holder_kind = string(holder.get("kind"));
    let holder_id = string(holder.get("id"));
    let stance = allowed(&object, "stance", STANCES)?;
    let status = match string(object.get("status")).as_str() {
        "" => "active".to_string(),
        _ => allowed(&object, "status", STATUSES)?,
    };
    let confidence = match object.get("confidence") {
        None | Some(Value::Null) => Value::Null,
        Some(value) => {
            let number = value.as_f64().ok_or_else(|| {
                AppError::invalid_input("knowledge edge confidence must be between 0 and 1")
            })?;
            if !(0.0..=1.0).contains(&number) {
                return Err(AppError::invalid_input(
                    "knowledge edge confidence must be between 0 and 1",
                ));
            }
            json!(number)
        }
    };
    Ok(json!({
        "id": deterministic_edge_id(&memory_id, &holder_kind, &holder_id),
        "memoryId": memory_id,
        "holder": holder,
        "stance": stance,
        "status": status,
        "confidence": confidence,
        "provenance": normalize_provenance(object.get("provenance"))?,
    }))
}

fn upsert_normalized(
    rows: &mut Vec<Value>,
    mut record: Map<String, Value>,
    now: &str,
) -> AppResult<Value> {
    let id = required(&record, "id")?;
    if let Some(existing) = rows.iter_mut().find(|row| string(row.get("id")) == id) {
        let existing_object = existing
            .as_object()
            .cloned()
            .ok_or_else(|| AppError::invalid_input("Stored knowledge edge is not an object"))?;
        let mut provenance = existing_object
            .get("provenance")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for item in record
            .get("provenance")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if !provenance.contains(item) {
                provenance.push(item.clone());
            }
        }
        record.insert("provenance".to_string(), Value::Array(provenance));
        record.insert(
            "createdAt".to_string(),
            existing_object
                .get("createdAt")
                .cloned()
                .unwrap_or_else(|| Value::String(now.to_string())),
        );
        if string(record.get("status")) != "invalidated" {
            record.insert("invalidatedReason".to_string(), Value::Null);
        }
        record.insert("updatedAt".to_string(), Value::String(now.to_string()));
        *existing = Value::Object(record);
        return Ok(existing.clone());
    }
    record.insert("createdAt".to_string(), Value::String(now.to_string()));
    record.insert("updatedAt".to_string(), Value::String(now.to_string()));
    record.insert("invalidatedReason".to_string(), Value::Null);
    let value = Value::Object(record);
    rows.push(value.clone());
    Ok(value)
}

pub(crate) fn upsert_edges_for_memory_in_rows(
    rows: &mut Vec<Value>,
    memory_id: &str,
    inputs: Vec<Value>,
    now: &str,
) -> AppResult<Vec<Value>> {
    let mut stored = Vec::new();
    for input in inputs {
        let record = marinara_core::ensure_object(normalize_input(input)?)?;
        if required(&record, "memoryId")? != memory_id {
            return Err(AppError::invalid_input(
                "knowledge edge memoryId must match the canonical memory",
            ));
        }
        stored.push(upsert_normalized(rows, record, now)?);
    }
    Ok(stored)
}

pub(crate) fn upsert_edge(state: &AppState, input: Value) -> AppResult<Value> {
    let record = marinara_core::ensure_object(normalize_input(input)?)?;
    let memory_id = required(&record, "memoryId")?;
    super::canonical_memory::get_memory(state, &memory_id)?;
    let now = now_iso();
    state
        .storage
        .update_collections_atomically(vec![COLLECTION], move |collections| {
            upsert_normalized(collections[0].rows_mut(), record, &now)
        })
}

fn update_status(
    state: &AppState,
    edge_id: &str,
    status: &str,
    reason: Option<&str>,
) -> AppResult<Value> {
    let edge_id = edge_id.trim().to_string();
    if edge_id.is_empty() {
        return Err(AppError::invalid_input("knowledge edge id is required"));
    }
    let status = status.to_string();
    let reason = reason
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    state
        .storage
        .update_collections_atomically(vec![COLLECTION], move |collections| {
            let row = collections[0]
                .rows_mut()
                .iter_mut()
                .find(|row| string(row.get("id")) == edge_id)
                .ok_or_else(|| {
                    AppError::not_found(format!("{COLLECTION}/{edge_id} was not found"))
                })?;
            let object = row
                .as_object_mut()
                .ok_or_else(|| AppError::invalid_input("Stored knowledge edge is not an object"))?;
            object.insert("status".to_string(), Value::String(status));
            object.insert(
                "invalidatedReason".to_string(),
                reason.map(Value::String).unwrap_or(Value::Null),
            );
            object.insert("updatedAt".to_string(), Value::String(now_iso()));
            Ok(row.clone())
        })
}

pub(crate) fn approve_edge(state: &AppState, edge_id: &str) -> AppResult<Value> {
    update_status(state, edge_id, "active", None)
}

pub(crate) fn invalidate_edge(state: &AppState, edge_id: &str, reason: &str) -> AppResult<Value> {
    if reason.trim().is_empty() {
        return Err(AppError::invalid_input(
            "knowledge edge invalidation reason is required",
        ));
    }
    update_status(state, edge_id, "invalidated", Some(reason))
}

fn string_set(value: Option<&Value>) -> Option<HashSet<String>> {
    value.and_then(Value::as_array).map(|values| {
        values
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect()
    })
}

pub(crate) fn query_edges(state: &AppState, body: Value) -> AppResult<Value> {
    let body = if body.is_null() { json!({}) } else { body };
    let object = body
        .as_object()
        .ok_or_else(|| AppError::invalid_input("knowledge edge query body must be an object"))?;
    let memory_ids = string_set(object.get("memoryIds"));
    let statuses = string_set(object.get("statuses"));
    let holders = object.get("holders").and_then(Value::as_array);
    let rows = state
        .storage
        .list(COLLECTION)?
        .into_iter()
        .filter(|row| {
            memory_ids
                .as_ref()
                .is_none_or(|ids| ids.contains(&string(row.get("memoryId"))))
                && statuses
                    .as_ref()
                    .is_none_or(|values| values.contains(&string(row.get("status"))))
                && holders.is_none_or(|values| {
                    values
                        .iter()
                        .any(|holder| row.get("holder") == Some(holder))
                })
        })
        .collect::<Vec<_>>();
    Ok(Value::Array(rows))
}

#[cfg(test)]
pub(crate) fn memory_is_classified(state: &AppState, memory_id: &str) -> AppResult<bool> {
    Ok(state.storage.list(COLLECTION)?.iter().any(|edge| {
        string(edge.get("memoryId")) == memory_id
            && matches!(
                string(edge.get("status")).as_str(),
                "active" | "invalidated"
            )
    }))
}

fn invalidate_row(row: &mut Value, reason: &str, now: &str) -> AppResult<()> {
    let object = row
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Stored knowledge edge is not an object"))?;
    object.insert(
        "status".to_string(),
        Value::String("invalidated".to_string()),
    );
    object.insert(
        "invalidatedReason".to_string(),
        Value::String(reason.to_string()),
    );
    object.insert("updatedAt".to_string(), Value::String(now.to_string()));
    Ok(())
}

pub(crate) fn apply_memory_lifecycle(
    rows: &mut [Value],
    memory_id: &str,
    content_changed: bool,
    previous_status: &str,
    next_status: &str,
    now: &str,
) -> AppResult<()> {
    for row in rows
        .iter_mut()
        .filter(|row| string(row.get("memoryId")) == memory_id)
    {
        let status = string(row.get("status"));
        if !matches!(status.as_str(), "active" | "proposed") {
            continue;
        }
        if content_changed {
            invalidate_row(row, "memory_content_changed", now)?;
            continue;
        }
        if next_status == "deleted" && previous_status != "deleted" {
            invalidate_row(row, "memory_deleted", now)?;
            continue;
        }
        if next_status != "superseded" || previous_status == "superseded" {
            continue;
        }
        let holder_kind = string(row.get("holder").and_then(|holder| holder.get("kind")));
        if holder_kind == "world" {
            invalidate_row(row, "memory_superseded", now)?;
            continue;
        }
        if status == "active" && string(row.get("stance")) == "knows" {
            let object = row
                .as_object_mut()
                .ok_or_else(|| AppError::invalid_input("Stored knowledge edge is not an object"))?;
            object.insert("stance".to_string(), Value::String("believes".to_string()));
            object.insert("updatedAt".to_string(), Value::String(now.to_string()));
            let provenance = object
                .entry("provenance".to_string())
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .ok_or_else(|| {
                    AppError::invalid_input("Stored knowledge edge provenance is not an array")
                })?;
            let evidence = json!({
                "kind": "supersession",
                "author": "system",
                "messageIds": [],
                "createdAt": now,
            });
            if !provenance.contains(&evidence) {
                provenance.push(evidence);
            }
        }
    }
    Ok(())
}

pub(crate) fn purge_memory_edges(rows: &mut Vec<Value>, memory_id: &str) {
    rows.retain(|row| string(row.get("memoryId")) != memory_id);
}

pub(crate) fn invalidate_message_sources(
    rows: &mut [Value],
    message_ids: &[String],
    reason: &str,
) -> AppResult<usize> {
    let source_ids = message_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    if source_ids.is_empty() {
        return Ok(0);
    }
    let now = now_iso();
    let mut invalidated = 0usize;
    for row in rows {
        if !matches!(string(row.get("status")).as_str(), "active" | "proposed") {
            continue;
        }
        let provenance = row
            .get("provenance")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let retained = provenance
            .iter()
            .filter(|evidence| {
                !evidence
                    .get("messageIds")
                    .and_then(Value::as_array)
                    .is_some_and(|ids| {
                        ids.iter()
                            .filter_map(Value::as_str)
                            .any(|id| source_ids.contains(id))
                    })
            })
            .cloned()
            .collect::<Vec<_>>();
        if retained.len() == provenance.len() {
            continue;
        }
        let object = row
            .as_object_mut()
            .ok_or_else(|| AppError::invalid_input("Stored knowledge edge is not an object"))?;
        object.insert("provenance".to_string(), Value::Array(retained.clone()));
        object.insert("updatedAt".to_string(), Value::String(now.clone()));
        if retained.is_empty() {
            invalidate_row(row, reason, &now)?;
            invalidated += 1;
        }
    }
    Ok(invalidated)
}

pub(crate) fn invalidate_message_sources_in_collections(
    collections: &mut [marinara_storage::AtomicCollectionRows],
    edge_collection_index: usize,
    message_ids: &[String],
    reason: &str,
) -> AppResult<usize> {
    invalidate_message_sources(
        collections
            .get_mut(edge_collection_index)
            .ok_or_else(|| AppError::new("storage_error", "Knowledge edge collection missing"))?
            .rows_mut(),
        message_ids,
        reason,
    )
}

pub(crate) fn delete_holder_atomically(
    state: &AppState,
    holder_collection: &'static str,
    holder_kind: &str,
    holder_id: &str,
) -> AppResult<bool> {
    let holder_kind = holder_kind.to_string();
    let holder_id = holder_id.to_string();
    state.storage.update_collections_atomically(
        vec![holder_collection, COLLECTION],
        move |collections| {
            let (holder_collections, edge_collections) = collections.split_at_mut(1);
            let holders = holder_collections[0].rows_mut();
            let before = holders.len();
            holders.retain(|row| string(row.get("id")) != holder_id);
            if holders.len() == before {
                return Ok(false);
            }
            let now = now_iso();
            for row in edge_collections[0].rows_mut() {
                let matches_holder = row.get("holder").is_some_and(|holder| {
                    string(holder.get("kind")) == holder_kind
                        && string(holder.get("id")) == holder_id
                });
                if matches_holder
                    && matches!(string(row.get("status")).as_str(), "active" | "proposed")
                {
                    invalidate_row(row, "holder_deleted", &now)?;
                }
            }
            Ok(true)
        },
    )
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
        let path = std::env::temp_dir().join(format!("de-koi-knowledge-edges-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).unwrap()
    }

    fn input(status: &str, message_ids: &[&str]) -> Value {
        json!({
            "memoryId": "memory-1",
            "holder": { "kind": "character", "id": "alice" },
            "stance": "believes",
            "status": status,
            "confidence": 0.75,
            "provenance": [{
                "kind": "targeted_disclosure",
                "author": "system",
                "sourceChatId": "chat-1",
                "messageIds": message_ids,
                "createdAt": "2026-08-30T12:00:00.000Z"
            }]
        })
    }

    fn seed_memory(state: &AppState, id: &str) {
        crate::storage_commands::canonical_memory::create_memory(
            state,
            json!({
                "id": id,
                "kind": "fact",
                "scope": { "kind": "chat", "id": "chat-1" },
                "content": "A claim",
                "confidence": 0.8,
                "provenance": { "sourceChatId": "chat-1", "messageIds": ["message-1"] }
            }),
        )
        .unwrap();
    }

    #[test]
    fn deterministic_upsert_preserves_identity_and_deduplicates_provenance() {
        let state = test_state("upsert");
        seed_memory(&state, "memory-1");
        let first = upsert_edge(&state, input("active", &["message-1"])).unwrap();
        let second = upsert_edge(&state, input("active", &["message-1"])).unwrap();

        assert_eq!(first["id"], second["id"]);
        assert_eq!(second["provenance"].as_array().unwrap().len(), 1);
        assert_eq!(
            query_edges(&state, json!({ "memoryIds": ["memory-1"] }))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn rejects_edges_for_missing_canonical_memories() {
        let state = test_state("missing-memory");
        let error = upsert_edge(&state, input("active", &["message-1"])).unwrap_err();
        assert_eq!(error.code, "not_found");
    }

    #[test]
    fn proposed_edges_can_be_approved_then_invalidated_without_losing_classification() {
        let state = test_state("lifecycle");
        seed_memory(&state, "memory-1");
        let proposed = upsert_edge(&state, input("proposed", &["message-1"])).unwrap();
        let id = proposed["id"].as_str().unwrap();
        assert!(!memory_is_classified(&state, "memory-1").unwrap());

        let approved = approve_edge(&state, id).unwrap();
        assert_eq!(approved["status"], json!("active"));
        assert!(memory_is_classified(&state, "memory-1").unwrap());

        let invalidated = invalidate_edge(&state, id, "source_message_deleted").unwrap();
        assert_eq!(invalidated["status"], json!("invalidated"));
        assert_eq!(
            invalidated["invalidatedReason"],
            json!("source_message_deleted")
        );
        assert!(memory_is_classified(&state, "memory-1").unwrap());
    }

    #[test]
    fn query_filters_by_memory_holder_and_status() {
        let state = test_state("query");
        seed_memory(&state, "memory-1");
        seed_memory(&state, "memory-2");
        upsert_edge(&state, input("active", &["message-1"])).unwrap();
        upsert_edge(&state, json!({
            "memoryId": "memory-2",
            "holder": { "kind": "world", "id": "world" },
            "stance": "knows",
            "status": "active",
            "provenance": [{ "kind": "user_edit", "author": "user", "messageIds": [], "createdAt": "2026-08-30T12:00:00.000Z" }]
        })).unwrap();

        let rows = query_edges(
            &state,
            json!({
                "memoryIds": ["memory-2"],
                "holders": [{ "kind": "world", "id": "world" }],
                "statuses": ["active"]
            }),
        )
        .unwrap();
        assert_eq!(rows.as_array().unwrap().len(), 1);
        assert_eq!(rows[0]["memoryId"], json!("memory-2"));
    }

    #[test]
    fn removing_one_message_evidence_keeps_an_edge_with_other_evidence_active() {
        let state = test_state("multiple-evidence");
        seed_memory(&state, "memory-1");
        upsert_edge(&state, input("active", &["message-1"])).unwrap();
        let mut second = input("active", &["message-2"]);
        second["provenance"][0]["createdAt"] = json!("2026-08-30T12:01:00.000Z");
        upsert_edge(&state, second).unwrap();

        state
            .storage
            .update_collections_atomically(vec![COLLECTION], |collections| {
                invalidate_message_sources_in_collections(
                    collections,
                    0,
                    &["message-1".to_string()],
                    "source_message_edited",
                )
            })
            .unwrap();

        let rows = query_edges(&state, json!({ "memoryIds": ["memory-1"] })).unwrap();
        assert_eq!(rows[0]["status"], json!("active"));
        assert_eq!(rows[0]["provenance"].as_array().unwrap().len(), 1);
        assert_eq!(rows[0]["provenance"][0]["messageIds"], json!(["message-2"]));
    }
}
