use super::chats::messages_for_chat;
use super::shared::*;
use super::*;
use std::collections::HashSet;

const MAX_ASSISTANT_RUN_INTERVAL: i64 = 100;
const DEFAULT_AGENT_CREDIT: &str = "Marinara Dev Team";
const DEFAULT_AGENT_MAX_TOKENS: i64 = 4096;
const SECRET_PLOT_AGENT_TYPE: &str = "secret-plot-driver";
const SECRET_PLOT_PACING_VALUES: [&str; 5] =
    ["slow", "exploration", "building", "climactic", "cooldown"];

#[derive(Clone, Copy)]
struct BuiltInAgentDefinition {
    agent_type: &'static str,
    name: &'static str,
    description: &'static str,
    phase: &'static str,
    enabled_by_default: bool,
}

const BUILT_IN_AGENT_DEFINITIONS: &[BuiltInAgentDefinition] = &[
    BuiltInAgentDefinition {
        agent_type: "prose-guardian",
        name: "Prose Guardian",
        description: "Analyzes recent messages for repetition, rhetorical patterns, and sentence structure - then generates strict writing directives to force variety and freshness.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "continuity",
        name: "Continuity Checker",
        description: "Detects contradictions with established lore and facts.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "director",
        name: "Narrative Director",
        description: "Introduces events, NPCs, and plot beats to keep the story moving.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "echo-chamber",
        name: "Echo Chamber",
        description: "Simulates a live streaming-style chat reacting to your roleplay in real time.",
        phase: "parallel",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "prompt-reviewer",
        name: "Prompt Reviewer",
        description: "Analyses your prompt preset for clarity, redundancy, and formatting issues, and suggests improvements.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "world-state",
        name: "World State",
        description: "Tracks date/time, weather, location, and present characters automatically.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "expression",
        name: "Expression Engine",
        description: "Detects character emotions and selects VN sprites/expressions.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "quest",
        name: "Quest Tracker",
        description: "Manages quest objectives, completion states, and rewards.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "background",
        name: "Background",
        description: "Selects the most fitting background image for the current scene from your uploaded backgrounds, with optional image generation for missing locations.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "character-tracker",
        name: "Character Tracker",
        description: "Tracks which characters are present in the scene, their mood, actions, appearance, outfit, thoughts, and per-character stats (HP, etc.).",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "persona-stats",
        name: "Persona Stats",
        description: "Tracks the player persona's status bars - Satiety, Energy, Hygiene, and other custom stats - with realistic changes based on narrative events.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "custom-tracker",
        name: "Custom Tracker",
        description: "Tracks user-defined fields (currencies, counters, flags, or any custom data). Add any fields you want the model to keep track of during the roleplay.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "illustrator",
        name: "Illustrator",
        description: "Generates image prompts for key scenes (requires image generation API).",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "lorebook-keeper",
        name: "Lorebook Keeper",
        description: "Automatically creates and updates lorebook entries based on story events, new characters, and world changes.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "card-evolution-auditor",
        name: "Card Evolution Auditor",
        description: "Detects when character card fields (description, personality, scenario, etc.) have become outdated based on roleplay events and proposes edits for user approval.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "combat",
        name: "Combat",
        description: "Manages combat encounters, initiative, HP tracking, and turn-based actions.",
        phase: "parallel",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "html",
        name: "Immersive HTML",
        description: "Injects a prompt directive that encourages the model to include inline HTML, CSS, and JS for immersive in-world visual elements.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "chat-summary",
        name: "Automated Chat Summary",
        description: "Automatically generates a rolling summary of the conversation every X user messages. Add to a chat for hands-free summary updates.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "spotify",
        name: "Spotify DJ",
        description: "Analyzes the narrative mood and controls Spotify playback - searching tracks, adjusting volume, and cueing music to match the scene. Requires a Spotify Premium account and API credentials.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "editor",
        name: "Consistency Editor",
        description: "Reads all agent data (tracker states, prose rules, continuity notes) and edits the model's response to fix factual errors, outfit/stat contradictions, repetition, and other inconsistencies.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "knowledge-retrieval",
        name: "Knowledge Retrieval",
        description: "Scans specified lorebooks for information relevant to the current conversation, summarizes the key data, and injects it into the prompt - a lightweight RAG pipeline without vector databases.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "knowledge-router",
        name: "Knowledge Router",
        description: "Lower-cost alternative to Knowledge Retrieval. Reads a short catalog of lorebook entries (descriptions or content snippets), picks which ones are relevant to the current scene, and injects them verbatim - no per-entry summarization passes. Best for large lorebooks where you've written entry descriptions.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "schedule-planner",
        name: "Schedule Planner",
        description: "Generates a realistic weekly schedule for each character in Conversation mode based on their personality and description. Updates automatically each week.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "response-orchestrator",
        name: "Response Orchestrator",
        description: "For group Conversation chats - decides which character(s) should respond to a message based on context, personality, and relevance.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "autonomous-messenger",
        name: "Autonomous Messenger",
        description: "Allows characters to send messages unprompted when the user has been inactive, based on personality traits like talkativeness and the character's current schedule.",
        phase: "parallel",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "cyoa",
        name: "CYOA Choices",
        description: "Generates interactive Choose Your Own Adventure choices after each assistant message. Click a choice to send it as your response. Roleplay mode only.",
        phase: "post_processing",
        enabled_by_default: false,
    },
    BuiltInAgentDefinition {
        agent_type: "secret-plot-driver",
        name: "Secret Plot Driver",
        description: "Secretly develops an overarching story arc and scene directions behind the scenes. The user never sees the actual plot - only a hint that something is unfolding. Creates long-term narrative structure with protagonist growth, mysteries, and pacing control.",
        phase: "pre_generation",
        enabled_by_default: false,
    },
];

fn built_in_agent_definition(agent_type: &str) -> Option<&'static BuiltInAgentDefinition> {
    BUILT_IN_AGENT_DEFINITIONS
        .iter()
        .find(|definition| definition.agent_type == agent_type)
}

fn is_built_in_agent_type(agent_type: &str) -> bool {
    built_in_agent_definition(agent_type).is_some()
}

fn unknown_built_in_agent_type(agent_type: &str) -> AppError {
    AppError::not_found(format!("Unknown built-in agent type: {agent_type}"))
}

fn parse_settings(value: Option<&Value>) -> Map<String, Value> {
    match value {
        Some(Value::Object(object)) => object.clone(),
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default(),
        _ => Map::new(),
    }
}

fn default_run_interval_setting(agent_type: &str) -> Option<i64> {
    match agent_type {
        "director" | "illustrator" | "chat-summary" => Some(5),
        "lorebook-keeper" | "card-evolution-auditor" => Some(8),
        _ => None,
    }
}

fn default_run_interval(agent_type: &str) -> i64 {
    default_run_interval_setting(agent_type).unwrap_or(1)
}

