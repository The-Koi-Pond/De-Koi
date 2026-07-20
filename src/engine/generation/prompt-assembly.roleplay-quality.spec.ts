import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function storage(): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (["prompts", "personas", "regex-scripts", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && id === "mira") {
        return { id: "mira", data: { name: "Mira", description: "A careful archivist." } } as T;
      }
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
      return {} as T;
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
    async listChatMemories() {
      return [];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return {} as T;
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

const repeatedHistory = [
  { id: "assistant-1", role: "assistant", content: "For a long moment, Mira waits. What happened?" },
  { id: "user-1", role: "user", content: "I listen." },
  { id: "assistant-2", role: "assistant", content: "For a long moment, she watches. What did you see?" },
  { id: "user-2", role: "user", content: "I stay quiet." },
  { id: "assistant-3", role: "assistant", content: "For a long moment, the rain falls. Will you answer?" },
  { id: "user-3", role: "user", content: "I wait." },
];

function promptText(result: Awaited<ReturnType<typeof assembleGenerationPrompt>>): string {
  return result.messages.map((message) => message.content).join("\n");
}

describe("Roleplay quality prompt guidance", () => {
  it.each(["roleplay", "visual_novel"])("injects and attributes bounded guidance in %s mode", async (mode) => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: {
        id: "chat-1",
        mode,
        characterIds: ["mira"],
        metadata: {},
        promptVariables: {
          agencyStrictness: "strict agency: never write the user's deliberate actions.",
        },
      },
      storedMessages: repeatedHistory,
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "I wait.",
    });

    expect(promptText(result)).toContain("<roleplay_quality>");
    expect(promptText(result)).toContain("Avoid repeating the recent phrase");
    expect(result.contextAttributionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_injection",
          label: "Roleplay quality",
          status: "injected",
          sourceId: "core-roleplay-quality",
        }),
      ]),
    );
    expect(result.roleplayAgencyContract).toContain("strict agency:");
  });

  it("does not add Roleplay guidance to Conversation mode", async () => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: repeatedHistory,
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "I wait.",
    });

    expect(promptText(result)).not.toContain("roleplay_quality");
    expect(result.contextAttributionItems).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: "core-roleplay-quality" })]),
    );
  });

  it("honors an explicit request for questions while keeping unrelated repetition guidance", async () => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: { id: "chat-1", mode: "roleplay", characterIds: ["mira"], metadata: {} },
      storedMessages: repeatedHistory,
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "Keep asking me questions until we solve it.",
    });

    const text = promptText(result);
    expect(text).toContain("Avoid repeating the recent phrase");
    expect(text).not.toContain("Do not end the next reply with another question");
  });
});
