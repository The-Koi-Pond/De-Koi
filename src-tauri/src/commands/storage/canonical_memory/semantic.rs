use super::{batch_queries, query_memories_batch, read_string, sha256_hash, INDEX_COLLECTION};
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

const DEFAULT_SIMILARITY_THRESHOLD: f64 = 0.28;
const DEFAULT_RESULT_LIMIT: usize = 24;
const MAX_RESULT_LIMIT: usize = 60;
const MAX_SEMANTIC_CANDIDATES: usize = 60;

#[derive(Clone, Debug, Eq, PartialEq)]
struct SemanticIndexIdentity {
    connection_id: String,
    provider: String,
    model: String,
}

#[derive(Debug)]
struct SemanticIndexPlan {
    cached_vectors: HashMap<String, Vec<f64>>,
    missing_memory_ids: Vec<String>,
}

fn require_body_string(body: &Value, key: &str) -> AppResult<String> {
    let value = read_string(body.get(key));
    if value.is_empty() {
        return Err(AppError::invalid_input(format!(
            "semantic memory query {key} is required"
        )));
    }
    Ok(value)
}

fn vector_from_value(value: Option<&Value>) -> Option<Vec<f64>> {
    let values = value?.as_array()?;
    if values.is_empty() {
        return None;
    }
    values.iter().map(Value::as_f64).collect()
}

fn semantic_index_row(
    memory: &Value,
    identity: &SemanticIndexIdentity,
    vector: Vec<f64>,
) -> AppResult<Value> {
    if vector.is_empty() || vector.iter().any(|value| !value.is_finite()) {
        return Err(AppError::new(
            "embedding_error",
            "Embedding provider returned an invalid vector",
        ));
    }
    let memory_id = read_string(memory.get("id"));
    let content = read_string(memory.get("content"));
    let canonical_updated_at = read_string(memory.get("updatedAt"));
    if memory_id.is_empty() || content.is_empty() || canonical_updated_at.is_empty() {
        return Err(AppError::invalid_input(
            "Canonical memory semantic indexing requires id, content, and updatedAt",
        ));
    }
    let content_hash = sha256_hash(&content);
    let identity_hash = sha256_hash(&format!(
        "{}:{}:{}",
        identity.connection_id, identity.provider, identity.model
    ));
    let projection_hash = sha256_hash(&format!("{identity_hash}:{content_hash}"));
    Ok(json!({
        "id": format!("{memory_id}:semantic:{identity_hash}"),
        "memoryId": memory_id,
        "connectionId": identity.connection_id,
        "provider": identity.provider,
        "model": identity.model,
        "dimensions": vector.len(),
        "contentHash": content_hash,
        "projectionHash": projection_hash,
        "canonicalUpdatedAt": canonical_updated_at,
        "vector": vector
    }))
}

fn semantic_row_matches_identity(row: &Value, identity: &SemanticIndexIdentity) -> bool {
    read_string(row.get("connectionId")) == identity.connection_id
        && read_string(row.get("provider")) == identity.provider
        && read_string(row.get("model")) == identity.model
}

fn semantic_index_rows_for_candidates(
    state: &AppState,
    memories: &[Value],
    identity: &SemanticIndexIdentity,
) -> AppResult<Vec<Value>> {
    let memory_ids = memories
        .iter()
        .map(|memory| read_string(memory.get("id")))
        .filter(|memory_id| !memory_id.is_empty())
        .collect::<HashSet<_>>();
    let mut rows = Vec::new();
    state.storage.visit_collection_rows_where_in(
        INDEX_COLLECTION,
        "memoryId",
        &memory_ids,
        &mut |row| {
            if semantic_row_matches_identity(row, identity) {
                rows.push(row.clone());
            }
            Ok(())
        },
    )?;
    Ok(rows)
}

