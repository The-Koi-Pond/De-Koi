use flate2::read::GzDecoder;
use marinara_core::{AppError, AppResult};
use rand::{distr::Alphanumeric, RngExt};
use reqwest::header::{ACCEPT, CONTENT_RANGE, ETAG, IF_RANGE, LAST_MODIFIED, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    LazyLock,
};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::{watch, Mutex};

pub const SIDECAR_CONNECTION_ID: &str = "sidecar:local";
pub const SIDECAR_MODEL: &str = "local-sidecar";

const DEFAULT_CONTEXT_SIZE: u32 = 4096;
const DEFAULT_MAX_TOKENS: u32 = 1024;
const DEFAULT_TEMPERATURE: f64 = 0.3;
const DEFAULT_TOP_P: f64 = 0.95;
const DEFAULT_TOP_K: u32 = 64;
const DEFAULT_GPU_LAYERS: i32 = -1;
const LLAMA_SERVER_PARALLEL_SLOTS: u32 = 1;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const READY_POLL_INTERVAL: Duration = Duration::from_millis(500);
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const DOWNLOAD_PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const MARINARA_USER_AGENT: &str = "MarinaraEngine";
const RUNTIME_CURRENT_FILENAME: &str = "current.json";

static SIDECAR_PROCESS: LazyLock<Mutex<SidecarProcessState>> =
    LazyLock::new(|| Mutex::new(SidecarProcessState::default()));
static SIDECAR_DOWNLOAD: LazyLock<Mutex<SidecarDownloadState>> =
    LazyLock::new(|| Mutex::new(SidecarDownloadState::default()));
static SIDECAR_ACTIVE_REQUESTS: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Debug)]
pub struct LocalSidecarState {
    data_dir: PathBuf,
}

impl LocalSidecarState {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SidecarQuantization {
    Q8_0,
    Q4KM,
}

impl SidecarQuantization {
    fn as_str(self) -> &'static str {
        match self {
            Self::Q8_0 => "q8_0",
            Self::Q4KM => "q4_k_m",
        }
    }

    fn from_value(value: &Value) -> AppResult<Self> {
        let raw = value
            .get("quantization")
            .and_then(Value::as_str)
            .map(str::trim)
            .ok_or_else(|| AppError::invalid_input("quantization is required"))?;
        match raw {
            "q8_0" => Ok(Self::Q8_0),
            "q4_k_m" => Ok(Self::Q4KM),
            _ => Err(AppError::invalid_input("Unsupported sidecar quantization")),
        }
    }
}

#[derive(Debug, Clone)]
struct CuratedSidecarModel {
    quantization: SidecarQuantization,
    label: &'static str,
    filename: &'static str,
    size_bytes: u64,
    ram_bytes: u64,
    download_url: &'static str,
}

// LEGACY_PARITY: local-sidecar-downloads - Keep the legacy Gemma GGUF presets available from the managed Local Model card.
const CURATED_MODELS: &[CuratedSidecarModel] = &[
    CuratedSidecarModel {
        quantization: SidecarQuantization::Q8_0,
        label: "Gemma 4 E2B - Q8 (Best Quality)",
        filename: "gemma-4-E2B-it-Q8_0.gguf",
        size_bytes: 5_400_000_000,
        ram_bytes: 5_800_000_000,
        download_url: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q8_0.gguf",
    },
    CuratedSidecarModel {
        quantization: SidecarQuantization::Q4KM,
        label: "Gemma 4 E2B - Q4_K_M (Smaller, Faster)",
        filename: "gemma-4-E2B-it-Q4_K_M.gguf",
        size_bytes: 3_200_000_000,
        ram_bytes: 3_600_000_000,
        download_url: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf",
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSidecarConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub executable_path: Option<String>,
    #[serde(default)]
    pub model_path: Option<String>,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_context_size")]
    pub context_size: u32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_top_p")]
    pub top_p: f64,
    #[serde(default = "default_top_k")]
    pub top_k: u32,
    #[serde(default = "default_gpu_layers")]
    pub gpu_layers: i32,
    #[serde(default)]
    pub quantization: Option<SidecarQuantization>,
    #[serde(default)]
    pub custom_model_repo: Option<String>,
    #[serde(default = "default_runtime_preference")]
    pub runtime_preference: String,
}

impl Default for LocalSidecarConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            executable_path: None,
            model_path: None,
            model: default_model(),
            context_size: DEFAULT_CONTEXT_SIZE,
            max_tokens: DEFAULT_MAX_TOKENS,
            temperature: DEFAULT_TEMPERATURE,
            top_p: DEFAULT_TOP_P,
            top_k: DEFAULT_TOP_K,
            gpu_layers: DEFAULT_GPU_LAYERS,
            quantization: None,
            custom_model_repo: None,
            runtime_preference: default_runtime_preference(),
        }
    }
}

#[derive(Default)]
struct SidecarProcessState {
    child: Option<Child>,
    base_url: Option<String>,
    signature: Option<String>,
    status: String,
    startup_error: Option<String>,
}

pub struct SidecarInferenceLease {
    base_url: String,
}

impl SidecarInferenceLease {
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

impl Drop for SidecarInferenceLease {
    fn drop(&mut self) {
        SIDECAR_ACTIVE_REQUESTS.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarDownloadProgress {
    phase: String,
    status: String,
    downloaded: u64,
    total: u64,
    speed: f64,
    label: Option<String>,
    error: Option<String>,
}

#[derive(Default)]
struct SidecarDownloadState {
    active: bool,
    progress: Option<SidecarDownloadProgress>,
    cancel: Option<watch::Sender<bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarRuntimeRecord {
    build: String,
    variant: String,
    platform: String,
    arch: String,
    asset_name: String,
    directory_name: String,
    server_relative_path: String,
    installed_at: String,
    source: String,
    system_path: Option<String>,
}

#[derive(Debug, Clone)]
struct SidecarRuntimeInstall {
    record: SidecarRuntimeRecord,
    server_path: PathBuf,
}

#[derive(Debug, Clone, Copy, Default)]
struct GpuRuntimeHints {
    nvidia: bool,
    amd: bool,
    intel: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LlamaStartupPlan {
    label: &'static str,
    gpu_layers: i32,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    #[allow(dead_code)]
    size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseResponse {
    tag_name: String,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct HuggingFaceTreeEntry {
    #[serde(rename = "type")]
    entry_type: Option<String>,
    path: Option<String>,
    size: Option<u64>,
    lfs: Option<HuggingFaceLfsInfo>,
}

#[derive(Debug, Clone, Deserialize)]
struct HuggingFaceLfsInfo {
    size: Option<u64>,
}

#[derive(Debug, Clone)]
struct CustomModelEntry {
    path: String,
    filename: String,
    size_bytes: Option<u64>,
    quantization_label: Option<String>,
    download_url: String,
}

fn default_model() -> String {
    SIDECAR_MODEL.to_string()
}

fn default_context_size() -> u32 {
    DEFAULT_CONTEXT_SIZE
}

fn default_max_tokens() -> u32 {
    DEFAULT_MAX_TOKENS
}

fn default_temperature() -> f64 {
    DEFAULT_TEMPERATURE
}

fn default_top_p() -> f64 {
    DEFAULT_TOP_P
}

fn default_top_k() -> u32 {
    DEFAULT_TOP_K
}

fn default_gpu_layers() -> i32 {
    DEFAULT_GPU_LAYERS
}

fn default_runtime_preference() -> String {
    "auto".to_string()
}

fn is_runtime_preference(value: &str) -> bool {
    matches!(
        value.trim(),
        "auto" | "nvidia" | "amd" | "intel" | "vulkan" | "cpu" | "system"
    )
}

pub fn is_sidecar_connection_id(connection_id: &str) -> bool {
    connection_id.trim() == SIDECAR_CONNECTION_ID
}

fn active_inference_count() -> usize {
    SIDECAR_ACTIVE_REQUESTS.load(Ordering::SeqCst)
}

fn sidecar_inference_busy_error() -> AppError {
    AppError::new(
        "sidecar_inference_busy",
        "Local Model deletion is blocked while sidecar inference is active. Try again after the current request finishes.",
    )
}

fn sidecar_root(state: &LocalSidecarState) -> AppResult<PathBuf> {
    let root = state.data_dir.join("local-sidecar");
    fs::create_dir_all(&root)?;
    Ok(root)
}

fn config_path(state: &LocalSidecarState) -> AppResult<PathBuf> {
    Ok(sidecar_root(state)?.join("config.json"))
}

fn log_path(state: &LocalSidecarState) -> AppResult<PathBuf> {
    Ok(sidecar_root(state)?.join("sidecar.log"))
}

pub fn log_tail(state: &LocalSidecarState, max_lines: usize) -> AppResult<Value> {
    let path = log_path(state)?;
    if !path.exists() {
        return Ok(json!({
            "available": false,
            "path": path.to_string_lossy(),
            "lines": [],
            "truncated": false,
            "error": "Sidecar log file does not exist yet."
        }));
    }

    let max_lines = max_lines.clamp(1, 1000);
    let contents = fs::read_to_string(&path)?;
    let mut lines: Vec<&str> = contents.lines().collect();
    let truncated = lines.len() > max_lines;
    if truncated {
        lines = lines.split_off(lines.len() - max_lines);
    }

    Ok(json!({
        "available": true,
        "path": path.to_string_lossy(),
        "lines": lines,
        "truncated": truncated
    }))
}

fn models_dir(state: &LocalSidecarState) -> AppResult<PathBuf> {
    let path = sidecar_root(state)?.join("models");
    fs::create_dir_all(path.join("custom"))?;
    Ok(path)
}

fn runtime_dir(state: &LocalSidecarState) -> AppResult<PathBuf> {
    let path = sidecar_root(state)?.join("runtime");
    fs::create_dir_all(&path)?;
    Ok(path)
}

fn runtime_current_path(state: &LocalSidecarState) -> AppResult<PathBuf> {
    Ok(runtime_dir(state)?.join(RUNTIME_CURRENT_FILENAME))
}

fn read_config(state: &LocalSidecarState) -> AppResult<LocalSidecarConfig> {
    let path = config_path(state)?;
    if !path.exists() {
        return Ok(LocalSidecarConfig::default());
    }
    let raw = fs::read_to_string(path)?;
    let value = serde_json::from_str::<Value>(&raw).map_err(|error| {
        AppError::new(
            "sidecar_config_error",
            format!("Local Model sidecar config is invalid: {error}"),
        )
    })?;
    validate_persisted_config_value(&value)?;
    let parsed = serde_json::from_value::<LocalSidecarConfig>(value).map_err(|error| {
        AppError::new(
            "sidecar_config_error",
            format!("Local Model sidecar config is invalid: {error}"),
        )
    })?;
    Ok(normalize_config(parsed))
}

fn validate_persisted_config_value(value: &Value) -> AppResult<()> {
    let Some(object) = value.as_object() else {
        return Err(AppError::new(
            "sidecar_config_error",
            "Local Model sidecar config must be an object",
        ));
    };
    if let Some(value) = object.get("runtimePreference") {
        let Some(runtime_preference) = value.as_str() else {
            return Err(AppError::new(
                "sidecar_config_error",
                "Local Model sidecar runtimePreference must be a string",
            ));
        };
        if !is_runtime_preference(runtime_preference) {
            return Err(AppError::new(
                "sidecar_config_error",
                format!(
                    "Local Model sidecar runtimePreference is unsupported: {runtime_preference}"
                ),
            ));
        }
    }
    Ok(())
}

fn write_config(state: &LocalSidecarState, config: &LocalSidecarConfig) -> AppResult<()> {
    let path = config_path(state)?;
    let raw = serde_json::to_string_pretty(config)
        .map_err(|error| AppError::new("sidecar_config_error", error.to_string()))?;
    fs::write(path, raw)?;
    Ok(())
}

fn normalize_config(config: LocalSidecarConfig) -> LocalSidecarConfig {
    normalize_config_for(config, current_platform(), current_arch())
}

fn normalize_config_for(mut config: LocalSidecarConfig, platform: &str, arch: &str) -> LocalSidecarConfig {
    config.executable_path = normalize_optional_string(config.executable_path);
    config.model_path = normalize_optional_string(config.model_path);
    config.custom_model_repo = normalize_optional_string(config.custom_model_repo);
    if config.model.trim().is_empty() {
        config.model = default_model();
    }
    config.context_size = config.context_size.clamp(512, 32768);
    config.max_tokens = config.max_tokens.clamp(64, 32768);
    if is_linux_arm64(platform, arch) {
        config.context_size = config.context_size.min(DEFAULT_CONTEXT_SIZE);
        config.max_tokens = config.max_tokens.min(DEFAULT_MAX_TOKENS);
    }
    if !config.temperature.is_finite() {
        config.temperature = DEFAULT_TEMPERATURE;
    }
    config.temperature = config.temperature.clamp(0.0, 2.0);
    if !config.top_p.is_finite() {
        config.top_p = DEFAULT_TOP_P;
    }
    config.top_p = config.top_p.clamp(0.01, 1.0);
    config.top_k = config.top_k.min(500);
    config.gpu_layers = config.gpu_layers.clamp(-1, 1024);
    config.runtime_preference = config.runtime_preference.trim().to_string();
    if !is_runtime_preference(&config.runtime_preference) {
        config.runtime_preference = default_runtime_preference();
    }
    config
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn optional_patch_string(
    patch: &Map<String, Value>,
    key: &str,
) -> AppResult<Option<Option<String>>> {
    let Some(value) = patch.get(key) else {
        return Ok(None);
    };
    match value {
        Value::Null => Ok(Some(None)),
        Value::String(raw) => {
            let trimmed = raw.trim();
            Ok(Some(if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }))
        }
        _ => Err(AppError::invalid_input(format!(
            "{key} must be a string or null"
        ))),
    }
}

fn patch_bool(patch: &Map<String, Value>, key: &str) -> AppResult<Option<bool>> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(AppError::invalid_input(format!("{key} must be a boolean"))),
    }
}

fn patch_required_string(patch: &Map<String, Value>, key: &str) -> AppResult<Option<String>> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::String(raw)) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                Err(AppError::invalid_input(format!("{key} must not be empty")))
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Some(_) => Err(AppError::invalid_input(format!("{key} must be a string"))),
    }
}

fn patch_u32(patch: &Map<String, Value>, key: &str) -> AppResult<Option<u32>> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::Number(value)) => {
            let Some(value) = value.as_u64() else {
                return Err(AppError::invalid_input(format!(
                    "{key} must be a non-negative integer"
                )));
            };
            u32::try_from(value)
                .map(Some)
                .map_err(|_| AppError::invalid_input(format!("{key} is too large")))
        }
        Some(_) => Err(AppError::invalid_input(format!(
            "{key} must be a non-negative integer"
        ))),
    }
}

fn patch_i32(patch: &Map<String, Value>, key: &str) -> AppResult<Option<i32>> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::Number(value)) => {
            if let Some(value) = value.as_i64() {
                return i32::try_from(value).map(Some).map_err(|_| {
                    AppError::invalid_input(format!("{key} is outside the supported range"))
                });
            }
            if let Some(value) = value.as_u64() {
                return i32::try_from(value).map(Some).map_err(|_| {
                    AppError::invalid_input(format!("{key} is outside the supported range"))
                });
            }
            Err(AppError::invalid_input(format!("{key} must be an integer")))
        }
        Some(_) => Err(AppError::invalid_input(format!("{key} must be an integer"))),
    }
}

