import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId?: string | null;
  extra?: Record<string, unknown>;
};

function groupTypingStorage(
  metadata: Record<string, unknown> = { groupResponseOrder: "sequential" },
  chatOverrides: Record<string, unknown> = {},
) {
  const chat = {
    id: "chat-1",
    mode: "conversation",
    connectionId: "conn-1",
    characterIds: ["char-a", "char-b"],
    metadata,
    ...chatOverrides,
  };
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": chat,
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model" },
    "char-a": { id: "char-a", name: "Aki", data: { name: "Aki", personality: "warm" } },
    "char-b": { id: "char-b", name: "Bea", data: { name: "Bea", personality: "dry" } },
    "char-c": { id: "char-c", name: "Cleo", data: { name: "Cleo", personality: "bright" } },
  };
  const messages: StoredMessage[] = [];
  let nextMessageId = 1;

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "connections") return [records["conn-1"]] as T[];
      if (entity === "personas") return [] as T[];
      if (entity === "prompts") return [] as T[];
      if (entity === "regex-scripts") return [] as T[];
      if (entity === "agents") return [] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === "chat-1") return records["chat-1"] as T;
      if (entity === "connections" && id === "conn-1") return records["conn-1"] as T;
      if (entity === "characters" && (id === "char-a" || id === "char-b" || id === "char-c")) {
        return records[id] as T;
      }
      return null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return { id: "created", ...value } as T;
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      records[id] = { ...(records[id] ?? { id, entity }), ...patch };
      return records[id] as T;
    },
    async delete(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return messages.filter((message) => message.chatId === chatId) as T[];
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const message = {
        id: `message-${nextMessageId++}`,
        chatId,
        role: String(value.role ?? ""),
        content: String(value.content ?? ""),
        characterId: typeof value.characterId === "string" ? value.characterId : null,
        extra: (value.extra as Record<string, unknown> | undefined) ?? {},
      };
      messages.push(message);
      return message as T;
    },
    async updateChatMessage<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      Object.assign(message, patch);
      return message as T;
    },
    async deleteChatMessage(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      message.extra = { ...(message.extra ?? {}), ...patch };
      return message as T;
    },
    async patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], metadata: { ...(records[chatId]?.metadata as object), ...patch } };
      return records[chatId] as T;
    },
    async patchChatSummaries<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], ...patch };
      return records[chatId] as T;
    },
    async listChatMemories<T = unknown>(): Promise<T[]> {
      return [] as T[];
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

  return { storage, messages };
}

function groupTypingLlm(selectorResponse = ""): LlmGateway {
  return {
    complete: vi.fn(async () => selectorResponse),
    async *stream() {
      yield { type: "token", text: "hey there" };
    },
    listModels: vi.fn(async () => []),
  };
}

