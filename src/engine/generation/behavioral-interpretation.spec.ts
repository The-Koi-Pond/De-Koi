import { describe, expect, it } from "vitest";
import type { CharacterBehavioralInterpretation, CharacterData } from "../contracts/types/character";
import {
  BEHAVIORAL_INTERPRETATION_VERSION,
  assessCharacterRichness,
  behavioralInterpretationSourceHash,
  isBehavioralInterpretationCurrent,
  packBehavioralInterpretation,
  validateBehavioralInterpretation,
} from "./behavioral-interpretation";

function card(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name: "Mira",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    tags: [],
    creator: "",
    character_version: "",
    alternate_greetings: [],
    extensions: {
      talkativeness: 0.5,
      fav: false,
      world: "",
      depth_prompt: { prompt: "", depth: 4, role: "system" },
      backstory: "",
      appearance: "",
    },
    character_book: null,
    ...overrides,
  };
}

describe("behavioral interpretation source contract", () => {
  it("classifies stable sparse and rich fixtures explainably", () => {
    const sparse = assessCharacterRichness(
      card({
        description: "A guarded courier who jokes when nervous.",
        first_mes: '"Wrong address," Mira says, hiding the letter.',
      }),
    );
    const rich = assessCharacterRichness(
      card({
        description:
          "Mira is a meticulous courier who avoids direct answers about missing mail. She masks fear with dry jokes and checks every exit before speaking.",
        personality:
          "Guarded, observant, stubbornly ethical, and uncomfortable with praise. Under pressure she becomes formal and redirects personal questions.",
        scenario:
          "A rain-soaked archive after a sealed letter vanished. Mira must work beside the user while deciding which officials can be trusted.",
        first_mes:
          'Mira checks the wax seal twice. "Ask about the weather if anyone enters. The letter does not exist until I know who followed you."',
        mes_example:
          '<START>\n{{user}}: Are you frightened?\n{{char}}: "Of paperwork? Terrified." Mira checks the lock instead of meeting their eyes.',
        system_prompt: "Keep Mira indirect about the missing letter unless direct evidence forces disclosure.",
      }),
    );

    expect(sparse.sparse).toBe(true);
    expect(sparse.reasons).toContain("few_authored_behavior_fields");
    expect(rich.sparse).toBe(false);
    expect(rich.score).toBeGreaterThan(sparse.score);
  });

  it("hashes only stable authored interpretation sources", () => {
    const source = card({ description: "A guarded courier.", personality: "Deflects with jokes." });
    const first = behavioralInterpretationSourceHash(source);
    const second = behavioralInterpretationSourceHash({ ...source, creator: "Changed catalog metadata" });
    const edited = behavioralInterpretationSourceHash({ ...source, personality: "Answers bluntly." });

    expect(first).toBe(second);
    expect(edited).not.toBe(first);
  });
});

