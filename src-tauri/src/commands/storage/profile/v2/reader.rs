use super::manifest::{ProfileV2Manifest, ProfileV2Table};
use crate::storage_commands::{
    contracts,
    profile::assets::{
        safe_profile_asset_path, MAX_PROFILE_ASSET_BYTES,
        PROFILE_ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT_BYTES,
    },
};
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path};

const MAX_PROFILE_V2_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ValidatedProfileV2Table {
    pub name: String,
    pub record_count: u64,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ValidatedProfileV2 {
    pub manifest: ProfileV2Manifest,
    pub tables: Vec<ValidatedProfileV2Table>,
    pub asset_count: u64,
    pub asset_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileV2AssetIndexRow {
    path: String,
    bytes: u64,
    sha256: String,
}

pub(super) fn validate_profile_v2_archive(path: &Path) -> AppResult<ValidatedProfileV2> {
    let mut archive = zip::ZipArchive::new(File::open(path)?)
        .map_err(|error| invalid_archive(format!("Could not read profile v2 ZIP: {error}")))?;
    let archive_names = validate_central_directory(&mut archive)?;
    if !archive_names.contains("manifest.json") {
        return Err(invalid_archive(
            "Profile v2 archive is missing manifest.json",
        ));
    }

    let manifest_bytes =
        read_bounded_entry(&mut archive, "manifest.json", MAX_PROFILE_V2_MANIFEST_BYTES)?;
    let manifest: ProfileV2Manifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| invalid_archive(format!("Invalid profile v2 manifest: {error}")))?;
    let expected_tables = contracts::profile_collections().collect::<Vec<_>>();
    manifest.validate(&expected_tables)?;

    let mut declared = HashSet::from(["manifest.json".to_string()]);
    let mut validated_tables = Vec::with_capacity(manifest.tables.len());
    for table in &manifest.tables {
        validate_table(&mut archive, table, &mut declared)?;
        validated_tables.push(ValidatedProfileV2Table {
            name: table.name.clone(),
            record_count: table.record_count,
            bytes: table.bytes,
        });
    }

    let (asset_count, asset_bytes) = if let Some(assets) = &manifest.assets {
        if assets.index.bytes > MAX_PROFILE_ASSET_BYTES {
            return Err(budget_error("asset-index", &assets.index.path));
        }
        declared.insert(assets.index.path.clone());
        let index_bytes =
            read_bounded_entry(&mut archive, &assets.index.path, MAX_PROFILE_ASSET_BYTES)?;
        verify_file_descriptor(
            &assets.index.path,
            &index_bytes,
            assets.index.bytes,
            &assets.index.sha256,
        )?;
        let rows: Vec<ProfileV2AssetIndexRow> = serde_json::from_slice(&index_bytes)
            .map_err(|error| invalid_archive(format!("Invalid asset index: {error}")))?;
        if rows.len() as u64 != assets.index.record_count {
            return Err(invalid_archive("Asset index record count mismatch"));
        }
        validate_assets(&mut archive, &rows, &mut declared)?
    } else {
        (0, 0)
    };

    if declared != archive_names {
        let missing = declared.difference(&archive_names).next().cloned();
        let undeclared = archive_names.difference(&declared).next().cloned();
        return Err(AppError::with_details(
            "invalid_profile_v2_archive",
            "Profile v2 archive entries do not match the manifest",
            json!({ "phase": "entries", "missing": missing, "undeclared": undeclared }),
        ));
    }

    Ok(ValidatedProfileV2 {
        manifest,
        tables: validated_tables,
        asset_count,
        asset_bytes,
    })
}

fn validate_central_directory(archive: &mut zip::ZipArchive<File>) -> AppResult<HashSet<String>> {
    let mut names = HashSet::new();
    let mut folded_names = HashSet::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| invalid_archive(format!("Could not read ZIP entry: {error}")))?;
        let name = entry.name().to_string();
        if entry.is_dir() || !is_safe_archive_path(&name) {
            return Err(invalid_archive(format!(
                "Unsafe profile v2 ZIP path: {name}"
            )));
        }
        total = total.saturating_add(entry.size());
        if total > PROFILE_ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT_BYTES {
            return Err(budget_error("archive", &name));
        }
        if !names.insert(name.clone()) || !folded_names.insert(name.to_ascii_lowercase()) {
            return Err(invalid_archive(format!(
                "Duplicate or ambiguous profile v2 ZIP path: {name}"
            )));
        }
    }
    Ok(names)
}

