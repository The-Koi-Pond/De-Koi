use super::shared::{get_required, normalize_update_patch};
use crate::state::AppState;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose, Engine as _};
use marinara_core::{ensure_object, AppError, AppResult};
use rand::{rngs::SysRng, TryRng};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;

pub(crate) const API_KEY_MASK: &str = "••••••••";
const SECRET_VERSION: &str = "v1";
const MASTER_KEY_FILE: &str = "connection-master.key";

fn is_masked_api_key(value: &str) -> bool {
    value.trim() == API_KEY_MASK
}

fn has_stored_secret_value(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && !is_masked_api_key(value)
}

pub(crate) fn mask_connection_for_read(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let has_secret = object
        .get("apiKeyEncrypted")
        .and_then(Value::as_str)
        .is_some_and(has_stored_secret_value)
        || object
            .get("apiKey")
            .and_then(Value::as_str)
            .is_some_and(has_stored_secret_value);
    object.remove("apiKeyEncrypted");
    object.remove("apiKeyHash");
    object.remove("apiKeyMasked");
    object.insert("hasApiKey".to_string(), Value::Bool(has_secret));
    if has_secret {
        object.insert(
            "apiKey".to_string(),
            Value::String(API_KEY_MASK.to_string()),
        );
    } else {
        object.remove("apiKey");
    }
}

pub(crate) fn mask_connection_rows_for_read(rows: &mut [Value]) {
    for row in rows {
        mask_connection_for_read(row);
    }
}

pub(crate) fn prepare_connection_for_create(state: &AppState, value: Value) -> AppResult<Value> {
    let mut object = ensure_object(value)?;
    normalize_connection_secret_object(state, &mut object, true)?;
    Ok(Value::Object(object))
}

pub(crate) fn patch_connection(state: &AppState, id: &str, patch: Value) -> AppResult<Value> {
    let patch = ensure_object(patch)?;
    let updated =
        state
            .storage
            .patch_with("connections", id, Value::Object(patch), |object, patch| {
                let explicit_api_key = patch.contains_key("apiKey");
                normalize_connection_secret_object(state, object, explicit_api_key)
            })?;
    let mut masked = updated;
    mask_connection_for_read(&mut masked);
    Ok(masked)
}

pub(crate) fn save_default_parameters(
    state: &AppState,
    id: &str,
    params: Value,
) -> AppResult<Value> {
    if !params.is_object() && !params.is_null() {
        return Err(AppError::invalid_input(
            "defaultParameters must be a JSON object or null",
        ));
    }
    let patch = normalize_update_patch(
        "connections",
        json!({
            "defaultParameters": params,
        }),
    )?;
    patch_connection(state, id, patch)
}

pub(crate) fn connection_for_runtime(state: &AppState, id: &str) -> AppResult<Value> {
    let raw = get_required(state, "connections", id)?;
    materialize_connection_for_runtime(state, raw)
}

pub(crate) fn connections_for_runtime(state: &AppState) -> AppResult<Vec<Value>> {
    state
        .storage
        .list("connections")?
        .into_iter()
        .map(|row| materialize_connection_for_runtime(state, row))
        .collect()
}

pub(crate) fn connections_for_export(state: &AppState) -> AppResult<Vec<Value>> {
    state
        .storage
        .list("connections")?
        .into_iter()
        .map(|mut connection| {
            mask_connection_for_read(&mut connection);
            Ok(connection)
        })
        .collect()
}

