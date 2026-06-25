import { describe, expect, it } from "vitest";

import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../../capabilities/storage";
import { concludeRoleplayScene } from "./scene-service";

type JsonRecord = Record<string, unknown>;

function storageForScene(args: {
  chats: JsonRecord[];
  messages: Record<string, JsonRecord[]>;
  connections?: JsonRecord[];
}): { storage: StorageGateway; createdMessages: Array<{ chatId: string; value: JsonRecord }> } {
  const chats = new Map(args.chats.map((chat) => [String(chat.id), { ...chat }]));
  const messages = new Map(
    Object.entries(args.messages).map(([chatId, rows]) => [chatId, rows.map((row) => ({ ...row }))]),
  );
  const createdMessages: Array<{ chatId: string; value: JsonRecord }> = [];

  const storage = {
    async get<T>(entity: StorageEntity, id: string) {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "characters") return null as T | null;
      return null as T | null;
    },
    async list<T>(entity: StorageEntity) {
      if (entity === "connections") return (args.connections ?? []) as T[];
      if (entity === "personas") return [] as T[];
      if (entity === "background-metadata") return [] as T[];
      return [] as T[];
    },
    async update<T>(entity: StorageEntity, id: string, patch: JsonRecord) {
      if (entity === "chats") {
        const current = chats.get(id) ?? { id };
        const next = { ...current, ...patch };
        chats.set(id, next);
        return next as T;
      }
      return { id, ...patch } as T;
    },
    async create<T>(_entity: StorageEntity, value: JsonRecord) {
      return { id: `created-${createdMessages.length + 1}`, ...value } as T;
    },
    async delete() {
      return { deleted: true };
    },
    async listChatMessages<T>(chatId: string) {
      return (messages.get(chatId) ?? []) as T[];
    },
    async createChatMessage<T>(chatId: string, value: JsonRecord) {
      createdMessages.push({ chatId, value });
      return { id: `message-${createdMessages.length}`, chatId, ...value } as T;
    },
    async patchChatMetadata<T>(chatId: string, patch: JsonRecord) {
      const current = chats.get(chatId) ?? { id: chatId };
      const metadata = { ...(current.metadata as JsonRecord | undefined), ...patch };
      const next = { ...current, metadata };
      chats.set(chatId, next);
      return next as T;
    },
    async patchChatSummaries<T>(_chatId: string, patch: JsonRecord) {
      return patch as T;
    },
    async getChatMessage<T>() {
      return null as T | null;
    },
    async updateChatMessage<T>(_messageId: string, patch: JsonRecord) {
      return patch as T;
    },
    async deleteChatMessage() {
      return { deleted: true };
    },
    async patchChatMessageExtra<T>(_messageId: string, patch: JsonRecord) {
      return patch as T;
    },
    async addChatMessageSwipe<T>(_chatId: string, _messageId: string, content: string) {
      return { content } as T;
    },
    async listChatMemories<T>() {
      return [] as T[];
    },
    async getWorldState<T>() {
      return null as T | null;
    },
    async saveTrackerSnapshot<T>(_chatId: string, snapshot: JsonRecord) {
      return snapshot as T;
    },
    async listLorebookEntries<T>() {
      return [] as T[];
    },
    async createLorebookEntries<T>() {
      return [] as T[];
    },
  } as unknown as StorageGateway;

  return { storage, createdMessages };
}

const idleLlm: LlmGateway = {
  async complete() {
    throw new Error("No model configured");
  },
  async *stream() {
    yield { type: "done" };
  },
  async listModels() {
    return [];
  },
};

describe("roleplay scene conclusion summaries", () => {
  it("uses clean prose for the no-LLM fallback instead of raw role-prefixed transcript slices", async () => {
    const longSceneBeat = [
      "Pulled from the safety of your screen and into the damp woods, you stand before the towering Trapper.",
      "His cleaver scrapes across nearby stone while he watches you decide whether to run or keep your promise.",
      "You steady your hands and choose to address the bleeding wounds at his shoulder.",
      "He does not strike. Not yet. He waits in the cold fog.",
    ].join(" ");
    const { storage, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Trapper", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: The Fog Claims You",
          mode: "roleplay",
          characterIds: [],
          metadata: {
            sceneOriginChatId: "origin",
            sceneDescription: "A dangerous meeting in the MacMillan Estate.",
            sceneStatus: "active",
          },
        },
      ],
      messages: {
        scene: [
          {
            id: "guide",
            role: "narrator",
            content: "You can cower, try to run, or stand your ground.",
          },
          { id: "opening", role: "assistant", content: longSceneBeat },
        ],
      },
    });

    const result = await concludeRoleplayScene({ storage, llm: idleLlm }, { sceneChatId: "scene" });
    const returnMessage = createdMessages.find((message) => message.chatId === "origin")?.value.content;

    expect(result.summary).not.toMatch(/\b(?:assistant|narrator|user):/i);
    expect(result.summary).toContain("A dangerous meeting in the MacMillan Estate.");
    expect(result.summary).toContain("Recent scene beats:");
    expect(result.summary).toMatch(/[.!?]$/);
    expect(returnMessage).toContain('The scene "The Fog Claims You" concluded.');
    expect(returnMessage).not.toMatch(/\b(?:assistant|narrator|user):/i);
  });

  it("removes accidental speaker labels from model-returned summaries", async () => {
    const { storage } = storageForScene({
      chats: [
        { id: "origin", name: "Trapper", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: The Fog Claims You",
          mode: "roleplay",
          characterIds: [],
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main" }],
      messages: {
        scene: [{ id: "opening", role: "assistant", content: "The Trapper waits in the fog." }],
      },
    });
    const llm: LlmGateway = {
      async complete() {
        return "Assistant: The Trapper waited in the fog while the persona held their ground.";
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    const result = await concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" });

    expect(result.summary).toBe("The Trapper waited in the fog while the persona held their ground.");
  });
});