fn semantic_index_plan(
    memories: &[Value],
    index_rows: &[Value],
    identity: &SemanticIndexIdentity,
    expected_dimensions: usize,
) -> SemanticIndexPlan {
    let mut rows_by_memory_id: HashMap<String, Vec<&Value>> = HashMap::new();
    for row in index_rows {
        if !semantic_row_matches_identity(row, identity) {
            continue;
        }
        let memory_id = read_string(row.get("memoryId"));
        if !memory_id.is_empty() {
            rows_by_memory_id.entry(memory_id).or_default().push(row);
        }
    }
    let mut cached_vectors = HashMap::new();
    let mut missing_memory_ids = Vec::new();
    for memory in memories {
        let memory_id = read_string(memory.get("id"));
        let content_hash = sha256_hash(&read_string(memory.get("content")));
        let updated_at = read_string(memory.get("updatedAt"));
        let fresh = rows_by_memory_id.get(&memory_id).and_then(|rows| {
            rows.iter().find_map(|row| {
                (read_string(row.get("canonicalUpdatedAt")) == updated_at
                    && read_string(row.get("contentHash")) == content_hash)
                    .then(|| vector_from_value(row.get("vector")))
                    .flatten()
                    .filter(|vector| vector.len() == expected_dimensions)
            })
        });
        if let Some(vector) = fresh {
            cached_vectors.insert(memory_id, vector);
        } else if !memory_id.is_empty() {
            missing_memory_ids.push(memory_id);
        }
    }
    SemanticIndexPlan {
        cached_vectors,
        missing_memory_ids,
    }
}

fn cosine_similarity(left: &[f64], right: &[f64]) -> Option<f64> {
    if left.is_empty() || left.len() != right.len() {
        return None;
    }
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (left_value, right_value) in left.iter().zip(right) {
        if !left_value.is_finite() || !right_value.is_finite() {
            return None;
        }
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }
    if left_norm <= f64::EPSILON || right_norm <= f64::EPSILON {
        return None;
    }
    Some(dot / (left_norm.sqrt() * right_norm.sqrt()))
}

fn rank_semantic_matches(
    memories: &[Value],
    vectors: &HashMap<String, Vec<f64>>,
    query_vector: &[f64],
    identity: &SemanticIndexIdentity,
    threshold: f64,
    limit: usize,
) -> Vec<Value> {
    let mut matches = memories
        .iter()
        .filter_map(|memory| {
            let memory_id = read_string(memory.get("id"));
            let similarity = cosine_similarity(query_vector, vectors.get(&memory_id)?)?;
            (similarity >= threshold).then(|| {
                json!({
                    "memory": memory,
                    "similarity": similarity,
                    "connectionId": identity.connection_id,
                    "provider": identity.provider,
                    "model": identity.model
                })
            })
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        right["similarity"]
            .as_f64()
            .partial_cmp(&left["similarity"].as_f64())
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                read_string(left["memory"].get("id")).cmp(&read_string(right["memory"].get("id")))
            })
    });
    matches.truncate(limit);
    matches
}

fn select_semantic_candidates(mut memories: Vec<Value>) -> Vec<Value> {
    memories.sort_by(|left, right| {
        (read_string(right.get("status")) == "pinned")
            .cmp(&(read_string(left.get("status")) == "pinned"))
            .then_with(|| {
                read_string(right.get("updatedAt")).cmp(&read_string(left.get("updatedAt")))
            })
            .then_with(|| read_string(left.get("id")).cmp(&read_string(right.get("id"))))
    });
    memories.truncate(MAX_SEMANTIC_CANDIDATES);
    memories
}

fn replace_semantic_index_rows(
    state: &AppState,
    identity: &SemanticIndexIdentity,
    rows: Vec<Value>,
) -> AppResult<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let identity = identity.clone();
    state
        .storage
        .update_collections_atomically(vec![INDEX_COLLECTION], move |collections| {
            let stored = collections[0].rows_mut();
            for row in &rows {
                let memory_id = read_string(row.get("memoryId"));
                stored.retain(|candidate| {
                    read_string(candidate.get("memoryId")) != memory_id
                        || !semantic_row_matches_identity(candidate, &identity)
                });
                stored.push(row.clone());
            }
            Ok(())
        })
}

