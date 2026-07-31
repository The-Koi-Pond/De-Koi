import { describe, expect, it } from "vitest";

import {
  emptyNarrativeCraftState,
  narrativeCraftPromptGuidanceFromData,
  narrativeCraftStateFromLegacyMemory,
  normalizeNarrativeCraftState,
} from "./narrative-craft-state";

describe("Narrative Craft state", () => {
  it("normalizes malformed input to a bounded empty state", () => {
    expect(normalizeNarrativeCraftState(null)).toEqual(emptyNarrativeCraftState());
  });

  it("keeps valid state fields and enforces collection limits", () => {
    const state = normalizeNarrativeCraftState({
      version: 99,
      pacing: "building",
      threads: Array.from({ length: 8 }, (_, index) => ({
        id: ` thread-${index} `,
        summary: ` Thread ${index} `,
        kind: index === 0 ? "main" : "subplot",
        status: index === 7 ? "invalid" : "active",
        ignored: true,
      })),
      openQuestions: [" A? ", "B?", "C?", "D?", "E?", "F?"],
      withheldInformation: ["one", "two", "three", "four", "five"],
      unresolvedConsequences: ["a", "b", "c", "d", "e", "f"],
      recentShapeChoices: ["1", "2", "3", "4", "5", "6", "7"],
      lastGuidance: [" one ", "two", "three"],
      pendingGuidance: [" use this once ", "drop this"],
      lastAnalysisReason: "  The scene already has room to breathe.  ",
      ignored: true,
    });

    expect(state).toMatchObject({
      version: 1,
      pacing: "building",
      openQuestions: ["A?", "B?", "C?", "D?", "E?"],
      withheldInformation: ["one", "two", "three", "four"],
      unresolvedConsequences: ["a", "b", "c", "d", "e"],
      recentShapeChoices: ["1", "2", "3", "4", "5", "6"],
      lastGuidance: ["one", "two"],
      pendingGuidance: ["use this once"],
      lastAnalysisReason: "The scene already has room to breathe.",
    });
    expect(state.threads).toHaveLength(6);
    expect(state.threads[0]).toEqual({
      id: "thread-0",
      summary: "Thread 0",
      kind: "main",
      status: "active",
    });
  });

  it("extracts only a non-empty current-run prompt injection", () => {
    expect(narrativeCraftPromptGuidanceFromData({ text: "  Keep this scene quiet.  " })).toBe("Keep this scene quiet.");
    expect(narrativeCraftPromptGuidanceFromData({ text: "   " })).toBeNull();
    expect(narrativeCraftPromptGuidanceFromData({ state: emptyNarrativeCraftState() })).toBeNull();
  });

  it("converts unfinished Secret Plot memory without reviving fulfilled obligations", () => {
    expect(
      narrativeCraftStateFromLegacyMemory({
        overarchingArc: { title: "The locked observatory" },
        sceneDirections: [
          { direction: "Let Mara notice the missing key.", fulfilled: false },
          { direction: "Introduce the groundskeeper.", fulfilled: true },
        ],
        pacing: "rising",
        recentlyFulfilled: ["The bell already rang."],
        staleDetected: true,
      }),
    ).toMatchObject({
      version: 1,
      pacing: "building",
      threads: [
        {
          id: "legacy-main",
          summary: "The locked observatory",
          kind: "main",
          status: "active",
        },
        {
          id: "legacy-direction-1",
          summary: "Let Mara notice the missing key.",
          kind: "subplot",
          status: "active",
        },
      ],
      lastGuidance: [],
      pendingGuidance: [],
    });
  });
});
