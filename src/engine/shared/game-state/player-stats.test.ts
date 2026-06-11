import { describe, expect, it } from "vitest";

import type { GameState } from "../../contracts/types/game-state";
import { normalizeGameStateTrackerRows } from "./tracker-row-ids";
import { applyQuestUpdatesToPlayerStats } from "./player-stats";

function emptyPlayerStats() {
  return {
    stats: [],
    attributes: null,
    skills: {},
    inventory: [],
    activeQuests: [],
    status: "",
  };
}

describe("applyQuestUpdatesToPlayerStats", () => {
  it("preserves generated quest metadata through tracker row normalization", () => {
    const result = applyQuestUpdatesToPlayerStats(emptyPlayerStats(), [
      {
        action: "create",
        questName: "Restore the River Shrine",
        description: "Cleanse the shrine before the flood season.",
        rewards: ["Moonstone charm", "Village renown"],
        notes: "The elder hinted the broken sluice gate matters.",
        objectives: ["Find the missing sluice key"],
      },
    ]);

    const normalized = normalizeGameStateTrackerRows({
      id: "state-1",
      chatId: "chat-1",
      messageId: "message-1",
      swipeIndex: 0,
      date: null,
      time: null,
      location: null,
      weather: null,
      temperature: null,
      presentCharacters: [],
      recentEvents: [],
      playerStats: result.playerStats,
      personaStats: null,
      createdAt: "2026-06-11T00:00:00.000Z",
    } satisfies GameState);

    expect(normalized.playerStats?.activeQuests[0]).toMatchObject({
      name: "Restore the River Shrine",
      description: "Cleanse the shrine before the flood season.",
      rewards: ["Moonstone charm", "Village renown"],
      notes: "The elder hinted the broken sluice gate matters.",
      objectives: [
        {
          text: "Find the missing sluice key",
          completed: false,
        },
      ],
    });
  });
});
