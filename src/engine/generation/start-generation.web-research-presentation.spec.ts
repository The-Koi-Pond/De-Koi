import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  extra: Record<string, unknown>;
};

function webResearchStorage(presentation: "quiet" | "visible", policy: "ask" | "always") {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "roleplay",
      connectionId: "conn-1",
      characterIds: ["char-1"],
      metadata: {
        characterWebAccessEnabled: true,
        characterWebResearchPolicy: policy,
        characterWebResearchPresentation: presentation,
      },
    },
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model" },
    "char-1": { id: "char-1", name: "Harlequin", data: { name: "Harlequin", personality: "dry" } },
  };
  const messages: StoredMessage[] = [];
  let nextMessageId = 1;

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "connections") return [records["conn-1"]] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === "chat-1") return records["chat-1"] as T;
      if (entity === "connections" && id === "conn-1") return records["conn-1"] as T;
      if (entity === "characters" && id === "char-1") return records["char-1"] as T;
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
      message.extra = { ...message.extra, ...patch };
      return message as T;
    },
    async patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = {
        ...records[chatId],
        metadata: { ...(records[chatId]?.metadata as object), ...patch },
      };
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

function scriptedWebResearchLlm(): LlmGateway {
  const turns = [
    {
      text: "I should check that. ",
      thinking: "I need current information.",
      toolCall: {
        id: "request-1",
        name: "request_character_web_research",
        arguments: JSON.stringify({
          query: "current lunar eclipse date",
          reason: "The date may have changed.",
          allowedDomains: ["nasa.gov"],
        }),
      },
    },
    {
      text: "Let me pull the sources. ",
      thinking: "I should use the approved exact query.",
      toolCall: {
        id: "search-1",
        name: "search_character_web",
        arguments: JSON.stringify({ maxResults: 4 }),
      },
    },
    { text: "Final sourced answer." },
  ];
  return {
    complete: vi.fn(async () => ""),
    async *stream() {
      const turn = turns.shift();
      if (!turn) throw new Error("Unexpected extra model turn");
      if (turn.text) yield { type: "token", text: turn.text };
      if (turn.thinking) yield { type: "thinking", text: turn.thinking };
      if (turn.toolCall) {
        yield {
          type: "tool_call",
          data: {
            id: turn.toolCall.id,
            name: turn.toolCall.name,
            arguments: turn.toolCall.arguments,
            function: { name: turn.toolCall.name, arguments: turn.toolCall.arguments },
          },
        };
      }
    },
    listModels: vi.fn(async () => []),
  };
}

async function runWebResearchPresentation(
  presentation: "quiet" | "visible",
  policy: "ask" | "always" = "always",
) {
  const { storage, messages } = webResearchStorage(presentation, policy);
  const events: GenerationEvent[] = [];
  const integrations = {
    webResearch: {
      async search() {
        return {
          results: [
            {
              title: "NASA eclipse guide",
              url: "https://science.nasa.gov/eclipses/",
              snippet: "Current eclipse details.",
            },
          ],
        };
      },
      async readPage() {
        return { text: "NASA page text" };
      },
    },
  } as unknown as IntegrationGateway;

  for await (const event of startGeneration(
    { storage, llm: scriptedWebResearchLlm(), integrations },
    {
      chatId: "chat-1",
      connectionId: "conn-1",
      userMessage: "When is the next lunar eclipse?",
      impersonateBlockAgents: true,
    },
  )) {
    events.push(event);
  }

  return { events, messages };
}

describe("startGeneration character web research presentation", () => {
  it("persists a quiet consent card without canned spoken boilerplate", async () => {
    const { events, messages } = await runWebResearchPresentation("quiet", "ask");
    const tokenText = events
      .filter((event) => event.type === "token")
      .map((event) => String(event.data))
      .join("");
    const assistant = messages.find((message) => message.role === "assistant");

    expect(tokenText).toBe("");
    expect(assistant?.content).toBe("");
    expect(assistant?.extra.characterWebResearchRequest).toEqual({
      query: "current lunar eclipse date",
      reason: "The date may have changed.",
      allowedDomains: ["nasa.gov"],
      status: "pending",
    });
  });

  it("hides intermediate web narration and reasoning in quiet mode", async () => {
    const { events, messages } = await runWebResearchPresentation("quiet");
    const tokenText = events
      .filter((event) => event.type === "token")
      .map((event) => String(event.data))
      .join("");

    expect(tokenText).toBe("Final sourced answer.");
    expect(events.filter((event) => event.type === "thinking")).toEqual([]);
    expect(events.filter((event) => event.type === "tool_call" || event.type === "tool_result")).toEqual([]);
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("Final sourced answer.");
    expect(assistant?.extra.characterWebResearchSources).toEqual([
      { title: "NASA eclipse guide", url: "https://science.nasa.gov/eclipses/" },
    ]);
  });

  it("retains intermediate web narration and reasoning in visible mode", async () => {
    const { events, messages } = await runWebResearchPresentation("visible");
    const tokenText = events
      .filter((event) => event.type === "token")
      .map((event) => String(event.data))
      .join("");

    expect(tokenText).toBe("I should check that. Let me pull the sources. Final sourced answer.");
    expect(events.filter((event) => event.type === "thinking")).toHaveLength(2);
    expect(events.filter((event) => event.type === "tool_call" || event.type === "tool_result")).toHaveLength(2);
    expect(messages.find((message) => message.role === "assistant")?.content).toBe(tokenText);
  });
});
