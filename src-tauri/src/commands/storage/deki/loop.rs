use super::budget::{truncate_to_chars, DekiEvidenceBudget, DekiRuntimeBudget};
use super::model_client::{DekiModelClient, DekiModelMessage};
use super::protocol::{extract_command_frame, DekiCommandFrame, JSON_PROTOCOL_PROMPT};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};

pub(super) struct DekiJsonRuntimeInput<'a> {
    pub(super) state: &'a AppState,
    pub(super) connection: marinara_llm::LlmConnection,
    pub(super) system_prompt: String,
    pub(super) task_prompt: String,
    pub(super) chat_access_grants: Vec<super::chat_access::DekiChatAccessGrant>,
    pub(super) web_research_grants: Vec<super::commands::web::DekiWebResearchGrant>,
}

pub(super) struct DekiJsonRuntimeOutput {
    pub(super) content: String,
    pub(super) workspace_trace: Vec<Value>,
}

struct DekiCommandRoundContext<'a> {
    state: &'a AppState,
    chat_access_grants: &'a [super::chat_access::DekiChatAccessGrant],
    web_research_grants: &'a [super::commands::web::DekiWebResearchGrant],
    command_state: &'a mut super::commands::DekiCommandTurnState,
    budget: &'a DekiRuntimeBudget,
    evidence_budget: &'a mut DekiEvidenceBudget,
    trace: &'a mut Vec<Value>,
    trace_chars: &'a mut usize,
}

pub(super) async fn run_json_command_runtime(
    input: DekiJsonRuntimeInput<'_>,
) -> AppResult<DekiJsonRuntimeOutput> {
    let model = DekiModelClient::new(input.connection);
    let budget = DekiRuntimeBudget::default();
    let mut evidence_budget = DekiEvidenceBudget::default();
    let mut messages = vec![
        DekiModelMessage::system(format!(
            "{}\n\n{}",
            input.system_prompt.trim(),
            JSON_PROTOCOL_PROMPT
        )),
        DekiModelMessage::user(input.task_prompt),
    ];
    let mut trace = Vec::new();
    let mut trace_chars = 0usize;
    let mut last_say = String::new();
    let mut command_state =
        super::commands::DekiCommandTurnState::new(budget.max_web_pages_per_turn());

    for round_index in 0..budget.max_rounds() {
        budget.ensure_can_start_round(round_index)?;
        let max_tokens = if round_index == 0 {
            super::DEKI_INITIAL_MAX_TOKENS
        } else {
            super::DEKI_POST_TOOL_MAX_TOKENS
        };
        let raw = model
            .complete(&messages, max_tokens, budget.remaining_timeout())
            .await?;
        let frame = match extract_command_frame(&raw) {
            Ok(frame) => frame,
            Err(error) => {
                push_trace(
                    &mut trace,
                    &mut trace_chars,
                    budget.max_trace_chars(),
                    protocol_repair_trace(round_index, &error),
                );
                messages.push(DekiModelMessage::assistant(raw));
                messages.push(DekiModelMessage::user(format!(
                    "Your previous response did not follow Deki's JSON command protocol: {}. Return exactly one JSON object with say, commands, and stop. Do not include markdown fences or prose outside the object.",
                    error.message
                )));
                continue;
            }
        };
        if !frame.say.trim().is_empty() {
            last_say = frame.say.trim().to_string();
        }
        if frame.stop || frame.commands.is_empty() {
            return Ok(DekiJsonRuntimeOutput {
                content: final_content_from_frame(&frame, &last_say),
                workspace_trace: trace,
            });
        }

        let assistant_frame = raw_frame_for_memory(&frame);
        let command_results = execute_command_round(
            round_index,
            frame,
            DekiCommandRoundContext {
                state: input.state,
                chat_access_grants: &input.chat_access_grants,
                web_research_grants: &input.web_research_grants,
                command_state: &mut command_state,
                budget: &budget,
                evidence_budget: &mut evidence_budget,
                trace: &mut trace,
                trace_chars: &mut trace_chars,
            },
        )
        .await?;
        let evidence = json!({
            "round": round_index + 1,
            "results": command_results,
            "instructions": "Use this evidence to decide the next Deki JSON command frame. Stop when you can answer. Do not reveal raw evidence JSON unless the user needs a concise citation or summary.",
        });
        let evidence_text = serde_json::to_string_pretty(&evidence)
            .unwrap_or_else(|_| "{\"error\":\"unserializable evidence\"}".to_string());
        messages.push(DekiModelMessage::assistant(assistant_frame));
        messages.push(DekiModelMessage::user(format!(
            "Deki workspace command results:\n{}\n\nRespond with the next JSON command frame.",
            evidence_text
        )));
    }

    Ok(DekiJsonRuntimeOutput {
        content: max_rounds_fallback(&last_say),
        workspace_trace: trace,
    })
}

