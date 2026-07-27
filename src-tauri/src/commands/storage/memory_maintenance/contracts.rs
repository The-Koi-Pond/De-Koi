use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const MAX_PROPOSALS: usize = 20;
const MAX_SOURCE_IDS: usize = 8;
const MAX_REPLACEMENT_CHARS: usize = 12_000;

#[derive(Clone, Debug, Deserialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProposalType {
    KeepOne,
    Combine,
    Shorten,
    Conflict,
}

#[derive(Clone, Debug, Deserialize)]
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
pub(crate) struct ApplyCleanupRequest {
    pub version: u32,
    pub scope: CleanupScope,
    pub proposals: Vec<CleanupProposal>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UndoCleanupRequest {
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
        ProposalType::Shorten => {
            if proposal.source_ids.len() != 1 {
                return Err(AppError::invalid_input(
                    "Shorten cleanup requires exactly one source",
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

    if matches!(
        proposal.proposal_type,
        ProposalType::Combine | ProposalType::Shorten
    ) {
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
    let request: ApplyCleanupRequest = serde_json::from_value(body).map_err(|error| {
        AppError::invalid_input(format!("Invalid memory cleanup request: {error}"))
    })?;
    if request.version != 1 {
        return Err(AppError::invalid_input(
            "Unsupported memory cleanup request version",
        ));
    }
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
    let request: UndoCleanupRequest = serde_json::from_value(body).map_err(|error| {
        AppError::invalid_input(format!("Invalid memory cleanup undo request: {error}"))
    })?;
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
