use super::canonical_memory;
use super::chats;
use super::prompts;
use super::shared::*;
use super::*;
use marinara_storage::AtomicCollectionRows;
use std::collections::{HashMap, HashSet};

const MEMORY_CHUNK_SIZE: usize = 5;
const MEMORY_EMBEDDING_DIMS: usize = 512;

fn message_role(message: &Value) -> &str {
    message
        .get("role")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|role| !role.is_empty())
        .unwrap_or("")
}
fn object_or_parse(value: Option<&Value>) -> Map<String, Value> {
    match value {
        Some(Value::Object(object)) => object.clone(),
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default(),
        _ => Map::new(),
    }
}

fn message_content(message: &Value) -> String {
    message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn record_display_name(record: &Value) -> Option<String> {
    let data = object_or_parse(record.get("data"));
    data.get("name")
        .and_then(Value::as_str)
        .or_else(|| record.get("name").and_then(Value::as_str))
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
}

fn chat_persona_name(state: &AppState, chat: &Value) -> AppResult<Option<String>> {
    let Some(persona_id) = string_field_trimmed(chat, "personaId") else {
        return Ok(None);
    };
    Ok(state
        .storage
        .get("personas", &persona_id)?
        .and_then(|persona| record_display_name(&persona)))
}

fn chat_character_names(state: &AppState, chat: &Value) -> AppResult<HashMap<String, String>> {
    let mut names = HashMap::new();
    for character_id in string_array_from_value(chat.get("characterIds")) {
        if names.contains_key(&character_id) {
            continue;
        }
        if let Some(character) = state.storage.get("characters", &character_id)? {
            if let Some(name) = record_display_name(&character) {
                names.insert(character_id, name);
            }
        }
    }
    Ok(names)
}

fn message_speaker_label(
    message: &Value,
    persona_name: Option<&str>,
    character_names: &HashMap<String, String>,
    fallback_character_name: Option<&str>,
) -> String {
    if let Some(character_name) = message
        .get("characterId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|character_id| !character_id.is_empty())
        .and_then(|character_id| character_names.get(character_id))
    {
        return character_name.clone();
    }

    let role = message
        .get("role")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|role| !role.is_empty())
        .unwrap_or("message");
    match role {
        "user" => persona_name.unwrap_or("User").to_string(),
        "assistant" => fallback_character_name.unwrap_or(role).to_string(),
        _ => role.to_string(),
    }
}

fn memory_recall_is_stopword(token: &str) -> bool {
    matches!(
        token,
        "about"
            | "and"
            | "are"
            | "been"
            | "but"
            | "did"
            | "does"
            | "find"
            | "for"
            | "from"
            | "had"
            | "has"
            | "have"
            | "her"
            | "him"
            | "his"
            | "how"
            | "its"
            | "know"
            | "like"
            | "look"
            | "make"
            | "more"
            | "our"
            | "out"
            | "remember"
            | "said"
            | "say"
            | "she"
            | "show"
            | "tell"
            | "that"
            | "the"
            | "their"
            | "them"
            | "then"
            | "there"
            | "they"
            | "this"
            | "was"
            | "what"
            | "when"
            | "where"
            | "which"
            | "who"
            | "why"
            | "with"
            | "you"
            | "your"
    )
}

fn lexical_memory_tokens(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric())
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.chars().count() > 1)
        .collect()
}

fn lexical_feature_hash(feature: &str) -> u32 {
    let mut hash = 2166136261_u32;
    for ch in feature.chars() {
        hash ^= ch as u32;
        hash = hash.wrapping_mul(16777619);
    }
    hash
}

fn add_lexical_feature(vector: &mut [f64], feature: &str, weight: f64) {
    if feature.is_empty() || weight <= 0.0 {
        return;
    }
    let hash = lexical_feature_hash(feature);
    let sign = if hash & 0x80000000 == 0 { 1.0 } else { -1.0 };
    let index = (hash as usize) % MEMORY_EMBEDDING_DIMS;
    vector[index] += weight * sign;
}

fn memory_recall_meaningful_token(token: &str) -> bool {
    !memory_recall_is_stopword(token)
}

fn memory_recall_token_weight(token: &str) -> f64 {
    if !memory_recall_meaningful_token(token) {
        return 0.0;
    }
    1.0 + ((token.chars().count().saturating_sub(4)) as f64 * 0.05).min(0.75)
}

fn add_memory_recall_token_features(vector: &mut [f64], token: &str) {
    let weight = memory_recall_token_weight(token);
    if weight <= 0.0 {
        return;
    }
    let chars = token.chars().collect::<Vec<_>>();
    add_lexical_feature(vector, &format!("w:{token}"), weight);
    if chars.len() >= 5 {
        add_lexical_feature(
            vector,
            &format!("p:{}", chars[..4].iter().copied().collect::<String>()),
            0.25,
        );
        add_lexical_feature(
            vector,
            &format!(
                "s:{}",
                chars[chars.len() - 4..].iter().copied().collect::<String>()
            ),
            0.25,
        );
    }
    for index in 0..chars.len().saturating_sub(2) {
        add_lexical_feature(
            vector,
            &format!(
                "g:{}",
                chars[index..index + 3].iter().copied().collect::<String>()
            ),
            0.15,
        );
    }
}

fn lexical_memory_embedding(text: &str) -> Vec<f64> {
    let mut vector = vec![0.0_f64; MEMORY_EMBEDDING_DIMS];
    let mut meaningful_tokens = Vec::new();
    for token in lexical_memory_tokens(text) {
        add_memory_recall_token_features(&mut vector, &token);
        if memory_recall_meaningful_token(&token) {
            meaningful_tokens.push(token);
        }
    }
    for pair in meaningful_tokens.windows(2) {
        if let [left, right] = pair {
            add_lexical_feature(&mut vector, &format!("b:{left} {right}"), 1.4);
        }
    }
    let magnitude = vector.iter().map(|value| value * value).sum::<f64>().sqrt();
    if magnitude > 0.0 {
        for value in &mut vector {
            *value /= magnitude;
        }
    }
    vector
}

struct MemoryEmbeddingContext {
    connection_id: String,
    connection: Value,
    model: String,
}

struct MemoryEmbeddingResult {
    embedding: Vec<f64>,
    source: &'static str,
    connection_id: Option<String>,
    model: Option<String>,
}

fn configured_embedding_model(connection: &Value) -> Option<String> {
    connection
        .get("embeddingModel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn memory_embedding_context_from_connection(
    connection_id: String,
    mut connection: Value,
) -> AppResult<MemoryEmbeddingContext> {
    let model = configured_embedding_model(&connection).ok_or_else(|| {
        AppError::invalid_input(format!(
            "Embedding connection {connection_id} is missing an embeddingModel"
        ))
    })?;
    if let Some(object) = connection.as_object_mut() {
        object.insert("model".to_string(), Value::String(model.clone()));
    }
    Ok(MemoryEmbeddingContext {
        connection_id,
        connection,
        model,
    })
}

fn automatic_embedding_unavailable(error: &AppError) -> bool {
    matches!(error.code.as_str(), "invalid_input" | "not_found")
}

fn configured_chat_connection_id<'a>(chat: &'a Value, key: &str) -> Option<&'a str> {
    chat.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

async fn memory_embedding_context_for_connection_id(
    state: &AppState,
    connection_id: &str,
) -> AppResult<MemoryEmbeddingContext> {
    let (embedding_connection_id, connection) =
        prompts::resolve_embedding_connection_for_id_async(state, connection_id).await?;
    memory_embedding_context_from_connection(embedding_connection_id, connection)
}

async fn memory_embedding_context_for_explicit_connection_id(
    state: &AppState,
    connection_id: &str,
) -> AppResult<MemoryEmbeddingContext> {
    let (embedding_connection_id, connection) =
        prompts::resolve_explicit_embedding_connection_async(state, connection_id).await?;
    memory_embedding_context_from_connection(embedding_connection_id, connection)
}

async fn memory_embedding_context(
    state: &AppState,
    chat: &Value,
) -> AppResult<Option<MemoryEmbeddingContext>> {
    if let Some(connection_id) = configured_chat_connection_id(chat, "embeddingConnectionId") {
        return Ok(Some(
            memory_embedding_context_for_explicit_connection_id(state, connection_id).await?,
        ));
    }

    if let Some(connection_id) = configured_chat_connection_id(chat, "connectionId") {
        return match memory_embedding_context_for_connection_id(state, connection_id).await {
            Ok(context) => Ok(Some(context)),
            Err(error) if automatic_embedding_unavailable(&error) => Ok(None),
            Err(error) => Err(error),
        };
    }

    match prompts::resolve_default_embedding_connection_async(state).await {
        Ok((connection_id, connection)) => Ok(Some(memory_embedding_context_from_connection(
            connection_id,
            connection,
        )?)),
        Err(error) if automatic_embedding_unavailable(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

async fn embed_memory_content(
    context: Option<&MemoryEmbeddingContext>,
    content: &str,
) -> AppResult<MemoryEmbeddingResult> {
    let mut results = embed_memory_contents(context, &[content]).await?;
    results
        .pop()
        .ok_or_else(|| AppError::new("embedding_error", "Embedding provider returned no vectors"))
}

async fn embed_memory_contents(
    context: Option<&MemoryEmbeddingContext>,
    contents: &[&str],
) -> AppResult<Vec<MemoryEmbeddingResult>> {
    if let Some(context) = context {
        let embeddings =
            prompts::embed_texts(&context.connection, &context.model, contents).await?;
        if embeddings.len() != contents.len() {
            return Err(AppError::new(
                "embedding_error",
                "Embedding provider returned a mismatched vector count",
            ));
        }
        return Ok(embeddings
            .into_iter()
            .map(|embedding| MemoryEmbeddingResult {
                embedding,
                source: "provider",
                connection_id: Some(context.connection_id.clone()),
                model: Some(context.model.clone()),
            })
            .collect());
    }
    Ok(contents
        .iter()
        .map(|content| MemoryEmbeddingResult {
            embedding: lexical_memory_embedding(content),
            source: "lexical",
            connection_id: None,
            model: None,
        })
        .collect())
}

fn insert_memory_embedding_fields(memory: &mut Map<String, Value>, result: MemoryEmbeddingResult) {
    memory.insert("embedding".to_string(), json!(result.embedding));
    memory.insert("hasEmbedding".to_string(), json!(true));
    memory.insert("embeddingStatus".to_string(), json!("vectorized"));
    memory.insert("embeddingSource".to_string(), json!(result.source));
    if let Some(connection_id) = result.connection_id {
        memory.insert(
            "embeddingConnectionId".to_string(),
            Value::String(connection_id),
        );
    }
    if let Some(model) = result.model {
        memory.insert("embeddingModel".to_string(), Value::String(model));
    }
}

fn remove_memory_embedding_fields(memory: &mut Map<String, Value>) {
    // Embedding availability is an index projection signal. Top-level `status`
    // is owned by lifecycle actions such as delete/correct/supersede only.
    memory.remove("embedding");
    memory.insert("hasEmbedding".to_string(), json!(false));
    memory.insert("embeddingStatus".to_string(), json!("missing"));
    memory.insert("embeddingSource".to_string(), Value::Null);
    memory.insert("embeddingConnectionId".to_string(), Value::Null);
    memory.insert("embeddingModel".to_string(), Value::Null);
}

fn chat_memory_status(memory: &Value) -> &str {
    memory
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("active")
}

fn chat_memory_object_status(memory: &Map<String, Value>) -> &str {
    memory
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("active")
}

fn chat_memory_object_is_retrievable(memory: &Map<String, Value>) -> bool {
    matches!(chat_memory_object_status(memory), "" | "active")
        && memory.get("deletedAt").is_none()
        && memory.get("correctedAt").is_none()
        && memory.get("supersededAt").is_none()
        && memory.get("supersededByMemoryId").is_none()
}

pub(crate) fn chat_memory_is_retrievable(memory: &Value) -> bool {
    memory
        .as_object()
        .is_some_and(chat_memory_object_is_retrievable)
}

fn memory_object_by_id_mut<'a>(
    memories: &'a mut [Value],
    memory_id: &str,
) -> AppResult<&'a mut Map<String, Value>> {
    memories
        .iter_mut()
        .find(|memory| memory.get("id").and_then(Value::as_str) == Some(memory_id))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| AppError::not_found("Chat memory was not found"))
}

fn string_from_object(memory: &Map<String, Value>, key: &str) -> Option<String> {
    memory
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

async fn embed_chat_memory_object(
    memory: &mut Map<String, Value>,
    embedding_context: Option<&MemoryEmbeddingContext>,
) -> AppResult<()> {
    let content = string_from_object(memory, "content")
        .ok_or_else(|| AppError::invalid_input("Memory content is required"))?;
    insert_memory_embedding_fields(
        memory,
        embed_memory_content(embedding_context, &content).await?,
    );
    Ok(())
}
fn memory_has_numeric_embedding(memory: &Value) -> bool {
    memory
        .get("embedding")
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(Value::is_number))
}

fn memory_has_current_embedding(memory: &Value, context: Option<&MemoryEmbeddingContext>) -> bool {
    if !memory_has_numeric_embedding(memory) {
        return false;
    }
    match context {
        Some(context) => {
            memory.get("embeddingSource").and_then(Value::as_str) == Some("provider")
                && memory.get("embeddingConnectionId").and_then(Value::as_str)
                    == Some(context.connection_id.as_str())
                && memory.get("embeddingModel").and_then(Value::as_str)
                    == Some(context.model.as_str())
        }
        None => {
            memory.get("embeddingSource").and_then(Value::as_str) == Some("lexical")
                && memory
                    .get("embedding")
                    .and_then(Value::as_array)
                    .is_some_and(|items| items.len() == MEMORY_EMBEDDING_DIMS)
        }
    }
}

fn memory_message_ids(memory: &Value) -> Vec<String> {
    memory
        .get("messageIds")
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn memory_chunk_key(message_ids: &[String]) -> String {
    message_ids.join("\u{1f}")
}

fn has_non_transcript_memory_metadata(memory: &Value) -> bool {
    if chat_memory_status(memory) != "active"
        || memory
            .get("userEdited")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return true;
    }
    if memory
        .get("source")
        .and_then(Value::as_str)
        .is_some_and(|source| !source.trim().is_empty())
    {
        return true;
    }
    if memory
        .get("embeddingSource")
        .and_then(Value::as_str)
        .is_some_and(|source| source.trim() == "command")
    {
        return true;
    }
    [
        "commandMemoryKey",
        "sourceChatId",
        "target",
        "targetCharacterId",
        "targetCharacterName",
    ]
    .iter()
    .any(|field| match memory.get(*field) {
        Some(Value::Null) | None => false,
        Some(Value::String(value)) => !value.trim().is_empty(),
        Some(_) => true,
    })
}

fn chat_memory_is_refresh_owned(memory: &Value) -> bool {
    !memory_message_ids(memory).is_empty() && !has_non_transcript_memory_metadata(memory)
}

fn chat_memory_is_automatic_exchange_capture(memory: &Value) -> bool {
    chat_memory_is_refresh_owned(memory)
        && memory.get("creationReason").and_then(Value::as_str)
            == Some("Automatic exchange capture")
}

fn reusable_chat_memory<'a>(
    existing: &'a HashMap<String, Value>,
    message_ids: &[String],
    content: &str,
    context: Option<&MemoryEmbeddingContext>,
) -> Option<&'a Value> {
    let memory = existing.get(&memory_chunk_key(message_ids))?;
    if memory.get("content").and_then(Value::as_str) != Some(content) {
        return None;
    }
    memory_has_current_embedding(memory, context).then_some(memory)
}

fn is_hidden_from_ai(message: &Value) -> bool {
    let extra = object_or_parse(message.get("extra"));
    ["hiddenFromAI", "hiddenFromAi"]
        .iter()
        .any(|key| extra.get(*key).and_then(Value::as_bool).unwrap_or(false))
}

fn chat_memory_recency_key(memory: &Value) -> &str {
    chat_memory_timestamp(memory).unwrap_or("")
}

fn chat_memory_values(chat: &Value) -> Vec<Value> {
    match chat.get("memories") {
        Some(Value::Array(values)) => values.clone(),
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|parsed| parsed.as_array().cloned())
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

pub(crate) fn chat_memory_values_for_mutation(chat: &Value) -> AppResult<Vec<Value>> {
    match chat.get("memories") {
        Some(Value::Array(values)) => Ok(values.clone()),
        Some(Value::String(raw)) => {
            let parsed = serde_json::from_str::<Value>(raw).map_err(|_| {
                AppError::invalid_input("Chat memories are not a valid serialized array")
            })?;
            match parsed {
                Value::Array(values) => Ok(values),
                _ => Err(AppError::invalid_input(
                    "Chat memories are not a valid serialized array",
                )),
            }
        }
        Some(Value::Null) | None => Ok(Vec::new()),
        _ => Err(AppError::invalid_input("Chat memories must be an array")),
    }
}

fn chat_memory_message_ids(memory: &Value) -> HashSet<String> {
    let mut ids = HashSet::new();
    if let Some(message_ids) = memory.get("messageIds").and_then(Value::as_array) {
        for value in message_ids {
            if let Some(id) = value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                ids.insert(id.to_string());
            }
        }
    }
    for field in ["firstMessageId", "lastMessageId"] {
        if let Some(id) = memory
            .get(field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            ids.insert(id.to_string());
        }
    }
    ids
}

