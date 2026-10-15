//! Fanfic research: searches the web for a fic's canon and real-world topics and returns readable text
//! from the best pages, so the outline and chapters can lean on sources instead of guesses.
//!
//! The requester opts in per fic (`metadata.fanfic.request.research`), and every page goes through the
//! same public-host checks as character web research.

use super::shared::get_required;
use super::web_research::{has_secret_query, host_is_public, validate_resolved_public_host};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

const MAX_QUERIES: usize = 5;
const MAX_QUERY_CHARS: usize = 200;
const RESULTS_PER_QUERY: usize = 5;
const PAGES_PER_QUERY: usize = 2;
const MAX_PAGES: usize = 6;
const PAGE_MAX_BYTES: usize = 1024 * 1024;
const PAGE_TEXT_CHARS: usize = 6000;
const REQUEST_TIMEOUT_SECS: u64 = 12;
const USER_AGENT: &str = "De-Koi fanfic research/1.0";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResearchRequest {
    chat_id: String,
    queries: Vec<String>,
}

pub(crate) async fn research(state: &AppState, body: Value) -> AppResult<Value> {
    let request: ResearchRequest = serde_json::from_value(body).map_err(|error| {
        AppError::invalid_input(format!("Invalid fanfic research request: {error}"))
    })?;
    let chat = get_required(state, "chats", request.chat_id.trim())?;
    ensure_research_enabled(&chat)?;
    let queries = clean_queries(&request.queries)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::new("fanfic_research_client_failed", error.to_string()))?;
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    let mut failures = Vec::new();
    for query in &queries {
        if sources.len() >= MAX_PAGES {
            break;
        }
        let results = match super::web_search::search(query, RESULTS_PER_QUERY, USER_AGENT).await {
            Ok(response) => response.results,
            Err(error) => {
                failures.push(json!({ "query": query, "error": error.message }));
                continue;
            }
        };
        let mut picked = 0;
        for result in rank_results(results) {
            if picked >= PAGES_PER_QUERY || sources.len() >= MAX_PAGES {
                break;
            }
            if !seen.insert(result.url.clone()) {
                continue;
            }
            match read_page(&client, &result.url).await {
                Ok(text) => {
                    picked += 1;
                    sources.push(json!({
                        "query": query,
                        "title": result.title,
                        "url": result.url,
                        "snippet": result.snippet,
                        "text": text,
                    }));
                }
                Err(error) => failures
                    .push(json!({ "query": query, "url": result.url, "error": error.message })),
            }
        }
    }
    Ok(json!({ "sources": sources, "failures": failures }))
}

fn ensure_research_enabled(chat: &Value) -> AppResult<()> {
    let metadata = match chat.get("metadata") {
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw).unwrap_or(Value::Null),
        Some(value) => value.clone(),
        None => Value::Null,
    };
    let is_fanfic = chat.get("mode").and_then(Value::as_str) == Some("fanfic");
    let opted_in = metadata
        .pointer("/fanfic/request/research")
        .and_then(Value::as_bool)
        == Some(true);
    if !is_fanfic || !opted_in {
        return Err(AppError::invalid_input(
            "Online research is not turned on for this fic.",
        ));
    }
    Ok(())
}

fn clean_queries(raw: &[String]) -> AppResult<Vec<String>> {
    let mut seen = HashSet::new();
    let queries: Vec<String> = raw
        .iter()
        .map(|query| {
            query
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(MAX_QUERY_CHARS)
                .collect::<String>()
        })
        .filter(|query| !query.is_empty() && seen.insert(query.to_lowercase()))
        .take(MAX_QUERIES)
        .collect();
    if queries.is_empty() {
        return Err(AppError::invalid_input("Give at least one research query."));
    }
    Ok(queries)
}

/// Reference pages first (fan wikis, Wikipedia), then everything else in the provider's order.
fn rank_results(
    results: Vec<super::web_search::WebSearchResult>,
) -> Vec<super::web_search::WebSearchResult> {
    let mut ranked: Vec<(usize, usize, super::web_search::WebSearchResult)> = results
        .into_iter()
        .enumerate()
        .map(|(index, result)| (reference_rank(&result.url), index, result))
        .collect();
    ranked.sort_by_key(|(rank, index, _)| (*rank, *index));
    ranked.into_iter().map(|(_, _, result)| result).collect()
}

fn reference_rank(url: &str) -> usize {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return 3;
    };
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    if host.ends_with("fandom.com") || host.ends_with("wiki.gg") || host.ends_with("wikipedia.org")
    {
        0
    } else if host.contains("wiki") || parsed.path().starts_with("/wiki/") {
        1
    } else {
        2
    }
}

