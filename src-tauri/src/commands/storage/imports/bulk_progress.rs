use super::super::*;
use serde_json::{json, Value};
use std::path::Path;

pub(super) fn empty_import_counts() -> Value {
    json!({
        "characters": 0,
        "chats": 0,
        "groupChats": 0,
        "presets": 0,
        "lorebooks": 0,
        "backgrounds": 0,
        "personas": 0
    })
}

pub(super) fn imported_count(imported: &Value, key: &str) -> i64 {
    imported.get(key).and_then(Value::as_i64).unwrap_or(0)
}

pub(super) fn push_import_error(errors: &mut Vec<Value>, item: impl AsRef<str>, error: AppError) {
    errors.push(Value::String(format!(
        "{}: {}",
        item.as_ref(),
        error.message
    )));
}

pub(super) fn push_path_import_error(errors: &mut Vec<Value>, path: &Path, error: AppError) {
    push_import_error(errors, path.to_string_lossy(), error);
}

pub(super) struct BulkImportProgress<'a> {
    emit: Option<&'a mut dyn FnMut(Value) -> AppResult<()>>,
    current: usize,
    total: usize,
}

impl<'a> BulkImportProgress<'a> {
    pub(super) fn new(
        emit: Option<&'a mut dyn FnMut(Value) -> AppResult<()>>,
        total: usize,
    ) -> Self {
        Self {
            emit,
            current: 0,
            total,
        }
    }

    pub(super) fn emit_item(
        &mut self,
        category: &str,
        item: &Path,
        imported: &Value,
    ) -> AppResult<()> {
        self.current += 1;
        self.emit_progress(category, &item.to_string_lossy(), imported)
    }

    pub(super) fn emit_skipped(
        &mut self,
        category: &str,
        item: &str,
        imported: &Value,
    ) -> AppResult<()> {
        self.current += 1;
        self.emit_progress(category, item, imported)
    }

    fn emit_progress(&mut self, category: &str, item: &str, imported: &Value) -> AppResult<()> {
        if let Some(emit) = self.emit.as_deref_mut() {
            emit(json!({
                "type": "progress",
                "data": {
                    "category": category,
                    "item": item,
                    "current": self.current,
                    "total": self.total,
                    "imported": imported
                }
            }))?;
        }
        Ok(())
    }

    pub(super) fn emit_done(&mut self, result: &Value) -> AppResult<()> {
        if let Some(emit) = self.emit.as_deref_mut() {
            emit(json!({ "type": "done", "data": result }))?;
        }
        Ok(())
    }
}
