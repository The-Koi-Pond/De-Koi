use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use image::ImageFormat;
use marinara_core::{AppError, AppResult};
use marinara_security::redact_sensitive_text;
use serde_json::Value;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tokio::process::Command;

const CODEX_IMAGEGEN_TIMEOUT_SECS: u64 = 360;
const CODEX_GENERATED_IMAGE_POLL_ATTEMPTS: usize = 20;
const CODEX_GENERATED_IMAGE_POLL_DELAY_MS: u64 = 500;
const DEFAULT_CODEX_CLI_EXECUTABLE: &str = "codex";
const CODEX_CLI_PATH_ENV: &str = "CODEX_CLI_PATH";
const DEFAULT_CODEX_IMAGEGEN_MODEL: &str = "gpt-5.5";
const CODEX_IMAGEGEN_MODEL_ENV: &str = "CODEX_IMAGEGEN_MODEL";

pub(crate) async fn generate_codex_subscription_image(
    prompt: &str,
    width: u64,
    height: u64,
    negative_prompt: Option<&str>,
    transparent_background: bool,
    reference_images: &[String],
) -> AppResult<(String, String)> {
    if !reference_images.is_empty() {
        return Err(AppError::invalid_input(
            "Codex subscription image generation does not support reference images yet",
        ));
    }

    let request = codex_imagegen_prompt(
        prompt,
        width,
        height,
        negative_prompt,
        transparent_background,
    );
    let cwd = env::current_dir().map_err(AppError::io)?;
    let args = codex_exec_args(&cwd, request);
    let output = tokio::time::timeout(
        Duration::from_secs(CODEX_IMAGEGEN_TIMEOUT_SECS),
        Command::new(codex_cli_executable()).args(args).output(),
    )
    .await
    .map_err(|_| {
        AppError::new(
            "image_timeout",
            "Codex image generation did not finish before the timeout",
        )
    })?
    .map_err(|error| AppError::new("image_network_error", codex_start_error_message(&error)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(AppError::new(
            "image_provider_error",
            format!(
                "Codex image generation failed: {}",
                truncate_error(&redact_sensitive_text(stderr.trim()))
            ),
        ));
    }

    let thread_id = parse_codex_thread_id_from_jsonl(&stdout).ok_or_else(|| {
        AppError::new(
            "image_response_error",
            "Codex did not report a generated-image thread id",
        )
    })?;
    let image_path = wait_for_codex_generated_image(&thread_id).await?;
    image_file_base64(&image_path)
}

fn codex_exec_args(cwd: &Path, request: String) -> Vec<OsString> {
    codex_exec_args_with_model(cwd, request, codex_imagegen_model())
}

fn codex_exec_args_with_model(cwd: &Path, request: String, model: OsString) -> Vec<OsString> {
    vec![
        OsString::from("exec"),
        OsString::from("--skip-git-repo-check"),
        OsString::from("--ignore-rules"),
        OsString::from("--json"),
        OsString::from("-m"),
        model,
        OsString::from("--cd"),
        cwd.as_os_str().to_os_string(),
        OsString::from("-s"),
        OsString::from("read-only"),
        OsString::from(request),
    ]
}
fn codex_cli_executable() -> OsString {
    fallback_env_os(
        env::var_os(CODEX_CLI_PATH_ENV),
        DEFAULT_CODEX_CLI_EXECUTABLE,
    )
}

fn codex_imagegen_model() -> OsString {
    fallback_env_os(
        env::var_os(CODEX_IMAGEGEN_MODEL_ENV),
        DEFAULT_CODEX_IMAGEGEN_MODEL,
    )
}

fn fallback_env_os(value: Option<OsString>, fallback: &str) -> OsString {
    value
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| OsString::from(fallback))
}

fn codex_start_error_message(error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        return format!(
            "Failed to start local Codex CLI. Install Codex CLI in the De-Koi server environment or set {CODEX_CLI_PATH_ENV}, then run `codex login`. Pi/Docker installs need a server image with @openai/codex and CODEX_HOME mounted to /root/.codex. ({error})"
        );
    }
    format!("Failed to start local Codex CLI: {error}")
}
fn codex_imagegen_prompt(
    prompt: &str,
    width: u64,
    height: u64,
    negative_prompt: Option<&str>,
    transparent_background: bool,
) -> String {
    let mut request = format!(
        "Use $imagegen to create exactly one image. Do not use the OpenAI API, API keys, curl, or any external image provider. Use the logged-in Codex subscription image-generation tool only. Desired size: {width}x{height} pixels. Prompt: {prompt}."
    );
    if let Some(negative) = negative_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request.push_str(" Avoid: ");
        request.push_str(negative);
        request.push('.');
    }
    if transparent_background {
        request.push_str(" Use a transparent background.");
    }
    request.push_str(
        " Do not edit repository files and do not run shell commands. Final answer only: GENERATED_IMAGE_READY.",
    );
    request
}

