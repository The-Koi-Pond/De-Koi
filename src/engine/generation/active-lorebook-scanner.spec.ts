import { describe, expect, it } from "vitest";
import type { StorageGateway } from "../capabilities/storage";
import { scanActiveLorebooks } from "./active-lorebook-scanner";

type JsonRecord = Record<string, unknown>;

const messages = [
  { role: "user", content: "ancient gate opened long ago" },
  ...Array.from({ length: 11 }, (_, index) => ({
    role: index % 2 === 0 ? "assistant" : "user",
    content: `recent message ${index}`,
  })),
];

function storageFor(lorebook: JsonRecord, entries: JsonRecord[]): StorageGateway {
  return {
    list: async <T = unknown>(entity: string): Promise<T[]> => {
      if (entity === "lorebooks") return [lorebook] as T[];
      if (entity === "lorebook-folders") return [];
      return [];
    },
    listLorebookEntriesByLorebookIds: async <T = unknown>(_lorebookIds: string[]): Promise<T[]> => entries as T[],
  } as unknown as StorageGateway;
}

async function scanEntryIds(lorebookPatch: JsonRecord): Promise<string[]> {
  const lorebook = {
    id: "book-1",
    name: "Book",
    enabled: true,
    isGlobal: true,
    ...lorebookPatch,
  };
  const result = await scanActiveLorebooks({
    storage: storageFor(lorebook, [
      {
        id: "entry-1",
        lorebookId: "book-1",
        name: "Entry",
        content: "Lore content",
        keys: ["ancient gate"],
        enabled: true,
      },
    ]),
    chat: { id: "chat-1", mode: "roleplay", metadata: {} },
    characters: [],
    persona: null,
    storedMessages: messages,
    request: {},
    embeddingSource: null,
  });

  return result.activatedEntries.map((entry) => entry.entry.id);
}

describe("active lorebook scanner", () => {
  it("bounds missing lorebook scanDepth to the generated-response default", async () => {
    await expect(scanEntryIds({})).resolves.toEqual([]);
  });

  it("preserves explicit lorebook scanDepth 0 as scan-all", async () => {
    await expect(scanEntryIds({ scanDepth: 0 })).resolves.toEqual(["entry-1"]);
  });
});
