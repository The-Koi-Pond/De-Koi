use super::lorebook_normalization::normalize_lorebook_entry;
use super::*;

#[derive(Clone, Copy)]
enum LorebookPersistenceMode {
    Create,
    Replace,
}

pub(crate) fn create_lorebook_records(
    state: &AppState,
    lorebook: Value,
    entries: &[Value],
) -> AppResult<(Value, usize)> {
    persist_lorebook_records(state, lorebook, entries, LorebookPersistenceMode::Create)
}

pub(crate) fn replace_lorebook_records(
    state: &AppState,
    lorebook: Value,
    entries: &[Value],
) -> AppResult<(Value, usize)> {
    persist_lorebook_records(state, lorebook, entries, LorebookPersistenceMode::Replace)
}

fn persist_lorebook_records(
    state: &AppState,
    lorebook: Value,
    entries: &[Value],
    mode: LorebookPersistenceMode,
) -> AppResult<(Value, usize)> {
    let mut lorebook_object = ensure_object(lorebook)?;
    let record = match mode {
        LorebookPersistenceMode::Create => {
            lorebook_object.remove("id");
            prepare_created_record(Value::Object(lorebook_object))?
        }
        LorebookPersistenceMode::Replace => {
            let has_id = lorebook_object
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.trim().is_empty());
            if !has_id {
                return Err(AppError::invalid_input(
                    "Replacing a lorebook requires an existing id",
                ));
            }
            lorebook_object.insert("updatedAt".to_string(), Value::String(now_iso()));
            Value::Object(lorebook_object)
        }
    };
    let lorebook_id = created_record_id(&record, "lorebook")?;
    let entry_records = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            prepare_created_record(normalize_lorebook_entry(&lorebook_id, entry, index))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let entries_imported = entry_records.len();
    let replace_existing_children = matches!(mode, LorebookPersistenceMode::Replace);
    let collections = if replace_existing_children {
        vec!["lorebooks", "lorebook-entries", "lorebook-folders"]
    } else {
        vec!["lorebooks", "lorebook-entries"]
    };

    state
        .storage
        .update_collections_atomically(collections, |collections| {
            let lorebooks = collections
                .get_mut(0)
                .ok_or_else(|| AppError::new("storage_error", "Lorebook collection missing"))?
                .rows_mut();
            lorebooks.retain(|row| row.get("id").and_then(Value::as_str) != Some(&lorebook_id));
            lorebooks.push(record.clone());

            let lorebook_entries = collections
                .get_mut(1)
                .ok_or_else(|| AppError::new("storage_error", "Lorebook entry collection missing"))?
                .rows_mut();
            if replace_existing_children {
                lorebook_entries.retain(|row| {
                    row.get("lorebookId").and_then(Value::as_str) != Some(&lorebook_id)
                });
            }
            lorebook_entries.extend(entry_records);

            if replace_existing_children {
                collections
                    .get_mut(2)
                    .ok_or_else(|| {
                        AppError::new("storage_error", "Lorebook folder collection missing")
                    })?
                    .rows_mut()
                    .retain(|row| {
                        row.get("lorebookId").and_then(Value::as_str) != Some(&lorebook_id)
                    });
            }
            Ok(())
        })?;

    Ok((record, entries_imported))
}
