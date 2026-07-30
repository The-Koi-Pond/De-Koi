use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const MAX_PROPOSALS: usize = 1_000;
const MAX_SOURCE_IDS: usize = 8;
const MAX_REPLACEMENT_CHARS: usize = 12_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CleanupScope {
    pub kind: String,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExpectedState {
    pub content: String,
    pub status: String,
    pub updated_at: Option<String>,
    pub pinned: bool,
    pub user_edited: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProposalType {
    KeepOne,
    Combine,
    Discard,
    Conflict,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CleanupReplacement {
    pub content: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CleanupProposal {
    pub id: String,
    #[serde(rename = "type")]
    pub proposal_type: ProposalType,
    pub source_ids: Vec<String>,
    pub expected: HashMap<String, ExpectedState>,
    pub winner_id: Option<String>,
    pub replacement: Option<CleanupReplacement>,
    #[serde(rename = "reason")]
    pub _reason: Option<String>,
    pub selected: bool,
    #[serde(rename = "estimatedTokensBefore")]
    pub _estimated_tokens_before: Option<usize>,
    #[serde(rename = "estimatedTokensAfter")]
    pub _estimated_tokens_after: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyCleanupRequestV1 {
    pub version: u32,
    pub scope: CleanupScope,
    pub proposals: Vec<CleanupProposal>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CleanupStore {
    Chat,
    Canonical,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CleanupTarget {
    pub store: CleanupStore,
    pub scope: CleanupScope,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyCleanupRequestV2 {
    pub version: u32,
    pub target: CleanupTarget,
    pub proposals: Vec<CleanupProposal>,
}

#[derive(Clone, Debug)]
pub(crate) struct ApplyCleanupRequest {
    pub store: CleanupStore,
    pub scope: CleanupScope,
    pub proposals: Vec<CleanupProposal>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UndoCleanupRequestV1 {
    pub scope: CleanupScope,
    pub batch_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UndoCleanupRequestV2 {
    pub version: u32,
    pub target: CleanupTarget,
    pub batch_id: String,
}

#[derive(Clone, Debug)]
pub(crate) struct UndoCleanupRequest {
    pub store: CleanupStore,
    pub scope: CleanupScope,
    pub batch_id: String,
}

fn validate_scope(scope: &CleanupScope) -> AppResult<()> {
    if !matches!(scope.kind.trim(), "chat" | "scene" | "character") {
        return Err(AppError::invalid_input("Unsupported memory cleanup scope"));
    }
    if scope.id.trim().is_empty() {
        return Err(AppError::invalid_input(
            "Memory cleanup scope id is required",
        ));
    }
    Ok(())
}

fn validate_proposal_shape(proposal: &CleanupProposal) -> AppResult<()> {
    if proposal.id.trim().is_empty() {
        return Err(AppError::invalid_input(
            "Memory cleanup proposal id is required",
        ));
    }
    if proposal.source_ids.len() > MAX_SOURCE_IDS {
        return Err(AppError::invalid_input(format!(
            "Memory cleanup proposals may consume at most {MAX_SOURCE_IDS} sources"
        )));
    }
    let unique_ids = proposal
        .source_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>();
    if unique_ids.len() != proposal.source_ids.len() {
        return Err(AppError::invalid_input(
            "Memory cleanup source ids must be non-empty and unique",
        ));
    }
    if proposal
        .winner_id
        .as_deref()
        .is_some_and(|winner| winner.trim().is_empty() || unique_ids.contains(winner.trim()))
    {
        return Err(AppError::invalid_input(
            "A retained cleanup winner cannot also be consumed",
        ));
    }

    match proposal.proposal_type {
        ProposalType::KeepOne => {
            if proposal.source_ids.is_empty()
                || proposal
                    .winner_id
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
                || proposal.replacement.is_some()
            {
                return Err(AppError::invalid_input(
                    "Keep-one cleanup requires consumed sources and a separate winner",
                ));
            }
        }
        ProposalType::Combine => {
            if proposal.source_ids.len() < 2 {
                return Err(AppError::invalid_input(
                    "Combine cleanup requires at least two sources",
                ));
            }
        }
        ProposalType::Discard => {
            if proposal.source_ids.len() != 1
                || proposal.winner_id.is_some()
                || proposal.replacement.is_some()
                || proposal._reason.as_deref() != Some("Low-value memory")
            {
                return Err(AppError::invalid_input(
                    "Discard cleanup requires one source and the low-value reason",
                ));
            }
        }
        ProposalType::Conflict => {
            if proposal.selected {
                return Err(AppError::invalid_input(
                    "Conflicting memories cannot be selected for cleanup",
                ));
            }
            return Ok(());
        }
    }

    if proposal.proposal_type == ProposalType::Combine {
        let replacement = proposal.replacement.as_ref().ok_or_else(|| {
            AppError::invalid_input("Cleanup replacement content and kind are required")
        })?;
        if replacement.content.trim().is_empty() || replacement.kind.trim().is_empty() {
            return Err(AppError::invalid_input(
                "Cleanup replacement content and kind are required",
            ));
        }
        if replacement.content.chars().count() > MAX_REPLACEMENT_CHARS {
            return Err(AppError::invalid_input(
                "Cleanup replacement content is too long",
            ));
        }
    } else if proposal.replacement.is_some() {
        return Err(AppError::invalid_input(
            "This cleanup proposal cannot create a replacement",
        ));
    }

    let mut expected_ids = unique_ids;
    if let Some(winner_id) = proposal.winner_id.as_deref() {
        expected_ids.insert(winner_id.trim());
    }
    if proposal.expected.len() != expected_ids.len()
        || expected_ids
            .iter()
            .any(|id| !proposal.expected.contains_key(*id))
    {
        return Err(AppError::invalid_input(
            "Cleanup expected state must match every referenced source",
        ));
    }
    Ok(())
}

pub(crate) fn parse_apply_request(body: Value) -> AppResult<ApplyCleanupRequest> {
    let version = body.get("version").and_then(Value::as_u64);
    let request = match version {
        Some(1) => {
            let request: ApplyCleanupRequestV1 = serde_json::from_value(body).map_err(|error| {
                AppError::invalid_input(format!("Invalid memory cleanup request: {error}"))
            })?;
            if request.version != 1 {
                return Err(AppError::invalid_input(
                    "Unsupported memory cleanup request version",
                ));
            }
            ApplyCleanupRequest {
                store: match request.scope.kind.as_str() {
                    "character" => CleanupStore::Canonical,
                    _ => CleanupStore::Chat,
                },
                scope: request.scope,
                proposals: request.proposals,
            }
        }
        Some(2) => {
            let request: ApplyCleanupRequestV2 = serde_json::from_value(body).map_err(|error| {
                AppError::invalid_input(format!("Invalid memory cleanup request: {error}"))
            })?;
            if request.version != 2 {
                return Err(AppError::invalid_input(
                    "Unsupported memory cleanup request version",
                ));
            }
            ApplyCleanupRequest {
                store: request.target.store,
                scope: request.target.scope,
                proposals: request.proposals,
            }
        }
        _ => {
            return Err(AppError::invalid_input(
                "Unsupported memory cleanup request version",
            ))
        }
    };
    validate_scope(&request.scope)?;
    if request.proposals.len() > MAX_PROPOSALS {
        return Err(AppError::invalid_input(format!(
            "Memory cleanup accepts at most {MAX_PROPOSALS} proposals"
        )));
    }
    if !request
        .proposals
        .iter()
        .any(|proposal| proposal.selected && proposal.proposal_type != ProposalType::Conflict)
    {
        return Err(AppError::invalid_input(
            "Select at least one memory cleanup proposal",
        ));
    }
    let mut consumed = HashSet::new();
    for proposal in &request.proposals {
        validate_proposal_shape(proposal)?;
        if !proposal.selected || proposal.proposal_type == ProposalType::Conflict {
            continue;
        }
        for source_id in &proposal.source_ids {
            if !consumed.insert(source_id.as_str()) {
                return Err(AppError::invalid_input(
                    "A memory cleanup source cannot be consumed twice",
                ));
            }
        }
    }
    Ok(request)
}

pub(crate) fn parse_undo_request(body: Value) -> AppResult<UndoCleanupRequest> {
    let request = if body.get("version").and_then(Value::as_u64) == Some(2) {
        let request: UndoCleanupRequestV2 = serde_json::from_value(body).map_err(|error| {
            AppError::invalid_input(format!("Invalid memory cleanup undo request: {error}"))
        })?;
        if request.version != 2 {
            return Err(AppError::invalid_input(
                "Unsupported memory cleanup undo request version",
            ));
        }
        UndoCleanupRequest {
            store: request.target.store,
            scope: request.target.scope,
            batch_id: request.batch_id,
        }
    } else {
        let request: UndoCleanupRequestV1 = serde_json::from_value(body).map_err(|error| {
            AppError::invalid_input(format!("Invalid memory cleanup undo request: {error}"))
        })?;
        UndoCleanupRequest {
            store: match request.scope.kind.as_str() {
                "character" => CleanupStore::Canonical,
                _ => CleanupStore::Chat,
            },
            scope: request.scope,
            batch_id: request.batch_id,
        }
    };
    validate_scope(&request.scope)?;
    if request.batch_id.trim().is_empty() {
        return Err(AppError::invalid_input(
            "Memory cleanup batch id is required",
        ));
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn discard_request_with_count(count: usize) -> Value {
        let proposals = (0..count)
            .map(|index| {
                let source_id = format!("memory-{index}");
                json!({
                    "id": format!("discard-{index}"),
                    "type": "discard",
                    "sourceIds": [source_id.clone()],
                    "expected": {
                        (source_id): {
                            "content": "Low-value memory",
                            "status": "active",
                            "updatedAt": null,
                            "pinned": false,
                            "userEdited": false
                        }
                    },
                    "reason": "Low-value memory",
                    "selected": true
                })
            })
            .collect::<Vec<_>>();
        json!({
            "version": 1,
            "scope": { "kind": "chat", "id": "chat-1" },
            "proposals": proposals
        })
    }

    #[test]
    fn apply_contract_accepts_single_source_discard() {
        let request = parse_apply_request(discard_request_with_count(1))
            .expect("single-source discard should be valid");

        assert_eq!(request.proposals[0].proposal_type, ProposalType::Discard);
    }

    #[test]
    fn version_two_routes_canonical_chat_scope_to_canonical_storage() {
        let mut body = discard_request_with_count(1);
        body["version"] = json!(2);
        let scope = body["scope"].take();
        body.as_object_mut()
            .expect("request should be an object")
            .remove("scope");
        body["target"] = json!({ "store": "canonical", "scope": scope });

        let request = parse_apply_request(body).expect("version two request should parse");

        assert_eq!(request.store, CleanupStore::Canonical);
        assert_eq!(request.scope.kind, "chat");
    }

    #[test]
    fn version_two_rejects_an_unsupported_store() {
        let mut body = discard_request_with_count(1);
        body["version"] = json!(2);
        let scope = body["scope"].take();
        body.as_object_mut()
            .expect("request should be an object")
            .remove("scope");
        body["target"] = json!({ "store": "archive", "scope": scope });

        assert!(parse_apply_request(body).is_err());
    }

    #[test]
    fn apply_contract_rejects_invalid_discard_shapes() {
        let mut no_sources = discard_request_with_count(1);
        no_sources["proposals"][0]["sourceIds"] = json!([]);
        no_sources["proposals"][0]["expected"] = json!({});
        assert!(parse_apply_request(no_sources).is_err());

        let mut multiple_sources = discard_request_with_count(1);
        multiple_sources["proposals"][0]["sourceIds"] = json!(["memory-0", "memory-1"]);
        multiple_sources["proposals"][0]["expected"]["memory-1"] = json!({
            "content": "Another low-value memory",
            "status": "active",
            "updatedAt": null,
            "pinned": false,
            "userEdited": false
        });
        assert!(parse_apply_request(multiple_sources).is_err());

        let mut with_winner = discard_request_with_count(1);
        with_winner["proposals"][0]["winnerId"] = json!("memory-winner");
        with_winner["proposals"][0]["expected"]["memory-winner"] = json!({
            "content": "Winner",
            "status": "active",
            "updatedAt": null,
            "pinned": false,
            "userEdited": false
        });
        assert!(parse_apply_request(with_winner).is_err());

        let mut with_replacement = discard_request_with_count(1);
        with_replacement["proposals"][0]["replacement"] =
            json!({ "content": "Replacement", "kind": "fact" });
        assert!(parse_apply_request(with_replacement).is_err());
    }

    #[test]
    fn apply_contract_accepts_large_reviewed_batches_with_a_hard_cap() {
        assert!(parse_apply_request(discard_request_with_count(21)).is_ok());
        assert!(parse_apply_request(discard_request_with_count(1_001)).is_err());
    }

    #[test]
    fn apply_contract_rejects_single_memory_shorten() {
        let shorten = parse_apply_request(json!({
            "version": 1,
            "scope": { "kind": "chat", "id": "chat-1" },
            "proposals": [{
                "id": "proposal-1",
                "type": "shorten",
                "sourceIds": ["memory-1"],
                "expected": {
                    "memory-1": {
                        "content": "Long memory",
                        "status": "active",
                        "updatedAt": null,
                        "pinned": false,
                        "userEdited": false
                    }
                },
                "replacement": { "content": "Short memory", "kind": "summary" },
                "selected": true
            }]
        }));

        assert!(shorten.is_err());
    }

    #[test]
    fn apply_contract_rejects_duplicate_consumption_and_selected_conflicts() {
        let empty = parse_apply_request(json!({
            "version": 1,
            "scope": { "kind": "chat", "id": "chat-1" },
            "proposals": []
        }));
        assert!(empty.is_err());

        let duplicate = parse_apply_request(json!({
            "version": 1,
            "scope": { "kind": "chat", "id": "chat-1" },
            "proposals": [
                {
                    "id": "proposal-1",
                    "type": "combine",
                    "sourceIds": ["memory-1", "memory-3"],
                    "expected": {
                        "memory-1": {
                            "content": "Long memory",
                            "status": "active",
                            "updatedAt": null,
                            "pinned": false,
                            "userEdited": false
                        },
                        "memory-3": {
                            "content": "Related memory",
                            "status": "active",
                            "updatedAt": null,
                            "pinned": false,
                            "userEdited": false
                        }
                    },
                    "replacement": { "content": "Combined memory", "kind": "summary" },
                    "selected": true
                },
                {
                    "id": "proposal-2",
                    "type": "keep_one",
                    "sourceIds": ["memory-1"],
                    "expected": {
                        "memory-1": {
                            "content": "Long memory",
                            "status": "active",
                            "updatedAt": null,
                            "pinned": false,
                            "userEdited": false
                        },
                        "memory-2": {
                            "content": "Short memory",
                            "status": "active",
                            "updatedAt": null,
                            "pinned": false,
                            "userEdited": false
                        }
                    },
                    "winnerId": "memory-2",
                    "selected": true
                }
            ]
        }));
        assert!(duplicate.is_err());

        let selected_conflict = parse_apply_request(json!({
            "version": 1,
            "scope": { "kind": "chat", "id": "chat-1" },
            "proposals": [{
                "id": "proposal-1",
                "type": "conflict",
                "sourceIds": ["memory-1", "memory-2"],
                "expected": {},
                "selected": true
            }]
        }));
        assert!(selected_conflict.is_err());
    }
}
