use serde_json::{json, Value};
use std::time::{Duration, Instant};

const DEFAULT_MAX_ROUNDS: usize = 8;
const DEFAULT_MAX_COMMANDS_PER_ROUND: usize = 4;
const DEFAULT_MAX_WEB_PAGES_PER_TURN: usize = 2;
const DEFAULT_MAX_DATA_MUTATIONS_PER_TURN: usize = 6;
const DEFAULT_MAX_TRACE_CHARS: usize = 64 * 1024;
const DEFAULT_WALL_CLOCK_SECS: u64 = 180;
/// Time kept back for the final answer round, so a run that investigates up
/// to its limit still has room to answer from what it found.
const FINAL_ANSWER_RESERVE_SECS: u64 = 45;

/// Context window assumed when the connection does not say (tokens).
const DEFAULT_CONTEXT_TOKENS: u64 = 128_000;
/// Share of the context window command evidence may fill, in characters
/// (about four characters per token).
const EVIDENCE_CONTEXT_SHARE: f64 = 0.3;
const MIN_TOTAL_EVIDENCE_CHARS: usize = 48 * 1024;
const MAX_TOTAL_EVIDENCE_CHARS: usize = 384 * 1024;
const MIN_SINGLE_EVIDENCE_CHARS: usize = 12 * 1024;
const MAX_SINGLE_EVIDENCE_CHARS: usize = 48 * 1024;
/// Below this much room the evidence budget counts as used up and the next
/// round must answer.
const EVIDENCE_EXHAUSTED_CHARS: usize = 4 * 1024;

#[derive(Debug, Clone)]
pub(super) struct DekiRuntimeBudget {
    max_rounds: usize,
    max_commands_per_round: usize,
    max_web_pages_per_turn: usize,
    max_data_mutations_per_turn: usize,
    max_trace_chars: usize,
    deadline: Instant,
    final_answer_reserve: Duration,
}

fn serialized_value_chars(value: &Value) -> usize {
    serde_json::to_string_pretty(value)
        .map(|serialized| serialized.chars().count())
        .unwrap_or(usize::MAX)
}

fn truncated_command_value(
    command_name: &str,
    value: &Value,
    serialized: &str,
    limit: usize,
) -> Option<Value> {
    let build = |evidence: String| {
        json!({
            "id": value.get("id").cloned().unwrap_or(Value::Null),
            "name": value.get("name").cloned().unwrap_or_else(|| json!(command_name)),
            "ok": value.get("ok").cloned().unwrap_or(Value::Bool(false)),
            "truncated": true,
            "evidence": evidence,
            "narrowing": format!(
                "The {command_name} result exceeded Deki's command evidence budget. Narrow the next command with a more specific query, path, line range, record id, lower limit, entryLimit, or page URL."
            ),
        })
    };
    fit_truncated_command_value(serialized, limit, build)
}

/// A result whose output could not be shown at all. It still names the
/// command and whether it succeeded, so the model never reads a dropped
/// result as "no matches".
fn omitted_command_value(command_name: &str, value: &Value) -> Value {
    json!({
        "id": value.get("id").cloned().unwrap_or(Value::Null),
        "name": value.get("name").cloned().unwrap_or_else(|| json!(command_name)),
        "ok": value.get("ok").cloned().unwrap_or(Value::Bool(false)),
        "omitted": true,
        "note": "This command ran, but its output did not fit the remaining evidence budget. It is not an empty result: do not report it as finding nothing.",
    })
}

fn fit_truncated_command_value(
    serialized: &str,
    limit: usize,
    build: impl Fn(String) -> Value,
) -> Option<Value> {
    if serialized_value_chars(&build(String::new())) > limit {
        return None;
    }

    let mut low = 0;
    let mut high = serialized.chars().count().min(limit);
    while low < high {
        let candidate_length = low + (high - low).div_ceil(2);
        let candidate = build(truncate_to_chars(serialized, candidate_length).0);
        if serialized_value_chars(&candidate) <= limit {
            low = candidate_length;
        } else {
            high = candidate_length - 1;
        }
    }
    Some(build(truncate_to_chars(serialized, low).0))
}

fn feedback_text(round_number: usize, results: &[Value]) -> String {
    let evidence = json!({
        "round": round_number,
        "results": results,
        "instructions": "Use this evidence to decide the next Deki JSON command frame. Stop when you can answer. A result marked omitted ran but was not shown; it is not an empty result. Do not reveal raw evidence JSON unless the user needs a concise citation or summary.",
    });
    let evidence_text = serde_json::to_string_pretty(&evidence)
        .unwrap_or_else(|_| "{\"error\":\"unserializable evidence\"}".to_string());
    format!(
        "Deki workspace command results:\n{evidence_text}\n\nRespond with the next JSON command frame."
    )
}

