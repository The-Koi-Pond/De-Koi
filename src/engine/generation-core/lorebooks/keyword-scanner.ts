import type {
  ActivationCondition,
  LorebookActivationTrace,
  LorebookActivationTraceEntry,
  LorebookActivationTraceReason,
  LorebookActivationTraceStatus,
  LorebookEntry,
  LorebookFilterMode,
  LorebookMatchingSource,
  LorebookSchedule,
} from "../../contracts/types/lorebook";
import { testPrimaryKeysAsync, testSecondaryKeysAsync } from "../../shared/regex/lorebook-keyword-matching";
import { vmRegexExecutor } from "./regex-timeout.js";

/** Compute cosine similarity between two vectors. Returns 0 for empty/mismatched vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Minimal message shape needed for scanning. */
export interface ScanMessage {
  role: string;
  content: string;
}

/** Result of scanning: an activated entry plus metadata. */
export interface ActivatedEntry {
  entry: LorebookEntry;
  /** Original stored content when entry.content has been macro-expanded for scanning or budgeting. */
  rawContent?: string;
  /** Which key(s) matched */
  matchedKeys: string[];
  /** True when a primary key matched the latest user message in the chat. */
  matchedLatestUserMessage?: boolean;
  /** Priority order for injection */
  injectionOrder: number;
  /** True when sticky state kept this entry active without a fresh keyword match */
  sticky?: boolean;
}

/** Runtime state for timing (sticky/cooldown/delay). */
export interface EntryTimingState {
  /** Message index when this entry was last activated */
  lastActivatedAt: number | null;
  /** How many consecutive messages it's been active (for sticky) */
  stickyCount: number;
  /** Messages since last activation (for cooldown) */
  cooldownRemaining: number;
  /** Delay messages remaining before first activation */
  delayRemaining: number;
}

export interface LorebookActivationTraceResult {
  activatedEntries: ActivatedEntry[];
  trace: LorebookActivationTrace;
}

type LorebookFilterValueContext = {
  activeCharacterIds: Set<string>;
  activeCharacterTags: Set<string>;
  generationTriggers: Set<string>;
};

/** Game state fields used for condition evaluation. */
export interface GameStateForScanning {
  location?: string | null;
  time?: string | null;
  date?: string | null;
  weather?: string | null;
  temperature?: string | null;
  presentCharacters?: Array<{ name: string; characterId: string }>;
  [key: string]: unknown;
}

/**
 * Evaluate activation conditions against game state.
 */
function evaluateConditions(conditions: ActivationCondition[], gameState: GameStateForScanning | null): boolean {
  if (conditions.length === 0) return true;
  if (!gameState) return true;

  for (const condition of conditions) {
    const fieldValue = getGameStateValue(gameState, condition.field);
    if (fieldValue === null) return false;

    switch (condition.operator) {
      case "equals":
        if (fieldValue.toLowerCase() !== condition.value.toLowerCase()) return false;
        break;
      case "not_equals":
        if (fieldValue.toLowerCase() === condition.value.toLowerCase()) return false;
        break;
      case "contains":
        if (!fieldValue.toLowerCase().includes(condition.value.toLowerCase())) return false;
        break;
      case "not_contains":
        if (fieldValue.toLowerCase().includes(condition.value.toLowerCase())) return false;
        break;
      case "gt":
        if (parseFloat(fieldValue) <= parseFloat(condition.value)) return false;
        break;
      case "lt":
        if (parseFloat(fieldValue) >= parseFloat(condition.value)) return false;
        break;
    }
  }

  return true;
}

function getGameStateValue(gameState: GameStateForScanning, field: string): string | null {
  const value = gameState[field];
  if (value === undefined || value === null) return null;
  const fieldValue = String(value).trim();
  return fieldValue.length > 0 ? fieldValue : null;
}

function scheduleValues(values: string[] | undefined): string[] {
  return Array.isArray(values) ? values : [];
}

function hasScheduleGate(schedule: LorebookSchedule): boolean {
  return (
    scheduleValues(schedule.activeTimes).length > 0 ||
    scheduleValues(schedule.activeDates).length > 0 ||
    scheduleValues(schedule.activeLocations).length > 0
  );
}

/**
 * Evaluate schedule conditions against game state.
 */
