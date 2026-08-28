use marinara_core::{now_iso, AppResult};
use marinara_storage::FileStorage;
use serde_json::{json, Map, Value};
use std::path::Path;

const MARINARA_PRESET_ID: &str = "7huDl_SOx3a5EZtMeKqSR";
const MARINARA_PRESET_NAME: &str = "De-Koi's Universal Preset";
const UNIVERSAL_V2_PRESET_ID: &str = "preset_universal_v2";
const UNIVERSAL_V2_PRESET_NAME: &str = "De-Koi Universal Preset V2";
const LEGACY_MARINARA_UNIVERSAL_PRESET_NAME: &str = "Marinara's Universal Preset";
const LEGACY_MARINARA_PRESET_NAME: &str = "Default";
const MARINARA_PRESET_AUTHOR: &str = "De-Koi";
const LEGACY_MARINARA_PRESET_AUTHOR: &str = "Marinara";
const LEGACY_DEKI_CHARACTER_ID: &str = "__professor_mari__";
const LEGACY_CLEANUP_MAX_COLLECTION_BYTES: u64 = 4 * 1024 * 1024;
const BUNDLED_UNIVERSAL_V2_PRESET_JSON: &str =
    include_str!("../resources/default-data/db/default-preset-v2.json");
const HISTORICAL_UNIVERSAL_V2_SFW_BOUNDARY: &str = "Keep the scene SFW. Profanity, fear, danger, grief, and non-graphic violence may appear when appropriate, but sexual content fades to black and gore stays restrained.";
const HISTORICAL_UNIVERSAL_V2_ADULT_BOUNDARY: &str = "Adult dark fiction is allowed for mature audiences when the user has opted into it. Treat the user's author-level consent and stated boundaries as the safety layer; do not require fictional relationships or character behavior to be healthy, gentle, morally approved, or consensual inside the story. Adult characters may be cruel, selfish, coercive, violent, deceptive, obsessive, toxic, or exploitative when the scenario calls for it. Keep minors and real-world sexualization out of explicit content, respect any user-stated stop or boundary, and otherwise continue the fictional scene without moralizing, safety lectures, or consent-check stalling.";
const HISTORICAL_UNIVERSAL_V2_SHORT_ADULT_BOUNDARY: &str = "Adult dark fiction is allowed.";
const HISTORICAL_UNIVERSAL_V2_AGENCY_SECTION: &str = "{{agencyStrictness}}\n\nApply this content boundary: {{contentBoundary}}\n\nFor adult dark fiction, separate writer consent from character consent. The user's request, selected boundary, chat history, and stated limits define what the collaboration permits; characters inside the fiction may still lie, resist, threaten, coerce, harm, exploit, desire, or make terrible choices. Do not interrupt an opted-in adult scene just because the fictional relationship is unhealthy, non-consensual, toxic, villainous, or frightening.\n\nPause, clarify, redirect, fade out, or refuse only when the user's author-level consent, age framing, or stated boundaries are genuinely unclear, or when explicit content would involve minors or real-world sexualization. Treat OOC stop signals and direct boundary statements as authoritative. Otherwise stay in-world and continue the scene without moralizing, consent-check stalling, or replacing the requested beat with decorative darkness.";

pub fn seed_bundled_defaults(storage: &FileStorage, default_data: &Path) -> AppResult<()> {
    let db_root = default_data.join("db");
    remove_legacy_deki_character_records(storage)?;
    remove_obsolete_connection_metadata(storage)?;
    seed_prompt_presets(storage, &db_root)?;
    seed_default_chat_presets(storage)?;
    seed_default_regex_scripts(storage)?;
    seed_default_ui_settings(storage)?;
    Ok(())
}

fn remove_obsolete_connection_metadata(storage: &FileStorage) -> AppResult<()> {
    for connection in storage.list("connections")? {
        let Some(id) = connection.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(mut metadata) = connection
            .get("providerMetadata")
            .and_then(Value::as_object)
            .cloned()
        else {
            continue;
        };
        if metadata.remove("roleplayProsePilot").is_some() {
            storage.patch(
                "connections",
                id,
                json!({ "providerMetadata": Value::Object(metadata) }),
            )?;
        }
    }
    Ok(())
}

fn seed_prompt_presets(storage: &FileStorage, db_root: &Path) -> AppResult<()> {
    let v2_path = db_root.join("default-preset-v2.json");
    let raw_v2_preset = if v2_path.exists() {
        std::fs::read_to_string(v2_path)?
    } else {
        BUNDLED_UNIVERSAL_V2_PRESET_JSON.to_string()
    };
    let v2_envelope: Value = serde_json::from_str(&raw_v2_preset)?;
    let v2_data = v2_envelope.get("data").cloned().unwrap_or(Value::Null);
    seed_prompt_preset_bundle(
        storage,
        &v2_data,
        UNIVERSAL_V2_PRESET_ID,
        &[(UNIVERSAL_V2_PRESET_NAME, MARINARA_PRESET_AUTHOR)],
    )?;
    set_bundled_prompt_default(storage)?;
    Ok(())
}
fn seed_prompt_preset_bundle(
    storage: &FileStorage,
    data: &Value,
    preset_id: &str,
    known_names: &[(&str, &str)],
) -> AppResult<()> {
    let Some(preset) = data.get("preset").and_then(Value::as_object) else {
        return Ok(());
    };
    let has_bundled = storage.get("prompts", preset_id)?.is_some()
        || storage.list("prompts")?.into_iter().any(|row| {
            let name = row.get("name").and_then(Value::as_str);
            let author = row.get("author").and_then(Value::as_str);
            known_names.iter().any(|(known_name, known_author)| {
                name == Some(*known_name) && author == Some(*known_author)
            })
        });
    if !has_bundled {
        storage.create("prompts", Value::Object(preset.clone()))?;
    }

    seed_related_prompt_rows_if_missing(storage, "prompt-groups", data.get("groups"))?;
    seed_related_prompt_rows_if_missing(storage, "prompt-sections", data.get("sections"))?;
    seed_related_prompt_rows_if_missing(storage, "prompt-variables", data.get("choiceBlocks"))?;
    refresh_universal_v2_boundary_rows(storage, data)?;
    Ok(())
}

