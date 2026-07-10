use crate::{
    cleanup_pending_collection_transaction_files,
    cleanup_pending_collection_transaction_files_checked, collection_content_stamp,
    collection_transaction_path, mark_collection_transaction_committed,
    recover_pending_collection_transactions, refresh_collection_backup,
    remove_collection_transaction_manifest, remove_path_if_exists,
    rollback_collection_replacements, storage_transaction_id, sync_directory, sync_file,
    write_prepared_collection_transaction_manifest, FileStorage, PendingCollectionReplacement,
};
use marinara_core::{AppError, AppResult};
use serde::de::{Error as _, SeqAccess, Visitor};
use serde::Deserializer as _;
use serde_json::Value;
use std::fmt;
use std::fs;
use std::io::{BufReader, BufWriter, Write};

#[derive(Debug, Eq, PartialEq)]
pub struct StreamingTransformReport {
    pub input_records: usize,
    pub output_records: usize,
    pub changed_records: usize,
}

struct TransformVisitor<'a, F, W> {
    transform: &'a mut F,
    writer: &'a mut W,
    transform_error: &'a mut Option<AppError>,
}

impl<'de, F, W> Visitor<'de> for TransformVisitor<'_, F, W>
where
    F: FnMut(usize, &mut Value) -> AppResult<bool>,
    W: Write,
{
    type Value = StreamingTransformReport;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        self.writer.write_all(b"[\n").map_err(A::Error::custom)?;
        let mut report = StreamingTransformReport {
            input_records: 0,
            output_records: 0,
            changed_records: 0,
        };
        while let Some(mut row) = seq.next_element::<Value>()? {
            let index = report.input_records;
            report.input_records += 1;
            let changed = match (self.transform)(index, &mut row) {
                Ok(changed) => changed,
                Err(error) => {
                    *self.transform_error = Some(error);
                    return Err(A::Error::custom("collection record transform failed"));
                }
            };
            if report.output_records > 0 {
                self.writer.write_all(b",\n").map_err(A::Error::custom)?;
            }
            serde_json::to_writer(&mut *self.writer, &row).map_err(A::Error::custom)?;
            report.output_records += 1;
            report.changed_records += usize::from(changed);
        }
        self.writer.write_all(b"\n]\n").map_err(A::Error::custom)?;
        Ok(report)
    }
}

fn transform_json_array<R, W, F>(
    reader: R,
    writer: &mut W,
    transform: &mut F,
) -> AppResult<StreamingTransformReport>
where
    R: std::io::Read,
    W: Write,
    F: FnMut(usize, &mut Value) -> AppResult<bool>,
{
    let mut transform_error = None;
    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    let result = (&mut deserializer).deserialize_seq(TransformVisitor {
        transform,
        writer,
        transform_error: &mut transform_error,
    });
    if let Some(error) = transform_error {
        return Err(error);
    }
    let report = result?;
    deserializer.end()?;
    Ok(report)
}

struct ValidateVisitor<'a, V> {
    validate: &'a mut V,
    validation_error: &'a mut Option<AppError>,
}

impl<'de, V> Visitor<'de> for ValidateVisitor<'_, V>
where
    V: FnMut(usize, &Value) -> AppResult<()>,
{
    type Value = usize;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut count = 0;
        while let Some(row) = seq.next_element::<Value>()? {
            if let Err(error) = (self.validate)(count, &row) {
                *self.validation_error = Some(error);
                return Err(A::Error::custom("collection record validation failed"));
            }
            count += 1;
        }
        Ok(count)
    }
}

fn validate_json_array_file<V>(path: &std::path::Path, validate: &mut V) -> AppResult<usize>
where
    V: FnMut(usize, &Value) -> AppResult<()>,
{
    let reader = BufReader::new(fs::File::open(path)?);
    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    let mut validation_error = None;
    let result = (&mut deserializer).deserialize_seq(ValidateVisitor {
        validate,
        validation_error: &mut validation_error,
    });
    if let Some(error) = validation_error {
        return Err(error);
    }
    let count = result?;
    deserializer.end()?;
    Ok(count)
}

