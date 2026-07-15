use super::*;

pub(crate) fn theme_set_active(state: &AppState, theme_id: Option<&str>) -> AppResult<Value> {
    let selected_id = theme_id
        .map(str::trim)
        .map(ToOwned::to_owned)
        .filter(|id| !id.is_empty());
    if theme_id.is_some() && selected_id.is_none() {
        return Err(AppError::invalid_input("themeId must not be empty"));
    }

    state
        .storage
        .update_collections_atomically(vec!["themes"], move |collections| {
            let [themes] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Theme selection expected the themes collection",
                ));
            };
            if themes.collection() != "themes" {
                return Err(AppError::new(
                    "storage_error",
                    "Theme selection received an unexpected collection",
                ));
            }
            if let Some(id) = selected_id.as_deref() {
                if !themes
                    .rows()
                    .iter()
                    .any(|row| row.get("id").and_then(Value::as_str) == Some(id))
                {
                    return Err(AppError::not_found(format!("themes/{id} was not found")));
                }
            }

            let now = now_iso();
            let mut selected = None;
            for row in themes.rows_mut() {
                let Some(object) = row.as_object_mut() else {
                    return Err(AppError::invalid_input("Stored theme is not an object"));
                };
                let is_selected = selected_id
                    .as_deref()
                    .is_some_and(|id| object.get("id").and_then(Value::as_str) == Some(id));
                object.insert("isActive".to_string(), Value::Bool(is_selected));
                object.insert("active".to_string(), Value::Bool(is_selected));
                object.insert("updatedAt".to_string(), Value::String(now.clone()));
                if is_selected {
                    selected = Some(Value::Object(object.clone()));
                }
            }
            Ok(selected.unwrap_or(Value::Null))
        })
}

const EXTENSIONS_COLLECTION: &str = "extensions";
const PLUGIN_MEMORY_COLLECTION: &str = "plugin-memory";
const EXTENSION_RETENTION_COLLECTION: &str = "extension-data-retention";

fn required_id(value: &str, field: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::invalid_input(format!(
            "{field} must not be empty"
        )));
    }
    Ok(value.to_string())
}

fn extension_namespace(extension: &Value) -> AppResult<String> {
    extension
        .get("storageNamespaceId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| extension.get("id").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::invalid_input("Stored extension is missing an id"))
}

fn memory_belongs_to(row: &Value, namespace: &str) -> bool {
    row.get("pluginId").and_then(Value::as_str) == Some(namespace)
        || row
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id.starts_with(&format!("{namespace}:")))
}

pub(crate) fn extension_remove(
    state: &AppState,
    extension_id: &str,
    data_policy: &str,
) -> AppResult<Value> {
    let extension_id = required_id(extension_id, "extensionId")?;
    if !matches!(data_policy, "retain" | "purge") {
        return Err(AppError::invalid_input(
            "dataPolicy must be either retain or purge",
        ));
    }
    let retain_data = data_policy == "retain";

    state.storage.update_collections_atomically(
        vec![
            EXTENSIONS_COLLECTION,
            PLUGIN_MEMORY_COLLECTION,
            EXTENSION_RETENTION_COLLECTION,
        ],
        move |collections| {
            let [extensions, memory, retention] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Extension removal expected three customization collections",
                ));
            };
            let extension_index = extensions
                .rows()
                .iter()
                .position(|row| row.get("id").and_then(Value::as_str) == Some(&extension_id))
                .ok_or_else(|| {
                    AppError::not_found(format!("extensions/{extension_id} was not found"))
                })?;
            let extension = extensions.rows()[extension_index].clone();
            let namespace = extension_namespace(&extension)?;
            let memory_count = memory
                .rows()
                .iter()
                .filter(|row| memory_belongs_to(row, &namespace))
                .count();

            extensions.rows_mut().remove(extension_index);
            let mut retention_id = None;
            let removed_memory_rows = if retain_data {
                if memory_count > 0 {
                    let id = new_id();
                    let now = now_iso();
                    retention.rows_mut().retain(|row| {
                        row.get("storageNamespaceId").and_then(Value::as_str)
                            != Some(namespace.as_str())
                    });
                    retention.rows_mut().push(json!({
                        "id": id,
                        "storageNamespaceId": namespace,
                        "originalExtensionId": extension_id,
                        "packageId": extension.get("packageId").cloned().unwrap_or(Value::Null),
                        "packageVersion": extension.get("packageVersion").cloned().unwrap_or(Value::Null),
                        "name": extension.get("name").cloned().unwrap_or(Value::Null),
                        "rowCount": memory_count,
                        "retainedAt": now,
                        "updatedAt": now,
                    }));
                    retention_id = Some(id);
                }
                0
            } else {
                memory
                    .rows_mut()
                    .retain(|row| !memory_belongs_to(row, &namespace));
                retention.rows_mut().retain(|row| {
                    row.get("storageNamespaceId").and_then(Value::as_str)
                        != Some(namespace.as_str())
                });
                memory_count
            };

            Ok(json!({
                "extensionId": extension_id,
                "dataPolicy": if retain_data { "retain" } else { "purge" },
                "retentionId": retention_id,
                "removedMemoryRows": removed_memory_rows,
                "retainedMemoryRows": if retain_data { memory_count } else { 0 },
            }))
        },
    )
}

