//! `deki_data`: Deki-senpai's app-data command family.
//!
//! Read actions return bounded library views. Mutation actions (`insert`,
//! `patch`, `delete`) never write: they produce a dry-run plan with a diff
//! preview and an operation hash, and the approval store turns that plan into
//! a pending approval. Writes happen only in [`apply_mutation`], which the
//! approval resolver calls after the user approves and the recomputed plan
//! still matches the approved hash.

use super::approvals::{self, DekiApprovalScope};
use super::library;
use crate::state::AppState;
use crate::storage_commands::{canonical_memory, entity_commands, knowledge_edges};
use marinara_core::{new_id, AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub(super) const DEKI_DATA_GUIDE: &str = r#"deki_data app-data commands (always include "action"):
- {"action":"status"} -> record counts per library collection and pending approval count.
- {"action":"collections"} -> collections deki_data can read and change.
- {"action":"list","collection":"characters","query":"optional text","limit":80,"offset":0}
- {"action":"search","query":"text","collections":["optional collection"],"limit":80}
- {"action":"get","collection":"lorebooks","id":"exact id"}
- {"action":"insert","collection":"lorebook-entries","value":{...},"reason":"why"}
- {"action":"patch","collection":"personas","id":"exact id","patch":{"only":"changed fields"},"reason":"why"}
- {"action":"delete","collection":"lorebook-entries","id":"exact id","reason":"why"}
Collections: characters, character-groups, personas, persona-groups, lorebooks, lorebook-entries, prompts, prompt-sections, prompt-groups, prompt-variables. Chats, messages, memories, connections, and settings are not deki_data collections.
insert/patch/delete are dry-runs: nothing is written. Each returns a diff preview and a pending approval that the user must approve in De-Koi. Never say a dry-run change was saved, applied, or deleted; say it is waiting for approval. Character patches go under patch.data (for example {"data":{"scenario":"..."}}); persona patches use top-level card fields. Patch only the fields that change. Prefer a <deki_action> card for drafting or rewriting one card the user will review; use deki_data for deletes and precise structured edits such as adding or removing lorebook entries or patching a few fields across records."#;

const MUTATION_ACTIONS: &str = "status, collections, list, search, get, insert, patch, delete";
const PAYLOAD_MAX_BYTES: usize = 64 * 1024;
const REASON_MAX_CHARS: usize = 500;
const PREVIEW_STRING_MAX_CHARS: usize = 600;
const PREVIEW_ARRAY_MAX_ITEMS: usize = 12;
const PREVIEW_MAX_DEPTH: usize = 4;
const CASCADE_PREVIEW_ROWS: usize = 5;
const STORAGE_OWNED_FIELDS: &[&str] = &["id", "createdAt", "updatedAt"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DekiDataMutationKind {
    Insert,
    Patch,
    Delete,
}

impl DekiDataMutationKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Patch => "patch",
            Self::Delete => "delete",
        }
    }
}

/// A requested app-data change. `payload` never carries storage-owned fields;
/// for inserts, `id` is pre-assigned so the preview, the hash, and the applied
/// record all name the same row.
#[derive(Debug, Clone)]
pub(super) struct DekiDataMutation {
    pub(super) kind: DekiDataMutationKind,
    pub(super) collection: &'static str,
    pub(super) id: String,
    pub(super) payload: Value,
    pub(super) reason: String,
}

impl DekiDataMutation {
    pub(super) fn command_label(&self) -> String {
        format!(
            "deki data {} {}/{}",
            self.kind.as_str(),
            self.collection,
            self.id
        )
    }
}

pub(super) enum DekiDataCommand {
    Status,
    Collections,
    List(ListArgs),
    Search(SearchArgs),
    Get(GetArgs),
    Mutate(DekiDataMutation),
}

