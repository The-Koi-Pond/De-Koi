import { describe, expect, it, vi } from "vitest";

import type { ChatMessageListOptions, ChatMessageReadOptions, ChatTranscriptPort } from "../capabilities/storage";
import { loadChatMessage, loadChatMessages } from "./context";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

describe("generation chat transcript storage", () => {
  it("loads transcript rows through the focused transcript port", async () => {
    const listChatMessages = vi.fn(async (_chatId: string, _options?: ChatMessageListOptions) => [
      { id: "message-1", role: "user", extra: {} },
    ]);
    const transcript: ChatTranscriptPort = {
      listChatMessages: async <T = unknown>(chatId: string, options?: ChatMessageListOptions) =>
        asStorageValue<Promise<T[]>>(listChatMessages(chatId, options)),
      getChatMessage: async () => null,
      createChatMessage: async <T = unknown>() => asStorageValue<T>({}),
      updateChatMessage: async <T = unknown>() => asStorageValue<T>({}),
      deleteChatMessage: async () => ({ deleted: true }),
      patchChatMessageExtra: async <T = unknown>() => asStorageValue<T>({}),
      addChatMessageSwipe: async <T = unknown>() => asStorageValue<T>({}),
    };

    const rows = await loadChatMessages(transcript, "chat-1", { limit: 12 });

    expect(rows).toEqual([{ id: "message-1", role: "user", extra: {} }]);
    expect(listChatMessages).toHaveBeenCalledWith("chat-1", {
      limit: 12,
      fields: expect.arrayContaining(["id", "chatId", "role", "content", "extra"]),
      fieldSelections: {
        extra: expect.arrayContaining(["hiddenFromAI", "contextInjections", "isConversationStart"]),
      },
    });
  });

  it("loads one transcript message without generic collection access", async () => {
    const getChatMessage = vi.fn(async (_messageId: string, _options?: ChatMessageReadOptions) => ({
      id: "message-2",
      role: "assistant",
      extra: {},
    }));
    const transcript: ChatTranscriptPort = {
      listChatMessages: async <T = unknown>() => asStorageValue<T[]>([]),
      getChatMessage: async <T = unknown>(messageId: string, options?: ChatMessageReadOptions) =>
        asStorageValue<Promise<T | null>>(getChatMessage(messageId, options)),
      createChatMessage: async <T = unknown>() => asStorageValue<T>({}),
      updateChatMessage: async <T = unknown>() => asStorageValue<T>({}),
      deleteChatMessage: async () => ({ deleted: true }),
      patchChatMessageExtra: async <T = unknown>() => asStorageValue<T>({}),
      addChatMessageSwipe: async <T = unknown>() => asStorageValue<T>({}),
    };

    await expect(loadChatMessage(transcript, "message-2")).resolves.toEqual({
      id: "message-2",
      role: "assistant",
      extra: {},
    });
    expect(getChatMessage).toHaveBeenCalledWith("message-2", {
      fields: expect.arrayContaining(["id", "chatId", "role", "content", "extra"]),
      fieldSelections: {
        extra: expect.arrayContaining(["hiddenFromAI", "contextInjections", "isConversationStart"]),
      },
    });
  });
});
