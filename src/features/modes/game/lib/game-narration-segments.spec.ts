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

  it("keeps inline readable blocks in parsed order with surrounding narration", () => {
    const segments = parseNarrationSegments(
      message("Narration: The shelf holds [Note: First clue] beside [Book: Field Notes] now."),
      new Map(),
    );

    expect(segments).toEqual([
      expect.objectContaining({ type: "narration", content: "The shelf holds" }),
      expect.objectContaining({ type: "readable", readableType: "note", readableContent: "First clue" }),
      expect.objectContaining({ type: "narration", content: "beside" }),
      expect.objectContaining({ type: "readable", readableType: "book", readableContent: "Field Notes" }),
      expect.objectContaining({ type: "narration", content: "now." }),
    ]);
  });

  it("preserves inline dialogue attribution and aligns truncation to rendered segments", () => {
    const raw = '"Hi," Amber said. The torch flared. "Careful," Lisa whispered. Tail.';
    const segments = parseNarrationSegments(message(raw), new Map([["Amber", "#f80"]]));

    expect(segments).toEqual([
      expect.objectContaining({ type: "dialogue", speaker: "Amber", content: '"Hi," Amber said.', color: "#f80" }),
      expect.objectContaining({ type: "narration", content: "The torch flared." }),
      expect.objectContaining({ type: "dialogue", speaker: "Lisa", content: '"Careful," Lisa whispered.' }),
      expect.objectContaining({ type: "narration", content: "Tail." }),
    ]);
    expect(truncateMessageContentAtSegment(raw, 0)).toBe('"Hi," Amber said.');
    expect(truncateMessageContentAtSegment(raw, 1)).toBe('"Hi," Amber said. The torch flared.');
    expect(truncateMessageContentAtSegment(raw, 2)).toBe('"Hi," Amber said. The torch flared. "Careful," Lisa whispered.');
    expect(truncateMessageContentAtSegment(raw, 3)).toBe(raw);
  });

  it("splits mixed readable and inline-dialogue narration the same way truncation counts it", () => {
    const raw = ['Narration: Intro.', "[Note: First clue]", '"Hi," Amber said. Tail.'].join("\n");
    const segments = parseNarrationSegments(message(raw), new Map());

    expect(segments).toEqual([
      expect.objectContaining({ type: "narration", content: "Intro." }),
      expect.objectContaining({ type: "readable", readableType: "note", readableContent: "First clue" }),
      expect.objectContaining({ type: "dialogue", speaker: "Amber", content: '"Hi," Amber said.' }),
      expect.objectContaining({ type: "narration", content: "Tail." }),
    ]);
    expect(truncateMessageContentAtSegment(raw, 0)).toBe("Narration: Intro.");
    expect(truncateMessageContentAtSegment(raw, 1)).toBe("Narration: Intro.\n[Note: First clue]");
    expect(truncateMessageContentAtSegment(raw, 2)).toBe('Narration: Intro.\n[Note: First clue]\n"Hi," Amber said.');
    expect(truncateMessageContentAtSegment(raw, 3)).toBe(raw);
  });

  it("counts and slices effect-tagged text by visible characters", () => {
    expect(effectDisplayLength("A {shake:boom} now")).toBe("A boom now".length);
    expect(slicePreservingEffects("A {shake:boom} now", 5)).toBe("A {shake:boo}");
  });
});
