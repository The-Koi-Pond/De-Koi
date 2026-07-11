use crate::messages::{
    is_pretty_top_level_record_end, pretty_json_field,
    read_pretty_projected_record_by_id_from_reader, strip_trailing_json_comma,
};
use crate::projection::{project_row, ProjectedNestedSeed};
use marinara_core::{AppError, AppResult};
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Cursor, ErrorKind, Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[cfg(test)]
pub(crate) type IndexBuildTestHook = Box<dyn FnMut(&Path) + Send + 'static>;

#[cfg(test)]
pub(crate) static INDEX_BUILD_TEST_HOOK: std::sync::Mutex<Option<IndexBuildTestHook>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
pub(crate) type ContentSignatureTestHook = Box<dyn FnMut(&Path) + Send + 'static>;

#[cfg(test)]
pub(crate) static CONTENT_SIGNATURE_TEST_HOOK: std::sync::Mutex<Option<ContentSignatureTestHook>> =
    std::sync::Mutex::new(None);

const COLLECTION_FAST_STAMP_SAMPLE_BYTES: u64 = 4 * 1024;

#[derive(Default)]
pub(crate) struct StorageCache {
    pub(crate) collections: HashMap<String, CachedCollection>,
    pub(crate) id_indexes: HashMap<String, CachedCollectionIdIndex>,
    pub(crate) projected_lists: HashMap<ProjectionCacheKey, CachedProjectedList>,
}

pub(crate) struct CachedCollection {
    pub(crate) rows: Vec<Value>,
    pub(crate) row_indices_by_id: HashMap<String, usize>,
    pub(crate) dirty: bool,
    pub(crate) approx_bytes: usize,
}

pub(crate) struct CachedCollectionIdIndex {
    pub(crate) records_by_id: HashMap<String, CachedCollectionRecord>,
    pub(crate) stamp: Option<CollectionContentStamp>,
}

#[derive(Clone)]
pub(crate) enum CachedCollectionRecord {
    PrettyRange(CachedRecordRange),
    Row(Value),
}

#[derive(Clone, Copy)]
pub(crate) struct CachedRecordRange {
    pub(crate) start: u64,
    pub(crate) end: u64,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct ProjectionCacheKey {
    pub(crate) collection: String,
    pub(crate) shape: ProjectionShape,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct ProjectionShape {
    pub(crate) fields: Vec<String>,
    pub(crate) field_selections: Vec<(String, Vec<String>)>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CollectionFastStamp {
    pub(crate) len: u64,
    pub(crate) modified_nanos: u128,
    pub(crate) changed_nanos: u128,
    pub(crate) sample_signature: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CollectionContentStamp {
    pub(crate) len: u64,
    pub(crate) modified_nanos: u128,
    pub(crate) content_signature: u64,
}

pub(crate) struct CachedProjectedList {
    pub(crate) rows: Vec<Value>,
    pub(crate) stamp: Option<CollectionFastStamp>,
}

pub(crate) fn approximate_json_bytes(value: &Value) -> usize {
    match value {
        Value::Null => 4,
        Value::Bool(_) => 5,
        Value::Number(number) => number.to_string().len(),
        Value::String(text) => text.len() + 2,
        Value::Array(values) => {
            values.iter().map(approximate_json_bytes).sum::<usize>() + values.len() + 2
        }
        Value::Object(object) => {
            object
                .iter()
                .map(|(key, value)| key.len() + 3 + approximate_json_bytes(value))
                .sum::<usize>()
                + object.len()
                + 2
        }
    }
}

pub(crate) fn row_matches_filters(row: &Value, filters: &Map<String, Value>) -> bool {
    let Some(object) = row.as_object() else {
        return false;
    };
    filters
        .iter()
        .all(|(key, expected)| object.get(key) == Some(expected))
}

pub(crate) fn row_string_field_matches_in(
    row: &Value,
    filter_field: &str,
    filter_values: &HashSet<String>,
) -> bool {
    row.get(filter_field)
        .is_some_and(|value| string_value_matches_in(value, filter_values))
}

pub(crate) fn string_value_matches_in(value: &Value, filter_values: &HashSet<String>) -> bool {
    value
        .as_str()
        .map(str::trim)
        .is_some_and(|value| filter_values.contains(value))
}

pub(crate) struct FindRowByIdVisitor<'a> {
    pub(crate) id: &'a str,
}

impl<'de, 'a> Visitor<'de> for FindRowByIdVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut found = None;
        while let Some(row) = seq.next_element_seed(FindRowByIdSeed { id: self.id })? {
            if row.is_some() {
                found = row;
                break;
            }
        }
        if found.is_some() {
            while seq.next_element::<serde::de::IgnoredAny>()?.is_some() {}
        }
        Ok(found)
    }
}

pub(crate) struct FindRowByIdSeed<'a> {
    pub(crate) id: &'a str,
}

