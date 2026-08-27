import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryInput, CanonicalMemoryRecord, StoryProjectionJob } from "../contracts/types/memory";
import {
  enqueueStoryArcJob,
  enqueueStoryEpisodeJob,
  processStoryConsolidationQueue,
  STORY_CONSOLIDATION_JOBS_COLLECTION,
} from "./story-consolidation-queue";

function sourceMessage(index: number) {
  return {
    id: `message-${index}`,
    chatId: "chat-1",
    role: index % 2 === 0 ? "assistant" : "user",
    content: `Story beat ${index}`,
    createdAt: `2026-08-27T00:${String(index).padStart(2, "0")}:00.000Z`,
  };
}

function harness() {
  const jobs = new Map<string, StoryProjectionJob>();
  const memories = new Map<string, CanonicalMemoryRecord>();
  const storeMemory = async (body: CanonicalMemoryInput) => {
    const record = {
      ...body,
      id: String(body.id),
      status: body.status ?? "active",
      title: body.title ?? null,
      tags: body.tags ?? [],
      supersedesMemoryId: body.supersedesMemoryId ?? null,
      supersededByMemoryId: body.supersededByMemoryId ?? null,
      payload: body.payload ?? {},
      createdAt: body.createdAt ?? "2026-08-27T01:00:00.000Z",
      updatedAt: body.updatedAt ?? "2026-08-27T01:00:00.000Z",
    } as CanonicalMemoryRecord;
    memories.set(record.id, record);
    return record;
  };
  const storage = {
    async list(entity: string) {
      if (entity === STORY_CONSOLIDATION_JOBS_COLLECTION) return Array.from(jobs.values());
      return [];
    },
    async get(entity: string, id: string) {
      if (entity === STORY_CONSOLIDATION_JOBS_COLLECTION) return jobs.get(id) ?? null;
      return null;
    },
    async create(entity: string, body: Record<string, unknown>) {
      if (entity !== STORY_CONSOLIDATION_JOBS_COLLECTION) throw new Error(`unexpected collection ${entity}`);
      jobs.set(String(body.id), body as StoryProjectionJob);
      return body;
    },
    async update(entity: string, id: string, patch: Record<string, unknown>) {
      if (entity !== STORY_CONSOLIDATION_JOBS_COLLECTION) throw new Error(`unexpected collection ${entity}`);
      const next = { ...jobs.get(id), ...patch } as StoryProjectionJob;
      jobs.set(id, next);
      return next;
    },
    async queryMemories() {
      return Array.from(memories.values());
    },
    async createMemory(body: CanonicalMemoryInput) {
      return storeMemory(body);
    },
    async updateMemory(memoryId: string, patch: Partial<CanonicalMemoryRecord>) {
      const next = { ...memories.get(memoryId)!, ...patch, updatedAt: "2026-08-27T01:00:00.000Z" };
      memories.set(memoryId, next);
      return next;
    },
    async rebuildMemoryIndex() {
      return { rebuilt: 1 };
    },
    async acquireStoryConsolidationWorker() {
      return "lease-1";
    },
    async releaseStoryConsolidationWorker() {},
    async updateStoryConsolidationJob(leaseId: string, id: string, patch: Record<string, unknown>) {
      if (leaseId !== "lease-1") throw Object.assign(new Error("lease lost"), { code: "memory_capture_lease_lost" });
      const next = { ...jobs.get(id), ...patch } as StoryProjectionJob;
      jobs.set(id, next);
      return next;
    },
    async commitStoryProjection(leaseId: string, jobId: string, body: CanonicalMemoryInput) {
      if (leaseId !== "lease-1") throw Object.assign(new Error("lease lost"), { code: "memory_capture_lease_lost" });
      const record = await storeMemory(body);
      if (body.supersedesMemoryId) {
        const old = memories.get(body.supersedesMemoryId);
        if (old) memories.set(old.id, { ...old, status: "superseded", supersededByMemoryId: record.id });
      }
      const job = { ...jobs.get(jobId), status: "completed", projectionMemoryId: record.id } as StoryProjectionJob;
      jobs.set(jobId, job);
      return { memory: record, job };
    },
  } as unknown as StorageGateway;
  return { storage, jobs, memories };
}

