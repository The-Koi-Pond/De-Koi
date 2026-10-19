use super::status::DekiRuntimeCancellation;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone)]
pub(super) struct DekiModelMessage {
    role: &'static str,
    content: String,
    /// Image data URLs sent with this message.
    images: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct DekiModelClient {
    connection: marinara_llm::LlmConnection,
}

#[derive(Debug)]
pub(super) struct DekiModelResponse {
    pub(super) content: String,
    pub(super) usage: Option<serde_json::Value>,
}

impl DekiModelMessage {
    pub(super) fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system",
            content: content.into(),
            images: Vec::new(),
        }
    }

    pub(super) fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user",
            content: content.into(),
            images: Vec::new(),
        }
    }

    pub(super) fn with_images(mut self, images: Vec<String>) -> Self {
        self.images = images;
        self
    }

    pub(super) fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant",
            content: content.into(),
            images: Vec::new(),
        }
    }
}

impl DekiModelClient {
    pub(super) fn new(connection: marinara_llm::LlmConnection) -> Self {
        Self { connection }
    }

    /// Runs one model call as a stream, handing each piece of text to
    /// `on_text` as it arrives, and returns the whole reply.
    pub(super) async fn complete(
        &self,
        messages: &[DekiModelMessage],
        max_tokens: u64,
        timeout_for: Duration,
        cancellation: &DekiRuntimeCancellation,
        mut on_text: impl FnMut(&str) + Send,
    ) -> AppResult<DekiModelResponse> {
        let timeout_for = if timeout_for.is_zero() {
            Duration::from_millis(1)
        } else {
            timeout_for
        };
        let request = marinara_llm::LlmRequest {
            connection: self.connection.clone(),
            messages: messages
                .iter()
                .map(|message| marinara_llm::LlmMessage {
                    role: message.role.to_string(),
                    content: message.content.clone(),
                    name: None,
                    images: message.images.clone(),
                    tool_call_id: None,
                    tool_calls: None,
                    provider_metadata: None,
                })
                .collect(),
            parameters: json!({
                "temperature": 0.35,
                "maxTokens": max_tokens,
                "responseFormat": "json_object",
            }),
            tools: Vec::new(),
        };
        let mut content = String::new();
        let mut usage = None;
        {
            let stream = marinara_llm::stream_events(request, |event| {
                match event.get("type").and_then(Value::as_str) {
                    Some("token") => {
                        if let Some(text) = event.get("text").and_then(Value::as_str) {
                            content.push_str(text);
                            on_text(text);
                        }
                    }
                    Some("usage") => usage = event.get("data").cloned(),
                    _ => {}
                }
                Ok(())
            });
            let completion = tokio::time::timeout(timeout_for, stream);
            tokio::select! {
                result = completion => result.map_err(|_| {
                        AppError::new(
                            "deki_model_timeout",
                            "Deki-senpai's selected model did not finish before the workspace time limit.",
                        )
                    })??,
                _ = cancellation.cancelled() => {
                    return Err(AppError::new(
                        "deki_workspace_aborted",
                        "Deki-senpai's workspace run was cancelled.",
                    ));
                }
            };
        }
        Ok(DekiModelResponse { content, usage })
    }
}
