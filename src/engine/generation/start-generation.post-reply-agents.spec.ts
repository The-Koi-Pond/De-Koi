import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackgroundJobsGateway } from "../capabilities/background-jobs";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { createFakeBackgroundJobs } from "./background-job-queue.fake";
import { resumeQueuedPostReplyAgents, startGeneration } from "./start-generation";

type Row = Record<string, unknown>;

const CONNECTION = { id: "conn-1", provider: "test-provider", model: "main-model" };
const WORLD_STATE_REPLY = JSON.stringify({ location: "Lantern harbor", time: "Night", weather: "Rain" });

/** One agent row per type; each runs on its own model, so the model of each LLM call names the agent. */
function agentRow(type: string, overrides: Row = {}): Row {
  return { id: `agent-${type}`, type, name: type, enabled: true, model: `model-${type}`, ...overrides };
}

const AGENTS = [
  agentRow("world-state"),
  // Pre-generation: shaped the turn's prompt; a recovery never runs it again.
  agentRow("prompt-reviewer"),
  // Live-only effects: never replayed.
  agentRow("echo-chamber"),
  agentRow("cyoa"),
  agentRow("music-dj"),
  // Disabled built-in: the automatic turn skipped it, so the recovery does too.
  agentRow("expression", { enabled: false }),
  // Every 5 assistant replies, last ran one reply ago: the turn skipped it, so the recovery does too.
  agentRow("illustrator", { settings: { runInterval: 5 } }),
];

function roleplayChat(activeAgentIds: string[]): Row {
  return {
    id: "chat-1",
    mode: "roleplay",
    connectionId: CONNECTION.id,
    characterIds: [],
    metadata: { enableAgents: true, activeAgentIds },
  };
}

function message(id: string, role: string, minute: number, extra: Row = {}): Row {
  const at = `2026-10-08T10:${String(minute).padStart(2, "0")}:00.000Z`;
  return { id, chatId: "chat-1", role, content: `${role} ${id}`, createdAt: at, updatedAt: at, extra };
}

