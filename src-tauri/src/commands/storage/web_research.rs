use super::shared::get_required;
use crate::state::AppState;
use chrono::{DateTime, Utc};
use marinara_core::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::IpAddr;
use std::time::Duration;
use unicode_normalization::UnicodeNormalization;

const SEARCH_MAX_RESULTS: usize = 8;
const REQUEST_TIMEOUT_SECS: u64 = 12;
const PAGE_MAX_BYTES: usize = 768 * 1024;
const PAGE_MAX_CHARS: usize = 16 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CharacterWebResearchGrant {
    pub id: String,
    pub query: String,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    pub request_message_id: String,
    pub granted_at: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRequest {
    chat_id: String,
    grant_id: String,
    query: String,
    max_results: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadRequest {
    chat_id: String,
    grant_id: String,
    query: String,
    url: String,
}

pub(crate) async fn search(state: &AppState, body: Value) -> AppResult<Value> {
    let request: SearchRequest = serde_json::from_value(body)
        .map_err(|error| AppError::invalid_input(format!("Invalid web search request: {error}")))?;
    let chat = get_required(state, "chats", request.chat_id.trim())?;
    let grant =
        validated_character_web_grant(&chat, &request.grant_id, &request.query, Utc::now())?;
    let max_results = request
        .max_results
        .unwrap_or(SEARCH_MAX_RESULTS)
        .clamp(1, SEARCH_MAX_RESULTS);
    let effective_query = effective_query(&grant.query, &grant.allowed_domains);
    let url = reqwest::Url::parse_with_params(
        "https://search.brave.com/search",
        &[("q", effective_query.as_str())],
    )
    .map_err(|error| AppError::new("character_web_search_invalid_url", error.to_string()))?;
    let client = web_client(reqwest::redirect::Policy::limited(4))?;
    let html = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::new("character_web_search_request_failed", error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::new("character_web_search_status_failed", error.to_string()))?
        .text()
        .await
        .map_err(|error| AppError::new("character_web_search_body_failed", error.to_string()))?;
    let results = filter_search_results(extract_search_results(&html, max_results), &grant);
    if results.is_empty() {
        return Err(AppError::new(
            "character_web_search_no_results",
            "The search provider returned no readable results.",
        ));
    }
    Ok(json!({ "query": grant.query, "grantId": grant.id, "results": results }))
}

pub(crate) async fn read_page(state: &AppState, body: Value) -> AppResult<Value> {
    let request: ReadRequest = serde_json::from_value(body)
        .map_err(|error| AppError::invalid_input(format!("Invalid web page request: {error}")))?;
    let chat = get_required(state, "chats", request.chat_id.trim())?;
    let grant =
        validated_character_web_grant(&chat, &request.grant_id, &request.query, Utc::now())?;
    let url = web_page_url_for_grant(&request.url, &grant)?;
    validate_resolved_public_host(&url).await?;
    let bytes = web_client(reqwest::redirect::Policy::none())?
        .get(url.clone())
        .send()
        .await
        .map_err(|error| AppError::new("character_web_page_request_failed", error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::new("character_web_page_status_failed", error.to_string()))?
        .bytes()
        .await
        .map_err(|error| AppError::new("character_web_page_body_failed", error.to_string()))?;
    let truncated = bytes.len() > PAGE_MAX_BYTES;
    let body = String::from_utf8_lossy(&bytes[..bytes.len().min(PAGE_MAX_BYTES)]);
    let text = extract_page_text(&body, PAGE_MAX_CHARS);
    if text.is_empty() {
        return Err(AppError::new(
            "character_web_page_no_readable_text",
            "No readable text could be extracted from the approved page.",
        ));
    }
    Ok(json!({
        "query": grant.query,
        "grantId": grant.id,
        "url": url.as_str(),
        "text": text,
        "truncated": truncated
    }))
}

pub(crate) fn validated_character_web_grant(
    chat: &Value,
    grant_id: &str,
    query: &str,
    now: DateTime<Utc>,
) -> AppResult<CharacterWebResearchGrant> {
    let metadata = chat
        .get("metadata")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::invalid_input("Character web access is not enabled for this chat.")
        })?;
    if metadata
        .get("characterWebAccessEnabled")
        .and_then(Value::as_bool)
        != Some(true)
    {
        return Err(AppError::invalid_input(
            "Character web access is not enabled for this chat.",
        ));
    }
    let grant: CharacterWebResearchGrant = serde_json::from_value(
        metadata
            .get("characterWebResearchGrant")
            .cloned()
            .ok_or_else(|| AppError::invalid_input("No web research grant is active."))?,
    )
    .map_err(|_| AppError::invalid_input("The web research grant is malformed."))?;
    if grant.id != grant_id.trim() || normalize_query(&grant.query) != normalize_query(query) {
        return Err(AppError::invalid_input(
            "This grant only permits the exact approved web research query.",
        ));
    }
    let expires_at = DateTime::parse_from_rfc3339(&grant.expires_at)
        .map_err(|_| AppError::invalid_input("The web research grant expiry is invalid."))?
        .with_timezone(&Utc);
    if expires_at <= now {
        return Err(AppError::invalid_input(
            "The web research grant has expired.",
        ));
    }
    Ok(grant)
}

pub(crate) fn web_page_url_for_grant(
    url: &str,
    grant: &CharacterWebResearchGrant,
) -> AppResult<reqwest::Url> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|error| AppError::invalid_input(format!("Web page URL is invalid: {error}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::invalid_input(
            "Only HTTP and HTTPS web page URLs are allowed.",
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || has_secret_query(&parsed) {
        return Err(AppError::invalid_input(
            "URLs containing credentials or secret parameters are not allowed.",
        ));
    }
    let host = parsed.host_str().unwrap_or_default();
    if !host_is_public(host) {
        return Err(AppError::invalid_input(
            "Only public web page URLs are allowed.",
        ));
    }
    if !grant.allowed_domains.is_empty()
        && !grant
            .allowed_domains
            .iter()
            .any(|domain| domain_matches(host, domain))
    {
        return Err(AppError::invalid_input(
            "That URL is outside the domains approved for this research.",
        ));
    }
    Ok(parsed)
}

async fn validate_resolved_public_host(url: &reqwest::Url) -> AppResult<()> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::invalid_input("Web page URL has no host."))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = match tokio::net::lookup_host((host, port)).await {
        Ok(addresses) => addresses.collect::<Vec<_>>(),
        Err(first_error) => {
            tokio::time::sleep(Duration::from_millis(50)).await;
            tokio::net::lookup_host((host, port))
                .await
                .map(|addresses| addresses.collect::<Vec<_>>())
                .map_err(|retry_error| {
                    AppError::new(
                        "character_web_dns_lookup_failed",
                        format!(
                            "Could not resolve the approved web page host after retry: {first_error}; {retry_error}"
                        ),
                    )
                })?
        }
    };
    if addresses.is_empty() {
        return Err(AppError::new(
            "character_web_dns_no_addresses",
            "The approved web page host resolved without any addresses.",
        ));
    }
    for address in addresses {
        if !ip_is_public(address.ip()) {
            return Err(AppError::invalid_input(
                "The web page host resolves to a private network address.",
            ));
        }
    }
    Ok(())
}

