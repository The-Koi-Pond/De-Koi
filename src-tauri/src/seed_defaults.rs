use marinara_core::{now_iso, AppResult};
use marinara_storage::FileStorage;
use serde_json::{json, Map, Value};
use std::path::Path;

const MARINARA_PRESET_ID: &str = "7huDl_SOx3a5EZtMeKqSR";
const MARINARA_PRESET_NAME: &str = "De-Koi's Universal Preset";
const LEGACY_MARINARA_UNIVERSAL_PRESET_NAME: &str = "Marinara's Universal Preset";
const LEGACY_MARINARA_PRESET_NAME: &str = "Default";
const MARINARA_PRESET_AUTHOR: &str = "De-Koi";
const LEGACY_MARINARA_PRESET_AUTHOR: &str = "Marinara";
const LEGACY_DEKI_CHARACTER_ID: &str = "__professor_mari__";
const LEGACY_CLEANUP_MAX_COLLECTION_BYTES: u64 = 4 * 1024 * 1024;
const OUTPUT_FORMAT_SECTION_ID: &str = "YX9D0XS7-4_Xx0s9MVPZE";
const OUTPUT_FORMAT_SECTION_IDENTIFIER: &str = "section_1772657928072";
const BUNDLED_MARINARA_PRESET_JSON: &str =
    include_str!("../resources/default-data/db/default-preset.json");

pub fn seed_bundled_defaults(storage: &FileStorage, default_data: &Path) -> AppResult<()> {
    let db_root = default_data.join("db");
    remove_legacy_deki_character_records(storage)?;
    seed_marinara_preset(storage, &db_root)?;
    seed_default_chat_presets(storage)?;
    seed_default_regex_scripts(storage)?;
    seed_default_ui_settings(storage)?;
    Ok(())
}

fn seed_marinara_preset(storage: &FileStorage, db_root: &Path) -> AppResult<()> {
    let preset_path = db_root.join("default-preset.json");
    let raw_preset = if preset_path.exists() {
        std::fs::read_to_string(preset_path)?
    } else {
        BUNDLED_MARINARA_PRESET_JSON.to_string()
    };

    let envelope: Value = serde_json::from_str(&raw_preset)?;
    let data = envelope.get("data").cloned().unwrap_or(Value::Null);
    let Some(preset) = data.get("preset").and_then(Value::as_object) else {
        return Ok(());
    };

    rename_legacy_default_preset(storage)?;

    let has_bundled = storage.get("prompts", MARINARA_PRESET_ID)?.is_some()
        || storage.list("prompts")?.into_iter().any(|row| {
            let name = row.get("name").and_then(Value::as_str);
            let author = row.get("author").and_then(Value::as_str);
            (name == Some(MARINARA_PRESET_NAME) && author == Some(MARINARA_PRESET_AUTHOR))
                || (name == Some(LEGACY_MARINARA_UNIVERSAL_PRESET_NAME)
                    && author == Some(LEGACY_MARINARA_PRESET_AUTHOR))
        });
    if !has_bundled {
        storage.create("prompts", Value::Object(preset.clone()))?;
    }

    seed_related_prompt_rows_if_missing(storage, "prompt-groups", data.get("groups"))?;
    seed_related_prompt_rows_if_missing(storage, "prompt-sections", data.get("sections"))?;
    seed_related_prompt_rows_if_missing(storage, "prompt-variables", data.get("choiceBlocks"))?;
    patch_legacy_output_format_prompt_section(storage, &data)?;
    Ok(())
}

fn bundled_output_format_content(data: &Value) -> Option<&str> {
    data.get("sections")
        .and_then(Value::as_array)?
        .iter()
        .find(|row| {
            row.get("id").and_then(Value::as_str) == Some(OUTPUT_FORMAT_SECTION_ID)
                && row.get("identifier").and_then(Value::as_str)
                    == Some(OUTPUT_FORMAT_SECTION_IDENTIFIER)
        })?
        .get("content")
        .and_then(Value::as_str)
}

fn legacy_output_format_content(current: &str) -> String {
    current
        .replace(
            "EXAMPLE: \"Are you even listening?\"",
            "EXAMPLE: \"Are you a gooner?\"",
        )
        .replace("BAD: \"Listening?\"", "BAD: \"Gooner?\"")
}

