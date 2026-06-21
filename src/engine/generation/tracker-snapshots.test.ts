import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import type { AgentResult } from "../contracts/types/agent";
import { persistTrackerSnapshotForTurn } from "./tracker-snapshots";

function createTrackerStorage(): StorageGateway {
  const storage = {
    list: vi.fn(async (entity: string) => (entity === "personas" ? [{ id: "persona-1", name: "Xel" }] : [])),
    get: vi.fn(async (entity: string, id: string) => {
      if (entity === "chats") return { id, personaId: "persona-1", gameState: null };
      if (entity === "personas") return { id: "persona-1", name: "Xel" };
      return null;
    }),
    create: vi.fn(async (_entity: string, value: Record<string, unknown>) => value),
    update: vi.fn(async (_entity: string, id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
    delete: vi.fn(async () => ({ deleted: true })),
    listChatMessages: vi.fn(async () => []),
    getChatMessage: vi.fn(async () => null),
    createChatMessage: vi.fn(async (_chatId: string, value: Record<string, unknown>) => value),
    updateChatMessage: vi.fn(async (_messageId: string, patch: Record<string, unknown>) => patch),
    deleteChatMessage: vi.fn(async () => ({ deleted: true })),
    patchChatMessageExtra: vi.fn(async (_messageId: string, patch: Record<string, unknown>) => patch),
    addChatMessageSwipe: vi.fn(async () => ({})),
    patchChatMetadata: vi.fn(async (_chatId: string, patch: Record<string, unknown>) => patch),
    patchChatSummaries: vi.fn(async (_chatId: string, patch: Record<string, unknown>) => patch),
    listChatMemories: vi.fn(async () => []),
    getWorldState: vi.fn(async () => null),
    saveTrackerSnapshot: vi.fn(async (_chatId: string, snapshot: Record<string, unknown>) => snapshot),
    listLorebookEntries: vi.fn(async () => []),
    promptFull: vi.fn(async () => null),
    createLorebookEntries: vi.fn(async () => []),
  };
  return storage as unknown as StorageGateway;
}

describe("persistTrackerSnapshotForTurn", () => {
  it("filters player persona rows that only identify through characterIds before canonical parsing", async () => {
    const storage = createTrackerStorage();
    const result: AgentResult = {
      agentId: "character-tracker",
      agentType: "character-tracker",
      type: "character_tracker_update",
      success: true,
      error: null,
      data: {
        presentCharacters: [
          { name: "Masked Hero", characterIds: ["persona-1"], mood: "ready" },
          { name: "Mira", characterIds: ["character-1"], mood: "watchful" },
        ],
      },
      tokensUsed: 0,
      durationMs: 0,
    };

    const snapshot = await persistTrackerSnapshotForTurn(storage, "chat-1", { messageId: "msg-1", swipeIndex: 0 }, [
      result,
    ]);

    expect(snapshot?.presentCharacters.map((character) => character.name)).toEqual(["Mira"]);
    expect(snapshot?.presentCharacters[0]).toMatchObject({ characterId: "Mira", mood: "watchful" });
  });
});
