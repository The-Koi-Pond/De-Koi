import { describe, expect, it } from "vitest";

import { defaultBackgroundAgentIdsForNewChat } from "./chat-modes";

describe("new-chat background agent defaults", () => {
  it("does not enable a background writer agent for new chats", () => {
    expect(defaultBackgroundAgentIdsForNewChat("roleplay")).toEqual([]);
    expect(defaultBackgroundAgentIdsForNewChat("conversation")).toEqual([]);
    expect(defaultBackgroundAgentIdsForNewChat("game")).toEqual([]);
  });
});
