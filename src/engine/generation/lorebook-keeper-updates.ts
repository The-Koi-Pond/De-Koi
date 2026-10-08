import type { StorageGateway } from "../capabilities/storage";
import { createLorebookEntrySchema, updateLorebookEntrySchema } from "../contracts/schemas/lorebook.schema";
import type { AgentResult } from "../contracts/types/agent";
import type { LorebookEntry } from "../contracts/types/lorebook";
import { resolveLorebookKeeperTarget } from "../generation-core/lorebooks/lorebook-keeper-target";
import type { LorebookKeeperSettlement } from "./lorebook-keeper-settlements";
import { parseRecord, readString, type JsonRecord } from "./runtime-records";

/** One Lorebook Keeper proposal, resolved to the lorebook it would change. */
export interface LorebookKeeperUpdate {
  lorebookId: string;
  lorebookName: string;
  action: "create" | "update" | "delete";
  entryId: string | null;
  entryName: string;
  content: string;
  newFacts: string[];
  keys: string[];
  tag: string;
  reason: string;
}

/**
 * Stored on each proposal in a Keeper run's `resultData.updates[i].reviewStatus`, so whichever
 * client opens the chat (or none) can tell what still needs a decision.
 */
export type LorebookKeeperReviewStatus = "pending" | "applied" | "rejected" | "failed" | "skipped";

export interface LorebookKeeperApplyResult {
  applied: boolean;
  lorebookId: string;
  entryId: string | null;
}

/** Embeds the given entries; the runtime command that does it lives outside the engine. */
export type LorebookEntryVectorizer = (lorebookId: string, entryIds: string[]) => Promise<unknown>;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readString(item).trim()).filter(Boolean)
    : typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function lorebookKeeperReviewRequired(chat: JsonRecord | null | undefined): boolean {
  return parseRecord(chat?.metadata).lorebookKeeperReviewRequired !== false;
}

export function isLorebookKeeperResult(result: { agentType?: string; type?: string }): boolean {
  return result.agentType === "lorebook-keeper" || result.type === "lorebook_update";
}

/** The raw proposals in a Keeper result, in their stored order. */
export function lorebookKeeperRawUpdates(data: unknown): JsonRecord[] {
  const updates = parseRecord(data).updates;
  return Array.isArray(updates) ? updates.map((update) => parseRecord(update)) : [];
}

export function lorebookKeeperReviewStatus(rawUpdate: JsonRecord): LorebookKeeperReviewStatus | null {
  const status = readString(rawUpdate.reviewStatus).trim();
  return status === "pending" ||
    status === "applied" ||
    status === "rejected" ||
    status === "failed" ||
    status === "skipped"
    ? status
    : null;
}

/**
 * Resolves one raw proposal to the lorebook it targets, or null when it is malformed or no
 * lorebook in scope can take it.
 */
export function resolveLorebookKeeperUpdate(
  rawUpdate: JsonRecord,
  context: { chat: JsonRecord | null; lorebooks: JsonRecord[] },
): LorebookKeeperUpdate | null {
  const action = readString(rawUpdate.action).trim().toLowerCase();
  if (action !== "create" && action !== "update" && action !== "delete") return null;
  const entryName = readString(rawUpdate.entryName).trim() || readString(rawUpdate.name).trim();
  const entryId = readString(rawUpdate.entryId).trim() || readString(rawUpdate.id).trim();
  if (!entryName && !entryId) return null;
  const chat = context.chat;
  const characterIds = Array.isArray(chat?.characterIds) ? chat.characterIds : [];
  const personaId = readString(chat?.personaId).trim();
  const target = resolveLorebookKeeperTarget(context.lorebooks, {
    chat,
    characters: characterIds.map((id) => ({ id: readString(id) })),
    persona: personaId ? { id: personaId } : null,
    proposedLorebookId: rawUpdate.lorebookId,
  });
  if (!target) return null;
  return {
    lorebookId: target.id,
    lorebookName: target.name,
    action,
    entryId: entryId || null,
    entryName: entryName || "Untitled entry",
    content: readString(rawUpdate.content).trim(),
    newFacts: stringArray(rawUpdate.newFacts),
    keys: uniqueStrings(stringArray(rawUpdate.keys)),
    tag: readString(rawUpdate.tag).trim(),
    reason: readString(rawUpdate.reason).trim(),
  };
}