pub(crate) fn materialize_connection_for_runtime(
    state: &AppState,
    mut connection: Value,
) -> AppResult<Value> {
    let Some(object) = connection.as_object_mut() else {
        return Ok(connection);
    };
    if let Some(secret) = object
        .get("apiKeyEncrypted")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if is_masked_api_key(secret) {
            object.remove("apiKeyEncrypted");
        } else {
            let api_key = decrypt_secret(state, secret)?;
            object.insert("apiKey".to_string(), Value::String(api_key));
            return Ok(connection);
        }
    }
    if object
        .get("apiKey")
        .and_then(Value::as_str)
        .is_some_and(is_masked_api_key)
    {
        object.remove("apiKey");
        return Ok(connection);
    }
    if let Some(api_key) = object
        .get("apiKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != API_KEY_MASK)
        .map(ToOwned::to_owned)
    {
        let connection_id = object
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        if let Some(connection_id) = connection_id {
            migrate_legacy_api_key(state, &connection_id, &api_key).ok();
        }
        object.insert("apiKey".to_string(), Value::String(api_key));
    }
    Ok(connection)
}

fn normalize_connection_secret_object(
    state: &AppState,
    object: &mut Map<String, Value>,
    explicit_api_key: bool,
) -> AppResult<()> {
    object.remove("apiKeyMasked");
    object.remove("hasApiKey");
    object.remove("apiKeyHash");
    if object
        .get("apiKeyEncrypted")
        .and_then(Value::as_str)
        .is_some_and(|value| !has_stored_secret_value(value))
    {
        object.remove("apiKeyEncrypted");
    }
    let provider = object
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let local_auth_provider = matches!(provider, "openai_chatgpt" | "claude_subscription");
    let api_key = object
        .get("apiKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToOwned::to_owned);

    if explicit_api_key {
        match api_key.as_deref() {
            Some(value) if !value.is_empty() && value != API_KEY_MASK => {
                object.insert(
                    "apiKeyEncrypted".to_string(),
                    Value::String(encrypt_secret(state, value)?),
                );
                object.remove("apiKey");
            }
            Some(_) if local_auth_provider => {
                object.remove("apiKey");
                object.remove("apiKeyEncrypted");
            }
            _ => {
                object.remove("apiKey");
            }
        }
        return Ok(());
    }

    if let Some(value) = api_key.as_deref().filter(|value| !value.is_empty()) {
        if value != API_KEY_MASK {
            object.insert(
                "apiKeyEncrypted".to_string(),
                Value::String(encrypt_secret(state, value)?),
            );
        }
        object.remove("apiKey");
    }
    Ok(())
}

fn migrate_legacy_api_key(state: &AppState, id: &str, api_key: &str) -> AppResult<()> {
    state
        .storage
        .patch_with("connections", id, json!({}), |object, _| {
            if object
                .get("apiKeyEncrypted")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
            {
                object.remove("apiKey");
                return Ok(());
            }
            object.insert(
                "apiKeyEncrypted".to_string(),
                Value::String(encrypt_secret(state, api_key)?),
            );
            object.remove("apiKey");
            Ok(())
        })
        .map(|_| ())
}

pub(crate) fn encrypt_secret(state: &AppState, value: &str) -> AppResult<String> {
    let key = master_key(state)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| AppError::new("connection_secret_error", "Invalid connection secret key"))?;
    let mut nonce = [0u8; 12];
    SysRng.try_fill_bytes(&mut nonce).map_err(|_| {
        AppError::new(
            "connection_secret_error",
            "Failed to generate encryption nonce",
        )
    })?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
        .map_err(|_| AppError::new("connection_secret_error", "Failed to encrypt secret"))?;
    Ok(format!(
        "{SECRET_VERSION}:{}:{}",
        general_purpose::STANDARD_NO_PAD.encode(nonce),
        general_purpose::STANDARD_NO_PAD.encode(ciphertext)
    ))
}

pub(crate) fn decrypt_secret(state: &AppState, value: &str) -> AppResult<String> {
    let mut parts = value.split(':');
    let version = parts.next().unwrap_or_default();
    let nonce = parts.next().unwrap_or_default();
    let ciphertext = parts.next().unwrap_or_default();
    if version != SECRET_VERSION || parts.next().is_some() {
        return Err(decrypt_error());
    }
    let nonce = general_purpose::STANDARD_NO_PAD
        .decode(nonce)
        .map_err(|_| decrypt_error())?;
    let ciphertext = general_purpose::STANDARD_NO_PAD
        .decode(ciphertext)
        .map_err(|_| decrypt_error())?;
    if nonce.len() != 12 {
        return Err(decrypt_error());
    }
    let key = master_key(state)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| AppError::new("connection_secret_error", "Invalid connection secret key"))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| decrypt_error())?;
    String::from_utf8(plaintext).map_err(|_| decrypt_error())
}

