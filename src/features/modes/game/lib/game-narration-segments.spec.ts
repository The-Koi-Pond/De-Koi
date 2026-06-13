import { describe, expect, it } from "vitest";
import type { Message } from "../../../../engine/contracts/types/chat";
import {
  effectDisplayLength,
  parseNarrationSegments,
  slicePreservingEffects,
  truncateMessageContentAtSegment,
  type NarrationMessage,
} from "./game-narration-segments";

function message(content: string, role: Message["role"] = "assistant"): NarrationMessage {
  return {
    id: "m1",
    chatId: "c1",
    role,
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

  it("stamps parsed segments with source identity and rendered indexes", () => {
    const segments = parseNarrationSegments(
      message(
        [
          "Narration: Start.",
          "[Note: First clue]",
          '[Amber][main]: "Ready."',
          '"Hi," Lisa said.',
        ].join("\n"),
        "user",
      ),
      new Map(),
    );

    expect(segments).toEqual([
      expect.objectContaining({ type: "narration", content: "Start." }),
      expect.objectContaining({ type: "readable", readableContent: "First clue" }),
      expect.objectContaining({ type: "dialogue", speaker: "Amber", content: "Ready." }),
      expect.objectContaining({ type: "dialogue", speaker: "Lisa", content: '"Hi," Lisa said.' }),
    ]);
    expect(segments.map((segment) => segment.sourceMessageId)).toEqual(["m1", "m1", "m1", "m1"]);
    expect(segments.map((segment) => segment.sourceRole)).toEqual(["user", "user", "user", "user"]);
    expect(segments.map((segment) => segment.sourceSegmentIndex)).toEqual([0, 1, 2, 3]);
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

  it("preserves dialogue metadata while splitting readable blocks inside compact dialogue lines", () => {
    const raw = '[Amber][main]: "See [Note: clue] on the desk."';
    const segments = parseNarrationSegments(message(raw), new Map([["Amber", "#f80"]]));

    expect(segments).toEqual([
      expect.objectContaining({
        type: "dialogue",
        speaker: "Amber",
        content: "See",
        color: "#f80",
        sourceMessageId: "m1",
        sourceSegmentIndex: 0,
        sourceRole: "assistant",
      }),
      expect.objectContaining({
        type: "readable",
        readableType: "note",
        readableContent: "clue",
        sourceSegmentIndex: 1,
      }),
      expect.objectContaining({
        type: "dialogue",
        speaker: "Amber",
        content: "on the desk.",
        color: "#f80",
        sourceSegmentIndex: 2,
      }),
    ]);
    expect(truncateMessageContentAtSegment(raw, 0)).toBe('[Amber][main]: "See ');
    expect(truncateMessageContentAtSegment(raw, 1)).toBe('[Amber][main]: "See [Note: clue]');
    expect(truncateMessageContentAtSegment(raw, 2)).toBe(raw);
  });

  it("preserves dialogue metadata while splitting readable blocks inside legacy dialogue lines", () => {
    const segments = parseNarrationSegments(message('Dialogue [Amber]: "See [Book: field notes] later."'), new Map());

    expect(segments).toEqual([
      expect.objectContaining({ type: "dialogue", speaker: "Amber", content: "See", sourceSegmentIndex: 0 }),
      expect.objectContaining({ type: "readable", readableType: "book", readableContent: "field notes", sourceSegmentIndex: 1 }),
      expect.objectContaining({ type: "dialogue", speaker: "Amber", content: "later.", sourceSegmentIndex: 2 }),
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
