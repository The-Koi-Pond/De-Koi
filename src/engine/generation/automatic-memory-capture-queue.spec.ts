import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import type {
  ChatMemoryCapturePreview,
  CommitChatMemoryCaptureInput,
  RefreshChatMemoriesOptions,
  StorageEntity,
  StorageGateway,
} from "../capabilities/storage";
import type { JsonRecord } from "./runtime-records";
import {
  beginForegroundGeneration,
  enqueueAutomaticMemoryCaptureJob,
  processAutomaticMemoryCaptureQueue,
  scheduleAutomaticMemoryCaptureQueueProcessing,
  subscribeAutomaticMemoryCaptureCompletions,
  subscribeAutomaticMemoryCaptureStatuses,
} from "./automatic-memory-capture-queue";
import type { CharacterMemoryScopeCharacter } from "./character-memory-scope";
import { buildCanonicalMemoryContext } from "./canonical-memory-context";
import { legacyMemoryId } from "./deterministic-memory-id";

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

function isValueReviewRequest(request: { messages: Array<{ content: string }> }): boolean {
  return request.messages.some((entry) => entry.content.includes("memory_cleanup_value_review"));
}

function passingValueReviewLlm(
  extraction: LlmGateway["complete"] = async () => JSON.stringify({ memories: [] }),
): LlmGateway {
  return {
    async complete(request, signal) {
      if (isValueReviewRequest(request)) return JSON.stringify({ proposals: [] });
      return extraction(request, signal);
    },
    async *stream() {
      yield { type: "done" };
    },
    async listModels() {
      return [];
    },
  };
}

function queueStorage(
  options: {
    refreshFailures?: number;
    characters?: CharacterMemoryScopeCharacter[];
    chat?: JsonRecord;
    persona?: JsonRecord | null;
    connections?: JsonRecord[];
  } = {},
) {
  const jobs = new Map<string, JsonRecord>();
  const canonicalMemories = new Map<string, JsonRecord>();
  const messages = new Map<string, JsonRecord>([
    ["user-1", message("user-1", "user", "My cat's name is Miso.")],
    ["assistant-1", message("assistant-1", "assistant", "Oh, that's interesting. I don't have pets.")],
  ]);
  const refreshCalls: Array<{ chatId: string; options?: RefreshChatMemoriesOptions }> = [];
  const previewCalls: Array<{ chatId: string; sourceMessageIds: string[] }> = [];
  const commitCalls: CommitChatMemoryCaptureInput[] = [];
  let refreshFailures = options.refreshFailures ?? 0;

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "memory-capture-jobs") return Array.from(jobs.values()) as T[];
      if (entity === "connections") {
        return (options.connections ?? [
          { id: "connection-1", provider: "openai", model: "foreground-model", enabled: true },
        ]) as T[];
      }
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "memory-capture-jobs") return (jobs.get(id) ?? null) as T | null;
      if (entity === "canonical-memories") return (canonicalMemories.get(id) ?? null) as T | null;
      if (entity === "personas" && id === "persona-1") return (options.persona ?? null) as T | null;
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
    async previewChatMemoryCapture(chatId, sourceMessageIds): Promise<ChatMemoryCapturePreview> {
      previewCalls.push({ chatId, sourceMessageIds });
      return {
        version: 1,
        chatId,
        sourceMessageIds,
        fingerprint: "capture-fingerprint",
        candidate: {
          id: "transcript-candidate",
          chatId,
          content: "Celia's cat is named Miso.",
          canonicalMemoryVersion: 1,
          memoryKind: "transcript",
          scopeType: "chat",
          scopeId: chatId,
          status: "active",
          messageCount: sourceMessageIds.length,
          messageIds: sourceMessageIds,
          firstMessageAt: "2026-01-01T00:01:00.000Z",
          lastMessageAt: "2026-01-01T00:02:00.000Z",
          createdAt: "2026-01-01T00:03:00.000Z",
          hasEmbedding: false,
        },
      };
    },
    async commitChatMemoryCapture(body) {
      commitCalls.push(body);
      if (refreshFailures > 0) {
        refreshFailures -= 1;
        throw new Error("provider unavailable");
      }
      return {
        operation: "created",
        memory: {
          id: "memory-1",
          chatId: body.chatId,
          content: "Celia's cat is named Miso.",
          memoryKind: "transcript",
          status: "active",
          messageCount: body.sourceMessageIds.length,
          messageIds: body.sourceMessageIds,
          firstMessageAt: "2026-01-01T00:01:00.000Z",
          lastMessageAt: "2026-01-01T00:02:00.000Z",
          createdAt: "2026-01-01T00:03:00.000Z",
          hasEmbedding: true,
        },
      };
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
        connectionId: "connection-1",
      },
      "2026-01-01T00:03:00.000Z",
    );
  }

  const llm = passingValueReviewLlm();
  return {
    storage,
    dependencies: { storage, llm },
    jobs,
    canonicalMemories,
    messages,
    refreshCalls,
    previewCalls,
    commitCalls,
    enqueue,
  };
}

