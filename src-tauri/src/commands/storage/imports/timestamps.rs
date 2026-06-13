use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde_json::{json, Value};

fn local_datetime_to_rfc3339(value: NaiveDateTime) -> Option<String> {
    Local
        .from_local_datetime(&value)
        .earliest()
        .map(|time| time.with_timezone(&Utc).to_rfc3339())
}

fn utc_datetime_to_rfc3339(value: NaiveDateTime) -> String {
    Utc.from_utc_datetime(&value).to_rfc3339()
}

fn local_date_to_rfc3339(value: NaiveDate) -> Option<String> {
    local_datetime_to_rfc3339(value.and_hms_opt(0, 0, 0)?)
}

fn parse_common_date_string(raw: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(raw)
        .map(|time| time.with_timezone(&Utc).to_rfc3339())
        .ok()
        .or_else(|| {
            DateTime::parse_from_rfc2822(raw)
                .map(|time| time.with_timezone(&Utc).to_rfc3339())
                .ok()
        })
        .or_else(|| {
            for pattern in [
                "%Y-%m-%dT%H:%M:%S%.f",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%dT%H:%M",
                "%Y-%m-%d %H:%M:%S%.f",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d %H:%M",
                "%Y/%m/%d %H:%M:%S%.f",
                "%Y/%m/%d %H:%M:%S",
                "%Y/%m/%d %H:%M",
                "%B %d, %Y %H:%M:%S%.f",
                "%B %d, %Y %H:%M:%S",
                "%B %d, %Y %H:%M",
                "%b %d, %Y %H:%M:%S%.f",
                "%b %d, %Y %H:%M:%S",
                "%b %d, %Y %H:%M",
                "%B %d, %Y %I:%M:%S%.f%p",
                "%B %d, %Y %I:%M:%S%.f %p",
                "%B %d, %Y %I:%M%p",
                "%B %d, %Y %I:%M %p",
                "%b %d, %Y %I:%M:%S%.f%p",
                "%b %d, %Y %I:%M:%S%.f %p",
                "%b %d, %Y %I:%M%p",
                "%b %d, %Y %I:%M %p",
            ] {
                if let Ok(parsed) = NaiveDateTime::parse_from_str(raw, pattern) {
                    if let Some(timestamp) = local_datetime_to_rfc3339(parsed) {
                        return Some(timestamp);
                    }
                }
            }
            None
        })
        .or_else(|| {
            NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .ok()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(utc_datetime_to_rfc3339)
        })
        .or_else(|| {
            for pattern in ["%m/%d/%Y", "%B %d, %Y", "%b %d, %Y"] {
                if let Ok(parsed) = NaiveDate::parse_from_str(raw, pattern) {
                    if let Some(timestamp) = local_date_to_rfc3339(parsed) {
                        return Some(timestamp);
                    }
                }
            }
            None
        })
}

fn take_digits(bytes: &[u8], index: &mut usize, min: usize, max: usize) -> Option<u32> {
    let start = *index;
    while *index < bytes.len() && bytes[*index].is_ascii_digit() && *index - start < max {
        *index += 1;
    }
    if *index - start < min {
        return None;
    }
    std::str::from_utf8(&bytes[start..*index])
        .ok()?
        .parse()
        .ok()
}

fn skip_spaces(bytes: &[u8], index: &mut usize) {
    while *index < bytes.len() && bytes[*index].is_ascii_whitespace() {
        *index += 1;
    }
}

fn consume_case_insensitive(bytes: &[u8], index: &mut usize, value: u8) -> bool {
    if *index < bytes.len() && bytes[*index].eq_ignore_ascii_case(&value) {
        *index += 1;
        true
    } else {
        false
    }
}

