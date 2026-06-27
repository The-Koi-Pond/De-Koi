import { describe, expect, it } from "vitest";

import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { providerVisibleLlmParameters } from "../../../generation/provider-visible-parameters";
import {
  maybeRefreshConversationStatusMessages,
  readStatusMessageMeta,
  shouldRefreshStatusMessage,
} from "./status-message.service";

const now = new Date("2026-06-26T12:00:00.000Z");
type Row = Record<string, unknown>;

function memoryStorage(seed: Record<string, Record<string, Row>>): StorageGateway {
  return {
    async get(collection: string, id: string) {
      return (seed[collection]?.[id] ?? null) as never;
    },
    async list(
      collection: string,
      options?: { filters?: Record<string, unknown>; orderBy?: string; descending?: boolean; limit?: number },
    ) {
      let rows = Object.values(seed[collection] ?? {});
      if (options?.filters) {
        rows = rows.filter((row) =>
          Object.entries(options.filters ?? {}).every(([field, value]) => row[field] === value),
        );
      }
      if (options?.orderBy) {
        const field = options.orderBy;
        rows = [...rows].sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")));
      }
      if (options?.descending) rows = [...rows].reverse();
      if (typeof options?.limit === "number") rows = rows.slice(0, options.limit);
      return rows as never;
    },
    async update(collection: string, id: string, patch: Record<string, unknown>) {
      seed[collection] ??= {};
      seed[collection]![id] = { ...(seed[collection]![id] ?? {}), ...(patch as Row) };
      return seed[collection]![id] as never;
    },
    async patchChatMetadata(id: string, patch: Record<string, unknown>) {
      const chat = seed.chats?.[id] ?? {};
      const metadata = typeof chat.metadata === "object" && chat.metadata ? (chat.metadata as Row) : {};
      seed.chats ??= {};
      seed.chats[id] = { ...chat, metadata: { ...metadata, ...(patch as Row) } };
      return seed.chats[id] as never;
    },
    async listChatMessages(
      chatId: string,
      options?: { role?: string; characterId?: string; orderBy?: string; descending?: boolean; limit?: number },
    ) {
      let rows = Object.values(seed.messages ?? {}).filter((message) => message.chatId === chatId);
      if (options?.role) rows = rows.filter((message) => message.role === options.role);
      if (options?.characterId) rows = rows.filter((message) => message.characterId === options.characterId);
      if (options?.orderBy) {
        const field = options.orderBy;
        rows = [...rows].sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")));
      }
      if (options?.descending) rows = [...rows].reverse();
      if (typeof options?.limit === "number") rows = rows.slice(0, options.limit);
      return rows as never;
    },
  } as unknown as StorageGateway;
}

function llmReturning(content: string): LlmGateway {
  return {
    async complete() {
      return content;
    },
  } as unknown as LlmGateway;
}

describe("status-message refresh gating", () => {
  it("refreshes when there is no generated status message", () => {
    expect(
      shouldRefreshStatusMessage({
        enabled: true,
        extensions: {},
        currentStatus: "online",
        currentActivity: "free time",
        now,
      }),
    ).toBe(true);
  });

  it("does not refresh before nextRefreshAt when the activity is unchanged", () => {
    expect(
      shouldRefreshStatusMessage({
        enabled: true,
        extensions: {
          conversationStatusMessage: "skimming old notes",
          conversationStatusMessageMeta: {
            generatedAt: "2026-06-26T11:40:00.000Z",
            nextRefreshAt: "2026-06-26T12:40:00.000Z",
            sourceStatus: "online",
            sourceActivity: "free time",
          },
        },
        currentStatus: "online",
        currentActivity: "free time",
        now,
      }),
    ).toBe(false);
  });

  it("refreshes immediately when the schedule status or activity changes", () => {
    expect(
      shouldRefreshStatusMessage({
        enabled: true,
        extensions: {
          conversationStatusMessage: "skimming old notes",
          conversationStatusMessageMeta: {
            generatedAt: "2026-06-26T11:40:00.000Z",
            nextRefreshAt: "2026-06-26T12:40:00.000Z",
            sourceStatus: "online",
            sourceActivity: "free time",
          },
        },
        currentStatus: "dnd",
        currentActivity: "in class",
        now,
      }),
    ).toBe(true);
  });

  it("ignores malformed stored metadata and refreshes", () => {
    expect(readStatusMessageMeta({ conversationStatusMessageMeta: "oops" })).toBeNull();
    expect(
      shouldRefreshStatusMessage({
        enabled: true,
        extensions: {
          conversationStatusMessage: "skimming old notes",
          conversationStatusMessageMeta: "oops",
        },
        currentStatus: "online",
        currentActivity: "free time",
        now,
      }),
    ).toBe(true);
  });

  it("does not refresh when disabled", () => {
    expect(
      shouldRefreshStatusMessage({
        enabled: false,
        extensions: {},
        currentStatus: "online",
        currentActivity: "free time",
        now,
      }),
    ).toBe(false);
  });
});

