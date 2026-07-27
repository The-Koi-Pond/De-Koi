use super::contracts::{
    ApplyCleanupRequest, CleanupProposal, CleanupScope, ExpectedState, ProposalType,
    UndoCleanupRequest,
};
use crate::state::AppState;
use crate::storage_commands::canonical_memory;
use marinara_core::{new_id, now_iso, AppError, AppResult};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn payload(memory: &Value) -> Option<&Map<String, Value>> {
    memory.get("payload").and_then(Value::as_object)
}

fn cleanup_metadata(memory: &Value) -> Option<&Map<String, Value>> {
    payload(memory)?
        .get("memoryCleanup")
        .and_then(Value::as_object)
}

fn is_cleanup_replacement(memory: &Value) -> bool {
    cleanup_metadata(memory)
        .and_then(|metadata| metadata.get("role"))
        .and_then(Value::as_str)
        == Some("replacement")
}

fn is_automatic(memory: &Value) -> bool {
    payload(memory)
        .and_then(|payload| payload.get("automatic"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn is_imported(memory: &Value) -> bool {
    has_tag(memory, "imported")
        || payload(memory)
            .and_then(|payload| payload.get("importedFromMemoryId"))
            .and_then(Value::as_str)
            .is_some_and(|id| !id.trim().is_empty())
}

fn has_tag(memory: &Value, expected: &str) -> bool {
    memory
        .get("tags")
        .and_then(Value::as_array)
        .is_some_and(|tags| tags.iter().any(|tag| tag.as_str() == Some(expected)))
}

fn canonical_memory_belongs_to_scope(memory: &Value, scope: &CleanupScope) -> bool {
    memory
        .get("scope")
        .and_then(Value::as_object)
        .is_some_and(|memory_scope| {
            memory_scope.get("kind").and_then(Value::as_str) == Some("character")
                && memory_scope.get("id").and_then(Value::as_str) == Some(scope.id.as_str())
        })
}

fn canonical_memory_is_cleanup_eligible(memory: &Value, scope: &CleanupScope) -> bool {
    canonical_memory_belongs_to_scope(memory, scope)
        && memory.get("status").and_then(Value::as_str) == Some("active")
        && (is_automatic(memory) || is_cleanup_replacement(memory))
        && !canonical_user_edited(memory)
        && !has_tag(memory, "manual")
        && !is_imported(memory)
}

fn canonical_user_edited(memory: &Value) -> bool {
    payload(memory)
        .and_then(|payload| payload.get("userEdited"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || (!is_automatic(memory) && !is_cleanup_replacement(memory))
}

fn expected_state_matches(memory: &Value, expected: &ExpectedState) -> bool {
    value_string(memory, "content").as_deref() == Some(expected.content.trim())
        && value_string(memory, "status").as_deref() == Some(expected.status.trim())
        && value_string(memory, "updatedAt") == expected.updated_at
        && (memory.get("status").and_then(Value::as_str) == Some("pinned")) == expected.pinned
        && canonical_user_edited(memory) == expected.user_edited
}

fn memory_by_id<'a>(memories: &'a [Value], id: &str) -> AppResult<&'a Value> {
    memories
        .iter()
        .find(|memory| memory.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| AppError::not_found(format!("Canonical memory {id} was not found")))
}

fn memory_by_id_mut<'a>(memories: &'a mut [Value], id: &str) -> AppResult<&'a mut Value> {
    memories
        .iter_mut()
        .find(|memory| memory.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| AppError::not_found(format!("Canonical memory {id} was not found")))
}

fn validate_referenced_memories(
    memories: &[Value],
    scope: &CleanupScope,
    proposal: &CleanupProposal,
) -> AppResult<()> {
    for source_id in &proposal.source_ids {
        let source = memory_by_id(memories, source_id)?;
        if !canonical_memory_is_cleanup_eligible(source, scope) {
            return Err(AppError::invalid_input(format!(
                "Canonical memory {source_id} is protected or outside this cleanup scope"
            )));
        }
        if !proposal
            .expected
            .get(source_id)
            .is_some_and(|expected| expected_state_matches(source, expected))
        {
            return Err(AppError::invalid_input(
                "Some memories changed after this cleanup preview was created",
            ));
        }
    }
    if let Some(winner_id) = proposal.winner_id.as_deref() {
        let winner = memory_by_id(memories, winner_id)?;
        if !canonical_memory_belongs_to_scope(winner, scope)
            || !proposal
                .expected
                .get(winner_id)
                .is_some_and(|expected| expected_state_matches(winner, expected))
        {
            return Err(AppError::invalid_input(
                "Cleanup winner changed or is outside this character",
            ));
        }
    }
    Ok(())
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn build_replacement(
    memories: &[Value],
    scope: &CleanupScope,
    proposal: &CleanupProposal,
    batch_id: &str,
    applied_at: &str,
) -> AppResult<Option<Value>> {
    if !matches!(
        proposal.proposal_type,
        ProposalType::Combine | ProposalType::Shorten
    ) {
        return Ok(None);
    }
    let replacement = proposal
        .replacement
        .as_ref()
        .ok_or_else(|| AppError::invalid_input("Cleanup replacement is required"))?;
    let sources = proposal
        .source_ids
        .iter()
        .map(|id| memory_by_id(memories, id))
        .collect::<AppResult<Vec<_>>>()?;
    let kinds = sources
        .iter()
        .filter_map(|memory| memory.get("kind").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    let kind = if kinds.len() == 1 {
        kinds.into_iter().next().unwrap_or("summary")
    } else {
        "summary"
    };
    let confidence = sources
        .iter()
        .filter_map(|memory| memory.get("confidence").and_then(Value::as_f64))
        .fold(0.0_f64, f64::max);
    let mut message_ids = HashSet::new();
    let mut source_chat_ids = HashSet::new();
    for source in &sources {
        let provenance = source.get("provenance").and_then(Value::as_object);
        message_ids.extend(string_array(
            provenance.and_then(|value| value.get("messageIds")),
        ));
        if let Some(source_chat_id) = provenance
            .and_then(|value| value.get("sourceChatId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            source_chat_ids.insert(source_chat_id.to_string());
        }
        source_chat_ids.extend(string_array(
            payload(source).and_then(|value| value.get("sourceChatIds")),
        ));
    }
    let mut message_ids = message_ids.into_iter().collect::<Vec<_>>();
    message_ids.sort();
    let mut source_chat_ids = source_chat_ids.into_iter().collect::<Vec<_>>();
    source_chat_ids.sort();
    let source_chat_id = source_chat_ids.first().cloned();
    // Cleanup creates a new canonical record at apply time. The source chat
    // provenance remains separate so its historical timestamps are not forged
    // into the replacement's lifecycle timestamps.
    Ok(Some(json!({
        "id": new_id(),
        "kind": kind,
        "status": "active",
        "scope": { "kind": "character", "id": scope.id },
        "content": replacement.content.trim(),
        "confidence": confidence,
        "provenance": {
            "sourceChatId": source_chat_id,
            "messageIds": message_ids,
            "characterId": scope.id,
            "timestamp": applied_at
        },
        "title": null,
        "tags": ["automatic", "memory_cleanup"],
        "supersedesMemoryId": null,
        "supersededByMemoryId": null,
        "payload": {
            "automatic": true,
            "sourceChatIds": source_chat_ids,
            "memoryCleanup": {
                "batchId": batch_id,
                "role": "replacement",
                "sourceIds": proposal.source_ids,
                "appliedAt": applied_at
            }
        },
        "createdAt": applied_at,
        "updatedAt": applied_at
    })))
}

fn source_cleanup_metadata(
    batch_id: &str,
    applied_at: &str,
    previous_status: &str,
    previous_updated_at: Option<String>,
    previous_superseded_by: Option<String>,
) -> Value {
    json!({
        "batchId": batch_id,
        "role": "source",
        "appliedAt": applied_at,
        "previousStatus": previous_status,
        "previousUpdatedAt": previous_updated_at,
        "previousSupersededByMemoryId": previous_superseded_by
    })
}

pub(crate) fn apply_canonical_cleanup(
    state: &AppState,
    request: ApplyCleanupRequest,
) -> AppResult<Value> {
    if request.scope.kind != "character" {
        return Err(AppError::invalid_input(
            "Canonical cleanup requires a character scope",
        ));
    }
    let batch_id = new_id();
    let applied_at = now_iso();
    let batch_id_for_write = batch_id.clone();
    let applied_at_for_write = applied_at.clone();
    state.storage.update_collections_atomically(
        vec!["canonical-memories", "memory-index-rows"],
        move |collections| {
            let (memory_collections, index_collections) = collections.split_at_mut(1);
            let memories = memory_collections[0].rows_mut();
            let index_rows = index_collections[0].rows_mut();
            let selected = request
                .proposals
                .iter()
                .filter(|proposal| {
                    proposal.selected && proposal.proposal_type != ProposalType::Conflict
                })
                .collect::<Vec<_>>();
            for proposal in &selected {
                validate_referenced_memories(memories, &request.scope, proposal)?;
            }
            let replacements = selected
                .iter()
                .map(|proposal| {
                    build_replacement(
                        memories,
                        &request.scope,
                        proposal,
                        &batch_id_for_write,
                        &applied_at_for_write,
                    )
                    .map(|replacement| (proposal.id.as_str(), replacement))
                })
                .collect::<AppResult<Vec<_>>>()?;
            let mut combined = 0usize;
            let mut shortened = 0usize;
            let mut superseded = 0usize;
            let mut created = 0usize;
            for proposal in selected {
                let replacement = replacements
                    .iter()
                    .find(|(proposal_id, _)| *proposal_id == proposal.id)
                    .and_then(|(_, replacement)| replacement.clone());
                let superseded_by = replacement
                    .as_ref()
                    .and_then(|memory| memory.get("id"))
                    .and_then(Value::as_str)
                    .or(proposal.winner_id.as_deref())
                    .ok_or_else(|| {
                        AppError::invalid_input("Cleanup proposal has no retained result")
                    })?
                    .to_string();
                for source_id in &proposal.source_ids {
                    let source = memory_by_id_mut(memories, source_id)?;
                    let previous_status =
                        value_string(source, "status").unwrap_or_else(|| "active".to_string());
                    let previous_updated_at = value_string(source, "updatedAt");
                    let previous_superseded_by = value_string(source, "supersededByMemoryId");
                    let source_object = source.as_object_mut().ok_or_else(|| {
                        AppError::invalid_input("Stored canonical memory is not an object")
                    })?;
                    let source_payload = source_object
                        .entry("payload".to_string())
                        .or_insert_with(|| json!({}))
                        .as_object_mut()
                        .ok_or_else(|| {
                            AppError::invalid_input("Canonical memory payload is not an object")
                        })?;
                    source_payload.insert(
                        "memoryCleanup".to_string(),
                        source_cleanup_metadata(
                            &batch_id_for_write,
                            &applied_at_for_write,
                            &previous_status,
                            previous_updated_at,
                            previous_superseded_by,
                        ),
                    );
                    source_object.insert("status".to_string(), json!("superseded"));
                    source_object.insert("supersededByMemoryId".to_string(), json!(superseded_by));
                    source_object.insert("updatedAt".to_string(), json!(applied_at_for_write));
                    let changed = Value::Object(source_object.clone());
                    canonical_memory::replace_memory_lexical_index(index_rows, &changed)?;
                    superseded += 1;
                }
                if let Some(replacement) = replacement {
                    canonical_memory::replace_memory_lexical_index(index_rows, &replacement)?;
                    memories.push(replacement);
                    created += 1;
                }
                match proposal.proposal_type {
                    ProposalType::Combine => combined += 1,
                    ProposalType::Shorten => shortened += 1,
                    ProposalType::KeepOne | ProposalType::Conflict => {}
                }
            }
            Ok(json!({
                "batchId": batch_id_for_write,
                "combined": combined,
                "shortened": shortened,
                "superseded": superseded,
                "created": created
            }))
        },
    )
}

pub(crate) fn undo_canonical_cleanup(
    state: &AppState,
    request: UndoCleanupRequest,
) -> AppResult<Value> {
    if request.scope.kind != "character" {
        return Err(AppError::invalid_input(
            "Canonical cleanup undo requires a character scope",
        ));
    }
    let batch_id = request.batch_id.clone();
    let scope = request.scope.clone();
    state.storage.update_collections_atomically(
        vec!["canonical-memories", "memory-index-rows"],
        move |collections| {
            let (memory_collections, index_collections) = collections.split_at_mut(1);
            let memories = memory_collections[0].rows_mut();
            let index_rows = index_collections[0].rows_mut();
            let source_ids = memories
                .iter()
                .filter(|memory| {
                    canonical_memory_belongs_to_scope(memory, &scope)
                        && cleanup_metadata(memory)
                            .and_then(|metadata| metadata.get("batchId"))
                            .and_then(Value::as_str)
                            == Some(batch_id.as_str())
                        && cleanup_metadata(memory)
                            .and_then(|metadata| metadata.get("role"))
                            .and_then(Value::as_str)
                            == Some("source")
                })
                .filter_map(|memory| value_string(memory, "id"))
                .collect::<Vec<_>>();
            let replacement_ids = memories
                .iter()
                .filter(|memory| {
                    canonical_memory_belongs_to_scope(memory, &scope)
                        && cleanup_metadata(memory)
                            .and_then(|metadata| metadata.get("batchId"))
                            .and_then(Value::as_str)
                            == Some(batch_id.as_str())
                        && cleanup_metadata(memory)
                            .and_then(|metadata| metadata.get("role"))
                            .and_then(Value::as_str)
                            == Some("replacement")
                })
                .filter_map(|memory| value_string(memory, "id"))
                .collect::<Vec<_>>();
            if source_ids.is_empty() && replacement_ids.is_empty() {
                return Err(AppError::not_found("Memory cleanup batch was not found"));
            }
            for id in source_ids.iter().chain(replacement_ids.iter()) {
                let memory = memory_by_id(memories, id)?;
                let applied_at = cleanup_metadata(memory)
                    .and_then(|metadata| metadata.get("appliedAt"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if applied_at.is_empty()
                    || memory.get("updatedAt").and_then(Value::as_str) != Some(applied_at)
                {
                    return Err(AppError::invalid_input(
                        "Memory cleanup cannot be undone because a changed memory is involved",
                    ));
                }
            }
            if source_ids.iter().any(|id| {
                memory_by_id(memories, id)
                    .ok()
                    .and_then(|memory| memory.get("status"))
                    .and_then(Value::as_str)
                    != Some("superseded")
            }) || replacement_ids.iter().any(|id| {
                memory_by_id(memories, id)
                    .ok()
                    .and_then(|memory| memory.get("status"))
                    .and_then(Value::as_str)
                    != Some("active")
            }) {
                return Err(AppError::invalid_input(
                    "Memory cleanup cannot be undone because its records changed",
                ));
            }

            let undo_at = now_iso();
            for id in &source_ids {
                let memory = memory_by_id_mut(memories, id)?;
                let metadata = cleanup_metadata(memory).cloned().ok_or_else(|| {
                    AppError::invalid_input("Canonical cleanup metadata is missing")
                })?;
                let previous_status = metadata
                    .get("previousStatus")
                    .and_then(Value::as_str)
                    .unwrap_or("active")
                    .to_string();
                let previous_updated_at = metadata.get("previousUpdatedAt").cloned();
                let previous_superseded_by = metadata.get("previousSupersededByMemoryId").cloned();
                // Canonical rows require updatedAt. Legacy rows without a saved
                // value fall back through durable row/batch time before undo time.
                let fallback_updated_at = value_string(memory, "createdAt")
                    .or_else(|| {
                        metadata
                            .get("appliedAt")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                    })
                    .unwrap_or_else(|| undo_at.clone());
                let object = memory.as_object_mut().ok_or_else(|| {
                    AppError::invalid_input("Stored canonical memory is not an object")
                })?;
                object.insert("status".to_string(), json!(previous_status));
                match previous_updated_at {
                    Some(Value::String(value)) => {
                        object.insert("updatedAt".to_string(), Value::String(value));
                    }
                    _ => {
                        object.insert("updatedAt".to_string(), json!(fallback_updated_at));
                    }
                }
                match previous_superseded_by {
                    Some(Value::String(value)) => {
                        // Restore an existing chain link verbatim; null means the
                        // pre-cleanup row had no valid string link to restore.
                        object.insert("supersededByMemoryId".to_string(), Value::String(value));
                    }
                    _ => {
                        object.insert("supersededByMemoryId".to_string(), Value::Null);
                    }
                }
                if let Some(payload) = object.get_mut("payload").and_then(Value::as_object_mut) {
                    payload.remove("memoryCleanup");
                }
                let changed = Value::Object(object.clone());
                canonical_memory::replace_memory_lexical_index(index_rows, &changed)?;
            }
            for id in &replacement_ids {
                let memory = memory_by_id_mut(memories, id)?;
                let object = memory.as_object_mut().ok_or_else(|| {
                    AppError::invalid_input("Stored canonical memory is not an object")
                })?;
                object.insert("status".to_string(), json!("superseded"));
                object.insert("updatedAt".to_string(), json!(undo_at));
                object.insert("supersededByMemoryId".to_string(), Value::Null);
                if let Some(metadata) = object
                    .get_mut("payload")
                    .and_then(Value::as_object_mut)
                    .and_then(|payload| payload.get_mut("memoryCleanup"))
                    .and_then(Value::as_object_mut)
                {
                    metadata.insert("undoneAt".to_string(), json!(undo_at));
                }
                let changed = Value::Object(object.clone());
                canonical_memory::replace_memory_lexical_index(index_rows, &changed)?;
            }
            Ok(json!({
                "batchId": batch_id,
                "restored": source_ids.len(),
                "inactivated": replacement_ids.len()
            }))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use crate::storage_commands::canonical_memory;
    use crate::storage_commands::memory_maintenance::contracts::{
        ApplyCleanupRequest, CleanupProposal, CleanupReplacement, CleanupScope, ExpectedState,
        ProposalType, UndoCleanupRequest,
    };
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-canonical-cleanup-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    #[test]
    fn cleanup_eligibility_protects_imported_automatic_records() {
        let scope = CleanupScope {
            kind: "character".to_string(),
            id: "mira".to_string(),
        };
        let imported = json!({
            "id": "memory-imported",
            "kind": "fact",
            "status": "active",
            "scope": { "kind": "character", "id": "mira" },
            "content": "Mira keeps the brass key.",
            "tags": ["automatic"],
            "payload": {
                "automatic": true,
                "importedFromMemoryId": "source-memory",
                "importedAt": "2026-07-27T00:00:00.000Z"
            }
        });

        assert!(!canonical_memory_is_cleanup_eligible(&imported, &scope));

        let mut edited = imported;
        edited["payload"] = json!({ "automatic": true, "userEdited": true });
        assert!(!canonical_memory_is_cleanup_eligible(&edited, &scope));
    }

    fn automatic_character_memory(state: &AppState, id: &str, content: &str) -> Value {
        canonical_memory::create_memory(
            state,
            json!({
                "id": id,
                "kind": "fact",
                "status": "active",
                "scope": { "kind": "character", "id": "mira" },
                "content": content,
                "confidence": 0.9,
                "provenance": {
                    "sourceChatId": "chat-1",
                    "messageIds": [format!("{id}-message")],
                    "characterId": "mira",
                    "timestamp": "2026-07-01T00:00:00.000Z"
                },
                "tags": ["automatic", "consequence"],
                "payload": { "automatic": true }
            }),
        )
        .expect("canonical memory should seed")
    }

    fn expected(memory: &Value) -> ExpectedState {
        ExpectedState {
            content: memory["content"].as_str().unwrap().to_string(),
            status: memory["status"].as_str().unwrap().to_string(),
            updated_at: memory["updatedAt"].as_str().map(ToOwned::to_owned),
            pinned: false,
            user_edited: false,
        }
    }

    fn active_character_ids(state: &AppState) -> Vec<String> {
        let mut ids = state
            .storage
            .list("canonical-memories")
            .expect("canonical memories should list")
            .into_iter()
            .filter(|memory| {
                memory["scope"] == json!({ "kind": "character", "id": "mira" })
                    && memory["status"] == json!("active")
            })
            .filter_map(|memory| memory["id"].as_str().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        ids.sort();
        ids
    }

    #[test]
    fn character_cleanup_updates_canonical_rows_and_indexes_and_can_undo() {
        let state = test_state("apply-undo");
        automatic_character_memory(&state, "memory-a", "Mira has the brass key.");
        automatic_character_memory(&state, "memory-b", "Mira keeps the brass key.");
        state
            .storage
            .update_collections_atomically(vec!["canonical-memories"], |collections| {
                let memories = collections[0].rows_mut();
                memory_by_id_mut(memories, "memory-a")?["supersededByMemoryId"] =
                    json!("prior-replacement");
                memory_by_id_mut(memories, "memory-b")?
                    .as_object_mut()
                    .expect("canonical memory should be an object")
                    .remove("updatedAt");
                Ok(())
            })
            .expect("legacy state should seed");
        let memory_a = state
            .storage
            .get("canonical-memories", "memory-a")
            .expect("memory-a should read")
            .expect("memory-a should exist");
        let memory_b = state
            .storage
            .get("canonical-memories", "memory-b")
            .expect("memory-b should read")
            .expect("memory-b should exist");
        let request = ApplyCleanupRequest {
            version: 1,
            scope: CleanupScope {
                kind: "character".to_string(),
                id: "mira".to_string(),
            },
            proposals: vec![CleanupProposal {
                id: "proposal-1".to_string(),
                proposal_type: ProposalType::Combine,
                source_ids: vec!["memory-a".to_string(), "memory-b".to_string()],
                expected: HashMap::from([
                    ("memory-a".to_string(), expected(&memory_a)),
                    ("memory-b".to_string(), expected(&memory_b)),
                ]),
                winner_id: None,
                replacement: Some(CleanupReplacement {
                    content: "Mira keeps the brass key.".to_string(),
                    kind: "fact".to_string(),
                }),
                _reason: Some("Overlapping detail".to_string()),
                selected: true,
                _estimated_tokens_before: Some(12),
                _estimated_tokens_after: Some(7),
            }],
        };

        let applied =
            apply_canonical_cleanup(&state, request).expect("canonical cleanup should apply");
        assert_eq!(applied["created"], json!(1));
        assert_eq!(active_character_ids(&state).len(), 1);
        assert_eq!(
            state
                .storage
                .list("memory-index-rows")
                .expect("index rows should list")
                .len(),
            1
        );

        undo_canonical_cleanup(
            &state,
            UndoCleanupRequest {
                scope: CleanupScope {
                    kind: "character".to_string(),
                    id: "mira".to_string(),
                },
                batch_id: applied["batchId"].as_str().unwrap().to_string(),
            },
        )
        .expect("canonical cleanup should undo");

        assert_eq!(
            active_character_ids(&state),
            vec!["memory-a".to_string(), "memory-b".to_string()]
        );
        assert_eq!(
            state
                .storage
                .list("memory-index-rows")
                .expect("index rows should list")
                .len(),
            2
        );
        let restored_a = state
            .storage
            .get("canonical-memories", "memory-a")
            .expect("memory-a should read")
            .expect("memory-a should exist");
        let restored_b = state
            .storage
            .get("canonical-memories", "memory-b")
            .expect("memory-b should read")
            .expect("memory-b should exist");
        assert_eq!(
            restored_a["supersededByMemoryId"],
            json!("prior-replacement")
        );
        assert_eq!(restored_b["updatedAt"], memory_b["createdAt"]);
    }
}
