import { describe, expect, it } from "vitest";

import {
  CARD_TOKEN_RECOMMENDED_LIMIT,
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
});
