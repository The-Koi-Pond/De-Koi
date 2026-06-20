import { describe, expect, it } from "vitest";
import { completeRequiredSpriteExpressionEntries, type AvailableSpriteCharacter } from "./sprite-expression-validation";

const availableSprites: AvailableSpriteCharacter[] = [
  {
    characterId: "char-speaker",
    characterName: "Speaker",
    expressions: ["angry", "neutral", "happy"],
  },
  {
    characterId: "char-other",
    characterName: "Other",
    expressions: ["idle", "smirk"],
  },
];

describe("completeRequiredSpriteExpressionEntries", () => {
  it("fills the required speaking target when the expression agent omits entries", () => {
    const result = completeRequiredSpriteExpressionEntries([], availableSprites, ["char-speaker"]);

    expect(result.expressions).toEqual([
      {
        characterId: "char-speaker",
        characterName: "Speaker",
        expression: "neutral",
        transition: "crossfade",
      },
    ]);
    expect(result.warnings).toEqual([
      { message: 'Expression agent omitted Speaker - filled missing required expression "neutral"' },
    ]);
  });

  it("keeps validated model choices and only fills missing required targets", () => {
    const result = completeRequiredSpriteExpressionEntries(
      [{ characterName: "Other", expression: "smirk" }],
      availableSprites,
      ["char-speaker", "char-other"],
    );

    expect(result.expressions).toEqual([
      {
        characterName: "Other",
        characterId: "char-other",
        expression: "smirk",
      },
      {
        characterId: "char-speaker",
        characterName: "Speaker",
        expression: "neutral",
        transition: "crossfade",
      },
    ]);
  });

  it("uses the response text to choose a better fallback expression", () => {
    const result = completeRequiredSpriteExpressionEntries([], availableSprites, ["char-speaker"], {
      defaultSourceText: "Speaker smiles warmly.",
    });

    expect(result.expressions).toEqual([
      {
        characterId: "char-speaker",
        characterName: "Speaker",
        expression: "happy",
        transition: "crossfade",
      },
    ]);
  });

  it("does not use containment-only matches for inferred fallback expressions", () => {
    const result = completeRequiredSpriteExpressionEntries(
      [],
      [{ characterId: "char-speaker", characterName: "Speaker", expressions: ["neutral", "unhappy"] }],
      ["char-speaker"],
      {
        defaultSourceText: "Speaker smiles warmly.",
      },
    );

    expect(result.expressions).toEqual([
      {
        characterId: "char-speaker",
        characterName: "Speaker",
        expression: "neutral",
        transition: "crossfade",
      },
    ]);
  });

  it("uses the named target clause when another owner has a different emotion", () => {
    const result = completeRequiredSpriteExpressionEntries(
      [],
      [{ characterId: "char-speaker", characterName: "Speaker", expressions: ["neutral", "happy", "shy"] }],
      ["char-speaker"],
      {
        defaultSourceText: "Speaker smiles while the player blushes.",
      },
    );

    expect(result.expressions).toEqual([
      {
        characterId: "char-speaker",
        characterName: "Speaker",
        expression: "happy",
        transition: "crossfade",
      },
    ]);
  });

  it("uses character-specific text when completing multiple required targets", () => {
    const result = completeRequiredSpriteExpressionEntries(
      [],
      [
        { characterId: "char-speaker", characterName: "Speaker", expressions: ["neutral", "happy"] },
        { characterId: "char-other", characterName: "Other", expressions: ["neutral", "shy"] },
      ],
      ["char-speaker", "char-other"],
      {
        defaultSourceText: "Speaker smiles brightly.",
        sourceTextByCharacterId: new Map([["char-other", "Other blushes and looks away."]]),
      },
    );

    expect(result.expressions).toEqual([
      {
        characterId: "char-speaker",
        characterName: "Speaker",
        expression: "happy",
        transition: "crossfade",
      },
      {
        characterId: "char-other",
        characterName: "Other",
        expression: "shy",
        transition: "crossfade",
      },
    ]);
  });
});
