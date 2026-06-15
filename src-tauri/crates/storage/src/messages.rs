use crate::projection::{project_nested_value, selected_child_paths, ProjectedNestedSeed};
use marinara_core::{AppError, AppResult};
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::io::{BufRead, BufReader, Cursor, Read, Seek, SeekFrom};
use std::path::Path;

const MESSAGE_REVERSE_READ_CHUNK_SIZE: u64 = 1024 * 1024;

pub(crate) struct MessageRowsForChatVisitor<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> Visitor<'de> for MessageRowsForChatVisitor<'a> {
    type Value = Vec<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a messages JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut rows = Vec::new();
        while let Some(row) = seq.next_element_seed(MessageRowForChatSeed {
            chat_id: self.chat_id,
        })? {
            if let Some(row) = row {
                rows.push(row);
            }
        }
        Ok(rows)
    }
}

pub(crate) struct MessageRowForChatSeed<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> DeserializeSeed<'de> for MessageRowForChatSeed<'a> {
    type Value = Option<Value>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(MessageRowForChatVisitor {
            chat_id: self.chat_id,
        })
    }
}

pub(crate) struct MessageRowForChatVisitor<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> Visitor<'de> for MessageRowForChatVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a message object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut object = Map::new();
        let mut matches_chat = None;
        while let Some(key) = map.next_key::<String>()? {
            if matches_chat == Some(false) {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
                continue;
            }

            let value = map.next_value::<Value>()?;
            if key == "chatId" {
                let is_match = value.as_str() == Some(self.chat_id);
                matches_chat = Some(is_match);
                if !is_match {
                    object.clear();
                    continue;
                }
            }
            object.insert(key, value);
        }

        Ok(matches_chat
            .unwrap_or(false)
            .then_some(Value::Object(object)))
    }
}

pub(crate) struct ProjectedMessageRowsForChatVisitor<'a> {
    pub(crate) chat_id: &'a str,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> Visitor<'de> for ProjectedMessageRowsForChatVisitor<'a> {
    type Value = Vec<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a messages JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut rows = Vec::new();
        while let Some(row) = seq.next_element_seed(ProjectedMessageRowForChatSeed {
            chat_id: self.chat_id,
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

pub(crate) struct ProjectedMessageRowForChatSeed<'a> {
    pub(crate) chat_id: &'a str,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> DeserializeSeed<'de> for ProjectedMessageRowForChatSeed<'a> {
    type Value = Option<Value>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(ProjectedMessageRowForChatVisitor {
            chat_id: self.chat_id,
            fields: self.fields,
            field_selections: self.field_selections,
        })
    }
}

pub(crate) struct ProjectedMessageRowForChatVisitor<'a> {
    pub(crate) chat_id: &'a str,
    pub(crate) fields: &'a HashSet<String>,
    pub(crate) field_selections: &'a HashMap<String, HashSet<String>>,
}

impl<'de, 'a> Visitor<'de> for ProjectedMessageRowForChatVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a message object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut object = Map::new();
        let mut matches_chat = None;
        while let Some(key) = map.next_key::<String>()? {
            if key == "chatId" {
                let value = map.next_value::<Value>()?;
                matches_chat = Some(value.as_str() == Some(self.chat_id));
                if matches_chat == Some(true) && self.fields.contains(&key) {
                    object.insert(key, value);
                }
                continue;
            }

            if matches_chat == Some(false) {
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

        Ok(matches_chat
            .unwrap_or(false)
            .then_some(Value::Object(object)))
    }
}

pub(crate) struct MessageIdRowsForChatVisitor<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> Visitor<'de> for MessageIdRowsForChatVisitor<'a> {
    type Value = Vec<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a messages JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut rows = Vec::new();
        while let Some(row) = seq.next_element_seed(MessageIdRowForChatSeed {
            chat_id: self.chat_id,
        })? {
            if let Some(row) = row {
                rows.push(row);
            }
        }
        Ok(rows)
    }
}

pub(crate) struct MessageIdRowForChatSeed<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> DeserializeSeed<'de> for MessageIdRowForChatSeed<'a> {
    type Value = Option<Value>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(MessageIdRowForChatVisitor {
            chat_id: self.chat_id,
        })
    }
}

