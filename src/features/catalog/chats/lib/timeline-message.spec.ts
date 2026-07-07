import { describe, expect, it } from "vitest";

import { timelineMessageProjection, sanitizeTimelineMessageRecord } from "./timeline-message";

describe("timelineMessageProjection", () => {
  it("keeps dialogue attribution metadata available for transcript rendering", () => {
    const projection = timelineMessageProjection();

    expect(projection.fieldSelections?.extra).toContain("dialogueAttributions");
  });
});

describe("sanitizeTimelineMessageRecord", () => {
  it("preserves dialogue attributions while removing oversized prompt snapshot maps", () => {
    const dialogueAttributions = {
      version: 1,
      textHash: "dk1:8:test",
      segments: [
        {
          start: 0,
          end: 8,
          speakerName: "Aster",
          speakerId: "character-1",
          source: "explicit-attribution",
          confidence: "derived",
        },
      ],
    };

    const sanitized = sanitizeTimelineMessageRecord({
      id: "message-1",
      swipes: [{ content: '"Ready."' }],
      extra: {
        dialogueAttributions,
        generationPromptSnapshotsBySwipe: { 0: { messages: [] } },
      },
    });

    expect(sanitized).not.toHaveProperty("swipes");
    expect(sanitized.extra).toEqual({ dialogueAttributions });
  });
});
