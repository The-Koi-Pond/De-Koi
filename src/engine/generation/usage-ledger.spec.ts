import { describe, expect, it } from "vitest";
import { buildGenerationTurnUsage, normalizeTokenUsage } from "./usage-ledger";

describe("normalizeTokenUsage", () => {
  it.each([
    [
      "camelCase",
      { promptTokens: 10, completionTokens: 4, cachedPromptTokens: 3, cacheWritePromptTokens: 2, totalTokens: 14 },
    ],
    [
      "snake_case",
      {
        prompt_tokens: 10,
        completion_tokens: 4,
        cached_prompt_tokens: 3,
        cache_write_prompt_tokens: 2,
        total_tokens: 14,
      },
    ],
    [
      "OpenAI chat details",
      {
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 3 },
        total_tokens: 14,
      },
    ],
    [
      "OpenAI Responses details",
      {
        input_tokens: 10,
        output_tokens: 4,
        input_tokens_details: { cached_tokens: 3 },
        total_tokens: 14,
      },
    ],
    [
      "Anthropic cache fields",
      {
        input_tokens: 10,
        output_tokens: 4,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
      },
    ],
    [
      "Google Gemini usage metadata",
      {
        promptTokenCount: 10,
        candidatesTokenCount: 4,
        cachedContentTokenCount: 3,
        totalTokenCount: 14,
      },
    ],
  ])("normalizes %s usage", (_label, raw) => {
    expect(normalizeTokenUsage(raw)).toEqual({
      promptTokens: 10,
      completionTokens: 4,
      cachedPromptTokens: 3,
      cacheWritePromptTokens:
        raw === undefined
          ? null
          : "cache_creation_input_tokens" in raw ||
              "cacheWritePromptTokens" in raw ||
              "cache_write_prompt_tokens" in raw
            ? 2
            : null,
      totalTokens: 14,
    });
  });

  it("keeps missing, negative, and non-finite counts unknown", () => {
    expect(
      normalizeTokenUsage({ promptTokens: -1, completionTokens: Number.POSITIVE_INFINITY, totalTokens: Number.NaN }),
    ).toEqual({
      promptTokens: null,
      completionTokens: null,
      cachedPromptTokens: null,
      cacheWritePromptTokens: null,
      totalTokens: null,
    });
  });
});

describe("buildGenerationTurnUsage", () => {
  it("adds agent usage to normalized main usage without altering the raw receipt", () => {
    const raw = { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } };
    const receipt = buildGenerationTurnUsage(raw, [{ tokensUsed: 7 }, { tokensUsed: 5 }]);

    expect(receipt).toEqual({
      main: {
        promptTokens: 10,
        completionTokens: 4,
        cachedPromptTokens: 3,
        cacheWritePromptTokens: null,
        totalTokens: 14,
      },
      agents: { totalTokens: 12, resultCount: 2 },
      totalTokens: 26,
    });
    expect(raw).toEqual({ prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } });
  });
});
