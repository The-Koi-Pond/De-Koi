import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type {
  CanonicalMemoryInput,
  CanonicalMemoryRecord,
  StoryProjectionCitation,
  StoryProjectionJob,
  StoryProjectionPayload,
  StoryProjectionSections,
} from "../contracts/types/memory";
import { isTerminalBackgroundGenerationError } from "./background-generation-error";
import { foregroundGenerationActive } from "./background-generation-coordinator";
import { sha256MemoryId } from "./deterministic-memory-id";
import { nowIso, parseArray, parseRecord, readString, type JsonRecord } from "./runtime-records";
import {
  getEffectiveStoryConsolidationEnabled,
  planArcCoverage,
  planEpisodeCoverage,
  eligibleStoryMessages,
  STORY_PROJECTION_VERSION,
} from "./story-projections";

export const STORY_CONSOLIDATION_JOBS_COLLECTION = "story-consolidation-jobs" as StorageEntity;
export const STORY_SUMMARIZER_VERSION = "story-projection-v1";
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
const LEASE_HEARTBEAT_MS = 10_000;
const ABANDONED_PROCESSING_MS = 60_000;
const STORY_SUMMARY_MAX_TOKENS = 1800;
const STORY_SUMMARY_RETRY_MAX_TOKENS = 8192;
const workerId = `story-consolidation-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
const activeWorkers = new WeakSet<StorageGateway>();

export interface StoryEpisodeScheduleInput {
  chat: JsonRecord;
  messages: JsonRecord[];
  connectionId?: string | null;
  provider?: string | null;
  model?: string | null;
  requestedBoundary?: "manual" | "scene_conclusion";
  supersedesMemoryId?: string | null;
  /** User-triggered backfill/regeneration bypasses the automatic per-chat opt-out. */
  explicit?: boolean;
}

export interface StoryConsolidationDependencies {
  storage: StorageGateway;
  llm: LlmGateway;
}

type StructuredStorySummary = {
  title: string;
  summary: string;
  sections: StoryProjectionSections;
};

function storySummaryParameters(maxTokens: number): Record<string, unknown> {
  return {
    temperature: 0.25,
    maxTokens,
    reasoningEffort: "none",
    reasoning_effort: "none",
    customParameters: { reasoning_effort: "none", reasoning: { exclude: true } },
  };
}

function exhaustedReasoningResponse(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === "string") return value.toLowerCase().includes("no final assistant text");
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Error && exhaustedReasoningResponse(value.message, seen)) return true;
  return Object.values(value as Record<string, unknown>).some((nested) => exhaustedReasoningResponse(nested, seen));
}

async function completeStorySummary(llm: LlmGateway, request: Parameters<LlmGateway["complete"]>[0]): Promise<string> {
  try {
    return await llm.complete({ ...request, parameters: storySummaryParameters(STORY_SUMMARY_MAX_TOKENS) });
  } catch (error) {
    if (!exhaustedReasoningResponse(error)) throw error;
    return llm.complete({ ...request, parameters: storySummaryParameters(STORY_SUMMARY_RETRY_MAX_TOKENS) });
  }
}

function isStoryProjection(memory: CanonicalMemoryRecord): boolean {
  return parseRecord(memory.payload).storyProjectionVersion === STORY_PROJECTION_VERSION;
}

function storyPayload(memory: CanonicalMemoryRecord): StoryProjectionPayload | null {
  return isStoryProjection(memory) ? (memory.payload as StoryProjectionPayload) : null;
}

async function storyMemories(storage: StorageGateway, chatId: string): Promise<CanonicalMemoryRecord[]> {
  if (!storage.queryMemories) return [];
  return (await storage.queryMemories({ scope: { kind: "chat", id: chatId }, includeInactive: true })).filter(
    isStoryProjection,
  );
}

function coveredMessageIds(memories: CanonicalMemoryRecord[]): Set<string> {
  return new Set(
    memories
      .filter(
        (memory) =>
          storyPayload(memory)?.level === "episode" && (memory.status === "active" || memory.status === "pinned"),
      )
      .flatMap((memory) => storyPayload(memory)?.messageIds ?? []),
  );
}

function sourceSnapshot(message: JsonRecord) {
  return {
    id: readString(message.id).trim(),
    role: readString(message.role).trim(),
    content: readString(message.content).trim(),
    createdAt: readString(message.createdAt).trim() || null,
  };
}

async function sourceFingerprint(messages: ReturnType<typeof sourceSnapshot>[]): Promise<string> {
  return sha256MemoryId(
    "story-source",
    messages
      .map((message) => `${message.id}\u001f${message.role}\u001f${message.content}\u001f${message.createdAt ?? ""}`)
      .join("\u001e"),
  );
}

async function coverageId(chatId: string, messageIds: string[]): Promise<string> {
  return sha256MemoryId("story-coverage", `${chatId}\u001f${messageIds.join("\u001f")}`);
}

function sameJobIdentity(
  job: StoryProjectionJob,
  expected: Pick<StoryProjectionJob, "level" | "coverageId" | "sourceFingerprint">,
) {
  return job.level === expected.level && job.coverageId === expected.coverageId && job.sourceFingerprint === expected.sourceFingerprint;
}

export async function enqueueStoryEpisodeJob(
  storage: StorageGateway,
  input: StoryEpisodeScheduleInput,
  now = nowIso(),
): Promise<StoryProjectionJob | null> {
  const chatId = readString(input.chat.id).trim();
  const mode = readString(input.chat.mode || input.chat.chatMode).trim();
  const metadata = parseRecord(input.chat.metadata);
  if (!chatId) return null;
  if (!input.explicit && !input.requestedBoundary && !input.supersedesMemoryId && !getEffectiveStoryConsolidationEnabled(mode, metadata)) {
    return null;
  }
  const memories = await storyMemories(storage, chatId);
  const superseded = input.supersedesMemoryId
    ? memories.find((memory) => memory.id === input.supersedesMemoryId)
    : null;
  const supersededPayload = superseded ? storyPayload(superseded) : null;
  if (input.supersedesMemoryId && (!supersededPayload || supersededPayload.level !== "episode")) {
    throw new Error("The episode selected for regeneration no longer exists");
  }
  const eligibleIds = new Set(eligibleStoryMessages(input.messages).map((message) => readString(message.id).trim()));
  if (supersededPayload?.messageIds.some((id) => !eligibleIds.has(id))) {
    throw new Error("One or more episode source messages are missing and cannot be regenerated");
  }
  const plan = supersededPayload
    ? {
        level: "episode" as const,
        chatId,
        boundaryReason: supersededPayload.boundaryReason ?? "manual",
        messageIds: supersededPayload.messageIds,
        firstMessageId: supersededPayload.firstMessageId,
        lastMessageId: supersededPayload.lastMessageId,
      }
    : planEpisodeCoverage({
        chatId,
        messages: input.messages,
        coveredMessageIds: coveredMessageIds(memories),
        formalSceneStatus:
          metadata.sceneStatus === "active" || metadata.sceneStatus === "concluded" ? metadata.sceneStatus : null,
        requestedBoundary: input.requestedBoundary,
      });
  if (!plan) return null;
  const sourceMessages = input.messages
    .filter((message) => plan.messageIds.includes(readString(message.id).trim()))
    .map(sourceSnapshot);
  const fingerprint = await sourceFingerprint(sourceMessages);
  const stableCoverageId = await coverageId(chatId, plan.messageIds);
  const id = await sha256MemoryId(
    "story-job",
    `${STORY_SUMMARIZER_VERSION}\u001fepisode\u001f${stableCoverageId}\u001f${fingerprint}`,
  );
  const existing = (await storage.get<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION, id).catch(() => null)) ?? null;
  if (existing) {
    if (!sameJobIdentity(existing, { level: "episode", coverageId: stableCoverageId, sourceFingerprint: fingerprint })) {
      throw new Error("Story consolidation SHA-256 job id collision");
    }
    return existing;
  }
  const job: StoryProjectionJob = {
    id,
    status: "pending",
    level: "episode",
    ownerChatId: chatId,
    coverageId: stableCoverageId,
    sourceFingerprint: fingerprint,
    sourceMessageIds: plan.messageIds,
    sourceEpisodeIds: [],
    sourceMessages,
    sourceEpisodes: [],
    boundaryReason: plan.boundaryReason,
    supersedesMemoryId: input.supersedesMemoryId ?? null,
    connectionId: input.connectionId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  return storage.create<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION, job);
}

export async function enqueueStoryArcJob(
  storage: StorageGateway,
  input: { chatId: string; connectionId?: string | null; provider?: string | null; model?: string | null },
  now = nowIso(),
): Promise<StoryProjectionJob | null> {
  const memories = await storyMemories(storage, input.chatId);
  const plan = storyArcCoveragePlan(memories, input.chatId);
  if (!plan) return null;
  const sourceEpisodes = plan.sourceEpisodeIds.map((episodeId) => {
    const memory = memories.find((candidate) => candidate.id === episodeId)!;
    return {
      id: memory.id,
      title: memory.title ?? null,
      content: memory.content,
      messageIds: memory.provenance.messageIds,
    };
  });
  const fingerprint = await sha256MemoryId(
    "story-source",
    sourceEpisodes.map((episode) => `${episode.id}\u001f${episode.content}`).join("\u001e"),
  );
  const stableCoverageId = await sha256MemoryId(
    "story-coverage",
    `${input.chatId}\u001farc\u001f${plan.sourceCoverageIds.join("\u001f")}`,
  );
  const id = await sha256MemoryId(
    "story-job",
    `${STORY_SUMMARIZER_VERSION}\u001farc\u001f${stableCoverageId}\u001f${fingerprint}`,
  );
  const existing = (await storage.get<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION, id).catch(() => null)) ?? null;
  if (existing) {
    if (!sameJobIdentity(existing, { level: "arc", coverageId: stableCoverageId, sourceFingerprint: fingerprint })) {
      throw new Error("Story consolidation SHA-256 job id collision");
    }
    return existing;
  }
  const job: StoryProjectionJob = {
    id,
    status: "pending",
    level: "arc",
    ownerChatId: input.chatId,
    coverageId: stableCoverageId,
    sourceFingerprint: fingerprint,
    sourceMessageIds: plan.messageIds,
    sourceEpisodeIds: plan.sourceEpisodeIds,
    sourceMessages: [],
    sourceEpisodes,
    boundaryReason: null,
    supersedesMemoryId: null,
    connectionId: input.connectionId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  return storage.create<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION, job);
}

function storyArcCoveragePlan(memories: CanonicalMemoryRecord[], chatId: string) {
  const episodeSlots = new Map<
    string,
    { memory: CanonicalMemoryRecord; payload: StoryProjectionPayload; active: boolean }
  >();
  for (const memory of memories) {
    const payload = storyPayload(memory);
    if (!payload || payload.level !== "episode" || memory.status === "deleted") continue;
    const active = memory.status === "active" || memory.status === "pinned";
    const existing = episodeSlots.get(payload.coverageId);
    if (!existing || (active && !existing.active) || (active === existing.active && memory.updatedAt > existing.memory.updatedAt)) {
      episodeSlots.set(payload.coverageId, { memory, payload, active });
    }
  }
  const episodes = Array.from(episodeSlots.values()).map(({ memory, payload, active }) => ({
    episodeId: memory.id,
    coverageId: payload.coverageId,
    messageIds: payload.messageIds,
    firstMessageId: payload.firstMessageId,
    lastMessageId: payload.lastMessageId,
    createdAt: payload.sourceMessages?.[0]?.createdAt ?? memory.createdAt,
    active,
  }));
  const coveredEpisodeIds = new Set(
    memories
      .flatMap((memory) => {
        const payload = storyPayload(memory);
        return payload?.level === "arc" && (memory.status === "active" || memory.status === "pinned")
          ? payload.sourceEpisodeIds
          : [];
      })
      .filter(Boolean),
  );
  return planArcCoverage({ chatId, episodes, coveredEpisodeIds });
}

async function ensureSceneArcFollowUpJob(
  storage: StorageGateway,
  input: {
    memoryId: string;
    payload: StoryProjectionPayload;
    connectionId?: string | null;
    provider?: string | null;
    model?: string | null;
  },
  now: string,
): Promise<StoryProjectionJob> {
  const id = await sha256MemoryId(
    "story-job",
    `${STORY_SUMMARIZER_VERSION}\u001farc-follow-up\u001f${input.payload.coverageId}\u001f${input.payload.sourceFingerprint}`,
  );
  const existing =
    (await storage.get<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION, id).catch(() => null)) ?? null;
  if (existing) {
    if (
      !sameJobIdentity(existing, {
        level: "episode",
        coverageId: input.payload.coverageId,
        sourceFingerprint: input.payload.sourceFingerprint,
      }) ||
      existing.projectionMemoryId !== input.memoryId
    ) {
      throw new Error("Story consolidation SHA-256 follow-up job id collision");
    }
    return existing;
  }
  const job: StoryProjectionJob = {
    id,
    status: "pending",
    level: "episode",
    ownerChatId: input.payload.ownerChatId,
    coverageId: input.payload.coverageId,
    sourceFingerprint: input.payload.sourceFingerprint,
    sourceMessageIds: input.payload.messageIds,
    sourceEpisodeIds: [],
    sourceMessages: input.payload.sourceMessages ?? [],
    sourceEpisodes: [],
    boundaryReason: "scene_conclusion",
    supersedesMemoryId: null,
    projectionMemoryId: input.memoryId,
    followUp: "arc_enqueue",
    parentArcJobId: null,
    lastError: null,
    connectionId: input.connectionId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  return storage.create<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION, job);
}

async function settleSceneArcFollowUp(
  dependencies: StoryConsolidationDependencies,
  followUp: StoryProjectionJob,
  input: { chatId: string; connectionId?: string | null; provider?: string | null; model?: string | null },
  now: string,
): Promise<void> {
  const { storage } = dependencies;
  const updateFollowUp = async (patch: Record<string, unknown>) => {
    try {
      await storage.update(STORY_CONSOLIDATION_JOBS_COLLECTION, followUp.id, patch);
    } catch (error) {
      console.warn("[story-consolidation] scene arc follow-up update failed; pending intent retained", error);
    }
  };
  try {
    const arcJob = await enqueueStoryArcJob(storage, input, now);
    if (!arcJob) {
      await updateFollowUp({
        status: "retryable",
        followUp: "arc_enqueue",
        parentArcJobId: null,
        staleReason: null,
        lastError: "Parent arc is not currently eligible",
        nextAttemptAt: retryAt(now, 1),
        updatedAt: now,
      });
    } else {
      await updateFollowUp({
        status: "completed",
        followUp: null,
        parentArcJobId: arcJob.id,
        lastError: null,
        nextAttemptAt: null,
        completedAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    await updateFollowUp({
      status: "retryable",
      followUp: "arc_enqueue",
      parentArcJobId: null,
      lastError: error instanceof Error ? error.message : String(error),
      nextAttemptAt: retryAt(now, 1),
      updatedAt: now,
    });
  }
  scheduleStoryConsolidationQueueProcessing(dependencies);
}

async function completedSceneArcFollowUpIsMaterialized(
  storage: StorageGateway,
  followUp: StoryProjectionJob,
): Promise<boolean> {
  const parentArcJobId = followUp.parentArcJobId?.trim();
  const projectionMemoryId = followUp.projectionMemoryId?.trim();
  if (followUp.status !== "completed" || !parentArcJobId || !projectionMemoryId) return false;
  const parent = await storage.get<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION, parentArcJobId);
  return Boolean(
    parent &&
      parent.id === parentArcJobId &&
      parent.level === "arc" &&
      parent.ownerChatId === followUp.ownerChatId &&
      parent.sourceEpisodeIds.includes(projectionMemoryId),
  );
}

function citation(value: unknown, allowedMessageIds: Set<string>, allowedEpisodeIds: Set<string>): StoryProjectionCitation | null {
  const record = parseRecord(value);
  const text = readString(record.text).trim();
  if (!text) return null;
  const sourceMessageIds = parseArray(record.sourceMessageIds)
    .map((entry) => readString(entry).trim())
    .filter((id) => allowedMessageIds.has(id));
  const sourceEpisodeIds = parseArray(record.sourceEpisodeIds)
    .map((entry) => readString(entry).trim())
    .filter((id) => allowedEpisodeIds.has(id));
  if (allowedMessageIds.size > 0 && sourceMessageIds.length === 0) return null;
  if (allowedEpisodeIds.size > 0 && sourceEpisodeIds.length === 0) return null;
  return {
    text,
    ...(sourceMessageIds.length ? { sourceMessageIds } : {}),
    ...(sourceEpisodeIds.length ? { sourceEpisodeIds } : {}),
  };
}

function parseSummary(raw: string, job: StoryProjectionJob): StructuredStorySummary {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(unfenced) as unknown;
  const record = parseRecord(value);
  const title = readString(record.title).trim();
  const summary = readString(record.summary).trim();
  if (!title || !summary) throw new Error("Story summarizer returned an incomplete result");
  const rawSections = parseRecord(record.sections);
  const allowedMessageIds = new Set(job.sourceMessageIds);
  const allowedEpisodeIds = new Set(job.sourceEpisodeIds);
  const section = (key: keyof StoryProjectionSections) =>
    parseArray(rawSections[key])
      .map((entry) => citation(entry, allowedMessageIds, allowedEpisodeIds))
      .filter((entry): entry is StoryProjectionCitation => entry !== null);
  const sections: StoryProjectionSections = {
    events: section("events"),
    choices: section("choices"),
    relationshipShifts: section("relationshipShifts"),
    promises: section("promises"),
    reveals: section("reveals"),
    unresolvedHooks: section("unresolvedHooks"),
    currentState: section("currentState"),
  };
  if (Object.values(sections).every((entries) => entries.length === 0)) {
    throw new Error("Story summarizer returned no source-backed details");
  }
  return { title, summary, sections };
}

function summarizerPrompt(job: StoryProjectionJob): string {
  const sources =
    job.level === "episode"
      ? job.sourceMessages.map((message) => `[${message.id}] ${message.role}: ${message.content}`).join("\n\n")
      : job.sourceEpisodes.map((episode) => `[${episode.id}] ${episode.title ?? "Episode"}: ${episode.content}`).join("\n\n");
  const citationField = job.level === "episode" ? "sourceMessageIds" : "sourceEpisodeIds";
  return [
    `Create a source-grounded ${job.level} projection for long-form roleplay continuity.`,
    "Return JSON only with title, summary, and sections.",
    "sections must contain arrays named events, choices, relationshipShifts, promises, reveals, unresolvedHooks, and currentState.",
    `Every section item must be {"text": string, "${citationField}": string[]} and cite only IDs shown below.`,
    "Capture concrete events and current state without inventing facts. Narrative projections are not authoritative over atomic memories.",
    "Keep summary readable, third-person, and under 260 words.",
    "",
    sources,
  ].join("\n");
}

async function currentSourcesStillMatch(storage: StorageGateway, job: StoryProjectionJob): Promise<boolean> {
  if (job.level === "episode") {
    if (typeof storage.getChatMessage !== "function") return false;
    const current = [];
    let priorTimestamp = Number.NEGATIVE_INFINITY;
    for (const snapshot of job.sourceMessages) {
      const row = await storage.getChatMessage<JsonRecord>(snapshot.id).catch(() => null);
      if (!row) return false;
      const next = sourceSnapshot(row);
      const timestamp = next.createdAt ? Date.parse(next.createdAt) : priorTimestamp;
      if (Number.isFinite(timestamp) && timestamp < priorTimestamp) return false;
      if (Number.isFinite(timestamp)) priorTimestamp = timestamp;
      current.push(next);
    }
    return (await sourceFingerprint(current)) === job.sourceFingerprint;
  }

  const memories = await storyMemories(storage, job.ownerChatId);
  if (job.sourceEpisodes.length !== job.sourceEpisodeIds.length) return false;
  const currentEpisodes = [];
  for (const snapshot of job.sourceEpisodes) {
    const memory = memories.find((candidate) => candidate.id === snapshot.id);
    const payload = memory ? storyPayload(memory) : null;
    if (
      !memory ||
      !payload ||
      payload.level !== "episode" ||
      (memory.status !== "active" && memory.status !== "pinned") ||
      !job.sourceEpisodeIds.includes(memory.id) ||
      payload.messageIds.join("\u001f") !== snapshot.messageIds.join("\u001f")
    ) {
      return false;
    }
    currentEpisodes.push({ id: memory.id, content: memory.content });
  }
  const fingerprint = await sha256MemoryId(
    "story-source",
    currentEpisodes.map((episode) => `${episode.id}\u001f${episode.content}`).join("\u001e"),
  );
  return fingerprint === job.sourceFingerprint;
}

function due(job: StoryProjectionJob, now: string): boolean {
  if (job.status === "pending") return true;
  if (job.status === "processing") {
    return Date.parse(job.updatedAt) + ABANDONED_PROCESSING_MS <= Date.parse(now);
  }
  if (job.status !== "retryable") return false;
  return !job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= Date.parse(now);
}

async function withStoryLeaseHeartbeat<T>(storage: StorageGateway, leaseId: string, operation: () => Promise<T>): Promise<T> {
  if (!storage.acquireStoryConsolidationWorker) return operation();
  let leaseError: unknown = null;
  let inFlight: Promise<void> | null = null;
  const renew = () => {
    if (inFlight) return inFlight;
    inFlight = storage
      .acquireStoryConsolidationWorker!(workerId, leaseId)
      .then((renewed) => {
        if (renewed !== leaseId) throw new Error("Story consolidation worker lease was lost");
      })
      .catch((error: unknown) => {
        leaseError = error;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
  const timer = setInterval(() => void renew(), LEASE_HEARTBEAT_MS);
  try {
    const value = await operation();
    await renew();
    if (leaseError) throw leaseError;
    return value;
  } finally {
    clearInterval(timer);
    if (inFlight) await inFlight;
  }
}

function retryAt(now: string, attempts: number): string {
  return new Date(Date.parse(now) + RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]!).toISOString();
}

function terminalStoryError(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}

function assertProjectionOverlapAllowed(
  job: Pick<StoryProjectionJob, "level" | "sourceMessageIds" | "sourceEpisodeIds" | "supersedesMemoryId" | "coverageId">,
  input: CanonicalMemoryInput,
  memories: CanonicalMemoryRecord[],
): void {
  const sourceIds = new Set(job.level === "episode" ? job.sourceMessageIds : job.sourceEpisodeIds);
  const conflicts = memories.filter((memory) => {
    if (memory.id === input.id || (memory.status !== "active" && memory.status !== "pinned")) return false;
    const candidate = storyPayload(memory);
    if (!candidate || candidate.level !== job.level) return false;
    const candidateIds = job.level === "episode" ? candidate.messageIds : candidate.sourceEpisodeIds;
    return candidateIds.some((id) => sourceIds.has(id));
  });
  if (conflicts.length === 0) return;
  const validReplacement =
    conflicts.length === 1 &&
    conflicts[0]!.id === job.supersedesMemoryId &&
    storyPayload(conflicts[0]!)?.coverageId === job.coverageId;
  if (!validReplacement) throw terminalStoryError("Story projection coverage overlaps an active story slot");
}

async function projectionInput(job: StoryProjectionJob, summary: StructuredStorySummary, now: string): Promise<CanonicalMemoryInput> {
  const id = await sha256MemoryId(
    `story-${job.level}`,
    `${STORY_SUMMARIZER_VERSION}\u001f${job.coverageId}\u001f${job.sourceFingerprint}`,
  );
  const payload: StoryProjectionPayload = {
    storyProjectionVersion: STORY_PROJECTION_VERSION,
    level: job.level,
    ownerChatId: job.ownerChatId,
    coverageId: job.coverageId,
    sourceFingerprint: job.sourceFingerprint,
    messageIds: job.sourceMessageIds,
    sourceMessages: job.sourceMessages,
    firstMessageId: job.sourceMessageIds[0] ?? "",
    lastMessageId: job.sourceMessageIds.at(-1) ?? "",
    boundaryReason: job.boundaryReason ?? null,
    sourceEpisodeIds: job.sourceEpisodeIds,
    sections: summary.sections,
    summarizer: {
      version: STORY_SUMMARIZER_VERSION,
      connectionId: job.connectionId ?? null,
      provider: job.provider ?? null,
      model: job.model ?? null,
      completedAt: now,
    },
  };
  return {
    id,
    kind: job.level === "episode" ? "episode" : "summary",
    status: "active",
    scope: { kind: "chat", id: job.ownerChatId },
    title: summary.title,
    content: summary.summary,
    confidence: 0.9,
    provenance: {
      sourceChatId: job.ownerChatId,
      messageIds: job.sourceMessageIds,
      sceneId: job.boundaryReason === "scene_conclusion" ? job.ownerChatId : null,
      timestamp: now,
    },
    tags: ["story-continuity", job.level],
    supersedesMemoryId: job.supersedesMemoryId ?? null,
    payload,
    createdAt: now,
    updatedAt: now,
  };
}

export async function processStoryConsolidationQueue(
  dependencies: StoryConsolidationDependencies,
  options: { now?: string } = {},
): Promise<{ leaseAcquired: boolean; processed: number; completed: number; retryable: number; failed: number; stale: number }> {
  const result = { leaseAcquired: false, processed: 0, completed: 0, retryable: 0, failed: 0, stale: 0 };
  const { storage, llm } = dependencies;
  if (!storage.acquireStoryConsolidationWorker || !storage.releaseStoryConsolidationWorker || !storage.createMemory) {
    return result;
  }
  const leaseId = await storage.acquireStoryConsolidationWorker(workerId);
  if (!leaseId) return result;
  result.leaseAcquired = true;
  const now = options.now ?? nowIso();
  const updateJob = (jobId: string, patch: Record<string, unknown>) =>
    storage.updateStoryConsolidationJob
      ? storage.updateStoryConsolidationJob(leaseId, jobId, patch)
      : storage.update(STORY_CONSOLIDATION_JOBS_COLLECTION, jobId, patch);
  try {
    const jobs = (await storage.list<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION))
      .filter((job) => due(job, now))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, 1);
    for (const job of jobs) {
      if (foregroundGenerationActive(storage)) break;
      result.processed += 1;
      const attempts = job.attempts + 1;
      await updateJob(job.id, {
        status: "processing",
        attempts,
        updatedAt: now,
      });
      try {
        if (job.followUp === "arc_enqueue") {
          const arcJob = await enqueueStoryArcJob(storage, {
            chatId: job.ownerChatId,
            connectionId: job.connectionId ?? null,
            provider: job.provider ?? null,
            model: job.model ?? null,
          });
          if (!arcJob) {
            const terminal = attempts >= job.maxAttempts;
            await updateJob(job.id, {
              status: terminal ? "failed" : "retryable",
              followUp: "arc_enqueue",
              parentArcJobId: null,
              lastError: "Parent arc is not currently eligible",
              nextAttemptAt: terminal ? null : retryAt(now, attempts),
              updatedAt: now,
            });
            if (terminal) result.failed += 1;
            else result.retryable += 1;
            continue;
          }
          await updateJob(job.id, {
            status: "completed",
            followUp: null,
            parentArcJobId: arcJob.id,
            lastError: null,
            nextAttemptAt: null,
            completedAt: now,
            updatedAt: now,
          });
          result.completed += 1;
          continue;
        }
        if (!(await currentSourcesStillMatch(storage, job))) {
          await updateJob(job.id, {
            status: "stale",
            staleReason: "source_content_changed",
            updatedAt: now,
          });
          result.stale += 1;
          continue;
        }
        const structured = parseSummary(
          await withStoryLeaseHeartbeat(storage, leaseId, () =>
            completeStorySummary(llm, {
              connectionId: job.connectionId ?? null,
              model: job.model ?? null,
              messages: [
                { role: "system", content: "You produce auditable long-form story continuity as strict JSON." },
                { role: "user", content: summarizerPrompt(job) },
              ],
            }),
          ),
          job,
        );
        const input = await projectionInput(job, structured, now);
        const currentMemories = await storyMemories(storage, job.ownerChatId);
        assertProjectionOverlapAllowed(job, input, currentMemories);
        let created: CanonicalMemoryRecord;
        if (storage.commitStoryProjection) {
          created = (await storage.commitStoryProjection(leaseId, job.id, input)).memory;
        } else {
          const existing = currentMemories.find((memory) => memory.id === input.id);
          created = existing ?? (await storage.createMemory(input));
          if (job.supersedesMemoryId && storage.updateMemory) {
            await storage.updateMemory(job.supersedesMemoryId, {
              status: "superseded",
              supersededByMemoryId: created.id,
            });
          }
          await storage.rebuildMemoryIndex?.({ scope: { kind: "chat", id: job.ownerChatId } }).catch(() => undefined);
          await updateJob(job.id, {
            status: "completed",
            projectionMemoryId: created.id,
            completedAt: now,
            nextAttemptAt: null,
            updatedAt: now,
          });
        }
        if (job.level === "episode") {
          try {
            await enqueueStoryArcJob(storage, {
              chatId: job.ownerChatId,
              connectionId: job.connectionId ?? null,
              provider: job.provider ?? null,
              model: job.model ?? null,
            });
          } catch (error) {
            const terminal = isTerminalBackgroundGenerationError(error) || attempts >= job.maxAttempts;
            await updateJob(job.id, {
              status: terminal ? "failed" : "retryable",
              followUp: "arc_enqueue",
              projectionMemoryId: created.id,
              lastError: error instanceof Error ? error.message : String(error),
              nextAttemptAt: terminal ? null : retryAt(now, attempts),
              updatedAt: now,
            });
            if (terminal) result.failed += 1;
            else result.retryable += 1;
            continue;
          }
        }
        result.completed += 1;
      } catch (error) {
        const terminal = isTerminalBackgroundGenerationError(error) || attempts >= job.maxAttempts;
        await updateJob(job.id, {
          status: terminal ? "failed" : "retryable",
          lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAt: terminal ? null : retryAt(now, attempts),
          updatedAt: now,
        });
        if (terminal) result.failed += 1;
        else result.retryable += 1;
      }
    }
    return result;
  } finally {
    await storage.releaseStoryConsolidationWorker(workerId, leaseId).catch(() => undefined);
  }
}

export function scheduleStoryConsolidationQueueProcessing(dependencies: StoryConsolidationDependencies): void {
  if (activeWorkers.has(dependencies.storage)) return;
  activeWorkers.add(dependencies.storage);
  setTimeout(() => {
    void (async () => {
      for (let processed = 0; processed < 100; processed += 1) {
        const result = await processStoryConsolidationQueue(dependencies);
        if (!result.leaseAcquired || result.processed === 0 || result.retryable > 0 || result.failed > 0) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    })()
      .catch((error) => console.warn("[story-consolidation] queue worker stopped", error))
      .finally(() => activeWorkers.delete(dependencies.storage));
  }, 0);
}

export async function enqueueAndScheduleStoryEpisode(
  dependencies: StoryConsolidationDependencies,
  input: StoryEpisodeScheduleInput,
): Promise<StoryProjectionJob | null> {
  const job = await enqueueStoryEpisodeJob(dependencies.storage, input);
  if (job) scheduleStoryConsolidationQueueProcessing(dependencies);
  return job;
}

/**
 * Reuses a formal scene's already-generated visible conclusion summary as its
 * canonical episode. No second model call is made for the same scene.
 */
export async function persistCompletedSceneStoryEpisode(
  dependencies: StoryConsolidationDependencies,
  input: {
    ownerChatId: string;
    sceneChatId: string;
    messages: JsonRecord[];
    summary: string;
    sections?: Partial<Record<keyof StoryProjectionSections, string[]>>;
    connectionId?: string | null;
    provider?: string | null;
    model?: string | null;
    now?: string;
  },
): Promise<CanonicalMemoryRecord | null> {
  const { storage } = dependencies;
  if (!storage.createMemory || !input.ownerChatId.trim() || !input.summary.trim()) return null;
  const sourceMessages = eligibleStoryMessages(input.messages).map(sourceSnapshot);
  if (sourceMessages.length === 0) return null;
  const messageIds = sourceMessages.map((message) => message.id);
  const fingerprint = await sourceFingerprint(sourceMessages);
  const stableCoverageId = await coverageId(input.ownerChatId, messageIds);
  const id = await sha256MemoryId(
    "story-episode",
    `${STORY_SUMMARIZER_VERSION}\u001f${stableCoverageId}\u001f${fingerprint}`,
  );
  const now = input.now ?? nowIso();
  const existingMemories = await storyMemories(storage, input.ownerChatId);
  const existing = existingMemories.find((memory) => memory.id === id);
  const citations = (key: keyof StoryProjectionSections): StoryProjectionCitation[] =>
    (input.sections?.[key] ?? [])
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ text, sourceMessageIds: messageIds }));
  const structuredSections: StoryProjectionSections = {
    events: citations("events"),
    choices: citations("choices"),
    relationshipShifts: citations("relationshipShifts"),
    promises: citations("promises"),
    reveals: citations("reveals"),
    unresolvedHooks: citations("unresolvedHooks"),
    currentState: citations("currentState"),
  };
  if (Object.values(structuredSections).every((entries) => entries.length === 0)) {
    const citation: StoryProjectionCitation = { text: input.summary.trim(), sourceMessageIds: messageIds };
    structuredSections.events = [citation];
    structuredSections.currentState = [citation];
  }
  const payload: StoryProjectionPayload = {
    storyProjectionVersion: STORY_PROJECTION_VERSION,
    level: "episode",
    ownerChatId: input.ownerChatId,
    coverageId: stableCoverageId,
    sourceFingerprint: fingerprint,
    messageIds,
    sourceMessages,
    firstMessageId: messageIds[0]!,
    lastMessageId: messageIds.at(-1)!,
    boundaryReason: "scene_conclusion",
    sourceEpisodeIds: [],
    sections: structuredSections,
    summarizer: {
      version: STORY_SUMMARIZER_VERSION,
      connectionId: input.connectionId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      completedAt: now,
    },
  };
  const memoryInput: CanonicalMemoryInput = {
    id,
    kind: "episode",
    status: "active",
    scope: { kind: "chat", id: input.ownerChatId },
    title: `Scene: ${input.summary.trim().split(/[.!?]/, 1)[0]!.slice(0, 90)}`,
    content: input.summary.trim(),
    confidence: 0.9,
    provenance: {
      sourceChatId: input.ownerChatId,
      sceneId: input.sceneChatId,
      messageIds,
      timestamp: now,
    },
    tags: ["story-continuity", "episode", "formal-scene"],
    payload,
    createdAt: now,
    updatedAt: now,
  };
  const syntheticJob: Pick<
    StoryProjectionJob,
    "level" | "sourceMessageIds" | "sourceEpisodeIds" | "supersedesMemoryId" | "coverageId"
  > = {
    level: "episode",
    sourceMessageIds: messageIds,
    sourceEpisodeIds: [],
    supersedesMemoryId: null,
    coverageId: stableCoverageId,
  };
  if (!existing) assertProjectionOverlapAllowed(syntheticJob, memoryInput, existingMemories);
  const prospectiveMemories = existing
    ? existingMemories
    : [...existingMemories, memoryInput as CanonicalMemoryRecord];
  if (!storyArcCoveragePlan(prospectiveMemories, input.ownerChatId)) {
    if (existing) return existing;
    const created = await storage.createMemory(memoryInput);
    await storage.rebuildMemoryIndex?.({ scope: { kind: "chat", id: input.ownerChatId } }).catch(() => undefined);
    return created;
  }
  const ensureAndSettleFollowUp = async () => {
    const followUp = await ensureSceneArcFollowUpJob(
      storage,
      {
        memoryId: id,
        payload,
        connectionId: input.connectionId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
      },
      now,
    );
    if (await completedSceneArcFollowUpIsMaterialized(storage, followUp)) return;
    await settleSceneArcFollowUp(
      dependencies,
      followUp,
      {
        chatId: input.ownerChatId,
        connectionId: input.connectionId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
      },
      now,
    );
  };
  if (existing) {
    await ensureAndSettleFollowUp();
    return existing;
  }
  const created = await storage.createMemory(memoryInput);
  await storage.rebuildMemoryIndex?.({ scope: { kind: "chat", id: input.ownerChatId } }).catch(() => undefined);
  await ensureAndSettleFollowUp();
  return created;
}
