import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { buildConversationFreshnessGuidance } from "./conversation-freshness";
import { assembleGenerationPrompt } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function conversationStorage(character: Record<string, unknown>, persona?: Record<string, unknown>): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "prompts") return [];
      if (["personas", "regex-scripts", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && character.id === id) return asStorageValue<T>(character);
      if (entity === "personas" && persona?.id === id) return asStorageValue<T>(persona);
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

const mira = {
  id: "mira",
  data: {
    name: "Mira",
    description: "Mira is a casual friend who texts plainly.",
  },
};

function promptText(messages: Array<{ content?: unknown }>): string {
  return messages.map((message) => String(message.content ?? "")).join("\n");
}

describe("conversation freshness guidance", () => {
  it("is absent when conversation history has no repeated assistant pattern", async () => {
    const result = await assembleGenerationPrompt(conversationStorage(mira), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: [{ id: "user-1", role: "user", content: "hey" }],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "hey",
    });

    expect(promptText(result.messages)).not.toContain("conversation_freshness");
  });

  it("adds compact guidance when recent conversation replies repeat AI-ish patterns", async () => {
    const result = await assembleGenerationPrompt(conversationStorage(mira), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: [
        { id: "user-1", role: "user", content: "rough day" },
        {
          id: "assistant-1",
          role: "assistant",
          content: "I hear you. That sounds really hard. What do you need right now?",
        },
        { id: "user-2", role: "user", content: "mostly tired" },
        {
          id: "assistant-2",
          role: "assistant",
          content: "I hear you. That sounds exhausting. How are you feeling about it?",
        },
        { id: "user-3", role: "user", content: "I do not know" },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "I do not know",
    });

    const text = promptText(result.messages);

    expect(text).toContain("conversation_freshness");
    expect(text).toContain("Recent replies leaned on question endings");
    expect(text).toContain("Recent replies used supportive check-in phrasing");
  });

  it("does not suppress question guidance when the user explicitly asks for questions", async () => {
    const result = await assembleGenerationPrompt(conversationStorage(mira), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: [
        { id: "user-1", role: "user", content: "I need help unpacking this" },
        { id: "assistant-1", role: "assistant", content: "What part feels most tangled?" },
        { id: "user-2", role: "user", content: "all of it" },
        { id: "assistant-2", role: "assistant", content: "What do you want to start with?" },
        { id: "user-3", role: "user", content: "ask me questions until I understand it" },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "ask me questions until I understand it",
    });

    const text = promptText(result.messages);

    expect(text).not.toContain("Recent replies leaned on question endings");
  });

  it("asks the next reply to reset after repeated oversized texts", async () => {
    const longReply = Array.from({ length: 90 }, (_, index) => `detail${index + 1}`).join(" ");
    const result = await assembleGenerationPrompt(conversationStorage(mira), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: [
        { id: "user-1", role: "user", content: "what happened?" },
        { id: "assistant-1", role: "assistant", content: longReply },
        { id: "user-2", role: "user", content: "okay" },
        { id: "assistant-2", role: "assistant", content: longReply },
        { id: "user-3", role: "user", content: "and now?" },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "and now?",
    });

    expect(promptText(result.messages)).toContain(
      "Recent replies were much longer than normal texts; make the next reply substantially shorter",
    );
  });
});

type Turn = { role: "user" | "assistant"; content: string };

function chatOf(pairs: Array<[string, string]>): Turn[] {
  return pairs.flatMap(([user, reply]) => [
    { role: "user" as const, content: user },
    { role: "assistant" as const, content: reply },
  ]);
}

function notes(messages: Turn[], extra: { userName?: string; characterNames?: string[]; latest?: string } = {}) {
  return (
    buildConversationFreshnessGuidance({
      messages,
      latestUserInput: extra.latest ?? "ok",
      userName: extra.userName,
      characterNames: extra.characterNames,
    }) ?? ""
  );
}

