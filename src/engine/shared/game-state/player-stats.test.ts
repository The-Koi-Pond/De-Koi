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

  it("preserves generated quest metadata when updating an existing quest", () => {
    const result = applyQuestUpdatesToPlayerStats(
      {
        ...emptyPlayerStats(),
        activeQuests: [
          {
            questEntryId: "river-shrine",
            name: "Restore the River Shrine",
            currentStage: 0,
            objectives: [],
            completed: false,
          },
        ],
      },
      [
        {
          action: "update",
          questName: "river-shrine",
          description: "The shrine can be saved if the sluice is repaired.",
          rewards: ["Moonstone charm"],
          notes: "The old sluice gate is the real blocker.",
        },
      ],
    );

    expect(result.playerStats.activeQuests[0]).toMatchObject({
      questEntryId: "river-shrine",
      description: "The shrine can be saved if the sluice is repaired.",
      rewards: ["Moonstone charm"],
      notes: "The old sluice gate is the real blocker.",
      completed: false,
    });
  });

  it("preserves generated quest metadata when completing an existing quest", () => {
    const result = applyQuestUpdatesToPlayerStats(
      {
        ...emptyPlayerStats(),
        activeQuests: [
          {
            questEntryId: "river-shrine",
            name: "Restore the River Shrine",
            currentStage: 0,
            objectives: [],
            completed: false,
          },
        ],
      },
      [
        {
          action: "complete",
          questName: "river-shrine",
          rewards: ["Village renown"],
          notes: "The village celebrates the restored water flow.",
        },
      ],
    );

    expect(result.playerStats.activeQuests[0]).toMatchObject({
      questEntryId: "river-shrine",
      rewards: ["Village renown"],
      notes: "The village celebrates the restored water flow.",
      completed: true,
    });
  });
});
