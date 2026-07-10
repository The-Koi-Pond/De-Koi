import { describe, expect, it } from "vitest";

import { timelineMessageProjection, sanitizeTimelineMessageRecord } from "./timeline-message";

describe("timelineMessageProjection", () => {
  it("does not request retired dialogue attribution metadata", () => {
    const projection = timelineMessageProjection();

    expect(projection.fieldSelections?.extra).not.toContain("dialogueAttributions");
  });
});

describe("sanitizeTimelineMessageRecord", () => {
  it("removes oversized prompt snapshot maps", () => {
    const sanitized = sanitizeTimelineMessageRecord({
      id: "message-1",
      swipes: [{ content: '"Ready."' }],
      extra: {
        generationPromptSnapshotsBySwipe: { 0: { messages: [] } },
      },
    });

    expect(sanitized).not.toHaveProperty("swipes");
    expect(sanitized.extra).toEqual({});
  });
});
