// ──────────────────────────────────────────────
// Chat & Message Types
// ──────────────────────────────────────────────

import type { GenerationGuideSource } from "../../shared/text/generation-guide.js";
import type { GenerationEvent, LegacyStreamProtocolEvent } from "./generation.js";
import type { LorebookActivationTrace } from "./lorebook.js";

/** The primary chat modes the engine supports. */
export type ChatMode = "conversation" | "roleplay" | "game";
/** Legacy persisted/imported mode name. New inputs should migrate this to "roleplay". */
export type LegacyChatMode = "visual_novel";
export type SpotifySourceType = "liked" | "playlist" | "artist" | "any";

/** How a multi-character (group) chat is handled. */
export type GroupChatMode = "merged" | "individual";

/** How individual-mode group chats decide response order. */
export type GroupResponseOrder = "sequential" | "smart" | "manual";

/** Role of a message in the conversation. */
export type MessageRole = "user" | "assistant" | "system" | "narrator";

/** Which side sprite sidebars / default sprite layouts prefer. */
export type SpriteSide = "left" | "right";

/** A saved on-screen sprite anchor position within the chat area. */
export interface SpritePlacement {
  /** Horizontal anchor percentage within the chat stage. */
  x: number;
  /** Vertical anchor percentage within the chat stage. */
  y: number;
}

/** A single chat conversation. */
export interface Chat {
  id: string;
  name: string;
  mode: ChatMode;
  characterIds: string[];
  /** Groups related chats together (like ST "chat files" per character) */
  groupId: string | null;
  personaId: string | null;
  promptPresetId: string | null;
  connectionId: string | null;
  /** ID of a linked chat (conversation ↔ roleplay bidirectional link) */
  connectedChatId: string | null;
  /** Folder this chat belongs to (null = root/unfiled) */
  folderId: string | null;
  /** Manual sort order within a folder (lower = higher). 0 = use default updatedAt sort. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  metadata: ChatMetadata;
  /** Embedded Memory Recall rows stored on the chat. Includes transcript chunks plus preserved imported/command rows. */
  memories?: ChatMemoryChunk[];
}

/** A folder for organising chats in the sidebar. */
export interface ChatFolder {
  id: string;
  name: string;
  mode: ChatMode;
  color: string;
  sortOrder: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A single day's auto-generated conversation summary. */
export interface DaySummaryEntry {
  /** Narrative recap of the day. */
  summary: string;
  /** Short strings the characters must remember going forward. */
  keyDetails: string[];
}

/** A single week's consolidated conversation summary (Monday → Sunday). */
export interface WeekSummaryEntry {
  /** Narrative recap of the week. */
  summary: string;
  /** Consolidated key details the characters must remember going forward. */
  keyDetails: string[];
}

/** A chat-scoped prompt template used by manual rolling summary generation. */
export interface ChatSummaryPromptTemplate {
  id: string;
  name: string;
  prompt: string;
}

/** Rolling summary entry category. Extensible beyond rolling summaries later. */
export type ChatSummaryEntryKind = "rolling";

/** Whether a rolling summary entry was user-created, agent-created, or preserved from legacy metadata. */
export type ChatSummaryEntryOrigin = "manual" | "automated" | "legacy";

/** Source selector used to create a rolling summary entry. */
export type ChatSummaryEntrySource = "all" | "last" | "range" | "agent";

/** A single structured rolling chat summary entry. */
export interface ChatSummaryEntry {
  id: string;
  kind: ChatSummaryEntryKind;
  origin: ChatSummaryEntryOrigin;
  title: string;
  content: string;
  enabled: boolean;
  sourceMode: ChatSummaryEntrySource;
  messageCount?: number;
  rangeStartIndex?: number;
  rangeEndIndex?: number;
  messageIds?: string[];
  promptTemplateId?: string | null;
  tokenEstimate: number;
  createdAt: string;
  updatedAt: string;
}

export type ChatMemoryKind =
  | "episode"
  | "transcript"
  | "manual"
  | "imported"
  | "command"
  | "character"
  | "scene_event"
  | "scene_summary"
  | "summary"
  | "correction";

export type ChatMemoryScopeType = "chat" | "character" | "scene";

export type ChatMemoryStatus = "active" | "deleted" | "wrong" | "superseded";

/** A vectorized recall fragment created from one chat's messages. */
export interface ChatMemoryChunk {
  id: string;
  chatId: string;
  content: string;
  canonicalMemoryVersion?: number;
  memoryKind?: ChatMemoryKind;

