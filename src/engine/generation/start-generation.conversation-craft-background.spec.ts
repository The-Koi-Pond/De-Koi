import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function conversationStorage(options: { enableAgents?: boolean; group?: boolean } = {}) {
  const characterIds = options.group ? ["char-a", "char-b"] : ["char-a"];
  const chat = {
    id: "chat-1",
    mode: "conversation",
    connectionId: "conn-1",
    characterIds,
    metadata: {
      activeAgentIds: [],
      enableAgents: options.enableAgents ?? true,
      groupResponseOrder: "sequential",
    },
  };
  const connection = { id: "conn-1", provider: "test-provider", model: "writer-model" };
  const characters: Record<string, unknown>[] = [
    { id: "char-a", name: "Aki", data: { name: "Aki", description: "A dry friend", personality: "dry" } },
    { id: "char-b", name: "Bea", data: { name: "Bea", description: "An earnest friend", personality: "earnest" } },
  ];
  const messages: Record<string, unknown>[] = [];
  const creates: Array<{ entity: StorageEntity; value: Record<string, unknown> }> = [];
  const agentRunPersisted = deferred<void>();
  let nextMessageId = 1;

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") return [] as T[];
      if (entity === "connections") return [connection] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === connection.id) return connection as T;
      if (entity === "characters") return (characters.find((character) => character.id === id) ?? null) as T | null;
      if (entity === "messages") return (messages.find((message) => message.id === id) ?? null) as T | null;
      return null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      creates.push({ entity, value });
      if (entity === "agent-runs") agentRunPersisted.resolve();
      return { id: `${entity}-${creates.length}`, ...value } as T;
    },
    async update<T = unknown>() { return {} as T; },
    async delete() { return { deleted: false }; },
    async listChatMessages<T = unknown>(): Promise<T[]> { return messages as T[]; },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const message = { id: `message-${nextMessageId++}`, chatId, ...value };
      messages.push(message);
      return message as T;
    },
    async updateChatMessage<T = unknown>() { return {} as T; },
    async deleteChatMessage() { return { deleted: false }; },
    async patchChatMessageExtra<T = unknown>() { return {} as T; },
    async addChatMessageSwipe<T = unknown>() { return {} as T; },
    async patchChatMetadata<T = unknown>() { return {} as T; },
    async patchChatSummaries<T = unknown>() { return {} as T; },
    async listChatMemories<T = unknown>() { return [] as T[]; },
    async getWorldState() { return null; },
    async saveTrackerSnapshot<T = unknown>() { return {} as T; },
    async listLorebookEntries() { return []; },
    async createLorebookEntries() { return []; },
    async promptFull() { return null; },
  };
  return { storage, creates, messages, agentRunPersisted };
}

async function advanceToDone(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error("Generation finished before emitting done.");
    if (next.value.type === "done") return;
  }
}

function conversationLlm(requests: LlmRequest[], criticGate: Promise<void>, onCritic: () => void): LlmGateway {
  return {
    async complete() { return ""; },
    async listModels() { return []; },
    async *stream(request) {
      requests.push(request);
      const prompt = request.messages.map((message) => message.content).join("\n");
      if (prompt.includes("You are Conversation Craft")) {
        onCritic();
        await criticGate;
        yield {
          type: "token",
          text: JSON.stringify({
            text: "untrusted advice",
            evidence: ["I hear you, and your feelings are completely valid."],
            issue: "therapy-speak",
            state: { version: 1, conversationMode: "solo", recentPatterns: [], recentStrengths: [] },
            reason: "Canned validation displaced the voice.",
            intervened: true,
          }),
        };
        yield { type: "done" };
        return;
      }
      yield { type: "token", text: "I hear you, and your feelings are completely valid." };
      yield { type: "done" };
    },
  };
}

describe("startGeneration Conversation Craft background analysis", () => {
  it.each([
    { name: "normal conversation", direct: false },
    { name: "direct messages input", direct: true },
  ])("finishes $name before starting the critic", async ({ direct }) => {
    vi.useFakeTimers();
    const { storage, creates, agentRunPersisted } = conversationStorage();
    const gate = deferred<void>();
    let criticStarted = false;
    const requests: LlmRequest[] = [];
    const generation = startGeneration(
      { storage, llm: conversationLlm(requests, gate.promise, () => { criticStarted = true; }), integrations: {} as IntegrationGateway },
      direct
        ? { chatId: "chat-1", connectionId: "conn-1", messages: [{ role: "user", content: "today sucked" }] }
        : { chatId: "chat-1", connectionId: "conn-1", userMessage: "today sucked" },
    );
    try {
      await advanceToDone(generation);
      expect(criticStarted).toBe(false);
      expect(requests).toHaveLength(1);
      const writerPrompt = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
      expect(writerPrompt.match(/<conversation_craft>/g)).toHaveLength(1);
      expect(writerPrompt).toContain("Do not paraphrase the user's message before reacting.");

      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(criticStarted).toBe(true);
      gate.resolve();
      await agentRunPersisted.promise;
      expect(creates).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity: "agent-memory" }),
        expect.objectContaining({ entity: "agent-runs" }),
      ]));
    } finally {
      gate.resolve();
      vi.useRealTimers();
    }
  });

  it("keeps first-reply guidance but schedules no critic when Agents are disabled", async () => {
    vi.useFakeTimers();
    const { storage } = conversationStorage({ enableAgents: false });
    const gate = deferred<void>();
    let criticStarted = false;
    const requests: LlmRequest[] = [];
    const generation = startGeneration(
      { storage, llm: conversationLlm(requests, gate.promise, () => { criticStarted = true; }), integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "hey" },
    );
    try {
      await advanceToDone(generation);
      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(requests).toHaveLength(1);
      expect(requests[0]?.messages.map((message) => message.content).join("\n")).toContain("<conversation_craft>");
      expect(criticStarted).toBe(false);
    } finally {
      gate.resolve();
      vi.useRealTimers();
    }
  });

  it("gives every group writer the group guide and analyzes only after the group reply finishes", async () => {
    vi.useFakeTimers();
    const { storage, agentRunPersisted } = conversationStorage({ group: true });
    const gate = deferred<void>();
    let criticStarted = false;
    const requests: LlmRequest[] = [];
    const generation = startGeneration(
      { storage, llm: conversationLlm(requests, gate.promise, () => { criticStarted = true; }), integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "what do you both think?" },
    );
    try {
      await advanceToDone(generation);
      expect(criticStarted).toBe(false);
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        const writerPrompt = request.messages.map((message) => message.content).join("\n");
        expect(writerPrompt).toContain("In a group, answer only what this character would notice");
        expect(writerPrompt.match(/<conversation_craft>/g)).toHaveLength(1);
      }

      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(criticStarted).toBe(true);
      gate.resolve();
      await agentRunPersisted.promise;
      expect(requests).toHaveLength(3);
    } finally {
      gate.resolve();
      vi.useRealTimers();
    }
  });
});