impl<'de, 'a> DeserializeSeed<'de> for FindRowByIdSeed<'a> {
    type Value = Option<Value>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(FindRowByIdRowVisitor { id: self.id })
    }
}

pub(crate) struct FindRowByIdRowVisitor<'a> {
    pub(crate) id: &'a str,
}

impl<'de, 'a> Visitor<'de> for FindRowByIdRowVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a record object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut object = Map::new();
        let mut matches_id = None;
        while let Some(key) = map.next_key::<String>()? {
            if matches_id == Some(false) {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
                continue;
            }

            let value = map.next_value::<Value>()?;
            if key == "id" {
                let is_match = value.as_str() == Some(self.id);
                matches_id = Some(is_match);
                if !is_match {
                    object.clear();
                    continue;
                }
            }
            object.insert(key, value);
        }

        Ok(matches_id.unwrap_or(false).then_some(Value::Object(object)))
    }
}

pub(crate) struct ProjectedRowByIdVisitor<'a> {
    pub(crate) id: &'a str,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> Visitor<'de> for ProjectedRowByIdVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut found = None;
        while let Some(row) = seq.next_element_seed(ProjectedRowByIdSeed {
            id: self.id,
            fields: self.fields,
            field_selections: self.field_selections,
        })? {
            if row.is_some() {
                found = row;
                break;
            }
        }
        if found.is_some() {
            while seq.next_element::<serde::de::IgnoredAny>()?.is_some() {}
        }
        Ok(found)
    }
}

pub(crate) struct ProjectedRowByIdSeed<'a> {
    pub(crate) id: &'a str,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> DeserializeSeed<'de> for ProjectedRowByIdSeed<'a> {
    type Value = Option<Value>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(ProjectedRowByIdRowVisitor {
            id: self.id,
            fields: self.fields,
            field_selections: self.field_selections,
        })
    }
}

pub(crate) struct ProjectedRowByIdRowVisitor<'a> {
    pub(crate) id: &'a str,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> Visitor<'de> for ProjectedRowByIdRowVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a record object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut object = Map::new();
        let mut matches_id = None;
        while let Some(key) = map.next_key::<String>()? {
            if matches_id == Some(false) {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
                continue;
            }

            if key == "id" {
                let value = map.next_value::<Value>()?;
                let is_match = value.as_str() == Some(self.id);
                matches_id = Some(is_match);
                if !is_match {
                    object.clear();
                    continue;
                }
                if self.fields.contains(&key) {
                    object.insert(key, value);
                }
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

        Ok(matches_id.unwrap_or(false).then_some(Value::Object(object)))
    }
}

pub(crate) fn projection_shape(
    fields: &[String],
    field_selections: &HashMap<String, HashSet<String>>,
) -> ProjectionShape {
    let mut normalized_fields = fields.to_vec();
    normalized_fields.sort();
    normalized_fields.dedup();
    let mut normalized_selections = field_selections
        .iter()
        .map(|(field, selections)| {
            let mut nested = selections.iter().cloned().collect::<Vec<_>>();
            nested.sort();
            nested.dedup();
            (field.clone(), nested)
        })
        .collect::<Vec<_>>();
    normalized_selections.sort_by(|a, b| a.0.cmp(&b.0));
    ProjectionShape {
        fields: normalized_fields,
        field_selections: normalized_selections,
    }
}

#[cfg(test)]
pub(crate) fn run_index_build_test_hook(path: &Path) -> AppResult<()> {
    let mut hook = INDEX_BUILD_TEST_HOOK
        .lock()
        .map_err(|_| AppError::new("lock_error", "Storage index test hook lock poisoned"))?;
    if let Some(hook) = hook.as_mut() {
        hook(path);
    }
    Ok(())
}