#[derive(Debug, Clone)]
pub(super) struct DekiEvidenceBudget {
    max_single_chars: usize,
    max_total_chars: usize,
    used_chars: usize,
}

/// Command results for the next round. `exhausted` means the evidence budget
/// is used up, so the next round has to answer from what it already has.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct DekiFeedback {
    pub(super) text: String,
    pub(super) exhausted: bool,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BudgetedText {
    pub(super) text: String,
    pub(super) truncated: bool,
}

impl Default for DekiRuntimeBudget {
    fn default() -> Self {
        Self::with_wall_clock(
            Duration::from_secs(DEFAULT_WALL_CLOCK_SECS),
            Duration::from_secs(FINAL_ANSWER_RESERVE_SECS),
        )
    }
}

impl DekiRuntimeBudget {
    pub(super) fn with_wall_clock(wall_clock: Duration, final_answer_reserve: Duration) -> Self {
        Self {
            max_rounds: DEFAULT_MAX_ROUNDS,
            max_commands_per_round: DEFAULT_MAX_COMMANDS_PER_ROUND,
            max_web_pages_per_turn: DEFAULT_MAX_WEB_PAGES_PER_TURN,
            max_data_mutations_per_turn: DEFAULT_MAX_DATA_MUTATIONS_PER_TURN,
            max_trace_chars: DEFAULT_MAX_TRACE_CHARS,
            deadline: Instant::now() + wall_clock,
            final_answer_reserve: final_answer_reserve.min(wall_clock),
        }
    }

    pub(super) fn max_rounds(&self) -> usize {
        self.max_rounds
    }

    pub(super) fn max_commands_per_round(&self) -> usize {
        self.max_commands_per_round
    }

    pub(super) fn max_web_pages_per_turn(&self) -> usize {
        self.max_web_pages_per_turn
    }

    pub(super) fn max_data_mutations_per_turn(&self) -> usize {
        self.max_data_mutations_per_turn
    }

    pub(super) fn max_trace_chars(&self) -> usize {
        self.max_trace_chars
    }

    /// Whole time left in the run, used by the final answer round.
    pub(super) fn remaining_timeout(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }

    /// Time an investigation round may use while keeping the final answer
    /// reserve free. Zero means the next round must be the final answer.
    pub(super) fn investigation_timeout(&self) -> Duration {
        self.remaining_timeout()
            .saturating_sub(self.final_answer_reserve)
    }
}

impl DekiEvidenceBudget {
    /// Sizes the evidence budget from the connection's context window
    /// (tokens), so large-context models can read more before answering.
    pub(super) fn for_context(max_context_tokens: Option<u64>) -> Self {
        let tokens = max_context_tokens
            .filter(|tokens| *tokens > 0)
            .unwrap_or(DEFAULT_CONTEXT_TOKENS);
        let total = ((tokens as f64) * 4.0 * EVIDENCE_CONTEXT_SHARE) as usize;
        let max_total_chars = total.clamp(MIN_TOTAL_EVIDENCE_CHARS, MAX_TOTAL_EVIDENCE_CHARS);
        let max_single_chars =
            (max_total_chars / 6).clamp(MIN_SINGLE_EVIDENCE_CHARS, MAX_SINGLE_EVIDENCE_CHARS);
        Self {
            max_single_chars,
            max_total_chars,
            used_chars: 0,
        }
    }

    fn remaining_chars(&self) -> usize {
        self.max_total_chars.saturating_sub(self.used_chars)
    }

    /// Fits one command result into the budget: whole, truncated with
    /// narrowing guidance, or as an omitted marker when nothing fits.
    pub(super) fn compact_command_value(&mut self, command_name: &str, value: &Value) -> Value {
        let serialized = serde_json::to_string_pretty(value)
            .unwrap_or_else(|_| "{\"error\":\"unserializable evidence\"}".to_string());
        let limit = self.max_single_chars.min(self.remaining_chars());
        if serialized.chars().count() <= limit {
            return value.clone();
        }
        truncated_command_value(command_name, value, &serialized, limit)
            .unwrap_or_else(|| omitted_command_value(command_name, value))
    }

