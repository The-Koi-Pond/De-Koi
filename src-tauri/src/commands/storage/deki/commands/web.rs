use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use super::super::budget::truncate_to_chars;

const DEKI_WEB_SEARCH_MAX_RESULTS: usize = 5;
const DEKI_WEB_SEARCH_TIMEOUT_SECS: u64 = 12;
const DEKI_WEB_SEARCH_MAX_BYTES: usize = 256 * 1024;
const DEKI_WEB_PAGE_MAX_BYTES: usize = 768 * 1024;
const DEKI_WEB_PAGE_MAX_CHARS: usize = 12 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::storage_commands::deki) struct DekiWebResearchGrant {
    pub(in crate::storage_commands::deki) id: String,
    pub(in crate::storage_commands::deki) action_message_id: String,
    pub(in crate::storage_commands::deki) scope: DekiWebResearchScope,
    pub(in crate::storage_commands::deki) granted_at: String,
    #[serde(default)]
    pub(in crate::storage_commands::deki) expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::storage_commands::deki) struct DekiWebResearchScope {
    #[serde(rename = "type")]
    pub(in crate::storage_commands::deki) scope_type: String,
    pub(in crate::storage_commands::deki) query: String,
    #[serde(default)]
    pub(in crate::storage_commands::deki) allowed_domains: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::storage_commands::deki) struct SearchDekiWebArgs {
    pub(in crate::storage_commands::deki) query: String,
    #[serde(default, alias = "max_results")]
    pub(in crate::storage_commands::deki) max_results: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub(in crate::storage_commands::deki) struct ReadDekiWebPageArgs {
    pub(in crate::storage_commands::deki) query: String,
    pub(in crate::storage_commands::deki) url: String,
}

pub(in crate::storage_commands::deki) async fn search_deki_web(
    args: SearchDekiWebArgs,
    grants: &[DekiWebResearchGrant],
) -> AppResult<Value> {
    let query = args.query.trim();
    if query.is_empty() {
        return Err(AppError::invalid_input("Web search query is required"));
    }
    let grant = deki_web_grant_for_query(query, grants).ok_or_else(|| {
        AppError::invalid_input(
            "Deki-senpai can only search the web after the user approves the exact search query.",
        )
    })?;
    let max_results = args
        .max_results
        .unwrap_or(DEKI_WEB_SEARCH_MAX_RESULTS)
        .clamp(1, DEKI_WEB_SEARCH_MAX_RESULTS);
    let effective_query = deki_web_effective_query(query, &grant.scope.allowed_domains);
    let url = deki_web_search_url(&effective_query)?;
    let client = deki_web_search_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::new("deki_web_search_request_failed", error.to_string()))?;
    if response.status().is_redirection() {
        return Err(AppError::new(
            "deki_web_search_redirect_rejected",
            "The web search provider redirected outside the approved request.",
        ));
    }
    let response = response
        .error_for_status()
        .map_err(|error| AppError::new("deki_web_search_status_failed", error.to_string()))?;
    let (html, truncated) = read_deki_web_response_body(
        response,
        DEKI_WEB_SEARCH_MAX_BYTES,
        "deki_web_search_body_failed",
    )
    .await?;
    if truncated {
        return Err(AppError::new(
            "deki_web_search_body_too_large",
            "The web search provider response exceeded the bounded response size.",
        ));
    }
    let results = deki_web_results_for_grant(
        deki_web_results_or_parse_error(&html, query, max_results)?,
        grant,
    );
    if results.is_empty() {
        return Err(AppError::new(
            "deki_web_search_no_results",
            format!("No web search results inside the approved scope were returned for '{query}'."),
        ));
    }
    Ok(json!({
        "query": query,
        "grantId": grant.id,
        "actionMessageId": grant.action_message_id,
        "allowedDomains": grant.scope.allowed_domains,
        "results": results,
    }))
}

