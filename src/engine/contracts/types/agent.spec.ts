import { describe, expect, it } from "vitest";

import { enabledChatAgentIds, filterAgentIdsForChatMode, isBuiltInAgentAvailableInChatMode } from "./agent";

describe("built-in agent chat mode availability", () => {
  it("allows explicit illustrator retries in Conversation mode", () => {
    expect(isBuiltInAgentAvailableInChatMode("conversation", "illustrator")).toBe(true);
    expect([...filterAgentIdsForChatMode(["illustrator"], "conversation")]).toEqual(["illustrator"]);
  });

  it("maps legacy Spotify active agents to Music DJ for roleplay chats", () => {
    expect(enabledChatAgentIds({ activeAgentIds: ["spotify", "builtin:spotify"] }, "roleplay")).toEqual(["music-dj"]);
    expect(isBuiltInAgentAvailableInChatMode("roleplay", "music-dj")).toBe(true);
    expect(isBuiltInAgentAvailableInChatMode("roleplay", "spotify")).toBe(true);
  });
});