fn web_client(redirect: reqwest::redirect::Policy) -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("De-Koi character web research/1.0")
        .redirect(redirect)
        .build()
        .map_err(|error| AppError::new("character_web_client_failed", error.to_string()))
}

fn effective_query(query: &str, allowed_domains: &[String]) -> String {
    let domains = allowed_domains
        .iter()
        .map(|domain| domain.trim())
        .filter(|domain| !domain.is_empty())
        .map(|domain| format!("site:{domain}"))
        .collect::<Vec<_>>();
    if domains.is_empty() {
        query.to_string()
    } else {
        format!("{query} {}", domains.join(" OR "))
    }
}

fn normalize_query(query: &str) -> String {
    query
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn has_secret_query(url: &reqwest::Url) -> bool {
    url.query_pairs().any(|(key, _)| {
        matches!(
            key.to_ascii_lowercase().as_str(),
            "token"
                | "access_token"
                | "api_key"
                | "apikey"
                | "key"
                | "secret"
                | "password"
                | "auth"
        )
    })
}

fn domain_matches(host: &str, approved: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let approved = approved
        .trim()
        .trim_end_matches('.')
        .trim_start_matches("*.")
        .to_ascii_lowercase();
    !approved.is_empty() && (host == approved || host.ends_with(&format!(".{approved}")))
}

fn host_is_public(host: &str) -> bool {
    let normalized = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if normalized.is_empty() || normalized == "localhost" || normalized.ends_with(".localhost") {
        return false;
    }
    normalized
        .parse::<IpAddr>()
        .map(ip_is_public)
        .unwrap_or(true)
}

fn ip_is_public(ip: IpAddr) -> bool {
    match ip {
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
    }
}

fn extract_search_results(html: &str, max_results: usize) -> Vec<Value> {
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
        let href = html_attr_value(&anchor[..tag_end], "href").unwrap_or_default();
        let title = html_class_text(block, "search-snippet-title");
        let snippet = html_class_text(block, "generic-snippet");
        if !href.is_empty() && !results.iter().any(|item: &Value| item["url"] == href) {
            results.push(json!({ "title": title, "url": href, "snippet": snippet }));
        }
        rest = &rest[next_snippet..];
    }
    results
}