pub(in crate::storage_commands::deki) async fn read_deki_web_page(
    args: ReadDekiWebPageArgs,
    grants: &[DekiWebResearchGrant],
) -> AppResult<Value> {
    let query = args.query.trim();
    if query.is_empty() {
        return Err(AppError::invalid_input("Web page read query is required"));
    }
    let grant = deki_web_grant_for_query(query, grants).ok_or_else(|| {
        AppError::invalid_input(
            "Deki-senpai can only read web pages after the user approves the matching web research query.",
        )
    })?;
    let url = deki_web_page_url_for_grant(&args.url, grant)?;
    let client = deki_web_page_client(&url).await?;
    let (text, truncated) = if let Some(api_url) = deki_fandom_api_url_for_page(&url) {
        match fetch_deki_web_page_body(&client, &api_url).await {
            Ok((api_body, api_truncated)) => {
                match extract_deki_mediawiki_page_text(&api_body, DEKI_WEB_PAGE_MAX_CHARS) {
                    Ok(text) if !text.trim().is_empty() => (text, api_truncated),
                    _ => {
                        let (html_body, html_truncated) =
                            fetch_deki_web_page_body(&client, &url).await?;
                        (
                            extract_deki_fandom_page_text(
                                &api_body,
                                &html_body,
                                DEKI_WEB_PAGE_MAX_CHARS,
                            )?,
                            html_truncated,
                        )
                    }
                }
            }
            Err(_) => {
                let (html_body, html_truncated) = fetch_deki_web_page_body(&client, &url).await?;
                (
                    extract_deki_web_page_text(&html_body, DEKI_WEB_PAGE_MAX_CHARS),
                    html_truncated,
                )
            }
        }
    } else {
        let (body, truncated) = fetch_deki_web_page_body(&client, &url).await?;
        (
            extract_deki_web_page_text(&body, DEKI_WEB_PAGE_MAX_CHARS),
            truncated,
        )
    };
    if text.trim().is_empty() {
        return Err(AppError::new(
            "deki_web_page_no_readable_text",
            format!("No readable text could be extracted from {}", url.as_str()),
        ));
    }
    Ok(json!({
        "query": query,
        "grantId": grant.id,
        "url": url.as_str(),
        "text": text,
        "truncated": truncated,
    }))
}

fn deki_web_search_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(DEKI_WEB_SEARCH_TIMEOUT_SECS))
        .user_agent("De-Koi Deki-senpai web research/1.0")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::new("deki_web_search_client_failed", error.to_string()))
}

async fn fetch_deki_web_page_body(
    client: &reqwest::Client,
    url: &reqwest::Url,
) -> AppResult<(String, bool)> {
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|error| AppError::new("deki_web_page_request_failed", error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::new("deki_web_page_status_failed", error.to_string()))?;
    read_deki_web_response_body(
        response,
        DEKI_WEB_PAGE_MAX_BYTES,
        "deki_web_page_body_failed",
    )
    .await
}

async fn read_deki_web_response_body(
    mut response: reqwest::Response,
    max_bytes: usize,
    body_error_code: &str,
) -> AppResult<(String, bool)> {
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    let mut truncated = false;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| AppError::new(body_error_code, error.to_string()))?
    {
        if append_deki_web_body_chunk(&mut bytes, &chunk, max_bytes) {
            truncated = true;
            break;
        }
    }
    let body = String::from_utf8_lossy(&bytes).to_string();
    Ok((body, truncated))
}

fn append_deki_web_body_chunk(bytes: &mut Vec<u8>, chunk: &[u8], max_bytes: usize) -> bool {
    let remaining = max_bytes.saturating_sub(bytes.len());
    if chunk.len() > remaining {
        bytes.extend_from_slice(&chunk[..remaining]);
        true
    } else {
        bytes.extend_from_slice(chunk);
        false
    }
}

