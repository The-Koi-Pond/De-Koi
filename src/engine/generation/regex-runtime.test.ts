import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import { applyRuntimeRegexScripts } from "./regex-runtime";

function storageWithRegexScripts(regexScripts: Record<string, unknown>[]): StorageGateway {
  return {
    async list<T>(entity: string) {
      return (entity === "regex-scripts" ? regexScripts : []) as T[];
    },
    async get() {
      return null;
    },
    async create<T>(_entity: string, data: T) {
      return data;
    },
    async update<T>(_entity: string, _id: string, data: T) {
      return data;
    },
    async delete() {
      return { deleted: true };
    },
  } as unknown as StorageGateway;
}

const baseScript = {
  id: "regex-1",
  enabled: true,
  promptOnly: false,
  placement: ["ai_output"],
  findRegex: "secret",
  flags: "g",
  replaceString: "visible",
  trimStrings: [],
  order: 0,
};

describe("applyRuntimeRegexScripts", () => {
  it("applies multi-target scripts for a matching response character", async () => {
    const storage = storageWithRegexScripts([{ ...baseScript, targetCharacterIds: ["char-a", "char-c"] }]);

    await expect(
      applyRuntimeRegexScripts(storage, "ai_output", "secret", { targetCharacterId: "char-c" }),
    ).resolves.toBe("visible");
  });

  it("skips multi-target scripts for unrelated response characters", async () => {
    const storage = storageWithRegexScripts([{ ...baseScript, targetCharacterIds: ["char-a", "char-c"] }]);

    await expect(
      applyRuntimeRegexScripts(storage, "ai_output", "secret", { targetCharacterId: "char-b" }),
    ).resolves.toBe("secret");
  });

  it("keeps single characterId scoped rows compatible", async () => {
    const storage = storageWithRegexScripts([{ ...baseScript, characterId: "char-a" }]);

    await expect(
      applyRuntimeRegexScripts(storage, "ai_output", "secret", { targetCharacterId: "char-a" }),
    ).resolves.toBe("visible");
  });
});
