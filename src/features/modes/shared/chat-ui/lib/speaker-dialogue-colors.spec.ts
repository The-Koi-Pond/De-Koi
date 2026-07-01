import { describe, expect, it } from "vitest";

import {
  createSpeakerColorLookup,
  splitSpeakerDialogueColorSegments,
} from "./speaker-dialogue-colors";

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
});