async fn execute_command_round(
    round_index: usize,
    frame: DekiCommandFrame,
    context: DekiCommandRoundContext<'_>,
) -> AppResult<Vec<Value>> {
    let DekiCommandRoundContext {
        state,
        chat_access_grants,
        web_research_grants,
        command_state,
        budget,
        evidence_budget,
        trace,
        trace_chars,
    } = context;
    let requested_count = frame.commands.len();
    let command_limit = budget.max_commands_per_round();
    let mut results = Vec::new();
    for (command_index, command) in frame.commands.into_iter().take(command_limit).enumerate() {
        budget.ensure_not_expired()?;
        let id = format!("deki_r{}_c{}", round_index + 1, command_index + 1);
        let execution = super::commands::execute(
            id,
            state,
            chat_access_grants,
            web_research_grants,
            command_state,
            command,
        )
        .await;
        push_trace(
            trace,
            trace_chars,
            budget.max_trace_chars(),
            command_trace(&execution),
        );
        let evidence = execution.evidence_value();
        results.push(evidence_budget.compact_command_value(&execution.name, &evidence));
    }
    if requested_count > command_limit {
        let evidence = json!({
            "id": format!("deki_r{}_limit", round_index + 1),
            "name": "deki_runtime",
            "ok": false,
            "error": {
                "code": "deki_command_round_limit",
                "message": format!(
                    "Deki requested {requested_count} commands in one round; only {command_limit} were executed."
                ),
            },
        });
        results.push(evidence_budget.compact_command_value("deki_runtime", &evidence));
    }
    Ok(results)
}

fn raw_frame_for_memory(frame: &DekiCommandFrame) -> String {
    let commands = frame
        .commands
        .iter()
        .map(|command| {
            json!({
                "name": command.name,
                "args": command.args,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "say": frame.say,
        "commands": commands,
        "stop": frame.stop,
    })
    .to_string()
}

fn final_content_from_frame(frame: &DekiCommandFrame, last_say: &str) -> String {
    frame
        .say
        .trim()
        .to_string()
        .if_empty_then(|| last_say.trim().to_string())
        .if_empty_then(|| {
            "I finished the workspace pass but did not receive visible text from the selected model."
                .to_string()
        })
}

fn max_rounds_fallback(last_say: &str) -> String {
    let fallback =
        "I reached Deki-senpai's workspace command limit before finishing the investigation. Ask me to continue if you want another pass.";
    if last_say.trim().is_empty() {
        fallback.to_string()
    } else {
        format!("{}\n\n{}", last_say.trim(), fallback)
    }
}

fn command_trace(execution: &super::commands::DekiCommandExecution) -> Value {
    let output = if execution.ok {
        serde_json::to_string(&execution.output).unwrap_or_else(|_| "{}".to_string())
    } else {
        execution
            .output
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Deki command failed.")
            .to_string()
    };
    let (output, truncated) = truncate_to_chars(&output, 4 * 1024);
    json!({
        "type": "tool",
        "tool": {
            "id": execution.id,
            "name": execution.trace_name,
            "status": if execution.ok { "done" } else { "error" },
            "input": execution.args,
            "output": if truncated {
                format!("{output}\n\n[Deki trace output truncated.]")
            } else {
                output
            },
            "updatedAt": chrono::Utc::now().timestamp_millis(),
        },
    })
}

fn protocol_repair_trace(round_index: usize, error: &AppError) -> Value {
    json!({
        "type": "status",
        "content": format!(
            "Deki protocol repair requested in round {}: {}",
            round_index + 1,
            error.message
        ),
    })
}

fn push_trace(trace: &mut Vec<Value>, used_chars: &mut usize, max_chars: usize, item: Value) {
    if *used_chars >= max_chars {
        return;
    }
    let size = serde_json::to_string(&item)
        .map(|value| value.chars().count())
        .unwrap_or(0);
    if used_chars.saturating_add(size) > max_chars {
        if !trace.iter().any(|item| {
            item.get("type").and_then(Value::as_str) == Some("status")
                && item
                    .get("content")
                    .and_then(Value::as_str)
                    .map(|content| content.contains("trace budget"))
                    .unwrap_or(false)
        }) {
            trace.push(json!({
                "type": "status",
                "content": "Deki workspace trace budget was exhausted; later command traces were omitted.",
            }));
        }
        *used_chars = max_chars;
        return;
    }
    trace.push(item);
    *used_chars += size;
}

trait EmptyStringFallback {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String;
}

impl EmptyStringFallback for String {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String {
        if self.trim().is_empty() {
            fallback()
        } else {
            self
        }
    }
}