fn patch_f64(patch: &Map<String, Value>, key: &str) -> AppResult<Option<f64>> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::Number(value)) => value
            .as_f64()
            .ok_or_else(|| AppError::invalid_input(format!("{key} must be a number")))
            .map(Some),
        Some(_) => Err(AppError::invalid_input(format!("{key} must be a number"))),
    }
}

fn patch_config(mut config: LocalSidecarConfig, patch: Value) -> AppResult<LocalSidecarConfig> {
    let Some(object) = patch.as_object() else {
        return Err(AppError::invalid_input(
            "Local Model sidecar config patch must be an object",
        ));
    };
    if let Some(value) = patch_bool(object, "enabled")? {
        config.enabled = value;
    }
    if let Some(value) = optional_patch_string(object, "executablePath")? {
        config.executable_path = value;
    }
    if let Some(value) = optional_patch_string(object, "modelPath")? {
        config.model_path = value;
    }
    if let Some(value) = patch_required_string(object, "model")? {
        config.model = value;
    }
    if let Some(value) = patch_u32(object, "contextSize")? {
        config.context_size = value;
    }
    if let Some(value) = patch_u32(object, "maxTokens")? {
        config.max_tokens = value;
    }
    if let Some(value) = patch_f64(object, "temperature")? {
        config.temperature = value;
    }
    if let Some(value) = patch_f64(object, "topP")? {
        config.top_p = value;
    }
    if let Some(value) = patch_u32(object, "topK")? {
        config.top_k = value;
    }
    if let Some(value) = patch_i32(object, "gpuLayers")? {
        config.gpu_layers = value;
    }
    if let Some(value) = patch_required_string(object, "runtimePreference")? {
        if !is_runtime_preference(&value) {
            return Err(AppError::invalid_input("runtimePreference is unsupported"));
        }
        config.runtime_preference = value;
    }
    Ok(normalize_config(config))
}

fn current_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        "linux" => "linux",
        other => other,
    }
}

fn current_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

fn now_runtime_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn sanitized_filename(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn slugify_repo(repo: &str) -> String {
    let slug = repo
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    slug.replace("__", "_")
}

fn managed_custom_model_relative_path(repo: &str, model_path: &str) -> String {
    let repo_slug = slugify_repo(repo);
    let model_path = model_path
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .map(sanitized_filename)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    format!("custom/{repo_slug}/{model_path}")
}

fn normalize_repo_path(repo: &str) -> String {
    repo.trim()
        .trim_matches('/')
        .replace('\\', "/")
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn validate_huggingface_repo(repo: &str) -> AppResult<String> {
    let repo = normalize_repo_path(repo);
    let parts = repo.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || parts
            .iter()
            .any(|part| part.trim().is_empty() || part.chars().any(char::is_whitespace))
    {
        return Err(AppError::invalid_input(
            "Repository must be in owner/repo format",
        ));
    }
    Ok(repo)
}

fn model_path_inside_models_dir(state: &LocalSidecarState, relative_path: &str) -> AppResult<PathBuf> {
    let root = models_dir(state)?;
    let normalized = relative_path.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.contains(':')
        || normalized
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(AppError::invalid_input("Invalid managed model path"));
    }
    let target = root.join(normalized);
    ensure_inside_dir(
        &root,
        &target,
        "Managed model path escaped the sidecar models directory",
    )?;
    Ok(target)
}

fn ensure_inside_dir(root: &Path, target: &Path, message: &str) -> AppResult<()> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let target_parent = target
        .parent()
        .unwrap_or(target)
        .canonicalize()
        .unwrap_or_else(|_| target.parent().unwrap_or(target).to_path_buf());
    if target_parent != root && !target_parent.starts_with(&root) {
        let lexical_root = root
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string();
        let lexical_target = target_parent
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string();
        if lexical_target != lexical_root
            && !lexical_target.starts_with(&format!("{lexical_root}{}", std::path::MAIN_SEPARATOR))
        {
            return Err(AppError::invalid_input(message));
        }
    }
    Ok(())
}

fn random_suffix(len: usize) -> String {
    rand::rng()
        .sample_iter(Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn is_managed_model_path(state: &LocalSidecarState, model_path: &str) -> bool {
    let Ok(root) = models_dir(state) else {
        return false;
    };
    let root = root.canonicalize().unwrap_or(root);
    let path = Path::new(model_path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(model_path));
    path.starts_with(root)
}

fn current_runtime_install(state: &LocalSidecarState) -> AppResult<Option<SidecarRuntimeInstall>> {
    let path = runtime_current_path(state)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)?;
    let record = serde_json::from_str::<SidecarRuntimeRecord>(&raw)
        .map_err(|error| AppError::new("sidecar_runtime_error", error.to_string()))?;
    let server_path = if record.source == "system" {
        record
            .system_path
            .as_deref()
            .map(PathBuf::from)
            .ok_or_else(|| {
                AppError::new("sidecar_runtime_error", "System runtime path is missing")
            })?
    } else {
        runtime_dir(state)?.join(&record.directory_name).join(
            record
                .server_relative_path
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        )
    };
    if !server_path.is_file() {
        return Ok(None);
    }
    Ok(Some(SidecarRuntimeInstall {
        record,
        server_path,
    }))
}

fn current_runtime_install_for_config(
    state: &LocalSidecarState,
    config: &LocalSidecarConfig,
) -> AppResult<Option<SidecarRuntimeInstall>> {
    let Some(install) = current_runtime_install(state)? else {
        return Ok(None);
    };
    if runtime_install_matches_preference(&install, &config.runtime_preference) {
        Ok(Some(install))
    } else {
        Ok(None)
    }
}

fn write_runtime_install(state: &LocalSidecarState, install: &SidecarRuntimeInstall) -> AppResult<()> {
    let raw = serde_json::to_string_pretty(&install.record)
        .map_err(|error| AppError::new("sidecar_runtime_error", error.to_string()))?;
    fs::write(runtime_current_path(state)?, raw)?;
    Ok(())
}

fn runtime_info_payload(state: &LocalSidecarState, config: &LocalSidecarConfig) -> Value {
    match current_runtime_install_for_config(state, config) {
        Ok(Some(install)) => json!({
            "installed": true,
            "build": install.record.build,
            "variant": install.record.variant,
            "backend": "llama_cpp",
            "source": install.record.source,
            "systemPath": install.record.system_path,
            "serverPath": install.server_path.to_string_lossy(),
        }),
        _ => json!({
            "installed": false,
            "build": null,
            "variant": null,
            "backend": "llama_cpp",
            "source": null,
            "systemPath": null,
            "serverPath": null,
        }),
    }
}

fn curated_models_payload() -> Value {
    Value::Array(
        CURATED_MODELS
            .iter()
            .map(|model| {
                json!({
                    "quantization": model.quantization.as_str(),
                    "backend": "llama_cpp",
                    "label": model.label,
                    "filename": model.filename,
                    "sizeBytes": model.size_bytes,
                    "ramBytes": model.ram_bytes,
                    "downloadUrl": model.download_url,
                })
            })
            .collect(),
    )
}

fn model_display_name(config: &LocalSidecarConfig) -> Option<String> {
    config
        .model_path
        .as_deref()
        .and_then(|path| Path::new(path).file_name())
        .map(|name| name.to_string_lossy().to_string())
}

fn model_size(config: &LocalSidecarConfig) -> Option<u64> {
    config
        .model_path
        .as_deref()
        .and_then(|path| fs::metadata(path).ok())
        .map(|metadata| metadata.len())
}

fn configured(config: &LocalSidecarConfig) -> bool {
    config
        .model_path
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
}

fn validate_executable_path(executable: &str) -> AppResult<()> {
    let looks_like_path =
        executable.contains('/') || executable.contains('\\') || executable.contains(':');
    if looks_like_path && !Path::new(executable).is_file() {
        return Err(AppError::invalid_input(
            "Configured sidecar executable path does not exist",
        ));
    }
    Ok(())
}

fn runtime_missing_error(config: &LocalSidecarConfig) -> AppError {
    if config.runtime_preference == "system" {
        return AppError::new(
            "sidecar_runtime_missing",
            "No system llama-server was found in PATH. Install llama.cpp separately, choose a bundled runtime, or set a custom executable path in Local AI Model settings.",
        );
    }
    AppError::new(
        "sidecar_runtime_missing",
        "Install the Local Model runtime before starting or testing the sidecar, or set a custom llama-server executable path in Local AI Model settings.",
    )
}

fn validate_model_path(config: &LocalSidecarConfig) -> AppResult<String> {
    let model_path = config
        .model_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::invalid_input("Select a local model before starting the sidecar")
        })?;
    if !Path::new(model_path).is_file() {
        return Err(AppError::invalid_input(
            "Configured sidecar model path does not exist",
        ));
    }
    Ok(model_path.to_string())
}

fn config_signature(state: &LocalSidecarState, config: &LocalSidecarConfig) -> String {
    let executable = config
        .executable_path
        .clone()
        .or_else(|| {
            current_runtime_install_for_config(state, config)
                .ok()
                .flatten()
                .map(|install| install.server_path.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "runtime-not-installed".to_string());
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}",
        executable,
        config.model_path.as_deref().unwrap_or_default(),
        config.model,
        config.context_size,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.top_k,
        config.gpu_layers
    )
}

fn find_free_port() -> AppResult<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| AppError::new("sidecar_port_error", error.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|error| AppError::new("sidecar_port_error", error.to_string()))?
        .port();
    drop(listener);
    Ok(port)
}

fn is_linux_arm64(platform: &str, arch: &str) -> bool {
    platform == "linux" && arch == "arm64"
}

fn llama_startup_plans(config: &LocalSidecarConfig) -> Vec<LlamaStartupPlan> {
    llama_startup_plans_for(config, current_platform(), current_arch())
}

fn llama_startup_plans_for(config: &LocalSidecarConfig, platform: &str, arch: &str) -> Vec<LlamaStartupPlan> {
    if config.gpu_layers == -1 && is_linux_arm64(platform, arch) {
        return vec![LlamaStartupPlan { label: "CPU fallback", gpu_layers: 0 }];
    }
    if config.gpu_layers == -1 {
        vec![
            LlamaStartupPlan {
                label: "max GPU offload",
                gpu_layers: 999,
            },
            LlamaStartupPlan {
                label: "CPU fallback",
                gpu_layers: 0,
            },
        ]
    } else {
        vec![LlamaStartupPlan {
            label: "configured GPU offload",
            gpu_layers: config.gpu_layers,
        }]
    }
}

fn sidecar_args(
    config: &LocalSidecarConfig,
    model_path: &str,
    port: u16,
    plan: &LlamaStartupPlan,
) -> Vec<String> {
    vec![
        "-m".to_string(),
        model_path.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--parallel".to_string(),
        LLAMA_SERVER_PARALLEL_SLOTS.to_string(),
        "--ctx-size".to_string(),
        config
            .context_size
            .saturating_mul(LLAMA_SERVER_PARALLEL_SLOTS)
            .to_string(),
        "--port".to_string(),
        port.to_string(),
        "-ngl".to_string(),
        plan.gpu_layers.to_string(),
    ]
}

fn open_sidecar_log(path: &Path) -> AppResult<(Stdio, Stdio)> {
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    let stderr = file.try_clone()?;
    Ok((Stdio::from(file), Stdio::from(stderr)))
}

async fn wait_for_ready(base_url: &str, child: &mut Child) -> AppResult<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| AppError::new("sidecar_client_error", error.to_string()))?;
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let mut last_error: Option<String> = None;

    while Instant::now() < deadline {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| AppError::new("sidecar_process_error", error.to_string()))?
        {
            return Err(AppError::new(
                "sidecar_start_failed",
                format!("Local sidecar exited before it became ready ({status})"),
            ));
        }

        for path in ["/health", "/v1/models"] {
            match client.get(format!("{base_url}{path}")).send().await {
                Ok(response) if response.status().is_success() => return Ok(()),
                Ok(response) => {
                    last_error = Some(format!("{path} returned {}", response.status()));
                }
                Err(error) => {
                    last_error = Some(error.to_string());
                }
            }
        }

        tokio::time::sleep(READY_POLL_INTERVAL).await;
    }

    Err(AppError::new(
        "sidecar_start_failed",
        last_error.unwrap_or_else(|| "Timed out waiting for the local sidecar server".to_string()),
    ))
}

async fn begin_download_job(phase: &str, label: &str) -> AppResult<watch::Receiver<bool>> {
    let mut state = SIDECAR_DOWNLOAD.lock().await;
    if state.active {
        return Err(AppError::new(
            "sidecar_download_conflict",
            "Another Local Model download or install is already running",
        ));
    }
    let (cancel_tx, cancel_rx) = watch::channel(false);
    state.active = true;
    state.cancel = Some(cancel_tx);
    state.progress = Some(SidecarDownloadProgress {
        phase: phase.to_string(),
        status: "downloading".to_string(),
        downloaded: 0,
        total: 0,
        speed: 0.0,
        label: Some(label.to_string()),
        error: None,
    });
    Ok(cancel_rx)
}

async fn set_download_progress(progress: SidecarDownloadProgress) {
    let mut state = SIDECAR_DOWNLOAD.lock().await;
    state.progress = Some(progress);
}

async fn finish_download_job(result: AppResult<()>, phase: &str, label: &str) {
    let mut state = SIDECAR_DOWNLOAD.lock().await;
    state.active = false;
    state.cancel = None;
    state.progress = Some(match result {
        Ok(()) => SidecarDownloadProgress {
            phase: phase.to_string(),
            status: "complete".to_string(),
            downloaded: 0,
            total: 0,
            speed: 0.0,
            label: Some(label.to_string()),
            error: None,
        },
        Err(error) => SidecarDownloadProgress {
            phase: phase.to_string(),
            status: "error".to_string(),
            downloaded: 0,
            total: 0,
            speed: 0.0,
            label: Some(label.to_string()),
            error: Some(error.message),
        },
    });
}

async fn cancel_download() -> AppResult<Value> {
    let state = SIDECAR_DOWNLOAD.lock().await;
    if let Some(cancel) = &state.cancel {
        let _ = cancel.send(true);
    }
    Ok(json!({ "ok": true }))
}

fn download_cancelled_error() -> AppError {
    AppError::new("sidecar_download_cancelled", "Download cancelled")
}

fn download_cancel_requested(cancel: &watch::Receiver<bool>) -> bool {
    *cancel.borrow()
}

const DOWNLOAD_DISK_HEADROOM_BYTES: u64 = 512 * 1024 * 1024;

