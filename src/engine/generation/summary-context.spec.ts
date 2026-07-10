import { describe, expect, it } from "vitest";

import { buildSummaryContextProjection } from "./summary-context";

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("buildSummaryContextProjection", () => {
  it("projects a completed week without repeating its daily summaries", () => {
    const projection = buildSummaryContextProjection({
      chat: {
        mode: "conversation",
        metadata: {
          daySummaries: {
            "06.07.2026": { summary: "Monday detail", keyDetails: ["Monday promise"] },
            "12.07.2026": { summary: "Sunday detail", keyDetails: [] },
            "13.07.2026": { summary: "Next Monday detail", keyDetails: [] },
          },
          weekSummaries: {
            "06.07.2026": { summary: "Completed week arc", keyDetails: ["Weekly promise"] },
          },
        },
      },
      budgetTokens: 2048,
    });

    expect(projection.text).toContain("Week summary 06.07.2026");
    expect(projection.text).toContain("Completed week arc");
    expect(projection.text).toContain("Day summary 13.07.2026");
    expect(projection.text).not.toContain("Day summary 06.07.2026");
    expect(projection.text).not.toContain("Day summary 12.07.2026");
    expect(projection.omittedDailyCount).toBe(2);
    expect(projection.deduplicatedDailyCount).toBe(2);
    expect(projection.budgetOmittedDailyCount).toBe(0);
    expect(projection.coversPriorHistory).toBe(false);
  });

  it("does not treat one parseable daily summary as global history coverage", () => {
    const projection = buildSummaryContextProjection({
      chat: {
        metadata: {
          daySummaries: {
            "08.07.2026": { summary: "One summarized day", keyDetails: [] },
          },
        },
      },
      budgetTokens: 512,
    });

    expect(projection.text).toContain("One summarized day");
    expect(projection.coversPriorHistory).toBe(false);
  });

  it("does not treat one Monday weekly summary as global history coverage", () => {
    const projection = buildSummaryContextProjection({
      chat: {
        metadata: {
          weekSummaries: {
            "06.07.2026": { summary: "One summarized week", keyDetails: [] },
          },
        },
      },
      budgetTokens: 512,
    });

    expect(projection.text).toContain("One summarized week");
    expect(projection.coversPriorHistory).toBe(false);
  });

  it("fails closed when dated summaries have a gap", () => {
    const projection = buildSummaryContextProjection({
      chat: {
        metadata: {
          daySummaries: {
            "06.07.2026": { summary: "Monday", keyDetails: [] },
            "08.07.2026": { summary: "Wednesday", keyDetails: [] },
          },
        },
      },
      budgetTokens: 512,
    });

    expect(projection.text).toContain("Monday");
    expect(projection.text).toContain("Wednesday");
    expect(projection.coversPriorHistory).toBe(false);
  });

  it("keeps non-Monday week keys as content without treating them as completed week coverage", () => {
    const projection = buildSummaryContextProjection({
      chat: {
        metadata: {
          daySummaries: {
            "07.07.2026": { summary: "Tuesday daily detail", keyDetails: [] },
            "08.07.2026": { summary: "Wednesday daily detail", keyDetails: [] },
          },
          weekSummaries: {
            "07.07.2026": { summary: "Imported non-Monday week note", keyDetails: [] },
          },
        },
      },
      budgetTokens: 2048,
    });
    const nonMondayOnly = buildSummaryContextProjection({
      chat: {
        metadata: {
          weekSummaries: {
            "07.07.2026": { summary: "Imported non-Monday week note", keyDetails: [] },
          },
        },
      },
      budgetTokens: 2048,
    });

    expect(projection.text).toContain("Day summary 07.07.2026");
    expect(projection.text).toContain("Day summary 08.07.2026");
    expect(projection.text).toContain("Week summary 07.07.2026");
    expect(projection.omittedDailyCount).toBe(0);
    expect(nonMondayOnly.coversPriorHistory).toBe(false);
  });

  it("keeps high-priority rolling context and newest days within the deterministic budget", () => {
    const projection = buildSummaryContextProjection({
      chat: {
        mode: "conversation",
        metadata: {
          summaryEntries: [
            {
              id: "manual-note",
              kind: "rolling",
              origin: "manual",
              title: "Pinned continuity",
              content: "MANUAL CONTINUITY",
              enabled: true,
              sourceMode: "last",
              tokenEstimate: 4,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
          daySummaries: {
            "08.07.2026": { summary: `NEWEST ${"n".repeat(72)}`, keyDetails: [] },
            "07.07.2026": { summary: `OLDER ${"o".repeat(72)}`, keyDetails: [] },
            "06.07.2026": { summary: `OLDEST ${"x".repeat(72)}`, keyDetails: [] },
          },
        },
      },
      budgetTokens: 40,
    });

    expect(projection.text).toContain("MANUAL CONTINUITY");
    expect(projection.text).toContain("NEWEST");
    expect(projection.text).not.toContain("OLDEST");
    expect(projection.estimatedTokens).toBeLessThanOrEqual(40);
    expect((projection.text?.length ?? 0) / 4).toBeLessThanOrEqual(40);
  });

  it("never splits emoji surrogate pairs when truncating from the head or tail", () => {
    const headTruncated = buildSummaryContextProjection({
      chat: {
        metadata: {
          daySummaries: {
            "08.07.2026": { summary: `${"a".repeat(40)}😀tail`, keyDetails: [] },
          },
        },
      },
      budgetTokens: 16,
    });
    const tailTruncated = buildSummaryContextProjection({
      chat: {
        metadata: {
          summaryEntries: [
            {
              id: "emoji-note",
              kind: "rolling",
              origin: "manual",
              title: "Emoji continuity",
              content: `prefix😀${"x".repeat(63)}`,
              enabled: true,
              sourceMode: "last",
              tokenEstimate: 18,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
      },
      budgetTokens: 16,
    });

    expect(hasUnpairedSurrogate(headTruncated.text ?? "")).toBe(false);
    expect(hasUnpairedSurrogate(tailTruncated.text ?? "")).toBe(false);
    expect(headTruncated.estimatedTokens).toBeLessThanOrEqual(16);
    expect(tailTruncated.estimatedTokens).toBeLessThanOrEqual(16);
  });

  it("keeps malformed day keys eligible instead of silently discarding their summaries", () => {
    const projection = buildSummaryContextProjection({
      chat: {
        metadata: {
          daySummaries: {
            "not-a-date": { summary: "Imported undated continuity", keyDetails: ["Keep this fact"] },
          },
        },
      },
      budgetTokens: 512,
    });

    expect(projection.text).toContain("Day summary not-a-date");
    expect(projection.text).toContain("Imported undated continuity");
    expect(projection.omittedDailyCount).toBe(0);
    expect(projection.coversPriorHistory).toBe(false);
  });

  it("does not compact from rolling source metadata without a retained-tail boundary", () => {
    const baseEntry = {
      kind: "rolling",
      title: "Continuity",
      content: "Remember the lantern promise.",
      enabled: true,
      sourceMode: "last",
      tokenEstimate: 7,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const uncovered = buildSummaryContextProjection({
      chat: { metadata: { summaryEntries: [{ ...baseEntry, id: "manual", origin: "manual" }] } },
      budgetTokens: 512,
    });
    const covered = buildSummaryContextProjection({
      chat: {
        metadata: {
          summaryEntries: [{ ...baseEntry, id: "covered", origin: "manual", messageIds: ["message-1"] }],
        },
      },
      budgetTokens: 512,
    });

    expect(uncovered.coversPriorHistory).toBe(false);
    expect(covered.coversPriorHistory).toBe(false);
  });

  it("deduplicates a synthetic twelve-week projection while staying under budget", () => {
    const daySummaries: Record<string, unknown> = {};
    const weekSummaries: Record<string, unknown> = {};
    const start = Date.UTC(2026, 0, 5);
    for (let week = 0; week < 12; week += 1) {
      const monday = new Date(start + week * 7 * 86_400_000);
      const key = `${String(monday.getUTCDate()).padStart(2, "0")}.${String(monday.getUTCMonth() + 1).padStart(2, "0")}.${monday.getUTCFullYear()}`;
      daySummaries[key] = { summary: `duplicated daily ${week}`, keyDetails: [] };
      weekSummaries[key] = { summary: `weekly arc ${week}`, keyDetails: [] };
    }

    const projection = buildSummaryContextProjection({
      chat: { metadata: { daySummaries, weekSummaries } },
      budgetTokens: 8192,
    });

    expect(projection.text).not.toContain("duplicated daily");
    expect(projection.text).toContain("weekly arc 0");
    expect(projection.text).toContain("weekly arc 11");
    expect(projection.omittedDailyCount).toBe(12);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(8192);
  });
});
