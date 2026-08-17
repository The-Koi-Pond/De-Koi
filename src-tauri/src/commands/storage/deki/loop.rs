use super::budget::{truncate_to_chars, DekiEvidenceBudget, DekiRuntimeBudget};
use super::model_client::{DekiModelClient, DekiModelMessage};
use super::protocol::{extract_command_frame, DekiCommandFrame, JSON_PROTOCOL_PROMPT};
use super::status::DekiRuntimeCancellation;
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};

const SYNTHESIS_CHECKPOINT_PROMPT: &str = "This is the bounded synthesis checkpoint. Answer the original user task now if the returned command evidence covers every requested file, query, and symbol. If one necessary item is still missing, issue only the smallest missing command batch with stop set to false; do not guess or claim a requested search ran when its result is absent.";
const FINAL_SYNTHESIS_PROMPT: &str = "This is the final bounded runtime round. Do not request more commands. Answer the original user task now using only the command evidence already returned. Set commands to [] and stop to true. Copy exact paths, symbols, signatures, and line numbers only from visible command evidence; otherwise state exactly what could not be verified. Do not guess or describe internal runtime limits.";

pub(super) struct DekiJsonRuntimeInput<'a> {
    pub(super) state: &'a AppState,
    pub(super) connection: marinara_llm::LlmConnection,
    pub(super) system_prompt: String,
    pub(super) task_prompt: String,
    pub(super) requires_repository_evidence: bool,
    pub(super) chat_access_grants: Vec<super::chat_access::DekiChatAccessGrant>,
    pub(super) web_research_grants: Vec<super::commands::web::DekiWebResearchGrant>,
    pub(super) cancellation: DekiRuntimeCancellation,
}

pub(super) struct DekiJsonRuntimeOutput {
    pub(super) content: String,
    pub(super) workspace_trace: Vec<Value>,
    pub(super) usage: Vec<Value>,
}

struct DekiCommandRoundContext<'a> {
    state: &'a AppState,
    chat_access_grants: &'a [super::chat_access::DekiChatAccessGrant],
    web_research_grants: &'a [super::commands::web::DekiWebResearchGrant],
    command_state: &'a mut super::commands::DekiCommandTurnState,
    budget: &'a DekiRuntimeBudget,
    cancellation: &'a DekiRuntimeCancellation,
    evidence_budget: &'a mut DekiEvidenceBudget,
    trace: &'a mut Vec<Value>,
    trace_chars: &'a mut usize,
}

struct DekiCommandRoundOutput {
    results: Vec<Value>,
    has_repository_evidence: bool,
}

