use super::super::*;
use super::*;
use serde_json::{json, Value};
use std::path::Path;

fn import_persona_payload(
    state: &AppState,
    payload: Value,
    fallback_name: &str,
) -> AppResult<Value> {
    let mut object = ensure_object(payload).unwrap_or_default();
    object
        .entry("name".to_string())
        .or_insert(Value::String(fallback_name.to_string()));
    if !object.contains_key("description") {
        if let Some(persona) = object
            .get("persona")
            .or_else(|| object.get("content"))
            .and_then(Value::as_str)
        {
            object.insert(
                "description".to_string(),
                Value::String(persona.to_string()),
            );
        }
    }
    let mut created_persona_id = None;
    let result = (|| -> AppResult<Value> {
        let record = state.storage.create(
            "personas",
            with_entity_defaults("personas", Value::Object(object))?,
        )?;
        let persona_id = created_record_id(&record, "persona")?;
        created_persona_id = Some(persona_id.clone());
        flush_import_writes(state)?;
        Ok(
            json!({ "success": true, "id": persona_id, "name": record.get("name").cloned().unwrap_or(Value::Null), "persona": record }),
        )
    })();

    result.map_err(|error| {
        let mut rollback_errors = Vec::new();
        if let Some(persona_id) = created_persona_id.as_deref() {
            rollback_created_records(
                state,
                "personas",
                &[persona_id.to_string()],
                &mut rollback_errors,
            );
        }
        append_rollback_errors(error, "persona import", rollback_errors)
    })
}

pub(super) fn import_persona_file(state: &AppState, path: &Path) -> AppResult<Value> {
    let raw = fs::read_to_string(path)?;
    let fallback_name = file_stem(path);
    let payload = parse_json_text(&raw)
        .unwrap_or_else(|_| json!({ "name": fallback_name, "description": raw }));
    import_persona_payload(state, payload, &fallback_name)
}

pub(super) fn import_persona_avatar_file(
    state: &AppState,
    path: &Path,
    name: String,
    description: String,
) -> AppResult<Value> {
    let stored = super::super::media_uploads::persist_image_file_copy(
        state,
        "avatars/personas",
        &path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| file_stem(path)),
        path,
    )?;
    let modified = modified_at(path);
    let avatar_path = stored.absolute_path.clone();
    let payload = json!({
        "name": name,
        "description": description,
        "avatarPath": stored.asset_url,
        "avatarFilePath": stored.absolute_path,
        "avatarFilename": stored.filename,
        "importedModifiedAt": modified,
    });
    import_persona_payload(state, payload, &file_stem(path)).map_err(|error| {
        let mut rollback_errors = Vec::new();
        rollback_managed_file_path(
            state,
            "avatars/personas",
            &avatar_path,
            &mut rollback_errors,
        );
        append_rollback_errors(error, "persona import", rollback_errors)
    })
}
