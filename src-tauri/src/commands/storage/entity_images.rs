use super::media_uploads::{
    persist_image_upload, remove_copied_file_path, remove_managed_record_file, safe_filename,
};
use super::*;

pub(crate) fn update_entity_image(
    state: &AppState,
    collection: &str,
    id: &str,
    body: Value,
) -> AppResult<Value> {
    let previous = shared::get_required(state, collection, id)?;
    let folder = entity_image_folder(collection)?;
    let stored = persist_image_upload(state, folder, id, &body, "image")?;
    let updated = match state.storage.patch(
        collection,
        id,
        json!({
            "imagePath": stored.asset_url,
            "imageFilePath": stored.absolute_path,
            "imageFilename": stored.filename,
            "imageUpdatedAt": now_iso()
        }),
    ) {
        Ok(updated) => updated,
        Err(error) => {
            remove_copied_file_path(
                Some(&stored.absolute_path),
                "rolled-back entity image upload",
            );
            return Err(error);
        }
    };
    remove_entity_image_file(state, collection, &previous);
    Ok(updated)
}

pub(crate) fn remove_entity_image_file(state: &AppState, collection: &str, record: &Value) {
    let Ok(folder) = entity_image_folder(collection) else {
        return;
    };
    remove_managed_record_file(state, folder, record, "imageFilePath", "imageFilename");
}

fn entity_image_folder(collection: &str) -> AppResult<&'static str> {
    match collection {
        "agents" => Ok("entity-images/agents"),
        "connections" => Ok("entity-images/connections"),
        _ => Err(AppError::invalid_input(format!(
            "{collection} does not support entity images"
        ))),
    }
}

pub(crate) fn entity_image_file_path(
    state: &AppState,
    collection: &str,
    filename: &str,
) -> AppResult<Value> {
    let folder = entity_image_folder(collection)?;
    let filename = safe_filename(filename);
    let path = state.data_dir.join(folder).join(filename);
    if !path.exists() || !path.is_file() {
        return Err(AppError::not_found("Entity image was not found"));
    }
    Ok(json!({ "path": path.to_string_lossy() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-entity-images-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn small_png_data_url() -> &'static str {
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lTmZsgAAAABJRU5ErkJggg=="
    }

    #[test]
    fn connection_image_upload_stores_managed_entity_image() {
        let state = test_state("connection-upload");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "conn-1",
                    "name": "Connection",
                    "provider": "custom"
                }),
            )
            .expect("connection should be created");

        let updated = update_entity_image(
            &state,
            "connections",
            "conn-1",
            json!({ "image": small_png_data_url(), "filename": "connection.png" }),
        )
        .expect("connection image should update");

        let image_path = updated
            .get("imagePath")
            .and_then(Value::as_str)
            .expect("imagePath should be present");
        assert!(
            !image_path.starts_with("data:image/"),
            "imagePath should be a managed asset URL, not inline data"
        );
        let image_file_path = updated
            .get("imageFilePath")
            .and_then(Value::as_str)
            .expect("imageFilePath should be present");
        assert!(Path::new(image_file_path).is_file());
        assert!(
            image_file_path
                .replace('\\', "/")
                .contains("entity-images/connections"),
            "connection image should be stored under entity-images/connections"
        );
    }

    #[test]
    fn agent_type_image_upload_creates_config_and_replaces_old_file() {
        let state = test_state("agent-type-upload");

        let first = super::super::agents::update_agent_image_by_type(
            &state,
            "illustrator",
            json!({ "image": small_png_data_url(), "filename": "first.png" }),
        )
        .expect("agent image should update");
        let first_path = first
            .get("imageFilePath")
            .and_then(Value::as_str)
            .expect("first image path should be present")
            .to_string();

        let second = super::super::agents::update_agent_image_by_type(
            &state,
            "illustrator",
            json!({ "image": small_png_data_url(), "filename": "second.png" }),
        )
        .expect("agent image should replace");
        let second_path = second
            .get("imageFilePath")
            .and_then(Value::as_str)
            .expect("second image path should be present");

        assert!(
            !Path::new(&first_path).exists(),
            "old agent image should be removed"
        );
        assert!(
            Path::new(second_path).is_file(),
            "new agent image should exist"
        );
        assert_eq!(
            second.get("type").and_then(Value::as_str),
            Some("illustrator")
        );
    }
}
