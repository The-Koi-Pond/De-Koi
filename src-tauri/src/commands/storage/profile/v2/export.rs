use super::manifest::{
    ProfileV2Assets, ProfileV2Compatibility, ProfileV2File, ProfileV2Manifest, PROFILE_V2_TYPE,
    PROFILE_V2_VERSION,
};
use super::sources::write_profile_v2_tables;
use crate::state::AppState;
use crate::storage_commands::{contracts, profile::assets::visit_profile_export_assets};
use marinara_core::{now_iso, AppError, AppResult};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

static PROFILE_V2_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ProfileV2ExportSummary {
    pub table_count: usize,
    pub record_count: u64,
    pub asset_count: u64,
    pub archive_bytes: u64,
}

#[derive(Debug)]
#[allow(dead_code)]
pub(super) struct ProfileV2Artifact {
    path: PathBuf,
    manifest: ProfileV2Manifest,
    summary: ProfileV2ExportSummary,
    retained: bool,
}

#[allow(dead_code)]
impl ProfileV2Artifact {
    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn manifest(&self) -> &ProfileV2Manifest {
        &self.manifest
    }

    pub(super) fn summary(&self) -> &ProfileV2ExportSummary {
        &self.summary
    }

    pub(super) fn retain(mut self) -> PathBuf {
        self.retained = true;
        self.path.clone()
    }
}

