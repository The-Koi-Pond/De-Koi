import type { CanonicalMemoryRecord, StoryProjectionJob, StoryProjectionPayload } from "../../engine/contracts/types/memory";
import {
  enqueueAndScheduleStoryEpisode,
  enqueueStoryEpisodeJob,
  processStoryConsolidationQueue,
  STORY_CONSOLIDATION_JOBS_COLLECTION,
} from "../../engine/generation/story-consolidation-queue";
import { parseRecord, readString, type JsonRecord } from "../../engine/generation/runtime-records";
import { llmApi } from "./llm-api";
import { storageApi } from "./storage-api";

export interface StoryContinuityState {
  chat: JsonRecord;
  messages: JsonRecord[];
  projections: CanonicalMemoryRecord[];
  jobs: StoryProjectionJob[];
}

function isStoryProjection(memory: CanonicalMemoryRecord): boolean {
  return parseRecord(memory.payload).storyProjectionVersion === 1;
}

async function generationIdentity(chat: JsonRecord) {
  const connectionId = readString(chat.connectionId).trim() || null;
  const connection = connectionId ? await storageApi.get<JsonRecord>("connections", connectionId).catch(() => null) : null;
  return {
    connectionId,
    provider: readString(connection?.provider).trim() || null,
    model: readString(connection?.model).trim() || null,
  };
}

async function loadSources(chatId: string) {
  const chat = await storageApi.get<JsonRecord>("chats", chatId);
  if (!chat) throw new Error("Chat not found");
  const messages = await storageApi.listChatMessages<JsonRecord>(chatId);
  return { chat, messages, ...(await generationIdentity(chat)) };
}

export const storyContinuityApi = {
  async getState(chatId: string): Promise<StoryContinuityState> {
    const { chat, messages } = await loadSources(chatId);
    const [projections, jobs] = await Promise.all([
      storageApi.queryMemories?.({ scope: { kind: "chat", id: chatId }, includeInactive: true }) ?? [],
      storageApi.list<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION),
    ]);
    return {
      chat,
      messages,
      projections: projections.filter(isStoryProjection).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      jobs: jobs.filter((job) => job.ownerChatId === chatId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  },

  async closeEpisode(chatId: string) {
    const input = await loadSources(chatId);
    const job = await enqueueAndScheduleStoryEpisode(
      { storage: storageApi, llm: llmApi },
      { ...input, requestedBoundary: "manual" },
    );
    if (!job) throw new Error("An episode needs at least two uncovered messages and must end on an assistant reply.");
    return job;
  },

  async buildExistingStory(chatId: string): Promise<number> {
    let completed = 0;
    let closingTail = false;
    for (let episode = 0; episode < 500; episode += 1) {
      const input = await loadSources(chatId);
      let job = await enqueueStoryEpisodeJob(storageApi, { ...input, explicit: true });
      if (!job && !closingTail) {
        closingTail = true;
        job = await enqueueStoryEpisodeJob(storageApi, { ...input, explicit: true, requestedBoundary: "manual" });
      }
      if (!job) break;
      let status = job.status;
      for (let pass = 0; pass < 600 && status !== "completed"; pass += 1) {
        const result = await processStoryConsolidationQueue({ storage: storageApi, llm: llmApi });
        const refreshed = await storageApi.get<StoryProjectionJob>(STORY_CONSOLIDATION_JOBS_COLLECTION, job.id);
        status = refreshed?.status ?? status;
        if (status === "failed" || status === "retryable" || status === "stale") {
          throw new Error(refreshed?.lastError ? String(refreshed.lastError) : `Story job stopped as ${status}.`);
        }
        if (result.processed === 0 && status !== "completed") throw new Error("Story builder could not acquire its worker.");
      }
      if (status !== "completed") throw new Error("Story builder reached its safety limit.");
      completed += 1;
      if (closingTail) break;
    }
    return completed;
  },

  async edit(memoryId: string, content: string) {
    const memory = await storageApi.get<CanonicalMemoryRecord>("canonical-memories", memoryId);
    if (!memory || !isStoryProjection(memory)) throw new Error("Story projection not found");
    return storageApi.updateMemory?.(memoryId, { content: content.trim() });
  },

  async setPinned(memory: CanonicalMemoryRecord, pinned: boolean) {
    if (pinned && memory.status !== "active") throw new Error("Only active story projections can be pinned.");
    if (!pinned && memory.status !== "pinned") return memory;
    return storageApi.updateMemory?.(memory.id, { status: pinned ? "pinned" : "active" });
  },

  async supersede(memory: CanonicalMemoryRecord) {
    const updated = await storageApi.updateMemory?.(memory.id, { status: "superseded" });
    const story = memory.payload as StoryProjectionPayload;
    if (story.level === "episode") {
      const rows = await storageApi.queryMemories?.({ scope: memory.scope, includeInactive: true }) ?? [];
      await Promise.all(
        rows
          .filter((candidate) => {
            const payload = parseRecord(candidate.payload);
            return payload.storyProjectionVersion === 1 &&
              payload.level === "arc" &&
              (candidate.status === "active" || candidate.status === "pinned") &&
              Array.isArray(payload.sourceEpisodeIds) && payload.sourceEpisodeIds.includes(memory.id);
          })
          .map((arc) => storageApi.updateMemory?.(arc.id, { status: "stale" })),
      );
    }
    await storageApi.rebuildMemoryIndex?.({ scope: memory.scope });
    return updated;
  },

  async regenerate(chatId: string, memory: CanonicalMemoryRecord) {
    const input = await loadSources(chatId);
    const story = memory.payload as StoryProjectionPayload;
    const messages = await Promise.all(
      story.messageIds.map((messageId) => storageApi.getChatMessage<JsonRecord>(messageId).catch(() => null)),
    );
    const job = await enqueueAndScheduleStoryEpisode(
      { storage: storageApi, llm: llmApi },
      {
        ...input,
        messages: messages.filter((message): message is JsonRecord => message !== null),
        supersedesMemoryId: memory.id,
        explicit: true,
      },
    );
    if (!job) throw new Error("This projection cannot be regenerated.");
    return job;
  },

  async retry(job: StoryProjectionJob) {
    await storageApi.update(STORY_CONSOLIDATION_JOBS_COLLECTION, job.id, {
      status: "pending",
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      updatedAt: new Date().toISOString(),
    });
    return processStoryConsolidationQueue({ storage: storageApi, llm: llmApi });
  },
};
