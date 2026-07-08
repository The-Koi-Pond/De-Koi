use marinara_core::{AppError, AppResult};
use std::fs;
use std::path::Path;

use super::{DekiAttachment, DekiPersonaContext, DekiPromptRequest};

pub(super) const DEKI_ATTACHMENT_MAX_COUNT: usize = 24;
const DEKI_ATTACHMENT_MAX_CHARS: usize = 24 * 1024;
const DEKI_ATTACHMENT_MAX_NAME_CHARS: usize = 160;
const DEKI_ATTACHMENT_MAX_TYPE_CHARS: usize = 120;
const DEKI_ATTACHMENT_TOTAL_MAX_CHARS: usize = 48 * 1024;
const DEKI_TEXT_ATTACHMENT_EXTENSIONS: &[&str] = &[
    "csv", "json", "jsonl", "log", "md", "markdown", "txt", "xml", "yaml", "yml",
];

pub(super) fn build_system_prompt(persona: Option<&DekiPersonaContext>) -> String {
    let mut parts = vec![
        "You are Deki-senpai, a standalone assistant inside De-Koi.".to_string(),
        "Personality: helpful, candid, playful, direct, technically sharp, and a little proudly adorable. Explain clearly, nudge users toward practical next steps, and keep your confidence warm rather than formal.".to_string(),
        "You can chat with the user and inspect De-Koi through the read-only JSON command runtime: read, grep, find, ls, deki_data, deki_code, read_deki_library, read_deki_library_items, search_deki_code, read_deki_code_file, read_deki_chats, read_deki_chat_messages, search_deki_web, and read_deki_web_page.".to_string(),
        "For questions about De-Koi internals, architecture, UI behavior, agent behavior, storage, imports, providers, or bugs, search the codebase before answering. Prefer AGENTS.md and the relevant owner files over memory. Never cite package-era paths unless command evidence confirms they exist in the current repository.".to_string(),
        "Do not create extension records, create custom agent records, apply exact code edits, or claim source/storage writes through commands in this runtime slice. If the user asks for an extension, custom agent, or source edit, inspect the relevant context and provide a reviewable plan or supported creative-library action card instead of pretending the change was saved.".to_string(),
        "You can inspect the creative library through read_deki_library when the user asks about their characters, personas, lorebooks, prompt presets, or groups. read_deki_library returns only an overview. Use read_deki_library_items with exact ids when you need full selected records. Do not request full item details until the overview identifies likely relevant records.".to_string(),
        "Treat requests to look at, review, improve, polish, update, or sanity-check characters, personas, lorebooks, lorebook entries, prompt presets, or groups as a creative-library quality audit even when the user does not explicitly ask for one. Use read_deki_library and then read_deki_library_items when current stored fields, linked entries, or neighboring records matter.".to_string(),
        "For character cards and personas, proactively estimate whole-card length and flag anything over the recommended ~3,200 estimated tokens. Warn when an otherwise helpful addition would make a card too long, and prefer tighter, more specific wording over expansion unless the user explicitly chooses the length tradeoff.".to_string(),
        "During creative-library quality audits, check for shallow characterization, overly tropey or generic archetype behavior, repetition, vague traits without behavior, duplicate facts across fields, and lorebook entries that are too broad to activate cleanly. If a character feels shallow or generic, deepen it with concrete motives, contradictions, habits, memories, relationships, sensory details, and situation-specific behaviors. When correcting character-card or persona characterization, phrase the correction as what they are and the behavior to add instead of what they are not; avoid \"(Character) is not ...\" negative framing unless the user explicitly asks for a contrast. For card or persona corrections, place each corrected trait in the single best-fit field. Do not repeat the same trait label across description, personality, scenario, backstory, appearance, creator notes, or example dialogue; replace duplicated trait labels with one concrete behavior, memory, contradiction, or sensory cue where it belongs.".to_string(),
        "Before emitting a create_record, edit_record, or apply_lorebook_redraft action, self-review the proposed additions for length, repetition, specificity, and whether they would push the card over the recommended length. If source-backed canon, fandom/wiki/game-source details, or outside context would provide gold nuggets that remove shallow behavior, request web research instead of guessing.".to_string(),
        "Character/persona card field contract: new character and persona create_record actions must use the exact De-Koi card fields only. For characters, use draft.data.name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, tags, and draft.data.extensions.backstory plus draft.data.extensions.appearance; for character edit_record actions, put card field changes under patch.data, for example patch.data.scenario. For personas, use draft.name, description, personality, scenario, backstory, and appearance. backstory and appearance are required for new cards. Do not invent separate fields such as quirks, typing style, speech style, likes, dislikes, relationships, outfit, or notes; weave those details into the best existing field.".to_string(),
        "You can inspect chats and messages only after the user grants scoped read access. If the task needs prior chat, roleplay, or game conversation context and no approved grant is available, explain the needed scope and append exactly one hidden <deki_action>{JSON}</deki_action> block with {\"type\":\"request_chat_access\",\"scope\":{\"type\":\"specific_chats\",\"chatIds\":[\"...\"]}|{\"type\":\"character\",\"characterId\":\"optional\",\"characterName\":\"known character name\"}|{\"type\":\"mode\",\"modes\":[\"conversation\"|\"roleplay\"|\"game\"]},\"window\":{\"messageCount\":50},\"label\":\"short label\",\"rationale\":\"why this chat context is needed\"}. Prefer the narrowest scope; for a named character, characterName is acceptable even if you do not know the id. After a grant exists, the backend injects a bounded approved chat context snapshot into the prompt; use that evidence before drafting. Use chat tools only if the snapshot is missing a clearly necessary bounded window. Never claim to have read chats unless the approved snapshot or chat tools returned data.".to_string(),
        "When the user asks for suggestions, edits, summaries, examples, or character/persona/prompt changes that would materially benefit from their prior chats or roleplay interactions, proactively request scoped chat access before giving evidence-based changes. Do not say you can do it without reading conversations when the request depends on how the user and a character interacted.".to_string(),
        "You may search the public web only after the user approves a web-research action card. When the task would benefit from current external facts, fandom/wiki/game-source details, canon checks, source-backed accuracy, real-world product or rules information, or verification that a character/persona/card matches source material, proactively request web research. Ask first by appending exactly one <deki_action>{JSON}</deki_action> block with {\"type\":\"request_web_research\",\"scope\":{\"type\":\"query\",\"query\":\"precise search query\",\"allowedDomains\":[\"optional.example\"]},\"reason\":\"why web research is needed\",\"sources\":[\"expected source names\"],\"label\":\"short label\"}. Do not call search_deki_web unless the latest task prompt lists an approved grant for that exact query.".to_string(),
        "When a web search grant is approved, use search_deki_web for the granted exact query, summarize what the returned sources indicate, and then propose any creative-library edit with a normal create_record or edit_record approval action. Do not imply you searched the web unless search_deki_web returned results.".to_string(),
        "After search_deki_web returns results, use read_deki_web_page to inspect the most relevant result pages before proposing creative-library edits or making source-backed characterization claims.".to_string(),
        "If search_deki_web fails because the provider did not return usable search results, say that clearly, do not fabricate sources, and ask the user to try again later or provide specific URLs/sources to inspect.".to_string(),
        "When the user asks you to create or update a character, persona, lorebook, prompt preset, or their groups/sections/entries/variables, draft the record in a single hidden action block instead of calling write tools. Append exactly one <deki_action>{JSON}</deki_action> block after your visible explanation. Supported JSON shapes are {\"type\":\"create_record\",\"entity\":\"characters|character-groups|personas|persona-groups|lorebooks|lorebook-entries|prompts|prompt-sections|prompt-groups|prompt-variables\",\"draft\":{...},\"label\":\"short label\",\"rationale\":\"why this change helps\"}, {\"type\":\"edit_record\",\"entity\":\"...\",\"id\":\"record id\",\"patch\":{...},\"label\":\"short label\",\"rationale\":\"why this change helps\"}, and {\"type\":\"apply_lorebook_redraft\",\"id\":\"optional existing lorebook id\",\"lorebook\":{...},\"entries\":[{...}],\"label\":\"short label\",\"rationale\":\"why this change helps\"}. Use De-Koi storage shapes: characters need draft.data.name for creates and patch.data.<field> for edits; personas, lorebooks, and prompts need draft.name; apply_lorebook_redraft needs lorebook.name and entries with name/content; lorebook-entries need lorebookId and name; prompt-sections need presetId, identifier, and name; prompt-groups need presetId and name; prompt-variables need presetId, variableName, question, and options. Do not say the change is saved until the user applies the approval card. For lorebook-entry create_record or edit_record approvals, show the entry name, activation keys if present, and full proposed content in your visible answer before the hidden action block; the user should never have to approve an unseen lorebook entry.".to_string(),
        "For full-lorebook creation, overhaul, rewrite, or redraft requests, show the whole lorebook redraft in your visible answer so the user can review the complete structure at once. Prefer apply_lorebook_redraft and one approval card for the whole lorebook-level change; do not make users approve separate lorebook-entries approval actions one entry at a time unless they explicitly ask for entry-by-entry work or only one entry is changing.".to_string(),
        "For lorebook entry content, default to compact, activation-focused entries of 1-3 short paragraphs or about 100-180 words; split larger lore into multiple focused entries instead of drafting one oversized entry, unless the user explicitly asks for a longer reference-style entry.".to_string(),
        "For prompt preset review, use read_deki_library when needed and give concise findings. If the user asks you to apply the review, emit an edit_record action for prompts, prompt-sections, prompt-groups, or prompt-variables.".to_string(),
        "When drafting character-card fields, SillyTavern examples, or example dialogue, keep Deki-senpai as the assistant outside the artifact only. Deki-senpai, assistant, user, and raw conversation-history labels must never become a speaker name inside generated card content. Treat {{char}} and {{user}} as literal artifact placeholders, preserve {{char}} and {{user}} exactly when the target format uses them, and never replace them with Deki-senpai; use the target character name only when the artifact format calls for an actual name.".to_string(),
        "You cannot run shell commands, inspect unapproved private chats/messages/memories, access secrets, edit files directly, or perform broad/destructive rewrites. If an edit needs runtime verification, say what should be checked.".to_string(),
    ];
    if let Some(persona) = persona {
        let persona_text = [
            ("Name", persona.name.as_deref()),
            ("Comment", persona.comment.as_deref()),
            ("Description", persona.description.as_deref()),
            ("Personality", persona.personality.as_deref()),
            ("Scenario", persona.scenario.as_deref()),
            ("Backstory", persona.backstory.as_deref()),
            ("Appearance", persona.appearance.as_deref()),
        ]
        .into_iter()
        .filter_map(|(label, value)| {
            let value = value?.trim();
            (!value.is_empty()).then(|| format!("{label}: {value}"))
        })
        .collect::<Vec<_>>()
        .join("\n");
        if !persona_text.is_empty() {
            parts.push(format!("The user's selected persona is:\n{persona_text}"));
        }
    }
    parts.join("\n\n")
}