fn ensure_download_space(available: u64, remaining: u64) -> AppResult<()> {
    let required = remaining.saturating_add(DOWNLOAD_DISK_HEADROOM_BYTES);
    if available < required {
        return Err(AppError::new(
            "sidecar_insufficient_disk_space",
            format!(
                "Not enough disk space for this download. Free at least {} additional bytes.",
                required.saturating_sub(available)
            ),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadPartialMetadata {
    url: String,
    validator: Option<String>,
    total: Option<u64>,
}

fn download_metadata_path(partial: &Path) -> PathBuf {
    partial.with_extension(format!(
        "{}json",
        partial
            .extension()
            .map(|extension| format!("{}.", extension.to_string_lossy()))
            .unwrap_or_default()
    ))
}

fn read_download_metadata(path: &Path) -> Option<DownloadPartialMetadata> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn write_download_metadata(path: &Path, metadata: &DownloadPartialMetadata) -> AppResult<()> {
    let staged = path.with_extension("json.tmp");
    fs::write(&staged, serde_json::to_vec(metadata)?)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(staged, path)?;
    Ok(())
}

fn discard_incompatible_download(partial_path: &Path, metadata_path: &Path) {
    let _ = fs::remove_file(partial_path);
    let _ = fs::remove_file(metadata_path);
}

fn partial_content_total(response: &reqwest::Response, expected_start: u64) -> AppResult<u64> {
    let raw = response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::new("sidecar_download_invalid_range", "Resume response omitted Content-Range"))?;
    let (range, total) = raw
        .strip_prefix("bytes ")
        .and_then(|value| value.split_once('/'))
        .ok_or_else(|| AppError::new("sidecar_download_invalid_range", "Resume response had invalid Content-Range"))?;
    let (start, _) = range
        .split_once('-')
        .ok_or_else(|| AppError::new("sidecar_download_invalid_range", "Resume response had invalid byte range"))?;
    let start = start.parse::<u64>().map_err(|_| {
        AppError::new("sidecar_download_invalid_range", "Resume response had invalid range start")
    })?;
    let total = total.parse::<u64>().map_err(|_| {
        AppError::new("sidecar_download_invalid_range", "Resume response had invalid total size")
    })?;
    if start != expected_start || total < expected_start {
        return Err(AppError::new(
            "sidecar_download_invalid_range",
            "Resume response did not match the saved partial file",
        ));
    }
    Ok(total)
}

async fn download_url_to_path(
    url: &str,
    destination: &Path,
    phase: &str,
    label: &str,
    mut cancel: watch::Receiver<bool>,
) -> AppResult<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp_path = destination.with_extension(format!(
        "{}download",
        destination
            .extension()
            .map(|extension| format!("{}.", extension.to_string_lossy()))
            .unwrap_or_default()
    ));
    let metadata_path = download_metadata_path(&temp_path);
    let mut partial_len = fs::metadata(&temp_path).map(|metadata| metadata.len()).unwrap_or(0);
    let mut partial_metadata = read_download_metadata(&metadata_path);
    if partial_len > 0
        && partial_metadata.as_ref().is_none_or(|metadata| {
            metadata.url != url || metadata.validator.as_deref().is_none_or(str::is_empty)
        })
    {
        fs::remove_file(&temp_path)?;
        let _ = fs::remove_file(&metadata_path);
        partial_len = 0;
        partial_metadata = None;
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| AppError::new("sidecar_download_failed", error.to_string()))?;
    if download_cancel_requested(&cancel) {
        return Err(download_cancelled_error());
    }
    let mut request_builder = client.get(url).header(USER_AGENT, MARINARA_USER_AGENT);
    if partial_len > 0 {
        request_builder = request_builder.header(reqwest::header::RANGE, format!("bytes={partial_len}-"));
        if let Some(validator) = partial_metadata.as_ref().and_then(|metadata| metadata.validator.as_ref()) {
            request_builder = request_builder.header(IF_RANGE, validator);
        }
    }
    let request = request_builder.send();
    tokio::pin!(request);
    let response = loop {
        tokio::select! {
            result = &mut request => {
                break result.map_err(|error| AppError::new("sidecar_download_failed", error.to_string()))?;
            }
            changed = cancel.changed() => {
                if changed.is_ok() && download_cancel_requested(&cancel) {
                    return Err(download_cancelled_error());
                }
            }
        }
    };
    if !response.status().is_success() {
        let status = response.status();
        let raw = response.text().await.unwrap_or_default();
        return Err(AppError::new(
            "sidecar_download_failed",
            format!(
                "HTTP {status}: {}",
                raw.chars().take(240).collect::<String>()
            ),
        ));
    }

    let resumed = partial_len > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let expected_total = if resumed {
        match partial_content_total(&response, partial_len) {
            Ok(total) => Some(total),
            Err(error) => {
                discard_incompatible_download(&temp_path, &metadata_path);
                return Err(error);
            }
        }
    } else {
        response.content_length()
    };
    if resumed
        && partial_metadata
            .as_ref()
            .and_then(|metadata| metadata.total)
            .zip(expected_total)
            .is_some_and(|(saved, actual)| saved != actual)
    {
        discard_incompatible_download(&temp_path, &metadata_path);
        return Err(AppError::new(
            "sidecar_download_invalid_range",
            "Resume response size did not match the saved partial metadata",
        ));
    }
    let response_validator = response
        .headers()
        .get(ETAG)
        .or_else(|| response.headers().get(LAST_MODIFIED))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let resume_validator_matches = partial_metadata
        .as_ref()
        .and_then(|metadata| metadata.validator.as_ref())
        .zip(response_validator.as_ref())
        .is_some_and(|(expected, actual)| expected == actual);
    if resumed && !resume_validator_matches {
        discard_incompatible_download(&temp_path, &metadata_path);
        return Err(AppError::new(
            "sidecar_download_invalid_range",
            "Resume response validator did not match the saved partial file",
        ));
    }
    if let (Some(parent), Some(remaining)) = (destination.parent(), response.content_length()) {
        let available = fs2::available_space(parent)
            .map_err(|error| AppError::new("sidecar_disk_space_check_failed", error.to_string()))?;
        ensure_download_space(available, remaining)?;
    }
    let total = response
        .content_length()
        .unwrap_or(0)
        .saturating_add(if resumed { partial_len } else { 0 });
    let mut downloaded = if resumed { partial_len } else { 0 };
    write_download_metadata(
        &metadata_path,
        &DownloadPartialMetadata {
            url: url.to_string(),
            validator: response_validator.or_else(|| partial_metadata.and_then(|metadata| metadata.validator)),
            total: expected_total,
        },
    )?;
    let mut last_report = Instant::now();
    let mut last_report_bytes = 0u64;
    let mut file = if resumed {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&temp_path)
            .await?
    } else {
        tokio::fs::File::create(&temp_path).await?
    };
    let mut response = response;

    loop {
        if download_cancel_requested(&cancel) {
            return Err(download_cancelled_error());
        }
        let next_chunk = response.chunk();
        tokio::pin!(next_chunk);
        let chunk = loop {
            tokio::select! {
                result = &mut next_chunk => {
                    break result.map_err(|error| AppError::new("sidecar_download_failed", error.to_string()))?;
                }
                changed = cancel.changed() => {
                    if changed.is_ok() && download_cancel_requested(&cancel) {
                        return Err(download_cancelled_error());
                    }
                }
            }
        };
        let Some(chunk) = chunk else {
            break;
        };
        file.write_all(&chunk).await?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);

        let now = Instant::now();
        if now.duration_since(last_report) >= DOWNLOAD_PROGRESS_INTERVAL {
            let elapsed = now.duration_since(last_report).as_secs_f64();
            let speed = if elapsed > 0.0 {
                (downloaded.saturating_sub(last_report_bytes)) as f64 / elapsed
            } else {
                0.0
            };
            set_download_progress(SidecarDownloadProgress {
                phase: phase.to_string(),
                status: "downloading".to_string(),
                downloaded,
                total,
                speed,
                label: Some(label.to_string()),
                error: None,
            })
            .await;
            last_report = now;
            last_report_bytes = downloaded;
        }
    }

    file.flush().await?;
    drop(file);
    if expected_total.is_some_and(|expected| downloaded != expected) {
        return Err(AppError::new(
            "sidecar_download_incomplete",
            "Downloaded byte count did not match the expected artifact size",
        ));
    }
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(&temp_path, destination)?;
    let _ = fs::remove_file(&metadata_path);
    set_download_progress(SidecarDownloadProgress {
        phase: phase.to_string(),
        status: "complete".to_string(),
        downloaded: if total > 0 { total } else { downloaded },
        total: if total > 0 { total } else { downloaded },
        speed: 0.0,
        label: Some(label.to_string()),
        error: None,
    })
    .await;
    Ok(())
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(url: &str) -> AppResult<T> {
    let response = reqwest::Client::builder()
        .build()
        .map_err(|error| AppError::new("sidecar_http_failed", error.to_string()))?
        .get(url)
        .header(USER_AGENT, MARINARA_USER_AGENT)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| AppError::new("sidecar_http_failed", error.to_string()))?;
    if !response.status().is_success() {
        let status = response.status();
        let raw = response.text().await.unwrap_or_default();
        return Err(AppError::new(
            "sidecar_http_failed",
            format!(
                "HTTP {status}: {}",
                raw.chars().take(240).collect::<String>()
            ),
        ));
    }
    response
        .json::<T>()
        .await
        .map_err(|error| AppError::new("sidecar_http_failed", error.to_string()))
}

fn is_likely_mmproj_model_path(model_path: &str) -> bool {
    let filename = Path::new(model_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    filename.contains("mmproj")
        || filename.contains("projector")
        || filename.contains("mm-proj")
        || filename.contains("mm_proj")
}

fn is_supported_llama_cpp_model_filename(model_path: &str) -> bool {
    model_path.to_ascii_lowercase().ends_with(".gguf") && !is_likely_mmproj_model_path(model_path)
}

fn assert_supported_llama_cpp_model_path(model_path: &str) -> AppResult<()> {
    if is_likely_mmproj_model_path(model_path) {
        return Err(AppError::invalid_input(
            "The selected GGUF is a multimodal projector, not a chat model. Select the main model GGUF instead.",
        ));
    }
    if !model_path.to_ascii_lowercase().ends_with(".gguf") {
        return Err(AppError::invalid_input("Select a GGUF model file"));
    }
    Ok(())
}

fn huggingface_download_url(repo: &str, branch: &str, model_path: &str) -> String {
    let encoded = model_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(percent_encode_path_segment)
        .collect::<Vec<_>>()
        .join("/");
    format!("https://huggingface.co/{repo}/resolve/{branch}/{encoded}")
}

fn percent_encode_path_segment(segment: &str) -> String {
    segment
        .bytes()
        .flat_map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect::<Vec<_>>()
            }
        })
        .collect()
}

fn extract_quantization_label(filename: &str) -> Option<String> {
    let stem = Path::new(filename)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    for part in stem.split(['-', '_', '.']) {
        let upper = part.to_ascii_uppercase();
        if upper.starts_with('Q') || upper.starts_with("IQ") {
            return Some(upper);
        }
    }
    None
}

struct HuggingFaceTree {
    branch: &'static str,
    entries: Vec<HuggingFaceTreeEntry>,
}

async fn fetch_huggingface_tree(repo: &str) -> AppResult<HuggingFaceTree> {
    let main_url = format!("https://huggingface.co/api/models/{repo}/tree/main?recursive=1");
    match fetch_json::<Vec<HuggingFaceTreeEntry>>(&main_url).await {
        Ok(entries) => Ok(HuggingFaceTree {
            branch: "main",
            entries,
        }),
        Err(main_error) => {
            let master_url =
                format!("https://huggingface.co/api/models/{repo}/tree/master?recursive=1");
            fetch_json::<Vec<HuggingFaceTreeEntry>>(&master_url)
                .await
                .map(|entries| HuggingFaceTree {
                    branch: "master",
                    entries,
                })
                .map_err(|_| main_error)
        }
    }
}

fn custom_model_entry_from_tree_entry(
    repo: &str,
    branch: &str,
    entry: HuggingFaceTreeEntry,
) -> Option<CustomModelEntry> {
    let path = entry.path?;
    if entry.entry_type.as_deref() != Some("file") || !is_supported_llama_cpp_model_filename(&path)
    {
        return None;
    }
    let filename = Path::new(&path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())?;
    Some(CustomModelEntry {
        download_url: huggingface_download_url(repo, branch, &path),
        quantization_label: extract_quantization_label(&filename),
        size_bytes: entry.size.or_else(|| entry.lfs.and_then(|lfs| lfs.size)),
        path,
        filename,
    })
}

async fn list_huggingface_models_inner(repo_input: &str) -> AppResult<Vec<CustomModelEntry>> {
    let repo = validate_huggingface_repo(repo_input)?;
    let tree = fetch_huggingface_tree(&repo).await?;
    let mut models = tree
        .entries
        .into_iter()
        .filter_map(|entry| custom_model_entry_from_tree_entry(&repo, tree.branch, entry))
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.filename.cmp(&right.filename));
    Ok(models)
}

fn select_custom_model_entry(
    models: &[CustomModelEntry],
    model_path: Option<&str>,
) -> AppResult<CustomModelEntry> {
    let requested = model_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Selected GGUF is required"))?;
    if let Some(entry) = models.iter().find(|entry| entry.path == requested) {
        return Ok(entry.clone());
    }
    let filename_matches = models
        .iter()
        .filter(|entry| entry.filename == requested)
        .collect::<Vec<_>>();
    match filename_matches.as_slice() {
        [entry] => Ok((*entry).clone()),
        [] => Err(AppError::invalid_input(
            "Selected GGUF was not found in that repository",
        )),
        _ => Err(AppError::invalid_input(
            "Selected GGUF filename is ambiguous; choose the exact repository path",
        )),
    }
}

fn custom_model_payload(models: Vec<CustomModelEntry>) -> Value {
    json!({
        "models": models
            .into_iter()
            .map(|model| {
                json!({
                    "path": model.path,
                    "filename": model.filename,
                    "sizeBytes": model.size_bytes,
                    "quantizationLabel": model.quantization_label,
                    "downloadUrl": model.download_url,
                })
            })
            .collect::<Vec<_>>()
    })
}

fn curated_model_for_quantization(
    quantization: SidecarQuantization,
) -> AppResult<&'static CuratedSidecarModel> {
    CURATED_MODELS
        .iter()
        .find(|model| model.quantization == quantization)
        .ok_or_else(|| AppError::invalid_input("Unknown sidecar quantization"))
}

async fn download_curated_model_inner(
    state: &LocalSidecarState,
    quantization: SidecarQuantization,
    cancel: watch::Receiver<bool>,
) -> AppResult<()> {
    let model = curated_model_for_quantization(quantization)?;
    let destination = model_path_inside_models_dir(state, model.filename)?;
    if !destination.exists() {
        download_url_to_path(
            model.download_url,
            &destination,
            "model",
            model.label,
            cancel,
        )
        .await?;
    }

    let mut process = SIDECAR_PROCESS.lock().await;
    process.stop_locked().await?;
    drop(process);

    let mut config = read_config(state)?;
    let previous_path = config.model_path.clone();
    config.model_path = Some(destination.to_string_lossy().to_string());
    config.model = SIDECAR_MODEL.to_string();
    config.quantization = Some(quantization);
    config.custom_model_repo = None;
    commit_model_switch(state, &config, previous_path.as_deref())?;
    Ok(())
}

