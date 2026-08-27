use crate::state::AppState;
use marinara_core::{new_id, now_iso, AppError, AppResult};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

#[path = "canonical_memory/semantic.rs"]
mod semantic;
pub(crate) use semantic::query_memories_semantic;

pub(crate) const MEMORY_COLLECTION: &str = "canonical-memories";
pub(crate) const INDEX_COLLECTION: &str = "memory-index-rows";
pub(crate) const STORY_JOBS_COLLECTION: &str = "story-consolidation-jobs";
const INDEX_METADATA_COLLECTION: &str = "memory-index-metadata";
const INDEX_HEALTH_ID: &str = "lexical-v1";
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

pub(crate) fn validate_memory_input(body: &Value) -> AppResult<()> {
    normalize_memory_record(marinara_core::ensure_object(body.clone())?, true).map(|_| ())
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
                Err(AppError::invalid_input(
                    "memory batch query entries must be objects",
                ))
            }
        })
        .collect()
}

pub(crate) fn create_memory(state: &AppState, body: Value) -> AppResult<Value> {
    let mut record = marinara_core::ensure_object(normalize_memory_record(
        marinara_core::ensure_object(body)?,
        true,
    )?)?;
    let memory_id = require_string(&record, "id")?;
    let now = now_iso();
    record
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    record
        .entry("updatedAt".to_string())
        .or_insert_with(|| Value::String(now));
    let record = Value::Object(record);

    let created = state.storage.update_collections_atomically(
        vec![MEMORY_COLLECTION, INDEX_COLLECTION],
        move |collections| {
            let memories = collections[0].rows_mut();
            if memories
                .iter()
                .any(|memory| read_string(memory.get("id")) == memory_id)
            {
                return Err(AppError::invalid_input(format!(
                    "{MEMORY_COLLECTION}/{memory_id} already exists"
                )));
            }
            validate_story_projection_overlap(memories, &record)?;
            memories.push(record.clone());
            replace_memory_lexical_index(collections[1].rows_mut(), &record)?;
            Ok(record)
        },
    )?;
    enqueue_canonical_memory_maintenance(state, &created)?;
    Ok(created)
}

/// Commits a story worker result and retires the replaced projection in one
/// storage transaction. The caller must hold the background-writer lease.
pub(crate) fn commit_story_projection_job(
    state: &AppState,
    job_id: &str,
    body: Value,
) -> AppResult<Value> {
    let mut record = marinara_core::ensure_object(normalize_memory_record(
        marinara_core::ensure_object(body)?,
        true,
    )?)?;
    let memory_id = require_string(&record, "id")?;
    let now = now_iso();
    record
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    record.insert("updatedAt".to_string(), Value::String(now.clone()));
    let record = Value::Object(record);
    let job_id = job_id.to_string();

    let committed = state.storage.update_collections_atomically(
        vec![MEMORY_COLLECTION, INDEX_COLLECTION, STORY_JOBS_COLLECTION],
        move |collections| {
            let (memory_collections, remaining) = collections.split_at_mut(1);
            let (index_collections, job_collections) = remaining.split_at_mut(1);
            let memories = memory_collections[0].rows_mut();
            let index_rows = index_collections[0].rows_mut();
            let story_jobs = job_collections[0].rows_mut();
            let job_index = story_jobs
                .iter()
                .position(|job| read_string(job.get("id")) == job_id)
                .ok_or_else(|| {
                    AppError::not_found(format!("{STORY_JOBS_COLLECTION}/{job_id} was not found"))
                })?;
            let job = &story_jobs[job_index];
            let job_status = read_string(job.get("status"));
            if job_status == "completed" && read_string(job.get("projectionMemoryId")) == memory_id
            {
                let memory = memories
                    .iter()
                    .find(|memory| read_string(memory.get("id")) == memory_id)
                    .cloned()
                    .ok_or_else(|| {
                        AppError::invalid_input("Completed story job is missing its projection")
                    })?;
                return Ok(json!({ "memory": memory, "job": job.clone() }));
            }
            if job_status != "processing" {
                return Err(AppError::invalid_input(
                    "Story projection job must be processing before commit",
                ));
            }
            let payload = story_projection_payload(&record)
                .ok_or_else(|| AppError::invalid_input("Story projection payload is required"))?;
            for (job_key, payload_key) in [
                ("level", "level"),
                ("ownerChatId", "ownerChatId"),
                ("coverageId", "coverageId"),
                ("sourceFingerprint", "sourceFingerprint"),
            ] {
                if read_string(job.get(job_key)) != read_string(payload.get(payload_key)) {
                    return Err(AppError::invalid_input(format!(
                        "Story projection {payload_key} does not match its job"
                    )));
                }
            }
            if read_string(job.get("supersedesMemoryId"))
                != read_string(record.get("supersedesMemoryId"))
            {
                return Err(AppError::invalid_input(
                    "Story projection supersession does not match its job",
                ));
            }

            let created = if let Some(existing) = memories
                .iter()
                .find(|memory| read_string(memory.get("id")) == memory_id)
            {
                if story_projection_payload(existing).is_none()
                    || read_string(
                        existing
                            .get("payload")
                            .and_then(|value| value.get("coverageId")),
                    ) != read_string(payload.get("coverageId"))
                    || read_string(
                        existing
                            .get("payload")
                            .and_then(|value| value.get("sourceFingerprint")),
                    ) != read_string(payload.get("sourceFingerprint"))
                {
                    return Err(AppError::invalid_input(
                        "Story projection deterministic id collision",
                    ));
                }
                existing.clone()
            } else {
                validate_story_projection_overlap(memories, &record)?;
                memories.push(record.clone());
                replace_memory_lexical_index(index_rows, &record)?;
                record.clone()
            };

            let supersedes = read_string(created.get("supersedesMemoryId"));
            if !supersedes.is_empty() {
                let old = memories
                    .iter_mut()
                    .find(|memory| read_string(memory.get("id")) == supersedes)
                    .ok_or_else(|| {
                        AppError::not_found(format!(
                            "Replacement source {MEMORY_COLLECTION}/{supersedes} was not found"
                        ))
                    })?;
                let object = old.as_object_mut().ok_or_else(|| {
                    AppError::invalid_input("Stored story projection is not an object")
                })?;
                object.insert(
                    "status".to_string(),
                    Value::String("superseded".to_string()),
                );
                object.insert(
                    "supersededByMemoryId".to_string(),
                    Value::String(memory_id.clone()),
                );
                object.insert("updatedAt".to_string(), Value::String(now.clone()));

                let source_episode_ids = HashSet::from([supersedes.clone()]);
                let mut stale_arc_ids = HashSet::new();
                for candidate in memories.iter_mut() {
                    let Some(candidate_payload) = story_projection_payload(candidate) else {
                        continue;
                    };
                    if candidate_payload.get("level").and_then(Value::as_str) == Some("arc")
                        && string_array_intersects(
                            candidate_payload.get("sourceEpisodeIds"),
                            &source_episode_ids,
                        )
                    {
                        let arc_id = read_string(candidate.get("id"));
                        if mark_story_row_stale(candidate, "source_episode_superseded", &now)? {
                            stale_arc_ids.insert(arc_id);
                        }
                    }
                }
                stale_arc_ids.insert(supersedes.clone());
                index_rows.retain(|row| !stale_arc_ids.contains(&read_string(row.get("memoryId"))));
                for candidate_job in story_jobs.iter_mut() {
                    if read_string(candidate_job.get("id")) != job_id
                        && string_array_intersects(
                            candidate_job.get("sourceEpisodeIds"),
                            &source_episode_ids,
                        )
                    {
                        mark_story_row_stale(candidate_job, "source_episode_superseded", &now)?;
                    }
                }
            }

            let job = story_jobs[job_index]
                .as_object_mut()
                .ok_or_else(|| AppError::invalid_input("Stored story job is not an object"))?;
            job.insert("status".to_string(), Value::String("completed".to_string()));
            job.insert(
                "projectionMemoryId".to_string(),
                Value::String(memory_id.clone()),
            );
            job.insert("completedAt".to_string(), Value::String(now.clone()));
            job.insert("nextAttemptAt".to_string(), Value::Null);
            job.insert("updatedAt".to_string(), Value::String(now.clone()));
            Ok(json!({ "memory": created, "job": Value::Object(job.clone()) }))
        },
    )?;
    if let Err(error) = enqueue_canonical_memory_maintenance(state, &committed["memory"]) {
        eprintln!("story projection maintenance enqueue failed after commit: {error}");
    }
    Ok(committed)
}

