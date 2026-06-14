use super::chats;
use super::prompts;
use super::shared::*;
use super::*;
use marinara_storage::AtomicCollectionRows;
use std::collections::{HashMap, HashSet};

const MEMORY_CHUNK_SIZE: usize = 5;
const MEMORY_EMBEDDING_DIMS: usize = 512;

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

fn no_embedding_connection_configured(error: &AppError) -> bool {
    error.code == "invalid_input" && error.message.starts_with("No embedding connection")
}

fn has_no_connection_rows(state: &AppState) -> AppResult<bool> {
    Ok(state.storage.list("connections")?.is_empty())
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
        return Ok(Some(
            memory_embedding_context_for_connection_id(state, connection_id).await?,
        ));
    }

    match prompts::resolve_default_embedding_connection_async(state).await {
        Ok((connection_id, connection)) => Ok(Some(memory_embedding_context_from_connection(
            connection_id,
            connection,
        )?)),
        Err(error)
            if no_embedding_connection_configured(&error) && has_no_connection_rows(state)? =>
        {
            Ok(None)
        }
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
    set_chat_memory_values(state, chat_id, Vec::new())
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

pub(crate) async fn refresh_chat_memories(state: &AppState, chat_id: &str) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let embedding_context = memory_embedding_context(state, &chat).await?;
    let existing_memories = chat_memory_values_for_mutation(&chat)?;
    let existing_by_chunk = existing_memories
        .into_iter()
        .filter_map(|memory| {
            let ids = memory_message_ids(&memory);
            if ids.is_empty() {
                None
            } else {
                Some((memory_chunk_key(&ids), memory))
            }
        })
        .collect::<HashMap<_, _>>();
    let visible_messages = chats::messages_for_chat(state, chat_id)?
        .into_iter()
        .filter(|message| !is_hidden_from_ai(message) && !message_content(message).is_empty())
        .collect::<Vec<_>>();
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
    for chunk in visible_messages.chunks(MEMORY_CHUNK_SIZE) {
        if chunk.len() < MEMORY_CHUNK_SIZE {
            continue;
        }
        let content = chunk
            .iter()
            .map(|message| {
                let speaker = message_speaker_label(
                    message,
                    persona_name.as_deref(),
                    &character_names,
                    fallback_character_name,
                );
                format!("{speaker}: {}", message_content(message))
            })
            .collect::<Vec<_>>()
            .join("\n");
        let mut memory = Map::new();
        let message_ids = chunk
            .iter()
            .filter_map(|message| message.get("id").and_then(Value::as_str))
            .filter(|id| !id.trim().is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if let Some(memory) = reusable_chat_memory(
            &existing_by_chunk,
            &message_ids,
            &content,
            embedding_context.as_ref(),
        ) {
            chunks.push(memory.clone());
            reused += 1;
            continue;
        }
        memory.insert("id".to_string(), Value::String(new_id()));
        memory.insert("chatId".to_string(), Value::String(chat_id.to_string()));
        memory.insert("content".to_string(), Value::String(content.clone()));
        memory.insert("messageCount".to_string(), json!(chunk.len()));
        memory.insert("messageIds".to_string(), json!(message_ids));
        memory.insert(
            "firstMessageId".to_string(),
            chunk
                .first()
                .and_then(|message| message.get("id"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        memory.insert(
            "lastMessageId".to_string(),
            chunk
                .last()
                .and_then(|message| message.get("id"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        memory.insert(
            "firstMessageAt".to_string(),
            chunk
                .first()
                .and_then(|message| message.get("createdAt"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        memory.insert(
            "lastMessageAt".to_string(),
            chunk
                .last()
                .and_then(|message| message.get("createdAt"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        memory.insert("createdAt".to_string(), Value::String(now.clone()));
        pending.push((chunks.len(), content, memory));
        chunks.push(Value::Null);
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
    state
        .storage
        .patch("chats", chat_id, json!({ "memories": chunks }))?;
    Ok(json!({ "rebuilt": chunks.len(), "embedded": embedded, "reused": reused, "chunks": chunks }))
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

fn public_memory_recall_export_chunk(memory: &Value, fallback_now: &str) -> Option<Value> {
    let content = string_field_trimmed(memory, "content")?;
    let created_at =
        string_field_trimmed(memory, "createdAt").unwrap_or_else(|| fallback_now.to_string());
    let first_message_at =
        string_field_trimmed(memory, "firstMessageAt").unwrap_or_else(|| created_at.clone());
    let last_message_at =
        string_field_trimmed(memory, "lastMessageAt").unwrap_or_else(|| first_message_at.clone());
    let message_count = positive_usize_field(memory, "messageCount").unwrap_or(1);

    Some(json!({
        "content": content,
        "embedding": public_memory_recall_embedding(memory.get("embedding")),
        "messageCount": message_count,
        "firstMessageAt": first_message_at,
        "lastMessageAt": last_message_at,
        "createdAt": created_at
    }))
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

    Some((memory, keys, content))
}

pub(crate) async fn import_chat_memories(
    state: &AppState,
    chat_id: &str,
    body: Value,
    replace: Option<bool>,
) -> AppResult<Value> {
    let chat = get_required(state, "chats", chat_id)?;
    let embedding_context = memory_embedding_context(state, &chat).await?;
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
        let has_embedding = memory
            .get("embedding")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().any(Value::is_number));
        if !has_embedding {
            insert_memory_embedding_fields(
                &mut memory,
                embed_memory_content(embedding_context.as_ref(), &content).await?,
            );
        } else {
            memory.insert("hasEmbedding".to_string(), json!(true));
            memory.insert("embeddingStatus".to_string(), json!("vectorized"));
        }
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
    Ok(json!({ "imported": imported, "skipped": skipped, "replaced": replace }))
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
    async fn refresh_chat_memories_errors_when_configured_embedding_target_lacks_model() {
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

        let error = refresh_chat_memories(&state, "chat-1")
            .await
            .expect_err("configured embedding target without a model should not fall back");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("embeddingModel"));
        assert!(error.message.contains("embedding-connection"));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert!(chat.get("memories").is_none());
    }

    #[tokio::test]
    async fn refresh_chat_memories_errors_when_default_embedding_connection_lacks_model() {
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

        let error = refresh_chat_memories(&state, "chat-1")
            .await
            .expect_err("default embedding connection without a model should not fall back");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("embedding model"));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert!(chat.get("memories").is_none());
    }

    #[tokio::test]
    async fn refresh_chat_memories_errors_when_configured_embedding_connection_is_invalid() {
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

        let error = refresh_chat_memories(&state, "chat-1")
            .await
            .expect_err("invalid configured embedding connection should not fall back");

        assert_eq!(error.code, "not_found");
        assert!(error.message.contains("missing-embedding"));
    }

    #[tokio::test]
    async fn import_chat_memories_errors_when_configured_embedding_target_lacks_model() {
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

        let error = import_chat_memories(
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
        .expect_err("configured embedding target without a model should not import");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("embeddingModel"));
        assert!(error.message.contains("embedding-connection"));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert!(chat.get("memories").is_none());
    }

    #[tokio::test]
    async fn import_chat_memories_errors_on_chat_embedding_override_before_generation_connection() {
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

        let error = import_chat_memories(
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
        .expect_err("chat embedding override should be validated before generation connection");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("embeddingModel"));
        assert!(error.message.contains("override-embedding"));
        assert!(!error.message.contains("generation-embedding"));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        assert!(chat.get("memories").is_none());
    }

    #[tokio::test]
    async fn import_chat_memories_errors_when_configured_embedding_connection_is_invalid() {
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

        let error = import_chat_memories(
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
        .expect_err("invalid configured embedding connection should not fall back");

        assert_eq!(error.code, "not_found");
        assert!(error.message.contains("missing-embedding"));
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
        assert!(
            !memories[0]["content"]
                .as_str()
                .expect("content should be a string")
                .contains("visible memory 5")
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
        let polish = lexical_memory_embedding("Zażółć gęślą jaźń and Snezhnaya");

        assert!(cosine(&query, &related) > cosine(&query, &unrelated));
        assert!(polish.iter().any(|value| value.abs() > 0.0));
    }
}
