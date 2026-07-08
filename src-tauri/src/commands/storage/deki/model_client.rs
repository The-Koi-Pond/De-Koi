use marinara_core::{AppError, AppResult};
use serde_json::json;
use std::time::Duration;

#[derive(Debug, Clone)]
pub(super) struct DekiModelMessage {
    role: &'static str,
    content: String,
}

#[derive(Debug, Clone)]
pub(super) struct DekiModelClient {
    connection: marinara_llm::LlmConnection,
}

impl DekiModelMessage {
    pub(super) fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system",
            content: content.into(),
        }
    }

    pub(super) fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user",
            content: content.into(),
        }
    }

    pub(super) fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant",
            content: content.into(),
        }
    }
}

impl DekiModelClient {
    pub(super) fn new(connection: marinara_llm::LlmConnection) -> Self {
        Self { connection }
    }

    pub(super) async fn complete(
        &self,
        messages: &[DekiModelMessage],
        max_tokens: u64,
        timeout_for: Duration,
    ) -> AppResult<String> {
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
                    images: Vec::new(),
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
        let response = tokio::time::timeout(timeout_for, marinara_llm::complete_rich(request))
            .await
            .map_err(|_| {
                AppError::new(
                    "deki_model_timeout",
                    "Deki-senpai's selected model did not finish before the workspace time limit.",
                )
            })??;
        Ok(response.content)
    }
}
