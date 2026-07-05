import { describe, expect, it } from "vitest";

import type { DialogueAttributionsExtra, MessageExtra } from "../../contracts/types/chat";
import {
  buildDialogueAttributions,
  createDialogueAttributionTextHash,
  validateDialogueAttributionsForText,
} from "./dialogue-attribution";

const speakers = [
  { id: "char-alice", name: "Alice" },
  { id: "char-bob", name: "Bob" },
  { id: "char-clara", name: "Clara" },
];

describe("dialogue attribution metadata", () => {
  it("keeps existing message extras valid without dialogue attribution metadata", () => {
    const extra = {
      displayText: null,
      isGenerated: true,
      tokenCount: null,
      generationInfo: null,
    } satisfies MessageExtra;

    expect(extra).not.toHaveProperty("dialogueAttributions");
  });

  it("uses a SHA-256 text hash for stale-range detection", () => {
    expect(createDialogueAttributionTextHash("abc")).toBe(
      "dk1:3:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("rejects attribution metadata when the text hash no longer matches", () => {
    const text = '"Careful," Alice said.';
    const metadata: DialogueAttributionsExtra = {
      version: 1,
      textHash: createDialogueAttributionTextHash(text),
      segments: [
        {
          start: 0,
          end: 10,
          speakerName: "Alice",
          speakerId: "char-alice",
          source: "explicit-attribution",
          confidence: "derived",
        },
      ],
    };

    expect(validateDialogueAttributionsForText(text, metadata)).not.toBeNull();
    expect(validateDialogueAttributionsForText(`${text} Edited.`, metadata)).toBeNull();
  });

  it("rejects restored segments that do not match the current speaker list", () => {
    const text = '"Careful," Alice said. "No," Mallory said.';
    const metadata = validateDialogueAttributionsForText(
      text,
      {
        version: 1,
        textHash: createDialogueAttributionTextHash(text),
        segments: [
          {
            start: 0,
            end: 10,
            speakerName: "Alice",
            speakerId: "char-alice",
            source: "explicit-attribution",
            confidence: "derived",
          },
          {
            start: 24,
            end: 29,
            speakerName: "Mallory",
            speakerId: "char-mallory",
            source: "explicit-attribution",
            confidence: "derived",
          },
        ],
      },
      speakers,
    );

    expect(metadata?.segments).toEqual([
      {
        start: 0,
        end: 10,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "explicit-attribution",
        confidence: "derived",
      },
    ]);
  });

  it("strips explicit speaker tags and records cleaned text ranges", () => {
    const result = buildDialogueAttributions(
      'Narration. <speaker name="Alice" characterId="char-alice">"We should go."</speaker> Bob waits.',
      speakers,
      { stripSpeakerTags: true },
    );

    expect(result.text).toBe('Narration. "We should go." Bob waits.');
    expect(result.attributions).toMatchObject({
      version: 1,
      textHash: createDialogueAttributionTextHash(result.text),
      segments: [
        {
          start: 11,
          end: 26,
          speakerName: "Alice",
          speakerId: "char-alice",
          source: "speaker-tag",
          confidence: "explicit",
        },
      ],
    });
  });

  it("attributes quoted dialogue to the explicit prose speaker instead of the nearest mention", () => {
    const result = buildDialogueAttributions('Alice watched Bob. "Careful," Alice said.', speakers, {
      includeDerivedProse: true,
    });

    expect(result.text).toBe('Alice watched Bob. "Careful," Alice said.');
    expect(result.attributions?.segments).toEqual([
      {
        start: 19,
        end: 29,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "explicit-attribution",
        confidence: "derived",
      },
    ]);
  });

  it("records name-prefix dialogue ranges as explicit attribution", () => {
    const result = buildDialogueAttributions("Alice: Ready.\nBob: Waiting.", speakers);

    expect(result.text).toBe("Alice: Ready.\nBob: Waiting.");
    expect(result.attributions?.segments).toEqual([
      {
        start: 7,
        end: 13,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "name-prefix",
        confidence: "explicit",
      },
      {
        start: 19,
        end: 27,
        speakerName: "Bob",
        speakerId: "char-bob",
        source: "name-prefix",
        confidence: "explicit",
      },
    ]);
  });

  it("strips a leading speaker prefix while preserving attribution on cleaned text", () => {
    const result = buildDialogueAttributions('Alice: "Ready."', speakers, {
      stripLeadingSpeakerPrefix: true,
    });

    expect(result.text).toBe('"Ready."');
    expect(result.attributions).toMatchObject({
      version: 1,
      textHash: createDialogueAttributionTextHash(result.text),
      segments: [
        {
          start: 0,
          end: result.text.length,
          speakerName: "Alice",
          speakerId: "char-alice",
          source: "name-prefix",
          confidence: "explicit",
        },
      ],
    });
  });

  it("does not record name-prefix ranges inside fenced or indented code", () => {
    const text = ["```text", "Alice: not dialogue", "```", "    Clara: also code", "Bob: Real."].join("\n");
    const result = buildDialogueAttributions(text, speakers);

    expect(result.attributions?.segments).toEqual([
      {
        start: text.indexOf("Real."),
        end: text.indexOf("Real.") + "Real.".length,
        speakerName: "Bob",
        speakerId: "char-bob",
        source: "name-prefix",
        confidence: "explicit",
      },
    ]);
  });

  it("does not duplicate derived attribution inside explicit name-prefix ranges", () => {
    const result = buildDialogueAttributions('Alice: "Ready," Alice said.', speakers, {
      includeDerivedProse: true,
    });

    expect(result.attributions?.segments).toEqual([
      {
        start: 7,
        end: 27,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "name-prefix",
        confidence: "explicit",
      },
    ]);
  });

  it("does not derive attribution for ambiguous mention-only prose", () => {
    const result = buildDialogueAttributions('Alice looked at Bob. "Careful."', speakers, {
      includeDerivedProse: true,
    });

    expect(result.text).toBe('Alice looked at Bob. "Careful."');
    expect(result.attributions).toBeNull();
  });

  it("normalizes ranges by clamping invalid spans and sorting valid segments", () => {
    const text = "Alice: Ready.\nBob: Waiting.";
    const metadata = validateDialogueAttributionsForText(text, {
      version: 1,
      textHash: createDialogueAttributionTextHash(text),
      segments: [
        {
          start: 15,
          end: 99,
          speakerName: "Bob",
          speakerId: "char-bob",
          source: "name-prefix",
          confidence: "explicit",
        },
        {
          start: -4,
          end: 0,
          speakerName: "Nobody",
          source: "postprocess",
          confidence: "derived",
        },
        {
          start: 7,
          end: 13,
          speakerName: "Alice",
          speakerId: "char-alice",
          source: "name-prefix",
          confidence: "explicit",
        },
      ],
    });

    expect(metadata?.segments).toEqual([
      {
        start: 7,
        end: 13,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "name-prefix",
        confidence: "explicit",
      },
      {
        start: 15,
        end: text.length,
        speakerName: "Bob",
        speakerId: "char-bob",
        source: "name-prefix",
        confidence: "explicit",
      },
    ]);
  });
});
