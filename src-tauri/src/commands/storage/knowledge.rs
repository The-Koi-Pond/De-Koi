use super::shared::*;
use super::*;
use marinara_security::assert_inside_dir;
use std::path::{Path, PathBuf};

pub(crate) fn knowledge_meta_path(state: &AppState) -> std::path::PathBuf {
    state.data_dir.join("knowledge-sources").join("meta.json")
}

pub(crate) fn read_knowledge_meta(state: &AppState) -> AppResult<Map<String, Value>> {
    let path = knowledge_meta_path(state);
    if !path.exists() {
        return Ok(Map::new());
    }
    let parsed: Value = serde_json::from_slice(&fs::read(path)?)?;
    Ok(parsed.as_object().cloned().unwrap_or_default())
}

pub(crate) fn write_knowledge_meta(state: &AppState, meta: &Map<String, Value>) -> AppResult<()> {
    let path = knowledge_meta_path(state);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(meta)?)?;
    Ok(())
}

pub(crate) fn knowledge_sources_call(
    state: &AppState,
    method: &str,
    rest: &[&str],
    body: Value,
) -> AppResult<Value> {
    let dir = state.data_dir.join("knowledge-sources");
    fs::create_dir_all(&dir)?;
    match (method, rest) {
        ("GET", []) => {
            let meta = read_knowledge_meta(state)?;
            let mut rows = meta.values().cloned().collect::<Vec<_>>();
            rows.sort_by(|a, b| {
                b.get("uploadedAt")
                    .and_then(Value::as_str)
                    .cmp(&a.get("uploadedAt").and_then(Value::as_str))
            });
            Ok(Value::Array(rows))
        }
        ("POST", ["upload"]) => {
            let (original_name, _content_type, bytes) = decode_uploaded_file(&body)?;
            let ext = std::path::Path::new(&original_name)
                .extension()
                .map(|ext| format!(".{}", ext.to_string_lossy().to_ascii_lowercase()))
                .unwrap_or_default();
            let allowed = [
                ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml",
                ".tsv", ".pdf",
            ];
            if !allowed.contains(&ext.as_str()) {
                return Err(AppError::invalid_input(format!(
                    "Unsupported knowledge source type: {ext}"
                )));
            }
            let id = new_id();
            let filename = format!("{id}{ext}");
            fs::write(dir.join(&filename), bytes)?;
            let entry = json!({
                "id": id,
                "originalName": original_name,
                "filename": filename,
                "size": fs::metadata(dir.join(&filename)).map(|m| m.len()).unwrap_or(0),
                "uploadedAt": now_iso()
            });
            let mut meta = read_knowledge_meta(state)?;
            meta.insert(id, entry.clone());
            write_knowledge_meta(state, &meta)?;
            Ok(entry)
        }
        ("DELETE", [id]) => {
            let mut meta = read_knowledge_meta(state)?;
            if let Some(entry) = meta.get(*id) {
                let path = entry
                    .get("filename")
                    .and_then(Value::as_str)
                    .map(|filename| knowledge_source_file_path(&dir, filename))
                    .transpose()?;
                meta.remove(*id);
                if let Some(path) = path {
                    let _ = fs::remove_file(path);
                }
                write_knowledge_meta(state, &meta)?;
                Ok(json!({ "success": true }))
            } else {
                Err(AppError::not_found("Knowledge source not found"))
            }
        }
        ("GET", [id, "text"]) => {
            let meta = read_knowledge_meta(state)?;
            let entry = meta
                .get(*id)
                .ok_or_else(|| AppError::not_found("Knowledge source not found"))?;
            let filename = entry
                .get("filename")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::not_found("Knowledge source file missing"))?;
            let text = extract_file_text(&knowledge_source_file_path(&dir, filename)?)?;
            Ok(
                json!({ "id": id, "originalName": entry.get("originalName").cloned().unwrap_or(Value::Null), "text": text }),
            )
        }
        _ => Err(AppError::new(
            "route_not_found",
            format!(
                "Unknown knowledge-sources route: {method} /{}",
                rest.join("/")
            ),
        )),
    }
}

fn knowledge_source_file_path(dir: &Path, filename: &str) -> AppResult<PathBuf> {
    assert_inside_dir(dir, Path::new(filename))
}

fn extract_file_text(path: &Path) -> AppResult<String> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    if ext == "pdf" {
        return Ok(pdf_extract::extract_text(path)
            .unwrap_or_else(|_| "[PDF text extraction failed]".to_string()));
    }

    let bytes = fs::read(path)?;
    Ok(String::from_utf8(bytes)
        .unwrap_or_else(|err| String::from_utf8_lossy(err.as_bytes()).into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-knowledge-{label}-{nonce}"));
        if path.exists() {
            fs::remove_dir_all(&path).expect("stale temp knowledge dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    #[test]
    fn knowledge_text_rejects_metadata_filename_escape() {
        let state = test_state("text-escape");
        let dir = state.data_dir.join("knowledge-sources");
        fs::create_dir_all(&dir).expect("knowledge source dir should be created");
        fs::write(state.data_dir.join("outside.txt"), "outside secret")
            .expect("outside fixture should be written");
        write_knowledge_meta(
            &state,
            &Map::from_iter([(
                "source-1".to_string(),
                json!({
                    "id": "source-1",
                    "originalName": "escape.txt",
                    "filename": "../outside.txt"
                }),
            )]),
        )
        .expect("poisoned metadata should be written");

        let error = knowledge_sources_call(&state, "GET", &["source-1", "text"], Value::Null)
            .expect_err("escaped knowledge filename should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(!error.message.contains("outside secret"));
    }

    #[test]
    fn knowledge_delete_rejects_metadata_filename_escape_without_deleting_outside_file() {
        let state = test_state("delete-escape");
        let dir = state.data_dir.join("knowledge-sources");
        fs::create_dir_all(&dir).expect("knowledge source dir should be created");
        let outside = state.data_dir.join("keep.txt");
        fs::write(&outside, "keep me").expect("outside fixture should be written");
        write_knowledge_meta(
            &state,
            &Map::from_iter([(
                "source-1".to_string(),
                json!({
                    "id": "source-1",
                    "originalName": "escape.txt",
                    "filename": "../keep.txt"
                }),
            )]),
        )
        .expect("poisoned metadata should be written");

        let error = knowledge_sources_call(&state, "DELETE", &["source-1"], Value::Null)
            .expect_err("escaped knowledge filename delete should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(outside.is_file());
        assert!(read_knowledge_meta(&state)
            .expect("metadata should still read")
            .contains_key("source-1"));
    }
}
