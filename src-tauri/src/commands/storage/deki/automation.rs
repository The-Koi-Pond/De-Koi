//! Extra rules for Deki-senpai's `deki_data` changes to extensions and custom
//! agents. Both run code or prompts inside the app, so Deki may propose them
//! but never switch them on: a new one is created off, a patch cannot change
//! `enabled`, and built-in agents are not Deki's to edit or delete.

use super::data_cli::{DekiDataMutation, DekiDataMutationKind, DekiDataValidation};
use crate::state::AppState;
use crate::storage_commands::agents;
use marinara_core::AppResult;
use serde_json::{json, Map, Value};

const AGENT_PHASES: &[&str] = &["pre_generation", "parallel", "post_processing"];
const CUSTOM_AGENT_PREFIX: &str = "custom-";
const AGENT_TYPE_MAX_CHARS: usize = 80;

/// Fills the defaults a new extension or agent needs before the dry-run is
/// planned, so the preview, the operation hash, and the applied record agree:
/// `enabled: false`, and for agents a unique `custom-` type and a phase.
pub(super) fn prepare_insert(
    state: &AppState,
    mut mutation: DekiDataMutation,
) -> AppResult<DekiDataMutation> {
    if mutation.kind != DekiDataMutationKind::Insert
        || !matches!(mutation.collection, "extensions" | "agents")
    {
        return Ok(mutation);
    }
    let Some(object) = mutation.payload.as_object_mut() else {
        return Ok(mutation);
    };
    object.entry("enabled").or_insert(json!(false));
    if mutation.collection == "agents" {
        object.entry("phase").or_insert(json!("parallel"));
        let has_type = object
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        if !has_type {
            let name = object.get("name").and_then(Value::as_str).unwrap_or("");
            let agent_type = unique_agent_type(state, &slug_agent_type(name))?;
            object.insert("type".to_string(), json!(agent_type));
        }
    }
    Ok(mutation)
}

/// Checks an extension or agent change against the rules above. Other
/// collections pass through untouched.
pub(super) fn validate(
    state: &AppState,
    mutation: &DekiDataMutation,
    payload: &Value,
    current: Option<&Value>,
    validation: &mut DekiDataValidation,
) -> AppResult<()> {
    let entity = mutation.collection;
    if !matches!(entity, "extensions" | "agents") {
        return Ok(());
    }
    let id = mutation.id.as_str();
    let empty = Map::new();
    let object = payload.as_object().unwrap_or(&empty);
    match mutation.kind {
        DekiDataMutationKind::Insert => {
            if object.get("enabled").and_then(Value::as_bool) == Some(true) {
                validation.error(
                    entity,
                    id,
                    "Deki-senpai creates extensions and agents switched off. Leave enabled out; the user turns it on after reviewing it.",
                );
            }
            if entity == "agents" {
                validate_new_agent(state, id, object, validation)?;
            }
        }
        DekiDataMutationKind::Patch => {
            for field in ["enabled", "type"] {
                if object.contains_key(field) {
                    validation.error(
                        entity,
                        id,
                        format!("Deki-senpai cannot change {field} on {entity}; the user changes that in De-Koi."),
                    );
                }
            }
            reject_built_in_agent(entity, id, current, "edit", validation);
        }
        DekiDataMutationKind::Delete => {
            reject_built_in_agent(entity, id, current, "delete", validation);
        }
    }
    Ok(())
}

fn validate_new_agent(
    state: &AppState,
    id: &str,
    object: &Map<String, Value>,
    validation: &mut DekiDataValidation,
) -> AppResult<()> {
    let text = |field: &str| {
        object
            .get(field)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
    };
    if text("promptTemplate").is_empty() {
        validation.error("agents", id, "A custom agent needs a promptTemplate.");
    }
    if !AGENT_PHASES.contains(&text("phase")) {
        validation.error(
            "agents",
            id,
            "Agent phase must be pre_generation, parallel, or post_processing.",
        );
    }
    let agent_type = text("type");
    if !agent_type.starts_with(CUSTOM_AGENT_PREFIX)
        || agent_type.chars().count() > AGENT_TYPE_MAX_CHARS
        || slug_agent_type(agent_type) != agent_type
    {
        validation.error(
            "agents",
            id,
            "A custom agent type must be lowercase letters, digits, and dashes starting with custom-.",
        );
    } else if agents::is_built_in_agent_type(agent_type) {
        validation.error(
            "agents",
            id,
            format!("{agent_type} is a built-in agent type; choose another type."),
        );
    } else if existing_agent_types(state)?.contains(&agent_type.to_string()) {
        validation.error(
            "agents",
            id,
            format!("An agent with type {agent_type} already exists; choose another type."),
        );
    }
    Ok(())
}

fn reject_built_in_agent(
    entity: &str,
    id: &str,
    current: Option<&Value>,
    verb: &str,
    validation: &mut DekiDataValidation,
) {
    if entity != "agents" {
        return;
    }
    let agent_type = current
        .and_then(|row| row.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if agents::is_built_in_agent_type(agent_type) {
        validation.error(
            entity,
            id,
            format!("{agent_type} is a built-in agent; Deki-senpai cannot {verb} it."),
        );
    }
}

fn existing_agent_types(state: &AppState) -> AppResult<Vec<String>> {
    Ok(state
        .storage
        .list("agents")?
        .into_iter()
        .filter_map(|row| row.get("type").and_then(Value::as_str).map(str::to_string))
        .collect())
}

fn unique_agent_type(state: &AppState, base: &str) -> AppResult<String> {
    let existing = existing_agent_types(state)?;
    let taken = |candidate: &str| {
        existing.iter().any(|value| value == candidate) || agents::is_built_in_agent_type(candidate)
    };
    if !taken(base) {
        return Ok(base.to_string());
    }
    Ok((2..1000)
        .map(|index| format!("{base}-{index}"))
        .find(|candidate| !taken(candidate))
        .unwrap_or_else(|| format!("{base}-{}", marinara_core::new_id())))
}

/// `custom-` plus the lowercase alphanumeric words of `value`, dash-joined.
fn slug_agent_type(value: &str) -> String {
    let body = value
        .trim()
        .trim_start_matches(CUSTOM_AGENT_PREFIX)
        .to_lowercase()
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let body = if body.is_empty() {
        "deki-agent".to_string()
    } else {
        body
    };
    let mut slug = format!("{CUSTOM_AGENT_PREFIX}{body}");
    slug.truncate(AGENT_TYPE_MAX_CHARS);
    slug.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_type_slugs_are_custom_and_stable() {
        assert_eq!(slug_agent_type("Mood Tracker!"), "custom-mood-tracker");
        assert_eq!(
            slug_agent_type("custom-mood-tracker"),
            "custom-mood-tracker"
        );
        assert_eq!(slug_agent_type("   "), "custom-deki-agent");
    }
}