function llmResult(): string {
  const cited = [{ text: "A concrete story beat occurred.", sourceMessageIds: ["message-1"] }];
  return JSON.stringify({
    title: "The First Turn",
    summary: "The characters crossed a threshold and left one question unresolved.",
    sections: {
      events: cited,
      choices: [],
      relationshipShifts: [],
      promises: [],
      reveals: [],
      unresolvedHooks: cited,
      currentState: cited,
    },
  });
}

describe("story consolidation queue", () => {
  it("enqueues one deterministic idempotent job for the same covered range", async () => {
    const test = harness();
    const input = {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: Array.from({ length: 24 }, (_, index) => sourceMessage(index + 1)),
      connectionId: "connection-1",
      model: "model-1",
    };

    const first = await enqueueStoryEpisodeJob(test.storage, input);
    const second = await enqueueStoryEpisodeJob(test.storage, input);

    expect(first?.id).toBe(second?.id);
    expect(test.jobs).toHaveLength(1);
    expect(first?.sourceMessageIds).toEqual(input.messages.map((message) => message.id));
  });

  it("lets explicit backfill run when automatic consolidation is opted out", async () => {
    const test = harness();
    const input = {
      chat: { id: "chat-1", mode: "roleplay", metadata: { enableStoryConsolidation: false } },
      messages: Array.from({ length: 24 }, (_, index) => sourceMessage(index + 1)),
    };

    await expect(enqueueStoryEpisodeJob(test.storage, input)).resolves.toBeNull();
    await expect(enqueueStoryEpisodeJob(test.storage, { ...input, explicit: true })).resolves.toEqual(
      expect.objectContaining({ level: "episode" }),
    );
  });

  it("writes a source-backed canonical episode and completes the job", async () => {
    const test = harness();
    const job = await enqueueStoryEpisodeJob(test.storage, {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: Array.from({ length: 24 }, (_, index) => sourceMessage(index + 1)),
      connectionId: "connection-1",
      model: "model-1",
    });
    const llm = { complete: vi.fn(async () => llmResult()) } as unknown as LlmGateway;

    const result = await processStoryConsolidationQueue({ storage: test.storage, llm }, { now: "2026-08-27T01:00:00.000Z" });

    expect(result).toEqual({ leaseAcquired: true, processed: 1, completed: 1, retryable: 0, failed: 0, stale: 0 });
    expect(test.jobs.get(String(job?.id))?.status).toBe("completed");
    expect(Array.from(test.memories.values())).toEqual([
      expect.objectContaining({
        kind: "episode",
        status: "active",
        scope: { kind: "chat", id: "chat-1" },
        provenance: expect.objectContaining({ messageIds: job?.sourceMessageIds }),
        payload: expect.objectContaining({
          storyProjectionVersion: 1,
          level: "episode",
          coverageId: job?.coverageId,
        }),
      }),
    ]);
  });

  it("keeps a failed summarization retryable without writing a partial projection", async () => {
    const test = harness();
    const job = await enqueueStoryEpisodeJob(test.storage, {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: Array.from({ length: 24 }, (_, index) => sourceMessage(index + 1)),
    });
    const llm = { complete: vi.fn(async () => Promise.reject(new Error("temporary network failure"))) } as unknown as LlmGateway;

    const result = await processStoryConsolidationQueue({ storage: test.storage, llm }, { now: "2026-08-27T01:00:00.000Z" });

    expect(result.retryable).toBe(1);
    expect(test.jobs.get(String(job?.id))?.status).toBe("retryable");
    expect(test.memories.size).toBe(0);
  });

  it("does not summarize or write when the worker loses its lease before processing", async () => {
    const test = harness();
    await enqueueStoryEpisodeJob(test.storage, {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: Array.from({ length: 24 }, (_, index) => sourceMessage(index + 1)),
    });
    test.storage.updateStoryConsolidationJob = vi.fn(async () => {
      throw Object.assign(new Error("lease lost"), { code: "memory_capture_lease_lost" });
    });
    const llm = { complete: vi.fn(async () => llmResult()) } as unknown as LlmGateway;

    await expect(
      processStoryConsolidationQueue({ storage: test.storage, llm }, { now: "2026-08-27T01:00:00.000Z" }),
    ).rejects.toThrow("lease lost");
    expect(llm.complete).not.toHaveBeenCalled();
    expect(test.memories.size).toBe(0);
  });

  it("enqueues one arc from four active consecutive episode projections", async () => {
    const test = harness();
    for (let index = 0; index < 4; index += 1) {
      const first = index * 2 + 1;
      await test.storage.createMemory?.({
        id: `episode-${index + 1}`,
        kind: "episode",
        status: "active",
        scope: { kind: "chat", id: "chat-1" },
        title: `Episode ${index + 1}`,
        content: `Episode ${index + 1} summary`,
        confidence: 0.9,
        provenance: { sourceChatId: "chat-1", messageIds: [`message-${first}`, `message-${first + 1}`] },
        tags: ["story-continuity", "episode"],
        payload: {
          storyProjectionVersion: 1,
          level: "episode",
          ownerChatId: "chat-1",
          coverageId: `coverage-${index + 1}`,
          sourceFingerprint: `fingerprint-${index + 1}`,
          messageIds: [`message-${first}`, `message-${first + 1}`],
          sourceMessages: [
            { id: `message-${first}`, role: "user", content: `Story beat ${first}`, createdAt: `2026-08-27T0${index}:00:00.000Z` },
          ],
          firstMessageId: `message-${first}`,
          lastMessageId: `message-${first + 1}`,
          sourceEpisodeIds: [],
          sections: {
            events: [],
            choices: [],
            relationshipShifts: [],
            promises: [],
            reveals: [],
            unresolvedHooks: [],
            currentState: [],
          },
          summarizer: { version: "story-projection-v1", completedAt: `2026-08-27T0${index}:00:00.000Z` },
        },
        createdAt: index === 1 ? "2026-08-28T00:00:00.000Z" : `2026-08-27T0${index}:00:00.000Z`,
        updatedAt: `2026-08-27T0${index}:00:00.000Z`,
      });
    }

    const job = await enqueueStoryArcJob(test.storage, { chatId: "chat-1" });

    expect(job?.level).toBe("arc");
    expect(job?.sourceEpisodeIds).toEqual(["episode-1", "episode-2", "episode-3", "episode-4"]);
    expect(job?.sourceMessageIds).toEqual(Array.from({ length: 8 }, (_, index) => `message-${index + 1}`));
  });

  it("rejects overlapping active episode coverage without replacing the valid projection", async () => {
    const test = harness();
    const job = await enqueueStoryEpisodeJob(test.storage, {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: Array.from({ length: 24 }, (_, index) => sourceMessage(index + 1)),
    });
    await test.storage.createMemory?.({
      id: "existing-episode",
      kind: "episode",
      status: "active",
      scope: { kind: "chat", id: "chat-1" },
      content: "The valid existing episode.",
      confidence: 0.9,
      provenance: { sourceChatId: "chat-1", messageIds: ["message-1"] },
      tags: ["story-continuity", "episode"],
      payload: {
        storyProjectionVersion: 1, level: "episode", ownerChatId: "chat-1", coverageId: "different-slot",
        sourceFingerprint: "old", messageIds: ["message-1"], firstMessageId: "message-1", lastMessageId: "message-1",
        sourceEpisodeIds: [], sections: { events: [], choices: [], relationshipShifts: [], promises: [], reveals: [], unresolvedHooks: [], currentState: [] },
        summarizer: { version: "story-projection-v1", completedAt: "2026-08-27T00:00:00Z" },
      },
    });
    const result = await processStoryConsolidationQueue(
      { storage: test.storage, llm: { complete: vi.fn(async () => llmResult()) } as unknown as LlmGateway },
      { now: "2026-08-27T01:00:00.000Z" },
    );
    expect(result.failed).toBe(1);
    expect(test.jobs.get(String(job?.id))?.status).toBe("failed");
    expect(test.memories.get("existing-episode")?.status).toBe("active");
    expect(test.memories).toHaveLength(1);
  });
});