pub(crate) fn get_memory(state: &AppState, memory_id: &str) -> AppResult<Value> {
    state
        .storage
        .get(MEMORY_COLLECTION, memory_id)?
        .ok_or_else(|| AppError::not_found(format!("canonical memory {memory_id} was not found")))
}

pub(crate) fn update_memory(state: &AppState, memory_id: &str, patch: Value) -> AppResult<Value> {
    let patch_object = marinara_core::ensure_object(patch)?;
    let memory_id = memory_id.to_string();

    let updated = state.storage.update_collections_atomically(
        vec![MEMORY_COLLECTION, INDEX_COLLECTION, STORY_JOBS_COLLECTION],
        move |collections| {
            let (memory_collections, remaining_collections) = collections.split_at_mut(1);
            let (index_collections, job_collections) = remaining_collections.split_at_mut(1);
            let memories = memory_collections[0].rows_mut();
            let index_rows = index_collections[0].rows_mut();
            let story_jobs = job_collections[0].rows_mut();
            let memory = memories
                .iter_mut()
                .find(|memory| read_string(memory.get("id")) == memory_id)
                .ok_or_else(|| {
                    AppError::not_found(format!("{MEMORY_COLLECTION}/{memory_id} was not found"))
                })?;
            let current = memory.clone();
            let mut normalized = marinara_core::ensure_object(normalize_memory_record(
                marinara_core::ensure_object(merge_patch(
                    &current,
                    Value::Object(patch_object.clone()),
                )?)?,
                false,
            )?)?;
            normalized.insert("id".to_string(), Value::String(memory_id.clone()));
            normalized.insert("updatedAt".to_string(), Value::String(now_iso()));
            let updated = Value::Object(normalized);
            *memory = updated.clone();
            replace_memory_lexical_index(index_rows, &updated)?;
            let superseded_episode_id = story_projection_payload(&updated)
                .filter(|payload| payload.get("level").and_then(Value::as_str) == Some("episode"))
                .filter(|_| updated.get("status").and_then(Value::as_str) == Some("superseded"))
                .map(|_| memory_id.clone());
            if let Some(episode_id) = superseded_episode_id {
                let source_episode_ids = HashSet::from([episode_id.clone()]);
                let now = now_iso();
                let mut stale_arc_ids = HashSet::new();
                for candidate in memories.iter_mut() {
                    let Some(payload) = story_projection_payload(candidate) else {
                        continue;
                    };
                    if payload.get("level").and_then(Value::as_str) == Some("arc")
                        && string_array_intersects(
                            payload.get("sourceEpisodeIds"),
                            &source_episode_ids,
                        )
                    {
                        let arc_id = read_string(candidate.get("id"));
                        if mark_story_row_stale(candidate, "source_episode_superseded", &now)? {
                            stale_arc_ids.insert(arc_id);
                        }
                    }
                }
                index_rows.retain(|row| !stale_arc_ids.contains(&read_string(row.get("memoryId"))));
                for job in story_jobs.iter_mut() {
                    if string_array_intersects(job.get("sourceEpisodeIds"), &source_episode_ids) {
                        mark_story_row_stale(job, "source_episode_superseded", &now)?;
                    }
                }
            }
            Ok(updated)
        },
    )?;
    enqueue_canonical_memory_maintenance(state, &updated)?;
    Ok(updated)
}

fn enqueue_canonical_memory_maintenance(state: &AppState, memory: &Value) -> AppResult<()> {
    let scope = memory
        .get("scope")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::invalid_input("Canonical memory scope is required"))?;
    let kind = scope
        .get("kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Canonical memory scope kind is required"))?;
    if !matches!(kind, "chat" | "scene" | "character") {
        return Ok(());
    }
    let id = scope
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Canonical memory scope id is required"))?;
    super::memory_maintenance::jobs::enqueue_memory_maintenance(
        state,
        super::memory_maintenance::jobs::target(
            super::memory_maintenance::contracts::CleanupStore::Canonical,
            kind,
            id,
        ),
        super::memory_maintenance::jobs::Trigger::Manual,
    )?;
    Ok(())
}

pub(crate) fn delete_memory(state: &AppState, memory_id: &str) -> AppResult<Value> {
    let deleted = update_memory(state, memory_id, json!({ "status": "deleted" }))?;
    delete_memory_index_rows_for_memory(state, memory_id)?;
    Ok(deleted)
}

