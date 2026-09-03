import { describe, expect, it } from "vitest";

import type { RoleplayContinuityDirectorState } from "../../../contracts/types/roleplay-continuity-director";
import { buildContinuityDirectorContext } from "./continuity-director-context";

const state: RoleplayContinuityDirectorState = {
  version: 1,
  revision: 7,
  enabled: true,
  connectionId: null,
  refreshMode: "manual",
  refreshEveryAssistantTurns: null,
  currentArc: null,
  openThreads: [],
  sourceSnapshot: null,
  updatedAt: "2026-09-02T12:00:00.000Z",
  beats: [
    {
      id: "later",
      text: "The watch captain arrives.",
      status: "approved",
      order: 2,
      source: "director",
      sourceIds: [],
      characterIds: [],
      threadIds: [],
      createdAt: "2026-09-02T12:00:00.000Z",
      updatedAt: "2026-09-02T12:00:00.000Z",
    },
    {
      id: "proposed",
      text: "This must stay out.",
      status: "proposed",
      order: 1,
      source: "director",
      sourceIds: [],
      characterIds: [],
      threadIds: [],
      createdAt: "2026-09-02T12:00:00.000Z",
      updatedAt: "2026-09-02T12:00:00.000Z",
    },
    {
      id: "first",
      text: "Mara reveals the forged seal.",
      status: "approved",
      order: 0,
      source: "user",
      sourceIds: ["episode-1"],
      characterIds: ["mara"],
      threadIds: ["thread-1"],
      createdAt: "2026-09-02T12:00:00.000Z",
      updatedAt: "2026-09-02T12:00:00.000Z",
    },
  ],
};

describe("continuity director prompt context", () => {
  it("projects approved beats in user order with exact attribution", () => {
    const result = buildContinuityDirectorContext({ chatId: "chat-1", chatMode: "roleplay", state });

    expect(result?.block).toContain("The latest explicit user request overrides every beat below.");
    expect(result?.block.indexOf("Mara reveals the forged seal.")).toBeLessThan(
      result?.block.indexOf("The watch captain arrives.") ?? -1,
    );
    expect(result?.block).not.toContain("This must stay out.");
    expect(result?.attributionItems).toEqual([
      expect.objectContaining({
        kind: "continuity_director",
        status: "injected",
        sourceId: "first",
        sourceCollection: "chats",
        parentSourceId: "chat-1",
        snippet: "Mara reveals the forged seal.",
        metadata: expect.objectContaining({ planRevision: 7, order: 0, beatStatus: "approved" }),
      }),
      expect.objectContaining({ sourceId: "later", snippet: "The watch captain arrives." }),
    ]);
  });

  it.each([
    { chatMode: "conversation", state },
    { chatMode: "roleplay", state: { ...state, enabled: false } },
    {
      chatMode: "roleplay",
      state: { ...state, beats: state.beats.map((beat) => ({ ...beat, status: "rejected" as const })) },
    },
  ])("returns no block when guidance is ineligible", (input) => {
    expect(buildContinuityDirectorContext({ chatId: "chat-1", ...input })).toBeNull();
  });
});
