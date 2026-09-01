import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryInput, CanonicalMemoryRecord, StoryProjectionJob } from "../contracts/types/memory";
import {
  enqueueStoryArcJob,
  enqueueStoryEpisodeJob,
  persistCompletedSceneStoryEpisode,
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

function episodeMemory(index: number, status: CanonicalMemoryRecord["status"] = "active"): CanonicalMemoryInput {
  const first = index * 2 - 1;
  return {
    id: `episode-${index}`,
    kind: "episode",
    status,
    scope: { kind: "chat", id: "chat-1" },
    title: `Episode ${index}`,
    content: `Episode ${index} summary`,
    confidence: 0.9,
    provenance: { sourceChatId: "chat-1", messageIds: [`message-${first}`, `message-${first + 1}`] },
    tags: ["story-continuity", "episode"],
    payload: {
      storyProjectionVersion: 1,
      level: "episode",
      ownerChatId: "chat-1",
      coverageId: `coverage-${index}`,
      sourceFingerprint: `fingerprint-${index}`,
      messageIds: [`message-${first}`, `message-${first + 1}`],
      sourceMessages: [
        {
          id: `message-${first}`,
          role: "user",
          content: `Story beat ${first}`,
          createdAt: `2026-08-27T0${index - 1}:00:00.000Z`,
        },
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
      summarizer: { version: "story-projection-v1", completedAt: `2026-08-27T0${index - 1}:00:00.000Z` },
    },
    createdAt: `2026-08-27T0${index - 1}:00:00.000Z`,
    updatedAt: `2026-08-27T0${index - 1}:00:00.000Z`,
  };
}

function harness() {
  const jobs = new Map<string, StoryProjectionJob>();
  const memories = new Map<string, CanonicalMemoryRecord>();
  let failArcCreate = false;
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
      if (failArcCreate && body.level === "arc") throw new Error("temporary arc enqueue failure");
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
    async getChatMessage(id: string) {
      const index = Number(id.replace("message-", ""));
      return Number.isFinite(index) ? sourceMessage(index) : null;
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
  return { storage, jobs, memories, setFailArcCreate: (value: boolean) => (failArcCreate = value) };
}

function llmResult(sourceId = "message-1"): string {
  const cited = [{ text: "A concrete story beat occurred.", sourceMessageIds: [sourceId] }];
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

  it("disables provider reasoning for bounded story projection JSON", async () => {
    const test = harness();
    await enqueueStoryEpisodeJob(test.storage, {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: Array.from({ length: 24 }, (_, index) => sourceMessage(index + 1)),
      connectionId: "connection-1",
      model: "model-1",
    });
    const llm = { complete: vi.fn(async () => llmResult()) } as unknown as LlmGateway;

    await processStoryConsolidationQueue({ storage: test.storage, llm }, { now: "2026-08-27T01:00:00.000Z" });

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          maxTokens: 1800,
          reasoningEffort: "none",
          reasoning_effort: "none",
          customParameters: {
            reasoning_effort: "none",
            reasoning: { exclude: true },
          },
        }),
      }),
    );
  });

  it.each([
    "Provider returned reasoning but no final assistant text.",
    "GLM 5.3 always thinks and does not support disabling reasoning.",
  ])("retries a forced-reasoning response without unsupported reasoning controls: %s", async (providerError) => {
    const test = harness();
    await enqueueStoryEpisodeJob(test.storage, {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: Array.from({ length: 24 }, (_, index) => sourceMessage(index + 1)),
      connectionId: "connection-1",
      model: "model-1",
    });
    const llm = {
      complete: vi.fn()
        .mockRejectedValueOnce(new Error(providerError))
        .mockResolvedValueOnce(llmResult()),
    } as unknown as LlmGateway;

    const result = await processStoryConsolidationQueue({ storage: test.storage, llm }, { now: "2026-08-27T01:00:00.000Z" });

    expect(result.completed).toBe(1);
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.complete).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parameters: { temperature: 0.25, maxTokens: 8192, reasoningEffort: "low", reasoning_effort: "low" },
    }));
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
      await test.storage.createMemory?.(episodeMemory(index + 1));
    }

    const job = await enqueueStoryArcJob(test.storage, { chatId: "chat-1" });

    expect(job?.level).toBe("arc");
    expect(job?.sourceEpisodeIds).toEqual(["episode-1", "episode-2", "episode-3", "episode-4"]);
    expect(job?.sourceMessageIds).toEqual(Array.from({ length: 8 }, (_, index) => `message-${index + 1}`));
  });

  it("does not let stale episode projections reserve message coverage", async () => {
    const test = harness();
    await test.storage.createMemory?.(episodeMemory(1, "stale"));

    const job = await enqueueStoryEpisodeJob(test.storage, {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: [sourceMessage(1), sourceMessage(2)],
      requestedBoundary: "manual",
    });

    expect(job?.sourceMessageIds).toEqual(["message-1", "message-2"]);
  });

  it("keeps active episode projections reserved", async () => {
    const test = harness();
    await test.storage.createMemory?.(episodeMemory(1));

    await expect(
      enqueueStoryEpisodeJob(test.storage, {
        chat: { id: "chat-1", mode: "roleplay", metadata: {} },
        messages: [sourceMessage(1), sourceMessage(2)],
        requestedBoundary: "manual",
      }),
    ).resolves.toBeNull();
  });

  it("rejects a deterministic arc job row with mismatched identity", async () => {
    const test = harness();
    for (let index = 1; index <= 4; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    const first = await enqueueStoryArcJob(test.storage, { chatId: "chat-1" });
    test.jobs.set(first!.id, { ...first!, level: "episode" });

    await expect(enqueueStoryArcJob(test.storage, { chatId: "chat-1" })).rejects.toThrow(
      "Story consolidation SHA-256 job id collision",
    );
  });

  it("stales an arc job before summarization when a source episode changes", async () => {
    const test = harness();
    for (let index = 1; index <= 4; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    const job = await enqueueStoryArcJob(test.storage, { chatId: "chat-1" });
    const changed = test.memories.get("episode-2")!;
    test.memories.set("episode-2", { ...changed, status: "superseded", content: "Changed after enqueue" });
    const llm = { complete: vi.fn(async () => llmResult()) } as unknown as LlmGateway;

    const result = await processStoryConsolidationQueue(
      { storage: test.storage, llm },
      { now: "2026-08-27T04:00:00.000Z" },
    );

    expect(result.stale).toBe(1);
    expect(test.jobs.get(job!.id)?.status).toBe("stale");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("records and retries a failed parent-arc enqueue after the episode commit", async () => {
    const test = harness();
    for (let index = 1; index <= 3; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    const episodeJob = await enqueueStoryEpisodeJob(test.storage, {
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      messages: Array.from({ length: 30 }, (_, index) => sourceMessage(index + 1)),
    });
    test.setFailArcCreate(true);
    const llm = { complete: vi.fn(async () => llmResult("message-7")) } as unknown as LlmGateway;

    const first = await processStoryConsolidationQueue(
      { storage: test.storage, llm },
      { now: "2026-08-27T04:00:00.000Z" },
    );

    expect(first.retryable).toBe(1);
    const retryJob = test.jobs.get(episodeJob!.id);
    expect(test.memories.has(String(retryJob?.projectionMemoryId))).toBe(true);
    expect(retryJob).toEqual(
      expect.objectContaining({ status: "retryable", followUp: "arc_enqueue", projectionMemoryId: expect.any(String) }),
    );

    test.setFailArcCreate(false);
    const second = await processStoryConsolidationQueue(
      { storage: test.storage, llm },
      { now: "2026-08-27T04:02:00.000Z" },
    );

    expect(second.completed).toBe(1);
    expect(test.jobs.get(episodeJob!.id)?.status).toBe("completed");
    expect(Array.from(test.jobs.values()).some((job) => job.level === "arc")).toBe(true);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it("keeps formal-scene persistence successful and durably retries parent arc enqueue", async () => {
    const test = harness();
    for (let index = 1; index <= 3; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    const input = {
      ownerChatId: "chat-1",
      sceneChatId: "scene-1",
      messages: [sourceMessage(7), sourceMessage(8)],
      summary: "The characters recovered the archive ledger.",
      sections: {
        events: ["They recovered the ledger."],
        choices: [],
        relationshipShifts: [],
        promises: [],
        reveals: [],
        unresolvedHooks: [],
        currentState: ["They now hold the ledger."],
      },
      now: "2026-08-27T04:00:00.000Z",
    };
    const dependencies = { storage: test.storage, llm: {} as LlmGateway };
    test.setFailArcCreate(true);

    await expect(persistCompletedSceneStoryEpisode(dependencies, input)).resolves.toMatchObject({
      kind: "episode",
      content: input.summary,
    });
    expect(test.memories.size).toBe(4);
    const followUp = Array.from(test.jobs.values()).find((job) => job.followUp === "arc_enqueue");
    expect(followUp).toEqual(
      expect.objectContaining({
        level: "episode",
        status: "retryable",
        projectionMemoryId: expect.any(String),
      }),
    );

    test.setFailArcCreate(false);
    const retried = await processStoryConsolidationQueue(
      dependencies,
      { now: "2026-08-27T04:02:00.000Z" },
    );

    expect(retried.completed).toBe(1);
    expect(test.memories.size).toBe(4);
    expect(Array.from(test.jobs.values()).some((job) => job.level === "arc")).toBe(true);
    expect(test.jobs.get(followUp!.id)).toEqual(
      expect.objectContaining({
        status: "completed",
        followUp: null,
        parentArcJobId: expect.any(String),
      }),
    );
    await expect(persistCompletedSceneStoryEpisode(dependencies, input)).resolves.toMatchObject({
      kind: "episode",
      content: input.summary,
    });
    expect(test.memories.size).toBe(4);
  });

  it("keeps an arc follow-up retryable when coverage is temporarily ineligible", async () => {
    const test = harness();
    for (let index = 1; index <= 3; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    test.setFailArcCreate(true);
    await persistCompletedSceneStoryEpisode(
      { storage: test.storage, llm: {} as LlmGateway },
      {
        ownerChatId: "chat-1",
        sceneChatId: "scene-1",
        messages: [sourceMessage(7), sourceMessage(8)],
        summary: "The characters recovered the archive ledger.",
        now: "2026-08-27T04:00:00.000Z",
      },
    );
    const followUp = Array.from(test.jobs.values()).find((job) => job.followUp === "arc_enqueue")!;
    const staleEpisode = test.memories.get("episode-3")!;
    test.memories.set("episode-3", { ...staleEpisode, status: "stale" });
    test.setFailArcCreate(false);

    const result = await processStoryConsolidationQueue(
      { storage: test.storage, llm: {} as LlmGateway },
      { now: "2026-08-27T04:02:00.000Z" },
    );

    expect(result.retryable).toBe(1);
    expect(Array.from(test.jobs.values()).filter((job) => job.level === "arc")).toHaveLength(0);
    expect(test.jobs.get(followUp.id)).toEqual(
      expect.objectContaining({
        status: "retryable",
        followUp: "arc_enqueue",
        parentArcJobId: null,
      }),
    );
  });

  it("keeps the immediate scene arc follow-up retryable when the arc plan disappears", async () => {
    const test = harness();
    for (let index = 1; index <= 3; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    let queryCount = 0;
    test.storage.queryMemories = vi.fn(async () => {
      queryCount += 1;
      const memories = Array.from(test.memories.values());
      return queryCount === 2
        ? memories.filter((memory) => !memory.tags.includes("formal-scene"))
        : memories;
    });

    await expect(
      persistCompletedSceneStoryEpisode(
        { storage: test.storage, llm: {} as LlmGateway },
        {
          ownerChatId: "chat-1",
          sceneChatId: "scene-1",
          messages: [sourceMessage(7), sourceMessage(8)],
          summary: "The characters recovered the archive ledger.",
          now: "2026-08-27T04:00:00.000Z",
        },
      ),
    ).resolves.toMatchObject({ kind: "episode" });

    const followUp = Array.from(test.jobs.values()).find((job) => job.boundaryReason === "scene_conclusion");
    expect(followUp).toEqual(
      expect.objectContaining({
        status: "retryable",
        followUp: "arc_enqueue",
        parentArcJobId: null,
        nextAttemptAt: expect.any(String),
      }),
    );
  });

  it("does not persist a scene arc follow-up when the episode write fails", async () => {
    const test = harness();
    for (let index = 1; index <= 3; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    test.storage.createMemory = vi.fn(async () => {
      throw new Error("episode write failed");
    });

    await expect(
      persistCompletedSceneStoryEpisode(
        { storage: test.storage, llm: {} as LlmGateway },
        {
          ownerChatId: "chat-1",
          sceneChatId: "scene-1",
          messages: [sourceMessage(7), sourceMessage(8)],
          summary: "The characters recovered the archive ledger.",
          now: "2026-08-27T04:00:00.000Z",
        },
      ),
    ).rejects.toThrow("episode write failed");

    expect(Array.from(test.jobs.values()).filter((job) => job.followUp === "arc_enqueue")).toHaveLength(0);
    expect(test.memories.size).toBe(3);
  });

  it("surfaces follow-up creation failure after the scene episode commits", async () => {
    const test = harness();
    for (let index = 1; index <= 3; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    const create = test.storage.create.bind(test.storage);
    test.storage.create = vi.fn(async (entity, body) => {
      if (entity === STORY_CONSOLIDATION_JOBS_COLLECTION && body.followUp === "arc_enqueue") {
        throw new Error("follow-up write failed");
      }
      return create(entity, body);
    }) as StorageGateway["create"];

    await expect(
      persistCompletedSceneStoryEpisode(
        { storage: test.storage, llm: {} as LlmGateway },
        {
          ownerChatId: "chat-1",
          sceneChatId: "scene-1",
          messages: [sourceMessage(7), sourceMessage(8)],
          summary: "The characters recovered the archive ledger.",
          now: "2026-08-27T04:00:00.000Z",
        },
      ),
    ).rejects.toThrow("follow-up write failed");

    expect(test.memories.size).toBe(4);
    expect(Array.from(test.jobs.values()).filter((job) => job.followUp === "arc_enqueue")).toHaveLength(0);
  });

  it("keeps a verified completed scene follow-up monotonic across replay", async () => {
    const test = harness();
    for (let index = 1; index <= 3; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    test.storage.acquireStoryConsolidationWorker = vi.fn(async () => null);
    const dependencies = { storage: test.storage, llm: {} as LlmGateway };
    const input = {
      ownerChatId: "chat-1",
      sceneChatId: "scene-1",
      messages: [sourceMessage(7), sourceMessage(8)],
      summary: "The characters recovered the archive ledger.",
      now: "2026-08-27T04:00:00.000Z",
    };
    await persistCompletedSceneStoryEpisode(dependencies, input);
    const followUp = Array.from(test.jobs.values()).find((job) => job.boundaryReason === "scene_conclusion")!;
    const parentArcJobId = followUp.parentArcJobId;
    expect(parentArcJobId).toEqual(expect.any(String));

    let queryCount = 0;
    test.storage.queryMemories = vi.fn(async () => {
      queryCount += 1;
      const memories = Array.from(test.memories.values());
      return queryCount === 2 ? memories.filter((memory) => memory.id !== "episode-3") : memories;
    });
    await persistCompletedSceneStoryEpisode(dependencies, { ...input, now: "2026-08-27T04:02:00.000Z" });

    expect(test.jobs.get(followUp.id)).toEqual(
      expect.objectContaining({
        status: "completed",
        followUp: null,
        parentArcJobId,
      }),
    );
    expect(Array.from(test.jobs.values()).filter((job) => job.level === "arc")).toHaveLength(1);
  });

  it("completes an arc follow-up only after verifying an existing matching arc job", async () => {
    const test = harness();
    for (let index = 1; index <= 3; index += 1) await test.storage.createMemory?.(episodeMemory(index));
    test.setFailArcCreate(true);
    const dependencies = { storage: test.storage, llm: {} as LlmGateway };
    await persistCompletedSceneStoryEpisode(dependencies, {
      ownerChatId: "chat-1",
      sceneChatId: "scene-1",
      messages: [sourceMessage(7), sourceMessage(8)],
      summary: "The characters recovered the archive ledger.",
      now: "2026-08-27T04:00:00.000Z",
    });
    const followUp = Array.from(test.jobs.values()).find((job) => job.followUp === "arc_enqueue")!;
    test.setFailArcCreate(false);
    const existingArc = await enqueueStoryArcJob(test.storage, { chatId: "chat-1" }, "2026-08-27T04:01:00.000Z");

    await processStoryConsolidationQueue(
      dependencies,
      { now: "2026-08-27T04:02:00.000Z" },
    );

    await vi.waitFor(() => {
      expect(test.jobs.get(followUp.id)).toEqual(
        expect.objectContaining({
          status: "completed",
          parentArcJobId: existingArc!.id,
        }),
      );
    });
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
