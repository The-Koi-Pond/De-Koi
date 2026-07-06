import { describe, expect, it } from "vitest";

import type { RefreshChatMemoriesOptions, StorageEntity, StorageGateway } from "../capabilities/storage";
import type { JsonRecord } from "./runtime-records";
import { enqueueAutomaticMemoryCaptureJob, processAutomaticMemoryCaptureQueue } from "./automatic-memory-capture-queue";

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

function queueStorage(options: { refreshFailures?: number } = {}) {
  const jobs = new Map<string, JsonRecord>();
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
    async patchChatMessageExtra<T = unknown>(): Promise<T> {
      return {} as T;
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
      return { rebuilt: 1 } as T;
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
  };

  async function enqueue() {
    return enqueueAutomaticMemoryCaptureJob(
      storage,
      {
        chat: { id: "chat-1", mode: "conversation" },
        savedUserMessage: messages.get("user-1"),
        savedAssistantMessage: messages.get("assistant-1"),
      },
      "2026-01-01T00:03:00.000Z",
    );
  }

  return { storage, jobs, messages, refreshCalls, enqueue };
}

describe("automatic memory capture queue", () => {
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
});
