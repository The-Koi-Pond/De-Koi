use super::manifest::{
    ProfileV2File, ProfileV2Table, PROFILE_V2_DESTRUCTIVE_MODE, PROFILE_V2_SCHEMA_VERSION,
};
use marinara_core::{AppError, AppResult};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Write;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

pub(super) const PROFILE_V2_MAX_CHUNK_RECORDS: u64 = 10_000;
pub(super) const PROFILE_V2_MAX_CHUNK_BYTES: u64 = 16 * 1024 * 1024;

pub(super) struct TableChunkSink<'a> {
    collection: String,
    zip: &'a mut ZipWriter<File>,
    files: Vec<ProfileV2File>,
    current_path: Option<String>,
    current_records: u64,
    current_bytes: u64,
    current_hasher: Sha256,
    total_records: u64,
    total_bytes: u64,
    max_records: u64,
    max_bytes: u64,
}

impl<'a> TableChunkSink<'a> {
    pub(super) fn new(collection: &str, zip: &'a mut ZipWriter<File>) -> AppResult<Self> {
        Self::create(
            collection,
            zip,
            PROFILE_V2_MAX_CHUNK_RECORDS,
            PROFILE_V2_MAX_CHUNK_BYTES,
        )
    }

    #[cfg(test)]
    pub(super) fn with_limits(
        collection: &str,
        zip: &'a mut ZipWriter<File>,
        max_records: u64,
        max_bytes: u64,
    ) -> AppResult<Self> {
        Self::create(collection, zip, max_records, max_bytes)
    }

    fn create(
        collection: &str,
        zip: &'a mut ZipWriter<File>,
        max_records: u64,
        max_bytes: u64,
    ) -> AppResult<Self> {
        if collection.is_empty() || max_records == 0 || max_bytes == 0 {
            return Err(AppError::invalid_input(
                "Profile v2 chunk collection and limits must be non-empty",
            ));
        }
        Ok(Self {
            collection: collection.to_string(),
            zip,
            files: Vec::new(),
            current_path: None,
            current_records: 0,
            current_bytes: 0,
            current_hasher: Sha256::new(),
            total_records: 0,
            total_bytes: 0,
            max_records,
            max_bytes,
        })
    }

    pub(super) fn push(&mut self, value: &Value) -> AppResult<()> {
        let mut line = serde_json::to_vec(value)?;
        line.push(b'\n');
        let line_bytes = line.len() as u64;

        if self.current_records > 0
            && (self.current_records >= self.max_records
                || self.current_bytes.saturating_add(line_bytes) > self.max_bytes)
        {
            self.finalize_current();
        }
        if self.current_path.is_none() {
            self.start_chunk()?;
        }

        self.zip.write_all(&line)?;
        self.current_hasher.update(&line);
        self.current_records += 1;
        self.current_bytes += line_bytes;
        self.total_records += 1;
        self.total_bytes += line_bytes;
        Ok(())
    }

    pub(super) fn finish(mut self) -> AppResult<ProfileV2Table> {
        self.finalize_current();
        Ok(ProfileV2Table {
            name: self.collection,
            record_count: self.total_records,
            files: self.files,
            bytes: self.total_bytes,
            schema_version: PROFILE_V2_SCHEMA_VERSION,
            destructive_import_mode: PROFILE_V2_DESTRUCTIVE_MODE.to_string(),
        })
    }

    fn start_chunk(&mut self) -> AppResult<()> {
        let path = format!(
            "tables/{}/{:06}.jsonl",
            self.collection,
            self.files.len() + 1
        );
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        self.zip
            .start_file(&path, options)
            .map_err(profile_v2_zip_error)?;
        self.current_path = Some(path);
        Ok(())
    }

    fn finalize_current(&mut self) {
        let Some(path) = self.current_path.take() else {
            return;
        };
        let digest = self.current_hasher.finalize_reset();
        let sha256 = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.files.push(ProfileV2File {
            path,
            record_count: self.current_records,
            bytes: self.current_bytes,
            sha256,
        });
        self.current_records = 0;
        self.current_bytes = 0;
    }
}

