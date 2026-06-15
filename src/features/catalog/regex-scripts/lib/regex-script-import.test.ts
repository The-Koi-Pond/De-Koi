import { describe, expect, it } from "vitest";

import type { CreateRegexScriptInput } from "../../../../engine/contracts/schemas/regex.schema";
import { filterRegexScriptsByCharacterIds } from "./regex-script-filter";
import { parseRegexScriptImportPayloads } from "./regex-script-import";

describe("parseRegexScriptImportPayloads", () => {
  it("normalizes JSON-string target ids to real scoped character ids", () => {
    const [payload] = parseRegexScriptImportPayloads({
      scriptName: "Scoped cleanup",
      findRegex: "/secret/gi",
      replaceString: "redacted",
      targetCharacterIds: '["char-a","char-b","char-a",""]',
      placement: [2],
    });

    expect(payload?.characterId).toBe("char-a");
    expect(payload?.targetCharacterIds).toEqual(["char-a", "char-b"]);
    expect(payload?.findRegex).toBe("secret");
    expect(payload?.flags).toBe("gi");
    expect(
      filterRegexScriptsByCharacterIds([{ id: "script", ...payload }], ["char-b"]).map((script) => script.id),
    ).toEqual(["script"]);
  });

  it("keeps single characterId strings as one-id scopes", () => {
    const [payload] = parseRegexScriptImportPayloads({
      name: "Character scope",
      findRegex: "secret",
      characterId: "char-a",
      placement: ["ai_output"],
    });

    expect(payload?.characterId).toBe("char-a");
    expect(payload?.targetCharacterIds).toEqual(["char-a"]);
  });

  it("validates every accepted row before callers start writing", () => {
    const writes: CreateRegexScriptInput[] = [];

    expect(() => {
      const payloads = parseRegexScriptImportPayloads([
        {
          name: "Valid",
          findRegex: "secret",
          replaceString: "redacted",
          placement: ["ai_output"],
        },
        {
          name: "Invalid",
          findRegex: "oops",
          replaceString: { not: "a string" },
          placement: ["ai_output"],
        },
      ]);
      for (const payload of payloads) writes.push(payload);
    }).toThrow();

    expect(writes).toEqual([]);
  });
});
