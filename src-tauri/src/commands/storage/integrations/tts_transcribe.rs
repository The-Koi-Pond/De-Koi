//! Speech-to-text for voice input and voice calls, using the provider already set up for Text to Speech
//! (OpenAI-compatible `/audio/transcriptions`, or ElevenLabs Scribe). Audio arrives base64-encoded from the app.

use super::*;

/// OpenAI's upload limit is 25 MB; stay under it so a long clip fails here with a clear message.
const MAX_AUDIO_BYTES: usize = 20 * 1024 * 1024;
const DEFAULT_OPENAI_STT_MODEL: &str = "whisper-1";
const DEFAULT_ELEVENLABS_STT_MODEL: &str = "scribe_v1";

fn audio_file_name(mime_type: &str) -> &'static str {
    let mime = mime_type.split(';').next().unwrap_or("").trim();
    match mime {
        "audio/webm" => "speech.webm",
        "audio/ogg" => "speech.ogg",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "speech.m4a",
        "audio/mpeg" | "audio/mp3" => "speech.mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "speech.wav",
        _ => "speech.webm",
    }
}

pub(super) async fn transcribe(state: &AppState, body: Value) -> AppResult<Value> {
    let audio_base64 = required_string(&body, "audioBase64")?;
    let mime_type = body
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("audio/webm")
        .to_string();
    let audio = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.trim())
        .map_err(|_| AppError::invalid_input("Recorded audio is not valid base64"))?;
    if audio.is_empty() {
        return Err(AppError::invalid_input("Recorded audio is empty"));
    }
    if audio.len() > MAX_AUDIO_BYTES {
        return Err(AppError::invalid_input(
            "Recording is too long to transcribe (20 MB max)",
        ));
    }
    let config = load_config(state)?;
    let source = config
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("openai");
    if source == "pockettts" {
        return Err(AppError::invalid_input(
            "PocketTTS can't transcribe speech. Pick OpenAI or ElevenLabs in Connections → Text to Speech, or use the browser's speech recognition.",
        ));
    }
    let api_key = config.get("apiKey").and_then(Value::as_str).unwrap_or("");
    if api_key.is_empty() {
        return Err(AppError::invalid_input(
            "Speech-to-text uses your Text to Speech provider key; add one in Connections → Text to Speech",
        ));
    }
    let base = configured_base_url(&config);
    let language = config
        .get("elevenLabsLanguageCode")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let configured_model = config
        .get("sttModel")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let file = reqwest::multipart::Part::bytes(audio)
        .file_name(audio_file_name(&mime_type))
        .mime_str(mime_type.split(';').next().unwrap_or("audio/webm").trim())
        .map_err(|error| AppError::invalid_input(format!("Unsupported audio type: {error}")))?;

    let use_nano_gpt = is_nano_gpt_base_url(&base);
    let (url, headers, form) = if source == "elevenlabs" && !use_nano_gpt {
        let model = if configured_model.is_empty() {
            DEFAULT_ELEVENLABS_STT_MODEL.to_string()
        } else {
            configured_model
        };
        let mut form = reqwest::multipart::Form::new()
            .part("file", file)
            .text("model_id", model);
        if !language.is_empty() {
            form = form.text("language_code", language);
        }
        (
            format!("{}/v1/speech-to-text", elevenlabs_api_root(&base)),
            elevenlabs_headers(api_key)?,
            form,
        )
    } else {
        let model = if configured_model.is_empty() {
            DEFAULT_OPENAI_STT_MODEL.to_string()
        } else {
            configured_model
        };
        let root = if use_nano_gpt {
            nano_gpt_v1_base_url(&base)
        } else {
            base.clone()
        };
        let headers = if use_nano_gpt {
            nano_gpt_headers(api_key)?
        } else {
            openai_headers(api_key)?
        };
        (
            format!("{root}/audio/transcriptions"),
            headers,
            reqwest::multipart::Form::new()
                .part("file", file)
                .text("model", model)
                .text("response_format", "json"),
        )
    };
    validate_tts_provider_url(&url, source).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(tts_request_timeout_ms(&config)))
        .build()
        .map_err(|error| AppError::new("stt_client_error", error.to_string()))?;
    let response = client
        .post(url)
        .headers(headers)
        .multipart(form)
        .send()
        .await
        .map_err(|error| AppError::new("stt_provider_error", error.to_string()))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| AppError::new("stt_provider_error", error.to_string()))?;
    if !status.is_success() {
        return Err(AppError::new(
            "stt_provider_error",
            format!(
                "Speech-to-text provider returned HTTP {status}: {}",
                text.chars().take(300).collect::<String>()
            ),
        ));
    }
    let parsed: Value = serde_json::from_str(&text).map_err(|_| {
        AppError::new(
            "stt_provider_error",
            "Speech-to-text provider returned something that isn't JSON",
        )
    })?;
    let transcript = parsed
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    Ok(json!({ "text": transcript }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorded_audio_gets_a_file_name_the_provider_recognizes() {
        assert_eq!(audio_file_name("audio/webm;codecs=opus"), "speech.webm");
        assert_eq!(audio_file_name("audio/mp4"), "speech.m4a");
        assert_eq!(audio_file_name("audio/ogg; codecs=opus"), "speech.ogg");
        assert_eq!(audio_file_name("application/octet-stream"), "speech.webm");
    }
}
