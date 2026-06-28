import { describe, expect, it } from "vitest";

import { metadataCharacterRoutines } from "./chat-settings-metadata";

describe("metadataCharacterRoutines", () => {
  it("accepts valid fuzzy routines and ignores malformed entries", () => {
    const routines = metadataCharacterRoutines({
      "char-1": {
        weekStart: "2026-06-22",
        generatedAt: "2026-06-28T12:00:00.000Z",
        sleep: "usually asleep after midnight and slow before late morning",
        busy: [{ when: "weekday afternoons", summary: "classes", availability: "busy" }],
        freeish: ["evenings after dinner"],
        replyStyle: "fast when relaxed, slower during class",
        checkInStyle: "likes texting at night",
        socialEnergy: { level: "medium", reason: "warms up once the day is done" },
        inactivityThresholdMinutes: 150,
        talkativeness: 68,
      },
      empty: {},
      malformed: {
        weekStart: "2026-06-22",
        generatedAt: "2026-06-28T12:00:00.000Z",
        sleep: "",
        busy: [],
        freeish: [],
        replyStyle: "",
        checkInStyle: "",
        socialEnergy: { level: "loud", reason: "" },
      },
    });

    expect(Object.keys(routines)).toEqual(["char-1"]);
    expect(routines["char-1"]?.busy).toEqual([
      { when: "weekday afternoons", summary: "classes", availability: "busy" },
    ]);
    expect(routines["char-1"]?.freeish).toEqual(["evenings after dinner"]);
    expect(routines["char-1"]?.socialEnergy).toEqual({
      level: "medium",
      reason: "warms up once the day is done",
    });
  });
});
