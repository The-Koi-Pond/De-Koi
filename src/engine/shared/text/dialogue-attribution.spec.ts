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

  it("attributes named and bare speaker tag forms over stripped text", () => {
    const named = buildDialogueAttributions('<speaker name="Alice">"Hi."</speaker>', speakers, {
      stripSpeakerTags: true,
    });
    const bare = buildDialogueAttributions('<speaker="Alice">"Hi."</speaker>', speakers, {
      stripSpeakerTags: true,
    });

    for (const result of [named, bare]) {
      expect(result.text).toBe('"Hi."');
      expect(result.attributions).toEqual({
        version: 1,
        textHash: createDialogueAttributionTextHash('"Hi."'),
        segments: [
          {
            start: 0,
            end: 5,
            speakerName: "Alice",
            speakerId: "char-alice",
            source: "speaker-tag",
            confidence: "explicit",
          },
        ],
      });
    }
  });

  it("strips nested speaker tags without residual markup", () => {
    const result = buildDialogueAttributions(
      '<speaker name="Alice">Outer <speaker name="Bob">Inner</speaker> tail</speaker>',
      speakers,
      { stripSpeakerTags: true },
    );

    expect(result.text).toBe("Outer Inner tail");
    expect(result.attributions?.segments).toEqual([
      {
        start: 0,
        end: 6,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "speaker-tag",
        confidence: "explicit",
      },
      {
        start: 6,
        end: 11,
        speakerName: "Bob",
        speakerId: "char-bob",
        source: "speaker-tag",
        confidence: "explicit",
      },
      {
        start: 11,
        end: 16,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "speaker-tag",
        confidence: "explicit",
      },
    ]);
  });

  it("strips incomplete and orphan speaker markers without dropping recoverable text", () => {
    const unclosed = buildDialogueAttributions('<speaker="Alice">Hello', speakers, { stripSpeakerTags: true });
    const splitOpener = buildDialogueAttributions('Hello <speaker name="Alice"', speakers, { stripSpeakerTags: true });
    const orphanClose = buildDialogueAttributions('Hello</speaker> tail', speakers, { stripSpeakerTags: true });

    expect(unclosed.text).toBe("Hello");
    expect(unclosed.attributions?.segments).toEqual([
      {
        start: 0,
        end: 5,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "speaker-tag",
        confidence: "explicit",
      },
    ]);
    expect(splitOpener.text).toBe("Hello ");
    expect(splitOpener.attributions).toBeNull();
    expect(orphanClose.text).toBe("Hello tail");
    expect(orphanClose.attributions).toBeNull();
  });

  it("strips malformed complete speaker tags while preserving inner text", () => {
    const malformedEquals = buildDialogueAttributions('<speaker=Alice>Hello</speaker>', speakers, {
      stripSpeakerTags: true,
    });
    const malformedSpace = buildDialogueAttributions('<speaker Alice>Hello</speaker>', speakers, {
      stripSpeakerTags: true,
    });
    const uppercaseBare = buildDialogueAttributions('<Speaker="Alice">Hello</speaker>', speakers, {
      stripSpeakerTags: true,
    });

    expect(malformedEquals.text).toBe("Hello");
    expect(malformedEquals.attributions).toBeNull();
    expect(malformedSpace.text).toBe("Hello");
    expect(malformedSpace.attributions).toBeNull();
    expect(uppercaseBare.text).toBe("Hello");
    expect(uppercaseBare.attributions?.segments).toEqual([
      {
        start: 0,
        end: 5,
        speakerName: "Alice",
        speakerId: "char-alice",
        source: "speaker-tag",
        confidence: "explicit",
      },
    ]);
  });

  it("preserves non-markup content around malformed Phase 2 inputs", () => {
    const specialSpeakers = [
      ...speakers,
      { id: "char-special", name: 'Dr. A+B: Ω' },
      { id: "char-quote", name: 'Anna "Ace"' },
    ];
    const special = buildDialogueAttributions('<speaker name="Dr. A+B: Ω">Hi</speaker>', specialSpeakers, {
      stripSpeakerTags: true,
    });
    const quotedName = buildDialogueAttributions('<speaker name=\'Anna "Ace"\'>Yo</speaker>', specialSpeakers, {
      stripSpeakerTags: true,
    });
    const warning = buildDialogueAttributions("Warning: the bridge is out.", specialSpeakers, {
      stripLeadingSpeakerPrefix: true,
    });
    const tagLikeQuote = buildDialogueAttributions('She said "<speaker name=\'Alice\'>hello</speaker>".', speakers, {
      stripSpeakerTags: true,
    });

    expect(special.text).toBe("Hi");
    expect(special.attributions?.segments[0]).toMatchObject({ speakerName: 'Dr. A+B: Ω', start: 0, end: 2 });
    expect(quotedName.text).toBe("Yo");
    expect(quotedName.attributions?.segments[0]).toMatchObject({ speakerName: 'Anna "Ace"', start: 0, end: 2 });
    expect(warning.text).toBe("Warning: the bridge is out.");
    expect(warning.attributions).toBeNull();
    expect(tagLikeQuote.text).toBe('She said "hello".');
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

  it("attributes by closest nearby character name without requiring a speech verb", () => {
    const result = buildDialogueAttributions('Alice looked at Bob. "Careful."', speakers, {
      includeDerivedProse: true,
    });

    expect(result.text).toBe('Alice looked at Bob. "Careful."');
    expect(result.attributions?.segments).toEqual([
      {
        start: 21,
        end: 31,
        speakerName: "Bob",
        speakerId: "char-bob",
        source: "explicit-attribution",
        confidence: "derived",
      },
    ]);
  });


  it("carries attribution across consecutive same-speaker quotes in one speech block", () => {
    const text =
      '"Jester?" Alice murmured, her voice dropping into genuine caution. "Jester is not an animal."';
    const result = buildDialogueAttributions(text, speakers, { includeDerivedProse: true });

    expect(result.attributions?.segments.map((segment) => segment.speakerName)).toEqual(["Alice", "Alice"]);
  });

  it("breaks nearby-name attribution ties by closest character name", () => {
    const text = [
      'Alice watches as Bob folds beside the curtain, "The cage was already open."',
      '"Stay still," Bob turns in place while Alice watches from the ring.',
    ].join("\n\n");
    const result = buildDialogueAttributions(text, speakers, { includeDerivedProse: true });

    expect(result.attributions?.segments.map((segment) => segment.speakerName)).toEqual(["Bob", "Bob"]);
  });

  it("does not guess when closest nearby character names are equidistant", () => {
    const result = buildDialogueAttributions('Alice "The room is too quiet." Bob', speakers, {
      includeDerivedProse: true,
    });

    expect(result.attributions).toBeNull();
  });

  it("uses the prior paragraph for pronoun-attributed quotes when it has one speaker name", () => {
    const text = [
      "A sharp, breathy hiss escapes Alice's throat at your invitation, her eyes widening in delight.",
      '"Oh... you want to look inside the serpent\'s mouth, darling?" she purrs, her voice dropping into a raspy register. "You really do have a death wish."',
      "With a fluid twist, Alice slides her torso further over Bob's shoulder.",
    ].join("\n\n");
    const result = buildDialogueAttributions(text, speakers, { includeDerivedProse: true });

    expect(result.attributions?.segments.map((segment) => segment.speakerName)).toEqual(["Alice", "Alice"]);
  });

  it("ignores possessive character names for proximity and carry-forward blocking", () => {
    const text =
      '"Look at him," Alice mocks, poking the side of Bob\'s rigid cap until the bells jingle. "You\'ve broken his spirit."';
    const result = buildDialogueAttributions(text, speakers, { includeDerivedProse: true });

    expect(result.attributions?.segments.map((segment) => segment.speakerName)).toEqual(["Alice", "Alice"]);
  });

  it("can use one following paragraph as speaker evidence when it has one non-possessive name", () => {
    const text = [
      '"My... my dear... you call me pretty... even while I hold the steel to your chest..."',
      "Bob leans his face down, nuzzling back against your forehead.",
      "But behind him, Alice is looking at you with a chilling intensity.",
    ].join("\n\n");
    const result = buildDialogueAttributions(text, speakers, { includeDerivedProse: true });

    expect(result.attributions?.segments.map((segment) => segment.speakerName)).toEqual(["Bob"]);
  });

  it("does not use surrounding paragraph evidence when multiple non-possessive names qualify", () => {
    const text = [
      "Alice watches Bob from the ring.",
      '"The room is too quiet," she says.',
      "Bob turns while Alice smiles.",
    ].join("\n\n");
    const result = buildDialogueAttributions(text, speakers, { includeDerivedProse: true });

    expect(result.attributions).toBeNull();
  });

  it("attributes observed roleplay speech verbs and carries through the same paragraph", () => {
    const text = [
      '"More..." Alice growls, her voice muffled against your skin. "You really want us to take a piece of you?"',
      '"Good...?" Alice repeats the word as if trying to recall a foreign language. "You are asking if we are enjoying the meal?"',
      '"We are forbidden from taking what is not permitted," Bob rumbles, his voice shaking your bones. "The Master keeps us on a very short leash."',
      '"It is a starvation you cannot possibly comprehend," Bob gasps, his breath hot against your skin. "And you have just opened the cage."',
    ].join("\n\n");
    const result = buildDialogueAttributions(text, speakers, { includeDerivedProse: true });

    expect(result.attributions?.segments.map((segment) => segment.speakerName)).toEqual([
      "Alice",
      "Alice",
      "Alice",
      "Alice",
      "Bob",
      "Bob",
      "Bob",
      "Bob",
    ]);
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