fn refresh_universal_v2_boundary_rows(storage: &FileStorage, data: &Value) -> AppResult<()> {
    refresh_universal_v2_prompt_metadata(storage, data)?;

    let desired_agency = data
        .get("sections")
        .and_then(Value::as_array)
        .and_then(|sections| {
            sections.iter().find(|section| {
                section.get("id").and_then(Value::as_str) == Some("section_v2_agency_boundaries")
            })
        })
        .and_then(|section| section.get("content"))
        .cloned();
    if let Some(desired_agency) = desired_agency {
        refresh_universal_v2_agency_section(storage, desired_agency)?;
    }

    let desired_boundary_options = data
        .get("choiceBlocks")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks.iter().find(|block| {
                block.get("id").and_then(Value::as_str) == Some("choice_v2_content_boundary")
            })
        })
        .and_then(|block| block.get("options"))
        .and_then(Value::as_array)
        .map(|options| {
            options
                .iter()
                .filter(|option| {
                    matches!(
                        option.get("id").and_then(Value::as_str),
                        Some("boundary_mature_dark") | Some("boundary_sfw")
                    )
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !desired_boundary_options.is_empty() {
        refresh_universal_v2_boundary_choices(storage, &desired_boundary_options)?;
    }
    refresh_universal_v2_choice_metadata(storage, data)?;

    Ok(())
}

fn refresh_universal_v2_prompt_metadata(storage: &FileStorage, data: &Value) -> AppResult<()> {
    let Some(prompt) = storage.get("prompts", UNIVERSAL_V2_PRESET_ID)? else {
        return Ok(());
    };

    let desired_preset = data.get("preset").and_then(Value::as_object);
    let desired_default_choices = desired_preset
        .and_then(|preset| preset.get("defaultChoices"))
        .and_then(Value::as_object);
    let mut patch = Map::new();
    let mut default_choices = prompt
        .get("defaultChoices")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut default_choices_changed = false;

    let managed_boundary_id = default_choices
        .get("contentBoundary")
        .and_then(Value::as_str)
        .and_then(managed_universal_v2_boundary_id);
    if let Some(desired_boundary) =
        managed_boundary_id.and_then(|id| desired_universal_v2_boundary_value(data, id))
    {
        if default_choices.get("contentBoundary") != Some(&desired_boundary) {
            default_choices.insert("contentBoundary".to_string(), desired_boundary);
            default_choices_changed = true;
        }
    }

    if let Some(desired_erotic_tone) = desired_default_choices
        .and_then(|choices| choices.get("eroticTone"))
        .cloned()
    {
        if !default_choices.contains_key("eroticTone") {
            default_choices.insert("eroticTone".to_string(), desired_erotic_tone);
            default_choices_changed = true;
        }
    }

    if default_choices_changed {
        patch.insert("defaultChoices".to_string(), Value::Object(default_choices));
    }

    refresh_prompt_order_field(
        &prompt,
        desired_preset,
        &mut patch,
        "sectionOrder",
        "section_v2_erotic_tone",
        "section_v2_agency_boundaries",
    );
    refresh_prompt_order_field(
        &prompt,
        desired_preset,
        &mut patch,
        "variableOrder",
        "choice_v2_erotic_tone",
        "choice_v2_content_boundary",
    );

    if !patch.is_empty() {
        storage.patch("prompts", UNIVERSAL_V2_PRESET_ID, Value::Object(patch))?;
    }
    Ok(())
}

fn refresh_prompt_order_field(
    prompt: &Value,
    desired_preset: Option<&Map<String, Value>>,
    patch: &mut Map<String, Value>,
    field: &str,
    id: &str,
    after_id: &str,
) {
    let current_order = prompt.get(field).and_then(Value::as_array).cloned();
    if current_order
        .as_ref()
        .map(|order| value_array_contains_str(order, id))
        .unwrap_or(false)
    {
        return;
    }

    let desired_order = desired_preset
        .and_then(|preset| preset.get(field))
        .and_then(Value::as_array)
        .cloned();
    let Some(order) = current_order.or(desired_order) else {
        return;
    };
    patch.insert(
        field.to_string(),
        Value::Array(insert_string_after_if_missing(order, id, after_id)),
    );
}

fn insert_string_after_if_missing(mut order: Vec<Value>, id: &str, after_id: &str) -> Vec<Value> {
    if value_array_contains_str(&order, id) {
        return order;
    }
    let insert_at = order
        .iter()
        .position(|value| value.as_str() == Some(after_id))
        .map(|index| index + 1)
        .unwrap_or(order.len());
    order.insert(insert_at, Value::String(id.to_string()));
    order
}

fn value_array_contains_str(values: &[Value], expected: &str) -> bool {
    values.iter().any(|value| value.as_str() == Some(expected))
}

fn desired_universal_v2_boundary_value(data: &Value, id: &str) -> Option<Value> {
    data.get("choiceBlocks")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks.iter().find(|block| {
                block.get("id").and_then(Value::as_str) == Some("choice_v2_content_boundary")
            })
        })
        .and_then(|block| block.get("options"))
        .and_then(Value::as_array)
        .and_then(|options| {
            options
                .iter()
                .find(|option| option.get("id").and_then(Value::as_str) == Some(id))
        })
        .and_then(|option| option.get("value"))
        .cloned()
}

fn refresh_universal_v2_agency_section(
    storage: &FileStorage,
    desired_content: Value,
) -> AppResult<()> {
    let Some(section) = storage.get("prompt-sections", "section_v2_agency_boundaries")? else {
        return Ok(());
    };
    let Some(current) = section.get("content").and_then(Value::as_str) else {
        return Ok(());
    };
    if current == HISTORICAL_UNIVERSAL_V2_AGENCY_SECTION || looks_like_legacy_v2_boundary(current) {
        storage.patch(
            "prompt-sections",
            "section_v2_agency_boundaries",
            json!({ "content": desired_content }),
        )?;
    }
    Ok(())
}

fn refresh_universal_v2_boundary_choices(
    storage: &FileStorage,
    desired_boundary_options: &[Value],
) -> AppResult<()> {
    let Some(choice) = storage.get("prompt-variables", "choice_v2_content_boundary")? else {
        return Ok(());
    };
    let Some(current_options) = choice.get("options").and_then(Value::as_array) else {
        return Ok(());
    };

    let mut changed = false;
    let options = current_options
        .iter()
        .map(|option| {
            let Some(id) = option.get("id").and_then(Value::as_str) else {
                return option.clone();
            };
            let is_managed_value = option
                .get("value")
                .and_then(Value::as_str)
                .and_then(managed_universal_v2_boundary_id)
                == Some(id);
            let desired_option = desired_boundary_options
                .iter()
                .find(|desired| desired.get("id").and_then(Value::as_str) == Some(id));
            if is_managed_value {
                if let Some(desired_option) = desired_option {
                    if desired_option != option {
                        changed = true;
                        return desired_option.clone();
                    }
                }
            }
            option.clone()
        })
        .collect::<Vec<_>>();

    if changed {
        storage.patch(
            "prompt-variables",
            "choice_v2_content_boundary",
            json!({ "options": options }),
        )?;
    }
    Ok(())
}

fn refresh_universal_v2_choice_metadata(storage: &FileStorage, data: &Value) -> AppResult<()> {
    let Some(desired_blocks) = data.get("choiceBlocks").and_then(Value::as_array) else {
        return Ok(());
    };

    for desired_block in desired_blocks {
        let Some(id) = desired_block.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(current_block) = storage.get("prompt-variables", id)? else {
            continue;
        };

        let mut patch = Map::new();
        if current_block.get("visibilityRule") != desired_block.get("visibilityRule") {
            if let Some(rule) = desired_block.get("visibilityRule").cloned() {
                patch.insert("visibilityRule".to_string(), rule);
            }
        }

        if let Some(options) = refreshed_choice_option_descriptions(&current_block, desired_block) {
            patch.insert("options".to_string(), Value::Array(options));
        }

        if !patch.is_empty() {
            storage.patch("prompt-variables", id, Value::Object(patch))?;
        }
    }

    Ok(())
}

fn refreshed_choice_option_descriptions(
    current_block: &Value,
    desired_block: &Value,
) -> Option<Vec<Value>> {
    let current_options = current_block.get("options").and_then(Value::as_array)?;
    let desired_options = desired_block.get("options").and_then(Value::as_array)?;
    let mut changed = false;
    let options = current_options
        .iter()
        .map(|current_option| {
            let Some(option_id) = current_option.get("id").and_then(Value::as_str) else {
                return current_option.clone();
            };
            let Some(desired_option) = desired_options
                .iter()
                .find(|option| option.get("id").and_then(Value::as_str) == Some(option_id))
            else {
                return current_option.clone();
            };
            let Some(desired_description) = desired_option.get("description").cloned() else {
                return current_option.clone();
            };
            if current_option.get("description") == Some(&desired_description) {
                return current_option.clone();
            }
            let mut object = current_option.as_object().cloned().unwrap_or_default();
            object.insert("description".to_string(), desired_description);
            changed = true;
            Value::Object(object)
        })
        .collect::<Vec<_>>();

    changed.then_some(options)
}

fn looks_like_legacy_v2_boundary(value: &str) -> bool {
    value.contains("Sexual content must involve adult characters with clear, ongoing consent")
        || value.contains("Keep consent, age, capacity, and boundaries legible")
        || value.contains("Do not eroticize coercion, minors, impaired consent, or unclear consent")
}

fn managed_universal_v2_boundary_id(value: &str) -> Option<&'static str> {
    if value == "Keep the scene SFW." || value == HISTORICAL_UNIVERSAL_V2_SFW_BOUNDARY {
        Some("boundary_sfw")
    } else if value == HISTORICAL_UNIVERSAL_V2_ADULT_BOUNDARY
        || value == HISTORICAL_UNIVERSAL_V2_SHORT_ADULT_BOUNDARY
        || looks_like_legacy_v2_boundary(value)
    {
        Some("boundary_mature_dark")
    } else {
        None
    }
}