impl DekiDataCommand {
    pub(super) fn is_mutation(&self) -> bool {
        matches!(self, Self::Mutate(_))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ListArgs {
    collection: String,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SearchArgs {
    query: String,
    #[serde(default)]
    collections: Vec<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GetArgs {
    collection: String,
    id: String,
    #[serde(default)]
    entry_query: Option<String>,
    #[serde(default)]
    entry_limit: Option<usize>,
    #[serde(default)]
    entry_offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InsertArgs {
    collection: String,
    value: Value,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PatchArgs {
    collection: String,
    id: String,
    patch: Value,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteArgs {
    collection: String,
    id: String,
    reason: String,
}

pub(super) fn parse(args: Value) -> AppResult<DekiDataCommand> {
    let Value::Object(mut object) = args else {
        return Err(AppError::invalid_input(format!(
            "deki_data args must be a JSON object with an action ({MUTATION_ACTIONS})."
        )));
    };
    let action = object
        .remove("action")
        .and_then(|value| {
            value
                .as_str()
                .map(|action| action.trim().to_ascii_lowercase())
        })
        .filter(|action| !action.is_empty())
        .ok_or_else(|| {
            AppError::invalid_input(format!(
                "deki_data requires an action: one of {MUTATION_ACTIONS}."
            ))
        })?;
    let rest = Value::Object(object);
    match action.as_str() {
        "status" => expect_no_args("status", &rest).map(|()| DekiDataCommand::Status),
        "collections" => {
            expect_no_args("collections", &rest).map(|()| DekiDataCommand::Collections)
        }
        "list" => parse_args("list", rest).map(DekiDataCommand::List),
        "search" => parse_args("search", rest).map(DekiDataCommand::Search),
        "get" => parse_args("get", rest).map(DekiDataCommand::Get),
        "insert" => {
            let args: InsertArgs = parse_args("insert", rest)?;
            Ok(DekiDataCommand::Mutate(DekiDataMutation {
                kind: DekiDataMutationKind::Insert,
                collection: library::library_entity_for(&args.collection)?,
                id: new_id(),
                payload: args.value,
                reason: required_reason(args.reason)?,
            }))
        }
        "patch" => {
            let args: PatchArgs = parse_args("patch", rest)?;
            Ok(DekiDataCommand::Mutate(DekiDataMutation {
                kind: DekiDataMutationKind::Patch,
                collection: library::library_entity_for(&args.collection)?,
                id: required_id(args.id)?,
                payload: args.patch,
                reason: required_reason(args.reason)?,
            }))
        }
        "delete" => {
            let args: DeleteArgs = parse_args("delete", rest)?;
            Ok(DekiDataCommand::Mutate(DekiDataMutation {
                kind: DekiDataMutationKind::Delete,
                collection: library::library_entity_for(&args.collection)?,
                id: required_id(args.id)?,
                payload: Value::Null,
                reason: required_reason(args.reason)?,
            }))
        }
        "replace" => Err(AppError::invalid_input(
            "deki_data replace is not supported because De-Koi storage owners merge updates; use patch with only the fields that change.",
        )),
        other => Err(AppError::invalid_input(format!(
            "Unknown deki_data action '{other}'. Use one of {MUTATION_ACTIONS}."
        ))),
    }
}

/// Runs a parsed `deki_data` command. Mutations only plan and record a pending
/// approval; `pending_approvals` receives each approval created by this call.
pub(super) fn execute(
    state: &AppState,
    scope: &DekiApprovalScope,
    command: DekiDataCommand,
    pending_approvals: &mut Vec<Value>,
) -> AppResult<Value> {
    match command {
        DekiDataCommand::Status => status(state, scope),
        DekiDataCommand::Collections => Ok(collections()),
        DekiDataCommand::List(args) => library::overview(
            state,
            library::LibraryOverviewQuery {
                item_type: Some(args.collection),
                types: Vec::new(),
                query: args.query,
                limit: args.limit,
                offset: args.offset,
            },
        ),
        DekiDataCommand::Search(args) => {
            if args.query.trim().is_empty() {
                return Err(AppError::invalid_input(
                    "deki_data search requires a query.",
                ));
            }
            library::overview(
                state,
                library::LibraryOverviewQuery {
                    item_type: None,
                    types: args.collections,
                    query: Some(args.query),
                    limit: args.limit,
                    offset: args.offset,
                },
            )
        }
        DekiDataCommand::Get(args) => library::items(
            state,
            vec![library::LibraryItemRequest {
                item_type: args.collection,
                id: args.id,
                include_entries: None,
                entry_query: args.entry_query,
                entry_limit: args.entry_limit,
                entry_offset: args.entry_offset,
            }],
        ),
        DekiDataCommand::Mutate(mutation) => {
            let plan = plan_mutation(state, &mutation)?;
            let approval = approvals::record_dry_run(scope, &plan)?;
            let mut result = json!({
                "ok": approval.is_some(),
                "mode": "dry-run",
                "command": plan.command,
                "summary": plan.summary,
                "validation": plan.validation.to_value(),
            });
            match approval {
                Some(approval) => {
                    result["approval"] = json!({
                        "status": "pending",
                        "id": approval["id"],
                        "operationHash": plan.operation_hash,
                    });
                    result["note"] = json!(
                        "Nothing was written. The user must approve this change in De-Koi before it is applied."
                    );
                    pending_approvals.push(approval);
                }
                None => {
                    result["error"] = json!(plan
                        .validation
                        .first_error()
                        .unwrap_or("The dry-run was blocked by validation."));
                }
            }
            Ok(result)
        }
    }
}

fn status(state: &AppState, scope: &DekiApprovalScope) -> AppResult<Value> {
    let mut counts = Map::new();
    for (_, entity) in library::library_collections() {
        counts.insert(entity.to_string(), json!(state.storage.list(entity)?.len()));
    }
    Ok(json!({
        "collections": counts,
        "pendingApprovals": approvals::pending_for(scope)?.len(),
    }))
}

fn collections() -> Value {
    let rows = library::library_collections()
        .map(|(item_type, entity)| {
            json!({
                "collection": entity,
                "type": item_type,
                "actions": ["list", "search", "get", "insert", "patch", "delete"],
                "requires": required_fields_note(entity),
            })
        })
        .collect::<Vec<_>>();
    json!({ "collections": rows })
}

fn required_fields_note(entity: &str) -> &'static str {
    match entity {
        "characters" => "insert needs data.name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, tags, extensions.backstory, extensions.appearance",
        "personas" => "insert needs name, description, personality, scenario, backstory, appearance",
        "lorebook-entries" => "insert needs lorebookId of an existing lorebook and name",
        "prompt-sections" | "prompt-groups" | "prompt-variables" => {
            "insert needs presetId of an existing prompt preset"
        }
        _ => "insert needs name",
    }
}

#[derive(Debug, Default, Clone)]
pub(super) struct DekiDataValidation {
    errors: Vec<Value>,
    notices: Vec<Value>,
    infos: Vec<Value>,
}

impl DekiDataValidation {
    fn issue(level: &str, entity: &str, id: &str, message: impl Into<String>) -> Value {
        json!({ "level": level, "entity": entity, "id": id, "message": message.into() })
    }

    fn error(&mut self, entity: &str, id: &str, message: impl Into<String>) {
        self.errors.push(Self::issue("error", entity, id, message));
    }

    fn notice(&mut self, entity: &str, id: &str, message: impl Into<String>) {
        self.notices
            .push(Self::issue("notice", entity, id, message));
    }

    fn info(&mut self, entity: &str, id: &str, message: impl Into<String>) {
        self.infos.push(Self::issue("info", entity, id, message));
    }

    pub(super) fn blocked(&self) -> bool {
        !self.errors.is_empty()
    }

    pub(super) fn status(&self) -> &'static str {
        if self.blocked() {
            "blocked"
        } else {
            "passed"
        }
    }

    pub(super) fn first_error(&self) -> Option<&str> {
        self.errors
            .first()
            .and_then(|issue| issue.get("message"))
            .and_then(Value::as_str)
    }

    pub(super) fn to_value(&self) -> Value {
        json!({
            "status": self.status(),
            "errors": self.errors,
            "notices": self.notices,
            "infos": self.infos,
        })
    }
}

#[derive(Debug, Clone)]
pub(super) struct DekiDataPlan {
    /// The mutation as it will be applied: payload normalized by the storage
    /// contract. Approvals store this, never the raw model payload.
    pub(super) mutation: DekiDataMutation,
    pub(super) command: String,
    pub(super) operation_hash: String,
    pub(super) validation: DekiDataValidation,
    pub(super) summary: Value,
    pub(super) affected_entities: Map<String, Value>,
    pub(super) affected_rows: usize,
    pub(super) preview: Vec<Value>,
    pub(super) preview_truncated: bool,
}

/// Computes the dry-run plan for a mutation against current storage without
/// writing. Malformed commands fail; semantically invalid changes produce a
/// blocked plan so the model can see every validation message.
pub(super) fn plan_mutation(
    state: &AppState,
    mutation: &DekiDataMutation,
) -> AppResult<DekiDataPlan> {
    let entity = mutation.collection;
    let id = mutation.id.as_str();
    let mut validation = DekiDataValidation::default();
    let mut payload = mutation.payload.clone();
    let current = state.storage.get(entity, id)?;
    let mut side_effects: Vec<DeleteSideEffect> = Vec::new();
    let mut preview = Vec::new();

    match mutation.kind {
        DekiDataMutationKind::Insert | DekiDataMutationKind::Patch => {
            let require_complete = mutation.kind == DekiDataMutationKind::Insert;
            payload = validate_payload(entity, id, payload, require_complete, &mut validation);
            if let Some(object) = payload.as_object() {
                validate_parent_references(
                    state,
                    entity,
                    id,
                    object,
                    require_complete,
                    &mut validation,
                )?;
            }
        }
        DekiDataMutationKind::Delete => {}
    }

    match mutation.kind {
        DekiDataMutationKind::Insert => {
            if current.is_some() {
                validation.error(
                    entity,
                    id,
                    format!("{entity}/{id} already exists; this insert was already applied."),
                );
            }
            let mut record = payload.as_object().cloned().unwrap_or_default();
            record.insert("id".to_string(), json!(id));
            preview.push(row_change(
                entity,
                id,
                "insert",
                None,
                Some(&Value::Object(record)),
            ));
        }
        DekiDataMutationKind::Patch => match current.as_ref() {
            None => validation.error(entity, id, format!("{entity}/{id} was not found.")),
            Some(current) => {
                let after = preview_patched_record(entity, current, &payload);
                let (before_subset, after_subset) = changed_subset(current, &after, 0);
                if before_subset.as_object().is_some_and(Map::is_empty)
                    && after_subset.as_object().is_some_and(Map::is_empty)
                {
                    validation.error(entity, id, "The patch does not change any stored field.");
                }
                if entity == "characters" {
                    validation.info(
                        entity,
                        id,
                        "De-Koi may save a character version snapshot before applying this edit.",
                    );
                }
                preview.push(row_change(
                    entity,
                    id,
                    "update",
                    Some(&before_subset),
                    Some(&after_subset),
                ));
            }
        },
        DekiDataMutationKind::Delete => match current.as_ref() {
            None => validation.error(entity, id, format!("{entity}/{id} was not found.")),
            Some(current) => {
                side_effects = delete_side_effects(state, entity, id, current)?;
                for effect in &side_effects {
                    validation.notice(
                        entity,
                        id,
                        format!(
                            "Also {} {} {} row(s).",
                            effect.verb(),
                            effect.rows.len(),
                            effect.entity
                        ),
                    );
                }
                if let Some(note) = delete_file_note(entity) {
                    validation.notice(entity, id, note);
                }
                preview.push(row_change(entity, id, "delete", Some(current), None));
            }
        },
    }

    // A blocked plan cannot apply, so it affects nothing. Its preview stays as
    // evidence for the validation messages.
    let can_apply = !validation.blocked();
    let mut preview_truncated = false;
    let mut affected_entities = Map::new();
    let primary_rows = usize::from(
        can_apply
            && match mutation.kind {
                DekiDataMutationKind::Insert => true,
                _ => current.is_some(),
            },
    );
    if primary_rows > 0 {
        affected_entities.insert(entity.to_string(), json!(primary_rows));
    }
    let mut affected_rows = primary_rows;
    let (mut side_deleted, mut side_updated) = (0, 0);
    for effect in &side_effects {
        if can_apply {
            affected_rows += effect.rows.len();
            let counted = affected_entities
                .get(effect.entity)
                .and_then(Value::as_u64)
                .unwrap_or(0);
            affected_entities.insert(
                effect.entity.to_string(),
                json!(counted + effect.rows.len() as u64),
            );
            if effect.action == "delete" {
                side_deleted += effect.rows.len();
            } else {
                side_updated += effect.rows.len();
            }
        }
        for row in effect.rows.iter().take(CASCADE_PREVIEW_ROWS) {
            preview.push(effect.preview_row(row));
        }
        preview_truncated |= effect.rows.len() > CASCADE_PREVIEW_ROWS;
    }

    let operation_hash = operation_hash(mutation, &payload, current.as_ref(), &side_effects);
    let (inserted, updated, deleted) = match mutation.kind {
        DekiDataMutationKind::Insert => (primary_rows, 0, 0),
        DekiDataMutationKind::Patch => (0, primary_rows, 0),
        DekiDataMutationKind::Delete => (0, side_updated, primary_rows + side_deleted),
    };
    let summary = json!({
        "matchedRows": usize::from(current.is_some()),
        "affectedRows": affected_rows,
        "insertedRows": inserted,
        "updatedRows": updated,
        "replacedRows": 0,
        "deletedRows": deleted,
        "affectedEntities": affected_entities,
        "preview": preview,
        "truncated": preview_truncated,
    });
    Ok(DekiDataPlan {
        mutation: DekiDataMutation {
            payload,
            ..mutation.clone()
        },
        command: mutation.command_label(),
        operation_hash,
        validation,
        summary,
        affected_entities,
        affected_rows,
        preview,
        preview_truncated,
    })
}

/// Applies an approved mutation through the same storage owners the app's
/// editors use, so normalization, cascades, and version snapshots match.
pub(super) fn apply_mutation(state: &AppState, mutation: &DekiDataMutation) -> AppResult<Value> {
    let entity = mutation.collection.to_string();
    match mutation.kind {
        DekiDataMutationKind::Insert => {
            let mut record = mutation.payload.as_object().cloned().ok_or_else(|| {
                AppError::invalid_input("deki_data insert value must be a JSON object.")
            })?;
            record.insert("id".to_string(), json!(mutation.id));
            entity_commands::storage_create_inner(state, entity, Value::Object(record))
        }
        DekiDataMutationKind::Patch => entity_commands::storage_update_inner(
            state,
            entity,
            mutation.id.clone(),
            mutation.payload.clone(),
        ),
        DekiDataMutationKind::Delete => {
            let result = entity_commands::delete_entity(state, &entity, &mutation.id, false)?;
            if result.get("deleted").and_then(Value::as_bool) != Some(true) {
                return Err(AppError::not_found(format!(
                    "{entity}/{} no longer exists, so nothing was deleted.",
                    mutation.id
                )));
            }
            Ok(result)
        }
    }
}

fn validate_payload(
    entity: &str,
    id: &str,
    payload: Value,
    require_complete: bool,
    validation: &mut DekiDataValidation,
) -> Value {
    let Some(object) = payload.as_object() else {
        validation.error(entity, id, "The value or patch must be a JSON object.");
        return payload;
    };
    if object.is_empty() {
        validation.error(entity, id, "The value or patch is empty.");
    }
    let owned = object
        .keys()
        .filter(|key| STORAGE_OWNED_FIELDS.contains(&key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !owned.is_empty() {
        validation.error(
            entity,
            id,
            format!(
                "Storage-owned field(s) cannot be set: {}.",
                owned.join(", ")
            ),
        );
    }
    let size = serde_json::to_vec(&payload)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX);
    if size > PAYLOAD_MAX_BYTES {
        validation.error(
            entity,
            id,
            format!(
                "The payload is {size} bytes; the limit is {PAYLOAD_MAX_BYTES}. Split the change."
            ),
        );
    }
    match super::normalize_deki_record_action_payload(entity, &payload, require_complete) {
        Ok(normalized) => normalized,
        Err(error) => {
            validation.error(entity, id, error.message);
            payload
        }
    }
}

fn validate_parent_references(
    state: &AppState,
    entity: &str,
    id: &str,
    object: &Map<String, Value>,
    require_parent: bool,
    validation: &mut DekiDataValidation,
) -> AppResult<()> {
    let (field, parent_entity) = match entity {
        "lorebook-entries" => ("lorebookId", "lorebooks"),
        "prompt-sections" | "prompt-groups" | "prompt-variables" => ("presetId", "prompts"),
        _ => {
            if require_parent && !has_text(object, "name") && entity != "characters" {
                validation.error(entity, id, "name is required.");
            }
            return Ok(());
        }
    };
    if require_parent && entity == "lorebook-entries" && !has_text(object, "name") {
        validation.error(entity, id, "name is required.");
    }
    match object.get(field) {
        None if require_parent => {
            validation.error(entity, id, format!("{field} is required."));
        }
        None => {}
        Some(value) => match value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            None => validation.error(entity, id, format!("{field} must be a non-empty id.")),
            Some(parent_id) => {
                if state.storage.get(parent_entity, parent_id)?.is_none() {
                    validation.error(
                        entity,
                        id,
                        format!("{field} {parent_id} does not match an existing {parent_entity} record."),
                    );
                }
            }
        },
    }
    Ok(())
}

fn has_text(object: &Map<String, Value>, field: &str) -> bool {
    object
        .get(field)
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
}

/// A durable change an approved delete makes beyond its primary row. Each one
/// mirrors a cleanup the storage owner performs (see `delete_entity`), is shown
/// in the preview and counts, and is folded into the operation hash so
/// approval-time revalidation rejects a plan whose related rows changed.
struct DeleteSideEffect {
    entity: &'static str,
    /// `delete` removes the rows; `update` changes them in place.
    action: &'static str,
    /// What happens to each row, in words the approval card can show.
    effect: &'static str,
    rows: Vec<Value>,
}

impl DeleteSideEffect {
    fn verb(&self) -> &'static str {
        if self.action == "delete" {
            "deletes"
        } else {
            "changes"
        }
    }

    fn preview_row(&self, row: &Value) -> Value {
        let id = row.get("id").and_then(Value::as_str).unwrap_or_default();
        let label = row_label(row);
        let after = (self.action != "delete").then_some(&label);
        let mut change = row_change(self.entity, id, self.action, Some(&label), after);
        change["effect"] = json!(self.effect);
        change
    }
}

fn delete_side_effects(
    state: &AppState,
    entity: &str,
    id: &str,
    current: &Value,
) -> AppResult<Vec<DeleteSideEffect>> {
    let mut effects = Vec::new();
    let mut push =
        |entity: &'static str, action: &'static str, effect: &'static str, rows: Vec<Value>| {
            if !rows.is_empty() {
                effects.push(DeleteSideEffect {
                    entity,
                    action,
                    effect,
                    rows,
                });
            }
        };
    match entity {
        "lorebooks" => {
            push(
                "lorebook-entries",
                "delete",
                "deleted with the lorebook",
                rows_where(state, "lorebook-entries", |row| {
                    text_field(row, "lorebookId") == Some(id)
                })?,
            );
            push(
                "lorebook-folders",
                "delete",
                "deleted with the lorebook",
                rows_where(state, "lorebook-folders", |row| {
                    text_field(row, "lorebookId") == Some(id)
                })?,
            );
            push(
                "chats",
                "update",
                "stops using this lorebook",
                rows_where(state, "chats", |row| chat_uses_lorebook(row, id))?,
            );
            push(
                "characters",
                "update",
                "loses its linked copy of this lorebook",
                rows_where(state, "characters", |row| {
                    embedded_lorebook_id(row) == Some(id)
                })?,
            );
        }
        "lorebook-entries" => {
            if let Some(lorebook_id) = text_field(current, "lorebookId") {
                push(
                    "characters",
                    "update",
                    "drops this entry from its linked lorebook copy",
                    rows_where(state, "characters", |row| {
                        embedded_lorebook_id(row) == Some(lorebook_id)
                    })?,
                );
            }
        }
        "prompts" => {
            for child in ["prompt-sections", "prompt-groups", "prompt-variables"] {
                push(
                    child,
                    "delete",
                    "deleted with the prompt preset",
                    rows_where(state, child, |row| text_field(row, "presetId") == Some(id))?,
                );
            }
        }
        "characters" => {
            push(
                "character-gallery",
                "delete",
                "gallery image deleted with the character",
                rows_where(state, "character-gallery", |row| {
                    text_field(row, "characterId") == Some(id)
                })?,
            );
            push(
                knowledge_edges::COLLECTION,
                "update",
                "knowledge link invalidated",
                knowledge_links(state, "character", id)?,
            );
            push(
                canonical_memory::MEMORY_COLLECTION,
                "update",
                "memory moved to deleted",
                rows_where(state, canonical_memory::MEMORY_COLLECTION, |row| {
                    row.get("scope").is_some_and(|scope| {
                        text_field(scope, "kind") == Some("character")
                            && text_field(scope, "id") == Some(id)
                    }) && text_field(row, "status") != Some("deleted")
                })?,
            );
        }
        "personas" => {
            push(
                "persona-gallery",
                "delete",
                "gallery image deleted with the persona",
                rows_where(state, "persona-gallery", |row| {
                    text_field(row, "personaId") == Some(id)
                })?,
            );
            push(
                knowledge_edges::COLLECTION,
                "update",
                "knowledge link invalidated",
                knowledge_links(state, "persona", id)?,
            );
        }
        "character-groups" => push(
            knowledge_edges::COLLECTION,
            "update",
            "knowledge link invalidated",
            knowledge_links(state, "group", id)?,
        ),
        _ => {}
    }
    Ok(effects)
}

/// Rows of `collection` matching `predicate`, sorted by id so the preview and
/// the operation hash are stable.
fn rows_where(
    state: &AppState,
    collection: &str,
    predicate: impl Fn(&Value) -> bool,
) -> AppResult<Vec<Value>> {
    let mut rows = state
        .storage
        .list(collection)?
        .into_iter()
        .filter(|row| predicate(row))
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| text_field(left, "id").cmp(&text_field(right, "id")));
    Ok(rows)
}

/// Knowledge links the holder delete invalidates (active or proposed ones).
fn knowledge_links(state: &AppState, holder_kind: &str, holder_id: &str) -> AppResult<Vec<Value>> {
    rows_where(state, knowledge_edges::COLLECTION, |row| {
        row.get("holder").is_some_and(|holder| {
            text_field(holder, "kind") == Some(holder_kind)
                && text_field(holder, "id") == Some(holder_id)
        }) && matches!(text_field(row, "status"), Some("active" | "proposed"))
    })
}

fn text_field<'a>(row: &'a Value, field: &str) -> Option<&'a str> {
    row.get(field).and_then(Value::as_str)
}

