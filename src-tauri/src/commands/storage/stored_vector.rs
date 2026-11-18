//! How embedding vectors are kept at rest: one string, `f32b64:` followed by the vector's little-endian
//! 32-bit floats in base64. As JSON numbers a 1536-dimension vector took about 13 KB; this takes about
//! 8 KB and parses as one string instead of 1536 numbers. 32-bit floats keep about seven significant
//! digits, more than similarity scoring needs.
//!
//! Vectors are decoded only here. Anything handed to the app (chat memory lists, recall exports) gets a
//! plain number array, and rows written before this format (backups, imports, not-yet-migrated data) are
//! still read as number arrays.

use base64::{engine::general_purpose, Engine as _};
use marinara_core::AppResult;
use marinara_storage::FileStorage;
use serde_json::Value;

const PREFIX: &str = "f32b64:";
const INDEX_COLLECTION: &str = "memory-index-rows";

/// The stored form of `vector`.
pub(crate) fn encode(vector: &[f64]) -> Value {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&(*value as f32).to_le_bytes());
    }
    Value::String(format!(
        "{PREFIX}{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

/// The numbers in a stored vector, from either form. `None` when there are none or the value is not a
/// vector. Like the number-array reader before it, an array that holds anything but numbers is no vector.
pub(crate) fn decode(value: Option<&Value>) -> Option<Vec<f64>> {
    let vector = match value? {
        Value::Array(items) => items
            .iter()
            .map(Value::as_f64)
            .collect::<Option<Vec<_>>>()?,
        Value::String(text) => {
            let bytes = general_purpose::STANDARD
                .decode(text.strip_prefix(PREFIX)?)
                .ok()?;
            if bytes.len() % 4 != 0 {
                return None;
            }
            bytes
                .chunks_exact(4)
                .map(|chunk| {
                    f64::from(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                })
                .collect()
        }
        _ => return None,
    };
    (!vector.is_empty()).then_some(vector)
}

/// A stored vector as the app sees it: a number array, or null when there is none.
pub(crate) fn to_public(value: Option<&Value>) -> Value {
    decode(value)
        .map(|vector| Value::Array(vector.into_iter().map(Value::from).collect()))
        .unwrap_or(Value::Null)
}

/// Rewrites a number-array vector in `object[field]` into the stored form. Leaves anything else alone.
fn compact_field(object: &mut serde_json::Map<String, Value>, field: &str) -> bool {
    if !object.get(field).is_some_and(Value::is_array) {
        return false;
    }
    let Some(vector) = decode(object.get(field)) else {
        return false;
    };
    object.insert(field.to_string(), encode(&vector));
    true
}

fn compact_chat_memory_embeddings(chat: &mut Value) -> bool {
    let Some(memories) = chat.get_mut("memories").and_then(Value::as_array_mut) else {
        return false;
    };
    let mut changed = false;
    for memory in memories.iter_mut().filter_map(Value::as_object_mut) {
        changed |= compact_field(memory, "embedding");
    }
    changed
}

fn compact_index_vector(row: &mut Value) -> bool {
    row.as_object_mut()
        .is_some_and(|row| compact_field(row, "vector"))
}

#[derive(Debug, Default, Eq, PartialEq)]
pub(crate) struct CompactVectorsReport {
    pub chats: usize,
    pub index_rows: usize,
}

/// One pass that moves vectors written as number arrays (chat memory embeddings and memory index rows)
/// into the stored form.
pub(crate) fn compact_stored_vectors(storage: &FileStorage) -> AppResult<CompactVectorsReport> {
    let chats = storage.transform_collection_streaming(
        "chats",
        "compact-memory-embeddings-v1",
        |_index, row| Ok(compact_chat_memory_embeddings(row)),
        |_index, _row| Ok(()),
    )?;
    let index_rows = storage.transform_collection_streaming(
        INDEX_COLLECTION,
        "compact-index-vectors-v1",
        |_index, row| Ok(compact_index_vector(row)),
        |_index, _row| Ok(()),
    )?;
    Ok(CompactVectorsReport {
        chats: chats.changed_records,
        index_rows: index_rows.changed_records,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn is_encoded(value: Option<&Value>) -> bool {
        value
            .and_then(Value::as_str)
            .is_some_and(|text| text.starts_with(PREFIX))
    }

    #[test]
    fn a_vector_round_trips_at_f32_precision_in_less_space() {
        let vector: Vec<f64> = (0..1536)
            .map(|index| ((index as f64) * 0.7311).sin() * 0.05)
            .collect();
        let stored = encode(&vector);
        assert!(is_encoded(Some(&stored)));
        let decoded = decode(Some(&stored)).unwrap();
        assert_eq!(decoded.len(), vector.len());
        for (left, right) in decoded.iter().zip(&vector) {
            assert!((left - right).abs() < 1e-8, "{left} vs {right}");
        }
        let as_numbers = serde_json::to_string(&json!(vector)).unwrap().len();
        let as_stored = serde_json::to_string(&stored).unwrap().len();
        assert!(
            as_stored * 10 < as_numbers * 7,
            "{as_stored} vs {as_numbers}"
        );
    }

    #[test]
    fn number_arrays_from_before_still_read() {
        assert_eq!(
            decode(Some(&json!([0.5, -1, 2.25]))),
            Some(vec![0.5, -1.0, 2.25])
        );
        assert_eq!(to_public(Some(&json!([0.5]))), json!([0.5]));
        assert_eq!(to_public(Some(&encode(&[0.5, 0.25]))), json!([0.5, 0.25]));
    }

    #[test]
    fn anything_else_is_no_vector() {
        for value in [
            json!([]),
            json!([0.5, "x"]),
            json!("plain text"),
            json!("f32b64:not base64!"),
            json!("f32b64:AAA="),
            json!(null),
            json!({ "vector": [1] }),
        ] {
            assert_eq!(decode(Some(&value)), None, "{value}");
            assert_eq!(to_public(Some(&value)), Value::Null, "{value}");
        }
        assert_eq!(decode(None), None);
    }

    #[test]
    fn compacting_rewrites_number_arrays_once_and_keeps_the_rest() {
        let path =
            std::env::temp_dir().join(format!("de-koi-stored-vector-{}", marinara_core::new_id()));
        let storage = FileStorage::new(&path).unwrap();
        storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "memories": [
                        { "id": "m1", "content": "a", "embedding": [0.5, 0.25] },
                        { "id": "m2", "content": "b", "embedding": null },
                        { "id": "m3", "content": "c" }
                    ]
                }),
            )
            .unwrap();
        storage
            .create("chats", json!({ "id": "chat-2", "memories": [] }))
            .unwrap();
        storage
            .create(
                INDEX_COLLECTION,
                json!({ "id": "row-1", "memoryId": "m", "vector": [1.0, -2.0], "lexicalTokens": ["x"] }),
            )
            .unwrap();

        let report = compact_stored_vectors(&storage).unwrap();
        assert_eq!(
            report,
            CompactVectorsReport {
                chats: 1,
                index_rows: 1
            }
        );

        let chat = storage.get("chats", "chat-1").unwrap().unwrap();
        assert!(is_encoded(chat["memories"][0].get("embedding")));
        assert_eq!(
            decode(chat["memories"][0].get("embedding")),
            Some(vec![0.5, 0.25])
        );
        assert_eq!(chat["memories"][1]["embedding"], Value::Null);
        assert!(chat["memories"][2].get("embedding").is_none());
        assert_eq!(chat["memories"][0]["content"], "a");
        let row = storage.get(INDEX_COLLECTION, "row-1").unwrap().unwrap();
        assert_eq!(decode(row.get("vector")), Some(vec![1.0, -2.0]));
        assert_eq!(row["lexicalTokens"], json!(["x"]));

        assert_eq!(
            compact_stored_vectors(&storage).unwrap(),
            CompactVectorsReport::default()
        );
        drop(storage);
        let _ = std::fs::remove_dir_all(path);
    }
}
