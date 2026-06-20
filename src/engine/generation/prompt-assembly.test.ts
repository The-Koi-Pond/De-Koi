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

function promptAssemblyStorage(args: { sections: JsonRecord[]; character?: JsonRecord; groups?: JsonRecord[] }): StorageGateway {
  const preset = {
    id: "preset-1",
    name: "Depth preset",
    wrapFormat: "xml",
    parameters: { strictRoleFormatting: true },
  };
  const character = args.character ?? {
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
      if (entity === "prompt-groups") return asStorageValue<T[]>(args.groups ?? []);
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
      return asStorageValue<T>({
        preset,
        sections: args.sections,
        groups: args.groups ?? [],
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

describe("prompt assembly connected conversation context", () => {
  it("injects linked game influences into conversation prompts", async () => {
    const prompt = await assembleGenerationPrompt(promptAssemblyStorage({ sections: [] }), {
      chat: {
        id: "conversation-1",
        mode: "conversation",
        connectedChatId: "game-1",
        notes: [
          {
            id: "note-1",
            type: "influence",
            targetChatId: "conversation-1",
            content: "The linked game has entered combat.",
            consumed: false,
          },
        ],
      },
      storedMessages: [{ role: "user", content: "What changed?" }],
      connection: { provider: "openai", model: "qa-model" },
      request: { promptPresetId: "preset-1" },
      latestUserInput: "What changed?",
    });

    expect(prompt.messages.some((message) => message.content.includes("<ooc_influences>"))).toBe(true);
    expect(prompt.messages.some((message) => message.content.includes("The linked game has entered combat."))).toBe(
      true,
    );
  });
});

describe("prompt assembly preset depth sections", () => {
  it("does not append character description extensions to prompt macros", async () => {
    const prompt = await assembleGenerationPrompt(
      promptAssemblyStorage({
        character: {
          id: "char-1",
          name: "Mira",
          description: "A friend who likes music.",
          tags: [],
          extensions: {
            altDescriptions: [{ active: true, content: "Hidden combat-state description." }],
          },
        },
        sections: [
          {
            id: "description-macro",
            presetId: "preset-1",
            identifier: "descriptionMacro",
            name: "Description Macro",
            content: "{{description}}",
            role: "system",
            enabled: true,
            sortOrder: 10,
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["char-1"],
        },
        storedMessages: [{ role: "user", content: "hello" }],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "hello",
      },
    );

    const promptText = prompt.messages.map((message) => message.content).join("\n");
    expect(promptText).toContain("A friend who likes music.");
    expect(promptText).not.toContain("Hidden combat-state description.");
  });

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

  it("keeps committed tracker context before the latest history message in strict-role prompts", async () => {
    const prompt = await assembleGenerationPrompt(
      promptAssemblyStorage({ sections: [] }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["char-1"],
          metadata: {
            activeAgentIds: ["world-state"],
          },
          gameState: {
            location: "Library",
            weather: "Rain",
          },
        },
        storedMessages: [
          { role: "user", content: "Where are we?" },
          { role: "assistant", content: "You step inside." },
          { role: "user", content: "What do I see?" },
        ],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "What do I see?",
      },
    );

    const providerPrompt = prompt.messages.map((message) => message.content).join("\n\n");
    expect(providerPrompt).toContain("Trackers:\n<world_state>");
    expect(providerPrompt.indexOf("Trackers:\n<world_state>")).toBeLessThan(
      providerPrompt.indexOf("[History]\nWhat do I see?"),
    );
  });

  it("keeps committed tracker context after history and before a later last-message block", async () => {
    const prompt = await assembleGenerationPrompt(
      promptAssemblyStorage({
        sections: [
          {
            id: "setup",
            presetId: "preset-1",
            identifier: "setup",
            name: "Setup",
            content: "Follow the current scene.",
            role: "system",
            enabled: true,
            sortOrder: 10,
          },
          {
            id: "chat-history",
            presetId: "preset-1",
            identifier: "chatHistory",
            name: "Chat History",
            content: "",
            role: "system",
            enabled: true,
            sortOrder: 20,
            markerConfig: { type: "chat_history" },
          },
          {
            id: "last-message",
            presetId: "preset-1",
            identifier: "lastMessage",
            name: "Last Message",
            content: "Assistant final beat.",
            role: "system",
            enabled: true,
            sortOrder: 30,
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["char-1"],
          metadata: {
            activeAgentIds: ["world-state"],
          },
          gameState: {
            location: "Library",
            weather: "Rain",
          },
        },
        storedMessages: [
          { role: "user", content: "Where are we?" },
          { role: "assistant", content: "You step inside." },
          { role: "user", content: "What do I see?" },
        ],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "What do I see?",
      },
    );

    const providerPrompt = prompt.messages.map((message) => message.content).join("\n\n");
    const historyIndex = providerPrompt.indexOf("[History]\nWhat do I see?");
    const trackerIndex = providerPrompt.indexOf("Trackers:\n<world_state>");
    const lastMessageIndex = providerPrompt.indexOf("<last_message>");

    expect(historyIndex).toBeGreaterThanOrEqual(0);
    expect(trackerIndex).toBeGreaterThan(historyIndex);
    expect(trackerIndex).toBeLessThan(lastMessageIndex);
  });

  it("dedupes older last-message prompt wrappers before injecting tracker context", async () => {
    const prompt = await assembleGenerationPrompt(
      promptAssemblyStorage({
        sections: [
          {
            id: "old-last-message",
            presetId: "preset-1",
            identifier: "oldLastMessage",
            name: "Last Message",
            content: "Stale last-message block.",
            role: "system",
            enabled: true,
            sortOrder: 10,
          },
          {
            id: "chat-history",
            presetId: "preset-1",
            identifier: "chatHistory",
            name: "Chat History",
            content: "",
            role: "system",
            enabled: true,
            sortOrder: 20,
            markerConfig: { type: "chat_history" },
          },
          {
            id: "current-last-message",
            presetId: "preset-1",
            identifier: "currentLastMessage",
            name: "Last Message",
            content: "Current last-message block.",
            role: "system",
            enabled: true,
            sortOrder: 30,
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["char-1"],
          metadata: {
            activeAgentIds: ["world-state"],
          },
          gameState: {
            location: "Library",
          },
        },
        storedMessages: [{ role: "user", content: "What do I see?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "What do I see?",
      },
    );

    const providerPrompt = prompt.messages.map((message) => message.content).join("\n\n");

    expect(providerPrompt).toContain("Stale last-message block.");
    expect(providerPrompt).toContain("<last_message>\n    Current last-message block.");
    expect(providerPrompt.match(/<last_message>/g)).toHaveLength(1);
  });

  it("dedupes older last-message wrappers inside grouped preset sections", async () => {
    const prompt = await assembleGenerationPrompt(
      promptAssemblyStorage({
        groups: [
          {
            id: "group-1",
            presetId: "preset-1",
            name: "Context Group",
            enabled: true,
          },
        ],
        sections: [
          {
            id: "old-last-message",
            presetId: "preset-1",
            identifier: "oldLastMessage",
            name: "Last Message",
            content: "Grouped stale last-message block.",
            role: "system",
            enabled: true,
            sortOrder: 10,
            groupId: "group-1",
          },
          {
            id: "chat-history",
            presetId: "preset-1",
            identifier: "chatHistory",
            name: "Chat History",
            content: "",
            role: "system",
            enabled: true,
            sortOrder: 20,
            markerConfig: { type: "chat_history" },
          },
          {
            id: "current-last-message",
            presetId: "preset-1",
            identifier: "currentLastMessage",
            name: "Last Message",
            content: "Current last-message block.",
            role: "system",
            enabled: true,
            sortOrder: 30,
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["char-1"],
          metadata: {
            activeAgentIds: ["world-state"],
          },
          gameState: {
            location: "Library",
          },
        },
        storedMessages: [{ role: "user", content: "What do I see?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: { promptPresetId: "preset-1" },
        latestUserInput: "What do I see?",
      },
    );

    const providerPrompt = prompt.messages.map((message) => message.content).join("\n\n");

    expect(providerPrompt).toContain("Grouped stale last-message block.");
    expect(providerPrompt).toContain("<last_message>\n    Current last-message block.");
    expect(providerPrompt.match(/<last_message>/g)).toHaveLength(1);
  });
});
