import { describe, expect, it } from "vitest";

import { starterStagingPatch } from "./starter-staging";

const STAGED = {
  id: "wisp-1",
  extensions: {
    startsStaged: true,
    sceneBackgrounds: [
      { background: "wisp-apartment.webp", name: "Apartment", keywords: ["apartment", "desk"] },
      { background: "wisp-back-street.webp", name: "Street", keywords: ["alley", "puddle"] },
    ],
  },
};

describe("starter staging", () => {
  it("opens a new chat in the first scene with sprites and the Expression agent", () => {
    expect(starterStagingPatch({ metadata: {}, characters: [STAGED], replyCount: 1 })).toEqual({
      starterStagingApplied: true,
      background: "wisp-apartment.webp",
      spriteCharacterIds: ["character:wisp-1"],
      activeAgentIds: ["expression"],
    });
  });

  it("keeps what the chat already has", () => {
    const patch = starterStagingPatch({
      metadata: {
        background: "mine.png",
        spriteCharacterIds: ["character:wisp-1"],
        activeAgentIds: ["world-state", "expression"],
      },
      characters: [STAGED],
      replyCount: 0,
    });
    expect(patch).toEqual({ starterStagingApplied: true });
  });

  it("leaves agents off when the chat switched them off", () => {
    const patch = starterStagingPatch({ metadata: { enableAgents: false }, characters: [STAGED], replyCount: 1 });
    expect(patch?.activeAgentIds).toBeUndefined();
    expect(patch?.spriteCharacterIds).toEqual(["character:wisp-1"]);
  });

  it("happens once, and only before the story has started", () => {
    expect(
      starterStagingPatch({ metadata: { starterStagingApplied: true }, characters: [STAGED], replyCount: 1 }),
    ).toBeNull();
    expect(starterStagingPatch({ metadata: {}, characters: [STAGED], replyCount: 2 })).toBeNull();
  });

  it("does nothing for ordinary characters", () => {
    expect(starterStagingPatch({ metadata: {}, characters: [{ id: "x", extensions: {} }], replyCount: 1 })).toBeNull();
  });

  it("gives an ordinary card with scene backgrounds only its opening background", () => {
    const card = { id: "c", extensions: { sceneBackgrounds: STAGED.extensions.sceneBackgrounds } };
    expect(starterStagingPatch({ metadata: {}, characters: [card], replyCount: 1 })).toEqual({
      starterStagingApplied: true,
      background: "wisp-apartment.webp",
    });
  });
});