async fn download_custom_model_inner(
    state: &LocalSidecarState,
    repo_input: &str,
    model_path: Option<&str>,
    cancel: watch::Receiver<bool>,
) -> AppResult<()> {
    let repo = validate_huggingface_repo(repo_input)?;
    let models = list_huggingface_models_inner(&repo).await?;
    let selected = select_custom_model_entry(&models, model_path)?;
    assert_supported_llama_cpp_model_path(&selected.path)?;

    let relative_path = managed_custom_model_relative_path(&repo, &selected.path);
    let destination = model_path_inside_models_dir(state, &relative_path)?;
    if !destination.exists() {
        download_url_to_path(
            &selected.download_url,
            &destination,
            "model",
            &selected.filename,
            cancel,
        )
        .await?;
    }

    let mut process = SIDECAR_PROCESS.lock().await;
    process.stop_locked().await?;
    drop(process);

    let mut config = read_config(state)?;
    let previous_path = config.model_path.clone();
    config.model_path = Some(destination.to_string_lossy().to_string());
    config.model = SIDECAR_MODEL.to_string();
    config.quantization = None;
    config.custom_model_repo = Some(repo);
    commit_model_switch(state, &config, previous_path.as_deref())?;
    Ok(())
}

fn commit_model_switch(
    state: &LocalSidecarState,
    config: &LocalSidecarConfig,
    previous_path: Option<&str>,
) -> AppResult<()> {
    write_config(state, config)?;
    if let Err(error) =
        cleanup_previous_managed_model(state, previous_path, config.model_path.as_deref())
    {
        eprintln!(
            "Local Model sidecar previous managed model cleanup failed after config commit: {error}"
        );
    }
    Ok(())
}

fn cleanup_previous_managed_model(
    state: &LocalSidecarState,
    previous: Option<&str>,
    next: Option<&str>,
) -> AppResult<()> {
    let Some(previous) = previous else {
        return Ok(());
    };
    // CONTRACT: local-sidecar-managed-delete - Only app-managed downloads are removed; BYO GGUF paths must survive model switches.
    if Some(previous) == next || !is_managed_model_path(state, previous) {
        return Ok(());
    }
    let previous_path = Path::new(previous);
    if previous_path.exists() {
        fs::remove_file(previous_path)?;
    }
    Ok(())
}

fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let output = StdCommand::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .to_ascii_lowercase(),
    )
}

fn lspci_display_controller_lines(output: &str) -> String {
    output
        .lines()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("vga compatible controller")
                || lower.contains("3d controller")
                || lower.contains("display controller")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn current_gpu_runtime_hints() -> GpuRuntimeHints {
    let mut hints = GpuRuntimeHints::default();
    let mut probe = String::new();
    for key in [
        "CUDA_PATH",
        "HIP_PATH",
        "ROCM_PATH",
        "VULKAN_SDK",
        "ONEAPI_ROOT",
    ] {
        if let Ok(value) = std::env::var(key) {
            probe.push_str(&value);
            probe.push('\n');
        }
    }
    for (command, args) in [
        ("nvidia-smi", &["-L"][..]),
        ("rocminfo", &[][..]),
        ("rocm-smi", &[][..]),
        ("vulkaninfo", &["--summary"][..]),
        ("sycl-ls", &[][..]),
    ] {
        if let Some(output) = command_output(command, args) {
            probe.push_str(&output);
            probe.push('\n');
        }
    }
    match current_platform() {
        "win32" => {
            if let Some(output) =
                command_output("wmic", &["path", "win32_VideoController", "get", "name"])
            {
                probe.push_str(&output);
            }
        }
        "linux" => {
            if let Some(output) = command_output("lspci", &[]) {
                probe.push_str(&lspci_display_controller_lines(&output));
            }
        }
        _ => {}
    }

    let probe = probe.to_ascii_lowercase();
    hints.nvidia = probe.contains("nvidia") || probe.contains("cuda");
    hints.amd = probe.contains("amd")
        || probe.contains("advanced micro devices")
        || probe.contains("radeon")
        || probe.contains("rocm")
        || probe.contains("hip");
    hints.intel = probe.contains("intel") || probe.contains("oneapi") || probe.contains("sycl");
    hints
}

fn push_candidate_once(candidates: &mut Vec<&'static str>, variant: &'static str) {
    if !candidates.contains(&variant) {
        candidates.push(variant);
    }
}

fn runtime_asset_candidates(preference: &str) -> Vec<&'static str> {
    runtime_asset_candidates_for_hints(
        current_platform(),
        current_arch(),
        preference,
        current_gpu_runtime_hints(),
    )
}

fn runtime_asset_candidates_for(platform: &str, arch: &str, preference: &str) -> Vec<&'static str> {
    runtime_asset_candidates_for_hints(platform, arch, preference, GpuRuntimeHints::default())
}

fn runtime_asset_candidates_for_hints(
    platform: &str,
    arch: &str,
    preference: &str,
    hints: GpuRuntimeHints,
) -> Vec<&'static str> {
    match (platform, arch, preference) {
        ("win32", "x64", "nvidia") => vec!["win-x64-cuda"],
        ("win32", "x64", "amd") => vec!["win-x64-hip"],
        ("win32", "x64", "intel") => vec!["win-x64-sycl"],
        ("win32", "x64", "vulkan") => vec!["win-x64-vulkan"],
        ("win32", "x64", "cpu") => vec!["win-x64-cpu"],
        ("win32", "x64", _) => {
            let mut candidates = Vec::new();
            if hints.nvidia {
                push_candidate_once(&mut candidates, "win-x64-cuda");
            }
            if hints.amd {
                push_candidate_once(&mut candidates, "win-x64-hip");
            }
            if hints.intel {
                push_candidate_once(&mut candidates, "win-x64-sycl");
            }
            push_candidate_once(&mut candidates, "win-x64-vulkan");
            push_candidate_once(&mut candidates, "win-x64-cpu");
            candidates
        }
        ("win32", "arm64", "auto") | ("win32", "arm64", "cpu") => vec!["win-arm64-cpu"],
        ("win32", "arm64", _) => Vec::new(),
        ("darwin", "arm64", "auto") => vec!["macos-arm64-metal"],
        ("darwin", "arm64", _) => Vec::new(),
        ("darwin", "x64", "auto") | ("darwin", "x64", "cpu") => vec!["macos-x64-cpu"],
        ("darwin", "x64", _) => Vec::new(),
        ("linux", "x64", "nvidia") => vec!["linux-x64-cuda"],
        ("linux", "x64", "amd") => vec!["linux-x64-rocm"],
        ("linux", "x64", "vulkan") | ("linux", "x64", "intel") => vec!["linux-x64-vulkan"],
        ("linux", "x64", "cpu") => vec!["linux-x64-cpu"],
        ("linux", "x64", _) => {
            let mut candidates = Vec::new();
            if hints.nvidia {
                push_candidate_once(&mut candidates, "linux-x64-cuda");
            }
            if hints.amd {
                push_candidate_once(&mut candidates, "linux-x64-rocm");
            }
            push_candidate_once(&mut candidates, "linux-x64-vulkan");
            push_candidate_once(&mut candidates, "linux-x64-cpu");
            candidates
        }
        ("linux", "arm64", "vulkan") | ("linux", "arm64", "amd") | ("linux", "arm64", "intel") => {
            vec!["linux-arm64-vulkan"]
        }
        ("linux", "arm64", "cpu") => vec!["linux-arm64-cpu"],
        ("linux", "arm64", "auto") => vec!["linux-arm64-cpu"],
        ("linux", "arm64", _) => Vec::new(),
        _ => Vec::new(),
    }
}

fn asset_name_matches_variant(name: &str, variant: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    match variant {
        "win-x64-cuda" => lower.contains("bin-win-cuda-") && lower.ends_with("-x64.zip"),
        "win-x64-hip" => lower.contains("bin-win-hip-x64.zip"),
        "win-x64-sycl" => lower.contains("bin-win-sycl-x64.zip"),
        "win-x64-vulkan" => lower.contains("bin-win-vulkan-x64.zip"),
        "win-x64-cpu" => lower.contains("bin-win-cpu-x64.zip"),
        "win-arm64-cpu" => lower.contains("bin-win-cpu-arm64.zip"),
        "macos-arm64-metal" => lower.contains("bin-macos-arm64") && lower.ends_with(".tar.gz"),
        "macos-x64-cpu" => lower.contains("bin-macos-x64") && lower.ends_with(".tar.gz"),
        "linux-x64-cuda" => lower.contains("bin-ubuntu-cuda-") && lower.ends_with("-x64.tar.gz"),
        "linux-x64-rocm" => lower.contains("bin-ubuntu-rocm-") && lower.ends_with("-x64.tar.gz"),
        "linux-x64-vulkan" => lower.contains("bin-ubuntu-vulkan-x64.tar.gz"),
        "linux-x64-cpu" => lower.contains("bin-ubuntu-x64.tar.gz"),
        "linux-arm64-vulkan" => lower.contains("bin-ubuntu-vulkan-arm64.tar.gz"),
        "linux-arm64-cpu" => lower.contains("bin-ubuntu-arm64.tar.gz"),
        _ => false,
    }
}

fn select_runtime_asset(
    assets: &[GitHubReleaseAsset],
    preference: &str,
) -> AppResult<(String, GitHubReleaseAsset)> {
    for variant in runtime_asset_candidates(preference) {
        if let Some(asset) = assets
            .iter()
            .find(|asset| asset_name_matches_variant(&asset.name, variant))
        {
            return Ok((variant.to_string(), asset.clone()));
        }
    }
    Err(AppError::new(
        "sidecar_runtime_unsupported",
        format!(
            "No llama.cpp runtime asset matched {} / {} / {}",
            current_platform(),
            current_arch(),
            preference
        ),
    ))
}

fn safe_release_asset_filename(name: &str) -> AppResult<String> {
    let filename = name.trim();
    if filename.is_empty()
        || filename == "."
        || filename == ".."
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains(':')
    {
        return Err(AppError::invalid_input(
            "Runtime release asset name is unsafe",
        ));
    }
    Ok(filename.to_string())
}

fn runtime_install_matches_preference(install: &SidecarRuntimeInstall, preference: &str) -> bool {
    match preference {
        "auto" => true,
        "system" => install.record.source == "system",
        "nvidia" | "amd" | "intel" | "vulkan" | "cpu" => {
            install.record.source == "bundled"
                && runtime_asset_candidates_for(
                    &install.record.platform,
                    &install.record.arch,
                    preference,
                )
                .into_iter()
                .any(|variant| variant == install.record.variant)
        }
        _ => false,
    }
}

fn extract_runtime_version(name: &str) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    for marker in ["cuda-", "rocm-"] {
        if let Some(start) = lower.find(marker) {
            let rest = &lower[start + marker.len()..];
            let version = rest
                .chars()
                .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
                .collect::<String>();
            if !version.is_empty() {
                return Some(version);
            }
        }
    }
    None
}

fn windows_cuda_dependency_asset(
    assets: &[GitHubReleaseAsset],
    runtime_asset_name: &str,
) -> Option<GitHubReleaseAsset> {
    let version = extract_runtime_version(runtime_asset_name)?;
    assets
        .iter()
        .find(|asset| {
            let lower = asset.name.to_ascii_lowercase();
            lower.starts_with("cudart-llama")
                && lower.contains(&format!("cuda-{version}"))
                && lower.ends_with("-x64.zip")
        })
        .cloned()
}

async fn find_system_llama_server() -> Option<PathBuf> {
    let candidates: Vec<(&str, Vec<&str>)> = if current_platform() == "win32" {
        vec![
            ("where", vec!["llama-server.exe"]),
            ("where", vec!["llama-server"]),
        ]
    } else {
        vec![("which", vec!["llama-server"])]
    };
    for (command, args) in candidates {
        let Ok(output) = Command::new(command).args(args).output().await else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(first) = stdout.lines().map(str::trim).find(|line| !line.is_empty()) {
            return Some(PathBuf::from(first));
        }
    }
    None
}

fn list_files_recursive(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = fs::metadata(&path)?;
        if metadata.is_file() {
            files.push(path);
            continue;
        }
        if metadata.is_dir() {
            for entry in fs::read_dir(path)? {
                stack.push(entry?.path());
            }
        }
    }
    Ok(files)
}

fn find_executable_recursive(root: &Path, name: &str) -> AppResult<PathBuf> {
    list_files_recursive(root)?
        .into_iter()
        .find(|path| {
            path.file_name()
                .map(|file_name| file_name.to_string_lossy().eq_ignore_ascii_case(name))
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            AppError::new(
                "sidecar_runtime_error",
                format!("Could not find {name} in runtime archive"),
            )
        })
}

fn extract_runtime_archive(archive_path: &Path, extract_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(extract_dir)?;
    let archive = archive_path.to_string_lossy();
    if archive.ends_with(".zip") {
        let file = File::open(archive_path)?;
        let mut zip = zip::ZipArchive::new(file)
            .map_err(|error| AppError::new("sidecar_runtime_error", error.to_string()))?;
        for index in 0..zip.len() {
            let mut entry = zip
                .by_index(index)
                .map_err(|error| AppError::new("sidecar_runtime_error", error.to_string()))?;
            let Some(enclosed_name) = entry.enclosed_name() else {
                return Err(AppError::invalid_input(
                    "Runtime ZIP contained an unsafe path",
                ));
            };
            let outpath = extract_dir.join(enclosed_name);
            ensure_inside_dir(
                extract_dir,
                &outpath,
                "Runtime ZIP entry escaped the extraction directory",
            )?;
            if entry.is_dir() {
                fs::create_dir_all(&outpath)?;
            } else {
                if let Some(parent) = outpath.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut outfile = File::create(&outpath)?;
                io::copy(&mut entry, &mut outfile)?;
            }
        }
        return Ok(());
    }

    if archive.ends_with(".tar.gz") {
        let file = File::open(archive_path)?;
        let decoder = GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        for entry in archive
            .entries()
            .map_err(|error| AppError::new("sidecar_runtime_error", error.to_string()))?
        {
            let mut entry =
                entry.map_err(|error| AppError::new("sidecar_runtime_error", error.to_string()))?;
            let entry_type = entry.header().entry_type();
            if entry_type.is_symlink() || entry_type.is_hard_link() {
                return Err(AppError::invalid_input(
                    "Runtime tar.gz contained an unsafe link entry",
                ));
            }
            let relative_path = safe_archive_entry_path(
                &entry
                    .path()
                    .map_err(|error| AppError::new("sidecar_runtime_error", error.to_string()))?,
                "tar.gz",
            )?;
            let outpath = extract_dir.join(relative_path);
            ensure_inside_dir(
                extract_dir,
                &outpath,
                "Runtime tar.gz entry escaped the extraction directory",
            )?;
            if entry_type.is_dir() {
                fs::create_dir_all(&outpath)?;
            } else if entry_type.is_file() {
                if let Some(parent) = outpath.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut outfile = File::create(&outpath)?;
                io::copy(&mut entry, &mut outfile)?;
            } else {
                return Err(AppError::invalid_input(
                    "Runtime tar.gz contained an unsupported entry type",
                ));
            }
        }
        return Ok(());
    }

    Err(AppError::new(
        "sidecar_runtime_error",
        "Unsupported runtime archive format",
    ))
}

fn safe_archive_entry_path(path: &Path, label: &str) -> AppResult<PathBuf> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.contains(':')
        || normalized
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(AppError::invalid_input(format!(
            "Runtime {label} contained an unsafe path"
        )));
    }
    Ok(normalized.split('/').collect())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> AppResult<()> {
    Ok(())
}