pub(crate) fn extension_retained_data_list(state: &AppState) -> AppResult<Value> {
    let mut rows = state.storage.list(EXTENSION_RETENTION_COLLECTION)?;
    rows.sort_by(|left, right| {
        right
            .get("retainedAt")
            .and_then(Value::as_str)
            .cmp(&left.get("retainedAt").and_then(Value::as_str))
    });
    Ok(Value::Array(rows))
}

pub(crate) fn extension_reconnect_data(
    state: &AppState,
    extension_id: &str,
    retention_id: &str,
) -> AppResult<Value> {
    let extension_id = required_id(extension_id, "extensionId")?;
    let retention_id = required_id(retention_id, "retentionId")?;
    state.storage.update_collections_atomically(
        vec![
            EXTENSIONS_COLLECTION,
            PLUGIN_MEMORY_COLLECTION,
            EXTENSION_RETENTION_COLLECTION,
        ],
        move |collections| {
            let [extensions, memory, retention] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Extension reconnect expected three customization collections",
                ));
            };
            let extension_index = extensions
                .rows()
                .iter()
                .position(|row| row.get("id").and_then(Value::as_str) == Some(&extension_id))
                .ok_or_else(|| {
                    AppError::not_found(format!("extensions/{extension_id} was not found"))
                })?;
            let retention_index = retention
                .rows()
                .iter()
                .position(|row| row.get("id").and_then(Value::as_str) == Some(&retention_id))
                .ok_or_else(|| {
                    AppError::not_found(format!(
                        "{EXTENSION_RETENTION_COLLECTION}/{retention_id} was not found"
                    ))
                })?;
            let retained = retention.rows()[retention_index].clone();
            let retained_package = retained.get("packageId").and_then(Value::as_str);
            let installed_package = extensions.rows()[extension_index]
                .get("packageId")
                .and_then(Value::as_str);
            if retained_package.is_none() || retained_package != installed_package {
                return Err(AppError::invalid_input(
                    "Retained data can only reconnect to the same package identity",
                ));
            }
            let retained_namespace = retained
                .get("storageNamespaceId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::invalid_input("Retained data is missing its namespace"))?
                .to_string();
            let current_namespace = extension_namespace(&extensions.rows()[extension_index])?;
            if current_namespace != retained_namespace
                && memory
                    .rows()
                    .iter()
                    .any(|row| memory_belongs_to(row, &current_namespace))
            {
                return Err(AppError::invalid_input(
                    "The installed extension already has data and cannot reconnect automatically",
                ));
            }

            let extension = extensions.rows_mut()[extension_index]
                .as_object_mut()
                .ok_or_else(|| AppError::invalid_input("Stored extension is not an object"))?;
            extension.insert(
                "storageNamespaceId".to_string(),
                Value::String(retained_namespace),
            );
            extension.insert("updatedAt".to_string(), Value::String(now_iso()));
            let connected = Value::Object(extension.clone());
            retention.rows_mut().remove(retention_index);
            Ok(connected)
        },
    )
}