fn default_inject_as_section(agent_type: &str) -> bool {
    matches!(
        agent_type,
        "director"
            | "world-state"
            | "quest"
            | "character-tracker"
            | "persona-stats"
            | "custom-tracker"
            | "secret-plot-driver"
    )
}

fn default_enabled_tools(agent_type: &str) -> &'static [&'static str] {
    match agent_type {
        "world-state" | "quest" | "character-tracker" | "persona-stats" | "custom-tracker" => {
            &["update_game_state"]
        }
        "combat" => &["roll_dice", "update_game_state"],
        "continuity" | "lorebook-keeper" | "knowledge-retrieval" => &["search_lorebook"],
        "expression" => &["set_expression"],
        "director" => &["trigger_event"],
        "spotify" => &[
            "spotify_get_current_playback",
            "spotify_get_playlists",
            "spotify_get_playlist_tracks",
            "spotify_search",
            "spotify_play",
            "spotify_set_volume",
        ],
        _ => &[],
    }
}

fn default_built_in_agent_settings(agent_type: &str) -> Map<String, Value> {
    let mut settings = Map::new();
    settings.insert("maxTokens".to_string(), json!(DEFAULT_AGENT_MAX_TOKENS));
    if default_inject_as_section(agent_type) {
        settings.insert("injectAsSection".to_string(), Value::Bool(true));
    }
    if let Some(run_interval) = default_run_interval_setting(agent_type) {
        settings.insert("runInterval".to_string(), json!(run_interval));
    }
    if matches!(agent_type, "knowledge-retrieval" | "knowledge-router") {
        settings.insert("useChatActiveLorebooks".to_string(), Value::Bool(true));
    }
    settings.insert(
        "enabledTools".to_string(),
        Value::Array(
            default_enabled_tools(agent_type)
                .iter()
                .map(|tool| Value::String((*tool).to_string()))
                .collect(),
        ),
    );
    settings
}

fn default_built_in_agent_object(
    definition: &BuiltInAgentDefinition,
    enabled: bool,
) -> Map<String, Value> {
    let mut object = Map::new();
    object.insert(
        "type".to_string(),
        Value::String(definition.agent_type.to_string()),
    );
    object.insert(
        "name".to_string(),
        Value::String(definition.name.to_string()),
    );
    object.insert(
        "description".to_string(),
        Value::String(definition.description.to_string()),
    );
    object.insert(
        "credit".to_string(),
        Value::String(DEFAULT_AGENT_CREDIT.to_string()),
    );
    object.insert("imagePath".to_string(), Value::Null);
    object.insert(
        "phase".to_string(),
        Value::String(definition.phase.to_string()),
    );
    object.insert("enabled".to_string(), Value::Bool(enabled));
    object.insert("connectionId".to_string(), Value::Null);
    object.insert("promptTemplate".to_string(), Value::String(String::new()));
    object.insert(
        "settings".to_string(),
        Value::Object(default_built_in_agent_settings(definition.agent_type)),
    );
    object
}

fn merge_agent_settings(default_object: &mut Map<String, Value>, patch_value: Value) {
    let Some(Value::Object(default_settings)) = default_object.get_mut("settings") else {
        default_object.insert("settings".to_string(), patch_value);
        return;
    };
    match patch_value {
        Value::Object(patch_settings) => {
            for (key, value) in patch_settings {
                default_settings.insert(key, value);
            }
        }
        Value::String(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(patch_settings)) => {
                for (key, value) in patch_settings {
                    default_settings.insert(key, value);
                }
            }
            _ => {
                default_object.insert("settings".to_string(), Value::String(raw));
            }
        },
        other => {
            default_object.insert("settings".to_string(), other);
        }
    }
}

fn merge_agent_config_object(default_object: &mut Map<String, Value>, patch: Map<String, Value>) {
    for (key, value) in patch {
        if key == "settings" {
            merge_agent_settings(default_object, value);
        } else {
            default_object.insert(key, value);
        }
    }
}

fn built_in_agent_config_object(
    definition: &BuiltInAgentDefinition,
    enabled: bool,
    existing: Option<&Value>,
    patch: Option<Map<String, Value>>,
) -> AppResult<Map<String, Value>> {
    let mut object = default_built_in_agent_object(definition, enabled);
    if let Some(existing) = existing {
        let existing_object = existing
            .as_object()
            .cloned()
            .ok_or_else(|| AppError::invalid_input("Stored agent config is not an object"))?;
        merge_agent_config_object(&mut object, existing_object);
    }
    if let Some(patch) = patch {
        merge_agent_config_object(&mut object, patch);
    }
    object.insert(
        "type".to_string(),
        Value::String(definition.agent_type.to_string()),
    );
    Ok(object)
}

fn create_built_in_agent_config(
    state: &AppState,
    definition: &BuiltInAgentDefinition,
    enabled: bool,
    patch: Option<Map<String, Value>>,
) -> AppResult<Value> {
    let object = built_in_agent_config_object(definition, enabled, None, patch)?;
    state.storage.create("agents", Value::Object(object))
}

fn patch_existing_built_in_agent_config(
    state: &AppState,
    definition: &BuiltInAgentDefinition,
    agent: Value,
    patch: Option<Map<String, Value>>,
) -> AppResult<Value> {
    let id = agent
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(definition.agent_type)
        .to_string();
    let object = built_in_agent_config_object(
        definition,
        definition.enabled_by_default,
        Some(&agent),
        patch,
    )?;
    state.storage.patch("agents", &id, Value::Object(object))
}

fn positive_run_interval(value: Option<&Value>, fallback: i64, max: i64) -> i64 {
    let parsed = match value {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(raw)) => raw.trim().parse::<i64>().ok(),
        _ => None,
    };
    parsed
        .filter(|value| *value >= 1)
        .unwrap_or(fallback)
        .clamp(1, max)
}

fn boolish(value: Option<&Value>, fallback: bool) -> bool {
    match value {
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(number)) => number.as_i64().map(|value| value != 0).unwrap_or(fallback),
        Some(Value::String(raw)) => match raw.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => true,
            "false" | "0" | "no" | "off" => false,
            _ => fallback,
        },
        _ => fallback,
    }
}

fn find_agent_config(state: &AppState, agent_type: &str) -> AppResult<Option<Value>> {
    if let Some(agent) = find_by_field(state, "agents", "type", agent_type)? {
        return Ok(Some(agent));
    }
    find_by_field(state, "agents", "agentType", agent_type)
}

fn get_or_create_agent_config(state: &AppState, agent_type: &str) -> AppResult<Value> {
    if let Some(agent) = find_agent_config(state, agent_type)? {
        if let Some(definition) = built_in_agent_definition(agent_type) {
            return patch_existing_built_in_agent_config(state, definition, agent, None);
        }
        return Ok(agent);
    }
    if let Some(definition) = built_in_agent_definition(agent_type) {
        return create_built_in_agent_config(
            state,
            definition,
            definition.enabled_by_default,
            None,
        );
    }
    state.storage.create(
        "agents",
        json!({
            "type": agent_type,
            "name": agent_type,
            "enabled": true,
            "settings": {}
        }),
    )
}

