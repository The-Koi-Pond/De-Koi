//! Per-character ElevenLabs delivery tags ("strong Russian accent").
//!
//! Eleven v4 smooths a voice toward fluent native speech, so an accent baked into a clone fades. ElevenLabs'
//! documented lever is an inline audio tag; it holds best when repeated right before each line it should shape.
//! A character's voice row can carry one tag, which the speak route puts in front of every sentence it sends.

use serde_json::Value;

const MAX_DELIVERY_TAG_CHARS: usize = 80;

/// The delivery tag saved on the voice row that uses `voice`, cleaned for use inside `[...]`.
pub(super) fn delivery_tag_for_voice(config: &Value, voice: &str) -> Option<String> {
    let voice = voice.trim();
    if voice.is_empty() {
        return None;
    }
    config
        .get("voiceAssignments")
        .and_then(Value::as_array)?
        .iter()
        .filter(|entry| entry.get("voice").and_then(Value::as_str).map(str::trim) == Some(voice))
        .find_map(|entry| clean_delivery_tag(entry.get("deliveryTag").and_then(Value::as_str)?))
}

fn clean_delivery_tag(raw: &str) -> Option<String> {
    let words = raw
        .chars()
        .filter(|ch| !matches!(ch, '[' | ']' | '<' | '>'))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let tag = words
        .chars()
        .take(MAX_DELIVERY_TAG_CHARS)
        .collect::<String>();
    let tag = tag.trim();
    (!tag.is_empty()).then(|| tag.to_string())
}

/// `text` with `[tag]` in front of every sentence. A sentence ends at `.`, `!`, `?` or `…` (plus any closing
/// quotes or brackets) followed by whitespace.
pub(super) fn tag_each_sentence(text: &str, tag: &str) -> String {
    let marker = format!("[{tag}]");
    let chars = text.chars().collect::<Vec<_>>();
    let mut sentences = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < chars.len() {
        if matches!(chars[index], '.' | '!' | '?' | '…') {
            let mut end = index + 1;
            while end < chars.len() && matches!(chars[end], '.' | '!' | '?' | '…') {
                end += 1;
            }
            while end < chars.len()
                && matches!(chars[end], '"' | '\'' | ')' | ']' | '”' | '’' | '»')
            {
                end += 1;
            }
            if end == chars.len() || chars[end].is_whitespace() {
                sentences.push(chars[start..end].iter().collect::<String>());
                start = end;
                index = end;
                continue;
            }
        }
        index += 1;
    }
    if start < chars.len() {
        sentences.push(chars[start..].iter().collect::<String>());
    }
    sentences
        .iter()
        .map(|sentence| sentence.trim())
        .filter(|sentence| !sentence.is_empty())
        .map(|sentence| format!("{marker} {sentence}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tags_every_sentence() {
        assert_eq!(
            tag_each_sentence(
                "That depends. Panic is expected! Then?  Focus on my voice… Count \"four.\" Hold",
                "strong Russian accent"
            ),
            "[strong Russian accent] That depends. [strong Russian accent] Panic is expected! \
             [strong Russian accent] Then? [strong Russian accent] Focus on my voice… \
             [strong Russian accent] Count \"four.\" [strong Russian accent] Hold"
        );
    }

    #[test]
    fn keeps_decimals_and_ellipses_inside_a_sentence() {
        assert_eq!(
            tag_each_sentence("Take 2.5 ml...now.", "calm"),
            "[calm] Take 2.5 ml...now."
        );
        assert_eq!(tag_each_sentence("   ", "calm"), "");
    }

    #[test]
    fn finds_the_tag_on_the_row_that_uses_the_voice() {
        let config = json!({
            "voiceAssignments": [
                { "characterId": "jester", "voice": "jester-voice", "deliveryTag": "" },
                { "characterId": "doctor", "voice": "doctor-voice", "deliveryTag": "  [strong   Russian accent] " },
                { "characterId": "doctor-pd", "voice": "doctor-voice" }
            ]
        });
        assert_eq!(
            delivery_tag_for_voice(&config, "doctor-voice").as_deref(),
            Some("strong Russian accent")
        );
        assert_eq!(delivery_tag_for_voice(&config, "jester-voice"), None);
        assert_eq!(delivery_tag_for_voice(&config, "someone-else"), None);
        assert_eq!(delivery_tag_for_voice(&json!({}), "doctor-voice"), None);
    }

    #[test]
    fn caps_tag_length_and_drops_markup() {
        let long = "a".repeat(200);
        let config =
            json!({ "voiceAssignments": [{ "voice": "v", "deliveryTag": format!("<b>{long}") }] });
        let tag = delivery_tag_for_voice(&config, "v").expect("tag");
        assert_eq!(tag.chars().count(), MAX_DELIVERY_TAG_CHARS);
        assert!(!tag.contains('<') && !tag.contains('>'));
    }
}