fn page_url(raw: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(raw.trim())
        .map_err(|_| AppError::invalid_input("Research result URL is invalid."))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(AppError::invalid_input(
            "Research result URL is not a public web page.",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::invalid_input("Research result URL has no host."))?;
    if !host_is_public(host) || has_secret_query(&url) {
        return Err(AppError::invalid_input(
            "Research result URL is not a public web page.",
        ));
    }
    Ok(url)
}

async fn read_page(client: &reqwest::Client, raw_url: &str) -> AppResult<String> {
    let url = page_url(raw_url)?;
    validate_resolved_public_host(&url).await?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::new("fanfic_research_page_failed", error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::new("fanfic_research_page_status", error.to_string()))?;
    if response
        .content_length()
        .is_some_and(|length| length > PAGE_MAX_BYTES as u64)
    {
        return Err(AppError::new(
            "fanfic_research_page_too_large",
            "The page is too large to read.",
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| AppError::new("fanfic_research_page_failed", error.to_string()))?;
    let html = String::from_utf8_lossy(&bytes[..bytes.len().min(PAGE_MAX_BYTES)]);
    let text = readable_text(&html, PAGE_TEXT_CHARS);
    if text.chars().count() < 200 {
        return Err(AppError::new(
            "fanfic_research_page_empty",
            "No readable article text on the page.",
        ));
    }
    Ok(text)
}

/// Article text from an HTML page: starts at the main content when the page marks it, drops scripts,
/// styles, and page chrome, and decodes the common entities.
pub(crate) fn readable_text(html: &str, max_chars: usize) -> String {
    let lower = html.to_ascii_lowercase();
    let start = ["class=\"mw-parser-output", "<main", "<article", "<body"]
        .iter()
        .find_map(|marker| lower.find(marker))
        .map(|found| lower[..=found].rfind('<').unwrap_or(found))
        .unwrap_or(0);
    let mut body = html[start..].to_string();
    // Infobox tables and asides stay: on fan wikis they hold the most reliable canon facts.
    for tag in [
        "script", "style", "noscript", "svg", "nav", "footer", "header", "form",
    ] {
        body = remove_elements(&body, tag);
    }
    let mut text = String::with_capacity(body.len() / 2);
    let mut in_tag = false;
    for character in body.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    let decoded = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    decoded
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn remove_elements(html: &str, tag: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut output = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(found) = lower[cursor..].find(&open) {
        let begin = cursor + found;
        let next = lower.as_bytes().get(begin + open.len()).copied();
        if !matches!(next, Some(b' ' | b'>' | b'\n' | b'\t' | b'/')) {
            output.push_str(&html[cursor..begin + open.len()]);
            cursor = begin + open.len();
            continue;
        }
        output.push_str(&html[cursor..begin]);
        cursor = match lower[begin..].find(&close) {
            Some(end) => begin + end + close.len(),
            None => html.len(),
        };
    }
    output.push_str(&html[cursor..]);
    output
}

#[cfg(test)]
mod tests {
    use super::{clean_queries, ensure_research_enabled, page_url, rank_results, readable_text};
    use super::super::web_search::WebSearchResult;
    use serde_json::json;

    #[test]
    fn research_needs_a_fanfic_chat_that_opted_in() {
        let opted_in = json!({ "mode": "fanfic", "metadata": { "fanfic": { "request": { "research": true } } } });
        let stored_as_string = json!({
            "mode": "fanfic",
            "metadata": "{\"fanfic\":{\"request\":{\"research\":true}}}"
        });
        let opted_out = json!({ "mode": "fanfic", "metadata": { "fanfic": { "request": { "research": false } } } });
        let roleplay = json!({ "mode": "roleplay", "metadata": { "fanfic": { "request": { "research": true } } } });
        assert!(ensure_research_enabled(&opted_in).is_ok());
        assert!(ensure_research_enabled(&stored_as_string).is_ok());
        assert!(ensure_research_enabled(&opted_out).is_err());
        assert!(ensure_research_enabled(&roleplay).is_err());
    }

    #[test]
    fn queries_are_trimmed_deduplicated_and_capped() {
        let raw = vec![
            "  The Freak Circus   Pierrot ".to_string(),
            "the freak circus pierrot".to_string(),
            String::new(),
            "a".repeat(400),
            "q3".to_string(),
            "q4".to_string(),
            "q5".to_string(),
            "q6".to_string(),
        ];
        let queries = clean_queries(&raw).expect("queries");
        assert_eq!(queries[0], "The Freak Circus Pierrot");
        assert_eq!(queries[1].chars().count(), 200);
        assert_eq!(queries.len(), 5);
        assert!(clean_queries(&[" ".to_string()]).is_err());
    }

    #[test]
    fn reference_wikis_are_read_first() {
        let result = |url: &str| WebSearchResult {
            title: url.to_string(),
            url: url.to_string(),
            snippet: String::new(),
        };
        let ranked = rank_results(vec![
            result("https://www.reddit.com/r/thread"),
            result("https://example.com/wiki/Page"),
            result("https://thefreakcircus.fandom.com/wiki/Pierrot"),
        ]);
        assert_eq!(
            ranked[0].url,
            "https://thefreakcircus.fandom.com/wiki/Pierrot"
        );
        assert_eq!(ranked[1].url, "https://example.com/wiki/Page");
    }

    #[test]
    fn private_and_secret_urls_are_never_read() {
        assert!(page_url("http://127.0.0.1/admin").is_err());
        assert!(page_url("http://localhost:7860/").is_err());
        assert!(page_url("file:///etc/passwd").is_err());
        assert!(page_url("https://user:pw@example.com/").is_err());
        assert!(page_url("https://example.com/page?token=abc").is_err());
        assert!(page_url("https://dbd.fandom.com/wiki/The_Shape").is_ok());
    }

    #[test]
    fn readable_text_keeps_the_article_and_drops_page_chrome() {
        let html = r#"<html><head><style>.x{color:red}</style><script>var a = 1;</script></head>
            <body><nav>Home | Wiki</nav><div class="mw-parser-output"><p>Pierrot is a clown &amp; performer.</p>
            <aside class="portable-infobox"><h3>Eyes</h3><div>Gold</div></aside><script>track()</script><p>He cooks brigadeiros.</p></div>
            <footer>Fandom footer</footer></body></html>"#;
        let text = readable_text(html, 500);
        assert_eq!(
            text,
            "Pierrot is a clown & performer. Eyes Gold He cooks brigadeiros."
        );
    }
}