fn agent_config_id(state: &AppState, agent_type: &str, create: bool) -> AppResult<Option<String>> {
    let agent = if create {
        Some(get_or_create_agent_config(state, agent_type)?)
    } else {
        find_agent_config(state, agent_type)?
    };
    Ok(agent.and_then(|agent| agent.get("id").and_then(Value::as_str).map(str::to_string)))
}

fn run_agent_type(run: &Value) -> Option<&str> {
    run.get("agentType")
        .or_else(|| run.get("agent_type"))
        .or_else(|| run.get("type"))
        .and_then(Value::as_str)
}

fn run_chat_id(run: &Value) -> Option<&str> {
    run.get("chatId")
        .or_else(|| run.get("chat_id"))
        .and_then(Value::as_str)
}

fn memory_chat_id(memory: &Value) -> Option<&str> {
    memory
        .get("chatId")
        .or_else(|| memory.get("chat_id"))
        .and_then(Value::as_str)
}

fn memory_agent_config_id(memory: &Value) -> Option<&str> {
    memory
        .get("agentConfigId")
        .or_else(|| memory.get("agent_config_id"))
        .and_then(Value::as_str)
}

fn run_agent_config_id(run: &Value) -> Option<&str> {
    run.get("agentConfigId")
        .or_else(|| run.get("agent_config_id"))
        .and_then(Value::as_str)
}

fn run_result_type(run: &Value) -> Option<&str> {
    run.get("resultType")
        .or_else(|| run.get("result_type"))
        .and_then(Value::as_str)
}

fn list_agent_runs_for_chat(state: &AppState, chat_id: &str) -> AppResult<Vec<Value>> {
    let mut rows = state.storage.list_where("agent-runs", &{
        let mut filters = Map::new();
        filters.insert("chatId".to_string(), Value::String(chat_id.to_string()));
        filters
    })?;
    let mut seen_ids = rows
        .iter()
        .filter_map(|row| row.get("id").and_then(Value::as_str).map(ToOwned::to_owned))
        .collect::<HashSet<_>>();
    let legacy_rows = state.storage.list_where("agent-runs", &{
        let mut filters = Map::new();
        filters.insert("chat_id".to_string(), Value::String(chat_id.to_string()));
        filters
    })?;
    for row in legacy_rows {
        let id = row.get("id").and_then(Value::as_str);
        if id.is_some_and(|id| !seen_ids.insert(id.to_string())) {
            continue;
        }
        rows.push(row);
    }
    Ok(rows)
}

fn agent_config_ids_for_type(state: &AppState, agent_type: &str) -> AppResult<HashSet<String>> {
    let mut ids = HashSet::new();
    ids.insert(format!("builtin:{agent_type}"));
    for row in state.storage.list("agents")? {
        let row_type = row
            .get("type")
            .or_else(|| row.get("agentType"))
            .and_then(Value::as_str);
        if row_type != Some(agent_type) {
            continue;
        }
        if let Some(id) = row.get("id").and_then(Value::as_str) {
            ids.insert(id.to_string());
        }
    }
    Ok(ids)
}

fn run_matches_agent(run: &Value, agent_type: &str, agent_config_ids: &HashSet<String>) -> bool {
    if let Some(run_type) = run_agent_type(run) {
        return run_type == agent_type;
    }
    run_agent_config_id(run).is_some_and(|id| agent_config_ids.contains(id))
}

fn run_successful(run: &Value) -> bool {
    boolish(run.get("success"), false)
}

fn run_message_id(run: &Value) -> Option<&str> {
    run.get("messageId")
        .or_else(|| run.get("message_id"))
        .and_then(Value::as_str)
}

fn run_created_at(run: &Value) -> Option<&str> {
    run.get("created_at")
        .or_else(|| run.get("createdAt"))
        .and_then(Value::as_str)
}

pub(crate) fn toggle_agent_type(state: &AppState, agent_type: &str) -> AppResult<Value> {
    if let Some(agent) = find_agent_config(state, agent_type)? {
        let definition = built_in_agent_definition(agent_type);
        let hydrated = if let Some(definition) = definition {
            patch_existing_built_in_agent_config(state, definition, agent, None)?
        } else {
            agent
        };
        let id = hydrated
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(agent_type)
            .to_string();
        let enabled = !hydrated
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        state
            .storage
            .patch("agents", &id, json!({ "enabled": enabled }))
    } else {
        let definition = built_in_agent_definition(agent_type)
            .ok_or_else(|| unknown_built_in_agent_type(agent_type))?;
        create_built_in_agent_config(state, definition, !definition.enabled_by_default, None)
    }
}

pub(crate) fn patch_agent_type(
    state: &AppState,
    agent_type: &str,
    body: Value,
) -> AppResult<Value> {
    if let Some(agent) = find_agent_config(state, agent_type)? {
        if let Some(definition) = built_in_agent_definition(agent_type) {
            let object = ensure_object(body)?;
            return patch_existing_built_in_agent_config(state, definition, agent, Some(object));
        }
        let id = agent
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(agent_type);
        state.storage.patch("agents", id, body)
    } else {
        let definition = built_in_agent_definition(agent_type)
            .ok_or_else(|| unknown_built_in_agent_type(agent_type))?;
        let object = ensure_object(body)?;
        create_built_in_agent_config(
            state,
            definition,
            definition.enabled_by_default,
            Some(object),
        )
    }
}

pub(crate) fn update_agent_image_by_type(
    state: &AppState,
    agent_type: &str,
    body: Value,
) -> AppResult<Value> {
    if find_agent_config(state, agent_type)?.is_none() && !is_built_in_agent_type(agent_type) {
        return Err(unknown_built_in_agent_type(agent_type));
    }
    let agent = get_or_create_agent_config(state, agent_type)?;
    let id = agent
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::new("storage_error", "Agent config is missing an id"))?;
    super::entity_images::update_entity_image(state, "agents", id, body)
}

