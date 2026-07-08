import { describe, expect, it } from "vitest";

import { createDialogueAttributionTextHash } from "../../../../../engine/shared/text/dialogue-attribution";
import { createSpeakerColorLookup, splitSpeakerDialogueColorSegments } from "./speaker-dialogue-colors";

describe("speaker dialogue colors", () => {
  it("colors dialogue from stored attribution spans", () => {
    const colors = createSpeakerColorLookup([
      ["Alice", "#ff3366"],
      ["Bob", "#33aaff"],
    ]);
    const text = 'Alice leaned closer. "Ready." Bob smiled. "Always."';

    expect(
      splitSpeakerDialogueColorSegments(text, "#ffffff", colors, {
        version: 1,
        textHash: createDialogueAttributionTextHash(text),
        segments: [
          {
            start: 21,
            end: 29,
            speakerName: "Alice",
            speakerId: "alice",
            source: "sidecar-model",
            confidence: "derived",
          },
          { start: 42, end: 51, speakerName: "Bob", speakerId: "bob", source: "sidecar-model", confidence: "derived" },
        ],
      }),
    ).toEqual([
      { text: "Alice leaned closer. ", color: "#ffffff" },
      { text: '"Ready."', color: "#ff3366" },
      { text: " Bob smiled. ", color: "#ffffff" },
      { text: '"Always."', color: "#33aaff" },
    ]);
  });


  it("prefers stable speaker ids over duplicate display names", () => {
    const colors = createSpeakerColorLookup([
      { id: "char-a", names: ["Twin"], color: "#ff3366" },
      { id: "char-b", names: ["Twin"], color: "#33aaff" },
    ]);
    const text = '"First." "Second."';

    expect(
      splitSpeakerDialogueColorSegments(text, "#ffffff", colors, {
        version: 1,
        textHash: createDialogueAttributionTextHash(text),
        segments: [
          { start: 0, end: 8, speakerName: "Twin", speakerId: "char-a", source: "speaker-tag", confidence: "explicit" },
          { start: 9, end: 18, speakerName: "Twin", speakerId: "char-b", source: "speaker-tag", confidence: "explicit" },
        ],
      }),
    ).toEqual([
      { text: '"First."', color: "#ff3366" },
      { text: " ", color: "#ffffff" },
      { text: '"Second."', color: "#33aaff" },
    ]);
  });

  it("uses stable speaker ids when display names have changed", () => {
    const colors = createSpeakerColorLookup([{ id: "char-a", names: ["Alicia"], color: "#ff3366" }]);
    const text = '"Still me."';

    expect(
      splitSpeakerDialogueColorSegments(text, "#ffffff", colors, {
        version: 1,
        textHash: createDialogueAttributionTextHash(text),
        segments: [
          { start: 0, end: text.length, speakerName: "Alice", speakerId: "char-a", source: "speaker-tag", confidence: "explicit" },
        ],
      }),
    ).toEqual([{ text, color: "#ff3366" }]);
  });

  it("uses aliases in the color map without inferring ownership from prose", () => {
    const colors = createSpeakerColorLookup([["The Archivist", "#b58cff"]]);
    const text = '"Welcome," the archivist said.';

    expect(
      splitSpeakerDialogueColorSegments(text, "#ffffff", colors, {
        version: 1,
        textHash: createDialogueAttributionTextHash(text),
        segments: [{ start: 0, end: 10, speakerName: "The Archivist", source: "sidecar-model", confidence: "derived" }],
      }),
    ).toEqual([
      { text: '"Welcome,"', color: "#b58cff" },
      { text: " the archivist said.", color: "#ffffff" },
    ]);
  });

  it("does not color attributed prose without stored spans", () => {
    const colors = createSpeakerColorLookup([["Alice", "#ff3366"]]);

    expect(splitSpeakerDialogueColorSegments('Alice leaned closer. "Ready."', "#ffffff", colors)).toEqual([
      { text: 'Alice leaned closer. "Ready."', color: "#ffffff" },
    ]);
  });

  it("renders stale attribution as the default color", () => {
    const colors = createSpeakerColorLookup([["Alice", "#ff3366"]]);
    const original = 'Alice leaned closer. "Ready."';
    const changed = 'Alice leaned closer. "Ready!"';

    expect(
      splitSpeakerDialogueColorSegments(changed, "#ffffff", colors, {
        version: 1,
        textHash: createDialogueAttributionTextHash(original),
        segments: [{ start: 21, end: 29, speakerName: "Alice", source: "sidecar-model", confidence: "derived" }],
      }),
    ).toEqual([{ text: changed, color: "#ffffff" }]);
  });
});