/// Objects may be stored as JSON text; read either shape.
fn object_field(row: &Value, field: &str) -> Option<Value> {
    match row.get(field)? {
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .filter(Value::is_object),
        value @ Value::Object(_) => Some(value.clone()),
        _ => None,
    }
}

fn lists_id(value: Option<&Value>, id: &str) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|ids| ids.iter().any(|value| value.as_str() == Some(id)))
}

fn chat_uses_lorebook(chat: &Value, lorebook_id: &str) -> bool {
    lists_id(chat.get("activeLorebookIds"), lorebook_id)
        || object_field(chat, "metadata")
            .is_some_and(|metadata| lists_id(metadata.get("activeLorebookIds"), lorebook_id))
}

fn embedded_lorebook_id(character: &Value) -> Option<&str> {
    character
        .pointer("/data/extensions/importMetadata/embeddedLorebook/lorebookId")
        .and_then(Value::as_str)
}

/// Managed files are not rows, so they are named rather than listed.
fn delete_file_note(entity: &str) -> Option<&'static str> {
    match entity {
        "characters" => {
            Some("Also removes the character's avatar, sprite, and gallery image files.")
        }
        "personas" => Some("Also removes the persona's avatar, sprite, and gallery image files."),
        "lorebooks" => Some("Also removes the lorebook's image file."),
        _ => None,
    }
}

