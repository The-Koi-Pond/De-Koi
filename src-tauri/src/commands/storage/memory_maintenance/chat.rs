use super::contracts::{
    ApplyCleanupRequest, CleanupProposal, CleanupScope, ExpectedState, ProposalType,
    UndoCleanupRequest,
};
use crate::state::AppState;
use crate::storage_commands::chat_memory;
use marinara_core::{new_id, now_iso, AppError, AppResult};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct PreparedReplacement {
    proposal_id: String,
    value: Value,
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn memory_status(memory: &Value) -> &str {
    memory
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("active")
}

fn memory_belongs_to_scope(memory: &Value, scope: &CleanupScope) -> bool {
    if memory.get("chatId").and_then(Value::as_str) != Some(scope.id.as_str()) {
        return false;
    }
    let scope_type = memory
        .get("scopeType")
        .and_then(Value::as_str)
        .unwrap_or("chat");
    let scope_id = memory
        .get("scopeId")
        .and_then(Value::as_str)
        .unwrap_or(scope.id.as_str());
    scope_type == scope.kind && scope_id == scope.id
}

fn chat_memory_is_cleanup_eligible(memory: &Value, scope: &CleanupScope) -> bool {
    memory_belongs_to_scope(memory, scope)
        && matches!(memory_status(memory), "active" | "pinned")
}

fn chat_memory_is_pinned(memory: &Value) -> bool {
    memory_status(memory) == "pinned"
        || memory
            .get("pinned")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

fn expected_state_matches(memory: &Value, expected: &ExpectedState) -> bool {
    value_string(memory, "content").as_deref() == Some(expected.content.trim())
        && memory_status(memory) == expected.status.trim()
        && value_string(memory, "updatedAt") == expected.updated_at
        && memory
            .get("pinned")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            == expected.pinned
        && memory
            .get("userEdited")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            == expected.user_edited
}

fn memory_by_id<'a>(memories: &'a [Value], id: &str) -> AppResult<&'a Value> {
    memories
        .iter()
        .find(|memory| memory.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| AppError::not_found(format!("Chat memory {id} was not found")))
}

fn memory_by_id_mut<'a>(memories: &'a mut [Value], id: &str) -> AppResult<&'a mut Value> {
    memories
        .iter_mut()
        .find(|memory| memory.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| AppError::not_found(format!("Chat memory {id} was not found")))
}

fn validate_referenced_memories(
    memories: &[Value],
    scope: &CleanupScope,
    proposal: &CleanupProposal,
) -> AppResult<()> {
    for source_id in &proposal.source_ids {
        let memory = memory_by_id(memories, source_id)?;
        if !chat_memory_is_cleanup_eligible(memory, scope) {
            return Err(AppError::invalid_input(format!(
                "Chat memory {source_id} is inactive or outside this cleanup scope"
            )));
        }
        let expected = proposal
            .expected
            .get(source_id)
            .ok_or_else(|| AppError::invalid_input("Cleanup expected state is incomplete"))?;
        if !expected_state_matches(memory, expected) {
            return Err(AppError::invalid_input(
                "Some memories changed after this cleanup preview was created",
            ));
        }
    }
    if let Some(winner_id) = proposal.winner_id.as_deref() {
        let winner = memory_by_id(memories, winner_id)?;
        if !chat_memory_is_cleanup_eligible(winner, scope) {
            return Err(AppError::invalid_input(
                "Cleanup winner is inactive or outside this scope",
            ));
        }
        let expected = proposal
            .expected
            .get(winner_id)
            .ok_or_else(|| AppError::invalid_input("Cleanup winner expected state is missing"))?;
        if !expected_state_matches(winner, expected) {
            return Err(AppError::invalid_input(
                "Some memories changed after this cleanup preview was created",
            ));
        }
        if proposal.proposal_type == ProposalType::KeepOne
            && proposal
                .source_ids
                .iter()
                .map(|source_id| memory_by_id(memories, source_id))
                .collect::<AppResult<Vec<_>>>()?
                .into_iter()
                .any(chat_memory_is_pinned)
            && !chat_memory_is_pinned(winner)
        {
            return Err(AppError::invalid_input(
                "Keep-one cleanup must retain a pinned winner",
            ));
        }
    }
    Ok(())
}

