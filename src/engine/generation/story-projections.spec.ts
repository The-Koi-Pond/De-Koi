import { describe, expect, it } from "vitest";

import {
  eligibleStoryMessages,
  getEffectiveStoryConsolidationEnabled,
  planArcCoverage,
  planEpisodeCoverage,
  type StoryEpisodeCoverage,
} from "./story-projections";

function message(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    content: `Message ${index}`,
    createdAt: `2026-08-27T00:${String(index).padStart(2, "0")}:00.000Z`,
    ...overrides,
  };
}

describe("story projection coverage", () => {
  it("enables automatic consolidation only for memory-enabled roleplay", () => {
    expect(getEffectiveStoryConsolidationEnabled("roleplay", {})).toBe(true);
    expect(getEffectiveStoryConsolidationEnabled("visual_novel", {})).toBe(true);
    expect(getEffectiveStoryConsolidationEnabled("roleplay", { enableStoryConsolidation: false })).toBe(false);
    expect(getEffectiveStoryConsolidationEnabled("conversation", {})).toBe(false);
    expect(getEffectiveStoryConsolidationEnabled("game", {})).toBe(false);
  });

  it("keeps only non-empty user-visible and AI-visible transcript messages", () => {
    expect(
      eligibleStoryMessages([
        message(1),
        message(2, { extra: { hiddenFromAI: true } }),
        message(3, { extra: { hiddenFromUser: true } }),
        message(4, { content: " " }),
        message(5, { role: "system" }),
        message(6, { role: "narrator" }),
      ]).map((entry) => entry.id),
    ).toEqual(["message-1", "message-6"]);
  });

  it("closes an automatic episode at the first assistant boundary after 24 uncovered messages", () => {
    const source = Array.from({ length: 27 }, (_, index) => message(index + 1));
    source[23] = message(24, { role: "user" });
    source[24] = message(25, { role: "assistant" });

    const plan = planEpisodeCoverage({ chatId: "chat-1", messages: source, coveredMessageIds: new Set() });

    expect(plan?.boundaryReason).toBe("message_threshold");
    expect(plan?.messageIds).toEqual(source.slice(0, 25).map((entry) => entry.id));
    expect(plan?.firstMessageId).toBe("message-1");
    expect(plan?.lastMessageId).toBe("message-25");
  });

  it("does not threshold an active formal scene and permits a completed manual close", () => {
    const source = Array.from({ length: 26 }, (_, index) => message(index + 1));
    expect(
      planEpisodeCoverage({
        chatId: "scene-1",
        messages: source,
        coveredMessageIds: new Set(),
        formalSceneStatus: "active",
      }),
    ).toBeNull();

    expect(
      planEpisodeCoverage({
        chatId: "chat-1",
        messages: source.slice(0, 2),
        coveredMessageIds: new Set(),
        requestedBoundary: "manual",
      })?.boundaryReason,
    ).toBe("manual");
    expect(
      planEpisodeCoverage({
        chatId: "chat-1",
        messages: [message(1)],
        coveredMessageIds: new Set(),
        requestedBoundary: "manual",
      }),
    ).toBeNull();
    expect(
      planEpisodeCoverage({
        chatId: "scene-1",
        messages: [message(1), message(2, { role: "user" })],
        coveredMessageIds: new Set(),
        requestedBoundary: "scene_conclusion",
      })?.messageIds,
    ).toEqual(["message-1", "message-2"]);
  });

  it("groups four consecutive uncovered episodes into one arc", () => {
    const episodes: StoryEpisodeCoverage[] = Array.from({ length: 5 }, (_, index) => ({
      episodeId: `episode-${index + 1}`,
      coverageId: `coverage-${index + 1}`,
      messageIds: [`message-${index * 2 + 1}`, `message-${index * 2 + 2}`],
      firstMessageId: `message-${index * 2 + 1}`,
      lastMessageId: `message-${index * 2 + 2}`,
      createdAt: `2026-08-27T0${index}:00:00.000Z`,
    }));

    const plan = planArcCoverage({ chatId: "chat-1", episodes, coveredEpisodeIds: new Set() });

    expect(plan?.sourceEpisodeIds).toEqual(["episode-1", "episode-2", "episode-3", "episode-4"]);
    expect(plan?.messageIds).toEqual(Array.from({ length: 8 }, (_, index) => `message-${index + 1}`));
  });

  it("does not bridge an invalidated episode slot when building an arc", () => {
    const episodes: StoryEpisodeCoverage[] = Array.from({ length: 5 }, (_, index) => ({
      episodeId: `episode-${index + 1}`,
      coverageId: `coverage-${index + 1}`,
      messageIds: [`message-${index + 1}`],
      firstMessageId: `message-${index + 1}`,
      lastMessageId: `message-${index + 1}`,
      createdAt: `2026-08-27T0${index}:00:00.000Z`,
      active: index !== 1,
    }));

    expect(planArcCoverage({ chatId: "chat-1", episodes, coveredEpisodeIds: new Set() })).toBeNull();
  });
});
