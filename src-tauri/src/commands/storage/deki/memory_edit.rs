//! Deki-senpai's memory edits as approvals. `edit_memory` replaces one
//! character or chat memory's content; the dry-run records a pending approval
//! under the `memories` collection and nothing changes until the user
//! approves. Chat memories need an approved chat-access grant when the edit is
//! proposed. Approval re-reads the memory, re-checks the operation hash over
//! it, and writes through the memory owner.

use super::chat_access::{self, DekiChatAccessGrant};
use super::data_cli::{
    self, DekiDataMutation, DekiDataMutationKind, DekiDataPlan, DekiDataValidation,
};
use super::memory_access;
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub(super) const MEMORY_COLLECTION: &str = "memories";
const MEMORY_CONTENT_MAX_CHARS: usize = 4_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EditMemoryArgs {
    #[serde(alias = "scope_type")]
    scope_type: String,
    #[serde(alias = "scope_id")]
    scope_id: String,
    #[serde(alias = "memory_id")]
    memory_id: String,
    content: String,
    #[serde(default)]
    reason: String,
}

/// The pending change for an `edit_memory` request. Chat memories need an
/// approved grant for the chat now; approving later is the user's consent.
pub(super) fn mutation(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
    args: EditMemoryArgs,
) -> AppResult<DekiDataMutation> {
    let scope_type = args.scope_type.trim().to_string();
    let memory_id = args.memory_id.trim().to_string();
    let scope_id = match scope_type.as_str() {
        "character" => args.scope_id.trim().to_string(),
        "chat" => chat_access::ensure_chat_allowed(state, grants, args.scope_id.trim())?,
        _ => {
            return Err(AppError::invalid_input(
                "edit_memory scopeType must be character or chat",
            ))
        }
    };
    if scope_id.is_empty() || memory_id.is_empty() {
        return Err(AppError::invalid_input(
            "edit_memory requires scopeId and memoryId",
        ));
    }
    Ok(DekiDataMutation {
        kind: DekiDataMutationKind::Patch,
        collection: MEMORY_COLLECTION,
        id: format!("{scope_type}/{scope_id}/{memory_id}"),
        payload: json!({
            "scopeType": scope_type,
            "scopeId": scope_id,
            "memoryId": memory_id,
            "content": args.content.trim(),
        }),
        reason: data_cli::required_reason(args.reason)?,
    })
}

struct MemoryEdit<'a> {
    scope_type: &'a str,
    scope_id: &'a str,
    memory_id: &'a str,
    content: &'a str,
}

fn memory_edit(payload: &Value) -> MemoryEdit<'_> {
    let text = |key: &str| payload.get(key).and_then(Value::as_str).unwrap_or("");
    MemoryEdit {
        scope_type: text("scopeType"),
        scope_id: text("scopeId"),
        memory_id: text("memoryId"),
        content: text("content"),
    }
}

pub(super) fn plan(state: &AppState, mutation: &DekiDataMutation) -> AppResult<DekiDataPlan> {
    let id = mutation.id.as_str();
    let edit = memory_edit(&mutation.payload);
    let mut validation = DekiDataValidation::default();
    let current = match memory_access::current_memory(
        state,
        edit.scope_type,
        edit.scope_id,
        edit.memory_id,
    ) {
        Ok(current) => Some(current),
        Err(error) => {
            validation.error(MEMORY_COLLECTION, id, error.message);
            None
        }
    };
    let before = current
        .as_ref()
        .and_then(|row| row.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if edit.content.is_empty() {
        validation.error(MEMORY_COLLECTION, id, "Memory content must not be empty.");
    } else if edit.content.chars().count() > MEMORY_CONTENT_MAX_CHARS {
        validation.error(
            MEMORY_COLLECTION,
            id,
            format!("Memory content is limited to {MEMORY_CONTENT_MAX_CHARS} characters."),
        );
    } else if current.is_some() && before == edit.content {
        validation.error(MEMORY_COLLECTION, id, "The memory already says that.");
    }

    let can_apply = !validation.blocked();
    let mut affected_entities = Map::new();
    if can_apply {
        affected_entities.insert(MEMORY_COLLECTION.to_string(), json!(1));
    }
    let preview = vec![data_cli::row_change(
        MEMORY_COLLECTION,
        id,
        "update",
        Some(&json!({ "content": before })),
        Some(&json!({ "content": edit.content })),
    )];
    let affected_rows = usize::from(can_apply);
    let summary = json!({
        "matchedRows": usize::from(current.is_some()),
        "affectedRows": affected_rows,
        "insertedRows": 0,
        "updatedRows": affected_rows,
        "replacedRows": 0,
        "deletedRows": 0,
        "affectedEntities": affected_entities,
        "preview": preview,
        "truncated": false,
    });
    Ok(DekiDataPlan {
        mutation: mutation.clone(),
        command: mutation.command_label(),
        operation_hash: operation_hash(id, current.as_ref(), edit.content),
        validation,
        summary,
        affected_entities,
        affected_rows,
        preview,
        preview_truncated: false,
    })
}

/// Writes the approved edit. Chat memories re-embed through their owner,
/// which is async, so this runs on the caller's blocking thread.
pub(super) fn apply(state: &AppState, mutation: &DekiDataMutation) -> AppResult<Value> {
    let edit = memory_edit(&mutation.payload);
    let update = memory_access::update_memory(
        state,
        edit.scope_type,
        edit.scope_id,
        edit.memory_id,
        edit.content,
    );
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => handle.block_on(update),
        Err(_) => tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| AppError::new("deki_memory_edit_failed", error.to_string()))?
            .block_on(update),
    }
}

fn operation_hash(id: &str, current: Option<&Value>, content: &str) -> String {
    let material = data_cli::canonical_json(&json!({
        "kind": "memory-edit",
        "id": id,
        "current": current,
        "content": content,
    }));
    let digest = Sha256::digest(material.as_bytes());
    format!(
        "sha256:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}
