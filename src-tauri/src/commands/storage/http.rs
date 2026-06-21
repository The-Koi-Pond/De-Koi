use super::shared::*;
use super::*;
use marinara_security::{is_allowed_outbound_url, is_local_or_reserved_ip};
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_BINARY_RESPONSE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_BINARY_REDIRECTS: usize = 5;

pub(crate) async fn http_json(url: &str) -> AppResult<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| AppError::new("http_client_error", error.to_string()))?;
    let response = client
        .get(url)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|error| AppError::new("upstream_request_failed", error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(AppError::with_details(
            "upstream_request_failed",
            format!("Upstream returned {status}"),
            json!({ "body": text.chars().take(500).collect::<String>() }),
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| AppError::new("upstream_json_error", error.to_string()))
}

pub(crate) async fn http_binary(url: &str, fallback_mime: &str) -> AppResult<Value> {
    // http_binary fetches content-supplied URLs (avatar/background/image references from
    // imported cards and lorebooks), so it is an SSRF sink. Three guards apply on every
    // hop: (1) the host must pass the internal-host/IMDS allow-list, (2) the resolved IPs
    // must not be local/reserved (defeats DNS rebinding) and are pinned via resolve_to_addrs,
    // and (3) redirects are followed manually with Policy::none so each Location is
    // re-validated rather than blindly chased into 169.254.169.254. Managed local assets are
    // resolved by load_local_asset_binary (asset://localhost) before this is ever reached.
    let mut current_url = validate_binary_fetch_url(url)?;
    for redirects_followed in 0..=MAX_BINARY_REDIRECTS {
        let response = send_binary_fetch_request(&current_url).await?;
        if response.status().is_redirection()
            && response.headers().contains_key(reqwest::header::LOCATION)
        {
            if redirects_followed == MAX_BINARY_REDIRECTS {
                return Err(AppError::invalid_input(
                    "Remote URL exceeded redirect limit",
                ));
            }
            current_url = redirected_binary_fetch_url(&current_url, &response)?;
            continue;
        }
        return finalize_binary_response(response, fallback_mime).await;
    }
    Err(AppError::invalid_input(
        "Remote URL exceeded redirect limit",
    ))
}

/// Parse and SSRF-screen a URL before fetching. Rejects local/reserved hosts (IMDS,
/// localhost, private ranges) via the security allow-list.
fn validate_binary_fetch_url(url: &str) -> AppResult<reqwest::Url> {
    if !is_allowed_outbound_url(url, false) {
        return Err(AppError::invalid_input(format!(
            "Outbound URL is not allowed: {url}"
        )));
    }
    reqwest::Url::parse(url)
        .map_err(|error| AppError::invalid_input(format!("Remote URL is invalid: {error}")))
}

/// Resolve and re-validate a redirect's Location header (relative or absolute) against the
/// same SSRF guard, so a public host can't 302 the fetch into a reserved address.
fn redirected_binary_fetch_url(
    current_url: &reqwest::Url,
    response: &reqwest::Response,
) -> AppResult<reqwest::Url> {
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .ok_or_else(|| AppError::invalid_input("Remote redirect is missing a Location header"))?
        .to_str()
        .map_err(|error| {
            AppError::invalid_input(format!("Remote redirect Location is invalid: {error}"))
        })?;
    validate_redirected_binary_fetch_url(current_url, location)
}

fn validate_redirected_binary_fetch_url(
    current_url: &reqwest::Url,
    location: &str,
) -> AppResult<reqwest::Url> {
    let redirected = current_url.join(location).map_err(|error| {
        AppError::invalid_input(format!("Remote redirect URL is invalid: {error}"))
    })?;
    validate_binary_fetch_url(redirected.as_str())
}

async fn send_binary_fetch_request(url: &reqwest::Url) -> AppResult<reqwest::Response> {
    let resolved_addresses = binary_fetch_resolved_addresses(url).await?;
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none());
    if let (Some(host), Some(addresses)) = (url.host_str(), resolved_addresses.as_deref()) {
        client_builder = client_builder.resolve_to_addrs(host, addresses);
    }
    client_builder
        .build()
        .map_err(|error| AppError::new("http_client_error", error.to_string()))?
        .get(url.clone())
        .send()
        .await
        .map_err(|error| AppError::new("upstream_request_failed", error.to_string()))
}