  scopeType?: ChatMemoryScopeType;
  scopeId?: string | null;
  legacySourceLane?: string | null;
  legacySourceId?: string | null;
  migratedAt?: string | null;
  sceneChatId?: string | null;
  status?: ChatMemoryStatus;
  pinned?: boolean;
  userEdited?: boolean;
  correctedByMemoryId?: string | null;
  correctionOfMemoryId?: string | null;
  deletedAt?: string | null;
  restoredAt?: string | null;
  correctedAt?: string | null;
  supersededAt?: string | null;
  supersededByMemoryId?: string | null;
  lastRecalledAt?: string | null;
  lastUsedAt?: string | null;
  recallCount?: number;
  confidence?: number | null;
  creationReason?: string | null;
  messageCount: number;
  /** Message ids covered by transcript-owned chunks. Imported and command rows may omit this or store an empty array. */
  messageIds?: string[];
  firstMessageId?: string | null;
  lastMessageId?: string | null;
  firstMessageAt: string;
  lastMessageAt: string;
  createdAt: string;
  /** Non-transcript source marker, such as connected command memory. */
  source?: string;
  /** Original chat for imported recall rows or command memories. */
  sourceChatId?: string | null;
  /** Stable dedupe key for `[memory:]` connected command rows. */
  commandMemoryKey?: string;
  target?: string;
  targetCharacterName?: string;
  targetCharacterId?: string | null;
  /** True when the chunk has either provider semantic embeddings or the local lexical fallback vector. */
  hasEmbedding: boolean;
  /** Recall vector used by the prompt assembler. May be provider semantic embeddings or local lexical fallback. */
  embedding?: number[] | null;
  /** Current vectorization state for display. */
  embeddingStatus?: "vectorized" | "pending" | "missing" | "unavailable";
  /** `provider` when semantic embeddings were generated by a configured connection; `lexical` for local fallback. */
  embeddingSource?: "provider" | "lexical" | string;
  embeddingConnectionId?: string | null;
  embeddingModel?: string | null;
}

type MemoryRecallMetadata = Partial<Pick<ChatMetadata, "enableMemoryRecall" | "sceneStatus">>;

/** Shared default for chat-local Memory Recall across UI, prompt assembly, and capture. */
export function getEffectiveMemoryRecallEnabled(
  chatMode: ChatMode | LegacyChatMode | string | null | undefined,
  metadata: MemoryRecallMetadata | null | undefined,
): boolean {
  if (typeof metadata?.enableMemoryRecall === "boolean") return metadata.enableMemoryRecall;
  if (chatMode === "conversation" || chatMode === "roleplay" || chatMode === "visual_novel") return true;
  return metadata?.sceneStatus === "active";
}

/** Extra metadata stored on a chat. */
export interface ChatMetadata {
  /** Lets characters ask for turn-scoped permission to research the public web. */
  characterWebAccessEnabled?: boolean;
  /**
   * Chat-mode consent policy. Missing or `"ask"` requests approval each time;
   * `"always"` automatically mints and clears a fresh exact-query grant for each requested search.
   */
  characterWebResearchPolicy?: "ask" | "always";
  /** Whether intermediate character web-research narration is hidden or shown. Missing defaults to quiet. */
  characterWebResearchPresentation?: "quiet" | "visible";
  /** Exact-query grant consumed by the next regenerated character turn. */
  characterWebResearchGrant?: CharacterWebResearchGrant | null;
  /** Optional language-generation connection used for foreground turns that include image attachments. */
  visionConnectionId?: string | null;
  /** Compiled enabled rolling summary text for context injection. */
  summary: string | null;
  /** Structured rolling summary entries. */
  summaryEntries?: ChatSummaryEntry[];
  /** Recent message count used by manual rolling summary generation and the automated summary agent. */
  summaryContextSize?: number;
  /** Chat-scoped manual summary prompt templates. Missing or empty uses the built-in default. */
  summaryPromptTemplates?: ChatSummaryPromptTemplate[];
  /** Selected manual summary prompt template ID. Null/omitted uses the built-in default. */
  activeSummaryPromptTemplateId?: string | null;
  /** Custom tags for organisation */
  tags: string[];
  /** When true, this chat is pinned to the top of the sidebar for its mode. */
  pinned?: boolean;
  /** Per-agent enable overrides (agentId → boolean) */
  agentOverrides: Record<string, boolean>;
  /** Legacy/global agent gate. False preserves disabled imported agent selections without running them. */
  enableAgents?: boolean;
  /** Agent IDs scoped to this chat. Only these agents run automatically; empty = no automatic agents. */
  activeAgentIds: string[];
  /** Explicit target lorebook for the Lorebook Keeper in this chat. Null/omitted = use a scoped active lorebook when available. */
  lorebookKeeperTargetLorebookId?: string | null;
  /** How many assistant responses behind the latest available one Lorebook Keeper should read from. */
  lorebookKeeperReadBehindMessages?: number;
  /** When true/omitted, Lorebook Keeper proposals wait for approve/reject instead of writing immediately. */
  lorebookKeeperReviewRequired?: boolean;
  /** Tool/function IDs scoped to this chat when toolSelectionMode is explicit. */
  activeToolIds: string[];
  /** Explicit selection is opt-in; missing preserves the legacy all-tools behavior. */
  toolSelectionMode?: "explicit" | "all";
  /** Per-chat variable selections for preset variables (variableName → value or values) */
  presetChoices: Record<string, string | string[]>;
  /** Chat-wide string variables persisted by agent tool calls (key → value). */
  agentVariables?: Record<string, string>;
  /** Group chat mode: "merged" (narrator) or "individual" (separate characters) */
  groupChatMode?: GroupChatMode;
  /** Group individual mode: prefix prompt history turns with speaker names. */
  groupSpeakerNamesInHistory?: boolean;
  /** Group individual mode response order: "smart" (default), "sequential", or "manual". */
  groupResponseOrder?: GroupResponseOrder;
  /** Character IDs attached to this chat but muted/excluded from generation. */
  inactiveCharacterIds?: string[];
  /** When true/omitted, individual group turns append a responding-character instruction to the prompt. */
  groupTurnPromptEnabled?: boolean;
  /** Characters with visible roleplay sprites enabled for this chat. */
  spriteCharacterIds?: string[];
  /** Which sprite file families the roleplay Expression Engine may display. */
  spriteDisplayModes?: Array<"expressions" | "full-body">;
  /** Whether roleplay expression avatars are enabled for this chat. */
  expressionAvatarsEnabled?: boolean;
  /** Preferred sidebar / default layout side for chat sprites. */
  spritePosition?: SpriteSide;
  /** Display scale for roleplay Expression Engine sprites. */
  spriteScale?: number;
  /** Display opacity for roleplay Expression Engine sprites. */
  spriteOpacity?: number;
  /** Saved freeform positions for enabled roleplay sprites. */
  spritePlacements?: Record<string, SpritePlacement>;
  /** When true, a shared group scenario replaces individual character card scenarios */
  groupScenarioOverride?: boolean;
  /** The shared scenario text used when groupScenarioOverride is enabled */
  groupScenarioText?: string;
  /** When true, show the Secret Plot tab in the roleplay Agents menu (edits apply to agent memory, same as generation). */
  showSecretPlotPanel?: boolean;
  /** When true, show the Injections tab in the roleplay Agents menu for cached prompt injections. */
  showInjectionsPanel?: boolean;
  /** When true, tracker agents only run when the user manually triggers them (not after every generation) */
  manualTrackers?: boolean;
  /** Whether to recall memories from this chat during generation. Default: true for conversation/roleplay/active scenes. */
  enableMemoryRecall?: boolean;
  /** Whether canonical durable memories are retrieved into generation prompts. Default: false. */
  enableCanonicalMemoryRecall?: boolean;
  /** Optional token budget for canonical memory prompt context. Missing uses a bounded context-share default. */
  canonicalMemoryRecallTokenBudget?: number | null;
  /** How many newest visible messages Memory Recall should ignore when selecting recalled chunks. Default: 1. */
  memoryRecallReadBehindMessages?: number;
  /** Discord webhook URL to mirror messages to a Discord channel. */
  discordWebhookUrl?: string;
  /** Per-chat ephemeral / enabled overrides for lorebook entries (entryId → state).
   *  Tracked per-chat so ephemeral countdown in one chat doesn't affect others. */
  entryStateOverrides?: Record<string, { ephemeral?: number | null; enabled?: boolean }>;
  /** Per-chat sticky/cooldown/delay runtime state for lorebook entries. */
  entryTimingStates?: Record<string, import("./lorebook.js").LorebookEntryTimingState>;
  /** Per-chat global lorebook token budget. Missing uses app default; 0 means unlimited. */
  lorebookTokenBudget?: number | null;
  /** When true or omitted, stored provider thinking/reasoning is not replayed into future prompts. */
  excludePastReasoning?: boolean;
  /** Show provider-returned reasoning inline beneath character messages. Default: false. */
  showInlineReasoning?: boolean;
  /** ID of the chat preset most recently applied to this chat (drives the preset bar dropdown). */
  appliedChatPresetId?: string | null;
  /** Custom prompt prefix used by the /impersonate slash command. */
  impersonatePrompt?: string | null;
  /** Show a manual draft translation button beside the send control. */
  showInputTranslateButton?: boolean;
  /** Allow roleplay characters to create direct-message conversation chats with hidden [dm] commands. */
  roleplayDmCommandsEnabled?: boolean;
  /** Marks a conversation chat as a roleplay-origin direct-message thread. */
  roleplayDmThread?: boolean;
  /** Roleplay chat that created or owns this direct-message thread. */
  dmOriginChatId?: string | null;
  /** Character targeted by this direct-message thread. */
  dmTargetCharacterId?: string | null;
  /** Per-chat roleplay narration voice/style guidance. */
  narratorStyleInstructions?: string | null;
  /** Music source constraint for Spotify DJ in roleplay and visual novel chats. */
  spotifySourceType?: SpotifySourceType;
  /** Spotify playlist ID used when spotifySourceType is "playlist". */
  spotifyPlaylistId?: string | null;
  /** Human-readable playlist name cached for prompts/display. */
  spotifyPlaylistName?: string | null;
  /** Spotify artist name used when spotifySourceType is "artist". */
  spotifyArtist?: string | null;
  /** Recently selected Spotify track URIs for roleplay/conversation Spotify DJ de-duplication. */
  spotifyRecentTracks?: string[];
  /** Durable count of autonomous messages the user has not viewed yet. */
  autonomousUnreadCount?: number;
  /** Character IDs that contributed to the current autonomous unread state. */
  autonomousUnreadCharacterIds?: string[];
  /** Timestamp of the newest autonomous unread message. */
  autonomousUnreadAt?: string | null;