function entryDefaults(lorebookId: string, update: LorebookKeeperUpdate): Record<string, unknown> {
  return {
    lorebookId,
    name: update.entryName || "Untitled entry",
    content: update.content,
    description: "",
    keys: update.keys,
    secondaryKeys: [],
    enabled: true,
    constant: false,
    selective: false,
    selectiveLogic: "and",
    probability: null,
    scanDepth: null,
    matchWholeWords: false,
    caseSensitive: false,
    useRegex: false,
    characterFilterMode: "any",
    characterFilterIds: [],
    characterTagFilterMode: "any",
    characterTagFilters: [],
    generationTriggerFilterMode: "any",
    generationTriggerFilters: [],
    additionalMatchingSources: [],
    position: 0,
    depth: 4,
    order: 100,
    role: "system",
    sticky: null,
    cooldown: null,
    delay: null,
    ephemeral: null,
    group: "",
    groupWeight: null,
    folderId: null,
    preventRecursion: false,
    locked: false,
    tag: update.tag,
    relationships: {},
    dynamicState: {},
    activationConditions: [],
    schedule: null,
    excludeFromVectorization: false,
    embedding: null,
  };
}

async function findExistingEntry(storage: StorageGateway, update: LorebookKeeperUpdate): Promise<LorebookEntry | null> {
  if (update.entryId) {
    const entry = await storage.get<LorebookEntry>("lorebook-entries", update.entryId).catch(() => null);
    if (entry?.lorebookId === update.lorebookId) return entry;
  }
  const entries = await storage.list<LorebookEntry>("lorebook-entries", { filters: { lorebookId: update.lorebookId } });
  const targetName = update.entryName.trim().toLowerCase();
  return entries.find((entry) => entry.name.trim().toLowerCase() === targetName) ?? null;
}

function appendLoreFacts(existingContent: string, update: LorebookKeeperUpdate): string {
  const additions = uniqueStrings([
    ...update.newFacts,
    ...(update.content && !existingContent.trim() ? [update.content] : []),
    ...(update.content &&
    existingContent.trim() &&
    !existingContent.includes(update.content) &&
    update.newFacts.length === 0
      ? [update.content]
      : []),
  ]).filter((fact) => !existingContent.toLowerCase().includes(fact.toLowerCase()));
  if (additions.length === 0) return existingContent;
  const additionText = additions.map((fact) => `- ${fact}`).join("\n");
  return [existingContent.trim(), additionText].filter(Boolean).join("\n\n");
}

async function vectorizeEntry(
  vectorize: LorebookEntryVectorizer | undefined,
  lorebookId: string,
  entryId: string | null,
): Promise<void> {
  if (!vectorize || !entryId) return;
  try {
    await vectorize(lorebookId, [entryId]);
  } catch (error) {
    // The entry is saved either way; it still activates by its keys and can be vectorized later.
    console.warn("[lorebook-keeper] Auto-vectorization failed", { lorebookId, entryId, error });
  }
}

/**
 * The id a reviewed proposal's new entry is created under. Storage refuses a second record with the
 * same id, so approving one proposal twice (two tabs, or a retry after its decision failed to save)
 * can never create the entry twice.
 */
export function lorebookKeeperProposalEntryId(runId: string, updateIndex: number): string {
  return `keeper-${runId}-${updateIndex}`;
}

async function entryExists(storage: StorageGateway, id: string): Promise<boolean> {
  return !!(await storage.get<LorebookEntry>("lorebook-entries", id).catch(() => null));
}

/**
 * Writes one proposal to its lorebook. Throws when the entry is locked or the write fails. With
 * `proposalEntryId`, applying the same proposal again is a no-op: a create made under that id is not
 * made twice, and update and delete already leave a repeated proposal's changes as they are.
 */