pub(crate) fn extension_retained_data_purge(
    state: &AppState,
    retention_id: &str,
) -> AppResult<Value> {
    let retention_id = required_id(retention_id, "retentionId")?;
    state.storage.update_collections_atomically(
        vec![PLUGIN_MEMORY_COLLECTION, EXTENSION_RETENTION_COLLECTION],
        move |collections| {
            let [memory, retention] = collections else {
                return Err(AppError::new(
                    "storage_error",
                    "Retained data purge expected two customization collections",
                ));
            };
            let retention_index = retention
                .rows()
                .iter()
                .position(|row| row.get("id").and_then(Value::as_str) == Some(&retention_id))
                .ok_or_else(|| {
                    AppError::not_found(format!(
                        "{EXTENSION_RETENTION_COLLECTION}/{retention_id} was not found"
                    ))
                })?;
            let namespace = retention.rows()[retention_index]
                .get("storageNamespaceId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::invalid_input("Retained data is missing its namespace"))?
                .to_string();
            let before = memory.rows().len();
            memory
                .rows_mut()
                .retain(|row| !memory_belongs_to(row, &namespace));
            let removed_memory_rows = before - memory.rows().len();
            retention.rows_mut().remove(retention_index);
            Ok(json!({
                "retentionId": retention_id,
                "removedMemoryRows": removed_memory_rows,
            }))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-customization-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn seed_themes(state: &AppState) {
        state
            .storage
            .create(
                "themes",
                json!({ "id": "theme-a", "name": "A", "css": "", "isActive": true, "active": true }),
            )
            .expect("first theme should seed");
        state
            .storage
            .create(
                "themes",
                json!({ "id": "theme-b", "name": "B", "css": "", "isActive": false, "active": false }),
            )
            .expect("second theme should seed");
    }

    fn active_theme_ids(state: &AppState) -> Vec<String> {
        state
            .storage
            .list("themes")
            .expect("themes should list")
            .into_iter()
            .filter(|row| {
                row.get("isActive")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    || row.get("active").and_then(Value::as_bool).unwrap_or(false)
            })
            .filter_map(|row| row.get("id").and_then(Value::as_str).map(ToOwned::to_owned))
            .collect()
    }

    #[test]
    fn theme_set_active_selects_exactly_one_and_can_clear_selection() {
        let state = test_state("theme-active");
        seed_themes(&state);

        let selected =
            super::theme_set_active(&state, Some("theme-b")).expect("selection should commit");
        assert_eq!(selected["id"], "theme-b");
        assert_eq!(active_theme_ids(&state), vec!["theme-b"]);

        let cleared = super::theme_set_active(&state, None).expect("clear should commit");
        assert_eq!(cleared, Value::Null);
        assert!(active_theme_ids(&state).is_empty());
    }

    #[test]
    fn theme_set_active_rejects_missing_ids_without_changing_rows() {
        let state = test_state("theme-missing");
        seed_themes(&state);

        let error = super::theme_set_active(&state, Some("missing"))
            .expect_err("missing theme should reject");

        assert_eq!(error.code, "not_found");
        assert_eq!(active_theme_ids(&state), vec!["theme-a"]);
    }

    #[test]
    fn concurrent_theme_selection_never_leaves_multiple_active_rows() {
        let state = test_state("theme-concurrent");
        seed_themes(&state);
        let barrier = Arc::new(Barrier::new(3));

        let handles = ["theme-a", "theme-b"].map(|id| {
            let state = state.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                super::theme_set_active(&state, Some(id))
                    .expect("concurrent selection should commit")
            })
        });
        barrier.wait();
        for handle in handles {
            handle.join().expect("selection thread should finish");
        }

        assert_eq!(active_theme_ids(&state).len(), 1);
    }

    fn seed_extension(state: &AppState, id: &str, package_id: Option<&str>) {
        state
            .storage
            .create(
                "extensions",
                json!({
                    "id": id,
                    "name": id,
                    "description": "",
                    "enabled": false,
                    "packageId": package_id,
                    "packageVersion": "1.0.0"
                }),
            )
            .expect("extension should seed");
    }

    fn seed_plugin_memory(state: &AppState, plugin_id: &str, key: &str) {
        state
            .storage
            .create(
                "plugin-memory",
                json!({
                    "id": format!("{plugin_id}:{key}"),
                    "pluginId": plugin_id,
                    "key": key,
                    "value": { "saved": true }
                }),
            )
            .expect("plugin memory should seed");
    }

    #[test]
    fn extension_remove_retains_memory_with_visible_metadata() {
        let state = test_state("extension-retain");
        seed_extension(&state, "extension-a", Some("pond.example"));
        seed_plugin_memory(&state, "extension-a", "settings");

        let result = super::extension_remove(&state, "extension-a", "retain")
            .expect("retained removal should commit");

        assert_eq!(result["removedMemoryRows"], 0);
        assert_eq!(result["dataPolicy"], "retain");
        assert_eq!(result["retainedMemoryRows"], 1);
        assert!(state
            .storage
            .get("extensions", "extension-a")
            .unwrap()
            .is_none());
        assert!(state
            .storage
            .get("plugin-memory", "extension-a:settings")
            .unwrap()
            .is_some());
        let retained = super::extension_retained_data_list(&state).expect("retention should list");
        assert_eq!(retained.as_array().unwrap().len(), 1);
        assert_eq!(retained[0]["packageId"], "pond.example");
        assert_eq!(retained[0]["rowCount"], 1);
        assert!(retained[0].get("value").is_none());
    }

    #[test]
    fn extension_remove_purges_only_the_selected_namespace_and_rolls_back_missing_ids() {
        let state = test_state("extension-purge");
        seed_extension(&state, "extension-a", Some("pond.a"));
        seed_extension(&state, "extension-b", Some("pond.b"));
        seed_plugin_memory(&state, "extension-a", "settings");
        seed_plugin_memory(&state, "extension-b", "settings");

        let error = super::extension_remove(&state, "missing", "purge")
            .expect_err("missing extension should reject");
        assert_eq!(error.code, "not_found");
        assert!(state
            .storage
            .get("extensions", "extension-a")
            .unwrap()
            .is_some());

        let result =
            super::extension_remove(&state, "extension-a", "purge").expect("purge should commit");
        assert_eq!(result["removedMemoryRows"], 1);
        assert!(state
            .storage
            .get("plugin-memory", "extension-a:settings")
            .unwrap()
            .is_none());
        assert!(state
            .storage
            .get("plugin-memory", "extension-b:settings")
            .unwrap()
            .is_some());
    }

    #[test]
    fn retained_data_reconnect_requires_matching_package_identity() {
        let state = test_state("extension-reconnect");
        seed_extension(&state, "old-extension", Some("pond.example"));
        seed_plugin_memory(&state, "old-extension", "settings");
        let removed = super::extension_remove(&state, "old-extension", "retain")
            .expect("retained removal should commit");
        let retention_id = removed["retentionId"].as_str().unwrap();

        seed_extension(&state, "wrong-extension", Some("pond.other"));
        let error = super::extension_reconnect_data(&state, "wrong-extension", retention_id)
            .expect_err("mismatched package should reject");
        assert_eq!(error.code, "invalid_input");

        seed_extension(&state, "new-extension", Some("pond.example"));
        let connected = super::extension_reconnect_data(&state, "new-extension", retention_id)
            .expect("matching package should reconnect");
        assert_eq!(connected["storageNamespaceId"], "old-extension");
        assert!(super::extension_retained_data_list(&state)
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn retained_data_purge_removes_only_the_retained_namespace() {
        let state = test_state("retained-purge");
        seed_extension(&state, "extension-a", Some("pond.a"));
        seed_plugin_memory(&state, "extension-a", "settings");
        seed_plugin_memory(&state, "other-extension", "settings");
        let removed = super::extension_remove(&state, "extension-a", "retain")
            .expect("retained removal should commit");
        let retention_id = removed["retentionId"].as_str().unwrap();

        let purged = super::extension_retained_data_purge(&state, retention_id)
            .expect("retained data purge should commit");

        assert_eq!(purged["removedMemoryRows"], 1);
        assert!(state
            .storage
            .get("plugin-memory", "extension-a:settings")
            .unwrap()
            .is_none());
        assert!(state
            .storage
            .get("plugin-memory", "other-extension:settings")
            .unwrap()
            .is_some());
        assert!(super::extension_retained_data_list(&state)
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }
}
