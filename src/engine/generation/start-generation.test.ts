import { describe, expect, it } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { startGeneration, type GenerationEngineDeps } from "./start-generation";
import type { JsonRecord } from "./runtime-records";

function createStorage(args: {
  chats?: JsonRecord[];
  characters?: JsonRecord[];
  connections?: JsonRecord[];
  personas?: JsonRecord[];
  prompts?: JsonRecord[];
  promptSections?: JsonRecord[];
  agents?: JsonRecord[];
  messages?: Record<string, JsonRecord[]>;
}): StorageGateway {
  const chats = args.chats ?? [];
  const characters = args.characters ?? [];
  const connections = args.connections ?? [];
  const personas = args.personas ?? [];
  const prompts = args.prompts ?? [];
  const promptSections = args.promptSections ?? [];
  const agents = args.agents ?? [];
  const messages = args.messages ?? {};
  let nextMessageId = 1;

  const byEntity: Record<string, JsonRecord[]> = {
    agents,
    chats,
    characters,
    connections,
    "custom-tools": [],
    "game-state-snapshots": [],
    lorebooks: [],
    personas,
    prompts,
    "prompt-groups": [],
    "prompt-sections": promptSections,
    "prompt-variables": [],
    "regex-scripts": [],
  };

  return {
    async list<T = unknown>(entity: string): Promise<T[]> {
      return ((byEntity[entity] ?? []) as T[]).slice();
    },
    async get<T = unknown>(entity: string, id: string): Promise<T | null> {
      return ((byEntity[entity] ?? []).find((row) => row.id === id) as T | undefined) ?? null;
    },
    async create<T = unknown>(_entity: string, value: Record<string, unknown>): Promise<T> {
      return value as T;
    },
    async update<T = unknown>(entity: string, id: string, patch: Record<string, unknown>): Promise<T> {
      const existing = byEntity[entity]?.find((row) => row.id === id);
      if (existing) Object.assign(existing, patch);
      return patch as T;
    },
    async delete() {
      return { deleted: true };
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return ((messages[chatId] ?? []) as T[]).slice();
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const saved = {
        id: `message-${nextMessageId++}`,
        chatId,
        createdAt: "2026-06-02T00:00:00.000Z",
        ...value,
      };
      messages[chatId] = [...(messages[chatId] ?? []), saved];
      return saved as T;
    },
    async updateChatMessage<T = unknown>(_messageId: string, patch: Record<string, unknown>): Promise<T> {
      return patch as T;
    },
    async deleteChatMessage() {
      return { deleted: true };
    },
    async patchChatMessageExtra<T = unknown>(_messageId: string, patch: Record<string, unknown>): Promise<T> {
      return patch as T;
    },
    async addChatMessageSwipe<T = unknown>(_chatId: string, _messageId: string, content: string): Promise<T> {
      return { content } as T;
    },
    async patchChatMetadata<T = unknown>(_chatId: string, patch: Record<string, unknown>): Promise<T> {
      return patch as T;
    },
    async patchChatSummaries<T = unknown>(_chatId: string, patch: Record<string, unknown>): Promise<T> {
      return patch as T;
    },
    async listChatMemories<T = unknown>(): Promise<T[]> {
      return [];
    },
    async getWorldState<T = unknown>(): Promise<T | null> {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>(_chatId: string, snapshot: Record<string, unknown>): Promise<T> {
      return snapshot as T;
    },
    async listLorebookEntries<T = unknown>(): Promise<T[]> {
      return [];
    },
    async createLorebookEntries<T = unknown>(_lorebookId: string, entries: Array<Record<string, unknown>>): Promise<T[]> {
      return entries as T[];
    },
    async promptFull<T = unknown>(): Promise<T | null> {
      return null;
    },
  };
}

function createIntegrations(): IntegrationGateway {
  const empty = async <T = unknown>(): Promise<T> => ({}) as T;
  return {
    spotify: {
      player: empty,
      playlists: empty,
      playlistTracks: empty,
      searchTracks: empty,
      playTrack: empty,
      play: empty,
      volume: empty,
    },
    haptic: {
      status: empty,
      connect: empty,
      command: empty,
      stopAll: empty,
    },
    customTools: {
      execute: empty,
    },
    image: {
      generate: empty,
    },
  };
}

function createLlm(capturedRequests: LlmRequest[]): LlmGateway {
  return {
    complete: async () => "",
    async *stream(request: LlmRequest) {
      capturedRequests.push(request);
      const requestText = request.messages.map((message) => message.content).join("\n\n");
      if (requestText.includes("specialized agent")) {
        yield {
          type: "token",
          text: '{"date":null,"time":"Night","location":"Theater","weather":"Windy","temperature":"Cold"}',
        };
        return;
      }
      yield { type: "token", text: "Bob answers." };
    },
    listModels: async () => [],
  };
}

describe("startGeneration roleplay individual group turns", () => {
  it("sends only the responding character card in manual individual mode", async () => {
    const chat = {
      id: "chat-1",
      mode: "roleplay",
      characterIds: ["alice", "bob"],
      connectionId: "connection-1",
      promptPresetId: "roleplay-preset",
      metadata: {
        groupChatMode: "individual",
        groupResponseOrder: "manual",
        activeAgentIds: ["world-state"],
      },
    };
    const storage = createStorage({
      chats: [chat],
      characters: [
        { id: "alice", data: { name: "Alice", description: "A careful friend." } },
        { id: "bob", data: { name: "Bob", description: "A curious friend." } },
      ],
      connections: [{ id: "connection-1", model: "test-model", provider: "test" }],
      agents: [
        {
          id: "world-state",
          type: "world-state",
          name: "World State",
          enabled: true,
          phase: "post_processing",
          connectionId: null,
          settings: {},
        },
      ],
      personas: [{ id: "persona-1", isActive: true, data: { name: "Mari", description: "The user." } }],
      prompts: [{ id: "roleplay-preset", wrapFormat: "none" }],
      promptSections: [
        {
          id: "characters",
          presetId: "roleplay-preset",
          enabled: true,
          sortOrder: 0,
          role: "system",
          name: "Characters",
          markerConfig: { type: "character" },
        },
        {
          id: "history",
          presetId: "roleplay-preset",
          enabled: true,
          sortOrder: 1,
          role: "user",
          name: "Chat History",
          markerConfig: { type: "chat_history" },
        },
      ],
      messages: {
        "chat-1": [{ id: "user-1", chatId: "chat-1", role: "user", content: "Bob, what do you notice?" }],
      },
    });
    const capturedRequests: LlmRequest[] = [];
    const deps: GenerationEngineDeps = {
      storage,
      llm: createLlm(capturedRequests),
      integrations: createIntegrations(),
    };

    for await (const _event of startGeneration(deps, { chatId: "chat-1", forCharacterId: "bob" })) {
      // Drain the generator.
    }

    const promptText = capturedRequests
      .flatMap((request) => request.messages)
      .map((message) => message.content)
      .join("\n\n");
    expect(promptText).toContain("Name: Bob");
    expect(promptText).toContain("Description: A curious friend.");
    expect(promptText).not.toContain("Name: Alice");
    expect(promptText).not.toContain('<character id="alice"');
    expect(promptText).not.toContain("A careful friend.");
    expect(capturedRequests).toHaveLength(2);
    expect(promptText).toContain("Respond only as Bob");
  });
});
