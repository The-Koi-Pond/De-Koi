import { describe, expect, it } from "vitest";

import type { CreateRegexScriptInput } from "../../../../engine/contracts/schemas/regex.schema";
import { filterRegexScriptsByCharacterIds } from "./regex-script-filter";
import {
  parseRegexScriptImportPayloads,
  reconcileRegexScriptImportPendingSignatures,
  writeRegexScriptImportPayloads,
} from "./regex-script-import";

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
    expect(payload?.promptOnly).toBe(true);
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
    expect(payload?.promptOnly).toBe(true);
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

  it("reports exact partial accounting when storage create fails after earlier writes", async () => {
    const payloads = parseRegexScriptImportPayloads([
      { name: "First", findRegex: "secret", replaceString: "redacted", placement: ["ai_output"] },
      { name: "Second", findRegex: "private", replaceString: "hidden", placement: ["ai_output"] },
    ]);
    const writes: CreateRegexScriptInput[] = [];

    await expect(
      writeRegexScriptImportPayloads({
        payloads,
        create: async (payload) => {
          if (writes.length === 0) {
            writes.push(payload);
            return { id: "created", ...payload };
          }
          throw new Error("storage unavailable");
        },
      }),
    ).rejects.toMatchObject({
      result: { total: 2, created: 1, skipped: 0, failed: 1, pending: 0 },
    });

    expect(writes.map((payload) => payload.name)).toEqual(["First"]);
  });

  it("skips already-created import signatures on retry after a partial failure", async () => {
    const payloads = parseRegexScriptImportPayloads([
      { name: "First", findRegex: "secret", replaceString: "redacted", placement: ["ai_output"] },
      { name: "Second", findRegex: "private", replaceString: "hidden", placement: ["ai_output"] },
    ]);
    const pendingSignatures = new Set<string>();
    const writes: string[] = [];

    await expect(
      writeRegexScriptImportPayloads({
        payloads,
        pendingSignatures,
        create: async (payload) => {
          writes.push(payload.name);
          if (payload.name === "Second") throw new Error("storage unavailable");
          return { id: "created", ...payload };
        },
      }),
    ).rejects.toMatchObject({
      name: "RegexScriptImportWriteError",
      result: { total: 2, created: 1, skipped: 0, failed: 1, pending: 0 },
    });

    const retry = await writeRegexScriptImportPayloads({
      payloads,
      pendingSignatures,
      existingScripts: [],
      create: async (payload) => {
        writes.push(payload.name);
        return { id: `created-${payload.name}`, ...payload };
      },
    });

    expect(retry).toEqual({ total: 2, created: 1, skipped: 1, failed: 0, pending: 0 });
    expect(writes).toEqual(["First", "Second", "Second"]);
  });

  it("creates again after a successful import is observed and then deleted", async () => {
    const [payload] = parseRegexScriptImportPayloads({
      name: "Reimportable",
      findRegex: "secret",
      replaceString: "redacted",
      placement: ["ai_output"],
    });
    const pendingSignatures = new Set<string>();
    const writes: string[] = [];

    await writeRegexScriptImportPayloads({
      payloads: [payload],
      pendingSignatures,
      existingScripts: [],
      create: async (nextPayload) => {
        writes.push(nextPayload.name);
        return { id: "created", ...nextPayload };
      },
    });

    reconcileRegexScriptImportPendingSignatures(pendingSignatures, [payload]);

    const reimport = await writeRegexScriptImportPayloads({
      payloads: [payload],
      pendingSignatures,
      existingScripts: [],
      create: async (nextPayload) => {
        writes.push(nextPayload.name);
        return { id: "recreated", ...nextPayload };
      },
    });

    expect(reimport).toEqual({ total: 1, created: 1, skipped: 0, failed: 0, pending: 0 });
    expect(writes).toEqual(["Reimportable", "Reimportable"]);
  });
});
