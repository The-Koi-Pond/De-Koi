use crate::cache::string_value_matches_in;
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fmt;

pub(crate) fn selected_child_paths(fields: &HashSet<String>, key: &str) -> Option<HashSet<String>> {
    let prefix = format!("{key}.");
    let children = fields
        .iter()
        .filter_map(|field| field.strip_prefix(&prefix).map(ToOwned::to_owned))
        .collect::<HashSet<_>>();
    (!children.is_empty()).then_some(children)
}

pub(crate) fn selected_nested_fields(
    field_selections: &Map<String, Value>,
) -> HashMap<String, HashSet<String>> {
    field_selections
        .iter()
        .filter_map(|(field, selection)| {
            let nested = selection
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<HashSet<_>>();
            (!nested.is_empty()).then(|| (field.clone(), nested))
        })
        .collect()
}

pub(crate) fn project_row(
    row: Value,
    fields: &HashSet<String>,
    field_selections: &HashMap<String, HashSet<String>>,
) -> Value {
    let Some(object) = row.as_object() else {
        return row;
    };
    let mut projected = Map::new();
    for field in fields {
        let Some(value) = object.get(field) else {
            continue;
        };
        let next = field_selections
            .get(field)
            .map(|nested| project_nested_value(value.clone(), nested))
            .unwrap_or_else(|| value.clone());
        projected.insert(field.clone(), next);
    }
    Value::Object(projected)
}

pub(crate) fn project_nested_value(value: Value, fields: &HashSet<String>) -> Value {
    match value {
        Value::Object(object) => Value::Object(project_object_nested_fields(&object, fields)),
        Value::String(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(object)) => {
                Value::Object(project_object_nested_fields(&object, fields))
            }
            _ => Value::String(raw),
        },
        other => other,
    }
}

pub(crate) fn project_object_nested_fields(
    object: &Map<String, Value>,
    fields: &HashSet<String>,
) -> Map<String, Value> {
    let mut projected = Map::new();
    for field in fields {
        insert_projected_nested_field(&mut projected, object, field);
    }
    projected
}

pub(crate) fn insert_projected_nested_field(
    projected: &mut Map<String, Value>,
    source: &Map<String, Value>,
    path: &str,
) {
    let Some((head, tail)) = path.split_once('.') else {
        if let Some(value) = source.get(path) {
            projected.insert(path.to_string(), value.clone());
        }
        return;
    };
    let Some(value) = source.get(head) else {
        return;
    };
    let Some(nested_source) = object_value(value) else {
        return;
    };
    let entry = projected
        .entry(head.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    if let Some(nested_projected) = entry.as_object_mut() {
        insert_projected_nested_field(nested_projected, &nested_source, tail);
    }
}

pub(crate) fn object_value(value: &Value) -> Option<Map<String, Value>> {
    match value {
        Value::Object(object) => Some(object.clone()),
        Value::String(raw) => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|value| value.as_object().cloned()),
        _ => None,
    }
}

pub(crate) struct FilteredRowsWhereInVisitor<'a> {
    pub(crate) filter_field: &'a str,
    pub(crate) filter_values: &'a HashSet<String>,
}

impl<'de, 'a> Visitor<'de> for FilteredRowsWhereInVisitor<'a> {
    type Value = Vec<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON array of filtered records")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut rows = Vec::new();
        while let Some(row) = seq.next_element_seed(FilteredRowWhereInSeed {
            filter_field: self.filter_field,
            filter_values: self.filter_values,
        })? {
            if let Some(row) = row {
                rows.push(row);
            }
        }
        Ok(rows)
    }
}

pub(crate) struct FilteredRowWhereInSeed<'a> {
    pub(crate) filter_field: &'a str,
    pub(crate) filter_values: &'a HashSet<String>,
}

impl<'de, 'a> DeserializeSeed<'de> for FilteredRowWhereInSeed<'a> {
    type Value = Option<Value>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(FilteredRowWhereInVisitor {
            filter_field: self.filter_field,
            filter_values: self.filter_values,
        })
    }
}

pub(crate) struct FilteredRowWhereInVisitor<'a> {
    pub(crate) filter_field: &'a str,
    pub(crate) filter_values: &'a HashSet<String>,
}

impl<'de, 'a> Visitor<'de> for FilteredRowWhereInVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a filtered record object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut object = Map::new();
        let mut matches_filter = None;
        while let Some(key) = map.next_key::<String>()? {
            if key == self.filter_field {
                let value = map.next_value::<Value>()?;
                let is_match = string_value_matches_in(&value, self.filter_values);
                matches_filter = Some(is_match);
                if is_match {
                    object.insert(key, value);
                } else {
                    object.clear();
                }
                continue;
            }

            if matches_filter == Some(false) {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
                continue;
            }

            object.insert(key, map.next_value::<Value>()?);
        }

        Ok(matches_filter
            .unwrap_or(false)
            .then_some(Value::Object(object)))
    }
}

