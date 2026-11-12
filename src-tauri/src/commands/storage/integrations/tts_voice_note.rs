//! Voice notes: a character's spoken message, made once with Text to Speech and kept as a managed file in
//! `voice-notes/<chat id>/`, so it replays without a new provider request, travels in backups and profile exports,
//! and is deleted with its chat.

use super::super::super::media_uploads::{file_path_asset_url, unique_file_path};
use super::*;
use std::path::PathBuf;

/// A voice note is a short message, not a narration: longer text is refused rather than cut off mid-sentence.
pub(super) const MAX_VOICE_NOTE_CHARS: usize = 600;
pub(crate) const VOICE_NOTES_DIR: &str = "voice-notes";

fn voice_note_extension(content_type: &str) -> &'static str {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/ogg" => "ogg",
        "audio/webm" => "webm",
        _ => "mp3",
    }
}

/// Chat ids become folder names, so only plain ids are accepted (no dots, separators or drive prefixes).
fn is_plain_chat_id(chat_id: &str) -> bool {
    !chat_id.is_empty()
        && chat_id.len() <= 128
        && chat_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
}

fn voice_note_chat_dir(state: &AppState, chat_id: &str) -> AppResult<PathBuf> {
    if !is_plain_chat_id(chat_id) {
        return Err(AppError::invalid_input("Voice note needs a valid chat id"));
    }
    Ok(state.data_dir.join(VOICE_NOTES_DIR).join(chat_id))
}

/// The folder holding one chat's voice notes, for deleting them with the chat.
pub(crate) fn voice_note_dir_for_chat(state: &AppState, chat_id: &str) -> Option<PathBuf> {
    voice_note_chat_dir(state, chat_id).ok()
}

pub(super) async fn create_voice_note(state: &AppState, body: Value) -> AppResult<Value> {
    let chat_id = body
        .get("chatId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let dir = voice_note_chat_dir(state, &chat_id)?;
    let text = body
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if text.is_empty() {
        return Err(AppError::invalid_input("Voice note text is empty"));
    }
    if text.chars().count() > MAX_VOICE_NOTE_CHARS {
        return Err(AppError::invalid_input(format!(
            "Voice note text is longer than {MAX_VOICE_NOTE_CHARS} characters"
        )));
    }

    let mut speech = json!({ "text": text });
    for key in ["voice", "speaker", "tone"] {
        if let Some(value) = body
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            speech[key] = Value::String(value.to_string());
        }
    }
    let audio = speak(state, speech).await?;
    let content_type = audio
        .get("contentType")
        .and_then(Value::as_str)
        .unwrap_or("audio/mpeg")
        .to_string();
    let encoded = audio
        .get("audioBase64")
        .and_then(Value::as_str)
        .unwrap_or("");
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| AppError::new("tts_provider_error", error.to_string()))?;
    if bytes.is_empty() {
        return Err(AppError::new(
            "tts_provider_error",
            "TTS provider returned no audio",
        ));
    }

    let target = unique_file_path(&dir.join(format!(
        "voice-{}.{}",
        new_id(),
        voice_note_extension(&content_type)
    )))?;
    write_managed_file_atomically(&target, &bytes)?;
    let filename = target
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(json!({
        "url": file_path_asset_url(&target),
        "filename": filename,
        "contentType": content_type,
        "bytes": bytes.len(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_note_extension_follows_the_provider_content_type() {
        assert_eq!(voice_note_extension("audio/mpeg"), "mp3");
        assert_eq!(voice_note_extension("audio/wav; codecs=1"), "wav");
        assert_eq!(voice_note_extension("application/octet-stream"), "mp3");
    }

    #[test]
    fn voice_note_folder_refuses_chat_ids_that_are_not_plain_names() {
        assert!(is_plain_chat_id("7266708d-chat_1"));
        for bad in ["", "..", "../chat-1", "a/b", r"a\b", "C:chat"] {
            assert!(!is_plain_chat_id(bad), "{bad:?} should be refused");
        }
    }
}
