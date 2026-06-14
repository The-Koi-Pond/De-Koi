use serde::Serialize;
use serde_json::Value;
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        code: impl Into<String>,
        message: impl Into<String>,
        details: impl Into<Value>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Some(details.into()),
        }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message)
    }

    pub fn io(error: std::io::Error) -> Self {
        Self::with_details("io_error", error.to_string(), error.kind().to_string())
    }
}

impl Display for AppError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::io(value)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::new("json_error", value.to_string())
    }
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn ensure_object(value: Value) -> AppResult<serde_json::Map<String, Value>> {
    match value {
        Value::Object(map) => Ok(map),
        Value::Null => Ok(serde_json::Map::new()),
        _ => Err(AppError::invalid_input("Expected a JSON object payload")),
    }
}
