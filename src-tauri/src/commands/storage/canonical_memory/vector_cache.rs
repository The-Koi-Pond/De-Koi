// Parsed semantic vectors kept in memory between memory searches.
//
// The semantic index collection holds every memory's vector as JSON numbers, so it soon outgrows the storage
// layer's in-memory collection cache (one Pi install had 1,508 vectors in 20 MB), and each reply then re-read
// and re-parsed the whole file to find the few vectors it needed. A memory's vector only changes when the memory
// or the embedding model does, so it is kept here under exactly the fields that decide whether a stored vector
// is fresh: the embedding identity, the memory id, its `updatedAt` and its content hash. A hit is the vector a
// fresh stored row holds; anything else misses and is read from storage as before.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

/// Vectors kept at most. A 1,536-dimension vector is 12 KB, so this caps the cache near 12 MB.
const MAX_ENTRIES: usize = 1_024;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct SemanticVectorKey {
    /// Embedding connection, provider and model, joined.
    pub identity: String,
    pub memory_id: String,
    pub updated_at: String,
    pub content_hash: String,
}

#[derive(Default)]
pub(crate) struct SemanticVectorCache {
    vectors: HashMap<SemanticVectorKey, Arc<Vec<f64>>>,
    /// Insertion order, oldest first, for evicting once full.
    order: VecDeque<SemanticVectorKey>,
}

impl SemanticVectorCache {
    pub(crate) fn get(&self, key: &SemanticVectorKey) -> Option<Arc<Vec<f64>>> {
        self.vectors.get(key).cloned()
    }

    pub(crate) fn insert(&mut self, key: SemanticVectorKey, vector: Arc<Vec<f64>>) {
        if self.vectors.insert(key.clone(), vector).is_some() {
            return; // already kept: its place in the order stands
        }
        // An edited memory has a new key; its old vector is never looked up again and ages out.
        self.order.push_back(key);
        while self.order.len() > MAX_ENTRIES {
            if let Some(oldest) = self.order.pop_front() {
                self.vectors.remove(&oldest);
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.vectors.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(memory_id: &str) -> SemanticVectorKey {
        SemanticVectorKey {
            identity: "connection:openai:model".to_string(),
            memory_id: memory_id.to_string(),
            updated_at: "2026-11-12T00:00:00Z".to_string(),
            content_hash: "hash".to_string(),
        }
    }

    #[test]
    fn evicts_the_oldest_vectors_once_full() {
        let mut cache = SemanticVectorCache::default();
        for index in 0..MAX_ENTRIES + 2 {
            cache.insert(
                key(&format!("memory-{index}")),
                Arc::new(vec![index as f64]),
            );
        }
        assert_eq!(cache.len(), MAX_ENTRIES);
        assert!(cache.get(&key("memory-0")).is_none());
        assert!(cache.get(&key("memory-1")).is_none());
        assert_eq!(
            cache
                .get(&key(&format!("memory-{}", MAX_ENTRIES + 1)))
                .as_deref(),
            Some(&vec![(MAX_ENTRIES + 1) as f64])
        );
    }
}