pub(crate) fn agent_cadence_status(
    state: &AppState,
    agent_type: &str,
    chat_id: &str,
) -> AppResult<Value> {
    let config = find_agent_config(state, agent_type)?;
    if config.is_none() && !is_built_in_agent_type(agent_type) {
        return Err(unknown_built_in_agent_type(agent_type));
    }
    let settings = parse_settings(config.as_ref().and_then(|agent| agent.get("settings")));
    let fallback_interval = default_run_interval(agent_type);
    let run_interval = positive_run_interval(
        settings.get("runInterval"),
        fallback_interval,
        MAX_ASSISTANT_RUN_INTERVAL,
    );
    let messages = messages_for_chat(state, chat_id)?;
    let agent_config_ids = agent_config_ids_for_type(state, agent_type)?;
    let runs = list_agent_runs_for_chat(state, chat_id)?
        .into_iter()
        .filter(|run| run_matches_agent(run, agent_type, &agent_config_ids))
        .collect::<Vec<_>>();
    let last_run = runs
        .iter()
        .filter(|run| run_successful(run))
        .max_by(|a, b| {
            let a_time = run_created_at(a).unwrap_or("");
            let b_time = run_created_at(b).unwrap_or("");
            a_time.cmp(b_time)
        });
    let mut assistant_messages_since_last_run = None;
    let mut last_run_message_found = None;
    if let Some(run) = last_run {
        if let Some(message_id) = run_message_id(run) {
            if let Some(index) = messages
                .iter()
                .position(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
            {
                last_run_message_found = Some(true);
                let count = messages[index + 1..]
                    .iter()
                    .filter(|message| {
                        message.get("role").and_then(Value::as_str) == Some("assistant")
                    })
                    .count() as i64;
                assistant_messages_since_last_run = Some(count);
            } else {
                last_run_message_found = Some(false);
                assistant_messages_since_last_run = Some(run_interval);
            }
        }
    }
    let remaining = if last_run.is_none() || run_interval <= 1 {
        0
    } else {
        (run_interval - (assistant_messages_since_last_run.unwrap_or(0) + 1)).max(0)
    };
    Ok(json!({
        "agentType": agent_type,
        "runInterval": run_interval,
        "lastSuccessfulRun": last_run.map(|run| json!({
            "messageId": run_message_id(run).map(|value| Value::String(value.to_string())).unwrap_or(Value::Null),
            "createdAt": run_created_at(run).map(|value| Value::String(value.to_string())).unwrap_or(Value::Null)
        })),
        "assistantMessagesSinceLastRun": assistant_messages_since_last_run,
        "remainingAssistantMessages": remaining,
        "runsNextAssistantMessage": remaining == 0,
        "lastRunMessageFound": last_run_message_found
    }))
}

pub(crate) fn agent_memory(
    state: &AppState,
    method: &str,
    agent_type: &str,
    chat_id: &str,
    body: Value,
) -> AppResult<Value> {
    match method {
        "GET" => {
            let Some(agent_config_id) = agent_config_id(state, agent_type, false)? else {
                return Err(AppError::not_found("Agent is not configured"));
            };
            Ok(json!({
                "agentConfigId": agent_config_id,
                "memory": read_agent_memory(state, &agent_config_id, chat_id)?
            }))
        }
        "PATCH" => {
            let agent_config_id = agent_config_id(state, agent_type, true)?
                .ok_or_else(|| AppError::not_found("Agent is not configured"))?;
            let mut patch = body
                .get("patch")
                .and_then(Value::as_object)
                .cloned()
                .ok_or_else(|| {
                    AppError::invalid_input("Body must be { patch: { key: value, ... } }")
                })?;
            if agent_type == SECRET_PLOT_AGENT_TYPE {
                patch = normalize_secret_plot_memory_patch(patch)?;
            }
            for (key, value) in patch {
                set_agent_memory_value(state, &agent_config_id, chat_id, &key, value)?;
            }
            Ok(json!({
                "agentConfigId": agent_config_id,
                "memory": read_agent_memory(state, &agent_config_id, chat_id)?
            }))
        }
        "DELETE" => {
            if let Some(agent_config_id) = agent_config_id(state, agent_type, false)? {
                clear_agent_memory(state, &agent_config_id, chat_id)?;
            }
            Ok(json!({ "deleted": true }))
        }
        _ => Err(AppError::new(
            "method_not_allowed",
            "Unsupported agent memory method",
        )),
    }
}

fn normalize_secret_plot_memory_patch(patch: Map<String, Value>) -> AppResult<Map<String, Value>> {
    let mut normalized = Map::new();
    for (key, value) in patch {
        match key.as_str() {
            "overarchingArc" => {
                normalized.insert(key, normalize_secret_plot_arc(value)?);
            }
            "sceneDirections" => {
                normalized.insert(
                    key,
                    Value::Array(normalize_secret_plot_scene_directions(value)?),
                );
            }
            "recentlyFulfilled" => {
                normalized.insert(
                    key,
                    Value::Array(normalize_secret_plot_string_array(value)?),
                );
            }
            "staleDetected" => {
                let Some(value) = value.as_bool() else {
                    return Err(AppError::invalid_input(
                        "Secret Plot staleDetected must be a boolean",
                    ));
                };
                normalized.insert(key, Value::Bool(value));
            }
            "pacing" => {
                let Some(value) = value.as_str() else {
                    return Err(AppError::invalid_input(
                        "Secret Plot pacing must be a string",
                    ));
                };
                let value = value.trim();
                if !SECRET_PLOT_PACING_VALUES.contains(&value) {
                    return Err(AppError::invalid_input(
                        "Secret Plot pacing must be slow, exploration, building, climactic, or cooldown",
                    ));
                }
                normalized.insert(key, Value::String(value.to_string()));
            }
            _ => {
                return Err(AppError::invalid_input(format!(
                    "Unsupported Secret Plot memory field: {key}"
                )));
            }
        }
    }
    if normalized.is_empty() {
        return Err(AppError::invalid_input(
            "Secret Plot memory patch must include at least one supported field",
        ));
    }
    Ok(normalized)
}

fn normalize_secret_plot_arc(value: Value) -> AppResult<Value> {
    match value {
        Value::Null => Ok(Value::Null),
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                Ok(Value::Null)
            } else {
                Ok(Value::String(trimmed.to_string()))
            }
        }
        Value::Object(object) => Ok(Value::Object(object)),
        _ => Err(AppError::invalid_input(
            "Secret Plot overarchingArc must be an object, string, or null",
        )),
    }
}

fn normalize_secret_plot_scene_directions(value: Value) -> AppResult<Vec<Value>> {
    let Value::Array(entries) = value else {
        return Err(AppError::invalid_input(
            "Secret Plot sceneDirections must be an array",
        ));
    };
    let mut normalized = Vec::new();
    for entry in entries {
        match entry {
            Value::String(raw) => {
                let direction = raw.trim();
                if !direction.is_empty() {
                    normalized.push(json!({ "direction": direction, "fulfilled": false }));
                }
            }
            Value::Object(object) => {
                let Some(direction) = object.get("direction").and_then(Value::as_str) else {
                    return Err(AppError::invalid_input(
                        "Secret Plot scene direction must include direction text",
                    ));
                };
                let direction = direction.trim();
                if !direction.is_empty() {
                    normalized.push(json!({
                        "direction": direction,
                        "fulfilled": object.get("fulfilled").and_then(Value::as_bool).unwrap_or(false)
                    }));
                }
            }
            _ => {
                return Err(AppError::invalid_input(
                    "Secret Plot scene directions must be strings or objects",
                ));
            }
        }
    }
    Ok(normalized)
}

fn normalize_secret_plot_string_array(value: Value) -> AppResult<Vec<Value>> {
    let Value::Array(entries) = value else {
        return Err(AppError::invalid_input(
            "Secret Plot recentlyFulfilled must be an array",
        ));
    };
    let mut normalized = Vec::new();
    for entry in entries {
        let Value::String(raw) = entry else {
            return Err(AppError::invalid_input(
                "Secret Plot recentlyFulfilled entries must be strings",
            ));
        };
        let text = raw.trim();
        if !text.is_empty() {
            normalized.push(Value::String(text.to_string()));
        }
    }
    Ok(normalized)
}

