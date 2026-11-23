import { describe, expect, it } from "vitest";

import bundled from "../../../src-tauri/resources/default-data/db/default-preset-v2.json";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

const PRESET_ID = "preset_universal_v2";
const SHORT = "under 150 words unless a sentence needs a little room to land";

type Row = Record<string, unknown>;
const data = (bundled as { data: { preset: Row; sections: Row[]; groups: Row[]; choiceBlocks: Row[] } }).data;

function storage(): StorageGateway {
  const rows: Partial<Record<StorageEntity, Row[]>> = {
    prompts: [data.preset],
    "prompt-sections": data.sections,
    "prompt-groups": data.groups,
    "prompt-variables": data.choiceBlocks,
  };
  const none = async () => [];
  const empty = async <T>() => ({}) as T;
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      return (rows[entity] ?? []) as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && id === "mira") {
        return { id: "mira", data: { name: "Mira", description: "A careful archivist." } } as T;
      }
      return ((rows[entity] ?? []).find((row) => row.id === id) ?? null) as T | null;
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
    listChatMessages: none,
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
    patchChatMessageExtra: empty,
    addChatMessageSwipe: empty,
    patchChatMetadata: empty,
    patchChatSummaries: empty,
    listChatMemories: none,
    async getWorldState() {
      return null;
    },
    saveTrackerSnapshot: empty,
    listLorebookEntries: none,
    listLorebookEntriesByLorebookIds: none,
  } as unknown as StorageGateway;
}

describe("universal preset length reminder", () => {
  it("ends the prompt with the chat's chosen length as the player's own note", async () => {
    const assembled = await assembleGenerationPrompt(storage(), {
      chat: {
        id: "chat-length",
        mode: "roleplay",
        characterIds: ["mira"],
        promptPresetId: PRESET_ID,
        metadata: { presetChoices: { length: SHORT } },
      },
      storedMessages: [
        { id: "u1", role: "user", content: "I open the archive." },
        { id: "a1", role: "assistant", content: "Mira looks up." },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "Explain the ledger to me.",
    });

    const last = assembled.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain(`(OOC: reply length: ${SHORT}. Treat it as a hard limit`);
    const text = assembled.messages.map((message) => message.content).join("\n");
    expect(text).not.toContain("{{length}}");
    // It comes after the output checklist, so it is the last thing the model reads.
    const discipline = assembled.messages.findIndex((message) =>
      message.content.includes("Before writing, silently check"),
    );
    expect(discipline).toBeGreaterThanOrEqual(0);
    expect(discipline).toBeLessThan(assembled.messages.length - 1);
  });
});