async fn deki_web_page_client(url: &reqwest::Url) -> AppResult<reqwest::Client> {
    let host = url.host_str().ok_or_else(|| {
        AppError::new(
            "deki_web_page_url_not_public",
            "Deki-senpai can only read public web page URLs.",
        )
    })?;
    let port = url.port_or_known_default().ok_or_else(|| {
        AppError::new(
            "deki_web_page_url_not_public",
            "The web page URL does not have a supported network port.",
        )
    })?;
    let resolved = if let Ok(ip) = host.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        tokio::net::lookup_host((host, port))
            .await
            .map_err(|error| AppError::new("deki_web_page_dns_failed", error.to_string()))?
            .collect::<Vec<_>>()
    };
    if resolved.is_empty()
        || resolved
            .iter()
            .any(|address| !deki_web_ip_is_public(address.ip()))
    {
        return Err(AppError::new(
            "deki_web_page_url_not_public",
            "Deki-senpai can only read hosts whose resolved addresses are public.",
        ));
    }

    reqwest::Client::builder()
        .timeout(Duration::from_secs(DEKI_WEB_SEARCH_TIMEOUT_SECS))
        .user_agent("De-Koi Deki-senpai web research/1.0")
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &resolved)
        .build()
        .map_err(|error| AppError::new("deki_web_page_client_failed", error.to_string()))
}
pub(in crate::storage_commands::deki) fn deki_fandom_api_url_for_page(
    url: &reqwest::Url,
) -> Option<reqwest::Url> {
    let host = url.host_str()?;
    if !deki_web_domain_matches(host, "fandom.com") {
        return None;
    }
    let title = url.path().strip_prefix("/wiki/")?.trim_matches('/');
    if title.is_empty() {
        return None;
    }
    let mut api = reqwest::Url::parse(&format!("{}://{host}/api.php", url.scheme())).ok()?;
    api.query_pairs_mut()
        .append_pair("action", "query")
        .append_pair("prop", "extracts")
        .append_pair("explaintext", "1")
        .append_pair("redirects", "1")
        .append_pair("format", "json")
        .append_pair("titles", title);
    Some(api)
}

pub(in crate::storage_commands::deki) fn extract_deki_fandom_page_text(
    mediawiki_body: &str,
    fallback_html: &str,
    max_chars: usize,
) -> AppResult<String> {
    if let Ok(text) = extract_deki_mediawiki_page_text(mediawiki_body, max_chars) {
        if !text.trim().is_empty() {
            return Ok(text);
        }
    }

    let fallback_text = extract_deki_web_page_text(fallback_html, max_chars);
    if fallback_text.trim().is_empty() {
        return Err(AppError::new(
            "deki_web_page_no_readable_text",
            "Fandom API did not include readable extract text, and no readable text could be extracted from the page HTML.",
        ));
    }
    Ok(fallback_text)
}
pub(in crate::storage_commands::deki) fn extract_deki_mediawiki_page_text(
    body: &str,
    max_chars: usize,
) -> AppResult<String> {
    let parsed: Value = serde_json::from_str(body).map_err(|error| {
        AppError::new(
            "deki_web_page_mediawiki_invalid_json",
            format!("MediaWiki response was not valid JSON: {error}"),
        )
    })?;
    let pages = parsed
        .get("query")
        .and_then(|query| query.get("pages"))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::new(
                "deki_web_page_mediawiki_missing_extract",
                "MediaWiki response did not include pages.",
            )
        })?;
    let page = pages.values().next().ok_or_else(|| {
        AppError::new(
            "deki_web_page_mediawiki_missing_extract",
            "MediaWiki response did not include a page.",
        )
    })?;
    let title = page
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let extract = page
        .get("extract")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "deki_web_page_mediawiki_missing_extract",
                "MediaWiki response did not include readable extract text.",
            )
        })?;
    let combined = if title.is_empty() || extract.contains(title) {
        extract.to_string()
    } else {
        format!("{title}\n\n{extract}")
    };
    Ok(truncate_to_chars(&combined, max_chars).0)
}
pub(in crate::storage_commands::deki) fn deki_web_page_url_for_grant(
    url: &str,
    grant: &DekiWebResearchGrant,
) -> AppResult<reqwest::Url> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|error| AppError::invalid_input(format!("Web page URL is invalid: {error}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::new(
            "deki_web_page_scheme_not_allowed",
            "Only HTTP and HTTPS web page URLs are allowed.",
        ));
    }
    let host = parsed.host_str().unwrap_or_default();
    if !deki_web_host_is_public(host) {
        return Err(AppError::new(
            "deki_web_page_url_not_public",
            "Deki-senpai can only read public web page URLs.",
        ));
    }
    if !grant.scope.allowed_domains.is_empty()
        && !grant
            .scope
            .allowed_domains
            .iter()
            .any(|domain| deki_web_domain_matches(host, domain))
    {
        return Err(AppError::new(
            "deki_web_page_domain_not_allowed",
            "That URL is outside the domains approved for this web research grant.",
        ));
    }
    Ok(parsed)
}

