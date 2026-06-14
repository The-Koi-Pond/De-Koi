import { describe, expect, it } from "vitest";
import { useAgentStore } from "./agent.store";

describe("useAgentStore", () => {
  it("clears pending review queues on reset", () => {
    useAgentStore.getState().clearPendingCardUpdates();
    useAgentStore.getState().clearPendingLorebookUpdates();

    useAgentStore.getState().enqueuePendingCardUpdate({
      id: "card-1",
      characterId: "character-1",
      characterName: "Rin",
      updates: [],
      agentName: "Card Evolution Auditor",
      timestamp: 1,
    });
    useAgentStore.getState().enqueuePendingLorebookUpdate({
      id: "lorebook-1",
      chatId: "chat-1",
      lorebookId: "lorebook-1",
      lorebookName: "World",
      action: "update",
      entryId: "entry-1",
      entryName: "Town",
      content: "Updated town facts",
      newFacts: ["Town changed"],
      keys: ["town"],
      tag: "setting",
      reason: "New scene fact",
      agentName: "Lorebook Keeper",
      timestamp: 1,
    });

    expect(useAgentStore.getState().pendingCardUpdates).toHaveLength(1);
    expect(useAgentStore.getState().pendingLorebookUpdates).toHaveLength(1);

    useAgentStore.getState().reset();

    expect(useAgentStore.getState().pendingCardUpdates).toEqual([]);
    expect(useAgentStore.getState().pendingLorebookUpdates).toEqual([]);
  });
});
