import { afterEach, describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { postReplyWorkRunning, trackPostReplyWork, waitForPostReplyWork } from "./post-reply-work";
import { startGeneration } from "./start-generation";

type Row = Record<string, unknown>;

const CONNECTION = { id: "conn-1", provider: "test-provider", model: "main-model" };
const IMAGE_CONNECTION = { id: "image-conn", provider: "image_generation", defaultForAgents: true };
const WAIT_PHASE = "Finishing the last reply's trackers...";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function agentRow(type: string): Row {
  return { id: `agent-${type}`, type, name: type, enabled: true, model: `model-${type}` };
}

/** Storage for one roleplay chat that logs the writes a quick second send could race. */
function chatStorage(agents: Row[], log: string[]) {
  const chat = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: CONNECTION.id,
    characterIds: [],
    metadata: { enableAgents: true, activeAgentIds: agents.map((agent) => agent.type) },
  };
  const messages: Row[] = [];
  const agentRuns: Row[] = [];
  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") return agents as T[];
      if (entity === "connections") return [CONNECTION, IMAGE_CONNECTION] as T[];
      if (entity === "agent-runs") return agentRuns as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === CONNECTION.id) return CONNECTION as T;
      if (entity === "connections" && id === IMAGE_CONNECTION.id) return IMAGE_CONNECTION as T;
      return null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Row): Promise<T> {
      const row = { id: `${entity}-${agentRuns.length + 1}`, ...value };
      if (entity === "agent-runs") {
        agentRuns.push(row);
        log.push(`agent-run:${String(value.agentType)}`);
      }
      return row as T;
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
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return (messages.find((row) => row.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Row): Promise<T> {
      const row = {
        id: `message-${messages.length + 1}`,
        chatId,
        createdAt: new Date(Date.UTC(2026, 9, 8, 10, messages.length)).toISOString(),
        ...value,
      };
      messages.push(row);
      log.push(`save:${String(value.role)}`);
      return row as T;
    },
    async updateChatMessage<T = unknown>() {
      return {} as T;
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Row): Promise<T> {
      const row = messages.find((message) => message.id === messageId);
      if (row) row.extra = { ...(row.extra as Row), ...patch };
      return (row ?? {}) as T;
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
    async saveTrackerSnapshot<T = unknown>(_chatId: string, snapshot: Row): Promise<T> {
      log.push(`tracker-snapshot:${String(snapshot.messageId)}`);
      return snapshot as T;
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
  return { storage };
}

/** The World State helper of the first reply answers only when `release` is called. */
function llmWithSlowWorldState() {
  const worldState = deferred();
  let worldStateCalls = 0;
  const llm: LlmGateway = {
    complete: vi.fn(async () => ""),
    async *stream(request: LlmRequest) {
      const model = String(request.model ?? "");
      if (model === "model-world-state") {
        worldStateCalls += 1;
        if (worldStateCalls === 1) await worldState.promise;
        yield { type: "token", text: JSON.stringify({ location: `Harbor ${worldStateCalls}` }) };
        return;
      }
      if (model === "model-illustrator") {
        yield { type: "token", text: JSON.stringify({ shouldGenerate: true, prompt: "A lantern in the rain." }) };
        return;
      }
      yield { type: "token", text: "The lantern stays lit." };
    },
    listModels: vi.fn(async () => []),
  };
  return { llm, release: () => worldState.resolve() };
}

function turn(storage: StorageGateway, llm: LlmGateway, integrations: IntegrationGateway, signal?: AbortSignal) {
  return startGeneration(
    { storage, llm, integrations },
    { chatId: "chat-1", connectionId: CONNECTION.id, userMessage: "Keep the lantern lit." },
    signal,
  );
}

async function advanceTo(generator: AsyncGenerator<GenerationEvent>, type: string): Promise<GenerationEvent[]> {
  const seen: GenerationEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error(`Generation finished before emitting ${type}.`);
    seen.push(next.value);
    if (next.value.type === type) return seen;
  }
}

/** Keep consuming a turn in the background, as the app does after Send unlocks. */
function drain(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  return (async () => {
    for await (const _event of generator) {
      // The app keeps reading the first reply's helper events while the next turn runs.
    }
  })();
}

const noImages = {} as IntegrationGateway;

describe("waitForPostReplyWork", () => {
  afterEach(() => vi.useRealTimers());

  const storage = {} as StorageGateway;

  it("resolves at once when nothing runs for the chat", async () => {
    await expect(waitForPostReplyWork(storage, "chat-idle", { timeoutMs: 10 })).resolves.toBe("finished");
  });

  it("waits until every piece of work for the chat ends, and only for that chat", async () => {
    const first = trackPostReplyWork(storage, "chat-a");
    const second = trackPostReplyWork(storage, "chat-a");
    const other = trackPostReplyWork(storage, "chat-b");
    const waited = waitForPostReplyWork(storage, "chat-a", { timeoutMs: 60_000 });
    first();
    first();
    expect(postReplyWorkRunning(storage, "chat-a")).toBe(true);
    second();
    await expect(waited).resolves.toBe("finished");
    expect(postReplyWorkRunning(storage, "chat-a")).toBe(false);
    expect(postReplyWorkRunning(storage, "chat-b")).toBe(true);
    other();
  });

  it("also waits for work that starts while it waits, within the same limit", async () => {
    vi.useFakeTimers();
    const first = trackPostReplyWork(storage, "chat-d");
    let waited: "finished" | "timed-out" | null = null;
    void waitForPostReplyWork(storage, "chat-d", { timeoutMs: 20_000 }).then((outcome) => {
      waited = outcome;
    });
    const late = trackPostReplyWork(storage, "chat-d");
    first();
    await vi.advanceTimersByTimeAsync(0);
    expect(waited).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(waited).toBe("timed-out");
    late();
  });

  it("gives up after the limit, and stops when the turn is cancelled", async () => {
    vi.useFakeTimers();
    const finish = trackPostReplyWork(storage, "chat-c");
    const timedOut = waitForPostReplyWork(storage, "chat-c", { timeoutMs: 20_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(timedOut).resolves.toBe("timed-out");

    const controller = new AbortController();
    const cancelled = waitForPostReplyWork(storage, "chat-c", { timeoutMs: 20_000, signal: controller.signal });
    controller.abort(new Error("stopped"));
    await expect(cancelled).rejects.toThrow("stopped");
    finish();
  });
});

describe("a quick second send", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for the first reply's trackers before it saves anything or reads tracker state", async () => {
    const log: string[] = [];
    const { storage } = chatStorage([agentRow("world-state")], log);
    const { llm, release } = llmWithSlowWorldState();

    const first = turn(storage, llm, noImages);
    await advanceTo(first, "assistant_message");
    const firstDone = drain(first);

    const second = turn(storage, llm, noImages);
    const beforeWait = await advanceTo(second, "phase");
    expect(beforeWait.at(-1)).toEqual({ type: "phase", data: WAIT_PHASE });
    const secondProgress = advanceTo(second, "user_message");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log).toEqual(["save:user", "save:assistant"]);

    release();
    await secondProgress;
    // The second turn's user message lands only after the first reply's snapshot and agent runs.
    expect(log.slice(0, 5)).toEqual([
      "save:user",
      "save:assistant",
      "tracker-snapshot:message-2",
      "agent-run:world-state",
      "save:user",
    ]);
    await Promise.all([firstDone, drain(second)]);
  });

  it("goes ahead after 20 seconds when the first reply's helpers still run", async () => {
    const log: string[] = [];
    const { storage } = chatStorage([agentRow("world-state")], log);
    const { llm, release } = llmWithSlowWorldState();

    const first = turn(storage, llm, noImages);
    await advanceTo(first, "assistant_message");
    const firstDone = drain(first);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const second = turn(storage, llm, noImages);
    await advanceTo(second, "phase");
    const secondProgress = advanceTo(second, "user_message");
    await vi.advanceTimersByTimeAsync(19_000);
    expect(log).toEqual(["save:user", "save:assistant"]);
    await vi.advanceTimersByTimeAsync(1_000);
    await secondProgress;
    expect(log).toEqual(["save:user", "save:assistant", "save:user"]);
    vi.useRealTimers();

    release();
    await Promise.all([firstDone, drain(second)]);
  });

  it("does not wait for the first reply's illustration once its trackers are saved", async () => {
    const log: string[] = [];
    const { storage } = chatStorage([agentRow("illustrator")], log);
    const { llm } = llmWithSlowWorldState();
    const image = deferred<{ base64: string; mimeType: string; ext: string }>();
    const integrations = { image: { generate: () => image.promise } } as unknown as IntegrationGateway;

    const first = turn(storage, llm, integrations);
    await advanceTo(first, "assistant_message");
    const firstDone = drain(first);
    await vi.waitFor(() => expect(log).toContain("agent-run:illustrator"));

    const second = turn(storage, llm, integrations);
    const events = await advanceTo(second, "user_message");

    expect(events).not.toContainEqual({ type: "phase", data: WAIT_PHASE });
    image.resolve({ base64: "iVBORw0KGgo=", mimeType: "image/png", ext: "png" });
    await Promise.all([firstDone, drain(second)]);
  });

  it("does not wait at all when the last reply's helpers are done", async () => {
    const log: string[] = [];
    const { storage } = chatStorage([agentRow("world-state")], log);
    const { llm, release } = llmWithSlowWorldState();
    release();

    await drain(turn(storage, llm, noImages));
    const events = await advanceTo(turn(storage, llm, noImages), "user_message");

    expect(events).not.toContainEqual({ type: "phase", data: WAIT_PHASE });
  });
});