pub(crate) fn clear_agent_runs_and_memory_for_chat(
    state: &AppState,
    chat_id: &str,
) -> AppResult<Value> {
    let mut preserved_arc: Option<Value> = None;
    let mut secret_plot_config_id: Option<String> = None;

    if let Some(secret_plot_config) = find_agent_config(state, "secret-plot-driver")? {
        if let Some(config_id) = secret_plot_config
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
        {
            let memory = read_agent_memory(state, &config_id, chat_id).unwrap_or_default();
            if let Some(arc) = memory.get("overarchingArc") {
                preserved_arc = Some(arc.clone());
                secret_plot_config_id = Some(config_id);
            }
        }
    }

    let (deleted_runs, deleted_memory) = delete_agent_bookkeeping_rows_for_chat(state, chat_id)?;

    let preserved_secret_plot_arc = secret_plot_config_id.is_some() && preserved_arc.is_some();
    if let (Some(config_id), Some(arc)) = (secret_plot_config_id, preserved_arc) {
        set_agent_memory_value(state, &config_id, chat_id, "overarchingArc", arc)?;
    }

    Ok(json!({
        "deletedRuns": deleted_runs,
        "deletedMemory": deleted_memory,
        "preservedSecretPlotArc": preserved_secret_plot_arc
    }))
}

pub(crate) fn delete_agent_bookkeeping_for_chat(state: &AppState, chat_id: &str) -> AppResult<()> {
    delete_agent_bookkeeping_rows_for_chat(state, chat_id).map(|_| ())
}

fn delete_agent_bookkeeping_rows_for_chat(
    state: &AppState,
    chat_id: &str,
) -> AppResult<(usize, usize)> {
    let deleted_runs = state
        .storage
        .delete_where_matching("agent-runs", |row| run_chat_id(row) == Some(chat_id))?;

    let deleted_memory = state
        .storage
        .delete_where_matching("agent-memory", |row| memory_chat_id(row) == Some(chat_id))?;

    Ok((deleted_runs, deleted_memory))
}

fn read_agent_memory(
    state: &AppState,
    agent_config_id: &str,
    chat_id: &str,
) -> AppResult<Map<String, Value>> {
    let mut memory = Map::new();
    for row in agent_memory_rows_for_chat_config(state, agent_config_id, chat_id)? {
        let Some(key) = row.get("key").and_then(Value::as_str) else {
            continue;
        };
        let value = row.get("value").cloned().unwrap_or(Value::Null);
        let parsed = match value {
            Value::String(raw) => serde_json::from_str::<Value>(&raw).unwrap_or(Value::String(raw)),
            other => other,
        };
        memory.insert(key.to_string(), parsed);
    }
    Ok(memory)
}

fn agent_memory_rows_for_chat_config(
    state: &AppState,
    agent_config_id: &str,
    chat_id: &str,
) -> AppResult<Vec<Value>> {
    Ok(state
        .storage
        .list("agent-memory")?
        .into_iter()
        .filter(|row| {
            memory_agent_config_id(row) == Some(agent_config_id)
                && memory_chat_id(row) == Some(chat_id)
        })
        .collect())
}

fn set_agent_memory_value(
    state: &AppState,
    agent_config_id: &str,
    chat_id: &str,
    key: &str,
    value: Value,
) -> AppResult<()> {
    let stored_value = match value {
        Value::String(raw) => Value::String(raw),
        other => Value::String(serde_json::to_string(&other)?),
    };
    let matching_rows = state
        .storage
        .list("agent-memory")?
        .into_iter()
        .filter(|row| {
            memory_agent_config_id(row) == Some(agent_config_id)
                && memory_chat_id(row) == Some(chat_id)
                && row.get("key").and_then(Value::as_str) == Some(key)
        })
        .collect::<Vec<_>>();
    if !matching_rows.is_empty() {
        let existing = matching_rows
            .iter()
            .find(|row| {
                row.get("agentConfigId").and_then(Value::as_str) == Some(agent_config_id)
                    && row.get("chatId").and_then(Value::as_str) == Some(chat_id)
            })
            .or_else(|| matching_rows.first())
            .expect("matching rows should not be empty");
        let id = existing
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| AppError::invalid_input("Agent memory row is missing id"))?;
        state.storage.patch(
            "agent-memory",
            &id,
            json!({
                "agentConfigId": agent_config_id,
                "chatId": chat_id,
                "key": key,
                "value": stored_value
            }),
        )?;
        for duplicate in matching_rows {
            let Some(duplicate_id) = duplicate.get("id").and_then(Value::as_str) else {
                continue;
            };
            if duplicate_id != id {
                state.storage.delete("agent-memory", duplicate_id)?;
            }
        }
    } else {
        state.storage.create(
            "agent-memory",
            json!({
                "agentConfigId": agent_config_id,
                "chatId": chat_id,
                "key": key,
                "value": stored_value
            }),
        )?;
    }
    Ok(())
}

fn clear_agent_memory(state: &AppState, agent_config_id: &str, chat_id: &str) -> AppResult<()> {
    for row in agent_memory_rows_for_chat_config(state, agent_config_id, chat_id)? {
        if let Some(id) = row.get("id").and_then(Value::as_str) {
            state.storage.delete("agent-memory", id)?;
        }
    }
    Ok(())
}

