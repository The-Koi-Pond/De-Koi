import { describe, expect, it } from "vitest";

import { defaultBackgroundAgentIdsForNewChat } from "./chat-modes";

describe("new-chat background agent defaults", () => {
  it("enables only detached Narrative Craft analysis for new roleplay chats", () => {
    expect(defaultBackgroundAgentIdsForNewChat("roleplay")).toEqual(["narrative-craft"]);
    expect(defaultBackgroundAgentIdsForNewChat("conversation")).toEqual([]);
    expect(defaultBackgroundAgentIdsForNewChat("game")).toEqual([]);
  });
});
