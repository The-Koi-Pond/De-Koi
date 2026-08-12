import { describe, expect, it } from "vitest";

import {
  BUILT_IN_AGENTS,
  BUILT_IN_AGENT_IDS,
  DEFAULT_AGENT_TOOLS,
  enabledChatAgentIds,
  filterAgentIdsForChatMode,
  getDefaultBuiltInAgentSettings,
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

  it("does not expose a built-in narrative director", () => {
    expect(BUILT_IN_AGENT_IDS).not.toHaveProperty("NARRATIVE_CRAFT");
    expect(BUILT_IN_AGENTS.find((agent) => agent.id === "narrative-craft")).toBeUndefined();
    expect(BUILT_IN_AGENTS.map((agent) => agent.id)).not.toEqual(
      expect.arrayContaining(["narrative-craft", "prose-guardian", "director", "secret-plot-driver"]),
    );
    expect(getDefaultBuiltInAgentSettings("narrative-craft")).toEqual({ maxTokens: 4096 });
    expect(DEFAULT_AGENT_TOOLS).not.toHaveProperty("narrative-craft");
  });

  it("keeps retired narrative agent IDs unavailable in every mode", () => {
    expect(isBuiltInAgentAvailableInChatMode("conversation", "narrative-craft")).toBe(false);
    expect(isBuiltInAgentHiddenFromChatSettingsPicker("conversation", "narrative-craft")).toBe(true);
    expect(isBuiltInAgentAvailableInChatMode("game", "narrative-craft")).toBe(false);
    expect(isBuiltInAgentAvailableInChatMode("roleplay", "director")).toBe(false);
  });

  it("drops retired narrative agent IDs from existing chats without disturbing other agents", () => {
    expect(
      enabledChatAgentIds(
        {
          activeAgentIds: [
            "prose-guardian",
            "builtin:director",
            "secret-plot-driver",
            "builtin:narrative-craft",
            "illustrator",
          ],
        },
        "roleplay",
      ),
    ).toEqual(["illustrator"]);
    expect(
      [...filterAgentIdsForChatMode(["narrative-craft", "builtin:narrative-craft", "continuity"], "roleplay")],
    ).toEqual(["continuity"]);
  });
});
