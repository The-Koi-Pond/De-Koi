import { describe, expect, it } from "vitest";
import {
  metadataCharacterSchedules,
  metadataChoiceSelections,
  metadataScopedRegexMode,
  metadataTranslationProvider,
} from "./chat-settings-metadata";

describe("chat settings metadata helpers", () => {
  it("normalizes character schedules without preserving invalid rows", () => {
    expect(
      metadataCharacterSchedules({
        "char-1": {
          weekStart: "2026-06-08",
          inactivityThresholdMinutes: 999,
          idleResponseDelayMinutes: "30",
          dndResponseDelayMinutes: "bad",
          talkativeness: -20,
          days: {
            Monday: [
              { time: "09:00-10:00", activity: "Breakfast", status: "idle" },
              { time: "", activity: "Ignored", status: "offline" },
            ],
            Funday: [{ time: "12:00-13:00", activity: "Bonus", status: "nonsense" }],
          },
        },
        "": {
          weekStart: "ignored",
          days: {},
        },
      }),
    ).toEqual({
      "char-1": {
        weekStart: "2026-06-08",
        inactivityThresholdMinutes: 360,
        idleResponseDelayMinutes: 30,
        talkativeness: 0,
        days: {
          Monday: [{ time: "09:00-10:00", activity: "Breakfast", status: "idle" }],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
          Sunday: [],
          Funday: [{ time: "12:00-13:00", activity: "Bonus", status: "online" }],
        },
      },
    });
  });

  it("keeps only valid preset choice selections", () => {
    expect(
      metadataChoiceSelections({
        tone: "warm",
        tags: ["one", "two"],
        invalidArray: ["one", 2],
        invalidObject: { nested: true },
      }),
    ).toEqual({
      tone: "warm",
      tags: ["one", "two"],
    });
  });

  it("defaults enum-like settings to safe drawer values", () => {
    expect(metadataTranslationProvider("deepl")).toBe("deepl");
    expect(metadataTranslationProvider("mystery")).toBe("google");
    expect(metadataScopedRegexMode("exclusive")).toBe("exclusive");
    expect(metadataScopedRegexMode("mystery")).toBe("chat");
  });
});
