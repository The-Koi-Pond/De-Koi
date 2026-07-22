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
  activeSwipeIndex: number;
  swipeCount: number;
  extra: Record<string, unknown>;
  swipes: Array<{ content: string; characterId?: string | null; extra?: Record<string, unknown> }>;
};

function roleplayAttributionStorage(
  connectionOverrides: Record<string, unknown> = {},
  chatOverrides: Record<string, unknown> = {},
) {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "roleplay",
      connectionId: "conn-1",
      characterIds: ["char-a"],
      metadata: {},
      ...chatOverrides,
    },
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model", ...connectionOverrides },
    "char-a": {
      id: "char-a",
      name: "Aki",
      data: { name: "Aki", personality: "warm" },
      publicProfile: { displayName: "Aki", handle: "@aki" },
    },
  };
  const messages: StoredMessage[] = [];
  const calls: string[] = [];
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
      if (entity === "characters" && id === "char-a") return records["char-a"] as T;
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
      calls.push(`getChatMessage:${messageId}`);
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      calls.push("createChatMessage");
      const content = String(value.content ?? "");
      const extra = (value.extra as Record<string, unknown> | undefined) ?? {};
      const message: StoredMessage = {
        id: `message-${nextMessageId++}`,
        chatId,
        role: String(value.role ?? ""),
        content,
        characterId: typeof value.characterId === "string" ? value.characterId : null,
        activeSwipeIndex: 0,
        swipeCount: 1,
        extra: { ...extra },
        swipes: [
          {
            content,
            characterId: typeof value.characterId === "string" ? value.characterId : null,
            extra: { ...extra },
          },
        ],
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
      calls.push(`patchChatMessageExtra:${messageId}`);
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      message.extra = { ...message.extra, ...patch };
      const activeSwipe = message.swipes[message.activeSwipeIndex];
      if (activeSwipe) activeSwipe.extra = { ...(activeSwipe.extra ?? {}), ...patch };
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
      throw new Error("addChatMessageSwipe should not be used for a first assistant message");
    },
    async promptFull<T = unknown>(): Promise<T | null> {
      return null;
    },
  };

  return { storage, messages, calls };
}

function roleplayLlm(response: string | string[], completeResponse = ""): LlmGateway & { requests: LlmRequest[] } {
  const responses = Array.isArray(response) ? response : [response];
  const requests: LlmRequest[] = [];
  let responseIndex = 0;
  return {
    requests,
    complete: vi.fn(async () => completeResponse),
    async *stream(request) {
      requests.push(request);
      yield { type: "token", text: responses[responseIndex++] ?? "" };
    },
    listModels: vi.fn(async () => []),
  };
}

