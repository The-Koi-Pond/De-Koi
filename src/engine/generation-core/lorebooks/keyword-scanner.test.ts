import { describe, expect, it } from "vitest";
import type { LorebookEntry } from "../../contracts/types/lorebook";
import { scanForActivatedEntries } from "./keyword-scanner";

function lorebookEntry(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id: "entry",
    lorebookId: "book",
    name: "Entry",
    content: "Entry content.",
    description: "",
    keys: ["needle"],
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
    depth: 0,
    order: 0,
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
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("scanForActivatedEntries vector exclusions", () => {
  it("does not activate excluded entries through semantic fallback", () => {
    const entries = [
      lorebookEntry({
        keys: ["absent-key"],
        excludeFromVectorization: true,
        embedding: [1, 0],
      }),
    ];

    const activated = scanForActivatedEntries([{ role: "user", content: "No keyword match here." }], entries, {
      chatEmbedding: [1, 0],
      semanticThreshold: 0.5,
    });

    expect(activated).toHaveLength(0);
  });

  it("still activates excluded entries through keyword matching", () => {
    const entries = [lorebookEntry({ excludeFromVectorization: true, embedding: [1, 0] })];

    const activated = scanForActivatedEntries([{ role: "user", content: "The needle is visible." }], entries, {
      chatEmbedding: [0, 1],
      semanticThreshold: 0.5,
    });

    expect(activated.map((entry) => entry.entry.id)).toEqual(["entry"]);
    expect(activated[0]?.matchedKeys).toEqual(["needle"]);
  });
});

describe("scanForActivatedEntries secondary keyword logic", () => {
  it("honors AND secondary keys even when imported entries omitted the selective flag", () => {
    const entries = [
      lorebookEntry({
        keys: ["dragon"],
        secondaryKeys: ["cave"],
        selective: false,
        selectiveLogic: "and",
      }),
    ];

    expect(scanForActivatedEntries([{ role: "user", content: "The dragon circles overhead." }], entries)).toHaveLength(
      0,
    );

    expect(
      scanForActivatedEntries([{ role: "user", content: "The dragon waits inside the cave." }], entries).map(
        (entry) => entry.entry.id,
      ),
    ).toEqual(["entry"]);
  });

  it("honors OR and NOT secondary-key logic", () => {
    const orEntry = lorebookEntry({
      id: "or-entry",
      keys: ["gate"],
      secondaryKeys: ["silver", "gold"],
      selectiveLogic: "or",
    });
    const notEntry = lorebookEntry({
      id: "not-entry",
      keys: ["gate"],
      secondaryKeys: ["sealed"],
      selectiveLogic: "not",
    });

    expect(
      scanForActivatedEntries([{ role: "user", content: "The gold gate opens." }], [orEntry]).map(
        (entry) => entry.entry.id,
      ),
    ).toEqual(["or-entry"]);
    expect(scanForActivatedEntries([{ role: "user", content: "The bronze gate opens." }], [orEntry])).toHaveLength(0);
    expect(scanForActivatedEntries([{ role: "user", content: "The sealed gate opens." }], [notEntry])).toHaveLength(
      0,
    );
    expect(
      scanForActivatedEntries([{ role: "user", content: "The quiet gate opens." }], [notEntry]).map(
        (entry) => entry.entry.id,
      ),
    ).toEqual(["not-entry"]);
  });
});
