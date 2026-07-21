import { describe, expect, it } from "vitest";

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
});
