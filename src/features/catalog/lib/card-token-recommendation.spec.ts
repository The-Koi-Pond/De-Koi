import { describe, expect, it } from "vitest";

import {
  CARD_TOKEN_RECOMMENDED_LIMIT,
  getInlineCardTokenWarning,
  getCardLengthToastActions,
  estimateTextTokens,
  formatEstimatedTokens,
  isCardTokenEstimateOverRecommendation,
} from "./card-token-recommendation";

describe("card token recommendation", () => {
  it("estimates tokens from text with the shared character approximation", () => {
    expect(estimateTextTokens("12345678")).toBe(2);
    expect(formatEstimatedTokens(1234)).toBe("~1,234 tokens");
  });

  it("warns only after the recommended whole-card token limit is exceeded", () => {
    expect(isCardTokenEstimateOverRecommendation(CARD_TOKEN_RECOMMENDED_LIMIT)).toBe(false);
    expect(isCardTokenEstimateOverRecommendation(CARD_TOKEN_RECOMMENDED_LIMIT + 1)).toBe(true);
  });

  it("builds compact inline warning copy for selection surfaces", () => {
    expect(getInlineCardTokenWarning(CARD_TOKEN_RECOMMENDED_LIMIT)).toBeNull();
    expect(getInlineCardTokenWarning(CARD_TOKEN_RECOMMENDED_LIMIT + 125)).toEqual({
      label: "Long card",
      description: "~3,325 tokens; recommended maximum is ~3,200 tokens. Open this character and shorten the card.",
    });
  });

  it("keeps the over-limit toast persistent, updated, and dismissed only after recovery", () => {
    const toastId = "character-card-length-card-1";

    expect(
      getCardLengthToastActions({
        cardKind: "character",
        cardId: "card-1",
        tokenEstimate: CARD_TOKEN_RECOMMENDED_LIMIT + 1,
        previousToastId: null,
      }),
    ).toEqual([
      {
        action: "show",
        toastId,
        title: "Character card is longer than recommended.",
        description: `~3,201 tokens used. Recommendation: ~3,200 tokens. It will still save.`,
        duration: Infinity,
        closeButton: true,
      },
    ]);

    expect(
      getCardLengthToastActions({
        cardKind: "character",
        cardId: "card-1",
        tokenEstimate: CARD_TOKEN_RECOMMENDED_LIMIT + 25,
        previousToastId: toastId,
      }),
    ).toEqual([
      expect.objectContaining({
        action: "show",
        toastId,
        description: `~3,225 tokens used. Recommendation: ~3,200 tokens. It will still save.`,
      }),
    ]);

    expect(
      getCardLengthToastActions({
        cardKind: "character",
        cardId: "card-1",
        tokenEstimate: CARD_TOKEN_RECOMMENDED_LIMIT,
        previousToastId: toastId,
      }),
    ).toEqual([{ action: "dismiss", toastId }]);
  });

  it("dismisses a previous card toast before showing a different card toast", () => {
    expect(
      getCardLengthToastActions({
        cardKind: "persona",
        cardId: "persona-2",
        tokenEstimate: CARD_TOKEN_RECOMMENDED_LIMIT + 1,
        previousToastId: "persona-card-length-persona-1",
      }),
    ).toEqual([
      { action: "dismiss", toastId: "persona-card-length-persona-1" },
      expect.objectContaining({
        action: "show",
        toastId: "persona-card-length-persona-2",
        title: "Persona card is longer than recommended.",
      }),
    ]);
  });
});