pub(crate) fn echo_messages(state: &AppState, method: &str, chat_id: &str) -> AppResult<Value> {
    match method {
        "GET" => {
            let rows = list_agent_runs_for_chat(state, chat_id)?;
            Ok(Value::Array(
                rows.into_iter()
                    .filter(|run| run_result_type(run) == Some("echo_message"))
                    .collect(),
            ))
        }
        "DELETE" => {
            let deleted = state.storage.delete_where_matching("agent-runs", |run| {
                run_chat_id(run) == Some(chat_id) && run_result_type(run) == Some("echo_message")
            })?;
            Ok(json!({ "deleted": deleted }))
        }
        _ => Err(AppError::new(
            "method_not_allowed",
            "Unsupported echo messages method",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-agent-storage-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp agent dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn seed_message(state: &AppState, id: &str, role: &str, created_at: &str) {
        state
            .storage
            .upsert_with_id(
                "messages",
                id,
                json!({
                    "id": id,
                    "chatId": "chat-1",
                    "role": role,
                    "content": "",
                    "createdAt": created_at
                }),
            )
            .expect("message should write");
    }

    #[test]
    fn by_type_mutations_reject_unknown_agent_types_without_creating_rows() {
        let state = test_state("unknown-agent-type-mutations");

        let patch_error = patch_agent_type(&state, "bogus-agent", json!({ "enabled": true }))
            .expect_err("unknown by-type patch should reject");
        let toggle_error = toggle_agent_type(&state, "bogus-agent")
            .expect_err("unknown by-type toggle should reject");

        assert_eq!(patch_error.code, "not_found");
        assert_eq!(toggle_error.code, "not_found");
        assert!(
            state
                .storage
                .list("agents")
                .expect("agents should be readable")
                .is_empty(),
            "unknown by-type mutations must not persist arbitrary agent rows"
        );
    }

    #[test]
    fn by_type_mutations_create_full_known_builtin_agent_rows() {
        let state = test_state("known-builtin-agent-mutations");

        let patched = patch_agent_type(&state, "director", json!({ "enabled": false }))
            .expect("known built-in patch should create a config row");
        let toggled = toggle_agent_type(&state, "illustrator")
            .expect("known built-in toggle should create a config row");
        let combat = patch_agent_type(&state, "combat", json!({}))
            .expect("combat patch should create a config row with default tools");

        assert_eq!(
            patched.get("type").and_then(Value::as_str),
            Some("director")
        );
        assert_eq!(
            patched.get("name").and_then(Value::as_str),
            Some("Narrative Director")
        );
        assert_eq!(
            patched.get("phase").and_then(Value::as_str),
            Some("pre_generation")
        );
        assert_eq!(patched.get("enabled").and_then(Value::as_bool), Some(false));
        assert_eq!(patched["connectionId"], Value::Null);
        assert_eq!(
            patched.get("promptTemplate").and_then(Value::as_str),
            Some("")
        );
        assert_eq!(patched["settings"]["maxTokens"], json!(4096));
        assert_eq!(patched["settings"]["injectAsSection"], json!(true));
        assert_eq!(patched["settings"]["runInterval"], json!(5));
        assert_eq!(
            patched["settings"]["enabledTools"],
            json!(["trigger_event"])
        );
        assert_eq!(
            toggled.get("type").and_then(Value::as_str),
            Some("illustrator")
        );
        assert_eq!(
            toggled.get("name").and_then(Value::as_str),
            Some("Illustrator")
        );
        assert_eq!(
            toggled.get("phase").and_then(Value::as_str),
            Some("post_processing")
        );
        assert_eq!(toggled.get("enabled").and_then(Value::as_bool), Some(true));
        assert_eq!(toggled["settings"]["maxTokens"], json!(4096));
        assert_eq!(toggled["settings"]["runInterval"], json!(5));
        assert_eq!(toggled["settings"]["enabledTools"], json!([]));
        assert_eq!(
            combat["settings"]["enabledTools"],
            json!(["roll_dice", "update_game_state"])
        );
    }

    #[test]
    fn by_type_patch_hydrates_existing_sparse_builtin_rows() {
        let state = test_state("sparse-builtin-patch");
        state
            .storage
            .upsert_with_id(
                "agents",
                "sparse-director",
                json!({
                    "id": "sparse-director",
                    "type": "director",
                    "enabled": true,
                    "settings": {
                        "runInterval": 2
                    }
                }),
            )
            .expect("sparse built-in config should write");

        let patched = patch_agent_type(
            &state,
            "director",
            json!({
                "settings": {
                    "sourceLorebookIds": ["lorebook-1"]
                }
            }),
        )
        .expect("known built-in patch should hydrate sparse config row");

        assert_eq!(
            patched.get("name").and_then(Value::as_str),
            Some("Narrative Director")
        );
        assert_eq!(
            patched.get("phase").and_then(Value::as_str),
            Some("pre_generation")
        );
        assert_eq!(patched.get("enabled").and_then(Value::as_bool), Some(true));
        assert_eq!(patched["settings"]["maxTokens"], json!(4096));
        assert_eq!(patched["settings"]["injectAsSection"], json!(true));
        assert_eq!(patched["settings"]["runInterval"], json!(2));
        assert_eq!(
            patched["settings"]["enabledTools"],
            json!(["trigger_event"])
        );
        assert_eq!(
            patched["settings"]["sourceLorebookIds"],
            json!(["lorebook-1"])
        );

        let stored = state
            .storage
            .get("agents", "sparse-director")
            .expect("agent lookup should succeed")
            .expect("hydrated agent should still exist");
        assert_eq!(stored["settings"]["runInterval"], json!(2));
        assert_eq!(
            stored.get("promptTemplate").and_then(Value::as_str),
            Some("")
        );
    }

    #[test]
    fn by_type_toggle_hydrates_existing_sparse_builtin_rows_before_flipping() {
        let state = test_state("sparse-builtin-toggle");
        state
            .storage
            .upsert_with_id(
                "agents",
                "sparse-illustrator",
                json!({
                    "id": "sparse-illustrator",
                    "type": "illustrator",
                    "enabled": true
                }),
            )
            .expect("sparse built-in config should write");

        let toggled = toggle_agent_type(&state, "illustrator")
            .expect("known built-in toggle should hydrate sparse config row");

        assert_eq!(toggled.get("enabled").and_then(Value::as_bool), Some(false));
        assert_eq!(
            toggled.get("name").and_then(Value::as_str),
            Some("Illustrator")
        );
        assert_eq!(
            toggled.get("phase").and_then(Value::as_str),
            Some("post_processing")
        );
        assert_eq!(toggled["settings"]["maxTokens"], json!(4096));
        assert_eq!(toggled["settings"]["runInterval"], json!(5));
        assert_eq!(toggled["settings"]["enabledTools"], json!([]));
    }

    #[test]
    fn get_or_create_agent_config_hydrates_existing_sparse_builtin_rows() {
        let state = test_state("sparse-builtin-get-or-create");
        state
            .storage
            .upsert_with_id(
                "agents",
                "sparse-background",
                json!({
                    "id": "sparse-background",
                    "type": "background",
                    "enabled": false
                }),
            )
            .expect("sparse built-in config should write");

        let hydrated = get_or_create_agent_config(&state, "background")
            .expect("get-or-create should hydrate sparse built-in row");

        assert_eq!(
            hydrated.get("enabled").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            hydrated.get("name").and_then(Value::as_str),
            Some("Background")
        );
        assert_eq!(
            hydrated.get("phase").and_then(Value::as_str),
            Some("post_processing")
        );
        assert_eq!(hydrated["settings"]["maxTokens"], json!(4096));
        assert_eq!(hydrated["settings"]["enabledTools"], json!([]));
    }

    #[test]
    fn by_type_patch_merges_settings_with_builtin_defaults() {
        let state = test_state("known-builtin-settings-merge");

        let patched = patch_agent_type(
            &state,
            "knowledge-retrieval",
            json!({
                "settings": {
                    "sourceLorebookIds": ["lorebook-1"]
                }
            }),
        )
        .expect("known built-in patch should merge default settings");

        assert_eq!(
            patched.get("name").and_then(Value::as_str),
            Some("Knowledge Retrieval")
        );
        assert_eq!(patched["settings"]["maxTokens"], json!(4096));
        assert_eq!(patched["settings"]["useChatActiveLorebooks"], json!(true));
        assert_eq!(
            patched["settings"]["enabledTools"],
            json!(["search_lorebook"])
        );
        assert_eq!(
            patched["settings"]["sourceLorebookIds"],
            json!(["lorebook-1"])
        );
    }

    #[test]
    fn cadence_status_rejects_unknown_agent_type_without_fake_status() {
        let state = test_state("unknown-agent-type-cadence");

        let error = agent_cadence_status(&state, "bogus-agent", "chat-1")
            .expect_err("unknown cadence status should reject");

        assert_eq!(error.code, "not_found");
    }

    #[test]
    fn cadence_status_still_reports_known_builtin_without_config_row() {
        let state = test_state("known-builtin-cadence");

        let status = agent_cadence_status(&state, "director", "chat-1")
            .expect("known built-in cadence status should use defaults");

        assert_eq!(status["agentType"], "director");
        assert_eq!(status["runInterval"], 5);
        assert_eq!(status["remainingAssistantMessages"], 0);
        assert_eq!(status["runsNextAssistantMessage"], true);
    }

    #[test]
    fn clear_agent_bookkeeping_preserves_legacy_secret_plot_arc() {
        let state = test_state("legacy-secret-plot-arc");
        state
            .storage
            .upsert_with_id(
                "agents",
                "secret-plot-agent",
                json!({
                    "id": "secret-plot-agent",
                    "type": "secret-plot-driver",
                    "name": "Secret Plot Driver",
                    "settings": {}
                }),
            )
            .expect("secret plot agent should write");
        state
            .storage
            .upsert_with_id(
                "agent-memory",
                "legacy-secret-arc",
                json!({
                    "id": "legacy-secret-arc",
                    "agent_config_id": "secret-plot-agent",
                    "chat_id": "chat-1",
                    "key": "overarchingArc",
                    "value": "legacy arc"
                }),
            )
            .expect("legacy secret plot memory should write");
        state
            .storage
            .upsert_with_id(
                "agent-memory",
                "legacy-director-note",
                json!({
                    "id": "legacy-director-note",
                    "agent_config_id": "agent-director",
                    "chat_id": "chat-1",
                    "key": "note",
                    "value": "delete me"
                }),
            )
            .expect("legacy ordinary memory should write");
        state
            .storage
            .upsert_with_id(
                "agent-memory",
                "legacy-other-chat-note",
                json!({
                    "id": "legacy-other-chat-note",
                    "agent_config_id": "agent-director",
                    "chat_id": "other-chat",
                    "key": "note",
                    "value": "keep me"
                }),
            )
            .expect("legacy other chat memory should write");

        let result = clear_agent_runs_and_memory_for_chat(&state, "chat-1")
            .expect("agent bookkeeping clear should succeed");

        assert_eq!(result["deletedMemory"], json!(2));
        assert_eq!(result["preservedSecretPlotArc"], json!(true));
        assert!(
            state
                .storage
                .get("agent-memory", "legacy-secret-arc")
                .expect("legacy secret arc lookup should succeed")
                .is_none(),
            "legacy secret plot row should be replaced by the preserved current row"
        );
        assert!(
            state
                .storage
                .get("agent-memory", "legacy-director-note")
                .expect("legacy ordinary row lookup should succeed")
                .is_none(),
            "ordinary legacy memory for the cleared chat should be removed"
        );
        assert!(
            state
                .storage
                .get("agent-memory", "legacy-other-chat-note")
                .expect("legacy other chat row lookup should succeed")
                .is_some(),
            "legacy memory for other chats should stay"
        );

        let rows = state
            .storage
            .list("agent-memory")
            .expect("agent memory should be readable");
        let restored_arc = rows
            .iter()
            .find(|row| {
                row.get("chatId").and_then(Value::as_str) == Some("chat-1")
                    && row.get("agentConfigId").and_then(Value::as_str) == Some("secret-plot-agent")
                    && row.get("key").and_then(Value::as_str) == Some("overarchingArc")
            })
            .expect("secret plot arc should be restored in current shape");
        assert_eq!(
            restored_arc.get("value").and_then(Value::as_str),
            Some("legacy arc")
        );
    }

    #[test]
    fn set_agent_memory_value_normalizes_legacy_only_row() {
        let state = test_state("legacy-memory-write");
        state
            .storage
            .upsert_with_id(
                "agent-memory",
                "legacy-note",
                json!({
                    "id": "legacy-note",
                    "agent_config_id": "agent-director",
                    "chat_id": "chat-1",
                    "key": "note",
                    "value": "old"
                }),
            )
            .expect("legacy memory should write");

        set_agent_memory_value(&state, "agent-director", "chat-1", "note", json!("updated"))
            .expect("memory write should succeed");

        let row = state
            .storage
            .get("agent-memory", "legacy-note")
            .expect("memory lookup should succeed")
            .expect("legacy row should be normalized in place");
        assert_eq!(
            row.get("agentConfigId").and_then(Value::as_str),
            Some("agent-director")
        );
        assert_eq!(row.get("chatId").and_then(Value::as_str), Some("chat-1"));
        assert_eq!(row.get("key").and_then(Value::as_str), Some("note"));
        assert_eq!(row.get("value").and_then(Value::as_str), Some("updated"));

        let mut filters = Map::new();
        filters.insert(
            "agentConfigId".to_string(),
            Value::String("agent-director".to_string()),
        );
        filters.insert("chatId".to_string(), Value::String("chat-1".to_string()));
        filters.insert("key".to_string(), Value::String("note".to_string()));
        let current_rows = state
            .storage
            .list_where("agent-memory", &filters)
            .expect("current-shape memory should be queryable");
        assert_eq!(current_rows.len(), 1);
        assert_eq!(
            current_rows[0].get("value").and_then(Value::as_str),
            Some("updated")
        );
    }

    #[test]
    fn set_agent_memory_value_prefers_current_row_over_legacy_duplicate() {
        let state = test_state("mixed-memory-write");
        state
            .storage
            .upsert_with_id(
                "agent-memory",
                "legacy-note",
                json!({
                    "id": "legacy-note",
                    "agent_config_id": "agent-director",
                    "chat_id": "chat-1",
                    "key": "note",
                    "value": "legacy stale"
                }),
            )
            .expect("legacy memory should write");
        state
            .storage
            .upsert_with_id(
                "agent-memory",
                "current-note",
                json!({
                    "id": "current-note",
                    "agentConfigId": "agent-director",
                    "chatId": "chat-1",
                    "key": "note",
                    "value": "current old"
                }),
            )
            .expect("current memory should write");

        set_agent_memory_value(
            &state,
            "agent-director",
            "chat-1",
            "note",
            json!("current updated"),
        )
        .expect("memory write should succeed");

        assert!(
            state
                .storage
                .get("agent-memory", "legacy-note")
                .expect("legacy memory lookup should succeed")
                .is_none(),
            "legacy duplicate should be removed after current row wins"
        );
        let row = state
            .storage
            .get("agent-memory", "current-note")
            .expect("current memory lookup should succeed")
            .expect("current row should remain");
        assert_eq!(
            row.get("value").and_then(Value::as_str),
            Some("current updated")
        );
        assert_eq!(
            row.get("agentConfigId").and_then(Value::as_str),
            Some("agent-director")
        );
        assert_eq!(row.get("chatId").and_then(Value::as_str), Some("chat-1"));
    }

    #[test]
    fn secret_plot_memory_patch_rejects_invalid_fields_without_writing_memory() {
        let state = test_state("secret-plot-invalid-memory-patch");

        let unknown = agent_memory(
            &state,
            "PATCH",
            "secret-plot-driver",
            "chat-1",
            json!({ "patch": { "note": "not part of the Secret Plot schema" } }),
        )
        .expect_err("unknown Secret Plot memory keys should reject");
        assert_eq!(unknown.code, "invalid_input");

        let invalid_stale = agent_memory(
            &state,
            "PATCH",
            "secret-plot-driver",
            "chat-1",
            json!({ "patch": { "staleDetected": "yes" } }),
        )
        .expect_err("invalid Secret Plot field types should reject");
        assert_eq!(invalid_stale.code, "invalid_input");

        let rows = state
            .storage
            .list("agent-memory")
            .expect("agent memory should list");
        assert!(
            rows.is_empty(),
            "invalid Secret Plot patches must not persist partial memory rows"
        );
    }

    #[test]
    fn secret_plot_memory_patch_normalizes_supported_fields() {
        let state = test_state("secret-plot-valid-memory-patch");

        let response = agent_memory(
            &state,
            "PATCH",
            "secret-plot-driver",
            "chat-1",
            json!({
                "patch": {
                    "overarchingArc": "  A mystery starts quietly.  ",
                    "sceneDirections": [
                        "  Let the conversation breathe.  ",
                        { "direction": "  A clue becomes tempting.  ", "fulfilled": true }
                    ],
                    "recentlyFulfilled": ["  old clue  ", ""],
                    "pacing": " building ",
                    "staleDetected": true
                }
            }),
        )
        .expect("valid Secret Plot memory patch should persist");

        let memory = response
            .get("memory")
            .and_then(Value::as_object)
            .expect("response should include memory");
        assert_eq!(memory["overarchingArc"], "A mystery starts quietly.");
        assert_eq!(
            memory["sceneDirections"],
            json!([
                { "direction": "Let the conversation breathe.", "fulfilled": false },
                { "direction": "A clue becomes tempting.", "fulfilled": true }
            ])
        );
        assert_eq!(memory["recentlyFulfilled"], json!(["old clue"]));
        assert_eq!(memory["pacing"], "building");
        assert_eq!(memory["staleDetected"], true);
    }

    #[test]
    fn secret_plot_schema_does_not_apply_to_other_agent_memory() {
        let state = test_state("director-arbitrary-memory-patch");

        let response = agent_memory(
            &state,
            "PATCH",
            "director",
            "chat-1",
            json!({ "patch": { "note": { "text": "keep me" }, "staleDetected": "yes" } }),
        )
        .expect("non-Secret agents should keep arbitrary memory patches");

        let memory = response
            .get("memory")
            .and_then(Value::as_object)
            .expect("response should include memory");
        assert_eq!(memory["note"], json!({ "text": "keep me" }));
        assert_eq!(memory["staleDetected"], "yes");
    }

    #[test]
    fn cadence_status_uses_default_interval_and_successful_runs() {
        let state = test_state("cadence-success");
        state
            .storage
            .upsert_with_id(
                "agents",
                "agent-director",
                json!({
                    "id": "agent-director",
                    "type": "director",
                    "name": "Narrative Director",
                    "settings": {}
                }),
            )
            .expect("agent config should write");
        seed_message(&state, "m1", "assistant", "2026-05-20T00:00:00Z");
        seed_message(&state, "m2", "assistant", "2026-05-20T00:01:00Z");
        seed_message(&state, "m3", "assistant", "2026-05-20T00:02:00Z");
        state
            .storage
            .upsert_with_id(
                "agent-runs",
                "run-success",
                json!({
                    "id": "run-success",
                    "agentConfigId": "agent-director",
                    "chatId": "chat-1",
                    "messageId": "m1",
                    "success": true,
                    "createdAt": "2026-05-20T00:00:30Z"
                }),
            )
            .expect("successful run should write");
        state
            .storage
            .upsert_with_id(
                "agent-runs",
                "run-failed-newer",
                json!({
                    "id": "run-failed-newer",
                    "agentConfigId": "agent-director",
                    "agentType": "director",
                    "chatId": "chat-1",
                    "messageId": "m3",
                    "success": false,
                    "createdAt": "2026-05-20T00:02:30Z"
                }),
            )
            .expect("failed run should write");

        let status = agent_cadence_status(&state, "director", "chat-1")
            .expect("cadence status should be calculated");

        assert_eq!(status["runInterval"], 5);
        assert_eq!(status["lastSuccessfulRun"]["messageId"], "m1");
        assert_eq!(status["assistantMessagesSinceLastRun"], 2);
        assert_eq!(status["remainingAssistantMessages"], 2);
        assert_eq!(status["runsNextAssistantMessage"], false);
        assert_eq!(status["lastRunMessageFound"], true);
    }

    #[test]
    fn cadence_status_matches_imported_runs_by_agent_config_id() {
        let state = test_state("cadence-imported-config-id");
        state
            .storage
            .upsert_with_id(
                "agents",
                "custom-agent-1",
                json!({
                    "id": "custom-agent-1",
                    "type": "custom-prophet",
                    "name": "Custom Prophet",
                    "settings": { "runInterval": 3 }
                }),
            )
            .expect("agent config should write");
        seed_message(&state, "m1", "user", "2026-05-20T00:00:00Z");
        seed_message(&state, "m2", "assistant", "2026-05-20T00:01:00Z");
        state
            .storage
            .upsert_with_id(
                "agent-runs",
                "run-imported-newer",
                json!({
                    "id": "run-imported-newer",
                    "agent_config_id": "custom-agent-1",
                    "chat_id": "chat-1",
                    "message_id": "m1",
                    "success": "true",
                    "created_at": "2026-05-20T00:00:30Z"
                }),
            )
            .expect("newer import-style run should write");
        state
            .storage
            .upsert_with_id(
                "agent-runs",
                "run-imported-older",
                json!({
                    "id": "run-imported-older",
                    "agent_config_id": "custom-agent-1",
                    "chat_id": "chat-1",
                    "message_id": "m2",
                    "success": "true",
                    "created_at": "2026-05-19T23:59:30Z"
                }),
            )
            .expect("older import-style run should write");

        let status = agent_cadence_status(&state, "custom-prophet", "chat-1")
            .expect("cadence status should match by config id");

        assert_eq!(status["runInterval"], 3);
        assert_eq!(status["lastSuccessfulRun"]["messageId"], "m1");
        assert_eq!(status["assistantMessagesSinceLastRun"], 1);
        assert_eq!(status["remainingAssistantMessages"], 1);
    }
}
