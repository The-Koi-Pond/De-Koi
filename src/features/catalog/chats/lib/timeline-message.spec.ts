import { describe, expect, it } from "vitest";

import { timelineMessageProjection, sanitizeTimelineMessageRecord } from "./timeline-message";

describe("timelineMessageProjection", () => {
  it("does not request retired dialogue attribution metadata", () => {
    const projection = timelineMessageProjection();

    expect(projection.fieldSelections?.extra).not.toContain("dialogueAttributions");
  });

  it("requests character web research metadata needed after timeline refresh", () => {
    const projection = timelineMessageProjection();

    expect(projection.fieldSelections?.extra).toEqual(
      expect.arrayContaining(["characterWebResearchRequest", "characterWebResearchSources"]),
    );
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

  it.each(["dialogueAttributions", "dialogueAttribution", "speakerAttributions", "speakerAttribution"])(
    "discards retired speaker metadata from timeline extras: %s",
    (retiredField) => {
      const sanitized = sanitizeTimelineMessageRecord({
        id: "message-legacy-speaker-metadata",
        extra: {
          displayText: "Visible text",
          [retiredField]: { segments: [{ speakerName: "Aster", start: 0, end: 12 }] },
        },
      });

      expect(sanitized.extra).toEqual({ displayText: "Visible text" });
      expect(sanitized.extra).not.toHaveProperty(retiredField);
    },
  );

  it("discards retired speaker metadata from serialized timeline extras", () => {
    const sanitized = sanitizeTimelineMessageRecord({
      id: "message-serialized-legacy-speaker-metadata",
      extra: JSON.stringify({
        thinking: "kept",
        dialogueAttributions: { segments: [] },
        speakerAttribution: { speakerName: "Aster" },
      }),
    });

    expect(sanitized.extra).toEqual({ thinking: "kept" });
  });
});