fn chat_memory_timestamp(memory: &Value) -> Option<&str> {
    memory
        .get("lastMessageAt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            memory
                .get("createdAt")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .or_else(|| {
            memory
                .get("firstMessageAt")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
}

fn memory_overlaps_deleted_messages(
    memory: &Value,
    deleted_ids: &HashSet<String>,
    deleted_start_at: Option<&str>,
) -> bool {
    if !chat_memory_is_refresh_owned(memory) {
        return false;
    }
    let chunk_ids = chat_memory_message_ids(memory);
    if !chunk_ids.is_empty() && chunk_ids.iter().any(|id| deleted_ids.contains(id)) {
        return true;
    }
    let Some(deleted_start_at) = deleted_start_at else {
        return false;
    };
    chat_memory_timestamp(memory).is_some_and(|timestamp| timestamp >= deleted_start_at)
}

pub(crate) fn prune_chat_memory_values_for_deleted_messages(
    values: Vec<Value>,
    deleted_messages: &[Value],
) -> Option<Vec<Value>> {
    let deleted_ids = deleted_messages
        .iter()
        .filter_map(|message| message.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    if deleted_ids.is_empty() {
        return None;
    }

    let deleted_start_at = deleted_messages
        .iter()
        .filter_map(|message| message.get("createdAt").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .min();
    let original_len = values.len();
    let retained = values
        .into_iter()
        .filter(|memory| !memory_overlaps_deleted_messages(memory, &deleted_ids, deleted_start_at))
        .collect::<Vec<_>>();
    (retained.len() != original_len).then_some(retained)
}

fn memory_overlaps_excluded_recent(
    memory: &Value,
    recent_ids: &HashSet<String>,
    recent_start_at: &str,
) -> bool {
    if recent_ids.is_empty() {
        return false;
    }
    let chunk_ids = chat_memory_message_ids(memory);
    if !chunk_ids.is_empty() {
        return chunk_ids.iter().any(|id| recent_ids.contains(id));
    }

    memory
        .get("lastMessageAt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|last_message_at| {
            !recent_start_at.is_empty() && last_message_at >= recent_start_at
        })
}

fn exclude_recent_chat_memories(
    values: Vec<Value>,
    exclude_recent_message_ids: &[String],
    exclude_recent_start_at: Option<&str>,
) -> Vec<Value> {
    let recent_ids = exclude_recent_message_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    let recent_start_at = exclude_recent_start_at.unwrap_or("").trim();
    if recent_ids.is_empty() {
        return values;
    }
    values
        .into_iter()
        .filter(|memory| !memory_overlaps_excluded_recent(memory, &recent_ids, recent_start_at))
        .collect()
}

fn memory_at_or_after_message(
    memory: &Value,
    message_ids: &HashSet<String>,
    created_at: &str,
) -> bool {
    if !chat_memory_is_refresh_owned(memory) {
        return false;
    }
    if !message_ids.is_empty() {
        let chunk_ids = chat_memory_message_ids(memory);
        if chunk_ids.iter().any(|id| message_ids.contains(id)) {
            return true;
        }
    }

    chat_memory_timestamp(memory)
        .is_some_and(|timestamp| !created_at.is_empty() && timestamp >= created_at)
}

fn retained_chat_memories_after_message_change(
    chat: &Value,
    message_id: &str,
    created_at: &str,
) -> AppResult<Option<Vec<Value>>> {
    let values = chat_memory_values_for_mutation(chat)?;
    if values.is_empty() {
        return Ok(None);
    }
    let message_ids = message_id
        .trim()
        .is_empty()
        .then(HashSet::new)
        .unwrap_or_else(|| HashSet::from([message_id.trim().to_string()]));
    let before = values.len();
    let retained = values
        .into_iter()
        .filter(|memory| !memory_at_or_after_message(memory, &message_ids, created_at.trim()))
        .collect::<Vec<_>>();
    if retained.len() == before {
        return Ok(None);
    }
    #[cfg(test)]
    if retained.iter().any(|memory| {
        memory.get("id").and_then(Value::as_str) == Some("__fail_after_message_mutation__")
    }) {
        return Err(AppError::invalid_input(
            "injected message memory cleanup failure",
        ));
    }
    Ok(Some(retained))
}

fn apply_chat_memory_invalidation_from_message(chat: &mut Value, message: &Value) -> AppResult<()> {
    let message_id = message
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .unwrap_or("");
    let created_at = message
        .get("createdAt")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if let Some(retained) =
        retained_chat_memories_after_message_change(chat, message_id, created_at)?
    {
        let object = chat
            .as_object_mut()
            .ok_or_else(|| AppError::invalid_input("Chat is not an object"))?;
        object.insert("memories".to_string(), Value::Array(retained));
    }
    Ok(())
}

pub(crate) fn apply_message_memory_invalidation_in_collections(
    collections: &mut [AtomicCollectionRows],
    chat_id: &str,
    message: &Value,
) -> AppResult<()> {
    let Some(chat) = collections.get_mut(2).and_then(|collection| {
        collection
            .rows_mut()
            .iter_mut()
            .find(|row| row.get("id").and_then(Value::as_str) == Some(chat_id))
    }) else {
        return Ok(());
    };
    apply_chat_memory_invalidation_from_message(chat, message)
}

#[cfg(test)]
fn list_chat_memories(
    state: &AppState,
    chat_id: &str,
    limit: Option<usize>,
    order: Option<&str>,
) -> AppResult<Value> {
    list_chat_memories_excluding_recent(state, chat_id, limit, order, &[], None)
}

pub(crate) fn list_chat_memories_excluding_recent(
    state: &AppState,
    chat_id: &str,
    limit: Option<usize>,
    order: Option<&str>,
    exclude_recent_message_ids: &[String],
    exclude_recent_start_at: Option<&str>,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let mut values = exclude_recent_chat_memories(
        chat_memory_values(&chat),
        exclude_recent_message_ids,
        exclude_recent_start_at,
    );

    match order
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("stored")
    {
        "stored" => {}
        "recent" => values.sort_by(|a, b| {
            chat_memory_recency_key(b)
                .cmp(chat_memory_recency_key(a))
                .then_with(|| {
                    let a_id = a.get("id").and_then(Value::as_str).unwrap_or("");
                    let b_id = b.get("id").and_then(Value::as_str).unwrap_or("");
                    b_id.cmp(a_id)
                })
        }),
        other => {
            return Err(AppError::invalid_input(format!(
                "Unsupported chat memory order: {other}"
            )));
        }
    }

    if let Some(limit) = limit {
        values.truncate(limit);
    }

    Ok(Value::Array(values))
}

fn set_chat_memory_values(state: &AppState, chat_id: &str, values: Vec<Value>) -> AppResult<Value> {
    state
        .storage
        .patch("chats", chat_id, json!({ "memories": values }))
}

pub(crate) fn clear_chat_memories(state: &AppState, chat_id: &str) -> AppResult<Value> {
    let result = set_chat_memory_values(state, chat_id, Vec::new())?;
    canonical_memory::delete_memory_index_rows_for_chat(state, chat_id)?;
    Ok(result)
}

pub(crate) fn delete_chat_memory(
    state: &AppState,
    chat_id: &str,
    memory_id: &str,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let values = chat_memory_values_for_mutation(&chat)?
        .into_iter()
        .filter(|item| item.get("id").and_then(Value::as_str) != Some(memory_id))
        .collect::<Vec<_>>();
    set_chat_memory_values(state, chat_id, values)
}

pub(crate) async fn update_chat_memory(
    state: &AppState,
    chat_id: &str,
    memory_id: &str,
    body: Value,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let embedding_context = memory_embedding_context(state, &chat).await?;
    let mut values = chat_memory_values_for_mutation(&chat)?;
    let now = now_iso();
    {
        let memory = memory_object_by_id_mut(&mut values, memory_id)?;
        if !chat_memory_object_is_retrievable(memory) {
            return Err(AppError::invalid_input(
                "Only active memories can be edited",
            ));
        }
        let content = body
            .get("content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::invalid_input("Memory content is required"))?;
        memory.insert("content".to_string(), Value::String(content.to_string()));
        memory.insert("userEdited".to_string(), json!(true));
        memory.insert("updatedAt".to_string(), Value::String(now.clone()));
        embed_chat_memory_object(memory, embedding_context.as_ref()).await?;
    }
    set_chat_memory_values(state, chat_id, values)
}

pub(crate) fn soft_delete_chat_memory(
    state: &AppState,
    chat_id: &str,
    memory_id: &str,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let mut values = chat_memory_values_for_mutation(&chat)?;
    {
        let memory = memory_object_by_id_mut(&mut values, memory_id)?;
        remove_memory_embedding_fields(memory);
        memory.insert("status".to_string(), json!("deleted"));
        memory.insert("deletedAt".to_string(), Value::String(now_iso()));
    }
    set_chat_memory_values(state, chat_id, values)
}

pub(crate) async fn restore_chat_memory(
    state: &AppState,
    chat_id: &str,
    memory_id: &str,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let embedding_context = memory_embedding_context(state, &chat).await?;
    let mut values = chat_memory_values_for_mutation(&chat)?;
    {
        let memory = memory_object_by_id_mut(&mut values, memory_id)?;
        memory.remove("deletedAt");
        memory.remove("correctedAt");
        memory.insert("status".to_string(), json!("active"));
        memory.insert("restoredAt".to_string(), Value::String(now_iso()));
        embed_chat_memory_object(memory, embedding_context.as_ref()).await?;
    }
    set_chat_memory_values(state, chat_id, values)
}

pub(crate) fn pin_chat_memory(
    state: &AppState,
    chat_id: &str,
    memory_id: &str,
    pinned: bool,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let mut values = chat_memory_values_for_mutation(&chat)?;
    {
        let memory = memory_object_by_id_mut(&mut values, memory_id)?;
        memory.insert("pinned".to_string(), json!(pinned));
        memory.insert("updatedAt".to_string(), Value::String(now_iso()));
    }
    set_chat_memory_values(state, chat_id, values)
}

pub(crate) async fn correct_chat_memory(
    state: &AppState,
    chat_id: &str,
    memory_id: &str,
    body: Value,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let embedding_context = memory_embedding_context(state, &chat).await?;
    let mut values = chat_memory_values_for_mutation(&chat)?;
    let now = now_iso();
    let mut replacement: Option<Value> = None;
    {
        let memory = memory_object_by_id_mut(&mut values, memory_id)?;
        remove_memory_embedding_fields(memory);
        memory.insert("status".to_string(), json!("wrong"));
        memory.insert("correctedAt".to_string(), Value::String(now.clone()));

        let replacement_content = body
            .get("replacementContent")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(content) = replacement_content {
            let replacement_id = new_id();
            memory.insert(
                "correctedByMemoryId".to_string(),
                Value::String(replacement_id.clone()),
            );
            let mut next = Map::new();
            next.insert("id".to_string(), Value::String(replacement_id.clone()));
            next.insert("chatId".to_string(), Value::String(chat_id.to_string()));
            next.insert("content".to_string(), Value::String(content.to_string()));
            next.insert("messageCount".to_string(), json!(1));
            next.insert("source".to_string(), json!("correction"));
            next.insert(
                "correctionOfMemoryId".to_string(),
                Value::String(memory_id.to_string()),
            );
            next.insert("canonicalMemoryVersion".to_string(), json!(1));
            next.insert("memoryKind".to_string(), json!("correction"));
            next.insert("scopeType".to_string(), json!("chat"));
            next.insert("scopeId".to_string(), json!(chat_id));
            next.insert("status".to_string(), json!("active"));
            next.insert("legacySourceLane".to_string(), json!("chats.memories"));
            next.insert(
                "legacySourceId".to_string(),
                Value::String(replacement_id.clone()),
            );
            next.insert("createdAt".to_string(), Value::String(now.clone()));
            next.insert(
                "firstMessageAt".to_string(),
                memory
                    .get("firstMessageAt")
                    .cloned()
                    .unwrap_or_else(|| Value::String(now.clone())),
            );
            next.insert(
                "lastMessageAt".to_string(),
                memory
                    .get("lastMessageAt")
                    .cloned()
                    .unwrap_or_else(|| Value::String(now.clone())),
            );
            next.insert("creationReason".to_string(), json!("User correction"));
            next.insert("userEdited".to_string(), json!(true));
            embed_chat_memory_object(&mut next, embedding_context.as_ref()).await?;
            replacement = Some(Value::Object(next));
        }
    }
    if let Some(replacement) = replacement {
        values.push(replacement);
    }
    set_chat_memory_values(state, chat_id, values)
}
fn capture_memory_content(
    messages: &[Value],
    persona_name: Option<&str>,
    character_names: &HashMap<String, String>,
    fallback_character_name: Option<&str>,
) -> String {
    messages
        .iter()
        .map(|message| {
            let speaker = message_speaker_label(
                message,
                persona_name,
                character_names,
                fallback_character_name,
            );
            format!("{speaker}: {}", message_content(message))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn capture_message_ids(messages: &[Value]) -> Vec<String> {
    messages
        .iter()
        .filter_map(|message| message.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>()
}

struct RefreshMemoryCaptureContext<'a> {
    existing_by_chunk: &'a HashMap<String, Value>,
    embedding_context: Option<&'a MemoryEmbeddingContext>,
    chat_id: &'a str,
    persona_name: Option<&'a str>,
    character_names: &'a HashMap<String, String>,
    fallback_character_name: Option<&'a str>,
    now: &'a str,
    creation_reason: &'a str,
}

fn push_refresh_memory_capture(
    captures: &mut Vec<Value>,
    pending: &mut Vec<(usize, String, Map<String, Value>)>,
    reused: &mut usize,
    messages: &[Value],
    context: &RefreshMemoryCaptureContext<'_>,
) {
    let message_ids = capture_message_ids(messages);
    if message_ids.is_empty() {
        return;
    }
    let content = capture_memory_content(
        messages,
        context.persona_name,
        context.character_names,
        context.fallback_character_name,
    );
    if let Some(existing_memory) = reusable_chat_memory(
        context.existing_by_chunk,
        &message_ids,
        &content,
        context.embedding_context,
    ) {
        let mut memory = existing_memory.clone();
        if let Some(object) = memory.as_object_mut() {
            canonicalize_transcript_capture(object, context.chat_id);
            object.insert(
                "creationReason".to_string(),
                Value::String(context.creation_reason.to_string()),
            );
        }
        captures.push(memory);
        *reused += 1;
        return;
    }

    let mut memory = Map::new();
    memory.insert("id".to_string(), Value::String(new_id()));
    memory.insert(
        "chatId".to_string(),
        Value::String(context.chat_id.to_string()),
    );
    memory.insert("content".to_string(), Value::String(content.clone()));
    memory.insert("messageCount".to_string(), json!(messages.len()));
    memory.insert("messageIds".to_string(), json!(message_ids));
    memory.insert(
        "firstMessageId".to_string(),
        messages
            .first()
            .and_then(|message| message.get("id"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    memory.insert(
        "lastMessageId".to_string(),
        messages
            .last()
            .and_then(|message| message.get("id"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    memory.insert(
        "firstMessageAt".to_string(),
        messages
            .first()
            .and_then(|message| message.get("createdAt"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    memory.insert(
        "lastMessageAt".to_string(),
        messages
            .last()
            .and_then(|message| message.get("createdAt"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    memory.insert(
        "createdAt".to_string(),
        Value::String(context.now.to_string()),
    );
    canonicalize_transcript_capture(&mut memory, context.chat_id);
    memory.insert(
        "creationReason".to_string(),
        Value::String(context.creation_reason.to_string()),
    );
    pending.push((captures.len(), content, memory));
    captures.push(Value::Null);
}
#[cfg(test)]
async fn refresh_chat_memories(state: &AppState, chat_id: &str) -> AppResult<Value> {
    refresh_chat_memories_for_source_messages(state, chat_id, Vec::new()).await
}

pub(crate) async fn refresh_chat_memories_for_source_messages(
    state: &AppState,
    chat_id: &str,
    source_message_ids: Vec<String>,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let embedding_context = memory_embedding_context(state, &chat).await?;
    let existing_memories = chat_memory_values_for_mutation(&chat)?;
    let visible_messages = chats::messages_for_chat(state, chat_id)?
        .into_iter()
        .filter(|message| !is_hidden_from_ai(message) && !message_content(message).is_empty())
        .collect::<Vec<_>>();
    let source_message_id_set = source_message_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    let focused_messages = visible_messages
        .iter()
        .filter(|message| {
            message
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .is_some_and(|id| source_message_id_set.contains(id))
        })
        .cloned()
        .collect::<Vec<_>>();
    let focused_refresh = focused_messages
        .last()
        .is_some_and(|message| message_role(message) == "assistant");
    let mut focused_capture_message_ids = existing_memories
        .iter()
        .filter(|memory| chat_memory_is_automatic_exchange_capture(memory))
        .flat_map(chat_memory_message_ids)
        .collect::<HashSet<_>>();
    if focused_refresh {
        focused_capture_message_ids.extend(capture_message_ids(&focused_messages));
    }
    let preserved_memories = existing_memories
        .iter()
        .filter(|memory| {
            if !chat_memory_is_refresh_owned(memory) {
                return true;
            }
            if chat_memory_is_automatic_exchange_capture(memory) {
                return !focused_refresh
                    || !chat_memory_message_ids(memory)
                        .iter()
                        .any(|id| source_message_id_set.contains(id));
            }
            if chat_memory_message_ids(memory)
                .iter()
                .any(|id| focused_capture_message_ids.contains(id))
            {
                return false;
            }
            focused_refresh
                && !chat_memory_message_ids(memory)
                    .iter()
                    .any(|id| source_message_id_set.contains(id))
        })
        .cloned()
        .collect::<Vec<_>>();
    let existing_by_chunk = existing_memories
        .iter()
        .filter(|memory| chat_memory_is_refresh_owned(memory))
        .filter_map(|memory| {
            let ids = memory_message_ids(memory);
            (!ids.is_empty()).then(|| (memory_chunk_key(&ids), memory.clone()))
        })
        .collect::<HashMap<_, _>>();
    let persona_name = chat_persona_name(state, &chat)?;
    let character_names = chat_character_names(state, &chat)?;
    let fallback_character_name = if character_names.len() == 1 {
        character_names.values().next().map(String::as_str)
    } else {
        None
    };
    let now = now_iso();
    let mut chunks: Vec<Value> = Vec::new();
    let mut pending = Vec::new();
    let mut reused = 0usize;
    let mut focused_capture_index = None;
    let mut focused_capture_operation = None;
    if focused_refresh {
        let focused_message_ids = capture_message_ids(&focused_messages);
        focused_capture_operation = Some(
            if existing_by_chunk.contains_key(&memory_chunk_key(&focused_message_ids)) {
                "updated"
            } else {
                "created"
            },
        );
        focused_capture_index = Some(chunks.len());
        let context = RefreshMemoryCaptureContext {
            existing_by_chunk: &existing_by_chunk,
            embedding_context: embedding_context.as_ref(),
            chat_id,
            persona_name: persona_name.as_deref(),
            character_names: &character_names,
            fallback_character_name,
            now: &now,
            creation_reason: "Automatic exchange capture",
        };
        push_refresh_memory_capture(
            &mut chunks,
            &mut pending,
            &mut reused,
            &focused_messages,
            &context,
        );
    }
    for chunk in visible_messages.chunks(MEMORY_CHUNK_SIZE) {
        if chunk.len() < MEMORY_CHUNK_SIZE
            || capture_message_ids(chunk)
                .iter()
                .any(|id| focused_capture_message_ids.contains(id))
        {
            continue;
        }
        let context = RefreshMemoryCaptureContext {
            existing_by_chunk: &existing_by_chunk,
            embedding_context: embedding_context.as_ref(),
            chat_id,
            persona_name: persona_name.as_deref(),
            character_names: &character_names,
            fallback_character_name,
            now: &now,
            creation_reason: "Automatic transcript chunk capture",
        };
        push_refresh_memory_capture(&mut chunks, &mut pending, &mut reused, chunk, &context);
    }
    let embedded = pending.len();
    if !pending.is_empty() {
        let texts = pending
            .iter()
            .map(|(_, content, _)| content.as_str())
            .collect::<Vec<_>>();
        let embeddings = embed_memory_contents(embedding_context.as_ref(), &texts).await?;
        for ((index, _, mut memory), embedding) in pending.into_iter().zip(embeddings) {
            insert_memory_embedding_fields(&mut memory, embedding);
            chunks[index] = Value::Object(memory);
        }
    }
    let focused_capture = focused_capture_index
        .and_then(|index| chunks.get(index))
        .and_then(|memory| {
            Some(json!({
                "operation": focused_capture_operation?,
                "memory": {
                    "id": memory.get("id")?.as_str()?,
                    "content": memory.get("content")?.as_str()?,
                }
            }))
        });
    chunks.extend(preserved_memories);
    state
        .storage
        .patch("chats", chat_id, json!({ "memories": chunks }))?;
    Ok(json!({
        "rebuilt": chunks.len(),
        "embedded": embedded,
        "reused": reused,
        "chunks": chunks,
        "capture": focused_capture,
    }))
}
pub(crate) fn export_chat_memories(state: &AppState, chat_id: &str) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let now = now_iso();
    let chunks = chat_memory_values(&chat)
        .iter()
        .filter_map(|memory| public_memory_recall_export_chunk(memory, &now))
        .collect::<Vec<_>>();
    let memory_count = chunks.len();
    Ok(json!({
        "type": "marinara_memory_recall",
        "version": 1,
        "exportedAt": now,
        "data": {
            "sourceChat": {
                "id": chat_id,
                "name": chat.get("name").and_then(Value::as_str).unwrap_or("Untitled Chat"),
                "mode": chat.get("mode").and_then(Value::as_str).unwrap_or("conversation"),
                "memoryCount": memory_count
            },
            "chunks": chunks
        }
    }))
}

fn string_field_trimmed(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn positive_usize_field(value: &Value, key: &str) -> Option<usize> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .and_then(|value| usize::try_from(value).ok())
}

fn public_memory_recall_embedding(value: Option<&Value>) -> Value {
    let Some(items) = value.and_then(Value::as_array) else {
        return Value::Null;
    };
    let numbers = items
        .iter()
        .filter(|item| item.is_number())
        .cloned()
        .collect::<Vec<_>>();
    if numbers.is_empty() {
        Value::Null
    } else {
        Value::Array(numbers)
    }
}

fn sanctioned_memory_recall_kind(value: &Value) -> Option<&'static str> {
    match value.as_str().map(str::trim) {
        Some("episode") => Some("episode"),
        Some("transcript") => Some("transcript"),
        Some("manual") => Some("manual"),
        Some("imported") => Some("imported"),
        Some("command") => Some("command"),
        Some("character") => Some("character"),
        Some("scene_event") => Some("scene_event"),
        Some("scene_summary") => Some("scene_summary"),
        Some("summary") => Some("summary"),
        Some("correction") => Some("correction"),
        _ => None,
    }
}

fn sanctioned_memory_recall_scope_type(value: &Value) -> Option<&'static str> {
    match value.as_str().map(str::trim) {
        Some("chat") => Some("chat"),
        Some("character") => Some("character"),
        Some("scene") => Some("scene"),
        _ => None,
    }
}

fn optional_sanctioned_memory_recall_kind(value: &Value) -> Option<Option<&'static str>> {
    match value.get("memoryKind") {
        Some(raw) if !raw.is_null() => sanctioned_memory_recall_kind(raw).map(Some),
        _ => Some(None),
    }
}

fn optional_sanctioned_memory_recall_scope_type(value: &Value) -> Option<Option<&'static str>> {
    match value.get("scopeType") {
        Some(raw) if !raw.is_null() => sanctioned_memory_recall_scope_type(raw).map(Some),
        _ => Some(None),
    }
}

fn public_memory_recall_export_chunk(memory: &Value, fallback_now: &str) -> Option<Value> {
    if !chat_memory_is_retrievable(memory) {
        return None;
    }
    let content = string_field_trimmed(memory, "content")?;
    let created_at =
        string_field_trimmed(memory, "createdAt").unwrap_or_else(|| fallback_now.to_string());
    let first_message_at =
        string_field_trimmed(memory, "firstMessageAt").unwrap_or_else(|| created_at.clone());
    let last_message_at =
        string_field_trimmed(memory, "lastMessageAt").unwrap_or_else(|| first_message_at.clone());
    let message_count = positive_usize_field(memory, "messageCount").unwrap_or(1);

    let mut chunk = Map::new();
    chunk.insert("content".to_string(), Value::String(content));
    chunk.insert(
        "embedding".to_string(),
        public_memory_recall_embedding(memory.get("embedding")),
    );
    chunk.insert("messageCount".to_string(), json!(message_count));
    chunk.insert(
        "firstMessageAt".to_string(),
        Value::String(first_message_at),
    );
    chunk.insert("lastMessageAt".to_string(), Value::String(last_message_at));
    chunk.insert("createdAt".to_string(), Value::String(created_at));
    if let Some(kind) = optional_sanctioned_memory_recall_kind(memory)? {
        chunk.insert("memoryKind".to_string(), json!(kind));
    }
    if let Some(scope_type) = optional_sanctioned_memory_recall_scope_type(memory)? {
        chunk.insert("scopeType".to_string(), json!(scope_type));
    }
    for key in [
        "canonicalMemoryVersion",
        "scopeId",
        "legacySourceLane",
        "legacySourceId",
        "creationReason",
        "source",
        "target",
        "targetCharacterId",
        "targetCharacterName",
        "commandMemoryKey",
        "correctionOfMemoryId",
    ] {
        if let Some(value) = memory.get(key).filter(|value| !value.is_null()) {
            chunk.insert(key.to_string(), value.clone());
        }
    }
    Some(Value::Object(chunk))
}

type MemoryRecallImportKey = (String, String, String);
type MemoryRecallImportKeys = Vec<MemoryRecallImportKey>;
type NormalizedMemoryRecallImportChunk = (Map<String, Value>, MemoryRecallImportKeys, String);

fn memory_recall_import_timestamp_key(value: &Value) -> (String, String) {
    let has_first_message_at = value.get("firstMessageAt").is_some();
    let has_last_message_at = value.get("lastMessageAt").is_some();
    let created_at = string_field_trimmed(value, "createdAt");
    let first_message_at_raw = string_field_trimmed(value, "firstMessageAt");
    let last_message_at_raw = string_field_trimmed(value, "lastMessageAt");
    let can_fallback_to_created_at = !has_first_message_at && !has_last_message_at;
    let first_message_at = first_message_at_raw
        .clone()
        .or_else(|| {
            can_fallback_to_created_at
                .then(|| created_at.clone())
                .flatten()
        })
        .unwrap_or_default();
    let last_message_at = last_message_at_raw
        .or_else(|| {
            (!has_last_message_at && (first_message_at_raw.is_some() || can_fallback_to_created_at))
                .then(|| first_message_at.clone())
        })
        .unwrap_or_default();
    (first_message_at, last_message_at)
}

fn memory_recall_import_key_for_content(value: &Value, content: &str) -> MemoryRecallImportKey {
    let (first_message_at, last_message_at) = memory_recall_import_timestamp_key(value);
    (first_message_at, last_message_at, content.to_string())
}

fn memory_recall_import_keys_for_content(value: &Value, content: &str) -> MemoryRecallImportKeys {
    let primary_key = memory_recall_import_key_for_content(value, content);
    let mut keys = vec![primary_key.clone()];
    let has_range_field =
        value.get("firstMessageAt").is_some() || value.get("lastMessageAt").is_some();
    if has_range_field && primary_key.0.is_empty() && primary_key.1.is_empty() {
        if let Some(created_at) = string_field_trimmed(value, "createdAt") {
            let created_at_key = (created_at.clone(), created_at, content.to_string());
            if !keys.contains(&created_at_key) {
                keys.push(created_at_key);
            }
        }
    }
    keys
}

fn memory_recall_existing_keys(memory: &Value) -> Option<MemoryRecallImportKeys> {
    let content = string_field_trimmed(memory, "content")?;
    let mut keys = memory_recall_import_keys_for_content(memory, &content);
    let has_range_field =
        memory.get("firstMessageAt").is_some() || memory.get("lastMessageAt").is_some();
    if !has_range_field && string_field_trimmed(memory, "createdAt").is_some() {
        let range_less_key = (String::new(), String::new(), content);
        if !keys.contains(&range_less_key) {
            keys.push(range_less_key);
        }
    }
    Some(keys)
}

fn memory_recall_import_chunks(body: &Value) -> AppResult<(&Vec<Value>, String)> {
    if body.get("type").and_then(Value::as_str) != Some("marinara_memory_recall")
        || body.get("version").and_then(Value::as_i64) != Some(1)
    {
        return Err(AppError::invalid_input(
            "Memory Recall import must use a marinara_memory_recall v1 envelope",
        ));
    }
    let data = body
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::invalid_input("Memory Recall import must contain data"))?;
    let source_chat = data
        .get("sourceChat")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::invalid_input("Memory Recall import must contain data.sourceChat")
        })?;
    let source_chat_id = source_chat
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::invalid_input("Memory Recall import must contain data.sourceChat.id")
        })?
        .to_string();
    let chunks = data
        .get("chunks")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::invalid_input("Memory Recall import must contain a data.chunks array")
        })?;
    Ok((chunks, source_chat_id))
}

fn normalize_memory_recall_import_chunk(
    value: &Value,
    chat_id: &str,
    source_chat_id: &str,
    now: &str,
) -> Option<NormalizedMemoryRecallImportChunk> {
    let content = string_field_trimmed(value, "content")?;
    let (first_message_at, last_message_at) = memory_recall_import_timestamp_key(value);
    let keys = memory_recall_import_keys_for_content(value, &content);
    let incoming_created_at = string_field_trimmed(value, "createdAt");
    let created_at = incoming_created_at
        .clone()
        .unwrap_or_else(|| now.to_string());
    let message_count = positive_usize_field(value, "messageCount").unwrap_or(1);

    let mut memory = Map::new();
    memory.insert("id".to_string(), Value::String(new_id()));
    memory.insert("chatId".to_string(), Value::String(chat_id.to_string()));
    if source_chat_id != chat_id {
        memory.insert(
            "sourceChatId".to_string(),
            Value::String(source_chat_id.to_string()),
        );
    }
    memory.insert("content".to_string(), Value::String(content.clone()));
    memory.insert("messageCount".to_string(), json!(message_count));
    memory.insert(
        "firstMessageAt".to_string(),
        Value::String(first_message_at),
    );
    memory.insert("lastMessageAt".to_string(), Value::String(last_message_at));
    memory.insert("createdAt".to_string(), Value::String(created_at));
    let embedding = public_memory_recall_embedding(value.get("embedding"));
    if !embedding.is_null() {
        memory.insert("embedding".to_string(), embedding);
    }
    if let Some(kind) = optional_sanctioned_memory_recall_kind(value)? {
        memory.insert("memoryKind".to_string(), json!(kind));
    }
    if let Some(scope_type) = optional_sanctioned_memory_recall_scope_type(value)? {
        memory.insert("scopeType".to_string(), json!(scope_type));
    }
    for key in [
        "canonicalMemoryVersion",
        "scopeId",
        "legacySourceLane",
        "legacySourceId",
        "creationReason",
        "source",
        "target",
        "targetCharacterId",
        "targetCharacterName",
        "commandMemoryKey",
        "correctionOfMemoryId",
    ] {
        if let Some(field_value) = value.get(key).filter(|field_value| !field_value.is_null()) {
            memory.insert(key.to_string(), field_value.clone());
        }
    }
    if memory.get("canonicalMemoryVersion").and_then(Value::as_u64) == Some(1) {
        memory.insert("status".to_string(), json!("active"));
    }

    Some((memory, keys, content))
}

fn canonical_memory_kind(memory: &Map<String, Value>, chat_id: &str) -> &'static str {
    if string_from_object(memory, "source").as_deref() == Some("correction")
        || string_from_object(memory, "correctionOfMemoryId").is_some()
    {
        return "correction";
    }
    if string_from_object(memory, "sourceChatId")
        .as_deref()
        .is_some_and(|source_chat_id| source_chat_id != chat_id)
    {
        return "imported";
    }
    if memory
        .get("commandMemoryKey")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        return "command";
    }
    if memory
        .get("messageIds")
        .and_then(Value::as_array)
        .is_some_and(|ids| !ids.is_empty())
    {
        return "transcript";
    }
    "manual"
}

fn set_if_absent(memory: &mut Map<String, Value>, key: &str, value: Value) -> bool {
    if memory.get(key).is_some_and(|existing| !existing.is_null()) {
        return false;
    }
    memory.insert(key.to_string(), value);
    true
}

fn canonicalize_memory_projection(
    memory: &mut Map<String, Value>,
    chat_id: &str,
    now: &str,
) -> bool {
    let mut changed = false;
    if memory.get("canonicalMemoryVersion").and_then(Value::as_u64) != Some(1) {
        memory.insert("canonicalMemoryVersion".to_string(), json!(1));
        changed = true;
    }
    if memory.get("status").is_none() {
        memory.insert("status".to_string(), json!("active"));
        changed = true;
    }
    let kind = canonical_memory_kind(memory, chat_id);
    if memory.get("memoryKind").and_then(Value::as_str) != Some(kind) {
        memory.insert("memoryKind".to_string(), json!(kind));
        changed = true;
    }
    changed |= set_if_absent(memory, "scopeType", json!("chat"));
    changed |= set_if_absent(memory, "scopeId", json!(chat_id));
    changed |= set_if_absent(memory, "legacySourceLane", json!("chats.memories"));
    if let Some(id) = string_from_object(memory, "id") {
        changed |= set_if_absent(memory, "legacySourceId", json!(id));
    }
    changed |= set_if_absent(memory, "creationReason", json!("Migrated chat memory"));
    changed |= set_if_absent(memory, "migratedAt", json!(now));
    changed
}

fn canonicalize_transcript_capture(memory: &mut Map<String, Value>, chat_id: &str) {
    memory.insert("canonicalMemoryVersion".to_string(), json!(1));
    memory.insert("status".to_string(), json!("active"));
    memory.insert("memoryKind".to_string(), json!("transcript"));
    memory.insert("scopeType".to_string(), json!("chat"));
    memory.insert("scopeId".to_string(), json!(chat_id));
    memory.insert("legacySourceLane".to_string(), json!("chats.memories"));
    if let Some(id) = string_from_object(memory, "id") {
        memory.insert("legacySourceId".to_string(), json!(id));
    }
    memory.insert(
        "creationReason".to_string(),
        json!("Automatic transcript chunk capture"),
    );
}

fn legacy_source_ids(memories: &[Value]) -> HashSet<String> {
    memories
        .iter()
        .filter_map(|memory| memory.get("legacySourceId").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn memory_projection_id(prefix: &str, seed: &str) -> String {
    let mut hash = 2166136261_u32;
    for byte in seed.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    format!("memory-{prefix}-{:08x}", hash)
}

struct MigratedMemoryProjection<'a> {
    chat_id: &'a str,
    content: &'a str,
    kind: &'a str,
    scope_type: &'a str,
    scope_id: &'a str,
    source_lane: &'a str,
    source_id: &'a str,
    created_at: &'a str,
    reason: &'a str,
}

fn migrated_memory_base(projection: MigratedMemoryProjection<'_>) -> Map<String, Value> {
    let mut memory = Map::new();
    memory.insert(
        "id".to_string(),
        Value::String(memory_projection_id(projection.kind, projection.source_id)),
    );
    memory.insert(
        "chatId".to_string(),
        Value::String(projection.chat_id.to_string()),
    );
    memory.insert(
        "content".to_string(),
        Value::String(projection.content.to_string()),
    );
    memory.insert("messageCount".to_string(), json!(1));
    memory.insert(
        "firstMessageAt".to_string(),
        Value::String(projection.created_at.to_string()),
    );
    memory.insert(
        "lastMessageAt".to_string(),
        Value::String(projection.created_at.to_string()),
    );
    memory.insert(
        "createdAt".to_string(),
        Value::String(projection.created_at.to_string()),
    );
    memory.insert("canonicalMemoryVersion".to_string(), json!(1));
    memory.insert("memoryKind".to_string(), json!(projection.kind));
    memory.insert("scopeType".to_string(), json!(projection.scope_type));
    memory.insert("scopeId".to_string(), json!(projection.scope_id));
    memory.insert(
        "legacySourceLane".to_string(),
        json!(projection.source_lane),
    );
    memory.insert("legacySourceId".to_string(), json!(projection.source_id));
    memory.insert("creationReason".to_string(), json!(projection.reason));
    memory.insert("status".to_string(), json!("active"));
    memory
}

fn push_character_memory_projections(
    state: &AppState,
    chat: &Value,
    chat_id: &str,
    memories: &mut Vec<Value>,
    seen: &mut HashSet<String>,
    now: &str,
) -> AppResult<usize> {
    let mut created = 0usize;
    for character_id in string_array_from_value(chat.get("characterIds")) {
        let Some(character) = state.storage.get("characters", &character_id)? else {
            continue;
        };
        let data = object_or_parse(character.get("data"));
        let extensions = object_or_parse(data.get("extensions"));
        let Some(character_memories) = extensions
            .get("characterMemories")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for (index, value) in character_memories.iter().enumerate() {
            let record = object_or_parse(Some(value));
            let Some(summary) = string_field_trimmed(&Value::Object(record.clone()), "summary")
            else {
                continue;
            };
            let created_at = string_field_trimmed(&Value::Object(record.clone()), "createdAt")
                .unwrap_or_else(|| now.to_string());
            let scene_chat_id = string_field_trimmed(&Value::Object(record.clone()), "sceneChatId");
            let source_id = format!(
                "character:{character_id}:{}:{}:{index}",
                scene_chat_id.clone().unwrap_or_default(),
                created_at
            );
            if !seen.insert(source_id.clone()) {
                continue;
            }
            let mut memory = migrated_memory_base(MigratedMemoryProjection {
                chat_id,
                content: &summary,
                kind: "character",
                scope_type: "character",
                scope_id: &character_id,
                source_lane: "characters.data.extensions.characterMemories",
                source_id: &source_id,
                created_at: &created_at,
                reason: "Migrated character memory",
            });
            if let Some(scene_chat_id) = scene_chat_id {
                memory.insert("sceneChatId".to_string(), Value::String(scene_chat_id));
            }
            memories.push(Value::Object(memory));
            created += 1;
        }
    }
    Ok(created)
}

fn push_scene_summary_projections(
    chat: &Value,
    chat_id: &str,
    memories: &mut Vec<Value>,
    seen: &mut HashSet<String>,
    now: &str,
) -> usize {
    let metadata = object_or_parse(chat.get("metadata"));
    let mut created = 0usize;
    let Some(history) = metadata
        .get("roleplaySceneHistory")
        .and_then(Value::as_array)
    else {
        return 0;
    };
    for (index, value) in history.iter().enumerate() {
        let record = object_or_parse(Some(value));
        let Some(summary) = string_field_trimmed(&Value::Object(record.clone()), "summary") else {
            continue;
        };
        let scene_chat_id = string_field_trimmed(&Value::Object(record.clone()), "sceneChatId")
            .unwrap_or_else(|| chat_id.to_string());
        let concluded_at = string_field_trimmed(&Value::Object(record.clone()), "concludedAt")
            .unwrap_or_else(|| now.to_string());
        let source_id = format!("scene:{scene_chat_id}:{concluded_at}:{index}");
        if !seen.insert(source_id.clone()) {
            continue;
        }
        let mut memory = migrated_memory_base(MigratedMemoryProjection {
            chat_id,
            content: &summary,
            kind: "scene_summary",
            scope_type: "scene",
            scope_id: &scene_chat_id,
            source_lane: "chats.metadata.roleplaySceneHistory",
            source_id: &source_id,
            created_at: &concluded_at,
            reason: "Migrated roleplay scene summary",
        });
        memory.insert("sceneChatId".to_string(), Value::String(scene_chat_id));
        memories.push(Value::Object(memory));
        created += 1;
    }
    created
}

fn push_chat_summary_projections(
    chat: &Value,
    chat_id: &str,
    memories: &mut Vec<Value>,
    seen: &mut HashSet<String>,
    now: &str,
) -> usize {
    let metadata = object_or_parse(chat.get("metadata"));
    let mut created = 0usize;
    if let Some(entries) = metadata.get("summaryEntries").and_then(Value::as_array) {
        for (index, value) in entries.iter().enumerate() {
            let record = object_or_parse(Some(value));
            let Some(content) = string_field_trimmed(&Value::Object(record.clone()), "content")
            else {
                continue;
            };
            let id = string_field_trimmed(&Value::Object(record.clone()), "id")
                .unwrap_or_else(|| index.to_string());
            let created_at = string_field_trimmed(&Value::Object(record.clone()), "createdAt")
                .unwrap_or_else(|| now.to_string());
            let source_id = format!("summary-entry:{id}");
            if !seen.insert(source_id.clone()) {
                continue;
            }
            memories.push(Value::Object(migrated_memory_base(
                MigratedMemoryProjection {
                    chat_id,
                    content: &content,
                    kind: "summary",
                    scope_type: "chat",
                    scope_id: chat_id,
                    source_lane: "chats.metadata.summaryEntries",
                    source_id: &source_id,
                    created_at: &created_at,
                    reason: "Migrated chat summary entry",
                },
            )));
            created += 1;
        }
    }
    if let Some(summary) =
        string_field_trimmed(chat.get("metadata").unwrap_or(&Value::Null), "summary")
    {
        let source_id = "summary:legacy".to_string();
        if seen.insert(source_id.clone()) {
            memories.push(Value::Object(migrated_memory_base(
                MigratedMemoryProjection {
                    chat_id,
                    content: &summary,
                    kind: "summary",
                    scope_type: "chat",
                    scope_id: chat_id,
                    source_lane: "chats.metadata.summary",
                    source_id: &source_id,
                    created_at: now,
                    reason: "Migrated legacy compiled chat summary",
                },
            )));
            created += 1;
        }
    }
    created
}

fn migration_metadata(
    mut metadata: Map<String, Value>,
    now: &str,
    created: usize,
    updated: usize,
) -> Map<String, Value> {
    metadata.insert(
        "memoryMigration".to_string(),
        json!({
            "version": 1,
            "migratedAt": now,
            "created": created,
            "updated": updated,
            "strategy": "additive_canonical_projection",
            "rollback": "Remove rows with canonicalMemoryVersion=1 and migratedAt/legacySourceLane, or ignore them and keep legacy lanes; original character memories, scene history, summaries, agent-memory, and plugin-memory are not deleted.",
            "separateLanes": {
                "agent-memory": "separate_runtime_state",
                "plugin-memory": "separate_extension_state"
            }
        }),
    );
    metadata
}

pub(crate) async fn rebuild_chat_memory_indexes(
    state: &AppState,
    chat_id: &str,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let embedding_context = memory_embedding_context(state, &chat).await?;
    let mut values = chat_memory_values_for_mutation(&chat)?;
    let mut rebuilt = 0usize;
    for memory in &mut values {
        if !chat_memory_is_retrievable(memory) {
            continue;
        }
        let Some(object) = memory.as_object_mut() else {
            continue;
        };
        if embed_chat_memory_object(object, embedding_context.as_ref())
            .await
            .is_ok()
        {
            rebuilt += 1;
        }
    }
    set_chat_memory_values(state, chat_id, values)?;
    Ok(json!({ "rebuilt": rebuilt }))
}

pub(crate) async fn migrate_chat_memories(state: &AppState, chat_id: &str) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let embedding_context = memory_embedding_context(state, &chat).await?;
    let now = now_iso();
    let mut values = chat_memory_values_for_mutation(&chat)?;
    let mut updated = 0usize;
    for memory in &mut values {
        let Some(object) = memory.as_object_mut() else {
            continue;
        };
        if canonicalize_memory_projection(object, chat_id, &now) {
            updated += 1;
        }
        if chat_memory_is_retrievable(&Value::Object(object.clone())) {
            embed_chat_memory_object(object, embedding_context.as_ref()).await?;
        }
    }
    let mut seen = legacy_source_ids(&values);
    let mut created = 0usize;
    created +=
        push_character_memory_projections(state, &chat, chat_id, &mut values, &mut seen, &now)?;
    created += push_scene_summary_projections(&chat, chat_id, &mut values, &mut seen, &now);
    created += push_chat_summary_projections(&chat, chat_id, &mut values, &mut seen, &now);
    for memory in values.iter_mut().rev().take(created) {
        if let Some(object) = memory.as_object_mut() {
            embed_chat_memory_object(object, embedding_context.as_ref()).await?;
        }
    }
    let metadata = migration_metadata(
        object_or_parse(chat.get("metadata")),
        &now,
        created,
        updated,
    );
    state.storage.patch(
        "chats",
        chat_id,
        json!({ "memories": values, "metadata": metadata }),
    )?;
    Ok(json!({ "created": created, "updated": updated, "version": 1 }))
}
pub(crate) async fn import_chat_memories(
    state: &AppState,
    chat_id: &str,
    body: Value,
    replace: Option<bool>,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let (incoming, source_chat_id) = memory_recall_import_chunks(&body)?;
    let replace = replace.unwrap_or(false);
    let mut memories = if replace {
        Vec::new()
    } else {
        chat_memory_values_for_mutation(&chat)?
    };
    let mut seen = memories
        .iter()
        .filter_map(memory_recall_existing_keys)
        .flatten()
        .collect::<HashSet<_>>();
    let now = now_iso();
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut lexical_indexed = 0usize;
    for value in incoming {
        let Some((mut memory, keys, content)) =
            normalize_memory_recall_import_chunk(value, chat_id, &source_chat_id, &now)
        else {
            skipped += 1;
            continue;
        };
        if keys.iter().any(|key| seen.contains(key)) {
            skipped += 1;
            continue;
        }
        memory.remove("embedding");
        memory.remove("embeddingConnectionId");
        memory.remove("embeddingModel");
        insert_memory_embedding_fields(&mut memory, embed_memory_content(None, &content).await?);
        lexical_indexed += 1;
        if let Some(stored_keys) = memory_recall_existing_keys(&Value::Object(memory.clone())) {
            seen.extend(stored_keys);
        } else {
            seen.extend(keys);
        }
        memories.push(Value::Object(memory));
        imported += 1;
    }
    if replace && imported == 0 {
        return Err(AppError::invalid_input(
            "Memory Recall replace import must contain at least one importable chunk",
        ));
    }
    set_chat_memory_values(state, chat_id, memories)?;
    if replace {
        canonical_memory::delete_memory_index_rows_for_chat(state, chat_id)?;
    }
    Ok(json!({
        "imported": imported,
        "skipped": skipped,
        "replaced": replace,
        "lexicalIndexed": lexical_indexed
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use std::collections::HashSet;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-chat-memory-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp chat memory dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn memory_ids(value: &Value) -> Vec<String> {
        value
            .as_array()
            .expect("memory list should be an array")
            .iter()
            .filter_map(|memory| {
                memory
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect()
    }

    fn memory_index_ids(state: &AppState) -> Vec<String> {
        let mut ids = state
            .storage
            .list("memory-index-rows")
            .expect("memory indexes should list")
            .iter()
            .filter_map(|row| row.get("id").and_then(Value::as_str).map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        ids.sort();
        ids
    }

    fn seed_chat_scoped_memory_index(
        state: &AppState,
        chat_id: &str,
        memory_id: &str,
        index_id: &str,
    ) {
        let memory = super::super::canonical_memory::create_memory(
            state,
            json!({
                "id": memory_id,
                "kind": "fact",
                "status": "active",
                "scope": { "kind": "chat", "id": chat_id },
                "content": format!("{memory_id} remembers the archive key."),
                "confidence": 0.9,
                "provenance": {
                    "sourceChatId": chat_id,
                    "messageIds": ["message-1"],
                    "timestamp": "2026-07-06T12:00:00.000Z"
                },
                "tags": []
            }),
        )
        .expect("canonical memory should seed");
        super::super::canonical_memory::upsert_memory_index_row(
            state,
            json!({
                "id": index_id,
                "memoryId": memory_id,
                "provider": "lexical",
                "model": "de-koi-lexical-v1",
                "dimensions": 64,
                "contentHash": format!("{index_id}-content"),
                "projectionHash": format!("{index_id}-projection"),
                "canonicalUpdatedAt": memory["updatedAt"],
                "vector": [0.1, 0.2]
            }),
        )
        .expect("memory index should seed");
    }
    fn seed_five_visible_messages(state: &AppState, chat_id: &str) -> (Vec<String>, String) {
        let mut message_ids = Vec::new();
        let mut content_lines = Vec::new();
        for index in 0..5 {
            let id = format!("message-{index}");
            let role = if index % 2 == 0 { "user" } else { "assistant" };
            let content = format!("visible memory {index}");
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": id,
                        "chatId": chat_id,
                        "role": role,
                        "content": content,
                        "createdAt": format!("2026-06-01T10:0{index}:00.000Z")
                    }),
                )
                .expect("message should seed");
            message_ids.push(format!("message-{index}"));
            let speaker = if role == "user" { "User" } else { role };
            content_lines.push(format!("{speaker}: visible memory {index}"));
        }
        (message_ids, content_lines.join("\n"))
    }

    #[test]
    fn list_chat_memories_accepts_string_serialized_chunks() {
        let state = test_state("chat-memory-list-string");
        let memories = serde_json::to_string(&json!([
            { "id": "stored-old", "lastMessageAt": "2026-01-01T00:00:00.000Z" },
            { "id": "stored-new", "lastMessageAt": "2026-01-02T00:00:00.000Z" }
        ]))
        .expect("memory fixture should serialize");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Serialized memory chat",
                    "memories": memories
                }),
            )
            .expect("chat should be created");

        let stored = list_chat_memories(&state, "chat-1", None, None)
            .expect("serialized memories should list in stored order");
        assert_eq!(memory_ids(&stored), vec!["stored-old", "stored-new"]);

        let recent = list_chat_memories(&state, "chat-1", Some(1), Some("recent"))
            .expect("serialized memories should sort by recency");
        assert_eq!(memory_ids(&recent), vec!["stored-new"]);
    }

    #[test]
    fn delete_chat_memory_preserves_serialized_non_target_chunks() {
        let state = test_state("chat-memory-delete-serialized");
        let memories = serde_json::to_string(&json!([
            { "id": "delete-me", "lastMessageAt": "2026-01-01T00:00:00.000Z" },
            { "id": "keep-me", "lastMessageAt": "2026-01-02T00:00:00.000Z" }
        ]))
        .expect("memory fixture should serialize");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Serialized memory delete chat",
                    "memories": memories
                }),
            )
            .expect("chat should be created");

        let listed = list_chat_memories(&state, "chat-1", None, None)
            .expect("serialized memories should be visible before deletion");
        assert_eq!(memory_ids(&listed), vec!["delete-me", "keep-me"]);

        delete_chat_memory(&state, "chat-1", "delete-me")
            .expect("serialized memory deletion should preserve non-target chunks");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(memory_ids(&chat["memories"]), vec!["keep-me"]);
    }

    #[test]
    fn delete_chat_memory_preserves_array_non_target_chunks() {
        let state = test_state("chat-memory-delete-array");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Array memory delete chat",
                    "memories": [
                        { "id": "delete-me", "lastMessageAt": "2026-01-01T00:00:00.000Z" },
                        { "id": "keep-me", "lastMessageAt": "2026-01-02T00:00:00.000Z" }
                    ]
                }),
            )
            .expect("chat should be created");

        delete_chat_memory(&state, "chat-1", "delete-me")
            .expect("array memory deletion should preserve non-target chunks");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(memory_ids(&chat["memories"]), vec!["keep-me"]);
    }

    #[tokio::test]
    async fn migration_projects_legacy_memory_lanes_without_trusting_old_vectors() {
        let state = test_state("chat-memory-migration-lanes");
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-1",
                    "name": "Mira",
                    "data": {
                        "name": "Mira",
                        "extensions": {
                            "characterMemories": [
                                {
                                    "from": "DM",
                                    "summary": "Mira remembers the user likes jasmine tea.",
                                    "createdAt": "2026-01-02T00:00:00.000Z"
                                },
                                {
                                    "from": "Moonlit duel",
                                    "sceneChatId": "scene-1",
                                    "summary": "Mira and the user survived the moonlit duel.",
                                    "createdAt": "2026-01-03T00:00:00.000Z"
                                }
                            ]
                        }
                    }
                }),
            )
            .expect("character should seed");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Migration chat",
                    "mode": "conversation",
                    "characterIds": ["char-1"],
                    "metadata": {
                        "summary": "Legacy rolling summary says the lantern key matters.",
                        "summaryEntries": [
                            {
                                "id": "summary-1",
                                "content": "Summary entry says jasmine tea matters.",
                                "createdAt": "2026-01-04T00:00:00.000Z"
                            }
                        ],
                        "roleplaySceneHistory": [
                            {
                                "sceneChatId": "scene-1",
                                "summary": "The moonlit duel ended peacefully.",
                                "concludedAt": "2026-01-05T00:00:00.000Z"
                            }
                        ]
                    },
                    "memories": [
                        {
                            "id": "transcript-old-vector",
                            "chatId": "chat-1",
                            "content": "User: old transcript memory",
                            "messageCount": 5,
                            "messageIds": ["m1", "m2", "m3", "m4", "m5"],
                            "firstMessageAt": "2026-01-01T00:00:00.000Z",
                            "lastMessageAt": "2026-01-01T00:05:00.000Z",
                            "createdAt": "2026-01-01T00:06:00.000Z",
                            "hasEmbedding": true,
                            "embedding": [0.42],
                            "embeddingSource": "legacy"
                        },
                        {
                            "id": "imported-old",
                            "chatId": "chat-1",
                            "content": "Imported memory from another chat.",
                            "messageCount": 1,
                            "sourceChatId": "other-chat",
                            "firstMessageAt": "2026-01-01T00:00:00.000Z",
                            "lastMessageAt": "2026-01-01T00:00:00.000Z",
                            "createdAt": "2026-01-01T00:00:00.000Z"
                        },
                        {
                            "id": "manual-old",
                            "chatId": "chat-1",
                            "content": "Manual memory without messages.",
                            "messageCount": 1,
                            "firstMessageAt": "2026-01-01T00:00:00.000Z",
                            "lastMessageAt": "2026-01-01T00:00:00.000Z",
                            "createdAt": "2026-01-01T00:00:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let result = migrate_chat_memories(&state, "chat-1")
            .await
            .expect("migration should succeed");
        assert!(result["created"].as_u64().unwrap_or_default() >= 3);
        assert!(result["updated"].as_u64().unwrap_or_default() >= 3);

        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert_eq!(chat["metadata"]["memoryMigration"]["version"], json!(1));
        assert_eq!(
            chat["metadata"]["memoryMigration"]["separateLanes"]["agent-memory"],
            json!("separate_runtime_state")
        );
        assert_eq!(
            chat["metadata"]["memoryMigration"]["separateLanes"]["plugin-memory"],
            json!("separate_extension_state")
        );
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");
        let transcript = memories
            .iter()
            .find(|memory| memory["id"] == json!("transcript-old-vector"))
            .expect("transcript memory should remain");
        assert_eq!(transcript["canonicalMemoryVersion"], json!(1));
        assert_eq!(transcript["memoryKind"], json!("transcript"));
        assert_eq!(transcript["embeddingSource"], json!("lexical"));
        assert!(transcript["embedding"].as_array().unwrap().len() > 8);
        assert!(memories
            .iter()
            .any(|memory| memory["memoryKind"] == json!("imported")));
        assert!(memories
            .iter()
            .any(|memory| memory["memoryKind"] == json!("manual")));
        assert!(memories.iter().any(|memory| {
            memory["memoryKind"] == json!("character")
                && memory["scopeType"] == json!("character")
                && memory["scopeId"] == json!("char-1")
        }));
        assert!(memories.iter().any(|memory| {
            memory["memoryKind"] == json!("scene_summary")
                && memory["scopeType"] == json!("scene")
                && memory["scopeId"] == json!("scene-1")
        }));
        assert!(memories
            .iter()
            .any(|memory| memory["memoryKind"] == json!("summary")));
    }

    #[tokio::test]
    async fn migration_export_import_and_index_rebuild_preserve_canonical_projection() {
        let state = test_state("chat-memory-migration-export-import");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "source-chat",
                    "name": "Source chat",
                    "mode": "conversation",
                    "memories": [
                        {
                            "id": "canonical-missing-index",
                            "chatId": "source-chat",
                            "content": "Canonical migrated memory without an index.",
                            "canonicalMemoryVersion": 1,
                            "memoryKind": "manual",
                            "scopeType": "chat",
                            "scopeId": "source-chat",
                            "messageCount": 1,
                            "firstMessageAt": "2026-01-01T00:00:00.000Z",
                            "lastMessageAt": "2026-01-01T00:00:00.000Z",
                            "createdAt": "2026-01-01T00:00:00.000Z",
                            "hasEmbedding": false,
                            "embeddingStatus": "pending"
                        }
                    ]
                }),
            )
            .expect("source chat should seed");

        let rebuild = rebuild_chat_memory_indexes(&state, "source-chat")
            .await
            .expect("index rebuild should succeed");
        assert_eq!(rebuild["rebuilt"], json!(1));
        let source = state.storage.get("chats", "source-chat").unwrap().unwrap();
        assert_eq!(source["memories"][0]["hasEmbedding"], json!(true));
        assert_eq!(source["memories"][0]["embeddingSource"], json!("lexical"));

        let exported = export_chat_memories(&state, "source-chat").expect("export should succeed");
        assert_eq!(
            exported["data"]["chunks"][0]["canonicalMemoryVersion"],
            json!(1)
        );
        assert_eq!(exported["data"]["chunks"][0]["memoryKind"], json!("manual"));
        assert_eq!(exported["data"]["chunks"][0]["scopeType"], json!("chat"));

        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "target-chat",
                    "name": "Target chat",
                    "mode": "conversation",
                    "memories": []
                }),
            )
            .expect("target chat should seed");
        import_chat_memories(&state, "target-chat", exported, None)
            .await
            .expect("import should preserve canonical metadata");
        let target = state.storage.get("chats", "target-chat").unwrap().unwrap();
        assert_eq!(target["memories"][0]["canonicalMemoryVersion"], json!(1));
        assert_eq!(target["memories"][0]["memoryKind"], json!("manual"));
        assert_eq!(target["memories"][0]["scopeType"], json!("chat"));
        assert_eq!(target["memories"][0]["sourceChatId"], json!("source-chat"));
    }
    #[tokio::test]
    async fn memory_console_actions_update_index_state() {
        let state = test_state("chat-memory-console-actions");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Console memory chat",
                    "mode": "conversation",
                    "memories": [
                        {
                            "id": "memory-1",
                            "chatId": "chat-1",
                            "content": "Mira keeps the blue key under the lantern.",
                            "messageCount": 1,
                            "firstMessageAt": "2026-01-01T00:00:00.000Z",
                            "lastMessageAt": "2026-01-01T00:00:00.000Z",
                            "createdAt": "2026-01-01T00:00:00.000Z",
                            "hasEmbedding": true,
                            "embedding": [1, 0, 0],
                            "embeddingStatus": "vectorized",
                            "embeddingSource": "lexical"
                        }
                    ]
                }),
            )
            .expect("chat should be created");

        pin_chat_memory(&state, "chat-1", "memory-1", true).expect("pin should persist");
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert_eq!(chat["memories"][0]["pinned"], json!(true));

        update_chat_memory(
            &state,
            "chat-1",
            "memory-1",
            json!({ "content": "Mira keeps the silver key under the lantern." }),
        )
        .await
        .expect("edit should re-index");
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert_eq!(chat["memories"][0]["userEdited"], json!(true));
        assert_eq!(chat["memories"][0]["hasEmbedding"], json!(true));
        assert!(chat["memories"][0]["embedding"].as_array().unwrap().len() > 8);

        let mut embedding_missing = chat["memories"][0].as_object().unwrap().clone();
        embedding_missing.insert("status".to_string(), json!("active"));
        remove_memory_embedding_fields(&mut embedding_missing);
        assert_eq!(embedding_missing["status"], json!("active"));
        assert_eq!(chat_memory_object_status(&embedding_missing), "active");
        assert_ne!(embedding_missing.get("status"), Some(&json!("unavailable")));
        assert_eq!(embedding_missing["hasEmbedding"], json!(false));
        assert_eq!(embedding_missing["embeddingStatus"], json!("missing"));
        assert!(embedding_missing.get("embedding").is_none());
        assert!(chat_memory_object_is_retrievable(&embedding_missing));
        let mut deleted_embedding_missing = embedding_missing.clone();
        deleted_embedding_missing.insert("status".to_string(), json!("deleted"));
        remove_memory_embedding_fields(&mut deleted_embedding_missing);
        assert_eq!(deleted_embedding_missing["status"], json!("deleted"));
        assert!(!chat_memory_object_is_retrievable(
            &deleted_embedding_missing
        ));
        state
            .storage
            .patch(
                "chats",
                "chat-1",
                json!({ "memories": [embedding_missing] }),
            )
            .expect("embedding-missing memory should seed");
        update_chat_memory(
            &state,
            "chat-1",
            "memory-1",
            json!({ "content": "Mira keeps the bronze key under the lantern." }),
        )
        .await
        .expect("embedding-missing active memory should remain editable and re-index");
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert_eq!(chat["memories"][0]["status"], json!("active"));
        assert_eq!(chat["memories"][0]["hasEmbedding"], json!(true));
        assert!(chat["memories"][0]["embedding"].as_array().unwrap().len() > 8);

        soft_delete_chat_memory(&state, "chat-1", "memory-1").expect("delete should deactivate");
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert_eq!(chat["memories"][0]["status"], json!("deleted"));
        assert_eq!(chat["memories"][0]["hasEmbedding"], json!(false));
        assert!(chat["memories"][0].get("embedding").is_none());
        let rejected_deleted_edit = update_chat_memory(
            &state,
            "chat-1",
            "memory-1",
            json!({ "content": "Deleted memories must not update." }),
        )
        .await;
        assert!(rejected_deleted_edit.is_err());
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert_eq!(
            chat["memories"][0]["content"],
            json!("Mira keeps the bronze key under the lantern.")
        );

        restore_chat_memory(&state, "chat-1", "memory-1")
            .await
            .expect("restore should rebuild index");
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        assert_eq!(chat["memories"][0]["status"], json!("active"));
        assert_eq!(chat["memories"][0]["hasEmbedding"], json!(true));
        assert!(chat["memories"][0]["embedding"].as_array().unwrap().len() > 8);

        correct_chat_memory(
            &state,
            "chat-1",
            "memory-1",
            json!({ "replacementContent": "Mira keeps the gold key under the bridge." }),
        )
        .await
        .expect("correction should deactivate original and index replacement");
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        let memories = chat["memories"]
            .as_array()
            .expect("memories should remain an array");
        assert_eq!(memories.len(), 2);
        assert_eq!(memories[0]["status"], json!("wrong"));
        assert_eq!(memories[0]["hasEmbedding"], json!(false));
        let rejected_wrong_edit = update_chat_memory(
            &state,
            "chat-1",
            "memory-1",
            json!({ "content": "Wrong memories must not update." }),
        )
        .await;
        assert!(rejected_wrong_edit.is_err());
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        let memories = chat["memories"]
            .as_array()
            .expect("memories should remain an array");
        assert_eq!(
            memories[0]["content"],
            json!("Mira keeps the bronze key under the lantern.")
        );
        assert_eq!(memories[1]["source"], json!("correction"));
        assert_eq!(memories[1]["correctionOfMemoryId"], json!("memory-1"));
        assert_eq!(memories[1]["canonicalMemoryVersion"], json!(1));
        assert_eq!(memories[1]["memoryKind"], json!("correction"));
        assert_eq!(memories[1]["scopeType"], json!("chat"));
        assert_eq!(memories[1]["scopeId"], json!("chat-1"));
        assert_eq!(memories[1]["status"], json!("active"));
        assert_eq!(memories[1]["hasEmbedding"], json!(true));
    }
    #[test]
    fn clear_chat_memories_removes_all_chunks() {
        let state = test_state("chat-memory-clear-all");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Clear memory chat",
                    "memories": [
                        {
                            "id": "transcript-memory",
                            "content": "transcript",
                            "messageIds": ["message-1", "message-2"]
                        },
                        {
                            "id": "command-memory",
                            "content": "command",
                            "source": "connected_command",
                            "messageIds": []
                        }
                    ]
                }),
            )
            .expect("chat should be created");

        clear_chat_memories(&state, "chat-1").expect("clear should succeed");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(memory_ids(&chat["memories"]), Vec::<String>::new());
    }

    #[test]
    fn clear_chat_memories_removes_chat_scoped_memory_index_rows() {
        let state = test_state("chat-memory-clear-index-rows");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Clear memory index chat",
                    "memories": [
                        { "id": "memory-one", "content": "first memory" },
                        { "id": "memory-two", "content": "second memory" }
                    ]
                }),
            )
            .expect("chat should seed");
        seed_chat_scoped_memory_index(&state, "chat-1", "canonical-one", "index-one");
        seed_chat_scoped_memory_index(&state, "chat-1", "canonical-two", "index-two");
        seed_chat_scoped_memory_index(&state, "other-chat", "canonical-other", "index-other");

        clear_chat_memories(&state, "chat-1").expect("clear should succeed");

        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(memory_ids(&chat["memories"]), Vec::<String>::new());
        assert_eq!(memory_index_ids(&state), vec!["index-other".to_string()]);
    }
    #[test]
    fn delete_chat_memory_rejects_malformed_serialized_chunks() {
        let state = test_state("chat-memory-delete-malformed");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Malformed memory delete chat",
                    "memories": "{not valid json"
                }),
            )
            .expect("chat should be created");

        let error = delete_chat_memory(&state, "chat-1", "delete-me")
            .expect_err("malformed serialized memory deletion should be rejected");
        assert_eq!(error.code, "invalid_input");

        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(chat["memories"], json!("{not valid json"));
    }

    #[test]
    fn list_chat_memories_excludes_recent_overlap_before_limit() {
        let state = test_state("chat-memory-list-filter-before-limit");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Filtered memory chat",
                    "memories": [
                        { "id": "recent-legacy-a", "lastMessageAt": "2026-01-10T00:00:00.000Z" },
                        { "id": "recent-legacy-b", "lastMessageAt": "2026-01-10T00:01:00.000Z" },
                        { "id": "older-eligible", "lastMessageAt": "2026-01-01T00:00:00.000Z" }
                    ]
                }),
            )
            .expect("chat should be created");
        let exclude_recent_message_ids = vec!["recent-message".to_string()];

        let filtered = list_chat_memories_excluding_recent(
            &state,
            "chat-1",
            Some(1),
            Some("recent"),
            &exclude_recent_message_ids,
            Some("2026-01-10T00:00:00.000Z"),
        )
        .expect("recent overlap should filter before limit");

        assert_eq!(memory_ids(&filtered), vec!["older-eligible"]);
    }

    #[test]
    fn list_chat_memories_can_return_recent_limited_chunks() {
        let state = test_state("chat-memory-list-limit");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        { "id": "old", "lastMessageAt": "2026-01-01T00:00:00.000Z" },
                        { "id": "new", "lastMessageAt": "2026-01-04T00:00:00.000Z" },
                        { "id": "created-only", "createdAt": "2026-01-03T00:00:00.000Z" },
                        { "id": "first-only", "firstMessageAt": "2026-01-02T00:00:00.000Z" },
                        { "id": "missing-date" }
                    ]
                }),
            )
            .expect("chat should be created");

        let recent = list_chat_memories(&state, "chat-1", Some(3), Some("recent"))
            .expect("recent limited memories should list");
        assert_eq!(
            memory_ids(&recent),
            vec!["new", "created-only", "first-only"]
        );

        let stored = list_chat_memories(&state, "chat-1", None, None)
            .expect("default memories should list in stored order");
        assert_eq!(
            memory_ids(&stored),
            vec!["old", "new", "created-only", "first-only", "missing-date"]
        );

        let invalid = list_chat_memories(&state, "chat-1", None, Some("popular"))
            .expect_err("unsupported ordering should be rejected");
        assert_eq!(invalid.code, "invalid_input");
    }

    #[test]
    fn chat_memory_timestamp_order_matches_recency_and_pruning() {
        let memory = json!({
            "messageIds": ["message-1"],
            "lastMessageAt": "   ",
            "createdAt": "2026-01-03T00:00:00.000Z",
            "firstMessageAt": "2026-01-01T00:00:00.000Z"
        });

        assert_eq!(
            chat_memory_recency_key(&memory),
            chat_memory_timestamp(&memory).expect("timestamp should resolve")
        );
        assert_eq!(chat_memory_recency_key(&memory), "2026-01-03T00:00:00.000Z");
        assert!(memory_overlaps_deleted_messages(
            &memory,
            &HashSet::new(),
            Some("2026-01-02T00:00:00.000Z")
        ));
    }

    #[test]
    fn message_edit_invalidation_preserves_non_transcript_memories() {
        let chat = json!({
            "id": "chat-1",
            "memories": [
                {
                    "id": "before-transcript",
                    "content": "older transcript chunk",
                    "messageIds": ["message-1", "message-2"],
                    "lastMessageAt": "2026-06-01T09:00:00.000Z"
                },
                {
                    "id": "after-transcript",
                    "content": "newer transcript chunk",
                    "messageIds": ["message-5", "message-6"],
                    "lastMessageAt": "2026-06-01T11:00:00.000Z"
                },
                {
                    "id": "imported-memory",
                    "sourceChatId": "source-chat",
                    "content": "imported row should not be pruned by transcript edit timestamps",
                    "lastMessageAt": "2026-06-01T12:00:00.000Z"
                },
                {
                    "id": "command-memory",
                    "source": "connected_command",
                    "embeddingSource": "command",
                    "commandMemoryKey": "chat-1::Mira::brass key",
                    "content": "command row should not be pruned by transcript edit timestamps",
                    "messageIds": [],
                    "lastMessageAt": "2026-06-01T13:00:00.000Z"
                }
            ]
        });

        let retained = retained_chat_memories_after_message_change(
            &chat,
            "message-5",
            "2026-06-01T10:00:00.000Z",
        )
        .expect("invalidation should succeed")
        .expect("transcript memory should be pruned");
        let retained_ids = retained
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert_eq!(
            retained_ids,
            vec!["before-transcript", "imported-memory", "command-memory"]
        );
    }

    #[test]
    fn message_delete_invalidation_preserves_non_transcript_memories() {
        let values = vec![
            json!({
                "id": "matching-transcript",
                "content": "transcript chunk with deleted message",
                "messageIds": ["message-2", "message-3"],
                "lastMessageAt": "2026-06-01T10:03:00.000Z"
            }),
            json!({
                "id": "later-transcript",
                "content": "later transcript chunk should be rebuilt after delete",
                "messageIds": ["message-4", "message-5"],
                "lastMessageAt": "2026-06-01T10:20:00.000Z"
            }),
            json!({
                "id": "imported-memory",
                "sourceChatId": "source-chat",
                "content": "imported row should survive transcript delete",
                "lastMessageAt": "2026-06-01T10:30:00.000Z"
            }),
            json!({
                "id": "command-memory",
                "source": "connected_command",
                "embeddingSource": "command",
                "commandMemoryKey": "chat-1::Mira::brass key",
                "content": "command row should survive transcript delete",
                "messageIds": [],
                "lastMessageAt": "2026-06-01T10:40:00.000Z"
            }),
        ];
        let deleted_messages = vec![json!({
            "id": "message-2",
            "createdAt": "2026-06-01T10:00:00.000Z"
        })];

        let retained = prune_chat_memory_values_for_deleted_messages(values, &deleted_messages)
            .expect("transcript memories should be pruned");
        let retained_ids = retained
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert_eq!(retained_ids, vec!["imported-memory", "command-memory"]);
    }

    #[tokio::test]
    async fn memory_embedding_context_prefers_dedicated_embedding_connection() {
        let state = test_state("memory-embedding-context");
        let chat = state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-a",
                    "name": "Chat",
                    "connectionId": "chat-connection"
                }),
            )
            .unwrap();
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "chat-connection",
                    "name": "Chat connection",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "embeddingConnectionId": "embedding-connection"
                }),
            )
            .unwrap();
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "embedding-connection",
                    "name": "Embeddings",
                    "provider": "custom",
                    "model": "chat-model",
                    "embeddingModel": "text-embedding-3-small"
                }),
            )
            .unwrap();

        let context = memory_embedding_context(&state, &chat)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(context.connection_id, "embedding-connection");
        assert_eq!(context.model, "text-embedding-3-small");
    }

    #[tokio::test]
    async fn refresh_chat_memories_errors_when_chat_embedding_override_lacks_model() {
        let state = test_state("memory-refresh-chat-override-missing-model");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "embeddingConnectionId": "override-embedding"
                }),
            )
            .expect("chat should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "override-embedding",
                    "name": "Override Embeddings",
                    "provider": "custom",
                    "model": "chat-model"
                }),
            )
            .expect("override embedding connection should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "default-embedding",
                    "name": "Default Embeddings",
                    "provider": "custom",
                    "model": "chat-model",
                    "embeddingModel": "default-embedding-model",
                    "isDefault": true
                }),
            )
            .expect("default embedding connection should seed");

        let error = refresh_chat_memories(&state, "chat-1")
            .await
            .expect_err("chat embedding override without a model should not fall back");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("embeddingModel"));
        assert!(error.message.contains("override-embedding"));
    }

    #[tokio::test]
    async fn refresh_chat_memories_prefers_chat_embedding_override_over_generation_connection() {
        let state = test_state("memory-refresh-chat-override-wins");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "connectionId": "chat-connection",
                    "embeddingConnectionId": "override-embedding"
                }),
            )
            .expect("chat should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "chat-connection",
                    "name": "Chat",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "embeddingConnectionId": "generation-embedding"
                }),
            )
            .expect("chat connection should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "generation-embedding",
                    "name": "Generation Embeddings",
                    "provider": "custom",
                    "model": "chat-model",
                    "embeddingModel": "generation-embedding-model"
                }),
            )
            .expect("generation embedding connection should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "override-embedding",
                    "name": "Override Embeddings",
                    "provider": "custom",
                    "model": "chat-model",
                    "embeddingModel": "override-embedding-model"
                }),
            )
            .expect("override embedding connection should seed");
        let (message_ids, content) = seed_five_visible_messages(&state, "chat-1");
        state
            .storage
            .patch(
                "chats",
                "chat-1",
                json!({
                    "memories": [
                        {
                            "id": "memory-1",
                            "chatId": "chat-1",
                            "content": content,
                            "messageCount": 5,
                            "messageIds": message_ids,
                            "embedding": [0.1, 0.2],
                            "hasEmbedding": true,
                            "embeddingStatus": "vectorized",
                            "embeddingSource": "provider",
                            "embeddingConnectionId": "override-embedding",
                            "embeddingModel": "override-embedding-model"
                        }
                    ]
                }),
            )
            .expect("existing memory should seed");

        let result = refresh_chat_memories(&state, "chat-1")
            .await
            .expect("matching override memory should be reused without provider call");

        assert_eq!(result["rebuilt"], json!(1));
        assert_eq!(result["embedded"], json!(0));
        assert_eq!(result["reused"], json!(1));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memory = chat["memories"][0]
            .as_object()
            .expect("memory should be an object");
        assert_eq!(memory.get("embeddingSource"), Some(&json!("provider")));
        assert_eq!(
            memory.get("embeddingConnectionId"),
            Some(&json!("override-embedding"))
        );
        assert_eq!(
            memory.get("embeddingModel"),
            Some(&json!("override-embedding-model"))
        );
    }

    #[tokio::test]
    async fn refresh_chat_memories_uses_lexical_embedding_when_no_provider_is_configured() {
        let state = test_state("memory-no-provider-lexical");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat"
                }),
            )
            .expect("chat should seed");
        for index in 0..5 {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": format!("message-{index}"),
                        "chatId": "chat-1",
                        "role": if index % 2 == 0 { "user" } else { "assistant" },
                        "content": format!("visible memory {index}"),
                        "createdAt": format!("2026-06-01T10:0{index}:00.000Z")
                    }),
                )
                .expect("message should seed");
        }

        refresh_chat_memories(&state, "chat-1")
            .await
            .expect("memory refresh should fall back to lexical embeddings");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memory = chat["memories"][0]
            .as_object()
            .expect("memory should be an object");

        assert_eq!(memory.get("embeddingSource"), Some(&json!("lexical")));
        assert_eq!(
            memory
                .get("embedding")
                .and_then(Value::as_array)
                .expect("lexical embedding should be stored")
                .len(),
            MEMORY_EMBEDDING_DIMS
        );
    }

    #[tokio::test]
    async fn refresh_chat_memories_creates_canonical_transcript_rows() {
        let state = test_state("memory-refresh-canonical-transcript");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "mode": "conversation",
                    "memories": []
                }),
            )
            .expect("chat should seed");
        for index in 1..=5 {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": format!("message-{index}"),
                        "chatId": "chat-1",
                        "role": if index % 2 == 0 { "assistant" } else { "user" },
                        "content": format!("Turn {index} remembers the observatory lantern."),
                        "createdAt": format!("2026-01-01T00:0{index}:00.000Z")
                    }),
                )
                .expect("message should seed");
        }

        refresh_chat_memories(&state, "chat-1")
            .await
            .expect("refresh should succeed");

        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        let memory = chat["memories"]
            .as_array()
            .and_then(|items| items.first())
            .expect("memory should be created");
        assert_eq!(memory["canonicalMemoryVersion"], json!(1));
        assert_eq!(memory["memoryKind"], json!("transcript"));
        assert_eq!(memory["scopeType"], json!("chat"));
        assert_eq!(memory["scopeId"], json!("chat-1"));
        assert_eq!(memory["legacySourceLane"], json!("chats.memories"));
        assert_eq!(
            memory["creationReason"],
            json!("Automatic transcript chunk capture")
        );
    }

    #[tokio::test]
    async fn refresh_chat_memories_uses_lexical_when_generation_embedding_target_lacks_model() {
        let state = test_state("memory-refresh-missing-target-model");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "connectionId": "chat-connection"
                }),
            )
            .expect("chat should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "chat-connection",
                    "name": "Chat",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "embeddingConnectionId": "embedding-connection"
                }),
            )
            .expect("chat connection should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "embedding-connection",
                    "name": "Embeddings",
                    "provider": "custom",
                    "model": "chat-model"
                }),
            )
            .expect("embedding connection should seed");
        for index in 0..5 {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": format!("message-{index}"),
                        "chatId": "chat-1",
                        "role": if index % 2 == 0 { "user" } else { "assistant" },
                        "content": format!("visible memory {index}"),
                        "createdAt": format!("2026-06-01T10:0{index}:00.000Z")
                    }),
                )
                .expect("message should seed");
        }

        refresh_chat_memories(&state, "chat-1")
            .await
            .expect("automatic memory indexing should use lexical embeddings");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(chat["memories"][0]["embeddingSource"], json!("lexical"));
        assert!(chat["memories"][0]["embeddingConnectionId"].is_null());
    }

    #[tokio::test]
    async fn refresh_chat_memories_uses_lexical_when_default_connection_lacks_embedding_model() {
        let state = test_state("memory-refresh-default-missing-model");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat"
                }),
            )
            .expect("chat should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "default-connection",
                    "name": "Default",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "isDefault": true
                }),
            )
            .expect("default connection should seed");
        for index in 0..5 {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": format!("message-{index}"),
                        "chatId": "chat-1",
                        "role": if index % 2 == 0 { "user" } else { "assistant" },
                        "content": format!("visible memory {index}"),
                        "createdAt": format!("2026-06-01T10:0{index}:00.000Z")
                    }),
                )
                .expect("message should seed");
        }

        refresh_chat_memories(&state, "chat-1")
            .await
            .expect("automatic memory indexing should use lexical embeddings");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(chat["memories"][0]["embeddingSource"], json!("lexical"));
    }

    #[tokio::test]
    async fn memory_embedding_context_uses_lexical_when_generation_embedding_connection_is_invalid()
    {
        let state = test_state("memory-refresh-invalid-embedding");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "connectionId": "chat-connection"
                }),
            )
            .expect("chat should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "chat-connection",
                    "name": "Chat",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "embeddingConnectionId": "missing-embedding"
                }),
            )
            .expect("connection should seed");

        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        let context = memory_embedding_context(&state, &chat).await.expect(
            "automatic memory indexing should tolerate unsupported embedding configuration",
        );

        assert!(context.is_none());
    }

    #[tokio::test]
    async fn import_chat_memories_uses_lexical_vectors_when_configured_embedding_target_lacks_model(
    ) {
        let state = test_state("memory-import-missing-target-model");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "connectionId": "chat-connection"
                }),
            )
            .expect("chat should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "chat-connection",
                    "name": "Chat",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "embeddingConnectionId": "embedding-connection"
                }),
            )
            .expect("chat connection should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "embedding-connection",
                    "name": "Embeddings",
                    "provider": "custom",
                    "model": "chat-model",
                    "embeddingModel": "   "
                }),
            )
            .expect("embedding connection should seed");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "source-chat",
                        "name": "Source chat",
                        "mode": "conversation",
                        "memoryCount": 2
                    },
                    "chunks": [
                        {
                            "content": "same portable memory",
                            "embedding": [99.0, -42.0],
                            "firstMessageAt": "2026-01-01T00:00:00.000Z",
                            "lastMessageAt": "2026-01-01T00:00:00.000Z",
                            "messageCount": 1
                        },
                        {
                            "content": "same portable memory",
                            "embedding": null,
                            "firstMessageAt": "2026-01-02T00:00:00.000Z",
                            "lastMessageAt": "2026-01-02T00:00:00.000Z",
                            "messageCount": 1
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("portable import should not resolve the configured embedding target");

        assert_eq!(result["imported"], json!(2));
        assert_eq!(result["lexicalIndexed"], json!(2));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("imported memories should be stored");
        assert_eq!(memories.len(), 2);
        assert_eq!(memories[0]["embedding"], memories[1]["embedding"]);
        assert_eq!(
            memories[0]["embedding"],
            json!(lexical_memory_embedding("same portable memory"))
        );
        for memory in memories {
            assert_eq!(memory["embeddingSource"], json!("lexical"));
            assert!(memory.get("embeddingConnectionId").is_none());
            assert!(memory.get("embeddingModel").is_none());
        }
    }

    #[tokio::test]
    async fn import_chat_memories_ignores_invalid_chat_embedding_override() {
        let state = test_state("memory-import-chat-override-missing-model");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "connectionId": "chat-connection",
                    "embeddingConnectionId": "override-embedding"
                }),
            )
            .expect("chat should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "chat-connection",
                    "name": "Chat",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "embeddingConnectionId": "generation-embedding"
                }),
            )
            .expect("chat connection should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "generation-embedding",
                    "name": "Generation Embeddings",
                    "provider": "custom",
                    "model": "chat-model"
                }),
            )
            .expect("generation embedding connection should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "override-embedding",
                    "name": "Override Embeddings",
                    "provider": "custom",
                    "model": "chat-model",
                    "embeddingModel": "   "
                }),
            )
            .expect("override embedding connection should seed");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "source-chat",
                        "name": "Source chat",
                        "mode": "conversation",
                        "memoryCount": 1
                    },
                    "chunks": [
                        {
                            "content": "needs override vectorization",
                            "embedding": null,
                            "messageCount": 1
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("portable import should ignore destination embedding overrides");

        assert_eq!(result["imported"], json!(1));
        assert_eq!(result["lexicalIndexed"], json!(1));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(chat["memories"][0]["embeddingSource"], json!("lexical"));
        assert!(chat["memories"][0].get("embeddingConnectionId").is_none());
        assert!(chat["memories"][0].get("embeddingModel").is_none());
    }

    #[tokio::test]
    async fn import_chat_memories_ignores_missing_configured_embedding_connection() {
        let state = test_state("memory-import-invalid-embedding");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "connectionId": "chat-connection"
                }),
            )
            .expect("chat should seed");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "chat-connection",
                    "name": "Chat",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "embeddingConnectionId": "missing-embedding"
                }),
            )
            .expect("connection should seed");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "source-chat",
                        "name": "Source chat",
                        "mode": "conversation",
                        "memoryCount": 1
                    },
                    "chunks": [
                        {
                            "content": "needs vectorization",
                            "embedding": null,
                            "messageCount": 1
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("portable import should not resolve a missing embedding connection");

        assert_eq!(result["imported"], json!(1));
        assert_eq!(result["lexicalIndexed"], json!(1));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(chat["memories"][0]["embeddingSource"], json!("lexical"));
    }

    #[tokio::test]
    async fn refresh_chat_memories_skips_legacy_and_current_hidden_flags() {
        let state = test_state("memory-hidden-flags");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat"
                }),
            )
            .expect("chat should be created");

        for message in [
            json!({
                "id": "visible-1",
                "chatId": "chat-1",
                "role": "user",
                "content": "visible memory",
                "createdAt": "2026-06-01T10:00:00.000Z"
            }),
            json!({
                "id": "visible-2",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "visible reply",
                "createdAt": "2026-06-01T10:00:30.000Z"
            }),
            json!({
                "id": "legacy-hidden-1",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "legacy hidden memory",
                "createdAt": "2026-06-01T10:01:00.000Z",
                "extra": { "hiddenFromAI": true }
            }),
            json!({
                "id": "legacy-hidden-string-1",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "string hidden memory",
                "createdAt": "2026-06-01T10:02:00.000Z",
                "extra": r#"{"hiddenFromAI":true}"#
            }),
            json!({
                "id": "current-hidden-1",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "current hidden memory",
                "createdAt": "2026-06-01T10:03:00.000Z",
                "extra": { "hiddenFromAi": true }
            }),
            json!({
                "id": "visible-3",
                "chatId": "chat-1",
                "role": "user",
                "content": "visible followup",
                "createdAt": "2026-06-01T10:04:00.000Z"
            }),
            json!({
                "id": "visible-4",
                "chatId": "chat-1",
                "role": "assistant",
                "content": "visible answer",
                "createdAt": "2026-06-01T10:05:00.000Z"
            }),
            json!({
                "id": "visible-5",
                "chatId": "chat-1",
                "role": "user",
                "content": "visible close",
                "createdAt": "2026-06-01T10:06:00.000Z"
            }),
        ] {
            state
                .storage
                .create("messages", message)
                .expect("message should be created");
        }

        refresh_chat_memories(&state, "chat-1")
            .await
            .expect("memory refresh should succeed");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat lookup should succeed")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");

        assert_eq!(memories.len(), 1);
        assert_eq!(
            memories[0]["messageIds"],
            json!([
                "visible-1",
                "visible-2",
                "visible-3",
                "visible-4",
                "visible-5"
            ])
        );
        assert_eq!(memories[0]["firstMessageId"], json!("visible-1"));
        assert_eq!(memories[0]["lastMessageId"], json!("visible-5"));
        let content = memories[0]["content"]
            .as_str()
            .expect("memory content should be a string");
        assert!(content.contains("User: visible memory"));
        assert!(content.contains("assistant: visible reply"));
        assert!(!content.contains("hidden memory"));
    }

    #[tokio::test]
    async fn refresh_chat_memories_uses_persona_and_character_names_for_chunk_speakers() {
        let state = test_state("memory-speaker-names");
        state
            .storage
            .create(
                "personas",
                json!({
                    "id": "persona-1",
                    "name": "Chai"
                }),
            )
            .expect("persona should be created");
        state
            .storage
            .create(
                "characters",
                json!({
                    "id": "char-1",
                    "name": "Mira",
                    "data": { "name": "Mira Card" }
                }),
            )
            .expect("character should be created");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "personaId": "persona-1",
                    "characterIds": ["char-1"]
                }),
            )
            .expect("chat should be created");

        for (id, role, content, character_id) in [
            ("message-1", "user", "first memory", None),
            ("message-2", "assistant", "named reply", Some("char-1")),
            ("message-3", "narrator", "scene beat", None),
            ("message-4", "assistant", "fallback reply", None),
            ("message-5", "user", "closing memory", None),
        ] {
            let mut message = json!({
                "id": id,
                "chatId": "chat-1",
                "role": role,
                "content": content,
                "createdAt": "2026-06-01T10:00:00.000Z"
            });
            if let Some(character_id) = character_id {
                message["characterId"] = json!(character_id);
            }
            state
                .storage
                .create("messages", message)
                .expect("message should be created");
        }

        refresh_chat_memories(&state, "chat-1")
            .await
            .expect("memory refresh should succeed");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat lookup should succeed")
            .expect("chat should exist");
        let content = chat["memories"][0]["content"]
            .as_str()
            .expect("memory content should be a string");

        assert!(content.contains("Chai: first memory"));
        assert!(content.contains("Mira Card: named reply"));
        assert!(content.contains("narrator: scene beat"));
        assert!(content.contains("Mira Card: fallback reply"));
        assert!(!content.contains("user: first memory"));
        assert!(!content.contains("assistant: named reply"));
    }

    #[tokio::test]
    async fn refresh_chat_memories_stores_only_complete_five_message_chunks() {
        let state = test_state("memory-complete-chunks-only");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat"
                }),
            )
            .expect("chat should seed");
        for index in 0..6 {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": format!("message-{index}"),
                        "chatId": "chat-1",
                        "role": if index % 2 == 0 { "user" } else { "assistant" },
                        "content": format!("visible memory {index}"),
                        "createdAt": format!("2026-06-01T10:0{index}:00.000Z")
                    }),
                )
                .expect("message should seed");
        }

        let result = refresh_chat_memories(&state, "chat-1")
            .await
            .expect("memory refresh should succeed");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");

        assert_eq!(result["rebuilt"], json!(1));
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0]["messageCount"], json!(5));
        assert_eq!(
            memories[0]["messageIds"],
            json!([
                "message-0",
                "message-1",
                "message-2",
                "message-3",
                "message-4"
            ])
        );
        assert!(!memories[0]["content"]
            .as_str()
            .expect("content should be a string")
            .contains("visible memory 5"));
    }

    #[tokio::test]
    async fn focused_refresh_returns_the_exact_created_or_updated_capture() {
        let state = test_state("memory-focused-capture-result");
        state
            .storage
            .create("chats", json!({ "id": "chat-1", "name": "Memory chat" }))
            .expect("chat should seed");
        for (id, role, content) in [
            ("user-1", "user", "My cat's name is Miso."),
            ("assistant-1", "assistant", "I'll remember that."),
        ] {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": id,
                        "chatId": "chat-1",
                        "role": role,
                        "content": content,
                        "createdAt": "2026-06-01T10:00:00.000Z"
                    }),
                )
                .expect("message should seed");
        }

        let source_ids = vec!["user-1".to_string(), "assistant-1".to_string()];
        let created =
            refresh_chat_memories_for_source_messages(&state, "chat-1", source_ids.clone())
                .await
                .expect("focused refresh should succeed");
        assert_eq!(created["capture"]["operation"], json!("created"));
        assert!(created["capture"]["memory"]["content"]
            .as_str()
            .expect("capture content should exist")
            .contains("My cat's name is Miso."));

        let updated = refresh_chat_memories_for_source_messages(&state, "chat-1", source_ids)
            .await
            .expect("focused refresh should be reusable");
        assert_eq!(updated["capture"]["operation"], json!("updated"));
        assert_eq!(
            updated["capture"]["memory"]["id"],
            created["capture"]["memory"]["id"]
        );
    }

    #[tokio::test]
    async fn focused_refresh_does_not_rebuild_transcript_chunks_with_overlapping_messages() {
        let state = test_state("memory-focused-capture-overlap");
        state
            .storage
            .create("chats", json!({ "id": "chat-1", "name": "Memory chat" }))
            .expect("chat should seed");
        for index in 0..10 {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": format!("message-{index}"),
                        "chatId": "chat-1",
                        "role": if index % 2 == 0 { "user" } else { "assistant" },
                        "content": format!("visible memory {index}"),
                        "createdAt": format!("2026-06-01T10:{index:02}:00.000Z")
                    }),
                )
                .expect("message should seed");
        }

        refresh_chat_memories_for_source_messages(
            &state,
            "chat-1",
            vec!["message-4".to_string(), "message-5".to_string()],
        )
        .await
        .expect("first focused refresh should succeed");
        let result = refresh_chat_memories_for_source_messages(
            &state,
            "chat-1",
            vec!["message-8".to_string(), "message-9".to_string()],
        )
        .await
        .expect("second focused refresh should succeed");
        let memories = result["chunks"]
            .as_array()
            .expect("memories should be an array");

        assert_eq!(memories.len(), 2);
        assert!(memories
            .iter()
            .all(|memory| { memory["creationReason"] == json!("Automatic exchange capture") }));
        let capture_message_ids = memories
            .iter()
            .map(chat_memory_message_ids)
            .collect::<Vec<_>>();
        assert!(capture_message_ids.contains(&HashSet::from([
            "message-8".to_string(),
            "message-9".to_string(),
        ])));
        assert!(capture_message_ids.contains(&HashSet::from([
            "message-4".to_string(),
            "message-5".to_string(),
        ])));

        let rebuilt = refresh_chat_memories(&state, "chat-1")
            .await
            .expect("full refresh should preserve focused captures");
        assert_eq!(rebuilt["chunks"].as_array().map(Vec::len), Some(2));
        assert!(rebuilt["chunks"]
            .as_array()
            .expect("rebuilt memories should be an array")
            .iter()
            .all(|memory| memory["creationReason"] == json!("Automatic exchange capture")));
    }

    #[tokio::test]
    async fn incomplete_focused_refresh_does_not_suppress_complete_transcript_chunks() {
        let state = test_state("memory-incomplete-focused-capture");
        state
            .storage
            .create("chats", json!({ "id": "chat-1", "name": "Memory chat" }))
            .expect("chat should seed");
        seed_five_visible_messages(&state, "chat-1");

        let result = refresh_chat_memories_for_source_messages(
            &state,
            "chat-1",
            vec!["message-4".to_string()],
        )
        .await
        .expect("incomplete focused refresh should succeed");

        assert!(result["capture"].is_null());
        assert_eq!(result["chunks"].as_array().map(Vec::len), Some(1));
        assert_eq!(
            result["chunks"][0]["creationReason"],
            json!("Automatic transcript chunk capture")
        );
    }

    #[tokio::test]
    async fn refresh_chat_memories_reuses_existing_complete_chunks() {
        let state = test_state("memory-incremental-chunks");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat"
                }),
            )
            .expect("chat should seed");
        for index in 0..5 {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": format!("message-{index}"),
                        "chatId": "chat-1",
                        "role": if index % 2 == 0 { "user" } else { "assistant" },
                        "content": format!("visible memory {index}"),
                        "createdAt": format!("2026-06-01T10:0{index}:00.000Z")
                    }),
                )
                .expect("message should seed");
        }

        let first_result = refresh_chat_memories(&state, "chat-1")
            .await
            .expect("first refresh should succeed");
        let first_chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let first_memory_id = first_chat["memories"][0]["id"]
            .as_str()
            .expect("memory id should exist")
            .to_string();
        assert_eq!(first_result["embedded"], json!(1));
        assert_eq!(first_result["reused"], json!(0));

        for index in 5..10 {
            state
                .storage
                .create(
                    "messages",
                    json!({
                        "id": format!("message-{index}"),
                        "chatId": "chat-1",
                        "role": if index % 2 == 0 { "user" } else { "assistant" },
                        "content": format!("visible memory {index}"),
                        "createdAt": format!("2026-06-01T10:{index}:00.000Z")
                    }),
                )
                .expect("message should seed");
        }

        let second_result = refresh_chat_memories(&state, "chat-1")
            .await
            .expect("second refresh should succeed");
        let second_chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = second_chat["memories"]
            .as_array()
            .expect("memories should be an array");

        assert_eq!(second_result["embedded"], json!(1));
        assert_eq!(second_result["reused"], json!(1));
        assert_eq!(memories.len(), 2);
        assert_eq!(memories[0]["id"], json!(first_memory_id));
        assert_eq!(
            memories[1]["messageIds"],
            json!([
                "message-5",
                "message-6",
                "message-7",
                "message-8",
                "message-9"
            ])
        );
    }

    #[tokio::test]
    async fn refresh_chat_memories_preserves_connected_command_memories() {
        let state = test_state("memory-refresh-preserves-command");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "command-memory",
                            "chatId": "chat-1",
                            "content": "Memory for Mira: Mira keeps a brass key.",
                            "commandMemoryKey": "chat-1::Mira::Mira keeps a brass key.",
                            "messageCount": 0,
                            "messageIds": [],
                            "firstMessageAt": "2026-06-01T09:00:00.000Z",
                            "lastMessageAt": "2026-06-01T09:00:00.000Z",
                            "createdAt": "2026-06-01T09:00:00.000Z",
                            "hasEmbedding": false,
                            "embeddingStatus": "unavailable",
                            "embeddingSource": "command",
                            "source": "connected_command",
                            "sourceChatId": "chat-1",
                            "target": "Mira",
                            "targetCharacterName": "Mira",
                            "targetCharacterId": "character-mira"
                        }
                    ]
                }),
            )
            .expect("chat should seed");
        seed_five_visible_messages(&state, "chat-1");

        refresh_chat_memories(&state, "chat-1")
            .await
            .expect("memory refresh should succeed");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");

        assert_eq!(memories.len(), 2);
        assert_ne!(memories[0]["id"], json!("command-memory"));
        assert_eq!(
            memories[0]["messageIds"],
            json!([
                "message-0",
                "message-1",
                "message-2",
                "message-3",
                "message-4"
            ])
        );
        assert_eq!(memories[1]["id"], json!("command-memory"));
        assert_eq!(memories[1]["source"], json!("connected_command"));
        assert_eq!(
            memories[1]["commandMemoryKey"],
            json!("chat-1::Mira::Mira keeps a brass key.")
        );
    }

    #[tokio::test]
    async fn refresh_chat_memories_preserves_imported_memories_without_message_ids() {
        let state = test_state("memory-refresh-preserves-import");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "imported-memory",
                            "chatId": "chat-1",
                            "sourceChatId": "source-chat",
                            "content": "Imported detail from another chat.",
                            "messageCount": 2,
                            "firstMessageAt": "2026-05-01T10:00:00.000Z",
                            "lastMessageAt": "2026-05-01T10:05:00.000Z",
                            "createdAt": "2026-05-01T10:06:00.000Z",
                            "hasEmbedding": true,
                            "embeddingStatus": "vectorized",
                            "embeddingSource": "lexical"
                        }
                    ]
                }),
            )
            .expect("chat should seed");
        seed_five_visible_messages(&state, "chat-1");

        refresh_chat_memories(&state, "chat-1")
            .await
            .expect("memory refresh should succeed");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");

        assert_eq!(memories.len(), 2);
        assert_ne!(memories[0]["id"], json!("imported-memory"));
        assert_eq!(
            memories[0]["messageIds"],
            json!([
                "message-0",
                "message-1",
                "message-2",
                "message-3",
                "message-4"
            ])
        );
        assert_eq!(memories[1]["id"], json!("imported-memory"));
        assert_eq!(memories[1]["sourceChatId"], json!("source-chat"));
        assert!(memories[1].get("messageIds").is_none());
    }

    #[test]
    fn export_chat_memories_emits_public_v1_chunks_only() {
        let state = test_state("memory-export-public-fields");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "mode": "conversation",
                    "memories": [
                        {
                            "id": "internal-id",
                            "chatId": "chat-1",
                            "content": "user: remembered detail",
                            "embedding": [0.1, 0.2],
                            "messageCount": 5,
                            "messageIds": ["message-1", "message-2"],
                            "firstMessageId": "message-1",
                            "lastMessageId": "message-2",
                            "firstMessageAt": "2026-06-01T10:00:00.000Z",
                            "lastMessageAt": "2026-06-01T10:04:00.000Z",
                            "createdAt": "2026-06-01T10:05:00.000Z",
                            "hasEmbedding": true,
                            "embeddingStatus": "vectorized",
                            "embeddingSource": "lexical"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let exported =
            export_chat_memories(&state, "chat-1").expect("memory export should succeed");
        let chunk = exported["data"]["chunks"][0]
            .as_object()
            .expect("exported chunk should be an object");

        assert_eq!(exported["type"], json!("marinara_memory_recall"));
        assert_eq!(exported["version"], json!(1));
        assert_eq!(
            chunk.keys().cloned().collect::<Vec<_>>(),
            vec![
                "content".to_string(),
                "createdAt".to_string(),
                "embedding".to_string(),
                "firstMessageAt".to_string(),
                "lastMessageAt".to_string(),
                "messageCount".to_string(),
            ]
        );
        assert_eq!(chunk["content"], json!("user: remembered detail"));
        assert_eq!(chunk["embedding"], json!([0.1, 0.2]));
        assert!(!chunk.contains_key("id"));
        assert!(!chunk.contains_key("chatId"));
        assert!(!chunk.contains_key("messageIds"));
        assert!(!chunk.contains_key("hasEmbedding"));
        assert!(!chunk.contains_key("embeddingStatus"));
    }

    #[test]
    fn export_chat_memories_skips_unsanctioned_projection_fields() {
        let state = test_state("memory-export-invalid-kind-scope");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "mode": "conversation",
                    "memories": [
                        {
                            "id": "bad-kind",
                            "chatId": "chat-1",
                            "content": "bad kind should not export",
                            "memoryKind": "foreign",
                            "scopeType": "chat",
                            "messageCount": 1,
                            "firstMessageAt": "2026-06-01T10:00:00.000Z",
                            "lastMessageAt": "2026-06-01T10:00:00.000Z",
                            "createdAt": "2026-06-01T10:00:00.000Z"
                        },
                        {
                            "id": "bad-scope",
                            "chatId": "chat-1",
                            "content": "bad scope should not export",
                            "memoryKind": "manual",
                            "scopeType": "foreign",
                            "messageCount": 1,
                            "firstMessageAt": "2026-06-01T11:00:00.000Z",
                            "lastMessageAt": "2026-06-01T11:00:00.000Z",
                            "createdAt": "2026-06-01T11:00:00.000Z"
                        },
                        {
                            "id": "valid",
                            "chatId": "chat-1",
                            "content": "valid projection exports",
                            "memoryKind": "manual",
                            "scopeType": "chat",
                            "messageCount": 1,
                            "firstMessageAt": "2026-06-01T12:00:00.000Z",
                            "lastMessageAt": "2026-06-01T12:00:00.000Z",
                            "createdAt": "2026-06-01T12:00:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let exported = export_chat_memories(&state, "chat-1").expect("export should succeed");
        let chunks = exported["data"]["chunks"]
            .as_array()
            .expect("chunks should be an array");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0]["content"], json!("valid projection exports"));
        assert_eq!(chunks[0]["memoryKind"], json!("manual"));
        assert_eq!(chunks[0]["scopeType"], json!("chat"));
    }

    #[tokio::test]
    async fn import_chat_memories_rejects_non_v1_memory_recall_envelopes() {
        let state = test_state("memory-import-envelope-validation");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat"
                }),
            )
            .expect("chat should seed");

        let raw_chunks_error = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "chunks": [
                    {
                        "content": "raw chunk should not import",
                        "messageCount": 1,
                        "firstMessageAt": "2026-06-01T10:00:00.000Z",
                        "lastMessageAt": "2026-06-01T10:00:00.000Z",
                        "createdAt": "2026-06-01T10:00:00.000Z"
                    }
                ]
            }),
            None,
        )
        .await
        .expect_err("raw chunks should be rejected");
        assert_eq!(raw_chunks_error.code, "invalid_input");

        let wrong_type_error = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_chat",
                "version": 1,
                "data": { "chunks": [] }
            }),
            None,
        )
        .await
        .expect_err("wrong envelope type should be rejected");
        assert_eq!(wrong_type_error.code, "invalid_input");

        let wrong_version_error = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 2,
                "data": { "chunks": [] }
            }),
            None,
        )
        .await
        .expect_err("wrong envelope version should be rejected");
        assert_eq!(wrong_version_error.code, "invalid_input");
    }

    #[tokio::test]
    async fn import_chat_memories_skips_unsanctioned_projection_fields() {
        let state = test_state("memory-import-invalid-kind-scope");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "mode": "conversation",
                    "memories": []
                }),
            )
            .expect("chat should seed");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "source-chat",
                        "name": "Source chat",
                        "mode": "conversation",
                        "memoryCount": 3
                    },
                    "chunks": [
                        {
                            "content": "bad kind should skip",
                            "memoryKind": "foreign",
                            "scopeType": "chat",
                            "messageCount": 1,
                            "createdAt": "2026-06-01T10:00:00.000Z"
                        },
                        {
                            "content": "bad scope should skip",
                            "memoryKind": "manual",
                            "scopeType": "foreign",
                            "messageCount": 1,
                            "createdAt": "2026-06-01T11:00:00.000Z"
                        },
                        {
                            "content": "valid shape should import",
                            "memoryKind": "manual",
                            "scopeType": "chat",
                            "messageCount": 1,
                            "createdAt": "2026-06-01T12:00:00.000Z"
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("valid neighbor should import");

        assert_eq!(result["imported"], json!(1));
        assert_eq!(result["skipped"], json!(2));
        let chat = state.storage.get("chats", "chat-1").unwrap().unwrap();
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0]["content"], json!("valid shape should import"));
        assert_eq!(memories[0]["memoryKind"], json!("manual"));
        assert_eq!(memories[0]["scopeType"], json!("chat"));
    }

    #[tokio::test]
    async fn import_chat_memories_preserves_source_and_dedupes_by_range() {
        let state = test_state("memory-import-source-and-dedupe");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "target-chat",
                    "name": "Target chat",
                    "memories": [
                        {
                            "id": "existing",
                            "chatId": "target-chat",
                            "content": "same content",
                            "messageCount": 5,
                            "firstMessageAt": "2026-06-01T10:00:00.000Z",
                            "lastMessageAt": "2026-06-01T10:04:00.000Z",
                            "createdAt": "2026-06-01T10:05:00.000Z",
                            "embedding": [0.3],
                            "hasEmbedding": true,
                            "embeddingStatus": "vectorized"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let result = import_chat_memories(
            &state,
            "target-chat",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "exportedAt": "2026-06-02T00:00:00.000Z",
                "data": {
                    "sourceChat": {
                        "id": "source-chat",
                        "name": "Source chat",
                        "mode": "conversation",
                        "memoryCount": 3
                    },
                    "chunks": [
                        {
                            "content": "same content",
                            "embedding": [0.1],
                            "messageCount": 5,
                            "firstMessageAt": "2026-06-01T10:00:00.000Z",
                            "lastMessageAt": "2026-06-01T10:04:00.000Z",
                            "createdAt": "2026-06-01T10:05:00.000Z"
                        },
                        {
                            "content": "same content",
                            "embedding": [0.2],
                            "messageCount": 5,
                            "firstMessageAt": "2026-06-01T11:00:00.000Z",
                            "lastMessageAt": "2026-06-01T11:04:00.000Z",
                            "createdAt": "2026-06-01T11:05:00.000Z"
                        },
                        {
                            "content": "same content",
                            "embedding": [0.4],
                            "messageCount": 5,
                            "firstMessageAt": "2026-06-01T11:00:00.000Z",
                            "lastMessageAt": "2026-06-01T11:04:00.000Z",
                            "createdAt": "2026-06-01T11:06:00.000Z"
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("memory import should succeed");

        assert_eq!(result["imported"], json!(1));
        assert_eq!(result["skipped"], json!(2));
        assert_eq!(result["replaced"], json!(false));
        let chat = state
            .storage
            .get("chats", "target-chat")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");
        assert_eq!(memories.len(), 2);
        assert_eq!(memories[1]["chatId"], json!("target-chat"));
        assert_eq!(memories[1]["sourceChatId"], json!("source-chat"));
        assert_eq!(
            memories[1]["firstMessageAt"],
            json!("2026-06-01T11:00:00.000Z")
        );
        assert_eq!(
            memories[1]["lastMessageAt"],
            json!("2026-06-01T11:04:00.000Z")
        );
        assert!(memories[1].get("messageIds").is_none());
    }

    #[tokio::test]
    async fn import_chat_memories_replace_clears_existing_memories() {
        let state = test_state("memory-import-replace");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "existing",
                            "chatId": "chat-1",
                            "content": "replace me",
                            "messageCount": 5,
                            "firstMessageAt": "2026-06-01T10:00:00.000Z",
                            "lastMessageAt": "2026-06-01T10:04:00.000Z",
                            "createdAt": "2026-06-01T10:05:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "chat-1",
                        "name": "Memory chat",
                        "mode": "conversation",
                        "memoryCount": 1
                    },
                    "chunks": [
                        {
                            "content": "replacement memory",
                            "embedding": null,
                            "messageCount": 0,
                            "createdAt": "2026-06-02T10:00:00.000Z"
                        }
                    ]
                }
            }),
            Some(true),
        )
        .await
        .expect("memory import should succeed");

        assert_eq!(result["imported"], json!(1));
        assert_eq!(result["skipped"], json!(0));
        assert_eq!(result["replaced"], json!(true));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0]["content"], json!("replacement memory"));
        assert_eq!(memories[0]["messageCount"], json!(1));
        assert_eq!(memories[0]["firstMessageAt"], memories[0]["createdAt"]);
        assert_eq!(memories[0]["lastMessageAt"], memories[0]["createdAt"]);
        assert!(memories[0].get("sourceChatId").is_none());
    }

    #[tokio::test]
    async fn import_chat_memories_replace_removes_replaced_chat_scoped_memory_index_rows() {
        let state = test_state("memory-import-replace-index-rows");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "existing",
                            "chatId": "chat-1",
                            "content": "replace me",
                            "messageCount": 5,
                            "createdAt": "2026-06-01T10:05:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");
        seed_chat_scoped_memory_index(&state, "chat-1", "canonical-old", "index-old");
        seed_chat_scoped_memory_index(&state, "other-chat", "canonical-other", "index-other");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "chat-1",
                        "name": "Memory chat",
                        "mode": "conversation",
                        "memoryCount": 1
                    },
                    "chunks": [
                        {
                            "content": "replacement memory",
                            "embedding": null,
                            "messageCount": 1,
                            "createdAt": "2026-06-02T10:00:00.000Z"
                        }
                    ]
                }
            }),
            Some(true),
        )
        .await
        .expect("memory import should succeed");

        assert_eq!(result["replaced"], json!(true));
        assert_eq!(memory_index_ids(&state), vec!["index-other".to_string()]);
    }

    #[tokio::test]
    async fn import_chat_memories_append_preserves_existing_chat_scoped_memory_index_rows() {
        let state = test_state("memory-import-append-keeps-index-rows");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "existing",
                            "chatId": "chat-1",
                            "content": "keep me",
                            "messageCount": 5,
                            "createdAt": "2026-06-01T10:05:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");
        seed_chat_scoped_memory_index(&state, "chat-1", "canonical-existing", "index-existing");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "chat-1",
                        "name": "Memory chat",
                        "mode": "conversation",
                        "memoryCount": 1
                    },
                    "chunks": [
                        {
                            "content": "append me",
                            "embedding": null,
                            "messageCount": 1,
                            "createdAt": "2026-06-02T10:00:00.000Z"
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("append import should succeed");

        assert_eq!(result["replaced"], json!(false));
        assert_eq!(memory_index_ids(&state), vec!["index-existing".to_string()]);
    }
    #[tokio::test]
    async fn import_chat_memories_ignores_payload_replace_without_explicit_option() {
        let state = test_state("memory-import-payload-replace-ignored");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "existing",
                            "chatId": "chat-1",
                            "content": "keep me",
                            "messageCount": 5,
                            "firstMessageAt": "2026-06-01T10:00:00.000Z",
                            "lastMessageAt": "2026-06-01T10:04:00.000Z",
                            "createdAt": "2026-06-01T10:05:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "replace": true,
                "data": {
                    "sourceChat": {
                        "id": "chat-1",
                        "name": "Memory chat",
                        "mode": "conversation",
                        "memoryCount": 1
                    },
                    "chunks": [
                        {
                            "content": "append me",
                            "embedding": null,
                            "messageCount": 1,
                            "firstMessageAt": "2026-06-02T10:00:00.000Z",
                            "lastMessageAt": "2026-06-02T10:01:00.000Z",
                            "createdAt": "2026-06-02T10:02:00.000Z"
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("payload replace should not clear existing memories");

        assert_eq!(result["imported"], json!(1));
        assert_eq!(result["skipped"], json!(0));
        assert_eq!(result["replaced"], json!(false));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");
        assert_eq!(memories.len(), 2);
        assert_eq!(memories[0]["id"], json!("existing"));
        assert_eq!(memories[1]["content"], json!("append me"));
    }

    #[tokio::test]
    async fn import_chat_memories_replace_rejects_empty_replacement_set() {
        let state = test_state("memory-import-replace-empty");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "existing",
                            "chatId": "chat-1",
                            "content": "keep me",
                            "messageCount": 5,
                            "firstMessageAt": "2026-06-01T10:00:00.000Z",
                            "lastMessageAt": "2026-06-01T10:04:00.000Z",
                            "createdAt": "2026-06-01T10:05:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let error = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "chat-1",
                        "name": "Memory chat",
                        "mode": "conversation",
                        "memoryCount": 1
                    },
                    "chunks": [
                        {
                            "content": "   ",
                            "embedding": null,
                            "messageCount": 1,
                            "firstMessageAt": "2026-06-02T10:00:00.000Z",
                            "lastMessageAt": "2026-06-02T10:01:00.000Z",
                            "createdAt": "2026-06-02T10:02:00.000Z"
                        }
                    ]
                }
            }),
            Some(true),
        )
        .await
        .expect_err("empty replacement set should be rejected");

        assert_eq!(error.code, "invalid_input");
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert_eq!(memory_ids(&chat["memories"]), vec!["existing"]);
    }

    #[tokio::test]
    async fn import_chat_memories_dedupes_legacy_range_less_existing_memories() {
        let state = test_state("memory-import-range-less-dedupe");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "legacy",
                            "chatId": "chat-1",
                            "content": "range-less memory",
                            "messageCount": 1,
                            "createdAt": "2026-06-01T10:00:00.000Z"
                        },
                        {
                            "id": "blank-legacy",
                            "chatId": "chat-1",
                            "content": "blank range memory",
                            "messageCount": 1,
                            "firstMessageAt": "",
                            "lastMessageAt": "",
                            "createdAt": "2026-06-01T10:30:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should seed");

        let result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "chat-1",
                        "name": "Memory chat",
                        "mode": "conversation",
                        "memoryCount": 2
                    },
                    "chunks": [
                        {
                            "content": "range-less memory",
                            "embedding": null,
                            "messageCount": 1,
                            "createdAt": "2026-06-01T10:00:00.000Z"
                        },
                        {
                            "content": "range-less memory",
                            "embedding": null,
                            "messageCount": 1
                        },
                        {
                            "content": "blank range memory",
                            "embedding": null,
                            "messageCount": 1,
                            "createdAt": "2026-06-01T10:30:00.000Z"
                        },
                        {
                            "content": "range-less memory",
                            "embedding": null,
                            "messageCount": 1,
                            "firstMessageAt": "2026-06-01T11:00:00.000Z",
                            "lastMessageAt": "2026-06-01T11:01:00.000Z",
                            "createdAt": "2026-06-01T11:02:00.000Z"
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("legacy range-less import should dedupe by normalized key");

        assert_eq!(result["imported"], json!(1));
        assert_eq!(result["skipped"], json!(3));
        assert_eq!(result["replaced"], json!(false));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");
        assert_eq!(memories.len(), 3);
        assert_eq!(memories[0]["id"], json!("legacy"));
        assert_eq!(memories[1]["id"], json!("blank-legacy"));
        assert_eq!(
            memories[2]["firstMessageAt"],
            json!("2026-06-01T11:00:00.000Z")
        );
    }

    #[tokio::test]
    async fn import_chat_memories_dedupes_reimported_no_date_chunks() {
        let state = test_state("memory-import-no-date-dedupe");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": []
                }),
            )
            .expect("chat should seed");

        let no_date_body = json!({
            "type": "marinara_memory_recall",
            "version": 1,
            "data": {
                "sourceChat": {
                    "id": "chat-1",
                    "name": "Memory chat",
                    "mode": "conversation",
                    "memoryCount": 1
                },
                "chunks": [
                    {
                        "content": "no date memory",
                        "embedding": null,
                        "messageCount": 1
                    }
                ]
            }
        });

        let first_result = import_chat_memories(&state, "chat-1", no_date_body.clone(), None)
            .await
            .expect("first no-date import should append");
        let second_result = import_chat_memories(&state, "chat-1", no_date_body, None)
            .await
            .expect("second no-date import should dedupe");
        let ranged_result = import_chat_memories(
            &state,
            "chat-1",
            json!({
                "type": "marinara_memory_recall",
                "version": 1,
                "data": {
                    "sourceChat": {
                        "id": "chat-1",
                        "name": "Memory chat",
                        "mode": "conversation",
                        "memoryCount": 1
                    },
                    "chunks": [
                        {
                            "content": "no date memory",
                            "embedding": null,
                            "messageCount": 1,
                            "firstMessageAt": "2026-06-01T12:00:00.000Z",
                            "lastMessageAt": "2026-06-01T12:01:00.000Z",
                            "createdAt": "2026-06-01T12:02:00.000Z"
                        }
                    ]
                }
            }),
            None,
        )
        .await
        .expect("distinct real range should append");

        assert_eq!(first_result["imported"], json!(1));
        assert_eq!(second_result["imported"], json!(0));
        assert_eq!(second_result["skipped"], json!(1));
        assert_eq!(ranged_result["imported"], json!(1));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");
        assert_eq!(memories.len(), 2);
        assert_eq!(memories[0]["content"], json!("no date memory"));
        assert_eq!(memories[0]["firstMessageAt"], json!(""));
        assert_eq!(memories[0]["lastMessageAt"], json!(""));
        assert_eq!(
            memories[1]["firstMessageAt"],
            json!("2026-06-01T12:00:00.000Z")
        );
    }

    #[tokio::test]
    async fn embed_memory_content_uses_lexical_fallback_without_context() {
        let result = embed_memory_content(None, "alpha beta").await.unwrap();

        assert_eq!(result.source, "lexical");
        assert_eq!(result.embedding.len(), MEMORY_EMBEDDING_DIMS);
        assert!(result.connection_id.is_none());
        assert!(result.model.is_none());
    }

    #[test]
    fn lexical_memory_embedding_rewards_related_and_unicode_features() {
        fn cosine(left: &[f64], right: &[f64]) -> f64 {
            let dot = left.iter().zip(right).map(|(a, b)| a * b).sum::<f64>();
            let left_mag = left.iter().map(|value| value * value).sum::<f64>().sqrt();
            let right_mag = right.iter().map(|value| value * value).sum::<f64>().sqrt();
            if left_mag > 0.0 && right_mag > 0.0 {
                dot / (left_mag * right_mag)
            } else {
                0.0
            }
        }

        let query = lexical_memory_embedding("Dottore remembered the freezing Snezhnaya facility");
        let related =
            lexical_memory_embedding("The Snezhnaya facility stayed frozen while Dottore observed");
        let unrelated = lexical_memory_embedding("Sunny beach playlist for a cheerful picnic");
        let polish = lexical_memory_embedding("ZaÅ¼Ã³Å‚Ä‡ gÄ™Å›lÄ… jaÅºÅ„ and Snezhnaya");

        assert!(cosine(&query, &related) > cosine(&query, &unrelated));
        assert!(polish.iter().any(|value| value.abs() > 0.0));
    }
}
