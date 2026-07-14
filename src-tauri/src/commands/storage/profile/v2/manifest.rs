use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub(super) const PROFILE_V2_TYPE: &str = "marinara_profile";
pub(super) const PROFILE_V2_VERSION: u32 = 2;
pub(super) const PROFILE_V2_SCHEMA_VERSION: u32 = 1;
pub(super) const PROFILE_V2_DESTRUCTIVE_MODE: &str = "replace-present-collection";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileV2File {
    pub path: String,
    pub record_count: u64,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileV2Table {
    pub name: String,
    pub record_count: u64,
    pub files: Vec<ProfileV2File>,
    pub bytes: u64,
    pub schema_version: u32,
    pub destructive_import_mode: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileV2Assets {
    pub index: ProfileV2File,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileV2Compatibility {
    pub minimum_reader_version: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileV2Manifest {
    #[serde(rename = "type")]
    pub profile_type: String,
    pub version: u32,
    pub exported_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    pub compatibility: ProfileV2Compatibility,
    pub tables: Vec<ProfileV2Table>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assets: Option<ProfileV2Assets>,
}

impl ProfileV2Manifest {
    pub(super) fn validate(&self, expected_table_names: &[&str]) -> AppResult<()> {
        if self.profile_type != PROFILE_V2_TYPE
            || self.version != PROFILE_V2_VERSION
            || self.compatibility.minimum_reader_version != PROFILE_V2_VERSION
        {
            return Err(invalid_manifest("unsupported profile package contract"));
        }

        let mut names = HashSet::new();
        let mut paths = HashSet::new();
        for table in &self.tables {
            if !names.insert(table.name.as_str()) {
                return Err(invalid_manifest("duplicate table name"));
            }
            if table.schema_version != PROFILE_V2_SCHEMA_VERSION
                || table.destructive_import_mode != PROFILE_V2_DESTRUCTIVE_MODE
            {
                return Err(invalid_manifest("unsupported table contract"));
            }
            for file in &table.files {
                if !paths.insert(file.path.as_str()) {
                    return Err(invalid_manifest("duplicate file path"));
                }
            }
            if !table
                .files
                .windows(2)
                .all(|files| files[0].path < files[1].path)
            {
                return Err(invalid_manifest("table files must be in lexical order"));
            }
            for (index, file) in table.files.iter().enumerate() {
                let expected_path = format!("tables/{}/{:06}.jsonl", table.name, index + 1);
                if file.path != expected_path {
                    return Err(invalid_manifest("invalid table chunk path"));
                }
                if !is_sha256(&file.sha256) {
                    return Err(invalid_manifest("invalid file sha256"));
                }
            }
            let record_count = table
                .files
                .iter()
                .map(|file| file.record_count)
                .sum::<u64>();
            if record_count != table.record_count {
                return Err(invalid_manifest("table record count does not match files"));
            }
            let bytes = table.files.iter().map(|file| file.bytes).sum::<u64>();
            if bytes != table.bytes {
                return Err(invalid_manifest("table byte count does not match files"));
            }
        }

        if self
            .tables
            .iter()
            .map(|table| table.name.as_str())
            .collect::<Vec<_>>()
            != expected_table_names
        {
            return Err(invalid_manifest(
                "table order does not match storage contract",
            ));
        }
        Ok(())
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn invalid_manifest(message: &str) -> AppError {
    AppError::new("invalid_profile_v2_manifest", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, record_count: u64, bytes: u64) -> ProfileV2File {
        ProfileV2File {
            path: path.to_string(),
            record_count,
            bytes,
            sha256: "a".repeat(64),
        }
    }

    fn manifest() -> ProfileV2Manifest {
        ProfileV2Manifest {
            profile_type: PROFILE_V2_TYPE.to_string(),
            version: PROFILE_V2_VERSION,
            exported_at: "2026-07-13T00:00:00Z".to_string(),
            app_version: Some("2.0.0".to_string()),
            compatibility: ProfileV2Compatibility {
                minimum_reader_version: PROFILE_V2_VERSION,
            },
            tables: vec![ProfileV2Table {
                name: "messages".to_string(),
                record_count: 2,
                files: vec![file("tables/messages/000001.jsonl", 2, 20)],
                bytes: 20,
                schema_version: PROFILE_V2_SCHEMA_VERSION,
                destructive_import_mode: PROFILE_V2_DESTRUCTIVE_MODE.to_string(),
            }],
            assets: None,
        }
    }

    #[test]
    fn profile_v2_manifest_accepts_the_canonical_contract() {
        manifest()
            .validate(&["messages"])
            .expect("canonical manifest should validate");
    }

    #[test]
    fn profile_v2_manifest_rejects_duplicate_table_names() {
        let mut value = manifest();
        value.tables.push(value.tables[0].clone());

        let error = value
            .validate(&["messages", "messages"])
            .expect_err("duplicate table names must reject");

        assert_eq!(error.code, "invalid_profile_v2_manifest");
        assert!(error.message.contains("duplicate table"));
    }

    #[test]
    fn profile_v2_manifest_rejects_mismatched_aggregate_counts() {
        let mut value = manifest();
        value.tables[0].record_count = 3;

        let error = value
            .validate(&["messages"])
            .expect_err("aggregate record count must match files");

        assert_eq!(error.code, "invalid_profile_v2_manifest");
        assert!(error.message.contains("record count"));
    }

    #[test]
    fn profile_v2_manifest_rejects_unsupported_versions() {
        let mut value = manifest();
        value.version = 3;
        assert!(value.validate(&["messages"]).is_err());
    }

    #[test]
    fn profile_v2_manifest_rejects_duplicate_file_paths() {
        let mut value = manifest();
        value.tables[0]
            .files
            .push(file("tables/messages/000001.jsonl", 1, 10));
        value.tables[0].record_count = 3;
        value.tables[0].bytes = 30;

        let error = value
            .validate(&["messages"])
            .expect_err("duplicate paths must reject");
        assert!(error.message.contains("duplicate file"));
    }

    #[test]
    fn profile_v2_manifest_rejects_nonlexical_file_order() {
        let mut value = manifest();
        value.tables[0].files = vec![
            file("tables/messages/000002.jsonl", 1, 10),
            file("tables/messages/000001.jsonl", 1, 10),
        ];

        let error = value
            .validate(&["messages"])
            .expect_err("file order must be lexical");
        assert!(error.message.contains("lexical"));
    }

    #[test]
    fn profile_v2_manifest_rejects_bad_chunk_paths_and_digests() {
        let mut bad_path = manifest();
        bad_path.tables[0].files[0].path = "tables/messages/1.jsonl".to_string();
        assert!(bad_path.validate(&["messages"]).is_err());

        let mut bad_digest = manifest();
        bad_digest.tables[0].files[0].sha256 = "A".repeat(64);
        assert!(bad_digest.validate(&["messages"]).is_err());
    }

    #[test]
    fn profile_v2_manifest_rejects_unknown_destructive_modes() {
        let mut value = manifest();
        value.tables[0].destructive_import_mode = "merge".to_string();
        assert!(value.validate(&["messages"]).is_err());
    }
}