fn html_attr_value(tag: &str, attr: &str) -> Option<String> {
    let double_quote = format!("{attr}=\"");
    if let Some(start) = tag.find(&double_quote) {
        let rest = &tag[start + double_quote.len()..];
        return rest.find('"').map(|end| decode_html_entities(&rest[..end]));
    }
    let single_quote = format!("{attr}='");
    let start = tag.find(&single_quote)? + single_quote.len();
    let rest = &tag[start..];
    rest.find('\'')
        .map(|end| decode_html_entities(&rest[..end]))
}

fn html_class_text(value: &str, class_marker: &str) -> String {
    value
        .find(class_marker)
        .and_then(|index| value[index..].find('>').map(|start| (index, start)))
        .map(|(index, start)| &value[index + start + 1..])
        .map(|after| &after[..after.find("</div>").unwrap_or(after.len())])
        .map(|text| strip_html(&decode_html_entities(text)))
        .unwrap_or_default()
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn filter_search_results(results: Vec<Value>, grant: &CharacterWebResearchGrant) -> Vec<Value> {
    results
        .into_iter()
        .filter(|result| {
            result
                .get("url")
                .and_then(Value::as_str)
                .is_some_and(|url| web_page_url_for_grant(url, grant).is_ok())
        })
        .collect()
}

fn extract_page_text(html: &str, max_chars: usize) -> String {
    strip_html(html).chars().take(max_chars).collect()
}

fn strip_html(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::{
        extract_search_results, filter_search_results, validated_character_web_grant,
        web_page_url_for_grant,
    };
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    fn chat_with_grant() -> serde_json::Value {
        json!({
            "id": "chat-1",
            "metadata": {
                "characterWebAccessEnabled": true,
                "characterWebResearchGrant": {
                    "id": "grant-1",
                    "query": "current lunar eclipse date",
                    "allowedDomains": ["nasa.gov"],
                    "requestMessageId": "message-1",
                    "grantedAt": "2026-07-18T00:00:00.000Z",
                    "expiresAt": "2026-07-18T00:05:00.000Z"
                }
            }
        })
    }

    #[test]
    fn validates_only_the_exact_unexpired_query_and_grant() {
        let chat = chat_with_grant();
        let now = Utc.with_ymd_and_hms(2026, 7, 18, 0, 3, 0).unwrap();
        let grant =
            validated_character_web_grant(&chat, "grant-1", "current lunar eclipse date", now)
                .expect("exact grant should validate");
        assert_eq!(grant.query, "current lunar eclipse date");
        assert!(validated_character_web_grant(&chat, "grant-1", "wider query", now).is_err());
        assert!(
            validated_character_web_grant(&chat, "different-grant", &grant.query, now).is_err()
        );
    }

    #[test]
    fn rejects_expired_grants() {
        let chat = chat_with_grant();
        let now = Utc.with_ymd_and_hms(2026, 7, 18, 0, 6, 0).unwrap();
        assert!(
            validated_character_web_grant(&chat, "grant-1", "current lunar eclipse date", now)
                .is_err()
        );
    }

    #[test]
    fn rejects_private_unapproved_and_secret_page_urls() {
        let chat = chat_with_grant();
        let now = Utc.with_ymd_and_hms(2026, 7, 18, 0, 3, 0).unwrap();
        let grant =
            validated_character_web_grant(&chat, "grant-1", "current lunar eclipse date", now)
                .expect("grant should validate");
        assert!(web_page_url_for_grant("http://127.0.0.1/private", &grant).is_err());
        assert!(web_page_url_for_grant("https://example.com/outside", &grant).is_err());
        assert!(web_page_url_for_grant("https://evilnasa.gov.example/outside", &grant).is_err());
        assert!(web_page_url_for_grant("https://evilnasa.gov/outside", &grant).is_err());
        assert!(web_page_url_for_grant("https://nasa.gov/page?token=secret", &grant).is_err());
        assert_eq!(
            web_page_url_for_grant("https://science.nasa.gov/eclipse", &grant)
                .expect("approved public subdomain should pass")
                .host_str(),
            Some("science.nasa.gov")
        );
    }

    #[test]
    fn domain_scope_requires_exact_host_or_a_dot_delimited_subdomain() {
        assert!(super::domain_matches("approved", "approved"));
        assert!(super::domain_matches("docs.approved", "approved"));
        assert!(!super::domain_matches("evilapproved", "approved"));
        assert!(!super::domain_matches("approved.example", "approved"));
    }

    #[test]
    fn normalizes_unicode_compatibility_and_mixed_whitespace_for_exact_queries() {
        let mut chat = chat_with_grant();
        chat["metadata"]["characterWebResearchGrant"]["query"] =
            json!("Ｆｕｌｌ\u{00a0}Ｗｉｄｔｈ eclipse");
        let now = Utc.with_ymd_and_hms(2026, 7, 18, 0, 3, 0).unwrap();
        assert!(
            validated_character_web_grant(&chat, "grant-1", "full width\t  eclipse", now,).is_ok()
        );
    }

    #[tokio::test]
    async fn unresolved_hosts_return_a_specific_dns_error_after_retry() {
        let url = reqwest::Url::parse("https://definitely-not-a-host.invalid/page").unwrap();
        let error = super::validate_resolved_public_host(&url)
            .await
            .expect_err("reserved invalid host must not resolve");
        assert_eq!(error.code, "character_web_dns_lookup_failed");
    }

    #[test]
    fn search_results_cannot_widen_the_approved_domain_scope() {
        let chat = chat_with_grant();
        let now = Utc.with_ymd_and_hms(2026, 7, 18, 0, 3, 0).unwrap();
        let grant =
            validated_character_web_grant(&chat, "grant-1", "current lunar eclipse date", now)
                .expect("grant should validate");
        let results = filter_search_results(
            vec![
                json!({ "title": "NASA", "url": "https://science.nasa.gov/eclipse" }),
                json!({ "title": "Outside", "url": "https://example.com/eclipse" }),
                json!({ "title": "Private", "url": "http://127.0.0.1/eclipse" }),
            ],
            &grant,
        );
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["title"], "NASA");
    }

    #[test]
    fn parses_only_brave_web_result_blocks_not_asset_links() {
        let html = r#"
          <a href="https://cdn.search.brave.com/app.js">asset</a>
          <div class="snippet card" data-type="web">
            <a href="https://science.nasa.gov/eclipse">
              <div class="title search-snippet-title">Eclipse &amp; Moon</div>
              <div class="generic-snippet">Current eclipse facts.</div>
            </a>
          </div>
        "#;
        let results = extract_search_results(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["url"], "https://science.nasa.gov/eclipse");
        assert_eq!(results[0]["title"], "Eclipse & Moon");
    }
}
