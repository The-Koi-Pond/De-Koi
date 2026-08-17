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
    "css", "html", "js", "jsx", "json", "md", "rs", "toml", "ts", "tsx", "yml", "yaml",
];
const CODE_SEARCH_MAX_FILE_BYTES: u64 = 512 * 1024;
const CODE_READ_MAX_FILE_BYTES: u64 = 96 * 1024;
const LIST_DEFAULT_LIMIT: usize = 80;
const LIST_MAX_LIMIT: usize = 200;
const FIND_DEFAULT_LIMIT: usize = 80;
const FIND_MAX_LIMIT: usize = 200;
const SEARCH_MAX_CONTEXT_LINES: usize = 3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadRepoFileArgs {
    pub(super) path: String,
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
}

#[derive(Debug, Deserialize)]
pub(super) struct ReadDekiCodeFileArgs {
    pub(super) path: String,
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
    read_deki_code_file(ReadDekiCodeFileArgs { path: args.path })
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
    })
}

pub(super) fn read_deki_code_file(args: ReadDekiCodeFileArgs) -> AppResult<Value> {
    read_code_file(&args.path)
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
    let query_lower = query.to_ascii_lowercase();
    if start.is_file() {
        search_code_file(
            &root,
            &start,
            &query_lower,
            scan_limit,
            context_lines,
            &mut searched_files,
            &mut results,
        )?;
    } else {
        search_code_dir(
            &root,
            &start,
            &query_lower,
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

fn read_code_file(path: &str) -> AppResult<Value> {
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
    if metadata.len() > CODE_READ_MAX_FILE_BYTES {
        return Err(AppError::invalid_input(format!(
            "{display_path} is too large to read directly; search it first and request a narrower file"
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
    Ok(json!({
        "path": display_path,
        "bytes": content.len(),
        "content": content,
    }))
}

fn resolve_repo_file(path: &str) -> AppResult<(PathBuf, PathBuf, String)> {
    let root = super::super::deki_repo_root()?;
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
    query_lower: &str,
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
                query_lower,
                max_results,
                context_lines,
                searched_files,
                results,
            )?;
        } else if file_type.is_file() {
            search_code_file(
                root,
                &path,
                query_lower,
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
    query_lower: &str,
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
        if !line.to_ascii_lowercase().contains(query_lower) {
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

fn is_code_text_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            let extension = extension.to_ascii_lowercase();
            CODE_SEARCH_ALLOWED_EXTENSIONS.contains(&extension.as_str())
        })
        .unwrap_or_else(|| {
            path.file_name()
                .and_then(|value| value.to_str())
                .map(|name| matches!(name, "AGENTS.md" | "README" | "LICENSE"))
                .unwrap_or(false)
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
}
