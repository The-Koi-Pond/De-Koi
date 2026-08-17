use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const DEFAULT_MAX_ROUNDS: usize = 8;
const DEFAULT_MAX_COMMANDS_PER_ROUND: usize = 4;
const DEFAULT_MAX_WEB_PAGES_PER_TURN: usize = 2;
const DEFAULT_MAX_SINGLE_EVIDENCE_CHARS: usize = 12 * 1024;
const DEFAULT_MAX_TOTAL_EVIDENCE_CHARS: usize = 48 * 1024;
const DEFAULT_MAX_TRACE_CHARS: usize = 64 * 1024;
const DEFAULT_WALL_CLOCK_SECS: u64 = 90;

#[derive(Debug, Clone)]
pub(super) struct DekiRuntimeBudget {
    max_rounds: usize,
    max_commands_per_round: usize,
    max_web_pages_per_turn: usize,
    max_trace_chars: usize,
    deadline: Instant,
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
                "The {command_name} result exceeded Deki's command evidence budget. Narrow the next command with a more specific query, path, record id, lower limit, entryLimit, or page URL."
            ),
        })
    };
    fit_truncated_command_value(serialized, limit, build)
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

#[derive(Debug, Clone)]
pub(super) struct DekiEvidenceBudget {
    max_single_chars: usize,
    max_total_chars: usize,
    used_chars: usize,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BudgetedText {
    pub(super) text: String,
    pub(super) truncated: bool,
}

impl Default for DekiRuntimeBudget {
    fn default() -> Self {
        Self {
            max_rounds: DEFAULT_MAX_ROUNDS,
            max_commands_per_round: DEFAULT_MAX_COMMANDS_PER_ROUND,
            max_web_pages_per_turn: DEFAULT_MAX_WEB_PAGES_PER_TURN,
            max_trace_chars: DEFAULT_MAX_TRACE_CHARS,
            deadline: Instant::now() + Duration::from_secs(DEFAULT_WALL_CLOCK_SECS),
        }
    }
}

impl Default for DekiEvidenceBudget {
    fn default() -> Self {
        Self {
            max_single_chars: DEFAULT_MAX_SINGLE_EVIDENCE_CHARS,
            max_total_chars: DEFAULT_MAX_TOTAL_EVIDENCE_CHARS,
            used_chars: 0,
        }
    }
}

impl DekiRuntimeBudget {
    pub(super) fn max_rounds(&self) -> usize {
        self.max_rounds
    }

    pub(super) fn max_commands_per_round(&self) -> usize {
        self.max_commands_per_round
    }

    pub(super) fn max_web_pages_per_turn(&self) -> usize {
        self.max_web_pages_per_turn
    }

    pub(super) fn max_trace_chars(&self) -> usize {
        self.max_trace_chars
    }

    pub(super) fn ensure_can_start_round(&self, round_index: usize) -> AppResult<()> {
        self.ensure_not_expired()?;
        if round_index >= self.max_rounds {
            return Err(AppError::new(
                "deki_runtime_round_budget_exhausted",
                "Deki-senpai reached the workspace command round limit.",
            ));
        }
        Ok(())
    }

    pub(super) fn ensure_not_expired(&self) -> AppResult<()> {
        if Instant::now() >= self.deadline {
            return Err(AppError::new(
                "deki_runtime_timeout",
                "Deki-senpai reached the workspace command time limit.",
            ));
        }
        Ok(())
    }

    pub(super) fn remaining_timeout(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }
}

impl DekiEvidenceBudget {
    pub(super) fn compact_command_value(
        &mut self,
        command_name: &str,
        value: &Value,
    ) -> Option<Value> {
        let serialized = serde_json::to_string_pretty(value)
            .unwrap_or_else(|_| "{\"error\":\"unserializable evidence\"}".to_string());
        let remaining_total = self.max_total_chars.saturating_sub(self.used_chars);
        let limit = self.max_single_chars.min(remaining_total);
        let serialized_chars = serialized.chars().count();
        if serialized_chars <= limit {
            self.used_chars += serialized_chars;
            return Some(value.clone());
        }
        let compacted = truncated_command_value(command_name, value, &serialized, limit)?;
        self.used_chars += serialized_value_chars(&compacted);
        Some(compacted)
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

        let compacted = budget
            .compact_command_value("grep", &value)
            .expect("small result should fit");

        assert_eq!(compacted, value);
        assert_eq!(budget.used_chars, serialized_value_chars(&compacted));
    }

    #[test]
    fn compact_command_value_wraps_truncated_results_with_narrowing_guidance() {
        let mut budget = DekiEvidenceBudget {
            max_single_chars: 420,
            max_total_chars: 420,
            used_chars: 0,
        };
        let value = json!({ "id": "cmd-1", "name": "grep", "ok": true, "output": { "text": "abcdefghijklmnopqrstuvwxyz".repeat(100) } });

        let compacted = budget
            .compact_command_value("grep", &value)
            .expect("truncated wrapper should fit");

        assert_eq!(compacted["id"], json!("cmd-1"));
        assert_eq!(compacted["name"], json!("grep"));
        assert_eq!(compacted["truncated"], json!(true));
        assert!(compacted["narrowing"]
            .as_str()
            .unwrap_or_default()
            .contains("specific query"));
        assert!(serialized_value_chars(&compacted) <= 420);
        assert_eq!(budget.used_chars, serialized_value_chars(&compacted));
    }

    #[test]
    fn compact_command_value_omits_results_that_cannot_fit_the_complete_wrapper() {
        let mut budget = DekiEvidenceBudget {
            max_single_chars: 20,
            max_total_chars: 20,
            used_chars: 0,
        };
        let value = json!({ "id": "cmd-1", "output": "too large" });

        assert!(budget.compact_command_value("grep", &value).is_none());
        assert_eq!(budget.used_chars, 0);
    }

    #[test]
    fn truncate_to_chars_reports_exact_fit() {
        assert_eq!(truncate_to_chars("abcd", 4), ("abcd".to_string(), false));
        assert_eq!(truncate_to_chars("abcde", 4), ("abcd".to_string(), true));
    }
}
