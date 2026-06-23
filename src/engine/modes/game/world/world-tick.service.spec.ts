import { describe, expect, it } from "vitest";
import type { GameNpc } from "../../../contracts/types/game";
import { createJournal } from "./journal.service";
import type { GameTime } from "./time.service";
import type { WeatherState } from "./weather.service";
import { resolveGameWorldTick } from "./world-tick.service";

const NOW = "2026-06-22T12:00:00.000Z";

function time(day: number, hour: number, minute = 0): GameTime {
  return { day, hour, minute };
}

function weather(type: WeatherState["type"]): WeatherState {
  return {
    type,
    temperature: 21,
    description: `The weather is ${type}.`,
    wind: "calm",
    visibility: "clear",
  };
}

function npc(id: string, name: string): GameNpc {
  return {
    id,
    name,
    emoji: "",
    description: `${name} lives nearby.`,
    location: "Harbor",
    reputation: 0,
    met: true,
    notes: [],
  };
}

describe("resolveGameWorldTick", () => {
  it("skips without changing state when the world tick is disabled", () => {
    const journal = createJournal();
    const npcs = [npc("mira", "Mira")];

    const result = resolveGameWorldTick({
      enabled: false,
      trigger: "manual",
      triggerKey: "manual:1",
      previousTriggerKeys: [],
      time: time(1, 8),
      weather: weather("clear"),
      location: "Harbor",
      journal,
      npcs,
      nowIso: NOW,
    });

    expect(result.changed).toBe(false);
    expect(result.skippedReason).toBe("disabled");
    expect(result.time).toEqual(time(1, 8));
    expect(result.journal).toBe(journal);
    expect(result.npcs).toBe(npcs);
    expect(result.recapLines).toEqual([]);
  });

  it("skips duplicate trigger keys so automatic hooks are idempotent", () => {
    const journal = createJournal();

    const result = resolveGameWorldTick({
      enabled: true,
      trigger: "session_end",
      triggerKey: "session:chat-1:end",
      previousTriggerKeys: ["session:chat-1:end"],
      time: time(1, 20),
      weather: weather("clear"),
      location: "Roadside Camp",
      journal,
      npcs: [],
      nowIso: NOW,
    });

    expect(result.changed).toBe(false);
    expect(result.skippedReason).toBe("duplicate");
    expect(result.nextHistoryEntry).toBeNull();
  });

  it("advances long-rest time across a new day and records a deterministic recap", () => {
    const result = resolveGameWorldTick({
      enabled: true,
      trigger: "rest",
      triggerKey: "rest:chat-1:turn-12",
      previousTriggerKeys: [],
      time: time(1, 23),
      weather: weather("fog"),
      location: "Roadside Camp",
      journal: createJournal(),
      npcs: [],
      nowIso: NOW,
    });

    expect(result.changed).toBe(true);
    expect(result.time).toEqual(time(2, 7));
    expect(result.dayChanged).toBe(true);
    expect(result.weatherIntent).toEqual({ refresh: true, reason: "new_day" });
    expect(result.recapLines).toContain("Time advanced to Day 2, 07:00 (morning).");
    expect(result.recapLines).toContain("A new day begins at Roadside Camp.");
  });

  it("requests a weather refresh for travel without inventing the weather itself", () => {
    const result = resolveGameWorldTick({
      enabled: true,
      trigger: "travel",
      triggerKey: "travel:chat-1:turn-3",
      previousTriggerKeys: [],
      time: time(1, 9),
      weather: weather("clear"),
      location: "North Road",
      journal: createJournal(),
      npcs: [],
      nowIso: NOW,
    });

    expect(result.time).toEqual(time(1, 11));
    expect(result.weather).toEqual(weather("clear"));
    expect(result.weatherIntent).toEqual({ refresh: true, reason: "travel" });
    expect(result.recapLines).toContain("Conditions may shift as travel continues through North Road.");
  });

  it("records a session boundary recap without advancing time", () => {
    const result = resolveGameWorldTick({
      enabled: true,
      trigger: "session_end",
      triggerKey: "session:chat-1:end",
      previousTriggerKeys: [],
      time: time(2, 21, 30),
      weather: weather("clear"),
      location: "Moon Gate",
      journal: createJournal(),
      npcs: [],
      nowIso: NOW,
    });

    expect(result.changed).toBe(true);
    expect(result.time).toEqual(time(2, 21, 30));
    expect(result.weatherIntent).toBeNull();
    expect(result.recapLines).toEqual([
      "World state reviewed at Day 2, 21:30 (night).",
      "Session ended at Moon Gate.",
    ]);
    expect(result.journal.entries[0]).toMatchObject({
      type: "event",
      title: "World advanced: Session ended",
      content: result.recap,
    });
  });
it("adds one world event journal entry when the tick changes world facts", () => {
    const result = resolveGameWorldTick({
      enabled: true,
      trigger: "manual",
      triggerKey: "manual:chat-1:1",
      previousTriggerKeys: [],
      time: time(1, 8),
      weather: weather("clear"),
      location: "Market Ward",
      journal: createJournal(),
      npcs: [],
      nowIso: NOW,
    });

    expect(result.journal.entries).toHaveLength(1);
    expect(result.journal.entries[0]).toMatchObject({
      timestamp: NOW,
      type: "event",
      title: "World advanced: Manual advance",
      content: result.recap,
    });
  });

  it("updates NPC notes only from explicit world tick rules", () => {
    const npcs = [npc("mira", "Mira"), npc("oren", "Oren")];

    const withoutRules = resolveGameWorldTick({
      enabled: true,
      trigger: "manual",
      triggerKey: "manual:chat-1:no-rules",
      previousTriggerKeys: [],
      time: time(1, 8),
      weather: weather("clear"),
      location: "Harbor",
      journal: createJournal(),
      npcs,
      nowIso: NOW,
    });

    expect(withoutRules.npcs).toEqual(npcs);

    const withRule = resolveGameWorldTick({
      enabled: true,
      trigger: "manual",
      triggerKey: "manual:chat-1:with-rule",
      previousTriggerKeys: [],
      time: time(1, 8),
      weather: weather("clear"),
      location: "Harbor",
      journal: createJournal(),
      npcs,
      npcRules: [{ npcId: "mira", note: "Mira finishes repairing the ferry sign." }],
      nowIso: NOW,
    });

    expect(withRule.npcUpdates).toEqual([
      { npcId: "mira", npcName: "Mira", note: "Mira finishes repairing the ferry sign." },
    ]);
    expect(withRule.npcs.find((entry) => entry.id === "mira")?.notes).toContain(
      "[world_tick] Mira finishes repairing the ferry sign.",
    );
    expect(withRule.npcs.find((entry) => entry.id === "oren")?.notes).toEqual([]);
  });
});
