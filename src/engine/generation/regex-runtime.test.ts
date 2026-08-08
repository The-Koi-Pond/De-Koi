import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import {
  applyRuntimeRegexScriptSnapshot,
  applyRuntimeRegexScripts,
  loadRuntimeRegexScripts,
} from "./regex-runtime";

function storageWithRegexScripts(regexScripts: Record<string, unknown>[]): StorageGateway {
  return {
    async list<T>(entity: string) {
      return (entity === "regex-scripts" ? regexScripts : []) as T[];
    },
    async get() {
      return null;
    },
    async getChatMessage() {
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
  it("loads one ordered snapshot that can be reused without storage", async () => {
    let listCalls = 0;
    const storage = storageWithRegexScripts([
      { ...baseScript, id: "second", order: 2, findRegex: "middle", replaceString: "done" },
      { ...baseScript, id: "first", order: 1, findRegex: "secret", replaceString: "middle" },
    ]);
    const originalList = storage.list.bind(storage);
    storage.list = async (entity, options) => {
      listCalls += entity === "regex-scripts" ? 1 : 0;
      return originalList(entity, options);
    };

    const scripts = await loadRuntimeRegexScripts(storage);

    expect(applyRuntimeRegexScriptSnapshot(scripts, "ai_output", "secret")).toBe("done");
    expect(applyRuntimeRegexScriptSnapshot(scripts, "ai_output", "secret")).toBe("done");
    expect(listCalls).toBe(1);
  });

  it("applies unscoped display scripts", async () => {
    const storage = storageWithRegexScripts([baseScript]);

    await expect(applyRuntimeRegexScripts(storage, "ai_output", "secret")).resolves.toBe("visible");
  });

  it("treats multi-target scripts as prompt-only and skips displayed response rewrites", async () => {
    const storage = storageWithRegexScripts([{ ...baseScript, targetCharacterIds: ["char-a", "char-c"] }]);

    await expect(
      applyRuntimeRegexScripts(storage, "ai_output", "secret", { targetCharacterId: "char-c" }),
    ).resolves.toBe("secret");
  });

  it("skips multi-target scripts for unrelated response characters", async () => {
    const storage = storageWithRegexScripts([{ ...baseScript, targetCharacterIds: ["char-a", "char-c"] }]);

    await expect(
      applyRuntimeRegexScripts(storage, "ai_output", "secret", { targetCharacterId: "char-b" }),
    ).resolves.toBe("secret");
  });

  it("treats single characterId scoped rows as prompt-only and skips displayed response rewrites", async () => {
    const storage = storageWithRegexScripts([{ ...baseScript, characterId: "char-a" }]);

    await expect(
      applyRuntimeRegexScripts(storage, "ai_output", "secret", { targetCharacterId: "char-a" }),
    ).resolves.toBe("secret");
  });
});
