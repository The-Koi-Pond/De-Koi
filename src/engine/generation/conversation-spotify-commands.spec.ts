import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";
import { persistConnectedCommandTags } from "./connected-commands";
import { conversationCommandPromptEnabled } from "../modes/chat/commands/activation";
import type { JsonRecord } from "./runtime-records";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function promptStorage(): StorageGateway {
  const character = {
    id: "char-1",
    name: "Mira",
    description: "A friend who likes music.",
    tags: [],
  };
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "personas") return [];
      if (entity === "prompts") return [];
      if (entity === "regex-scripts") return [];
      if (entity === "lorebooks") return [];
      if (entity === "agents") return [];
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

function commandStorage(): StorageGateway {
  return {
    async list() {
      return [];
    },
    async get() {
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

function spotifyIntegrations(searchTracks: IntegrationGateway["spotify"]["searchTracks"]): IntegrationGateway {
  return {
    spotify: {
      async player() {
        return asStorageValue({});
      },
      async playlists() {
        return asStorageValue({});
      },
      async playlistTracks() {
        return asStorageValue({});
      },
      searchTracks,
      async playTrack() {
        return asStorageValue({});
      },
      async play() {
        return asStorageValue({});
      },
      async volume() {
        return asStorageValue({});
      },
    },
    customTools: {
      async execute() {
        return asStorageValue({});
      },
    },
    image: {
      async generate() {
        return asStorageValue({});
      },
    },
  };
}

async function conversationPromptText(commandCapabilities: JsonRecord, metadata: JsonRecord = {}): Promise<string> {
  const result = await assembleGenerationPrompt(promptStorage(), {
    chat: {
      id: "chat-1",
      mode: "conversation",
      characterIds: ["char-1"],
      metadata: {
        ...metadata,
        commandCapabilities,
      },
    },
    storedMessages: [{ role: "user", content: "Play something fitting." }],
    connection: { provider: "openai", model: "qa-model" },
    request: {},
    latestUserInput: "Play something fitting.",
  });
  return result.messages.map((message) => String(message.content ?? "")).join("\n");
}

async function timedConversationPromptText(
  storedMessages: JsonRecord[],
  latestUserInput: string,
  request: JsonRecord = {},
): Promise<string> {
  const result = await assembleGenerationPrompt(promptStorage(), {
    chat: {
      id: "chat-1",
      mode: "conversation",
      characterIds: ["char-1"],
      metadata: {},
    },
    storedMessages,
    connection: { provider: "openai", model: "qa-model" },
    request: { userTimeZone: "America/New_York", ...request },
    latestUserInput,
  });
  return result.messages.map((message) => String(message.content ?? "")).join("\n");
}

describe("conversation Spotify command prompting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds authoritative current date, time, weekday, and daypart to conversation prompts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T19:30:00.000Z"));

    const result = await assembleGenerationPrompt(promptStorage(), {
      chat: {
        id: "chat-1",
        mode: "conversation",
        characterIds: ["char-1"],
        metadata: {},
      },
      storedMessages: [{ role: "user", content: "what time of day is it?" }],
      connection: { provider: "openai", model: "qa-model" },
      request: { userTimeZone: "America/New_York" },
      latestUserInput: "what time of day is it?",
    });

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(promptText).toContain("Current date: 2026-06-21");
    expect(promptText).toContain("Current time: 15:30");
    expect(promptText).toContain("Current weekday: Sunday");
    expect(promptText).toContain("Current time of day: afternoon");
    expect(promptText).toContain("Time zone: America/New_York");
  });

  it("marks an overnight user return as a later conversation interaction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T13:00:00.000Z"));

    const promptText = await timedConversationPromptText(
      [
        {
          id: "assistant-goodnight",
          role: "assistant",
          content: "goodnight",
          createdAt: "2026-06-22T03:30:00.000Z",
        },
        {
          id: "user-return",
          role: "user",
          content: "hey, how are you?",
          createdAt: "2026-06-22T13:00:00.000Z",
        },
      ],
      "hey, how are you?",
    );

    expect(promptText).toContain("Conversation resumed 9h 30m after the previous visible message");
    expect(promptText).toContain("2026-06-21 23:30 -> 2026-06-22 09:00; local date changed");
    expect(promptText).toContain("Treat this as a later interaction");
  });

  it("keeps a short message gap in the same conversation interaction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T13:00:00.000Z"));

    const promptText = await timedConversationPromptText(
      [
        {
          id: "assistant-recent",
          role: "assistant",
          content: "not bad, you?",
          createdAt: "2026-06-22T12:50:00.000Z",
        },
        {
          id: "user-recent",
          role: "user",
          content: "pretty good",
          createdAt: "2026-06-22T13:00:00.000Z",
        },
      ],
      "pretty good",
    );

    expect(promptText).not.toContain("Conversation resumed");
    expect(promptText).not.toContain("Treat this as a later interaction");
  });

  it("does not reinterpret an overnight gap while regenerating an old reply", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T13:00:00.000Z"));

    const promptText = await timedConversationPromptText(
      [
        {
          id: "assistant-goodnight",
          role: "assistant",
          content: "goodnight",
          createdAt: "2026-06-22T03:30:00.000Z",
        },
        {
          id: "user-return",
          role: "user",
          content: "hey, how are you?",
          createdAt: "2026-06-22T13:00:00.000Z",
        },
      ],
      "hey, how are you?",
      { regenerateMessageId: "assistant-reply" },
    );

    expect(promptText).not.toContain("Conversation resumed");
    expect(promptText).not.toContain("Treat this as a later interaction");
  });

  it("uses one activation contract for conversation command defaults", () => {
    expect(conversationCommandPromptEnabled({ mode: "conversation" })).toBe(true);
    expect(conversationCommandPromptEnabled({ mode: "conversation", metadata: {} })).toBe(true);
    expect(conversationCommandPromptEnabled({ mode: "conversation", metadata: { characterCommands: false } })).toBe(
      false,
    );
    expect(conversationCommandPromptEnabled({ mode: "roleplay", metadata: {} })).toBe(false);
  });

  it("advertises Spotify only when playback is available and command capability is enabled", async () => {
    await expect(conversationPromptText({ spotifyPlaybackAvailable: false })).resolves.not.toContain(
      '[spotify: title="Song title", artist="Artist"]',
    );
    await expect(conversationPromptText({ spotifyPlaybackAvailable: true })).resolves.toContain(
      '[spotify: title="Song title", artist="Artist"]',
    );
    await expect(
      conversationPromptText({ spotifyPlaybackAvailable: true }, { characterCommands: false }),
    ).resolves.not.toContain('[spotify: title="Song title", artist="Artist"]');
    await expect(conversationPromptText({ spotifyPlaybackAvailable: true, spotify: false })).resolves.not.toContain(
      '[spotify: title="Song title", artist="Artist"]',
    );
  });
});

describe("conversation Spotify command execution", () => {
  it("reports a command error instead of success when Spotify search returns no playable track", async () => {
    const result = await persistConnectedCommandTags(
      commandStorage(),
      { id: "chat-1", mode: "conversation" },
      'Visible reply.\n[spotify: title="Missing Song", artist="No Artist"]',
      spotifyIntegrations(async () => asStorageValue({ tracks: [] })),
    );

    expect(result.displayContent).toBe("Visible reply.");
    expect(result.executedCommands).toEqual([]);
    expect(result.events).toEqual([
      {
        type: "command_error",
        data: {
          command: "spotify",
          error: 'Spotify did not find a playable track for "Missing Song" by "No Artist".',
        },
      },
    ]);
  });
});