impl FileStorage {
    pub fn visit_collection_streaming<V>(&self, collection: &str, mut visit: V) -> AppResult<usize>
    where
        V: FnMut(usize, &Value) -> AppResult<()>,
    {
        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.flush_dirty_collections_locked()?;
        let path = self.collection_path(collection)?;
        if !path.exists() {
            return Ok(0);
        }
        validate_json_array_file(&path, &mut visit)
    }

    pub fn transform_collection_streaming<F, V>(
        &self,
        collection: &str,
        migration_suffix: &str,
        mut transform: F,
        mut validate: V,
    ) -> AppResult<StreamingTransformReport>
    where
        F: FnMut(usize, &mut Value) -> AppResult<bool>,
        V: FnMut(usize, &Value) -> AppResult<()>,
    {
        if migration_suffix.is_empty()
            || !migration_suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(AppError::invalid_input("Invalid migration suffix"));
        }

        let _write_permit = self.write_gate.begin_write()?;
        let _guard = self
            .lock
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage lock poisoned"))?;
        self.flush_dirty_collections_locked()?;

        let path = self.collection_path(collection)?;
        if !path.exists() {
            return Ok(StreamingTransformReport {
                input_records: 0,
                output_records: 0,
                changed_records: 0,
            });
        }
        let source_stamp = collection_content_stamp(&path)?;
        let transaction_id = format!("{}-{migration_suffix}", storage_transaction_id());
        let tmp = collection_transaction_path(&path, &transaction_id, 0, "tmp")?;
        let backup = collection_transaction_path(&path, &transaction_id, 0, "backup")?;
        let collections_dir = path
            .parent()
            .ok_or_else(|| AppError::invalid_input("Collection path has no parent"))?;
        remove_path_if_exists(&tmp)?;

        let transform_result = (|| -> AppResult<StreamingTransformReport> {
            let reader = BufReader::new(fs::File::open(&path)?);
            let mut writer = BufWriter::new(fs::File::create(&tmp)?);
            let report = transform_json_array(reader, &mut writer, &mut transform)?;
            writer.flush()?;
            drop(writer);
            sync_file(&tmp)?;
            let validated_records = validate_json_array_file(&tmp, &mut validate)?;
            if validated_records != report.output_records
                || report.input_records != report.output_records
            {
                return Err(AppError::new(
                    "streaming_transform_validation_failed",
                    "Transformed collection record count did not match the source",
                ));
            }
            if collection_content_stamp(&path)? != source_stamp {
                let mut cache = self
                    .cache
                    .write()
                    .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
                cache.collections.remove(collection);
                cache.id_indexes.remove(collection);
                cache
                    .projected_lists
                    .retain(|key, _| key.collection != collection);
                return Err(AppError::new(
                    "storage_source_changed",
                    "Collection changed while streaming transformation was running",
                ));
            }
            Ok(report)
        })();

        let report = match transform_result {
            Ok(report) => report,
            Err(error) => {
                let _ = remove_path_if_exists(&tmp);
                return Err(error);
            }
        };
        if report.changed_records == 0 {
            remove_path_if_exists(&tmp)?;
            return Ok(report);
        }

        let pending = vec![PendingCollectionReplacement {
            path: path.clone(),
            tmp,
            backup,
            existed: true,
        }];
        let manifest_path = match write_prepared_collection_transaction_manifest(
            collections_dir,
            &transaction_id,
            &pending,
        ) {
            Ok(path) => path,
            Err(error) => {
                cleanup_pending_collection_transaction_files(&pending);
                return Err(error);
            }
        };
        let mut backed_up = Vec::new();
        let mut installed = Vec::new();
        let install_result = (|| -> AppResult<()> {
            refresh_collection_backup(&path)?;
            fs::rename(&path, &pending[0].backup)?;
            backed_up.push(0);
            fs::rename(&pending[0].tmp, &path)?;
            installed.push(0);
            sync_directory(collections_dir)
        })();
        if let Err(error) = install_result {
            if let Err(rollback_error) =
                rollback_collection_replacements(&pending, &backed_up, &installed)
            {
                cleanup_pending_collection_transaction_files(&pending);
                return Err(AppError::new(
                    "storage_rollback_failed",
                    format!(
                        "{error}; additionally failed to roll back streaming transformation: {rollback_error}"
                    ),
                ));
            }
            cleanup_pending_collection_transaction_files(&pending);
            remove_collection_transaction_manifest(&manifest_path)?;
            return Err(error);
        }
        if let Err(error) = mark_collection_transaction_committed(&manifest_path) {
            recover_pending_collection_transactions(collections_dir)?;
            return Err(error);
        }
        if cleanup_pending_collection_transaction_files_checked(&pending).is_ok() {
            remove_collection_transaction_manifest(&manifest_path)?;
        }

