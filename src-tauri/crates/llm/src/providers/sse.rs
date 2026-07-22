use crate::*;

pub(crate) fn take_sse_block(buffer: &mut String) -> Option<String> {
    let lf_boundary = buffer.find("\n\n").map(|index| (index, 2));
    let crlf_boundary = buffer.find("\r\n\r\n").map(|index| (index, 4));
    let (index, delimiter_len) = match (lf_boundary, crlf_boundary) {
        (Some(left), Some(right)) => {
            if left.0 <= right.0 {
                left
            } else {
                right
            }
        }
        (Some(boundary), None) | (None, Some(boundary)) => boundary,
        (None, None) => return None,
    };
    let block = buffer[..index].to_string();
    buffer.drain(..index + delimiter_len);
    Some(block)
}

pub(crate) fn ensure_sse_buffer_within_limit(buffer: &str) -> AppResult<()> {
    if buffer.len() > PROVIDER_RESPONSE_MAX_BYTES {
        return Err(AppError::new(
            "llm_stream_error",
            format!(
                "Provider stream buffered more than {PROVIDER_RESPONSE_MAX_BYTES} bytes without an SSE event boundary"
            ),
        ));
    }
    Ok(())
}

pub(crate) fn ensure_sse_stream_completed(completed: bool, message: &'static str) -> AppResult<()> {
    if completed {
        return Ok(());
    }
    Err(AppError::new("llm_stream_incomplete", message))
}

#[derive(Default)]
pub(crate) struct OpenAiToolCallAccumulator {
    calls: BTreeMap<u64, OpenAiToolCallParts>,
}

#[derive(Default)]
pub(crate) struct OpenAiToolCallParts {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
}

impl OpenAiToolCallAccumulator {
    pub(crate) fn ingest_delta(&mut self, delta: &Value) {
        let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) else {
            return;
        };
        for tool_call in tool_calls {
            let index = tool_call
                .get("index")
                .and_then(Value::as_u64)
                .unwrap_or(self.calls.len() as u64);
            let parts = self.calls.entry(index).or_default();
            if let Some(id) = tool_call
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            {
                parts.id = Some(id.to_string());
            }
            let Some(function) = tool_call.get("function").and_then(Value::as_object) else {
                continue;
            };
            if let Some(name) = function
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
            {
                parts.name.get_or_insert_with(String::new).push_str(name);
            }
            if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                parts.arguments.push_str(arguments);
            }
        }
    }

    pub(crate) fn into_tool_calls(self) -> Vec<Value> {
        self.calls
            .into_iter()
            .filter_map(|(index, parts)| {
                let name = parts.name.unwrap_or_default();
                if name.trim().is_empty() && parts.arguments.trim().is_empty() {
                    return None;
                }
                let arguments = if parts.arguments.trim().is_empty() {
                    "{}".to_string()
                } else {
                    parts.arguments
                };
                Some(json!({
                    "id": parts.id.unwrap_or_else(|| format!("call-{index}")),
                    "name": name.clone(),
                    "arguments": arguments.clone(),
                    "function": {
                        "name": name,
                        "arguments": arguments
                    }
                }))
            })
            .collect()
    }
}
