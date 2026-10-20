//! Streams Deki-senpai's final answer while the model writes its JSON command
//! frame. The protocol asks for `commands` and `stop` before `say`, so once a
//! frame shows `"commands": []` its `say` is the answer and can be shown as it
//! arrives. A frame that lists commands, or writes `say` before `commands`,
//! streams nothing and its text appears when the round ends, as before.
//! Hidden `<deki_action>` blocks are never streamed.

const ACTION_OPEN_TAG: &str = "<deki_action>";

pub(super) struct AnswerStream {
    raw: String,
    emitted_chars: usize,
    enabled: bool,
}

impl AnswerStream {
    pub(super) fn new(enabled: bool) -> Self {
        Self {
            raw: String::new(),
            emitted_chars: 0,
            enabled,
        }
    }

    /// Adds model output and returns the answer text that just became visible.
    pub(super) fn push(&mut self, delta: &str) -> Option<String> {
        self.raw.push_str(delta);
        if !self.enabled {
            return None;
        }
        let visible = visible_answer(&self.raw)?;
        let count = visible.chars().count();
        if count <= self.emitted_chars {
            return None;
        }
        let fresh = visible.chars().skip(self.emitted_chars).collect::<String>();
        self.emitted_chars = count;
        Some(fresh)
    }

    /// True once any answer text was shown, so an abandoned round must clear it.
    pub(super) fn emitted_any(&self) -> bool {
        self.emitted_chars > 0
    }

    /// Forgets the model output so far because the reply was started over.
    /// Returns true when shown answer text has to be cleared.
    pub(super) fn restart(&mut self) -> bool {
        let shown = self.emitted_any();
        self.raw.clear();
        self.emitted_chars = 0;
        shown
    }
}

/// The answer visible so far: the decoded `say` string of a frame whose
/// `commands` array was already seen to be empty, cut before any hidden action
/// block (or a partial `<deki_action>` tag at the end).
fn visible_answer(raw: &str) -> Option<String> {
    let start = raw.find('{')?;
    let bytes = raw.as_bytes();
    let mut depth = 0usize;
    let mut index = start;
    let mut key: Option<String> = None;
    let mut expecting_key = false;
    let mut commands_empty: Option<bool> = None;
    while index < bytes.len() {
        let ch = bytes[index];
        match ch {
            b'{' | b'[' => {
                if depth == 1 && key.as_deref() == Some("commands") && ch == b'[' {
                    let rest = raw[index + 1..].trim_start();
                    if rest.is_empty() {
                        return None;
                    }
                    commands_empty = Some(rest.starts_with(']'));
                }
                depth += 1;
                expecting_key = ch == b'{' && depth == 1;
                index += 1;
            }
            b'}' | b']' => {
                depth = depth.saturating_sub(1);
                index += 1;
            }
            b',' => {
                if depth == 1 {
                    expecting_key = true;
                    key = None;
                }
                index += 1;
            }
            b'"' => {
                let (text, end, closed) = decode_string(raw, index + 1);
                if depth == 1 && expecting_key {
                    if !closed {
                        return None;
                    }
                    key = Some(text);
                    expecting_key = false;
                } else if depth == 1 && key.as_deref() == Some("say") {
                    if commands_empty != Some(true) {
                        return None;
                    }
                    return Some(hide_action(text.trim_start()));
                }
                if !closed {
                    return None;
                }
                index = end;
            }
            _ => index += 1,
        }
    }
    None
}

