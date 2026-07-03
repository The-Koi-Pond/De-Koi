import { describe, expect, it } from "vitest";

import {
  BUILT_IN_AGENTS,
  enabledChatAgentIds,
  filterAgentIdsForChatMode,
  isBuiltInAgentAvailableInChatMode,
  isBuiltInAgentHiddenFromChatSettingsPicker,
} from "./agent";

describe("built-in agent chat mode availability", () => {
  it("allows explicit illustrator retries in Conversation mode", () => {
    expect(isBuiltInAgentAvailableInChatMode("conversation", "illustrator")).toBe(true);
    expect([...filterAgentIdsForChatMode(["illustrator"], "conversation")]).toEqual(["illustrator"]);
  });

  it("maps legacy Spotify active agents to Music Player for roleplay chats", () => {
    expect(enabledChatAgentIds({ activeAgentIds: ["spotify", "builtin:spotify"] }, "roleplay")).toEqual(["music-dj"]);
    expect(isBuiltInAgentAvailableInChatMode("roleplay", "music-dj")).toBe(true);
    expect(isBuiltInAgentAvailableInChatMode("roleplay", "spotify")).toBe(true);
  });

  it("labels the YouTube-first built-in music agent as Music Player", () => {
    expect(BUILT_IN_AGENTS.find((agent) => agent.id === "music-dj")?.name).toBe("Music Player");
  });

  it("keeps Music Player available in Conversation mode so fresh picks can run", () => {
    expect(isBuiltInAgentAvailableInChatMode("conversation", "music-dj")).toBe(true);
    expect(isBuiltInAgentHiddenFromChatSettingsPicker("conversation", "music-dj")).toBe(false);
    expect(enabledChatAgentIds({ activeAgentIds: ["music-dj"] }, "conversation")).toEqual(["music-dj"]);
  });
});