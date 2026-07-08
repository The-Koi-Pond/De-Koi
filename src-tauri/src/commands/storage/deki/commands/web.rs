use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::IpAddr;
use std::time::Duration;

use super::super::budget::truncate_to_chars;

const DEKI_WEB_SEARCH_MAX_RESULTS: usize = 5;
const DEKI_WEB_SEARCH_TIMEOUT_SECS: u64 = 12;
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
pub(in crate::storage_commands::deki) struct SearchDekiWebArgs {
    pub(in crate::storage_commands::deki) query: String,
    #[serde(default)]
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
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DEKI_WEB_SEARCH_TIMEOUT_SECS))
        .user_agent("De-Koi Deki-senpai web research/1.0")
        .redirect(reqwest::redirect::Policy::limited(4))
        .build()
        .map_err(|error| AppError::new("deki_web_search_client_failed", error.to_string()))?;
    let html = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::new("deki_web_search_request_failed", error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::new("deki_web_search_status_failed", error.to_string()))?
        .text()
        .await
        .map_err(|error| AppError::new("deki_web_search_body_failed", error.to_string()))?;
    let results = deki_web_results_or_parse_error(&html, query, max_results)?;
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
    let client = deki_web_page_client()?;
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

async fn fetch_deki_web_page_body(
    client: &reqwest::Client,
    url: &reqwest::Url,
) -> AppResult<(String, bool)> {
    let bytes = client
        .get(url.clone())
        .send()
        .await
        .map_err(|error| AppError::new("deki_web_page_request_failed", error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::new("deki_web_page_status_failed", error.to_string()))?
        .bytes()
        .await
        .map_err(|error| AppError::new("deki_web_page_body_failed", error.to_string()))?;
    let truncated = bytes.len() > DEKI_WEB_PAGE_MAX_BYTES;
    let slice_len = bytes.len().min(DEKI_WEB_PAGE_MAX_BYTES);
    let body = String::from_utf8_lossy(&bytes[..slice_len]).to_string();
    Ok((body, truncated))
}
pub(in crate::storage_commands::deki) fn deki_web_page_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(DEKI_WEB_SEARCH_TIMEOUT_SECS))
        .user_agent("De-Koi Deki-senpai web research/1.0")
        .redirect(reqwest::redirect::Policy::none())
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
        return match ip {
            IpAddr::V4(ip) => {
                !(ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_unspecified()
                    || ip.is_broadcast()
                    || ip.octets()[0] == 0)
            }
            IpAddr::V6(ip) => {
                !(ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local())
            }
        };
    }
    true
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