fn set_bundled_prompt_default(storage: &FileStorage) -> AppResult<()> {
    for row in storage.list("prompts")? {
        let Some(id) = row.get("id").and_then(Value::as_str) else {
            continue;
        };
        if should_clear_bundled_prompt_default(&row) {
            storage.patch("prompts", id, json!({ "isDefault": false }))?;
        }
    }
    if storage.get("prompts", UNIVERSAL_V2_PRESET_ID)?.is_some() {
        storage.patch(
            "prompts",
            UNIVERSAL_V2_PRESET_ID,
            json!({ "isDefault": true }),
        )?;
    }
    Ok(())
}

fn should_clear_bundled_prompt_default(row: &Value) -> bool {
    if row.get("id").and_then(Value::as_str) == Some(UNIVERSAL_V2_PRESET_ID) {
        return false;
    }
    if row.get("id").and_then(Value::as_str) == Some(MARINARA_PRESET_ID) {
        return true;
    }

    let name = row.get("name").and_then(Value::as_str);
    let author = row.get("author").and_then(Value::as_str);
    matches!(
        (name, author),
        (Some(MARINARA_PRESET_NAME), Some(MARINARA_PRESET_AUTHOR))
            | (
                Some(MARINARA_PRESET_NAME),
                Some(LEGACY_MARINARA_PRESET_AUTHOR)
            )
            | (
                Some(LEGACY_MARINARA_UNIVERSAL_PRESET_NAME),
                Some(LEGACY_MARINARA_PRESET_AUTHOR)
            )
            | (
                Some(LEGACY_MARINARA_PRESET_NAME),
                Some(LEGACY_MARINARA_PRESET_AUTHOR)
            )
    )
}

