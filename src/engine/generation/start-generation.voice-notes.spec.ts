import { afterEach, describe, expect, it, vi } from "vitest";

import type { IntegrationGateway, VoiceNoteGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { ChatMessageListOptions, StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "../contracts/types/generation";
import { startGeneration } from "./start-generation";

type Row = Record<string, unknown>;

const CONNECTION = { id: "conn-1", provider: "test-provider", model: "test-model" };
const MIRA = { id: "char-1", name: "Mira", data: { name: "Mira", description: "Mira texts short." } };

/** One Conversation chat with one character and a short history. */
function chatStorage(chat: Row) {
  const messages: Row[] = [
    { id: "m-1", chatId: chat.id, role: "assistant", content: "ok. go to bed.", createdAt: "2026-10-20T10:00:00.000Z" },
    { id: "m-2", chatId: chat.id, role: "user", content: "no", createdAt: "2026-10-20T10:01:00.000Z" },
  ];
  const patchChatMetadata = async (_chatId: string, patch: Row) => {
    chat.metadata = { ...(chat.metadata as Row), ...patch };
    return chat;
  };
  const storage = {
    async list<T = unknown>(_entity: StorageEntity): Promise<T[]> {
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === CONNECTION.id) return CONNECTION as T;
      if (entity === "characters" && id === MIRA.id) return MIRA as T;
      return null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Row): Promise<T> {
      return { id: "record-1", ...value } as T;
    },
    async update<T = unknown>() {
      return {} as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(_chatId: string, options?: ChatMessageListOptions): Promise<T[]> {
      const rows = options?.descending ? [...messages].reverse() : [...messages];
      return (options?.limit ? rows.slice(0, options.limit) : rows) as T[];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Row): Promise<T> {
      const row = {
        id: `m-${messages.length + 1}`,
        chatId,
        createdAt: new Date(Date.UTC(2026, 9, 20, 10, messages.length)).toISOString(),
        ...value,
      };
      messages.push(row);
      return row as T;
    },
    async updateChatMessage<T = unknown>() {
      return {} as T;
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
    patchChatMetadata,
    async patchChatSummaries<T = unknown>() {
      return {} as T;
    },
    async listChatMemories<T = unknown>() {
      return [] as T[];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>(_chatId: string, snapshot: Row): Promise<T> {
      return snapshot as T;
    },
    async listLorebookEntries() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull() {
      return null;
    },
  } as unknown as StorageGateway;
  return { storage, messages };
}

function llm(prompts: LlmRequest[]): LlmGateway {
  return {
    complete: vi.fn(async () => ""),
    async *stream(request: LlmRequest) {
      prompts.push(request);
      yield { type: "token" as const, text: "omw. save me a seat" };
    },
    listModels: vi.fn(async () => []),
  } as unknown as LlmGateway;
}

async function reply(
  voiceNotes: VoiceNoteGateway | undefined,
  metadata: Row = { voiceNoteFrequency: { "char-1": "sometimes" } },
) {
  const chat: Row = {
    id: "chat-1",
    mode: "conversation",
    characterIds: ["char-1"],
    connectionId: CONNECTION.id,
    metadata,
  };
  const { storage, messages } = chatStorage(chat);
  const prompts: LlmRequest[] = [];
  const events: GenerationEvent[] = [];
  for await (const event of startGeneration(
    { storage, llm: llm(prompts), integrations: { voiceNotes } as unknown as IntegrationGateway },
    { chatId: "chat-1", connectionId: CONNECTION.id, userMessage: "where are you" },
  )) {
    events.push(event as GenerationEvent);
  }
  const saved = messages.filter((message) => message.role === "assistant").at(-1);
  const prompt = prompts.map((request) => request.messages.map((message) => message.content).join("\n")).join("\n");
  return { saved, prompt, events };
}

const savedFile = {
  url: "asset://localhost/voice-notes/chat-1/voice-a.mp3",
  filename: "voice-a.mp3",
  contentType: "audio/mpeg",
};

describe("voice notes in a Conversation reply", () => {
  afterEach(() => vi.restoreAllMocks());

  it("on a hit, asks for something to say out loud and saves the spoken reply with the chat", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const create = vi.fn(async () => savedFile);

    const { saved, prompt } = await reply({ available: async () => true, create });

    expect(prompt).toContain("Send this reply as a short voice message");
    expect(create).toHaveBeenCalledWith({
      chatId: "chat-1",
      text: "omw. save me a seat",
      speaker: "Mira",
      characterId: "char-1",
    });
    expect(saved?.content).toBe("omw. save me a seat");
    expect((saved?.extra as Row | undefined)?.attachments).toEqual([
      { type: "audio", voiceNote: true, url: savedFile.url, filename: "voice-a.mp3", contentType: "audio/mpeg" },
    ]);
  });

  it("is skipped without Text to Speech or when set to never, and a failed one stays a text that says why", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const create = vi.fn(async () => savedFile);

    const noTts = await reply({ available: async () => false, create });
    const never = await reply({ available: async () => true, create }, { voiceNoteFrequency: { "char-1": "never" } });
    expect(create).not.toHaveBeenCalled();
    expect(noTts.prompt).not.toContain("voice message");
    expect(never.prompt).not.toContain("voice message");

    const failed = await reply({
      available: async () => true,
      create: async () => {
        throw new Error("ElevenLabs voice is not selected");
      },
    });
    expect(failed.saved?.content).toBe("omw. save me a seat");
    expect((failed.saved?.extra as Row | undefined)?.attachments).toBeUndefined();
    expect(failed.events).toContainEqual({
      type: "command_error",
      data: { command: "voice_note", error: "Voice note failed: ElevenLabs voice is not selected" },
    });
  });
});