/// Resolve a hostname and reject (then pin) it so a public-looking name can't rebind to a
/// reserved IP between the allow-list check and the connect. IP-literal hosts are already
/// screened by validate_binary_fetch_url, so they need no pinning.
async fn binary_fetch_resolved_addresses(
    url: &reqwest::Url,
) -> AppResult<Option<Vec<std::net::SocketAddr>>> {
    let Some(host) = url.host_str() else {
        return Err(AppError::invalid_input("Remote URL is missing a hostname"));
    };
    if binary_fetch_host_ip(host).is_some() {
        return Ok(None);
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| {
            AppError::invalid_input(format!("Remote host '{host}' did not resolve: {error}"))
        })?;
    let mut resolved = Vec::new();
    for address in addresses {
        if is_local_or_reserved_ip(address.ip()) {
            return Err(AppError::invalid_input(format!(
                "Remote URL resolves to a local, private, or reserved address: {url}"
            )));
        }
        resolved.push(address);
    }
    if resolved.is_empty() {
        return Err(AppError::invalid_input(format!(
            "Remote host '{host}' did not resolve"
        )));
    }
    Ok(Some(resolved))
}

fn binary_fetch_host_ip(host: &str) -> Option<std::net::IpAddr> {
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    unbracketed.parse::<std::net::IpAddr>().ok()
}

async fn finalize_binary_response(
    response: reqwest::Response,
    fallback_mime: &str,
) -> AppResult<Value> {
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::new(
            "upstream_request_failed",
            format!("Upstream returned {status}"),
        ));
    }
    let mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or(fallback_mime)
        .to_string();
    let normalized_mime = mime_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !allowed_binary_mime(&normalized_mime) {
        return Err(AppError::invalid_input(format!(
            "Unsupported remote content type: {mime_type}"
        )));
    }
    if response.content_length().unwrap_or(0) > MAX_BINARY_RESPONSE_BYTES {
        return Err(AppError::invalid_input("Remote file is too large"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| AppError::new("upstream_body_error", error.to_string()))?;
    if bytes.len() as u64 > MAX_BINARY_RESPONSE_BYTES {
        return Err(AppError::invalid_input("Remote file is too large"));
    }
    Ok(json!({
        "base64": general_purpose::STANDARD.encode(bytes),
        "mimeType": mime_type
    }))
}

fn allowed_binary_mime(mime_type: &str) -> bool {
    mime_type.starts_with("image/")
        || mime_type.starts_with("audio/")
        || mime_type.starts_with("video/")
        || matches!(
            mime_type,
            "application/octet-stream" | "binary/octet-stream"
        )
}

pub(crate) async fn load_url_binary_for_state(
    state: &AppState,
    url: &str,
    fallback_mime: &str,
) -> AppResult<Value> {
    if let Some(response) = load_local_asset_binary(state, url, fallback_mime)? {
        return Ok(response);
    }
    http_binary(url, fallback_mime).await
}

fn load_local_asset_binary(
    state: &AppState,
    url: &str,
    fallback_mime: &str,
) -> AppResult<Option<Value>> {
    let Some(path) = local_asset_path_from_url(url) else {
        return Ok(None);
    };
    let canonical_path = std::fs::canonicalize(&path).map_err(|error| {
        AppError::new(
            "local_asset_not_found",
            format!("Managed local asset could not be read: {error}"),
        )
    })?;
    let data_dir = std::fs::canonicalize(&state.data_dir).map_err(AppError::from)?;
    if !canonical_path.starts_with(&data_dir) {
        return Err(AppError::invalid_input(
            "Managed local asset URL is outside the app data directory",
        ));
    }
    if !is_managed_local_binary_asset(&data_dir, &canonical_path) {
        return Err(AppError::invalid_input(
            "Managed local asset URL is outside allowed media directories",
        ));
    }

    let expected_handle = validated_local_binary_asset_handle(&canonical_path)?;
    let file = open_local_binary_file(&canonical_path).map_err(AppError::from)?;
    let metadata = validate_opened_local_binary_file(&file, &expected_handle)?;
    if metadata.len() > MAX_BINARY_RESPONSE_BYTES {
        return Err(AppError::invalid_input("Local asset file is too large"));
    }

    let mut bytes = Vec::new();
    let mut reader = file.take(MAX_BINARY_RESPONSE_BYTES + 1);
    reader.read_to_end(&mut bytes).map_err(AppError::from)?;
    if bytes.len() as u64 > MAX_BINARY_RESPONSE_BYTES {
        return Err(AppError::invalid_input("Local asset file is too large"));
    }

    Ok(Some(json!({
        "base64": general_purpose::STANDARD.encode(bytes),
        "mimeType": local_binary_mime_type(&canonical_path, fallback_mime)
    })))
}

fn open_local_binary_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    configure_no_follow_open(&mut options);
    options.open(path)
}

