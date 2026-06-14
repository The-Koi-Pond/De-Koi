import { describe, expect, it } from "vitest";
import type { LorebookEntry } from "../../contracts/types/lorebook";
import { scanForActivatedEntries } from "./keyword-scanner";

function entry(patch: Partial<LorebookEntry>): LorebookEntry {
  return {
    id: "entry-1",
    lorebookId: "book-1",
    name: "Entry",
    content: "Lore content",
    description: "",
    keys: [],
    secondaryKeys: [],
    enabled: true,
    constant: false,
    selective: false,
    selectiveLogic: "and",
    probability: null,
    scanDepth: null,
    matchWholeWords: false,
    caseSensitive: false,
    useRegex: false,
    characterFilterMode: "any",
    characterFilterIds: [],
    characterTagFilterMode: "any",
    characterTagFilters: [],
    generationTriggerFilterMode: "any",
    generationTriggerFilters: [],
    additionalMatchingSources: [],
    position: 0,
    depth: 4,
    order: 100,
    role: "system",
    sticky: null,
    cooldown: null,
    delay: null,
    ephemeral: null,
    group: "",
    groupWeight: null,
    folderId: null,
    locked: false,
    preventRecursion: false,
    tag: "",
    relationships: {},
    dynamicState: {},
    activationConditions: [],
    schedule: null,
    excludeFromVectorization: false,
    embedding: null,
    embeddingModel: null,
    embeddingConnectionId: null,
    embeddingUpdatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("lorebook keyword scanner", () => {
  it("treats per-entry scanDepth 0 as full history while null inherits bounded scan text", async () => {
    const messages = [
      { role: "user", content: "ancient gate opened long ago" },
      { role: "assistant", content: "recent reply only" },
    ];

    const activated = await scanForActivatedEntries(
      messages,
      [
        entry({ id: "full-history", keys: ["ancient gate"], scanDepth: 0 }),
        entry({ id: "bounded", keys: ["ancient gate"], scanDepth: null }),
      ],
      { scanDepth: 1 },
    );

    expect(activated.map((item) => item.entry.id)).toEqual(["full-history"]);
  });
});