fn remove_legacy_deki_character_records(storage: &FileStorage) -> AppResult<()> {
    delete_legacy_record_if_small(storage, "characters", LEGACY_DEKI_CHARACTER_ID)?;
    delete_legacy_record_if_small(storage, "characters", "professor-mari")?;
    delete_legacy_record_if_small(storage, "chats", "__professor_mari_chat__")?;
    delete_legacy_record_if_small(storage, "messages", "professor-mari-welcome")?;
    delete_legacy_record_if_small(storage, "app-settings", "professor-mari-assistant-prompt")?;
    Ok(())
}

fn delete_legacy_record_if_small(
    storage: &FileStorage,
    collection: &str,
    id: &str,
) -> AppResult<()> {
    if !collection_is_small_enough_for_startup_cleanup(storage, collection)? {
        return Ok(());
    }
    if storage.get(collection, id)?.is_some() {
        storage.delete(collection, id)?;
    }
    Ok(())
}

fn collection_is_small_enough_for_startup_cleanup(
    storage: &FileStorage,
    collection: &str,
) -> AppResult<bool> {
    let path = storage
        .root()
        .join("collections")
        .join(format!("{collection}.json"));
    if !path.exists() {
        return Ok(true);
    }
    Ok(std::fs::metadata(path)?.len() <= LEGACY_CLEANUP_MAX_COLLECTION_BYTES)
}

fn seed_related_prompt_rows_if_missing(
    storage: &FileStorage,
    collection: &str,
    rows: Option<&Value>,
) -> AppResult<()> {
    let Some(rows) = rows.and_then(Value::as_array) else {
        return Ok(());
    };
    for row in rows {
        if let Some(id) = row.get("id").and_then(Value::as_str) {
            if storage.get(collection, id)?.is_some() {
                continue;
            }
        }
        storage.create(collection, row.clone())?;
    }
    Ok(())
}

fn seed_default_chat_presets(storage: &FileStorage) -> AppResult<()> {
    for mode in ["conversation", "roleplay", "game"] {
        let id = format!("default-chat-preset-{mode}");
        if storage.get("chat-presets", &id)?.is_none() {
            let has_mode_rows = storage
                .list("chat-presets")?
                .into_iter()
                .any(|row| row.get("mode").and_then(Value::as_str) == Some(mode));
            storage.create(
                "chat-presets",
                json!({
                    "id": id,
                    "name": "Default",
                    "mode": mode,
                    "settings": {},
                    "isDefault": true,
                    "default": true,
                    "isActive": !has_mode_rows,
                    "active": !has_mode_rows
                }),
            )?;
        }

        let rows = storage.list("chat-presets")?;
        let has_active = rows.iter().any(|row| {
            row.get("mode").and_then(Value::as_str) == Some(mode)
                && (is_truthy(row.get("isActive")) || is_truthy(row.get("active")))
        });
        if !has_active {
            storage.patch(
                "chat-presets",
                &id,
                json!({
                    "isActive": true,
                    "active": true
                }),
            )?;
        }
    }
    Ok(())
}

