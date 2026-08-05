import { describe, expect, it, vi } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("assembleGenerationPrompt prerequisite reads", () => {
  it("starts immutable character, persona, and preset reads before any one resolves", async () => {
    const character = deferred<Record<string, unknown> | null>();
    const persona = deferred<Record<string, unknown> | null>();
    const prompts = deferred<Record<string, unknown>[]>();
    const starts: string[] = [];
    const storage = {
      async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
        if (entity === "prompts") {
          starts.push("preset");
          return (await prompts.promise) as T[];
        }
        return [] as T[];
      },
      async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
        if (entity === "characters" && id === "mira") {
          starts.push("character");
          return (await character.promise) as T | null;
        }
        if (entity === "personas" && id === "player") {
          starts.push("persona");
          return (await persona.promise) as T | null;
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
      async listChatMemories<T = unknown>() {
        return [] as T[];
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
    } as StorageGateway;

    const assembly = assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "conversation",
        characterIds: ["mira"],
        personaId: "player",
        metadata: { enableMemoryRecall: false },
      },
      storedMessages: [{ id: "user-1", role: "user", content: "Hello." }],
      connection: {},
      request: {},
      latestUserInput: "Hello.",
    });

    await Promise.resolve();
    expect(starts).toEqual(["character", "persona", "preset"]);

    character.resolve({ id: "mira", data: { name: "Mira", description: "A patient guide." } });
    persona.resolve({ id: "player", data: { name: "Player" } });
    prompts.resolve([]);

    await expect(assembly).resolves.toMatchObject({
      characters: [expect.objectContaining({ id: "mira", name: "Mira" })],
      persona: expect.objectContaining({ name: "Player" }),
    });
  });

  it("starts regex, linked-chat, and cross-chat reads together", async () => {
    const linkedChat = deferred<Record<string, unknown> | null>();
    const siblingContext = deferred<Array<{ chat: Record<string, unknown>; messages: Record<string, unknown>[] }>>();
    const regexScripts = deferred<Record<string, unknown>[]>();
    const starts: string[] = [];
    const storage = {
      async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
        if (entity === "regex-scripts") {
          starts.push("regex");
          return (await regexScripts.promise) as T[];
        }
        return [] as T[];
      },
      async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
        if (entity === "characters" && id === "mira") {
          return { id: "mira", data: { name: "Mira", description: "A patient guide." } } as T;
        }
        if (entity === "chats" && id === "linked-scene") {
          starts.push("linked");
          return (await linkedChat.promise) as T | null;
        }
        return null;
      },
      async listSiblingConversationContext<T = unknown>(): Promise<T[]> {
        starts.push("cross-chat");
        return (await siblingContext.promise) as T[];
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
      async listChatMemories<T = unknown>() {
        return [] as T[];
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
    } as StorageGateway;

    const assembly = assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "conversation",
        characterIds: ["mira"],
        connectedChatId: "linked-scene",
        metadata: { crossChatAwareness: true, enableMemoryRecall: false },
      },
      storedMessages: [{ id: "user-1", role: "user", content: "Hello." }],
      connection: {},
      request: {},
      latestUserInput: "Hello.",
    });

    await vi.waitFor(() => {
      expect(new Set(starts)).toEqual(new Set(["regex", "linked", "cross-chat"]));
    });

    regexScripts.resolve([]);
    linkedChat.resolve({ id: "linked-scene", mode: "roleplay", name: "The Library" });
    siblingContext.resolve([]);

    await expect(assembly).resolves.toMatchObject({
      characters: [expect.objectContaining({ id: "mira", name: "Mira" })],
    });
  });
});
