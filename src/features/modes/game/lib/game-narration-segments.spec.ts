import { describe, expect, it } from "vitest";
import {
  effectDisplayLength,
  parseNarrationSegments,
  slicePreservingEffects,
  truncateMessageContentAtSegment,
  type NarrationMessage,
} from "./game-narration-segments";

function message(content: string): NarrationMessage {
  return {
    id: "m1",
    chatId: "c1",
    role: "assistant",
    content,
    characterId: null,
    extra: {
      displayText: null,
      isGenerated: true,
      tokenCount: null,
      generationInfo: null,
    },
  };
}

describe("game narration segment parsing", () => {
  it("parses narration, party dialogue, action remaps, and readable blocks", () => {
    const segments = parseNarrationSegments(
      message(
        [
          "Narration: The door opens.",
          '[Amber][main][happy]: "Ready!"',
          "[Paimon][action]: points at the door",
          "[Book: Field Notes [Chapter 1]]",
        ].join("\n"),
      ),
      new Map([["Amber", "#f80"]]),
    );

    expect(segments).toEqual([
      expect.objectContaining({ type: "narration", content: "The door opens." }),
      expect.objectContaining({
        type: "dialogue",
        speaker: "Amber",
        sprite: "happy",
        content: "Ready!",
        color: "#f80",
        partyType: "main",
      }),
      expect.objectContaining({ type: "narration", content: "points at the door" }),
      expect.objectContaining({
        type: "readable",
        content: "You find a book...",
        readableType: "book",
        readableContent: "Field Notes [Chapter 1]",
      }),
    ]);
  });

  it("truncates raw content at parsed segment boundaries without rewriting the prefix", () => {
    const raw = [
      "Narration: First beat.",
      "[Note: Keep this [nested] note]",
      '[Amber][main]: "Third beat."',
      "Narration: Fourth beat.",
    ].join("\n");

    expect(truncateMessageContentAtSegment(raw, 1)).toBe('Narration: First beat.\n[Note: Keep this [nested] note]');
    expect(truncateMessageContentAtSegment(raw, -1)).toBe("");
  });

  it("counts and slices effect-tagged text by visible characters", () => {
    expect(effectDisplayLength("A {shake:boom} now")).toBe("A boom now".length);
    expect(slicePreservingEffects("A {shake:boom} now", 5)).toBe("A {shake:boo}");
  });
});
