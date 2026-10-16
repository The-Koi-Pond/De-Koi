// ──────────────────────────────────────────────
// Lorebook / World Info Types
// ──────────────────────────────────────────────

/** Top-level lorebook categories. */
export type LorebookCategory = "world" | "character" | "npc" | "spellbook" | "uncategorized";

/**
 * How secondary keys gate an entry, matching SillyTavern's four modes:
 * "and" = AND ANY (default), "and_all" = AND ALL, "not" = NOT ANY, "not_all" = NOT ALL.
 * "or" is an older alias of AND ANY.
 */
export type SelectiveLogic = "and" | "and_all" | "or" | "not" | "not_all";

/** Role for injected lorebook content. */
export type LorebookRole = "system" | "user" | "assistant";

/** Include/exclude behavior for contextual lorebook filters. */
export type LorebookFilterMode = "any" | "include" | "exclude";

/** Legacy top-level lorebook scope gate. */
export type LorebookScopeMode = "all" | "disabled" | "specific";

export interface LorebookScope {
  mode: LorebookScopeMode;
  chatIds: string[];
}

/** Extra places an entry can scan for keyword matches beyond recent chat text. */
export type LorebookMatchingSource =
  | "character_name"
  | "character_description"
  | "character_personality"
  | "character_scenario"
  | "character_tags"
  | "persona_description"
  | "persona_tags";

/** A complete lorebook (collection of entries). */
export interface Lorebook {
  id: string;
  name: string;
  description: string;
  /** Top-level category this lorebook belongs to */
  category: LorebookCategory;
  /** Optional picture displayed for this lorebook in the library UI */
  imagePath: string | null;
  /** Default scan depth for entries that don't override */
  scanDepth: number;
  /** Max output tokens allocated to this lorebook */
  tokenBudget: number;
  /**
   * Enables recursive scanning for the active lorebook set. Once any active
   * lorebook enables recursion, selected entries from all active lorebooks can
   * seed later passes unless the entry has preventRecursion.
   */
  recursiveScanning: boolean;
  /** Maximum recursion depth this lorebook contributes when it enables recursive scanning. */
  maxRecursionDepth: number;
  /** ID of the character this lorebook is linked to (character books) */
  characterId: string | null;
  /** IDs of characters this lorebook is linked to */
  characterIds: string[];
  /** ID of the persona this lorebook is linked to (persona books) */
  personaId: string | null;
  /** IDs of personas this lorebook is linked to */
  personaIds: string[];
  /** ID of the chat this lorebook is scoped to (if any) */
  chatId: string | null;
  /** Legacy-compatible top-level lorebook scope gate */
  scope: LorebookScope;
  /** Whether this lorebook bypasses character/persona/chat scope filters */
  isGlobal: boolean;
  /** Master on/off switch for this lorebook */
  enabled: boolean;
  /** When true, semantic vectorization and semantic matching skip every entry. Keyword matching still works. */
  excludeFromVectorization: boolean;
  /** Tags for organizing/filtering lorebooks */
  tags: string[];
  /** Library folder this lorebook belongs to (null = root/unfiled). */
  folderId: string | null;
  /** Agent/generation origin tracking */
  generatedBy: "user" | "agent" | "import" | "lorebook-maker" | "game-session" | null;
  sourceAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A collapsible container that groups lorebook entries to reduce visual
 * clutter in the editor. Folders may nest: `parentFolderId` points at a parent
 * folder in the same lorebook (null = top level).
 *
 * Folder enable/disable acts as a gate: when a folder OR any of its ancestors
 * is disabled, every entry inside is treated as inactive at activation time,
 * regardless of the entry's own `enabled` flag. The entry's own flag is
 * preserved (the folder toggle does NOT mutate it), so re-enabling restores the
 * entries' previous individual settings.
 *
 * Folders sit above root-level entries in the editor display. Folder display
 * order among siblings is controlled by `order`. Entry `order` continues to
 * control prompt-injection priority and per-container display sort.
 */
export interface LorebookFolder {
  id: string;
  lorebookId: string;
  /** Display name shown on the folder header row. */
  name: string;
  /**
   * When false, every entry under this folder is skipped during activation —
   * including entries in enabled subfolders — regardless of the entry's own
   * `enabled` flag.
   */
  enabled: boolean;
  /**
   * Parent folder for nesting, or null for a top-level folder. Must reference a
   * folder in the same lorebook; self-parenting and cycles are rejected at
   * write time.
   */
  parentFolderId: string | null;
  /** Display order among sibling folders (lower = higher in the list). */
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** A single lorebook entry. */
export interface LorebookEntry {
  id: string;
  lorebookId: string;
  /** Display name */
  name: string;
  /** The actual content injected into the prompt */
  content: string;
  /** Short summary used by the knowledge-router agent to decide if this entry is relevant */
  description: string;
  /** Chat id captured when this entry was drafted from a Save Moment action. */
  sourceChatId?: string | null;
  /** Message id captured when this entry was drafted from a Save Moment action. */
  sourceMessageId?: string | null;
  /** Primary trigger keywords (supports regex) */
  keys: string[];
  /** Secondary / optional keywords */
  secondaryKeys: string[];