  // ── Conversation Mode Fields ──
  /** Whether conversation character schedules are enabled for this chat. */
  conversationSchedulesEnabled?: boolean;
  /** Allow conversation characters to use hidden command tags. Default: true. */
  characterCommands?: boolean;
  /** Chat-scoped generated schedules for conversation characters. */
  characterSchedules?: Record<string, unknown>;
  /** Week start timestamp for the current generated conversation schedules. */
  scheduleWeekStart?: string;
  /** Chat-scoped conversation-mode system prompt. Empty/null uses the built-in conversation prompt. */
  customSystemPrompt?: string | null;
  /** Chat-scoped selfie prompt-builder template. Empty/null uses the global/default prompt. */
  selfiePrompt?: string | null;
  /** Extra positive prompt/tags appended to generated conversation selfie prompts. */
  selfiePositivePrompt?: string;
  /** Extra negative prompt/tags sent with generated conversation selfies. */
  selfieNegativePrompt?: string;

  // ── Game Mode Fields ──
  /** UUID linking all sessions of one game */
  gameId?: string;
  /** Session number within a game (1-based) */
  gameSessionNumber?: number;
  /** Current session lifecycle status */
  gameSessionStatus?: import("./game.js").GameSessionStatus;
  /** Whether the first game intro screen has been dismissed for this game chat. */
  gameIntroPresented?: boolean;
  /** Timestamp for when the current game session was created/started */
  gameCurrentSessionStartedAt?: string;
  /** Current game state (exploration, dialogue, combat, travel_rest) */
  gameActiveState?: import("./game.js").GameActiveState;
  /** Whether GM is a standalone narrator or an existing character */
  gameGmMode?: import("./game.js").GameGmMode;
  /** Character ID used as GM (when gameGmMode is "character") */
  gameGmCharacterId?: string;
  /** Party member IDs for the player's party; library character IDs or `npc:<slug>` tracked-NPC IDs. */
  gamePartyCharacterIds?: string[];
  /** ID of the linked party chat */
  gamePartyChatId?: string;
  /** Current area map */
  gameMap?: import("./game.js").GameMap | null;
  /** All generated/known maps for this game session/campaign. */
  gameMaps?: import("./game.js").GameMap[];
  /** ID of the map the party is currently on. */
  activeGameMapId?: string | null;
  /** Summaries of all previous sessions */
  gamePreviousSessionSummaries?: import("./game.js").SessionSummary[];
  /** GM-only: overarching story arc and plot (never sent to party agent) */
  gameStoryArc?: string;
  /** GM-only: planned plot twists (never sent to party agent) */
  gamePlotTwists?: string[];
  /** Active dialogue sub-scene chat ID */
  gameDialogueChatId?: string | null;
  /** Active combat sub-scene chat ID */
  gameCombatChatId?: string | null;
  /** Live combat encounter snapshot — restored on page refresh while a fight is in progress. */
  gameCombatState?: import("./game.js").GameCombatStateSnapshot | null;
  /** User's initial game setup preferences */
  gameSetupConfig?: import("./game.js").GameSetupConfig | null;
  /** Image style profile chosen for this game chat. Missing uses setup config or global default profile. */
  imageStyleProfileId?: string | null;
  /** Tracked NPCs with reputation */
  gameNpcs?: import("./game.js").GameNpc[];
  /** Current-session turn number when the last rare generated scene illustration was created. */
  gameLastIllustrationTurn?: number;
  /** Session number where the last rare generated scene illustration was created. */
  gameLastIllustrationSessionNumber?: number | null;
  /** Background tag for the last rare generated scene illustration. */
  gameLastIllustrationTag?: string;
  /** Extra user instructions for game scene illustration prompts. */
  gameImagePromptInstructions?: string | null;
  /** Per-game asset browser folder exclusions. Omitted/null means every asset folder is available. */
  gameAssetSelection?: { excludedFolders?: string[] } | null;
  /** When true, Game Mode uses Music Player for music instead of local music assets. */
  gameUseMusicDj?: boolean;
  /** Default Music Player provider for Game Mode. */
  gameMusicProvider?: "youtube" | "spotify" | "local" | string;
  /** Recently selected provider-neutral music track IDs for Game Mode scene music de-duplication. */
  gameRecentMusicTracks?: string[];
  /** When true, Game Mode uses legacy Spotify DJ for music instead of local music assets. */
  gameUseSpotifyMusic?: boolean;
  /** Music source constraint for Spotify DJ in Game Mode. */
  gameSpotifySourceType?: SpotifySourceType;
  /** Spotify playlist ID used when gameSpotifySourceType is "playlist". */
  gameSpotifyPlaylistId?: string | null;
  /** Human-readable playlist name cached for prompts/display. */
  gameSpotifyPlaylistName?: string | null;
  /** Spotify artist name used when gameSpotifySourceType is "artist". */
  gameSpotifyArtist?: string | null;
  /** Recently selected Spotify track URIs for Game Mode scene music de-duplication. */
  gameRecentSpotifyTracks?: string[];
  /** Run Game Lorebook Keeper after a session is concluded. */
  gameLorebookKeeperEnabled?: boolean;
  /** Chat-scoped lorebook maintained by Game Lorebook Keeper. */
  gameLorebookKeeperLorebookId?: string | null;
  /** Status of the most recent Game Lorebook Keeper session-end run. */
  gameLorebookKeeperLastRun?: {
    sessionNumber: number;
    status: "running" | "success" | "failed";
    updatedAt: string;
    lorebookId?: string | null;
    entryCount?: number;
    error?: string;
  } | null;