fn system_runtime_install(server_path: PathBuf) -> SidecarRuntimeInstall {
    SidecarRuntimeInstall {
        record: SidecarRuntimeRecord {
            build: format!(
                "system: {}",
                server_path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| "llama-server".to_string())
            ),
            variant: "system-llama-server".to_string(),
            platform: current_platform().to_string(),
            arch: current_arch().to_string(),
            asset_name: "system".to_string(),
            directory_name: String::new(),
            server_relative_path: server_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "llama-server".to_string()),
            installed_at: now_runtime_iso(),
            source: "system".to_string(),
            system_path: Some(server_path.to_string_lossy().to_string()),
        },
        server_path,
    }
}

async fn install_system_runtime(state: &LocalSidecarState) -> AppResult<()> {
    let Some(server_path) = find_system_llama_server().await else {
        return Err(AppError::new(
            "sidecar_runtime_error",
            "No system llama-server was found in PATH",
        ));
    };
    let install = system_runtime_install(server_path);
    write_runtime_install(state, &install)
}

async fn resolve_executable(state: &LocalSidecarState, config: &LocalSidecarConfig) -> AppResult<String> {
    if let Some(path) = config.executable_path.clone() {
        validate_executable_path(&path)?;
        return Ok(path);
    }
    if let Some(install) = current_runtime_install_for_config(state, config)? {
        let executable = install.server_path.to_string_lossy().to_string();
        validate_executable_path(&executable)?;
        return Ok(executable);
    }
    if config.runtime_preference == "system" {
        if let Some(server_path) = find_system_llama_server().await {
            let install = system_runtime_install(server_path);
            write_runtime_install(state, &install)?;
            let executable = install.server_path.to_string_lossy().to_string();
            validate_executable_path(&executable)?;
            return Ok(executable);
        }
    }
    // CONTRACT: local-sidecar-runtime-first - Start/Test must not silently fall through to PATH; setup state should tell the user to install or pick a runtime.
    Err(runtime_missing_error(config))
}

async fn install_runtime_inner(
    state: &LocalSidecarState,
    reinstall: bool,
    cancel: watch::Receiver<bool>,
) -> AppResult<()> {
    let config = read_config(state)?;
    if config.runtime_preference == "system" {
        install_system_runtime(state).await?;
        return Ok(());
    }
    if let Some(current) = current_runtime_install(state)? {
        if !reinstall && runtime_install_matches_preference(&current, &config.runtime_preference) {
            return Ok(());
        }
    }

    let release = fetch_json::<GitHubReleaseResponse>(
        "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest",
    )
    .await?;
    let (variant, asset) = select_runtime_asset(&release.assets, &config.runtime_preference)?;
    let asset_filename = safe_release_asset_filename(&asset.name)?;
    let runtime_root = runtime_dir(state)?;
    let directory_name = format!("{}-{}-{}", release.tag_name, variant, random_suffix(8));
    let final_dir = runtime_root.join(&directory_name);
    let extract_dir = runtime_root.join(format!("{directory_name}.extract"));
    let archive_path = runtime_root.join(&asset_filename);

    let _ = fs::remove_dir_all(&extract_dir);
    let _ = fs::remove_dir_all(&final_dir);
    download_url_to_path(
        &asset.browser_download_url,
        &archive_path,
        "runtime",
        &asset_filename,
        cancel.clone(),
    )
    .await?;
    set_download_progress(SidecarDownloadProgress {
        phase: "runtime".to_string(),
        status: "downloading".to_string(),
        downloaded: 0,
        total: 0,
        speed: 0.0,
        label: Some("Extracting runtime files".to_string()),
        error: None,
    })
    .await;
    extract_runtime_archive(&archive_path, &extract_dir)?;
    if variant == "win-x64-cuda" {
        if let Some(dependency_asset) = windows_cuda_dependency_asset(&release.assets, &asset.name)
        {
            let dependency_filename = safe_release_asset_filename(&dependency_asset.name)?;
            let dependency_path = runtime_root.join(&dependency_filename);
            download_url_to_path(
                &dependency_asset.browser_download_url,
                &dependency_path,
                "runtime",
                &dependency_filename,
                cancel.clone(),
            )
            .await?;
            extract_runtime_archive(&dependency_path, &extract_dir)?;
            let _ = fs::remove_file(&dependency_path);
        }
    }
    let executable_name = if current_platform() == "win32" {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let executable_path = find_executable_recursive(&extract_dir, executable_name)?;
    let server_relative_path = executable_path
        .strip_prefix(&extract_dir)
        .map_err(|_| {
            AppError::new(
                "sidecar_runtime_error",
                "Runtime executable escaped the extraction directory",
            )
        })?
        .to_path_buf();
    fs::rename(&extract_dir, &final_dir)?;
    let final_executable = final_dir.join(&server_relative_path);
    make_executable(&final_executable)?;
    let _ = fs::remove_file(&archive_path);

    let install = SidecarRuntimeInstall {
        record: SidecarRuntimeRecord {
            build: release.tag_name,
            variant,
            platform: current_platform().to_string(),
            arch: current_arch().to_string(),
            asset_name: asset_filename,
            directory_name,
            server_relative_path: final_executable
                .strip_prefix(&final_dir)
                .unwrap_or(&final_executable)
                .to_string_lossy()
                .replace('\\', "/"),
            installed_at: now_runtime_iso(),
            source: "bundled".to_string(),
            system_path: None,
        },
        server_path: final_executable,
    };
    write_runtime_install(state, &install)?;
    cleanup_old_runtime_dirs(state, &install.record.directory_name)?;
    Ok(())
}

fn cleanup_old_runtime_dirs(state: &LocalSidecarState, keep_directory: &str) -> AppResult<()> {
    let root = runtime_dir(state)?;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == keep_directory || name == RUNTIME_CURRENT_FILENAME || name == "sidecar.log" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            let _ = fs::remove_dir_all(path);
        } else if path.is_file() && (name.ends_with(".zip") || name.ends_with(".tar.gz")) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

impl SidecarProcessState {
    fn refresh_exit(&mut self) -> AppResult<()> {
        let Some(child) = self.child.as_mut() else {
            return Ok(());
        };
        if let Some(status) = child
            .try_wait()
            .map_err(|error| AppError::new("sidecar_process_error", error.to_string()))?
        {
            self.child = None;
            self.base_url = None;
            self.signature = None;
            self.status = "server_error".to_string();
            self.startup_error = Some(format!("Local sidecar exited ({status})"));
        }
        Ok(())
    }

    async fn stop_locked(&mut self) -> AppResult<()> {
        if let Some(mut child) = self.child.take() {
            child
                .start_kill()
                .map_err(|error| AppError::new("sidecar_stop_failed", error.to_string()))?;
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
        }
        self.base_url = None;
        self.signature = None;
        self.status = "stopped".to_string();
        Ok(())
    }

    async fn ensure_ready_locked(
        &mut self,
        state: &LocalSidecarState,
        require_enabled: bool,
    ) -> AppResult<String> {
        let config = read_config(state)?;
        if require_enabled && !config.enabled {
            return Err(AppError::invalid_input(
                "Enable Local Model before using the sidecar connection",
            ));
        }
        let model_path = match validate_model_path(&config) {
            Ok(path) => path,
            Err(error) => {
                self.status = "server_error".to_string();
                self.startup_error = Some(error.message.clone());
                return Err(error);
            }
        };
        let executable = match resolve_executable(state, &config).await {
            Ok(path) => path,
            Err(error) => {
                self.status = "server_error".to_string();
                self.startup_error = Some(error.message.clone());
                return Err(error);
            }
        };
        let signature = config_signature(state, &config);

        self.refresh_exit()?;
        if self.child.is_some()
            && self.status == "ready"
            && self.signature.as_deref() == Some(signature.as_str())
        {
            if let Some(base_url) = self.base_url.clone() {
                return Ok(base_url);
            }
        }

        self.stop_locked().await?;
        self.status = "starting".to_string();
        self.startup_error = None;

        let log_path = log_path(state)?;
        let mut failed_attempts = Vec::new();
        for plan in llama_startup_plans(&config) {
            let port = find_free_port()?;
            let base_url = format!("http://127.0.0.1:{port}");
            let args = sidecar_args(&config, &model_path, port, &plan);
            let (stdout, stderr) = open_sidecar_log(&log_path)?;
            let mut command = Command::new(&executable);
            command
                .args(&args)
                .stdout(stdout)
                .stderr(stderr)
                .kill_on_drop(true);
            #[cfg(target_os = "windows")]
            {
                command.creation_flags(CREATE_NO_WINDOW);
            }

            let mut child = command.spawn().map_err(|error| {
                AppError::new(
                    "sidecar_start_failed",
                    format!("Failed to start local sidecar executable at {executable}: {error}"),
                )
            })?;

            match wait_for_ready(&base_url, &mut child).await {
                Ok(()) => {
                    self.child = Some(child);
                    self.base_url = Some(base_url.clone());
                    self.signature = Some(signature);
                    self.status = "ready".to_string();
                    self.startup_error = None;
                    return Ok(base_url);
                }
                Err(error) => {
                    let _ = child.start_kill();
                    let message = format!("{} failed: {}", plan.label, error.message);
                    failed_attempts.push(message);
                }
            }
        }
        let message = failed_attempts.join("; ");
        self.child = None;
        self.base_url = None;
        self.signature = None;
        self.status = "server_error".to_string();
        self.startup_error = Some(message.clone());
        Err(AppError::new("sidecar_start_failed", message))
    }
}

async fn status_payload(state: &LocalSidecarState) -> AppResult<Value> {
    let config = read_config(state)?;
    let log_path = log_path(state)?;
    let mut process = SIDECAR_PROCESS.lock().await;
    process.refresh_exit()?;
    let download = SIDECAR_DOWNLOAD.lock().await;
    let status = if download.active {
        match download
            .progress
            .as_ref()
            .map(|progress| progress.phase.as_str())
        {
            Some("runtime") => "downloading_runtime",
            Some("model") => "downloading_model",
            _ => "downloading_model",
        }
    } else if process.status.is_empty() {
        if configured(&config) {
            "downloaded"
        } else {
            "not_configured"
        }
    } else {
        process.status.as_str()
    };
    Ok(json!({
        "id": SIDECAR_CONNECTION_ID,
        "status": status,
        "configured": configured(&config),
        "enabled": config.enabled,
        "config": config,
        "ready": process.status == "ready" && process.base_url.is_some(),
        "baseUrl": process.base_url.clone(),
        "logPath": log_path.to_string_lossy(),
        "startupError": process.startup_error.clone(),
        "modelDownloaded": configured(&config) && validate_model_path(&config).is_ok(),
        "modelDisplayName": model_display_name(&config),
        "modelSize": model_size(&config),
        "runtime": runtime_info_payload(state, &config),
        "platform": current_platform(),
        "arch": current_arch(),
        "curatedModels": curated_models_payload(),
        "download": download.progress.clone(),
    }))
}

pub async fn status(state: &LocalSidecarState) -> AppResult<Value> {
    status_payload(state).await
}

fn should_stop_for_config_update(
    has_child: bool,
    current_signature: Option<&str>,
    next_enabled: bool,
    next_signature: &str,
) -> bool {
    // A resident child must stop when it is disabled or when any launch/runtime
    // field changes. The next signature is the single inventory of those fields:
    // executable/runtime install, model path/name, context and token limits,
    // sampling values, and GPU layers. New config fields that affect the child
    // command must be added to config_signature and its tests.
    has_child && (!next_enabled || current_signature != Some(next_signature))
}

pub async fn update_config(state: &LocalSidecarState, body: Value) -> AppResult<Value> {
    let current = read_config(state)?;
    let next = patch_config(current, body)?;
    write_config(state, &next)?;

    let mut process = SIDECAR_PROCESS.lock().await;
    process.refresh_exit()?;
    let next_signature = config_signature(state, &next);
    if should_stop_for_config_update(
        process.child.is_some(),
        process.signature.as_deref(),
        next.enabled,
        &next_signature,
    ) {
        process.stop_locked().await?;
    }
    drop(process);

    status_payload(state).await
}

pub async fn runtime_install(state: &LocalSidecarState, body: Value) -> AppResult<Value> {
    let reinstall = body
        .get("reinstall")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let cancel = begin_download_job("runtime", "Installing local runtime").await?;
    let app_state = state.clone();
    tokio::spawn(async move {
        let result = install_runtime_inner(&app_state, reinstall, cancel).await;
        finish_download_job(result, "runtime", "Local runtime").await;
    });
    status_payload(state).await
}

pub async fn download_curated(state: &LocalSidecarState, body: Value) -> AppResult<Value> {
    let quantization = SidecarQuantization::from_value(&body)?;
    let model = curated_model_for_quantization(quantization)?;
    let cancel = begin_download_job("model", model.label).await?;
    let app_state = state.clone();
    tokio::spawn(async move {
        let result = download_curated_model_inner(&app_state, quantization, cancel).await;
        finish_download_job(result, "model", model.label).await;
    });
    status_payload(state).await
}

pub async fn list_huggingface_models(
    _state: &LocalSidecarState,
    body: Value,
) -> AppResult<Value> {
    let repo = body
        .get("repo")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input("repo is required"))?;
    Ok(custom_model_payload(
        list_huggingface_models_inner(repo).await?,
    ))
}

pub async fn download_custom(state: &LocalSidecarState, body: Value) -> AppResult<Value> {
    let repo = body
        .get("repo")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input("repo is required"))?
        .to_string();
    let model_path = body
        .get("modelPath")
        .and_then(Value::as_str)
        .map(str::to_string);
    let label = model_path
        .as_deref()
        .and_then(|path| Path::new(path).file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "Custom GGUF".to_string());
    let cancel = begin_download_job("model", &label).await?;
    let app_state = state.clone();
    tokio::spawn(async move {
        let result =
            download_custom_model_inner(&app_state, &repo, model_path.as_deref(), cancel).await;
        finish_download_job(result, "model", &label).await;
    });
    status_payload(state).await
}

pub async fn download_cancel(_state: &LocalSidecarState) -> AppResult<Value> {
    cancel_download().await
}

pub async fn delete_model(state: &LocalSidecarState) -> AppResult<Value> {
    let mut process = SIDECAR_PROCESS.lock().await;
    if active_inference_count() > 0 {
        return Err(sidecar_inference_busy_error());
    }
    process.stop_locked().await?;
    drop(process);
    let mut config = read_config(state)?;
    let previous_path = config.model_path.clone();
    if let Some(path) = previous_path.as_deref() {
        if is_managed_model_path(state, path) && Path::new(path).is_file() {
            fs::remove_file(path)?;
        }
    }
    config.model_path = None;
    config.quantization = None;
    config.custom_model_repo = None;
    write_config(state, &config)?;
    status_payload(state).await
}

pub async fn start(state: &LocalSidecarState) -> AppResult<Value> {
    let mut process = SIDECAR_PROCESS.lock().await;
    process.ensure_ready_locked(state, false).await?;
    drop(process);
    status_payload(state).await
}

pub async fn shutdown() -> AppResult<()> {
    // Startup owns this mutex while it tries at most two 60-second readiness plans.
    // Keep acquisition bounded without canceling stop_locked after it owns the child.
    shutdown_with_lock_timeout(Duration::from_secs(180)).await
}

async fn shutdown_with_lock_timeout(lock_timeout: Duration) -> AppResult<()> {
    let mut process = tokio::time::timeout(lock_timeout, SIDECAR_PROCESS.lock())
        .await
        .map_err(|_| {
            AppError::new(
                "sidecar_shutdown_timeout",
                "Timed out waiting for managed local model state during shutdown",
            )
        })?;
    process.stop_locked().await
}

