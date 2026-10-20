//! Saves a finished Deki-senpai reply when the client that asked for it is
//! gone. The browser normally saves the reply itself when the stream ends; if
//! the tab was closed or the connection dropped mid-run, the turn still
//! finishes on the server, and this writes the reply into the session the same
//! way the browser would, so it is there when the user comes back.

use crate::state::AppState;
use crate::storage_commands::entity_commands;
use marinara_core::{new_id, AppResult};
use serde_json::{json, Value};

/// Appends `response` (a finished `deki_prompt` response) as the next
/// assistant message of the request's session. Returns false when there is no
/// stored session to add it to.
pub(crate) fn persist_detached_reply(
    state: &AppState,
    request: &Value,
    response: &Value,
) -> AppResult<bool> {
    let Some(session_id) = request
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return Ok(false);
    };
    let content = response
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if content.is_empty() || state.storage.get("deki-sessions", session_id)?.is_none() {
        return Ok(false);
    }
    state.storage.with_exclusive_writes(|| {
        let next_order = state
            .storage
            .list("deki-messages")?
            .iter()
            .filter(|row| row.get("sessionId").and_then(Value::as_str) == Some(session_id))
            .count();
        let now = chrono::Utc::now().to_rfc3339();
        let mut message = json!({
            "id": format!("deki-message-{}", new_id()),
            "sessionId": session_id,
            "role": "assistant",
            "content": content,
            "createdAt": now,
            "sortOrder": next_order,
        });
        if let Some(action) = response
            .get("action")
            .filter(|action| action.get("type").and_then(Value::as_str) != Some("none"))
        {
            message["action"] = action.clone();
            message["actionApplication"] = Value::Null;
        }
        if let Some(trace) = response
            .get("workspaceTrace")
            .filter(|trace| trace.as_array().is_some_and(|items| !items.is_empty()))
        {
            message["workspaceTrace"] = trace.clone();
        }
        entity_commands::storage_create_inner(state, "deki-messages".to_string(), message)?;
        entity_commands::storage_update_inner(
            state,
            "deki-sessions".to_string(),
            session_id.to_string(),
            json!({ "updatedAt": now, "messageCount": next_order + 1 }),
        )?;
        Ok(true)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-deki-detached-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test app state")
    }

    #[test]
    fn a_reply_for_a_stored_session_is_appended_after_its_messages() {
        let state = test_state("appended");
        state
            .storage
            .create(
                "deki-sessions",
                json!({ "id": "session-1", "title": "Ports", "messageCount": 1 }),
            )
            .expect("session");
        state
            .storage
            .create(
                "deki-messages",
                json!({ "id": "m-1", "sessionId": "session-1", "role": "user", "content": "Which port?", "sortOrder": 0 }),
            )
            .expect("user message");

        let saved = persist_detached_reply(
            &state,
            &json!({ "sessionId": "session-1" }),
            &json!({
                "content": "Port 8787.",
                "action": { "type": "none" },
                "workspaceTrace": [{ "type": "status", "content": "Checked." }]
            }),
        )
        .expect("persist");

        assert!(saved);
        let messages = state.storage.list("deki-messages").expect("messages");
        let reply = messages
            .iter()
            .find(|row| row["role"] == json!("assistant"))
            .expect("reply saved");
        assert_eq!(reply["content"], json!("Port 8787."));
        assert_eq!(reply["sortOrder"], json!(1));
        assert!(reply.get("action").is_none(), "a none action is not stored");
        assert_eq!(reply["workspaceTrace"][0]["content"], json!("Checked."));
        let session = state
            .storage
            .get("deki-sessions", "session-1")
            .expect("read")
            .expect("session");
        assert_eq!(session["messageCount"], json!(2));
    }

    #[test]
    fn replies_without_a_stored_session_are_not_saved() {
        let state = test_state("no-session");
        let response = json!({ "content": "Hi." });
        assert!(
            !persist_detached_reply(&state, &json!({ "sessionId": "missing" }), &response).unwrap()
        );
        assert!(!persist_detached_reply(&state, &json!({}), &response).unwrap());
        assert!(state.storage.list("deki-messages").unwrap().is_empty());
    }
}