  // ── Conversation-Mode Auto-Summarization ──
  /** Per-day auto-generated conversation summaries (key: "DD.MM.YYYY"). */
  daySummaries?: Record<string, DaySummaryEntry>;
  /** Per-week consolidated conversation summaries (key: Monday "DD.MM.YYYY"). */
  weekSummaries?: Record<string, WeekSummaryEntry>;
  /**
   * Hour of day (0-11, local time) at which a conversation "day" rolls over for
   * summarization. Messages sent before this hour are filed under the previous
   * day, so a late-night session isn't cut off mid-conversation. Default: 4.
   */
  dayRolloverHour?: number;
  /**
   * How many of the most recent messages to keep verbatim in the prompt even
   * after they've been summarized. Bridges the day boundary so characters can
   * pick up the actual flow of recent conversation, not just the gist. 0 disables.
   * Valid range: 0-50. Default: 10.
   */
  summaryTailMessages?: number;

  /** How character-scoped regex scripts are applied: "disabled" | "exclusive" | "chat" (default). */
  scopedRegexMode?: "disabled" | "exclusive" | "chat";

  // ── Card Theming ──
  /** How creator-notes CSS is applied: "disabled" | "exclusive" | "chat" (default). */
  cardCssMode?: "disabled" | "exclusive" | "chat";

