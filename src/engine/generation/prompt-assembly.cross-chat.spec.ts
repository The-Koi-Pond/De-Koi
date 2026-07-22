import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

describe("prompt assembly cross-chat awareness", () => {
  it("fails explicitly when the storage runtime cannot provide sibling context", async () => {
    const storage = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      listChatMessages: vi.fn(async () => []),
      listChatMemories: vi.fn(async () => []),
      promptFull: vi.fn(async () => null),
    } as unknown as StorageGateway;

    await expect(
      assembleGenerationPrompt(storage, {
        chat: {
          id: "chat-current",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { crossChatAwareness: true, enableMemoryRecall: false },
        },
        storedMessages: [{ id: "current", role: "user", content: "What should we do with the key?" }],
        connection: { maxContext: 4096 },
        request: {},
        latestUserInput: "What should we do with the key?",
      }),
    ).rejects.toThrow("sibling conversation context is not supported");
  });

  it("uses one bounded sibling-context query without listing chats or messages serially", async () => {
    const siblingContext = vi.fn(async () => [
      {
        chat: {
          id: "chat-sibling",
          name: "Mira's other thread",
          mode: "conversation",
          characterIds: ["mira"],
          updatedAt: "2026-07-21T12:00:00.000Z",
        },
        messages: [
          { id: "sibling-user", role: "user", content: "Did you find the brass key?" },
          { id: "sibling-assistant", role: "assistant", characterId: "mira", content: "It is under the red teacup." },
        ],
      },
    ]);
    const storage = {
      list: vi.fn(async (entity: string) => {
        if (entity === "chats") throw new Error("cross-chat awareness must use the bounded storage query");
        return [];
      }),
      get: vi.fn(async (entity: string, id: string) =>
        entity === "characters" && id === "mira"
          ? { id: "mira", data: { name: "Mira", description: "A careful archivist." } }
          : null,
      ),
      listChatMessages: vi.fn(async () => {
        throw new Error("cross-chat awareness must not read sibling messages one chat at a time");
      }),
      listChatMemories: vi.fn(async () => []),
      promptFull: vi.fn(async () => null),
      listSiblingConversationContext: siblingContext,
    } as unknown as StorageGateway & { listSiblingConversationContext: typeof siblingContext };

    const result = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-current",
        mode: "conversation",
        characterIds: ["mira"],
        metadata: { crossChatAwareness: true, enableMemoryRecall: false },
      },
      storedMessages: [{ id: "current", role: "user", content: "What should we do with the key?" }],
      connection: { maxContext: 4096 },
      request: {},
      latestUserInput: "What should we do with the key?",
    });

    expect(siblingContext).toHaveBeenCalledTimes(1);
    expect(siblingContext).toHaveBeenCalledWith({
      chatId: "chat-current",
      characterIds: ["mira"],
      candidateLimit: 24,
      maxChats: 6,
      messagesPerChat: 8,
    });
    expect(storage.list).not.toHaveBeenCalledWith("chats");
    expect(storage.listChatMessages).not.toHaveBeenCalled();
    expect(result.messages.map((message) => message.content).join("\n")).toContain("Mira's other thread");
    expect(result.messages.map((message) => message.content).join("\n")).toContain("under the red teacup");
  });
});
