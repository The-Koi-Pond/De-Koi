import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { createFakeBackgroundJobs } from "./background-job-queue.fake";
import { resumeQueuedLorebookKeeperBackfills, startGeneration } from "./start-generation";

const continuityScheduler = vi.hoisted(() => vi.fn());

vi.mock("../modes/roleplay/continuity-director/continuity-director-scheduler", () => ({
  scheduleContinuityDirectorRefreshDurably: continuityScheduler,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function lorebookKeeperBackgroundStorage() {
  const agentRuns = deferred<Record<string, unknown>[]>();
  const chat = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: "conn-1",
    characterIds: [],
    metadata: { activeAgentIds: ["lorebook-keeper"] },
  };
  const connection = { id: "conn-1", provider: "test-provider", model: "test-model" };
  const messages: Record<string, unknown>[] = [];
  let backfillStarted = false;

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") {
        return [
          {
            id: "lorebook-keeper",
            type: "lorebook-keeper",
            enabled: true,
            settings: { runInterval: 1 },
          },
        ] as T[];
      }
      if (entity === "agent-runs") {
        backfillStarted = true;
        return (await agentRuns.promise) as T[];
      }
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === connection.id) return connection as T;
      return null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return { id: `message-${messages.length + 1}`, ...value } as T;
    },
    async update<T = unknown>() {
      return {} as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const message = { id: `message-${messages.length + 1}`, chatId, ...value };
      messages.push(message);
      return message as T;
    },
    async updateChatMessage<T = unknown>() {
      return {} as T;
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>() {
      return {} as T;
    },
    async addChatMessageSwipe<T = unknown>() {
      return {} as T;
    },
    async patchChatMetadata<T = unknown>() {
      return {} as T;
    },
    async patchChatSummaries<T = unknown>() {
      return {} as T;
    },
    async listChatMemories<T = unknown>() {
      return [] as T[];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return {} as T;
    },
    async listLorebookEntries() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull() {
      return null;
    },
  };

  return {
    storage,
    releaseBackfill() {
      const assistantMessageId = String(messages.find((message) => message.role === "assistant")?.id ?? "");
      agentRuns.resolve([
        {
          id: "processed-assistant-message",
          chatId: chat.id,
          messageId: assistantMessageId,
          agentType: "lorebook-keeper",
          success: true,
        },
      ]);
    },
    backfillStarted: () => backfillStarted,
  };
}

async function advanceToDone(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error("Generation finished before emitting done.");
    if (next.value.type === "done") return;
  }
}