  /** Any extra key-value data */
  [key: string]: unknown;
}

/** A single message within a chat. */
export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  /** Which character sent this (null for user messages / narration) */
  characterId: string | null;
  content: string;
  /** Index into the swipes array for the currently displayed alternative */
  activeSwipeIndex: number;
  /** Number of swipes for this message (0 or 1 = no alternatives) */
  swipeCount?: number;
  /** Server-side SQLite row position used only for stable pagination cursors */
  rowid?: number;
  createdAt: string;
  /** Extra display data */
  extra: MessageExtra;
}

export type MessageAttachmentExtraValue = string | number | boolean | null | undefined;

/** Persisted attachment rendered with a message or carried into generation. */
export interface MessageAttachment {
  type?: string | null;
  url?: string | null;
  data?: string | null;
  imageUrl?: string | null;
  filePath?: string | null;
  filename?: string | null;
  name?: string | null;
  prompt?: string | null;
  galleryId?: string | null;
  [key: string]: MessageAttachmentExtraValue;
}

export interface MessageMemoryCaptureExtra {
  status: "completed";
  jobId: string;
  sourceMessageIds: string[];
  completedAt: string;
  capture?: {
    operation: "created" | "updated";
    memory: { id: string; content: string };
  };
}
/** Additional data attached to a message. */
export interface MessageExtra {
  /** A character's pending or resolved request to research an exact web query. */
  characterWebResearchRequest?: CharacterWebResearchRequest | null;
  /** Public sources used during an approved research turn. */
  characterWebResearchSources?: Array<{ title: string; url: string }> | null;
  /** Display-formatted text (may differ from raw content) */
  displayText: string | null;
  /** Whether this message was generated by the AI vs typed by user */
  isGenerated: boolean;
  /** Token count of this message */
  tokenCount: number | null;
  /** Generation metadata */
  generationInfo: GenerationInfo | null;
  /** When true, this message marks the "new start" of the conversation — all earlier messages are excluded from context */
  isConversationStart?: boolean;
  /** Model's reasoning/thinking content (if available) */
  thinking?: string | null;
  /** Provider-shaped reasoning content from OpenAI-compatible responses. */
  reasoning?: string | null;
  /** Provider-shaped reasoning content from OpenAI-compatible streaming deltas. */
  reasoning_content?: string | null;
  /** User-provided or generated attachments rendered with the message. */
  attachments?: MessageAttachment[] | null;
  memoryCapture?: MessageMemoryCaptureExtra | null;
  /** Per-swipe sprite expressions from the Expression Engine agent */
  spriteExpressions?: Record<string, string> | null;
  /** Per-swipe CYOA choices from the CYOA Choices agent */
  cyoaChoices?: Array<{ label: string; text: string }> | null;
  /** Snapshot of the persona that was active when this message was sent (user messages only) */
  personaSnapshot?: {
    personaId: string;
    name: string;
    description?: string | null;
    personality?: string | null;
    backstory?: string | null;
    appearance?: string | null;
    scenario?: string | null;
    avatarUrl?: string | null;
    avatarFilePath?: string | null;
    avatarFilename?: string | null;
    /** JSON-encoded AvatarCrop captured at send time so re-edits don't restyle past messages. */
    avatarCrop?: string | null;
    nameColor?: string | null;
    dialogueColor?: string | null;
    boxColor?: string | null;
  } | null;
  /** Stored for generation context but hidden from the visible chat transcript */
  hiddenFromUser?: boolean;
  /** When true, the visible message is excluded from future AI prompt context */
  hiddenFromAI?: boolean;
  /**
   * Cached pipeline injections (prose-guardian, director, knowledge-retrieval, etc.)
   * saved with this assistant message — reused when regenerating that swipe unless refreshed.
   */
  contextInjections?: Array<{ agentType: string; agentName?: string; text: string }> | null;
  /** Fingerprint of the chat summary text used in the generation prompt. */
  chatSummaryFingerprint?: string | null;
  /**
   * Hidden command-generation options needed to make swipes/regenerations replay
   * the same slash-command or guided-regenerate prompt behavior.
   */
  generationReplay?: {
    impersonate?: true;
    userMessage?: string | null;
    generationGuide?: string | null;
    generationGuideSource?: GenerationGuideSource | null;
    impersonatePresetId?: string | null;
    impersonateConnectionId?: string | null;
    impersonateBlockAgents?: boolean;
    impersonatePromptTemplate?: string | null;
  } | null;
  /** Exact main-generation LLM request saved for Peek Prompt on the active response. */
  generationPromptSnapshot?: GenerationPromptSnapshot | null;
  /** @deprecated Legacy input only. Prompt snapshots now live on swipes[index].extra. */
  generationPromptSnapshotsBySwipe?: Record<string, GenerationPromptSnapshot>;
}

