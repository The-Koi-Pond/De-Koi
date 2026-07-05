import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function promptStorage(
  characters: Record<string, unknown> | Record<string, unknown>[],
  promptBundle: { preset: Record<string, unknown>; sections: Record<string, unknown>[] } | null = null,
): StorageGateway {
  const characterRows = Array.isArray(characters) ? characters : [characters];
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
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
describe("merged roleplay prompt compaction", () => {
  it("omits bulky greeting and example fields for merged multi-character roleplay prompts", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage(
        [
          {
            id: "mira",
            data: {
              name: "Mira Vale",
              description: "Mira Vale core description.",
              personality: "Mira Vale core personality.",
              first_mes: "MIRA_GREETING_SHOULD_NOT_BE_SENT",
              mes_example: "MIRA_EXAMPLES_SHOULD_NOT_BE_SENT",
            },
          },
          {
            id: "orin",
            data: {
              name: "Orin",
              description: "Orin core description.",
              personality: "Orin core personality.",
              first_mes: "ORIN_GREETING_SHOULD_NOT_BE_SENT",
              mes_example: "ORIN_EXAMPLES_SHOULD_NOT_BE_SENT",
            },
          },
          {
            id: "sable",
            data: {
              name: "Sable Reed",
              description: "Sable Reed core description.",
              personality: "Sable Reed core personality.",
              first_mes: "SABLE_GREETING_SHOULD_NOT_BE_SENT",
              mes_example: "SABLE_EXAMPLES_SHOULD_NOT_BE_SENT",
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
          characterIds: ["mira", "orin", "sable"],
          metadata: { groupChatMode: "merged" },
        },
        storedMessages: [{ role: "user", content: "Continue." }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Continue.",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");

    expect(promptText).toContain("Mira Vale core description.");
    expect(promptText).toContain("Orin core personality.");
    expect(promptText).toContain("Sable Reed core description.");
    expect(promptText).not.toContain("MIRA_GREETING_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("MIRA_EXAMPLES_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("ORIN_GREETING_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("ORIN_EXAMPLES_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("SABLE_GREETING_SHOULD_NOT_BE_SENT");
    expect(promptText).not.toContain("SABLE_EXAMPLES_SHOULD_NOT_BE_SENT");
  });

  it("adds generic speaker tag guidance for multi-character roleplay", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage([
        {
          id: "mira",
          data: {
            name: "Mira Vale",
            description: "Mira core description.",
          },
        },
        {
          id: "orin",
          data: {
            name: "Orin",
            description: "Orin core description.",
          },
        },
      ]),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["mira", "orin"],
          metadata: { groupChatMode: "merged" },
        },
        storedMessages: [{ role: "user", content: "Continue." }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Continue.",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");

    expect(promptText).toContain(
      "When one assistant response includes quoted dialogue from more than one known character",
    );
    expect(promptText).toContain('<speaker="Mira Vale">"Example dialogue."</speaker>');
    expect(promptText).toContain('<speaker="Orin">"Example dialogue."</speaker>');
    expect(promptText).not.toContain('<speaker="Archivist">');
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
  });
});
