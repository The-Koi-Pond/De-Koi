import { describe, expect, it } from "vitest";

import type { DialogueAttributionsExtra } from "../../../../../engine/contracts/types/chat";
import { createDialogueAttributionTextHash } from "../../../../../engine/shared/text/dialogue-attribution";
import { createSpeakerColorLookup, splitSpeakerDialogueColorSegments } from "./speaker-dialogue-colors";

describe("speaker dialogue colors", () => {
  it("uses each speaker tag color case-insensitively on repeated renders", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);
    const text = '<speaker="alice">"First."</speaker> <speaker="BOB">"Second."</speaker>';

    expect(splitSpeakerDialogueColorSegments(text, "#ffffff", colors)).toEqual([
      { text: '"First."', color: "#ff3366" },
      { text: " ", color: "#ffffff" },
      { text: '"Second."', color: "#33aaff" },
    ]);
    expect(splitSpeakerDialogueColorSegments(text, "#ffffff", colors)).toEqual([
      { text: '"First."', color: "#ff3366" },
      { text: " ", color: "#ffffff" },
      { text: '"Second."', color: "#33aaff" },
    ]);
  });

  it("colors narrator-style name-prefixed dialogue by the current speaker", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);

    expect(splitSpeakerDialogueColorSegments('Alice: "Ready."\nBob: "Always."', "#ffffff", colors)).toEqual([
      { text: "Alice: ", color: "#ffffff" },
      { text: '"Ready."\n', color: "#ff3366" },
      { text: "Bob: ", color: "#ffffff" },
      { text: '"Always."', color: "#33aaff" },
    ]);
  });

  it("colors attributed narrator quotes by the nearest named speaker", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments('Alice leaned closer. "Ready." Bob smiled. "Always."', "#ffffff", colors),
    ).toEqual([
      { text: "Alice leaned closer. ", color: "#ffffff" },
      { text: '"Ready."', color: "#ff3366" },
      { text: " Bob smiled. ", color: "#ffffff" },
      { text: '"Always."', color: "#33aaff" },
    ]);
  });

  it("does not let a mentioned non-speaker steal the next quote color", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments('Alice watches Bob cross the room. "Stay close."', "#ffffff", colors),
    ).toEqual([
      { text: "Alice watches Bob cross the room. ", color: "#ffffff" },
      { text: '"Stay close."', color: "#ff3366" },
    ]);
  });

  it("keeps the previous speaker color across same-attribution quote continuations", () => {
    const colors = createSpeakerColorLookup([
      ["Harlequin", "#00ff66"],
      ["Jester", "#aa77ff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments(
        'Harlequin leans close. "Oh, I want to hear this," he murmurs. "Please make it official." Jester ignores him.',
        "#ffffff",
        colors,
      ),
    ).toEqual([
      { text: "Harlequin leans close. ", color: "#ffffff" },
      { text: '"Oh, I want to hear this,"', color: "#00ff66" },
      { text: " he murmurs. ", color: "#ffffff" },
      { text: '"Please make it official."', color: "#00ff66" },
      { text: " Jester ignores him.", color: "#ffffff" },
    ]);
  });

  it("prefers the speaking subject over a later addressed character name", () => {
    const colors = createSpeakerColorLookup([
      ["Harlequin", "#00ff66"],
      ["Jester", "#aa77ff"],
    ]);

    expect(splitSpeakerDialogueColorSegments('Harlequin tells Jester, "Sign here."', "#ffffff", colors)).toEqual([
      { text: "Harlequin tells Jester, ", color: "#ffffff" },
      { text: '"Sign here."', color: "#00ff66" },
    ]);
  });

  it("does not treat straight double quotes in height measurements as dialogue delimiters", () => {
    const colors = createSpeakerColorLookup([
      ["Doctor", "#00ddff"],
      ["Jester", "#aa77ff"],
    ]);

    expect(
      splitSpeakerDialogueColorSegments(
        'Doctor stood 6\'9" tall, his hands still. "On time." Doctor observed.',
        "#ffffff",
        colors,
      ),
    ).toEqual([
      { text: "Doctor stood 6'9\" tall, his hands still. ", color: "#ffffff" },
      { text: '"On time."', color: "#00ddff" },
      { text: " Doctor observed.", color: "#ffffff" },
    ]);
  });

  it("uses matching attribution metadata before mention heuristics", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);
    const text = 'Alice watched Bob. "Careful."';
    const metadata: DialogueAttributionsExtra = {
      version: 1,
      textHash: createDialogueAttributionTextHash(text),
      segments: [
        {
          start: 19,
          end: 29,
          speakerName: "Bob",
          speakerId: "character-bob",
          source: "postprocess",
          confidence: "explicit",
        },
      ],
    };

    expect(splitSpeakerDialogueColorSegments(text, "#ffffff", colors, metadata)).toEqual([
      { text: "Alice watched Bob. ", color: "#ffffff" },
      { text: '"Careful."', color: "#33aaff" },
    ]);
  });

  it("ignores attribution metadata with a stale text hash", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);
    const text = 'Alice watched Bob. "Careful."';
    const metadata: DialogueAttributionsExtra = {
      version: 1,
      textHash: createDialogueAttributionTextHash(`${text} changed`),
      segments: [
        {
          start: 19,
          end: 29,
          speakerName: "Bob",
          speakerId: "character-bob",
          source: "postprocess",
          confidence: "explicit",
        },
      ],
    };

    expect(splitSpeakerDialogueColorSegments(text, "#ffffff", colors, metadata)).toEqual([
      { text: "Alice watched Bob. ", color: "#ffffff" },
      { text: '"Careful."', color: "#ff3366" },
    ]);
  });

  it("colors only attribution ranges when matching metadata is present", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);
    const text = 'Narration. "First." More narration. "Second."';
    const metadata: DialogueAttributionsExtra = {
      version: 1,
      textHash: createDialogueAttributionTextHash(text),
      segments: [
        {
          start: 11,
          end: 19,
          speakerName: "Alice",
          speakerId: "character-alice",
          source: "postprocess",
          confidence: "explicit",
        },
        {
          start: 36,
          end: 45,
          speakerName: "Bob",
          speakerId: "character-bob",
          source: "postprocess",
          confidence: "explicit",
        },
      ],
    };

    expect(splitSpeakerDialogueColorSegments(text, "#ffffff", colors, metadata)).toEqual([
      { text: "Narration. ", color: "#ffffff" },
      { text: '"First."', color: "#ff3366" },
      { text: " More narration. ", color: "#ffffff" },
      { text: '"Second."', color: "#33aaff" },
    ]);
  });
});
