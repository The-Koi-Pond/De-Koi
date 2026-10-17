import { describe, expect, it } from "vitest";
import { regexApplyModeFromSillyTavern, regexScriptApplyMode, regexScriptSurfaces } from "./regex-apply-mode";

describe("regex apply modes", () => {
  it("reads older rows from promptOnly", () => {
    expect(regexScriptApplyMode({ promptOnly: true })).toBe("prompt");
    expect(regexScriptApplyMode({ promptOnly: "true" })).toBe("prompt");
    expect(regexScriptApplyMode({ promptOnly: false })).toBe("both");
    expect(regexScriptApplyMode({ promptOnly: true, applyMode: "display" })).toBe("display");
  });

  it("maps SillyTavern's two flags", () => {
    expect(regexApplyModeFromSillyTavern({ markdownOnly: true })).toBe("display");
    expect(regexApplyModeFromSillyTavern({ promptOnly: true })).toBe("prompt");
    expect(regexApplyModeFromSillyTavern({ markdownOnly: true, promptOnly: true })).toBe("both");
    expect(regexApplyModeFromSillyTavern({})).toBe("both");
  });

  it("never lets a character-scoped script rewrite saved messages", () => {
    const table = (["prompt", "display", "both"] as const).flatMap((applyMode) =>
      [false, true].map((scoped) => [applyMode, scoped, regexScriptSurfaces({ applyMode }, scoped)] as const),
    );

    expect(table).toEqual([
      ["prompt", false, { prompt: true, display: false, savedMessage: false }],
      ["prompt", true, { prompt: true, display: false, savedMessage: false }],
      ["display", false, { prompt: false, display: true, savedMessage: false }],
      ["display", true, { prompt: false, display: true, savedMessage: false }],
      ["both", false, { prompt: false, display: true, savedMessage: true }],
      ["both", true, { prompt: true, display: true, savedMessage: false }],
    ]);
  });
});
