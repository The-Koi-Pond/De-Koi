use marinara_core::{AppError, AppResult};
use marinara_security::{assert_inside_dir, assert_relative_safe_path};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const CODE_SEARCH_SKIP_DIRS: &[&str] = &[
    ".codex",
    ".git",
    ".next",
    ".pnpm-store",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
];
const CODE_SEARCH_SKIP_PATH_PREFIXES: &[&str] = &["packages/server/data", "src-tauri/gen"];
const CODE_SEARCH_ALLOWED_EXTENSIONS: &[&str] = &[
    "cjs", "css", "cts", "html", "js", "jsx", "json", "md", "mjs", "mts", "ps1", "puml", "py",
    "rs", "sh", "sql", "toml", "ts", "tsx", "yml", "yaml",
];
/// Source files without an allowed extension that are still worth reading.
const CODE_TEXT_FILE_NAMES: &[&str] = &[
    "AGENTS.md",
    "Dockerfile",
    "Dockerfile.web",
    "LICENSE",
    "README",
];
pub(in crate::storage_commands::deki) const CODE_SEARCH_MAX_FILE_BYTES: u64 = 512 * 1024;
/// Files up to this size are returned whole when no line range is asked for.
const CODE_READ_WHOLE_FILE_BYTES: usize = 96 * 1024;
/// Lines returned from a larger file when no range is asked for.
const CODE_READ_DEFAULT_LINES: usize = 400;
/// Most lines one ranged read returns.
const CODE_READ_MAX_RANGE_LINES: usize = 800;
const LIST_DEFAULT_LIMIT: usize = 80;
const LIST_MAX_LIMIT: usize = 200;
const FIND_DEFAULT_LIMIT: usize = 80;
const FIND_MAX_LIMIT: usize = 200;
const SEARCH_MAX_CONTEXT_LINES: usize = 3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadRepoFileArgs {
    pub(super) path: String,
    #[serde(default, alias = "start_line")]
    pub(super) start_line: Option<usize>,
    #[serde(default, alias = "end_line")]
    pub(super) end_line: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SearchTextArgs {
    #[serde(default, alias = "pattern")]
    pub(super) query: Option<String>,
    #[serde(default)]
    pub(super) path: Option<String>,
    #[serde(default, alias = "max_results")]
    pub(super) max_results: Option<usize>,
    #[serde(default, alias = "context_lines")]
    pub(super) context_lines: Option<usize>,
    /// Treat `query` as a regular expression instead of plain text.
    #[serde(default)]
    pub(super) regex: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OutlineArgs {
    pub(super) path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListRepoPathArgs {
    #[serde(default)]
    pub(super) path: Option<String>,
    #[serde(default, alias = "max_entries")]
    pub(super) limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FindRepoPathArgs {
    #[serde(default, alias = "pattern")]
    pub(super) query: Option<String>,
    #[serde(default)]
    pub(super) path: Option<String>,
    #[serde(default, alias = "max_results")]
    pub(super) max_results: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub(super) struct SearchDekiCodeArgs {
    pub(super) query: String,
    #[serde(default)]
    pub(super) path: Option<String>,
    #[serde(default)]
    pub(super) max_results: Option<usize>,
    #[serde(default)]
    pub(super) context_lines: Option<usize>,
    #[serde(default)]
    pub(super) regex: Option<bool>,
}

/// How a search matches one line: plain text or a regular expression, both
/// case-insensitive.
enum LineMatcher {
    Text(String),
    Pattern(regex::Regex),
}

impl LineMatcher {
    fn new(query: &str, regex: bool) -> AppResult<Self> {
        if !regex {
            return Ok(Self::Text(query.to_ascii_lowercase()));
        }
        regex::RegexBuilder::new(query)
            .case_insensitive(true)
            .size_limit(1 << 20)
            .build()
            .map(Self::Pattern)
            .map_err(|error| {
                AppError::invalid_input(format!("The search regex is invalid: {error}"))
            })
    }

    fn is_match(&self, line: &str) -> bool {
        match self {
            Self::Text(needle) => line.to_ascii_lowercase().contains(needle.as_str()),
            Self::Pattern(pattern) => pattern.is_match(line),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadDekiCodeFileArgs {
    pub(super) path: String,
    #[serde(default, alias = "start_line")]
    pub(super) start_line: Option<usize>,
    #[serde(default, alias = "end_line")]
    pub(super) end_line: Option<usize>,
}

pub(super) enum DekiCodeCommand {
    Search(SearchTextArgs),
    Read(ReadDekiCodeFileArgs),
}

pub(super) fn parse_deki_code_command(args: Value) -> AppResult<DekiCodeCommand> {
    let object = args
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::invalid_input("deki_code arguments must be a JSON object"))?;
    let search_discriminator = match (object.get("query"), object.get("pattern")) {
        (Some(_), Some(_)) => {
            return Err(AppError::invalid_input(
                "deki_code accepts query or pattern, not both",
            ));
        }
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    };
    if let Some(value) = search_discriminator {
        value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::invalid_input("deki_code query must be a non-empty string"))?;
        return super::parse_command_args("deki_code", Value::Object(object))
            .map(DekiCodeCommand::Search);
    }
    super::parse_command_args("deki_code", Value::Object(object)).map(DekiCodeCommand::Read)
}

pub(super) fn read_repo_file(args: ReadRepoFileArgs) -> AppResult<Value> {
    read_deki_code_file(ReadDekiCodeFileArgs {
        path: args.path,
        start_line: args.start_line,
        end_line: args.end_line,
    })
}

pub(super) fn search_code(args: SearchTextArgs) -> AppResult<Value> {
    let query = args
        .query
        .map(|query| query.trim().to_string())
        .filter(|query| !query.is_empty())
        .ok_or_else(|| AppError::invalid_input("Search query is required"))?;
    search_deki_code(SearchDekiCodeArgs {
        query,
        path: args.path,
        max_results: args.max_results,
        context_lines: args.context_lines,
        regex: args.regex,
    })
}

/// Most outline entries one call returns.
const OUTLINE_MAX_ENTRIES: usize = 400;

/// The declarations in a source file with their line numbers (functions,
/// types, impls, modules, constants; exported or top-level for TypeScript and
/// JavaScript), so a large file can be navigated before reading a range.
pub(super) fn outline_repo_file(args: OutlineArgs) -> AppResult<Value> {
    let (_root, target, display_path) = resolve_repo_file(&args.path)?;
    if !target.is_file() {
        return Err(AppError::not_found(format!("{display_path} was not found")));
    }
    if !is_code_text_path(Path::new(&display_path)) {
        return Err(AppError::invalid_input(format!(
            "{display_path} is not a readable source or guidance file"
        )));
    }
    if fs::metadata(&target)?.len() > CODE_SEARCH_MAX_FILE_BYTES {
        return Err(AppError::invalid_input(format!(
            "{display_path} is too large to outline"
        )));
    }
    let content = fs::read_to_string(&target).map_err(|error| {
        AppError::new(
            "deki_code_read_failed",
            format!("{display_path} is not valid UTF-8: {error}"),
        )
    })?;
    let (entries, truncated) = outline_entries(&content);
    Ok(json!({
        "path": display_path,
        "totalLines": content.lines().count(),
        "entries": entries,
        "truncated": truncated,
    }))
}

fn outline_entries(content: &str) -> (Vec<Value>, bool) {
    // Rust items at any depth (impl methods are indented), plus top-level
    // TypeScript/JavaScript declarations and Markdown headings.
    const PATTERN: &str = r"^(\s*(pub(\([^)]*\))?\s+)?(async\s+)?(unsafe\s+)?(fn|struct|enum|trait|impl|mod|const|static|type|macro_rules!)\b|^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let)\s|^#{1,4}\s)";
    let Ok(pattern) = regex::Regex::new(PATTERN) else {
        return (Vec::new(), false);
    };
    let mut entries = Vec::new();
    for (index, line) in content.lines().enumerate() {
        if !pattern.is_match(line) || line.trim_start().starts_with("//") {
            continue;
        }
        if entries.len() == OUTLINE_MAX_ENTRIES {
            return (entries, true);
        }
        entries.push(json!({ "line": index + 1, "text": truncate_preview(line.trim_end()) }));
    }
    (entries, false)
}

pub(super) fn read_deki_code_file(args: ReadDekiCodeFileArgs) -> AppResult<Value> {
    read_code_file(&args.path, args.start_line, args.end_line)
}

pub(super) fn list_repo_path(args: ListRepoPathArgs) -> AppResult<Value> {
    let (_root, target, display_path) = resolve_runtime_repo_path(args.path.as_deref())?;
    if !target.is_dir() {
        return Err(AppError::invalid_input(format!(
            "{display_path} is not a directory"
        )));
    }
    let limit = args
        .limit
        .unwrap_or(LIST_DEFAULT_LIMIT)
        .clamp(1, LIST_MAX_LIMIT);
    let scan_limit = limit.saturating_add(1);
    let mut entries = fs::read_dir(&target)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());
    let mut output = Vec::new();
    for entry in entries {
        if output.len() >= scan_limit {
            break;
        }
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let entry_path = entry.path();
        let relative = display_child_path(&display_path, &entry_path);
        if is_skipped_relative_path(Path::new(&relative)) {
            continue;
        }
        let kind = if file_type.is_dir() {
            "dir"
        } else if file_type.is_file() {
            "file"
        } else {
            "other"
        };
        let bytes = if file_type.is_file() {
            entry.metadata().ok().map(|metadata| metadata.len())
        } else {
            None
        };
        output.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "path": relative,
            "type": kind,
            "bytes": bytes,
        }));
    }
    let (output, truncated) = finish_limited_results(output, limit);
    Ok(json!({
        "path": display_path,
        "entries": output,
        "truncated": truncated,
    }))
}

pub(super) fn find_repo_paths(args: FindRepoPathArgs) -> AppResult<Value> {
    let query = args
        .query
        .map(|query| query.trim().to_ascii_lowercase())
        .filter(|query| !query.is_empty())
        .ok_or_else(|| AppError::invalid_input("Find query is required"))?;
    let max_results = args
        .max_results
        .unwrap_or(FIND_DEFAULT_LIMIT)
        .clamp(1, FIND_MAX_LIMIT);
    let scan_limit = max_results.saturating_add(1);
    let (root, start, display_path) = resolve_runtime_repo_path(args.path.as_deref())?;
    let mut results = Vec::new();
    find_repo_paths_inner(&root, &start, &query, scan_limit, &mut results)?;
    let (results, truncated) = finish_limited_results(results, max_results);
    Ok(json!({
        "query": query,
        "path": display_path,
        "results": results,
        "truncated": truncated,
    }))
}

fn search_deki_code(args: SearchDekiCodeArgs) -> AppResult<Value> {
    let query = args.query.trim();
    if query.is_empty() {
        return Err(AppError::invalid_input("Search query is required"));
    }
    let max_results = args.max_results.unwrap_or(32).clamp(1, 80);
    let scan_limit = max_results.saturating_add(1);
    let context_lines = args
        .context_lines
        .unwrap_or(0)
        .min(SEARCH_MAX_CONTEXT_LINES);
    let (root, start, display_root) = match args
        .path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        Some(path) => resolve_repo_file(path)?,
        None => {
            let root = super::super::deki_repo_root()?;
            (root.clone(), root, ".".to_string())
        }
    };
    if !start.exists() {
        return Err(AppError::not_found(format!("{display_root} was not found")));
    }

    let mut results = Vec::new();
    let mut searched_files = 0usize;
    let matcher = LineMatcher::new(query, args.regex.unwrap_or(false))?;
    if start.is_file() {
        search_code_file(
            &root,
            &start,
            &matcher,
            scan_limit,
            context_lines,
            &mut searched_files,
            &mut results,
        )?;
    } else {
        search_code_dir(
            &root,
            &start,
            &matcher,
            scan_limit,
            context_lines,
            &mut searched_files,
            &mut results,
        )?;
    }
    let (results, truncated) = finish_limited_results(results, max_results);

    Ok(json!({
        "query": query,
        "path": display_root,
        "searchedFiles": searched_files,
        "contextLines": context_lines,
        "truncated": truncated,
        "results": results,
    }))
}

fn read_code_file(
    path: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> AppResult<Value> {
    let (_root, target, display_path) = resolve_repo_file(path)?;
    if !target.is_file() {
        return Err(AppError::not_found(format!("{display_path} was not found")));
    }
    if !is_code_text_path(Path::new(&display_path)) {
        return Err(AppError::invalid_input(format!(
            "{display_path} is not a readable source or guidance file"
        )));
    }
    let metadata = fs::metadata(&target)?;
    if metadata.len() > CODE_SEARCH_MAX_FILE_BYTES {
        return Err(AppError::invalid_input(format!(
            "{display_path} is too large to read; search it for the lines you need instead"
        )));
    }
    let content = fs::read_to_string(&target).map_err(|error| {
        AppError::new(
            "deki_code_read_failed",
            format!("{display_path} is not valid UTF-8: {error}"),
        )
    })?;
    if !is_context_safe_source_text(&content) {
        return Err(AppError::invalid_input(format!(
            "{display_path} appears to contain generated, encoded, or binary-like content; search narrower source files instead"
        )));
    }
    let mut window = read_window(&content, start_line, end_line)
        .map_err(|message| AppError::invalid_input(format!("{display_path}: {message}")))?;
    window["path"] = json!(display_path);
    Ok(window)
}

/// The requested lines of `content`, numbered from 1 so answers can cite
/// them. With no range, a file up to `CODE_READ_WHOLE_FILE_BYTES` comes back
/// whole and a larger one as its first `CODE_READ_DEFAULT_LINES` lines;
/// `nextStartLine` says where to continue.
fn read_window(
    content: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> Result<Value, String> {
    let lines = content.lines().collect::<Vec<_>>();
    let total = lines.len();
    if total == 0 {
        return Ok(json!({ "totalLines": 0, "content": "" }));
    }
    let start = start_line.unwrap_or(1).max(1);
    if start > total {
        return Err(format!(
            "startLine {start} is past the end of the file ({total} lines)"
        ));
    }
    let default_end = if start_line.is_none()
        && end_line.is_none()
        && content.len() <= CODE_READ_WHOLE_FILE_BYTES
    {
        total
    } else {
        start + CODE_READ_DEFAULT_LINES - 1
    };
    let end = end_line
        .unwrap_or(default_end)
        .min(total)
        .min(start + CODE_READ_MAX_RANGE_LINES - 1);
    if end < start {
        return Err(format!(
            "endLine {} is before startLine {start}",
            end_line.unwrap_or(end)
        ));
    }
    let numbered = lines[start - 1..end]
        .iter()
        .enumerate()
        .map(|(offset, line)| format!("{:>6}\t{line}", start + offset))
        .collect::<Vec<_>>()
        .join("\n");
    let mut window = json!({
        "totalLines": total,
        "startLine": start,
        "endLine": end,
        "content": numbered,
    });
    if end < total {
        window["nextStartLine"] = json!(end + 1);
    }
    Ok(window)
}

pub(in crate::storage_commands::deki) fn resolve_repo_file(
    path: &str,
) -> AppResult<(PathBuf, PathBuf, String)> {
    resolve_repo_file_in(super::super::deki_repo_root()?, path)
}

/// [`resolve_repo_file`] against an explicit repository root.
pub(in crate::storage_commands::deki) fn resolve_repo_file_in(
    root: PathBuf,
    path: &str,
) -> AppResult<(PathBuf, PathBuf, String)> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input(
            "Repository-relative path is required",
        ));
    }
    let relative = assert_relative_safe_path(trimmed)?;
    if relative.as_os_str().is_empty() || is_skipped_relative_path(&relative) {
        return Err(AppError::invalid_input(
            "That path is not available to Deki-senpai",
        ));
    }
    let resolved = assert_inside_dir(&root, &relative)?;
    let display_path = relative.to_string_lossy().replace('\\', "/");
    Ok((root, resolved, display_path))
}