describe("startGeneration Lorebook Keeper backfill", () => {
  beforeEach(() => continuityScheduler.mockReset().mockResolvedValue(true));

  it("reports done only after the Director refresh is stored, so closing the tab then cannot drop it", async () => {
    const stored = deferred<boolean>();
    continuityScheduler.mockReturnValue(stored.promise);
    const { storage, releaseBackfill } = lorebookKeeperBackgroundStorage();
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream() {
        yield { type: "token", text: "The lantern stays lit." };
      },
      listModels: vi.fn(async () => []),
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "Keep the lantern lit.", impersonateBlockAgents: true },
    );
    let done = false;
    const reachedDone = advanceToDone(generation).then(() => {
      done = true;
    });

    try {
      await vi.waitFor(() => expect(continuityScheduler).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(done).toBe(false);
      stored.resolve(true);
      await reachedDone;
      expect(done).toBe(true);
      await generation.return(undefined);
    } finally {
      releaseBackfill();
    }
  });

  it("starts the normal-path Keeper backfill after done even when the consumer stops iteration", async () => {
    vi.useFakeTimers();
    const { storage, releaseBackfill, backfillStarted } = lorebookKeeperBackgroundStorage();
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream() {
        yield { type: "token", text: "The lantern stays lit." };
      },
      listModels: vi.fn(async () => []),
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "Keep the lantern lit.", impersonateBlockAgents: true },
    );

    try {
      await advanceToDone(generation);
      expect(continuityScheduler).toHaveBeenCalledWith({
        storage,
        llm,
        chatId: "chat-1",
        trigger: "assistant_saved",
      });
      expect(backfillStarted()).toBe(false);
      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(backfillStarted()).toBe(true);
      releaseBackfill();
    } finally {
      releaseBackfill();
      vi.useRealTimers();
    }
  });

  it("starts the direct-message Keeper backfill after done and detaches foreground cancellation", async () => {
    vi.useFakeTimers();
    const { storage, releaseBackfill, backfillStarted } = lorebookKeeperBackgroundStorage();
    const controller = new AbortController();
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream() {
        yield { type: "token", text: "The lantern stays lit." };
      },
      listModels: vi.fn(async () => []),
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      {
        chatId: "chat-1",
        connectionId: "conn-1",
        messages: [{ role: "user", content: "Keep the lantern lit." }],
        impersonateBlockAgents: true,
      },
      controller.signal,
    );

    try {
      await advanceToDone(generation);
      expect(continuityScheduler).toHaveBeenCalledWith({
        storage,
        llm,
        chatId: "chat-1",
        trigger: "assistant_saved",
      });
      expect(backfillStarted()).toBe(false);
      controller.abort();
      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(backfillStarted()).toBe(true);
      releaseBackfill();
    } finally {
      releaseBackfill();
      vi.useRealTimers();
    }
  });

  describe("on a runtime that stores background jobs", () => {
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream() {
        yield { type: "token", text: "The lantern stays lit." };
      },
      listModels: vi.fn(async () => []),
    };

    const keeperJobId = "lorebook-keeper:chat-1";

    function liveHolds(fake: ReturnType<typeof createFakeBackgroundJobs>): string[] {
      const job = fake.jobs.get(keeperJobId);
      return job ? [...job.holds].filter(([, lapsesAt]) => lapsesAt > Date.now()).map(([id]) => id) : [];
    }

    function durableGeneration(fake: ReturnType<typeof createFakeBackgroundJobs>, storage: StorageGateway) {
      return startGeneration(
        {
          storage: { ...storage, backgroundJobs: fake.gateway } as StorageGateway,
          llm,
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Keep the lantern lit.",
          impersonateBlockAgents: true,
        },
      );
    }

    it("holds the Keeper backfill from before the reply is saved until the turn is done, then runs it", async () => {
      const fake = createFakeBackgroundJobs();
      const order: string[] = [];
      const fakeEnqueue = fake.gateway.enqueue.bind(fake.gateway);
      const keeperEnqueue = vi.spyOn(fake.gateway, "enqueue").mockImplementation(async (input) => {
        if (input.queue === "lorebook-keeper") order.push(input.releaseHoldId ? "release" : "hold");
        return fakeEnqueue(input);
      });
      const { storage, releaseBackfill, backfillStarted } = lorebookKeeperBackgroundStorage();
      const createChatMessage = storage.createChatMessage.bind(storage);
      storage.createChatMessage = async (chatId, value) => {
        if (value.role === "assistant") order.push("save");
        return createChatMessage(chatId, value);
      };
      const generation = durableGeneration(fake, storage);

      try {
        await advanceToDone(generation);
        const keeperCalls = keeperEnqueue.mock.calls
          .map(([call]) => call)
          .filter((call) => call.queue === "lorebook-keeper");
        expect(keeperCalls).toEqual([
          expect.objectContaining({ key: "chat-1", payload: { connectionId: "conn-1" }, holdId: expect.any(String) }),
          expect.objectContaining({ key: "chat-1", releaseHoldId: keeperCalls[0]?.holdId }),
        ]);
        expect(order).toEqual(["hold", "save", "release"]);
        expect(liveHolds(fake)).toEqual([]);
        // This tab still waits for its own generation to finish before running it.
        expect(backfillStarted()).toBe(false);

        await generation.return(undefined);
        await vi.waitFor(() => expect(backfillStarted()).toBe(true));
        releaseBackfill();
        await vi.waitFor(() =>
          expect(fake.finished).toContainEqual({ jobId: keeperJobId, outcome: "done", error: null }),
        );
      } finally {
        releaseBackfill();
      }
    });

    it("keeps the hold for as long as the turn is still writing, however long that takes", async () => {
      vi.useFakeTimers();
      const fake = createFakeBackgroundJobs();
      const { storage, releaseBackfill } = lorebookKeeperBackgroundStorage();
      const save = deferred<void>();
      const createChatMessage = storage.createChatMessage.bind(storage);
      storage.createChatMessage = async (chatId, value) => {
        if (value.role === "assistant") await save.promise;
        return createChatMessage(chatId, value);
      };
      const generation = durableGeneration(fake, storage);
      const reachedDone = advanceToDone(generation);

      try {
        await vi.waitFor(() => expect(liveHolds(fake)).toHaveLength(1));
        // Far past the runtime's 30s hold lifetime: renewals keep it live.
        await vi.advanceTimersByTimeAsync(3 * 60_000);
        expect(liveHolds(fake)).toHaveLength(1);
        save.resolve();
        await reachedDone;
        expect(liveHolds(fake)).toEqual([]);
        await generation.return(undefined);
      } finally {
        save.resolve();
        releaseBackfill();
        vi.useRealTimers();
      }
    });

    it("releases the hold when the turn fails, so the backfill can repair it", async () => {
      const fake = createFakeBackgroundJobs();
      const keeperEnqueue = vi.spyOn(fake.gateway, "enqueue");
      const { storage, releaseBackfill } = lorebookKeeperBackgroundStorage();
      const createChatMessage = storage.createChatMessage.bind(storage);
      storage.createChatMessage = async (chatId, value) => {
        if (value.role === "assistant") throw new Error("disk full");
        return createChatMessage(chatId, value);
      };
      const generation = durableGeneration(fake, storage);

      try {
        await expect(advanceToDone(generation)).rejects.toThrow("disk full");
        const keeperCalls = keeperEnqueue.mock.calls
          .map(([call]) => call)
          .filter((call) => call.queue === "lorebook-keeper");
        expect(keeperCalls).toEqual([
          expect.objectContaining({ holdId: expect.any(String) }),
          expect.objectContaining({ releaseHoldId: keeperCalls[0]?.holdId }),
        ]);
        expect(liveHolds(fake)).toEqual([]);
      } finally {
        releaseBackfill();
      }
    });

    it("finishes a queued backfill for a deleted chat and fails one for a chat that cannot generate", async () => {
      const fake = createFakeBackgroundJobs();
      await fake.gateway.enqueue({ queue: "lorebook-keeper", key: "gone", chatId: "gone", payload: {} });
      await fake.gateway.enqueue({ queue: "lorebook-keeper", key: "concluded", chatId: "concluded", payload: {} });
      const storage = {
        backgroundJobs: fake.gateway,
        get: vi.fn(async (entity: string, id: string) =>
          entity === "chats" && id === "concluded"
            ? { id, mode: "roleplay", characterIds: ["char-1"], metadata: { sceneStatus: "concluded" } }
            : null,
        ),
      } as unknown as StorageGateway;

      resumeQueuedLorebookKeeperBackfills({ storage, llm, integrations: {} as IntegrationGateway });

      await vi.waitFor(() =>
        expect(fake.finished).toEqual([
          { jobId: "lorebook-keeper:gone", outcome: "done", error: null },
          { jobId: "lorebook-keeper:concluded", outcome: "failed", error: null },
        ]),
      );
    });
  });
});