function runtimeStorage(options: { chat: Row; agents: Row[]; messages?: Row[]; agentRuns?: Row[] }) {
  const messages = (options.messages ?? []).map((row) => ({ ...row }));
  const agentRuns = [...(options.agentRuns ?? [])];
  const snapshots: Row[] = [];
  const extraPatches: Array<{ messageId: string; patch: Row }> = [];
  const savedAssistantExtras: Row[] = [];
  const findMessage = (id: string) => messages.find((row) => row.id === id) ?? null;
  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") return options.agents as T[];
      if (entity === "connections") return [CONNECTION] as T[];
      if (entity === "agent-runs") return agentRuns as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === options.chat.id) return options.chat as T;
      if (entity === "connections" && id === CONNECTION.id) return CONNECTION as T;
      return null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Row): Promise<T> {
      const row = { id: `${entity}-${agentRuns.length + 1}`, ...value };
      if (entity === "agent-runs") agentRuns.push(row);
      return row as T;
    },
    async update<T = unknown>() {
      return {} as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(_chatId: string, listOptions?: { before?: unknown }): Promise<T[]> {
      if (!listOptions?.before) return messages as T[];
      const before = String(listOptions.before);
      return messages.filter((row) => `${row.createdAt}|${row.id}` < before) as T[];
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return findMessage(messageId) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Row): Promise<T> {
      const row = message(`message-${messages.length + 1}`, String(value.role), 30 + messages.length);
      Object.assign(row, value, { chatId });
      if (value.role === "assistant") savedAssistantExtras.push(structuredClone(value.extra as Row));
      messages.push(row);
      return row as T;
    },
    async updateChatMessage<T = unknown>() {
      return {} as T;
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Row): Promise<T> {
      extraPatches.push({ messageId, patch });
      const row = findMessage(messageId);
      if (!row) throw new Error(`missing message ${messageId}`);
      row.extra = { ...(row.extra as Row), ...patch };
      return row as T;
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
    async saveTrackerSnapshot<T = unknown>(chatId: string, snapshot: Row): Promise<T> {
      snapshots.push({ chatId, ...snapshot });
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
  return { storage, messages, agentRuns, snapshots, extraPatches, savedAssistantExtras, findMessage };
}

/** Records the model of every LLM call; agents get a world-state update, the main reply gets prose. */
function recordingLlm() {
  const models: string[] = [];
  const llm: LlmGateway = {
    complete: vi.fn(async () => ""),
    async *stream(request: LlmRequest) {
      const model = String(request.model ?? "");
      models.push(model);
      yield { type: "token", text: model === CONNECTION.model ? "The lantern stays lit." : WORLD_STATE_REPLY };
    },
    listModels: vi.fn(async () => []),
  };
  return { llm, models, agentModels: () => models.filter((model) => model !== CONNECTION.model) };
}

/** Logs each post-reply-agents enqueue as `hold`, `release` or `enqueue`, and the assistant save as `save`. */
function loggedJobs(order: string[]) {
  const fake = createFakeBackgroundJobs();
  const enqueue = fake.gateway.enqueue.bind(fake.gateway);
  const calls: Parameters<BackgroundJobsGateway["enqueue"]>[0][] = [];
  fake.gateway.enqueue = async (input) => {
    if (input.queue === "post-reply-agents") {
      calls.push(input);
      order.push(input.holdId ? "hold" : input.releaseHoldId ? "release" : "enqueue");
    }
    return enqueue(input);
  };
  return { fake, calls };
}

async function advanceToDone(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error("Generation finished before emitting done.");
    if (next.value.type === "done") return;
  }
}

const integrations = {} as IntegrationGateway;

describe("post-reply helpers held as a durable job", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the job from before the reply is saved until the turn has run its helpers, then finds them done", async () => {
    const order: string[] = [];
    const runtime = runtimeStorage({ chat: roleplayChat(["world-state"]), agents: [agentRow("world-state")] });
    const createChatMessage = runtime.storage.createChatMessage.bind(runtime.storage);
    runtime.storage.createChatMessage = async (chatId, value) => {
      if (value.role === "assistant") order.push("save");
      return createChatMessage(chatId, value);
    };
    const { fake, calls } = loggedJobs(order);
    const { llm, agentModels } = recordingLlm();
    const storage = { ...runtime.storage, backgroundJobs: fake.gateway };

    const generation = startGeneration(
      { storage, llm, integrations },
      { chatId: "chat-1", connectionId: CONNECTION.id, userMessage: "Keep the lantern lit." },
    );
    await advanceToDone(generation);

    expect(order).toEqual(["hold", "save", "release"]);
    const turnId = String(calls[0]?.key);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        chatId: "chat-1",
        payload: expect.objectContaining({ turnId, connectionId: CONNECTION.id, regeneration: false }),
        holdId: expect.any(String),
      }),
    );
    expect(calls[1]).toEqual(expect.objectContaining({ key: turnId, releaseHoldId: calls[0]?.holdId }));
    // Saved pending, marked done once the helpers wrote everything, before the hold is released.
    expect(runtime.savedAssistantExtras[0]?.postReplyAgents).toEqual({ turnId, status: "pending" });
    const reply = runtime.messages.find((row) => row.role === "assistant")!;
    expect((reply.extra as Row).postReplyAgents).toEqual({ turnId, status: "done" });
    expect(runtime.snapshots).toHaveLength(1);

    await generation.return(undefined);
    await vi.waitFor(() =>
      expect(fake.finished).toContainEqual({ jobId: `post-reply-agents:${turnId}`, outcome: "done", error: null }),
    );
    // The job found the helpers done and ran nothing again.
    expect(agentModels()).toEqual(["model-world-state"]);
    expect(runtime.snapshots).toHaveLength(1);
  });

  it("holds no job for a turn without helpers a recovery would run", async () => {
    const order: string[] = [];
    const runtime = runtimeStorage({
      chat: roleplayChat(["prompt-reviewer", "music-dj"]),
      agents: [agentRow("prompt-reviewer"), agentRow("music-dj")],
    });
    const { fake } = loggedJobs(order);
    const { llm } = recordingLlm();

    const generation = startGeneration(
      { storage: { ...runtime.storage, backgroundJobs: fake.gateway }, llm, integrations },
      { chatId: "chat-1", connectionId: CONNECTION.id, userMessage: "Keep the lantern lit." },
    );
    await advanceToDone(generation);
    await generation.return(undefined);

    expect(order).toEqual([]);
    expect(runtime.savedAssistantExtras[0]).not.toHaveProperty("postReplyAgents");
  });

  describe("when the turn's tab closed before its helpers finished", () => {
    function pendingReply(turnId: string) {
      const earlierReply = message("assistant-0", "assistant", 0);
      const user = message("user-1", "user", 1);
      const reply = message("assistant-1", "assistant", 2, {
        postReplyAgents: { turnId, status: "pending" },
        contextInjections: [{ agentType: "prompt-reviewer", text: "Keep it tense." }],
      });
      return runtimeStorage({
        chat: roleplayChat(AGENTS.map((agent) => String(agent.type))),
        agents: AGENTS,
        messages: [earlierReply, user, reply],
        agentRuns: [
          {
            id: "run-0",
            chatId: "chat-1",
            messageId: "assistant-0",
            agentType: "illustrator",
            success: true,
            resultType: "image_prompt",
            resultData: { shouldGenerate: true, prompt: "A lantern in the rain." },
            createdAt: "2026-10-08T10:00:30.000Z",
          },
        ],
      });
    }

    async function recover(runtime: ReturnType<typeof runtimeStorage>, turnId: string) {
      const fake = createFakeBackgroundJobs();
      const { llm, agentModels } = recordingLlm();
      await fake.gateway.enqueue({
        queue: "post-reply-agents",
        key: turnId,
        chatId: "chat-1",
        payload: { turnId, connectionId: CONNECTION.id, regeneration: false },
      });
      resumeQueuedPostReplyAgents({ storage: { ...runtime.storage, backgroundJobs: fake.gateway }, llm, integrations });
      await vi.waitFor(() => expect(fake.finished).toHaveLength(1));
      return { finished: fake.finished, agentModels };
    }

    it("any client re-runs the reply's helpers from storage, as the automatic turn would have", async () => {
      const runtime = pendingReply("reply-1");

      const { finished, agentModels } = await recover(runtime, "reply-1");

      expect(finished).toEqual([{ jobId: "post-reply-agents:reply-1", outcome: "done", error: null }]);
      // Only enabled parallel/post-processing helpers that pass their run interval; no pre-generation
      // agent, no disabled one, and nothing whose effect only mattered live.
      expect(agentModels()).toEqual(["model-world-state"]);
      expect(runtime.agentRuns.filter((run) => run.messageId === "assistant-1")).toEqual([
        expect.objectContaining({ agentType: "world-state", success: true }),
      ]);
      expect(runtime.snapshots).toEqual([expect.objectContaining({ chatId: "chat-1", messageId: "assistant-1" })]);
      const reply = runtime.findMessage("assistant-1")!;
      expect((reply.extra as Row).postReplyAgents).toEqual({ turnId: "reply-1", status: "done" });
      // The turn's stored injections are kept, not replaced.
      expect((reply.extra as Row).contextInjections).toEqual([
        { agentType: "prompt-reviewer", text: "Keep it tense." },
      ]);
    });

    it("runs nothing when a later regeneration replaced the reply", async () => {
      const runtime = pendingReply("reply-2");

      const { finished, agentModels } = await recover(runtime, "reply-1");

      expect(finished).toEqual([{ jobId: "post-reply-agents:reply-1", outcome: "done", error: null }]);
      expect(agentModels()).toEqual([]);
      expect(runtime.extraPatches).toEqual([]);
    });

    it("runs nothing when the turn already marked its helpers done", async () => {
      const runtime = pendingReply("reply-1");
      runtime.findMessage("assistant-1")!.extra = { postReplyAgents: { turnId: "reply-1", status: "done" } };

      const { agentModels } = await recover(runtime, "reply-1");

      expect(agentModels()).toEqual([]);
      expect(runtime.snapshots).toEqual([]);
    });
  });
});
