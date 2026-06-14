import { describe, expect, it } from "vitest";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../capabilities/storage";
import { resolveMacros, type MacroContext } from "../shared/macros/macro-engine";
import { assembleGenerationPrompt } from "./prompt-assembly";
import type { JsonRecord } from "./runtime-records";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function macroContext(): MacroContext {
  return {
    user: "User",
    char: "Mira",
    characters: ["Mira"],
    variables: {},
  };
}

function promptAssemblyStorage(args: { sections: JsonRecord[] }): StorageGateway {
  const preset = {
    id: "preset-1",
    name: "Depth preset",
    wrapFormat: "xml",
    parameters: { strictRoleFormatting: true },
  };
  const character = {
    id: "char-1",
    name: "Mira",
    description: "A friend who likes music.",
    tags: [],
  };

  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      if (entity === "prompts") return asStorageValue<T[]>([preset]);
      if (entity === "prompt-sections") {
        const presetId = String(options?.filters?.presetId ?? "");
        return asStorageValue<T[]>(
          args.sections.filter((section) => !presetId || String(section.presetId) === presetId),
        );
      }
      if (entity === "prompt-groups") return [];
      if (entity === "prompt-variables") return [];
      if (entity === "personas") return [];
      if (entity === "regex-scripts") return [];
      if (entity === "lorebooks") return [];
      if (entity === "agents") return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && id === character.id) return asStorageValue<T>(character);
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
      return asStorageValue<T>({
        preset,
        sections: args.sections,
        groups: [],
        choiceBlocks: [],
      });
    },
  };
}

describe("prompt assembly macros", () => {
  it("strips every legacy-supported banned macro form before generation", () => {
    const result = resolveMacros(
      [
        'keep {{banned "straight double"}}',
        "{{banned 'single'}}",
        "{{banned \u201ctypographic double\u201d}}",
        "{{banned unquoted text}}",
        "{{banned}}",
        "{{BANNED {{char}}}}",
        "{{banished text}} keep",
      ].join(" "),
      macroContext(),
    );

    expect(result).toBe("keep       {{banished text}} keep");
  });
});

describe("prompt assembly preset depth sections", () => {
  it("injects depth-positioned preset sections at the requested chat-history depth", async () => {
    const prompt = await assembleGenerationPrompt(
      promptAssemblyStorage({
        sections: [
          {
            id: "ordered-before",
            presetId: "preset-1",
            identifier: "orderedBefore",
            name: "Ordered Before",
            content: "Ordered before history.",
            role: "system",
            enabled: true,
            sortOrder: 10,
          },
          {
            id: "depth-reminder",
            presetId: "preset-1",
            identifier: "depthReminder",
            name: "Depth Reminder",
            content: "Depth preset reminder.",
            role: "system",
            enabled: true,
            sortOrder: 20,
            injectionPosition: "depth",
            injectionDepth: 2,
            injectionOrder: 5,
          },
          {
            id: "chat-history",
            presetId: "preset-1",
            identifier: "chatHistory",
            name: "Chat History",
            content: "",
            role: "system",
            enabled: true,
            sortOrder: 30,
            markerConfig: { type: "chat_history" },
          },
          {
            id: "ordered-after",
            presetId: "preset-1",
            identifier: "orderedAfter",
            name: "Ordered After",
            content: "Ordered after history.",
            role: "system",
            enabled: true,
            sortOrder: 40,
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["char-1"],
        },
        storedMessages: [
          { role: "user", content: "history-1" },
          { role: "assistant", content: "history-2" },
          { role: "user", content: "history-3" },
          { role: "assistant", content: "history-4" },
        ],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "history-4",
      },
    );

    const depthIndex = prompt.messages.findIndex((message) => message.content.includes("Depth preset reminder."));
    const history2Index = prompt.messages.findIndex((message) => message.content === "history-2");
    const history3Index = prompt.messages.findIndex((message) => message.content === "history-3");
    const orderedBeforeIndex = prompt.messages.findIndex((message) => message.content.includes("Ordered before history."));
    const orderedAfterIndex = prompt.messages.findIndex((message) => message.content.includes("Ordered after history."));

    expect(orderedBeforeIndex).toBeLessThan(history2Index);
    expect(history2Index).toBeLessThan(depthIndex);
    expect(depthIndex).toBeLessThan(history3Index);
    expect(orderedAfterIndex).toBeGreaterThan(history3Index);
  });

  it("does not add the fallback system prompt for depth-only presets with resolved content", async () => {
    const prompt = await assembleGenerationPrompt(
      promptAssemblyStorage({
        sections: [
          {
            id: "depth-only",
            presetId: "preset-1",
            identifier: "depthOnly",
            name: "Depth Only",
            content: "Depth-only preset instruction.",
            role: "system",
            enabled: true,
            sortOrder: 10,
            injectionPosition: "depth",
            injectionDepth: 1,
            injectionOrder: 5,
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["char-1"],
        },
        storedMessages: [
          { role: "user", content: "history-1" },
          { role: "assistant", content: "history-2" },
        ],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "history-2",
      },
    );

    expect(prompt.messages.some((message) => message.content.includes("Depth-only preset instruction."))).toBe(true);
    expect(prompt.messages.some((message) => message.content === "history-1")).toBe(true);
    expect(prompt.messages.some((message) => message.content === "history-2")).toBe(true);
    expect(prompt.messages.some((message) => message.contextKind === "prompt")).toBe(false);
  });

  it("still falls back when depth-positioned preset sections resolve empty", async () => {
    const prompt = await assembleGenerationPrompt(
      promptAssemblyStorage({
        sections: [
          {
            id: "empty-depth-only",
            presetId: "preset-1",
            identifier: "emptyDepthOnly",
            name: "Empty Depth Only",
            content: "{{banned empty depth section}}",
            role: "system",
            enabled: true,
            sortOrder: 10,
            injectionPosition: "depth",
            injectionDepth: 1,
            injectionOrder: 5,
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["char-1"],
        },
        storedMessages: [{ role: "user", content: "history-1" }],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "history-1",
      },
    );

    expect(prompt.messages.some((message) => message.content.includes("empty depth section"))).toBe(false);
    expect(prompt.messages.some((message) => message.contextKind === "prompt")).toBe(true);
  });
});