fn seed_default_regex_scripts(storage: &FileStorage) -> AppResult<()> {
    let scripts = [
        json!({
            "id": "default-clean-html",
            "name": "Clean HTML (Outgoing Prompt)",
            "enabled": true,
            "findRegex": r#"[ \t]?<(?!--)(?!\/?(?:font|lie|filter)\b)(?:"[^"]*"|'[^']*'|[^'">])*>"#,
            "replaceString": "",
            "trimStrings": [],
            "placement": ["user_input", "ai_output"],
            "flags": "g",
            "promptOnly": true,
            "order": 0,
            "sortOrder": 0,
            "minDepth": Value::Null,
            "maxDepth": Value::Null
        }),
        json!({
            "id": "default-collapse-newlines",
            "name": "Collapse Excess Newlines",
            "enabled": true,
            "findRegex": r#"\n{3,}"#,
            "replaceString": "\n\n",
            "trimStrings": [],
            "placement": ["user_input", "ai_output"],
            "flags": "g",
            "promptOnly": false,
            "order": 10,
            "sortOrder": 10,
            "minDepth": Value::Null,
            "maxDepth": Value::Null
        }),
    ];

    for script in scripts {
        let Some(id) = script
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
        else {
            continue;
        };
        if storage.get("regex-scripts", &id)?.is_none() {
            storage.create("regex-scripts", script)?;
        }
    }
    Ok(())
}

fn seed_default_ui_settings(storage: &FileStorage) -> AppResult<()> {
    let defaults = [
        ("imageBackgroundWidth", json!(1280)),
        ("imageBackgroundHeight", json!(720)),
        ("imagePortraitWidth", json!(1024)),
        ("imagePortraitHeight", json!(1024)),
        ("imageSelfieWidth", json!(896)),
        ("imageSelfieHeight", json!(1152)),
    ];

    let mut ui = storage
        .get("app-settings", "ui")?
        .and_then(|record| record.get("value").cloned())
        .and_then(parse_settings_object)
        .unwrap_or_default();

    let mut changed = false;
    for (key, value) in defaults {
        if !ui.contains_key(key) {
            ui.insert(key.to_string(), value);
            changed = true;
        }
    }
    if changed || storage.get("app-settings", "ui")?.is_none() {
        ui.insert("updatedAt".to_string(), json!(now_iso()));
        storage.upsert_with_id("app-settings", "ui", json!({ "value": Value::Object(ui) }))?;
    }
    Ok(())
}

fn parse_settings_object(value: Value) -> Option<Map<String, Value>> {
    match value {
        Value::Object(object) => Some(object),
        Value::String(raw) => serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(parse_settings_object),
        _ => None,
    }
}

fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(value)) => *value,
        Some(Value::String(value)) => value == "true",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempRoot(PathBuf);

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn temp_storage() -> (FileStorage, TempRoot) {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("marinara-seed-test-{suffix}"));
        let storage = FileStorage::new(root.join("data")).expect("storage should initialize");
        (storage, TempRoot(root))
    }

    #[test]
    fn removes_legacy_deki_character_seed() {
        let (storage, root) = temp_storage();
        storage
            .create(
                "characters",
                json!({
                    "id": LEGACY_DEKI_CHARACTER_ID,
                    "data": {
                        "name": "Deki-senpai",
                        "extensions": {
                            "isBuiltInAssistant": true
                        }
                    },
                    "comment": "Built-in guide",
                    "avatarPath": Value::Null
                }),
            )
            .expect("canonical row should be inserted");

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        assert!(storage
            .get("characters", LEGACY_DEKI_CHARACTER_ID)
            .expect("canonical lookup should succeed")
            .is_none());
    }

    #[test]
    fn removes_legacy_deki_records() {
        let (storage, root) = temp_storage();

        storage
            .create(
                "characters",
                json!({
                    "id": "professor-mari",
                    "data": "{}",
                    "comment": "",
                    "avatarPath": Value::Null
                }),
            )
            .expect("legacy row should be inserted");

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        assert!(storage
            .get("characters", "professor-mari")
            .expect("legacy lookup should succeed")
            .is_none());
    }

    #[test]
    fn does_not_seed_legacy_marinara_preset_from_embedded_defaults() {
        let (storage, root) = temp_storage();

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        assert!(storage
            .get("prompts", MARINARA_PRESET_ID)
            .expect("preset lookup should succeed")
            .is_none());
        assert!(!storage
            .list("prompt-sections")
            .expect("prompt sections should list")
            .iter()
            .any(|section| section.get("presetId").and_then(Value::as_str)
                == Some(MARINARA_PRESET_ID)));
    }

    #[test]
    fn seeds_v2_preset_as_default() {
        let (storage, root) = temp_storage();

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        let prompts = storage.list("prompts").expect("prompts should list");
        let v2 = prompts
            .iter()
            .find(|preset| {
                preset.get("name").and_then(Value::as_str) == Some("De-Koi Universal Preset V2")
                    && preset.get("author").and_then(Value::as_str) == Some("De-Koi")
            })
            .expect("De-Koi Universal Preset V2 should be seeded");

        assert!(is_truthy(v2.get("isDefault")));
        assert_eq!(
            v2.get("parameters")
                .and_then(|value| value.get("maxTokens"))
                .and_then(Value::as_i64),
            Some(4096)
        );
        assert_eq!(
            v2.get("parameters")
                .and_then(|value| value.get("reasoningEffort"))
                .and_then(Value::as_str),
            Some("low")
        );
        assert!(v2
            .get("defaultChoices")
            .and_then(|value| value.get("contentBoundary"))
            .and_then(Value::as_str)
            .expect("content boundary default should be present")
            .starts_with("Keep sexual content non-explicit or fade to black."));
        assert_eq!(
            prompts
                .iter()
                .filter(|preset| is_truthy(preset.get("isDefault")))
                .count(),
            1,
            "exactly one prompt preset should be the bundled default"
        );

        assert!(storage
            .list("prompt-sections")
            .expect("prompt sections should list")
            .iter()
            .any(|section| section.get("presetId").and_then(Value::as_str)
                == Some("preset_universal_v2")));
    }

    #[test]
    fn refreshes_existing_universal_v2_boundary_rows() {
        let (storage, root) = temp_storage();
        let old_boundary = "Adult dark fiction is allowed.";
        let old_agency = HISTORICAL_UNIVERSAL_V2_AGENCY_SECTION;

        storage
            .create(
                "prompts",
                json!({
                    "id": UNIVERSAL_V2_PRESET_ID,
                    "name": UNIVERSAL_V2_PRESET_NAME,
                    "author": MARINARA_PRESET_AUTHOR,
                    "isDefault": false,
                    "sectionOrder": [
                        "section_v2_role",
                        "section_v2_agency_boundaries",
                        "section_v2_style"
                    ],
                    "variableOrder": [
                        "choice_v2_mode",
                        "choice_v2_content_boundary",
                        "choice_v2_agency"
                    ],
                    "defaultChoices": {
                        "contentBoundary": old_boundary,
                        "language": "English"
                    }
                }),
            )
            .expect("existing V2 prompt should insert");
        storage
            .create(
                "prompt-sections",
                json!({
                    "id": "section_v2_agency_boundaries",
                    "presetId": UNIVERSAL_V2_PRESET_ID,
                    "content": old_agency
                }),
            )
            .expect("existing agency section should insert");
        storage
            .create(
                "prompt-variables",
                json!({
                    "id": "choice_v2_content_boundary",
                    "presetId": UNIVERSAL_V2_PRESET_ID,
                    "options": [
                        {
                            "id": "boundary_mature_dark",
                            "label": "Mature Dark",
                            "value": old_boundary
                        },
                        {
                            "id": "boundary_sfw",
                            "label": "SFW",
                            "value": HISTORICAL_UNIVERSAL_V2_SFW_BOUNDARY
                        }
                    ]
                }),
            )
            .expect("existing boundary variable should insert");

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        let prompt = storage
            .get("prompts", UNIVERSAL_V2_PRESET_ID)
            .expect("prompt should read")
            .expect("V2 prompt should remain available");
        let default_choices = prompt
            .get("defaultChoices")
            .and_then(Value::as_object)
            .expect("default choices should stay an object");
        assert_eq!(
            default_choices.get("language").and_then(Value::as_str),
            Some("English")
        );
        assert_eq!(
            default_choices
                .get("contentBoundary")
                .and_then(Value::as_str),
            Some("Adult explicit content is permitted. Keep explicit sexual content limited to fictional adults; exclude minors and real-world sexualization.")
        );
        assert!(default_choices
            .get("eroticTone")
            .and_then(Value::as_str)
            .expect("erotic tone default should be present")
            .contains("no erotic tone preference"));

        let section_order = prompt
            .get("sectionOrder")
            .and_then(Value::as_array)
            .expect("section order should stay an array");
        let agency_index = section_order
            .iter()
            .position(|value| value.as_str() == Some("section_v2_agency_boundaries"))
            .expect("agency section should stay in order");
        assert_eq!(
            section_order.get(agency_index + 1).and_then(Value::as_str),
            Some("section_v2_erotic_tone")
        );

        let variable_order = prompt
            .get("variableOrder")
            .and_then(Value::as_array)
            .expect("variable order should stay an array");
        let boundary_index = variable_order
            .iter()
            .position(|value| value.as_str() == Some("choice_v2_content_boundary"))
            .expect("content boundary choice should stay in order");
        assert_eq!(
            variable_order
                .get(boundary_index + 1)
                .and_then(Value::as_str),
            Some("choice_v2_erotic_tone")
        );

        let erotic_section = storage
            .get("prompt-sections", "section_v2_erotic_tone")
            .expect("erotic tone section should read")
            .expect("erotic tone section should be seeded");
        assert!(erotic_section
            .get("content")
            .and_then(Value::as_str)
            .expect("erotic tone content should be present")
            .contains("controls how explicit, blunt, or dirty sexual language becomes"));

        let erotic_choice = storage
            .get("prompt-variables", "choice_v2_erotic_tone")
            .expect("erotic tone variable should read")
            .expect("erotic tone variable should be seeded");
        let erotic_options = erotic_choice
            .get("options")
            .and_then(Value::as_array)
            .expect("erotic tone options should stay an array");
        assert_eq!(erotic_options.len(), 5);
        assert!(erotic_options.iter().any(|option| {
            option.get("id").and_then(Value::as_str) == Some("erotic_tone_filthy")
                && option.get("label").and_then(Value::as_str) == Some("Filthy")
        }));

        let agency = storage
            .get("prompt-sections", "section_v2_agency_boundaries")
            .expect("agency section should read")
            .expect("agency section should remain available");
        assert!(agency
            .get("content")
            .and_then(Value::as_str)
            .expect("agency content should be present")
            .contains("default preference for comfort or approval"));

        let boundary_choice = storage
            .get("prompt-variables", "choice_v2_content_boundary")
            .expect("boundary variable should read")
            .expect("boundary variable should remain available");
        let options = boundary_choice
            .get("options")
            .and_then(Value::as_array)
            .expect("options should stay an array");
        let explicit_adult = options
            .iter()
            .find(|option| option.get("id").and_then(Value::as_str) == Some("boundary_mature_dark"))
            .expect("adult dark option should remain available");
        assert_eq!(
            explicit_adult.get("label").and_then(Value::as_str),
            Some("Explicit / Adult Fiction")
        );
        assert_eq!(
            explicit_adult.get("value").and_then(Value::as_str),
            Some("Adult explicit content is permitted. Keep explicit sexual content limited to fictional adults; exclude minors and real-world sexualization.")
        );
        let sfw = options
            .iter()
            .find(|option| option.get("id").and_then(Value::as_str) == Some("boundary_sfw"))
            .expect("non-explicit option should remain available");
        assert_eq!(
            sfw.get("label").and_then(Value::as_str),
            Some("Non-Explicit")
        );
        assert_eq!(
            sfw.get("value").and_then(Value::as_str),
            Some("Keep sexual content non-explicit or fade to black. This setting does not limit genre, danger, violence, emotional intensity, character morality, or consequences.")
        );
        assert_eq!(
            sfw.get("description").and_then(Value::as_str),
            Some("Sexual content stays non-explicit; all other story intensity follows the scene.")
        );
        assert_eq!(
            explicit_adult.get("description").and_then(Value::as_str),
            Some("Allows adult explicit content; genre and character dynamics follow the scene.")
        );
    }

    #[test]
    fn upgrades_existing_managed_default_and_preserves_custom_defaults_without_a_version_marker() {
        let (storage, root) = temp_storage();
        let historical_adult_boundary = "Adult dark fiction is allowed for mature audiences when the user has opted into it. Treat the user's author-level consent and stated boundaries as the safety layer; do not require fictional relationships or character behavior to be healthy, gentle, morally approved, or consensual inside the story. Adult characters may be cruel, selfish, coercive, violent, deceptive, obsessive, toxic, or exploitative when the scenario calls for it. Keep minors and real-world sexualization out of explicit content, respect any user-stated stop or boundary, and otherwise continue the fictional scene without moralizing, safety lectures, or consent-check stalling.";

        for (id, boundary) in [
            (UNIVERSAL_V2_PRESET_ID, historical_adult_boundary),
            ("custom-preset", "Keep this custom boundary exactly."),
        ] {
            storage
                .create(
                    "prompts",
                    json!({
                        "id": id,
                        "name": if id == UNIVERSAL_V2_PRESET_ID { UNIVERSAL_V2_PRESET_NAME } else { "Custom" },
                        "author": if id == UNIVERSAL_V2_PRESET_ID { MARINARA_PRESET_AUTHOR } else { "User" },
                        "parameters": { "maxTokens": 8192, "reasoningEffort": "maximum" },
                        "defaultChoices": { "contentBoundary": boundary }
                    }),
                )
                .expect("prompt should insert");
        }
        storage
            .create(
                "prompt-sections",
                json!({
                    "id": "section_v2_agency_boundaries",
                    "presetId": UNIVERSAL_V2_PRESET_ID,
                    "content": "Keep this custom agency contract exactly."
                }),
            )
            .expect("custom agency section should insert");
        storage
            .create(
                "prompt-variables",
                json!({
                    "id": "choice_v2_content_boundary",
                    "presetId": UNIVERSAL_V2_PRESET_ID,
                    "options": [
                        {
                            "id": "boundary_mature_dark",
                            "label": "Mature Dark",
                            "value": "Keep this custom adult option exactly."
                        },
                        {
                            "id": "boundary_sfw",
                            "label": "Custom Non-Explicit",
                            "value": "Keep this custom non-explicit option exactly."
                        }
                    ]
                }),
            )
            .expect("custom boundary choices should insert");

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        let managed = storage
            .get("prompts", UNIVERSAL_V2_PRESET_ID)
            .expect("managed prompt should read")
            .expect("managed prompt should exist");
        assert_eq!(
            managed["defaultChoices"]["contentBoundary"].as_str(),
            Some("Adult explicit content is permitted. Keep explicit sexual content limited to fictional adults; exclude minors and real-world sexualization.")
        );
        assert_eq!(managed["parameters"]["maxTokens"].as_i64(), Some(8192));
        assert_eq!(
            managed["parameters"]["reasoningEffort"].as_str(),
            Some("maximum")
        );
        let custom = storage
            .get("prompts", "custom-preset")
            .expect("custom prompt should read")
            .expect("custom prompt should exist");
        assert_eq!(
            custom["defaultChoices"]["contentBoundary"].as_str(),
            Some("Keep this custom boundary exactly.")
        );
        assert_eq!(custom["parameters"]["maxTokens"].as_i64(), Some(8192));
        assert_eq!(
            custom["parameters"]["reasoningEffort"].as_str(),
            Some("maximum")
        );
        let custom_agency = storage
            .get("prompt-sections", "section_v2_agency_boundaries")
            .expect("custom agency should read")
            .expect("custom agency should exist");
        assert_eq!(
            custom_agency["content"].as_str(),
            Some("Keep this custom agency contract exactly.")
        );
        let custom_choices = storage
            .get("prompt-variables", "choice_v2_content_boundary")
            .expect("custom choices should read")
            .expect("custom choices should exist");
        let custom_options = custom_choices["options"]
            .as_array()
            .expect("custom options should stay an array");
        assert!(custom_options.iter().any(|option| {
            option["id"] == "boundary_mature_dark"
                && option["value"] == "Keep this custom adult option exactly."
        }));
        assert!(custom_options.iter().any(|option| {
            option["id"] == "boundary_sfw"
                && option["value"] == "Keep this custom non-explicit option exactly."
        }));

        storage
            .patch(
                "prompts",
                UNIVERSAL_V2_PRESET_ID,
                json!({
                    "defaultChoices": {
                        "contentBoundary": HISTORICAL_UNIVERSAL_V2_SFW_BOUNDARY
                    },
                    "parameters": {
                        "maxTokens": 4096
                    }
                }),
            )
            .expect("current non-explicit selection should patch");
        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed with a current non-explicit selection");

        let managed = storage
            .get("prompts", UNIVERSAL_V2_PRESET_ID)
            .expect("managed prompt should read")
            .expect("managed prompt should exist");
        assert_eq!(
            managed["defaultChoices"]["contentBoundary"].as_str(),
            Some("Keep sexual content non-explicit or fade to black. This setting does not limit genre, danger, violence, emotional intensity, character morality, or consequences.")
        );
        assert_eq!(managed["parameters"]["maxTokens"].as_i64(), Some(4096));
        assert_eq!(managed["parameters"]["reasoningEffort"].as_str(), None);

        storage
            .patch(
                "prompts",
                UNIVERSAL_V2_PRESET_ID,
                json!({
                    "defaultChoices": {
                        "contentBoundary": "Keep this managed preset customization exactly."
                    },
                    "parameters": {
                        "maxTokens": 6144,
                        "reasoningEffort": "high"
                    }
                }),
            )
            .expect("managed preset customization should patch");
        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed again");

        let managed = storage
            .get("prompts", UNIVERSAL_V2_PRESET_ID)
            .expect("managed prompt should read")
            .expect("managed prompt should exist");
        assert_eq!(
            managed["defaultChoices"]["contentBoundary"].as_str(),
            Some("Keep this managed preset customization exactly.")
        );
        assert_eq!(managed["parameters"]["maxTokens"].as_i64(), Some(6144));
        assert_eq!(
            managed["parameters"]["reasoningEffort"].as_str(),
            Some("high")
        );
    }

    #[test]
    fn removes_obsolete_roleplay_prose_pilot_metadata_without_touching_siblings() {
        let (storage, root) = temp_storage();
        storage
            .create(
                "connections",
                json!({
                    "id": "nano",
                    "name": "Nano",
                    "provider": "nanogpt",
                    "model": "zai-org/glm-5.2",
                    "providerMetadata": {
                        "roleplayProsePilot": { "enabled": true },
                        "retained": "keep-me"
                    }
                }),
            )
            .expect("connection should insert");

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        let connection = storage
            .get("connections", "nano")
            .expect("connection should read")
            .expect("connection should remain available");
        let metadata = connection["providerMetadata"]
            .as_object()
            .expect("provider metadata should remain an object");
        assert_eq!(
            metadata.get("retained").and_then(Value::as_str),
            Some("keep-me")
        );
        assert!(!metadata.contains_key("roleplayProsePilot"));
    }

    #[test]
    fn deactivates_legacy_marinara_universal_preset_when_v2_is_default() {
        let (storage, root) = temp_storage();

        storage
            .create(
                "prompts",
                json!({
                    "id": "legacy-marinara-universal",
                    "name": LEGACY_MARINARA_UNIVERSAL_PRESET_NAME,
                    "author": LEGACY_MARINARA_PRESET_AUTHOR,
                    "isDefault": true
                }),
            )
            .expect("legacy universal preset should insert");

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        let legacy = storage
            .get("prompts", "legacy-marinara-universal")
            .expect("legacy preset should read")
            .expect("legacy preset should remain available");
        assert!(!is_truthy(legacy.get("isDefault")));

        let prompts = storage.list("prompts").expect("prompts should list");
        assert_eq!(
            prompts
                .iter()
                .filter(|preset| is_truthy(preset.get("isDefault")))
                .count(),
            1,
            "V2 should be the only bundled default"
        );
        let v2 = prompts
            .iter()
            .find(|preset| preset.get("id").and_then(Value::as_str) == Some(UNIVERSAL_V2_PRESET_ID))
            .expect("V2 preset should be seeded");
        assert!(is_truthy(v2.get("isDefault")));
    }
}