pub(crate) async fn query_memories_semantic(state: &AppState, body: Value) -> AppResult<Value> {
    let body = Value::Object(marinara_core::ensure_object(body)?);
    let query_text = require_body_string(&body, "queryText")?;
    let requested_connection_id = require_body_string(&body, "connectionId")?;
    let queries = batch_queries(json!({
        "queries": body.get("queries").cloned().unwrap_or(Value::Null)
    }))?;
    if queries.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let limit = body
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_RESULT_LIMIT)
        .clamp(1, MAX_RESULT_LIMIT);
    let threshold = body
        .get("similarityThreshold")
        .and_then(Value::as_f64)
        .unwrap_or(DEFAULT_SIMILARITY_THRESHOLD);
    if !(0.0..=1.0).contains(&threshold) {
        return Err(AppError::invalid_input(
            "semantic memory similarityThreshold must be between 0 and 1",
        ));
    }
    let memories = query_memories_batch(state, json!({ "queries": queries }))?
        .as_array()
        .cloned()
        .map(select_semantic_candidates)
        .unwrap_or_default();
    if memories.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }

    let (connection_id, connection) =
        super::super::prompts::resolve_embedding_connection_for_id_async(
            state,
            &requested_connection_id,
        )
        .await?;
    let model = read_string(connection.get("embeddingModel"));
    if model.is_empty() {
        return Err(AppError::invalid_input(format!(
            "Embedding connection {connection_id} is missing an embeddingModel"
        )));
    }
    let provider = read_string(connection.get("provider"));
    let identity = SemanticIndexIdentity {
        connection_id,
        provider: if provider.is_empty() {
            "openai".to_string()
        } else {
            provider
        },
        model,
    };
    let index_rows = semantic_index_rows_for_candidates(state, &memories, &identity)?;
    let mut query_embeddings =
        super::super::prompts::embed_texts(&connection, &identity.model, &[query_text.as_str()])
            .await?;
    if query_embeddings.len() != 1 {
        return Err(AppError::new(
            "embedding_error",
            "Embedding provider returned a mismatched query vector count",
        ));
    }
    let query_vector = query_embeddings.remove(0);
    if query_vector.is_empty() || query_vector.iter().any(|value| !value.is_finite()) {
        return Err(AppError::new(
            "embedding_error",
            "Embedding provider returned an invalid query vector",
        ));
    }
    let dimensions = query_vector.len();
    let plan = semantic_index_plan(&memories, &index_rows, &identity, dimensions);
    let by_id = memories
        .iter()
        .map(|memory| (read_string(memory.get("id")), memory))
        .collect::<HashMap<_, _>>();
    let missing_memories = plan
        .missing_memory_ids
        .iter()
        .filter_map(|memory_id| by_id.get(memory_id).copied())
        .collect::<Vec<_>>();
    let texts = missing_memories
        .iter()
        .map(|memory| {
            memory
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default()
        })
        .collect::<Vec<_>>();
    let embeddings = if texts.is_empty() {
        Vec::new()
    } else {
        super::super::prompts::embed_texts(&connection, &identity.model, &texts).await?
    };
    if embeddings.len() != texts.len() {
        return Err(AppError::new(
            "embedding_error",
            "Embedding provider returned a mismatched vector count",
        ));
    }
    let mut vectors = plan.cached_vectors;
    let mut new_rows = Vec::with_capacity(missing_memories.len());
    for (memory, vector) in missing_memories.into_iter().zip(embeddings) {
        if vector.len() != dimensions {
            return Err(AppError::new(
                "embedding_error",
                "Embedding provider returned inconsistent vector dimensions",
            ));
        }
        let memory_id = read_string(memory.get("id"));
        new_rows.push(semantic_index_row(memory, &identity, vector.clone())?);
        vectors.insert(memory_id, vector);
    }
    replace_semantic_index_rows(state, &identity, new_rows)?;
    Ok(Value::Array(rank_semantic_matches(
        &memories,
        &vectors,
        &query_vector,
        &identity,
        threshold,
        limit,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::json;
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    fn semantic_test_state(label: &str) -> (AppState, std::path::PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("de-koi-semantic-index-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).unwrap();
        }
        let state = AppState::from_data_dir(path.clone(), Vec::new()).unwrap();
        (state, path)
    }

    #[test]
    fn semantic_index_rows_for_candidates_excludes_unrelated_rows_before_cloning() {
        let (state, data_dir) = semantic_test_state("targeted-read");
        let identity = SemanticIndexIdentity {
            connection_id: "embedding-connection".to_string(),
            provider: "openai".to_string(),
            model: "text-embedding-3-small".to_string(),
        };
        for (id, memory_id, connection_id, provider, model) in [
            (
                "candidate-valid",
                "candidate",
                "embedding-connection",
                "openai",
                "text-embedding-3-small",
            ),
            (
                "other-memory",
                "not-a-candidate",
                "embedding-connection",
                "openai",
                "text-embedding-3-small",
            ),
            (
                "other-connection",
                "candidate",
                "different-connection",
                "openai",
                "text-embedding-3-small",
            ),
            (
                "other-provider",
                "candidate",
                "embedding-connection",
                "cohere",
                "text-embedding-3-small",
            ),
            (
                "other-model",
                "candidate",
                "embedding-connection",
                "openai",
                "text-embedding-ada-002",
            ),
        ] {
            state
                .storage
                .upsert_with_id(
                    INDEX_COLLECTION,
                    id,
                    json!({
                        "memoryId": memory_id,
                        "connectionId": connection_id,
                        "provider": provider,
                        "model": model,
                        "vector": [1.0, 0.0]
                    }),
                )
                .unwrap();
        }
        let memories = vec![json!({
            "id": "candidate",
            "content": "Candidate fact",
            "updatedAt": "2026-08-05T10:00:00Z"
        })];

        let rows = semantic_index_rows_for_candidates(&state, &memories, &identity).unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], json!("candidate-valid"));
        assert_eq!(rows[0]["memoryId"], json!("candidate"));
        drop(state);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn semantic_index_plan_keeps_the_first_fresh_valid_row_per_memory() {
        let identity = SemanticIndexIdentity {
            connection_id: "embedding-connection".to_string(),
            provider: "openai".to_string(),
            model: "text-embedding-3-small".to_string(),
        };
        let memories = vec![json!({
            "id": "candidate",
            "content": "Candidate fact",
            "updatedAt": "2026-08-05T10:00:00Z"
        })];
        let rows = vec![
            json!({
                "memoryId": "candidate",
                "connectionId": "embedding-connection",
                "provider": "openai",
                "model": "text-embedding-3-small",
                "canonicalUpdatedAt": "2026-08-04T10:00:00Z",
                "contentHash": "stale",
                "vector": [0.5, 0.5]
            }),
            semantic_index_row(&memories[0], &identity, vec![1.0, 0.0]).unwrap(),
            semantic_index_row(&memories[0], &identity, vec![0.0, 1.0]).unwrap(),
            json!({
                "memoryId": "unrelated",
                "connectionId": "embedding-connection",
                "provider": "openai",
                "model": "text-embedding-3-small",
                "canonicalUpdatedAt": "2026-08-05T10:00:00Z",
                "contentHash": "unrelated",
                "vector": [0.0, 1.0]
            }),
        ];

        let plan = semantic_index_plan(&memories, &rows, &identity, 2);

        assert_eq!(plan.cached_vectors.len(), 1);
        assert_eq!(plan.cached_vectors["candidate"], vec![1.0, 0.0]);
        assert!(plan.missing_memory_ids.is_empty());
    }

    #[test]
    fn semantic_index_rows_use_sha256_identifiers() {
        let identity = SemanticIndexIdentity {
            connection_id: "embedding-connection".to_string(),
            provider: "openai".to_string(),
            model: "text-embedding-3-small".to_string(),
        };
        let row = semantic_index_row(
            &json!({
                "id": "candidate",
                "content": "Candidate fact",
                "updatedAt": "2026-08-05T10:00:00Z"
            }),
            &identity,
            vec![1.0, 0.0],
        )
        .unwrap();

        assert_eq!(row["contentHash"].as_str().unwrap().len(), 64);
        assert_eq!(row["projectionHash"].as_str().unwrap().len(), 64);
        assert_eq!(
            row["id"]
                .as_str()
                .unwrap()
                .strip_prefix("candidate:semantic:")
                .unwrap()
                .len(),
            64
        );
    }

    fn nested_semantic_index_plan_reference(
        memories: &[Value],
        index_rows: &[Value],
        identity: &SemanticIndexIdentity,
        expected_dimensions: usize,
    ) -> SemanticIndexPlan {
        let mut cached_vectors = HashMap::new();
        let mut missing_memory_ids = Vec::new();
        for memory in memories {
            let memory_id = read_string(memory.get("id"));
            let content = read_string(memory.get("content"));
            let updated_at = read_string(memory.get("updatedAt"));
            let fresh = index_rows.iter().find_map(|row| {
                (read_string(row.get("memoryId")) == memory_id
                    && semantic_row_matches_identity(row, identity)
                    && read_string(row.get("canonicalUpdatedAt")) == updated_at
                    && read_string(row.get("contentHash")) == sha256_hash(&content))
                .then(|| vector_from_value(row.get("vector")))
                .flatten()
                .filter(|vector| vector.len() == expected_dimensions)
            });
            if let Some(vector) = fresh {
                cached_vectors.insert(memory_id, vector);
            } else if !memory_id.is_empty() {
                missing_memory_ids.push(memory_id);
            }
        }
        SemanticIndexPlan {
            cached_vectors,
            missing_memory_ids,
        }
    }

    #[test]
    #[ignore = "manual performance measurement"]
    fn semantic_index_plan_large_index_benchmark() {
        const DIMENSIONS: usize = 128;
        const IRRELEVANT_ROWS: usize = 5_000;
        let (state, data_dir) = semantic_test_state("large-index-benchmark");
        let identity = SemanticIndexIdentity {
            connection_id: "embedding-connection".to_string(),
            provider: "openai".to_string(),
            model: "text-embedding-3-small".to_string(),
        };
        let memories = (0..MAX_SEMANTIC_CANDIDATES)
            .map(|index| {
                json!({
                    "id": format!("candidate-{index}"),
                    "content": format!("Candidate fact {index}"),
                    "updatedAt": "2026-08-05T10:00:00Z"
                })
            })
            .collect::<Vec<_>>();
        let mut stored_rows = (0..IRRELEVANT_ROWS)
            .map(|index| {
                json!({
                    "id": format!("irrelevant-{index}"),
                    "memoryId": format!("unrelated-{index}"),
                    "connectionId": "other-connection",
                    "provider": "openai",
                    "model": "text-embedding-3-small",
                    "canonicalUpdatedAt": "2026-08-05T10:00:00Z",
                    "contentHash": "irrelevant",
                    "vector": vec![0.01; DIMENSIONS]
                })
            })
            .collect::<Vec<_>>();
        stored_rows.extend(
            memories.iter().map(|memory| {
                semantic_index_row(memory, &identity, vec![1.0; DIMENSIONS]).unwrap()
            }),
        );
        state
            .storage
            .replace_all(INDEX_COLLECTION, stored_rows)
            .unwrap();

        let old_started = Instant::now();
        let all_rows = state.storage.list(INDEX_COLLECTION).unwrap();
        let old_plan =
            nested_semantic_index_plan_reference(&memories, &all_rows, &identity, DIMENSIONS);
        let old_elapsed = old_started.elapsed();

        let new_started = Instant::now();
        let targeted_rows =
            semantic_index_rows_for_candidates(&state, &memories, &identity).unwrap();
        let new_plan = semantic_index_plan(&memories, &targeted_rows, &identity, DIMENSIONS);
        let new_elapsed = new_started.elapsed();

        assert_eq!(new_plan.cached_vectors, old_plan.cached_vectors);
        assert_eq!(new_plan.missing_memory_ids, old_plan.missing_memory_ids);
        eprintln!(
            "semantic index benchmark: rows={}; targeted_rows={}; old={old_elapsed:?}; new={new_elapsed:?}",
            all_rows.len(),
            targeted_rows.len()
        );
        drop(state);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn semantic_index_plan_reuses_only_fresh_rows_for_the_resolved_embedding_identity() {
        let identity = SemanticIndexIdentity {
            connection_id: "embedding-connection".to_string(),
            provider: "openai".to_string(),
            model: "text-embedding-3-small".to_string(),
        };
        let memories = vec![
            json!({ "id": "fresh", "content": "Fresh fact", "updatedAt": "2026-08-04T10:00:00Z" }),
            json!({ "id": "changed", "content": "Changed fact", "updatedAt": "2026-08-04T11:00:00Z" }),
            json!({ "id": "other-model", "content": "Other model fact", "updatedAt": "2026-08-04T10:00:00Z" }),
            json!({ "id": "wrong-dimensions", "content": "Wrong dimensions", "updatedAt": "2026-08-04T10:00:00Z" }),
        ];
        let rows = vec![
            semantic_index_row(&memories[0], &identity, vec![1.0, 0.0]).unwrap(),
            json!({
                "memoryId": "changed",
                "connectionId": "embedding-connection",
                "provider": "openai",
                "model": "text-embedding-3-small",
                "canonicalUpdatedAt": "2026-08-04T10:00:00Z",
                "contentHash": "stale",
                "vector": [0.8, 0.2]
            }),
            json!({
                "memoryId": "other-model",
                "connectionId": "embedding-connection",
                "provider": "openai",
                "model": "text-embedding-ada-002",
                "canonicalUpdatedAt": "2026-08-04T10:00:00Z",
                "contentHash": "wrong-model",
                "vector": [0.0, 1.0]
            }),
            semantic_index_row(&memories[3], &identity, vec![1.0, 0.0, 0.0]).unwrap(),
        ];

        let plan = semantic_index_plan(&memories, &rows, &identity, 2);

        assert_eq!(plan.cached_vectors.len(), 1);
        assert_eq!(
            plan.missing_memory_ids,
            vec!["changed", "other-model", "wrong-dimensions"]
        );
    }

    #[test]
    fn semantic_ranking_returns_only_matches_above_threshold_in_similarity_order() {
        let identity = SemanticIndexIdentity {
            connection_id: "embedding-connection".to_string(),
            provider: "openai".to_string(),
            model: "text-embedding-3-small".to_string(),
        };
        let memories = vec![
            json!({ "id": "relevant", "content": "A promise made beneath the circus lights." }),
            json!({ "id": "weak", "content": "A distant unrelated detail." }),
            json!({ "id": "opposite", "content": "Something orthogonal." }),
        ];
        let vectors = std::collections::HashMap::from([
            ("relevant".to_string(), vec![0.95, 0.05]),
            ("weak".to_string(), vec![0.2, 0.98]),
            ("opposite".to_string(), vec![0.0, 1.0]),
        ]);

        let matches = rank_semantic_matches(&memories, &vectors, &[1.0, 0.0], &identity, 0.28, 10);

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["memory"]["id"], json!("relevant"));
        assert!(matches[0]["similarity"].as_f64().unwrap() > 0.99);
        assert_eq!(matches[0]["connectionId"], json!("embedding-connection"));
    }

    #[test]
    fn semantic_candidates_are_bounded_and_prefer_pinned_then_recent_memories() {
        let memories = (0..65)
            .map(|index| {
                json!({
                    "id": format!("memory-{index:02}"),
                    "content": format!("Fact {index}"),
                    "status": if index == 0 { "pinned" } else { "active" },
                    "updatedAt": format!("2026-08-{day:02}T10:00:00Z", day = (index % 31) + 1)
                })
            })
            .collect::<Vec<_>>();

        let selected = select_semantic_candidates(memories);

        assert_eq!(selected.len(), MAX_SEMANTIC_CANDIDATES);
        assert_eq!(selected[0]["id"], json!("memory-00"));
        assert!(selected.iter().any(|memory| memory["id"] == json!("memory-61")));
        assert!(!selected.iter().any(|memory| memory["id"] == json!("memory-01")));
    }
}
