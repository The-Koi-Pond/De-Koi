import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackgroundJobsGateway } from "../capabilities/background-jobs";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { createFakeBackgroundJobs } from "./background-job-queue.fake";
import { startGeneration } from "./start-generation";

const directorPlan = vi.hoisted(() => vi.fn());
const summaryBackfill = vi.hoisted(() => vi.fn());

vi.mock("../modes/roleplay/continuity-director/continuity-director-planner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../modes/roleplay/continuity-director/continuity-director-planner")>()),
  refreshContinuityDirectorPlan: directorPlan,
}));

vi.mock("../modes/chat/core/summaries/auto-summary.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../modes/chat/core/summaries/auto-summary.service")>()),
  backfillConversationSummaries: summaryBackfill,
}));

const CADENCE_DIRECTOR = { version: 1, enabled: true, refreshMode: "cadence", refreshEveryAssistantTurns: 5 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** Storage for one chat that logs "save" when the assistant reply is written. */
function chatStorage(chat: Record<string, unknown>, order: string[]) {
  const connection = { id: "conn-1", provider: "test-provider", model: "test-model" };
  const messages: Record<string, unknown>[] = [];
  const storage: StorageGateway = {
    async list<T = unknown>(_entity: StorageEntity): Promise<T[]> {
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === connection.id) return connection as T;
      return null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return { id: `record-${messages.length + 1}`, ...value } as T;
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
      if (value.role === "assistant") order.push("save");
      const message = { id: `message-${messages.length + 1}`, chatId, createdAt: new Date().toISOString(), ...value };
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
  return { storage, assistantSaved: () => messages.some((message) => message.role === "assistant") };
}

/** Logs each enqueue of the watched queues as `<queue>:hold`, `<queue>:release` or `<queue>:enqueue`. */
function loggedJobs(order: string[], queues: string[]) {
  const fake = createFakeBackgroundJobs();
  const enqueue = fake.gateway.enqueue.bind(fake.gateway);
  const calls: Parameters<BackgroundJobsGateway["enqueue"]>[0][] = [];
  fake.gateway.enqueue = async (input) => {
    if (queues.includes(input.queue)) {
      calls.push(input);
      order.push(`${input.queue}:${input.holdId ? "hold" : input.releaseHoldId ? "release" : "enqueue"}`);
    }
    return enqueue(input);
  };
  return { fake, calls };
}

/**
 * Records whether the reply was already saved when the Director planned for `runtimeStorage`.
 * Matched by storage, since queued refreshes left by earlier tests can still run on their own timers.
 */
function recordPlansFor(runtimeStorage: StorageGateway, assistantSaved: () => boolean): boolean[] {
  const savedWhenPlanned: boolean[] = [];
  directorPlan.mockImplementation(async ({ storage }: { storage: StorageGateway }) => {
    if (storage === runtimeStorage) savedWhenPlanned.push(assistantSaved());
    return { ok: true, rejectedUnsafeBeats: 0 };
  });
  return savedWhenPlanned;
}

function liveHolds(fake: ReturnType<typeof createFakeBackgroundJobs>, jobId: string): string[] {
  const job = fake.jobs.get(jobId);
  return job ? [...job.holds].filter(([, lapsesAt]) => lapsesAt > Date.now()).map(([id]) => id) : [];
}

const llm: LlmGateway = {
  complete: vi.fn(async () => ""),
  async *stream() {
    yield { type: "token", text: "The lantern stays lit." };
  },
  listModels: vi.fn(async () => []),
};

const PATHS = [
  { path: "normal", turn: { userMessage: "Keep the lantern lit." } },
  { path: "direct", turn: { messages: [{ role: "user" as const, content: "Keep the lantern lit." }] } },
];

function generate(storage: StorageGateway, turn: (typeof PATHS)[number]["turn"]) {
  return startGeneration(
    { storage, llm, integrations: {} as IntegrationGateway },
    { chatId: "chat-1", connectionId: "conn-1", impersonateBlockAgents: true, ...turn },
  );
}

async function advanceToDone(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error("Generation finished before emitting done.");
    if (next.value.type === "done") return;
  }
}

function roleplayChat(director: Record<string, unknown>) {
  return {
    id: "chat-1",
    mode: "roleplay",
    connectionId: "conn-1",
    characterIds: [],
    metadata: { roleplayContinuityDirector: director },
  };
}

describe("startGeneration post-reply jobs that read the saved reply", () => {
  afterEach(() => {
    directorPlan.mockReset();
    summaryBackfill.mockReset();
    vi.useRealTimers();
  });

  describe.each(PATHS)("on the $path path", ({ turn }) => {
    it("holds a cadence Director refresh from before the reply is saved until the turn is done", async () => {
      const order: string[] = [];
      const { storage, assistantSaved } = chatStorage(roleplayChat(CADENCE_DIRECTOR), order);
      const { fake, calls } = loggedJobs(order, ["continuity-director"]);
      const runtimeStorage = { ...storage, backgroundJobs: fake.gateway };
      const savedWhenPlanned = recordPlansFor(runtimeStorage, assistantSaved);
      const generation = generate(runtimeStorage, turn);

      await advanceToDone(generation);
      // Stored before the save, so a tab closed the moment the reply lands still has it queued; held
      // until the turn has written everything, so no client counts a turn that isn't saved yet.
      expect(order).toEqual(["continuity-director:hold", "save", "continuity-director:release"]);
      expect(calls[0]).toEqual(
        expect.objectContaining({ key: "chat-1", payload: { trigger: "assistant_saved" }, holdId: expect.any(String) }),
      );
      expect(calls[1]).toEqual(expect.objectContaining({ releaseHoldId: calls[0]?.holdId }));
      expect(liveHolds(fake, "continuity-director:chat-1")).toEqual([]);

      await generation.return(undefined);
      await vi.waitFor(() =>
        expect(fake.finished).toContainEqual({ jobId: "continuity-director:chat-1", outcome: "done", error: null }),
      );
      expect(savedWhenPlanned).toEqual([true]);
    });

    it("queues the conversation summary before the reply is saved", async () => {
      const order: string[] = [];
      const { storage } = chatStorage({ id: "chat-1", mode: "conversation", connectionId: "conn-1" }, order);
      const { fake, calls } = loggedJobs(order, ["conversation-summary"]);
      summaryBackfill.mockResolvedValue({ failedDays: [], failedWeeks: [] });
      const generation = generate({ ...storage, backgroundJobs: fake.gateway }, turn);

      await advanceToDone(generation);
      expect(order).toEqual(["conversation-summary:enqueue", "save"]);
      expect(calls[0]).toEqual(expect.objectContaining({ key: "chat-1", chatId: "chat-1" }));

      await generation.return(undefined);
      await vi.waitFor(() => expect(summaryBackfill).toHaveBeenCalledOnce());
    });
  });

  it("keeps the Director hold for as long as the turn is still writing, however long that takes", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const { storage } = chatStorage(roleplayChat(CADENCE_DIRECTOR), order);
    const { fake } = loggedJobs(order, ["continuity-director"]);
    directorPlan.mockResolvedValue({ ok: true, rejectedUnsafeBeats: 0 });
    const save = deferred<void>();
    const createChatMessage = storage.createChatMessage.bind(storage);
    storage.createChatMessage = async (chatId, value) => {
      if (value.role === "assistant") await save.promise;
      return createChatMessage(chatId, value);
    };
    const generation = generate({ ...storage, backgroundJobs: fake.gateway }, PATHS[0]!.turn);
    const reachedDone = advanceToDone(generation);

    try {
      await vi.waitFor(() => expect(liveHolds(fake, "continuity-director:chat-1")).toHaveLength(1));
      // Far past the runtime's 30s hold lifetime: renewals keep it live.
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(liveHolds(fake, "continuity-director:chat-1")).toHaveLength(1);
      save.resolve();
      await reachedDone;
      expect(liveHolds(fake, "continuity-director:chat-1")).toEqual([]);
      await generation.return(undefined);
    } finally {
      save.resolve();
    }
  });

  it("releases the Director hold when the reply cannot be saved", async () => {
    const order: string[] = [];
    const { storage } = chatStorage(roleplayChat(CADENCE_DIRECTOR), order);
    const { fake, calls } = loggedJobs(order, ["continuity-director"]);
    directorPlan.mockResolvedValue({ ok: true, rejectedUnsafeBeats: 0 });
    storage.createChatMessage = async (_chatId, value) => {
      if (value.role === "assistant") throw new Error("disk full");
      return {} as never;
    };

    await expect(advanceToDone(generate({ ...storage, backgroundJobs: fake.gateway }, PATHS[0]!.turn))).rejects.toThrow(
      "disk full",
    );
    expect(calls).toEqual([
      expect.objectContaining({ holdId: expect.any(String) }),
      expect.objectContaining({ releaseHoldId: calls[0]?.holdId }),
    ]);
    expect(liveHolds(fake, "continuity-director:chat-1")).toEqual([]);
  });

  it("runs the Director in this tab only once the reply is saved when the runtime can't store it", async () => {
    const order: string[] = [];
    const { storage, assistantSaved } = chatStorage(roleplayChat(CADENCE_DIRECTOR), order);
    const { fake } = loggedJobs(order, []);
    const enqueue = fake.gateway.enqueue.bind(fake.gateway);
    fake.gateway.enqueue = async (input) => {
      if (input.queue === "continuity-director") throw new Error("director queue offline");
      return enqueue(input);
    };
    const runtimeStorage = { ...storage, backgroundJobs: fake.gateway };
    const savedWhenPlanned = recordPlansFor(runtimeStorage, assistantSaved);
    const generation = generate(runtimeStorage, PATHS[0]!.turn);

    await advanceToDone(generation);
    await vi.waitFor(() => expect(savedWhenPlanned).toEqual([true]));
    await generation.return(undefined);
  });

  it.each([
    ["refreshes on scene events", { version: 1, enabled: true, refreshMode: "scene_events" }],
    ["is off", { version: 1, enabled: false, refreshMode: "cadence", refreshEveryAssistantTurns: 5 }],
  ])("queues no reply trigger when the chat's Director %s", async (_label, director) => {
    const order: string[] = [];
    const { storage } = chatStorage(roleplayChat(director), order);
    const { fake } = loggedJobs(order, ["continuity-director"]);
    // A scene trigger already waiting must not be replaced by a reply trigger the Director ignores.
    await fake.gateway.enqueue({
      queue: "continuity-director",
      key: "chat-1",
      chatId: "chat-1",
      payload: { trigger: "scene_concluded" },
    });
    order.length = 0;
    fake.holdLease("continuity-director");
    const generation = generate({ ...storage, backgroundJobs: fake.gateway }, PATHS[0]!.turn);

    await advanceToDone(generation);
    expect(order).toEqual(["save"]);
    expect(fake.jobs.get("continuity-director:chat-1")?.payload).toEqual({ trigger: "scene_concluded" });
    await generation.return(undefined);
  });
});
