import { describe, expect, it } from "vitest";

import { summarizeCharacterAvailability } from "./schedule-availability-summary";
import type { ScheduleBlock } from "./chat-settings-metadata";

const days = (blocks: ScheduleBlock[]) => ({
  Monday: blocks,
  Tuesday: [],
  Wednesday: [],
  Thursday: [],
  Friday: [],
  Saturday: [],
  Sunday: [],
});

describe("summarizeCharacterAvailability", () => {
  it("summarizes the current availability instead of exposing raw status names", () => {
    const summary = summarizeCharacterAvailability(
      {
        weekStart: "2026-06-22T00:00:00.000Z",
        inactivityThresholdMinutes: 60,
        talkativeness: 50,
        days: days([
          { time: "09:00-12:00", activity: "answering messages", status: "online" },
          { time: "12:00-17:00", activity: "focused research", status: "dnd" },
          { time: "17:00-19:00", activity: "commuting", status: "idle" },
          { time: "23:00-07:00", activity: "sleeping", status: "offline" },
        ]),
      },
      new Date(2026, 5, 22, 13, 30),
    );

    expect(summary.current).toEqual({
      key: "busy",
      label: "Busy now",
      activity: "focused research",
      message: "Busy now: focused research.",
    });
    expect(summary.counts).toEqual({ available: 1, delayed: 1, busy: 1, unavailable: 1 });
  });

  it("allows activity inference only through existing status blocks, not UI labels", () => {
    const summary = summarizeCharacterAvailability(
      {
        weekStart: "2026-06-22T00:00:00.000Z",
        inactivityThresholdMinutes: 60,
        talkativeness: 50,
        days: days([{ time: "09:00-10:00", activity: "office hours", status: "online" }]),
      },
      new Date(2026, 5, 22, 11, 0),
    );

    expect(summary.current).toMatchObject({
      key: "available",
      label: "Available now",
      activity: "free time",
    });
    expect(summary.activeDays).toBe(1);
    expect(summary.totalBlocks).toBe(1);
  });

  it("carries overnight availability into the following morning", () => {
    const summary = summarizeCharacterAvailability(
      {
        weekStart: "2026-06-22T00:00:00.000Z",
        inactivityThresholdMinutes: 60,
        talkativeness: 50,
        days: days([{ time: "23:00-07:00", activity: "sleeping", status: "offline" }]),
      },
      new Date(2026, 5, 23, 1, 15),
    );

    expect(summary.current).toMatchObject({
      key: "unavailable",
      label: "Unavailable now",
      activity: "sleeping",
    });
  });

  it("falls back safely when the current day is missing", () => {
    const summary = summarizeCharacterAvailability(
      {
        weekStart: "2026-06-22T00:00:00.000Z",
        inactivityThresholdMinutes: 60,
        talkativeness: 50,
        days: {
          Monday: [{ time: "09:00-10:00", activity: "office hours", status: "online" }],
        },
      },
      new Date(2026, 5, 23, 9, 30),
    );

    expect(summary.current).toMatchObject({
      key: "available",
      label: "Available now",
      activity: "free time",
    });
    expect(summary.days).toHaveLength(7);
  });

  it("does not treat malformed time strings as current availability", () => {
    const summary = summarizeCharacterAvailability(
      {
        weekStart: "2026-06-22T00:00:00.000Z",
        inactivityThresholdMinutes: 60,
        talkativeness: 50,
        days: days([{ time: "soon-ish", activity: "ambiguous plans", status: "dnd" }]),
      },
      new Date(2026, 5, 22, 9, 30),
    );

    expect(summary.current).toMatchObject({
      key: "available",
      label: "Available now",
      activity: "free time",
    });
    expect(summary.counts.busy).toBe(1);
  });
});