export interface CharacterWebResearchGrant {
  id: string;
  query: string;
  allowedDomains: string[];
  requestMessageId: string;
  grantedAt: string;
  expiresAt: string;
}

export interface CharacterWebResearchRequest {
  query: string;
  reason: string;
  allowedDomains: string[];
  status?: "pending" | "approved" | "declined";
}

/** Metadata about how a message was generated. */
export interface GenerationInfo {
  model: string;
  provider: string;
  temperature: number | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensCachedPrompt?: number | null;
  tokensCacheWritePrompt?: number | null;
  durationMs: number | null;
  finishReason: string | null;
  /** Normalized usage for the complete turn, including agent calls. */
  turnUsage?: GenerationTurnUsage | null;
}

export interface NormalizedTokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  cachedPromptTokens: number | null;
  cacheWritePromptTokens: number | null;
  totalTokens: number | null;
}

export interface GenerationTurnUsage {
  main: NormalizedTokenUsage;
  agents: { totalTokens: number; resultCount: number };
  totalTokens: number | null;
}

export interface GenerationPromptSnapshotMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  images?: string[];
  tool_call_id?: string;
  tool_calls?: unknown;
  [key: string]: unknown;
}

export interface GenerationPromptSnapshotInfo {
  model?: string;
  provider?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  topK?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  showThoughts?: boolean | null;
  reasoningEffort?: string | null;
  verbosity?: string | null;
  serviceTier?: string | null;
  assistantPrefill?: string | null;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  tokensCachedPrompt?: number | null;
  tokensCacheWritePrompt?: number | null;
  durationMs?: number | null;
  finishReason?: string | null;
}