fn decrypt_error() -> AppError {
    AppError::new(
        "connection_secret_error",
        "Stored secret could not be decrypted. Re-enter the credential.",
    )
}

fn master_key(state: &AppState) -> AppResult<[u8; 32]> {
    let dir = state.data_dir.join("secrets");
    fs::create_dir_all(&dir)?;
    harden_secret_directory_permissions(&dir)?;
    let path = dir.join(MASTER_KEY_FILE);
    if path.exists() {
        harden_master_key_permissions(&path)?;
        let encoded = fs::read_to_string(&path)?;
        let decoded = general_purpose::STANDARD_NO_PAD
            .decode(encoded.trim())
            .map_err(|_| {
                AppError::new(
                    "connection_secret_error",
                    "Connection secret key is invalid",
                )
            })?;
        return key_from_bytes(&decoded);
    }
    let mut key = [0u8; 32];
    SysRng.try_fill_bytes(&mut key).map_err(|_| {
        AppError::new(
            "connection_secret_error",
            "Failed to generate connection secret key",
        )
    })?;
    let encoded = general_purpose::STANDARD_NO_PAD.encode(key);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(owner_only_file_mode());
    }
    let mut file = options.open(&path)?;
    file.write_all(encoded.as_bytes())?;
    file.sync_all()?;
    harden_master_key_permissions(&path)?;
    Ok(key)
}

#[cfg(any(unix, test))]
const fn owner_only_file_mode() -> u32 {
    0o600
}

#[cfg(unix)]
fn harden_secret_directory_permissions(path: &std::path::Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(AppError::from)
}

#[cfg(not(unix))]
fn harden_secret_directory_permissions(_path: &std::path::Path) -> AppResult<()> {
    Ok(())
}

#[cfg(unix)]
fn harden_master_key_permissions(path: &std::path::Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(owner_only_file_mode()))
        .map_err(AppError::from)
}

#[cfg(not(unix))]
fn harden_master_key_permissions(_path: &std::path::Path) -> AppResult<()> {
    Ok(())
}

fn key_from_bytes(bytes: &[u8]) -> AppResult<[u8; 32]> {
    if bytes.len() == 32 {
        let mut key = [0u8; 32];
        key.copy_from_slice(bytes);
        return Ok(key);
    }
    let hash = Sha256::digest(bytes);
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> (AppState, std::path::PathBuf) {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("de-koi-{label}-{}-{suffix}", std::process::id()));
        let state =
            AppState::from_data_dir(&root, Vec::new()).expect("test state should initialize");
        (state, root)
    }

    #[test]
    fn connection_secret_round_trip_preserves_existing_ciphertext_contract() {
        let (state, root) = test_state("secret-round-trip");
        let encrypted = encrypt_secret(&state, "provider-secret").expect("secret should encrypt");

        assert!(encrypted.starts_with("v1:"));
        assert_eq!(
            decrypt_secret(&state, &encrypted).expect("secret should decrypt"),
            "provider-secret"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn master_key_owner_only_mode_is_restrictive() {
        assert_eq!(owner_only_file_mode(), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn existing_master_key_permissions_are_hardened_when_loaded() {
        use std::os::unix::fs::PermissionsExt;

        let (state, root) = test_state("secret-permissions");
        encrypt_secret(&state, "first").expect("master key should be created");
        let key_path = state.data_dir.join("secrets").join(MASTER_KEY_FILE);
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o644))
            .expect("test should broaden key permissions");

        encrypt_secret(&state, "second").expect("existing master key should load");

        let mode = std::fs::metadata(&key_path)
            .expect("key metadata should load")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_dir_all(root);
    }
}
