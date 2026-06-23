import { describe, expect, it } from "vitest";
import type { LorebookEntry } from "../../contracts/types/lorebook";
import { scanForActivatedEntries, scanForActivatedEntriesWithTrace } from "./keyword-scanner";

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

  it("explains keyword, timing, probability, semantic, and group decisions", async () => {
    const messages = [{ role: "user", content: "ancient gate silver moon" }];

    const result = await scanForActivatedEntriesWithTrace(
      messages,
      [
        entry({ id: "constant", constant: true, order: 0 }),
        entry({ id: "primary-miss", keys: ["missing"] }),
        entry({
          id: "secondary-miss",
          keys: ["ancient gate"],
          selective: true,
          secondaryKeys: ["lost crown"],
        }),
        entry({ id: "cooldown", keys: ["ancient gate"], cooldown: 2 }),
        entry({ id: "probability-failed", keys: ["ancient gate"], probability: 25 }),
        entry({ id: "semantic", keys: ["missing"], embedding: [1, 0], order: 1 }),
        entry({ id: "group-winner", keys: ["ancient gate"], group: "one", groupWeight: 90, order: 2 }),
        entry({ id: "group-loser", keys: ["ancient gate"], group: "one", groupWeight: 10 }),
        entry({ id: "sticky", keys: ["missing"], order: 3 }),
      ],
      {
        timingStates: new Map([
          ["cooldown", { lastActivatedAt: 1, stickyCount: 0, cooldownRemaining: 1, delayRemaining: 0 }],
          ["sticky", { lastActivatedAt: 1, stickyCount: 1, cooldownRemaining: 0, delayRemaining: 0 }],
        ]),
        chatEmbedding: [1, 0],
        random: () => 0.9,
      },
    );

    expect(result.activatedEntries.map((item) => item.entry.id)).toEqual(["constant", "semantic", "group-winner", "sticky"]);

    const traceById = new Map(result.trace.entries.map((item) => [item.entryId, item]));
    expect(traceById.get("constant")).toMatchObject({
      status: "included",
      reason: "constant",
      matchedKeys: ["[constant]"],
    });
    expect(traceById.get("primary-miss")).toMatchObject({
      status: "skipped",
      reason: "primary_key_miss",
      hint: "Edit this entry's keys or increase scan depth.",
    });
    expect(traceById.get("secondary-miss")).toMatchObject({
      status: "skipped",
      reason: "secondary_key_miss",
      matchedKeys: ["ancient gate"],
    });
    expect(traceById.get("cooldown")).toMatchObject({
      status: "skipped",
      reason: "timing_blocked",
      timing: { cooldownRemaining: 1 },
    });
    expect(traceById.get("probability-failed")).toMatchObject({
      status: "skipped",
      reason: "probability_failed",
      probability: { configured: 25, roll: 90, passed: false },
    });
    expect(traceById.get("semantic")).toMatchObject({
      status: "included",
      reason: "semantic_match",
      semanticScore: 1,
      matchedKeys: ["[semantic:1.000]"],
    });
    expect(traceById.get("group-winner")).toMatchObject({
      status: "included",
      reason: "keyword_match",
      matchedKeys: ["ancient gate"],
    });
    expect(traceById.get("group-loser")).toMatchObject({
      status: "skipped",
      reason: "group_loser",
      matchedKeys: ["ancient gate"],
    });
    expect(traceById.get("sticky")).toMatchObject({
      status: "included",
      reason: "sticky",
      matchedKeys: ["[sticky]"],
    });
  });

});