fn is_safe_archive_path(name: &str) -> bool {
    if name.is_empty() || name.contains('\\') || name.starts_with('/') || name.ends_with('/') {
        return false;
    }
    let path = Path::new(name);
    !path.is_absolute()
        && path.components().all(|component| match component {
            Component::Normal(value) => value
                .to_str()
                .is_some_and(|segment| !segment.is_empty() && segment != "." && segment != ".."),
            _ => false,
        })
}

fn validate_table(
    archive: &mut zip::ZipArchive<File>,
    table: &ProfileV2Table,
    declared: &mut HashSet<String>,
) -> AppResult<()> {
    for descriptor in &table.files {
        if descriptor.bytes > MAX_PROFILE_ASSET_BYTES {
            return Err(budget_error("table-chunk", &descriptor.path));
        }
        declared.insert(descriptor.path.clone());
        let entry = archive.by_name(&descriptor.path).map_err(|_| {
            table_error(
                "entry",
                &table.name,
                &descriptor.path,
                "Missing declared table chunk",
            )
        })?;
        if entry.size() != descriptor.bytes {
            return Err(table_error(
                "integrity",
                &table.name,
                &descriptor.path,
                "Table chunk size mismatch",
            ));
        }
        let mut reader = BufReader::new(entry.take(MAX_PROFILE_ASSET_BYTES.saturating_add(1)));
        let mut hasher = Sha256::new();
        let mut record_count = 0_u64;
        let mut byte_count = 0_u64;
        let mut line = Vec::new();
        loop {
            line.clear();
            let read = reader.read_until(b'\n', &mut line)?;
            if read == 0 {
                break;
            }
            byte_count += read as u64;
            hasher.update(&line);
            if !line.ends_with(b"\n") || line == b"\n" {
                return Err(table_error(
                    "jsonl",
                    &table.name,
                    &descriptor.path,
                    "Table chunk contains a blank or unterminated JSONL record",
                ));
            }
            let value: Value = serde_json::from_slice(&line[..line.len() - 1]).map_err(|_| {
                table_error(
                    "jsonl",
                    &table.name,
                    &descriptor.path,
                    "Table chunk contains malformed JSONL",
                )
            })?;
            if !value.is_object() {
                return Err(table_error(
                    "jsonl",
                    &table.name,
                    &descriptor.path,
                    "Table chunk JSONL records must be objects",
                ));
            }
            record_count += 1;
        }
        if byte_count != descriptor.bytes
            || record_count != descriptor.record_count
            || sha256_hex(hasher.finalize().as_slice()) != descriptor.sha256
        {
            return Err(table_error(
                "integrity",
                &table.name,
                &descriptor.path,
                "Table chunk count, size, or hash mismatch",
            ));
        }
    }
    Ok(())
}

fn validate_assets(
    archive: &mut zip::ZipArchive<File>,
    rows: &[ProfileV2AssetIndexRow],
    declared: &mut HashSet<String>,
) -> AppResult<(u64, u64)> {
    let mut previous = None::<&str>;
    let mut asset_bytes = 0_u64;
    for row in rows {
        if previous.is_some_and(|value| value >= row.path.as_str())
            || safe_profile_asset_path(&row.path).is_err()
            || !is_sha256(&row.sha256)
        {
            return Err(invalid_archive("Invalid or non-lexical asset index path"));
        }
        previous = Some(&row.path);
        if row.bytes > MAX_PROFILE_ASSET_BYTES {
            return Err(budget_error("asset", &row.path));
        }
        let entry_path = format!("assets/{}", row.path);
        declared.insert(entry_path.clone());
        let mut entry = archive
            .by_name(&entry_path)
            .map_err(|_| invalid_archive(format!("Missing declared asset: {}", row.path)))?;
        if entry.size() != row.bytes {
            return Err(invalid_archive(format!(
                "Asset size mismatch: {}",
                row.path
            )));
        }
        let mut hasher = Sha256::new();
        let mut actual = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = entry.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            actual += read as u64;
            hasher.update(&buffer[..read]);
        }
        if actual != row.bytes || sha256_hex(hasher.finalize().as_slice()) != row.sha256 {
            return Err(invalid_archive(format!(
                "Asset hash mismatch: {}",
                row.path
            )));
        }
        asset_bytes = asset_bytes.saturating_add(actual);
    }
    Ok((rows.len() as u64, asset_bytes))
}