fn deki_web_host_is_public(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host == "localhost" || host.ends_with(".localhost") {
        return false;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return deki_web_ip_is_public(ip);
    }
    true
}

fn deki_web_ip_is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || octets[0] == 0
                || octets[0] >= 240
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
                || (octets[0] == 198 && (18..=19).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113))
        }
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4() {
                return deki_web_ip_is_public(IpAddr::V4(mapped));
            }
            let segments = ip.segments();
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_multicast()
                || segments[0] & 0xffc0 == 0xfec0
                || (segments[0] == 0x2001 && segments[1] == 0x0db8))
        }
    }
}

fn deki_web_domain_matches(host: &str, approved_domain: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let approved = approved_domain
        .trim()
        .trim_end_matches('.')
        .trim_start_matches("*.")
        .to_ascii_lowercase();
    !approved.is_empty() && (host == approved || host.ends_with(&format!(".{approved}")))
}

pub(in crate::storage_commands::deki) fn extract_deki_web_page_text(
    html: &str,
    max_chars: usize,
) -> String {
    let without_scripts = remove_deki_html_element_blocks(html, "script");
    let without_styles = remove_deki_html_element_blocks(&without_scripts, "style");
    let without_noscript = remove_deki_html_element_blocks(&without_styles, "noscript");
    let title = html_tag_text(&without_noscript, "title");
    let body = html_tag_text(&without_noscript, "body");
    let source = if body.trim().is_empty() {
        without_noscript.as_str()
    } else {
        body.as_str()
    };
    let text = strip_deki_html(&decode_deki_html_entities(source));
    let combined = if title.trim().is_empty() {
        text
    } else if text.trim().is_empty() || text.contains(title.trim()) {
        title
    } else {
        format!("{}\n\n{}", title.trim(), text.trim())
    };
    truncate_to_chars(&combined, max_chars).0
}

fn html_tag_text(value: &str, tag: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let open_prefix = format!("<{tag}");
    let Some(open_start) = lower.find(&open_prefix) else {
        return String::new();
    };
    let Some(content_start_relative) = value[open_start..].find('>') else {
        return String::new();
    };
    let content_start = open_start + content_start_relative + 1;
    let close = format!("</{tag}>");
    let content_end = lower[content_start..]
        .find(&close)
        .map(|index| content_start + index)
        .unwrap_or(value.len());
    strip_deki_html(&decode_deki_html_entities(
        &value[content_start..content_end],
    ))
}

