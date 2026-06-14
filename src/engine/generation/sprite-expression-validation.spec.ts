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
        transition: "none",
      },
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
        transition: "none",
      },
    ]);
  });
});