pub(crate) fn records_by_id(rows: &[Value]) -> HashMap<String, CachedCollectionRecord> {
    let mut index = HashMap::new();
    for row in rows {
        let Some(id) = row.get("id").and_then(Value::as_str) else {
            continue;
        };
        index
            .entry(id.to_string())
            .or_insert_with(|| CachedCollectionRecord::Row(row.clone()));
    }
    index
}

pub(crate) fn pretty_record_ranges_by_id(
    path: &Path,
) -> AppResult<Option<HashMap<String, CachedRecordRange>>> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut ranges = HashMap::new();
    let mut in_record = false;
    let mut saw_array_start = false;
    let mut saw_record = false;
    let mut record_start = 0_u64;
    let mut record_id: Option<String> = None;
    let mut line = String::new();

    loop {
        let line_start = reader.stream_position()?;
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let line_end = reader.stream_position()?;
        let line = line.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim_start();

        if !in_record {
            if trimmed.starts_with('[') {
                saw_array_start = true;
                continue;
            }
            if trimmed.starts_with(']') {
                break;
            }
            if trimmed.trim().is_empty() {
                continue;
            }
            if trimmed.starts_with('{') {
                in_record = true;
                saw_record = true;
                record_start = line_start;
                record_id = None;
                continue;
            }
            return Ok(None);
        }

        if is_pretty_top_level_record_end(line) {
            if let Some(id) = record_id.take() {
                ranges.entry(id).or_insert(CachedRecordRange {
                    start: record_start,
                    end: line_end,
                });
            }
            in_record = false;
            continue;
        }

        if record_id.is_none() {
            let Some((field, value_start)) = pretty_json_field(line, 4)? else {
                continue;
            };
            if field == "id" {
                let value = value_start
                    .trim()
                    .strip_suffix(',')
                    .unwrap_or(value_start.trim())
                    .trim_end();
                if let Ok(Value::String(id)) = serde_json::from_str::<Value>(value) {
                    record_id = Some(id);
                }
            }
        }
    }

    if !saw_array_start || in_record || !saw_record {
        return Ok(None);
    }
    Ok(Some(ranges))
}

pub(crate) fn read_indexed_record_value(
    path: &Path,
    record: &CachedCollectionRecord,
) -> AppResult<Option<Value>> {
    match record {
        CachedCollectionRecord::PrettyRange(range) => {
            read_pretty_record_range(path, *range).map(Some)
        }
        CachedCollectionRecord::Row(row) => Ok(Some(row.clone())),
    }
}

pub(crate) fn read_indexed_record_projected_value(
    path: &Path,
    record: &CachedCollectionRecord,
    id: &str,
    fields: &HashSet<String>,
    field_selections: &HashMap<String, HashSet<String>>,
) -> AppResult<Option<Value>> {
    match record {
        CachedCollectionRecord::PrettyRange(range) => {
            read_pretty_projected_record_range(path, *range, id, fields, field_selections)
        }
        CachedCollectionRecord::Row(row) => {
            Ok(Some(project_row(row.clone(), fields, field_selections)))
        }
    }
}

pub(crate) fn read_pretty_record_range(path: &Path, range: CachedRecordRange) -> AppResult<Value> {
    let mut bytes = read_file_range(path, range)?;
    strip_trailing_json_comma(&mut bytes);
    Ok(serde_json::from_slice(&bytes)?)
}

pub(crate) fn read_pretty_projected_record_range(
    path: &Path,
    range: CachedRecordRange,
    id: &str,
    fields: &HashSet<String>,
    field_selections: &HashMap<String, HashSet<String>>,
) -> AppResult<Option<Value>> {
    let mut bytes = read_file_range(path, range)?;
    strip_trailing_json_comma(&mut bytes);
    let mut wrapped = Vec::with_capacity(bytes.len() + 4);
    wrapped.extend_from_slice(b"[\n");
    wrapped.extend_from_slice(&bytes);
    wrapped.extend_from_slice(b"\n]");
    let reader = BufReader::new(Cursor::new(wrapped));
    read_pretty_projected_record_by_id_from_reader(reader, id, fields, field_selections)
}

