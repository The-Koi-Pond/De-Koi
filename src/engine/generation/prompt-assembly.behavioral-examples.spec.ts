import { describe, expect, it } from "vitest";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function promptStorage(character: Record<string, unknown>): StorageGateway {
  const preset = {
    id: "preset-1",
    name: "Behavioral examples",
    wrapFormat: "xml",
    parameters: { strictRoleFormatting: true },
  };
  const sections = [
    {
      id: "dialogue",
      presetId: preset.id,
      identifier: "dialogueExamples",
      name: "Dialogue Examples",
      content: "",
      role: "system",
      enabled: true,
      sortOrder: 1,
      markerConfig: { type: "dialogue_examples" },
    },
    {
      id: "history",
      presetId: preset.id,
      identifier: "chatHistory",
      name: "Chat History",
      content: "",
      role: "system",
      enabled: true,
      sortOrder: 2,
      markerConfig: { type: "chat_history" },
    },
  ];

  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      if (entity === "prompts") return asStorageValue<T[]>([preset]);
      if (entity === "prompt-sections") {
        const presetId = String(options?.filters?.presetId ?? "");
        return asStorageValue<T[]>(sections.filter((section) => !presetId || section.presetId === presetId));
      }
      if (entity === "prompt-groups" || entity === "prompt-variables") return [];
      if (entity === "personas" || entity === "regex-scripts" || entity === "lorebooks" || entity === "agents")
        return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && id === "mira") return asStorageValue<T>(character);
      if (entity === "prompts" && id === preset.id) return asStorageValue<T>(preset);
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
    async promptFull<T = unknown>(presetId: string): Promise<T | null> {
      if (presetId !== preset.id) return null;
      return asStorageValue<T>({ preset, sections, groups: [], choiceBlocks: [] });
    },
  };
}

describe("prompt assembly behavioral examples", () => {
  it("preserves the existing dialogue-example output for a small authored pool", async () => {
    const mesExample = "<START>\nUser: Hello.\nMira: Keep your voice down.";
    const result = await assembleGenerationPrompt(
      promptStorage({
        id: "mira",
        data: {
          name: "Mira",
          description: "A guarded archivist.",
          mes_example: mesExample,
          first_mes: "Welcome to the archive.",
          alternate_greetings: ["The west door is open."],
        },
      }),
      {
        chat: { id: "chat-1", mode: "roleplay", characterIds: ["mira"] },
        storedMessages: [{ role: "user", content: "Hello." }],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "Hello.",
      },
    );

    const promptText = result.messages.map((message) => message.content).join("\n");
    expect(result.messages[0]?.content).toBe(
      "<dialogue_examples>\n    <START>\n    User: Hello.\n    Mira: Keep your voice down.\n</dialogue_examples>",
    );
    expect(promptText).not.toContain("Welcome to the archive.");
    expect(promptText).not.toContain("The west door is open.");
    expect(result.contextAttributionItems.some((item) => item.kind === "behavioral_example")).toBe(false);
  });

  it("injects only a relevant bounded subset when authored examples exceed the configured threshold", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage({
        id: "mira",
        data: {
          name: "Mira",
          description: "A guarded archivist.",
          mes_example: [
            "<START>\n{{user}}: Nice weather.\n{{char}}: The clouds are tolerable.",
            "<START>\n{{user}}: Surrender the vault key.\n{{char}}: No. Threats make me less cooperative.",
            "<START>\n{{user}}: Did the joke land?\n{{char}}: It fell down the stairs.",
          ].join("\n"),
          alternate_greetings: [],
        },
      }),
      {
        chat: { id: "chat-1", mode: "roleplay", characterIds: ["mira"] },
        storedMessages: [{ role: "user", content: "I order you to surrender the key." }],
        connection: { provider: "openai", model: "qa-model" },
        request: {
          promptPresetId: "preset-1",
          behavioralExampleSelectionThresholdTokens: 1,
          behavioralExampleTokenBudget: 80,
          behavioralExampleCandidateCap: 1,
        },
        latestUserInput: "I order you to surrender the key.",
      },
    );

    const promptText = result.messages.map((message) => message.content).join("\n");
    expect(promptText).toContain("Surrender the vault key.");
    expect(promptText).not.toContain("Nice weather.");
    expect(promptText).not.toContain("Did the joke land?");
    expect(result.contextAttributionItems.filter((item) => item.kind === "behavioral_example")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "injected", parentSourceId: "mira" }),
        expect.objectContaining({ status: "skipped", parentSourceId: "mira" }),
      ]),
    );
  });
});