fn parse_codex_thread_id_from_jsonl(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let value: Value = serde_json::from_str(line).ok()?;
        if value.get("type").and_then(Value::as_str) != Some("thread.started") {
            return None;
        }
        value
            .get("thread_id")
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

async fn wait_for_codex_generated_image(thread_id: &str) -> AppResult<PathBuf> {
    let dir = codex_generated_images_dir(thread_id)?;
    for _ in 0..CODEX_GENERATED_IMAGE_POLL_ATTEMPTS {
        if let Some(path) = newest_generated_image(generated_image_candidates(&dir)?) {
            return Ok(path);
        }
        tokio::time::sleep(Duration::from_millis(CODEX_GENERATED_IMAGE_POLL_DELAY_MS)).await;
    }
    Err(AppError::new(
        "image_response_error",
        format!("Codex completed but no generated image was found for thread {thread_id}"),
    ))
}

fn codex_generated_images_dir(thread_id: &str) -> AppResult<PathBuf> {
    Ok(codex_home_dir()?.join("generated_images").join(thread_id))
}

fn codex_home_dir() -> AppResult<PathBuf> {
    if let Some(path) = non_empty_env_path("CODEX_HOME") {
        return Ok(path);
    }
    if let Some(profile) = non_empty_env_path("USERPROFILE") {
        return Ok(profile.join(".codex"));
    }
    if let Some(home) = non_empty_env_path("HOME") {
        return Ok(home.join(".codex"));
    }
    Err(AppError::new(
        "image_provider_error",
        "Codex home directory could not be determined; run codex login first",
    ))
}

fn non_empty_env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name).and_then(|value: OsString| {
        if value.is_empty() {
            None
        } else {
            Some(PathBuf::from(value))
        }
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct GeneratedImageCandidate {
    path: PathBuf,
    modified: SystemTime,
}

fn generated_image_candidates(dir: &Path) -> AppResult<Vec<GeneratedImageCandidate>> {
    let mut candidates = Vec::new();
    collect_generated_image_candidates(dir, &mut candidates)?;
    Ok(candidates)
}

fn collect_generated_image_candidates(
    dir: &Path,
    candidates: &mut Vec<GeneratedImageCandidate>,
) -> AppResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(AppError::io)? {
        let entry = entry.map_err(AppError::io)?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(AppError::io)?;
        if metadata.is_dir() {
            collect_generated_image_candidates(&path, candidates)?;
        } else if is_supported_image_path(&path) {
            candidates.push(GeneratedImageCandidate {
                path,
                modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            });
        }
    }
    Ok(())
}

fn newest_generated_image<I>(files: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = GeneratedImageCandidate>,
{
    files
        .into_iter()
        .filter(|candidate| is_supported_image_path(&candidate.path))
        .max_by_key(|candidate| candidate.modified)
        .map(|candidate| candidate.path)
}

fn is_supported_image_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif")
    )
}

fn image_file_base64(path: &Path) -> AppResult<(String, String)> {
    let bytes = fs::read(path).map_err(AppError::io)?;
    let mime = mime_type_for_image(&bytes)?;
    Ok((BASE64_STANDARD.encode(bytes), mime.to_string()))
}

fn mime_type_for_image(bytes: &[u8]) -> AppResult<&'static str> {
    match image::guess_format(bytes).map_err(|error| {
        AppError::new(
            "image_response_error",
            format!("Codex generated an unreadable image: {error}"),
        )
    })? {
        ImageFormat::Png => Ok("image/png"),
        ImageFormat::Jpeg => Ok("image/jpeg"),
        ImageFormat::WebP => Ok("image/webp"),
        ImageFormat::Gif => Ok("image/gif"),
        _ => Err(AppError::new(
            "image_response_error",
            "Codex generated an unsupported image format",
        )),
    }
}

