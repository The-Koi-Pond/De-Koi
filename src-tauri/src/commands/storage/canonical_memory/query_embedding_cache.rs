// The user's message, embedded once per reply and kept briefly for the semantic memory search.
//
// A reply embeds the user's message for Memory Recall (`llm_embed`, started as the turn starts) and then the
// semantic memory search (`memory_query_semantic`) embedded the same text again, with the same connection and
// model: two provider calls for one vector, the second on the reply's critical path (about half a second on a
// Pi). `llm_embed` keeps a single-text result here under the resolved connection, provider, model and a hash of
// the text, and the memory search uses it only when all four match. Entries expire after two minutes, so an
// edited connection is picked up on the next reply; anything else misses and is embedded as before.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Recent query vectors kept at most: a few replies' worth across chats.
const MAX_ENTRIES: usize = 16;
const TIME_TO_LIVE: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct QueryEmbeddingKey {
    connection_id: String,
    provider: String,
    model: String,
    text_hash: String,
}

impl QueryEmbeddingKey {
    /// `provider` is the connection's raw provider field; empty means OpenAI-compatible, as the memory search reads it.
    pub(crate) fn new(connection_id: &str, provider: &str, model: &str, text: &str) -> Self {
        let provider = provider.trim();
        Self {
            connection_id: connection_id.to_string(),
            provider: if provider.is_empty() {
                "openai".to_string()
            } else {
                provider.to_string()
            },
            model: model.to_string(),
            text_hash: super::sha256_hash(text),
        }
    }
}

#[derive(Default)]
pub(crate) struct QueryEmbeddingCache {
    /// Oldest first.
    entries: VecDeque<(QueryEmbeddingKey, Instant, Arc<Vec<f64>>)>,
}

impl QueryEmbeddingCache {
    pub(crate) fn get(&mut self, key: &QueryEmbeddingKey, now: Instant) -> Option<Arc<Vec<f64>>> {
        self.entries
            .retain(|(_, stored_at, _)| now.saturating_duration_since(*stored_at) < TIME_TO_LIVE);
        self.entries
            .iter()
            .find(|(stored_key, _, _)| stored_key == key)
            .map(|(_, _, vector)| Arc::clone(vector))
    }

    /// Keeps a usable vector only: empty or non-finite vectors are never stored.
    pub(crate) fn insert(&mut self, key: QueryEmbeddingKey, vector: Vec<f64>, now: Instant) {
        if vector.is_empty() || vector.iter().any(|value| !value.is_finite()) {
            return;
        }
        self.entries.retain(|(stored_key, _, _)| *stored_key != key);
        self.entries.push_back((key, now, Arc::new(vector)));
        while self.entries.len() > MAX_ENTRIES {
            self.entries.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(text: &str) -> QueryEmbeddingKey {
        QueryEmbeddingKey::new("embed-connection", "", "text-embedding-3-small", text)
    }

    #[test]
    fn a_hit_needs_the_same_connection_provider_model_and_text() {
        let mut cache = QueryEmbeddingCache::default();
        let now = Instant::now();
        cache.insert(key("hello there"), vec![0.1, 0.2], now);

        assert_eq!(
            cache.get(&key("hello there"), now).as_deref(),
            Some(&vec![0.1, 0.2])
        );
        // An empty provider is OpenAI-compatible, as the memory search reads it.
        let explicit = QueryEmbeddingKey::new(
            "embed-connection",
            "openai",
            "text-embedding-3-small",
            "hello there",
        );
        assert!(cache.get(&explicit, now).is_some());
        for other in [
            key("hello there!"),
            QueryEmbeddingKey::new(
                "other-connection",
                "",
                "text-embedding-3-small",
                "hello there",
            ),
            QueryEmbeddingKey::new(
                "embed-connection",
                "google",
                "text-embedding-3-small",
                "hello there",
            ),
            QueryEmbeddingKey::new(
                "embed-connection",
                "",
                "text-embedding-3-large",
                "hello there",
            ),
        ] {
            assert!(cache.get(&other, now).is_none(), "{other:?} must miss");
        }
    }

    #[test]
    fn entries_expire_and_the_oldest_go_first_once_full() {
        let mut cache = QueryEmbeddingCache::default();
        let start = Instant::now();
        cache.insert(key("old"), vec![1.0], start);
        assert!(cache.get(&key("old"), start + TIME_TO_LIVE).is_none());

        for index in 0..MAX_ENTRIES + 1 {
            cache.insert(key(&format!("text {index}")), vec![index as f64], start);
        }
        assert!(cache.get(&key("text 0"), start).is_none());
        assert!(cache
            .get(&key(&format!("text {MAX_ENTRIES}")), start)
            .is_some());
    }

    #[test]
    fn unusable_vectors_are_not_kept() {
        let mut cache = QueryEmbeddingCache::default();
        let now = Instant::now();
        cache.insert(key("empty"), Vec::new(), now);
        cache.insert(key("nan"), vec![f64::NAN], now);
        assert!(cache.get(&key("empty"), now).is_none());
        assert!(cache.get(&key("nan"), now).is_none());
    }
}