pub(crate) fn read_file_range(path: &Path, range: CachedRecordRange) -> AppResult<Vec<u8>> {
    let len = range.end.checked_sub(range.start).ok_or_else(|| {
        AppError::invalid_input("Cached storage record range ended before it started")
    })?;
    let len = usize::try_from(len)
        .map_err(|_| AppError::invalid_input("Cached storage record range is too large"))?;
    let mut bytes = vec![0_u8; len];
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(range.start))?;
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

pub(crate) fn row_indices_by_id(rows: &[Value]) -> HashMap<String, usize> {
    let mut index = HashMap::new();
    for (row_index, row) in rows.iter().enumerate() {
        let Some(id) = row.get("id").and_then(Value::as_str) else {
            continue;
        };
        index.entry(id.to_string()).or_insert(row_index);
    }
    index
}

pub(crate) fn collection_fast_stamp(path: &Path) -> AppResult<Option<CollectionFastStamp>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    Ok(Some(CollectionFastStamp {
        len: metadata.len(),
        modified_nanos: metadata_modified_nanos(&metadata),
        changed_nanos: metadata_changed_nanos(&metadata),
        sample_signature: collection_sample_signature(path, metadata.len())?,
    }))
}

pub(crate) fn collection_fast_stamps_share_content_window(
    before: Option<CollectionFastStamp>,
    after: Option<CollectionFastStamp>,
) -> bool {
    match (before, after) {
        (Some(before), Some(after)) => {
            before.len == after.len
                && before.modified_nanos == after.modified_nanos
                && before.sample_signature == after.sample_signature
        }
        (None, None) => true,
        _ => false,
    }
}
pub(crate) fn collection_content_stamp(path: &Path) -> AppResult<Option<CollectionContentStamp>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    Ok(Some(CollectionContentStamp {
        len: metadata.len(),
        modified_nanos: metadata_modified_nanos(&metadata),
        content_signature: collection_content_signature(path, metadata.len())?,
    }))
}

pub(crate) fn metadata_modified_nanos(metadata: &fs::Metadata) -> u128 {
    metadata_time_nanos(metadata.modified().ok())
}

#[cfg(unix)]
pub(crate) fn metadata_changed_nanos(metadata: &fs::Metadata) -> u128 {
    use std::os::unix::fs::MetadataExt;

    let seconds = metadata.ctime();
    if seconds < 0 {
        return 0;
    }

    let nanos = metadata.ctime_nsec();
    if nanos < 0 {
        return seconds as u128 * 1_000_000_000;
    }

    seconds as u128 * 1_000_000_000 + nanos as u128
}

#[cfg(not(unix))]
pub(crate) fn metadata_changed_nanos(metadata: &fs::Metadata) -> u128 {
    metadata_time_nanos(metadata.accessed().ok())
}

fn metadata_time_nanos(time: Option<std::time::SystemTime>) -> u128 {
    time.and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn collection_sample_signature(path: &Path, len: u64) -> AppResult<u64> {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    len.hash(&mut hasher);

    if len == 0 {
        return Ok(hasher.finish());
    }

    let sample_len = len.min(COLLECTION_FAST_STAMP_SAMPLE_BYTES);
    let middle_offset = len.saturating_sub(sample_len) / 2;
    let end_offset = len.saturating_sub(sample_len);
    let mut offsets = HashSet::new();
    let mut buffer = vec![0_u8; sample_len as usize];
    let mut file = fs::File::open(path)?;

    for offset in [0, middle_offset, end_offset] {
        if !offsets.insert(offset) {
            continue;
        }

        file.seek(SeekFrom::Start(offset))?;
        let bytes_read = file.read(&mut buffer)?;
        offset.hash(&mut hasher);
        hasher.write(&buffer[..bytes_read]);
    }

    Ok(hasher.finish())
}

pub(crate) fn collection_content_signature(path: &Path, len: u64) -> AppResult<u64> {
    #[cfg(test)]
    if let Ok(mut hook) = CONTENT_SIGNATURE_TEST_HOOK.lock() {
        if let Some(hook) = hook.as_mut() {
            hook(path);
        }
    }

    let mut file = fs::File::open(path)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    len.hash(&mut hasher);
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.write(&buffer[..bytes_read]);
    }
    Ok(hasher.finish())
}