fn remove_deki_html_element_blocks(value: &str, tag: &str) -> String {
    let mut output = String::new();
    let mut rest = value;
    let open_prefix = format!("<{tag}");
    let close = format!("</{tag}>");
    loop {
        let lower = rest.to_ascii_lowercase();
        let Some(start) = lower.find(&open_prefix) else {
            output.push_str(rest);
            break;
        };
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let after_lower = after_start.to_ascii_lowercase();
        let Some(close_index) = after_lower.find(&close) else {
            break;
        };
        rest = &after_start[close_index + close.len()..];
    }
    output
}
pub(in crate::storage_commands::deki) fn deki_web_search_url(
    query: &str,
) -> AppResult<reqwest::Url> {
    reqwest::Url::parse_with_params("https://search.brave.com/search", &[("q", query)])
        .map_err(|error| AppError::new("deki_web_search_invalid_url", error.to_string()))
}
pub(in crate::storage_commands::deki) fn deki_web_grant_for_query<'a>(
    query: &str,
    grants: &'a [DekiWebResearchGrant],
) -> Option<&'a DekiWebResearchGrant> {
    let normalized_query = normalize_deki_web_query(query);
    grants.iter().find(|grant| {
        grant.scope.scope_type == "query"
            && normalize_deki_web_query(&grant.scope.query) == normalized_query
            && !deki_web_grant_is_expired(grant)
    })
}

fn deki_web_grant_is_expired(grant: &DekiWebResearchGrant) -> bool {
    let Some(expires_at) = grant
        .expires_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(expires_at)
        .map(|expires_at| expires_at.with_timezone(&chrono::Utc) <= chrono::Utc::now())
        .unwrap_or(true)
}

