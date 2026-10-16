import { describe, expect, it } from "vitest";
import type { Chat, Message } from "../../../../engine/contracts/types/chat";
import { formatChatJsonl } from "./chat-transcript-export";

const chat = {
  id: "chat-1",
  name: "Mira Chat",
  mode: "conversation",
  characterIds: ["character-1"],
  groupId: null,
  personaId: "persona-1",
  promptPresetId: null,
  connectionId: null,
  connectedChatId: null,
  folderId: null,
  sortOrder: 0,
  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-06-01T12:02:00.000Z",
  metadata: {
    summary: null,
    tags: [],
    agentOverrides: {},
    activeAgentIds: [],
    activeToolIds: [],
    presetChoices: {},
  },
} satisfies Chat;

const baseExtra = {
  displayText: null,
  isGenerated: false,
  tokenCount: null,
  generationInfo: null,
};

describe("formatChatJsonl", () => {
  const names = { characters: { "character-1": "Mira" }, user: "Chai" };

  function rowsOf(messages: Message[], chatPatch: Partial<Chat> = {}) {
    return formatChatJsonl({ ...chat, ...chatPatch }, messages, names)
      .trimEnd()
      .split("\n")
      .map((row) => JSON.parse(row) as Record<string, unknown>);
  }

  it("writes SillyTavern's chat file shape: header first, then named messages", () => {
    const rows = rowsOf(
      [
        {
          id: "message-1",
          chatId: "chat-1",
          role: "user",
          characterId: null,
          content: "Hello, Mira.",
          activeSwipeIndex: 0,
          createdAt: "2026-06-01T12:01:00.000Z",
          extra: { ...baseExtra, personaSnapshot: { personaId: "persona-1", name: "Chai" } },
        },
        {
          id: "message-2",
          chatId: "chat-1",
          role: "assistant",
          characterId: "character-1",
          content: "Hello back.",
          activeSwipeIndex: 0,
          createdAt: "2026-06-01T12:02:00.000Z",
          extra: { ...baseExtra, isGenerated: true },
        },
      ],
      { metadata: { ...chat.metadata, authorNotes: "Keep it rainy.", authorNotesDepth: 2 } as Chat["metadata"] },
    );

    expect(rows[0]).toMatchObject({
      user_name: "Chai",
      character_name: "Mira",
      create_date: "2026-06-01@12h00m00s",
      chat_metadata: {
        note_prompt: "Keep it rainy.",
        note_depth: 2,
        deKoi: { format: "de-koi-chat-transcript-jsonl", chatId: "chat-1", mode: "conversation" },
      },
    });
    expect(rows[0]).not.toHaveProperty("mes");
    expect(rows[1]).toMatchObject({ name: "Chai", is_user: true, is_system: false, mes: "Hello, Mira." });
    expect(rows[2]).toMatchObject({ name: "Mira", is_user: false, is_system: false, mes: "Hello back." });
  });

  it("writes every swipe with its reasoning, and hidden messages as is_system", () => {
    const swiped = {
      id: "message-3",
      chatId: "chat-1",
      role: "assistant",
      characterId: "character-1",
      content: "Second try",
      activeSwipeIndex: 1,
      createdAt: "2026-06-01T12:03:00.000Z",
      extra: { ...baseExtra, thinking: "think two" },
      swipes: [
        { content: "First try", extra: { thinking: "think one" }, createdAt: "2026-06-01T12:02:30.000Z" },
        { content: "Second try", extra: { thinking: "think two" } },
      ],
    } as Message;
    const hidden = {
      id: "message-4",
      chatId: "chat-1",
      role: "user",
      characterId: null,
      content: "(note to self)",
      activeSwipeIndex: 0,
      createdAt: "2026-06-01T12:04:00.000Z",
      extra: { ...baseExtra, hiddenFromAI: true },
    } as Message;

    const [, reply, note] = rowsOf([swiped, hidden]);

    expect(reply).toMatchObject({
      mes: "Second try",
      swipe_id: 1,
      swipes: ["First try", "Second try"],
      swipe_info: [
        { send_date: "2026-06-01T12:02:30.000Z", extra: { reasoning: "think one" } },
        { send_date: "2026-06-01T12:03:00.000Z", extra: { reasoning: "think two" } },
      ],
      extra: { reasoning: "think two" },
    });
    expect(note).toMatchObject({ name: "Chai", is_user: true, is_system: true });
  });
});
