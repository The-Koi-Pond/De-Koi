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
  it("writes legacy-compatible transcript rows for single-chat JSONL export", () => {
    const messages: Message[] = [
      {
        id: "message-1",
        chatId: "chat-1",
        role: "user",
        characterId: null,
        content: "Hello, Mira.",
        activeSwipeIndex: 0,
        createdAt: "2026-06-01T12:01:00.000Z",
        extra: {
          ...baseExtra,
          personaSnapshot: { personaId: "persona-1", name: "Celia" },
        },
      },
      {
        id: "message-2",
        chatId: "chat-1",
        role: "assistant",
        characterId: "character-1",
        content: "Hello back.",
        activeSwipeIndex: 0,
        createdAt: "2026-06-01T12:02:00.000Z",
        extra: {
          ...baseExtra,
          isGenerated: true,
        },
      },
    ];

    const rows = formatChatJsonl(chat, messages)
      .trimEnd()
      .split("\n")
      .map((row) => JSON.parse(row) as Record<string, unknown>);

    expect(rows[0]).toMatchObject({
      format: "marinara-chat-transcript-jsonl",
      version: 1,
      rowType: "format",
    });
    expect(rows[1]).toMatchObject({
      rowType: "header",
      user_name: "You",
      character_name: "Mira Chat",
      create_date: "2026-06-01T12:00:00.000Z",
    });
    expect(rows[2]).toMatchObject({
      rowType: "message",
      name: "Celia",
      is_user: true,
      is_system: false,
      mes: "Hello, Mira.",
      send_date: "2026-06-01T12:01:00.000Z",
    });
    expect(rows[3]).toMatchObject({
      rowType: "message",
      name: "character-1",
      is_user: false,
      is_system: false,
      mes: "Hello back.",
      send_date: "2026-06-01T12:02:00.000Z",
    });
  });
});
