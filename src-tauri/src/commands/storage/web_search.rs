use marinara_core::{AppError, AppResult};
use reqwest::Url;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const THROTTLE_COOLDOWN: Duration = Duration::from_secs(60);
const PROVIDERS: [WebSearchProvider; 2] = [WebSearchProvider::Brave, WebSearchProvider::Bing];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum WebSearchProvider {
    Brave,
    Bing,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Clone, Debug)]
pub(crate) struct WebSearchResponse {
    pub provider: WebSearchProvider,
    pub results: Vec<WebSearchResult>,
}

#[derive(Clone, Debug)]
struct ProviderHttpResponse {
    status: u16,
    body: String,
}

pub(crate) async fn search(
    query: &str,
    max_results: usize,
    user_agent: &str,
) -> AppResult<WebSearchResponse> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(user_agent)
        .redirect(reqwest::redirect::Policy::limited(4))
        .build()
        .map_err(|error| AppError::new("web_search_client_failed", error.to_string()))?;
    search_with_fetcher(
        query,
        max_results,
        provider_cooldowns(),
        move |_provider, url| {
            let client = client.clone();
            async move {
                let response = client
                    .get(url)
                    .send()
                    .await
                    .map_err(|error| error.to_string())?;
                let status = response.status().as_u16();
                let body = response.text().await.map_err(|error| error.to_string())?;
                Ok(ProviderHttpResponse { status, body })
            }
        },
    )
    .await
}

async fn search_with_fetcher<F, Fut>(
    query: &str,
    max_results: usize,
    cooldowns: &Mutex<HashMap<WebSearchProvider, Instant>>,
    mut fetch: F,
) -> AppResult<WebSearchResponse>
where
    F: FnMut(WebSearchProvider, Url) -> Fut,
    Fut: Future<Output = Result<ProviderHttpResponse, String>>,
{
    let now = Instant::now();
    for provider in PROVIDERS {
        if provider_is_cooling_down(cooldowns, provider, now) {
            continue;
        }
        let url = provider_url(provider, query)?;
        let response = match fetch(provider, url).await {
            Ok(response) => response,
            Err(error) => {
                log::warn!(
                    "[web-search] {} request failed; trying another provider: {error}",
                    provider.name()
                );
                continue;
            }
        };
        if response.status == 429 {
            mark_provider_throttled(cooldowns, provider, now);
            log::warn!(
                "[web-search] {} returned 429; trying another provider",
                provider.name()
            );
            continue;
        }
        if !(200..300).contains(&response.status) {
            log::warn!(
                "[web-search] {} returned HTTP {}; trying another provider",
                provider.name(),
                response.status
            );
            continue;
        }
        let results = provider.parse(&response.body, max_results.max(1));
        if results.is_empty() {
            log::warn!(
                "[web-search] {} returned no parseable results; trying another provider",
                provider.name()
            );
            continue;
        }
        clear_provider_cooldown(cooldowns, provider);
        log::info!("[web-search] {} served the search", provider.name());
        return Ok(WebSearchResponse { provider, results });
    }
    Err(AppError::new(
        "web_search_providers_exhausted",
        "No web search provider returned usable results.",
    ))
}

impl WebSearchProvider {
    fn name(self) -> &'static str {
        match self {
            Self::Brave => "brave",
            Self::Bing => "bing",
        }
    }

    fn parse(self, html: &str, max_results: usize) -> Vec<WebSearchResult> {
        match self {
            Self::Brave => extract_brave_results(html, max_results),
            Self::Bing => extract_bing_results(html, max_results),
        }
    }
}

fn provider_url(provider: WebSearchProvider, query: &str) -> AppResult<Url> {
    let endpoint = match provider {
        WebSearchProvider::Brave => "https://search.brave.com/search",
        WebSearchProvider::Bing => "https://www.bing.com/search",
    };
    Url::parse_with_params(endpoint, &[("q", query)])
        .map_err(|error| AppError::new("web_search_invalid_url", error.to_string()))
}

