import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function focusStorage(characters: Array<Record<string, unknown>>): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (["prompts", "personas", "regex-scripts", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters") {
        return asStorageValue<T>(characters.find((character) => character.id === id) ?? null);
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

function conversationMessages(replyCount: number, characterId = "mira"): Array<Record<string, unknown>> {
  return [
    ...Array.from({ length: replyCount }, (_, index) => [
      {
        id: `user-${index + 1}`,
        role: "user",
        content: index === 0 ? "EARLY_USER_EXAMPLE tell me what you really think" : `old user turn ${index + 1}`,
      },
      {
        id: `assistant-${index + 1}`,
        role: "assistant",
        characterId,
        content:
          index === 0
            ? "EARLY_ASSISTANT_EXAMPLE mm. dangerous question."
            : index === 1
              ? "SECOND_ASSISTANT_EXAMPLE ask sweeter and i might answer"
              : `OLD_ASSISTANT_DRIFT_${index + 1} That is an understandable perspective to have.`,
      },
    ]).flat(),
    { id: "current-user", role: "user", content: "CURRENT_USER_SENTINEL what do you think now?" },
  ];
}

function longCharacter(id = "mira", name = "Mira"): Record<string, unknown> {
  const today = new Date().toISOString();
  return {
    id,
    data: {
      name,
      description: `IDENTITY_HEAD ${"BLOATED_DESCRIPTION_MIDDLE ".repeat(500)} IDENTITY_TAIL`,
      personality: `PERSONALITY_HEAD ${"personality filler ".repeat(120)} PERSONALITY_TAIL`,
      system_prompt: `SYSTEM_HEAD ${"voice filler ".repeat(180)} SYSTEM_TAIL_TYPING_RULE`,
      mes_example:
        '<START> {{user}}: show me how you talk\n\n{{char}}: CARD_ROLEPLAY_SENTINEL *Mira crosses the room.* "This is not texting."',
      first_mes: "CARD_FIRST_MESSAGE_SENTINEL *Mira waves.*",
      extensions: {
        characterMemories: [
          {
            createdAt: today,
            summary: `MEMORY_HEAD ${"unrelated durable detail ".repeat(220)} MEMORY_TAIL`,
          },
        ],
      },
    },
  };
}

function promptText(messages: Array<{ content?: unknown }>): string {
  return messages.map((message) => String(message.content ?? "")).join("\n");
}

describe("long Conversation context focus", () => {
  it("concentrates character voice and recent continuity without dropping command capabilities", async () => {
    const result = await assembleGenerationPrompt(focusStorage([longCharacter()]), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: conversationMessages(20),
      connection: { provider: "openai", model: "qa-model", maxContext: 128_000 },
      request: {},
      latestUserInput: "CURRENT_USER_SENTINEL what do you think now?",
    });

    const text = promptText(result.messages);
    const history = result.messages.filter((message) => message.contextKind === "history");
    expect(history).toHaveLength(2);
    expect(history.every((message) => message.role === "user")).toBe(true);
    expect(text).toContain("<conversation_focus_contract>");
    expect(text).toContain("<conversation_character_core>");
    expect(text).toContain("Respond from inside Mira's world");
    expect(text).toContain("<conversation_voice_examples>");
    expect(text).toContain("This is not texting.");
    expect(text).toContain("EARLY_USER_EXAMPLE");
    expect(text).toContain("EARLY_ASSISTANT_EXAMPLE");
    expect(text).toContain("IDENTITY_HEAD");
    expect(text).toContain("IDENTITY_TAIL");
    expect(text).toContain("SYSTEM_TAIL_TYPING_RULE");
    expect(text).toContain("CURRENT_USER_SENTINEL");
    expect(text).toContain('[memory: target="Character Name", summary="brief memory"]');
    expect(text).not.toContain("CARD_ROLEPLAY_SENTINEL");
    expect(text).not.toContain("CARD_FIRST_MESSAGE_SENTINEL");
    expect(text).toContain("old user turn 17");
    expect(text).not.toContain("OLD_ASSISTANT_DRIFT_17");
    expect(text.match(/BLOATED_DESCRIPTION_MIDDLE/g)?.length ?? 0).toBeLessThan(25);
    expect(text.length).toBeLessThan(7_000);
  });

  it("leaves a 19-reply Conversation on the normal prompt path", async () => {
    const result = await assembleGenerationPrompt(focusStorage([longCharacter()]), {
      chat: { id: "chat-short", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: conversationMessages(19),
      connection: { provider: "openai", model: "qa-model", maxContext: 128_000 },
      request: {},
      latestUserInput: "CURRENT_USER_SENTINEL what do you think now?",
    });

    const text = promptText(result.messages);
    expect(result.messages.filter((message) => message.contextKind === "history")).toHaveLength(39);
    expect(text).toContain("CARD_ROLEPLAY_SENTINEL");
    expect(text).not.toContain("<conversation_voice_examples>");
  });

  it("preserves focused voice examples when reusable context triggers a second assembly", async () => {
    const storage = focusStorage([longCharacter()]);
    const input = {
      chat: { id: "chat-reused", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: conversationMessages(20),
      connection: { provider: "openai", model: "qa-model", maxContext: 128_000 },
      request: {},
      latestUserInput: "CURRENT_USER_SENTINEL what do you think now?",
    };
    const first = await assembleGenerationPrompt(storage, input);
    const second = await assembleGenerationPrompt(storage, {
      ...input,
      reusableContext: first.reusableContext,
      agentData: { memory: "A late agent injection." },
    });

    expect(first.characters[0]?.mesExample).toContain("This is not texting.");
    expect(second.characters[0]?.mesExample).toBe(first.characters[0]?.mesExample);
  });

  it("leaves impersonation on the normal prompt path", async () => {
    const result = await assembleGenerationPrompt(focusStorage([longCharacter()]), {
      chat: { id: "chat-impersonate", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: conversationMessages(20),
      connection: { provider: "openai", model: "qa-model", maxContext: 128_000 },
      request: { impersonate: true },
      latestUserInput: "CURRENT_USER_SENTINEL what do you think now?",
    });

    expect(result.messages.filter((message) => message.contextKind === "history")).toHaveLength(41);
    expect(promptText(result.messages)).not.toContain("<conversation_voice_examples>");
  });

  it("leaves untargeted group Conversation on the normal prompt path", async () => {
    const result = await assembleGenerationPrompt(focusStorage([longCharacter(), longCharacter("sol", "Sol")]), {
      chat: { id: "chat-group", mode: "conversation", characterIds: ["mira", "sol"], metadata: {} },
      storedMessages: conversationMessages(20),
      connection: { provider: "openai", model: "qa-model", maxContext: 128_000 },
      request: {},
      latestUserInput: "CURRENT_USER_SENTINEL what do you think now?",
    });

    expect(result.messages.filter((message) => message.contextKind === "history")).toHaveLength(41);
    expect(promptText(result.messages)).not.toContain("<conversation_voice_examples>");
  });

  it("focuses an explicitly targeted group Conversation speaker", async () => {
    const result = await assembleGenerationPrompt(focusStorage([longCharacter(), longCharacter("sol", "Sol")]), {
      chat: { id: "chat-targeted", mode: "conversation", characterIds: ["mira", "sol"], metadata: {} },
      storedMessages: conversationMessages(20),
      connection: { provider: "openai", model: "qa-model", maxContext: 128_000 },
      request: { forCharacterId: "mira" },
      latestUserInput: "CURRENT_USER_SENTINEL what do you think now?",
    });

    const text = promptText(result.messages);
    expect(result.messages.filter((message) => message.contextKind === "history")).toHaveLength(2);
    expect(
      result.messages
        .filter((message) => message.contextKind === "history")
        .every((message) => message.role === "user"),
    ).toBe(true);
    expect(text).toContain("<conversation_voice_examples>");
    expect(text).toContain("Respond only as Mira");
  });

  it("leaves Roleplay on the normal prompt path", async () => {
    const result = await assembleGenerationPrompt(focusStorage([longCharacter()]), {
      chat: { id: "chat-roleplay", mode: "roleplay", characterIds: ["mira"], metadata: {} },
      storedMessages: conversationMessages(20),
      connection: { provider: "openai", model: "qa-model", maxContext: 128_000 },
      request: {},
      latestUserInput: "CURRENT_USER_SENTINEL what do you think now?",
    });

    const text = promptText(result.messages);
    expect(result.messages.filter((message) => message.contextKind === "history")).toHaveLength(41);
    expect(text).toContain("CARD_ROLEPLAY_SENTINEL");
    expect(text).not.toContain("<conversation_voice_examples>");
  });
});
