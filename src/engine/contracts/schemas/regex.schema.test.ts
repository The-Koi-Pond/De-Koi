import { describe, expect, it } from "vitest";

import { createRegexScriptSchema, updateRegexScriptSchema } from "./regex.schema";

const baseRegexScript = {
  name: "Multi target script",
  enabled: true,
  findRegex: "secret",
  replaceString: "visible",
  trimStrings: [],
  placement: ["ai_output"],
  flags: "g",
  promptOnly: true,
  order: 0,
  minDepth: null,
  maxDepth: null,
};

describe("regex script schemas", () => {
  it("preserves legacy multi-target character scopes on create", () => {
    const parsed = createRegexScriptSchema.parse({
      ...baseRegexScript,
      characterId: "char-a",
      targetCharacterIds: ["char-a", "char-c"],
    });

    expect(parsed.targetCharacterIds).toEqual(["char-a", "char-c"]);
  });

  it("preserves legacy multi-target character scopes on update", () => {
    const parsed = updateRegexScriptSchema.parse({
      targetCharacterIds: ["char-b", "char-d"],
    });

    expect(parsed.targetCharacterIds).toEqual(["char-b", "char-d"]);
  });
});