/// Mirrors how storage owners merge a patch so the preview shows the stored
/// result: character `data` merges recursively, other fields replace.
fn preview_patched_record(entity: &str, current: &Value, patch: &Value) -> Value {
    let mut record = current.as_object().cloned().unwrap_or_default();
    let Some(patch) = patch.as_object() else {
        return Value::Object(record);
    };
    for (key, value) in patch {
        if entity == "characters" && key == "data" {
            let merged = record
                .entry("data".to_string())
                .or_insert_with(|| json!({}));
            merge_recursive(merged, value);
        } else {
            record.insert(key.clone(), value.clone());
        }
    }
    Value::Object(record)
}

fn merge_recursive(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                match target.get_mut(key) {
                    Some(existing) if existing.is_object() && value.is_object() => {
                        merge_recursive(existing, value)
                    }
                    _ => {
                        target.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (target, patch) => *target = patch.clone(),
    }
}

/// Returns the before/after subsets that differ, descending two object levels
/// so a one-field character edit previews that field, not the whole card.
fn changed_subset(before: &Value, after: &Value, depth: usize) -> (Value, Value) {
    let (Some(before_object), Some(after_object)) = (before.as_object(), after.as_object()) else {
        return (before.clone(), after.clone());
    };
    let mut before_changed = Map::new();
    let mut after_changed = Map::new();
    let mut keys = before_object
        .keys()
        .chain(after_object.keys())
        .collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    for key in keys {
        if key == "updatedAt" {
            continue;
        }
        let left = before_object.get(key);
        let right = after_object.get(key);
        if left == right {
            continue;
        }
        match (left, right) {
            (Some(left), Some(right)) if depth < 2 && left.is_object() && right.is_object() => {
                let (left, right) = changed_subset(left, right, depth + 1);
                before_changed.insert(key.clone(), left);
                after_changed.insert(key.clone(), right);
            }
            _ => {
                before_changed.insert(key.clone(), left.cloned().unwrap_or(Value::Null));
                after_changed.insert(key.clone(), right.cloned().unwrap_or(Value::Null));
            }
        }
    }
    (Value::Object(before_changed), Value::Object(after_changed))
}

fn row_change(
    entity: &str,
    id: &str,
    action: &str,
    before: Option<&Value>,
    after: Option<&Value>,
) -> Value {
    let mut row = json!({ "entity": entity, "id": id, "action": action });
    if let Some(before) = before {
        row["before"] = compact_preview(before, 0);
    }
    if let Some(after) = after {
        row["after"] = compact_preview(after, 0);
    }
    row
}

fn row_label(row: &Value) -> Value {
    let mut label = Map::new();
    for key in [
        "id",
        "name",
        "title",
        "identifier",
        "variableName",
        "filename",
    ] {
        if let Some(value) = row.get(key) {
            label.insert(key.to_string(), value.clone());
        }
    }
    if let Some(name) = row.pointer("/data/name") {
        label.insert("data".to_string(), json!({ "name": name }));
    }
    Value::Object(label)
}

/// Bounds preview values so a delete of a large card or lorebook cannot flood
/// the model context or the approval card.
fn compact_preview(value: &Value, depth: usize) -> Value {
    match value {
        Value::String(text) => {
            let count = text.chars().count();
            if count > PREVIEW_STRING_MAX_CHARS {
                let kept = text
                    .chars()
                    .take(PREVIEW_STRING_MAX_CHARS)
                    .collect::<String>();
                json!(format!(
                    "{kept}… [+{} chars]",
                    count - PREVIEW_STRING_MAX_CHARS
                ))
            } else {
                value.clone()
            }
        }
        Value::Array(items) => {
            if depth >= PREVIEW_MAX_DEPTH {
                return json!(format!("[{} item(s) omitted]", items.len()));
            }
            let mut compacted = items
                .iter()
                .take(PREVIEW_ARRAY_MAX_ITEMS)
                .map(|item| compact_preview(item, depth + 1))
                .collect::<Vec<_>>();
            if items.len() > PREVIEW_ARRAY_MAX_ITEMS {
                compacted.push(json!(format!(
                    "[+{} more item(s)]",
                    items.len() - PREVIEW_ARRAY_MAX_ITEMS
                )));
            }
            Value::Array(compacted)
        }
        Value::Object(object) => {
            if depth >= PREVIEW_MAX_DEPTH {
                return json!(format!("[{} field(s) omitted]", object.len()));
            }
            Value::Object(
                object
                    .iter()
                    .map(|(key, value)| (key.clone(), compact_preview(value, depth + 1)))
                    .collect(),
            )
        }
        _ => value.clone(),
    }
}

fn operation_hash(
    mutation: &DekiDataMutation,
    payload: &Value,
    current: Option<&Value>,
    side_effects: &[DeleteSideEffect],
) -> String {
    let cascade = side_effects
        .iter()
        .map(|effect| json!({ "entity": effect.entity, "action": effect.action, "rows": effect.rows }))
        .collect::<Vec<_>>();
    let material = canonical_json(&json!({
        "kind": mutation.kind.as_str(),
        "collection": mutation.collection,
        "id": mutation.id,
        "payload": payload,
        "current": current,
        "cascade": cascade,
    }));
    let digest = Sha256::digest(material.as_bytes());
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("sha256:{hex}")
}

/// Serializes with object keys sorted at every level, independent of whether
/// serde_json preserves insertion order in this build.
fn canonical_json(value: &Value) -> String {
    fn sorted(value: &Value) -> Value {
        match value {
            Value::Object(object) => {
                let mut keys = object.keys().collect::<Vec<_>>();
                keys.sort();
                let mut sorted_object = Map::new();
                for key in keys {
                    sorted_object.insert(key.clone(), sorted(&object[key]));
                }
                Value::Object(sorted_object)
            }
            Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
            _ => value.clone(),
        }
    }
    sorted(value).to_string()
}

fn required_reason(reason: String) -> AppResult<String> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::invalid_input(
            "deki_data mutations require a short reason the user will see on the approval.",
        ));
    }
    Ok(reason.chars().take(REASON_MAX_CHARS).collect())
}

fn required_id(id: String) -> AppResult<String> {
    let id = id.trim();
    if id.is_empty() || id.chars().count() > 256 {
        return Err(AppError::invalid_input(
            "deki_data requires an exact record id.",
        ));
    }
    Ok(id.to_string())
}

fn expect_no_args(action: &str, rest: &Value) -> AppResult<()> {
    if rest.as_object().is_some_and(|object| !object.is_empty()) {
        return Err(AppError::invalid_input(format!(
            "deki_data {action} takes no arguments besides action."
        )));
    }
    Ok(())
}

fn parse_args<T>(action: &str, args: Value) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(args).map_err(|error| {
        AppError::invalid_input(format!("deki_data {action} args are invalid: {error}"))
    })
}