fn resolve_runtime_repo_path(path: Option<&str>) -> AppResult<(PathBuf, PathBuf, String)> {
    let root = super::super::deki_repo_root()?;
    let path = path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .unwrap_or(".");
    if path == "." {
        return Ok((root.clone(), root, ".".to_string()));
    }
    let relative = assert_relative_safe_path(path)?;
    if relative.as_os_str().is_empty() || is_skipped_relative_path(&relative) {
        return Err(AppError::invalid_input(
            "That path is not available to Deki-senpai",
        ));
    }
    let resolved = assert_inside_dir(&root, &relative)?;
    let display_path = relative.to_string_lossy().replace('\\', "/");
    Ok((root, resolved, display_path))
}

fn search_code_dir(
    root: &Path,
    dir: &Path,
    matcher: &LineMatcher,
    max_results: usize,
    context_lines: usize,
    searched_files: &mut usize,
    results: &mut Vec<Value>,
) -> AppResult<()> {
    if results.len() >= max_results {
        return Ok(());
    }
    let mut entries = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        if results.len() >= max_results {
            break;
        }
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let relative = path.strip_prefix(root).unwrap_or(&path);
        if is_skipped_relative_path(relative) {
            continue;
        }
        if file_type.is_dir() {
            search_code_dir(
                root,
                &path,
                matcher,
                max_results,
                context_lines,
                searched_files,
                results,
            )?;
        } else if file_type.is_file() {
            search_code_file(
                root,
                &path,
                matcher,
                max_results,
                context_lines,
                searched_files,
                results,
            )?;
        }
    }
    Ok(())
}