pub(crate) struct MessageIdRowForChatVisitor<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> Visitor<'de> for MessageIdRowForChatVisitor<'a> {
    type Value = Option<Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a message object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut id = None;
        let mut matches_chat = None;
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "id" => {
                    id = Some(map.next_value::<Value>()?);
                }
                "chatId" => {
                    let value = map.next_value::<Value>()?;
                    matches_chat = Some(value.as_str() == Some(self.chat_id));
                }
                _ => {
                    let _ = map.next_value::<serde::de::IgnoredAny>()?;
                }
            }
        }

        if matches_chat != Some(true) {
            return Ok(None);
        }

        let mut object = Map::new();
        if let Some(id) = id {
            object.insert("id".to_string(), id);
        }
        Ok(Some(Value::Object(object)))
    }
}

pub(crate) struct MessageCountForChatVisitor<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> Visitor<'de> for MessageCountForChatVisitor<'a> {
    type Value = usize;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a messages JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut count = 0;
        while let Some(matches_chat) = seq.next_element_seed(MessageCountForChatSeed {
            chat_id: self.chat_id,
        })? {
            if matches_chat {
                count += 1;
            }
        }
        Ok(count)
    }
}

pub(crate) struct MessageCountForChatSeed<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> DeserializeSeed<'de> for MessageCountForChatSeed<'a> {
    type Value = bool;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(MessageCountForChatRowVisitor {
            chat_id: self.chat_id,
        })
    }
}

pub(crate) struct MessageCountForChatRowVisitor<'a> {
    pub(crate) chat_id: &'a str,
}

impl<'de, 'a> Visitor<'de> for MessageCountForChatRowVisitor<'a> {
    type Value = bool;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a message object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut matches_chat = false;
        while let Some(key) = map.next_key::<String>()? {
            if key == "chatId" {
                let value = map.next_value::<Value>()?;
                matches_chat = value.as_str() == Some(self.chat_id);
            } else {
                let _ = map.next_value::<serde::de::IgnoredAny>()?;
            }
        }
        Ok(matches_chat)
    }
}

pub(crate) fn count_pretty_messages_for_chat(
    path: &Path,
    chat_id: &str,
) -> AppResult<Option<usize>> {
    let encoded_chat_id = serde_json::to_string(chat_id)?;
    let pretty_field = format!("\"chatId\": {encoded_chat_id}");
    let compact_field = format!("\"chatId\":{encoded_chat_id}");
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut saw_chat_id_field = false;
    let mut count = 0;

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim_start();
        if !trimmed.starts_with("\"chatId\"") {
            continue;
        }
        saw_chat_id_field = true;
        if trimmed.starts_with(&pretty_field) || trimmed.starts_with(&compact_field) {
            count += 1;
        }
    }

    Ok(saw_chat_id_field.then_some(count))
}

pub(crate) fn is_pretty_top_level_record_end(line: &str) -> bool {
    line.starts_with("  }") && matches!(line.trim(), "}" | "},")
}

pub(crate) fn read_pretty_message_page_from_file(
    path: &Path,
    chat_id: &str,
    limit: usize,
    before: Option<&str>,
) -> AppResult<Option<Vec<Value>>> {
    let mut file = fs::File::open(path)?;
    let mut position = file.metadata()?.len();
    let before_cursor = before.map(parse_storage_message_cursor);
    let mut rows_newest_first = Vec::new();
    let mut record_lines_newest_first: Vec<Vec<u8>> = Vec::new();
    let mut in_record = false;
    let mut saw_record = false;

    let mut carry = Vec::new();
    while position > 0 {
        let read_len = position.min(MESSAGE_REVERSE_READ_CHUNK_SIZE) as usize;
        position -= read_len as u64;

        let mut block = vec![0_u8; read_len];
        file.seek(SeekFrom::Start(position))?;
        file.read_exact(&mut block)?;
        block.extend_from_slice(&carry);

        let mut line_ranges = Vec::new();
        let mut line_start = 0;
        for (index, byte) in block.iter().enumerate() {
            if *byte == b'\n' {
                line_ranges.push(line_start..index);
                line_start = index + 1;
            }
        }
        line_ranges.push(line_start..block.len());

        let first_line_is_partial = position > 0;
        for line_index in (0..line_ranges.len()).rev() {
            if first_line_is_partial && line_index == 0 {
                continue;
            }
            let line = &block[line_ranges[line_index].clone()];
            if !in_record {
                if is_top_level_message_record_end(line) {
                    saw_record = true;
                    in_record = true;
                    record_lines_newest_first.clear();
                    record_lines_newest_first.push(line.to_vec());
                }
                continue;
            }

            record_lines_newest_first.push(line.to_vec());
            if !is_top_level_message_record_start(line) {
                continue;
            }

            let mut record_bytes = join_reverse_lines(&record_lines_newest_first);
            strip_trailing_json_comma(&mut record_bytes);
            let row: Value = serde_json::from_slice(&record_bytes)?;
            if row.get("chatId").and_then(Value::as_str) == Some(chat_id)
                && message_is_before_cursor(&row, before_cursor.as_ref())
            {
                rows_newest_first.push(row);
                if rows_newest_first.len() >= limit {
                    rows_newest_first.reverse();
                    return Ok(Some(rows_newest_first));
                }
            }

            in_record = false;
            record_lines_newest_first.clear();
        }

        carry = if first_line_is_partial {
            block[line_ranges[0].clone()].to_vec()
        } else {
            Vec::new()
        };
    }

    if in_record || !saw_record {
        return Ok(None);
    }

    rows_newest_first.reverse();
    Ok(Some(rows_newest_first))
}

