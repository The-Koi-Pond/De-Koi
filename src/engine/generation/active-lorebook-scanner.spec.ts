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

function storageFor(lorebook: JsonRecord, entries: JsonRecord[], folders: JsonRecord[] = []): StorageGateway {
  return {
    list: async <T = unknown>(entity: string): Promise<T[]> => {
      if (entity === "lorebooks") return [lorebook] as T[];
      if (entity === "lorebook-folders") return folders as T[];
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

  it("traces entries skipped by lorebook token budget", async () => {
    const result = await scanActiveLorebooks({
      storage: storageFor({ id: "book-1", name: "Book", enabled: true, isGlobal: true, tokenBudget: 2 }, [
        {
          id: "entry-1",
          lorebookId: "book-1",
          name: "Small",
          content: "abcd",
          constant: true,
          enabled: true,
          order: 1,
        },
        {
          id: "entry-2",
          lorebookId: "book-1",
          name: "Large",
          content: "abcdefghijkl",
          constant: true,
          enabled: true,
          order: 2,
        },
      ]),
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      characters: [],
      persona: null,
      storedMessages: messages,
      request: {},
      embeddingSource: null,
    });

    expect(result.activatedEntries.map((entry) => entry.entry.id)).toEqual(["entry-1"]);
    expect(result.activationTrace.entries.find((entry) => entry.entryId === "entry-2")).toMatchObject({
      status: "matched",
      reason: "budget_lorebook",
      matchedKeys: ["[constant]"],
      tokenEstimate: 3,
      hint: "Raise this lorebook's token budget or shorten higher-priority entries.",
    });
  });

  it("traces folder-disabled entries before activation filtering", async () => {
    const result = await scanActiveLorebooks({
      storage: storageFor(
        { id: "book-1", name: "Book", enabled: true, isGlobal: true },
        [
          {
            id: "entry-1",
            lorebookId: "book-1",
            folderId: "folder-1",
            name: "Foldered",
            content: "Lore content",
            keys: ["ancient gate"],
            enabled: true,
          },
        ],
        [{ id: "folder-1", lorebookId: "book-1", enabled: false }],
      ),
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      characters: [],
      persona: null,
      storedMessages: messages,
      request: {},
      embeddingSource: null,
    });

    expect(result.activatedEntries).toEqual([]);
    expect(result.activationTrace.entries).toContainEqual(
      expect.objectContaining({
        entryId: "entry-1",
        status: "skipped",
        reason: "folder_disabled",
        hint: "Re-enable this entry's folder to allow activation.",
      }),
    );
  });
  it("reuses materialized active entries for unchanged lorebook rows and invalidates on row changes", async () => {
    const lorebook = {
      id: "book-1",
      name: "Book",
      enabled: true,
      isGlobal: true,
      scanDepth: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const row = {
      id: "entry-1",
      lorebookId: "book-1",
      name: "Entry",
      content: "Lore content",
      keys: ["ancient gate"],
      enabled: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const storage = storageFor(lorebook, [row]);
    const input = {
      storage,
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      characters: [],
      persona: null,
      storedMessages: messages,
      request: {},
      embeddingSource: null,
    };

    const first = await scanActiveLorebooks(input);
    const second = await scanActiveLorebooks(input);

    expect(first.activatedEntries.map((entry) => entry.entry.id)).toEqual(["entry-1"]);
    expect(second.entriesForTiming[0]).toBe(first.entriesForTiming[0]);
    expect(second.activationTrace.entries).toEqual(first.activationTrace.entries);

    row.keys = ["silver moon"];
    row.updatedAt = "2026-01-02T00:00:00.000Z";
    const third = await scanActiveLorebooks(input);

    expect(third.entriesForTiming[0]).not.toBe(first.entriesForTiming[0]);
    expect(third.activatedEntries).toEqual([]);
  });
  it("preserves large recursive activation results while reusing cached materialized entries", async () => {
    const lorebook = {
      id: "book-1",
      name: "Recursive Book",
      enabled: true,
      isGlobal: true,
      scanDepth: 0,
      recursiveScanning: true,
      maxRecursionDepth: 2,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const entries = [
      {
        id: "entry-seed",
        lorebookId: "book-1",
        name: "Seed",
        content: "recursive anchor",
        keys: ["ancient gate"],
        enabled: true,
        order: 0,
      },
      ...Array.from({ length: 75 }, (_, index) => ({
        id: `entry-recursive-${index}`,
        lorebookId: "book-1",
        name: `Recursive ${index}`,
        content: `Recursive lore ${index}`,
        keys: ["recursive anchor"],
        enabled: true,
        order: index + 1,
      })),
    ];
    const storage = storageFor(lorebook, entries);
    const input = {
      storage,
      chat: { id: "chat-1", mode: "roleplay", metadata: {} },
      characters: [],
      persona: null,
      storedMessages: messages,
      request: {},
      embeddingSource: null,
    };

    const first = await scanActiveLorebooks(input);
    const second = await scanActiveLorebooks(input);

    expect(first.activatedEntries).toHaveLength(76);
    expect(second.activatedEntries.map((entry) => entry.entry.id)).toEqual(
      first.activatedEntries.map((entry) => entry.entry.id),
    );
    expect(second.entriesForTiming[0]).toBe(first.entriesForTiming[0]);
    expect(second.entriesForTiming[75]).toBe(first.entriesForTiming[75]);
    expect(first.activationTrace.entries.find((entry) => entry.entryId === "entry-recursive-0")).toMatchObject({
      status: "included",
      reason: "keyword_match",
      recursive: { depth: 1, preventedByEntry: false },
    });
  });
});