        let mut cache = self
            .cache
            .write()
            .map_err(|_| AppError::new("lock_error", "Storage cache lock poisoned"))?;
        cache.collections.remove(collection);
        cache.id_indexes.remove(collection);
        cache
            .projected_lists
            .retain(|key, _| key.collection != collection);
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use crate::FileStorage;
    use marinara_core::AppError;
    use serde_json::json;
    use std::fs;

    fn temp_storage_root(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should follow the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "marinara-storage-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("temporary storage root should be created");
        root
    }

    #[test]
    fn streaming_transform_preserves_original_on_mid_record_failure() {
        let root = temp_storage_root("stream-transform-failure");
        let storage = FileStorage::new(&root).expect("storage should initialize");
        storage
            .replace_all(
                "character-versions",
                vec![
                    json!({"id":"v1","payload":"a".repeat(4096)}),
                    json!({"id":"v2","payload":"b".repeat(4096)}),
                    json!({"id":"v3","payload":"c".repeat(4096)}),
                ],
            )
            .expect("fixture should persist");
        let collection = root.join("collections/character-versions.json");
        let before = fs::read(&collection).expect("fixture should be readable");

        let error = storage
            .transform_collection_streaming(
                "character-versions",
                "inline-media-v2",
                |index, _row| {
                    if index == 1 {
                        return Err(AppError::new("forced_failure", "stop"));
                    }
                    Ok(false)
                },
                |_index, _row| Ok(()),
            )
            .expect_err("transform should fail");

        assert_eq!(error.code, "forced_failure");
        assert_eq!(
            fs::read(&collection).expect("original should remain readable"),
            before
        );
        assert!(!collection
            .with_extension("json.inline-media-v2.tmp")
            .exists());

        fs::remove_dir_all(root).expect("temporary storage root should clean up");
    }

    #[test]
    fn streaming_transform_installs_changed_rows_and_reports_counts() {
        let root = temp_storage_root("stream-transform-success");
        let storage = FileStorage::new(&root).expect("storage should initialize");
        storage
            .replace_all(
                "character-versions",
                vec![json!({"id":"v1","avatar":"inline"}), json!({"id":"v2"})],
            )
            .expect("fixture should persist");

        let report = storage
            .transform_collection_streaming(
                "character-versions",
                "inline-media-v2",
                |_index, row| {
                    if row.get("avatar").is_some() {
                        row["avatar"] = json!("managed");
                        return Ok(true);
                    }
                    Ok(false)
                },
                |_index, _row| Ok(()),
            )
            .expect("transform should succeed");

        assert_eq!(report.input_records, 2);
        assert_eq!(report.output_records, 2);
        assert_eq!(report.changed_records, 1);
        assert_eq!(
            storage.list("character-versions").unwrap()[0]["avatar"],
            "managed"
        );
        fs::remove_dir_all(root).expect("temporary storage root should clean up");
    }

