import { describe, expect, it } from "vitest";

import { filterRegexScriptsByCharacterIds } from "./regex-script-filter";

describe("filterRegexScriptsByCharacterIds", () => {
  const scripts = [
    { id: "global", characterId: null },
    { id: "char-a", characterId: "char-a" },
    { id: "char-b", characterId: "char-b" },
  ];

  it("keeps scoped scripts in the default regex manager list", () => {
    expect(filterRegexScriptsByCharacterIds(scripts).map((script) => script.id)).toEqual(["global", "char-a", "char-b"]);
  });

  it("keeps global and matching scoped scripts for character-specific lists", () => {
    expect(filterRegexScriptsByCharacterIds(scripts, ["char-a"]).map((script) => script.id)).toEqual([
      "global",
      "char-a",
    ]);
  });
});
