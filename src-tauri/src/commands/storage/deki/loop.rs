use super::answer_stream::AnswerStream;
use super::budget::{truncate_to_chars, DekiEvidenceBudget, DekiRuntimeBudget};
use super::events::DekiEventSink;
use super::model_client::{DekiModelClient, DekiModelMessage, DekiModelText};
use super::protocol::{
    extract_command_frame, is_tool_markup_loop, tool_markup_error, DekiCommandFrame,
    JSON_PROTOCOL_PROMPT,
};
use super::status::DekiRuntimeCancellation;
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};

const SYNTHESIS_CHECKPOINT_PROMPT: &str = "This is the bounded synthesis checkpoint. Answer the original user task now if the returned command evidence covers every requested file, query, and symbol. If one necessary item is still missing, issue only the smallest missing command batch with stop set to false; do not guess or claim a requested search ran when its result is absent.";
const FINAL_SYNTHESIS_PROMPT: &str = "This is the final bounded runtime round. Do not request more commands. Answer the original user task now using only the command evidence already returned. Set commands to [] and stop to true. Copy exact paths, symbols, signatures, and line numbers only from visible command evidence; otherwise state exactly what could not be verified. Do not guess or describe internal runtime limits.";

/// Why a run had to answer before the model chose to stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DekiFinalReason {
    Rounds,
    Time,
    Evidence,
}

impl DekiFinalReason {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::Rounds => "rounds",
            Self::Time => "time",
            Self::Evidence => "evidence",
        }
    }

    fn incomplete_note(self) -> &'static str {
        match self {
            Self::Rounds => "I used all of my search rounds before I could finish, so this answer is incomplete.",
            Self::Time => "I ran out of time before I could finish, so this answer is incomplete.",
            Self::Evidence => "I read as much as fits in one answer before I could finish, so this answer is incomplete.",
        }
    }
}

pub(super) struct DekiJsonRuntimeInput<'a> {
    pub(super) state: &'a AppState,
    pub(super) approval_scope: super::approvals::DekiApprovalScope,
    pub(super) connection: marinara_llm::LlmConnection,
    pub(super) system_prompt: String,
    pub(super) task_prompt: String,
    /// Image data URLs attached to the latest user message.
    pub(super) task_images: Vec<String>,
    pub(super) requires_repository_evidence: bool,
    /// The connection's context window in tokens, when it records one.
    pub(super) max_context_tokens: Option<u64>,
    pub(super) chat_access_grants: Vec<super::chat_access::DekiChatAccessGrant>,
    pub(super) web_research_grants: Vec<super::commands::web::DekiWebResearchGrant>,
    pub(super) cancellation: DekiRuntimeCancellation,
    pub(super) events: DekiEventSink,
}

pub(super) struct DekiJsonRuntimeOutput {
    pub(super) content: String,
    pub(super) workspace_trace: Vec<Value>,
    pub(super) usage: Vec<Value>,
    pub(super) pending_approvals: Vec<Value>,
    /// Set when the answer is a labelled partial answer instead of a finished one.
    pub(super) incomplete: Option<DekiFinalReason>,
}

struct DekiCommandRoundContext<'a> {
    commands: super::commands::DekiCommandContext<'a>,
    command_state: &'a mut super::commands::DekiCommandTurnState,
    budget: &'a DekiRuntimeBudget,
    cancellation: &'a DekiRuntimeCancellation,
    events: &'a DekiEventSink,
    evidence_budget: &'a mut DekiEvidenceBudget,
    trace: &'a mut Vec<Value>,
    trace_chars: &'a mut usize,
}

struct DekiCommandRoundOutput {
    results: Vec<Value>,
    has_repository_evidence: bool,
    /// The investigation time ran out partway, so later commands were skipped.
    ran_out_of_time: bool,
}

