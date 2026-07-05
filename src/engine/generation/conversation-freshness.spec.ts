import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function conversationStorage(character: Record<string, unknown>): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "prompts") return [];
      if (["personas", "regex-scripts", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && character.id === id) return asStorageValue<T>(character);
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
    async listChatMessages() {
      return [];
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
    async listChatMemories() {
      return [];
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
    async promptFull() {
      return null;
    },
  };
}

const mira = {
  id: "mira",
  data: {
    name: "Mira",
    description: "Mira is a casual friend who texts plainly.",
  },
};

function promptText(messages: Array<{ content?: unknown }>): string {
  return messages.map((message) => String(message.content ?? "")).join("\n");
}

describe("conversation freshness guidance", () => {
  it("is absent when conversation history has no repeated assistant pattern", async () => {
    const result = await assembleGenerationPrompt(conversationStorage(mira), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: [{ id: "user-1", role: "user", content: "hey" }],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "hey",
    });

    expect(promptText(result.messages)).not.toContain("conversation_freshness");
  });

  it("adds compact guidance when recent conversation replies repeat AI-ish patterns", async () => {
    const result = await assembleGenerationPrompt(conversationStorage(mira), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: [
        { id: "user-1", role: "user", content: "rough day" },
        { id: "assistant-1", role: "assistant", content: "I hear you. That sounds really hard. What do you need right now?" },
        { id: "user-2", role: "user", content: "mostly tired" },
        { id: "assistant-2", role: "assistant", content: "I hear you. That sounds exhausting. How are you feeling about it?" },
        { id: "user-3", role: "user", content: "I do not know" },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "I do not know",
    });

    const text = promptText(result.messages);

    expect(text).toContain("conversation_freshness");
    expect(text).toContain("Recent replies leaned on question endings");
    expect(text).toContain("Recent replies used supportive check-in phrasing");
  });

  it("does not suppress question guidance when the user explicitly asks for questions", async () => {
    const result = await assembleGenerationPrompt(conversationStorage(mira), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: [
        { id: "user-1", role: "user", content: "I need help unpacking this" },
        { id: "assistant-1", role: "assistant", content: "What part feels most tangled?" },
        { id: "user-2", role: "user", content: "all of it" },
        { id: "assistant-2", role: "assistant", content: "What do you want to start with?" },
        { id: "user-3", role: "user", content: "ask me questions until I understand it" },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "ask me questions until I understand it",
    });

    const text = promptText(result.messages);

    expect(text).not.toContain("Recent replies leaned on question endings");
  });
});