pub(crate) fn purge_memory(state: &AppState, memory_id: &str) -> AppResult<()> {
    let memory_id = memory_id.to_string();
    state.storage.update_collections_atomically(
        vec![MEMORY_COLLECTION, INDEX_COLLECTION],
        move |collections| {
            let (memory_collections, index_collections) = collections.split_at_mut(1);
            memory_collections[0]
                .rows_mut()
                .retain(|memory| read_string(memory.get("id")) != memory_id);
            index_collections[0]
                .rows_mut()
                .retain(|row| read_string(row.get("memoryId")) != memory_id);
            Ok(())
        },
    )
}

fn story_projection_payload(memory: &Value) -> Option<&Map<String, Value>> {
    let payload = memory.get("payload")?.as_object()?;
    (payload
        .get("storyProjectionVersion")
        .and_then(Value::as_u64)
        == Some(1))
    .then_some(payload)
}

fn validate_story_projection_overlap(memories: &[Value], candidate: &Value) -> AppResult<()> {
    let Some(payload) = story_projection_payload(candidate) else {
        return Ok(());
    };
    let level = read_string(payload.get("level"));
    let source_key = if level == "episode" {
        "messageIds"
    } else if level == "arc" {
        "sourceEpisodeIds"
    } else {
        return Ok(());
    };
    let candidate_ids = payload
        .get(source_key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    let conflicts = memories
        .iter()
        .filter(|memory| {
            matches!(
                memory.get("status").and_then(Value::as_str),
                Some("active" | "pinned")
            )
        })
        .filter(|memory| {
            story_projection_payload(memory).is_some_and(|existing| {
                existing.get("level").and_then(Value::as_str) == Some(level.as_str())
                    && string_array_intersects(existing.get(source_key), &candidate_ids)
            })
        })
        .collect::<Vec<_>>();
    if conflicts.is_empty() {
        return Ok(());
    }
    let supersedes = read_string(candidate.get("supersedesMemoryId"));
    let coverage = read_string(payload.get("coverageId"));
    let valid_replacement = conflicts.len() == 1
        && read_string(conflicts[0].get("id")) == supersedes
        && story_projection_payload(conflicts[0])
            .is_some_and(|existing| read_string(existing.get("coverageId")) == coverage);
    if valid_replacement {
        Ok(())
    } else {
        Err(AppError::invalid_input(
            "Story projection coverage overlaps an active story slot",
        ))
    }
}

fn string_array_intersects(value: Option<&Value>, ids: &HashSet<String>) -> bool {
    value.and_then(Value::as_array).is_some_and(|values| {
        values
            .iter()
            .filter_map(Value::as_str)
            .any(|id| ids.contains(id))
    })
}

fn mark_story_row_stale(row: &mut Value, reason: &str, now: &str) -> AppResult<bool> {
    let status = read_string(row.get("status"));
    if !matches!(
        status.as_str(),
        "active" | "pinned" | "pending" | "processing" | "retryable"
    ) {
        return Ok(false);
    }
    #[cfg(test)]
    if read_string(row.get("id")) == "__fail_story_invalidation__" {
        return Err(AppError::invalid_input(
            "injected story projection invalidation failure",
        ));
    }
    let object = row
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Story projection row is not an object"))?;
    object.insert("status".to_string(), Value::String("stale".to_string()));
    object.insert("staleReason".to_string(), Value::String(reason.to_string()));
    object.insert("staleAt".to_string(), Value::String(now.to_string()));
    object.insert("updatedAt".to_string(), Value::String(now.to_string()));
    if let Some(payload) = object.get_mut("payload").and_then(Value::as_object_mut) {
        payload.insert("staleReason".to_string(), Value::String(reason.to_string()));
        payload.insert("staleAt".to_string(), Value::String(now.to_string()));
    }
    Ok(true)
}

fn stale_story_memory_rows(
    memories: &mut [Value],
    message_ids: &[String],
    reason: &str,
) -> AppResult<(HashSet<String>, HashSet<String>, usize, String)> {
    let source_ids = message_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    if source_ids.is_empty() {
        return Ok((HashSet::new(), HashSet::new(), 0, now_iso()));
    }
    let now = now_iso();
    let mut affected_episode_ids = HashSet::new();
    let mut stale_memory_ids = HashSet::new();
    let mut stale_count = 0usize;

    for memory in memories.iter_mut() {
        let Some(payload) = story_projection_payload(memory) else {
            continue;
        };
        if payload.get("level").and_then(Value::as_str) != Some("episode")
            || !string_array_intersects(payload.get("messageIds"), &source_ids)
        {
            continue;
        }
        let id = read_string(memory.get("id"));
        if !id.is_empty() {
            affected_episode_ids.insert(id.clone());
        }
        if mark_story_row_stale(memory, reason, &now)? {
            stale_memory_ids.insert(id);
            stale_count += 1;
        }
    }

    for memory in memories.iter_mut() {
        let Some(payload) = story_projection_payload(memory) else {
            continue;
        };
        if payload.get("level").and_then(Value::as_str) != Some("arc")
            || !string_array_intersects(payload.get("sourceEpisodeIds"), &affected_episode_ids)
        {
            continue;
        }
        let id = read_string(memory.get("id"));
        if mark_story_row_stale(memory, "source_episode_stale", &now)? {
            stale_memory_ids.insert(id);
            stale_count += 1;
        }
    }
    Ok((affected_episode_ids, stale_memory_ids, stale_count, now))
}

fn stale_story_job_rows(
    jobs: &mut [Value],
    message_ids: &[String],
    affected_episode_ids: &HashSet<String>,
    reason: &str,
    now: &str,
) -> AppResult<()> {
    let source_ids = message_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    for job in jobs {
        let affected = string_array_intersects(job.get("sourceMessageIds"), &source_ids)
            || string_array_intersects(job.get("sourceEpisodeIds"), affected_episode_ids);
        if affected {
            mark_story_row_stale(job, reason, now)?;
        }
    }
    Ok(())
}

pub(crate) fn stale_story_projections_in_collections(
    collections: &mut [marinara_storage::AtomicCollectionRows],
    memory_collection_index: usize,
    index_collection_index: usize,
    story_jobs_collection_index: usize,
    message_ids: &[String],
    reason: &str,
) -> AppResult<usize> {
    let (affected_episode_ids, stale_memory_ids, stale_count, now) = stale_story_memory_rows(
        collections
            .get_mut(memory_collection_index)
            .ok_or_else(|| AppError::new("storage_error", "Canonical memory collection missing"))?
            .rows_mut(),
        message_ids,
        reason,
    )?;

    collections
        .get_mut(index_collection_index)
        .ok_or_else(|| AppError::new("storage_error", "Memory index collection missing"))?
        .rows_mut()
        .retain(|row| !stale_memory_ids.contains(&read_string(row.get("memoryId"))));
    stale_story_job_rows(
        collections
            .get_mut(story_jobs_collection_index)
            .ok_or_else(|| AppError::new("storage_error", "Story job collection missing"))?
            .rows_mut(),
        message_ids,
        &affected_episode_ids,
        reason,
        &now,
    )?;
    Ok(stale_count)
}

pub(crate) fn stale_story_projections_in_journaled_collections(
    collections: &mut [marinara_storage::AtomicCollectionRows],
    memory_collection_index: usize,
    story_jobs_collection_index: usize,
    message_ids: &[String],
    reason: &str,
) -> AppResult<usize> {
    if memory_collection_index >= story_jobs_collection_index {
        return Err(AppError::new(
            "storage_error",
            "Story collection order is invalid",
        ));
    }
    let (memory_collections, job_collections) =
        collections.split_at_mut(story_jobs_collection_index);
    let (affected_episode_ids, _stale_memory_ids, stale_count, now) = stale_story_memory_rows(
        memory_collections
            .get_mut(memory_collection_index)
            .ok_or_else(|| AppError::new("storage_error", "Canonical memory collection missing"))?
            .rows_mut(),
        message_ids,
        reason,
    )?;
    stale_story_job_rows(
        job_collections
            .get_mut(0)
            .ok_or_else(|| AppError::new("storage_error", "Story job collection missing"))?
            .rows_mut(),
        message_ids,
        &affected_episode_ids,
        reason,
        &now,
    )?;
    // Staling changes canonical updatedAt, so every old lexical row immediately
    // fails the canonicalUpdatedAt freshness check without rewriting its index file.
    Ok(stale_count)
}

/// Invalidates only story projections derived from edited/deleted transcript rows.
/// Atomic memories and unrelated story slots are intentionally untouched.
#[cfg(test)]
pub(crate) fn stale_story_projections_for_messages(
    state: &AppState,
    message_ids: &[String],
    reason: &str,
) -> AppResult<usize> {
    let reason = reason.to_string();
    state.storage.update_collections_atomically(
        vec![MEMORY_COLLECTION, INDEX_COLLECTION, STORY_JOBS_COLLECTION],
        move |collections| {
            stale_story_projections_in_collections(collections, 0, 1, 2, message_ids, &reason)
        },
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChatMemoryCleanupResult {
    pub deleted: usize,
    pub retained_shared: usize,
}

fn memory_source_chat_ids(memory: &Value) -> HashSet<String> {
    let mut source_chat_ids = HashSet::new();
    let scope = memory.get("scope").and_then(Value::as_object);
    if scope
        .and_then(|scope| scope.get("kind"))
        .and_then(Value::as_str)
        == Some("chat")
    {
        let scope_id = read_string(scope.and_then(|scope| scope.get("id")));
        if !scope_id.is_empty() {
            source_chat_ids.insert(scope_id);
        }
    }
    let provenance_chat_id = read_string(
        memory
            .get("provenance")
            .and_then(Value::as_object)
            .and_then(|provenance| provenance.get("sourceChatId")),
    );
    if !provenance_chat_id.is_empty() {
        source_chat_ids.insert(provenance_chat_id);
    }
    if let Some(payload_source_chat_ids) = memory
        .get("payload")
        .and_then(Value::as_object)
        .and_then(|payload| payload.get("sourceChatIds"))
        .and_then(Value::as_array)
    {
        source_chat_ids.extend(
            payload_source_chat_ids
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|source_chat_id| !source_chat_id.is_empty())
                .map(ToOwned::to_owned),
        );
    }
    source_chat_ids
}

pub(crate) fn delete_memories_learned_only_from_chats(
    state: &AppState,
    chat_ids: &HashSet<String>,
) -> AppResult<ChatMemoryCleanupResult> {
    if chat_ids.is_empty() {
        return Ok(ChatMemoryCleanupResult {
            deleted: 0,
            retained_shared: 0,
        });
    }
    let chat_ids = chat_ids.clone();
    state.storage.update_collections_atomically(
        vec![MEMORY_COLLECTION, INDEX_COLLECTION],
        move |collections| {
            let (memory_collections, index_collections) = collections.split_at_mut(1);
            let memories = memory_collections[0].rows_mut();
            let index_rows = index_collections[0].rows_mut();
            let mut deleted_memory_ids = HashSet::new();
            let mut updated_memories = Vec::new();
            let mut retained_memories = Vec::with_capacity(memories.len());
            let mut deleted = 0usize;
            let mut retained_shared = 0usize;

            for mut memory in memories.drain(..) {
                let known_sources = memory_source_chat_ids(&memory);
                if known_sources.is_empty()
                    || !known_sources.iter().any(|source| chat_ids.contains(source))
                {
                    retained_memories.push(memory);
                    continue;
                }
                let mut remaining_sources = known_sources
                    .difference(&chat_ids)
                    .cloned()
                    .collect::<Vec<_>>();
                remaining_sources.sort();
                if remaining_sources.is_empty() {
                    let memory_id = read_string(memory.get("id"));
                    if !memory_id.is_empty() {
                        deleted_memory_ids.insert(memory_id);
                    }
                    deleted += 1;
                    continue;
                }

                if let Some(provenance) =
                    memory.get_mut("provenance").and_then(Value::as_object_mut)
                {
                    let current_source = read_string(provenance.get("sourceChatId"));
                    if current_source.is_empty() || chat_ids.contains(&current_source) {
                        provenance.insert(
                            "sourceChatId".to_string(),
                            Value::String(remaining_sources[0].clone()),
                        );
                    }
                    provenance.insert("messageIds".to_string(), Value::Array(Vec::new()));
                }
                if let Some(payload) = memory.get_mut("payload").and_then(Value::as_object_mut) {
                    payload.insert(
                        "sourceChatIds".to_string(),
                        Value::Array(
                            remaining_sources
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    );
                }
                if let Some(object) = memory.as_object_mut() {
                    object.insert("updatedAt".to_string(), Value::String(now_iso()));
                }
                updated_memories.push(memory.clone());
                retained_memories.push(memory);
                retained_shared += 1;
            }

            *memories = retained_memories;
            index_rows
                .retain(|row| !deleted_memory_ids.contains(&read_string(row.get("memoryId"))));
            for memory in &updated_memories {
                replace_memory_lexical_index(index_rows, memory)?;
            }
            Ok(ChatMemoryCleanupResult {
                deleted,
                retained_shared,
            })
        },
    )
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
    let stored = state.storage.list(MEMORY_COLLECTION)?;
    let mut emitted = HashSet::new();
    let mut memories = Vec::new();
    // The request array is the batch's explicit scope ordinal. Preserve it so
    // downstream equal-score cutoffs do not inherit storage-file order.
    for query in &queries {
        for memory in &stored {
            let memory_id = read_string(memory.get("id"));
            if !memory_id.is_empty()
                && memory_allowed_by_query(memory, query)
                && emitted.insert(memory_id)
            {
                memories.push(memory.clone());
            }
        }
    }
    Ok(Value::Array(memories))
}

fn normalize_index_row(state: &AppState, mut object: Map<String, Value>) -> AppResult<Value> {
    let memory_id = require_string(&object, "memoryId")?;
    let memory = get_memory(state, &memory_id)?;
    let provider = require_string(&object, "provider")?;
    let model = require_string(&object, "model")?;
    normalize_optional_string(&mut object, "connectionId");
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
        let connection_id = read_string(object.get("connectionId"));
        let id = if connection_id.is_empty() {
            format!("{memory_id}:{provider}:{model}:{projection_hash}")
        } else {
            format!("{memory_id}:{connection_id}:{provider}:{model}:{projection_hash}")
        };
        object.insert("id".to_string(), Value::String(id));
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

fn delete_memory_index_rows_matching(
    state: &AppState,
    matches: impl Fn(&Value) -> bool,
) -> AppResult<usize> {
    state.storage.update_collections_atomically(
        vec![INDEX_COLLECTION, INDEX_METADATA_COLLECTION],
        move |collections| {
            let (index_collections, metadata_collections) = collections.split_at_mut(1);
            let index_rows = index_collections[0].rows_mut();
            let before = index_rows.len();
            index_rows.retain(|row| !matches(row));
            let deleted = before.saturating_sub(index_rows.len());
            if deleted > 0 {
                metadata_collections[0]
                    .rows_mut()
                    .retain(|row| read_string(row.get("id")) != INDEX_HEALTH_ID);
            }
            Ok(deleted)
        },
    )
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
    let deleted = delete_memory_index_rows_matching(state, |row| {
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
    let deleted = delete_memory_index_rows_matching(state, |row| {
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

fn sha256_hash(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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

fn memory_is_lexically_indexed(memory: &Value) -> bool {
    matches!(
        memory.get("status").and_then(Value::as_str),
        Some("active" | "pinned")
    )
}

fn lexical_index_row(memory: &Value) -> AppResult<Value> {
    let memory_id = read_string(memory.get("id"));
    if memory_id.is_empty() {
        return Err(AppError::invalid_input("canonical memory id is required"));
    }
    let canonical_updated_at = read_string(memory.get("updatedAt"));
    if canonical_updated_at.is_empty() {
        return Err(AppError::invalid_input(
            "canonical memory updatedAt is required",
        ));
    }
    let content = read_string(memory.get("content"));
    let tokens = lexical_tokens(&content);
    let projection_hash = sha256_hash(&format!("{}:{}", memory_id, tokens.join(" ")));
    Ok(json!({
        "id": format!("{memory_id}:lexical:{projection_hash}"),
        "memoryId": memory_id,
        "provider": LEXICAL_PROVIDER,
        "model": LEXICAL_MODEL,
        "dimensions": LEXICAL_DIMENSIONS,
        "contentHash": sha256_hash(&content),
        "projectionHash": projection_hash,
        "canonicalUpdatedAt": canonical_updated_at,
        "lexicalTokens": tokens,
        "vector": lexical_vector(&tokens)
    }))
}

pub(crate) fn replace_memory_lexical_index(
    index_rows: &mut Vec<Value>,
    memory: &Value,
) -> AppResult<()> {
    let memory_id = read_string(memory.get("id"));
    index_rows.retain(|row| {
        read_string(row.get("memoryId")) != memory_id
            || read_string(row.get("provider")) != LEXICAL_PROVIDER
            || read_string(row.get("model")) != LEXICAL_MODEL
    });
    if memory_is_lexically_indexed(memory) {
        index_rows.push(lexical_index_row(memory)?);
    }
    Ok(())
}

pub(crate) fn rebuild_memory_lexical_index(state: &AppState, body: Value) -> AppResult<Value> {
    let body = if body.is_null() { json!({}) } else { body };
    if !body.is_object() {
        return Err(AppError::invalid_input(
            "memory index rebuild body must be an object",
        ));
    }
    let full_rebuild = body.as_object().is_some_and(Map::is_empty);
    let collections = if full_rebuild {
        vec![
            MEMORY_COLLECTION,
            INDEX_COLLECTION,
            INDEX_METADATA_COLLECTION,
        ]
    } else {
        vec![MEMORY_COLLECTION, INDEX_COLLECTION]
    };
    let rebuilt = state
        .storage
        .update_collections_atomically(collections, move |collections| {
            let (memory_collections, index_collections) = collections.split_at_mut(1);
            let rows = memory_collections[0]
                .rows()
                .iter()
                .filter(|memory| memory_allowed_by_query(memory, &body))
                .cloned()
                .collect::<Vec<_>>();
            let index_rows = index_collections[0].rows_mut();
            if full_rebuild {
                index_rows.retain(|row| {
                    read_string(row.get("provider")) != LEXICAL_PROVIDER
                        || read_string(row.get("model")) != LEXICAL_MODEL
                });
            }
            for memory in &rows {
                if read_string(memory.get("id")).is_empty() {
                    continue;
                }
                replace_memory_lexical_index(index_rows, memory)?;
            }
            if full_rebuild {
                let metadata_rows = index_collections[1].rows_mut();
                metadata_rows.retain(|row| read_string(row.get("id")) != INDEX_HEALTH_ID);
                metadata_rows.push(json!({
                    "id": INDEX_HEALTH_ID,
                    "version": 1,
                    "lexicalComplete": true,
                    "updatedAt": now_iso()
                }));
            }
            Ok(rows.len())
        })?;
    Ok(json!({ "rebuilt": rebuilt }))
}

pub(crate) fn memory_index_health(state: &AppState) -> AppResult<Value> {
    Ok(state
        .storage
        .get(INDEX_METADATA_COLLECTION, INDEX_HEALTH_ID)?
        .map(|row| {
            json!({
                "version": 1,
                "lexicalComplete": row
                    .get("lexicalComplete")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
        })
        .unwrap_or_else(|| json!({ "version": 1, "lexicalComplete": false })))
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
        if memory_id.is_empty() || seen.contains(&memory_id) {
            continue;
        }
        let Ok(memory) = get_memory(state, &memory_id) else {
            continue;
        };
        if memory.get("updatedAt") != row.get("canonicalUpdatedAt") {
            continue;
        }
        seen.insert(memory_id);
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
    let mut indexed = Vec::new();
    for row in state.storage.list(INDEX_COLLECTION)? {
        let memory_id = read_string(row.get("memoryId"));
        if memory_id.is_empty() || seen.contains(&memory_id) {
            continue;
        }
        let Ok(memory) = get_memory(state, &memory_id) else {
            continue;
        };
        if memory.get("updatedAt") != row.get("canonicalUpdatedAt") {
            continue;
        }
        seen.insert(memory_id);
        indexed.push(memory);
    }
    let mut emitted = HashSet::new();
    let mut memories = Vec::new();
    // Match `query_memories_batch`: scope-query order, not index storage order,
    // is the stable tie-break contract for a mixed-scope batch.
    for query in &queries {
        for memory in &indexed {
            let memory_id = read_string(memory.get("id"));
            if !memory_id.is_empty()
                && memory_allowed_by_query(memory, query)
                && emitted.insert(memory_id)
            {
                memories.push(memory.clone());
            }
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

    fn seed_story_projection(
        state: &AppState,
        id: &str,
        level: &str,
        message_ids: &[&str],
        source_episode_ids: &[&str],
    ) -> Value {
        create_memory(
            state,
            json!({
                "id": id,
                "kind": if level == "episode" { "episode" } else { "summary" },
                "status": "active",
                "scope": { "kind": "chat", "id": "chat-1" },
                "content": format!("{id} story projection"),
                "confidence": 0.9,
                "provenance": { "sourceChatId": "chat-1", "messageIds": message_ids },
                "tags": ["story-continuity", level],
                "payload": {
                    "storyProjectionVersion": 1,
                    "level": level,
                    "ownerChatId": "chat-1",
                    "coverageId": format!("{id}-coverage"),
                    "sourceFingerprint": format!("{id}-fingerprint"),
                    "messageIds": message_ids,
                    "firstMessageId": message_ids.first().copied().unwrap_or(""),
                    "lastMessageId": message_ids.last().copied().unwrap_or(""),
                    "sourceEpisodeIds": source_episode_ids,
                    "sections": {},
                    "summarizer": { "version": "story-projection-v1", "completedAt": "2026-08-27T00:00:00Z" }
                }
            }),
        )
        .unwrap()
    }

    #[test]
    fn source_mutation_stales_only_affected_story_chain_and_queued_jobs() {
        let state = test_state("story-source-invalidation");
        seed_memory(&state, "atomic-fact", "chat", "chat-1", "active");
        seed_story_projection(&state, "episode-affected", "episode", &["message-1"], &[]);
        seed_story_projection(&state, "episode-other", "episode", &["message-2"], &[]);
        seed_story_projection(
            &state,
            "arc-affected",
            "arc",
            &["message-1"],
            &["episode-affected"],
        );
        state
            .storage
            .create(
                STORY_JOBS_COLLECTION,
                json!({
                    "id": "story-job",
                    "status": "pending",
                    "sourceMessageIds": ["message-1"],
                    "sourceEpisodeIds": []
                }),
            )
            .unwrap();

        let stale = stale_story_projections_for_messages(
            &state,
            &["message-1".to_string()],
            "source_message_edited",
        )
        .unwrap();

        assert_eq!(stale, 2);
        assert_eq!(
            get_memory(&state, "atomic-fact").unwrap()["status"],
            json!("active")
        );
        assert_eq!(
            get_memory(&state, "episode-affected").unwrap()["status"],
            json!("stale")
        );
        assert_eq!(
            get_memory(&state, "arc-affected").unwrap()["status"],
            json!("stale")
        );
        assert_eq!(
            get_memory(&state, "episode-other").unwrap()["status"],
            json!("active")
        );
        let indexed = state.storage.list(INDEX_COLLECTION).unwrap();
        let indexed_ids = indexed
            .iter()
            .filter_map(|row| row.get("memoryId").and_then(Value::as_str))
            .collect::<HashSet<_>>();
        assert!(indexed_ids.contains("atomic-fact"));
        assert!(indexed_ids.contains("episode-other"));
        assert!(!indexed_ids.contains("episode-affected"));
        assert!(!indexed_ids.contains("arc-affected"));
        assert_eq!(
            state
                .storage
                .get(STORY_JOBS_COLLECTION, "story-job")
                .unwrap()
                .unwrap()["status"],
            json!("stale")
        );
    }

    #[test]
    fn story_overlap_requires_same_slot_supersession_and_cascades_arcs() {
        let state = test_state("story-overlap");
        seed_story_projection(&state, "episode-original", "episode", &["message-1"], &[]);
        seed_story_projection(
            &state,
            "arc-original",
            "arc",
            &["message-1"],
            &["episode-original"],
        );
        let conflicting = json!({
            "id": "episode-conflict",
            "kind": "episode",
            "status": "active",
            "scope": { "kind": "chat", "id": "chat-1" },
            "content": "Conflicting projection",
            "confidence": 0.9,
            "provenance": { "sourceChatId": "chat-1", "messageIds": ["message-1"] },
            "payload": {
                "storyProjectionVersion": 1,
                "level": "episode",
                "coverageId": "different-coverage",
                "messageIds": ["message-1"],
                "sourceEpisodeIds": []
            }
        });
        assert!(create_memory(&state, conflicting).is_err());

        let replacement = create_memory(
            &state,
            json!({
                "id": "episode-replacement",
                "kind": "episode",
                "status": "active",
                "scope": { "kind": "chat", "id": "chat-1" },
                "content": "Regenerated projection",
                "confidence": 0.9,
                "provenance": { "sourceChatId": "chat-1", "messageIds": ["message-1"] },
                "supersedesMemoryId": "episode-original",
                "payload": {
                    "storyProjectionVersion": 1,
                    "level": "episode",
                    "coverageId": "episode-original-coverage",
                    "messageIds": ["message-1"],
                    "sourceEpisodeIds": []
                }
            }),
        )
        .unwrap();
        assert_eq!(replacement["status"], json!("active"));

        update_memory(
            &state,
            "episode-original",
            json!({ "status": "superseded", "supersededByMemoryId": "episode-replacement" }),
        )
        .unwrap();
        assert_eq!(
            get_memory(&state, "arc-original").unwrap()["status"],
            json!("stale")
        );
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
        let refreshed_index = state.storage.list("memory-index-rows").unwrap();
        assert_eq!(refreshed_index.len(), 1);
        assert_eq!(
            refreshed_index[0]["canonicalUpdatedAt"],
            updated["updatedAt"]
        );

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
        let maintenance_jobs = state.storage.list("memory-maintenance-jobs").unwrap();
        assert_eq!(maintenance_jobs.len(), 1);
        assert_eq!(
            maintenance_jobs[0]["targetKey"],
            json!("canonical:chat:chat-1")
        );
    }

    #[test]
    fn creating_active_memory_builds_its_lexical_index() {
        let state = test_state("atomic-create-index");
        seed_memory(
            &state,
            "memory-active",
            "character",
            "character-1",
            "active",
        );
        seed_memory(&state, "memory-stale", "character", "character-1", "stale");

        let indexed = query_memory_index(
            &state,
            json!({ "scope": { "kind": "character", "id": "character-1" } }),
        )
        .expect("active memory should be indexed without an explicit rebuild");

        assert_eq!(ids(&indexed), vec!["memory-active"]);
    }

    #[test]
    fn updating_one_memory_keeps_both_memories_indexed() {
        let state = test_state("atomic-update-index");
        seed_memory(&state, "memory-one", "character", "character-1", "active");
        seed_memory(&state, "memory-two", "character", "character-1", "active");

        update_memory(
            &state,
            "memory-one",
            json!({ "content": "Mira now keeps the silver key under the clock." }),
        )
        .expect("memory update should succeed");

        let indexed = query_memory_index(
            &state,
            json!({ "scope": { "kind": "character", "id": "character-1" } }),
        )
        .expect("both active memories should remain indexed");

        let mut indexed_ids = ids(&indexed);
        indexed_ids.sort();
        assert_eq!(indexed_ids, vec!["memory-one", "memory-two"]);
        assert_eq!(
            indexed
                .as_array()
                .and_then(|rows| rows.iter().find(|row| row["id"] == json!("memory-one")))
                .map(|row| row["content"].clone()),
            Some(json!("Mira now keeps the silver key under the clock."))
        );
    }

    #[test]
    fn batch_queries_return_the_union_of_requested_scopes_once() {
        let state = test_state("batch-query-scopes");
        seed_memory(&state, "memory-chat", "chat", "chat-1", "active");
        seed_memory(
            &state,
            "memory-character",
            "character",
            "character-1",
            "active",
        );
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
    fn batch_queries_preserve_requested_scope_ordinal_over_storage_order() {
        let state = test_state("batch-query-scope-ordinal");
        seed_memory(
            &state,
            "memory-character",
            "character",
            "character-1",
            "active",
        );
        seed_memory(&state, "memory-chat", "chat", "chat-1", "active");

        let rows = query_memories_batch(
            &state,
            json!({
                "queries": [
                    { "scope": { "kind": "chat", "id": "chat-1" } },
                    { "scope": { "kind": "character", "id": "character-1" } }
                ]
            }),
        )
        .expect("ordered batch scope query should succeed");

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
        delete_memory_index_rows_for_memory(&state, "memory-changed")
            .expect("current projection should be removable for the stale-row fixture");

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
    fn index_query_prefers_a_fresh_row_after_a_stale_row_for_the_same_memory() {
        let state = test_state("index-query-stale-before-fresh");
        let memory = seed_memory(&state, "memory-one", "chat", "chat-1", "active");
        delete_memory_index_rows_for_memory(&state, "memory-one")
            .expect("generated lexical projection should be removable");
        for (id, canonical_updated_at) in [
            ("index-stale", json!("stale-canonical-updated-at")),
            ("index-fresh", memory["updatedAt"].clone()),
        ] {
            upsert_memory_index_row(
                &state,
                json!({
                    "id": id,
                    "memoryId": "memory-one",
                    "provider": "lexical",
                    "model": "de-koi-lexical-v1",
                    "dimensions": 64,
                    "contentHash": format!("{id}-content"),
                    "projectionHash": format!("{id}-projection"),
                    "canonicalUpdatedAt": canonical_updated_at,
                    "vector": [0.2, 0.4]
                }),
            )
            .expect("index row should seed");
        }

        let query = json!({ "scope": { "kind": "chat", "id": "chat-1" } });
        assert_eq!(
            ids(&query_memory_index(&state, query.clone()).unwrap()),
            ["memory-one"]
        );
        assert_eq!(
            ids(&query_memory_index_batch(&state, json!({ "queries": [query] })).unwrap()),
            ["memory-one"]
        );
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
        assert!(rows.iter().all(|row| row["contentHash"]
            .as_str()
            .is_some_and(|hash| hash.len() == 64)));
        assert!(rows.iter().all(|row| row["projectionHash"]
            .as_str()
            .is_some_and(|hash| hash.len() == 64)));
    }

    #[test]
    fn full_lexical_rebuild_marks_the_index_complete() {
        let state = test_state("full-lexical-rebuild-health");
        seed_memory(&state, "memory-one", "chat", "chat-1", "active");

        assert_eq!(
            memory_index_health(&state).unwrap()["lexicalComplete"],
            false
        );
        rebuild_memory_lexical_index(
            &state,
            json!({ "scope": { "kind": "chat", "id": "chat-1" } }),
        )
        .unwrap();
        assert_eq!(
            memory_index_health(&state).unwrap()["lexicalComplete"],
            false
        );

        rebuild_memory_lexical_index(&state, json!({})).unwrap();
        assert_eq!(
            memory_index_health(&state).unwrap()["lexicalComplete"],
            true
        );
    }

    #[test]
    fn deleting_index_rows_invalidates_complete_health() {
        let state = test_state("delete-index-invalidates-health");
        seed_memory(&state, "memory-one", "chat", "chat-1", "active");
        rebuild_memory_lexical_index(&state, json!({})).unwrap();
        assert_eq!(
            memory_index_health(&state).unwrap()["lexicalComplete"],
            true
        );

        delete_memory_index_rows_for_memory(&state, "memory-one").unwrap();

        assert_eq!(
            memory_index_health(&state).unwrap()["lexicalComplete"],
            false
        );
    }

    #[test]
    fn lexical_rebuild_preserves_provider_semantic_rows() {
        let state = test_state("lexical-rebuild-preserves-semantic");
        let memory = seed_memory(&state, "memory-one", "character", "character-1", "active");
        upsert_memory_index_row(
            &state,
            json!({
                "id": "memory-one:semantic:embedding-connection:text-embedding-3-small",
                "memoryId": "memory-one",
                "connectionId": "embedding-connection",
                "provider": "openai",
                "model": "text-embedding-3-small",
                "dimensions": 3,
                "contentHash": "semantic-content",
                "projectionHash": "semantic-projection",
                "canonicalUpdatedAt": memory["updatedAt"],
                "vector": [1.0, 0.0, 0.0]
            }),
        )
        .expect("semantic fixture should be stored");

        rebuild_memory_lexical_index(
            &state,
            json!({ "scope": { "kind": "character", "id": "character-1" } }),
        )
        .expect("lexical rebuild should succeed");

        let rows = state.storage.list(INDEX_COLLECTION).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .any(|row| row["provider"] == json!(LEXICAL_PROVIDER)));
        assert!(rows.iter().any(|row| {
            row["provider"] == json!("openai")
                && row["connectionId"] == json!("embedding-connection")
                && row["model"] == json!("text-embedding-3-small")
        }));
    }

    #[test]
    fn generated_index_ids_preserve_legacy_shape_without_a_connection() {
        let state = test_state("generated-index-id-compatibility");
        let memory = seed_memory(&state, "memory-one", "character", "character-1", "active");

        let row = upsert_memory_index_row(
            &state,
            json!({
                "memoryId": "memory-one",
                "provider": "lexical",
                "model": "de-koi-lexical-v1",
                "dimensions": 64,
                "contentHash": "content-hash",
                "projectionHash": "projection-hash",
                "canonicalUpdatedAt": memory["updatedAt"],
                "lexicalTokens": ["fact"]
            }),
        )
        .expect("legacy index row should be stored");

        assert_eq!(
            row["id"],
            json!("memory-one:lexical:de-koi-lexical-v1:projection-hash")
        );
    }

    #[test]
    fn delete_memories_learned_only_from_chats_removes_exclusive_sources_and_indexes() {
        let state = test_state("delete-exclusive-chat-sources");
        seed_memory(
            &state,
            "memory-active",
            "character",
            "character-1",
            "active",
        );
        seed_memory(
            &state,
            "memory-pinned",
            "character",
            "character-1",
            "pinned",
        );
        create_memory(
            &state,
            json!({
                "id": "memory-manual",
                "kind": "fact",
                "status": "active",
                "scope": { "kind": "character", "id": "character-1" },
                "content": "Mira prefers jasmine tea.",
                "confidence": 1.0,
                "provenance": { "characterId": "character-1" }
            }),
        )
        .unwrap();

        let result =
            delete_memories_learned_only_from_chats(&state, &HashSet::from(["chat-1".to_string()]))
                .unwrap();

        assert_eq!(
            result,
            ChatMemoryCleanupResult {
                deleted: 2,
                retained_shared: 0
            }
        );
        assert!(get_memory(&state, "memory-active").is_err());
        assert!(get_memory(&state, "memory-pinned").is_err());
        assert_eq!(
            get_memory(&state, "memory-manual").unwrap()["status"],
            "active"
        );
        let indexed_ids = state
            .storage
            .list(INDEX_COLLECTION)
            .unwrap()
            .into_iter()
            .filter_map(|row| row["memoryId"].as_str().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        assert_eq!(indexed_ids, vec!["memory-manual"]);
    }

    #[test]
    fn delete_memories_learned_only_from_chats_retains_shared_memory_without_deleted_provenance() {
        let state = test_state("delete-shared-chat-sources");
        let created = create_memory(
            &state,
            json!({
                "id": "memory-shared",
                "kind": "fact",
                "status": "active",
                "scope": { "kind": "character", "id": "character-1" },
                "content": "Mira keeps the silver key under the clock.",
                "confidence": 0.9,
                "provenance": {
                    "sourceChatId": "chat-1",
                    "messageIds": ["message-1"],
                    "characterId": "character-1"
                },
                "payload": { "sourceChatIds": ["chat-2", "chat-1"] }
            }),
        )
        .unwrap();
        upsert_memory_index_row(
            &state,
            json!({
                "id": "memory-shared:stale",
                "memoryId": "memory-shared",
                "provider": "lexical",
                "model": "de-koi-lexical-v1",
                "dimensions": 64,
                "contentHash": "stale-content",
                "projectionHash": "stale-projection",
                "canonicalUpdatedAt": created["updatedAt"],
                "vector": [0.1]
            }),
        )
        .unwrap();

        let result =
            delete_memories_learned_only_from_chats(&state, &HashSet::from(["chat-1".to_string()]))
                .unwrap();

        assert_eq!(
            result,
            ChatMemoryCleanupResult {
                deleted: 0,
                retained_shared: 1
            }
        );
        let retained = get_memory(&state, "memory-shared").unwrap();
        assert_eq!(retained["provenance"]["sourceChatId"], "chat-2");
        assert_eq!(retained["provenance"]["messageIds"], json!([]));
        assert_eq!(retained["payload"]["sourceChatIds"], json!(["chat-2"]));
        assert_ne!(retained["updatedAt"], created["updatedAt"]);
        let rows = state.storage.list(INDEX_COLLECTION).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["memoryId"], "memory-shared");
        assert_eq!(rows[0]["canonicalUpdatedAt"], retained["updatedAt"]);
        assert_ne!(rows[0]["id"], "memory-shared:stale");
        assert_ne!(rows[0]["contentHash"], "stale-content");
        assert_ne!(rows[0]["projectionHash"], "stale-projection");
    }
}