fn validated_local_binary_asset_handle(canonical_path: &Path) -> AppResult<same_file::Handle> {
    same_file::Handle::from_path(canonical_path).map_err(AppError::from)
}

fn validate_opened_local_binary_file(
    file: &File,
    expected_handle: &same_file::Handle,
) -> AppResult<std::fs::Metadata> {
    let file_handle = same_file::Handle::from_file(file.try_clone().map_err(AppError::from)?)
        .map_err(AppError::from)?;
    if &file_handle != expected_handle {
        return Err(AppError::invalid_input(
            "Managed local asset changed before it could be read",
        ));
    }
    let metadata = file.metadata().map_err(AppError::from)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::invalid_input(
            "Managed local asset URL does not point to a file",
        ));
    }
    Ok(metadata)
}

#[cfg(unix)]
fn configure_no_follow_open(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;

    options.custom_flags(libc::O_NOFOLLOW);
}

#[cfg(windows)]
fn configure_no_follow_open(options: &mut OpenOptions) {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
}

#[cfg(not(any(unix, windows)))]
fn configure_no_follow_open(_options: &mut OpenOptions) {}

fn local_asset_path_from_url(url: &str) -> Option<PathBuf> {
    let trimmed = url.trim();
    let encoded = trimmed
        .strip_prefix("asset://localhost/")
        .or_else(|| trimmed.strip_prefix("http://asset.localhost/"))?;
    let encoded = encoded
        .split(['?', '#'])
        .next()
        .filter(|value| !value.is_empty())?;
    if !local_asset_url_path_shape_is_allowed(encoded) {
        return None;
    }
    Some(PathBuf::from(percent_decode(encoded)))
}

fn local_asset_url_path_shape_is_allowed(encoded: &str) -> bool {
    let decoded = percent_decode(encoded);
    if decoded.contains('\0') || decoded_path_has_dot_segment(&decoded) {
        return false;
    }
    if !encoded.contains('/') {
        return Path::new(&decoded).is_absolute();
    }
    encoded.split('/').all(|segment| {
        let decoded = percent_decode(segment);
        !decoded.is_empty()
            && !matches!(decoded.as_str(), "." | "..")
            && !decoded.contains(['/', '\\'])
    })
}

fn decoded_path_has_dot_segment(decoded: &str) -> bool {
    Path::new(decoded).components().any(|component| {
        matches!(
            component,
            std::path::Component::CurDir | std::path::Component::ParentDir
        )
    })
}

