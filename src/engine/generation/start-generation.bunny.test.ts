import { describe, expect, it } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../capabilities/storage";
import {
  buildUserMessageRegenerationPromptFromSource,
  buildUserMessageRegenerationSourceMessage,
} from "./generate-route-utils";
import { assembleGenerationPrompt } from "./prompt-assembly";
import { dryRunGeneration, startGeneration } from "./start-generation";
import type { JsonRecord } from "./runtime-records";
import { createDialogueAttributionTextHash } from "../shared/text/dialogue-attribution";

async function drain(generator: AsyncGenerator<unknown>): Promise<void> {
  for await (const _event of generator) {
    // Exhaust the generation stream so assertions see provider/save side effects.
  }
}

async function collect(generator: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function recordList<T = JsonRecord>(records: JsonRecord[], options?: StorageListOptions): T[] {
  let rows = [...records];
  if (options?.filters) {
    rows = rows.filter((row) => Object.entries(options.filters ?? {}).every(([key, value]) => row[key] === value));
  }
  if (options?.whereIn) {
    const values = new Set(options.whereIn.values);
    rows = rows.filter((row) => values.has(String(row[options.whereIn!.field] ?? "")));
  }
  if (typeof options?.limit === "number") rows = rows.slice(-options.limit);
  return rows as T[];
}

function llmThatStreams(onStream: (request?: Parameters<LlmGateway["stream"]>[0]) => void, text = "rewrite"): LlmGateway {
  return {
    async complete() {
      return "";
    },
    async listModels() {
      return [];
    },
    async *stream(request) {
      onStream(request);
      yield { type: "token", text };
    },
  };
}

function eventRecord(event: unknown): Record<string, unknown> {
  return event && typeof event === "object" && !Array.isArray(event) ? (event as Record<string, unknown>) : {};
}

const noopIntegrations: IntegrationGateway = {
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
    async searchTracks() {
      return asStorageValue({});
    },
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

function baseGenerationRecords() {
  const chat: JsonRecord = {
    id: "chat-1",
    title: "QA chat",
    mode: "rp",
    characterIds: ["char-1"],
    metadata: {},
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
  const character: JsonRecord = {
    id: "char-1",
    name: "QA Character",
    description: "A concise QA responder.",
    tags: [],
  };
  const connection: JsonRecord = {
    id: "conn-1",
    name: "QA Non-Google",
    provider: "openai",
    model: "qa-model",
    enabled: true,
  };
  const previous: JsonRecord = {
    id: "message-prev",
    chatId: chat.id,
    role: "user",
    content: "Earlier user context.",
    extra: {},
    createdAt: "2026-06-06T00:00:01.000Z",
    updatedAt: "2026-06-06T00:00:01.000Z",
  };
  const target: JsonRecord = {
    id: "message-target",
    chatId: chat.id,
    role: "user",
    content: "Original user message.",
    extra: {},
    createdAt: "2026-06-06T00:00:02.000Z",
    updatedAt: "2026-06-06T00:00:02.000Z",
  };
  return { chat, character, connection, previous, target };
}

function generationStorage(args: {
  getTarget: (call: number, target: JsonRecord) => JsonRecord | null | Promise<JsonRecord | null>;
  chatMode?: string;
  chatMetadata?: JsonRecord;
  messages?: JsonRecord[];
  agentRows?: JsonRecord[];
  onCreate?: (chatId: string, value: Record<string, unknown>) => unknown;
  onSwipe?: (content: string, options: unknown) => void;
  onPatchExtra?: (messageId: string, patch: Record<string, unknown>) => void;
  onPatchChatMetadata?: (patch: Record<string, unknown>) => void;
}): StorageGateway {
  const records = baseGenerationRecords();
  if (args.chatMode) records.chat.mode = args.chatMode;
  const chatMetadata =
    records.chat.metadata && typeof records.chat.metadata === "object" && !Array.isArray(records.chat.metadata)
      ? (records.chat.metadata as JsonRecord)
      : {};
  records.chat.metadata = { ...chatMetadata, ...args.chatMetadata };
  let targetGetCalls = 0;
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "connections") return asStorageValue<T[]>([records.connection]);
      if (entity === "agents") return asStorageValue<T[]>(args.agentRows ?? []);
      if (entity === "lorebooks") return [];
      if (entity === "prompts") return [];
      if (entity === "regex-scripts") return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === records.chat.id) return asStorageValue<T>(records.chat);
      if (entity === "connections" && id === records.connection.id) return asStorageValue<T>(records.connection);
      if (entity === "characters" && id === records.character.id) return asStorageValue<T>(records.character);
      if (entity === "messages" && id === records.target.id) {
        targetGetCalls += 1;
        return asStorageValue<T | null>(await args.getTarget(targetGetCalls, records.target));
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
    async listChatMessages<T = unknown>(
      _chatId: string,
      options?: Parameters<StorageGateway["listChatMessages"]>[1],
    ): Promise<T[]> {
      if (options?.before) return asStorageValue<T[]>([records.previous]);
      return asStorageValue<T[]>(args.messages ?? [records.previous, records.target]);
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      if (messageId === records.target.id) {
        targetGetCalls += 1;
        return asStorageValue<T | null>(await args.getTarget(targetGetCalls, records.target));
      }
      return null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>) {
      if (args.onCreate) return asStorageValue<T>(args.onCreate(chatId, value));
      throw new Error("createChatMessage should not be called");
    },
    async updateChatMessage() {
      throw new Error("updateChatMessage should not be called");
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Record<string, unknown>) {
      args.onPatchExtra?.(messageId, patch);
      return asStorageValue<T>(records.target);
    },
    async addChatMessageSwipe<T = unknown>(
      _chatId: string,
      _messageId: string,
      content: string,
      options?: unknown,
    ) {
      args.onSwipe?.(content, options);
      return asStorageValue<T>(records.target);
    },
    async patchChatMetadata<T = unknown>() {
      args.onPatchChatMetadata?.({});
      return asStorageValue<T>(records.chat);
    },
    async patchChatSummaries<T = unknown>() {
      return asStorageValue<T>(records.chat);
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

function promptAssemblyRegexStorage(args: { characters: JsonRecord[]; regexScripts: JsonRecord[] }): StorageGateway {
  const characters = new Map(args.characters.map((character) => [String(character.id), character]));
  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      if (entity === "regex-scripts") return recordList<T>(args.regexScripts, options);
      if (entity === "lorebooks") return [];
      if (entity === "lorebook-folders") return [];
      if (entity === "prompts") return [];
      if (entity === "personas") return [];
      if (entity === "agents") return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters") return asStorageValue<T | null>(characters.get(id) ?? null);
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

describe("user-message regeneration review guards", () => {
  it("keeps stored text attachments when literal user text mentions attached_file tags", () => {
    const source = buildUserMessageRegenerationSourceMessage({
      content: "The quoted docs mention <attached_file but that is not a stored attachment.",
      extra: {
        attachments: [
          {
            filename: "notes.txt",
            type: "text/plain",
            data: "data:text/plain,Stored%20attachment%20body",
          },
        ],
      },
    });

    expect(source.content).toContain("The quoted docs mention <attached_file");
    expect(source.content).toContain('<attached_file name="notes.txt" type="text/plain">');
    expect(source.content).toContain("Stored attachment body");
  });

  it("keeps stored text attachments when literal user text copies a helper-shaped block", () => {
    const attachment = {
      filename: "notes.txt",
      type: "text/plain",
      data: "data:text/plain,Stored%20attachment%20body",
    };
    const copiedBlock = [
      '<attached_file name="notes.txt" type="text/plain">',
      "Stored attachment body",
      "</attached_file>",
    ].join("\n");
    const source = buildUserMessageRegenerationSourceMessage({
      content: `The user quoted this block:\n${copiedBlock}`,
      extra: { attachments: [attachment] },
    });

    expect(source.content.split('<attached_file name="notes.txt" type="text/plain">')).toHaveLength(3);
    expect(source.content).toContain("The user quoted this block:");
  });

  it("does not duplicate a helper-generated readable attachment block when building the rewrite prompt", () => {
    const attachment = {
      filename: "notes.txt",
      type: "text/plain",
      data: "data:text/plain,Stored%20attachment%20body",
    };
    const normalized = buildUserMessageRegenerationSourceMessage({
      content: "Original source.",
      extra: { attachments: [attachment] },
    });
    const prompt = buildUserMessageRegenerationPromptFromSource(normalized);

    expect(prompt.content.split('<attached_file name="notes.txt" type="text/plain">')).toHaveLength(2);
    expect(prompt.content).toContain("Stored attachment body");
  });

  it("aborts before model call or saved swipe when the full source row load fails", async () => {
    let modelCalls = 0;
    let swipeCalls = 0;
    const storage = generationStorage({
      getTarget: (call, target) => {
        if (call >= 3) throw new Error("storage unavailable");
        return target;
      },
      onSwipe: () => {
        swipeCalls += 1;
      },
    });

    await expect(
      drain(
        startGeneration(
          {
            storage,
            llm: llmThatStreams(() => {
              modelCalls += 1;
            }),
            integrations: noopIntegrations,
          },
          { chatId: "chat-1", regenerateMessageId: "message-target", connectionId: "conn-1" },
        ),
      ),
    ).rejects.toThrow("storage unavailable");

    expect(modelCalls).toBe(0);
    expect(swipeCalls).toBe(0);
  });

  it("rejects a hidden authoritative full source row even when the timeline row is visible", async () => {
    let modelCalls = 0;
    let swipeCalls = 0;
    const storage = generationStorage({
      getTarget: (call, target) => (call >= 3 ? { ...target, extra: { hiddenFromAI: true } } : target),
      onSwipe: () => {
        swipeCalls += 1;
      },
    });

    await expect(
      drain(
        startGeneration(
          {
            storage,
            llm: llmThatStreams(() => {
              modelCalls += 1;
            }),
            integrations: noopIntegrations,
          },
          { chatId: "chat-1", regenerateMessageId: "message-target", connectionId: "conn-1" },
        ),
      ),
    ).rejects.toThrow("Cannot regenerate a message hidden from AI");

    expect(modelCalls).toBe(0);
    expect(swipeCalls).toBe(0);
  });

  it("saves assembled user-message regeneration text without running connected command tags", async () => {
    let modelCalls = 0;
    const savedSwipes: string[] = [];
    const storage = generationStorage({
      getTarget: (_call, target) => target,
      onSwipe: (content) => {
        savedSwipes.push(content);
      },
    });
    const connectedCommandText = "<note>do not persist this</note>\nrewritten user text";

    const events = await collect(
      startGeneration(
        {
          storage,
          llm: llmThatStreams(() => {
            modelCalls += 1;
          }, connectedCommandText),
          integrations: noopIntegrations,
        },
        { chatId: "chat-1", regenerateMessageId: "message-target", connectionId: "conn-1" },
      ),
    );

    expect(modelCalls).toBe(1);
    expect(savedSwipes).toEqual([connectedCommandText]);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "user_message" })]));
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "command_error" })]));
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "assistant_action" })]));
  });

  it("saves direct user-message regeneration text without running connected command tags", async () => {
    let modelCalls = 0;
    const savedSwipes: string[] = [];
    const storage = generationStorage({
      getTarget: (_call, target) => target,
      onSwipe: (content) => {
        savedSwipes.push(content);
      },
    });
    const connectedCommandText = "<note>do not persist this direct rewrite</note>\nrewritten direct user text";

    const events = await collect(
      startGeneration(
        {
          storage,
          llm: llmThatStreams(() => {
            modelCalls += 1;
          }, connectedCommandText),
          integrations: noopIntegrations,
        },
        {
          chatId: "chat-1",
          regenerateMessageId: "message-target",
          connectionId: "conn-1",
          messages: [{ role: "user", content: "Direct rewrite request" }],
        },
      ),
    );

    expect(modelCalls).toBe(1);
    expect(savedSwipes).toEqual([connectedCommandText]);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "user_message" })]));
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "command_error" })]));
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "assistant_action" })]));
  });

  it("saves roleplay dialogue attribution metadata on fresh assistant messages", async () => {
    let modelCalls = 0;
    const createdMessages: Array<{ chatId: string; value: Record<string, unknown> }> = [];
    const savedText = '"Ready."';
    const storage = generationStorage({
      getTarget: (_call, target) => target,
      onCreate: (chatId, value) => {
        createdMessages.push({ chatId, value });
        return { id: "message-assistant", chatId, ...value };
      },
    });

    const events = await collect(
      startGeneration(
        {
          storage,
          llm: llmThatStreams(() => {
            modelCalls += 1;
          }, '<speaker name="QA Character">"Ready."</speaker>'),
          integrations: noopIntegrations,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          messages: [{ role: "user", content: "Give a short reply." }],
        },
      ),
    );

    const savedMessage = createdMessages[0]?.value ?? {};
    const extra = (savedMessage.extra ?? {}) as Record<string, unknown>;

    expect(modelCalls).toBe(1);
    expect(createdMessages).toHaveLength(1);
    expect(savedMessage).toMatchObject({ role: "assistant", characterId: "char-1", content: savedText });
    expect(extra.dialogueAttributions).toMatchObject({
      version: 1,
      textHash: createDialogueAttributionTextHash(savedText),
      segments: [
        {
          start: 0,
          end: savedText.length,
          speakerId: "char-1",
          speakerName: "QA Character",
          source: "speaker-tag",
          confidence: "explicit",
        },
      ],
    });
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "assistant_message" })]));
  });

  it("does not save roleplay dialogue attribution metadata for mention-only assistant prose", async () => {
    let modelCalls = 0;
    const createdMessages: Array<{ chatId: string; value: Record<string, unknown> }> = [];
    const savedText = "QA Character waits near the door.";
    const storage = generationStorage({
      getTarget: (_call, target) => target,
      onCreate: (chatId, value) => {
        createdMessages.push({ chatId, value });
        return { id: "message-assistant", chatId, ...value };
      },
    });

    await collect(
      startGeneration(
        {
          storage,
          llm: llmThatStreams(() => {
            modelCalls += 1;
          }, savedText),
          integrations: noopIntegrations,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          messages: [{ role: "user", content: "Describe the room." }],
        },
      ),
    );

    const savedMessage = createdMessages[0]?.value ?? {};
    const extra = (savedMessage.extra ?? {}) as Record<string, unknown>;

    expect(modelCalls).toBe(1);
    expect(createdMessages).toHaveLength(1);
    expect(savedMessage).toMatchObject({ role: "assistant", characterId: "char-1", content: savedText });
    expect(extra).not.toHaveProperty("dialogueAttributions");
  });

  it("saves roleplay dialogue attribution metadata on regenerated assistant swipes", async () => {
    let modelCalls = 0;
    const savedSwipes: string[] = [];
    const swipeOptions: unknown[] = [];
    const extraPatches: Array<Record<string, unknown>> = [];
    const savedText = '"Again."';
    const storage = generationStorage({
      getTarget: (_call, target) => ({ ...target, role: "assistant", characterId: "char-1" }),
      onSwipe: (content, options) => {
        savedSwipes.push(content);
        swipeOptions.push(options);
      },
      onPatchExtra: (_messageId, patch) => {
        extraPatches.push(patch);
      },
    });

    await collect(
      startGeneration(
        {
          storage,
          llm: llmThatStreams(() => {
            modelCalls += 1;
          }, 'QA Character: "Again."'),
          integrations: noopIntegrations,
        },
        { chatId: "chat-1", regenerateMessageId: "message-target", connectionId: "conn-1" },
      ),
    );

    const savedSwipeExtra = ((swipeOptions[0] as { extra?: Record<string, unknown> } | undefined)?.extra ?? {}) as Record<
      string,
      unknown
    >;

    expect(modelCalls).toBe(1);
    expect(savedSwipes).toEqual([savedText]);
    expect(savedSwipeExtra.dialogueAttributions).toMatchObject({
      version: 1,
      textHash: createDialogueAttributionTextHash(savedText),
      segments: [
        {
          start: 0,
          end: savedText.length,
          speakerId: "char-1",
          speakerName: "QA Character",
          source: "name-prefix",
          confidence: "explicit",
        },
      ],
    });
    expect(extraPatches[0]?.dialogueAttributions).toMatchObject(savedSwipeExtra.dialogueAttributions as object);
  });
  it("adds conversation freshness guidance to generation prompt messages", async () => {
    let modelCalls = 0;
    const llmRequests: Array<{ messages: Array<{ content: string }> }> = [];
    const storage = generationStorage({
      chatMode: "conversation",
      messages: [
        {
          id: "message-a1",
          chatId: "chat-1",
          role: "assistant",
          content: "That sounds exhausting. How are you feeling about it?",
          extra: {},
        },
        { id: "message-u1", chatId: "chat-1", role: "user", content: "A little stuck.", extra: {} },
        {
          id: "message-a2",
          chatId: "chat-1",
          role: "assistant",
          content: "I hear you. Does that make sense?",
          extra: {},
        },
      ],
      getTarget: (_call, target) => target,
      onCreate: (chatId, value) => ({ id: "message-assistant", chatId, ...value }),
    });

    await collect(
      startGeneration(
        {
          storage,
          llm: llmThatStreams((request) => {
            modelCalls += 1;
            llmRequests.push({ messages: request?.messages.map((message) => ({ content: message.content })) ?? [] });
          }, "Fresh answer."),
          integrations: noopIntegrations,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          messages: [{ role: "user", content: "Tell me what you think." }],
        },
      ),
    );

    expect(modelCalls).toBe(1);
    expect(llmRequests[0]?.messages.some((message) => message.content.includes("Conversation freshness guide"))).toBe(
      true,
    );
  });
  it("dry-runs generation with prompt output and no chat-state writes", async () => {
    let modelCalls = 0;
    const writeCalls: string[] = [];
    const llmRequests: Array<{ messages: Array<{ content: string }> }> = [];
    const storage = generationStorage({
      getTarget: (_call, target) => target,
      onSwipe: () => {
        writeCalls.push("addChatMessageSwipe");
      },
      onPatchExtra: () => {
        writeCalls.push("patchChatMessageExtra");
      },
      onPatchChatMetadata: () => {
        writeCalls.push("patchChatMetadata");
      },
    });
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        modelCalls += 1;
        llmRequests.push({ messages: request.messages.map((message) => ({ content: message.content })) });
        yield { type: "token", text: "dry response" };
        yield { type: "usage", data: { promptTokens: 12, completionTokens: 2 } };
      },
    };

    const events = await collect(
      dryRunGeneration(
        {
          storage,
          llm,
          integrations: noopIntegrations,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          message: "Fresh dry-run user input.",
          runId: "dry-run-1",
        },
      ),
    );
    const dryRunResult = events.map(eventRecord).find((event) => event.type === "dry_run_result");
    const data = eventRecord(dryRunResult?.data);
    const promptSnapshot = eventRecord(data.promptSnapshot);
    const promptMessages = Array.isArray(promptSnapshot.messages)
      ? (promptSnapshot.messages as Array<{ content?: unknown }>)
      : [];

    expect(modelCalls).toBe(1);
    expect(writeCalls).toEqual([]);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "dry_run_start" })]));
    expect(data).toMatchObject({ runId: "dry-run-1", content: "dry response" });
    expect(promptMessages.some((message) => String(message.content ?? "").includes("Fresh dry-run user input."))).toBe(
      true,
    );
    expect(llmRequests[0]?.messages.some((message) => message.content.includes("Fresh dry-run user input."))).toBe(
      true,
    );
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "token", data: "dry response" })]));
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "user_message" })]));
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "assistant_message" })]));
  });

  it("saves assembled user-message regeneration without assistant agent metadata", async () => {
    let modelCalls = 0;
    const savedSwipes: string[] = [];
    const swipeOptions: unknown[] = [];
    const extraPatches: Array<Record<string, unknown>> = [];
    const storage = generationStorage({
      chatMetadata: { activeAgentIds: ["html"] },
      agentRows: [
        {
          id: "html",
          type: "html",
          name: "Immersive HTML",
          enabled: true,
          phase: "pre_generation",
          promptTemplate: "Assistant-only HTML context should not decorate user rewrites.",
        },
      ],
      getTarget: (_call, target) => target,
      onSwipe: (content, options) => {
        savedSwipes.push(content);
        swipeOptions.push(options);
      },
      onPatchExtra: (_messageId, patch) => {
        extraPatches.push(patch);
      },
    });

    const events = await collect(
      startGeneration(
        {
          storage,
          llm: llmThatStreams(() => {
            modelCalls += 1;
          }),
          integrations: noopIntegrations,
        },
        { chatId: "chat-1", regenerateMessageId: "message-target", connectionId: "conn-1" },
      ),
    );

    const savedSwipeExtra = ((swipeOptions[0] as { extra?: Record<string, unknown> } | undefined)?.extra ?? {}) as Record<
      string,
      unknown
    >;

    expect(modelCalls).toBe(1);
    expect(savedSwipes).toEqual(["rewrite"]);
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "agent_result" })]));
    expect(savedSwipeExtra).not.toHaveProperty("contextInjections");
    expect(savedSwipeExtra).not.toHaveProperty("spriteExpressions");
    expect(savedSwipeExtra).not.toHaveProperty("cyoaChoices");
    expect(extraPatches).toHaveLength(1);
    expect(extraPatches[0]).not.toHaveProperty("contextInjections");
    expect(extraPatches[0]).not.toHaveProperty("spriteExpressions");
    expect(extraPatches[0]).not.toHaveProperty("cyoaChoices");
  });

  it("recomputes source-sensitive lore when reusable context receives a regeneration source", async () => {
    const chat: JsonRecord = {
      id: "chat-1",
      mode: "rp",
      characterIds: [],
      metadata: {},
    };
    const lorebook: JsonRecord = {
      id: "lore-1",
      name: "Blue Lantern Lore",
      enabled: true,
      isGlobal: true,
    };
    const loreEntry: JsonRecord = {
      id: "entry-1",
      lorebookId: lorebook.id,
      name: "Blue Lantern",
      content: "Blue lantern constructs are powered by hope.",
      keys: ["blue lantern"],
      enabled: true,
      position: 0,
      role: "system",
      order: 0,
    };
    const storage: StorageGateway = {
      async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
        if (entity === "lorebooks") return recordList<T>([lorebook], options);
        if (entity === "lorebook-folders") return [];
        if (entity === "regex-scripts") return [];
        if (entity === "prompts") return [];
        if (entity === "personas") return [];
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
        return asStorageValue<T>(chat);
      },
      async patchChatSummaries<T = unknown>() {
        return asStorageValue<T>(chat);
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
      async listLorebookEntries<T = unknown>() {
        return asStorageValue<T[]>([loreEntry]);
      },
      async listLorebookEntriesByLorebookIds<T = unknown>() {
        return asStorageValue<T[]>([loreEntry]);
      },
      async createLorebookEntries() {
        return [];
      },
      async promptFull() {
        return null;
      },
    };

    const first = await assembleGenerationPrompt(storage, {
      chat,
      storedMessages: [{ role: "user", content: "plain source" }],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "plain source",
    });
    expect(first.activatedLorebookEntries).toEqual([]);

    const second = await assembleGenerationPrompt(storage, {
      chat,
      storedMessages: [{ role: "user", content: "plain source" }],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "plain source",
      userRegenerationSourceMessage: {
        role: "user",
        content: "Please rewrite a message about a blue lantern.",
      },
      reusableContext: first.reusableContext,
    });

    expect(second.activatedLorebookEntries.map((entry) => entry.id)).toContain(loreEntry.id);
  });

  it("does not apply character-scoped prompt regex scripts during impersonation turns", async () => {
    const storage = promptAssemblyRegexStorage({
      characters: [
        { id: "char-a", name: "Alpha", description: "Alpha description.", tags: [] },
        { id: "char-b", name: "Beta", description: "Beta description.", tags: [] },
      ],
      regexScripts: [
        {
          id: "regex-alpha",
          enabled: true,
          promptOnly: true,
          placement: ["user_input"],
          findRegex: "secret",
          flags: "g",
          replaceString: "visible",
          characterId: "char-a",
        },
      ],
    });

    const prompt = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "conversation",
        characterIds: ["char-a", "char-b"],
        metadata: { characterCommands: false },
      },
      storedMessages: [{ role: "user", content: "secret" }],
      connection: { provider: "openai", model: "qa-model" },
      request: { forCharacterId: "char-a", impersonate: true },
      latestUserInput: "secret",
    });

    expect(prompt.messages.some((message) => message.content.includes("visible"))).toBe(false);
    expect(prompt.messages.some((message) => message.content.includes("secret"))).toBe(true);
  });

  it("still applies character-scoped prompt regex scripts for real group targets", async () => {
    const storage = promptAssemblyRegexStorage({
      characters: [
        { id: "char-a", name: "Alpha", description: "Alpha description.", tags: [] },
        { id: "char-b", name: "Beta", description: "Beta description.", tags: [] },
      ],
      regexScripts: [
        {
          id: "regex-alpha",
          enabled: true,
          promptOnly: true,
          placement: ["user_input"],
          findRegex: "secret",
          flags: "g",
          replaceString: "visible",
          characterId: "char-a",
        },
      ],
    });

    const prompt = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "conversation",
        characterIds: ["char-a", "char-b"],
        metadata: {},
      },
      storedMessages: [{ role: "user", content: "secret" }],
      connection: { provider: "openai", model: "qa-model" },
      request: { forCharacterId: "char-a" },
      latestUserInput: "secret",
    });

    expect(prompt.messages.some((message) => message.content.includes("visible"))).toBe(true);
  });
});