pub(super) async fn run_json_command_runtime(
    input: DekiJsonRuntimeInput<'_>,
) -> AppResult<DekiJsonRuntimeOutput> {
    let model = DekiModelClient::new(input.connection);
    let budget = DekiRuntimeBudget::default();
    let mut evidence_budget = DekiEvidenceBudget::default();
    let mut messages = vec![
        DekiModelMessage::system(format!(
            "{}\n\n{}\n\n{}",
            input.system_prompt.trim(),
            JSON_PROTOCOL_PROMPT,
            super::commands::JSON_COMMAND_GUIDE,
        )),
        DekiModelMessage::user(input.task_prompt),
    ];
    let mut trace = Vec::new();
    let mut usage = Vec::new();
    let mut trace_chars = 0usize;
    let mut last_say = String::new();
    let mut has_repository_evidence = false;
    let mut command_state =
        super::commands::DekiCommandTurnState::new(budget.max_web_pages_per_turn());

    for round_index in 0..budget.max_rounds() {
        input.cancellation.ensure_not_cancelled()?;
        budget.ensure_can_start_round(round_index)?;
        let final_round = is_final_round(round_index, budget.max_rounds());
        if let Some(prompt) = synthesis_prompt(round_index, budget.max_rounds()) {
            messages.push(DekiModelMessage::user(prompt.to_string()));
        }
        let max_tokens = if round_index == 0 {
            super::DEKI_INITIAL_MAX_TOKENS
        } else {
            super::DEKI_POST_TOOL_MAX_TOKENS
        };
        let response = model
            .complete(
                &messages,
                max_tokens,
                budget.remaining_timeout(),
                &input.cancellation,
            )
            .await?;
        if let Some(round_usage) = response.usage {
            usage.push(round_usage);
        }
        let raw = response.content;
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
                messages.push(DekiModelMessage::user(protocol_repair_prompt(&error)));
                continue;
            }
        };
        let needs_repository_evidence = frame_needs_repository_evidence(
            &frame,
            input.requires_repository_evidence,
            has_repository_evidence,
        );
        if needs_repository_evidence {
            messages.push(DekiModelMessage::assistant(raw_frame_for_memory(&frame)));
            messages.push(DekiModelMessage::user(
                "The original task asks about the current repository, but no repository command has succeeded yet. Continue the original task with the smallest useful read, grep, find, ls, deki_code, search_deki_code, or read_deki_code_file command. Do not answer from memory and do not mention this internal reminder in say."
                    .to_string(),
            ));
            continue;
        }
        if !frame.say.trim().is_empty() {
            last_say = frame.say.trim().to_string();
        }
        if frame_is_terminal(&frame, final_round) {
            return Ok(DekiJsonRuntimeOutput {
                content: final_content_from_frame(&frame, &last_say),
                workspace_trace: trace,
                usage,
            });
        }

        let assistant_frame = raw_frame_for_memory(&frame);
        let command_round = execute_command_round(
            round_index,
            frame,
            DekiCommandRoundContext {
                state: input.state,
                chat_access_grants: &input.chat_access_grants,
                web_research_grants: &input.web_research_grants,
                command_state: &mut command_state,
                budget: &budget,
                cancellation: &input.cancellation,
                evidence_budget: &mut evidence_budget,
                trace: &mut trace,
                trace_chars: &mut trace_chars,
            },
        )
        .await?;
        has_repository_evidence |= command_round.has_repository_evidence;
        let Some(feedback) =
            evidence_budget.compact_feedback(round_index + 1, command_round.results)
        else {
            break;
        };
        messages.push(DekiModelMessage::assistant(assistant_frame));
        messages.push(DekiModelMessage::user(feedback));
    }

    Ok(DekiJsonRuntimeOutput {
        content: max_rounds_fallback(&last_say),
        workspace_trace: trace,
        usage,
    })
}

async fn execute_command_round(
    round_index: usize,
    frame: DekiCommandFrame,
    context: DekiCommandRoundContext<'_>,
) -> AppResult<DekiCommandRoundOutput> {
    let DekiCommandRoundContext {
        state,
        chat_access_grants,
        web_research_grants,
        command_state,
        budget,
        cancellation,
        evidence_budget,
        trace,
        trace_chars,
    } = context;
    let requested_count = frame.commands.len();
    let command_limit = budget.max_commands_per_round();
    let mut results = Vec::new();
    let mut has_repository_evidence = false;
    for (command_index, command) in frame.commands.into_iter().take(command_limit).enumerate() {
        cancellation.ensure_not_cancelled()?;
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
        has_repository_evidence |=
            execution.ok && super::commands::is_repository_command(&execution.name);
        cancellation.ensure_not_cancelled()?;
        push_trace(
            trace,
            trace_chars,
            budget.max_trace_chars(),
            command_trace(&execution),
        );
        let evidence = execution.evidence_value();
        if let Some(compacted) = evidence_budget.compact_command_value(&execution.name, &evidence) {
            results.push(compacted);
        }
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
        if let Some(compacted) = evidence_budget.compact_command_value("deki_runtime", &evidence) {
            results.push(compacted);
        }
    }
    Ok(DekiCommandRoundOutput {
        results,
        has_repository_evidence,
    })
}

fn frame_requests_stop(frame: &DekiCommandFrame) -> bool {
    frame.commands.is_empty()
}

fn frame_is_terminal(frame: &DekiCommandFrame, final_round: bool) -> bool {
    frame_requests_stop(frame) || final_round
}

fn is_final_round(round_index: usize, max_rounds: usize) -> bool {
    max_rounds > 0 && round_index.saturating_add(1) == max_rounds
}

fn synthesis_prompt(round_index: usize, max_rounds: usize) -> Option<&'static str> {
    if is_final_round(round_index, max_rounds) {
        Some(FINAL_SYNTHESIS_PROMPT)
    } else if max_rounds > 1 && round_index.saturating_add(2) == max_rounds {
        Some(SYNTHESIS_CHECKPOINT_PROMPT)
    } else {
        None
    }
}