fn local_binary_mime_type(path: &Path, fallback_mime: &str) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        _ => fallback_mime,
    }
    .to_string()
}

fn is_managed_local_binary_asset(data_dir: &Path, path: &Path) -> bool {
    const LOCAL_BINARY_ASSET_DIRS: &[&str] = &[
        "avatars",
        "backgrounds",
        "fonts",
        "gallery",
        "game-assets",
        "knowledge-sources",
        "lorebooks/images",
        "sprites",
    ];

    LOCAL_BINARY_ASSET_DIRS.iter().any(|asset_dir| {
        std::fs::canonicalize(data_dir.join(asset_dir))
            .ok()
            .is_some_and(|allowed_root| path.starts_with(allowed_root))
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                if let (Some(hi), Some(lo)) =
                    (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
                {
                    output.push((hi << 4) | lo);
                    index += 3;
                } else {
                    output.push(bytes[index]);
                    index += 1;
                }
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&output).to_string()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
pub(crate) async fn gifs_search(route: &ParsedPath) -> AppResult<Value> {
    let api_key = std::env::var("GIPHY_API_KEY")
        .or_else(|_| std::env::var("VITE_GIPHY_API_KEY"))
        .map_err(|_| {
            AppError::new(
                "external_service_unavailable",
                "GIF search requires GIPHY_API_KEY",
            )
        })?;
    let query = route.query.get("q").cloned().unwrap_or_default();
    let limit = route
        .query
        .get("limit")
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(20)
        .min(50);
    let offset = route
        .query
        .get("pos")
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    let endpoint = if query.trim().is_empty() {
        "trending"
    } else {
        "search"
    };
    let client = reqwest::Client::new();
    let mut request = client
        .get(format!("https://api.giphy.com/v1/gifs/{endpoint}"))
        .query(&[
            ("api_key", api_key.as_str()),
            ("limit", &limit.to_string()),
            ("offset", &offset.to_string()),
            ("rating", "r"),
        ]);
    if !query.trim().is_empty() {
        request = request.query(&[("q", query.as_str())]);
    }
    let data = request
        .send()
        .await
        .map_err(|error| AppError::new("gif_request_failed", error.to_string()))?
        .json::<Value>()
        .await
        .map_err(|error| AppError::new("gif_response_error", error.to_string()))?;
    let items = data
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let pagination = data.get("pagination").cloned().unwrap_or_else(|| json!({}));
    let current_offset = pagination
        .get("offset")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let count = pagination.get("count").and_then(Value::as_u64).unwrap_or(0);
    let total = pagination
        .get("total_count")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let next_offset = current_offset + count;
    let results = items
        .into_iter()
        .map(|item| {
            let images = item.get("images").cloned().unwrap_or_else(|| json!({}));
            let fixed_height = images.get("fixed_height").cloned().unwrap_or_else(|| json!({}));
            let preview = images
                .get("fixed_height_small")
                .and_then(|value| value.get("url"))
                .or_else(|| fixed_height.get("url"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let original = images
                .get("original")
                .and_then(|value| value.get("url"))
                .or_else(|| fixed_height.get("url"))
                .and_then(Value::as_str)
                .unwrap_or("");
            json!({
                "id": item.get("id").and_then(Value::as_str).unwrap_or(""),
                "title": item.get("title").and_then(Value::as_str).unwrap_or(""),
                "preview": preview,
                "url": original,
                "width": fixed_height.get("width").and_then(Value::as_str).and_then(|value| value.parse::<u32>().ok()).unwrap_or(200),
                "height": fixed_height.get("height").and_then(Value::as_str).and_then(|value| value.parse::<u32>().ok()).unwrap_or(200)
            })
        })
        .collect::<Vec<_>>();
    Ok(
        json!({ "results": results, "next": if next_offset < total { next_offset.to_string() } else { String::new() } }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state(label: &str) -> AppState {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-http-assets-{label}-{nonce}"));
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    #[test]
    fn local_asset_url_parser_accepts_explicit_managed_shapes() {
        assert_eq!(
            local_asset_path_from_url("asset://localhost/gallery/avatar.png"),
            Some(PathBuf::from("gallery/avatar.png"))
        );

        if cfg!(windows) {
            assert_eq!(
                local_asset_path_from_url(
                    "http://asset.localhost/C%3A%5CUsers%5CMari%5CMy%20Avatar.png",
                ),
                Some(PathBuf::from(r"C:\Users\Mari\My Avatar.png"))
            );
        } else {
            assert_eq!(
                local_asset_path_from_url("asset://localhost/%2Ftmp%2Fde-koi%2FAvatar%20One.png"),
                Some(PathBuf::from("/tmp/de-koi/Avatar One.png"))
            );
        }
    }

    #[test]
    fn local_asset_url_parser_rejects_malformed_shapes() {
        for url in [
            "asset://localhost/gallery/%2e%2e/secret.png",
            "asset://localhost/gallery/%2Ftmp%2Fsecret.png",
            "asset://localhost/gallery%2Favatar.png",
            "asset://localhost/gallery%5Cavatar.png",
            "asset://localhost/gallery/a%5Cb.png",
            "asset://evil.localhost/gallery/avatar.png",
            "asset://localhost/../gallery/avatar.png",
            "asset://localhost/%2Ftmp%2F..%2Fsecret.png",
            "http://asset.localhost/gallery/%2e%2e/secret.png",
        ] {
            assert_eq!(
                local_asset_path_from_url(url),
                None,
                "malformed local asset URL should be rejected before filesystem lookup: {url}"
            );
        }
    }

    #[test]
    fn local_asset_loader_rejects_handle_mismatch_before_reading() {
        let state = test_state("handle-mismatch");
        let gallery = state.data_dir.join("gallery");
        std::fs::create_dir_all(&gallery).expect("gallery dir should be created");
        let validated_path = gallery.join("validated.png");
        let swapped_path = gallery.join("swapped.png");
        std::fs::write(&validated_path, b"validated").expect("validated asset should be written");
        std::fs::write(&swapped_path, b"swapped").expect("swapped asset should be written");
        let data_dir =
            std::fs::canonicalize(&state.data_dir).expect("data dir should canonicalize");
        let canonical_path =
            std::fs::canonicalize(&validated_path).expect("asset should canonicalize");
        let expected_handle = validated_local_binary_asset_handle(&canonical_path)
            .expect("validated asset handle should be captured");
        let file = open_local_binary_file(&swapped_path).expect("swapped file should open");

        let error = validate_opened_local_binary_file(&file, &expected_handle)
            .expect_err("mismatched opened file handle should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("changed"));
    }

    #[test]
    fn local_asset_loader_rejects_file_replaced_after_validation() {
        let state = test_state("file-replaced");
        let gallery = state.data_dir.join("gallery");
        std::fs::create_dir_all(&gallery).expect("gallery dir should be created");
        let asset_path = gallery.join("asset.png");
        std::fs::write(&asset_path, b"validated").expect("validated asset should be written");
        let data_dir =
            std::fs::canonicalize(&state.data_dir).expect("data dir should canonicalize");
        let canonical_path = std::fs::canonicalize(&asset_path).expect("asset should canonicalize");
        assert!(is_managed_local_binary_asset(&data_dir, &canonical_path));
        let expected_handle = validated_local_binary_asset_handle(&canonical_path)
            .expect("validated asset handle should be captured");
        std::fs::remove_file(&asset_path).expect("asset should be removable");
        std::fs::write(&asset_path, b"replacement").expect("replacement asset should be written");
        let file = open_local_binary_file(&canonical_path).expect("replacement file should open");

        let error = validate_opened_local_binary_file(&file, &expected_handle)
            .expect_err("replacement file handle should be rejected");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("changed"));
    }

    #[cfg(unix)]
    fn percent_encode_for_test(value: &str) -> String {
        value
            .as_bytes()
            .iter()
            .map(|byte| match *byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (*byte as char).to_string()
                }
                byte => format!("%{byte:02X}"),
            })
            .collect()
    }
    #[cfg(unix)]
    #[test]
    fn local_asset_loader_reads_validated_canonical_target() {
        let state = test_state("symlink-inside");
        let gallery = state.data_dir.join("gallery");
        std::fs::create_dir_all(&gallery).expect("gallery dir should be created");
        let target = gallery.join("target.png");
        std::fs::write(&target, b"inside").expect("target asset should be written");
        let link = gallery.join("link.png");
        std::os::unix::fs::symlink(&target, &link).expect("asset symlink should be created");

        let url = format!(
            "asset://localhost/{}",
            percent_encode_for_test(&link.to_string_lossy())
        );
        let result = load_local_asset_binary(&state, &url, "image/png")
            .expect("valid canonical asset should load")
            .expect("local asset URL should produce a response");

        let expected_base64 = general_purpose::STANDARD.encode(b"inside");
        assert_eq!(
            result.get("base64").and_then(Value::as_str),
            Some(expected_base64.as_str())
        );
        assert_eq!(
            result.get("mimeType").and_then(Value::as_str),
            Some("image/png")
        );
    }
    #[tokio::test]
    async fn http_binary_blocks_local_and_reserved_hosts() {
        // The internal-host guard runs before any network request, so these all fail fast.
        for url in [
            "http://169.254.169.254/latest/meta-data/",
            "http://localhost:3000/secret",
            "http://127.0.0.1/",
            "http://10.0.0.5/",
            "http://192.168.1.1/",
            "http://[::1]/",
        ] {
            let error = http_binary(url, "image/png")
                .await
                .expect_err("local/reserved host must be rejected");
            assert_eq!(error.code, "invalid_input", "url {url} should be blocked");
            assert!(error.message.contains("Outbound URL is not allowed"));
        }
    }

    #[test]
    fn redirect_revalidation_blocks_reserved_locations() {
        // A public response that 302s to a reserved/internal address must be rejected when the
        // redirect Location is re-validated, instead of being chased into IMDS/localhost.
        let current = reqwest::Url::parse("https://cdn.example.com/avatar.png").unwrap();
        for location in [
            "http://169.254.169.254/latest/meta-data/",
            "http://127.0.0.1/",
            "http://localhost/internal",
            "http://10.0.0.5/",
        ] {
            let error = validate_redirected_binary_fetch_url(&current, location)
                .expect_err("redirect to a reserved host must be rejected");
            assert_eq!(
                error.code, "invalid_input",
                "location {location} should be blocked"
            );
        }
    }

    #[test]
    fn redirect_revalidation_allows_public_relative_locations() {
        let current = reqwest::Url::parse("https://cdn.example.com/avatar.png").unwrap();
        let resolved = validate_redirected_binary_fetch_url(&current, "/resized/avatar.png")
            .expect("public relative redirect should resolve");
        assert_eq!(
            resolved.as_str(),
            "https://cdn.example.com/resized/avatar.png"
        );
    }

    #[tokio::test]
    async fn resolved_addresses_skip_pinning_for_ip_literal_hosts() {
        // IP-literal hosts are screened by the URL guard, so no DNS lookup/pinning is performed.
        let url = reqwest::Url::parse("http://1.1.1.1/x").unwrap();
        assert!(binary_fetch_resolved_addresses(&url)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn resolved_addresses_reject_hosts_resolving_to_reserved_ips() {
        // localhost resolves to a loopback address; the rebinding guard must reject it.
        let url = reqwest::Url::parse("http://localhost:9/x").unwrap();
        let error = binary_fetch_resolved_addresses(&url)
            .await
            .expect_err("a host that resolves to a reserved IP must be rejected");
        assert_eq!(error.code, "invalid_input");
    }
}