fn normalize_deki_web_query(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn deki_web_effective_query(query: &str, allowed_domains: &[String]) -> String {
    let domains = allowed_domains
        .iter()
        .map(|domain| domain.trim())
        .filter(|domain| !domain.is_empty())
        .map(|domain| format!("site:{domain}"))
        .collect::<Vec<_>>();
    if domains.is_empty() {
        query.to_string()
    } else {
        format!("{} {}", query, domains.join(" OR "))
    }
}

fn deki_web_results_for_grant(results: Vec<Value>, grant: &DekiWebResearchGrant) -> Vec<Value> {
    results
        .into_iter()
        .filter(|result| {
            result
                .get("url")
                .and_then(Value::as_str)
                .is_some_and(|url| deki_web_page_url_for_grant(url, grant).is_ok())
        })
        .collect()
}

pub(in crate::storage_commands::deki) fn deki_web_results_or_parse_error(
    html: &str,
    query: &str,
    max_results: usize,
) -> AppResult<Vec<Value>> {
    let results = extract_deki_web_results(html, max_results);
    if results.is_empty() {
        return Err(AppError::new(
            "deki_web_search_no_results",
            format!(
                "No parseable web search results were returned for '{query}'. The search provider may have returned an interstitial or changed its HTML."
            ),
        ));
    }
    Ok(results)
}
pub(in crate::storage_commands::deki) fn extract_deki_web_results(
    html: &str,
    max_results: usize,
) -> Vec<Value> {
    let mut results = extract_duckduckgo_web_results(html, max_results);
    if results.len() < max_results {
        for result in extract_brave_web_results(html, max_results - results.len()) {
            let url = result
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !results
                .iter()
                .any(|existing| existing.get("url").and_then(Value::as_str) == Some(url))
            {
                results.push(result);
            }
        }
    }
    results.truncate(max_results);
    results
}

fn extract_duckduckgo_web_results(html: &str, max_results: usize) -> Vec<Value> {
    let mut results = Vec::new();
    let mut rest = html;
    while results.len() < max_results {
        let Some(anchor_start) = rest.find("<a") else {
            break;
        };
        rest = &rest[anchor_start..];
        let Some(tag_end) = rest.find('>') else {
            break;
        };
        let anchor_tag = &rest[..tag_end];
        if !anchor_tag.contains("result__a") {
            rest = &rest[tag_end..];
            continue;
        }
        let Some(anchor_close) = rest[tag_end + 1..].find("</a>") else {
            break;
        };
        let title_html = &rest[tag_end + 1..tag_end + 1 + anchor_close];
        let href = html_attr_value(anchor_tag, "href")
            .map(|href| normalize_deki_web_result_url(&href))
            .unwrap_or_default();
        let title = strip_deki_html(&decode_deki_html_entities(title_html));
        let after_anchor = &rest[tag_end + 1 + anchor_close + "</a>".len()..];
        let snippet = deki_web_snippet_after_anchor(after_anchor);
        if !title.trim().is_empty() || !href.trim().is_empty() {
            results.push(json!({
                "title": title.trim(),
                "url": href,
                "snippet": snippet,
            }));
        }
        rest = after_anchor;
    }
    results
}

fn extract_brave_web_results(html: &str, max_results: usize) -> Vec<Value> {
    let mut results = Vec::new();
    let mut rest = html;
    while results.len() < max_results {
        let Some(snippet_start) = rest.find("<div class=\"snippet") else {
            break;
        };
        rest = &rest[snippet_start..];
        let next_snippet = rest["<div class=\"snippet".len()..]
            .find("<div class=\"snippet")
            .map(|index| index + "<div class=\"snippet".len())
            .unwrap_or(rest.len());
        let block = &rest[..next_snippet];
        if !block.contains("data-type=\"web\"") {
            rest = &rest[next_snippet..];
            continue;
        }
        let Some(anchor_start) = block.find("<a") else {
            rest = &rest[next_snippet..];
            continue;
        };
        let anchor = &block[anchor_start..];
        let Some(tag_end) = anchor.find('>') else {
            rest = &rest[next_snippet..];
            continue;
        };
        let anchor_tag = &anchor[..tag_end];
        let href = html_attr_value(anchor_tag, "href")
            .map(|href| normalize_deki_web_result_url(&href))
            .unwrap_or_default();
        let title = html_class_text(block, "search-snippet-title");
        let snippet = html_class_text(block, "generic-snippet");
        if !title.trim().is_empty() || !href.trim().is_empty() {
            results.push(json!({
                "title": title.trim(),
                "url": href,
                "snippet": snippet,
            }));
        }
        rest = &rest[next_snippet..];
    }
    results
}

fn html_class_text(value: &str, class_marker: &str) -> String {
    let Some(class_index) = value.find(class_marker) else {
        return String::new();
    };
    let value = &value[class_index..];
    let Some(start) = value.find('>') else {
        return String::new();
    };
    let after_start = &value[start + 1..];
    let end = after_start.find("</div>").unwrap_or(after_start.len());
    strip_deki_html(&decode_deki_html_entities(&after_start[..end]))
        .trim()
        .to_string()
}
fn deki_web_snippet_after_anchor(value: &str) -> String {
    let Some(snippet_index) = value.find("result__snippet") else {
        return String::new();
    };
    let snippet = &value[snippet_index..];
    let Some(start) = snippet.find('>') else {
        return String::new();
    };
    let after_start = &snippet[start + 1..];
    let end = after_start
        .find("</a>")
        .or_else(|| after_start.find("</div>"))
        .unwrap_or(after_start.len());
    strip_deki_html(&decode_deki_html_entities(&after_start[..end]))
        .trim()
        .to_string()
}

fn html_attr_value(tag: &str, attr: &str) -> Option<String> {
    let double_quote_pattern = format!("{attr}=\"");
    if let Some(start) = tag.find(&double_quote_pattern) {
        let rest = &tag[start + double_quote_pattern.len()..];
        let end = rest.find('"')?;
        return Some(decode_deki_html_entities(&rest[..end]));
    }
    let single_quote_pattern = format!("{attr}='");
    let start = tag.find(&single_quote_pattern)? + single_quote_pattern.len();
    let rest = &tag[start..];
    let end = rest.find('\'')?;
    Some(decode_deki_html_entities(&rest[..end]))
}

fn normalize_deki_web_result_url(href: &str) -> String {
    let href = href.trim();
    let parsed = reqwest::Url::parse(href)
        .or_else(|_| reqwest::Url::parse("https://duckduckgo.com")?.join(href));
    let Ok(parsed) = parsed else {
        return href.to_string();
    };
    if parsed.domain() == Some("duckduckgo.com") && parsed.path().starts_with("/l/") {
        if let Some((_, target)) = parsed.query_pairs().find(|(key, _)| key == "uddg") {
            return target.into_owned();
        }
    }
    parsed.to_string()
}

fn decode_deki_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn strip_deki_html(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn web_search_client_does_not_follow_redirects() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("redirect test listener should bind");
        let address = listener
            .local_addr()
            .expect("redirect test listener should have an address");
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("redirect test request should connect");
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await;
            stream
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("redirect test response should write");
        });

        let response = deki_web_search_client()
            .expect("search client should build")
            .get(format!("http://{address}/search"))
            .send()
            .await
            .expect("the initial redirect response should be returned");
        server.await.expect("redirect test server should finish");

        assert!(response.status().is_redirection());
    }

    #[test]
    fn web_body_chunk_cap_stops_at_the_byte_boundary() {
        let mut bytes = Vec::new();

        assert!(!append_deki_web_body_chunk(&mut bytes, b"abc", 5));
        assert!(append_deki_web_body_chunk(&mut bytes, b"def", 5));
        assert_eq!(bytes, b"abcde");
    }

    #[test]
    fn web_page_addresses_must_resolve_to_public_networks() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            let ip = address
                .parse::<IpAddr>()
                .expect("test address should parse");
            assert!(!deki_web_ip_is_public(ip), "{address} must be rejected");
        }
        assert!(deki_web_ip_is_public(
            "1.1.1.1".parse().expect("public test address should parse")
        ));
    }

    #[test]
    fn web_search_results_stay_inside_the_approved_domain_scope() {
        let grant = DekiWebResearchGrant {
            id: "grant-1".to_string(),
            action_message_id: "message-1".to_string(),
            scope: DekiWebResearchScope {
                scope_type: "query".to_string(),
                query: "Ghostface Dead by Daylight".to_string(),
                allowed_domains: vec!["deadbydaylight.fandom.com".to_string()],
            },
            granted_at: "2026-07-19T12:00:00Z".to_string(),
            expires_at: None,
        };
        let results = vec![
            json!({
                "title": "Ghost Face",
                "url": "https://deadbydaylight.fandom.com/wiki/Ghost_Face",
                "snippet": "Approved result",
            }),
            json!({
                "title": "Unapproved mirror",
                "url": "https://example.com/ghost-face",
                "snippet": "Outside the grant",
            }),
        ];

        let filtered = deki_web_results_for_grant(results, &grant);

        assert_eq!(filtered.len(), 1);
        assert_eq!(
            filtered[0]["url"],
            "https://deadbydaylight.fandom.com/wiki/Ghost_Face"
        );
    }

    #[test]
    fn web_search_parser_respects_the_requested_result_cap() {
        let html = r#"
            <a class="result__a" href="https://example.com/one">One</a>
            <div class="result__snippet">First result</div>
            <a class="result__a" href="https://example.com/two">Two</a>
            <div class="result__snippet">Second result</div>
        "#;

        let results = deki_web_results_or_parse_error(html, "query", 1)
            .expect("one parseable result should be returned");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["url"], "https://example.com/one");
    }

    #[test]
    fn web_search_parser_reports_an_unusable_provider_response() {
        let error = deki_web_results_or_parse_error("<html>interstitial</html>", "query", 5)
            .expect_err("provider interstitial should be reported");

        assert_eq!(error.code, "deki_web_search_no_results");
        assert!(error.message.contains("interstitial"));
    }
}
