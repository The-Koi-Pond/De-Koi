use super::*;

pub(super) fn storage_where_in(
    options: Option<&Value>,
) -> Result<Option<StorageWhereIn>, AppError> {
    let Some(value) = options.and_then(|value| value.get("whereIn")) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(object) = value.as_object() else {
        return Err(AppError::invalid_input(
            "storage_list whereIn must be an object",
        ));
    };
    let field = object
        .get("field")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("storage_list whereIn.field is required"))?
        .to_string();
    let values_array = object
        .get("values")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::invalid_input("storage_list whereIn.values must be an array"))?;
    let mut values = HashSet::new();
    for value in values_array {
        let Some(value) = value.as_str() else {
            return Err(AppError::invalid_input(
                "storage_list whereIn.values must contain only strings",
            ));
        };
        let value = value.trim();
        if !value.is_empty() {
            values.insert(value.to_string());
        }
    }
    Ok(Some(StorageWhereIn { field, values }))
}

pub(super) fn message_id_projection_only(options: Option<&Value>) -> bool {
    let Some(options) = options else {
        return false;
    };
    if options.get("limit").is_some()
        || options.get("before").is_some()
        || options.get("orderBy").is_some()
        || options.get("fieldSelections").is_some()
        || options.get("whereIn").is_some()
    {
        return false;
    }
    let Some(fields) = options.get("fields").and_then(Value::as_array) else {
        return false;
    };
    fields.len() == 1 && fields.first().and_then(Value::as_str) == Some("id")
}

pub(super) fn storage_list_projection_fields_for_read(
    entity: &str,
    fields: &[String],
    options: Option<&Value>,
) -> Vec<String> {
    let mut projection = if entity == "messages" {
        message_projection_fields_for_materialization(fields, options)
    } else {
        fields.to_vec()
    };
    append_storage_list_sort_projection_fields(&mut projection, options);
    projection
}

pub(super) fn append_storage_list_sort_projection_fields(
    projection: &mut Vec<String>,
    options: Option<&Value>,
) {
    if let Some(order_by) = options
        .and_then(|value| value.get("orderBy"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !projection.iter().any(|existing| existing == order_by) {
            projection.push(order_by.to_string());
        }
        return;
    }
    for field in ["sortOrder", "order", "createdAt"] {
        if !projection.iter().any(|existing| existing == field) {
            projection.push(field.to_string());
        }
    }
}

pub(super) fn message_projection_fields_for_materialization(
    fields: &[String],
    options: Option<&Value>,
) -> Vec<String> {
    let mut projection = fields.to_vec();
    for field in ["id", "sortOrder", "order", "createdAt"] {
        if !projection.iter().any(|existing| existing == field) {
            projection.push(field.to_string());
        }
    }
    if let Some(order_by) = options
        .and_then(|value| value.get("orderBy"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !projection.iter().any(|existing| existing == order_by) {
            projection.push(order_by.to_string());
        }
    }
    if fields
        .iter()
        .any(|field| matches!(field.as_str(), "extra" | "swipes"))
        && !projection
            .iter()
            .any(|existing| existing == "activeSwipeIndex")
    {
        projection.push("activeSwipeIndex".to_string());
    }
    projection
}

pub(super) fn message_page_options(options: Option<&Value>) -> Option<(usize, Option<String>)> {
    let options = options?;
    let limit = options.get("limit").and_then(Value::as_u64)? as usize;
    let before = options
        .get("before")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    Some((limit, before))
}

pub(super) fn storage_get_projection_fields_for_read(
    entity: &str,
    fields: &[String],
    options: Option<&Value>,
) -> Vec<String> {
    let mut projection = if entity == "messages" {
        message_projection_fields_for_materialization(fields, options)
    } else {
        fields.to_vec()
    };

    if entity == "connections"
        && fields
            .iter()
            .any(|field| matches!(field.as_str(), "apiKey" | "hasApiKey"))
    {
        for field in ["apiKey", "apiKeyEncrypted"] {
            if !projection.iter().any(|existing| existing == field) {
                projection.push(field.to_string());
            }
        }
    }

    projection
}

pub(super) fn compare_json_values(
    left: Option<&Value>,
    right: Option<&Value>,
) -> std::cmp::Ordering {
    match (left, right) {
        (Some(Value::Number(a)), Some(Value::Number(b))) => a
            .as_f64()
            .partial_cmp(&b.as_f64())
            .unwrap_or(std::cmp::Ordering::Equal),
        (Some(Value::String(a)), Some(Value::String(b))) => a.cmp(b),
        (Some(Value::Bool(a)), Some(Value::Bool(b))) => a.cmp(b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        _ => std::cmp::Ordering::Equal,
    }
}

pub(super) fn apply_message_pagination(rows: &mut Vec<Value>, options: Option<&Value>) {
    rows.sort_by(|a, b| {
        let (a_created_at, a_id) = message_cursor(a);
        let (b_created_at, b_id) = message_cursor(b);
        a_created_at.cmp(b_created_at).then_with(|| a_id.cmp(b_id))
    });

    let before = options
        .and_then(|value| value.get("before"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(parse_message_cursor);

    if let Some((before_created_at, before_id)) = before {
        rows.retain(|row| {
            let (created_at, id) = message_cursor(row);
            created_at < before_created_at.as_str()
                || (created_at == before_created_at.as_str()
                    && before_id.as_deref().is_some_and(|cursor_id| id < cursor_id))
        });
    }

    let Some(limit) = options
        .and_then(|value| value.get("limit"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
    else {
        return;
    };

    if rows.len() > limit {
        let keep_from = rows.len() - limit;
        rows.drain(0..keep_from);
    }
}

pub(super) fn parse_message_cursor(cursor: &str) -> (String, Option<String>) {
    let mut parts = cursor.splitn(2, '|');
    let created_at = parts.next().unwrap_or_default().to_string();
    let id = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    (created_at, id)
}

pub(super) fn message_cursor(row: &Value) -> (&str, &str) {
    (
        row.get("createdAt").and_then(Value::as_str).unwrap_or(""),
        row.get("id").and_then(Value::as_str).unwrap_or(""),
    )
}
