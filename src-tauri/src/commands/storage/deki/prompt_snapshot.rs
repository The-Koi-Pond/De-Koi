//! Snapshot of the first model request of a Deki-senpai turn, so a PR that
//! changes Deki's prompt shows the change as a plain-text diff.
//!
//! Update after an intended prompt change: `pnpm test:prompt-snapshots:update`

use super::model_client::DekiModelMessage;
use super::{command_loop, prompt, DekiPromptRequest};
use serde_json::{json, Value};
use std::path::PathBuf;

const UPDATE_ENV: &str = "UPDATE_PROMPT_SNAPSHOTS";
const UPDATE_COMMAND: &str = "pnpm test:prompt-snapshots:update";

/// Public-domain demo data only. The question avoids codebase words on purpose:
/// a codebase question pulls the live AGENTS.md map into the prompt, which
/// would make this snapshot change on every unrelated AGENTS.md edit.
fn fixture_request_body() -> Value {
    json!({
        "sessionId": "snapshot-session",
        "connectionId": "conn-snapshot",
        "persona": {
            "name": "Jo",
            "description": "A hobby writer who collects Victorian detective stories.",
            "personality": "Curious, quick to laugh, likes concrete feedback."
        },
        "messages": [
            {
                "role": "user",
                "content": "Hi Deki! I imported a Sherlock Holmes card from a public domain pack."
            },
            {
                "role": "assistant",
                "content": "Welcome, Jo! Holmes is a great pick. I found the card in your library; tell me what you'd like to tighten.",
                "workspaceTrace": [
                    {
                        "type": "tool",
                        "tool": {
                            "id": "trace-1",
                            "name": "read_deki_library",
                            "status": "done",
                            "input": { "collections": ["characters"] },
                            "output": "characters: 1 (Sherlock Holmes, id char-holmes)"
                        }
                    }
                ]
            }
        ],
        "userMessage": "Can you look over my Sherlock Holmes character card? His scenario feels thin next to his personality."
    })
}

/// The messages a turn sends on its first model call, as the runtime builds them.
fn first_round_messages() -> Vec<DekiModelMessage> {
    let input: DekiPromptRequest =
        serde_json::from_value(fixture_request_body()).expect("fixture should parse");
    assert!(
        !prompt::looks_like_codebase_question(&input.user_message),
        "fixture must not pull the live AGENTS.md map into the snapshot"
    );
    let system_prompt = prompt::build_system_prompt(input.persona.as_ref());
    let task_prompt = prompt::build_task_prompt(&input, None, None);
    command_loop::initial_messages(
        &system_prompt,
        task_prompt,
        prompt::plan_image_attachments(&input.attachments).images,
    )
}

fn render(messages: &[(String, String, usize)]) -> String {
    let mut out = format!(
        "# Prompt snapshot: deki\n# Update after an intended prompt change: {UPDATE_COMMAND}\n# {} messages sent to the model, in order.\n",
        messages.len()
    );
    for (index, (role, content, images)) in messages.iter().enumerate() {
        let images = if *images > 0 {
            format!(" | images={images}")
        } else {
            String::new()
        };
        out.push_str(&format!(
            "\n=== [{}/{}] {role}{images} ===\n{content}\n",
            index + 1,
            messages.len()
        ));
    }
    out
}

fn snapshot_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/unit/prompt-snapshots/deki.txt")
}

/// A short line diff (longest common subsequence) so a failure reads like a text diff.
fn line_diff(expected: &str, actual: &str) -> String {
    let old: Vec<&str> = expected.lines().collect();
    let new: Vec<&str> = actual.lines().collect();
    let mut lcs = vec![vec![0usize; new.len() + 1]; old.len() + 1];
    for i in (0..old.len()).rev() {
        for j in (0..new.len()).rev() {
            lcs[i][j] = if old[i] == new[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }
    let (mut i, mut j, mut out) = (0, 0, Vec::new());
    while i < old.len() || j < new.len() {
        if i < old.len() && j < new.len() && old[i] == new[j] {
            i += 1;
            j += 1;
        } else if j < new.len() && (i == old.len() || lcs[i][j + 1] >= lcs[i + 1][j]) {
            out.push(format!("+ {}", new[j]));
            j += 1;
        } else {
            out.push(format!("- {}", old[i]));
            i += 1;
        }
    }
    out.join("\n")
}

#[test]
fn deki_first_request_matches_snapshot() {
    let messages = first_round_messages()
        .iter()
        .map(|message| {
            (
                message.role().to_string(),
                message.content().to_string(),
                message.images().len(),
            )
        })
        .collect::<Vec<_>>();
    let actual = render(&messages);
    let path = snapshot_path();
    if std::env::var_os(UPDATE_ENV).is_some() {
        std::fs::write(&path, &actual).expect("snapshot should be writable");
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    assert!(
        expected == actual,
        "Deki prompt snapshot changed ({}).\nIf the change is intended, run: {UPDATE_COMMAND}\n\n{}",
        path.display(),
        line_diff(&expected, &actual)
    );
}
