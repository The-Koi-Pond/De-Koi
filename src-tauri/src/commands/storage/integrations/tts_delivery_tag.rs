//! Per-character ElevenLabs delivery tags ("strong Russian accent").
//!
//! Eleven v4 smooths a voice toward fluent native speech, so an accent baked into a clone fades. ElevenLabs'
//! documented lever is an inline audio tag; it holds best when repeated right before each line it should shape.
//! A character's voice row can carry one tag, which the speak route puts in front of every sentence it sends.
//! When the row's box is empty, an accent named on the character's card ("speaks with a thick Scottish accent")
//! is used instead, so nobody has to type it. Typing "none" turns the tag off for that voice.

use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

const MAX_DELIVERY_TAG_CHARS: usize = 80;

/// Card fields that describe the character themself, read in this order.
const CARD_ACCENT_FIELDS: &[&str] = &["description", "personality", "system_prompt"];

/// "[intensity] Nationality accent", where the nationality is one or two capitalised words.
static CARD_ACCENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?:\b(?i:(thick|heavy|strong|broad|slight|faint|light|mild|soft|subtle|noticeable|distinct|lilting|posh|refined|clipped|rough|crisp))\s+)?\b([A-Z][a-z]+(?:[- ][A-Z][a-z]+)?)\s+(?i:accent)\b",
    )
    .expect("card accent pattern compiles")
});

/// Capitalised words that start a sentence or point at someone, not a place: "His Russian accent" is Russian.
const NOT_A_NATIONALITY: &[&str] = &[
    "A", "An", "The", "His", "Her", "Hers", "Their", "Its", "Your", "My", "Our", "This", "That",
    "No", "Any", "Some", "With", "Fake", "Faked", "Put", "Speaks", "Has",
];

/// The delivery tag for `voice`: the one typed on its voice row, else an accent named on that row's character
/// card (looked up with `card_for`), cleaned for use inside `[...]`. "none" or "off" on the row means no tag.
pub(super) fn delivery_tag_for_voice(
    config: &Value,
    voice: &str,
    card_for: impl Fn(&str) -> Option<Value>,
) -> Option<String> {
    let voice = voice.trim();
    if voice.is_empty() {
        return None;
    }
    let rows = config
        .get("voiceAssignments")
        .and_then(Value::as_array)?
        .iter()
        .filter(|entry| entry.get("voice").and_then(Value::as_str).map(str::trim) == Some(voice))
        .collect::<Vec<_>>();
    if let Some(typed) = rows
        .iter()
        .find_map(|entry| clean_delivery_tag(entry.get("deliveryTag").and_then(Value::as_str)?))
    {
        return (!matches!(typed.to_ascii_lowercase().as_str(), "none" | "off")).then_some(typed);
    }
    rows.iter().find_map(|entry| {
        let character_id = entry.get("characterId").and_then(Value::as_str)?.trim();
        if character_id.is_empty() {
            return None;
        }
        accent_tag_from_card(&card_for(character_id)?)
    })
}

/// "strong Scottish accent" when the card's own description, personality or system prompt names an accent.
/// A soft wording ("a faint Irish accent") stays soft; anything else is strong, as ElevenLabs' tag guide writes it.
pub(super) fn accent_tag_from_card(card: &Value) -> Option<String> {
    let data = card.get("data").unwrap_or(card);
    CARD_ACCENT_FIELDS
        .iter()
        .filter_map(|field| data.get(*field).and_then(Value::as_str))
        .find_map(accent_tag_from_text)
}

