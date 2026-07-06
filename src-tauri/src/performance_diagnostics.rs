use serde_json::{json, Map, Value};
use std::env;
use std::time::Instant;

const ENABLED_VALUES: [&str; 4] = ["1", "true", "yes", "on"];

pub(crate) fn enabled_env_flag_value(value: Option<&str>) -> bool {
    value
        .map(|item| item.trim().to_ascii_lowercase())
        .is_some_and(|item| ENABLED_VALUES.contains(&item.as_str()))
}

pub(crate) fn performance_diagnostics_enabled() -> bool {
    enabled_env_flag_value(env::var("DE_KOI_PERFORMANCE_DIAGNOSTICS").ok().as_deref())
        || enabled_env_flag_value(env::var("MARINARA_PERFORMANCE_DIAGNOSTICS").ok().as_deref())
}

pub(crate) fn approx_json_bytes(value: &Value) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or_default()
}

pub(crate) fn log_span(
    category: &str,
    name: &str,
    started_at: Instant,
    status: &str,
    fields: Map<String, Value>,
) {
    if !performance_diagnostics_enabled() {
        return;
    }
    let mut payload = fields;
    payload.insert("category".to_string(), json!(category));
    payload.insert("name".to_string(), json!(name));
    payload.insert("status".to_string(), json!(status));
    payload.insert(
        "elapsedMs".to_string(),
        json!(started_at.elapsed().as_secs_f64() * 1000.0),
    );
    println!("[de-koi:perf] span {}", Value::Object(payload));
}

#[cfg(test)]
mod tests {
    use super::{approx_json_bytes, enabled_env_flag_value};
    use serde_json::json;

    #[test]
    fn env_flag_values_are_explicit_opt_in() {
        assert!(enabled_env_flag_value(Some("1")));
        assert!(enabled_env_flag_value(Some("true")));
        assert!(enabled_env_flag_value(Some("YES")));
        assert!(enabled_env_flag_value(Some("on")));
        assert!(!enabled_env_flag_value(None));
        assert!(!enabled_env_flag_value(Some("")));
        assert!(!enabled_env_flag_value(Some("0")));
        assert!(!enabled_env_flag_value(Some("false")));
    }

    #[test]
    fn json_byte_estimates_are_based_on_serialized_shape() {
        let value = json!({ "id": "row-1", "count": 2 });

        assert_eq!(
            approx_json_bytes(&value),
            serde_json::to_vec(&value)
                .expect("test JSON should serialize")
                .len()
        );
    }
}
