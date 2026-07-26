use super::*;

pub(super) fn portable_character_memory_bodies(
    character_id: &str,
    value: Option<&Value>,
) -> AppResult<Vec<Value>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let memories = value
        .as_array()
        .ok_or_else(|| AppError::invalid_input("character memories must be an array"))?;
    let mut id_map = HashMap::new();
    for memory in memories {
        let export_id = memory
            .get("exportId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::invalid_input("character memory exportId is required"))?;
        if id_map.insert(export_id.to_string(), new_id()).is_some() {
            return Err(AppError::invalid_input(
                "character memory exportId values must be unique",
            ));
        }
    }

    let mut bodies = Vec::with_capacity(memories.len());
    for memory in memories {
        let export_id = memory["exportId"].as_str().unwrap().trim();
        let mut body = Map::new();
        body.insert("id".to_string(), Value::String(id_map[export_id].clone()));
        for field in ["kind", "status", "title", "content", "confidence", "tags"] {
            if let Some(value) = memory.get(field) {
                body.insert(field.to_string(), value.clone());
            }
        }
        body.insert(
            "scope".to_string(),
            json!({ "kind": "character", "id": character_id }),
        );
        body.insert(
            "provenance".to_string(),
            json!({
                "sourceChatId": null,
                "messageIds": [],
                "characterId": character_id
            }),
        );
        body.insert("payload".to_string(), json!({}));
        for (export_field, memory_field) in [
            ("supersedesExportId", "supersedesMemoryId"),
            ("supersededByExportId", "supersededByMemoryId"),
        ] {
            if let Some(linked_export_id) = memory.get(export_field).and_then(Value::as_str) {
                let linked_memory_id = id_map.get(linked_export_id).ok_or_else(|| {
                    AppError::invalid_input(format!(
                        "character memory {export_field} references an unknown exportId"
                    ))
                })?;
                body.insert(
                    memory_field.to_string(),
                    Value::String(linked_memory_id.clone()),
                );
            }
        }
        let body = Value::Object(body);
        canonical_memory::validate_memory_input(&body)?;
        bodies.push(body);
    }
    Ok(bodies)
}