pub async fn stop(state: &LocalSidecarState) -> AppResult<Value> {
    let mut process = SIDECAR_PROCESS.lock().await;
    process.stop_locked().await?;
    process.startup_error = None;
    drop(process);
    status_payload(state).await
}

pub async fn restart(state: &LocalSidecarState) -> AppResult<Value> {
    let mut process = SIDECAR_PROCESS.lock().await;
    process.stop_locked().await?;
    process.ensure_ready_locked(state, false).await?;
    drop(process);
    status_payload(state).await
}

pub async fn runtime_connection_value(
    state: &LocalSidecarState,
    require_enabled: bool,
) -> AppResult<Value> {
    // LEGACY_PARITY: local-sidecar-connection - Keep the sidecar selectable as a synthetic connection without storing it in `connections`.
    let base_url = {
        let mut process = SIDECAR_PROCESS.lock().await;
        process.ensure_ready_locked(state, require_enabled).await?
    };
    let config = read_config(state)?;
    Ok(json!({
        "id": SIDECAR_CONNECTION_ID,
        "name": "Local Model",
        "provider": "custom",
        "baseUrl": format!("{base_url}/v1"),
        "apiKey": "local-sidecar",
        "model": config.model,
        "maxContext": config.context_size,
        "embeddingModel": config.model,
        "embeddingBaseUrl": format!("{base_url}/v1"),
        "maxTokensOverride": config.max_tokens,
        "defaultParameters": {
            "temperature": config.temperature,
            "topP": config.top_p,
            "topK": config.top_k,
            "maxTokens": config.max_tokens
        }
    }))
}

pub async fn begin_inference_request(
    state: &LocalSidecarState,
    require_enabled: bool,
) -> AppResult<SidecarInferenceLease> {
    let base_url = {
        let mut process = SIDECAR_PROCESS.lock().await;
        let base_url = process.ensure_ready_locked(state, require_enabled).await?;
        SIDECAR_ACTIVE_REQUESTS.fetch_add(1, Ordering::SeqCst);
        base_url
    };
    Ok(SidecarInferenceLease { base_url })
}

#[cfg(test)]
fn begin_test_inference_request() -> SidecarInferenceLease {
    SIDECAR_ACTIVE_REQUESTS.fetch_add(1, Ordering::SeqCst);
    SidecarInferenceLease {
        base_url: "http://127.0.0.1:1".to_string(),
    }
}

pub async fn models(state: &LocalSidecarState) -> AppResult<Value> {
    let config = read_config(state)?;
    Ok(json!([{
        "id": config.model,
        "name": "Local Model",
        "provider": "custom",
        "context": config.context_size,
        "fromProvider": false
    }]))
}

fn smoke_test_request(model: &str, nonce: &str) -> Value {
    json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are a local runtime smoke test. Follow the user's format exactly and include the verification token."
            },
            {
                "role": "user",
                "content": format!("Reply in exactly two lines.\nLine 1: TOKEN {nonce}\nLine 2: one short sentence confirming that the local sidecar test succeeded.")
            }
        ],
        "max_tokens": 48,
        "temperature": 0.2,
        "reasoning_format": "none",
        "chat_template_kwargs": {
            "enable_thinking": false
        }
    })
}

fn smoke_test_output_text(payload: &Value) -> String {
    smoke_test_output(payload).response
}

#[derive(Debug, PartialEq, Eq)]
struct SmokeTestOutput {
    response: String,
    message_content: String,
    reasoning_content: String,
}

fn smoke_test_output(payload: &Value) -> SmokeTestOutput {
    let message = payload
        .pointer("/choices/0/message")
        .unwrap_or(&Value::Null);
    let message_content = message
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    let reasoning_content = message
        .get("reasoning_content")
        .or_else(|| message.get("reasoning"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    let response = if !message_content.is_empty() {
        message_content.clone()
    } else {
        reasoning_content.clone()
    };

    SmokeTestOutput {
        response,
        message_content,
        reasoning_content,
    }
}

fn current_runtime_variant_for_config(
    state: &LocalSidecarState,
    config: &LocalSidecarConfig,
) -> Option<String> {
    current_runtime_install_for_config(state, config)
        .ok()
        .flatten()
        .map(|install| install.record.variant)
}

fn smoke_test_failure_payload(
    started: Instant,
    error: &AppError,
    failed_runtime_variant: Option<String>,
) -> Value {
    json!({
        "success": false,
        "response": "",
        "messageContent": "",
        "reasoningContent": "",
        "nonce": null,
        "nonceVerified": false,
        "latencyMs": started.elapsed().as_millis(),
        "usage": Value::Null,
        "timings": Value::Null,
        "error": error.message,
        "errorCode": error.code,
        "details": error.details.clone().unwrap_or(Value::Null),
        "failedRuntimeVariant": failed_runtime_variant
    })
}

fn smoke_test_success_payload(started: Instant, nonce: String, payload: &Value) -> Value {
    let output = smoke_test_output(payload);
    json!({
        "success": true,
        "response": output.response,
        "messageContent": output.message_content,
        "reasoningContent": output.reasoning_content,
        "nonce": nonce,
        "nonceVerified": true,
        "latencyMs": started.elapsed().as_millis(),
        "usage": payload.get("usage").cloned().unwrap_or(Value::Null),
        "timings": payload.get("timings").cloned().unwrap_or(Value::Null),
        "failedRuntimeVariant": Value::Null
    })
}

pub async fn test_message(state: &LocalSidecarState) -> AppResult<Value> {
    let started = Instant::now();
    let config = read_config(state)?;
    let failed_runtime_variant = current_runtime_variant_for_config(state, &config);
    let lease = match begin_inference_request(state, false).await {
        Ok(lease) => lease,
        Err(error) => {
            return Ok(smoke_test_failure_payload(
                started,
                &error,
                failed_runtime_variant,
            ))
        }
    };
    let nonce: String = rand::rng()
        .sample_iter(Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            let error = AppError::new("sidecar_client_error", error.to_string());
            return Ok(smoke_test_failure_payload(
                started,
                &error,
                failed_runtime_variant,
            ));
        }
    };
    let response = match client
        .post(format!("{}/v1/chat/completions", lease.base_url()))
        .json(&smoke_test_request(&config.model, &nonce))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            let error = AppError::new("sidecar_test_failed", error.to_string());
            return Ok(smoke_test_failure_payload(
                started,
                &error,
                failed_runtime_variant,
            ));
        }
    };
    let status = response.status();
    let payload: Value = match response.json().await {
        Ok(payload) => payload,
        Err(error) => {
            let error = AppError::new("sidecar_test_failed", error.to_string());
            return Ok(smoke_test_failure_payload(
                started,
                &error,
                failed_runtime_variant,
            ));
        }
    };
    if !status.is_success() {
        let error = AppError::with_details(
            "sidecar_test_failed",
            format!("Local sidecar returned HTTP {status}"),
            payload,
        );
        return Ok(smoke_test_failure_payload(
            started,
            &error,
            failed_runtime_variant,
        ));
    }
    let content = smoke_test_output_text(&payload);
    if content.is_empty() {
        let error = AppError::with_details(
            "sidecar_test_failed",
            "The local sidecar test returned an empty response",
            payload,
        );
        return Ok(smoke_test_failure_payload(
            started,
            &error,
            failed_runtime_variant,
        ));
    }
    if !content.contains(&nonce) {
        let error = AppError::with_details(
            "sidecar_test_failed",
            "The local sidecar test response did not include the verification token",
            payload,
        );
        return Ok(smoke_test_failure_payload(
            started,
            &error,
            failed_runtime_variant,
        ));
    }
    Ok(smoke_test_success_payload(started, nonce, &payload))
}

#[cfg(test)]
mod tests {
    use super::*;
        use flate2::{write::GzEncoder, Compression};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

    static SIDECAR_PROCESS_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-sidecar-{label}-{nonce}"));
        if path.exists() {
            fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        fs::create_dir_all(&path).expect("temp dir should be creatable");
        path
    }

    fn test_state(label: &str) -> LocalSidecarState {
        LocalSidecarState::new(temp_dir(label))
    }

    #[tokio::test]
    async fn shutdown_is_idempotent_without_a_managed_child() {
        let _test_guard = SIDECAR_PROCESS_TEST_LOCK.lock().await;
        shutdown()
            .await
            .expect("shutdown without a managed child should succeed");
        shutdown()
            .await
            .expect("repeated shutdown without a managed child should succeed");
    }

    #[tokio::test]
    async fn shutdown_bounds_managed_state_lock_acquisition() {
        let _test_guard = SIDECAR_PROCESS_TEST_LOCK.lock().await;
        let process_guard = SIDECAR_PROCESS.lock().await;

        let error = shutdown_with_lock_timeout(Duration::from_millis(20))
            .await
            .expect_err("shutdown should time out while managed state is locked");

        drop(process_guard);
        assert_eq!(error.code, "sidecar_shutdown_timeout");
    }

    #[test]
    fn blocking_sidecar_fixture() {
        if std::env::var_os("DE_KOI_BLOCKING_SIDECAR_FIXTURE").is_none() {
            return;
        }

        use std::io::Write as _;
        println!("DE_KOI_BLOCKING_SIDECAR_READY");
        std::io::stdout()
            .flush()
            .expect("fixture ready marker should flush");
        loop {
            std::thread::park_timeout(Duration::from_secs(60));
        }
    }

