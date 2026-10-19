//! Deki-senpai's source edits as approvals. `edit_file` plans an exact,
//! single-occurrence replacement in a repository file and records it as a
//! pending approval under the `source` collection; nothing is written until
//! the user approves. Approval re-reads the file, re-checks the operation hash
//! over its whole current content, and writes the new content atomically.
//!
//! Edits need a git checkout at the repository root: that is the only case
//! where a source change reaches the running app (dev builds reload it) and
//! can be undone with git. Packaged and container installs run from a copy,
//! so their dry-runs are blocked with that reason.

use super::commands::code;
use super::data_cli::{
    self, DekiDataMutation, DekiDataMutationKind, DekiDataPlan, DekiDataValidation,
};
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

pub(super) const SOURCE_COLLECTION: &str = "source";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EditFileArgs {
    path: String,
    #[serde(alias = "old_text")]
    old_text: String,
    #[serde(alias = "new_text")]
    new_text: String,
    #[serde(default)]
    reason: String,
}

/// The pending change for an `edit_file` request. The path is validated and
/// normalized here; the edit itself is checked when it is planned.
pub(super) fn mutation(args: EditFileArgs) -> AppResult<DekiDataMutation> {
    let (_root, _target, display_path) = code::resolve_repo_file(&args.path)?;
    Ok(DekiDataMutation {
        kind: DekiDataMutationKind::Patch,
        collection: SOURCE_COLLECTION,
        id: display_path,
        payload: json!({ "oldText": args.old_text, "newText": args.new_text }),
        reason: data_cli::required_reason(args.reason)?,
    })
}

struct SourceEdit<'a> {
    old_text: &'a str,
    new_text: &'a str,
}

fn edit_texts(payload: &Value) -> SourceEdit<'_> {
    let text = |key: &str| payload.get(key).and_then(Value::as_str).unwrap_or("");
    SourceEdit {
        old_text: text("oldText"),
        new_text: text("newText"),
    }
}

/// Plans the edit against the file as it is now. Every problem becomes a
/// validation error, so a blocked dry-run is recorded and nothing pends.
pub(super) fn plan(mutation: &DekiDataMutation) -> AppResult<DekiDataPlan> {
    plan_in(&super::deki_repo_root()?, mutation)
}

fn plan_in(root: &Path, mutation: &DekiDataMutation) -> AppResult<DekiDataPlan> {
    let path = mutation.id.as_str();
    let edit = edit_texts(&mutation.payload);
    let mut validation = DekiDataValidation::default();
    let current = read_current(root, path, &mut validation)?;

    if edit.old_text.is_empty() {
        validation.error(SOURCE_COLLECTION, path, "oldText must not be empty.");
    }
    if edit.old_text == edit.new_text {
        validation.error(SOURCE_COLLECTION, path, "newText is the same as oldText.");
    }
    if edit.old_text.len() + edit.new_text.len() > data_cli::PAYLOAD_MAX_BYTES {
        validation.error(
            SOURCE_COLLECTION,
            path,
            "The edit is too large for one approval; split it into smaller edits.",
        );
    }
    let mut line = None;
    if let Some(content) = current.as_deref() {
        if !edit.old_text.is_empty() {
            let matches = content.matches(edit.old_text).count();
            if matches != 1 {
                validation.error(
                    SOURCE_COLLECTION,
                    path,
                    format!("oldText must occur exactly once in {path}; found {matches}. Read the file and copy a longer, unique oldText."),
                );
            } else if let Some(index) = content.find(edit.old_text) {
                line = Some(content[..index].matches('\n').count() + 1);
            }
        }
    }

    let can_apply = !validation.blocked();
    let mut affected_entities = Map::new();
    if can_apply {
        affected_entities.insert(SOURCE_COLLECTION.to_string(), json!(1));
    }
    let preview = vec![data_cli::row_change(
        SOURCE_COLLECTION,
        path,
        "update",
        Some(&json!({ "line": line, "text": edit.old_text })),
        Some(&json!({ "line": line, "text": edit.new_text })),
    )];
    let operation_hash = operation_hash(path, current.as_deref(), &edit);
    let affected_rows = usize::from(can_apply);
    let summary = json!({
        "matchedRows": usize::from(current.is_some()),
        "affectedRows": affected_rows,
        "insertedRows": 0,
        "updatedRows": affected_rows,
        "replacedRows": 0,
        "deletedRows": 0,
        "affectedEntities": affected_entities,
        "preview": preview,
        "truncated": false,
    });
    Ok(DekiDataPlan {
        mutation: mutation.clone(),
        command: mutation.command_label(),
        operation_hash,
        validation,
        summary,
        affected_entities,
        affected_rows,
        preview,
        preview_truncated: false,
    })
}

/// Writes the approved edit. The approval resolver has already re-planned and
/// matched the hash, so the file still holds exactly one `oldText`.
pub(super) fn apply(mutation: &DekiDataMutation) -> AppResult<Value> {
    apply_in(&super::deki_repo_root()?, mutation)
}

fn apply_in(root: &Path, mutation: &DekiDataMutation) -> AppResult<Value> {
    let (_root, target, display_path) =
        code::resolve_repo_file_in(root.to_path_buf(), &mutation.id)?;
    let edit = edit_texts(&mutation.payload);
    let content = fs::read_to_string(&target).map_err(|error| {
        AppError::new(
            "deki_source_edit_failed",
            format!("{display_path} could not be read: {error}"),
        )
    })?;
    if content.matches(edit.old_text).count() != 1 {
        return Err(AppError::new(
            "deki_source_edit_failed",
            format!("{display_path} changed; oldText no longer occurs exactly once."),
        ));
    }
    let updated = content.replacen(edit.old_text, edit.new_text, 1);
    write_atomically(&target, &updated)?;
    Ok(json!({ "path": display_path, "replacements": 1, "bytes": updated.len() }))
}