impl Drop for ProfileV2Artifact {
    fn drop(&mut self) {
        if !self.retained {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

struct ProfileV2ExportOptions {
    exported_at: String,
    app_version: Option<String>,
    temp_root: PathBuf,
    fail_after_tables: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileV2AssetIndexRow {
    path: String,
    bytes: u64,
    sha256: String,
}

struct OwnedTemporary {
    path: PathBuf,
    retained: bool,
}

impl Drop for OwnedTemporary {
    fn drop(&mut self) {
        if !self.retained {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

pub(super) fn export_profile_v2_artifact(state: &AppState) -> AppResult<ProfileV2Artifact> {
    export_profile_v2_artifact_with_options(
        state,
        ProfileV2ExportOptions {
            exported_at: now_iso(),
            app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            temp_root: state.data_dir.join(".profile-v2-exports"),
            fail_after_tables: false,
        },
    )
}

fn export_profile_v2_artifact_with_options(
    state: &AppState,
    options: ProfileV2ExportOptions,
) -> AppResult<ProfileV2Artifact> {
    let (mut owned, file) = create_owned_temporary(&options.temp_root)?;
    let path = owned.path.clone();

    let result = (|| {
        let mut zip = ZipWriter::new(file);
        let tables = write_profile_v2_tables(state, &mut zip)?;
        if options.fail_after_tables {
            return Err(AppError::new(
                "profile_v2_export_test_failure",
                "Injected failure after tables",
            ));
        }

        let mut asset_rows = Vec::new();
        visit_profile_export_assets(state, |asset| {
            let relative = asset.relative.to_string_lossy().replace('\\', "/");
            let entry_path = format!("assets/{relative}");
            zip.start_file(&entry_path, zip_options())
                .map_err(profile_v2_zip_error)?;
            let mut source = File::open(&asset.absolute)?;
            let mut hasher = Sha256::new();
            let mut copied = 0_u64;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let read = source.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                zip.write_all(&buffer[..read])?;
                hasher.update(&buffer[..read]);
                copied += read as u64;
            }
            if copied != asset.bytes {
                return Err(AppError::new(
                    "profile_v2_asset_changed",
                    format!("Managed asset changed while exporting: {relative}"),
                ));
            }
            asset_rows.push(ProfileV2AssetIndexRow {
                path: relative,
                bytes: copied,
                sha256: sha256_hex(hasher.finalize().as_slice()),
            });
            Ok(())
        })?;

        let index_bytes = serde_json::to_vec(&asset_rows)?;
        zip.start_file("assets/index.json", zip_options())
            .map_err(profile_v2_zip_error)?;
        zip.write_all(&index_bytes)?;
        let asset_count = asset_rows.len() as u64;
        let assets = ProfileV2Assets {
            index: ProfileV2File {
                path: "assets/index.json".to_string(),
                record_count: asset_count,
                bytes: index_bytes.len() as u64,
                sha256: sha256_hex(Sha256::digest(&index_bytes).as_slice()),
            },
        };

        let manifest = ProfileV2Manifest {
            profile_type: PROFILE_V2_TYPE.to_string(),
            version: PROFILE_V2_VERSION,
            exported_at: options.exported_at,
            app_version: options.app_version,
            compatibility: ProfileV2Compatibility {
                minimum_reader_version: PROFILE_V2_VERSION,
            },
            tables,
            assets: Some(assets),
        };
        let expected_tables = contracts::profile_collections().collect::<Vec<_>>();
        manifest.validate(&expected_tables)?;
        let manifest_bytes = serde_json::to_vec(&manifest)?;
        zip.start_file("manifest.json", zip_options())
            .map_err(profile_v2_zip_error)?;
        zip.write_all(&manifest_bytes)?;

        let output = zip.finish().map_err(profile_v2_zip_error)?;
        output.sync_all()?;
        drop(output);
        let archive_bytes = std::fs::metadata(&path)?.len();
        let summary = ProfileV2ExportSummary {
            table_count: manifest.tables.len(),
            record_count: manifest.tables.iter().map(|table| table.record_count).sum(),
            asset_count,
            archive_bytes,
        };
        Ok((manifest, summary))
    })();

    let (manifest, summary) = result?;
    owned.retained = true;
    Ok(ProfileV2Artifact {
        path,
        manifest,
        summary,
        retained: false,
    })
}

fn create_owned_temporary(root: &Path) -> AppResult<(OwnedTemporary, File)> {
    std::fs::create_dir_all(root)?;
    for _ in 0..100 {
        let sequence = PROFILE_V2_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = root.join(format!(
            "profile-v2-{}-{sequence:016x}.zip",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                return Ok((
                    OwnedTemporary {
                        path,
                        retained: false,
                    },
                    file,
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(AppError::new(
        "profile_v2_temp_collision",
        "Could not allocate a unique profile v2 export path",
    ))
}

fn zip_options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

fn sha256_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn profile_v2_zip_error(error: zip::result::ZipError) -> AppError {
    AppError::new("profile_v2_zip_error", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::fs::File;
    use std::io::Read;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::ZipArchive;

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("profile-v2-export-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test state should initialize")
    }

    fn options(state: &AppState) -> ProfileV2ExportOptions {
        ProfileV2ExportOptions {
            exported_at: "2026-07-13T00:00:00Z".to_string(),
            app_version: Some("2.0.0-test".to_string()),
            temp_root: state.data_dir.join("v2-temp"),
            fail_after_tables: false,
        }
    }

    fn read_entry(path: &std::path::Path, name: &str) -> Vec<u8> {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut entry = archive.by_name(name).unwrap();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        bytes
    }

    fn sha256(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    #[test]
    fn profile_v2_export_writes_manifest_tables_and_assets() {
        let state = test_state("structure");
        state
            .storage
            .replace_all("characters", vec![json!({ "id": "character" })])
            .unwrap();
        std::fs::create_dir_all(state.data_dir.join("avatars")).unwrap();
        std::fs::write(state.data_dir.join("avatars/koi.png"), b"koi").unwrap();

        let artifact = export_profile_v2_artifact_with_options(&state, options(&state)).unwrap();
        let manifest: Value =
            serde_json::from_slice(&read_entry(artifact.path(), "manifest.json")).unwrap();
        let archive = ZipArchive::new(File::open(artifact.path()).unwrap()).unwrap();
        let names = archive.file_names().map(str::to_string).collect::<Vec<_>>();

        assert_eq!(manifest["version"], 2);
        assert!(names.contains(&"tables/characters/000001.jsonl".to_string()));
        assert!(names.contains(&"assets/index.json".to_string()));
        assert!(names.contains(&"assets/avatars/koi.png".to_string()));
        assert_eq!(artifact.summary().asset_count, 1);
        drop(archive);
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_export_hashes_asset_index_and_asset_bytes() {
        let state = test_state("hashes");
        std::fs::create_dir_all(state.data_dir.join("avatars")).unwrap();
        std::fs::write(state.data_dir.join("avatars/koi.png"), b"asset-bytes").unwrap();
        let artifact = export_profile_v2_artifact_with_options(&state, options(&state)).unwrap();
        let index_bytes = read_entry(artifact.path(), "assets/index.json");
        let index: Value = serde_json::from_slice(&index_bytes).unwrap();
        let descriptor = &artifact.manifest().assets.as_ref().unwrap().index;

        assert_eq!(descriptor.sha256, sha256(&index_bytes));
        assert_eq!(index[0]["sha256"], sha256(b"asset-bytes"));
        assert_eq!(index[0]["bytes"], 11);
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_export_is_deterministic_with_fixed_metadata() {
        let state = test_state("deterministic");
        state
            .storage
            .replace_all("characters", vec![json!({ "id": "same" })])
            .unwrap();
        let first = export_profile_v2_artifact_with_options(&state, options(&state)).unwrap();
        let first_bytes = std::fs::read(first.path()).unwrap();
        let second = export_profile_v2_artifact_with_options(&state, options(&state)).unwrap();
        let second_bytes = std::fs::read(second.path()).unwrap();

        assert_eq!(first.manifest(), second.manifest());
        assert_eq!(first_bytes, second_bytes);
        drop(first);
        drop(second);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_export_drop_removes_unclaimed_artifact() {
        let state = test_state("drop");
        let artifact = export_profile_v2_artifact_with_options(&state, options(&state)).unwrap();
        let path = artifact.path().to_path_buf();
        assert!(path.exists());
        drop(artifact);
        assert!(!path.exists());
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_export_failure_removes_owned_temporary() {
        let state = test_state("failure");
        let mut export_options = options(&state);
        export_options.fail_after_tables = true;
        let temp_root = export_options.temp_root.clone();

        export_profile_v2_artifact_with_options(&state, export_options)
            .expect_err("injected failure should reject");

        assert_eq!(std::fs::read_dir(temp_root).unwrap().count(), 0);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }

    #[test]
    fn profile_v2_export_excludes_unmanaged_files() {
        let state = test_state("unmanaged");
        std::fs::write(state.data_dir.join("private.txt"), b"private").unwrap();
        let artifact = export_profile_v2_artifact_with_options(&state, options(&state)).unwrap();
        let archive = ZipArchive::new(File::open(artifact.path()).unwrap()).unwrap();
        let names = archive.file_names().map(str::to_string).collect::<Vec<_>>();

        assert!(!names.iter().any(|name| name.contains("private.txt")));
        drop(archive);
        drop(artifact);
        std::fs::remove_dir_all(state.data_dir).unwrap();
    }
}