    #[tokio::test]
    async fn shutdown_terminates_and_reaps_a_managed_child() {
        let _test_guard = SIDECAR_PROCESS_TEST_LOCK.lock().await;
        shutdown()
            .await
            .expect("test should begin without a managed child");

        let mut command =
            Command::new(std::env::current_exe().expect("test binary should resolve"));
        command
            .arg("--exact")
            .arg("tests::blocking_sidecar_fixture")
            .arg("--nocapture")
            .env("DE_KOI_BLOCKING_SIDECAR_FIXTURE", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().expect("blocking fixture should start");
        let stdout = child
            .stdout
            .take()
            .expect("blocking fixture stdout should be piped");
        let mut stdout = BufReader::new(stdout);
        tokio::time::timeout(Duration::from_secs(5), async {
            let mut line = String::new();
            loop {
                line.clear();
                let bytes = stdout
                    .read_line(&mut line)
                    .await
                    .expect("fixture stdout should be readable");
                assert!(bytes > 0, "fixture exited before reporting ready");
                if line.contains("DE_KOI_BLOCKING_SIDECAR_READY") {
                    break;
                }
            }
        })
        .await
        .expect("blocking fixture should report ready");

        {
            let mut process = SIDECAR_PROCESS.lock().await;
            assert!(process.child.is_none(), "test state should be isolated");
            process.child = Some(child);
            process.status = "ready".to_string();
        }

        shutdown().await.expect("managed child should stop cleanly");

        let mut remainder = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), stdout.read_to_end(&mut remainder))
            .await
            .expect("managed child stdout should close after shutdown")
            .expect("managed child stdout should reach EOF");
        let process = SIDECAR_PROCESS.lock().await;
        assert!(process.child.is_none(), "managed child should be reaped");
        assert_eq!(process.status, "stopped");
    }

    fn write_fake_bundled_runtime_install(
        state: &LocalSidecarState,
        variant: &str,
    ) -> SidecarRuntimeInstall {
        write_fake_bundled_runtime_install_for(state, variant, current_platform(), current_arch())
    }

    fn write_fake_bundled_runtime_install_for(
        state: &LocalSidecarState,
        variant: &str,
        platform: &str,
        arch: &str,
    ) -> SidecarRuntimeInstall {
        let directory_name = format!("test-{variant}");
        let executable_relative = PathBuf::from("bin").join("llama-server");
        let executable_path = runtime_dir(state)
            .expect("runtime dir should resolve")
            .join(&directory_name)
            .join(&executable_relative);
        fs::create_dir_all(
            executable_path
                .parent()
                .expect("executable should have parent"),
        )
        .expect("runtime executable parent should be creatable");
        fs::write(&executable_path, b"server").expect("runtime executable should be writable");
        let install = SidecarRuntimeInstall {
            record: SidecarRuntimeRecord {
                build: "test-build".to_string(),
                variant: variant.to_string(),
                platform: platform.to_string(),
                arch: arch.to_string(),
                asset_name: "test-runtime.tar.gz".to_string(),
                directory_name,
                server_relative_path: executable_relative.to_string_lossy().replace('\\', "/"),
                installed_at: now_runtime_iso(),
                source: "bundled".to_string(),
                system_path: None,
            },
            server_path: executable_path,
        };
        write_runtime_install(state, &install).expect("runtime current file should be writable");
        install
    }

    fn write_tar_gz_file(archive_path: &Path, entry_path: &str, contents: &[u8]) {
        let file = File::create(archive_path).expect("archive file should be creatable");
        let encoder = GzEncoder::new(file, Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        let mut reader = contents;
        builder
            .append_data(&mut header, entry_path, &mut reader)
            .expect("tar entry should be appendable");
        let encoder = builder.into_inner().expect("tar builder should finish");
        encoder.finish().expect("gzip encoder should finish");
    }

    fn write_tar_gz_symlink(archive_path: &Path, entry_path: &str, target: &str) {
        let file = File::create(archive_path).expect("archive file should be creatable");
        let encoder = GzEncoder::new(file, Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        header.set_cksum();
        builder
            .append_link(&mut header, entry_path, target)
            .expect("tar symlink should be appendable");
        let encoder = builder.into_inner().expect("tar builder should finish");
        encoder.finish().expect("gzip encoder should finish");
    }

    #[test]
    fn log_tail_reads_last_requested_lines() {
        let state = test_state("log-tail");
        let path = log_path(&state).expect("log path should resolve");
        fs::write(&path, "line 1\nline 2\nline 3\nline 4\n")
            .expect("log file should be writable");

        let tail = log_tail(&state, 2).expect("log tail should be readable");

        assert_eq!(tail["available"], true);
        assert_eq!(tail["truncated"], true);
        assert_eq!(tail["lines"], json!(["line 3", "line 4"]));
        assert_eq!(tail["path"].as_str(), Some(path.to_string_lossy().as_ref()));
    }

    #[test]
    fn config_update_stops_only_a_resident_child_that_is_disabled_or_changed() {
        assert!(should_stop_for_config_update(
            true,
            Some("same-signature"),
            false,
            "same-signature"
        ));
        assert!(!should_stop_for_config_update(
            true,
            Some("same-signature"),
            true,
            "same-signature"
        ));
        assert!(should_stop_for_config_update(
            true,
            Some("old-signature"),
            true,
            "new-signature"
        ));
        assert!(!should_stop_for_config_update(
            false,
            Some("old-signature"),
            false,
            "new-signature"
        ));
    }

    #[tokio::test]
    async fn malformed_config_errors_and_patch_does_not_overwrite() {
        let state = test_state("malformed-config");
        let path = config_path(&state).expect("config path should resolve");
        fs::write(&path, "{not-json").expect("malformed config should be writable");

        let read_error = read_config(&state).expect_err("malformed config should not default");
        let patch_error = update_config(&state, json!({ "enabled": true }))
            .await
            .expect_err("patch should not overwrite malformed config");

        assert_eq!(read_error.code, "sidecar_config_error");
        assert_eq!(patch_error.code, "sidecar_config_error");
        assert_eq!(
            fs::read_to_string(&path).expect("malformed config should still be readable"),
            "{not-json"
        );

        let missing_state = test_state("missing-config-defaults");
        let default_config = read_config(&missing_state).expect("missing config should default");
        assert!(!default_config.enabled);
        assert_eq!(default_config.model_path, None);
        assert_eq!(default_config.model, SIDECAR_MODEL);
    }

    #[tokio::test]
    async fn persisted_invalid_runtime_preference_errors_and_patch_does_not_overwrite() {
        let state = test_state("invalid-runtime-preference");
        let path = config_path(&state).expect("config path should resolve");
        fs::write(
            &path,
            serde_json::to_string_pretty(&json!({
                "enabled": true,
                "runtimePreference": "unsupported"
            }))
            .expect("invalid config json should serialize"),
        )
        .expect("invalid config should be writable");

        let read_error = read_config(&state)
            .expect_err("persisted invalid runtimePreference should not normalize to auto");
        let patch_error = update_config(&state, json!({ "model": "local-sidecar" }))
            .await
            .expect_err("patch should not overwrite invalid persisted runtimePreference");

        assert_eq!(read_error.code, "sidecar_config_error");
        assert_eq!(patch_error.code, "sidecar_config_error");
        assert!(fs::read_to_string(&path)
            .expect("invalid config should remain readable")
            .contains("unsupported"));

        let missing_field_state = test_state("missing-runtime-preference");
        let missing_field_path =
            config_path(&missing_field_state).expect("config path should resolve");
        fs::write(&missing_field_path, json!({ "enabled": true }).to_string())
            .expect("legacy config should be writable");
        let legacy_config =
            read_config(&missing_field_state).expect("missing runtimePreference should default");

        assert!(legacy_config.enabled);
        assert_eq!(legacy_config.runtime_preference, "auto");
    }

    #[tokio::test]
    async fn invalid_config_patch_shapes_do_not_rewrite_persisted_paths() {
        let state = test_state("invalid-config-patch");
        let config = LocalSidecarConfig {
            enabled: true,
            model_path: Some("old-model.gguf".to_string()),
            executable_path: Some("old-runtime".to_string()),
            context_size: 2048,
            runtime_preference: "cpu".to_string(),
            ..LocalSidecarConfig::default()
        };
        write_config(&state, &config).expect("config should be writable");

        let model_path_error = update_config(&state, json!({ "modelPath": 123 }))
            .await
            .expect_err("non-string modelPath should be rejected");
        let enabled_error = update_config(&state, json!({ "enabled": "false" }))
            .await
            .expect_err("non-boolean enabled should be rejected");
        let context_error = update_config(&state, json!({ "contextSize": "8192" }))
            .await
            .expect_err("non-integer contextSize should be rejected");
        let runtime_error = update_config(&state, json!({ "runtimePreference": 7 }))
            .await
            .expect_err("non-string runtimePreference should be rejected");
        let non_object_error = update_config(&state, json!(["not", "an", "object"]))
            .await
            .expect_err("non-object config patch should be rejected");
        let stored = read_config(&state).expect("stored config should still be readable");

        assert_eq!(model_path_error.code, "invalid_input");
        assert_eq!(enabled_error.code, "invalid_input");
        assert_eq!(context_error.code, "invalid_input");
        assert_eq!(runtime_error.code, "invalid_input");
        assert_eq!(non_object_error.code, "invalid_input");
        assert!(stored.enabled);
        assert_eq!(stored.model_path, Some("old-model.gguf".to_string()));
        assert_eq!(stored.executable_path, Some("old-runtime".to_string()));
        assert_eq!(stored.context_size, 2048);
        assert_eq!(stored.runtime_preference, "cpu");
    }

    #[tokio::test]
    async fn delete_model_rejects_active_inference_and_preserves_model() {
        let state = test_state("delete-active-inference");
        let model_path = model_path_inside_models_dir(&state, "busy-model.gguf")
            .expect("managed model path should resolve");
        fs::write(&model_path, b"gguf").expect("managed model fixture should be writable");
        let model_path_string = model_path.to_string_lossy().to_string();
        write_config(
            &state,
            &LocalSidecarConfig {
                enabled: true,
                model_path: Some(model_path_string.clone()),
                ..LocalSidecarConfig::default()
            },
        )
        .expect("sidecar config should be writable");

        let lease = begin_test_inference_request();
        let error = delete_model(&state)
            .await
            .expect_err("active inference should block model deletion");

        assert_eq!(error.code, "sidecar_inference_busy");
        assert!(model_path.is_file());
        assert_eq!(
            read_config(&state)
                .expect("config should remain readable")
                .model_path,
            Some(model_path_string)
        );

        drop(lease);
        delete_model(&state)
            .await
            .expect("idle sidecar should allow model deletion");
        assert!(!model_path.exists());
        assert_eq!(
            read_config(&state)
                .expect("config should remain readable")
                .model_path,
            None
        );
    }

    #[test]
    fn nullable_string_patch_supports_clear_and_update_only() {
        let config = LocalSidecarConfig {
            model_path: Some("old-model.gguf".to_string()),
            executable_path: Some("old-runtime".to_string()),
            ..LocalSidecarConfig::default()
        };

        let number_error = patch_config(config.clone(), json!({ "executablePath": 123 }))
            .expect_err("non-string executablePath should be rejected");
        let null_clear = patch_config(config.clone(), json!({ "modelPath": null }))
            .expect("null should clear modelPath");
        let empty_clear = patch_config(config.clone(), json!({ "modelPath": "   " }))
            .expect("empty string should clear modelPath");
        let update = patch_config(config, json!({ "modelPath": " next-model.gguf " }))
            .expect("string should update modelPath");

        assert_eq!(number_error.code, "invalid_input");
        assert_eq!(null_clear.model_path, None);
        assert_eq!(empty_clear.model_path, None);
        assert_eq!(update.model_path, Some("next-model.gguf".to_string()));
    }

    #[test]
    fn scalar_patch_fields_reject_wrong_types_and_update_valid_values() {
        let config = LocalSidecarConfig::default();
        for patch in [
            json!({ "enabled": "false" }),
            json!({ "model": "" }),
            json!({ "model": null }),
            json!({ "contextSize": "8192" }),
            json!({ "contextSize": -1 }),
            json!({ "contextSize": 999999999999u64 }),
            json!({ "maxTokens": false }),
            json!({ "maxTokens": 999999999999u64 }),
            json!({ "temperature": "0.4" }),
            json!({ "topP": false }),
            json!({ "topK": 1.5 }),
            json!({ "topK": 999999999999u64 }),
            json!({ "gpuLayers": 1.5 }),
            json!({ "gpuLayers": 999999999999u64 }),
            json!({ "runtimePreference": 7 }),
            json!({ "runtimePreference": "unsupported" }),
        ] {
            let error =
                patch_config(config.clone(), patch).expect_err("bad scalar patch should fail");
            assert_eq!(error.code, "invalid_input");
        }

        let updated = patch_config(
            config,
            json!({
                "enabled": true,
                "model": " sidecar-model ",
                "contextSize": 4096,
                "maxTokens": 512,
                "temperature": 0.4,
                "topP": 0.8,
                "topK": 32,
                "gpuLayers": -1,
                "runtimePreference": "cpu"
            }),
        )
        .expect("valid scalar patch should update config");

        assert!(updated.enabled);
        assert_eq!(updated.model, "sidecar-model");
        assert_eq!(updated.context_size, 4096);
        assert_eq!(updated.max_tokens, 512);
        assert_eq!(updated.temperature, 0.4);
        assert_eq!(updated.top_p, 0.8);
        assert_eq!(updated.top_k, 32);
        assert_eq!(updated.gpu_layers, -1);
        assert_eq!(updated.runtime_preference, "cpu");
    }

    #[test]
    fn release_asset_filename_rejects_path_metadata() {
        assert_eq!(
            safe_release_asset_filename(" llama-b0000-bin-ubuntu-x64.tar.gz ")
                .expect("plain filename should be accepted"),
            "llama-b0000-bin-ubuntu-x64.tar.gz"
        );

        for name in [
            "",
            ".",
            "..",
            "../llama-b0000-bin-ubuntu-x64.tar.gz",
            r"..\llama-b0000-bin-win-cpu-x64.zip",
            "nested/llama-b0000-bin-ubuntu-x64.tar.gz",
            r"nested\llama-b0000-bin-win-cpu-x64.zip",
            "C:llama-b0000-bin-win-cpu-x64.zip",
        ] {
            assert!(
                safe_release_asset_filename(name).is_err(),
                "{name} should be rejected before joining runtime paths"
            );
        }
    }

    #[test]
    fn commit_model_switch_keeps_config_when_cleanup_fails() {
        let state = test_state("model-switch-cleanup-fails");
        let previous_path = model_path_inside_models_dir(&state, "previous-as-directory")
            .expect("previous managed path should resolve");
        let next_path = model_path_inside_models_dir(&state, "next.gguf")
            .expect("next managed path should resolve");
        fs::create_dir_all(&previous_path).expect("previous managed directory should be creatable");
        fs::write(&next_path, b"next").expect("next managed model should be writable");
        let config = LocalSidecarConfig {
            model_path: Some(next_path.to_string_lossy().to_string()),
            model: SIDECAR_MODEL.to_string(),
            ..LocalSidecarConfig::default()
        };
        let previous_path_string = previous_path.to_string_lossy().to_string();

        commit_model_switch(&state, &config, Some(previous_path_string.as_str()))
            .expect("cleanup failure should not fail committed switch");
        let stored = read_config(&state).expect("committed config should be readable");

        assert_eq!(stored.model_path, config.model_path);
        assert!(previous_path.exists());
    }

    #[test]
    fn commit_model_switch_removes_previous_managed_model_when_cleanup_succeeds() {
        let state = test_state("model-switch-cleanup-succeeds");
        let previous_path = model_path_inside_models_dir(&state, "previous.gguf")
            .expect("previous managed path should resolve");
        let next_path = model_path_inside_models_dir(&state, "next.gguf")
            .expect("next managed path should resolve");
        fs::write(&previous_path, b"previous").expect("previous managed model should be writable");
        fs::write(&next_path, b"next").expect("next managed model should be writable");
        let config = LocalSidecarConfig {
            model_path: Some(next_path.to_string_lossy().to_string()),
            model: SIDECAR_MODEL.to_string(),
            ..LocalSidecarConfig::default()
        };
        let previous_path_string = previous_path.to_string_lossy().to_string();

        commit_model_switch(&state, &config, Some(previous_path_string.as_str()))
            .expect("cleanup success should keep command successful");

        assert!(!previous_path.exists());
        assert_eq!(
            read_config(&state)
                .expect("committed config should be readable")
                .model_path,
            config.model_path
        );
    }

    #[tokio::test]
    async fn download_cancel_aborts_stalled_chunk_read() {
        let root = temp_dir("cancel-stalled-download");
        let destination = root.join("model.gguf");
        fs::write(destination.with_extension("gguf.download"), b"partial")
            .expect("partial fixture should be writable");
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("stalled test server should bind");
        let addr = listener
            .local_addr()
            .expect("stalled test server address should resolve");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener
                .accept()
                .await
                .expect("stalled test server should accept one request");
            let mut request = [0u8; 1024];
            let _ = socket
                .read(&mut request)
                .await
                .expect("request should be readable");
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n")
                .await
                .expect("headers should be writable");
            tokio::time::sleep(Duration::from_secs(30)).await;
        });
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let download = tokio::spawn({
            let destination = destination.clone();
            async move {
                download_url_to_path(
                    &format!("http://{addr}/model.gguf"),
                    &destination,
                    "model",
                    "Stalled model",
                    cancel_rx,
                )
                .await
            }
        });

        tokio::time::sleep(Duration::from_millis(100)).await;
        cancel_tx
            .send(true)
            .expect("active download should receive cancel");
        let result = tokio::time::timeout(Duration::from_secs(2), download)
            .await
            .expect("cancel should abort the stalled chunk read")
            .expect("download task should not panic");

        let error = result.expect_err("stalled download should return a cancel error");
        assert_eq!(error.code, "sidecar_download_cancelled");
        assert!(!destination.exists());
        assert!(destination.with_extension("gguf.download").exists());
        server.abort();
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn download_resumes_an_existing_partial_file() {
        let root = temp_dir("resume-partial-download");
        let destination = root.join("model.gguf");
        let partial = destination.with_extension("gguf.download");
        fs::write(&partial, b"ab").expect("partial fixture should be writable");
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("resume test server should bind");
        let addr = listener.local_addr().expect("server address should resolve");
        let url = format!("http://{addr}/model.gguf");
        write_download_metadata(
            &download_metadata_path(&partial),
            &DownloadPartialMetadata {
                url: url.clone(),
                validator: Some("\"v1\"".to_string()),
                total: Some(4),
            },
        )
        .expect("resume metadata should save");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("server should accept request");
            let mut request = [0u8; 2048];
            let count = socket.read(&mut request).await.expect("request should read");
            let request = String::from_utf8_lossy(&request[..count]);
            let request_lower = request.to_ascii_lowercase();
            assert!(
                request_lower.contains("range: bytes=2-"),
                "request was {request}"
            );
            assert!(request_lower.contains("if-range: \"v1\""));
            socket
                .write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 2\r\nContent-Range: bytes 2-3/4\r\nETag: \"v1\"\r\n\r\ncd")
                .await
                .expect("partial response should write");
        });
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        download_url_to_path(
            &url,
            &destination,
            "model",
            "Resume model",
            cancel_rx,
        )
        .await
        .expect("partial download should resume");

        assert_eq!(fs::read(&destination).expect("model should read"), b"abcd");
        assert!(!partial.exists());
        assert!(!download_metadata_path(&partial).exists());
        server.await.expect("server should finish");
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn download_rejects_a_mismatched_partial_content_range() {
        let root = temp_dir("reject-mismatched-content-range");
        let destination = root.join("model.gguf");
        let partial = destination.with_extension("gguf.download");
        fs::write(&partial, b"ab").expect("partial fixture should write");
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}/model.gguf");
        write_download_metadata(
            &download_metadata_path(&partial),
            &DownloadPartialMetadata {
                url: url.clone(),
                validator: Some("\"v1\"".to_string()),
                total: Some(4),
            },
        )
        .unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let _ = socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 2\r\nContent-Range: bytes 1-2/4\r\nETag: \"v1\"\r\n\r\ncd")
                .await
                .unwrap();
        });
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        let error = download_url_to_path(&url, &destination, "model", "Bad range", cancel_rx)
            .await
            .expect_err("mismatched range must reject");

        assert_eq!(error.code, "sidecar_download_invalid_range");
        assert!(!partial.exists());
        assert!(!download_metadata_path(&partial).exists());
        assert!(!destination.exists());
        server.await.unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn download_discards_a_partial_with_a_mismatched_validator() {
        let root = temp_dir("reject-mismatched-validator");
        let destination = root.join("model.gguf");
        let partial = destination.with_extension("gguf.download");
        fs::write(&partial, b"ab").unwrap();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let url = format!("http://{}/model.gguf", listener.local_addr().unwrap());
        write_download_metadata(
            &download_metadata_path(&partial),
            &DownloadPartialMetadata {
                url: url.clone(),
                validator: Some("\"v1\"".to_string()),
                total: Some(4),
            },
        )
        .unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let _ = socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 2\r\nContent-Range: bytes 2-3/4\r\nETag: \"v2\"\r\n\r\ncd")
                .await
                .unwrap();
        });
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        let error = download_url_to_path(&url, &destination, "model", "Bad validator", cancel_rx)
            .await
            .expect_err("mismatched validator must reject");

        assert_eq!(error.code, "sidecar_download_invalid_range");
        assert!(!partial.exists());
        assert!(!download_metadata_path(&partial).exists());
        assert!(!destination.exists());
        server.await.unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn download_without_a_saved_validator_restarts_from_zero() {
        let root = temp_dir("restart-missing-validator");
        let destination = root.join("model.gguf");
        let partial = destination.with_extension("gguf.download");
        fs::write(&partial, b"ab").unwrap();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let url = format!("http://{}/model.gguf", listener.local_addr().unwrap());
        write_download_metadata(
            &download_metadata_path(&partial),
            &DownloadPartialMetadata { url: url.clone(), validator: None, total: Some(4) },
        )
        .unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let count = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..count]).to_ascii_lowercase();
            assert!(!request.contains("range:"), "request was {request}");
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nETag: \"v2\"\r\n\r\nabcd")
                .await
                .unwrap();
        });
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        download_url_to_path(&url, &destination, "model", "Fresh download", cancel_rx)
            .await
            .expect("missing validator should restart cleanly");

        assert_eq!(fs::read(&destination).unwrap(), b"abcd");
        assert!(!partial.exists());
        assert!(!download_metadata_path(&partial).exists());
        server.await.unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn download_space_check_requires_transfer_plus_headroom() {
        let error = ensure_download_space(600 * 1024 * 1024, 100 * 1024 * 1024)
            .expect_err("less than transfer plus headroom should reject");
        assert_eq!(error.code, "sidecar_insufficient_disk_space");
        ensure_download_space(700 * 1024 * 1024, 100 * 1024 * 1024)
            .expect("sufficient transfer headroom should pass");
    }

    #[test]
    fn safe_archive_entry_path_rejects_parent_and_absolute_paths() {
        let parent_error = safe_archive_entry_path(Path::new("../escape.txt"), "tar.gz")
            .expect_err("parent-relative tar path should be rejected");
        let absolute_error = safe_archive_entry_path(Path::new("/tmp/escape.txt"), "tar.gz")
            .expect_err("absolute tar path should be rejected");

        assert_eq!(parent_error.code, "invalid_input");
        assert_eq!(absolute_error.code, "invalid_input");
    }

    #[test]
    fn extract_runtime_archive_rejects_tar_symlink() {
        let root = temp_dir("tar-symlink");
        let archive_path = root.join("runtime.tar.gz");
        let extract_dir = root.join("extract");
        write_tar_gz_symlink(&archive_path, "bin/llama-server", "../escape");

        let error = extract_runtime_archive(&archive_path, &extract_dir)
            .expect_err("symlink tar entry should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("unsafe link"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extract_runtime_archive_accepts_normal_tar_file() {
        let root = temp_dir("tar-normal");
        let archive_path = root.join("runtime.tar.gz");
        let extract_dir = root.join("extract");
        write_tar_gz_file(&archive_path, "bin/llama-server", b"server");

        extract_runtime_archive(&archive_path, &extract_dir)
            .expect("normal tar archive should extract");

        assert_eq!(
            fs::read_to_string(extract_dir.join("bin").join("llama-server"))
                .expect("extracted file should be readable"),
            "server"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn runtime_info_ignores_runtime_that_does_not_match_preference() {
        let state = test_state("stale-runtime-status");
        write_fake_bundled_runtime_install(&state, "stale-vulkan");
        let config = LocalSidecarConfig {
            runtime_preference: "cpu".to_string(),
            ..LocalSidecarConfig::default()
        };

        let payload = runtime_info_payload(&state, &config);

        assert_eq!(payload["installed"], json!(false));
        assert_eq!(payload["serverPath"], Value::Null);
    }

    #[tokio::test]
    async fn resolve_executable_rejects_runtime_that_does_not_match_preference() {
        let state = test_state("stale-runtime-resolve");
        write_fake_bundled_runtime_install(&state, "stale-vulkan");
        let config = LocalSidecarConfig {
            runtime_preference: "cpu".to_string(),
            ..LocalSidecarConfig::default()
        };

        let error = resolve_executable(&state, &config)
            .await
            .expect_err("stale runtime should not satisfy selected preference");

        assert_eq!(error.code, "sidecar_runtime_missing");
    }

    #[test]
    fn explicit_cpu_runtime_does_not_select_macos_arm64_metal() {
        assert!(runtime_asset_candidates_for("darwin", "arm64", "cpu").is_empty());
        assert_eq!(
            runtime_asset_candidates_for("darwin", "arm64", "auto"),
            vec!["macos-arm64-metal"]
        );
    }

    #[test]
    fn auto_runtime_candidates_prefer_detected_gpu_backends() {
        let all_hints = GpuRuntimeHints {
            nvidia: true,
            amd: true,
            intel: true,
        };

        assert_eq!(
            runtime_asset_candidates_for_hints("win32", "x64", "auto", all_hints),
            vec![
                "win-x64-cuda",
                "win-x64-hip",
                "win-x64-sycl",
                "win-x64-vulkan",
                "win-x64-cpu"
            ]
        );
        assert_eq!(
            runtime_asset_candidates_for_hints("linux", "x64", "auto", all_hints),
            vec![
                "linux-x64-cuda",
                "linux-x64-rocm",
                "linux-x64-vulkan",
                "linux-x64-cpu"
            ]
        );
    }

    #[test]
    fn auto_runtime_candidates_keep_vulkan_cpu_fallback_without_gpu_hints() {
        assert_eq!(
            runtime_asset_candidates_for_hints("win32", "x64", "auto", GpuRuntimeHints::default()),
            vec!["win-x64-vulkan", "win-x64-cpu"]
        );
        assert_eq!(
            runtime_asset_candidates_for_hints("linux", "x64", "auto", GpuRuntimeHints::default()),
            vec!["linux-x64-vulkan", "linux-x64-cpu"]
        );
    }

    #[test]
    fn linux_arm64_auto_runtime_prefers_cpu_runtime() {
        assert_eq!(
            runtime_asset_candidates_for("linux", "arm64", "auto"),
            vec!["linux-arm64-cpu"]
        );
    }

    #[test]
    fn linux_gpu_probe_ignores_non_display_pci_devices() {
        let filtered = lspci_display_controller_lines(
            "00:00.0 Host bridge: Advanced Micro Devices, Inc. [AMD] Device 14da\n\
             01:00.0 VGA compatible controller: NVIDIA Corporation AD104 [GeForce RTX]\n\
             02:00.0 Network controller: Intel Corporation Wi-Fi 6 AX200",
        );

        assert!(filtered.contains("NVIDIA"));
        assert!(!filtered.contains("Advanced Micro Devices"));
        assert!(!filtered.contains("Network controller"));
    }

    #[test]
    fn gpu_layers_auto_builds_cpu_fallback_startup_plan() {
        let auto_config = LocalSidecarConfig {
            gpu_layers: -1,
            ..LocalSidecarConfig::default()
        };
        let fixed_config = LocalSidecarConfig {
            gpu_layers: 12,
            ..LocalSidecarConfig::default()
        };

        let auto_plans = llama_startup_plans(&auto_config);
        let fixed_plans = llama_startup_plans(&fixed_config);

        assert_eq!(
            auto_plans,
            vec![
                LlamaStartupPlan {
                    label: "max GPU offload",
                    gpu_layers: 999
                },
                LlamaStartupPlan {
                    label: "CPU fallback",
                    gpu_layers: 0
                }
            ]
        );
        assert_eq!(
            fixed_plans,
            vec![LlamaStartupPlan {
                label: "configured GPU offload",
                gpu_layers: 12
            }]
        );
        assert!(
            sidecar_args(&auto_config, "model.gguf", 1234, &auto_plans[0])
                .windows(2)
                .any(|pair| pair == ["-ngl", "999"])
        );
        assert!(
            sidecar_args(&auto_config, "model.gguf", 1234, &auto_plans[1])
                .windows(2)
                .any(|pair| pair == ["-ngl", "0"])
        );
    }

    #[test]
    fn linux_arm64_auto_gpu_layers_start_cpu_only() {
        let auto_config = LocalSidecarConfig {
            gpu_layers: -1,
            ..LocalSidecarConfig::default()
        };

        assert_eq!(
            llama_startup_plans_for(&auto_config, "linux", "arm64"),
            vec![LlamaStartupPlan {
                label: "CPU fallback",
                gpu_layers: 0
            }]
        );
    }

    #[test]
    fn default_sidecar_args_keep_single_4096_context_slot() {
        let config = LocalSidecarConfig::default();
        let plan = LlamaStartupPlan {
            label: "CPU fallback",
            gpu_layers: 0,
        };
        let args = sidecar_args(&config, "model.gguf", 1234, &plan);

        assert!(args.windows(2).any(|pair| pair == ["--parallel", "1"]));
        assert!(args.windows(2).any(|pair| pair == ["--ctx-size", "4096"]));
    }

    #[test]
    fn linux_arm64_normalize_caps_generation_window() {
        let config = LocalSidecarConfig {
            context_size: 8192,
            max_tokens: 4096,
            ..LocalSidecarConfig::default()
        };

        let normalized = normalize_config_for(config, "linux", "arm64");

        assert_eq!(normalized.context_size, 4096);
        assert_eq!(normalized.max_tokens, 1024);
    }
    #[test]
    fn smoke_test_request_disables_reasoning_outputs() {
        let request = smoke_test_request("local-sidecar", "abc123");

        assert_eq!(request["reasoning_format"], json!("none"));
        assert_eq!(
            request["chat_template_kwargs"]["enable_thinking"],
            json!(false)
        );
        assert!(request["messages"][1]["content"]
            .as_str()
            .expect("user content should be a string")
            .contains("abc123"));
    }

    #[test]
    fn smoke_test_output_accepts_reasoning_content_fallback() {
        let content_payload = json!({
            "choices": [{
                "message": {
                    "content": "TOKEN content"
                }
            }]
        });
        let reasoning_payload = json!({
            "choices": [{
                "message": {
                    "content": "",
                    "reasoning_content": "TOKEN reasoning"
                }
            }]
        });
        let legacy_reasoning_payload = json!({
            "choices": [{
                "message": {
                    "reasoning": "TOKEN legacy reasoning"
                }
            }]
        });

        assert_eq!(smoke_test_output_text(&content_payload), "TOKEN content");
        assert_eq!(
            smoke_test_output_text(&reasoning_payload),
            "TOKEN reasoning"
        );
        assert_eq!(
            smoke_test_output_text(&legacy_reasoning_payload),
            "TOKEN legacy reasoning"
        );
    }

    #[test]
    fn smoke_test_success_payload_preserves_diagnostics() {
        let payload = json!({
            "choices": [{
                "message": {
                    "content": "TOKEN abc123\nLocal model ready.",
                    "reasoning_content": "Hidden reasoning"
                }
            }],
            "usage": { "prompt_tokens": 3, "completion_tokens": 4 },
            "timings": { "prompt_ms": 12, "generation_ms": 34 }
        });

        let result = smoke_test_success_payload(Instant::now(), "abc123".to_string(), &payload);

        assert_eq!(result["success"], json!(true));
        assert_eq!(
            result["response"],
            json!("TOKEN abc123\nLocal model ready.")
        );
        assert_eq!(
            result["messageContent"],
            json!("TOKEN abc123\nLocal model ready.")
        );
        assert_eq!(result["reasoningContent"], json!("Hidden reasoning"));
        assert_eq!(result["usage"], payload["usage"]);
        assert_eq!(result["timings"], payload["timings"]);
        assert_eq!(result["failedRuntimeVariant"], Value::Null);
    }

    #[test]
    fn smoke_test_failure_payload_keeps_durable_error_details() {
        let error = AppError::with_details(
            "sidecar_test_failed",
            "Local sidecar returned HTTP 500",
            json!({ "error": "boom" }),
        );

        let result =
            smoke_test_failure_payload(Instant::now(), &error, Some("win-x64-vulkan".to_string()));

        assert_eq!(result["success"], json!(false));
        assert_eq!(result["response"], json!(""));
        assert_eq!(result["nonceVerified"], json!(false));
        assert_eq!(result["error"], json!("Local sidecar returned HTTP 500"));
        assert_eq!(result["errorCode"], json!("sidecar_test_failed"));
        assert_eq!(result["details"], json!({ "error": "boom" }));
        assert_eq!(result["failedRuntimeVariant"], json!("win-x64-vulkan"));
    }

    #[test]
    fn runtime_preference_rejects_recorded_metal_when_cpu_selected() {
        let state = test_state("cpu-rejects-metal");
        let install =
            write_fake_bundled_runtime_install_for(&state, "macos-arm64-metal", "darwin", "arm64");

        assert!(!runtime_install_matches_preference(&install, "cpu"));
        assert!(runtime_install_matches_preference(&install, "auto"));
    }

    #[test]
    fn custom_model_cache_path_preserves_repository_tree_path() {
        let left = managed_custom_model_relative_path("owner/repo", "alpha/model.gguf");
        let right = managed_custom_model_relative_path("owner/repo", "beta/model.gguf");

        assert_ne!(left, right);
        assert!(left.ends_with("alpha/model.gguf"));
        assert!(right.ends_with("beta/model.gguf"));
    }

    #[test]
    fn custom_model_download_url_preserves_discovery_branch() {
        let entry = HuggingFaceTreeEntry {
            entry_type: Some("file".to_string()),
            path: Some("nested/My Model.Q4_K_M.gguf".to_string()),
            size: Some(123),
            lfs: None,
        };
        let main = custom_model_entry_from_tree_entry("owner/repo", "main", entry.clone())
            .expect("main branch GGUF should produce a custom model entry");
        let master = custom_model_entry_from_tree_entry("owner/repo", "master", entry)
            .expect("master branch GGUF should produce a custom model entry");

        assert_eq!(
            main.download_url,
            "https://huggingface.co/owner/repo/resolve/main/nested/My%20Model.Q4_K_M.gguf"
        );
        assert_eq!(
            master.download_url,
            "https://huggingface.co/owner/repo/resolve/master/nested/My%20Model.Q4_K_M.gguf"
        );
    }

    #[test]
    fn custom_model_selection_rejects_ambiguous_filename() {
        let models = vec![
            CustomModelEntry {
                path: "alpha/model.gguf".to_string(),
                filename: "model.gguf".to_string(),
                size_bytes: None,
                quantization_label: None,
                download_url: "https://example.test/alpha/model.gguf".to_string(),
            },
            CustomModelEntry {
                path: "beta/model.gguf".to_string(),
                filename: "model.gguf".to_string(),
                size_bytes: None,
                quantization_label: None,
                download_url: "https://example.test/beta/model.gguf".to_string(),
            },
        ];

        let error = select_custom_model_entry(&models, Some("model.gguf"))
            .expect_err("filename-only duplicate selection should be rejected");
        let selected = select_custom_model_entry(&models, Some("beta/model.gguf"))
            .expect("exact repository path should select the intended model");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("ambiguous"));
        assert_eq!(selected.path, "beta/model.gguf");
    }
}