function evaluateSchedule(schedule: LorebookSchedule | null, gameState: GameStateForScanning | null): boolean {
  if (!schedule) return true;
  if (!hasScheduleGate(schedule)) return true;
  if (!gameState) return true;

  // Check active times
  const activeTimes = scheduleValues(schedule.activeTimes);
  if (activeTimes.length > 0) {
    const currentTime = getGameStateValue(gameState, "time");
    if (currentTime !== null) {
      const normalizedTime = currentTime.toLowerCase();
      const matches = activeTimes.some((t) => normalizedTime.includes(t.toLowerCase()));
      if (!matches) return false;
    }
  }

  // Check active dates
  const activeDates = scheduleValues(schedule.activeDates);
  if (activeDates.length > 0) {
    const currentDate = getGameStateValue(gameState, "date");
    if (currentDate !== null) {
      const normalizedDate = currentDate.toLowerCase();
      const matches = activeDates.some((d) => normalizedDate.includes(d.toLowerCase()));
      if (!matches) return false;
    }
  }

  // Check active locations
  const activeLocations = scheduleValues(schedule.activeLocations);
  if (activeLocations.length > 0) {
    const currentLoc = getGameStateValue(gameState, "location");
    if (currentLoc !== null) {
      const normalizedLocation = currentLoc.toLowerCase();
      const matches = activeLocations.some((l) => normalizedLocation.includes(l.toLowerCase()));
      if (!matches) return false;
    }
  }

  return true;
}

/**
 * Check timing state (sticky/cooldown/delay).
 */
function checkTiming(entry: LorebookEntry, timingState: EntryTimingState | undefined): boolean {
  if (!timingState) return !(entry.delay !== null && entry.delay > 0);

  // Delay: must wait N messages before first activation
  if (entry.delay !== null && entry.delay > 0) {
    if (timingState.delayRemaining > 0) return false;
  }

  // Cooldown: wait N messages between activations
  if (entry.cooldown !== null && entry.cooldown > 0) {
    if (timingState.cooldownRemaining > 0) return false;
  }

  return true;
}