describe("behavioral interpretation validation", () => {
  const source = card({
    description: "Mira avoids direct answers about the missing letter.",
    personality: "She uses dry jokes to deflect personal questions.",
  });

  it("accepts bounded claims with exact authored evidence", () => {
    const result = validateBehavioralInterpretation(source, {
      claims: [
        {
          statement: "Uses dry jokes to deflect personal questions.",
          evidenceClass: "explicit",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
        },
        {
          statement: "May avoid direct answers when the missing letter is mentioned.",
          evidenceClass: "tentative",
          evidence: [{ field: "description", quote: "avoids direct answers about the missing letter" }],
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        version: BEHAVIORAL_INTERPRETATION_VERSION,
        sourceHash: behavioralInterpretationSourceHash(source),
        claims: expect.arrayContaining([
          expect.objectContaining({ evidenceClass: "explicit", source: "generated" }),
          expect.objectContaining({ evidenceClass: "tentative", source: "generated" }),
        ]),
      }),
    );
  });

  it("collapses reworded claims that rely on the same evidence", () => {
    const result = validateBehavioralInterpretation(source, {
      claims: [
        {
          statement: "May use dry humor to deflect personal questions.",
          evidenceClass: "tentative",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
        },
        {
          statement: "Mira sidesteps personal inquiries with sarcastic jokes.",
          evidenceClass: "tentative",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
        },
      ],
    });

    expect(result?.claims).toHaveLength(1);
  });

  it("collapses broader paraphrases that rely on the same evidence", () => {
    const result = validateBehavioralInterpretation(source, {
      claims: [
        {
          statement: "May use dry humor to deflect personal questions.",
          evidenceClass: "tentative",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
        },
        {
          statement: "She jokes and changes the subject when conversation turns to her personal life.",
          evidenceClass: "tentative",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
        },
      ],
    });

    expect(result?.claims).toHaveLength(1);
  });

  it("keeps distinct behavioral claims that share the same evidence", () => {
    const result = validateBehavioralInterpretation(source, {
      claims: [
        {
          statement: "Uses dry jokes in a restrained style.",
          evidenceClass: "explicit",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
        },
        {
          statement: "Deflects personal questions instead of answering them.",
          evidenceClass: "explicit",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
        },
      ],
    });

    expect(result?.claims).toHaveLength(2);
  });

  it.each([
    {
      name: "evidence-free",
      value: { claims: [{ statement: "Becomes formal under threat.", evidenceClass: "tentative", evidence: [] }] },
    },
    {
      name: "invented biography",
      value: {
        claims: [
          {
            statement: "Was abandoned by her family as a child.",
            evidenceClass: "strongly_implied",
            evidence: [{ field: "description", quote: "missing letter" }],
          },
        ],
      },
    },
    {
      name: "user-control instruction",
      value: {
        claims: [
          {
            statement: "Make the user confess and decide to help her.",
            evidenceClass: "explicit",
            evidence: [{ field: "description", quote: "missing letter" }],
          },
        ],
      },
    },
    {
      name: "unsupported quote",
      value: {
        claims: [
          {
            statement: "Uses jokes to deflect.",
            evidenceClass: "explicit",
            evidence: [{ field: "personality", quote: "laughs loudly at danger" }],
          },
        ],
      },
    },
  ])("rejects $name claims", ({ value }) => {
    expect(validateBehavioralInterpretation(source, value)).toBeNull();
  });
});

describe("behavioral interpretation freshness and packing", () => {
  const source = card({
    description: "Mira avoids direct answers about the missing letter.",
    personality: "She uses dry jokes to deflect personal questions.",
  });
  const profile = validateBehavioralInterpretation(source, {
    claims: [
      {
        statement: "Uses dry jokes to deflect personal questions.",
        evidenceClass: "explicit",
        evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
      },
      {
        statement: "Avoids direct answers about the missing letter.",
        evidenceClass: "strongly_implied",
        evidence: [{ field: "description", quote: "avoids direct answers about the missing letter" }],
      },
      {
        statement: "May become evasive and resist direct answers when the missing letter comes up.",
        evidenceClass: "tentative",
        evidence: [{ field: "description", quote: "avoids direct answers about the missing letter" }],
      },
      {
        statement: "May lean on dry humor when personal questions feel too close.",
        evidenceClass: "tentative",
        evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
      },
    ],
  })!;

  it("invalidates source edits, version changes, stale status, and disabled profiles", () => {
    expect(isBehavioralInterpretationCurrent(source, profile)).toBe(true);
    expect(isBehavioralInterpretationCurrent({ ...source, personality: "Answers bluntly." }, profile)).toBe(false);
    expect(isBehavioralInterpretationCurrent(source, { ...profile, version: 999 })).toBe(false);
    expect(isBehavioralInterpretationCurrent(source, { ...profile, status: "stale" })).toBe(false);
    expect(isBehavioralInterpretationCurrent(source, { ...profile, enabled: false })).toBe(false);
  });

  it("treats a missing derived profile as the supported authored-only state", () => {
    expect(isBehavioralInterpretationCurrent(source, undefined)).toBe(false);
    expect(isBehavioralInterpretationCurrent(source, null)).toBe(false);
    expect(packBehavioralInterpretation(source, undefined)).toBe("");
    expect(packBehavioralInterpretation(source, null)).toBe("");
  });

  it("does not pack reworded generated claims backed by the same evidence twice", () => {
    const packed = packBehavioralInterpretation(source, {
      ...profile,
      claims: [
        {
          id: "indirect",
          statement: "May use dry humor to deflect personal questions.",
          evidenceClass: "tentative",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
          source: "generated",
        },
        {
          id: "evasive",
          statement: "Mira sidesteps personal inquiries with sarcastic jokes.",
          evidenceClass: "tentative",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
          source: "generated",
        },
      ],
    });

    expect(packed.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(1);
  });

  it("packs distinct behavioral claims even when they cite the same evidence", () => {
    const packed = packBehavioralInterpretation(source, {
      ...profile,
      claims: [
        {
          id: "style",
          statement: "Uses dry jokes in a restrained style.",
          evidenceClass: "explicit",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
          source: "generated",
        },
        {
          id: "boundary",
          statement: "Deflects personal questions instead of answering them.",
          evidenceClass: "explicit",
          evidence: [{ field: "personality", quote: "uses dry jokes to deflect personal questions" }],
          source: "generated",
        },
      ],
    });

    expect(packed.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
  });

  it("does not crash when legacy stored claims have malformed evidence", () => {
    const malformed = {
      ...profile,
      claims: [
        {
          id: "legacy",
          statement: "May avoid direct answers when the missing letter is questioned.",
          evidenceClass: "tentative",
          source: "generated",
        },
        {
          id: "current",
          statement: "Could become evasive and resist direct answers about the missing letter.",
          evidenceClass: "tentative",
          evidence: [{ field: "description", quote: "avoids direct answers about the missing letter" }],
          source: "generated",
        },
      ],
    } as unknown as CharacterBehavioralInterpretation;

    expect(() => packBehavioralInterpretation(source, malformed)).not.toThrow();
  });

  it("packs bounded non-duplicative claims with authored precedence and overrides first", () => {
    const packed = packBehavioralInterpretation(source, {
      ...profile,
      claims: [
        ...profile.claims,
        {
          id: "override-1",
          statement: "Answers plainly when someone presents the original seal.",
          evidenceClass: "explicit",
          evidence: [{ field: "user_override", quote: "User correction" }],
          source: "user_override",
        },
        {
          id: "duplicate",
          statement: source.personality,
          evidenceClass: "explicit",
          evidence: [{ field: "personality", quote: source.personality }],
          source: "generated",
        },
      ],
    });

    expect(packed).toContain("Authored card text and current scene events always win");
    expect(packed).toContain("User correction: Answers plainly");
    expect(packed).not.toContain(`- Explicit: ${source.personality}`);
    expect(packed.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(3);
  });
});