fn profile_v2_zip_error(error: zip::result::ZipError) -> AppError {
    AppError::new("profile_v2_zip_error", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs::File;
    use std::io::Read;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::ZipArchive;

    fn temp_zip(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("profile-v2-chunks-{label}-{nonce}.zip"))
    }

    fn write_rows(path: &PathBuf, rows: &[Value]) -> (ProfileV2Table, Vec<u8>) {
        let file = File::create(path).expect("zip should create");
        let mut zip = zip::ZipWriter::new(file);
        let mut sink = TableChunkSink::with_limits("messages", &mut zip, 10, 1024)
            .expect("sink should create");
        for row in rows {
            sink.push(row).unwrap();
        }
        let table = sink.finish().unwrap();
        zip.finish().unwrap();
        let bytes = std::fs::read(path).unwrap();
        (table, bytes)
    }

    #[test]
    fn profile_v2_chunks_split_before_record_limit() {
        let path = temp_zip("records");
        let file = File::create(&path).expect("zip should create");
        let mut zip = zip::ZipWriter::new(file);
        let mut sink =
            TableChunkSink::with_limits("messages", &mut zip, 2, 1024).expect("sink should create");
        sink.push(&json!({ "id": "1" })).unwrap();
        sink.push(&json!({ "id": "2" })).unwrap();
        sink.push(&json!({ "id": "3" })).unwrap();
        let table = sink.finish().unwrap();
        zip.finish().unwrap();

        assert_eq!(table.record_count, 3);
        assert_eq!(table.files.len(), 2);
        assert_eq!(table.files[0].record_count, 2);
        assert_eq!(table.files[1].record_count, 1);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn profile_v2_chunks_emit_no_file_for_empty_table() {
        let path = temp_zip("empty");
        let file = File::create(&path).expect("zip should create");
        let mut zip = zip::ZipWriter::new(file);
        let sink =
            TableChunkSink::with_limits("messages", &mut zip, 2, 1024).expect("sink should create");
        let table = sink.finish().unwrap();
        zip.finish().unwrap();

        assert_eq!(table.record_count, 0);
        assert_eq!(table.bytes, 0);
        assert!(table.files.is_empty());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn profile_v2_chunks_end_every_record_with_newline() {
        let path = temp_zip("newline");
        let file = File::create(&path).expect("zip should create");
        let mut zip = zip::ZipWriter::new(file);
        let mut sink = TableChunkSink::with_limits("messages", &mut zip, 10, 1024)
            .expect("sink should create");
        sink.push(&json!({ "id": "1" })).unwrap();
        sink.push(&json!({ "id": "2" })).unwrap();
        sink.finish().unwrap();
        zip.finish().unwrap();

        let mut archive = ZipArchive::new(File::open(&path).unwrap()).unwrap();
        let mut entry = archive.by_name("tables/messages/000001.jsonl").unwrap();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        assert!(bytes.ends_with(b"\n"));
        assert_eq!(bytes.iter().filter(|byte| **byte == b'\n').count(), 2);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn profile_v2_chunks_split_before_byte_limit() {
        let path = temp_zip("bytes");
        let file = File::create(&path).expect("zip should create");
        let mut zip = zip::ZipWriter::new(file);
        let mut sink =
            TableChunkSink::with_limits("messages", &mut zip, 10, 15).expect("sink should create");
        sink.push(&json!({ "id": "1" })).unwrap();
        sink.push(&json!({ "id": "2" })).unwrap();
        let table = sink.finish().unwrap();
        zip.finish().unwrap();

        assert_eq!(table.files.len(), 2);
        assert_eq!(table.files[0].record_count, 1);
        assert_eq!(table.files[1].record_count, 1);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn profile_v2_chunks_keep_an_oversized_record_as_a_singleton() {
        let path = temp_zip("oversized");
        let file = File::create(&path).expect("zip should create");
        let mut zip = zip::ZipWriter::new(file);
        let mut sink =
            TableChunkSink::with_limits("messages", &mut zip, 10, 5).expect("sink should create");
        sink.push(&json!({ "id": "oversized" })).unwrap();
        sink.push(&json!({ "id": "next" })).unwrap();
        let table = sink.finish().unwrap();
        zip.finish().unwrap();

        assert_eq!(table.files.len(), 2);
        assert_eq!(table.files[0].record_count, 1);
        assert!(table.files[0].bytes > 5);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn profile_v2_chunks_are_deterministic_for_identical_rows() {
        let first_path = temp_zip("deterministic-first");
        let second_path = temp_zip("deterministic-second");
        let rows = [json!({ "id": "1" }), json!({ "id": "2" })];
        let (first_table, first_zip) = write_rows(&first_path, &rows);
        let (second_table, second_zip) = write_rows(&second_path, &rows);

        assert_eq!(first_table, second_table);
        assert_eq!(first_zip, second_zip);
        std::fs::remove_file(first_path).unwrap();
        std::fs::remove_file(second_path).unwrap();
    }
}
