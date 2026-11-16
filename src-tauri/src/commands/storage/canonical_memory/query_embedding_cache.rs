// The user's message, embedded once per reply and kept briefly for the semantic memory search.
//
// A reply embeds the user's message for Memory Recall (`llm_embed`, started as the turn starts) and then the
// semantic memory search (`memory_query_semantic`) embedded the same text again, with the same connection and
// model: two provider calls for one vector, the second on the reply's critical path (about half a second on a
// Pi). `llm_embed` keeps a single-text result here under the resolved connection, provider, model and a hash of
// the text, and the memory search uses it only when all four match. Entries expire after two minutes, so an
// edited connection is picked up on the next reply; anything else misses and is embedded as before.
//
// Memory Recall's call starts as the turn starts and the search starts moments later, so with a slow provider the
// search usually arrives while that call is still out. `llm_embed` therefore registers the call before sending it
// (`QueryEmbeddingTicket`), and the search waits for that result instead of sending the same text a second time. If
// the first call fails, the ticket is dropped and the search embeds the text itself.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::watch;

type SharedVector = Option<Arc<Vec<f64>>>;

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

/// What the cache holds for a key: a vector, a call still out (wait on it), or nothing.
pub(crate) enum QueryEmbeddingLookup {
    Ready(Arc<Vec<f64>>),
    InFlight(watch::Receiver<SharedVector>),
    Missing,
}

impl QueryEmbeddingLookup {
    /// The vector, waiting for a call still out. `None` when there is none or that call failed.
    pub(crate) async fn vector(self) -> Option<Arc<Vec<f64>>> {
        match self {
            Self::Ready(vector) => Some(vector),
            Self::InFlight(mut receiver) => receiver
                .wait_for(Option::is_some)
                .await
                .ok()
                .and_then(|value| value.clone()),
            Self::Missing => None,
        }
    }
}

#[derive(Default)]
pub(crate) struct QueryEmbeddingCache {
    /// Oldest first.
    entries: VecDeque<(QueryEmbeddingKey, Instant, Arc<Vec<f64>>)>,
    /// Calls sent and not yet answered, at most one per key.
    in_flight: Vec<(QueryEmbeddingKey, watch::Receiver<SharedVector>)>,
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

    pub(crate) fn lookup(&mut self, key: &QueryEmbeddingKey, now: Instant) -> QueryEmbeddingLookup {
        if let Some(vector) = self.get(key, now) {
            return QueryEmbeddingLookup::Ready(vector);
        }
        self.in_flight
            .iter()
            .find(|(pending_key, _)| pending_key == key)
            .map(|(_, receiver)| QueryEmbeddingLookup::InFlight(receiver.clone()))
            .unwrap_or(QueryEmbeddingLookup::Missing)
    }

    /// Keeps a usable vector only: empty or non-finite vectors are never stored. Returns whether it was kept.
    fn insert(&mut self, key: QueryEmbeddingKey, vector: Arc<Vec<f64>>, now: Instant) -> bool {
        if !usable(&vector) {
            return false;
        }
        self.entries.retain(|(stored_key, _, _)| *stored_key != key);
        self.entries.push_back((key, now, vector));
        while self.entries.len() > MAX_ENTRIES {
            self.entries.pop_front();
        }
        true
    }
}

fn usable(vector: &[f64]) -> bool {
    !vector.is_empty() && vector.iter().all(|value| value.is_finite())
}

/// A query embedding call that has been sent. Others asking for the same key wait for it; dropping the ticket
/// without completing it (the call failed) lets them embed the text themselves.
pub(crate) struct QueryEmbeddingTicket {
    cache: Arc<Mutex<QueryEmbeddingCache>>,
    key: QueryEmbeddingKey,
    sender: watch::Sender<SharedVector>,
}