  // ── Activation settings ──
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  selectiveLogic: SelectiveLogic;
  probability: number | null;
  /** How far back in chat to scan for matches */
  scanDepth: number | null;
  matchWholeWords: boolean;
  caseSensitive: boolean;
  /** Use regex matching for keys */
  useRegex: boolean;
  /**
   * Character gates for activation. These are independent from lorebook tags,
   * which are only organizational.
   */
  characterFilterMode: LorebookFilterMode;
  characterFilterIds: string[];
  /** Character-card tag gates for activation. */
  characterTagFilterMode: LorebookFilterMode;
  characterTagFilters: string[];
  /** Generation trigger gates (chat, game, swipe, lorebook_assistant, etc.). */
  generationTriggerFilterMode: LorebookFilterMode;
  generationTriggerFilters: string[];
  /** Additional non-chat sources to include when matching entry keywords. */
  additionalMatchingSources: LorebookMatchingSource[];

  // ── Injection settings ──
  /** 0 = before character, 1 = after character, 2 = inject at message depth */
  position: number;
  /** Insertion depth in the message array */
  depth: number;
  /** Insertion priority (lower = earlier) */
  order: number;
  role: LorebookRole;

  // ── Timing ──
  /** Keep active for N messages after trigger */
  sticky: number | null;
  /** Wait N messages between activations */
  cooldown: number | null;
  /** Delay N messages before first activation */
  delay: number | null;
  /** Activations remaining before auto-disable (null = unlimited) */
  ephemeral: number | null;

  // ── Grouping ──
  /**
   * Inclusion groups, comma-separated. When several entries in one group fire, only one is
   * kept: a random pick weighted by `groupWeight`, unless one of them has `groupOverride`.
   */
  group: string;
  /** Chance of winning a group pick relative to the others (default 100). */
  groupWeight: number | null;
  /** Wins its group pick by highest `order` instead of by weight (SillyTavern "Prioritize Inclusion"). */
  groupOverride: boolean;
  /** Only the group's entries that matched the most keys compete (SillyTavern "Group Scoring"). */
  useGroupScoring: boolean;
  /**
   * ID of the folder this entry belongs to, or null if it lives at the
   * lorebook root level. Display sort by `order` is per-container — entries
   * inside a folder sort independently from root entries and from entries in
   * other folders. When a folder is disabled, every entry whose `folderId`
   * matches is excluded from activation regardless of `enabled`.
   */
  folderId: string | null;