export async function applyLorebookKeeperUpdate(
  storage: StorageGateway,
  update: LorebookKeeperUpdate,
  vectorize?: LorebookEntryVectorizer,
  options: { proposalEntryId?: string } = {},
): Promise<LorebookKeeperApplyResult> {
  const result = (applied: boolean, entryId: string | null) => ({ applied, lorebookId: update.lorebookId, entryId });
  const { proposalEntryId } = options;
  const create = async () => {
    if (proposalEntryId && (await entryExists(storage, proposalEntryId))) return result(true, proposalEntryId);
    const value = createLorebookEntrySchema.parse(entryDefaults(update.lorebookId, update));
    let created: LorebookEntry;
    try {
      created = await storage.create<LorebookEntry>(
        "lorebook-entries",
        proposalEntryId ? { ...value, id: proposalEntryId } : value,
      );
    } catch (error) {
      // Another approval of this proposal created it first.
      if (proposalEntryId && (await entryExists(storage, proposalEntryId))) return result(true, proposalEntryId);
      throw error;
    }
    await vectorizeEntry(vectorize, update.lorebookId, created.id);
    return result(true, created.id);
  };
  if (update.action === "create") return create();

  const existing = await findExistingEntry(storage, update);
  if (!existing) {
    if (update.action === "delete") return result(false, null);
    return create();
  }
  if (existing.locked) {
    throw new Error(`"${existing.name}" is locked and cannot be changed by Lorebook Keeper.`);
  }
  if (update.action === "delete") {
    await storage.delete("lorebook-entries", existing.id);
    return result(true, existing.id);
  }

  const nextContent = appendLoreFacts(existing.content ?? "", update);
  const nextKeys = uniqueStrings([...(existing.keys ?? []), ...update.keys]);
  const patch: Record<string, unknown> = {};
  if (nextContent !== existing.content) patch.content = nextContent;
  if (nextKeys.length !== (existing.keys ?? []).length) patch.keys = nextKeys;
  if (update.tag && update.tag !== existing.tag) patch.tag = update.tag;
  if (Object.keys(patch).length === 0) return result(false, existing.id);
  patch.embedding = null;
  await storage.update<LorebookEntry>("lorebook-entries", existing.id, updateLorebookEntrySchema.parse(patch));
  await vectorizeEntry(vectorize, update.lorebookId, existing.id);
  return result(true, existing.id);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Settles the Keeper's proposals before its run is stored: with review off they are written to the
 * lorebook here, so no open tab is needed; with review on they are stored as pending, and the review
 * dialog picks them up from the stored run. Each proposal carries its `reviewStatus`. Returns the
 * settlement to publish once the run is stored, or null when there was nothing to settle.
 */
export async function settleLorebookKeeperResults(
  deps: { storage: StorageGateway; vectorize?: LorebookEntryVectorizer },
  chat: JsonRecord,
  results: AgentResult[],
): Promise<{ results: AgentResult[]; settlement: LorebookKeeperSettlement | null }> {
  const chatId = readString(chat.id).trim();
  const keeperResults = results.filter(
    (result) => result.success && isLorebookKeeperResult(result) && lorebookKeeperRawUpdates(result.data).length > 0,
  );
  if (keeperResults.length === 0) return { results, settlement: null };

  const reviewRequired = lorebookKeeperReviewRequired(chat);
  // A failed read must not pass for "no lorebooks": that would mark every proposal skipped for good.
  // Throwing fails this run instead, and the queued backfill retries it.
  const lorebooks = await deps.storage.list<JsonRecord>("lorebooks");
  const settlement: LorebookKeeperSettlement = { chatId, applied: 0, pending: 0, lorebookIds: [] };
  const settled = new Map<AgentResult, AgentResult>();
  for (const result of keeperResults) {
    const updates: JsonRecord[] = [];
    for (const rawUpdate of lorebookKeeperRawUpdates(result.data)) {
      if (lorebookKeeperReviewStatus(rawUpdate)) {
        updates.push(rawUpdate);
        continue;
      }
      const update = resolveLorebookKeeperUpdate(rawUpdate, { chat, lorebooks });
      if (!update) {
        updates.push({ ...rawUpdate, reviewStatus: "skipped" });
        continue;
      }
      if (reviewRequired) {
        settlement.pending += 1;
        updates.push({ ...rawUpdate, reviewStatus: "pending" });
        continue;
      }
      try {
        const applied = await applyLorebookKeeperUpdate(deps.storage, update, deps.vectorize);
        if (applied.applied) {
          settlement.applied += 1;
          if (!settlement.lorebookIds.includes(applied.lorebookId)) settlement.lorebookIds.push(applied.lorebookId);
        }
        updates.push({ ...rawUpdate, reviewStatus: "applied", appliedEntryId: applied.entryId });
      } catch (error) {
        console.warn("[lorebook-keeper] could not apply a proposal", { chatId, entryName: update.entryName, error });
        updates.push({ ...rawUpdate, reviewStatus: "failed", reviewError: errorText(error) });
      }
    }
    settled.set(result, { ...result, data: { ...parseRecord(result.data), updates } });
  }
  return {
    results: results.map((result) => settled.get(result) ?? result),
    settlement: settlement.applied > 0 || settlement.pending > 0 ? settlement : null,
  };
}
