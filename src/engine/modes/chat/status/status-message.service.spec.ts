import { describe, expect, it } from "vitest";

import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
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
    async list(collection: string) {
      return Object.values(seed[collection] ?? {}) as never;
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
    async listChatMessages() {
      return [] as never;
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
      { storage, llm: llmReturning("{\"message\":\"reading\"}") },
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
      { storage, llm: llmReturning("{\"message\":\"reading\"}") },
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
        llm: llmReturning('{"message":"\"  quietly   reading\nby the window with coffee and notes that stretch past the safety cap while waiting for the rain to ease and the room to settle into silence  \""}'),
      },
      { chatId: "chat1", now: new Date("2026-06-26T12:00:00.000Z") },
    );

    const extensions = (seed.characters.char1.data as Row).extensions as Row;
    const message = extensions.conversationStatusMessage as string;
    expect(message).toHaveLength(96);
    expect(message).toContain('quietly reading by the window with coffee and notes');
    expect(message).not.toMatch(/^['"`]|['"`]$/);
    expect(message).not.toContain("\n");
    expect(message).not.toMatch(/\s{2,}/);
    expect(extensions.conversationStatusMessageMeta).toMatchObject({
      generatedAt: "2026-06-26T12:00:00.000Z",
      sourceStatus: "online",
      sourceActivity: "free time",
    });
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
      maybeRefreshConversationStatusMessages({ storage, llm: llmReturning('{"message":"reading"}') }, { chatId: "chat1", now }),
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
      maybeRefreshConversationStatusMessages({ storage, llm: llmReturning('{"message":"reading"}') }, { chatId: "chat1", now }),
    ).rejects.toThrow("storage unavailable");
  });
});
