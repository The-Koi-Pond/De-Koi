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

const juno = {
  id: "juno",
  data: { name: "Juno", description: "Juno texts in short lowercase bursts." },
};

describe("conversation reactions in the prompt", () => {
  it("adds who reacted with what after a reacted message", async () => {
    const result = await assembleGenerationPrompt(conversationStorage(juno), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["juno"], metadata: {} },
      storedMessages: [
        {
          id: "user-1",
          role: "user",
          content: "i got the job",
          extra: { reactions: [{ by: "juno", emoji: "🎉", at: "2026-10-19T12:00:00.000Z" }] },
        },
        {
          id: "assistant-1",
          role: "assistant",
          characterId: "juno",
          content: "SAM. cake. now",
          extra: { reactions: [{ by: "user", emoji: "❤️", at: "2026-10-19T12:01:00.000Z" }] },
        },
        { id: "user-2", role: "user", content: "ok ok" },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "ok ok",
    });

    const history = result.messages
      .filter((message) => message.role !== "system")
      .map((message) => message.content)
      .join("\n");
    expect(history).toContain("i got the job\n(Juno reacted 🎉)");
    expect(history).toContain("SAM. cake. now\n(The user reacted ❤️)");
  });
});