/// The file's current content, or `None` with the reason recorded when it
/// cannot be edited (no git checkout, missing, not a source file, too large).
fn read_current(
    root: &Path,
    path: &str,
    validation: &mut DekiDataValidation,
) -> AppResult<Option<String>> {
    if !root.join(".git").exists() {
        validation.error(
            SOURCE_COLLECTION,
            path,
            "Source edits need De-Koi running from a git checkout of its repository. This install runs from a packaged copy, so an edit would not change the running app; suggest the change instead.",
        );
        return Ok(None);
    }
    let (_root, target, display_path) = code::resolve_repo_file_in(root.to_path_buf(), path)?;
    if !target.is_file() {
        validation.error(
            SOURCE_COLLECTION,
            path,
            format!("{display_path} was not found."),
        );
        return Ok(None);
    }
    if !code::is_code_text_path(Path::new(&display_path)) {
        validation.error(
            SOURCE_COLLECTION,
            path,
            format!("{display_path} is not an editable source or guidance file."),
        );
        return Ok(None);
    }
    if fs::metadata(&target)?.len() > code::CODE_SEARCH_MAX_FILE_BYTES {
        validation.error(
            SOURCE_COLLECTION,
            path,
            format!("{display_path} is too large for an exact edit."),
        );
        return Ok(None);
    }
    match fs::read_to_string(&target) {
        Ok(content) => Ok(Some(content)),
        Err(error) => {
            validation.error(
                SOURCE_COLLECTION,
                path,
                format!("{display_path} is not valid UTF-8 text: {error}"),
            );
            Ok(None)
        }
    }
}

/// Covers the whole current file, so any change to it after the dry-run makes
/// the approval `state_changed`.
fn operation_hash(path: &str, current: Option<&str>, edit: &SourceEdit<'_>) -> String {
    let material = data_cli::canonical_json(&json!({
        "kind": "source-edit",
        "path": path,
        "current": current,
        "oldText": edit.old_text,
        "newText": edit.new_text,
    }));
    let digest = Sha256::digest(material.as_bytes());
    format!(
        "sha256:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

/// Writes next to the file, then renames over it, so a failed write never
/// leaves a half-written source file.
fn write_atomically(target: &Path, content: &str) -> AppResult<()> {
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("source");
    let temp = target.with_file_name(format!(".{file_name}.deki-{}.tmp", marinara_core::new_id()));
    fs::write(&temp, content.as_bytes()).map_err(|error| {
        AppError::new(
            "deki_source_edit_failed",
            format!("The edited file could not be written: {error}"),
        )
    })?;
    fs::rename(&temp, target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        AppError::new(
            "deki_source_edit_failed",
            format!("The edited file could not replace the original: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(label: &str, git: bool) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("de-koi-deki-source-{label}-{nonce}"));
        fs::create_dir_all(root.join("src")).expect("repo dir");
        if git {
            fs::create_dir_all(root.join(".git")).expect("git dir");
        }
        fs::write(
            root.join("src/app.ts"),
            "const a = 1;
const b = 2;
const b2 = 2;
",
        )
        .expect("source file");
        root
    }

    fn edit(old_text: &str, new_text: &str) -> DekiDataMutation {
        DekiDataMutation {
            kind: DekiDataMutationKind::Patch,
            collection: SOURCE_COLLECTION,
            id: "src/app.ts".to_string(),
            payload: json!({ "oldText": old_text, "newText": new_text }),
            reason: "test".to_string(),
        }
    }

    #[test]
    fn a_unique_edit_plans_without_writing_and_applies_exactly() {
        let root = temp_repo("apply", true);
        let mutation = edit("const a = 1;", "const a = 10;");

        let plan = plan_in(&root, &mutation).expect("plan");
        assert!(!plan.validation.blocked());
        assert_eq!(plan.preview[0]["before"]["line"], json!(1));
        assert!(fs::read_to_string(root.join("src/app.ts"))
            .unwrap()
            .contains("const a = 1;"));

        apply_in(&root, &mutation).expect("apply");
        let content = fs::read_to_string(root.join("src/app.ts")).unwrap();
        assert_eq!(
            content,
            "const a = 10;
const b = 2;
const b2 = 2;
"
        );
        let leftovers = fs::read_dir(root.join("src")).unwrap().count();
        assert_eq!(leftovers, 1, "no temp file is left behind");
    }

    #[test]
    fn a_changed_file_changes_the_operation_hash() {
        let root = temp_repo("hash", true);
        let mutation = edit("const a = 1;", "const a = 10;");
        let before = plan_in(&root, &mutation).expect("plan").operation_hash;
        fs::write(
            root.join("src/app.ts"),
            "const a = 1;
// changed
",
        )
        .unwrap();
        let after = plan_in(&root, &mutation).expect("plan").operation_hash;
        assert_ne!(before, after);
    }

    #[test]
    fn ambiguous_or_empty_edits_and_non_checkouts_are_blocked() {
        let root = temp_repo("blocked", true);
        let ambiguous = plan_in(&root, &edit("const b", "let b")).expect("plan");
        assert!(ambiguous
            .validation
            .first_error()
            .unwrap()
            .contains("found 2"));
        let same = plan_in(&root, &edit("const a = 1;", "const a = 1;")).expect("plan");
        assert!(same.validation.blocked());

        let packaged = temp_repo("packaged", false);
        let plan = plan_in(&packaged, &edit("const a = 1;", "const a = 10;")).expect("plan");
        assert!(plan
            .validation
            .first_error()
            .unwrap()
            .contains("git checkout"));
    }
}