fn truncate_error(message: &str) -> String {
    const MAX_LEN: usize = 1200;
    if message.chars().count() <= MAX_LEN {
        return message.to_string();
    }
    let mut truncated = message.chars().take(MAX_LEN).collect::<String>();
    truncated.push_str("...");
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{Duration, SystemTime};

    #[test]
    fn codex_exec_args_skip_git_repo_check_for_container_app_dir() {
        let args = codex_exec_args_with_model(
            Path::new("/app"),
            "make an image".to_string(),
            OsString::from(DEFAULT_CODEX_IMAGEGEN_MODEL),
        );
        let values = args
            .iter()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(values[0], "exec");
        assert!(values.contains(&"--skip-git-repo-check".to_string()));
        assert!(values.contains(&"--ignore-rules".to_string()));
        assert!(values.contains(&"--json".to_string()));
        assert!(values.contains(&"-m".to_string()));
        assert!(values.contains(&DEFAULT_CODEX_IMAGEGEN_MODEL.to_string()));
        assert_eq!(values.last().map(String::as_str), Some("make an image"));
    }
    #[test]
    fn codex_cli_executable_uses_env_override_when_present() {
        assert_eq!(
            fallback_env_os(
                Some(OsString::from("/opt/codex/bin/codex")),
                DEFAULT_CODEX_CLI_EXECUTABLE
            ),
            OsString::from("/opt/codex/bin/codex")
        );
        assert_eq!(
            fallback_env_os(Some(OsString::new()), DEFAULT_CODEX_CLI_EXECUTABLE),
            OsString::from(DEFAULT_CODEX_CLI_EXECUTABLE)
        );
        assert_eq!(
            fallback_env_os(None, DEFAULT_CODEX_CLI_EXECUTABLE),
            OsString::from(DEFAULT_CODEX_CLI_EXECUTABLE)
        );
    }

    #[test]
    fn fallback_env_os_uses_non_empty_override_or_fallback() {
        assert_eq!(
            fallback_env_os(
                Some(OsString::from("gpt-5.4")),
                DEFAULT_CODEX_IMAGEGEN_MODEL
            ),
            OsString::from("gpt-5.4")
        );
        assert_eq!(
            fallback_env_os(Some(OsString::new()), DEFAULT_CODEX_IMAGEGEN_MODEL),
            OsString::from(DEFAULT_CODEX_IMAGEGEN_MODEL)
        );
    }

    #[test]
    fn codex_start_error_explains_container_setup_when_binary_missing() {
        let error = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let message = codex_start_error_message(&error);

        assert!(message.contains("Install Codex CLI in the De-Koi server environment"));
        assert!(message.contains(CODEX_CLI_PATH_ENV));
        assert!(message.contains("CODEX_HOME mounted to /root/.codex"));
    }
    #[test]
    fn codex_prompt_mentions_subscription_source_size_and_options() {
        let prompt = codex_imagegen_prompt(
            "a calm koi in a moonlit pond",
            768,
            512,
            Some("text, watermark"),
            true,
        );

        assert!(prompt.contains("$imagegen"));
        assert!(prompt.contains("a calm koi in a moonlit pond"));
        assert!(prompt.contains("768x512"));
        assert!(prompt.contains("transparent background"));
        assert!(prompt.contains("Avoid: text, watermark"));
        assert!(prompt.contains("Do not use the OpenAI API"));
    }

    #[test]
    fn parse_codex_thread_id_from_jsonl_returns_started_thread() {
        let jsonl = format!(
            "{}\n{}\n",
            json!({
                "type": "thread.started",
                "thread_id": "019f1e3a-de0d-7eb1-a3bc-325bc3336ff5"
            }),
            json!({ "type": "turn.completed" })
        );

        assert_eq!(
            parse_codex_thread_id_from_jsonl(&jsonl),
            Some("019f1e3a-de0d-7eb1-a3bc-325bc3336ff5".to_string())
        );
    }

    #[test]
    fn newest_generated_image_prefers_latest_supported_image() {
        let files = vec![
            GeneratedImageCandidate {
                path: PathBuf::from("older.png"),
                modified: SystemTime::UNIX_EPOCH + Duration::from_secs(10),
            },
            GeneratedImageCandidate {
                path: PathBuf::from("latest.txt"),
                modified: SystemTime::UNIX_EPOCH + Duration::from_secs(30),
            },
            GeneratedImageCandidate {
                path: PathBuf::from("latest.webp"),
                modified: SystemTime::UNIX_EPOCH + Duration::from_secs(20),
            },
        ];

        assert_eq!(
            newest_generated_image(files).map(|path| path.display().to_string()),
            Some("latest.webp".to_string())
        );
    }
}