fn search_code_file(
    root: &Path,
    path: &Path,
    matcher: &LineMatcher,
    max_results: usize,
    context_lines: usize,
    searched_files: &mut usize,
    results: &mut Vec<Value>,
) -> AppResult<()> {
    if results.len() >= max_results || !is_code_text_path(path) {
        return Ok(());
    }
    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    if metadata.len() > CODE_SEARCH_MAX_FILE_BYTES {
        return Ok(());
    }
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(());
    };
    if !is_context_safe_source_text(&content) {
        return Ok(());
    }
    *searched_files += 1;
    let display_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let lines = content.lines().collect::<Vec<_>>();
    for (index, line) in lines.iter().enumerate() {
        if !matcher.is_match(line) {
            continue;
        }
        let mut result = json!({
            "path": display_path,
            "line": index + 1,
            "preview": truncate_preview(line.trim()),
        });
        if context_lines > 0 {
            result["context"] = Value::Array(search_context(&lines, index, context_lines));
        }
        results.push(result);
        if results.len() >= max_results {
            break;
        }
    }
    Ok(())
}

fn search_context(lines: &[&str], match_index: usize, context_lines: usize) -> Vec<Value> {
    let start = match_index.saturating_sub(context_lines);
    let end = match_index
        .saturating_add(context_lines)
        .saturating_add(1)
        .min(lines.len());
    lines[start..end]
        .iter()
        .enumerate()
        .map(|(offset, line)| {
            json!({
                "line": start + offset + 1,
                "text": truncate_preview(line.trim_end()),
            })
        })
        .collect()
}

