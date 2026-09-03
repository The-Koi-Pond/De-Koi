import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import type { RoleplayContinuityDirectorState } from "../contracts/types/roleplay-continuity-director";
import { assembleGenerationPrompt } from "./prompt-assembly";

function storage(): StorageGateway {
  return {
    list: async () => [],
    get: async (entity, id) =>
      entity === "characters" && id === "mara"
        ? ({ id, data: { name: "Mara", description: "A careful investigator." } } as never)
        : null,
    create: async () => {
      throw new Error("unexpected create");
    },
    update: async () => {
      throw new Error("unexpected update");
    },
    delete: async () => ({ deleted: false }),
    listChatMessages: async () => [],
    getChatMessage: async () => null,
    createChatMessage: async () => {
      throw new Error("unexpected message create");
    },
    updateChatMessage: async () => {
      throw new Error("unexpected message update");
    },
    deleteChatMessage: async () => ({ deleted: false }),
    patchChatMessageExtra: async () => ({}),
    addChatMessageSwipe: async () => ({}),
    patchChatMetadata: async () => ({}),
    patchChatSummaries: async () => ({}),
    listChatMemories: async () => [],
    getWorldState: async () => null,
    saveTrackerSnapshot: async () => ({}),
    listLorebookEntries: async () => [],
    listLorebookEntriesByLorebookIds: async () => [],
    createLorebookEntries: async () => [],
    promptFull: async () => null,
  } as StorageGateway;
}

function state(enabled = true): RoleplayContinuityDirectorState {
  return {
    version: 1,
    revision: 3,
    enabled,
    connectionId: null,
    refreshMode: "manual",
    refreshEveryAssistantTurns: null,
    currentArc: null,
    openThreads: [],
    sourceSnapshot: null,
    updatedAt: "2026-09-02T12:00:00.000Z",
    beats: [
      {
        id: "beat-approved",
        text: "Mara reveals the forged seal.",
        status: "approved",
        order: 0,
        source: "user",
        sourceIds: [],
        characterIds: ["mara"],
        threadIds: [],
        createdAt: "2026-09-02T12:00:00.000Z",
        updatedAt: "2026-09-02T12:00:00.000Z",
      },
      {
        id: "beat-rejected",
        text: "Celia attacks the captain.",
        status: "rejected",
        order: 1,
        source: "director",
        sourceIds: [],
        characterIds: [],
        threadIds: [],
        createdAt: "2026-09-02T12:00:00.000Z",
        updatedAt: "2026-09-02T12:00:00.000Z",
      },
    ],
  };
}

describe("prompt assembly continuity director", () => {
  it("places exact approved guidance before the latest user request and attributes it", async () => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["mara"],
        metadata: { roleplayContinuityDirector: state() },
      },
      storedMessages: [{ id: "u1", role: "user", content: "Do not reveal the seal yet." }],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "Do not reveal the seal yet.",
    });

    const directorIndex = result.messages.findIndex((message) => message.content.includes("<continuity_director>"));
    const latestUserIndex = result.messages.map((message) => message.role).lastIndexOf("user");
    expect(directorIndex).toBeGreaterThanOrEqual(0);
    expect(directorIndex).toBeLessThan(latestUserIndex);
    expect(result.messages[directorIndex]?.content).toContain("Mara reveals the forged seal.");
    expect(result.messages[directorIndex]?.content).not.toContain("Celia attacks the captain.");
    expect(result.messages[directorIndex]?.contextSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contextKind: "continuity_director",
          content: expect.stringContaining("Mara reveals the forged seal."),
        }),
      ]),
    );
    expect(result.contextAttributionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "continuity_director",
          sourceId: "beat-approved",
          snippet: "Mara reveals the forged seal.",
        }),
      ]),
    );
  });

  it("adds nothing when disabled", async () => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["mara"],
        metadata: { roleplayContinuityDirector: state(false) },
      },
      storedMessages: [],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "Continue.",
    });
    expect(result.messages.some((message) => message.content.includes("<continuity_director>"))).toBe(false);
    expect(result.contextAttributionItems.some((item) => item.kind === "continuity_director")).toBe(false);
  });
});
