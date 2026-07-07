use crate::cache::{collection_fast_stamp, CollectionFastStamp};
use crate::projection::{project_row, selected_nested_fields};
use marinara_core::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const DB_FILE_NAME: &str = "storage.sqlite3";
const CHAT_SUMMARIES_SCHEMA_VERSION: i64 = 1;
const CHAT_SUMMARIES_SOURCE_KEY: &str = "chat_summaries.source_stamp";
const CHAT_SUMMARIES_SCHEMA_KEY: &str = "chat_summaries.schema_version";

pub(crate) fn sqlite_storage_path(root: &Path) -> PathBuf {
    root.join(DB_FILE_NAME)
}

pub(crate) fn chat_summary_source_stamp(path: &Path) -> AppResult<Option<String>> {
    Ok(collection_fast_stamp(path)?.map(format_fast_stamp))
}

pub(crate) fn chat_summary_read_model_current(
    root: &Path,
    source_stamp: Option<&str>,
) -> AppResult<bool> {
    let Some(source_stamp) = source_stamp else {
        return Ok(false);
    };
    let path = sqlite_storage_path(root);
    if !path.exists() {
        return Ok(false);
    }
    let conn = open_chat_summary_connection(root)?;
    let stored_stamp = storage_meta_value(&conn, CHAT_SUMMARIES_SOURCE_KEY)?;
    Ok(stored_stamp.as_deref() == Some(source_stamp))
}

pub(crate) fn list_chat_summaries_from_read_model(
    root: &Path,
    fields: &[String],
    field_selections: &Map<String, Value>,
    descending: bool,
    limit: Option<usize>,
) -> AppResult<Vec<Value>> {
    let conn = open_chat_summary_connection(root)?;
    let direction = if descending { "DESC" } else { "ASC" };
    let sql = match limit {
        Some(_) => format!(
            "SELECT payload FROM chat_summaries ORDER BY updated_at {direction}, row_order ASC LIMIT ?1"
        ),
        None => format!(
            "SELECT payload FROM chat_summaries ORDER BY updated_at {direction}, row_order ASC"
        ),
    };
    let mut statement = conn.prepare(&sql).map_err(sqlite_error)?;
    let payloads = match limit {
        Some(limit) => statement
            .query_map(params![limit as i64], |row| row.get::<_, String>(0))
            .map_err(sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sqlite_error)?,
        None => statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sqlite_error)?,
    };
    let field_set = fields.iter().cloned().collect::<HashSet<_>>();
    let nested_field_sets = selected_nested_fields(field_selections);
    payloads
        .into_iter()
        .map(|payload| {
            let row = serde_json::from_str::<Value>(&payload)?;
            Ok(project_row(row, &field_set, &nested_field_sets))
        })
        .collect()
}

pub(crate) fn rebuild_chat_summary_read_model(
    root: &Path,
    source_stamp: Option<&str>,
    rows: &[Value],
) -> AppResult<()> {
    let Some(source_stamp) = source_stamp else {
        return remove_chat_summary_read_model(root);
    };
    let mut conn = open_chat_summary_connection(root)?;
    let tx = conn.transaction().map_err(sqlite_error)?;
    tx.execute("DELETE FROM chat_summaries", [])
        .map_err(sqlite_error)?;
    {
        let mut insert = tx
            .prepare(
                "INSERT OR REPLACE INTO chat_summaries \
                 (id, updated_at, created_at, row_order, payload) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .map_err(sqlite_error)?;
        for (index, row) in rows.iter().enumerate() {
            let Some(id) = row.get("id").and_then(Value::as_str) else {
                continue;
            };
            insert
                .execute(params![
                    id,
                    row.get("updatedAt").and_then(Value::as_str).unwrap_or(""),
                    row.get("createdAt").and_then(Value::as_str).unwrap_or(""),
                    index as i64,
                    serde_json::to_string(row)?,
                ])
                .map_err(sqlite_error)?;
        }
    }
    set_storage_meta_value(&tx, CHAT_SUMMARIES_SOURCE_KEY, source_stamp)?;
    set_storage_meta_value(
        &tx,
        CHAT_SUMMARIES_SCHEMA_KEY,
        &CHAT_SUMMARIES_SCHEMA_VERSION.to_string(),
    )?;
    tx.commit().map_err(sqlite_error)
}

pub(crate) fn remove_chat_summary_read_model(root: &Path) -> AppResult<()> {
    let path = sqlite_storage_path(root);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn open_chat_summary_connection(root: &Path) -> AppResult<Connection> {
    let path = sqlite_storage_path(root);
    match open_chat_summary_connection_once(&path) {
        Ok(conn) => Ok(conn),
        Err(first_error) => {
            let _ = fs::remove_file(&path);
            open_chat_summary_connection_once(&path).map_err(|second_error| {
                AppError::new(
                    "storage_sqlite_error",
                    format!(
                        "Could not open chat summary read model: {}; retry after rebuild failed: {}",
                        first_error.message, second_error.message
                    ),
                )
            })
        }
    }
}

fn open_chat_summary_connection_once(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path).map_err(sqlite_error)?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(sqlite_error)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(sqlite_error)?;
    ensure_chat_summary_schema(&conn)?;
    Ok(conn)
}

fn ensure_chat_summary_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS storage_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_summaries (
            id TEXT PRIMARY KEY,
            updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            row_order INTEGER NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_summaries_updated_at
            ON chat_summaries(updated_at, row_order);",
    )
    .map_err(sqlite_error)?;
    set_storage_meta_value(
        conn,
        CHAT_SUMMARIES_SCHEMA_KEY,
        &CHAT_SUMMARIES_SCHEMA_VERSION.to_string(),
    )
}

fn storage_meta_value(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM storage_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(sqlite_error)
}

fn set_storage_meta_value(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map(|_| ())
    .map_err(sqlite_error)
}

fn format_fast_stamp(stamp: CollectionFastStamp) -> String {
    format!(
        "{}:{}:{}",
        stamp.len, stamp.modified_nanos, stamp.sample_signature
    )
}

fn sqlite_error(error: rusqlite::Error) -> AppError {
    AppError::new("storage_sqlite_error", error.to_string())
}