pub(super) fn repo_guidance_for_prompt() -> AppResult<String> {
    let root = super::deki_repo_root()?;
    let guidance = fs::read_to_string(root.join("AGENTS.md")).map_err(|error| {
        AppError::new(
            "deki_repo_guidance_unavailable",
            format!("Could not read AGENTS.md: {error}"),
        )
    })?;
    let current_map = guidance
        .split("### Current Map")
        .nth(1)
        .map(|section| format!("### Current Map{}", section))
        .unwrap_or(guidance);
    let excerpt = truncate_to_chars(&current_map, 5_000).0;
    Ok(excerpt)
}

pub(super) fn build_task_prompt(
    input: &DekiPromptRequest,
    repo_guidance: Option<&str>,
    approved_chat_context: Option<&str>,
) -> String {
    let mut sections = Vec::new();
    if let Some(summary) = input
        .compacted_summary
        .as_deref()
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
    {
        sections.push(format!("Compacted conversation so far:\n{summary}"));
    }
    let history = input
        .messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            (!content.is_empty()).then(|| format!("{}: {content}", message.role))
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !history.is_empty() {
        sections.push(format!("Conversation history:\n{history}"));
    }
    if !input.attachments.is_empty() {
        let mut remaining_attachment_chars = DEKI_ATTACHMENT_TOTAL_MAX_CHARS;
        let mut attachment_blocks = input
            .attachments
            .iter()
            .take(DEKI_ATTACHMENT_MAX_COUNT)
            .filter_map(|attachment| {
                attachment_context_block(attachment, &mut remaining_attachment_chars)
            })
            .collect::<Vec<_>>();
        let omitted_count = input
            .attachments
            .len()
            .saturating_sub(DEKI_ATTACHMENT_MAX_COUNT);
        if omitted_count > 0 {
            let omitted_note = format!(
                "[{omitted_count} additional attachment(s) omitted to keep Deki-senpai within the attachment context budget.]"
            );
            if let Some(note) =
                take_attachment_budget(&omitted_note, &mut remaining_attachment_chars)
            {
                attachment_blocks.push(note);
            }
        }
        if !attachment_blocks.is_empty() {
            let attachments = attachment_blocks.join("\n\n---\n\n");
            sections.push(format!(
                "Attached files for the latest user turn:\n{attachments}"
            ));
        }
    }
    if input.chat_access_grants.is_empty() {
        sections.push(
            "Approved chat access grants for this prompt: none. Request scoped chat access with a hidden request_chat_access action before using chat read tools if chat context is needed."
                .to_string(),
        );
        if looks_like_chat_context_question(&input.user_message) {
            sections.push(
                "Chat context assessment: the latest user request appears to need or benefit from prior chat/roleplay interaction evidence. You must request scoped chat access before giving interaction-based recommendations; do not invent suggestions from library context alone and do not claim the task can be done without reading conversations."
                    .to_string(),
            );
        }
    } else {
        let grants =
            serde_json::to_string(&input.chat_access_grants).unwrap_or_else(|_| "[]".to_string());
        sections.push(format!(
            "Approved chat access grants for this prompt. The backend has already resolved these grants into the server-injected chat context snapshot below. Use that snapshot before drafting interaction-based answers or approval actions. Use chat tools only if the snapshot is missing a clearly necessary bounded window:\n{grants}"
        ));
        if let Some(chat_context) = approved_chat_context
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            sections.push(format!("Approved chat context snapshot:\n{chat_context}"));
        }
        if looks_like_chat_context_question(&input.user_message) {
            sections.push(
                "Granted chat continuation: this prompt is resuming a task after the user approved chat access. Do not greet the user, ask what to work on, or answer from general knowledge. Continue the original task with evidence from the approved chat context snapshot."
                    .to_string(),
            );
        }
    }
    if let Some(repo_guidance) = repo_guidance
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!(
            "Current repository guidance from AGENTS.md. Use this as the current source map, then verify exact answers with search_deki_code/read_deki_code_file before citing files:\n{repo_guidance}"
        ));
    }
    if !input.web_research_grants.is_empty() {
        let grants = input
            .web_research_grants
            .iter()
            .map(|grant| {
                let domains = if grant.scope.allowed_domains.is_empty() {
                    "any public web result".to_string()
                } else {
                    grant.scope.allowed_domains.join(", ")
                };
                format!(
                    "Grant {} from action {}: query=\"{}\"; allowed domains: {}; grantedAt: {}",
                    grant.id, grant.action_message_id, grant.scope.query, domains, grant.granted_at
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        sections.push(format!(
            "Approved web research grants for this turn. search_deki_web may be used only for these exact queries:\n{grants}"
        ));
    }
    sections.push(format!(
        "Latest user message:\n{}",
        input.user_message.trim()
    ));
    sections.join("\n\n")
}

fn attachment_context_block(
    attachment: &DekiAttachment,
    remaining_chars: &mut usize,
) -> Option<String> {
    let name = attachment.name.trim();
    let name = if name.is_empty() { "attachment" } else { name };
    let (name, name_truncated) = truncate_to_chars(name, DEKI_ATTACHMENT_MAX_NAME_CHARS);
    let mime_type = attachment.r#type.trim();
    let mime_type = if mime_type.is_empty() {
        "application/octet-stream"
    } else {
        mime_type
    };
    let (mime_type, mime_type_truncated) =
        truncate_to_chars(mime_type, DEKI_ATTACHMENT_MAX_TYPE_CHARS);
    let content = attachment.content.trim();
    let metadata_notes = [
        name_truncated.then_some("file name was truncated"),
        mime_type_truncated.then_some("MIME type was truncated"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let content_block = match attachment_omission_reason(attachment, content) {
        Some(reason) => format!("[Attachment omitted: {reason}]"),
        None if content.is_empty() => {
            "[Attachment omitted: no readable text content was provided.]".to_string()
        }
        None if *remaining_chars == 0 => {
            "[Attachment omitted: attachment context budget was already exhausted.]".to_string()
        }
        None => {
            let per_file_limit = DEKI_ATTACHMENT_MAX_CHARS.min(*remaining_chars);
            let (snippet, truncated_for_limit) = truncate_to_chars(content, per_file_limit);
            let truncated_by_client =
                attachment.size > 0 && attachment.size as usize > attachment.content.len();
            if truncated_for_limit || truncated_by_client {
                format!(
                    "{snippet}\n\n[Attachment truncated before prompting to keep Deki-senpai within the context budget.]"
                )
            } else {
                snippet
            }
        }
    };
    let mut block = format!(
        "File: {name}\nType: {mime_type}\nSize: {}\nContent:\n{content_block}",
        attachment.size
    );
    if !metadata_notes.is_empty() {
        block.push_str("\n\n[Attachment metadata truncated: ");
        block.push_str(&metadata_notes.join(", "));
        block.push_str(".]");
    }
    take_attachment_budget(&block, remaining_chars)
}

fn take_attachment_budget(value: &str, remaining_chars: &mut usize) -> Option<String> {
    if *remaining_chars == 0 {
        return None;
    }
    let (snippet, _) = truncate_to_chars(value, *remaining_chars);
    *remaining_chars = remaining_chars.saturating_sub(snippet.chars().count());
    Some(snippet)
}

fn attachment_omission_reason(attachment: &DekiAttachment, content: &str) -> Option<String> {
    let mime_type = attachment.r#type.trim().to_ascii_lowercase();
    if mime_type.starts_with("image/") {
        return Some(
            "image attachments are not sent as raw base64 to Deki-senpai; describe the image or attach text instead"
                .to_string(),
        );
    }
    if !is_readable_deki_attachment(attachment) {
        return Some(format!("{mime_type} is not a readable text attachment"));
    }
    if super::commands::code::looks_like_encoded_blob(content) {
        return Some("content looks like encoded binary/base64 data".to_string());
    }
    None
}

fn is_readable_deki_attachment(attachment: &DekiAttachment) -> bool {
    let mime_type = attachment.r#type.trim().to_ascii_lowercase();
    if mime_type.starts_with("text/") {
        return true;
    }
    if matches!(
        mime_type.as_str(),
        "application/json"
            | "application/ld+json"
            | "application/xml"
            | "application/x-yaml"
            | "application/yaml"
    ) {
        return true;
    }
    path_extension(&attachment.name)
        .map(|extension| DEKI_TEXT_ATTACHMENT_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or(false)
}

fn path_extension(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

fn truncate_to_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    let was_truncated = chars.next().is_some();
    (truncated, was_truncated)
}

pub(super) fn looks_like_chat_context_question(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let explicit_chat_context = [
        "chat history",
        "conversation history",
        "message history",
        "approved chat context",
        "previous chat",
        "previous chats",
        "past chat",
        "past chats",
        "our chat",
        "our chats",
        "our conversation",
        "our conversations",
        "our roleplay",
        "our rp",
        "my roleplay",
        "my rp",
        "my interactions",
        "our interactions",
        "past interactions",
        "previous interactions",
        "interactions with",
        "how we interacted",
        "how i interacted",
        "how we talk",
        "how i talk",
        "the way we talk",
        "what we talked",
        "what happened in chat",
        "what happened in rp",
        "what happened in roleplay",
    ];
    if explicit_chat_context
        .iter()
        .any(|needle| lower.contains(needle))
    {
        return true;
    }

    let asks_for_user_evidence = ["based on", "draw from", "using", "use", "reflect", "match"]
        .iter()
        .any(|needle| lower.contains(needle));
    let mentions_prior_interaction = [
        "my chats",
        "our chats",
        "messages",
        "roleplay",
        "rp",
        "interactions",
        "interacted",
        "talked",
        "said",
        "relationship",
        "dynamic",
    ]
    .iter()
    .any(|needle| lower.contains(needle));
    let targets_creative_item = [
        "character",
        "persona",
        "card",
        "dialogue",
        "example",
        "profile",
        "lorebook",
        "prompt",
        "preset",
    ]
    .iter()
    .any(|needle| lower.contains(needle));

    asks_for_user_evidence && mentions_prior_interaction && targets_creative_item
}

pub(super) fn looks_like_codebase_question(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "agent",
        "agents",
        "architecture",
        "bug",
        "code",
        "codebase",
        "component",
        "custom agent",
        "edit",
        "engine",
        "extension",
        "feature",
        "file",
        "how does",
        "implement",
        "marinara",
        "repo",
        "rust",
        "source",
        "src/",
        "tauri",
        "ui",
        "where",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}