fn memory_ids(memory: &Value, key: &str) -> Vec<String> {
    memory
        .get(key)
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
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
    if proposal.proposal_type != ProposalType::Combine {
        return Ok(None);
    }
    let replacement = proposal
        .replacement
        .as_ref()
        .ok_or_else(|| AppError::invalid_input("Cleanup replacement is required"))?;
    let mut message_ids = HashSet::new();
    let mut first_message_at: Option<String> = None;
    let mut last_message_at: Option<String> = None;
    let mut pinned = false;
    for source_id in &proposal.source_ids {
        let source = memory_by_id(memories, source_id)?;
        pinned |= chat_memory_is_pinned(source);
        message_ids.extend(memory_ids(source, "messageIds"));
        if let Some(timestamp) = value_string(source, "firstMessageAt") {
            if first_message_at
                .as_ref()
                .is_none_or(|current| timestamp < *current)
            {
                first_message_at = Some(timestamp);
            }
        }
        if let Some(timestamp) = value_string(source, "lastMessageAt") {
            if last_message_at
                .as_ref()
                .is_none_or(|current| timestamp > *current)
            {
                last_message_at = Some(timestamp);
            }
        }
    }
    let mut message_ids = message_ids.into_iter().collect::<Vec<_>>();
    message_ids.sort();
    let replacement_id = new_id();
    // The replacement is a new record created by cleanup. Source transcript
    // times and the exact consumed source IDs remain attached as provenance;
    // applied_at is the explicit fallback when no source transcript time exists.
    Ok(Some(json!({
        "id": replacement_id,
        "chatId": scope.id,
        "content": replacement.content.trim(),
        "canonicalMemoryVersion": 1,
        "memoryKind": "summary",
        "scopeType": scope.kind,
        "scopeId": scope.id,
        "status": "active",
        "pinned": pinned,
        "source": "memory_cleanup",
        "creationReason": "AI memory cleanup",
        "userEdited": false,
        "messageCount": message_ids.len().max(1),
        "messageIds": message_ids,
        "firstMessageAt": first_message_at.unwrap_or_else(|| applied_at.to_string()),
        "lastMessageAt": last_message_at.unwrap_or_else(|| applied_at.to_string()),
        "createdAt": applied_at,
        "updatedAt": applied_at,
        "cleanupBatchId": batch_id,
        "cleanupSourceIds": proposal.source_ids,
        "cleanupAppliedAt": applied_at
    })))
}

fn chat_memories_from_row(chat: &Value) -> AppResult<Vec<Value>> {
    chat_memory::chat_memory_values_for_mutation(chat)
}

fn set_chat_memories_on_row(chat: &mut Value, memories: Vec<Value>) -> AppResult<()> {
    let object = chat
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_input("Stored chat is not an object"))?;
    object.insert("memories".to_string(), Value::Array(memories));
    Ok(())
}