fn find_repo_paths_inner(
    root: &Path,
    dir: &Path,
    query_lower: &str,
    max_results: usize,
    results: &mut Vec<Value>,
) -> AppResult<()> {
    if results.len() >= max_results {
        return Ok(());
    }
    let mut entries = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        if results.len() >= max_results {
            break;
        }
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(&path);
        if is_skipped_relative_path(relative) {
            continue;
        }
        let display_path = relative.to_string_lossy().replace('\\', "/");
        let name = entry.file_name().to_string_lossy().to_string();
        let kind = if file_type.is_dir() {
            "dir"
        } else if file_type.is_file() {
            "file"
        } else {
            "other"
        };
        if name.to_ascii_lowercase().contains(query_lower)
            || display_path.to_ascii_lowercase().contains(query_lower)
        {
            results.push(json!({
                "path": display_path,
                "name": name,
                "type": kind,
            }));
        }
        if file_type.is_dir() {
            find_repo_paths_inner(root, &path, query_lower, max_results, results)?;
        }
    }
    Ok(())
}

fn finish_limited_results(mut results: Vec<Value>, limit: usize) -> (Vec<Value>, bool) {
    let truncated = results.len() > limit;
    results.truncate(limit);
    (results, truncated)
}

fn display_child_path(parent_display: &str, child: &Path) -> String {
    let child_name = child
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| child.to_string_lossy().to_string());
    if parent_display == "." {
        child_name
    } else {
        format!("{parent_display}/{child_name}")
    }
}

