import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { ChatMessageListOptions, StorageEntity, StorageGateway } from "../../../capabilities/storage";
import type { CanonicalMemoryInput } from "../../../contracts/types/memory";
import {
  abandonRoleplayScene,
  concludeRoleplayScene,
  createRoleplayScene,
  forkRoleplayScene,
  planRoleplayScene,
  reopenRoleplayScene,
} from "./scene-service";

type JsonRecord = Record<string, unknown>;

function storageForScene(args: {
  chats: JsonRecord[];
  messages: Record<string, JsonRecord[]>;
  connections?: JsonRecord[];
  characters?: JsonRecord[];
  failStoryArcCreate?: boolean;
  failStoryFollowUpCreate?: boolean;
}): {
  storage: StorageGateway;
  createdRecords: Array<{ entity: StorageEntity; value: JsonRecord }>;
  createdMessages: Array<{ chatId: string; value: JsonRecord }>;
  messageReads: Array<{ chatId: string; options?: ChatMessageListOptions }>;
  deletedRecords: Array<{ entity: StorageEntity; id: string }>;
  deletedMessages: string[];
  bulkDeletedMessageBatches: Array<{ chatId: string; messageIds: string[] }>;
} {
  const chats = new Map(args.chats.map((chat) => [String(chat.id), { ...chat }]));
  const characters = new Map((args.characters ?? []).map((character) => [String(character.id), { ...character }]));
  const messages = new Map(
    Object.entries(args.messages).map(([chatId, rows]) => [chatId, rows.map((row) => ({ ...row }))]),
  );
  const createdRecords: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
  const createdMessages: Array<{ chatId: string; value: JsonRecord }> = [];
  const messageReads: Array<{ chatId: string; options?: ChatMessageListOptions }> = [];
  const deletedRecords: Array<{ entity: StorageEntity; id: string }> = [];
  const deletedMessages: string[] = [];
  const bulkDeletedMessageBatches: Array<{ chatId: string; messageIds: string[] }> = [];
  const storage = {
    async get<T>(entity: StorageEntity, id: string) {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "connections") {
        return ((args.connections ?? []).find((connection) => connection.id === id) ?? null) as T | null;
      }
      if (entity === "characters") return (characters.get(id) ?? null) as T | null;
      if (entity === "prompts" && id === "preset_universal_v2") return { id, name: "De-Koi Universal Preset V2" } as T;
      const created = createdRecords.find((record) => record.entity === entity && record.value.id === id);
      if (created) return created.value as T;
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
              {
                id: "boundary_sfw",
                value:
                  "Keep sexual content non-explicit or fade to black. This setting does not limit genre, danger, violence, emotional intensity, character morality, or consequences.",
              },
              {
                id: "boundary_mature_dark",
                value:
                  "Adult explicit content is permitted. Keep explicit sexual content limited to fictional adults; exclude minors and real-world sexualization.",
              },
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
      if (entity === "story-consolidation-jobs") {
        return createdRecords
          .filter((record) => record.entity === entity)
          .map((record) => record.value) as T[];
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
      if (entity === "characters") {
        const current = characters.get(id) ?? { id };
        const next = { ...current, ...patch };
        characters.set(id, next);
        return next as T;
      }
      const created = createdRecords.find((record) => record.entity === entity && record.value.id === id);
      if (created) {
        created.value = { ...created.value, ...patch };
        return created.value as T;
      }
      return { id, ...patch } as T;
    },
    async create<T>(entity: StorageEntity, value: JsonRecord) {
      if (entity === "chats" && value.mode === "roleplay" && value.folderId === "conversation-folder") {
        throw new Error("Chat folder conversation-folder is for conversation chats, not roleplay chats");
      }
      if (args.failStoryArcCreate && entity === "story-consolidation-jobs" && value.level === "arc") {
        throw new Error("temporary arc enqueue failure");
      }
      if (args.failStoryFollowUpCreate && entity === "story-consolidation-jobs" && value.followUp === "arc_enqueue") {
        throw new Error("follow-up write failed");
      }
      createdRecords.push({ entity, value });
      return { id: "created-" + createdRecords.length, ...value } as T;
    },
    async delete(entity: StorageEntity, id: string) {
      deletedRecords.push({ entity, id });
      return { deleted: true };
    },
    async listChatMessages<T>(chatId: string, options?: ChatMessageListOptions) {
      messageReads.push({ chatId, options });
      const rows = messages.get(chatId) ?? [];
      return (typeof options?.limit === "number" ? rows.slice(-options.limit) : rows) as T[];
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
    async deleteChatMessage(messageId: string) {
      deletedMessages.push(messageId);
      return { deleted: true };
    },
    async bulkDeleteChatMessages(chatId: string, messageIds: string[]) {
      bulkDeletedMessageBatches.push({ chatId, messageIds });
      return { deleted: messageIds.length };
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
    async queryMemories() {
      return createdRecords
        .filter((record) => record.entity === "canonical-memories")
        .map((record, index) => ({ id: `canonical-${index + 1}`, ...record.value })) as never[];
    },
    async createMemory<T>(value: JsonRecord) {
      createdRecords.push({ entity: "canonical-memories" as StorageEntity, value });
      return value as T;
    },
    async rebuildMemoryIndex() {
      return { rebuilt: 1 };
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

  return {
    storage,
    createdRecords,
    createdMessages,
    messageReads,
    deletedRecords,
    deletedMessages,
    bulkDeletedMessageBatches,
  };
}

function llmWithResponse(response: string): LlmGateway {
  return {
    complete: async () => response,
    stream: async function* () {},
    listModels: async () => [],
  } as unknown as LlmGateway;
}

function priorSceneEpisode(index: number): CanonicalMemoryInput {
  const first = index * 2 - 1;
  return {
    id: `prior-episode-${index}`,
    kind: "episode",
    status: "active",
    scope: { kind: "chat", id: "origin" },
    title: `Prior episode ${index}`,
    content: `Prior episode ${index} summary.`,
    confidence: 0.9,
    provenance: { sourceChatId: "origin", messageIds: [`prior-message-${first}`, `prior-message-${first + 1}`] },
    tags: ["story-continuity", "episode"],
    payload: {
      storyProjectionVersion: 1,
      level: "episode",
      ownerChatId: "origin",
      coverageId: `prior-coverage-${index}`,
      sourceFingerprint: `prior-fingerprint-${index}`,
      messageIds: [`prior-message-${first}`, `prior-message-${first + 1}`],
      sourceMessages: [{
        id: `prior-message-${first}`,
        role: "user",
        content: `Prior story beat ${first}.`,
        createdAt: `2026-08-27T0${index - 1}:00:00.000Z`,
      }],
      firstMessageId: `prior-message-${first}`,
      lastMessageId: `prior-message-${first + 1}`,
      sourceEpisodeIds: [],
      sections: {
        events: [],
        choices: [],
        relationshipShifts: [],
        promises: [],
        reveals: [],
        unresolvedHooks: [],
        currentState: [],
      },
      summarizer: { version: "story-projection-v1", completedAt: `2026-08-27T0${index - 1}:00:00.000Z` },
    },
    createdAt: `2026-08-27T0${index - 1}:00:00.000Z`,
    updatedAt: `2026-08-27T0${index - 1}:00:00.000Z`,
  };
}

describe("roleplay scene recent history", () => {
  it("bounds scene planning recent conversation reads", async () => {
    const plan = {
      name: "Scene: Mirror Hall",
      description: "A focused mirror hall scene.",
      scenario: "The mirror hall answers.",
      firstMessage: "The reflection moves first.",
      background: null,
      characterIds: [],
      systemPrompt: "Keep continuity.",
      rating: "sfw",
      relationshipHistory: "Recent trust.",
      participationGuide: "Take turns.",
      presetChoices: {},
    };
    const { storage, messageReads } = storageForScene({
      chats: [{ id: "chat-1", connectionId: "conn-1", characterIds: [], metadata: {} }],
      messages: {
        "chat-1": Array.from({ length: 40 }, (_, index) => ({
          id: `message-${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          content: `line ${index}`,
        })),
      },
      connections: [{ id: "conn-1" }],
    });

    await planRoleplayScene(
      { storage, llm: llmWithResponse(JSON.stringify(plan)) },
      { chatId: "chat-1", prompt: "", connectionId: null },
    );

    expect(messageReads.map((read) => read.options?.limit)).toEqual([8, 20]);
  });

  it("does not let planner preset choices override explicit adult-scene inference", async () => {
    const { storage, createdRecords } = storageForScene({
      chats: [{ id: "chat-1", connectionId: "conn-1", characterIds: [], metadata: {}, mode: "conversation" }],
      messages: {
        "chat-1": [{ id: "message-1", role: "user", content: "Make this an absolutely filthy explicit scene." }],
      },
      connections: [{ id: "conn-1" }],
    });
    const response = await planRoleplayScene(
      {
        storage,
        llm: llmWithResponse(
          JSON.stringify({
            name: "Scene: Private Room",
            description: "An explicitly sexual encounter.",
            scenario: "The adults continue in a filthy direction.",
            firstMessage: "The door closes.",
            background: null,
            characterIds: [],
            systemPrompt: "Keep the character voice sharp.",
            rating: "nsfw",
            relationshipHistory: "They explicitly invited each other.",
            participationGuide: "",
            presetChoices: {
              contentBoundary: "boundary_explicit_adult_safe",
              eroticTone: "erotic_tone_filthy",
            },
          }),
        ),
      },
      { chatId: "chat-1", prompt: "an absolutely filthy smut scene", connectionId: null },
    );
    if (!response.plan) throw new Error(response.error || "Expected scene planning to succeed");

    await createRoleplayScene(storage, {
      originChatId: "chat-1",
      initiatorCharId: null,
      connectionId: null,
      plan: response.plan,
    });

    expect(response.plan.presetChoices).toBeUndefined();
    const createdScene = createdRecords.find((record) => record.entity === "chats")?.value;
    expect(createdScene).toMatchObject({
      metadata: {
        presetChoices: {
          contentBoundary:
            "Adult explicit content is permitted. Keep explicit sexual content limited to fictional adults; exclude minors and real-world sexualization.",
          eroticTone: "filthy erotic tone",
        },
      },
    });
  });

  it("keeps non-explicit scenes genre-neutral instead of softening the fiction", async () => {
    const { storage, createdRecords } = storageForScene({
      chats: [{ id: "chat-1", connectionId: "conn-1", characterIds: [], metadata: {}, mode: "conversation" }],
      messages: {
        "chat-1": [{ id: "message-1", role: "user", content: "Start the political betrayal scene." }],
      },
      connections: [{ id: "conn-1" }],
    });
    const response = await planRoleplayScene(
      {
        storage,
        llm: llmWithResponse(
          JSON.stringify({
            name: "Scene: Broken Alliance",
            description: "An ally carries out a ruthless betrayal.",
            scenario: "The alliance collapses under the consequences of the betrayal.",
            firstMessage: "The sealed orders land on the table.",
            background: null,
            characterIds: [],
            systemPrompt: "Keep the character motives intact.",
            rating: "sfw",
            relationshipHistory: "Their trust has been eroding.",
            participationGuide: "",
          }),
        ),
      },
      { chatId: "chat-1", prompt: "a ruthless political betrayal", connectionId: null },
    );
    if (!response.plan) throw new Error(response.error || "Expected scene planning to succeed");

    await createRoleplayScene(storage, {
      originChatId: "chat-1",
      initiatorCharId: null,
      connectionId: null,
      plan: response.plan,
    });

    const createdScene = createdRecords.find((record) => record.entity === "chats")?.value;
    expect(createdScene).toMatchObject({
      metadata: {
        presetChoices: {
          contentBoundary:
            "Keep sexual content non-explicit or fade to black. This setting does not limit genre, danger, violence, emotional intensity, character morality, or consequences.",
        },
      },
    });
  });

  it("normalizes double-escaped planner line breaks before persistence", async () => {
    const { storage, createdMessages } = storageForScene({
      chats: [{ id: "chat-1", connectionId: "conn-1", characterIds: [], metadata: {}, mode: "conversation" }],
      messages: { "chat-1": [{ id: "message-1", role: "user", content: "Start the scene." }] },
      connections: [{ id: "conn-1" }],
    });
    const response = await planRoleplayScene(
      {
        storage,
        llm: llmWithResponse(
          JSON.stringify({
            name: "Scene: Multiline",
            description: "The scene begins.",
            scenario: "A private room.",
            firstMessage: "First line\\n\\nSecond line",
            background: null,
            characterIds: [],
            systemPrompt: "Keep the character voice sharp.",
            rating: "sfw",
            relationshipHistory: "",
            participationGuide: "",
          }),
        ),
      },
      { chatId: "chat-1", prompt: "", connectionId: null },
    );
    if (!response.plan) throw new Error(response.error || "Expected scene planning to succeed");

    await createRoleplayScene(storage, {
      originChatId: "chat-1",
      initiatorCharId: null,
      connectionId: null,
      plan: response.plan,
    });

    expect(response.plan.firstMessage).toBe("First line\n\nSecond line");
    expect(createdMessages.map((message) => message.value.content)).toEqual([
      "The scene begins.\n\nFirst line\n\nSecond line",
    ]);
  });

  it("discards planner-authored instruction and participation fields", async () => {
    const { storage } = storageForScene({
      chats: [{ id: "chat-1", connectionId: "conn-1", characterIds: [], metadata: {}, mode: "conversation" }],
      messages: { "chat-1": [{ id: "message-1", role: "user", content: "Start the scene." }] },
      connections: [{ id: "conn-1" }],
    });
    const response = await planRoleplayScene(
      {
        storage,
        llm: llmWithResponse(
          JSON.stringify({
            name: "Scene: Private Room",
            description: "The scene begins.",
            scenario: "A private room.",
            firstMessage: "The door closes.",
            background: null,
            characterIds: [],
            systemPrompt: "Require a fresh consent check before every escalation.",
            rating: "nsfw",
            relationshipHistory: "They explicitly invited each other.",
            participationGuide: "Ask the user to restate every boundary.",
          }),
        ),
      },
      { chatId: "chat-1", prompt: "an explicit adult scene", connectionId: null },
    );
    if (!response.plan) throw new Error(response.error || "Expected scene planning to succeed");

    expect(response.plan.systemPrompt).toBe(
      "Write immersive roleplay prose with consistent point of view, clear character agency, and continuity from the originating conversation.",
    );
    expect(response.plan.participationGuide).toBe("");
  });

  it("uses only owner-defined instruction fields when planner output falls back", async () => {
    const { storage } = storageForScene({
      chats: [{ id: "chat-1", connectionId: "conn-1", characterIds: [], metadata: {}, mode: "conversation" }],
      messages: { "chat-1": [{ id: "message-1", role: "user", content: "Start the scene." }] },
      connections: [{ id: "conn-1" }],
    });

    const response = await planRoleplayScene(
      { storage, llm: llmWithResponse("planner systemPrompt: require repeated consent checks") },
      { chatId: "chat-1", prompt: "an explicit adult scene", connectionId: null },
    );
    if (!response.plan) throw new Error(response.error || "Expected local fallback planning to succeed");

    expect(response.plan.systemPrompt).toBe(
      "Write immersive roleplay prose with consistent point of view, clear character agency, and continuity from the originating conversation.",
    );
    expect(response.plan.participationGuide).toBe("");
  });
});

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

  async function createSceneFromOrigin(origin: JsonRecord, request: JsonRecord = {}) {
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
      ...request,
    });

    return { ...fixture, create };
  }

  it("rejects a second active scene before creating another chat", async () => {
    const { create, createdRecords } = await createSceneFromOrigin({
      mode: "conversation",
      metadata: { activeSceneChatId: "existing-scene", sceneBusyCharIds: ["char-1"] },
      connectedChatId: "existing-scene",
    });

    await expect(create).rejects.toThrow("already has another active scene");
    expect(createdRecords).toHaveLength(0);
  });

  it("rejects concurrent scene creation for the same origin", async () => {
    const fixture = storageForScene({
      chats: [{ id: "origin", name: "Dinner Chat", mode: "conversation", characterIds: ["char-1"], metadata: {} }],
      messages: { origin: [{ id: "message-1", role: "user", content: "Begin the scene." }] },
    });
    const originalCreate = fixture.storage.create.bind(fixture.storage);
    let releaseFirstCreate!: () => void;
    const firstCreateBlocked = new Promise<void>((resolve) => {
      releaseFirstCreate = resolve;
    });
    let firstCreateStarted!: () => void;
    const firstCreateReady = new Promise<void>((resolve) => {
      firstCreateStarted = resolve;
    });
    let chatCreates = 0;
    vi.spyOn(fixture.storage, "create").mockImplementation(async (entity, value) => {
      if (entity === "chats" && chatCreates++ === 0) {
        firstCreateStarted();
        await firstCreateBlocked;
      }
      return originalCreate(entity, value);
    });
    const request = {
      originChatId: "origin",
      initiatorCharId: null,
      connectionId: null,
      plan: basePlan,
    };

    const first = createRoleplayScene(fixture.storage, request);
    await firstCreateReady;
    await expect(createRoleplayScene(fixture.storage, request)).rejects.toThrow(
      "scene creation is already in progress",
    );
    releaseFirstCreate();
    await expect(first).resolves.toMatchObject({ chatId: "created-1" });
    expect(fixture.createdRecords.filter((record) => record.entity === "chats")).toHaveLength(1);
  });

  it("removes the partial scene and origin links when opening-message creation fails", async () => {
    const fixture = await createSceneFromOrigin({ mode: "conversation" });
    vi.spyOn(fixture.storage, "createChatMessage").mockRejectedValue(new Error("opening write failed"));

    await expect(fixture.create).rejects.toThrow("opening write failed");

    expect(fixture.deletedRecords).toContainEqual({ entity: "chats", id: "created-1" });
    await expect(fixture.storage.get<JsonRecord>("chats", "origin")).resolves.toMatchObject({
      connectedChatId: null,
      metadata: { activeSceneChatId: null, sceneBusyCharIds: null },
    });
  });

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

  it("does not activate a background agent for a created scene", async () => {
    const { create, createdRecords } = await createSceneFromOrigin({
      mode: "conversation",
      folderId: "conversation-folder",
    });

    await create;

    const createdScene = createdRecords.find((record) => record.entity === "chats")?.value;
    expect(createdScene?.metadata).toMatchObject({ activeAgentIds: [] });
  });

  it("defers the planned opening when the caller will use the roleplay writer", async () => {
    const { create, createdMessages } = await createSceneFromOrigin(
      {
        mode: "conversation",
        folderId: "conversation-folder",
      },
      { openingMode: "generated" },
    );

    await create;

    expect(createdMessages).toEqual([]);
  });

  it("does not copy AI-hidden conclusion messages into a later scene's conversation context", async () => {
    const { storage, createdRecords } = storageForScene({
      chats: [{ id: "origin", name: "Dinner Chat", mode: "conversation", characterIds: ["char-1"], metadata: {} }],
      messages: {
        origin: [
          { id: "user-1", role: "user", content: "VISIBLE_USER_CONTEXT" },
          {
            id: "old-conclusion",
            role: "assistant",
            content: "HIDDEN_SCENE_CONCLUSION",
            extra: { hiddenFromAI: true, hiddenFromAi: true },
          },
          { id: "assistant-1", role: "assistant", content: "VISIBLE_ASSISTANT_CONTEXT" },
        ],
      },
    });

    await createRoleplayScene(storage, {
      originChatId: "origin",
      initiatorCharId: null,
      connectionId: null,
      plan: basePlan,
    });

    const createdScene = createdRecords.find((record) => record.entity === "chats")?.value;
    const context = String((createdScene?.metadata as JsonRecord | undefined)?.sceneConversationContext ?? "");
    expect(context).toContain("VISIBLE_USER_CONTEXT");
    expect(context).toContain("VISIBLE_ASSISTANT_CONTEXT");
    expect(context).not.toContain("HIDDEN_SCENE_CONCLUSION");
  });

  it("never auto-applies a library background from the scene plan", async () => {
    const { storage, createdRecords } = storageForScene({
      chats: [{ id: "origin", name: "Dinner Chat", mode: "conversation", characterIds: ["char-1"], metadata: {} }],
      messages: { origin: [{ id: "message-1", role: "user", content: "Begin the scene." }] },
    });

    await createRoleplayScene(
      storage,
      {
        originChatId: "origin",
        initiatorCharId: null,
        connectionId: null,
        plan: { ...basePlan, background: "castle.jpg" },
      },
      { listBackgrounds: async () => [{ filename: "castle.jpg" }] } as never,
    );

    const createdScene = createdRecords.find((record) => record.entity === "chats")?.value;
    expect((createdScene?.metadata as JsonRecord | undefined)?.sceneBackground).toBeNull();
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
          contentBoundary:
            "Adult explicit content is permitted. Keep explicit sexual content limited to fictional adults; exclude minors and real-world sexualization.",
          eroticTone: "filthy erotic tone",
          narration: "second-person",
        },
      },
    });
    const sceneSystemPrompt = String((createdScene?.metadata as JsonRecord | undefined)?.sceneSystemPrompt ?? "");
    expect(sceneSystemPrompt).toContain(
      "Follow the active preset, originating chat, and explicit scene request for narration and point of view",
    );
    expect(sceneSystemPrompt).not.toMatch(/keep narration in third person/i);
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
  it("stores one source-backed canonical episode from the same scene summary pass", async () => {
    const calls: LlmRequest[] = [];
    const { storage, createdRecords } = storageForScene({
      chats: [
        { id: "origin", name: "Origin", mode: "roleplay", metadata: { enableMemoryRecall: true } },
        {
          id: "scene",
          name: "Scene: The Archive",
          mode: "roleplay",
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main", provider: "openai", model: "model-1" }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: "Mara opens the flooded archive." },
          { id: "choice", role: "user", content: "She chooses to rescue the ledger." },
        ],
      },
    });
    const llm = {
      complete: vi.fn(async (request: LlmRequest) => {
        calls.push(request);
        if (calls.length === 1) return "Mara entered the flooded archive and chose to rescue the ledger.";
        return JSON.stringify({
          summary: "Mara entered the flooded archive and chose to rescue the ledger.",
          sections: {
            events: ["Mara entered the flooded archive."],
            choices: ["Mara chose to rescue the ledger."],
            relationshipShifts: [], promises: [], reveals: [], unresolvedHooks: [],
            currentState: ["Mara still holds the rescued ledger."],
          },
        });
      }),
      async *stream() {},
      async listModels() { return []; },
    } as LlmGateway;

    await concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" });

    expect(calls).toHaveLength(2);
    expect(createdRecords.filter((record) => record.entity === "canonical-memories")).toEqual([
      expect.objectContaining({
        value: expect.objectContaining({
          kind: "episode",
          scope: { kind: "chat", id: "origin" },
          provenance: expect.objectContaining({ sceneId: "scene", messageIds: ["opening", "choice"] }),
          payload: expect.objectContaining({
            level: "episode",
            boundaryReason: "scene_conclusion",
            sections: expect.objectContaining({
              choices: [expect.objectContaining({ text: "Mara chose to rescue the ledger.", sourceMessageIds: ["opening", "choice"] })],
            }),
            summarizer: expect.objectContaining({ provider: "openai", model: "model-1" }),
          }),
        }),
      }),
    ]);
  });

  it("concludes the scene and retains durable parent-arc retry state after enqueue failure", async () => {
    const { storage, createdRecords, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Origin", mode: "roleplay", metadata: { enableMemoryRecall: true } },
        {
          id: "scene",
          name: "Scene: The Archive",
          mode: "roleplay",
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main", provider: "openai", model: "model-1" }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: "Mara opens the flooded archive." },
          { id: "choice", role: "user", content: "She chooses to rescue the ledger." },
        ],
      },
      failStoryArcCreate: true,
    });
    for (let index = 1; index <= 3; index += 1) {
      await storage.createMemory?.(priorSceneEpisode(index));
    }
    const llm = {
      complete: vi.fn()
        .mockResolvedValueOnce("Mara entered the flooded archive and chose to rescue the ledger.")
        .mockResolvedValueOnce(JSON.stringify({
          summary: "Mara entered the flooded archive and chose to rescue the ledger.",
          sections: {
            events: ["Mara entered the flooded archive."],
            choices: ["Mara chose to rescue the ledger."],
            relationshipShifts: [],
            promises: [],
            reveals: [],
            unresolvedHooks: [],
            currentState: ["Mara still holds the rescued ledger."],
          },
        })),
      async *stream() {},
      async listModels() { return []; },
    } as unknown as LlmGateway;

    await expect(concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" })).resolves.toBeDefined();

    expect(createdMessages.filter((message) => message.chatId === "origin")).toHaveLength(1);
    await expect(storage.get<JsonRecord>("chats", "scene")).resolves.toMatchObject({
      metadata: expect.objectContaining({ sceneStatus: "concluded" }),
    });
    expect(
      createdRecords.find(
        (record) =>
          record.entity === "story-consolidation-jobs" &&
          record.value.level === "episode" &&
          record.value.followUp === "arc_enqueue",
      )?.value,
    ).toEqual(
      expect.objectContaining({
        status: "retryable",
        projectionMemoryId: expect.any(String),
      }),
    );
  });

  it("keeps the scene open for replay when its durable parent-arc follow-up cannot be written", async () => {
    const { storage, createdRecords, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Origin", mode: "roleplay", metadata: { enableMemoryRecall: true } },
        {
          id: "scene",
          name: "Scene: The Archive",
          mode: "roleplay",
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main", provider: "openai", model: "model-1" }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: "Mara opens the flooded archive." },
          { id: "choice", role: "user", content: "She chooses to rescue the ledger." },
        ],
      },
      failStoryFollowUpCreate: true,
    });
    for (let index = 1; index <= 3; index += 1) {
      await storage.createMemory?.(priorSceneEpisode(index));
    }
    const llm = {
      complete: vi.fn()
        .mockResolvedValueOnce("Mara entered the flooded archive and chose to rescue the ledger.")
        .mockResolvedValueOnce(JSON.stringify({
          summary: "Mara entered the flooded archive and chose to rescue the ledger.",
          sections: {
            events: ["Mara entered the flooded archive."],
            choices: ["Mara chose to rescue the ledger."],
            relationshipShifts: [],
            promises: [],
            reveals: [],
            unresolvedHooks: [],
            currentState: ["Mara still holds the rescued ledger."],
          },
        })),
      async *stream() {},
      async listModels() { return []; },
    } as unknown as LlmGateway;

    await expect(concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" })).rejects.toThrow(
      "follow-up write failed",
    );

    expect(createdMessages.filter((message) => message.chatId === "origin")).toHaveLength(0);
    await expect(storage.get<JsonRecord>("chats", "scene")).resolves.toMatchObject({
      metadata: expect.objectContaining({ sceneStatus: "active" }),
    });
    expect(
      createdRecords.filter(
        (record) => record.entity === "canonical-memories" && record.value.payload &&
          (record.value.payload as JsonRecord).boundaryReason === "scene_conclusion",
      ),
    ).toHaveLength(1);
    expect(createdRecords.filter((record) => record.entity === "story-consolidation-jobs")).toHaveLength(0);
  });

  it("keeps an enabled scene retryable when canonical memory capabilities are missing", async () => {
    const { storage, createdMessages, createdRecords } = storageForScene({
      chats: [
        { id: "origin", name: "Origin", mode: "roleplay", metadata: { enableMemoryRecall: true } },
        {
          id: "scene",
          name: "Scene: Missing Storage",
          mode: "roleplay",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: "Mara opens the archive." },
          { id: "choice", role: "user", content: "She rescues the ledger." },
        ],
      },
    });
    (storage as { createMemory?: StorageGateway["createMemory"] }).createMemory = undefined;
    const llm = {
      complete: vi
        .fn()
        .mockResolvedValueOnce("The section records the archive rescue.")
        .mockResolvedValueOnce(
          JSON.stringify({
            summary: "Mara rescued the archive ledger.",
            sections: {
              events: ["Mara rescued the ledger."],
              choices: [], relationshipShifts: [], promises: [], reveals: [], unresolvedHooks: [], currentState: [],
            },
          }),
        ),
      async *stream() {},
      async listModels() { return []; },
    } as unknown as LlmGateway;

    await expect(concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" })).rejects.toThrow(
      "canonical memory persistence is unavailable",
    );

    expect(createdMessages.filter((message) => message.chatId === "origin")).toHaveLength(0);
    expect(createdRecords.filter((record) => record.entity === "canonical-memories")).toHaveLength(0);
    await expect(storage.get<JsonRecord>("chats", "scene")).resolves.toMatchObject({
      metadata: expect.objectContaining({ sceneStatus: "active" }),
    });
  });

  it.each([
    ["missing summary", JSON.stringify({ sections: { events: [], choices: [], relationshipShifts: [], promises: [], reveals: [], unresolvedHooks: [], currentState: [] } })],
    ["malformed fenced JSON", "```json\n{\"summary\": \"The archive closes\""],
    ["malformed sections", JSON.stringify({ summary: "The archive closes.", sections: { events: "not-an-array" } })],
  ])("rejects %s instead of displaying machine payload as scene prose", async (_label, finalRaw) => {
    const { storage, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Origin", mode: "roleplay", metadata: { enableMemoryRecall: true } },
        {
          id: "scene",
          name: "Scene: Invalid Summary",
          mode: "roleplay",
          connectionId: "conn-1",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "conn-1" }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: "Mara opens the archive." },
          { id: "choice", role: "user", content: "She rescues the ledger." },
        ],
      },
    });
    const llm = {
      complete: vi.fn().mockResolvedValueOnce("The section records the archive rescue.").mockResolvedValueOnce(finalRaw),
      async *stream() {},
      async listModels() { return []; },
    } as unknown as LlmGateway;

    await expect(concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" })).rejects.toThrow(
      /structured scene summary/i,
    );
    expect(createdMessages.filter((message) => message.chatId === "origin")).toHaveLength(0);
  });

  it("resolves a Random summary override before sending requests to the LLM", async () => {
    const connectionIds: Array<string | null | undefined> = [];
    const { storage } = storageForScene({
      chats: [
        { id: "origin", name: "Origin", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: Random Summary",
          mode: "roleplay",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "nanogpt", enabled: true, useForRandom: true }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: "The pair enter the flooded archive together." },
          { id: "ending", role: "user", content: "They recover the ledger and agree to return home." },
        ],
      },
    });
    const llm: LlmGateway = {
      async complete(request) {
        connectionIds.push(request.connectionId);
        return "The pair entered the flooded archive, recovered the ledger, and agreed to return home together.";
      },
      async *stream() {},
      async listModels() {
        return [];
      },
    };

    await concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene", connectionId: "random" });

    expect(connectionIds.length).toBeGreaterThan(0);
    expect(connectionIds).toEqual(connectionIds.map(() => "nanogpt"));
  });

  it("does not conclude the scene with a transcript excerpt when summary generation fails", async () => {
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

    await expect(concludeRoleplayScene({ storage, llm: idleLlm }, { sceneChatId: "scene" })).rejects.toThrow(
      "Scene summary generation failed",
    );
    expect(createdMessages.find((message) => message.chatId === "origin")).toBeUndefined();
    await expect(storage.get("chats", "scene")).resolves.toMatchObject({
      metadata: { sceneStatus: "active" },
    });
  });

  it("does not write origin memory or conclude long scenes when only fallback text is available", async () => {
    const openingBeat = [
      "The violet tent opens on a leash game with Jester, Pierrot, and Harlequin.",
      "Pierrot kneels anxiously while Harlequin teases from the edge of the stage.",
    ].join(" ");
    const fillerBeat = "They negotiate boundaries and rewards under the spotlight. ".repeat(40);
    const finalBeat = [
      "At the end, Chai tells all three performers they are quiet and gentle together.",
      "Jester drops the professional distance and joins the embrace instead of standing above it.",
    ].join(" ");
    const { storage, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Jester", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: The Masters Leash",
          mode: "roleplay",
          characterIds: ["jester"],
          metadata: {
            sceneOriginChatId: "origin",
            sceneDescription: "Chai enters the violet-lit circus tent.",
            sceneStatus: "active",
          },
        },
      ],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: openingBeat },
          { id: "middle", role: "user", content: fillerBeat },
          { id: "final", role: "assistant", content: finalBeat },
        ],
      },
    });

    await expect(concludeRoleplayScene({ storage, llm: idleLlm }, { sceneChatId: "scene" })).rejects.toThrow(
      "Scene summary generation failed",
    );
    expect(createdMessages.find((message) => message.chatId === "origin")).toBeUndefined();
    await expect(storage.get("chats", "origin")).resolves.toMatchObject({ metadata: {} });
  });

  it("summarizes every chunk before synthesizing a long-scene conclusion", async () => {
    const beginningBeat = "BEGINNING_BEAT Chai enters the violet tent and names the leash game as a test of trust. ";
    const middleBeat = "MIDDLE_BEAT Pierrot admits his fear while Harlequin stops teasing and chooses honesty. ";
    const endingBeat =
      "ENDING_BEAT Jester lowers the leashes, accepts Chai's terms, and the group settles into a gentler pact. ";
    const longFiller = "stage lights hum while everyone keeps negotiating boundaries and intent. ".repeat(180);
    const calls: Array<{ system: string; user: string }> = [];
    const { storage, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Jester", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: The Masters Leash",
          mode: "roleplay",
          characterIds: ["jester"],
          connectionId: "main",
          metadata: {
            sceneOriginChatId: "origin",
            sceneDescription: "Chai tests control and trust in the violet-lit circus tent.",
            sceneStatus: "active",
          },
        },
      ],
      connections: [{ id: "main" }],
      characters: [{ id: "jester", data: { name: "Jester", extensions: {} } }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: beginningBeat + longFiller },
          { id: "middle", role: "user", content: middleBeat + longFiller },
          { id: "final", role: "assistant", content: endingBeat + longFiller },
        ],
      },
    });
    const llm: LlmGateway = {
      async complete(request) {
        const system = request.messages.find((message) => message.role === "system")?.content ?? "";
        const user = request.messages.find((message) => message.role === "user")?.content ?? "";
        calls.push({ system, user });
        if (system.includes("Summarize this section of a completed roleplay scene")) {
          if (user.includes("BEGINNING_BEAT")) return "Chunk beginning: Chai frames the leash game as a test of trust.";
          if (user.includes("MIDDLE_BEAT")) return "Chunk middle: Pierrot admits fear and Harlequin chooses honesty.";
          if (user.includes("ENDING_BEAT"))
            return "Chunk ending: Jester lowers the leashes and accepts Chai's gentler pact.";
          return "Chunk extra: The performers continue negotiating boundaries.";
        }
        if (system.includes("Synthesize the final conclusion summary")) {
          expect(user).toContain("Chunk beginning: Chai frames the leash game as a test of trust.");
          expect(user).toContain("Chunk middle: Pierrot admits fear and Harlequin chooses honesty.");
          expect(user).toContain("Chunk ending: Jester lowers the leashes and accepts Chai's gentler pact.");
          return [
            "Chai entered the violet tent and turned Jester's leash game into a test of mutual trust.",
            "Pierrot admitted his fear, Harlequin gave up the teasing mask for honesty, and Jester finally lowered the leashes.",
            "The scene ended with Chai's terms accepted and the group settling into a gentler pact with unresolved intimacy still ahead.",
          ].join(" ");
        }
        return "One-shot summary should not be used for long scene conclusions.";
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    const result = await concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" });
    const returnMessage = createdMessages.find((message) => message.chatId === "origin")?.value;

    expect(calls.filter((call) => call.system.includes("Summarize this section"))).toHaveLength(3);
    expect(calls.at(-1)?.system).toContain("Synthesize the final conclusion summary");
    expect(result.summary).toContain("Chai entered the violet tent");
    expect(result.summary).toContain("Pierrot admitted his fear");
    expect(result.summary).toContain("Jester finally lowered the leashes");
    expect(returnMessage).toMatchObject({
      role: "assistant",
      characterId: null,
      extra: { hiddenFromAI: true, hiddenFromAi: true },
    });
    expect(returnMessage?.content).toContain(result.summary);
    await expect(storage.get("characters", "jester")).resolves.toMatchObject({
      data: {
        extensions: {
          characterMemories: [
            expect.objectContaining({
              sceneChatId: "scene",
              originChatId: "origin",
            }),
          ],
        },
      },
    });
  });

  it("rejects an empty final synthesis after successful chunk summaries", async () => {
    const longFiller = "The scene keeps developing with enough detail to require section summaries. ".repeat(220);
    const { storage, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Jester", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: Empty Final Summary",
          mode: "roleplay",
          characterIds: ["jester"],
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main" }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: `BEGINNING ${longFiller}` },
          { id: "ending", role: "assistant", content: `ENDING ${longFiller}` },
        ],
      },
    });
    const llm: LlmGateway = {
      async complete(request) {
        const system = request.messages.find((message) => message.role === "system")?.content ?? "";
        if (system.includes("Summarize this section of a completed roleplay scene")) {
          return "A valid chunk summary.";
        }
        if (system.includes("Synthesize the final conclusion summary")) return "   ";
        return "";
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    await expect(concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" })).rejects.toThrow(
      "Scene summary generation failed",
    );
    expect(createdMessages.find((message) => message.chatId === "origin")).toBeUndefined();
  });
  it("preserves late-scene facts from a long final synthesis", async () => {
    const { storage } = storageForScene({
      chats: [
        { id: "origin", name: "Jester", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: Long Final Summary",
          mode: "roleplay",
          characterIds: ["jester"],
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main" }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: "The scene opens with Chai challenging Jester's rules." },
          {
            id: "ending",
            role: "assistant",
            content: "ENDING_FACT Jester admits the game changed him after Chai's final demand.",
          },
        ],
      },
    });
    const longMiddle = Array.from({ length: 34 }, (_, index) => {
      return `Middle detail ${index + 1}: the scene summary keeps describing negotiations, pauses, reactions, and emotional context before it reaches the final outcome.`;
    }).join(" ");
    const finalRequests: Array<{ system: string; user: string }> = [];
    const llm: LlmGateway = {
      async complete(request) {
        const system = request.messages.find((message) => message.role === "system")?.content ?? "";
        const user = request.messages.find((message) => message.role === "user")?.content ?? "";
        if (system.includes("Summarize this section")) {
          return "The chunk summary includes the opening challenge and the ending fact.";
        }
        finalRequests.push({ system, user });
        if (finalRequests.length > 1) {
          return [
            "Chai challenged Jester's rules and kept the negotiation focused on trust, choice, and the consequences of the game.",
            "The confrontation moved through pauses and reversals without breaking their agreement.",
            "ENDING_FACT Jester admits that Chai's last demand changed him, leaving that admission as the scene's unresolved consequence.",
          ].join(" ");
        }
        return `${longMiddle} ENDING_FACT Jester admits the game changed him after Chai's final demand.`;
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    const result = await concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" });

    expect(result.summary).toContain("ENDING_FACT Jester admits");
    expect(result.summary.trim().split(/\s+/).length).toBeLessThanOrEqual(220);
    expect(finalRequests).toHaveLength(2);
    expect(finalRequests[0]?.system).toContain("120-220 words");
    expect(finalRequests[1]?.system).toContain("previous answer was too long");
    expect(finalRequests[1]?.user).toContain("Middle detail 34");
    expect(finalRequests[1]?.user).toContain("ENDING_FACT Jester admits");
  });

  it("hard-caps the final summary when the provider ignores the compression retry", async () => {
    const { storage, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Jester", mode: "conversation", metadata: {} },
        {
          id: "scene",
          name: "Scene: Provider Ignores Limit",
          mode: "roleplay",
          characterIds: [],
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main" }],
      messages: {
        scene: [{ id: "opening", role: "assistant", content: "The scene reaches a clear conclusion." }],
      },
    });
    const oversizedSummary = [
      `The opening establishes the agreement ${"opening detail ".repeat(100)}.`,
      `The middle changes their relationship ${"middle detail ".repeat(100)}.`,
      `The ending records the final consequence ${"ending detail ".repeat(10)}.`,
    ].join(" ");
    const completionSystems: string[] = [];
    const llm: LlmGateway = {
      async complete(request) {
        completionSystems.push(request.messages.find((message) => message.role === "system")?.content ?? "");
        return oversizedSummary;
      },
      async *stream() {},
      async listModels() {
        return [];
      },
    };

    const result = await concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" });

    expect(
      completionSystems.filter((system) => system.includes("Synthesize the final conclusion summary")),
    ).toHaveLength(2);
    expect(result.summary.trim().split(/\s+/).length).toBeLessThanOrEqual(220);
    expect(result.summary).toContain("The opening establishes the agreement");
    expect(result.summary).toContain("The ending records the final consequence");
    expect(createdMessages.find((message) => message.chatId === "origin")?.value.content).toContain(result.summary);
  });

  it("retries LinkAPI-style empty assistant scene summary responses with a larger no-reasoning budget", async () => {
    const { storage } = storageForScene({
      chats: [
        { id: "origin", name: "Jester", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: LinkAPI Summary",
          mode: "roleplay",
          characterIds: ["jester"],
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main" }],
      messages: {
        scene: [
          { id: "opening", role: "assistant", content: "The scene begins with Jester testing Chai's patience." },
          { id: "ending", role: "user", content: "Chai ends the scene by making Jester admit the game changed him." },
        ],
      },
    });
    const requests: Array<Parameters<LlmGateway["complete"]>[0]> = [];
    const llm: LlmGateway = {
      async complete(request) {
        requests.push(request);
        const system = request.messages.find((message) => message.role === "system")?.content ?? "";
        if (system.includes("Summarize this section") && requests.length === 1) {
          throw Object.assign(new Error("Provider response did not contain assistant text or tool calls"), {
            details: {
              finishReason: "MAX_TOKENS",
              providerMetadata: { note: "reasoning but no final assistant text" },
            },
          });
        }
        if (system.includes("Summarize this section")) {
          return "The section summary covers Jester's test and Chai's final challenge.";
        }
        return "Jester tested Chai's patience, but Chai turned the game back on him and ended by making him admit the scene changed him.";
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    const result = await concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" });

    expect(result.summary).toContain("Jester tested Chai's patience");
    expect(requests).toHaveLength(3);
    expect(requests[0].parameters).toMatchObject({ maxTokens: 700, reasoningEffort: "none" });
    expect(requests[1].parameters).toMatchObject({ maxTokens: 2048, reasoningEffort: "none" });
    expect(requests[0].parameters?.customParameters).toMatchObject({
      reasoning_effort: "none",
      reasoning: { exclude: true },
    });
  });
  it("retries a too-brief final synthesis for substantial LinkAPI scene summaries", async () => {
    const sceneMessages = Array.from({ length: 10 }, (_, index) => {
      const phase =
        index < 3
          ? "BEGINNING Chai challenges Jester's rules and reframes the leash game as a trust negotiation."
          : index < 7
            ? "MIDDLE Pierrot admits fear, Harlequin drops the teasing act, and the group renegotiates control."
            : "ENDING Jester accepts Chai's terms, lowers the leashes, and leaves unresolved intimacy for later.";
      return {
        id: `scene-message-${index + 1}`,
        role: index % 2 === 0 ? "assistant" : "user",
        content: `${phase} Detail ${index + 1} adds concrete emotional and relationship consequences.`,
      };
    });
    const { storage, createdMessages } = storageForScene({
      chats: [
        { id: "origin", name: "Jester", mode: "chat", metadata: {} },
        {
          id: "scene",
          name: "Scene: LinkAPI Brief Final",
          mode: "roleplay",
          characterIds: ["jester"],
          connectionId: "main",
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      connections: [{ id: "main" }],
      messages: { scene: sceneMessages },
    });
    const finalPrompts: string[] = [];
    const llm: LlmGateway = {
      async complete(request) {
        const system = request.messages.find((message) => message.role === "system")?.content ?? "";
        const user = request.messages.find((message) => message.role === "user")?.content ?? "";
        if (system.includes("Summarize this section")) {
          return [
            "The section summary covers Chai challenging Jester's rules at the beginning.",
            "Pierrot admits fear in the middle while Harlequin drops the teasing act.",
            "The ending has Jester lower the leashes and accept Chai's terms, with unresolved intimacy left open.",
          ].join(" ");
        }
        finalPrompts.push(user);
        if (finalPrompts.length === 1) return "Chai wins Jester's game and everyone changes.";
        return [
          "Chai enters Jester's leash game by challenging the rules instead of submitting to them, turning the premise into a negotiation over trust and control.",
          "Through the middle of the scene, Pierrot admits his fear and loyalty while Harlequin drops the teasing mask long enough to respond honestly.",
          "By the end, Jester lowers the leashes and accepts Chai's terms, leaving the group with a gentler pact and unresolved intimacy to carry forward.",
        ].join(" ");
      },
      async *stream() {
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    };

    const result = await concludeRoleplayScene({ storage, llm }, { sceneChatId: "scene" });

    expect(finalPrompts).toHaveLength(2);
    expect(finalPrompts[1]).toContain("Previous summary was too brief");
    expect(result.summary).toContain("Pierrot admits his fear");
    expect(result.summary).toContain("Jester lowers the leashes");
    expect(result.summary).not.toBe("Chai wins Jester's game and everyone changes.");
    expect(createdMessages.find((message) => message.chatId === "origin")?.value.content).toContain(result.summary);
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
describe("roleplay scene cleanup", () => {
  it("abandons a scene by bulk-deleting the scene transcript before deleting the scene chat", async () => {
    const sceneMessages = Array.from({ length: 25 }, (_, index) => ({
      id: `scene-message-${index + 1}`,
      role: index % 2 === 0 ? "assistant" : "user",
      content: `Scene beat ${index + 1}`,
    }));
    const { storage, deletedRecords, deletedMessages, bulkDeletedMessageBatches } = storageForScene({
      chats: [
        {
          id: "origin",
          connectedChatId: "scene",
          metadata: { activeSceneChatId: "scene", sceneBusyCharIds: ["char-1"] },
        },
        {
          id: "scene",
          connectedChatId: "origin",
          characterIds: ["char-1"],
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      messages: { scene: sceneMessages },
    });

    await expect(abandonRoleplayScene(storage, { sceneChatId: "scene" })).resolves.toEqual({ originChatId: "origin" });

    expect(bulkDeletedMessageBatches).toEqual([
      { chatId: "scene", messageIds: sceneMessages.map((message) => message.id) },
    ]);
    expect(deletedMessages).toEqual([]);
    expect(deletedRecords).toContainEqual({ entity: "chats", id: "scene" });
    await expect(storage.get("chats", "origin")).resolves.toMatchObject({
      connectedChatId: null,
      metadata: { activeSceneChatId: null, sceneBusyCharIds: null },
    });
  });

  it("converts a scene by cloning messages and bulk-deleting the source scene transcript", async () => {
    const sceneMessages = Array.from({ length: 18 }, (_, index) => ({
      id: `scene-message-${index + 1}`,
      role: index % 2 === 0 ? "assistant" : "user",
      content: `Scene beat ${index + 1}`,
    }));
    const { storage, createdRecords, deletedRecords, deletedMessages, bulkDeletedMessageBatches } = storageForScene({
      chats: [
        {
          id: "origin",
          connectedChatId: "scene",
          metadata: { activeSceneChatId: "scene", sceneBusyCharIds: ["char-1"] },
        },
        {
          id: "scene",
          name: "Scene: Keep the Good Bits",
          connectedChatId: "origin",
          characterIds: ["char-1"],
          metadata: { sceneOriginChatId: "origin", sceneStatus: "active" },
        },
      ],
      messages: { scene: sceneMessages },
    });

    await expect(forkRoleplayScene(storage, { sceneChatId: "scene", mode: "convert" })).resolves.toMatchObject({
      originChatId: "origin",
      mode: "convert",
    });

    expect(createdRecords.filter((record) => record.entity === "messages")).toHaveLength(sceneMessages.length);
    expect(bulkDeletedMessageBatches).toEqual([
      { chatId: "scene", messageIds: sceneMessages.map((message) => message.id) },
    ]);
    expect(deletedMessages).toEqual([]);
    expect(deletedRecords).toContainEqual({ entity: "chats", id: "scene" });
  });
});