async function collectEvents(generator: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe("startGeneration group typing", () => {
  it("lets sequential conversation group responders send separate messages", async () => {
    const { storage, messages } = groupTypingStorage();

    const events = await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm(),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "hello group",
          impersonateBlockAgents: true,
        },
      ),
    );

    const groupTurns = events.filter((event) => event.type === "group_turn");
    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(groupTurns.map((event) => event.data)).toEqual([
      { characterId: "char-a", characterName: "Aki", index: 0, total: 2 },
      { characterId: "char-b", characterName: "Bea", index: 1, total: 2 },
    ]);
    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-a", "char-b"]);
  });

  it("gives later responders same-send peer context without inviting repeated replies", async () => {
    const { storage } = groupTypingStorage();
    const requests: LlmRequest[] = [];
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream(request) {
        requests.push(request);
        yield { type: "token", text: requests.length === 1 ? "Aki got here first." : "Bea adds something new." };
      },
      listModels: vi.fn(async () => []),
    };

    await collectEvents(
      startGeneration(
        {
          storage,
          llm,
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Aki and Bea, what do you both think?",
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(requests).toHaveLength(2);
    const secondPrompt = requests[1]!.messages.map((message) => message.content).join("\n");
    expect(secondPrompt).toContain("same-send peer contribution");
    expect(secondPrompt).toContain("Aki: Aki got here first.");
    expect(secondPrompt).toContain("Respond only as Bea");
    expect(secondPrompt).toContain("Do not repeat");
    expect(secondPrompt).not.toContain("Prefix each character's line");
  });

  it("keeps same-send peer guidance when the ordinary group turn prompt is disabled", async () => {
    const { storage } = groupTypingStorage({
      groupResponseOrder: "sequential",
      groupTurnPromptEnabled: false,
    });
    const requests: LlmRequest[] = [];
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream(request) {
        requests.push(request);
        yield { type: "token", text: requests.length === 1 ? "Aki already answered." : "Bea answers next." };
      },
      listModels: vi.fn(async () => []),
    };

    await collectEvents(
      startGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Aki and Bea, answer together.",
          impersonateBlockAgents: true,
        },
      ),
    );

    const secondPrompt = requests[1]!.messages.map((message) => message.content).join("\n");
    expect(secondPrompt).toContain("same-send peer contribution");
    expect(secondPrompt).toContain("Aki: Aki already answered.");
    expect(secondPrompt).toContain("Do not repeat");
  });

  it("preserves every prior responder identity when same-send context is bounded", async () => {
    const { storage } = groupTypingStorage(
      { groupResponseOrder: "sequential" },
      { characterIds: ["char-a", "char-b", "char-c"] },
    );
    const requests: LlmRequest[] = [];
    const responses = [`Aki starts ${"x".repeat(4_100)}`, "Bea gives the recent peer reply.", "Cleo responds."];
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream(request) {
        requests.push(request);
        yield { type: "token", text: responses[requests.length - 1] };
      },
      listModels: vi.fn(async () => []),
    };

    await collectEvents(
      startGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Aki, Bea, and Cleo: thoughts?",
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(requests).toHaveLength(3);
    const thirdPrompt = requests[2]!.messages.map((message) => message.content).join("\n");
    expect(thirdPrompt).toContain("Aki:");
    expect(thirdPrompt).toContain("Bea: Bea gives the recent peer reply.");
    expect(thirdPrompt).toContain("Respond only as Cleo");
  });

  it("lets smart conversation group selection choose multiple responders", async () => {
    const { storage, messages } = groupTypingStorage({ groupResponseOrder: "smart" });

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm('{"characterIds":["char-b","char-a"],"reason":"both would answer"}'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "what do you both think?",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-b", "char-a"]);
  });

  it("stops a later smart responder when an earlier mentioned character answered fully", async () => {
    const { storage, messages } = groupTypingStorage({ groupResponseOrder: "smart" });
    const continuationRequests: LlmRequest[] = [];
    const llm: LlmGateway = {
      complete: vi.fn(async (request) => {
        continuationRequests.push(request);
        return '{"shouldRespond":false,"reason":"Aki already answered fully"}';
      }),
      async *stream() {
        yield { type: "token", text: "Aki covered the whole answer." };
      },
      listModels: vi.fn(async () => []),
    };

    await collectEvents(
      startGeneration(
        {
          storage,
          llm,
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Aki and Bea, what do you both think?",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");
    const continuationRequest = continuationRequests.find((request) =>
      request.messages.some((message) => message.content.includes("hidden continuation orchestrator")),
    );

    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-a"]);
    expect(continuationRequest).toBeDefined();
    expect(continuationRequest!.messages.map((message) => message.content).join("\n")).toContain(
      "Aki covered the whole answer.",
    );
  });

  it("keeps a later smart responder when the continuation decision is malformed", async () => {
    const { storage, messages } = groupTypingStorage({ groupResponseOrder: "smart" });

    await collectEvents(
      startGeneration(
        { storage, llm: groupTypingLlm("not json"), integrations: {} as IntegrationGateway },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Aki and Bea, what do you both think?",
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(messages.filter((message) => message.role === "assistant").map((message) => message.characterId)).toEqual([
      "char-a",
      "char-b",
    ]);
  });

  it("keeps a later smart responder when the continuation decision errors", async () => {
    const { storage, messages } = groupTypingStorage({ groupResponseOrder: "smart" });
    const llm = groupTypingLlm();
    llm.complete = vi.fn(async () => {
      throw new Error("selector unavailable");
    });

    await collectEvents(
      startGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Aki and Bea, what do you both think?",
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(messages.filter((message) => message.role === "assistant").map((message) => message.characterId)).toEqual([
      "char-a",
      "char-b",
    ]);
  });

  it("defaults conversation group response order to smart selection", async () => {
    const { storage, messages } = groupTypingStorage({});

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm('{"characterIds":["char-b"],"reason":"Bea is directly relevant"}'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "what do you think?",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-b"]);
  });

  it("falls back to conversation group turn order when smart selection chooses nobody", async () => {
    const { storage, messages } = groupTypingStorage({ groupResponseOrder: "smart" });

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm('{"characterIds":[],"reason":"No one needs to answer yet"}'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Hi",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-a", "char-b"]);
  });

  it("queues automatic memory refresh after saving a conversation assistant message", async () => {
    const { storage } = groupTypingStorage({}, { characterIds: ["char-a"] });
    const jobs = new Map<string, Record<string, unknown>>();
    const refreshChatMemories = vi.fn(async () => ({ rebuilt: 1 }));
    const originalList = storage.list.bind(storage);
    const originalGet = storage.get.bind(storage);
    const originalCreate = storage.create.bind(storage);
    const originalUpdate = storage.update.bind(storage);
    Object.assign(storage, {
      async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
        if (entity === "memory-capture-jobs") return Array.from(jobs.values()) as T[];
        return originalList<T>(entity);
      },
      async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
        if (entity === "memory-capture-jobs") return (jobs.get(id) ?? null) as T | null;
        return originalGet<T>(entity, id);
      },
      async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
        if (entity === "memory-capture-jobs") {
          const row = { id: String(value.id), ...value };
          jobs.set(String(row.id), row);
          return row as T;
        }
        return originalCreate<T>(entity, value);
      },
      async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
        if (entity === "memory-capture-jobs") {
          const row = { ...(jobs.get(id) ?? { id }), ...patch };
          jobs.set(id, row);
          return row as T;
        }
        return originalUpdate<T>(entity, id, patch);
      },
      refreshChatMemories,
    });

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm(JSON.stringify({ characterIds: ["char-a"], reason: "test" })),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "hello",
          impersonateBlockAgents: true,
        },
      ),
    );
    for (
      let index = 0;
      index < 20 && !Array.from(jobs.values()).some((job) => job.status === "completed");
      index += 1
    ) {
      await Promise.resolve();
    }

    expect(refreshChatMemories).toHaveBeenCalledWith("chat-1", { sourceMessageIds: ["message-1", "message-2"] });
    expect(Array.from(jobs.values())).toEqual([
      expect.objectContaining({
        status: "completed",
        sourceMessageIds: ["message-1", "message-2"],
        userMessageId: "message-1",
        assistantMessageId: "message-2",
      }),
    ]);
  });
  it("emits debug timing diagnostics for merged roleplay group generation", async () => {
    const { storage, messages } = groupTypingStorage(
      { groupChatMode: "merged" },
      { mode: "roleplay", chatMode: "roleplay" },
    );

    const events = await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm(),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "set the scene",
          impersonateBlockAgents: true,
          debugMode: true,
        },
      ),
    );

    const diagnostics = events.filter((event) => event.type === "diagnostic");
    const timingNames = diagnostics.map((event) => event.data.name);
    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(timingNames).toEqual(
      expect.arrayContaining(["save-user-message", "prepare-context", "assemble-prompt", "model-call"]),
    );
    expect(diagnostics.every((event) => typeof event.data.durationMs === "number")).toBe(true);
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.characterId).toBeNull();
  });
});