pub(crate) fn read_pretty_projected_message_page_from_file(
    path: &Path,
    chat_id: &str,
    limit: usize,
    before: Option<&str>,
    fields: &HashSet<String>,
    field_selections: &HashMap<String, HashSet<String>>,
) -> AppResult<Option<Vec<Value>>> {
    let mut file = fs::File::open(path)?;
    let mut position = file.metadata()?.len();
    let before_cursor = before.map(parse_storage_message_cursor);
    let mut rows_newest_first = Vec::new();
    let mut record_lines_newest_first: Vec<Vec<u8>> = Vec::new();
    let mut in_record = false;
    let mut saw_record = false;

    let mut carry = Vec::new();
    while position > 0 {
        let read_len = position.min(MESSAGE_REVERSE_READ_CHUNK_SIZE) as usize;
        position -= read_len as u64;

        let mut block = vec![0_u8; read_len];
        file.seek(SeekFrom::Start(position))?;
        file.read_exact(&mut block)?;
        block.extend_from_slice(&carry);

        let mut line_ranges = Vec::new();
        let mut line_start = 0;
        for (index, byte) in block.iter().enumerate() {
            if *byte == b'\n' {
                line_ranges.push(line_start..index);
                line_start = index + 1;
            }
        }
        line_ranges.push(line_start..block.len());

        let first_line_is_partial = position > 0;
        for line_index in (0..line_ranges.len()).rev() {
            if first_line_is_partial && line_index == 0 {
                continue;
            }
            let line = &block[line_ranges[line_index].clone()];
            if !in_record {
                if is_top_level_message_record_end(line) {
                    saw_record = true;
                    in_record = true;
                    record_lines_newest_first.clear();
                    record_lines_newest_first.push(line.to_vec());
                }
                continue;
            }

            record_lines_newest_first.push(line.to_vec());
            if !is_top_level_message_record_start(line) {
                continue;
            }

            let mut record_bytes = join_reverse_lines(&record_lines_newest_first);
            strip_trailing_json_comma(&mut record_bytes);
            if let Some((row, created_at, id)) = read_projected_pretty_message_record(
                &record_bytes,
                chat_id,
                fields,
                field_selections,
            )? {
                if message_parts_are_before_cursor(&created_at, &id, before_cursor.as_ref()) {
                    rows_newest_first.push(row);
                    if rows_newest_first.len() >= limit {
                        rows_newest_first.reverse();
                        return Ok(Some(rows_newest_first));
                    }
                }
            }

            in_record = false;
            record_lines_newest_first.clear();
        }

        carry = if first_line_is_partial {
            block[line_ranges[0].clone()].to_vec()
        } else {
            Vec::new()
        };
    }

    if in_record || !saw_record {
        return Ok(None);
    }

    rows_newest_first.reverse();
    Ok(Some(rows_newest_first))
}