fn parse_legacy_loose_timestamp(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut index = 0;
    let mut year = take_digits(bytes, &mut index, 1, 4)? as i32;
    if !matches!(bytes.get(index), Some(b'-' | b'/')) {
        return None;
    }
    index += 1;
    let month = take_digits(bytes, &mut index, 1, 2)?;
    if !matches!(bytes.get(index), Some(b'-' | b'/')) {
        return None;
    }
    index += 1;
    let day = take_digits(bytes, &mut index, 1, 2)?;
    skip_spaces(bytes, &mut index);
    consume_case_insensitive(bytes, &mut index, b'@');
    skip_spaces(bytes, &mut index);

    let hour = take_digits(bytes, &mut index, 1, 2)?;
    consume_case_insensitive(bytes, &mut index, b'h');
    skip_spaces(bytes, &mut index);
    let minute = take_digits(bytes, &mut index, 1, 2)?;
    consume_case_insensitive(bytes, &mut index, b'm');
    skip_spaces(bytes, &mut index);
    let second = take_digits(bytes, &mut index, 1, 2)?;
    consume_case_insensitive(bytes, &mut index, b's');
    skip_spaces(bytes, &mut index);
    let millisecond = if index < bytes.len() && bytes[index].is_ascii_digit() {
        let millisecond = take_digits(bytes, &mut index, 1, 3)?;
        consume_case_insensitive(bytes, &mut index, b'm');
        consume_case_insensitive(bytes, &mut index, b's');
        millisecond
    } else {
        0
    };
    skip_spaces(bytes, &mut index);
    if index != bytes.len() {
        return None;
    }

    if (0..=99).contains(&year) {
        year += 1900;
    }
    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    let parsed = date.and_hms_milli_opt(hour, minute, second, millisecond)?;
    local_datetime_to_rfc3339(parsed)
}

fn parse_trusted_timestamp(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Number(number) => {
            let raw = number.as_f64()?;
            if !raw.is_finite() {
                return None;
            }
            let millis = if raw < 1_000_000_000_000.0 {
                raw * 1000.0
            } else {
                raw
            };
            chrono::DateTime::<chrono::Utc>::from_timestamp_millis(millis.round() as i64)
                .map(|time| time.to_rfc3339())
        }
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return None;
            }
            if trimmed.chars().all(|ch| ch.is_ascii_digit()) && trimmed.len() >= 10 {
                if let Ok(number) = trimmed.parse::<f64>() {
                    let millis = if trimmed.len() <= 10 {
                        number * 1000.0
                    } else {
                        number
                    };
                    return chrono::DateTime::<chrono::Utc>::from_timestamp_millis(
                        millis.round() as i64
                    )
                    .map(|time| time.to_rfc3339());
                }
            }
            parse_common_date_string(trimmed).or_else(|| parse_legacy_loose_timestamp(trimmed))
        }
        _ => None,
    }
}

pub(super) fn timestamp_overrides_from_value(value: Option<&Value>) -> Option<(String, String)> {
    let value = value?;
    match value {
        Value::String(raw) => {
            if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                timestamp_overrides_from_value(Some(&parsed))
            } else {
                parse_trusted_timestamp(Some(value)).map(|timestamp| (timestamp.clone(), timestamp))
            }
        }
        Value::Object(object) => {
            let created = parse_trusted_timestamp(object.get("createdAt"));
            let updated = parse_trusted_timestamp(object.get("updatedAt"));
            match (created, updated) {
                (Some(created), Some(updated)) => Some((created, updated)),
                (Some(created), None) => Some((created.clone(), created)),
                (None, Some(updated)) => Some((updated.clone(), updated)),
                (None, None) => None,
            }
        }
        _ => parse_trusted_timestamp(Some(value)).map(|timestamp| (timestamp.clone(), timestamp)),
    }
}

fn timestamp_overrides_from_body_and_payload(
    body: &Value,
    payload: &Value,
) -> Option<(String, String)> {
    timestamp_overrides_from_value(
        body.get("timestampOverrides")
            .or_else(|| body.get("__timestampOverrides")),
    )
    .or_else(|| {
        let created = body.get("createdAt");
        let updated = body.get("updatedAt");
        timestamp_overrides_from_value(Some(&json!({
            "createdAt": created.cloned().unwrap_or(Value::Null),
            "updatedAt": updated.cloned().unwrap_or(Value::Null)
        })))
    })
    .or_else(|| {
        payload
            .get("metadata")
            .and_then(|metadata| metadata.get("timestamps"))
            .and_then(|timestamps| timestamp_overrides_from_value(Some(timestamps)))
    })
}