    #[test]
    fn streaming_transform_preserves_original_when_output_validation_fails() {
        let root = temp_storage_root("stream-transform-validation");
        let storage = FileStorage::new(&root).expect("storage should initialize");
        storage
            .replace_all(
                "character-versions",
                vec![json!({"id":"v1","avatar":"inline"})],
            )
            .expect("fixture should persist");
        let collection = root.join("collections/character-versions.json");
        let before = fs::read(&collection).expect("fixture should be readable");

        let error = storage
            .transform_collection_streaming(
                "character-versions",
                "inline-media-v2",
                |_index, row| {
                    row["avatar"] = json!("managed-outside-root");
                    Ok(true)
                },
                |_index, _row| {
                    Err(AppError::new(
                        "forced_validation_failure",
                        "managed path escaped",
                    ))
                },
            )
            .expect_err("validation should fail");

        assert_eq!(error.code, "forced_validation_failure");
        assert_eq!(fs::read(collection).unwrap(), before);
        fs::remove_dir_all(root).expect("temporary storage root should clean up");
    }

    #[test]
    fn streaming_transform_skips_install_when_no_rows_change() {
        let root = temp_storage_root("stream-transform-noop");
        let storage = FileStorage::new(&root).expect("storage should initialize");
        storage
            .replace_all("character-versions", vec![json!({"id":"v1"})])
            .expect("fixture should persist");
        let collection = root.join("collections/character-versions.json");
        let before = fs::read(&collection).expect("fixture should be readable");

        let report = storage
            .transform_collection_streaming(
                "character-versions",
                "inline-media-v2",
                |_index, _row| Ok(false),
                |_index, _row| Ok(()),
            )
            .expect("no-op transform should succeed");

        assert_eq!(report.changed_records, 0);
        assert_eq!(fs::read(collection).unwrap(), before);
        fs::remove_dir_all(root).expect("temporary storage root should clean up");
    }

    #[test]
    fn streaming_transform_invalidates_a_preexisting_full_row_cache() {
        let root = temp_storage_root("stream-transform-cache");
        let storage = FileStorage::new(&root).expect("storage should initialize");
        storage
            .replace_all(
                "character-versions",
                vec![json!({"id":"v1","avatar":"inline"})],
            )
            .expect("fixture should persist");
        assert_eq!(
            storage.list("character-versions").unwrap()[0]["avatar"],
            "inline"
        );

        storage
            .transform_collection_streaming(
                "character-versions",
                "inline-media-v2",
                |_index, row| {
                    row["avatar"] = json!("managed");
                    Ok(true)
                },
                |_index, _row| Ok(()),
            )
            .expect("transform should succeed");

        assert_eq!(
            storage.list("character-versions").unwrap()[0]["avatar"],
            "managed"
        );
        fs::remove_dir_all(root).expect("temporary storage root should clean up");
    }

    #[test]
    fn streaming_transform_rejects_an_unsafe_suffix() {
        let root = temp_storage_root("stream-transform-suffix");
        let storage = FileStorage::new(&root).expect("storage should initialize");
        let error = storage
            .transform_collection_streaming(
                "character-versions",
                "../escape",
                |_index, _row| Ok(false),
                |_index, _row| Ok(()),
            )
            .expect_err("unsafe suffix should fail");
        assert_eq!(error.code, "invalid_input");
        fs::remove_dir_all(root).expect("temporary storage root should clean up");
    }

    #[test]
    fn streaming_transform_rejects_a_source_changed_during_transform() {
        let root = temp_storage_root("stream-transform-source-change");
        let storage = FileStorage::new(&root).expect("storage should initialize");
        storage
            .replace_all("character-versions", vec![json!({"id":"v1"})])
            .expect("fixture should persist");
        let collection = root.join("collections/character-versions.json");
        let changed_collection = collection.clone();

        let error = storage
            .transform_collection_streaming(
                "character-versions",
                "inline-media-v2",
                move |_index, row| {
                    fs::write(&changed_collection, b"[{\"id\":\"external\"}]")?;
                    row["changed"] = json!(true);
                    Ok(true)
                },
                |_index, _row| Ok(()),
            )
            .expect_err("source change should fail");

        assert_eq!(error.code, "storage_source_changed");
        assert_eq!(
            storage.list("character-versions").unwrap()[0]["id"],
            "external"
        );
        fs::remove_dir_all(root).expect("temporary storage root should clean up");
    }
}