/// Decodes a JSON string starting just after its opening quote. Returns the
/// text, the index after the closing quote, and whether the string closed. An
/// escape cut off at the end of the input stops decoding before it.
fn decode_string(raw: &str, from: usize) -> (String, usize, bool) {
    let mut text = String::new();
    let mut chars = raw[from..].char_indices();
    while let Some((offset, ch)) = chars.next() {
        match ch {
            '"' => return (text, from + offset + 1, true),
            '\\' => {
                let Some((_, escaped)) = chars.next() else {
                    return (text, raw.len(), false);
                };
                match escaped {
                    'n' => text.push('\n'),
                    't' => text.push('\t'),
                    'r' => text.push('\r'),
                    'b' => text.push('\u{8}'),
                    'f' => text.push('\u{c}'),
                    'u' => {
                        let hex = chars.by_ref().take(4).map(|(_, ch)| ch).collect::<String>();
                        if hex.len() < 4 {
                            return (text, raw.len(), false);
                        }
                        if let Some(decoded) =
                            u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32)
                        {
                            text.push(decoded);
                        }
                    }
                    other => text.push(other),
                }
            }
            other => text.push(other),
        }
    }
    (text, raw.len(), false)
}

fn hide_action(text: &str) -> String {
    if let Some(index) = text.find(ACTION_OPEN_TAG) {
        return text[..index].trim_end().to_string();
    }
    // Hold back a trailing "<deki_ac..." that may become the tag, and the
    // whitespace before it, so every visible text is a prefix of the next.
    for cut in (1..ACTION_OPEN_TAG.len()).rev() {
        if text.ends_with(&ACTION_OPEN_TAG[..cut]) {
            return text[..text.len() - cut].trim_end().to_string();
        }
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream_all(chunks: &[&str]) -> String {
        let mut stream = AnswerStream::new(true);
        chunks
            .iter()
            .filter_map(|chunk| stream.push(chunk))
            .collect::<String>()
    }

    #[test]
    fn a_final_frame_streams_its_say_as_it_arrives() {
        let streamed = stream_all(&[
            "{\"commands\": [], \"stop\": true, \"say\": \"It is ",
            "256, in `http_",
            "server.rs`.\\nDone\"}",
        ]);
        assert_eq!(streamed, "It is 256, in `http_server.rs`.\nDone");
    }

    #[test]
    fn a_restarted_reply_streams_only_the_new_answer() {
        let mut stream = AnswerStream::new(true);
        assert_eq!(
            stream.push("{\"commands\": [], \"stop\": true, \"say\": \"Port 80"),
            Some("Port 80".to_string())
        );
        assert!(stream.restart(), "shown text must be cleared");
        assert_eq!(
            stream.push("{\"commands\": [], \"stop\": true, \"say\": \"Port 8787.\"}"),
            Some("Port 8787.".to_string())
        );
        assert!(!AnswerStream::new(true).restart());
    }

    #[test]
    fn frames_with_commands_or_say_first_stream_nothing() {
        assert_eq!(
            stream_all(&["{\"commands\":[{\"name\":\"grep\",\"args\":{\"query\":\"a\"}}],\"say\":\"Checking\"}"]),
            ""
        );
        assert_eq!(
            stream_all(&["{\"say\":\"Answer\",\"commands\":[],\"stop\":true}"]),
            ""
        );
        let mut disabled = AnswerStream::new(false);
        assert!(disabled
            .push("{\"commands\":[],\"stop\":true,\"say\":\"x\"}")
            .is_none());
    }

    #[test]
    fn hidden_action_blocks_and_split_escapes_are_held_back() {
        let streamed = stream_all(&[
            "```json\n{\"commands\":[],\"stop\":true,\"say\":\"Here is the card.\\n<deki_",
            "action>{\\\"type\\\":\\\"create_record\\\"}</deki_action>\"}",
        ]);
        assert_eq!(streamed, "Here is the card.");

        let unicode = stream_all(&[
            "{\"commands\":[],\"stop\":true,\"say\":\"caf\\u00",
            "e9 \\\"ok\\\"\"}",
        ]);
        assert_eq!(unicode, "café \"ok\"");
    }

    #[test]
    fn strings_with_braces_in_earlier_keys_do_not_confuse_the_scanner() {
        let streamed = stream_all(&[
            "{\"note\":\"a } b { c\",\"commands\":[ ],\"stop\":true,\"say\":\"fine\"}",
        ]);
        assert_eq!(streamed, "fine");
    }
}
