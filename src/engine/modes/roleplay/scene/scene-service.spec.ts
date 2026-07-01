import { describe, expect, it } from "vitest";

import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../../capabilities/storage";
import { concludeRoleplayScene, createRoleplayScene, reopenRoleplayScene } from "./scene-service";

type JsonRecord = Record<string, unknown>;

function storageForScene(args: {
  chats: JsonRecord[];
  messages: Record<string, JsonRecord[]>;
  connections?: JsonRecord[];
}): {
  storage: StorageGateway;
  createdRecords: Array<{ entity: StorageEntity; value: JsonRecord }>;
  createdMessages: Array<{ chatId: string; value: JsonRecord }>;
} {
  const chats = new Map(args.chats.map((chat) => [String(chat.id), { ...chat }]));
  const messages = new Map(
    Object.entries(args.messages).map(([chatId, rows]) => [chatId, rows.map((row) => ({ ...row }))]),
  );
  const createdRecords: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
  const createdMessages: Array<{ chatId: string; value: JsonRecord }> = [];

  const storage = {
    async get<T>(entity: StorageEntity, id: string) {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "prompts" && id === "preset_universal_v2") return { id, name: "De-Koi Universal Preset V2" } as T;
      if (entity === "characters") return null as T | null;
      return null as T | null;
    },
    async list<T>(entity: StorageEntity) {
      if (entity === "connections") return (args.connections ?? []) as T[];
      if (entity === "personas") return [] as T[];
      if (entity === "background-metadata") return [] as T[];
      if (entity === "prompt-variables") {
        return [
          {
            variableName: "contentBoundary",
            options: [
              { id: "boundary_sfw", value: "Keep the scene SFW." },
              { id: "boundary_mature_dark", value: "Adult dark fiction is allowed." },
              { id: "boundary_explicit_adult_safe", value: "Explicit adult content may appear only with consent." },
            ],
          },
          {
            variableName: "eroticTone",
            options: [
              { id: "erotic_tone_none", value: "no erotic tone preference" },
              { id: "erotic_tone_filthy", value: "filthy erotic tone" },
            ],
          },
          {
            variableName: "narration",
            options: [
              { id: "narration_second", value: "second-person" },
              { id: "narration_third", value: "third-person" },
            ],
          },
        ] as T[];
      }
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
    async create<T>(entity: StorageEntity, value: JsonRecord) {
      if (entity === "chats" && value.mode === "roleplay" && value.folderId === "conversation-folder") {
        throw new Error("Chat folder conversation-folder is for conversation chats, not roleplay chats");
      }
      createdRecords.push({ entity, value });
      return { id: "created-" + createdRecords.length, ...value } as T;
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

  return { storage, createdRecords, createdMessages };
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

describe("createRoleplayScene", () => {
  const basePlan = {
    name: "Scene: Dinner",
    description: "The dinner turns dramatic.",
    scenario: "A tense dinner scene.",
    firstMessage: "The room goes quiet.",
    background: null,
    characterIds: ["char-1"],
    systemPrompt: "Keep the roleplay grounded.",
    rating: "sfw" as const,
    relationshipHistory: "They were talking over dinner.",
    participationGuide: "",
  };

  async function createSceneFromOrigin(origin: JsonRecord) {
    const fixture = storageForScene({
      chats: [
        {
          id: "origin",
          name: "Dinner Chat",
          characterIds: ["char-1"],
          metadata: {},
          ...origin,
        },
      ],
      messages: {
        origin: [{ id: "message-1", role: "user", content: "Let this become a focused scene." }],
      },
    });

    const create = createRoleplayScene(fixture.storage, {
      originChatId: "origin",
      initiatorCharId: null,
      connectionId: null,
      plan: basePlan,
    });

    return { ...fixture, create };
  }

  it("does not place a branched roleplay scene in the origin conversation folder", async () => {
    const { create, createdRecords } = await createSceneFromOrigin({
      mode: "conversation",
      folderId: "conversation-folder",
    });

    await expect(create).resolves.toMatchObject({ chatId: "created-1", chatName: "Scene: Dinner" });

    const createdScene = createdRecords.find((record) => record.entity === "chats")?.value;
    expect(createdScene).toMatchObject({ mode: "roleplay" });
    expect(createdScene).not.toHaveProperty("folderId", "conversation-folder");
  });

  it("starts spawned scenes on the De-Koi Universal preset with inferred choices", async () => {
    const { storage, createdRecords } = storageForScene({
      chats: [
        {
          id: "origin",
          name: "Dinner Chat",
          mode: "conversation",
          characterIds: ["char-1"],
          metadata: {},
        },
      ],
      messages: {
        origin: [{ id: "message-1", role: "user", content: "Make this explicit and filthy." }],
      },
    });

    await createRoleplayScene(storage, {
      originChatId: "origin",
      initiatorCharId: null,
      connectionId: null,
      plan: {
        ...basePlan,
        description: "The dinner becomes explicitly sexual.",
        scenario: "The scene heads in a filthy adult direction.",
        rating: "nsfw",
        relationshipHistory: "They were flirting over dinner.",
      },
    });

    const createdScene = createdRecords.find((record) => record.entity === "chats")?.value;
    expect(createdScene).toMatchObject({
      mode: "roleplay",
      promptPresetId: "preset_universal_v2",
      metadata: {
        sceneUniversalPresetId: "preset_universal_v2",
        presetChoices: {
          contentBoundary: "Adult dark fiction is allowed.",
          eroticTone: "filthy erotic tone",
          narration: "second-person",
        },
      },
    });
  });

  it.each([
    ["roleplay", "roleplay-folder"],
    ["visual_novel", "legacy-roleplay-folder"],
  ])("inherits a roleplay-compatible folder from %s origins", async (mode, folderId) => {
    const { create, createdRecords } = await createSceneFromOrigin({ mode, folderId });

    await expect(create).resolves.toMatchObject({ chatId: "created-1" });

    const createdScene = createdRecords.find((record) => record.entity === "chats")?.value;
    expect(createdScene).toMatchObject({ mode: "roleplay", folderId });
  });

  it.each([
    ["missing mode", {}],
    ["blank mode", { mode: "   " }],
    ["typo mode", { mode: "chat" }],
  ])("rejects %s instead of silently creating an unfiled scene", async (_label, origin) => {
    const { create, createdRecords } = await createSceneFromOrigin({
      folderId: "conversation-folder",
      ...origin,
    });

    await expect(create).rejects.toThrow("Cannot create roleplay scene from chat mode");
    expect(createdRecords).toHaveLength(0);
  });
});
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

describe("reopenRoleplayScene", () => {
  it("restores a concluded scene as the active scene on its origin conversation", async () => {
    const { storage } = storageForScene({
      chats: [
        {
          id: "origin-1",
          connectedChatId: null,
          metadata: { activeSceneChatId: null, sceneBusyCharIds: null },
        },
        {
          id: "scene-1",
          connectedChatId: null,
          characterIds: ["char-1", "char-2"],
          metadata: { sceneOriginChatId: "origin-1", sceneStatus: "concluded" },
        },
      ],
      messages: {},
    });

    const result = await reopenRoleplayScene(storage, { sceneChatId: "scene-1" });

    expect(result).toEqual({ originChatId: "origin-1" });
    await expect(storage.get("chats", "scene-1")).resolves.toMatchObject({
      connectedChatId: "origin-1",
      metadata: { sceneStatus: "active" },
    });
    await expect(storage.get("chats", "origin-1")).resolves.toMatchObject({
      connectedChatId: "scene-1",
      metadata: {
        activeSceneChatId: "scene-1",
        sceneBusyCharIds: ["char-1", "char-2"],
      },
    });
  });

  it("does not replace another active scene on the origin conversation", async () => {
    const { storage } = storageForScene({
      chats: [
        {
          id: "origin-1",
          connectedChatId: "scene-2",
          metadata: { activeSceneChatId: "scene-2", sceneBusyCharIds: ["char-3"] },
        },
        {
          id: "scene-1",
          connectedChatId: null,
          characterIds: ["char-1"],
          metadata: { sceneOriginChatId: "origin-1", sceneStatus: "concluded" },
        },
      ],
      messages: {},
    });

    await expect(reopenRoleplayScene(storage, { sceneChatId: "scene-1" })).rejects.toThrow(
      "The origin conversation already has another active scene",
    );

    await expect(storage.get("chats", "origin-1")).resolves.toMatchObject({
      connectedChatId: "scene-2",
      metadata: { activeSceneChatId: "scene-2", sceneBusyCharIds: ["char-3"] },
    });
  });
});
