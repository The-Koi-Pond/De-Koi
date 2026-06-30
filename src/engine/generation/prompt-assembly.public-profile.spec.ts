import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function promptStorage(character: Record<string, unknown>): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (["personas", "prompts", "regex-scripts", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && id === character.id) return asStorageValue<T>(character);
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