describe("conversation freshness: repeated habits", () => {
  it("names the send-off when texts keep ending on an order", () => {
    const text = notes(
      chatOf([
        ["did the 5k", "Proper job. Tomorrow is the flat route.\nIce the shin tonight."],
        ["it's fine", "It's not fine, it's a shin. Now log it."],
        ["ok", "Good. Shoes."],
      ]),
    );

    expect(text).toContain('Recent texts keep ending on a short order or send-off ("Shoes.", "Now log it.")');
  });

  it("names the closer when texts keep ending on the same thing", () => {
    const text = notes(
      chatOf([
        ["morning", "Bike today, easy spin. I want proof."],
        ["ugh", "Ugh all you like. Still waiting on that proof."],
        ["later", "Later is fine. Proof by tonight though, or I'm calling."],
      ]),
    );

    expect(text).toContain("Recent texts keep ending on the same thing");
    expect(text).toContain('"Proof by tonight though, or I\'m calling."');
  });

  it("does not count a short statement as an order", () => {
    const text = notes(
      chatOf([
        ["hi", "Biscuit says hi."],
        ["aw", "He is a menace."],
        ["lol", "Biscuit says hi again."],
      ]),
    );

    expect(text).not.toContain("short order or send-off");
  });

  it("flags the user's name used as a beat in most texts", () => {
    const messages = chatOf([
      ["hey", "Rain's not a reason, Dev."],
      ["it's cold", "Cold is a feeling. Wear a hat, Dev."],
      ["fine", "Fine is good."],
      ["done", "Look at you, Dev."],
      ["tired", "Sleep then, Dev. You earned it."],
      ["night", "Night."],
    ]);

    expect(notes(messages, { userName: "Dev Patel" })).toContain(
      'Recent texts used "Dev" in 4 of the last 6 replies; people rarely text someone\'s name',
    );
    expect(notes(messages)).not.toContain("people rarely text someone's name");
  });

  it("flags a running gag only the character keeps bringing up", () => {
    const messages = chatOf([
      ["hi", "Mr. Fitz knocked a Brontë off the shelf again."],
      ["lol", "He's unrepentant. Fitz has no shame."],
      ["sounds busy", "Busy is a strong word. Fitz napped on the till."],
      ["any customers?", "Two. Mr. Fitz hissed at one."],
    ]);

    expect(notes(messages, { characterNames: ["Wren Abernathy"] })).toContain(
      'Recent texts keep bringing back "fitz"; leave it out of the next one.',
    );
    expect(notes(messages, { characterNames: ["Wren Abernathy"], latest: "how is Mr Fitz?" })).not.toContain(
      "keep bringing back",
    );
  });

  it("does not flag the user's own topic or the character's name", () => {
    const text = notes(
      chatOf([
        ["night shift again", "Wren survived the day. How's the shift?"],
        ["long", "Long shift. Wren made extra."],
        ["this shift is endless", "Wren accepts complaints. Endless shifts end."],
        ["will do", "Shift's nearly over. Wren is proud."],
      ]),
      { characterNames: ["Wren Abernathy"] },
    );

    expect(text).not.toContain("keep bringing back");
  });

  it("ignores reply commands when finding the closer", () => {
    const text = notes(
      chatOf([
        ["it was rough", 'Send me the crossword.\n[memory: target="Juno", summary="Sam had a rough day"]'],
        ["ok", "Text me the clue.\n[react: ❤️]"],
        ["fine", "Now send it."],
      ]),
    );

    expect(text).toContain(
      'Recent texts keep ending on a short order or send-off ("Now send it.", "Text me the clue.")',
    );
  });

  it("flags caretaking orders anywhere in a text, without a second closer note", () => {
    const text = notes(
      chatOf([
        ["shift done", "Finally. Eat something with protein in it before you crash."],
        ["toast?", "Toast is not protein. And eat the second meal. Real food."],
        ["home now", "Good. Now go to sleep, the plants can wait."],
      ]),
    );

    expect(text).toContain(
      'Recent texts keep telling the user to eat, sleep or rest ("Now go to sleep, the plants can wait.", "And eat the second meal.")',
    );
    expect(text).not.toContain("short order or send-off");
  });

  it("reaches the prompt with the persona name", async () => {
    const result = await assembleGenerationPrompt(conversationStorage(mira, { id: "dev", name: "Dev" }), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], personaId: "dev", metadata: {} },
      storedMessages: [
        { id: "u1", role: "user", content: "hey" },
        { id: "a1", role: "assistant", content: "Hey Dev, the kettle's on." },
        { id: "u2", role: "user", content: "nice" },
        { id: "a2", role: "assistant", content: "Very nice, Dev. Two sugars." },
        { id: "u3", role: "user", content: "perfect" },
        { id: "a3", role: "assistant", content: "Dev, you always say that." },
        { id: "u4", role: "user", content: "it's true" },
        { id: "a4", role: "assistant", content: "True enough, Dev." },
        { id: "u5", role: "user", content: "anyway" },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "anyway",
    });

    expect(promptText(result.messages)).toContain('Recent texts used "Dev" in 4 of the last 4 replies');
  });
});
