//! Live workspace events for a Deki turn.
//!
//! The JSON runtime reports what it is doing through a [`DekiEventSink`]; the
//! transport decides where events go (a Tauri channel for the embedded app, an
//! SSE stream for the hostable runtime). Events follow the frontend
//! `DekiWorkspacePromptEvent` contract and never carry hidden protocol frames:
//! only visible narration, command names/arguments, bounded result summaries,
//! and pending approvals.

use super::budget::truncate_to_chars;
use serde_json::{json, Value};
use std::sync::Arc;

const TOOL_OUTPUT_EVENT_MAX_CHARS: usize = 1_200;

type EventCallback = dyn Fn(Value) + Send + Sync;

#[derive(Clone, Default)]
pub(crate) struct DekiEventSink(Option<Arc<EventCallback>>);

impl DekiEventSink {
    pub(crate) fn new(callback: impl Fn(Value) + Send + Sync + 'static) -> Self {
        Self(Some(Arc::new(callback)))
    }

    pub(crate) fn none() -> Self {
        Self(None)
    }

    fn emit(&self, event_type: &str, data: Value) {
        if let Some(callback) = &self.0 {
            callback(json!({ "type": event_type, "data": data }));
        }
    }

    pub(super) fn narration(&self, content: &str) {
        let content = content.trim();
        if !content.is_empty() {
            self.emit("status", json!({ "content": content, "kind": "info" }));
        }
    }

    pub(super) fn retry(&self) {
        self.emit(
            "status",
            json!({
                "content": "Retrying after an unreadable model reply.",
                "kind": "retry",
                "level": "warning",
            }),
        );
    }

    pub(super) fn tool_start(&self, id: &str, name: &str, input: &Value) {
        self.emit(
            "tool_start",
            json!({ "id": id, "name": name, "input": input }),
        );
    }

    pub(super) fn tool_end(&self, id: &str, name: &str, is_error: bool, output: &str) {
        self.emit(
            "tool_end",
            json!({
                "id": id,
                "name": name,
                "isError": is_error,
                "output": bounded_output(output),
            }),
        );
    }

    pub(super) fn approval_pending(&self, approval: &Value) {
        self.emit("approval_pending", approval.clone());
    }
}

pub(super) fn bounded_output(output: &str) -> String {
    let (text, truncated) = truncate_to_chars(output, TOOL_OUTPUT_EVENT_MAX_CHARS);
    if truncated {
        format!("{text}\n[Output truncated.]")
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn recording_sink() -> (DekiEventSink, Arc<Mutex<Vec<Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = DekiEventSink::new({
            let events = events.clone();
            move |event| events.lock().expect("events lock").push(event)
        });
        (sink, events)
    }

    #[test]
    fn events_use_the_frontend_prompt_event_shape() {
        let (sink, events) = recording_sink();

        sink.narration("  Checking the storage owner.  ");
        sink.narration("   ");
        sink.tool_start("deki_r1_c1", "grep", &json!({ "query": "AppShell" }));
        sink.tool_end("deki_r1_c1", "grep", false, &"x".repeat(5_000));

        let events = events.lock().expect("events lock");
        assert_eq!(events.len(), 3, "blank narration is not emitted");
        assert_eq!(events[0]["type"], "status");
        assert_eq!(events[0]["data"]["content"], "Checking the storage owner.");
        assert_eq!(events[1]["type"], "tool_start");
        assert_eq!(events[1]["data"]["input"]["query"], "AppShell");
        let output = events[2]["data"]["output"].as_str().expect("output text");
        assert!(output.ends_with("[Output truncated.]"));
        assert!(output.chars().count() < 1_300);
    }

    #[test]
    fn a_sink_without_a_transport_is_a_no_op() {
        DekiEventSink::none().narration("nobody is listening");
    }
}