fn frame_needs_repository_evidence(
    frame: &DekiCommandFrame,
    requires_repository_evidence: bool,
    has_repository_evidence: bool,
) -> bool {
    frame_requests_stop(frame) && requires_repository_evidence && !has_repository_evidence
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
    let fallback = "I reached Deki-senpai's workspace command limit before finishing the investigation. Ask a narrower follow-up question so I can complete one bounded pass.";
    if last_say.trim().is_empty() {
        fallback.to_string()
    } else {
        format!("{}\n\n{}", last_say.trim(), fallback)
    }
}

fn protocol_repair_prompt(error: &AppError) -> String {
    format!(
        "Your previous response did not follow Deki's JSON command protocol: {}. Continue the original user task. Return exactly one JSON object with say, commands, and stop, with no markdown fences or prose outside it. Do not mention this repair, the hidden protocol, or its error in say. If the original task needs evidence, issue the next useful command. Set stop to true only after answering the original task.",
        error.message
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_rounds_fallback_preserves_last_visible_text_and_reports_the_limit() {
        let content = max_rounds_fallback("Still checking.");

        assert!(content.starts_with("Still checking."));
        assert!(content.contains("workspace command limit"));
    }

    #[test]
    fn max_rounds_fallback_is_useful_without_prior_visible_text() {
        let content = max_rounds_fallback("");

        assert!(content.contains("workspace command limit"));
        assert!(content.contains("narrower follow-up"));
        assert!(!content.contains("Ask me to continue"));
        assert!(!content.trim().is_empty());
    }

    #[test]
    fn protocol_repair_resumes_the_original_task_without_leaking_protocol_details() {
        let prompt = protocol_repair_prompt(&AppError::new(
            "deki_protocol_invalid_json",
            "malformed command JSON",
        ));

        assert!(prompt.contains("Continue the original user task"));
        assert!(prompt.contains("Do not mention this repair"));
        assert!(prompt.contains("stop to true only after answering"));
    }

    #[test]
    fn final_content_uses_only_visible_frame_text() {
        let frame = DekiCommandFrame {
            say: "Visible answer.".to_string(),
            commands: Vec::new(),
            stop: true,
        };

        let content = final_content_from_frame(&frame, "Earlier progress.");

        assert_eq!(content, "Visible answer.");
        assert!(!content.contains("\"commands\""));
    }

    #[test]
    fn empty_command_frame_requests_a_stop_even_without_the_stop_flag() {
        let frame = DekiCommandFrame {
            say: "Answer".to_string(),
            commands: Vec::new(),
            stop: false,
        };

        assert!(frame_requests_stop(&frame));
    }

    #[test]
    fn non_empty_commands_take_precedence_over_an_accidental_stop_flag() {
        let frame = DekiCommandFrame {
            say: "Checking one missing symbol.".to_string(),
            commands: vec![super::super::protocol::DekiCommandRequest {
                name: "grep".to_string(),
                args: json!({ "query": "/api/invoke" }),
            }],
            stop: true,
        };

        assert!(!frame_requests_stop(&frame));
        assert!(!frame_is_terminal(&frame, false));
        assert!(frame_is_terminal(&frame, true));
    }

    #[test]
    fn repository_answer_cannot_finish_before_a_successful_repository_command() {
        let frame = DekiCommandFrame {
            say: "Answer from memory".to_string(),
            commands: Vec::new(),
            stop: true,
        };

        assert!(frame_needs_repository_evidence(&frame, true, false));
        assert!(!frame_needs_repository_evidence(&frame, true, true));
        assert!(!frame_needs_repository_evidence(&frame, false, false));
    }

    #[test]
    fn final_two_bounded_rounds_have_distinct_synthesis_contracts() {
        assert_eq!(synthesis_prompt(5, 8), None);
        assert_eq!(synthesis_prompt(6, 8), Some(SYNTHESIS_CHECKPOINT_PROMPT));
        assert_eq!(synthesis_prompt(7, 8), Some(FINAL_SYNTHESIS_PROMPT));
        assert_eq!(synthesis_prompt(0, 0), None);
        assert!(SYNTHESIS_CHECKPOINT_PROMPT.contains("smallest missing command batch"));
        assert!(SYNTHESIS_CHECKPOINT_PROMPT.contains("stop set to false"));
        assert!(FINAL_SYNTHESIS_PROMPT.contains("Do not request more commands"));
        assert!(FINAL_SYNTHESIS_PROMPT.contains("commands to []"));
        assert!(FINAL_SYNTHESIS_PROMPT.contains("only from visible command evidence"));
    }
}