fn provider_cooldowns() -> &'static Mutex<HashMap<WebSearchProvider, Instant>> {
    static COOLDOWNS: OnceLock<Mutex<HashMap<WebSearchProvider, Instant>>> = OnceLock::new();
    COOLDOWNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn provider_is_cooling_down(
    cooldowns: &Mutex<HashMap<WebSearchProvider, Instant>>,
    provider: WebSearchProvider,
    now: Instant,
) -> bool {
    cooldowns
        .lock()
        .expect("web search cooldown lock")
        .get(&provider)
        .is_some_and(|until| *until > now)
}

fn mark_provider_throttled(
    cooldowns: &Mutex<HashMap<WebSearchProvider, Instant>>,
    provider: WebSearchProvider,
    now: Instant,
) {
    cooldowns
        .lock()
        .expect("web search cooldown lock")
        .insert(provider, now + THROTTLE_COOLDOWN);
}

fn clear_provider_cooldown(
    cooldowns: &Mutex<HashMap<WebSearchProvider, Instant>>,
    provider: WebSearchProvider,
) {
    cooldowns
        .lock()
        .expect("web search cooldown lock")
        .remove(&provider);
}

fn extract_bing_results(html: &str, max_results: usize) -> Vec<WebSearchResult> {
    let mut results = Vec::new();
    let mut rest = html;
    while results.len() < max_results {
        let Some(result_start) = rest.find("<li class=\"b_algo") else {
            break;
        };
        rest = &rest[result_start..];
        let next_result = rest["<li class=\"b_algo".len()..]
            .find("<li class=\"b_algo")
            .map(|index| index + "<li class=\"b_algo".len())
            .unwrap_or(rest.len());
        let block = &rest[..next_result];
        let Some(heading_start) = block.find("<h2") else {
            rest = &rest[next_result..];
            continue;
        };
        let heading = &block[heading_start..];
        let Some(anchor_start) = heading.find("<a") else {
            rest = &rest[next_result..];
            continue;
        };
        let anchor = &heading[anchor_start..];
        let Some(tag_end) = anchor.find('>') else {
            rest = &rest[next_result..];
            continue;
        };
        let href = html_attr_value(&anchor[..tag_end], "href").unwrap_or_default();
        let title = anchor[tag_end + 1..]
            .find("</a>")
            .map(|end| {
                strip_html(&decode_html_entities(
                    &anchor[tag_end + 1..tag_end + 1 + end],
                ))
            })
            .unwrap_or_default();
        let snippet = block
            .find("<div class=\"b_caption")
            .map(|index| &block[index..])
            .and_then(|caption| caption.find("<p").map(|index| &caption[index..]))
            .and_then(|paragraph| paragraph.find('>').map(|index| &paragraph[index + 1..]))
            .and_then(|paragraph| paragraph.find("</p>").map(|index| &paragraph[..index]))
            .map(|value| strip_html(&decode_html_entities(value)))
            .unwrap_or_default();
        if !href.is_empty()
            && !results
                .iter()
                .any(|result: &WebSearchResult| result.url == href)
        {
            results.push(WebSearchResult {
                title,
                url: href,
                snippet,
            });
        }
        rest = &rest[next_result..];
    }
    results
}