pub(super) async fn run_json_command_runtime(
    input: DekiJsonRuntimeInput<'_>,
) -> AppResult<DekiJsonRuntimeOutput> {
    let model = DekiModelClient::new(input.connection);
    let budget = DekiRuntimeBudget::default();
    let mut evidence_budget = DekiEvidenceBudget::for_context(input.max_context_tokens);
    let mut messages = vec![
        DekiModelMessage::system(format!(
            "{}\n\n{}\n\n{}\n\n{}",
            input.system_prompt.trim(),
            JSON_PROTOCOL_PROMPT,
            super::commands::JSON_COMMAND_GUIDE,
            super::data_cli::DEKI_DATA_GUIDE,
        )),
        DekiModelMessage::user(input.task_prompt).with_images(input.task_images),
    ];
    let mut trace = Vec::new();
    let mut usage = Vec::new();
    let mut trace_chars = 0usize;
    let mut last_say = String::new();
    let mut has_repository_evidence = false;
    let mut command_state = super::commands::DekiCommandTurnState::new(
        budget.max_web_pages_per_turn(),
        budget.max_data_mutations_per_turn(),
    );

    // Set once the run must answer from the evidence it has: the last round,
    // the investigation time is spent, or the evidence budget is used up.
    let mut final_reason: Option<DekiFinalReason> = None;
    let mut final_prompt_sent = false;

    for round_index in 0..budget.max_rounds() {
        input.cancellation.ensure_not_cancelled()?;
        if final_reason.is_none() {
            if is_final_round(round_index, budget.max_rounds()) {
                final_reason = Some(DekiFinalReason::Rounds);
            } else if budget.investigation_timeout().is_zero() {
                final_reason = Some(DekiFinalReason::Time);
            }
        }
        let final_round = final_reason.is_some();
        if final_round {
            if !final_prompt_sent {
                messages.push(DekiModelMessage::user(FINAL_SYNTHESIS_PROMPT.to_string()));
                final_prompt_sent = true;
            }
        } else if let Some(prompt) = checkpoint_prompt(round_index, budget.max_rounds()) {
            messages.push(DekiModelMessage::user(prompt.to_string()));
        }
        let timeout = if final_round {
            budget.remaining_timeout()
        } else {
            budget.investigation_timeout()
        };
        if timeout.is_zero() {
            break;
        }
        let max_tokens = if round_index == 0 {
            super::DEKI_INITIAL_MAX_TOKENS
        } else {
            super::DEKI_POST_TOOL_MAX_TOKENS
        };
        // Stream the answer as it is written, except when a stop would be
        // turned away for lacking repository evidence.
        let mut answer = AnswerStream::new(
            final_round || !input.requires_repository_evidence || has_repository_evidence,
        );
        let events = &input.events;
        let mut round_raw = String::new();
        let response = model
            .complete(
                &messages,
                max_tokens,
                timeout,
                &input.cancellation,
                |text| match text {
                    DekiModelText::Delta(text) => {
                        if let Some(visible) = answer.push(text) {
                            events.answer_token(&visible);
                        }
                        round_raw.push_str(text);
                        // A reply looping on tool-call markup can run for minutes; stop it
                        // and ask for the JSON frame again.
                        !is_tool_markup_loop(&round_raw)
                    }
                    DekiModelText::Restart => {
                        if answer.restart() {
                            events.answer_reset();
                        }
                        round_raw.clear();
                        true
                    }
                },
            )
            .await;
        // Any path below that does not return this round's answer clears it.
        let abandon = |events: &DekiEventSink| {
            if answer.emitted_any() {
                events.answer_reset();
            }
        };
        let response = match response {
            Ok(response) => response,
            // An investigation round that runs into the reserve gives way to
            // the final answer round instead of failing the whole turn.
            Err(error) if error.code == "deki_model_timeout" && !final_round => {
                abandon(events);
                final_reason = Some(DekiFinalReason::Time);
                continue;
            }
            Err(error) if error.code == "deki_model_timeout" => {
                abandon(events);
                final_reason.get_or_insert(DekiFinalReason::Time);
                break;
            }
            Err(error) => {
                abandon(events);
                return Err(error);
            }
        };
        if let Some(round_usage) = response.usage {
            usage.push(round_usage);
        }
        let raw = response.content;
        let frame = if response.cut_short {
            Err(tool_markup_error())
        } else {
            extract_command_frame(&raw)
        };
        let frame = match frame {
            Ok(frame) => frame,
            Err(error) => {
                abandon(events);
                input.events.retry();
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
        let needs_repository_evidence = !final_round
            && frame_needs_repository_evidence(
                &frame,
                input.requires_repository_evidence,
                has_repository_evidence,
            );
        if needs_repository_evidence {
            abandon(events);
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
            if frame.say.trim().is_empty() && final_reason.is_some() {
                abandon(events);
                break;
            }
            return Ok(DekiJsonRuntimeOutput {
                content: final_content_from_frame(&frame, &last_say),
                workspace_trace: history_trace(trace),
                usage,
                pending_approvals: command_state.take_pending_approvals(),
                incomplete: None,
            });
        }

        abandon(events);
        if !frame.say.trim().is_empty() {
            input.events.narration(&frame.say);
            push_trace(
                &mut trace,
                &mut trace_chars,
                budget.max_trace_chars(),
                json!({ "type": "status", "content": frame.say.trim() }),
            );
        }
        let assistant_frame = raw_frame_for_memory(&frame);
        let command_round = execute_command_round(
            round_index,
            frame,
            DekiCommandRoundContext {
                commands: super::commands::DekiCommandContext {
                    state: input.state,
                    approval_scope: &input.approval_scope,
                    chat_access_grants: &input.chat_access_grants,
                    web_research_grants: &input.web_research_grants,
                },
                command_state: &mut command_state,
                budget: &budget,
                cancellation: &input.cancellation,
                events: &input.events,
                evidence_budget: &mut evidence_budget,
                trace: &mut trace,
                trace_chars: &mut trace_chars,
            },
        )
        .await?;
        has_repository_evidence |= command_round.has_repository_evidence;
        let feedback = evidence_budget.compact_feedback(round_index + 1, command_round.results);
        if feedback.exhausted {
            final_reason.get_or_insert(DekiFinalReason::Evidence);
        }
        if command_round.ran_out_of_time {
            final_reason.get_or_insert(DekiFinalReason::Time);
        }
        messages.push(DekiModelMessage::assistant(assistant_frame));
        messages.push(DekiModelMessage::user(feedback.text));
    }

    let reason = final_reason.unwrap_or(DekiFinalReason::Rounds);
    Ok(DekiJsonRuntimeOutput {
        content: incomplete_answer(&last_say, reason),
        workspace_trace: history_trace(trace),
        usage,
        pending_approvals: command_state.take_pending_approvals(),
        incomplete: Some(reason),
    })
}

async fn execute_command_round(
    round_index: usize,
    frame: DekiCommandFrame,
    context: DekiCommandRoundContext<'_>,
) -> AppResult<DekiCommandRoundOutput> {
    let DekiCommandRoundContext {
        commands,
        command_state,
        budget,
        cancellation,
        events,
        evidence_budget,
        trace,
        trace_chars,
    } = context;
    let requested_count = frame.commands.len();
    let command_limit = budget.max_commands_per_round();
    let mut results = Vec::new();
    let mut has_repository_evidence = false;
    let mut ran_out_of_time = false;
    for (command_index, command) in frame.commands.into_iter().take(command_limit).enumerate() {
        cancellation.ensure_not_cancelled()?;
        let id = format!("deki_r{}_c{}", round_index + 1, command_index + 1);
        if budget.investigation_timeout().is_zero() {
            ran_out_of_time = true;
            results.push(json!({
                "id": id,
                "name": command.name.trim(),
                "ok": false,
                "skipped": true,
                "note": "Not run: the investigation time is used up. Answer from the evidence already returned.",
            }));
            continue;
        }
        let display_name = super::commands::display_name(&command.name);
        events.tool_start(&id, &display_name, &command.args);
        let approvals_before = command_state.pending_approval_count();
        let execution = super::commands::execute(id, commands, command_state, command).await;
        events.tool_end(
            &execution.id,
            &execution.trace_name,
            !execution.ok,
            &command_output_text(&execution),
        );
        for approval in command_state.pending_approvals_since(approvals_before) {
            events.approval_pending(approval);
        }
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
    Ok(DekiCommandRoundOutput {
        results,
        has_repository_evidence,
        ran_out_of_time,
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

/// The checkpoint nudge for the round before the last. The last round itself
/// always gets the final answer prompt.
fn checkpoint_prompt(round_index: usize, max_rounds: usize) -> Option<&'static str> {
    (max_rounds > 1 && round_index.saturating_add(2) == max_rounds)
        .then_some(SYNTHESIS_CHECKPOINT_PROMPT)
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

/// The labelled partial answer used only when even the final answer round
/// produced nothing: the last visible progress plus why it stopped.
fn incomplete_answer(last_say: &str, reason: DekiFinalReason) -> String {
    let note = format!(
        "{} Ask me to continue, or narrow the question, and I'll pick up from here.",
        reason.incomplete_note()
    );
    if last_say.trim().is_empty() {
        note
    } else {
        format!("{}\n\n{}", last_say.trim(), note)
    }
}

fn protocol_repair_prompt(error: &AppError) -> String {
    format!(
        "Your previous response did not follow Deki's JSON command protocol: {}. Continue the original user task. Return exactly one JSON object with say, commands, and stop, with no markdown fences or prose outside it. Do not mention this repair, the hidden protocol, or its error in say. If the original task needs evidence, issue the next useful command. Set stop to true only after answering the original task.",
        error.message
    )
}

fn command_output_text(execution: &super::commands::DekiCommandExecution) -> String {
    if execution.ok {
        serde_json::to_string(&execution.output).unwrap_or_else(|_| "{}".to_string())
    } else {
        execution
            .output
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Deki command failed.")
            .to_string()
    }
}

/// The trace kept with the assistant message: visible narration and command
/// steps with bounded output. Internal protocol-repair notes stay out.
fn history_trace(trace: Vec<Value>) -> Vec<Value> {
    trace
        .into_iter()
        .filter(|item| item.get("internal").and_then(Value::as_bool) != Some(true))
        .map(|mut item| {
            if let Some(output) = item
                .pointer("/tool/output")
                .and_then(Value::as_str)
                .map(super::events::bounded_output)
            {
                item["tool"]["output"] = json!(output);
            }
            item
        })
        .collect()
}

fn command_trace(execution: &super::commands::DekiCommandExecution) -> Value {
    let output = command_output_text(execution);
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
        "internal": true,
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
    fn incomplete_answer_keeps_progress_and_names_the_real_reason() {
        let content = incomplete_answer("Still checking.", DekiFinalReason::Evidence);

        assert!(content.starts_with("Still checking."));
        assert!(content.contains("as much as fits in one answer"));
        assert!(content.contains("incomplete"));
        assert!(!content.contains("command limit"));
    }

    #[test]
    fn incomplete_answer_is_useful_without_prior_visible_text() {
        for reason in [
            DekiFinalReason::Rounds,
            DekiFinalReason::Time,
            DekiFinalReason::Evidence,
        ] {
            let content = incomplete_answer("", reason);
            assert!(content.contains("incomplete"));
            assert!(content.contains("Ask me to continue"));
        }
        assert!(incomplete_answer("", DekiFinalReason::Time).contains("ran out of time"));
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
        assert_eq!(checkpoint_prompt(5, 8), None);
        assert_eq!(checkpoint_prompt(6, 8), Some(SYNTHESIS_CHECKPOINT_PROMPT));
        assert_eq!(checkpoint_prompt(7, 8), None);
        assert_eq!(checkpoint_prompt(0, 0), None);
        assert!(SYNTHESIS_CHECKPOINT_PROMPT.contains("smallest missing command batch"));
        assert!(SYNTHESIS_CHECKPOINT_PROMPT.contains("stop set to false"));
        assert!(FINAL_SYNTHESIS_PROMPT.contains("Do not request more commands"));
        assert!(FINAL_SYNTHESIS_PROMPT.contains("commands to []"));
        assert!(FINAL_SYNTHESIS_PROMPT.contains("only from visible command evidence"));
    }
}
