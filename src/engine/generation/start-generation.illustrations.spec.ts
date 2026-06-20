import { describe, expect, it } from "vitest";

import { buildIllustrationNegativePrompt, ILLUSTRATOR_TEXT_NEGATIVE_PROMPT } from "./start-generation";

describe("buildIllustrationNegativePrompt", () => {
  it("keeps caller negative prompts and appends the Illustrator text guard", () => {
    const negativePrompt = buildIllustrationNegativePrompt({
      itemNegativePrompt: "bad hands",
      agentNegativePrompt: "low quality",
      chatIllustrationNegativePrompt: "blurry",
      chatSelfieNegativePrompt: "extra fingers",
    });

    expect(negativePrompt).toBe(`bad hands, low quality, blurry, extra fingers, ${ILLUSTRATOR_TEXT_NEGATIVE_PROMPT}`);
    expect(negativePrompt).toContain("speech bubbles");
    expect(negativePrompt).toContain("readable text");
  });

  it("deduplicates whole prompt fragments while preserving the text guard", () => {
    const negativePrompt = buildIllustrationNegativePrompt({
      itemNegativePrompt: "low quality",
      agentNegativePrompt: "LOW QUALITY",
      chatIllustrationNegativePrompt: ILLUSTRATOR_TEXT_NEGATIVE_PROMPT,
    });

    expect(negativePrompt).toBe(`low quality, ${ILLUSTRATOR_TEXT_NEGATIVE_PROMPT}`);
  });
});