fn extract_brave_results(html: &str, max_results: usize) -> Vec<WebSearchResult> {
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
        if !href.is_empty()
            && !results
                .iter()
                .any(|result: &WebSearchResult| result.url == href)
        {
            results.push(WebSearchResult {
                title,
                url: href,
                snippet,
            });
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
        extract_bing_results, extract_brave_results, search_with_fetcher, ProviderHttpResponse,
        WebSearchProvider,
    };
    use std::collections::{HashMap, VecDeque};
    use std::sync::{Arc, Mutex};

    const BING_FIXTURE: &str = r#"
      <ol id="b_results">
        <li class="b_algo" data-id="SERP.1">
          <h2><a href="https://www.nasa.gov/gateway/">NASA Gateway</a></h2>
          <div class="b_caption"><p>Latest Gateway mission information.</p></div>
        </li>
      </ol>
    "#;
    const BRAVE_FIXTURE: &str = r#"
      <a href="https://cdn.search.brave.com/app.js">asset</a>
      <div class="snippet card" data-type="web">
        <a href="https://science.nasa.gov/eclipse">
          <div class="title search-snippet-title">Eclipse &amp; Moon</div>
          <div class="generic-snippet">Current eclipse facts.</div>
        </a>
      </div>
    "#;

    #[test]
    fn parses_bing_result_blocks() {
        let results = extract_bing_results(BING_FIXTURE, 4);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "NASA Gateway");
        assert_eq!(results[0].url, "https://www.nasa.gov/gateway/");
        assert_eq!(results[0].snippet, "Latest Gateway mission information.");
    }

    #[test]
    fn parses_only_brave_web_result_blocks() {
        let results = extract_brave_results(BRAVE_FIXTURE, 4);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Eclipse & Moon");
        assert_eq!(results[0].url, "https://science.nasa.gov/eclipse");
        assert_eq!(results[0].snippet, "Current eclipse facts.");
    }

    #[tokio::test]
    async fn throttled_brave_falls_through_to_bing() {
        let responses = Arc::new(Mutex::new(VecDeque::from([
            (
                WebSearchProvider::Brave,
                ProviderHttpResponse {
                    status: 429,
                    body: String::new(),
                },
            ),
            (
                WebSearchProvider::Bing,
                ProviderHttpResponse {
                    status: 200,
                    body: BING_FIXTURE.to_string(),
                },
            ),
        ])));
        let cooldowns = Mutex::new(HashMap::new());

        let response = search_with_fetcher(
            "NASA Gateway latest",
            4,
            &cooldowns,
            move |provider, _url| {
                let responses = Arc::clone(&responses);
                Box::pin(async move {
                    let (expected_provider, response) = responses
                        .lock()
                        .expect("response queue lock")
                        .pop_front()
                        .expect("scripted response");
                    assert_eq!(provider, expected_provider);
                    Ok(response)
                })
            },
        )
        .await
        .expect("Bing fallback should succeed");

        assert_eq!(response.provider, WebSearchProvider::Bing);
        assert_eq!(response.results[0].url, "https://www.nasa.gov/gateway/");
    }

    #[tokio::test]
    async fn skips_a_provider_during_its_throttle_cooldown() {
        let cooldowns = Mutex::new(HashMap::new());
        let first_responses = Arc::new(Mutex::new(VecDeque::from([
            (
                WebSearchProvider::Brave,
                ProviderHttpResponse {
                    status: 429,
                    body: String::new(),
                },
            ),
            (
                WebSearchProvider::Bing,
                ProviderHttpResponse {
                    status: 200,
                    body: BING_FIXTURE.to_string(),
                },
            ),
        ])));
        search_with_fetcher(
            "NASA Gateway latest",
            4,
            &cooldowns,
            move |provider, _url| {
                let responses = Arc::clone(&first_responses);
                Box::pin(async move {
                    let (expected_provider, response) = responses
                        .lock()
                        .expect("first response queue lock")
                        .pop_front()
                        .expect("first scripted response");
                    assert_eq!(provider, expected_provider);
                    Ok(response)
                })
            },
        )
        .await
        .expect("initial fallback should succeed");

        let seen = Arc::new(Mutex::new(Vec::new()));
        let response = search_with_fetcher("NASA Gateway latest", 4, &cooldowns, {
            let seen = Arc::clone(&seen);
            move |provider, _url| {
                seen.lock().expect("seen provider lock").push(provider);
                Box::pin(async move {
                    Ok(ProviderHttpResponse {
                        status: 200,
                        body: BING_FIXTURE.to_string(),
                    })
                })
            }
        })
        .await
        .expect("cooldown search should succeed");

        assert_eq!(
            seen.lock().expect("seen provider lock").as_slice(),
            &[WebSearchProvider::Bing]
        );
        assert_eq!(response.provider, WebSearchProvider::Bing);
    }

    #[tokio::test]
    async fn server_error_falls_through_to_the_next_provider() {
        let responses = Arc::new(Mutex::new(VecDeque::from([
            (
                WebSearchProvider::Brave,
                ProviderHttpResponse {
                    status: 500,
                    body: BRAVE_FIXTURE.to_string(),
                },
            ),
            (
                WebSearchProvider::Bing,
                ProviderHttpResponse {
                    status: 200,
                    body: BING_FIXTURE.to_string(),
                },
            ),
        ])));
        let cooldowns = Mutex::new(HashMap::new());

        let response = search_with_fetcher(
            "NASA Gateway latest",
            4,
            &cooldowns,
            move |provider, _url| {
                let responses = Arc::clone(&responses);
                Box::pin(async move {
                    let (expected_provider, response) = responses
                        .lock()
                        .expect("response queue lock")
                        .pop_front()
                        .expect("scripted response");
                    assert_eq!(provider, expected_provider);
                    Ok(response)
                })
            },
        )
        .await
        .expect("Bing fallback should succeed");

        assert_eq!(response.provider, WebSearchProvider::Bing);
    }

    #[tokio::test]
    async fn transport_error_falls_through_to_the_next_provider() {
        let calls = Arc::new(Mutex::new(0usize));
        let cooldowns = Mutex::new(HashMap::new());

        let response = search_with_fetcher("NASA Gateway latest", 4, &cooldowns, {
            let calls = Arc::clone(&calls);
            move |provider, _url| {
                let calls = Arc::clone(&calls);
                Box::pin(async move {
                    let mut calls = calls.lock().expect("call count lock");
                    *calls += 1;
                    if provider == WebSearchProvider::Brave {
                        Err("request timed out".to_string())
                    } else {
                        Ok(ProviderHttpResponse {
                            status: 200,
                            body: BING_FIXTURE.to_string(),
                        })
                    }
                })
            }
        })
        .await
        .expect("Bing fallback should succeed");

        assert_eq!(*calls.lock().expect("call count lock"), 2);
        assert_eq!(response.provider, WebSearchProvider::Bing);
    }

    #[tokio::test]
    async fn empty_or_unrecognized_markup_falls_through_to_the_next_provider() {
        let responses = Arc::new(Mutex::new(VecDeque::from([
            (
                WebSearchProvider::Brave,
                ProviderHttpResponse {
                    status: 200,
                    body: "<html><div>interstitial</div></html>".to_string(),
                },
            ),
            (
                WebSearchProvider::Bing,
                ProviderHttpResponse {
                    status: 200,
                    body: BING_FIXTURE.to_string(),
                },
            ),
        ])));
        let cooldowns = Mutex::new(HashMap::new());

        let response = search_with_fetcher(
            "NASA Gateway latest",
            4,
            &cooldowns,
            move |provider, _url| {
                let responses = Arc::clone(&responses);
                Box::pin(async move {
                    let (expected_provider, response) = responses
                        .lock()
                        .expect("response queue lock")
                        .pop_front()
                        .expect("scripted response");
                    assert_eq!(provider, expected_provider);
                    Ok(response)
                })
            },
        )
        .await
        .expect("Bing fallback should succeed");

        assert_eq!(response.provider, WebSearchProvider::Bing);
        assert_eq!(response.results.len(), 1);
    }

    #[tokio::test]
    async fn exhausted_providers_return_one_provider_neutral_error() {
        let cooldowns = Mutex::new(HashMap::new());
        let error = search_with_fetcher("NASA Gateway latest", 4, &cooldowns, |_provider, _url| {
            Box::pin(async {
                Ok(ProviderHttpResponse {
                    status: 503,
                    body: String::new(),
                })
            })
        })
        .await
        .expect_err("all-provider failure should be explicit");

        assert_eq!(error.code, "web_search_providers_exhausted");
        assert_eq!(
            error.message,
            "No web search provider returned usable results."
        );
    }
}