function normalizeProbability(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : null;
  if (parsed === null || !Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

function hasTimingConfig(entry: LorebookEntry): boolean {
  return (
    (entry.sticky !== null && entry.sticky > 0) ||
    (entry.cooldown !== null && entry.cooldown > 0) ||
    (entry.delay !== null && entry.delay > 0)
  );
}

function cloneTimingState(state: EntryTimingState): EntryTimingState {
  return {
    lastActivatedAt: state.lastActivatedAt,
    stickyCount: state.stickyCount,
    cooldownRemaining: state.cooldownRemaining,
    delayRemaining: state.delayRemaining,
  };
}

function shouldPersistTimingState(entry: LorebookEntry, state: EntryTimingState): boolean {
  if (state.stickyCount > 0 || state.cooldownRemaining > 0 || state.delayRemaining > 0) return true;
  if (entry.delay !== null && entry.delay > 0) return true;
  return false;
}

export function updateTimingStatesForScan(
  entries: LorebookEntry[],
  activatedEntries: ActivatedEntry[],
  previousStates: Map<string, EntryTimingState> = new Map(),
  currentMessageIndex: number,
): Map<string, EntryTimingState> {
  const nextStates = new Map<string, EntryTimingState>();
  const activatedById = new Map(activatedEntries.map((entry) => [entry.entry.id, entry]));

  for (const entry of entries) {
    if (!hasTimingConfig(entry)) continue;
    const previous = previousStates.get(entry.id);
    const state: EntryTimingState = previous
      ? cloneTimingState(previous)
      : {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: entry.delay !== null && entry.delay > 0 ? entry.delay : 0,
        };

    const activated = activatedById.get(entry.id);
    if (activated && !activated.sticky) {
      state.lastActivatedAt = currentMessageIndex;
      state.stickyCount = entry.sticky !== null && entry.sticky > 0 ? entry.sticky : 0;
      state.cooldownRemaining = entry.cooldown !== null && entry.cooldown > 0 ? entry.cooldown : 0;
      state.delayRemaining = 0;
    } else {
      if (state.delayRemaining > 0) state.delayRemaining -= 1;
      if (state.cooldownRemaining > 0) state.cooldownRemaining -= 1;
      if (state.stickyCount > 0) state.stickyCount -= 1;
    }

    if (shouldPersistTimingState(entry, state)) {
      nextStates.set(entry.id, state);
    }
  }

  return nextStates;
}

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase();
}

function makeValueSet(values: string[] | undefined) {
  return new Set((values ?? []).map(normalizeFilterValue).filter(Boolean));
}

function passesValueFilter(
  mode: LorebookFilterMode | undefined,
  filters: string[] | undefined,
  activeValues: Set<string>,
) {
  const normalizedMode = mode ?? "any";
  const filterValues = makeValueSet(filters);
  if (normalizedMode === "any" || filterValues.size === 0) return true;
  const hasMatch = Array.from(filterValues).some((value) => activeValues.has(value));
  return normalizedMode === "include" ? hasMatch : !hasMatch;
}

function passesEntryFilters(entry: LorebookEntry, context: LorebookFilterValueContext) {
  return (
    passesValueFilter(entry.characterFilterMode, entry.characterFilterIds, context.activeCharacterIds) &&
    passesValueFilter(entry.characterTagFilterMode, entry.characterTagFilters, context.activeCharacterTags) &&
    passesValueFilter(entry.generationTriggerFilterMode, entry.generationTriggerFilters, context.generationTriggers)
  );
}

export function lorebookEntryPassesContextFilters(
  entry: LorebookEntry,
  options: { activeCharacterIds?: string[]; activeCharacterTags?: string[]; generationTriggers?: string[] },
) {
  return passesEntryFilters(entry, {
    activeCharacterIds: makeValueSet(options.activeCharacterIds),
    activeCharacterTags: makeValueSet(options.activeCharacterTags),
    generationTriggers: makeValueSet(options.generationTriggers?.length ? options.generationTriggers : ["chat"]),
  });
}

function getAdditionalMatchingText(entry: LorebookEntry, sourceText: Partial<Record<LorebookMatchingSource, string>>) {
  if (!entry.additionalMatchingSources?.length) return "";
  return entry.additionalMatchingSources
    .map((source) => sourceText[source]?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

function latestUserMessageContent(messages: ScanMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.content;
  }
  return "";
}

/**
 * Group-based selection: within a group, only activate entries up to weight limits.
 */
function applyGroupSelection(entries: ActivatedEntry[]): ActivatedEntry[] {
  const grouped = new Map<string, ActivatedEntry[]>();
  const ungrouped: ActivatedEntry[] = [];

  for (const entry of entries) {
    const group = entry.entry.group;
    if (group) {
      const list = grouped.get(group) ?? [];
      list.push(entry);
      grouped.set(group, list);
    } else {
      ungrouped.push(entry);
    }
  }

  const result: ActivatedEntry[] = [...ungrouped];

  for (const [, groupEntries] of grouped) {
    // Sort by weight (higher = more likely), then by order
    groupEntries.sort((a, b) => {
      const wA = a.entry.groupWeight ?? 100;
      const wB = b.entry.groupWeight ?? 100;
      if (wA !== wB) return wB - wA;
      return a.entry.order - b.entry.order;
    });
    // Pick the highest-weight entry from each group
    const top = groupEntries[0];
    if (top) {
      result.push(top);
    }
  }

  return result;
}

export interface ScanOptions {
  /** How many messages back to scan (0 = all). */
  scanDepth?: number;
  /** Current game state for condition evaluation. */
  gameState?: GameStateForScanning | null;
  /** Timing state map (entryId → state). */
  timingStates?: Map<string, EntryTimingState>;
  /** Current message index for timing calculations. */
  currentMessageIndex?: number;
  /** Pre-computed embedding of the chat context for semantic matching fallback. */
  chatEmbedding?: number[] | null;
  /** Cosine similarity threshold for semantic matching (0-1, default 0.3). */
  semanticThreshold?: number;
  /** Active character IDs for per-entry include/exclude gates. */
  activeCharacterIds?: string[];
  /** Tags from active character cards for per-entry include/exclude gates. */
  activeCharacterTags?: string[];
  /** Generation trigger names for per-entry include/exclude gates. */
  generationTriggers?: string[];
  /** Extra source text entries may opt into scanning. */
  additionalMatchingSourceText?: Partial<Record<LorebookMatchingSource, string>>;
  /** Ignore sticky/cooldown/delay runtime state for preview/debug scans. */
  ignoreTiming?: boolean;
  /** Random source for probability gates; injectable for deterministic tests. */
  random?: () => number;
}

function estimateTraceTokens(entry: LorebookEntry): number {
  return Math.ceil(entry.content.length / 4);
}

function timingTrace(state: EntryTimingState | undefined): EntryTimingState | undefined {
  return state ? cloneTimingState(state) : undefined;
}

export function hintForTraceReason(reason: LorebookActivationTraceReason): string {
  switch (reason) {
    case "primary_key_miss":
      return "Edit this entry's keys or increase scan depth.";
    case "secondary_key_miss":
      return "Edit secondary keys or change the selective-key logic.";
    case "disabled":
      return "Enable this entry to allow activation.";
    case "scope_filter":
      return "Adjust character, tag, or generation-trigger filters for this context.";
    case "condition_miss":
      return "Change the game-state condition or update the current game state.";
    case "schedule_miss":
      return "Adjust the schedule or move the scene into a matching time, date, or location.";
    case "timing_blocked":
      return "Reset timing state or wait for delay/cooldown to expire.";
    case "probability_failed":
      return "Increase probability or test again with a new roll.";
    case "group_loser":
      return "Raise this entry's group weight or move it to another group.";
    case "budget_lorebook":
      return "Raise this lorebook's token budget or shorten higher-priority entries.";
    case "budget_chat":
      return "Raise the chat lorebook budget or shorten higher-priority entries.";
    case "budget_both":
      return "Raise lorebook and chat budgets or shorten higher-priority entries.";
    case "folder_disabled":
      return "Re-enable this entry's folder to allow activation.";
    case "empty_content":
      return "Add entry content before testing activation.";
    case "position_disabled":
      return "Enable this injection position in the active prompt preset.";
    case "recursion_blocked":
      return "Disable anti-recursion only if this entry should seed recursive scans.";
    case "keyword_match":
    case "constant":
    case "sticky":
    case "semantic_match":
      return "This entry reached the activation set for this scan.";
  }
}

function traceEntry(
  entry: LorebookEntry,
  status: LorebookActivationTraceStatus,
  reason: LorebookActivationTraceReason,
  extras: Partial<LorebookActivationTraceEntry> = {},
): LorebookActivationTraceEntry {
  return {
    entryId: entry.id,
    lorebookId: entry.lorebookId,
    name: entry.name,
    status,
    reason,
    hint: hintForTraceReason(reason),
    matchedKeys: [],
    tokenEstimate: estimateTraceTokens(entry),
    injection: {
      position: entry.position,
      role: entry.role,
      depth: entry.depth,
      order: entry.order,
    },
    ...extras,
  };
}

function activationGateTraceReason(
  entry: LorebookEntry,
  timingState: EntryTimingState | undefined,
  filterContext: LorebookFilterValueContext,
  gameState: GameStateForScanning | null,
  ignoreTiming: boolean,
): LorebookActivationTraceReason | null {
  if (!entry.enabled) return "disabled";
  if (!passesEntryFilters(entry, filterContext)) return "scope_filter";
  if (!evaluateConditions(entry.activationConditions, gameState)) return "condition_miss";
  if (!evaluateSchedule(entry.schedule, gameState)) return "schedule_miss";
  if (!ignoreTiming && !checkTiming(entry, timingState)) return "timing_blocked";
  return null;
}

/**
 * Main scanning function with trace metadata: given messages and lorebook entries,
 * returns activated entries plus one decision row per scanned entry.
 */
export async function scanForActivatedEntriesWithTrace(
  messages: ScanMessage[],
  entries: LorebookEntry[],
  options: ScanOptions = {},
): Promise<LorebookActivationTraceResult> {
  const {
    scanDepth = 0,
    gameState = null,
    timingStates = new Map(),
    currentMessageIndex: _currentMessageIndex = messages.length,
    chatEmbedding = null,
    semanticThreshold = 0.3,
    activeCharacterIds = [],
    activeCharacterTags = [],
    generationTriggers = ["chat"],
    additionalMatchingSourceText = {},
    ignoreTiming = false,
    random = Math.random,
  } = options;
  const filterContext: LorebookFilterValueContext = {
    activeCharacterIds: makeValueSet(activeCharacterIds),
    activeCharacterTags: makeValueSet(activeCharacterTags),
    generationTriggers: makeValueSet(generationTriggers.length > 0 ? generationTriggers : ["chat"]),
  };

  const messagesToScan = scanDepth > 0 ? messages.slice(-scanDepth) : messages;
  const combinedText = messagesToScan.map((m) => m.content).join("\n");
  const latestUserText = latestUserMessageContent(messages);

  const activated: ActivatedEntry[] = [];
  const activatedIds = new Set<string>();
  const traceById = new Map<string, LorebookActivationTraceEntry>();
  const probabilityDecisions = new Map<
    string,
    { configured: number | null; roll: number | null; passed: boolean }
  >();
  const recordTrace = (entry: LorebookEntry, trace: LorebookActivationTraceEntry) => {
    traceById.set(entry.id, trace);
  };
  const probabilityForEntry = (entry: LorebookEntry) => {
    const existing = probabilityDecisions.get(entry.id);
    if (existing) return existing;
    const configured = normalizeProbability(entry.probability);
    if (configured === null || configured >= 100) {
      const decision = { configured, roll: null, passed: true };
      probabilityDecisions.set(entry.id, decision);
      return decision;
    }
    if (configured <= 0) {
      const decision = { configured, roll: null, passed: false };
      probabilityDecisions.set(entry.id, decision);
      return decision;
    }
    const roll = random() * 100;
    const decision = { configured, roll, passed: roll < configured };
    probabilityDecisions.set(entry.id, decision);
    return decision;
  };
  const probabilityTrace = (decision: { configured: number | null; roll: number | null; passed: boolean }) =>
    decision.configured === null
      ? undefined
      : {
          configured: decision.configured,
          roll: decision.roll === null ? null : Number(decision.roll.toFixed(6)),
          passed: decision.passed,
        };

  for (const entry of entries) {
    const timingState = timingStates.get(entry.id);

    if (!ignoreTiming && timingState?.stickyCount && timingState.stickyCount > 0) {
      const contextualReason = activationGateTraceReason(entry, undefined, filterContext, gameState, true);
      if (contextualReason) {
        recordTrace(
          entry,
          traceEntry(entry, "skipped", contextualReason, {
            timing: timingTrace(timingState),
          }),
        );
        continue;
      }
      const activatedEntry = {
        entry,
        matchedKeys: ["[sticky]"],
        injectionOrder: entry.order,
        sticky: true,
      } satisfies ActivatedEntry;
      activated.push(activatedEntry);
      activatedIds.add(entry.id);
      recordTrace(
        entry,
        traceEntry(entry, "included", "sticky", {
          matchedKeys: activatedEntry.matchedKeys,
          timing: timingTrace(timingState),
        }),
      );
      continue;
    }

    const gateReason = activationGateTraceReason(entry, timingState, filterContext, gameState, ignoreTiming);
    if (gateReason) {
      recordTrace(
        entry,
        traceEntry(entry, "skipped", gateReason, {
          timing: timingTrace(timingState),
        }),
      );
      continue;
    }

    if (entry.constant) {
      const probability = probabilityForEntry(entry);
      if (!probability.passed) {
        recordTrace(
          entry,
          traceEntry(entry, "skipped", "probability_failed", {
            matchedKeys: ["[constant]"],
            probability: probabilityTrace(probability),
          }),
        );
        continue;
      }
      const activatedEntry = {
        entry,
        matchedKeys: ["[constant]"],
        injectionOrder: entry.order,
      } satisfies ActivatedEntry;
      activated.push(activatedEntry);
      activatedIds.add(entry.id);
      recordTrace(
        entry,
        traceEntry(entry, "included", "constant", {
          matchedKeys: activatedEntry.matchedKeys,
          probability: probabilityTrace(probability),
        }),
      );
      continue;
    }

    const baseEntryScanText =
      entry.scanDepth === 0
        ? messages.map((m) => m.content).join("\n")
        : entry.scanDepth !== null && entry.scanDepth > 0
          ? messages
              .slice(-entry.scanDepth)
              .map((m) => m.content)
              .join("\n")
          : combinedText;
    const extraMatchingText = getAdditionalMatchingText(entry, additionalMatchingSourceText);
    const entryScanText = extraMatchingText ? `${baseEntryScanText}\n${extraMatchingText}` : baseEntryScanText;

    const matchOptions = {
      useRegex: entry.useRegex,
      matchWholeWords: entry.matchWholeWords,
      caseSensitive: entry.caseSensitive,
      regexExecutor: vmRegexExecutor,
    };

    const { matched, matchedKeys } = await testPrimaryKeysAsync(entry.keys, entryScanText, matchOptions);
    if (!matched) {
      recordTrace(entry, traceEntry(entry, "skipped", "primary_key_miss"));
      continue;
    }
    const matchedLatestUserMessage =
      latestUserText.length > 0 && (await testPrimaryKeysAsync(entry.keys, latestUserText, matchOptions)).matched;

    if (entry.selective && entry.secondaryKeys.length > 0) {
      if (!(await testSecondaryKeysAsync(entry.secondaryKeys, entryScanText, entry.selectiveLogic, matchOptions))) {
        recordTrace(
          entry,
          traceEntry(entry, "skipped", "secondary_key_miss", {
            matchedKeys,
          }),
        );
        continue;
      }
    }

    const probability = probabilityForEntry(entry);
    if (!probability.passed) {
      recordTrace(
        entry,
        traceEntry(entry, "skipped", "probability_failed", {
          matchedKeys,
          probability: probabilityTrace(probability),
        }),
      );
      continue;
    }

    const activatedEntry = {
      entry,
      matchedKeys,
      matchedLatestUserMessage,
      injectionOrder: entry.order,
    } satisfies ActivatedEntry;
    activated.push(activatedEntry);
    activatedIds.add(entry.id);
    recordTrace(
      entry,
      traceEntry(entry, "included", "keyword_match", {
        matchedKeys,
        probability: probabilityTrace(probability),
      }),
    );
  }

  if (chatEmbedding && chatEmbedding.length > 0) {
    for (const entry of entries) {
      if (!entry.enabled || entry.constant || activatedIds.has(entry.id)) continue;
      if (entry.excludeFromVectorization) continue;
      if (!entry.embedding || entry.embedding.length === 0) continue;
      const timingState = timingStates.get(entry.id);
      const gateReason = activationGateTraceReason(entry, timingState, filterContext, gameState, ignoreTiming);
      if (gateReason) continue;

      const similarity = cosineSimilarity(chatEmbedding, entry.embedding);
      if (similarity >= semanticThreshold) {
        const probability = probabilityForEntry(entry);
        if (!probability.passed) {
          recordTrace(
            entry,
            traceEntry(entry, "skipped", "probability_failed", {
              matchedKeys: [`[semantic:${similarity.toFixed(3)}]`],
              probability: probabilityTrace(probability),
              semanticScore: Number(similarity.toFixed(6)),
            }),
          );
          continue;
        }
        const activatedEntry = {
          entry,
          matchedKeys: [`[semantic:${similarity.toFixed(3)}]`],
          injectionOrder: entry.order,
        } satisfies ActivatedEntry;
        activated.push(activatedEntry);
        activatedIds.add(entry.id);
        recordTrace(
          entry,
          traceEntry(entry, "included", "semantic_match", {
            matchedKeys: activatedEntry.matchedKeys,
            probability: probabilityTrace(probability),
            semanticScore: Number(similarity.toFixed(6)),
          }),
        );
      }
    }
  }

  const afterGroups = applyGroupSelection(activated);
  const selectedIds = new Set(afterGroups.map((entry) => entry.entry.id));
  for (const entry of activated) {
    if (selectedIds.has(entry.entry.id)) continue;
    recordTrace(
      entry.entry,
      traceEntry(entry.entry, "skipped", "group_loser", {
        matchedKeys: entry.matchedKeys,
      }),
    );
  }

  afterGroups.sort((a, b) => a.injectionOrder - b.injectionOrder);

  return {
    activatedEntries: afterGroups,
    trace: {
      entries: entries.map((entry) => traceById.get(entry.id) ?? traceEntry(entry, "skipped", "primary_key_miss")),
    },
  };
}

/**
 * Main scanning function: given messages and lorebook entries,
 * returns the list of activated entries.
 */
export async function scanForActivatedEntries(
  messages: ScanMessage[],
  entries: LorebookEntry[],
  options: ScanOptions = {},
): Promise<ActivatedEntry[]> {
  return (await scanForActivatedEntriesWithTrace(messages, entries, options)).activatedEntries;
}
