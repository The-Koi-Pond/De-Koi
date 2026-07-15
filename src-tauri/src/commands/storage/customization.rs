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
}