pub(crate) fn read_projected_pretty_message_record(
    record_bytes: &[u8],
    chat_id: &str,
    fields: &HashSet<String>,
    field_selections: &HashMap<String, HashSet<String>>,
) -> AppResult<Option<(Value, String, String)>> {
    let mut reader = BufReader::new(Cursor::new(record_bytes));
    let mut in_record = false;
    let mut matches_chat = None;
    let mut projected = Map::new();
    let mut id = String::new();
    let mut created_at = String::new();

    while let Some(line) = read_json_line(&mut reader)? {
        let trimmed = line.trim_start();

        if !in_record {
            if trimmed.starts_with('{') {
                in_record = true;
                continue;
            }
            if trimmed.trim().is_empty() {
                continue;
            }
            return Ok(None);
        }

        if is_pretty_top_level_record_end(&line) {
            return Ok(matches_chat.unwrap_or(false).then_some((
                Value::Object(projected),
                created_at,
                id,
            )));
        }

        let Some((field, value_start)) = pretty_json_field(&line, 4)? else {
            continue;
        };

        match field.as_str() {
            "chatId" => {
                let value = read_pretty_json_value(&mut reader, value_start)?;
                matches_chat = Some(value.as_str() == Some(chat_id));
                if matches_chat == Some(true) && fields.contains(&field) {
                    projected.insert(field, value);
                } else if matches_chat == Some(false) {
                    projected.clear();
                }
            }
            "id" => {
                let value = read_pretty_json_value(&mut reader, value_start)?;
                id = value.as_str().unwrap_or_default().to_string();
                if matches_chat != Some(false) && fields.contains(&field) {
                    projected.insert(field, value);
                }
            }
            "createdAt" => {
                let value = read_pretty_json_value(&mut reader, value_start)?;
                created_at = value.as_str().unwrap_or_default().to_string();
                if matches_chat != Some(false) && fields.contains(&field) {
                    projected.insert(field, value);
                }
            }
            _ if matches_chat == Some(false) => {
                skip_pretty_json_value(&mut reader, value_start)?;
            }
            _ if fields.contains(&field) => {
                let value = if let Some(nested_fields) = field_selections.get(&field) {
                    read_pretty_projected_nested_value(&mut reader, value_start, nested_fields, 6)?
                } else {
                    read_pretty_json_value(&mut reader, value_start)?
                };
                projected.insert(field, value);
            }
            _ => {
                skip_pretty_json_value(&mut reader, value_start)?;
            }
        }
    }

    Ok(None)
}

pub(crate) fn join_reverse_lines(lines_newest_first: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for line in lines_newest_first.iter().rev() {
        if !bytes.is_empty() {
            bytes.push(b'\n');
        }
        bytes.extend_from_slice(line);
    }
    bytes
}

pub(crate) fn is_top_level_message_record_start(line: &[u8]) -> bool {
    trim_ascii_end(line) == b"  {"
}

pub(crate) fn is_top_level_message_record_end(line: &[u8]) -> bool {
    matches!(trim_ascii_end(line), b"  }" | b"  },")
}

pub(crate) fn trim_ascii_end(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    &bytes[..end]
}

pub(crate) fn strip_trailing_json_comma(bytes: &mut Vec<u8>) {
    while bytes.last().is_some_and(u8::is_ascii_whitespace) {
        bytes.pop();
    }
    if bytes.last() == Some(&b',') {
        bytes.pop();
    }
}

pub(crate) fn read_pretty_record_by_id_from_file(
    path: &Path,
    id: &str,
) -> AppResult<Option<Value>> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut record_lines: Vec<String> = Vec::new();
    let mut in_record = false;
    let mut saw_array_start = false;
    let mut saw_record = false;
    let expected_id_line = format!("\"id\": {}", serde_json::to_string(id)?);

    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let line = line.trim_end_matches('\n').to_string();
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
                record_lines.clear();
                record_lines.push(line);
                continue;
            }
            return Ok(None);
        }

        let is_id_line =
            trimmed.strip_suffix(',').unwrap_or(trimmed).trim_end() == expected_id_line;
        record_lines.push(line);
        if is_id_line {
            loop {
                let mut next_line = String::new();
                let bytes = reader.read_line(&mut next_line)?;
                if bytes == 0 {
                    return Ok(None);
                }
                let next_line = next_line.trim_end_matches('\n').to_string();
                let is_end = is_pretty_top_level_record_end(&next_line);
                record_lines.push(next_line);
                if is_end {
                    let mut raw = record_lines.join("\n").into_bytes();
                    strip_trailing_json_comma(&mut raw);
                    let row: Value = serde_json::from_slice(&raw)?;
                    if row.get("id").and_then(Value::as_str) == Some(id) {
                        return Ok(Some(row));
                    }
                    in_record = false;
                    record_lines.clear();
                    break;
                }
            }
        }

        if is_pretty_top_level_record_end(
            record_lines.last().map(String::as_str).unwrap_or_default(),
        ) {
            in_record = false;
            record_lines.clear();
        }
    }

    if !saw_array_start || in_record || !saw_record {
        return Ok(None);
    }
    Ok(None)
}

