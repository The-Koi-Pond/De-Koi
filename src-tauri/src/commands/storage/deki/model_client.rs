use super::status::DekiRuntimeCancellation;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::time::Duration;

/// Reasoning effort for every Deki model call. On Claude Subscription with Opus 5.5,
/// medium answered Deki's codebase questions as well as leaving it unset (judge 9.1 vs
/// 9.0 of 10 on a fixed task set) in about three quarters of the time. Providers without
/// an effort setting ignore it.
const DEKI_REASONING_EFFORT: &str = "medium";

#[derive(Debug, Clone)]
pub(super) struct DekiModelMessage {
    role: &'static str,
    content: String,
    /// Image data URLs sent with this message.
    images: Vec<String>,
}

#[derive(Debug, Clone)]
/// Streamed model output: more reply text, or a restart that throws away the
/// text so far because the provider started the reply over.
pub(super) enum DekiModelText<'a> {
    Delta(&'a str),
    Restart,
}

pub(super) struct DekiModelClient {
    connection: marinara_llm::LlmConnection,
}

#[derive(Debug)]
pub(super) struct DekiModelResponse {
    pub(super) content: String,
    pub(super) usage: Option<serde_json::Value>,
    /// The caller stopped the reply before the model finished it.
    pub(super) cut_short: bool,
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

    #[cfg(test)]
    pub(super) fn role(&self) -> &str {
        self.role
    }

    #[cfg(test)]
    pub(super) fn content(&self) -> &str {
        &self.content
    }

    #[cfg(test)]
    pub(super) fn images(&self) -> &[String] {
        &self.images
    }
}

impl DekiModelClient {
    pub(super) fn new(connection: marinara_llm::LlmConnection) -> Self {
        Self { connection }
    }

    /// Runs one model call as a stream, handing each piece of text to
    /// `on_text` as it arrives, and returns the whole reply. When the provider
    /// starts the reply over, `on_text` gets a restart and the text before it
    /// is not part of the returned reply. When `on_text` returns false the call
    /// is stopped there and the reply so far comes back with `cut_short` set.
    pub(super) async fn complete(
        &self,
        messages: &[DekiModelMessage],
        max_tokens: u64,
        timeout_for: Duration,
        cancellation: &DekiRuntimeCancellation,
        mut on_text: impl FnMut(DekiModelText<'_>) -> bool + Send,
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
                "reasoningEffort": DEKI_REASONING_EFFORT,
            }),
            tools: Vec::new(),
        };
        let mut content = String::new();
        let mut usage = None;
        let mut cut_short = false;
        let outcome = {
            let stream = marinara_llm::stream_events_with_restarts(request, |event| {
                let keep_going = match event.get("type").and_then(Value::as_str) {
                    Some("token") => match event.get("text").and_then(Value::as_str) {
                        Some(text) => {
                            content.push_str(text);
                            on_text(DekiModelText::Delta(text))
                        }
                        None => true,
                    },
                    Some("text_reset") => {
                        content.clear();
                        on_text(DekiModelText::Restart)
                    }
                    Some("usage") => {
                        usage = event.get("data").cloned();
                        true
                    }
                    _ => true,
                };
                if keep_going {
                    Ok(())
                } else {
                    // Ending the stream drops the provider call (for Claude Code, its process).
                    cut_short = true;
                    Err(AppError::new(
                        "deki_model_cut_short",
                        "Deki-senpai stopped this model reply early.",
                    ))
                }
            });
            let completion = tokio::time::timeout(timeout_for, stream);
            tokio::select! {
                result = completion => result.map_err(|_| {
                    AppError::new(
                        "deki_model_timeout",
                        "Deki-senpai's selected model did not finish before the workspace time limit.",
                    )
                })?,
                _ = cancellation.cancelled() => {
                    return Err(AppError::new(
                        "deki_workspace_aborted",
                        "Deki-senpai's workspace run was cancelled.",
                    ));
                }
            }
        };
        if let Err(error) = outcome {
            if !cut_short {
                return Err(error);
            }
        }
        Ok(DekiModelResponse {
            content,
            usage,
            cut_short,
        })
    }
}
