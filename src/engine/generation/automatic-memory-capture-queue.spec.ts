import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import type { RefreshChatMemoriesOptions, StorageEntity, StorageGateway } from "../capabilities/storage";
import type { JsonRecord } from "./runtime-records";
import {
  beginForegroundGeneration,
  enqueueAutomaticMemoryCaptureJob,
  processAutomaticMemoryCaptureQueue,
  subscribeAutomaticMemoryCaptureCompletions,
} from "./automatic-memory-capture-queue";
import type { CharacterMemoryScopeCharacter } from "./character-memory-scope";
import { buildCanonicalMemoryContext } from "./canonical-memory-context";

function message(id: string, role: string, content: string): JsonRecord {
  return {
    id,
    chatId: "chat-1",
    role,
    content,
    characterId: role === "assistant" ? "char-1" : null,
    createdAt: `2026-01-01T00:0${id.endsWith("1") ? 1 : 2}:00.000Z`,
  };
}

function queueStorage(
  options: {
    refreshFailures?: number;
    characters?: CharacterMemoryScopeCharacter[];
    chat?: JsonRecord;
  } = {},
) {
  const jobs = new Map<string, JsonRecord>();
  const canonicalMemories = new Map<string, JsonRecord>();
  const messages = new Map<string, JsonRecord>([
    ["user-1", message("user-1", "user", "My cat's name is Miso.")],
    ["assistant-1", message("assistant-1", "assistant", "Oh, that's interesting. I don't have pets.")],
  ]);
  const refreshCalls: Array<{ chatId: string; options?: RefreshChatMemoriesOptions }> = [];
  let refreshFailures = options.refreshFailures ?? 0;

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "memory-capture-jobs") return Array.from(jobs.values()) as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "memory-capture-jobs") return (jobs.get(id) ?? null) as T | null;
      if (entity === "canonical-memories") return (canonicalMemories.get(id) ?? null) as T | null;
      return null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      if (entity === "memory-capture-jobs") {
        const row = { ...value, id: String(value.id) };
        jobs.set(row.id, row);
        return row as T;
      }
      return { id: "created", ...value } as T;
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      if (entity === "memory-capture-jobs") {
        const row = { ...(jobs.get(id) ?? { id }), ...patch };
        jobs.set(id, row);
        return row as T;
      }
      return { id, ...patch } as T;
    },
    async delete(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return Array.from(messages.values()) as T[];
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return (messages.get(messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async updateChatMessage<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const row = { ...(messages.get(messageId) ?? { id: messageId }), ...patch };
      messages.set(messageId, row);
      return row as T;
    },
    async deleteChatMessage(messageId: string): Promise<{ deleted: boolean }> {
      messages.delete(messageId);
      return { deleted: true };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, extraPatch: Record<string, unknown>): Promise<T> {
      const row = messages.get(messageId) ?? { id: messageId };
      const currentExtra = row.extra && typeof row.extra === "object" && !Array.isArray(row.extra) ? row.extra : {};
      const next = { ...row, extra: { ...currentExtra, ...extraPatch } };
      messages.set(messageId, next);
      return next as T;
    },
    async patchChatMetadata<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async patchChatSummaries<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async listChatMemories<T = unknown>(): Promise<T[]> {
      return [] as T[];
    },
    async refreshChatMemories<T = unknown>(chatId: string, refreshOptions?: RefreshChatMemoriesOptions): Promise<T> {
      refreshCalls.push({ chatId, options: refreshOptions });
      if (refreshFailures > 0) {
        refreshFailures -= 1;
        throw new Error("provider unavailable");
      }
      return {
        rebuilt: 1,
        capture: {
          operation: "created",
          memory: { id: "memory-1", content: "Celia's cat is named Miso." },
        },
      } as T;
    },
    async getWorldState<T = unknown>(): Promise<T | null> {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async listLorebookEntries<T = unknown>(): Promise<T[]> {
      return [] as T[];
    },
    async createLorebookEntries<T = unknown>(): Promise<T[]> {
      return [] as T[];
    },
    async addChatMessageSwipe<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async promptFull<T = unknown>(): Promise<T | null> {
      return null;
    },
    async createMemory(body) {
      const row = { ...body, id: String(body.id), createdAt: body.createdAt ?? "", updatedAt: body.updatedAt ?? "" };
      canonicalMemories.set(row.id, row);
      return row as never;
    },
    async updateMemory(memoryId, patch) {
      const row = { ...(canonicalMemories.get(memoryId) ?? { id: memoryId }), ...patch };
      canonicalMemories.set(memoryId, row);
      return row as never;
    },
    async rebuildMemoryIndex() {
      return { rebuilt: 1 };
    },
    async queryMemoryIndex(body) {
      return Array.from(canonicalMemories.values()).filter(
        (memory) =>
          !body?.scope ||
          ((memory.scope as { kind?: string; id?: string } | undefined)?.kind === body.scope.kind &&
            (memory.scope as { kind?: string; id?: string } | undefined)?.id === body.scope.id),
      ) as never;
    },
    async queryMemories(body) {
      return Array.from(canonicalMemories.values()).filter(
        (memory) =>
          !body?.scope ||
          ((memory.scope as { kind?: string; id?: string } | undefined)?.kind === body.scope.kind &&
            (memory.scope as { kind?: string; id?: string } | undefined)?.id === body.scope.id),
      ) as never;
    },
  };

  async function enqueue() {
    return enqueueAutomaticMemoryCaptureJob(
      storage,
      {
        chat: options.chat ?? { id: "chat-1", mode: "conversation" },
        characters: options.characters ?? [{ id: "char-1" }],
        savedUserMessage: messages.get("user-1"),
        savedAssistantMessage: messages.get("assistant-1"),
      },
      "2026-01-01T00:03:00.000Z",
    );
  }

  return { storage, jobs, canonicalMemories, messages, refreshCalls, enqueue };
}

describe("automatic memory capture queue", () => {
  it("persists a typed consequence from the complete queued exchange and records its exact ID", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    const llm: LlmGateway = {
      async complete() {
        return JSON.stringify({
          memories: [
            {
              kind: "fact",
              content: "The user's cat is named Miso.",
              confidence: 0.97,
              evidence: "direct_user_assertion",
              sourceMessageIds: ["user-1"],
            },
          ],
        });
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    await processAutomaticMemoryCaptureQueue({ storage: harness.storage, llm }, { now: "2026-01-01T00:03:00.000Z" });

    const consequence = Array.from(harness.canonicalMemories.values()).find((memory) => memory.kind === "fact");
    expect(consequence).toEqual(
      expect.objectContaining({
        status: "active",
        scope: { kind: "character", id: "char-1" },
        content: "The user's cat is named Miso.",
        provenance: expect.objectContaining({ messageIds: ["user-1"] }),
      }),
    );
    expect(harness.jobs.get(String(job?.id))?.affectedCanonicalMemoryIds).toEqual([consequence?.id]);
    expect((harness.messages.get("assistant-1")?.extra as JsonRecord).memoryCapture).toEqual(
      expect.objectContaining({
        consequences: {
          status: "completed",
          affected: [
            {
              operation: "created",
              memory: expect.objectContaining({
                id: consequence?.id,
                kind: "fact",
                status: "active",
              }),
            },
          ],
        },
      }),
    );
  });

  it("completes a pending capture job with the queued source exchange", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();

    const result = await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });

    expect(result).toEqual({ processed: 1, completed: 1, retryable: 0, failed: 0, stale: 0 });
    expect(harness.refreshCalls).toEqual([
      { chatId: "chat-1", options: { sourceMessageIds: ["user-1", "assistant-1"] } },
    ]);
    expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "completed", attempts: 1 }));
  });

  it("pauses a draining queue before its next job when foreground generation starts", async () => {
    const harness = queueStorage();
    await harness.enqueue();
    harness.messages.set("user-2", message("user-2", "user", "I moved to Osaka."));
    harness.messages.set("assistant-2", message("assistant-2", "assistant", "I'll remember that."));
    const secondJob = await enqueueAutomaticMemoryCaptureJob(
      harness.storage,
      {
        chat: { id: "chat-1", mode: "conversation" },
        characters: [{ id: "char-1" }],
        savedUserMessage: harness.messages.get("user-2"),
        savedAssistantMessage: harness.messages.get("assistant-2"),
      },
      "2026-01-01T00:04:00.000Z",
    );

    let releaseFirstRefresh: () => void = () => {};
    const firstRefreshReleased = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let markFirstRefreshStarted: () => void = () => {};
    const firstRefreshStarted = new Promise<void>((resolve) => {
      markFirstRefreshStarted = resolve;
    });
    const originalRefresh = harness.storage.refreshChatMemories!.bind(harness.storage);
    let refreshCount = 0;
    harness.storage.refreshChatMemories = async <T = unknown>(
      chatId: string,
      options?: RefreshChatMemoriesOptions,
    ): Promise<T> => {
      refreshCount += 1;
      if (refreshCount === 1) {
        markFirstRefreshStarted();
        await firstRefreshReleased;
      }
      return originalRefresh<T>(chatId, options);
    };

    const processing = processAutomaticMemoryCaptureQueue(harness.storage, {
      now: "2026-01-01T00:05:00.000Z",
    });
    await firstRefreshStarted;
    const releaseForegroundGeneration = beginForegroundGeneration(harness.storage);
    releaseFirstRefresh();

    const result = await processing;
    expect(result.processed).toBe(1);
    expect(harness.jobs.get(String(secondJob?.id))?.status).toBe("pending");

    releaseForegroundGeneration();
    await vi.waitFor(() => expect(harness.jobs.get(String(secondJob?.id))?.status).toBe("completed"));
  });

  it("marks the assistant message extra after capture completes", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });

    expect(harness.messages.get("assistant-1")?.extra).toEqual({
      memoryCapture: {
        status: "completed",
        jobId: String(job?.id),
        sourceMessageIds: ["user-1", "assistant-1"],
        completedAt: "2026-01-01T00:03:00.000Z",
        capture: {
          operation: "created",
          memory: { id: "memory-1", content: "Celia's cat is named Miso." },
        },
        consequences: {
          status: "skipped",
          skipReason: "llm_gateway_unavailable",
          affected: [],
        },
      },
    });
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ consequenceStatus: "skipped", consequenceSkipReason: "llm_gateway_unavailable" }),
    );
  });

  it.each([
    ["blank content", { content: "" }],
    ["unknown kind", { kind: "legacy" }],
    ["unknown status", { status: "corrupt" }],
    ["blank provenance message ID", { provenance: { messageIds: [""] } }],
    ["non-string tag", { tags: ["trusted", 7] }],
    ["non-record payload", { payload: [] }],
  ])("does not expose an active memory with %s to extraction or report it", async (_label, malformedPatch) => {
    const harness = queueStorage();
    harness.canonicalMemories.set("malformed-memory", {
      id: "malformed-memory",
      kind: "fact",
      status: "active",
      scope: { kind: "character", id: "char-1" },
      content: "The user's cat used to be called Luna.",
      confidence: 0.9,
      provenance: { messageIds: ["user-old"] },
      tags: ["pet"],
      payload: {},
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
      ...malformedPatch,
    });
    const job = await harness.enqueue();
    const prompts: string[] = [];
    const llm: LlmGateway = {
      async complete(request) {
        prompts.push(request.messages.map((entry) => entry.content).join("\n"));
        return JSON.stringify({
          memories: [
            {
              kind: "fact",
              content: "The user's cat is named Miso.",
              confidence: 0.97,
              evidence: "direct_user_assertion",
              sourceMessageIds: ["user-1"],
              supersedesMemoryId: "malformed-memory",
            },
          ],
        });
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    await processAutomaticMemoryCaptureQueue({ storage: harness.storage, llm }, { now: "2026-01-01T00:03:00.000Z" });

    expect(prompts.join("\n")).not.toContain("malformed-memory");
    expect(harness.jobs.get(String(job?.id))?.affectedCanonicalMemoryIds).toEqual([]);
    expect(Array.from(harness.canonicalMemories.values()).filter((memory) => memory.id !== "malformed-memory")).toEqual(
      [expect.objectContaining({ id: `canonical-${String(job?.id)}` })],
    );
  });

  it("publishes the exact saved memory after durable capture completes", async () => {
    const harness = queueStorage();
    await harness.enqueue();
    const notices: unknown[] = [];
    const unsubscribe = subscribeAutomaticMemoryCaptureCompletions((notice) => notices.push(notice));

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });
    unsubscribe();

    expect(notices).toEqual([
      {
        chatId: "chat-1",
        assistantMessageId: "assistant-1",
        operation: "created",
        memory: { id: "memory-1", content: "Celia's cat is named Miso." },
      },
    ]);
  });

  it("retries transient failures with bounded backoff before succeeding", async () => {
    const harness = queueStorage({ refreshFailures: 1 });
    const job = await harness.enqueue();

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ status: "retryable", attempts: 1, lastError: "provider unavailable" }),
    );

    const retryAt = String(harness.jobs.get(String(job?.id))?.nextAttemptAt);
    await processAutomaticMemoryCaptureQueue(harness.storage, { now: retryAt });

    expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "completed", attempts: 2 }));
    expect(harness.refreshCalls).toHaveLength(2);
  });

  it("retries a transient consequence-extraction failure without duplicating canonical consequences", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    let attempts = 0;
    const llm: LlmGateway = {
      async complete() {
        attempts += 1;
        if (attempts === 1) throw new Error("extractor unavailable");
        return JSON.stringify({
          memories: [
            {
              kind: "fact",
              content: "The user's cat is named Miso.",
              confidence: 0.97,
              evidence: "direct_user_assertion",
              sourceMessageIds: ["user-1"],
            },
          ],
        });
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };
    const dependencies = { storage: harness.storage, llm };

    await processAutomaticMemoryCaptureQueue(dependencies, { now: "2026-01-01T00:03:00.000Z" });
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ status: "retryable", attempts: 1, lastError: "extractor unavailable" }),
    );

    const retryAt = String(harness.jobs.get(String(job?.id))?.nextAttemptAt);
    await processAutomaticMemoryCaptureQueue(dependencies, { now: retryAt });

    expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "completed", attempts: 2 }));
    expect(Array.from(harness.canonicalMemories.values()).filter((memory) => memory.kind === "fact")).toHaveLength(1);
  });

  it("records terminal failure after max attempts", async () => {
    const harness = queueStorage({ refreshFailures: 3 });
    const job = await harness.enqueue();

    for (let index = 0; index < 3; index += 1) {
      const now = String(harness.jobs.get(String(job?.id))?.nextAttemptAt || "2026-01-01T00:03:00.000Z");
      await processAutomaticMemoryCaptureQueue(harness.storage, { now });
    }

    expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "failed", attempts: 3 }));
  });

  it("resumes a processing job after restart", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    await harness.storage.update("memory-capture-jobs", String(job?.id), { status: "processing" });

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "completed" }));
  });

  it("marks edited or deleted source evidence stale instead of writing memory", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    await harness.storage.updateChatMessage("user-1", { content: "My cat's name changed." });

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.refreshCalls).toHaveLength(0);
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ status: "stale", staleReason: "source_content_changed" }),
    );
  });

  it("marks a job stale when source evidence was deleted before processing", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    await harness.storage.deleteChatMessage("user-1");

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.refreshCalls).toHaveLength(0);
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ status: "stale", staleReason: "source_message_deleted" }),
    );
  });

  it("uses a deterministic job id so enqueueing the same source evidence does not duplicate work", async () => {
    const harness = queueStorage();
    const first = await harness.enqueue();
    const second = await harness.enqueue();

    expect(first?.id).toBe(second?.id);
    expect(harness.jobs.size).toBe(1);

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });
    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.refreshCalls).toHaveLength(1);
  });

  it("persists attributed characters in character scope by default", async () => {
    const harness = queueStorage();

    const job = await harness.enqueue();

    expect(job).toEqual(
      expect.objectContaining({
        scopeKind: "character",
        scopeId: "char-1",
        scopeReason: "attributed_character",
        characterId: "char-1",
      }),
    );
  });

  it("keeps explicitly chat-only character memories local", async () => {
    const harness = queueStorage({ characters: [{ id: "char-1", memoryPersistence: "chat" }] });

    const job = await harness.enqueue();
    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });

    expect(job).toEqual(
      expect.objectContaining({
        scopeKind: "chat",
        scopeId: "chat-1",
        scopeReason: "character_chat_only",
      }),
    );
    expect(harness.canonicalMemories.size).toBe(0);
  });

  it("keeps an unattributed roleplay capture in scene scope without creating a character memory", async () => {
    const harness = queueStorage({
      chat: { id: "chat-1", mode: "roleplay", sceneId: "scene-1" },
      characters: [{ id: "other-character" }],
    });

    const job = await harness.enqueue();
    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });

    expect(job).toEqual(
      expect.objectContaining({
        scopeKind: "scene",
        scopeId: "scene-1",
        scopeReason: "ambiguous_scene",
        characterId: null,
      }),
    );
    expect(harness.canonicalMemories.size).toBe(0);
  });

  it("creates one stable canonical character memory after local capture", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });

    expect(Array.from(harness.canonicalMemories.values())).toEqual([
      expect.objectContaining({
        id: `canonical-${String(job?.id)}`,
        kind: "episode",
        status: "active",
        scope: { kind: "character", id: "char-1" },
        content: "Celia's cat is named Miso.",
        confidence: 1,
        provenance: {
          sourceChatId: "chat-1",
          messageIds: ["user-1", "assistant-1"],
          sceneId: null,
          characterId: "char-1",
          timestamp: "2026-01-01T00:01:00.000Z",
        },
        tags: ["automatic", "conversation"],
        payload: {
          automatic: true,
          captureVersion: 2,
          captureJobId: String(job?.id),
        },
      }),
    ]);
  });

  it("updates the stable canonical ID when a resumed job is processed again", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });
    await harness.storage.update("memory-capture-jobs", String(job?.id), { status: "processing" });

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.canonicalMemories.size).toBe(1);
    expect(harness.canonicalMemories.has(`canonical-${String(job?.id)}`)).toBe(true);
  });

  it("treats legacy jobs without persisted scope as chat-local", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    const jobId = String(job?.id);
    const legacyJob = { ...harness.jobs.get(jobId) };
    delete legacyJob.scopeKind;
    delete legacyJob.scopeReason;
    legacyJob.scopeType = "chat";
    legacyJob.scopeId = "chat-1";
    harness.jobs.set(jobId, legacyJob);

    await processAutomaticMemoryCaptureQueue(harness.storage, { now: "2026-01-01T00:03:00.000Z" });

    expect(harness.canonicalMemories.size).toBe(0);
  });

  it("recalls an extracted Conversation consequence for the same character in a later Roleplay", async () => {
    const harness = queueStorage();
    await harness.enqueue();
    const llm: LlmGateway = {
      async complete() {
        return JSON.stringify({
          memories: [
            {
              kind: "fact",
              content: "The user's cat is named Miso.",
              confidence: 0.97,
              evidence: "direct_user_assertion",
              sourceMessageIds: ["user-1"],
            },
          ],
        });
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };
    await processAutomaticMemoryCaptureQueue({ storage: harness.storage, llm }, { now: "2026-01-01T00:03:00.000Z" });
    const consequence = Array.from(harness.canonicalMemories.values()).find((memory) => memory.kind === "fact");

    const recalled = await buildCanonicalMemoryContext(harness.storage, {
      chat: { id: "chat-2", mode: "roleplay", metadata: {} },
      storedMessages: [{ id: "roleplay-user-1", role: "user", content: "What was my cat's name?" }],
      latestUserInput: "What was my cat's name?",
      characters: [{ id: "char-1", name: "Mira", tags: [] }],
      maxContext: 4096,
    });

    expect(recalled?.block).toContain("The user's cat is named Miso.");
    expect(recalled?.attributionItems).toContainEqual(
      expect.objectContaining({ sourceId: consequence?.id, sourceCollection: "canonical-memories" }),
    );
  });
});