fn accent_tag_from_text(text: &str) -> Option<String> {
    CARD_ACCENT.captures_iter(text).find_map(|found| {
        let whole = found.get(0)?;
        let before = &text[..whole.start()];
        let lead_in = before
            .char_indices()
            .rev()
            .nth(24)
            .map_or(before, |(index, _)| &before[index..]);
        if lead_in.to_ascii_lowercase().contains("user") {
            return None;
        }
        let place = found
            .get(2)?
            .as_str()
            .split([' ', '-'])
            .skip_while(|word| NOT_A_NATIONALITY.contains(word))
            .collect::<Vec<_>>()
            .join(" ");
        if place.is_empty() {
            return None;
        }
        let soft = found.get(1).is_some_and(|word| {
            matches!(
                word.as_str().to_ascii_lowercase().as_str(),
                "slight" | "faint" | "light" | "mild" | "soft" | "subtle"
            )
        });
        let intensity = if soft { "slight" } else { "strong" };
        clean_delivery_tag(&format!("{intensity} {place} accent"))
    })
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
            delivery_tag_for_voice(&config, "doctor-voice", no_cards).as_deref(),
            Some("strong Russian accent")
        );
        assert_eq!(
            delivery_tag_for_voice(&config, "jester-voice", no_cards),
            None
        );
        assert_eq!(
            delivery_tag_for_voice(&config, "someone-else", no_cards),
            None
        );
        assert_eq!(
            delivery_tag_for_voice(&json!({}), "doctor-voice", no_cards),
            None
        );
    }

    #[test]
    fn caps_tag_length_and_drops_markup() {
        let long = "a".repeat(200);
        let config =
            json!({ "voiceAssignments": [{ "voice": "v", "deliveryTag": format!("<b>{long}") }] });
        let tag = delivery_tag_for_voice(&config, "v", no_cards).expect("tag");
        assert_eq!(tag.chars().count(), MAX_DELIVERY_TAG_CHARS);
        assert!(!tag.contains('<') && !tag.contains('>'));
    }

    fn no_cards(_: &str) -> Option<Value> {
        None
    }

    fn card(description: &str) -> Value {
        json!({ "data": { "name": "Someone", "description": description, "personality": "", "system_prompt": "" } })
    }

    #[test]
    fn an_empty_box_uses_the_accent_on_the_card() {
        let config = json!({ "voiceAssignments": [
            { "characterId": "fergus", "voice": "fergus-voice", "deliveryTag": "" },
            { "characterId": "mira", "voice": "mira-voice", "deliveryTag": "   " },
            { "characterId": "doctor", "voice": "doctor-voice", "deliveryTag": "none" },
            { "characterId": "plain", "voice": "plain-voice" }
        ]});
        let cards = |id: &str| match id {
            "fergus" => Some(card("A ferryman who speaks with a thick Scottish accent.")),
            "mira" => Some(card("Mira hums. She has a faint Irish accent when tired.")),
            "doctor" => Some(card("A surgeon with a heavy Russian accent.")),
            "plain" => Some(card("Speaks in short, clinical sentences.")),
            _ => None,
        };
        assert_eq!(
            delivery_tag_for_voice(&config, "fergus-voice", cards).as_deref(),
            Some("strong Scottish accent")
        );
        assert_eq!(
            delivery_tag_for_voice(&config, "mira-voice", cards).as_deref(),
            Some("slight Irish accent")
        );
        // "none" turns the card's accent off for that voice.
        assert_eq!(delivery_tag_for_voice(&config, "doctor-voice", cards), None);
        assert_eq!(delivery_tag_for_voice(&config, "plain-voice", cards), None);
    }

    #[test]
    fn a_typed_tag_beats_the_card() {
        let config = json!({ "voiceAssignments": [
            { "characterId": "fergus", "voice": "v", "deliveryTag": "soft-spoken, posh British accent" }
        ]});
        let cards = |_: &str| Some(card("Speaks with a thick Scottish accent."));
        assert_eq!(
            delivery_tag_for_voice(&config, "v", cards).as_deref(),
            Some("soft-spoken, posh British accent")
        );
    }

    #[test]
    fn reads_accents_the_way_cards_write_them() {
        let tag = |text: &str| accent_tag_from_card(&card(text));
        assert_eq!(
            tag("His Russian accent thickens when angry.").as_deref(),
            Some("strong Russian accent")
        );
        assert_eq!(
            tag("Thick Southern accent, slow drawl.").as_deref(),
            Some("strong Southern accent")
        );
        assert_eq!(
            tag("a Russian-American accent").as_deref(),
            Some("strong Russian American accent")
        );
        assert_eq!(
            tag("She speaks with a light French ACCENT.").as_deref(),
            Some("slight French accent")
        );
        assert_eq!(tag("No accent to speak of."), None);
        assert_eq!(tag("He teases {{user}}'s Boston accent."), None);
        assert_eq!(tag("an accent you can't place"), None);
        // Personality and the system prompt count too; other fields (greetings, examples) don't.
        let personality = json!({ "data": { "description": "Tall.", "personality": "Gruff, broad Yorkshire accent." } });
        assert_eq!(
            accent_tag_from_card(&personality).as_deref(),
            Some("strong Yorkshire accent")
        );
        let greeting = json!({ "data": { "description": "Tall.", "first_mes": "\"Och,\" he says in a Scottish accent." } });
        assert_eq!(accent_tag_from_card(&greeting), None);
    }
}