fn patch_legacy_output_format_prompt_section(storage: &FileStorage, data: &Value) -> AppResult<()> {
    let Some(current_content) = bundled_output_format_content(data) else {
        return Ok(());
    };
    let legacy_content = legacy_output_format_content(current_content);
    let Some(existing) = storage.get("prompt-sections", OUTPUT_FORMAT_SECTION_ID)? else {
        return Ok(());
    };
    let is_bundled_output_format_section = existing.get("presetId").and_then(Value::as_str)
        == Some(MARINARA_PRESET_ID)
        && existing.get("identifier").and_then(Value::as_str)
            == Some(OUTPUT_FORMAT_SECTION_IDENTIFIER);
    if is_bundled_output_format_section
        && existing.get("content").and_then(Value::as_str) == Some(legacy_content.as_str())
    {
        storage.patch(
            "prompt-sections",
            OUTPUT_FORMAT_SECTION_ID,
            json!({ "content": current_content }),
        )?;
    }
    Ok(())
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

fn rename_legacy_default_preset(storage: &FileStorage) -> AppResult<()> {
    let legacy = storage.list("prompts")?.into_iter().find(|row| {
        row.get("name").and_then(Value::as_str) == Some(LEGACY_MARINARA_PRESET_NAME)
            && row.get("author").and_then(Value::as_str) == Some(LEGACY_MARINARA_PRESET_AUTHOR)
    });
    if let Some(legacy) = legacy {
        if let Some(id) = legacy.get("id").and_then(Value::as_str) {
            storage.patch(
                "prompts",
                id,
                json!({
                    "name": MARINARA_PRESET_NAME,
                    "description": "De-Koi's universal roleplay preset. Serves as a good base."
                }),
            )?;
        }
    }
    Ok(())
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
    fn seeds_marinara_preset_from_embedded_fallback_when_default_data_root_is_missing() {
        let (storage, root) = temp_storage();

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        let preset = storage
            .get("prompts", MARINARA_PRESET_ID)
            .expect("preset lookup should succeed")
            .expect("De-Koi preset should be seeded");
        assert_eq!(preset["name"], MARINARA_PRESET_NAME);
        assert_eq!(preset["author"], MARINARA_PRESET_AUTHOR);

        let sections = storage
            .list("prompt-sections")
            .expect("prompt sections should list");
        assert!(sections.iter().any(|section| {
            section.get("presetId").and_then(Value::as_str) == Some(MARINARA_PRESET_ID)
        }));
    }

    #[test]
    fn patches_stock_legacy_output_format_prompt_section() {
        let (storage, root) = temp_storage();
        let envelope: Value = serde_json::from_str(BUNDLED_MARINARA_PRESET_JSON)
            .expect("bundled preset should parse");
        let data = envelope
            .get("data")
            .expect("bundled preset data should exist");
        let current_content =
            bundled_output_format_content(data).expect("output format section should exist");
        let legacy_content = legacy_output_format_content(current_content);

        storage
            .create(
                "prompt-sections",
                json!({
                    "id": OUTPUT_FORMAT_SECTION_ID,
                    "presetId": MARINARA_PRESET_ID,
                    "identifier": OUTPUT_FORMAT_SECTION_IDENTIFIER,
                    "name": "Output Format",
                    "content": legacy_content
                }),
            )
            .expect("legacy prompt section should insert");

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        let patched = storage
            .get("prompt-sections", OUTPUT_FORMAT_SECTION_ID)
            .expect("prompt section lookup should succeed")
            .expect("prompt section should exist");
        assert_eq!(patched["content"], current_content);
    }

    #[test]
    fn preserves_user_edited_output_format_prompt_section() {
        let (storage, root) = temp_storage();
        let custom_content = "User customized output format";

        storage
            .create(
                "prompt-sections",
                json!({
                    "id": OUTPUT_FORMAT_SECTION_ID,
                    "presetId": MARINARA_PRESET_ID,
                    "identifier": OUTPUT_FORMAT_SECTION_IDENTIFIER,
                    "name": "Output Format",
                    "content": custom_content
                }),
            )
            .expect("custom prompt section should insert");

        seed_bundled_defaults(&storage, &root.0.join("missing-default-data"))
            .expect("defaults should seed");

        let preserved = storage
            .get("prompt-sections", OUTPUT_FORMAT_SECTION_ID)
            .expect("prompt section lookup should succeed")
            .expect("prompt section should exist");
        assert_eq!(preserved["content"], custom_content);
    }
}