pub(super) fn apply_timestamp_overrides(record: &mut Value, body: &Value, payload: &Value) {
    let Some((created_at, updated_at)) = timestamp_overrides_from_body_and_payload(body, payload)
    else {
        return;
    };
    if let Some(object) = record.as_object_mut() {
        object.insert("createdAt".to_string(), Value::String(created_at));
        object.insert("updatedAt".to_string(), Value::String(updated_at));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_expected(
        year: i32,
        month: u32,
        day: u32,
        hour: u32,
        minute: u32,
        second: u32,
        millisecond: u32,
    ) -> String {
        let value = NaiveDate::from_ymd_opt(year, month, day)
            .and_then(|date| date.and_hms_milli_opt(hour, minute, second, millisecond))
            .expect("test timestamp should be valid");
        local_datetime_to_rfc3339(value).expect("test local timestamp should resolve")
    }

    #[test]
    fn rejects_invalid_timestamp_strings() {
        assert_eq!(
            timestamp_overrides_from_value(Some(&json!("definitely not a timestamp"))),
            None
        );
        assert_eq!(
            timestamp_overrides_from_value(Some(&json!({
                "createdAt": "nope",
                "updatedAt": "still nope"
            }))),
            None
        );
    }

    #[test]
    fn normalizes_rfc_and_numeric_timestamp_strings() {
        assert_eq!(
            timestamp_overrides_from_value(Some(&json!(1718282096000_i64))),
            Some((
                "2024-06-13T12:34:56+00:00".to_string(),
                "2024-06-13T12:34:56+00:00".to_string(),
            ))
        );
        assert_eq!(
            timestamp_overrides_from_value(Some(&json!("1718282096"))),
            Some((
                "2024-06-13T12:34:56+00:00".to_string(),
                "2024-06-13T12:34:56+00:00".to_string(),
            ))
        );
        assert_eq!(
            timestamp_overrides_from_value(Some(&json!("Thu, 13 Jun 2024 12:34:56 GMT"))),
            Some((
                "2024-06-13T12:34:56+00:00".to_string(),
                "2024-06-13T12:34:56+00:00".to_string(),
            ))
        );
    }

    #[test]
    fn normalizes_legacy_loose_timestamp_strings() {
        let expected = local_expected(2024, 6, 13, 12, 34, 56, 7);
        assert_eq!(
            timestamp_overrides_from_value(Some(&json!("2024-6-13 @ 12h34m56s 7ms"))),
            Some((expected.clone(), expected))
        );
    }

    #[test]
    fn normalizes_legacy_new_date_timestamp_strings() {
        for (raw, expected) in [
            (
                "2024-06-13T12:34:56",
                local_expected(2024, 6, 13, 12, 34, 56, 0),
            ),
            (
                "2024-06-13 12:34:56.789",
                local_expected(2024, 6, 13, 12, 34, 56, 789),
            ),
            ("June 13, 2024", local_expected(2024, 6, 13, 0, 0, 0, 0)),
            ("06/13/2024", local_expected(2024, 6, 13, 0, 0, 0, 0)),
        ] {
            assert_eq!(
                timestamp_overrides_from_value(Some(&json!(raw))),
                Some((expected.clone(), expected)),
                "{raw} should match legacy Date parsing"
            );
        }
    }

    #[test]
    fn ignores_invalid_object_side_and_copies_valid_side() {
        assert_eq!(
            timestamp_overrides_from_value(Some(&json!({
                "createdAt": "invalid",
                "updatedAt": "2024-06-13T12:34:56Z"
            }))),
            Some((
                "2024-06-13T12:34:56+00:00".to_string(),
                "2024-06-13T12:34:56+00:00".to_string(),
            ))
        );
    }
}