describe("maybeRefreshConversationStatusMessages", () => {
  it("does nothing when chat metadata has status blurbs disabled", async () => {
    const storage = {
      async get(collection: string, id: string) {
        if (collection === "chats" && id === "chat1") {
          return {
            id: "chat1",
            mode: "conversation",
            characterIds: ["char1"],
            metadata: { conversationStatusMessagesEnabled: false },
          };
        }
        throw new Error(`unexpected get: ${collection}/${id}`);
      },
      async list(collection: string) {
        if (collection === "connections") throw new Error("connections should not be read");
        return [];
      },
      async update() {
        throw new Error("not expected");
      },
      async patchChatMetadata() {
        throw new Error("not expected");
      },
      async listChatMessages() {
        return [];
      },
    } as unknown as StorageGateway;

    await maybeRefreshConversationStatusMessages(
      { storage, llm: llmReturning('{"message":"reading"}') },
      { chatId: "chat1", now: new Date("2026-06-26T12:00:00.000Z") },
    );
  });

  it("does nothing when chat has no character ids", async () => {
    const storage = {
      async get(collection: string, id: string) {
        if (collection === "chats" && id === "chat1") {
          return {
            id: "chat1",
            mode: "conversation",
            metadata: { conversationStatusMessagesEnabled: true },
          };
        }
        throw new Error(`unexpected get: ${collection}/${id}`);
      },
      async list(collection: string) {
        if (collection === "connections") throw new Error("connections should not be read");
        return [];
      },
      async update() {
        throw new Error("not expected");
      },
      async patchChatMetadata() {
        throw new Error("not expected");
      },
      async listChatMessages() {
        return [];
      },
    } as unknown as StorageGateway;

    await maybeRefreshConversationStatusMessages(
      { storage, llm: llmReturning('{"message":"reading"}') },
      { chatId: "chat1", now: new Date("2026-06-26T12:00:00.000Z") },
    );
  });

  it("stores a sanitized generated blurb and metadata when enabled", async () => {
    const seed = {
      chats: {
        chat1: {
          id: "chat1",
          mode: "conversation",
          connectionId: "conn1",
          characterIds: ["char1"],
          metadata: { conversationStatusMessagesEnabled: true },
        },
      },
      connections: {
        conn1: { id: "conn1", model: "test-model" },
      },
      characters: {
        char1: {
          id: "char1",
          data: {
            name: "Ari",
            description: "A focused student.",
            personality: "Careful and dryly funny.",
            extensions: { conversationStatus: "online", conversationActivity: "free time" },
          },
        },
      },
    };

    await maybeRefreshConversationStatusMessages(
      {
        storage: memoryStorage(seed),
        llm: llmReturning(
          JSON.stringify({
            message:
              '"  quietly   reading\nby the window with coffee and notes that stretch past the safety cap while waiting for the rain to ease and the room to settle into silence  "',
          }),
        ),
      },
      { chatId: "chat1", now: new Date("2026-06-26T12:00:00.000Z") },
    );

    const extensions = (seed.characters.char1.data as Row).extensions as Row;
    const message = extensions.conversationStatusMessage as string;
    expect(message).toHaveLength(96);
    expect(message).toContain("quietly reading by the window with coffee and notes");
    expect(message).not.toMatch(/^['"`]|['"`]$/);
    expect(message).not.toContain("\n");
    expect(message).not.toMatch(/\s{2,}/);
    expect(extensions.conversationStatusMessageMeta).toMatchObject({
      generatedAt: "2026-06-26T12:00:00.000Z",
      sourceStatus: "online",
      sourceActivity: "free time",
    });
  });

  it("asks for a character-authored custom status in default Conversation style", async () => {
    const seed = {
      chats: {
        chat1: {
          id: "chat1",
          mode: "conversation",
          connectionId: "conn1",
          characterIds: ["char1"],
          metadata: {
            conversationStatusMessagesEnabled: true,
            summary: "Ari has been teasing the user about procrastinating on homework.",
          },
        },
      },
      connections: {
        conn1: { id: "conn1", model: "test-model" },
      },
      characters: {
        char1: {
          id: "char1",
          data: {
            name: "Ari",
            description: "A focused student.",
            personality: "Careful and dryly funny.",
            extensions: { conversationStatus: "online", conversationActivity: "studying chemistry" },
          },
        },
      },
    };
    let systemPrompt = "";

    await maybeRefreshConversationStatusMessages(
      {
        storage: memoryStorage(seed),
        llm: {
          async complete(request: Parameters<LlmGateway["complete"]>[0]) {
            systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
            return JSON.stringify({ message: "i'm pretending chemistry is fun" });
          },
        } as unknown as LlmGateway,
      },
      { chatId: "chat1", now: new Date("2026-06-26T12:00:00.000Z") },
    );

    expect(systemPrompt).toContain("first-person");
    expect(systemPrompt).toContain("custom status");
    expect(systemPrompt).toContain("Sound like a person texting");
    expect(systemPrompt).toContain("Do not sound like an assistant, therapist, narrator, or writing partner");
    expect(systemPrompt).toContain("no *actions*, no narration, no quoted dialogue, no stage directions");
    expect(systemPrompt).toContain("Do not write a schedule label or third-person activity summary");
  });
  it("includes character Conversation typing quirks and recent replies in the status prompt", async () => {
    const seed = {
      chats: {
        chat1: {
          id: "chat1",
          mode: "conversation",
          connectionId: "conn1",
          characterIds: ["michael"],
          metadata: { conversationStatusMessagesEnabled: true },
        },
      },
      connections: {
        conn1: { id: "conn1", model: "test-model" },
      },
      characters: {
        michael: {
          id: "michael",
          data: {
            name: "Michael Myers (The Shape)",
            description: "Silent, masked killer.",
            personality: "Pure evil, silent, relentless.",
            system_prompt:
              "In texting/Conversation Mode, Michael is trying to use a phone for the first time. He types in short, broken, poorly spelled words with massive typos.",
            post_history_instructions:
              "In texting/Conversation Mode, have him type short, blunt, broken words with massive typos like STAK U, KIL, and WRE U.",
            mes_example:
              "{{user}}: Where are you?\n{{char}}: HADNFLD WRE U\n***\n{{user}}: What are you doing?\n{{char}}: STAK U",
            extensions: { conversationStatus: "dnd", conversationActivity: "Participating in Trials" },
          },
        },
      },
      messages: {
        message1: {
          id: "message1",
          chatId: "chat1",
          role: "assistant",
          characterId: "michael",
          content: "U LUK OK ME STAK U",
          createdAt: "2026-06-26T18:50:34.150Z",
        },
        message2: {
          id: "message2",
          chatId: "chat1",
          role: "user",
          content: "Do you not want people to run?",
          createdAt: "2026-06-26T18:51:25.316Z",
        },
        message3: {
          id: "message3",
          chatId: "chat1",
          role: "assistant",
          characterId: "michael",
          content: "THEI RUN NO ESKP I STB",
          createdAt: "2026-06-26T18:51:32.534Z",
        },
        message4: {
          id: "message4",
          chatId: "chat1",
          role: "assistant",
          content: "watching you like normal prose",
          createdAt: "2026-06-26T18:52:32.534Z",
        },
      },
    };
    let systemPrompt = "";

    await maybeRefreshConversationStatusMessages(
      {
        storage: memoryStorage(seed),
        llm: {
          async complete(request: Parameters<LlmGateway["complete"]>[0]) {
            systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
            return JSON.stringify({ message: "STAK U" });
          },
        } as unknown as LlmGateway,
      },
      { chatId: "chat1", now },
    );

    expect(systemPrompt).toContain("same typing quirks");
    expect(systemPrompt).toContain("typing style evidence");
    expect(systemPrompt).toContain("poorly spelled words with massive typos");
    expect(systemPrompt).toContain("STAK U");
    expect(systemPrompt).toContain("WRE U");
    expect(systemPrompt).toContain("U LUK OK ME STAK U");
    expect(systemPrompt).toContain("THEI RUN NO ESKP I STB");
    expect(systemPrompt).not.toContain("watching you like normal prose");
  });

  it("uses the newest explicitly owned replies from a capped mixed transcript", async () => {
    const messages: Record<string, Row> = {};
    for (let index = 0; index < 7; index += 1) {
      messages[`oldOwned${index}`] = {
        id: `oldOwned${index}`,
        chatId: "chat1",
        role: "assistant",
        characterId: "char1",
        content: `OLD STYLE SAMPLE ${index}`,
        createdAt: new Date(Date.UTC(2026, 5, 26, 10, index)).toISOString(),
      };
    }
    for (let index = 0; index < 170; index += 1) {
      messages[`user${index}`] = {
        id: `user${index}`,
        chatId: "chat1",
        role: "user",
        content: `filler ${index}`,
        createdAt: new Date(Date.UTC(2026, 5, 26, 11, index)).toISOString(),
      };
    }
    messages.latestOwned = {
      id: "latestOwned",
      chatId: "chat1",
      role: "assistant",
      characterId: "char1",
      content: "LATEST OWNED QUIRK",
      createdAt: "2026-06-26T15:00:00.000Z",
    };
    messages.unownedLatest = {
      id: "unownedLatest",
      chatId: "chat1",
      role: "assistant",
      content: "AMBIGUOUS IMPORTED VOICE",
      createdAt: "2026-06-26T16:00:00.000Z",
    };

    const seed = {
      chats: {
        chat1: {
          id: "chat1",
          mode: "conversation",
          connectionId: "conn1",
          characterIds: ["char1"],
          metadata: { conversationStatusMessagesEnabled: true },
        },
      },
      connections: { conn1: { id: "conn1", model: "test-model" } },
      characters: {
        char1: {
          id: "char1",
          data: {
            name: "Ari",
            system_prompt: "Ari texts in clipped notebook fragments.",
            extensions: { conversationStatus: "online", conversationActivity: "free time" },
          },
        },
      },
      messages,
    };
    let systemPrompt = "";

    await maybeRefreshConversationStatusMessages(
      {
        storage: memoryStorage(seed),
        llm: {
          async complete(request: Parameters<LlmGateway["complete"]>[0]) {
            systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
            return JSON.stringify({ message: "latest owned quirk" });
          },
        } as unknown as LlmGateway,
      },
      { chatId: "chat1", now },
    );

    expect(systemPrompt).toContain("LATEST OWNED QUIRK");
    expect(systemPrompt).not.toContain("OLD STYLE SAMPLE 0");
    expect(systemPrompt).not.toContain("AMBIGUOUS IMPORTED VOICE");
  });

  it("only includes usable character turns from card message examples", async () => {
    const seed = {
      chats: {
        chat1: {
          id: "chat1",
          mode: "conversation",
          connectionId: "conn1",
          characterIds: ["char1"],
          metadata: { conversationStatusMessagesEnabled: true },
        },
      },
      connections: { conn1: { id: "conn1", model: "test-model" } },
      characters: {
        char1: {
          id: "char1",
          data: {
            name: "Ari",
            mes_example:
              "***\n{{user}}: only user text\n***\nloose narration without a character turn\n***\nstray setup text\n{{char}}: FAKE COMMENTARY TURN\n***\n{{user}}: what now?\n{{char}}: VALID QUIRK TURN",
            extensions: { conversationStatus: "online", conversationActivity: "free time" },
          },
        },
      },
    };
    let systemPrompt = "";

    await maybeRefreshConversationStatusMessages(
      {
        storage: memoryStorage(seed),
        llm: {
          async complete(request: Parameters<LlmGateway["complete"]>[0]) {
            systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
            return JSON.stringify({ message: "valid quirk turn" });
          },
        } as unknown as LlmGateway,
      },
      { chatId: "chat1", now },
    );

    expect(systemPrompt).toContain("VALID QUIRK TURN");
    expect(systemPrompt).not.toContain("only user text");
    expect(systemPrompt).not.toContain("loose narration without a character turn");
    expect(systemPrompt).not.toContain("FAKE COMMENTARY TURN");
  });
  it("does not resolve connections when no character needs a refresh", async () => {
    const seed = {
      chats: {
        chat1: {
          id: "chat1",
          mode: "conversation",
          characterIds: ["char1"],
          metadata: { conversationStatusMessagesEnabled: true },
        },
      },
      connections: {},
      characters: {
        char1: {
          id: "char1",
          data: {
            name: "Ari",
            extensions: {
              conversationStatus: "online",
              conversationActivity: "free time",
              conversationStatusMessage: "already reading",
              conversationStatusMessageMeta: {
                nextRefreshAt: "2026-06-26T13:00:00.000Z",
                generatedAt: "2026-06-26T11:00:00.000Z",
                sourceStatus: "online",
                sourceActivity: "free time",
              },
            },
          },
        },
      },
    };

    const result = await maybeRefreshConversationStatusMessages(
      { storage: memoryStorage(seed), llm: llmReturning('{"message":"unused"}') },
      { chatId: "chat1", now: new Date("2026-06-26T12:00:00.000Z") },
    );

    expect(result).toEqual({ refreshed: [], skipped: ["char1"] });
  });

  it("retries empty length-limited provider responses with a larger no-reasoning budget", async () => {
    const seed = {
      chats: {
        chat1: {
          id: "chat1",
          mode: "conversation",
          connectionId: "conn1",
          characterIds: ["char1"],
          metadata: { conversationStatusMessagesEnabled: true },
        },
      },
      connections: {
        conn1: { id: "conn1", provider: "custom", model: "gemini-3.5-flash" },
      },
      characters: {
        char1: {
          id: "char1",
          data: {
            name: "Michael Myers (The Shape)",
            extensions: { conversationStatus: "idle", conversationActivity: "Patrolling Lampkin Lane" },
          },
        },
      },
    };
    const requests: Array<Parameters<LlmGateway["complete"]>[0]> = [];

    const result = await maybeRefreshConversationStatusMessages(
      {
        storage: memoryStorage(seed),
        llm: {
          async complete(request: Parameters<LlmGateway["complete"]>[0]) {
            requests.push(request);
            if (requests.length === 1) {
              throw Object.assign(new Error("empty assistant content from provider"), {
                details: {
                  error: "Provider response did not contain assistant text",
                  providerMetadata: { finish_reason: "length" },
                },
              });
            }
            return JSON.stringify({ message: "still watching" });
          },
        } as unknown as LlmGateway,
      },
      { chatId: "chat1", now },
    );

    expect(result).toEqual({ refreshed: ["char1"], skipped: [] });
    expect(requests).toHaveLength(2);
    expect(requests[0].parameters).toMatchObject({ maxTokens: 1024, reasoningEffort: "none" });
    expect(requests[1].parameters).toMatchObject({ maxTokens: 2048, reasoningEffort: "none" });
    expect(requests[0].parameters?.customParameters).toMatchObject({
      reasoning_effort: "none",
      reasoning: { exclude: true },
    });
    expect(
      providerVisibleLlmParameters({ provider: "custom", model: "gemini-3.5-flash" }, requests[0].parameters ?? {}),
    ).toMatchObject({
      maxTokens: 1024,
      reasoningEffort: "none",
      customParameters: {
        reasoning_effort: "none",
        reasoning: { exclude: true },
      },
    });
    expect(
      providerVisibleLlmParameters({ provider: "google", model: "gemini-3.5-flash" }, requests[1].parameters ?? {}),
    ).toMatchObject({
      generationConfig: {
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: "minimal", includeThoughts: true },
      },
    });
    const extensions = (seed.characters.char1.data as Row).extensions as Row;
    expect(extensions.conversationStatusMessage).toBe("still watching");
  });

  it("throws when status blurbs are enabled but the configured connection is missing", async () => {
    const storage = {
      async get(collection: string, id: string) {
        if (collection === "chats" && id === "chat1") {
          return {
            id: "chat1",
            mode: "conversation",
            connectionId: "missing-conn",
            characterIds: ["char1"],
            metadata: { conversationStatusMessagesEnabled: true },
          };
        }
        if (collection === "characters" && id === "char1") {
          return {
            id: "char1",
            data: {
              name: "Ari",
              extensions: { conversationStatus: "online", conversationActivity: "free time" },
            },
          };
        }
        if (collection === "connections") return null;
        return null;
      },
      async list(collection: string) {
        if (collection === "connections") return [];
        return [];
      },
      async update() {
        throw new Error("not expected");
      },
      async patchChatMetadata() {
        throw new Error("not expected");
      },
      async listChatMessages() {
        return [];
      },
    } as unknown as StorageGateway;

    await expect(
      maybeRefreshConversationStatusMessages(
        { storage, llm: llmReturning('{"message":"reading"}') },
        { chatId: "chat1", now },
      ),
    ).rejects.toThrow("status blurbs enabled but no usable connection");
  });

  it("throws when the resolved connection is missing a model", async () => {
    const seed = {
      chats: {
        chat1: {
          id: "chat1",
          mode: "conversation",
          connectionId: "conn1",
          characterIds: ["char1"],
          metadata: { conversationStatusMessagesEnabled: true },
        },
      },
      connections: {
        conn1: { id: "conn1" },
      },
      characters: {
        char1: {
          id: "char1",
          data: {
            name: "Ari",
            extensions: { conversationStatus: "online", conversationActivity: "free time" },
          },
        },
      },
    };

    await expect(
      maybeRefreshConversationStatusMessages(
        { storage: memoryStorage(seed), llm: llmReturning('{"message":"reading"}') },
        { chatId: "chat1", now },
      ),
    ).rejects.toThrow("status blurbs enabled but connection");
  });

  it("rejects storage failures while resolving the connection list", async () => {
    const storage = {
      async get(collection: string, id: string) {
        if (collection === "chats" && id === "chat1") {
          return {
            id: "chat1",
            mode: "conversation",
            characterIds: ["char1"],
            metadata: { conversationStatusMessagesEnabled: true },
          };
        }
        if (collection === "characters" && id === "char1") {
          return {
            id: "char1",
            data: {
              name: "Ari",
              extensions: { conversationStatus: "online", conversationActivity: "free time" },
            },
          };
        }
        return null;
      },
      async list() {
        throw new Error("storage unavailable");
      },
      async update() {
        throw new Error("not expected");
      },
      async patchChatMetadata() {
        throw new Error("not expected");
      },
      async listChatMessages() {
        return [];
      },
    } as unknown as StorageGateway;

    await expect(
      maybeRefreshConversationStatusMessages(
        { storage, llm: llmReturning('{"message":"reading"}') },
        { chatId: "chat1", now },
      ),
    ).rejects.toThrow("storage unavailable");
  });
});
