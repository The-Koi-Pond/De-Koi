import { describe, expect, it } from "vitest";

import { nextRegexScriptTargetCharacterIds, regexApplyModeHelp } from "./regex-script-editor-state";

describe("regex script editor state", () => {
  it("toggles a character in and out of a script's scope", () => {
    const scoped = nextRegexScriptTargetCharacterIds([], "char-a");

    expect(scoped).toEqual(["char-a"]);
    expect(nextRegexScriptTargetCharacterIds(scoped, "char-a")).toEqual([]);
  });

  it("says a global Both script rewrites the saved message and a scoped one does not", () => {
    expect(regexApplyModeHelp("both", false)).toMatch(/message itself/);
    expect(regexApplyModeHelp("both", true)).toMatch(/saved message stays/);
    expect(regexApplyModeHelp("display", false)).toMatch(/only what you see/);
  });
});