describe("automatic memory capture queue", () => {
  it("does not reuse a colliding legacy job without an exact capture identity match", async () => {
    const harness = queueStorage();
    const identity = "2\u001fchat-1\u001fuser-1\u001fassistant-1";
    const legacyId = legacyMemoryId("memory-capture", identity);
    harness.jobs.set(legacyId, {
      id: legacyId,
      status: "completed",
      captureVersion: 2,
      chatId: "unrelated-chat",
      sourceMessageIds: ["unrelated-message"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const job = await harness.enqueue();

    expect(job?.id).not.toBe(legacyId);
    expect(job?.chatId).toBe("chat-1");
    expect(harness.jobs).toHaveLength(2);
  });

  it("reuses a matching legacy job id", async () => {
    const harness = queueStorage();
    const identity = "2\u001fchat-1\u001fuser-1\u001fassistant-1";
    const legacyId = legacyMemoryId("memory-capture", identity);
    harness.jobs.set(legacyId, {
      id: legacyId,
      status: "completed",
      captureVersion: 2,
      chatId: "chat-1",
      sourceMessageIds: ["user-1", "assistant-1"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const job = await harness.enqueue();

    expect(job?.id).toBe(legacyId);
    expect(harness.jobs).toHaveLength(1);
  });

  it("resolves the dedicated background connection when the queued job runs", async () => {
    const harness = queueStorage({
      connections: [
        { id: "connection-1", provider: "nanogpt", model: "foreground-model", enabled: true },
        {
          id: "background-connection",
          provider: "openai",
          model: "background-model",
          enabled: true,
          defaultForAgents: true,
        },
      ],
    });
    await harness.enqueue();
    const requests: Parameters<LlmGateway["complete"]>[0][] = [];
    const llm = passingValueReviewLlm(async (request) => {
      requests.push(request);
      return JSON.stringify({ memories: [] });
    });

    await processAutomaticMemoryCaptureQueue({ storage: harness.storage, llm }, { now: "2026-01-01T00:03:00.000Z" });

    expect(requests).not.toHaveLength(0);
    expect(requests.every((request) => request.connectionId === "background-connection")).toBe(true);
    expect(requests[0]?.model).toBe("background-model");
  });

  it("snapshots named source and bounded reference context", async () => {
    const harness = queueStorage({
      chat: { id: "chat-1", mode: "conversation", personaId: "persona-1" },
      persona: { id: "persona-1", name: "Celia" },
      characters: [{ id: "char-1", name: "Pierrot" }],
    });
    harness.messages.set("prior-1", {
      id: "prior-1",
      chatId: "chat-1",
      role: "user",
      content: "I meant the circus accident.",
      characterId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const job = await harness.enqueue();

    expect(job).toEqual(
      expect.objectContaining({
        userLabel: "Celia",
        characterLabels: { "char-1": "Pierrot" },
        sourceMessageIds: ["user-1", "assistant-1"],
        referenceMessageIds: ["prior-1"],
        sourceMessages: [
          expect.objectContaining({ id: "user-1", speakerLabel: "Celia" }),
          expect.objectContaining({ id: "assistant-1", speakerLabel: "Pierrot" }),
        ],
        referenceMessages: [expect.objectContaining({ id: "prior-1", speakerLabel: "Celia" })],
      }),
    );
  });

  it("marks edited reference context stale instead of writing memory", async () => {
    const harness = queueStorage({
      chat: { id: "chat-1", mode: "conversation", personaId: "persona-1" },
      persona: { id: "persona-1", name: "Celia" },
      characters: [{ id: "char-1", name: "Pierrot" }],
    });
    harness.messages.set("prior-1", {
      id: "prior-1",
      chatId: "chat-1",
      role: "user",
      content: "I meant the circus accident.",
      characterId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const job = await harness.enqueue();
    await harness.storage.updateChatMessage("prior-1", { content: "I meant a different accident." });

    const result = await processAutomaticMemoryCaptureQueue(harness.dependencies, {
      now: "2026-01-01T00:03:00.000Z",
    });

    expect(result.stale).toBe(1);
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ status: "stale", staleReason: "source_content_changed" }),
    );
    expect(Array.from(harness.canonicalMemories.values())).toHaveLength(0);
  });

  it("persists only candidates that pass the shared value review", async () => {
    const harness = queueStorage();
    await harness.enqueue();
    const llm: LlmGateway = {
      async complete(request) {
        const prompt = request.messages.map((entry) => entry.content).join("\n");
        if (prompt.includes("memory_cleanup_value_review")) {
          return JSON.stringify({
            proposals: [
              {
                type: "discard",
                sourceIds: ["transcript-candidate"],
                reason: "Low-value memory",
              },
            ],
          });
        }
        return JSON.stringify({
          memories: [
            {
              kind: "fact",
              content: "{{user}}'s cat is named Miso.",
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

    const result = await processAutomaticMemoryCaptureQueue(
      { storage: harness.storage, llm },
      { now: "2026-01-01T00:03:00.000Z" },
    );

    expect(result.completed).toBe(1);
    expect(harness.previewCalls).toHaveLength(1);
    expect(harness.refreshCalls).toHaveLength(0);
    expect(harness.commitCalls).toHaveLength(0);
    expect(Array.from(harness.canonicalMemories.values())).toEqual([
      expect.objectContaining({ content: "{{user}}'s cat is named Miso." }),
    ]);
  });

  it("fails closed against an older runtime without two-phase capture", async () => {
    const harness = queueStorage();
    await harness.enqueue();
    harness.storage.previewChatMemoryCapture = undefined;
    harness.storage.commitChatMemoryCapture = undefined;
    const llm: LlmGateway = {
      async complete() {
        return JSON.stringify({ memories: [] });
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    const result = await processAutomaticMemoryCaptureQueue(
      { storage: harness.storage, llm },
      { now: "2026-01-01T00:03:00.000Z" },
    );

    expect(result.retryable).toBe(1);
    expect(harness.refreshCalls).toHaveLength(0);
    expect(harness.canonicalMemories.size).toBe(0);
  });

  it("fails closed and retries when value review fails", async () => {
    const harness = queueStorage();
    await harness.enqueue();
    const llm: LlmGateway = {
      async complete(request) {
        if (isValueReviewRequest(request)) throw new Error("invalid structured response");
        return JSON.stringify({ memories: [] });
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    const result = await processAutomaticMemoryCaptureQueue(
      { storage: harness.storage, llm },
      { now: "2026-01-01T00:03:00.000Z" },
    );

    expect(result.retryable).toBe(1);
    expect(harness.commitCalls).toHaveLength(0);
    expect(harness.canonicalMemories.size).toBe(0);
  });

  it("fails once without retrying an explicit provider configuration error", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    const llm = passingValueReviewLlm(async () => {
      throw new Error('Provider returned HTTP 400: reasoning_effort must be "high" or "max"');
    });

    const result = await processAutomaticMemoryCaptureQueue(
      { storage: harness.storage, llm },
      { now: "2026-01-01T00:03:00.000Z" },
    );

    expect(result).toMatchObject({ failed: 1, retryable: 0 });
    expect(harness.jobs.get(String(job?.id))).toMatchObject({ status: "failed", attempts: 1, nextAttemptAt: null });
    expect((harness.messages.get("assistant-1")?.extra as JsonRecord).memoryCapture).toMatchObject({
      status: "failed",
      failureCategory: "configuration_error",
    });
  });

  it("does not duplicate canonical survivors after a partial retry", async () => {
    const harness = queueStorage({ refreshFailures: 1 });
    const job = await harness.enqueue();
    const llm = passingValueReviewLlm(async () =>
      JSON.stringify({
        memories: [
          {
            kind: "fact",
            content: "{{user}}'s cat is named Miso.",
            confidence: 0.97,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
          },
        ],
      }),
    );
    const dependencies = { storage: harness.storage, llm };

    const first = await processAutomaticMemoryCaptureQueue(dependencies, {
      now: "2026-01-01T00:03:00.000Z",
    });
    const retryAt = String(harness.jobs.get(String(job?.id))?.nextAttemptAt);
    const second = await processAutomaticMemoryCaptureQueue(dependencies, { now: retryAt });

    expect(first.retryable).toBe(1);
    expect(second.completed).toBe(1);
    expect(harness.canonicalMemories.size).toBe(1);
    expect([...harness.canonicalMemories.keys()]).toEqual([expect.stringMatching(/^canonical-consequence-/)]);
    expect(harness.commitCalls).toHaveLength(2);
  });

  it("persists a typed consequence from the complete queued exchange and records its exact ID", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    const llm = passingValueReviewLlm(async () =>
      JSON.stringify({
        memories: [
          {
            kind: "fact",
            content: "{{user}}'s cat is named Miso.",
            confidence: 0.97,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
          },
        ],
      }),
    );
    const notices: unknown[] = [];
    const unsubscribe = subscribeAutomaticMemoryCaptureCompletions((notice) => notices.push(notice));

    await processAutomaticMemoryCaptureQueue({ storage: harness.storage, llm }, { now: "2026-01-01T00:03:00.000Z" });
    unsubscribe();

    const consequence = Array.from(harness.canonicalMemories.values()).find((memory) => memory.kind === "fact");
    expect(consequence).toEqual(
      expect.objectContaining({
        status: "active",
        scope: { kind: "character", id: "char-1" },
        content: "{{user}}'s cat is named Miso.",
        provenance: expect.objectContaining({ messageIds: ["user-1"] }),
      }),
    );
    expect(harness.jobs.get(String(job?.id))?.affectedCanonicalMemoryIds).toEqual([consequence?.id]);
    expect(notices).toEqual([
      {
        chatId: "chat-1",
        assistantMessageId: "assistant-1",
        operation: "created",
        memory: { id: consequence?.id, content: "{{user}}'s cat is named Miso." },
      },
    ]);
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

    const result = await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });

    expect(result).toEqual({ processed: 1, completed: 1, retryable: 0, failed: 0, stale: 0 });
    expect(harness.previewCalls).toEqual([{ chatId: "chat-1", sourceMessageIds: ["user-1", "assistant-1"] }]);
    expect(harness.commitCalls).toHaveLength(1);
    expect(harness.refreshCalls).toHaveLength(0);
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
        connectionId: "connection-1",
      },
      "2026-01-01T00:04:00.000Z",
    );

    let releaseFirstCommit: () => void = () => {};
    const firstCommitReleased = new Promise<void>((resolve) => {
      releaseFirstCommit = resolve;
    });
    let markFirstCommitStarted: () => void = () => {};
    const firstCommitStarted = new Promise<void>((resolve) => {
      markFirstCommitStarted = resolve;
    });
    const originalCommit = harness.storage.commitChatMemoryCapture!.bind(harness.storage);
    let commitCount = 0;
    harness.storage.commitChatMemoryCapture = async (body) => {
      commitCount += 1;
      if (commitCount === 1) {
        markFirstCommitStarted();
        await firstCommitReleased;
      }
      return originalCommit(body);
    };

    const processing = processAutomaticMemoryCaptureQueue(harness.dependencies, {
      now: "2026-01-01T00:05:00.000Z",
    });
    await firstCommitStarted;
    const releaseForegroundGeneration = beginForegroundGeneration(harness.storage);
    releaseFirstCommit();

    const result = await processing;
    expect(result.processed).toBe(1);
    expect(harness.jobs.get(String(secondJob?.id))?.status).toBe("pending");

    releaseForegroundGeneration();
    await vi.waitFor(() => expect(harness.jobs.get(String(secondJob?.id))?.status).toBe("completed"));
  });

  it("marks the assistant message extra after capture completes", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });

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
        valueReview: {
          status: "completed",
          reviewed: 1,
          rejected: 0,
          accepted: 1,
        },
        consequences: {
          status: "completed",
          affected: [],
        },
      },
    });
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ consequenceStatus: "completed", consequenceSkipReason: null }),
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
    const llm = passingValueReviewLlm(async (request) => {
      prompts.push(request.messages.map((entry) => entry.content).join("\n"));
      return JSON.stringify({
        memories: [
          {
            kind: "fact",
            content: "{{user}}'s cat is named Miso.",
            confidence: 0.97,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
            supersedesMemoryId: "malformed-memory",
          },
        ],
      });
    });

    await processAutomaticMemoryCaptureQueue({ storage: harness.storage, llm }, { now: "2026-01-01T00:03:00.000Z" });

    expect(prompts.join("\n")).not.toContain("malformed-memory");
    expect(harness.jobs.get(String(job?.id))?.affectedCanonicalMemoryIds).toEqual([]);
    expect(Array.from(harness.canonicalMemories.values()).filter((memory) => memory.id !== "malformed-memory")).toEqual(
      [],
    );
  });

  it("does not publish raw transcript capture as saved memory", async () => {
    const harness = queueStorage();
    await harness.enqueue();
    const notices: unknown[] = [];
    const unsubscribe = subscribeAutomaticMemoryCaptureCompletions((notice) => notices.push(notice));

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });
    unsubscribe();

    expect(notices).toEqual([]);
  });

  it("retries transient failures with bounded backoff before succeeding", async () => {
    const harness = queueStorage({ refreshFailures: 1 });
    const job = await harness.enqueue();
    const statuses: unknown[] = [];
    const unsubscribe = subscribeAutomaticMemoryCaptureStatuses((status) => statuses.push(status));

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });
    unsubscribe();
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ status: "retryable", attempts: 1, lastError: "provider unavailable" }),
    );
    expect((harness.messages.get("assistant-1")?.extra as JsonRecord).memoryCapture).toEqual({
      status: "retryable",
      jobId: String(job?.id),
      sourceMessageIds: ["user-1", "assistant-1"],
      attempts: 1,
      nextAttemptAt: "2026-01-01T00:04:00.000Z",
      updatedAt: "2026-01-01T00:03:00.000Z",
    });
    expect((harness.messages.get("assistant-1")?.extra as JsonRecord).memoryCapture).not.toHaveProperty("lastError");
    expect(statuses).toEqual([
      { chatId: "chat-1", assistantMessageId: "assistant-1", status: "processing" },
      { chatId: "chat-1", assistantMessageId: "assistant-1", status: "retryable" },
    ]);

    const retryAt = String(harness.jobs.get(String(job?.id))?.nextAttemptAt);
    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: retryAt });

    expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "completed", attempts: 2 }));
    expect(harness.commitCalls).toHaveLength(2);
    expect(harness.refreshCalls).toHaveLength(0);
  });

  it("marks a terminal capture failure without exposing its provider error on the message", async () => {
    const harness = queueStorage({ refreshFailures: 3 });
    const job = await harness.enqueue();

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });
    await processAutomaticMemoryCaptureQueue(harness.dependencies, {
      now: String(harness.jobs.get(String(job?.id))?.nextAttemptAt),
    });
    await processAutomaticMemoryCaptureQueue(harness.dependencies, {
      now: String(harness.jobs.get(String(job?.id))?.nextAttemptAt),
    });

    expect((harness.messages.get("assistant-1")?.extra as JsonRecord).memoryCapture).toEqual({
      status: "failed",
      jobId: String(job?.id),
      sourceMessageIds: ["user-1", "assistant-1"],
      attempts: 3,
      failureCategory: "capture_unavailable",
      updatedAt: "2026-01-01T00:09:00.000Z",
    });
    expect((harness.messages.get("assistant-1")?.extra as JsonRecord).memoryCapture).not.toHaveProperty("lastError");
    expect(harness.jobs.get(String(job?.id))?.lastError).toBe("provider unavailable");
  });

  it("wakes a retryable job at its backoff deadline without another generation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:03:00.000Z"));
    try {
      const harness = queueStorage({ refreshFailures: 1 });
      const job = await harness.enqueue();

      scheduleAutomaticMemoryCaptureQueueProcessing(harness.dependencies);
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "retryable", attempts: 1 }));

      await vi.advanceTimersByTimeAsync(59_999);
      expect(harness.jobs.get(String(job?.id))?.status).toBe("retryable");

      await vi.advanceTimersByTimeAsync(1);
      expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "completed", attempts: 2 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains more than one bounded batch after a single schedule request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:03:00.000Z"));
    try {
      const harness = queueStorage();
      const template = await harness.enqueue();
      for (let index = 1; index < 11; index += 1) {
        harness.jobs.set(`batch-job-${index}`, {
          ...template,
          id: `batch-job-${index}`,
          status: "pending",
          attempts: 0,
        } as JsonRecord);
      }

      scheduleAutomaticMemoryCaptureQueueProcessing(harness.dependencies);
      await vi.runAllTimersAsync();

      expect(Array.from(harness.jobs.values()).filter((job) => job.status === "completed")).toHaveLength(11);
      expect(harness.commitCalls).toHaveLength(11);
      expect(harness.refreshCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient consequence-extraction failure without duplicating canonical consequences", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    let attempts = 0;
    const llm = passingValueReviewLlm(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("extractor unavailable");
      return JSON.stringify({
        memories: [
          {
            kind: "fact",
            content: "{{user}}'s cat is named Miso.",
            confidence: 0.97,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
          },
        ],
      });
    });
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
      await processAutomaticMemoryCaptureQueue(harness.dependencies, { now });
    }

    expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "failed", attempts: 3 }));
  });

  it("resumes a processing job after restart", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    await harness.storage.update("memory-capture-jobs", String(job?.id), { status: "processing" });

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.jobs.get(String(job?.id))).toEqual(expect.objectContaining({ status: "completed" }));
  });

  it("marks edited or deleted source evidence stale instead of writing memory", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    await harness.storage.updateChatMessage("user-1", { content: "My cat's name changed." });

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.previewCalls).toHaveLength(0);
    expect(harness.refreshCalls).toHaveLength(0);
    expect(harness.jobs.get(String(job?.id))).toEqual(
      expect.objectContaining({ status: "stale", staleReason: "source_content_changed" }),
    );
  });

  it("marks a job stale when source evidence was deleted before processing", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    await harness.storage.deleteChatMessage("user-1");

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.previewCalls).toHaveLength(0);
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

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });
    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.commitCalls).toHaveLength(1);
    expect(harness.refreshCalls).toHaveLength(0);
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
    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });

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
    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });

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

  it("keeps raw local capture out of canonical character memory", async () => {
    const harness = queueStorage();
    await harness.enqueue();

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });

    expect(harness.canonicalMemories.size).toBe(0);
  });

  it("does not promote raw capture when a completed job is resumed", async () => {
    const harness = queueStorage();
    const job = await harness.enqueue();
    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });
    await harness.storage.update("memory-capture-jobs", String(job?.id), { status: "processing" });

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:04:00.000Z" });

    expect(harness.canonicalMemories.size).toBe(0);
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

    await processAutomaticMemoryCaptureQueue(harness.dependencies, { now: "2026-01-01T00:03:00.000Z" });

    expect(harness.canonicalMemories.size).toBe(0);
  });

  it("recalls an extracted Conversation consequence for the same character in a later Roleplay", async () => {
    const harness = queueStorage();
    await harness.enqueue();
    const llm = passingValueReviewLlm(async () =>
      JSON.stringify({
        memories: [
          {
            kind: "fact",
            content: "{{user}}'s cat is named Miso.",
            confidence: 0.97,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
          },
        ],
      }),
    );
    await processAutomaticMemoryCaptureQueue({ storage: harness.storage, llm }, { now: "2026-01-01T00:03:00.000Z" });
    const consequence = Array.from(harness.canonicalMemories.values()).find((memory) => memory.kind === "fact");

    const recalled = await buildCanonicalMemoryContext(harness.storage, {
      chat: { id: "chat-2", mode: "roleplay", metadata: {} },
      storedMessages: [{ id: "roleplay-user-1", role: "user", content: "What was my cat's name?" }],
      latestUserInput: "What was my cat's name?",
      characters: [{ id: "char-1", name: "Mira", tags: [] }],
      maxContext: 4096,
    });

    expect(recalled?.block).toContain("{{user}}'s cat is named Miso.");
    expect(recalled?.attributionItems).toContainEqual(
      expect.objectContaining({ sourceId: consequence?.id, sourceCollection: "canonical-memories" }),
    );
  });
});
