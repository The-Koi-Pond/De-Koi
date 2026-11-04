use marinara_core::AppResult;
use serde_json::{json, Value};

pub fn call_integration(_integration: &str, _operation: &str, _payload: Value) -> AppResult<Value> {
    Ok(json!({ "ok": false }))
}