  // ── Engine extensions (beyond ST) ──
  /** When true, the Lorebook Keeper agent cannot modify or overwrite this entry */
  locked: boolean;
  /** When true, this entry's content won't seed later recursive scanning passes. */
  preventRecursion: boolean;
  /** When true, recursive passes can't activate this entry; only chat text can (SillyTavern "Non-recursable"). */
  excludeRecursion: boolean;
  /** When true, this entry can only activate during a recursive pass (SillyTavern "Delay until recursion"). */
  delayUntilRecursion: boolean;
  /** Sub-category tag for the entry (e.g. "location", "item", "lore", "quest") */
  tag: string;
  /** Relationships to other entries: { entryId: relationshipType } */
  relationships: Record<string, string>;
  /** Dynamic state for quests etc. (arbitrary JSON) */
  dynamicState: Record<string, unknown>;
  /** Game-state conditional activation rules */
  activationConditions: ActivationCondition[];
  /** Schedule: only active during certain in-game times/dates */
  schedule: LorebookSchedule | null;

  /** When true, bulk vectorization skips this entry and semantic matching ignores any stored vector */
  excludeFromVectorization: boolean;
  /** Pre-computed embedding vector for semantic matching (null if not vectorized) */
  embedding: number[] | null;
  /** Embedding model used to generate the stored vector, when known. */
  embeddingModel?: string | null;
  /** Connection used to generate the stored vector, when known. */
  embeddingConnectionId?: string | null;
  /** ISO timestamp for the stored vector, when known. */
  embeddingUpdatedAt?: string | null;

  createdAt: string;
  updatedAt: string;
}

/** A rule for conditional lorebook activation based on game state. */
export interface ActivationCondition {
  /** The game state field to check (e.g. "location", "time_of_day") */
  field: string;
  /** Comparison operator */
  operator: "equals" | "not_equals" | "contains" | "not_contains" | "gt" | "lt";
  /** Value to compare against */
  value: string;
}

/** Schedule for time-based activation. */
export interface LorebookSchedule {
  /** In-game times when active (e.g. ["morning", "evening"]) */
  activeTimes: string[];
  /** In-game dates/seasons when active */
  activeDates: string[];
  /** In-game locations where active */
  activeLocations: string[];
}

/** Per-chat runtime state for sticky/cooldown/delay lorebook entry timing. */
export interface LorebookEntryTimingState {
  /** Message index when this entry was last activated */
  lastActivatedAt: number | null;
  /** Sticky messages remaining after the original activation */
  stickyCount: number;
  /** Messages remaining before this entry may activate again */
  cooldownRemaining: number;
  /** Messages remaining before this entry may first activate */
  delayRemaining: number;
}

export type LorebookActivationTraceStatus = "included" | "matched" | "skipped";

export type LorebookActivationTraceReason =
  | "keyword_match"
  | "constant"
  | "sticky"
  | "semantic_match"
  | "primary_key_miss"
  | "secondary_key_miss"
  | "disabled"
  | "scope_filter"
  | "condition_miss"
  | "schedule_miss"
  | "timing_blocked"
  | "probability_failed"
  | "group_loser"
  | "budget_lorebook"
  | "budget_chat"
  | "budget_both"
  | "folder_disabled"
  | "empty_content"
  | "position_disabled"
  | "recursion_blocked"
  | "recursion_excluded"
  | "recursion_delayed"
  | "unscanned";

export interface LorebookActivationTraceEntry {
  entryId: string;
  lorebookId: string;
  name: string;
  status: LorebookActivationTraceStatus;
  reason: LorebookActivationTraceReason;
  hint: string;
  matchedKeys: string[];
  tokenEstimate: number;
  injection: {
    position: number;
    role: LorebookRole;
    depth: number;
    order: number;
  };
  timing?: LorebookEntryTimingState;
  probability?: {
    configured: number;
    roll: number | null;
    passed: boolean;
  };
  semanticScore?: number;
  recursive?: {
    depth: number;
    preventedByEntry: boolean;
  };
}

export interface LorebookActivationTrace {
  entries: LorebookActivationTraceEntry[];
}

/** Quest-specific fields for quest-type lorebook entries. */
export interface QuestData {
  stages: QuestStage[];
  currentStageIndex: number;
  completed: boolean;
  rewards: string[];
}

/** A single stage/objective in a quest. */
export interface QuestStage {
  name: string;
  description: string;
  objectives: QuestObjective[];
  completionTrigger: string;
}

/** An objective within a quest stage. */
export interface QuestObjective {
  text: string;
  completed: boolean;
}