pub(crate) struct ProjectedRowsVisitor<'a> {
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> Visitor<'de> for ProjectedRowsVisitor<'a> {
    type Value = Vec<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON array of records")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut rows = Vec::new();
        while let Some(row) = seq.next_element_seed(ProjectedRowSeed {
            fields: self.fields,
            field_selections: self.field_selections,
        })? {
            rows.push(row);
        }
        Ok(rows)
    }
}

pub(crate) struct ProjectedRowsWhereInVisitor<'a> {
    pub(crate) filter_field: &'a str,
    pub(crate) filter_values: &'a HashSet<String>,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> Visitor<'de> for ProjectedRowsWhereInVisitor<'a> {
    type Value = Vec<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON array of filtered records")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut rows = Vec::new();
        while let Some(row) = seq.next_element_seed(ProjectedRowWhereInSeed {
            filter_field: self.filter_field,
            filter_values: self.filter_values,
            fields: self.fields,
            field_selections: self.field_selections,
        })? {
            if let Some(row) = row {
                rows.push(row);
            }
        }
        Ok(rows)
    }
}

pub(crate) struct ProjectedRowWhereInSeed<'a> {
    pub(crate) filter_field: &'a str,
    pub(crate) filter_values: &'a HashSet<String>,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> DeserializeSeed<'de> for ProjectedRowWhereInSeed<'a> {
    type Value = Option<Value>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(ProjectedRowWhereInVisitor {
            filter_field: self.filter_field,
            filter_values: self.filter_values,
            fields: self.fields,
            field_selections: self.field_selections,
        })
    }
}

pub(crate) struct ProjectedRowWhereInVisitor<'a> {
    pub(crate) filter_field: &'a str,
    pub(crate) filter_values: &'a HashSet<String>,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> Visitor<'de> for ProjectedRowWhereInVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a filtered record object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut object = Map::new();
        let mut matches_filter = None;
        while let Some(key) = map.next_key::<String>()? {
            if key == self.filter_field {
                let value = map.next_value::<Value>()?;
                let is_match = string_value_matches_in(&value, self.filter_values);
                matches_filter = Some(is_match);
                if is_match && self.fields.contains(&key) {
                    object.insert(key, value);
                } else if !is_match {
                    object.clear();
                }
                continue;
            }

            if matches_filter == Some(false) {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
                continue;
            }

            if !self.fields.contains(&key) {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
                continue;
            }

            let value = if let Some(nested_fields) = self.field_selections.get(&key) {
                map.next_value_seed(ProjectedNestedSeed {
                    fields: nested_fields,
                })?
            } else {
                map.next_value::<Value>()?
            };
            object.insert(key, value);
        }

        Ok(matches_filter
            .unwrap_or(false)
            .then_some(Value::Object(object)))
    }
}

pub(crate) struct ProjectedRowSeed<'a> {
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> DeserializeSeed<'de> for ProjectedRowSeed<'a> {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(ProjectedRowVisitor {
            fields: self.fields,
            field_selections: self.field_selections,
        })
    }
}

pub(crate) struct ProjectedRowVisitor<'a> {
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> Visitor<'de> for ProjectedRowVisitor<'a> {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a record object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut object = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if !self.fields.contains(&key) {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
                continue;
            }

            let value = if let Some(nested_fields) = self.field_selections.get(&key) {
                map.next_value_seed(ProjectedNestedSeed {
                    fields: nested_fields,
                })?
            } else {
                map.next_value::<Value>()?
            };
            object.insert(key, value);
        }
        Ok(Value::Object(object))
    }
}

pub(crate) struct ProjectedNestedSeed<'a> {
    pub(crate) fields: &'a HashSet<String>,
}

impl<'de, 'a> DeserializeSeed<'de> for ProjectedNestedSeed<'a> {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_any(ProjectedNestedVisitor {
            fields: self.fields,
        })
    }
}

pub(crate) struct ProjectedNestedVisitor<'a> {
    pub(crate) fields: &'a HashSet<String>,
}

impl<'de, 'a> Visitor<'de> for ProjectedNestedVisitor<'a> {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a nested object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut object = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if self.fields.contains(&key) {
                object.insert(key, map.next_value::<Value>()?);
            } else if let Some(child_fields) = selected_child_paths(self.fields, &key) {
                let value = map.next_value_seed(ProjectedNestedSeed {
                    fields: &child_fields,
                })?;
                if !value.as_object().is_some_and(Map::is_empty) {
                    object.insert(key, value);
                }
            } else {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
            }
        }
        Ok(Value::Object(object))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(project_nested_value(
            Value::String(value.to_string()),
            self.fields,
        ))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(project_nested_value(Value::String(value), self.fields))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Value::Null)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Value::Null)
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(serde_json::Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null))
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(value) = seq.next_element::<Value>()? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }
}