pub(in crate::storage_commands::deki) fn is_code_text_path(path: &Path) -> bool {
    let name = path.file_name().and_then(|value| value.to_str());
    if name.is_some_and(|name| CODE_TEXT_FILE_NAMES.contains(&name)) {
        return true;
    }
    // Dotfiles such as `.env` have no extension here and stay unreadable.
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            let extension = extension.to_ascii_lowercase();
            CODE_SEARCH_ALLOWED_EXTENSIONS.contains(&extension.as_str())
        })
}

fn is_skipped_relative_path(path: &Path) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if CODE_SEARCH_SKIP_PATH_PREFIXES
        .iter()
        .any(|prefix| normalized == *prefix || normalized.starts_with(&format!("{prefix}/")))
    {
        return true;
    }
    path.components().any(|component| {
        let value = component.as_os_str().to_string_lossy();
        CODE_SEARCH_SKIP_DIRS.contains(&value.as_ref())
    })
}

fn truncate_preview(value: &str) -> String {
    const MAX_CHARS: usize = 240;
    let mut chars = value.chars();
    let preview = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn is_context_safe_source_text(content: &str) -> bool {
    let compact_content = content
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    !content.as_bytes().contains(&0)
        && !looks_like_encoded_blob(&compact_content)
        && !content.lines().map(str::trim).any(looks_like_encoded_blob)
}

pub(in crate::storage_commands::deki) fn looks_like_encoded_blob(value: &str) -> bool {
    const MIN_BLOB_CHARS: usize = 2048;
    if value.len() < MIN_BLOB_CHARS {
        return false;
    }
    let lower = value
        .chars()
        .take(64)
        .collect::<String>()
        .to_ascii_lowercase();
    if lower.starts_with("data:") || lower.contains(";base64,") {
        return true;
    }
    let mut encoded_chars = 0usize;
    let mut whitespace_chars = 0usize;
    let mut total_chars = 0usize;
    for ch in value.chars() {
        total_chars += 1;
        if ch.is_whitespace() {
            whitespace_chars += 1;
            continue;
        }
        if ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '=' | '-' | '_') {
            encoded_chars += 1;
        }
    }
    let non_whitespace_chars = total_chars.saturating_sub(whitespace_chars);
    non_whitespace_chars >= MIN_BLOB_CHARS
        && whitespace_chars * 100 / total_chars <= 5
        && encoded_chars * 100 / non_whitespace_chars >= 96
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_context_returns_a_bounded_one_based_window() {
        let lines = ["zero", "one", "match", "three", "four"];

        let context = search_context(&lines, 2, 1);

        assert_eq!(context.len(), 3);
        assert_eq!(context[0], json!({ "line": 2, "text": "one" }));
        assert_eq!(context[1], json!({ "line": 3, "text": "match" }));
        assert_eq!(context[2], json!({ "line": 4, "text": "three" }));
    }

    #[test]
    fn exact_limit_results_are_not_truncated_until_one_more_is_observed() {
        let exact = vec![json!("one"), json!("two")];
        let overflow = vec![json!("one"), json!("two"), json!("three")];

        let (exact, exact_truncated) = finish_limited_results(exact, 2);
        let (overflow, overflow_truncated) = finish_limited_results(overflow, 2);

        assert_eq!(exact, vec![json!("one"), json!("two")]);
        assert!(!exact_truncated);
        assert_eq!(overflow, vec![json!("one"), json!("two")]);
        assert!(overflow_truncated);
    }

    #[test]
    fn read_window_numbers_lines_and_honors_a_range() {
        let content = "one\ntwo\nthree\nfour\nfive";

        let whole = read_window(content, None, None).expect("small file reads whole");
        assert_eq!(whole["totalLines"], json!(5));
        assert_eq!(whole["startLine"], json!(1));
        assert_eq!(whole["endLine"], json!(5));
        assert!(whole["content"]
            .as_str()
            .unwrap()
            .starts_with("     1\tone"));
        assert!(whole.get("nextStartLine").is_none());

        let middle = read_window(content, Some(2), Some(3)).expect("range reads");
        assert_eq!(middle["content"], json!("     2\ttwo\n     3\tthree"));
        assert_eq!(middle["nextStartLine"], json!(4));

        assert!(read_window(content, Some(9), None)
            .unwrap_err()
            .contains("past the end"));
        assert!(read_window(content, Some(4), Some(2))
            .unwrap_err()
            .contains("before startLine"));
    }

    #[test]
    fn read_window_returns_the_first_lines_of_a_large_file_with_a_continuation() {
        let line = "x".repeat(300);
        let content = vec![line.as_str(); 1_000].join("\n");
        assert!(content.len() > CODE_READ_WHOLE_FILE_BYTES);

        let window = read_window(&content, None, None).expect("large file opens");
        assert_eq!(window["endLine"], json!(CODE_READ_DEFAULT_LINES));
        assert_eq!(window["nextStartLine"], json!(CODE_READ_DEFAULT_LINES + 1));

        let capped = read_window(&content, Some(1), Some(1_000)).expect("long range is capped");
        assert_eq!(capped["endLine"], json!(CODE_READ_MAX_RANGE_LINES));
    }

    #[test]
    fn script_sources_are_readable_and_secret_files_are_not() {
        assert!(is_code_text_path(Path::new(
            "scripts/check-min-text-size.mjs"
        )));
        assert!(is_code_text_path(Path::new("src/vite.config.mts")));
        assert!(is_code_text_path(Path::new("Dockerfile.web")));
        assert!(!is_code_text_path(Path::new(".env")));
        assert!(!is_code_text_path(Path::new(".env.local")));
        assert!(!is_code_text_path(Path::new("notes/secret.txt")));
        assert!(!is_code_text_path(Path::new("assets/logo.png")));
    }

    #[test]
    fn deki_code_tools_reject_encoded_source_payloads() {
        assert!(is_context_safe_source_text(
            "export function usefulSource() {\n  return 'readable code';\n}\n"
        ));
        assert!(!is_context_safe_source_text(&format!(
            "{{\"image\":\"data:image/png;base64,{}\"}}",
            "A".repeat(4096)
        )));
    }

    #[test]
    fn deki_code_tools_reject_wrapped_encoded_source_payloads() {
        let payload = "A"
            .repeat(4096)
            .as_bytes()
            .chunks(76)
            .map(|chunk| std::str::from_utf8(chunk).expect("ASCII test payload"))
            .collect::<Vec<_>>()
            .join("\n");
        let source = format!("export const embeddedImage = `\n{payload}\n`;");

        assert!(!is_context_safe_source_text(&source));
    }

    #[test]
    fn regex_search_matches_patterns_and_reports_bad_ones() {
        let matcher = LineMatcher::new(r"const \w+_TTL: Duration", true).expect("valid regex");
        assert!(matcher
            .is_match("const BACKGROUND_WORKER_LEASE_TTL: Duration = Duration::from_secs(30);"));
        assert!(!matcher.is_match("let ttl = 30;"));
        let text = LineMatcher::new("Lease_TTL", false).expect("text matcher");
        assert!(text.is_match("const MEMORY_CAPTURE_WORKER_LEASE_TTL: Duration"));
        let error = LineMatcher::new("(unclosed", true)
            .err()
            .expect("bad regex is refused");
        assert!(error.message.contains("regex is invalid"));
    }

    #[test]
    fn outline_lists_declarations_with_line_numbers() {
        let content = "use std::fs;\n\npub(crate) async fn deki_prompt() {}\nstruct Budget {\n    rounds: usize,\n}\nimpl Budget {\n    pub(super) fn rounds(&self) -> usize { 1 }\n}\n// fn commented_out() {}\nexport function sendMessage() {}\n## Owners\n";
        let (entries, truncated) = outline_entries(content);
        let lines = entries
            .iter()
            .map(|entry| entry["line"].as_u64().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(lines, vec![3, 4, 7, 8, 11, 12]);
        assert!(!truncated);
    }
}