export type GenerationContextAttributionSource = "saved_snapshot" | "best_effort_reconstruction";

export type GenerationContextAttributionKind =
  | "chat_history"
  | "chat_summary"
  | "memory_recall"
  | "lorebook"
  | "knowledge_retrieval"
  | "knowledge_router"
  | "agent_injection";

export type GenerationContextAttributionStatus = "considered" | "injected" | "redacted" | "skipped";

export interface GenerationContextAttributionItem {
  kind: GenerationContextAttributionKind;
  label: string;
  status: GenerationContextAttributionStatus;
  sourceId?: string | null;
  sourceCollection?: string | null;
  parentSourceId?: string | null;
  snippet?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface GenerationContextAttribution {
  source: GenerationContextAttributionSource;
  items: GenerationContextAttributionItem[];
}
export interface GenerationPromptSnapshot {
  messages: GenerationPromptSnapshotMessage[];
  previewMessages?: GenerationPromptSnapshotMessage[];
  parameters: Record<string, unknown>;
  tools?: unknown[] | null;
  generationInfo?: GenerationPromptSnapshotInfo | null;
  promptPresetId?: string | null;
  lorebookActivationTrace?: LorebookActivationTrace;
  contextAttribution?: GenerationContextAttribution | null;
  contextFitDecision?: {
    removedMessages: Array<{ contextKind: string; displayName?: string; estimatedTokens: number }>;
    truncatedMessages: Array<{ contextKind: string; removedEstimatedTokens: number }>;
    originalEstimatedTokens: number;
    fittedEstimatedTokens: number;
    inputBudgetTokens: number;
  } | null;
  createdAt?: string;
}

export type MessageSwipeExtra = Partial<MessageExtra> & Record<string, unknown>;

/** A swipe (alternate response) for a message. */
export interface MessageSwipe {
  id: string;
  messageId: string;
  index: number;
  content: string;
  characterId?: string | null;
  createdAt: string;
  extra?: MessageSwipeExtra;
}

/** Payload sent to start a generation. */
export interface GenerateRequest {
  chatId: string;
  userMessage: string | null;
  /** If set, regenerate the message at this ID */
  regenerateMessageId: string | null;
  /** Override connection for this generation */
  connectionId: string | null;
}

/** An SSE event from the active generation stream. */
export type StreamEvent = GenerationEvent | LegacyStreamProtocolEvent;

/** An OOC influence queued from a conversation chat to be injected into a roleplay chat. */
export interface OocInfluence {
  id: string;
  sourceChatId: string;
  targetChatId: string;
  content: string;
  anchorMessageId: string;
  consumed: boolean;
  createdAt: string;
}

/** A durable note emitted from a conversation chat that persists in the connected roleplay's prompt until cleared. */
export interface ConversationNote {
  id: string;
  sourceChatId: string;
  targetChatId: string;
  content: string;
  anchorMessageId: string;
  createdAt: string;
}