    /// Builds the next round's feedback. When the results do not fit, the
    /// largest ones become omitted markers, never silent drops; the markers
    /// may overrun the budget by their own small size.
    pub(super) fn compact_feedback(
        &mut self,
        round_number: usize,
        mut results: Vec<Value>,
    ) -> DekiFeedback {
        let remaining = self.remaining_chars();
        let mut omitted_any = false;
        loop {
            let text = feedback_text(round_number, &results);
            let chars = text.chars().count();
            let largest = results
                .iter()
                .enumerate()
                .filter(|(_, value)| value.get("omitted").and_then(Value::as_bool) != Some(true))
                .max_by_key(|(_, value)| serialized_value_chars(value))
                .map(|(index, _)| index);
            match largest {
                Some(index) if chars > remaining => {
                    let name = results[index]
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("command")
                        .to_string();
                    results[index] = omitted_command_value(&name, &results[index]);
                    omitted_any = true;
                }
                _ => {
                    self.used_chars = self.used_chars.saturating_add(chars);
                    return DekiFeedback {
                        text,
                        exhausted: omitted_any || self.remaining_chars() < EVIDENCE_EXHAUSTED_CHARS,
                    };
                }
            }
        }
    }

    #[cfg(test)]
    pub(super) fn compact_value(&mut self, value: &Value) -> BudgetedText {
        let serialized = serde_json::to_string_pretty(value)
            .unwrap_or_else(|_| "{\"error\":\"unserializable evidence\"}".to_string());
        self.compact_text(&serialized)
    }

    #[cfg(test)]
    pub(super) fn compact_text(&mut self, value: &str) -> BudgetedText {
        self.compact_text_with_label("command", value)
    }

    #[cfg(test)]
    fn compact_text_with_label(&mut self, label: &str, value: &str) -> BudgetedText {
        let remaining_total = self.max_total_chars.saturating_sub(self.used_chars);
        if remaining_total == 0 {
            return BudgetedText {
                text: String::new(),
                truncated: true,
            };
        }
        let limit = self.max_single_chars.min(remaining_total);
        let (text, truncated) = truncate_to_chars(value, limit);
        if !truncated {
            self.used_chars += text.chars().count();
            return BudgetedText { text, truncated };
        }

        let marker = format!(
            "\n\n[Deki {label} evidence truncated. Narrow the next command with a more specific query, path, id, limit, or page URL.]"
        );
        let marker_chars = marker.chars().count();
        let mut text = if marker_chars < limit {
            truncate_to_chars(value, limit - marker_chars).0
        } else {
            String::new()
        };
        let marker_limit = limit.saturating_sub(text.chars().count());
        text.push_str(&truncate_to_chars(&marker, marker_limit).0);
        self.used_chars += text.chars().count();
        BudgetedText { text, truncated }
    }
}