fn apply_validated_chat_batch(
    memories: &mut Vec<Value>,
    request: &ApplyCleanupRequest,
    prepared: &[PreparedReplacement],
    batch_id: &str,
    applied_at: &str,
) -> AppResult<Value> {
    let selected = request
        .proposals
        .iter()
        .filter(|proposal| proposal.selected && proposal.proposal_type != ProposalType::Conflict)
        .collect::<Vec<_>>();
    for proposal in &selected {
        validate_referenced_memories(memories, &request.scope, proposal)?;
    }

    let prepared_by_proposal = prepared
        .iter()
        .map(|replacement| (replacement.proposal_id.as_str(), replacement.value.clone()))
        .collect::<HashMap<_, _>>();
    let mut combined = 0usize;
    let mut superseded = 0usize;
    let mut created = 0usize;
    for proposal in selected {
        let replacement_id = prepared_by_proposal
            .get(proposal.id.as_str())
            .and_then(|replacement| replacement.get("id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let superseded_by = replacement_id
            .as_deref()
            .or(proposal.winner_id.as_deref())
            .ok_or_else(|| AppError::invalid_input("Cleanup proposal has no retained result"))?
            .to_string();
        for source_id in &proposal.source_ids {
            let source = memory_by_id_mut(memories, source_id)?;
            let previous_status = memory_status(source).to_string();
            let source = source
                .as_object_mut()
                .ok_or_else(|| AppError::invalid_input("Stored chat memory is not an object"))?;
            let previous_updated_at = source.get("updatedAt").cloned().unwrap_or(Value::Null);
            let previous_superseded_at_present = source.contains_key("supersededAt");
            let previous_superseded_at = source.get("supersededAt").cloned().unwrap_or(Value::Null);
            let previous_superseded_by_present = source.contains_key("supersededByMemoryId");
            let previous_superseded_by = source
                .get("supersededByMemoryId")
                .cloned()
                .unwrap_or(Value::Null);
            source.insert("status".to_string(), json!("superseded"));
            source.insert("supersededAt".to_string(), json!(applied_at));
            source.insert("supersededByMemoryId".to_string(), json!(superseded_by));
            source.insert("cleanupPreviousStatus".to_string(), json!(previous_status));
            source.insert("cleanupPreviousUpdatedAt".to_string(), previous_updated_at);
            source.insert(
                "cleanupPreviousSupersededAtPresent".to_string(),
                json!(previous_superseded_at_present),
            );
            source.insert(
                "cleanupPreviousSupersededAt".to_string(),
                previous_superseded_at,
            );
            source.insert(
                "cleanupPreviousSupersededByMemoryIdPresent".to_string(),
                json!(previous_superseded_by_present),
            );
            source.insert(
                "cleanupPreviousSupersededByMemoryId".to_string(),
                previous_superseded_by,
            );
            source.insert("cleanupSupersededByBatchId".to_string(), json!(batch_id));
            source.insert("cleanupAppliedAt".to_string(), json!(applied_at));
            source.insert("updatedAt".to_string(), json!(applied_at));
            superseded += 1;
        }
        if let Some(replacement) = prepared_by_proposal.get(proposal.id.as_str()) {
            memories.push(replacement.clone());
            created += 1;
        }
        match proposal.proposal_type {
            ProposalType::Combine => combined += 1,
            ProposalType::KeepOne | ProposalType::Conflict => {}
        }
    }
    Ok(json!({
        "batchId": batch_id,
        "combined": combined,
        "superseded": superseded,
        "created": created
    }))
}

pub(crate) async fn apply_chat_cleanup(
    state: &AppState,
    request: ApplyCleanupRequest,
) -> AppResult<Value> {
    if !matches!(request.scope.kind.as_str(), "chat" | "scene") {
        return Err(AppError::invalid_input(
            "Chat cleanup requires a chat or scene scope",
        ));
    }
    let chat = state
        .storage
        .get("chats", &request.scope.id)?
        .ok_or_else(|| AppError::not_found("Chat was not found"))?;
    let memories = chat_memories_from_row(&chat)?;
    let batch_id = new_id();
    let applied_at = now_iso();
    let embedding_context = chat_memory::memory_embedding_context(state, &chat).await?;
    let mut prepared = Vec::new();
    for proposal in request
        .proposals
        .iter()
        .filter(|proposal| proposal.selected && proposal.proposal_type != ProposalType::Conflict)
    {
        validate_referenced_memories(&memories, &request.scope, proposal)?;
        if let Some(mut replacement) =
            build_replacement(&memories, &request.scope, proposal, &batch_id, &applied_at)?
        {
            let replacement_object = replacement
                .as_object_mut()
                .ok_or_else(|| AppError::invalid_input("Cleanup replacement is not an object"))?;
            chat_memory::embed_chat_memory_object(replacement_object, embedding_context.as_ref())
                .await?;
            prepared.push(PreparedReplacement {
                proposal_id: proposal.id.clone(),
                value: replacement,
            });
        }
    }

    let chat_id = request.scope.id.clone();
    let batch_id_for_write = batch_id.clone();
    let applied_at_for_write = applied_at.clone();
    state
        .storage
        .update_collections_atomically(vec!["chats"], move |collections| {
            let chats = collections[0].rows_mut();
            let chat = chats
                .iter_mut()
                .find(|chat| chat.get("id").and_then(Value::as_str) == Some(chat_id.as_str()))
                .ok_or_else(|| AppError::not_found("Chat was not found"))?;
            let mut current_memories = chat_memories_from_row(chat)?;
            let result = apply_validated_chat_batch(
                &mut current_memories,
                &request,
                &prepared,
                &batch_id_for_write,
                &applied_at_for_write,
            )?;
            set_chat_memories_on_row(chat, current_memories)?;
            Ok(result)
        })
}

fn remove_embedding_fields(memory: &mut Map<String, Value>) {
    for field in [
        "embedding",
        "hasEmbedding",
        "embeddingStatus",
        "embeddingSource",
        "embeddingConnectionId",
        "embeddingModel",
    ] {
        memory.remove(field);
    }
}

pub(crate) fn undo_chat_cleanup(state: &AppState, request: UndoCleanupRequest) -> AppResult<Value> {
    if !matches!(request.scope.kind.as_str(), "chat" | "scene") {
        return Err(AppError::invalid_input(
            "Chat cleanup undo requires a chat or scene scope",
        ));
    }
    let chat_id = request.scope.id.clone();
    let batch_id = request.batch_id.clone();
    state
        .storage
        .update_collections_atomically(vec!["chats"], move |collections| {
            let chats = collections[0].rows_mut();
            let chat = chats
                .iter_mut()
                .find(|chat| chat.get("id").and_then(Value::as_str) == Some(chat_id.as_str()))
                .ok_or_else(|| AppError::not_found("Chat was not found"))?;
            let mut memories = chat_memories_from_row(chat)?;
            let source_indexes = memories
                .iter()
                .enumerate()
                .filter(|(_, memory)| {
                    memory
                        .get("cleanupSupersededByBatchId")
                        .and_then(Value::as_str)
                        == Some(batch_id.as_str())
                })
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            let replacement_indexes = memories
                .iter()
                .enumerate()
                .filter(|(_, memory)| {
                    memory.get("cleanupBatchId").and_then(Value::as_str) == Some(batch_id.as_str())
                })
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            if source_indexes.is_empty() && replacement_indexes.is_empty() {
                return Err(AppError::not_found("Memory cleanup batch was not found"));
            }
            for index in source_indexes.iter().chain(replacement_indexes.iter()) {
                let memory = &memories[*index];
                let applied_at = memory
                    .get("cleanupAppliedAt")
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
            if source_indexes
                .iter()
                .any(|index| memory_status(&memories[*index]) != "superseded")
                || replacement_indexes
                    .iter()
                    .any(|index| memory_status(&memories[*index]) != "active")
            {
                return Err(AppError::invalid_input(
                    "Memory cleanup cannot be undone because its records changed",
                ));
            }

            let undo_at = now_iso();
            for index in &source_indexes {
                let memory = memories[*index].as_object_mut().ok_or_else(|| {
                    AppError::invalid_input("Stored chat memory is not an object")
                })?;
                let previous_status = memory
                    .remove("cleanupPreviousStatus")
                    .and_then(|value| value.as_str().map(ToOwned::to_owned))
                    .unwrap_or_else(|| "active".to_string());
                let previous_updated_at = memory.remove("cleanupPreviousUpdatedAt");
                let previous_superseded_at = memory.remove("cleanupPreviousSupersededAt");
                let previous_superseded_at_present = memory
                    .remove("cleanupPreviousSupersededAtPresent")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
                    // A non-null saved value wins over an absent or
                    // contradictory legacy flag: it proves the field existed.
                    || previous_superseded_at
                        .as_ref()
                        .is_some_and(|value| !value.is_null());
                let previous_superseded_by = memory.remove("cleanupPreviousSupersededByMemoryId");
                let previous_superseded_by_present = memory
                    .remove("cleanupPreviousSupersededByMemoryIdPresent")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
                    // Preserve a valid saved chain value even when legacy
                    // metadata omitted or contradicted its presence flag.
                    || previous_superseded_by
                        .as_ref()
                        .is_some_and(|value| !value.is_null());
                memory.insert("status".to_string(), json!(previous_status));
                for field in [
                    "supersededAt",
                    "supersededByMemoryId",
                    "cleanupSupersededByBatchId",
                    "cleanupAppliedAt",
                ] {
                    memory.remove(field);
                }
                match previous_updated_at {
                    Some(Value::String(value)) => {
                        memory.insert("updatedAt".to_string(), Value::String(value));
                    }
                    _ => {
                        // ChatMemoryChunk.updatedAt is optional. Undo restores
                        // the exact pre-cleanup absence instead of inventing time.
                        memory.remove("updatedAt");
                    }
                }
                if previous_superseded_at_present {
                    memory.insert(
                        "supersededAt".to_string(),
                        previous_superseded_at.unwrap_or(Value::Null),
                    );
                }
                if previous_superseded_by_present {
                    memory.insert(
                        "supersededByMemoryId".to_string(),
                        previous_superseded_by.unwrap_or(Value::Null),
                    );
                }
            }
            for index in &replacement_indexes {
                let memory = memories[*index].as_object_mut().ok_or_else(|| {
                    AppError::invalid_input("Stored chat memory is not an object")
                })?;
                memory.insert("status".to_string(), json!("superseded"));
                memory.insert("supersededAt".to_string(), json!(undo_at));
                memory.insert("updatedAt".to_string(), json!(undo_at));
                memory.insert("cleanupUndoneAt".to_string(), json!(undo_at));
                remove_embedding_fields(memory);
            }
            let result = json!({
                "batchId": batch_id,
                "restored": source_indexes.len(),
                "inactivated": replacement_indexes.len()
            });
            set_chat_memories_on_row(chat, memories)?;
            Ok(result)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
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
        let path = std::env::temp_dir().join(format!("de-koi-memory-cleanup-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn automatic_memory(id: &str, content: &str) -> Value {
        json!({
            "id": id,
            "chatId": "chat-1",
            "content": content,
            "canonicalMemoryVersion": 1,
            "memoryKind": "transcript",
            "scopeType": "chat",
            "scopeId": "chat-1",
            "status": "active",
            "messageIds": [format!("{id}-message")],
            "createdAt": "2026-07-01T00:00:00.000Z",
            "firstMessageAt": "2026-07-01T00:00:00.000Z",
            "lastMessageAt": "2026-07-01T00:00:00.000Z"
        })
    }

    fn expected(content: &str) -> ExpectedState {
        ExpectedState {
            content: content.to_string(),
            status: "active".to_string(),
            updated_at: None,
            pinned: false,
            user_edited: false,
        }
    }

    fn apply_request() -> ApplyCleanupRequest {
        ApplyCleanupRequest {
            version: 1,
            scope: CleanupScope {
                kind: "chat".to_string(),
                id: "chat-1".to_string(),
            },
            proposals: vec![CleanupProposal {
                id: "proposal-1".to_string(),
                proposal_type: ProposalType::Combine,
                source_ids: vec!["memory-a".to_string(), "memory-b".to_string()],
                expected: HashMap::from([
                    (
                        "memory-a".to_string(),
                        ExpectedState {
                            content: "Mira has the brass key.".to_string(),
                            status: "pinned".to_string(),
                            updated_at: None,
                            pinned: true,
                            user_edited: true,
                        },
                    ),
                    (
                        "memory-b".to_string(),
                        expected("Mira keeps the brass key."),
                    ),
                ]),
                winner_id: None,
                replacement: Some(CleanupReplacement {
                    content: "Mira keeps the brass key.".to_string(),
                    kind: "fact".to_string(),
                }),
                _reason: Some("Overlapping memories".to_string()),
                selected: true,
                _estimated_tokens_before: Some(12),
                _estimated_tokens_after: Some(7),
            }],
        }
    }

    fn active_memory_ids(state: &AppState) -> Vec<String> {
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat read should work")
            .expect("chat should exist");
        let mut ids = chat["memories"]
            .as_array()
            .expect("memories should be an array")
            .iter()
            .filter(|memory| {
                matches!(
                    memory
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("active"),
                    "active" | "pinned"
                )
            })
            .filter_map(|memory| {
                memory
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Vec<_>>();
        ids.sort();
        ids
    }

    #[test]
    fn cleanup_eligibility_accepts_all_active_origins_and_rejects_inactive_or_foreign_rows() {
        let scope = CleanupScope {
            kind: "chat".to_string(),
            id: "chat-1".to_string(),
        };
        let same_chat = json!({
            "id": "memory-1",
            "chatId": "chat-1",
            "scopeType": "chat",
            "scopeId": "chat-1",
            "status": "active",
            "content": "Mira keeps the brass key.",
            "messageIds": ["message-1"],
            "sourceChatId": "chat-1",
            "commandMemoryKey": null,
            "correctionOfMemoryId": null,
            "correctedByMemoryId": null
        });
        let mut imported = same_chat.clone();
        imported["sourceChatId"] = json!("other-chat");
        imported["source"] = json!("imported");
        let mut manual = same_chat.clone();
        manual["source"] = json!("manual");
        manual["userEdited"] = json!(true);
        manual["messageIds"] = json!([]);
        let mut correction = same_chat.clone();
        correction["source"] = json!("correction");
        correction["correctionOfMemoryId"] = json!("memory-old");
        let mut command = same_chat.clone();
        command["source"] = json!("connected_command");
        command["commandMemoryKey"] = json!("relationship-status");
        let mut pinned = same_chat.clone();
        pinned["status"] = json!("pinned");
        pinned["pinned"] = json!(true);
        let mut wrong = same_chat.clone();
        wrong["status"] = json!("wrong");
        let mut foreign = same_chat.clone();
        foreign["chatId"] = json!("chat-2");
        foreign["scopeId"] = json!("chat-2");

        assert!(chat_memory_is_cleanup_eligible(&same_chat, &scope));
        assert!(chat_memory_is_cleanup_eligible(&imported, &scope));
        assert!(chat_memory_is_cleanup_eligible(&manual, &scope));
        assert!(chat_memory_is_cleanup_eligible(&correction, &scope));
        assert!(chat_memory_is_cleanup_eligible(&command, &scope));
        assert!(chat_memory_is_cleanup_eligible(&pinned, &scope));
        assert!(!chat_memory_is_cleanup_eligible(&wrong, &scope));
        assert!(!chat_memory_is_cleanup_eligible(&foreign, &scope));
    }

    #[test]
    fn keep_one_cleanup_rejects_unpinned_winner_for_pinned_source() {
        let scope = CleanupScope {
            kind: "chat".to_string(),
            id: "chat-1".to_string(),
        };
        let mut pinned = automatic_memory("pinned", "Mira keeps the brass key.");
        pinned["status"] = json!("pinned");
        pinned["pinned"] = json!(true);
        let winner = automatic_memory("winner", "Mira keeps the brass key.");
        let proposal = CleanupProposal {
            id: "proposal-keep-one".to_string(),
            proposal_type: ProposalType::KeepOne,
            source_ids: vec!["pinned".to_string()],
            expected: HashMap::from([
                (
                    "pinned".to_string(),
                    ExpectedState {
                        content: "Mira keeps the brass key.".to_string(),
                        status: "pinned".to_string(),
                        updated_at: None,
                        pinned: true,
                        user_edited: false,
                    },
                ),
                (
                    "winner".to_string(),
                    expected("Mira keeps the brass key."),
                ),
            ]),
            winner_id: Some("winner".to_string()),
            replacement: None,
            _reason: Some("Repeated fact".to_string()),
            selected: true,
            _estimated_tokens_before: None,
            _estimated_tokens_after: None,
        };

        let error = validate_referenced_memories(&[pinned, winner], &scope, &proposal)
            .expect_err("an unpinned winner must not consume pinned memory");
        assert!(error.message.contains("pinned winner"));
    }

    #[tokio::test]
    async fn chat_cleanup_combines_eligible_rows_and_undo_restores_them() {
        let state = test_state("chat-apply-undo");
        let mut memory_a = automatic_memory("memory-a", "Mira has the brass key.");
        memory_a["status"] = json!("pinned");
        memory_a["pinned"] = json!(true);
        memory_a["source"] = json!("manual");
        memory_a["userEdited"] = json!(true);
        memory_a["supersededAt"] = json!("2026-06-01T00:00:00.000Z");
        memory_a["supersededByMemoryId"] = json!("prior-replacement");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        memory_a,
                        automatic_memory("memory-b", "Mira keeps the brass key."),
                        {
                            "id": "manual",
                            "chatId": "chat-1",
                            "content": "Never rewrite this.",
                            "memoryKind": "manual",
                            "scopeType": "chat",
                            "scopeId": "chat-1",
                            "status": "active",
                            "source": "manual",
                            "userEdited": true,
                            "messageIds": [],
                            "createdAt": "2026-07-01T00:00:00.000Z",
                            "firstMessageAt": "2026-07-01T00:00:00.000Z",
                            "lastMessageAt": "2026-07-01T00:00:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let applied = apply_chat_cleanup(&state, apply_request())
            .await
            .expect("cleanup should apply");
        assert_eq!(applied["combined"], json!(1));
        let active_after_apply = active_memory_ids(&state);
        assert_eq!(active_after_apply.len(), 2);
        assert!(active_after_apply.contains(&"manual".to_string()));
        let applied_chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat read should work")
            .expect("chat should exist");
        let replacement = applied_chat["memories"]
            .as_array()
            .and_then(|memories| {
                memories
                    .iter()
                    .find(|memory| memory.get("cleanupBatchId").is_some())
            })
            .expect("cleanup replacement should exist");
        assert_eq!(replacement["pinned"], json!(true));

        undo_chat_cleanup(
            &state,
            UndoCleanupRequest {
                scope: CleanupScope {
                    kind: "chat".to_string(),
                    id: "chat-1".to_string(),
                },
                batch_id: applied["batchId"]
                    .as_str()
                    .expect("batch id should be returned")
                    .to_string(),
            },
        )
        .expect("cleanup should undo");

        assert_eq!(
            active_memory_ids(&state),
            vec![
                "manual".to_string(),
                "memory-a".to_string(),
                "memory-b".to_string(),
            ]
        );
        let restored_chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat read should work")
            .expect("chat should exist");
        let restored_memory_a = restored_chat["memories"]
            .as_array()
            .and_then(|memories| {
                memories
                    .iter()
                    .find(|memory| memory["id"] == json!("memory-a"))
            })
            .expect("memory-a should be restored");
        assert_eq!(
            restored_memory_a["supersededAt"],
            json!("2026-06-01T00:00:00.000Z")
        );
        assert_eq!(
            restored_memory_a["supersededByMemoryId"],
            json!("prior-replacement")
        );
        assert_eq!(restored_memory_a["status"], json!("pinned"));
        assert_eq!(restored_memory_a["pinned"], json!(true));
        assert!(
            restored_memory_a.get("updatedAt").is_none(),
            "undo must preserve the exact absence of optional chat updatedAt"
        );

        let reapplied = apply_chat_cleanup(&state, apply_request())
            .await
            .expect("cleanup should reapply");
        state
            .storage
            .update_collections_atomically(vec!["chats"], |collections| {
                let chat = collections[0]
                    .rows_mut()
                    .iter_mut()
                    .find(|chat| chat["id"] == json!("chat-1"))
                    .expect("chat should exist");
                let memories = chat["memories"]
                    .as_array_mut()
                    .expect("memories should be an array");
                for memory in memories
                    .iter_mut()
                    .filter(|memory| matches!(memory["id"].as_str(), Some("memory-a" | "memory-b")))
                {
                    let memory = memory
                        .as_object_mut()
                        .expect("chat memory should be an object");
                    if memory.get("id").and_then(Value::as_str) == Some("memory-a") {
                        memory.insert(
                            "cleanupPreviousSupersededAtPresent".to_string(),
                            Value::Bool(false),
                        );
                        memory.insert(
                            "cleanupPreviousSupersededByMemoryIdPresent".to_string(),
                            Value::Bool(false),
                        );
                    } else {
                        memory.remove("cleanupPreviousSupersededAtPresent");
                        memory.remove("cleanupPreviousSupersededByMemoryIdPresent");
                    }
                }
                Ok(())
            })
            .expect("contradictory and partial cleanup metadata should seed");

        undo_chat_cleanup(
            &state,
            UndoCleanupRequest {
                scope: CleanupScope {
                    kind: "chat".to_string(),
                    id: "chat-1".to_string(),
                },
                batch_id: reapplied["batchId"]
                    .as_str()
                    .expect("batch id should be returned")
                    .to_string(),
            },
        )
        .expect("cleanup with partial presence metadata should undo");

        let restored_again = state
            .storage
            .get("chats", "chat-1")
            .expect("chat read should work")
            .expect("chat should exist");
        let restored_memory_a = restored_again["memories"]
            .as_array()
            .and_then(|memories| {
                memories
                    .iter()
                    .find(|memory| memory["id"] == json!("memory-a"))
            })
            .expect("memory-a should be restored again");
        assert_eq!(
            restored_memory_a["supersededAt"],
            json!("2026-06-01T00:00:00.000Z")
        );
        assert_eq!(
            restored_memory_a["supersededByMemoryId"],
            json!("prior-replacement")
        );
        assert!(
            restored_memory_a.get("updatedAt").is_none(),
            "legacy metadata recovery must not invent an optional updatedAt"
        );
    }
}
