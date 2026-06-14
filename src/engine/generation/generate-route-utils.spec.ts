import { describe, expect, it } from "vitest";

import { mergeStoredGenerationParameters } from "./generate-route-utils";

describe("mergeStoredGenerationParameters", () => {
  it("preserves custom thinking tag generation parameters", () => {
    expect(
      mergeStoredGenerationParameters({
        temperature: 0.7,
        customThinkingTags: [{ open: "<analysis>", close: "</analysis>" }],
      }),
    ).toMatchObject({
      temperature: 0.7,
      customThinkingTags: [{ open: "<analysis>", close: "</analysis>" }],
    });
  });

  it("lets later custom thinking tag sources override inherited pairs", () => {
    expect(
      mergeStoredGenerationParameters(
        { customThinkingTags: [{ open: "<analysis>", close: "</analysis>" }] },
        { customThinkingTags: [{ open: "<scratchpad>", close: "</scratchpad>" }] },
      ),
    ).toMatchObject({
      customThinkingTags: [{ open: "<scratchpad>", close: "</scratchpad>" }],
    });
  });
});
