import { describe, expect, it } from "vitest";
import { negativePromptOverride, promptOverride } from "./game-api-asset-helpers";

describe("game image prompt overrides", () => {
  it("preserves edited negative prompts separately from positive prompt overrides", () => {
    const payload = {
      promptOverrides: [
        {
          id: "background:misty-forest",
          prompt: "  revised background prompt  ",
          negativePrompt: "  no text, no people  ",
        },
      ],
    };

    expect(promptOverride(payload, "background:misty-forest")).toBe("revised background prompt");
    expect(negativePromptOverride(payload, "background:misty-forest")).toBe("no text, no people");
  });

  it("treats an empty negative prompt as an explicit review override", () => {
    const payload = {
      promptOverrides: [{ id: "portrait:ari", negativePrompt: "   " }],
    };

    expect(promptOverride(payload, "portrait:ari")).toBeNull();
    expect(negativePromptOverride(payload, "portrait:ari")).toBe("");
  });
});