pub(crate) fn read_pretty_projected_record_by_id_from_file(
    path: &Path,
    id: &str,
    fields: &HashSet<String>,
    field_selections: &HashMap<String, HashSet<String>>,
) -> AppResult<Option<Value>> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    read_pretty_projected_record_by_id_from_reader(reader, id, fields, field_selections)
}

pub(crate) fn read_pretty_projected_record_by_id_from_reader<R: BufRead>(
    mut reader: R,
    id: &str,
    fields: &HashSet<String>,
    field_selections: &HashMap<String, HashSet<String>>,
) -> AppResult<Option<Value>> {
    let mut in_record = false;
    let mut saw_array_start = false;
    let mut saw_record = false;
    let mut matches_id = None;
    let mut projected = Map::new();

    while let Some(line) = read_json_line(&mut reader)? {
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
                matches_id = None;
                projected.clear();
                continue;
            }
            return Ok(None);
        }

        if is_pretty_top_level_record_end(&line) {
            if matches_id == Some(true) {
                return Ok(Some(Value::Object(projected)));
            }
            in_record = false;
            matches_id = None;
            projected.clear();
            continue;
        }

        let Some((field, value_start)) = pretty_json_field(&line, 4)? else {
            continue;
        };

        if field == "id" {
            let value = read_pretty_json_value(&mut reader, value_start)?;
            let is_match = value.as_str() == Some(id);
            matches_id = Some(is_match);
            if is_match {
                if fields.contains(&field) {
                    projected.insert(field, value);
                }
            } else {
                projected.clear();
            }
            continue;
        }

        if matches_id == Some(false) {
            skip_pretty_json_value(&mut reader, value_start)?;
            continue;
        }

        if fields.contains(&field) {
            let value = if let Some(nested_fields) = field_selections.get(&field) {
                read_pretty_projected_nested_value(&mut reader, value_start, nested_fields, 6)?
            } else {
                read_pretty_json_value(&mut reader, value_start)?
            };
            projected.insert(field, value);
        } else {
            skip_pretty_json_value(&mut reader, value_start)?;
        }
    }

    if !saw_array_start || in_record || !saw_record {
        return Ok(None);
    }
    Ok(None)
}

pub(crate) fn read_pretty_projected_nested_value<R: BufRead>(
    reader: &mut R,
    first_value: String,
    fields: &HashSet<String>,
    field_indent: usize,
) -> AppResult<Value> {
    let trimmed = first_value.trim();
    if !trimmed.starts_with('{') || json_container_depth_delta(trimmed) <= 0 {
        return read_pretty_json_value(reader, first_value)
            .map(|value| project_nested_value(value, fields));
    }

    let end_indent = field_indent.saturating_sub(2);
    let mut projected = Map::new();
    while let Some(line) = read_json_line(reader)? {
        if is_pretty_object_end(&line, end_indent) {
            return Ok(Value::Object(projected));
        }

        let Some((field, value_start)) = pretty_json_field(&line, field_indent)? else {
            continue;
        };
        if fields.contains(&field) {
            let value = read_pretty_json_value(reader, value_start)?;
            projected.insert(field, value);
        } else if let Some(child_fields) = selected_child_paths(fields, &field) {
            let value = read_pretty_projected_nested_value(
                reader,
                value_start,
                &child_fields,
                field_indent + 2,
            )?;
            if !value.as_object().is_some_and(Map::is_empty) {
                projected.insert(field, value);
            }
        } else {
            skip_pretty_json_value(reader, value_start)?;
        }
    }

    Err(AppError::invalid_input(
        "Projected pretty JSON object ended unexpectedly",
    ))
}

pub(crate) fn read_pretty_json_value<R: BufRead>(
    reader: &mut R,
    first_value: String,
) -> AppResult<Value> {
    let mut lines = vec![first_value];
    let mut depth = json_container_depth_delta(lines[0].trim());
    while depth > 0 {
        let Some(line) = read_json_line(reader)? else {
            return Err(AppError::invalid_input(
                "Pretty JSON value ended unexpectedly",
            ));
        };
        depth += json_container_depth_delta(line.trim());
        lines.push(line);
    }
    parse_pretty_json_value(lines)
}

