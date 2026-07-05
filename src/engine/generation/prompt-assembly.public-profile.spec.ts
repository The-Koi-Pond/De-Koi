import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function promptStorage(
  characters: Record<string, unknown> | Record<string, unknown>[],
  promptBundle: { preset: Record<string, unknown>; sections: Record<string, unknown>[] } | null = null,
  seed: {
    chats?: Record<string, unknown>[];
    messages?: Record<string, Record<string, unknown>[]>;
    memories?: Record<string, unknown>[];
    onListChatsOptions?: (options: unknown) => void;
    onListChatMessagesOptions?: (chatId: string, options: unknown) => Promise<void> | void;
  } = {},
): StorageGateway {
  const characterRows = Array.isArray(characters) ? characters : [characters];
  return {
    async list<T = unknown>(entity: StorageEntity, options?: unknown): Promise<T[]> {
      if (entity === "chats") {
        seed.onListChatsOptions?.(options);
        return asStorageValue<T[]>(seed.chats ?? []);
      }
      if (entity === "prompts") return asStorageValue<T[]>(promptBundle ? [promptBundle.preset] : []);
      if (["personas", "regex-scripts", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      const character = characterRows.find((row) => row.id === id);
      if (entity === "characters" && character) return asStorageValue<T>(character);
      return null;
    },
    async create() {
      throw new Error("create should not be called");
    },
    async update() {
      throw new Error("update should not be called");
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(chatId: string, options?: unknown) {
      await seed.onListChatMessagesOptions?.(chatId, options);
      return asStorageValue<T[]>(seed.messages?.[chatId] ?? []);
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage() {
      throw new Error("createChatMessage should not be called");
    },
    async updateChatMessage() {
      throw new Error("updateChatMessage should not be called");
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>() {
      return asStorageValue<T>({});
    },
    async addChatMessageSwipe<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatMetadata<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatSummaries<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listChatMemories<T = unknown>() {
      return asStorageValue<T[]>(seed.memories ?? []);
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listLorebookEntries() {
      return [];
    },
    async listLorebookEntriesByLorebookIds() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull<T = unknown>() {
      if (!promptBundle) return null;
      return asStorageValue<T>({
        preset: promptBundle.preset,
        sections: promptBundle.sections,
        groups: [],
        choiceBlocks: [],
      });
    },
  };
}

describe("character public profiles in prompt assembly", () => {
  it("adds shallow public profile context without exposing creator notes", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage({
        id: "char-1",
        data: {
          name: "Mira",
          description: "Full private-ish card description with hidden story details.",
          creator_notes: "Private setup notes: reveal the twist later.",
          tags: ["bard", "friend"],
          extensions: {
            publicProfile: {
              displayName: "Mira Vale",
              handle: "@moonbard",
              bio: "A cheerful bard who remembers every song half-wrong.",
              tags: ["music", "sunny"],
            },
          },
        },
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["char-1"],
          metadata: {},
        },
        storedMessages: [{ role: "user", content: "Who is here?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Who is here?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");

    expect(promptText).toContain("<public_profile>");
    expect(promptText).toContain("Mira Vale");
    expect(promptText).toContain("@moonbard");
    expect(promptText).toContain("A cheerful bard who remembers every song half-wrong.");
    expect(promptText).not.toContain("music, sunny");
    expect(promptText).not.toContain("Private setup notes");
  });
});
describe("prompt context overlap suppression", () => {
  it("skips recalled memories already present in same-day character memories", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await assembleGenerationPrompt(
      promptStorage(
        {
          id: "mira",
          data: {
            name: "Mira",
            description: "Mira core description.",
            extensions: {
              characterMemories: [
                {
                  createdAt: `${today}T09:00:00.000Z`,
                  from: "chat",
                  summary: "Mira keeps a brass key under her glove.",
                },
              ],
            },
          },
        },
        null,
        {
          memories: [
            {
              content: "Mira keeps a brass key under her glove.",
              lastMessageAt: `${today}T08:55:00.000Z`,
            },
          ],
        },
      ),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: true },
        },
        storedMessages: [{ id: "message-1", role: "user", content: "Where is Mira's brass key?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Where is Mira's brass key?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    const memoryItems = result.contextAttributionItems.filter((item) => item.kind === "memory_recall");

    expect(promptText).toContain("Mira keeps a brass key under her glove.");
    expect(promptText).not.toContain("--- Memory 1 ---");
    expect(memoryItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "skipped",
          snippet: "Mira keeps a brass key under her glove.",
          metadata: expect.objectContaining({ reason: "context_overlap", overlapSource: "same_day_character_memory" }),
        }),
      ]),
    );
  });

  it("skips chat summary chunks already present in recent history", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage({
        id: "mira",
        data: {
          name: "Mira",
          description: "Mira core description.",
        },
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: {
            conversationSummary: "Mira already found the brass key under her glove.",
          },
        },
        storedMessages: [
          { id: "message-1", role: "assistant", content: "Mira already found the brass key under her glove." },
          { id: "message-2", role: "user", content: "What about the key?" },
        ],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "What about the key?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    const summaryItems = result.contextAttributionItems.filter((item) => item.kind === "chat_summary");

    expect(promptText.match(/Mira already found the brass key under her glove\./g)).toHaveLength(1);
    expect(summaryItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "skipped",
          snippet: "Mira already found the brass key under her glove.",
          metadata: expect.objectContaining({ reason: "context_overlap", overlapSource: "recent_history" }),
        }),
      ]),
    );
  });

  it("keeps distinct chat summary chunks beside recent history", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage({
        id: "mira",
        data: {
          name: "Mira",
          description: "Mira core description.",
        },
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: {
            conversationSummary: "Mira distrusts station clocks and keeps train schedules by hand.",
          },
        },
        storedMessages: [
          { id: "message-1", role: "assistant", content: "Mira already found the brass key under her glove." },
          { id: "message-2", role: "user", content: "What about the key and clocks?" },
        ],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "What about the key and clocks?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    const summaryItems = result.contextAttributionItems.filter((item) => item.kind === "chat_summary");

    expect(promptText).toContain("Mira distrusts station clocks and keeps train schedules by hand.");
    expect(summaryItems).toEqual(expect.arrayContaining([expect.objectContaining({ status: "injected" })]));
    expect(summaryItems).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: "skipped" })]));
  });
  it("keeps distinct recalled memories when same-day character memory only overlaps the query", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await assembleGenerationPrompt(
      promptStorage(
        {
          id: "mira",
          data: {
            name: "Mira",
            description: "Mira core description.",
            extensions: {
              characterMemories: [
                {
                  createdAt: `${today}T09:00:00.000Z`,
                  from: "chat",
                  summary: "Mira keeps a brass key under her glove.",
                },
              ],
            },
          },
        },
        null,
        {
          memories: [
            {
              content: "Mira distrusts station clocks and keeps train schedules by hand.",
              lastMessageAt: `${today}T08:55:00.000Z`,
            },
          ],
        },
      ),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: true },
        },
        storedMessages: [{ id: "message-1", role: "user", content: "What about Mira's brass key, station clocks, and train schedules by hand?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "What about Mira's brass key, station clocks, and train schedules by hand?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    const memoryItems = result.contextAttributionItems.filter((item) => item.kind === "memory_recall");

    expect(promptText).toContain("--- Memory 1 ---");
    expect(promptText).toContain("Mira distrusts station clocks and keeps train schedules by hand.");
    expect(memoryItems).toEqual(expect.arrayContaining([expect.objectContaining({ status: "injected" })]));
    expect(memoryItems).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: "skipped" })]));
  });
});
describe("cross-chat awareness prompt assembly", () => {
  it("reads sibling chat messages with bounded parallelism while keeping recency output order", async () => {
    const listChatsOptions: unknown[] = [];
    const messageOptions: Array<{ chatId: string; options: unknown }> = [];
    let activeReads = 0;
    let maxActiveReads = 0;

    const storage = promptStorage(
      {
        id: "mira",
        data: {
          name: "Mira",
          description: "Mira core description.",
        },
      },
      null,
      {
        chats: [
          {
            id: "chat-1",
            name: "Current",
            mode: "conversation",
            characterIds: ["mira"],
            updatedAt: "2026-07-03T12:00:00.000Z",
          },
          {
            id: "chat-new",
            name: "New sibling",
            mode: "conversation",
            characterIds: ["mira"],
            updatedAt: "2026-07-03T11:00:00.000Z",
          },
          {
            id: "chat-old",
            name: "Old sibling",
            mode: "conversation",
            characterIds: ["mira"],
            updatedAt: "2026-07-02T11:00:00.000Z",
          },
          {
            id: "chat-other",
            name: "Other character",
            mode: "conversation",
            characterIds: ["other"],
            updatedAt: "2026-07-04T11:00:00.000Z",
          },
        ],
        messages: {
          "chat-new": [{ role: "assistant", characterId: "mira", content: "New clue from the later sibling." }],
          "chat-old": [{ role: "assistant", characterId: "mira", content: "Old clue from the earlier sibling." }],
        },
        onListChatsOptions(options) {
          listChatsOptions.push(options);
        },
        async onListChatMessagesOptions(chatId, options) {
          messageOptions.push({ chatId, options });
          activeReads += 1;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeReads -= 1;
        },
      },
    );

    const result = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "conversation",
        characterIds: ["mira"],
        metadata: { crossChatAwareness: true },
      },
      storedMessages: [{ role: "user", content: "What did I miss?" }],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "What did I miss?",
    });

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");

    expect(maxActiveReads).toBeGreaterThan(1);
    expect(listChatsOptions[0]).toMatchObject({
      fields: [
        "id",
        "name",
        "mode",
        "chatMode",
        "characterIds",
        "metadata",
        "lastActivityAt",
        "updatedAt",
        "lastMessageAt",
        "createdAt",
      ],
    });
    expect(messageOptions).toHaveLength(2);
    expect(messageOptions.map((entry) => entry.chatId).sort()).toEqual(["chat-new", "chat-old"]);
    expect(messageOptions.every((entry) => entry.options && typeof entry.options === "object")).toBe(true);
    expect(messageOptions.map((entry) => entry.options)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          limit: 8,
          fields: ["role", "content", "characterId", "hiddenFromAi", "extra"],
        }),
      ]),
    );
    expect(promptText.indexOf("Chat: New sibling")).toBeLessThan(promptText.indexOf("Chat: Old sibling"));
    expect(promptText).toContain("New clue from the later sibling.");
    expect(promptText).toContain("Old clue from the earlier sibling.");
  });
});
describe("merged roleplay prompt compaction", () => {
  it("omits bulky greeting and example fields for merged multi-character roleplay prompts", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage(
        [
          {
            id: "harlequin",
            data: {
              name: "Harlequin",
              description: "Harlequin core description.",
              personality: "Harlequin core personality.",
              first_mes: "HARLEQUIN_GREETING_SHOULD_NOT_BE_SENT",
              mes_example: "HARLEQUIN_EXAMPLES_SHOULD_NOT_BE_SENT",
            },
          },
          {
            id: "jester",
            data: {
              name: "Jester",
              description: "Jester core description.",
              personality: "Jester core personality.",
              first_mes: "JESTER_GREETING_SHOULD_NOT_BE_SENT",
              mes_example: "JESTER_EXAMPLES_SHOULD_NOT_BE_SENT",
            },
          },
          {
            id: "pierrot",
            data: {
              name: "Pierrot",
              description: "Pierrot core description.",
              personality: "Pierrot core personality.",
              first_mes: "PIERROT_GREETING_SHOULD_NOT_BE_SENT",
              mes_example: "PIERROT_EXAMPLES_SHOULD_NOT_BE_SENT",
            },
          },
        ],
        {
          preset: { id: "default-roleplay-preset", isDefault: true },
          sections: [
            {
              id: "characters",
              enabled: true,
              sortOrder: 1,
              name: "Characters",
              role: "system",
              markerConfig: { type: "character" },
            },
            {
              id: "dialogue",
              enabled: true,
              sortOrder: 2,
              name: "Dialogue Examples",
              role: "system",
              markerConfig: { type: "dialogue_examples" },
            },
          ],
        },
      ),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["harlequin", "jester", "pierrot"],
          metadata: { groupChatMode: "merged" },
        },
        storedMessages: [{ role: "user", content: "Continue." }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Continue.",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");

    expect(promptText).toContain("Harlequin core description.");
    expect(promptText).toContain("Jester core personality.");
    expect(promptText).toContain("Pierrot core description.");
    expect(promptText).not.toContain("HARLEQUIN_GREETING_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("HARLEQUIN_EXAMPLES_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("JESTER_GREETING_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("JESTER_EXAMPLES_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("PIERROT_GREETING_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("PIERROT_EXAMPLES_SHOULD_NOT_BE_SENT");
  });

  it("guides merged multi-character roleplay prompts to use internal speaker ownership tags", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage(
        [
          { id: "harlequin", data: { name: "Harlequin", description: "Harlequin core description." } },
          { id: "jester", data: { name: "Jester", description: "Jester core description." } },
        ],
        { preset: { id: "default-roleplay-preset", isDefault: true }, sections: [] },
      ),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["harlequin", "jester"],
          metadata: { groupChatMode: "merged" },
        },
        storedMessages: [{ role: "user", content: "Continue." }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Continue.",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");

    expect(promptText).toContain('<speaker name="Harlequin">');
    expect(promptText).toContain("</speaker>");
    expect(promptText).toContain("internal speaker tags");
  });
});
describe("single-character roleplay prompt cards", () => {
  it("keeps greeting and example fields for ordinary one-character roleplay prompts", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage(
        {
          id: "mira",
          data: {
            name: "Mira",
            description: "Mira core description.",
            first_mes: "MIRA_GREETING_SHOULD_STAY",
            mes_example: "MIRA_EXAMPLES_SHOULD_STAY",
          },
        },
        {
          preset: { id: "default-roleplay-preset", isDefault: true },
          sections: [
            {
              id: "characters",
              enabled: true,
              sortOrder: 1,
              name: "Characters",
              role: "system",
              markerConfig: { type: "character" },
            },
            {
              id: "dialogue",
              enabled: true,
              sortOrder: 2,
              name: "Dialogue Examples",
              role: "system",
              markerConfig: { type: "dialogue_examples" },
            },
          ],
        },
      ),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["mira"],
          metadata: {},
        },
        storedMessages: [{ role: "user", content: "Continue." }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Continue.",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");

    expect(promptText).toContain("Mira core description.");
    expect(promptText).toContain("MIRA_GREETING_SHOULD_STAY");
    expect(promptText).toContain("MIRA_EXAMPLES_SHOULD_STAY");
    expect(promptText).not.toContain("internal speaker tags");
    expect(promptText).not.toContain("<speaker");
  });
});
