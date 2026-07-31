import { describe, expect, it } from "vitest";

import {
  BUILT_IN_AGENTS,
  BUILT_IN_AGENT_IDS,
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

  it("exposes Narrative Craft as the only current built-in prose director", () => {
    expect(BUILT_IN_AGENT_IDS.NARRATIVE_CRAFT).toBe("narrative-craft");
    expect(BUILT_IN_AGENTS.find((agent) => agent.id === "narrative-craft")).toMatchObject({
      name: "Narrative Craft",
      phase: "post_processing",
      enabledByDefault: false,
      defaultInjectAsSection: true,
      category: "writer",
      modeAllowlist: ["roleplay", "visual_novel"],
    });
    expect(BUILT_IN_AGENTS.map((agent) => agent.id)).not.toEqual(
      expect.arrayContaining(["prose-guardian", "director", "secret-plot-driver"]),
    );
    expect(getDefaultBuiltInAgentSettings("narrative-craft")).toEqual({
      maxTokens: 2500,
      temperature: 0,
      injectAsSection: true,
      runInterval: 4,
    });
  });

  it("maps retired narrative agents to one Narrative Craft activation", () => {
    expect(
      enabledChatAgentIds(
        {
          activeAgentIds: ["prose-guardian", "builtin:director", "secret-plot-driver", "builtin:narrative-craft"],
        },
        "roleplay",
      ),
    ).toEqual(["narrative-craft"]);
  });

  it("does not make Narrative Craft available to Conversation or Game", () => {
    expect(isBuiltInAgentAvailableInChatMode("roleplay", "narrative-craft")).toBe(true);
    expect(isBuiltInAgentAvailableInChatMode("conversation", "narrative-craft")).toBe(false);
    expect(isBuiltInAgentAvailableInChatMode("game", "narrative-craft")).toBe(false);
    expect(enabledChatAgentIds({ activeAgentIds: ["director"] }, "conversation")).toEqual([]);
    expect(enabledChatAgentIds({ activeAgentIds: ["secret-plot-driver"] }, "game")).toEqual([]);
  });
});