pub(crate) fn skip_pretty_json_value<R: BufRead>(
    reader: &mut R,
    first_value: String,
) -> AppResult<()> {
    let mut depth = json_container_depth_delta(first_value.trim());
    while depth > 0 {
        let Some(line) = read_json_line(reader)? else {
            return Err(AppError::invalid_input(
                "Pretty JSON value ended unexpectedly",
            ));
        };
        depth += json_container_depth_delta(line.trim());
    }
    Ok(())
}

pub(crate) fn parse_pretty_json_value(lines: Vec<String>) -> AppResult<Value> {
    let mut raw = lines.join("\n").into_bytes();
    strip_trailing_json_comma(&mut raw);
    Ok(serde_json::from_slice(&raw)?)
}

pub(crate) fn pretty_json_field(line: &str, indent: usize) -> AppResult<Option<(String, String)>> {
    if line.len() <= indent || !line.starts_with(&" ".repeat(indent)) {
        return Ok(None);
    }
    if line
        .as_bytes()
        .get(indent)
        .is_some_and(u8::is_ascii_whitespace)
    {
        return Ok(None);
    }
    let trimmed = line.trim_start();
    if !trimmed.starts_with('"') {
        return Ok(None);
    }
    let Some((raw_key, raw_value)) = trimmed.split_once(':') else {
        return Ok(None);
    };
    let key = serde_json::from_str::<String>(raw_key)?;
    Ok(Some((key, raw_value.trim_start().to_string())))
}

pub(crate) fn is_pretty_object_end(line: &str, indent: usize) -> bool {
    let bytes = line.as_bytes();
    let value_index = indent;
    let suffix_index = value_index + 1;
    bytes
        .get(..indent)
        .is_some_and(|prefix| prefix.iter().all(|byte| *byte == b' '))
        && bytes.get(value_index) == Some(&b'}')
        && matches!(bytes.get(suffix_index), None | Some(b','))
        && matches!(line.trim(), "}" | "},")
}

pub(crate) fn read_json_line<R: BufRead>(reader: &mut R) -> AppResult<Option<String>> {
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    Ok(Some(line.trim_end_matches(['\r', '\n']).to_string()))
}

pub(crate) fn json_container_depth_delta(value: &str) -> i32 {
    let mut depth = 0;
    let mut in_string = false;
    let mut escaped = false;
    for byte in value.bytes() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match byte {
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth -= 1,
            _ => {}
        }
    }
    depth
}

pub(crate) fn parse_storage_message_cursor(cursor: &str) -> (String, Option<String>) {
    let mut parts = cursor.splitn(2, '|');
    let created_at = parts.next().unwrap_or_default().to_string();
    let id = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    (created_at, id)
}

pub(crate) fn message_is_before_cursor(
    row: &Value,
    before: Option<&(String, Option<String>)>,
) -> bool {
    let created_at = row.get("createdAt").and_then(Value::as_str).unwrap_or("");
    let id = row.get("id").and_then(Value::as_str).unwrap_or("");
    message_parts_are_before_cursor(created_at, id, before)
}

pub(crate) fn message_parts_are_before_cursor(
    created_at: &str,
    id: &str,
    before: Option<&(String, Option<String>)>,
) -> bool {
    let Some((before_created_at, before_id)) = before else {
        return true;
    };
    created_at < before_created_at.as_str()
        || (created_at == before_created_at.as_str()
            && before_id.as_deref().is_some_and(|cursor_id| id < cursor_id))
}

pub(crate) fn apply_message_page(rows: &mut Vec<Value>, limit: usize, before: Option<&str>) {
    rows.sort_by(|a, b| {
        let a_created_at = a.get("createdAt").and_then(Value::as_str).unwrap_or("");
        let b_created_at = b.get("createdAt").and_then(Value::as_str).unwrap_or("");
        let a_id = a.get("id").and_then(Value::as_str).unwrap_or("");
        let b_id = b.get("id").and_then(Value::as_str).unwrap_or("");
        a_created_at.cmp(b_created_at).then_with(|| a_id.cmp(b_id))
    });

    let before_cursor = before.map(parse_storage_message_cursor);
    if before_cursor.is_some() {
        rows.retain(|row| message_is_before_cursor(row, before_cursor.as_ref()));
    }
    if rows.len() > limit {
        let keep_from = rows.len() - limit;
        rows.drain(0..keep_from);
    }
}