fn read_bounded_entry(
    archive: &mut zip::ZipArchive<File>,
    path: &str,
    limit: u64,
) -> AppResult<Vec<u8>> {
    let entry = archive
        .by_name(path)
        .map_err(|_| invalid_archive(format!("Missing declared entry: {path}")))?;
    if entry.size() > limit {
        return Err(budget_error("entry", path));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(budget_error("entry", path));
    }
    Ok(bytes)
}

fn verify_file_descriptor(
    path: &str,
    bytes: &[u8],
    expected_bytes: u64,
    expected_sha256: &str,
) -> AppResult<()> {
    if bytes.len() as u64 != expected_bytes
        || !is_sha256(expected_sha256)
        || sha256_hex(Sha256::digest(bytes).as_slice()) != expected_sha256
    {
        return Err(invalid_archive(format!("Entry integrity mismatch: {path}")));
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn sha256_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn invalid_archive(message: impl Into<String>) -> AppError {
    AppError::new("invalid_profile_v2_archive", message)
}

fn budget_error(phase: &str, path: &str) -> AppError {
    AppError::with_details(
        "profile_v2_archive_budget_exceeded",
        "Profile v2 archive exceeds a safety budget",
        json!({ "phase": phase, "path": path }),
    )
}

fn table_error(phase: &str, table: &str, chunk: &str, message: &str) -> AppError {
    AppError::with_details(
        "invalid_profile_v2_archive",
        message,
        json!({ "phase": phase, "table": table, "chunk": chunk }),
    )
}

#[cfg(test)]
mod tests {
    use super::super::export::export_profile_v2_artifact;
    use super::*;
    use crate::state::AppState;
    use serde_json::{json, Value};
    use std::fs::File;
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        AppState::from_data_dir(
            std::env::temp_dir().join(format!("profile-v2-reader-{label}-{nonce}")),
            Vec::new(),
        )
        .unwrap()
    }

    fn rewritten(
        source: &Path,
        label: &str,
        mut edit: impl FnMut(&str, Vec<u8>) -> Option<Vec<u8>>,
        extras: &[(&str, &[u8])],
    ) -> PathBuf {
        let mut archive = ZipArchive::new(File::open(source).unwrap()).unwrap();
        let mut entries = Vec::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).unwrap();
            let name = entry.name().to_string();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            if let Some(bytes) = edit(&name, bytes) {
                entries.push((name, bytes));
            }
        }
        drop(archive);
        for (name, bytes) in extras {
            entries.push(((*name).to_string(), bytes.to_vec()));
        }
        let target = source.with_file_name(format!("reader-{label}.zip"));
        let mut zip = ZipWriter::new(File::create(&target).unwrap());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, bytes) in entries {
            zip.start_file(name, options).unwrap();
            zip.write_all(&bytes).unwrap();
        }
        zip.finish().unwrap();
        target
    }

    fn modify_manifest(bytes: Vec<u8>, edit: impl FnOnce(&mut Value)) -> Vec<u8> {
        let mut value: Value = serde_json::from_slice(&bytes).unwrap();
        edit(&mut value);
        serde_json::to_vec(&value).unwrap()
    }

    #[test]
    fn profile_v2_reader_accepts_exported_archive_without_mutation() {
        let state = test_state("accept");
        state
            .storage
            .replace_all("characters", vec![json!({ "id": "unchanged" })])
            .unwrap();
        let collection_path = state.data_dir.join("data/collections/characters.json");
        let before = std::fs::read(&collection_path).unwrap();
        let artifact = export_profile_v2_artifact(&state).unwrap();

        let validated = validate_profile_v2_archive(artifact.path()).unwrap();

        assert!(validated
            .tables
            .iter()
            .any(|table| { table.name == "characters" && table.record_count == 1 }));
        assert_eq!(std::fs::read(&collection_path).unwrap(), before);
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_reader_rejects_unsupported_version() {
        let state = test_state("version");
        let artifact = export_profile_v2_artifact(&state).unwrap();
        let path = rewritten(
            artifact.path(),
            "version",
            |name, bytes| {
                Some(if name == "manifest.json" {
                    modify_manifest(bytes, |value| value["version"] = json!(99))
                } else {
                    bytes
                })
            },
            &[],
        );
        assert!(validate_profile_v2_archive(&path).is_err());
        std::fs::remove_file(path).unwrap();
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_reader_rejects_duplicate_and_unsafe_paths() {
        let state = test_state("unsafe");
        let artifact = export_profile_v2_artifact(&state).unwrap();
        let path = rewritten(
            artifact.path(),
            "unsafe",
            |_, bytes| Some(bytes),
            &[("../escape.txt", b"escape"), ("Manifest.json", b"{}")],
        );
        assert!(validate_profile_v2_archive(&path).is_err());
        std::fs::remove_file(path).unwrap();
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_reader_rejects_missing_and_undeclared_entries() {
        let state = test_state("declared");
        state
            .storage
            .replace_all("characters", vec![json!({ "id": "row" })])
            .unwrap();
        let artifact = export_profile_v2_artifact(&state).unwrap();
        let undeclared = rewritten(
            artifact.path(),
            "undeclared",
            |_, bytes| Some(bytes),
            &[("extra.txt", b"extra")],
        );
        let missing = rewritten(
            artifact.path(),
            "missing",
            |name, bytes| (name != "tables/characters/000001.jsonl").then_some(bytes),
            &[],
        );
        assert!(validate_profile_v2_archive(&undeclared).is_err());
        assert!(validate_profile_v2_archive(&missing).is_err());
        std::fs::remove_file(undeclared).unwrap();
        std::fs::remove_file(missing).unwrap();
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_reader_rejects_chunk_size_hash_and_count_mismatch() {
        let state = test_state("chunk-mismatch");
        state
            .storage
            .replace_all("characters", vec![json!({ "id": "row" })])
            .unwrap();
        let artifact = export_profile_v2_artifact(&state).unwrap();
        let path = rewritten(
            artifact.path(),
            "chunk-mismatch",
            |name, bytes| {
                Some(if name == "tables/characters/000001.jsonl" {
                    b"{\"id\":\"changed\"}\n".to_vec()
                } else {
                    bytes
                })
            },
            &[],
        );
        assert!(validate_profile_v2_archive(&path).is_err());
        std::fs::remove_file(path).unwrap();
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_reader_rejects_malformed_jsonl_with_table_and_chunk_details() {
        let state = test_state("malformed");
        state
            .storage
            .replace_all("characters", vec![json!({ "id": "row" })])
            .unwrap();
        let artifact = export_profile_v2_artifact(&state).unwrap();
        let path = rewritten(
            artifact.path(),
            "malformed",
            |name, bytes| {
                Some(if name == "tables/characters/000001.jsonl" {
                    let mut malformed = vec![b'x'; bytes.len()];
                    *malformed.last_mut().unwrap() = b'\n';
                    malformed
                } else {
                    bytes
                })
            },
            &[],
        );
        let error = validate_profile_v2_archive(&path).unwrap_err();
        let details = error.details.unwrap();
        assert_eq!(details["phase"], "jsonl");
        assert_eq!(details["table"], "characters");
        assert_eq!(details["chunk"], "tables/characters/000001.jsonl");
        std::fs::remove_file(path).unwrap();
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_reader_rejects_asset_index_and_asset_hash_mismatch() {
        let state = test_state("asset-mismatch");
        std::fs::create_dir_all(state.data_dir.join("avatars")).unwrap();
        std::fs::write(state.data_dir.join("avatars/koi.png"), b"koi").unwrap();
        let artifact = export_profile_v2_artifact(&state).unwrap();
        let path = rewritten(
            artifact.path(),
            "asset-mismatch",
            |name, bytes| {
                Some(if name == "assets/avatars/koi.png" {
                    b"changed".to_vec()
                } else {
                    bytes
                })
            },
            &[],
        );
        assert!(validate_profile_v2_archive(&path).is_err());
        std::fs::remove_file(path).unwrap();
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_reader_enforces_entry_and_total_budgets_before_allocation() {
        let state = test_state("budget");
        let artifact = export_profile_v2_artifact(&state).unwrap();
        let path = rewritten(
            artifact.path(),
            "budget",
            |name, bytes| {
                Some(if name == "manifest.json" {
                    modify_manifest(bytes, |value| {
                        value["assets"]["index"]["bytes"] =
                            json!(super::MAX_PROFILE_ASSET_BYTES + 1)
                    })
                } else {
                    bytes
                })
            },
            &[],
        );
        assert!(validate_profile_v2_archive(&path).is_err());
        std::fs::remove_file(path).unwrap();
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_reader_never_falls_back_to_v1() {
        let state = test_state("v1");
        let path = state.data_dir.join("v1.zip");
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("marinara-profile.json", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"{\"type\":\"marinara_profile\",\"version\":1}")
            .unwrap();
        zip.finish().unwrap();
        assert!(validate_profile_v2_archive(&path).is_err());
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }
}