impl QueryEmbeddingTicket {
    /// Registers the call, unless one for the same key is already out (then there is nothing to share).
    pub(crate) fn begin(
        cache: &Arc<Mutex<QueryEmbeddingCache>>,
        key: QueryEmbeddingKey,
    ) -> Option<Self> {
        let mut guard = cache.lock().ok()?;
        if guard
            .in_flight
            .iter()
            .any(|(pending_key, _)| *pending_key == key)
        {
            return None;
        }
        let (sender, receiver) = watch::channel(None);
        guard.in_flight.push((key.clone(), receiver));
        Some(Self {
            cache: Arc::clone(cache),
            key,
            sender,
        })
    }

    /// Stores the vector and hands it to anyone waiting. An unusable vector is neither: waiters embed for themselves.
    pub(crate) fn complete(self, vector: &[f64]) {
        let vector = Arc::new(vector.to_vec());
        let kept = self
            .cache
            .lock()
            .map(|mut cache| cache.insert(self.key.clone(), Arc::clone(&vector), Instant::now()))
            .unwrap_or(false);
        if kept {
            let _ = self.sender.send(Some(vector));
        }
    }
}

impl Drop for QueryEmbeddingTicket {
    fn drop(&mut self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache
                .in_flight
                .retain(|(pending_key, _)| *pending_key != self.key);
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
        cache.insert(key("hello there"), Arc::new(vec![0.1, 0.2]), now);

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
        cache.insert(key("old"), Arc::new(vec![1.0]), start);
        assert!(cache.get(&key("old"), start + TIME_TO_LIVE).is_none());

        for index in 0..MAX_ENTRIES + 1 {
            cache.insert(
                key(&format!("text {index}")),
                Arc::new(vec![index as f64]),
                start,
            );
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
        cache.insert(key("empty"), Arc::new(Vec::new()), now);
        cache.insert(key("nan"), Arc::new(vec![f64::NAN]), now);
        assert!(cache.get(&key("empty"), now).is_none());
        assert!(cache.get(&key("nan"), now).is_none());
    }

    #[tokio::test]
    async fn a_search_waits_for_the_call_still_out_instead_of_sending_its_own() {
        let cache = Arc::new(Mutex::new(QueryEmbeddingCache::default()));
        let ticket = QueryEmbeddingTicket::begin(&cache, key("hi")).expect("first call registers");
        // One call per key: a second one for the same text has nothing to register.
        assert!(QueryEmbeddingTicket::begin(&cache, key("hi")).is_none());

        let lookup = cache.lock().unwrap().lookup(&key("hi"), Instant::now());
        assert!(matches!(lookup, QueryEmbeddingLookup::InFlight(_)));
        let waiter = tokio::spawn(lookup.vector());
        ticket.complete(&[0.5, 0.5]);
        assert_eq!(waiter.await.unwrap().as_deref(), Some(&vec![0.5, 0.5]));

        // Done: later searches read the stored vector, and a new call may register again.
        assert!(matches!(
            cache.lock().unwrap().lookup(&key("hi"), Instant::now()),
            QueryEmbeddingLookup::Ready(_)
        ));
        assert!(QueryEmbeddingTicket::begin(&cache, key("hi")).is_some());
    }

    #[tokio::test]
    async fn a_failed_call_lets_the_waiting_search_embed_for_itself() {
        let cache = Arc::new(Mutex::new(QueryEmbeddingCache::default()));
        let ticket = QueryEmbeddingTicket::begin(&cache, key("hi")).expect("first call registers");
        let lookup = cache.lock().unwrap().lookup(&key("hi"), Instant::now());
        let waiter = tokio::spawn(lookup.vector());
        drop(ticket); // the provider call returned an error
        assert_eq!(waiter.await.unwrap(), None);
        assert!(matches!(
            cache.lock().unwrap().lookup(&key("hi"), Instant::now()),
            QueryEmbeddingLookup::Missing
        ));

        // An unusable vector counts as a failed call too.
        let ticket = QueryEmbeddingTicket::begin(&cache, key("hi")).expect("registers again");
        let waiter = tokio::spawn(
            cache
                .lock()
                .unwrap()
                .lookup(&key("hi"), Instant::now())
                .vector(),
        );
        ticket.complete(&[f64::NAN]);
        assert_eq!(waiter.await.unwrap(), None);
    }
}