pub(super) fn truncate_to_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    let was_truncated = chars.next().is_some();
    (truncated, was_truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compact_value_limits_single_evidence() {
        let mut budget = DekiEvidenceBudget {
            max_single_chars: 160,
            max_total_chars: 160,
            used_chars: 0,
        };
        let compacted =
            budget.compact_value(&json!({ "text": "abcdefghijklmnopqrstuvwxyz".repeat(20) }));
        assert!(compacted.truncated);
        assert!(compacted.text.starts_with("{\n  \""));
        assert!(compacted.text.contains("evidence truncated"));
        assert!(compacted.text.contains("Narrow the next command"));
        assert!(compacted.text.chars().count() <= 160);
        assert_eq!(budget.used_chars, compacted.text.chars().count());
    }

    #[test]
    fn compact_text_omits_after_total_budget() {
        let mut budget = DekiEvidenceBudget {
            max_single_chars: 10,
            max_total_chars: 3,
            used_chars: 3,
        };
        let compacted = budget.compact_text("abcdef");
        assert!(compacted.truncated);
        assert!(compacted.text.is_empty());
    }

    #[test]
    fn compact_command_value_preserves_small_structured_results() {
        let mut budget = DekiEvidenceBudget {
            max_single_chars: 200,
            max_total_chars: 200,
            used_chars: 0,
        };
        let value = json!({ "id": "cmd-1", "name": "grep", "ok": true, "output": { "rows": [] } });

        let compacted = budget.compact_command_value("grep", &value);

        assert_eq!(compacted, value);
        assert_eq!(budget.used_chars, 0);
    }

    #[test]
    fn compact_command_value_wraps_truncated_results_with_narrowing_guidance() {
        let mut budget = DekiEvidenceBudget {
            max_single_chars: 420,
            max_total_chars: 420,
            used_chars: 0,
        };
        let value = json!({ "id": "cmd-1", "name": "grep", "ok": true, "output": { "text": "abcdefghijklmnopqrstuvwxyz".repeat(100) } });

        let compacted = budget.compact_command_value("grep", &value);

        assert_eq!(compacted["id"], json!("cmd-1"));
        assert_eq!(compacted["name"], json!("grep"));
        assert_eq!(compacted["truncated"], json!(true));
        assert!(compacted["narrowing"]
            .as_str()
            .unwrap_or_default()
            .contains("specific query"));
        assert!(serialized_value_chars(&compacted) <= 420);
        assert_eq!(budget.used_chars, 0);
    }

    #[test]
    fn a_result_that_cannot_fit_becomes_an_omitted_marker_not_a_drop() {
        let mut budget = DekiEvidenceBudget {
            max_single_chars: 20,
            max_total_chars: 20,
            used_chars: 0,
        };
        let value = json!({ "id": "cmd-1", "name": "grep", "ok": true, "output": "too large" });

        let compacted = budget.compact_command_value("grep", &value);

        assert_eq!(compacted["id"], json!("cmd-1"));
        assert_eq!(compacted["ok"], json!(true));
        assert_eq!(compacted["omitted"], json!(true));
        assert!(compacted["note"]
            .as_str()
            .unwrap_or_default()
            .contains("not an empty result"));
    }

    #[test]
    fn compact_feedback_marks_results_that_do_not_fit_and_reports_exhaustion() {
        let first = json!({ "id": "cmd-1", "name": "grep", "ok": true, "output": "first" });
        let second =
            json!({ "id": "cmd-2", "name": "grep", "ok": true, "output": "second ".repeat(40) });
        let one_result_chars = feedback_text(1, std::slice::from_ref(&first))
            .chars()
            .count();
        let mut budget = DekiEvidenceBudget {
            max_single_chars: 2000,
            max_total_chars: one_result_chars + 40,
            used_chars: 0,
        };

        let feedback = budget.compact_feedback(1, vec![first, second]);

        assert!(feedback.text.contains("cmd-1"));
        assert!(
            feedback.text.contains("cmd-2"),
            "the oversized result keeps its id"
        );
        assert!(!feedback.text.contains("second second"));
        assert!(feedback.text.contains("\"omitted\": true"));
        assert!(feedback.exhausted);
    }

    #[test]
    fn compact_feedback_with_room_left_is_not_exhausted() {
        let mut budget = DekiEvidenceBudget::for_context(Some(128_000));
        let feedback = budget.compact_feedback(
            1,
            vec![json!({ "id": "cmd-1", "name": "grep", "ok": true, "output": "small" })],
        );
        assert!(!feedback.exhausted);
        assert!(!feedback.text.contains("omitted\": true"));
    }

    #[test]
    fn evidence_budget_scales_with_the_context_window_within_bounds() {
        let small = DekiEvidenceBudget::for_context(Some(8_000));
        assert_eq!(small.max_total_chars, MIN_TOTAL_EVIDENCE_CHARS);
        assert_eq!(small.max_single_chars, MIN_SINGLE_EVIDENCE_CHARS);

        let default = DekiEvidenceBudget::for_context(None);
        assert_eq!(default.max_total_chars, 153_600);
        assert_eq!(default.max_single_chars, 25_600);

        let huge = DekiEvidenceBudget::for_context(Some(1_000_000));
        assert_eq!(huge.max_total_chars, MAX_TOTAL_EVIDENCE_CHARS);
        assert_eq!(huge.max_single_chars, MAX_SINGLE_EVIDENCE_CHARS);
    }

    #[test]
    fn investigation_time_keeps_the_final_answer_reserve() {
        let budget =
            DekiRuntimeBudget::with_wall_clock(Duration::from_secs(60), Duration::from_secs(45));
        assert!(budget.investigation_timeout() <= Duration::from_secs(15));
        assert!(budget.remaining_timeout() > Duration::from_secs(45));

        let tight =
            DekiRuntimeBudget::with_wall_clock(Duration::from_secs(10), Duration::from_secs(45));
        assert_eq!(tight.investigation_timeout(), Duration::ZERO);
    }

    #[test]
    fn truncate_to_chars_reports_exact_fit() {
        assert_eq!(truncate_to_chars("abcd", 4), ("abcd".to_string(), false));
        assert_eq!(truncate_to_chars("abcde", 4), ("abcd".to_string(), true));
    }
}