async function collectEvents(generator: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe("startGeneration roleplay text persistence", () => {
  it("saves model prose verbatim without speaker attribution metadata", async () => {
    const { storage, messages, calls } = roleplayAttributionStorage();

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: roleplayLlm('<speaker name="Aki">"Hi."</speaker>'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "say hello",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistant = messages.find((item) => item.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.content).toBe('<speaker name="Aki">"Hi."</speaker>');
    expect(calls).not.toContain(`patchChatMessageExtra:${assistant!.id}`);
    expect(assistant!.extra).not.toHaveProperty("dialogueAttributions");
    expect(assistant!.swipes[0]?.extra).not.toHaveProperty("dialogueAttributions");
  });

  it("preserves generated assistant blank lines when saving roleplay content", async () => {
    const { storage, messages } = roleplayAttributionStorage();
    const content = "First paragraph.\n\n\nSecond paragraph.";

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: roleplayLlm(content),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "continue",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistant = messages.find((item) => item.role === "assistant");
    expect(assistant?.content).toBe(content);
    expect(assistant?.swipes[0]?.content).toBe(content);
  });

  it("reconciles a strict-agency repair before saving and records source-backed swipe metadata", async () => {
    const { storage, messages } = roleplayAttributionStorage(
      {},
      {
        promptVariables: {
          agencyStrictness: "strict agency: never write the user's dialogue or deliberate actions.",
        },
      },
    );
    const original = 'Mira opens the ledger. You accept the bargain. "Good," she says. This tail is unfinished';
    const corrected = 'Mira opens the ledger. "The bargain is yours to accept," she says.';
    const llm = roleplayLlm([
      original,
      JSON.stringify({
        editedText: corrected,
        changes: [
          {
            reason: "agency",
            description: "Removed a decision assigned to the user.",
            evidence: "You accept the bargain.",
          },
        ],
      }),
    ]);

    const events = await collectEvents(
      startGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "I study the bargain.",
          trimIncompleteModelOutput: true,
        },
      ),
    );

    const assistant = messages.find((item) => item.role === "assistant");
    expect(llm.requests).toHaveLength(2);
    expect(assistant?.content).toBe(corrected);
    expect(assistant?.swipes[0]?.content).toBe(corrected);
    expect(assistant?.extra.roleplayQualityCorrection).toEqual({
      source: "focused_editor_audit",
      reasons: ["agency"],
      evidence: ["You accept the bargain."],
      durationMs: expect.any(Number),
    });
    expect(assistant?.swipes[0]?.extra?.roleplayQualityCorrection).toEqual(
      assistant?.extra.roleplayQualityCorrection,
    );
    expect(events.filter((event) => event.type === "content_replace")).toEqual([
      { type: "content_replace", data: corrected },
    ]);
  });

  it("applies the same strict-agency repair to the direct-messages generation branch", async () => {
    const { storage, messages } = roleplayAttributionStorage(
      {},
      {
        promptVariables: { agencyStrictness: "strict agency: preserve user choices." },
      },
    );
    const original = "You sign the contract.";
    const corrected = "Mira leaves the contract open for your signature.";
    const llm = roleplayLlm([
      original,
      JSON.stringify({
        editedText: corrected,
        changes: [
          {
            reason: "agency",
            description: "Removed a deliberate action assigned to the user.",
            evidence: original,
          },
        ],
      }),
    ]);

    await collectEvents(
      startGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          messages: [{ role: "user", content: "I inspect the signature line." }],
        },
      ),
    );

    expect(llm.requests).toHaveLength(2);
    expect(messages.find((item) => item.role === "assistant")?.content).toBe(corrected);
  });

  it.each([
    ["a clean strict-agency turn", 'Mira opens the ledger. "The choice is yours."', "strict agency: preserve user choices."],
    ["an organic-agency candidate", "You accept the bargain.", "organic agency: infer minor actions when useful."],
  ])("adds no audit call for %s", async (_label, response, agencyStrictness) => {
    const { storage, messages } = roleplayAttributionStorage({}, { promptVariables: { agencyStrictness } });
    const llm = roleplayLlm(response);

    await collectEvents(
      startGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", userMessage: "Continue." },
      ),
    );

    expect(llm.requests).toHaveLength(1);
    expect(messages.find((item) => item.role === "assistant")?.content).toBe(response);
  });

  it("preserves the original when the focused audit is malformed", async () => {
    const { storage, messages } = roleplayAttributionStorage(
      {},
      {
        promptVariables: { agencyStrictness: "strict agency: preserve user choices." },
      },
    );
    const original = "You accept the bargain.";
    const llm = roleplayLlm([original, "not valid editor JSON"]);

    await collectEvents(
      startGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", userMessage: "I consider it." },
      ),
    );

    const assistant = messages.find((item) => item.role === "assistant");
    expect(llm.requests.length).toBeGreaterThanOrEqual(2);
    expect(assistant?.content).toBe(original);
    expect(assistant?.extra.roleplayQualityCorrection).toBeNull();
  });

  it("preserves the original when the focused audit times out", async () => {
    vi.useFakeTimers();
    try {
      const { storage, messages } = roleplayAttributionStorage(
        {},
        {
          promptVariables: { agencyStrictness: "strict agency: preserve user choices." },
        },
      );
      const original = "You accept the bargain.";
      const requests: LlmRequest[] = [];
      const llm: LlmGateway = {
        complete: vi.fn(async () => ""),
        listModels: vi.fn(async () => []),
        async *stream(request, signal) {
          requests.push(request);
          if (requests.length === 1) {
            yield { type: "token", text: original };
            return;
          }
          await new Promise<void>((_resolve, reject) => {
            const abort = () => reject(new DOMException("Timed out.", "AbortError"));
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          });
        },
      };

      const generation = collectEvents(
        startGeneration(
          { storage, llm, integrations: {} as IntegrationGateway },
          { chatId: "chat-1", connectionId: "conn-1", userMessage: "I consider it." },
        ),
      );
      for (let index = 0; index < 20 && requests.length < 2; index += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(requests).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(8_000);
      await generation;

      const assistant = messages.find((item) => item.role === "assistant");
      expect(assistant?.content).toBe(original);
      expect(assistant?.extra.roleplayQualityCorrection).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("honors the per-chat automatic correction off switch", async () => {
    const { storage, messages } = roleplayAttributionStorage(
      {},
      {
        metadata: { automaticRoleplayQualityCorrection: false },
        promptVariables: { agencyStrictness: "strict agency: preserve user choices." },
      },
    );
    const original = "You accept the bargain.";
    const llm = roleplayLlm(original);

    await collectEvents(
      startGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", userMessage: "I consider it." },
      ),
    );

    expect(llm.requests).toHaveLength(1);
    expect(messages.find((item) => item.role === "assistant")?.content).toBe(original);
  });

  it("persists partial assistant text when the provider stream ends incompletely", async () => {
    const { storage, messages } = roleplayAttributionStorage();
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      listModels: vi.fn(async () => []),
      async *stream() {
        yield { type: "token", text: "The reply began, but" };
        throw Object.assign(new Error("LLM provider stream ended before a terminal event."), {
          code: "llm_stream_incomplete",
        });
      },
    };

    await expect(
      collectEvents(
        startGeneration(
          { storage, llm, integrations: {} as IntegrationGateway },
          {
            chatId: "chat-1",
            connectionId: "conn-1",
            userMessage: "Continue.",
            impersonateBlockAgents: true,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "llm_stream_incomplete" });

    const assistant = messages.find((item) => item.role === "assistant");
    expect(assistant?.content).toBe("The reply began, but");
    expect(assistant?.extra.generationInterrupted).toEqual({
      reason: "incomplete_stream",
      message: "Generation interrupted",
    });
  });

  it("does not create a blank assistant message when an incomplete stream has no text", async () => {
    const { storage, messages } = roleplayAttributionStorage();
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      listModels: vi.fn(async () => []),
      async *stream() {
        yield* [];
        throw Object.assign(new Error("LLM provider stream ended before a terminal event."), {
          code: "llm_stream_incomplete",
        });
      },
    };

    await expect(
      collectEvents(
        startGeneration(
          { storage, llm, integrations: {} as IntegrationGateway },
          {
            chatId: "chat-1",
            connectionId: "conn-1",
            userMessage: "Continue.",
            impersonateBlockAgents: true,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "llm_stream_incomplete" });

    expect(messages.filter((item) => item.role === "assistant")).toEqual([]);
  });

  it("persists a provider length-limited reply as interrupted instead of successful", async () => {
    const { storage, messages } = roleplayAttributionStorage();
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      listModels: vi.fn(async () => []),
      async *stream() {
        yield { type: "token", text: "The provider reached its" };
        yield {
          type: "provider_metadata",
          data: { finishReason: "length" },
          finishReason: "length",
        };
      },
    };

    await expect(
      collectEvents(
        startGeneration(
          { storage, llm, integrations: {} as IntegrationGateway },
          {
            chatId: "chat-1",
            connectionId: "conn-1",
            userMessage: "Continue.",
            impersonateBlockAgents: true,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "llm_stream_length" });

    const assistant = messages.find((item) => item.role === "assistant");
    expect(assistant?.content).toBe("The provider reached its");
    expect(assistant?.extra.generationInterrupted).toEqual({
      reason: "length",
      message: "Generation interrupted",
    });
  });
});
