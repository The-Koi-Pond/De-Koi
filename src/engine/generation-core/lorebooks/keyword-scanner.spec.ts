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
    excludeRecursion: false,
    delayUntilRecursion: false,
    groupOverride: false,
    useGroupScoring: false,
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
        entry({ id: "group-winner", keys: ["ancient gate"], group: "one", groupWeight: 95, order: 2 }),
        entry({ id: "group-loser", keys: ["ancient gate"], group: "one", groupWeight: 5 }),
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

    expect(result.activatedEntries.map((item) => item.entry.id)).toEqual([
      "constant",
      "semantic",
      "group-winner",
      "sticky",
    ]);

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

describe("inclusion groups", () => {
  const chat = [{ role: "user", content: "the ancient gate under a silver moon" }];
  const ids = async (entries: LorebookEntry[], options: Parameters<typeof scanForActivatedEntries>[2] = {}) =>
    (await scanForActivatedEntries(chat, entries, options)).map((item) => item.entry.id).sort();

  it("picks one entry at random, weighted by group weight", async () => {
    const entries = [
      entry({ id: "light", keys: ["gate"], group: "doors", groupWeight: 30 }),
      entry({ id: "heavy", keys: ["gate"], group: "doors", groupWeight: 70 }),
    ];

    await expect(ids(entries, { random: () => 0.2 })).resolves.toEqual(["light"]);
    await expect(ids(entries, { random: () => 0.5 })).resolves.toEqual(["heavy"]);
  });

  it("lets a Prioritize entry win by highest order", async () => {
    const entries = [
      entry({ id: "low", keys: ["gate"], group: "doors", groupOverride: true, order: 5 }),
      entry({ id: "high", keys: ["gate"], group: "doors", groupOverride: true, order: 9 }),
      entry({ id: "heavy", keys: ["gate"], group: "doors", groupWeight: 1000 }),
    ];

    await expect(ids(entries, { random: () => 0 })).resolves.toEqual(["high"]);
  });

  it("keeps only the entries that matched the most keys when group scoring is on", async () => {
    const entries = [
      entry({ id: "two-keys", keys: ["gate", "moon"], group: "doors", groupWeight: 1, useGroupScoring: true }),
      entry({ id: "one-key", keys: ["gate"], group: "doors", groupWeight: 1000 }),
    ];

    await expect(ids(entries, { random: () => 0.99 })).resolves.toEqual(["two-keys"]);
  });

  it("treats comma-separated groups as separate groups", async () => {
    const entries = [
      entry({ id: "both", keys: ["gate"], group: "doors, night", groupOverride: true }),
      entry({ id: "door", keys: ["gate"], group: "doors" }),
      entry({ id: "night", keys: ["moon"], group: "night" }),
      entry({ id: "free", keys: ["moon"] }),
    ];

    await expect(ids(entries)).resolves.toEqual(["both", "free"]);
  });

  it("keeps a sticky entry over new matches in its group", async () => {
    const entries = [
      entry({ id: "sticky", keys: ["missing"], group: "doors" }),
      entry({ id: "fresh", keys: ["gate"], group: "doors", groupOverride: true }),
    ];
    const timingStates = new Map([
      ["sticky", { lastActivatedAt: 1, stickyCount: 1, cooldownRemaining: 0, delayRemaining: 0 }],
    ]);

    await expect(ids(entries, { timingStates })).resolves.toEqual(["sticky"]);
  });

  it("drops new matches for a group that already has a winner from an earlier pass", async () => {
    const entries = [entry({ id: "late", keys: ["gate"], group: "doors" }), entry({ id: "free", keys: ["gate"] })];

    await expect(ids(entries, { takenGroups: new Set(["doors"]) })).resolves.toEqual(["free"]);
  });
});

describe("recursion flags", () => {
  const chat = [{ role: "user", content: "we reach the ancient gate" }];

  it("waits for a recursive pass before a Delay to Recursion entry can fire, then scans chat and recursion", async () => {
    const delayed = entry({ id: "delayed", keys: ["ancient gate"], delayUntilRecursion: true });

    const direct = await scanForActivatedEntriesWithTrace(chat, [delayed]);
    expect(direct.activatedEntries).toEqual([]);
    expect(direct.trace.entries[0]).toMatchObject({ status: "skipped", reason: "recursion_delayed" });

    const recursive = await scanForActivatedEntries(chat, [delayed], {
      recursionPass: 1,
      recursionText: "unrelated lore",
    });
    expect(recursive.map((item) => item.entry.id)).toEqual(["delayed"]);
  });

  it("never lets recursion activate a Non-recursable entry", async () => {
    const guarded = entry({ id: "guarded", keys: ["dragon"], excludeRecursion: true });
    const open = entry({ id: "open", keys: ["dragon"] });

    const result = await scanForActivatedEntriesWithTrace(chat, [guarded, open], {
      recursionPass: 1,
      recursionText: "a dragon sleeps here",
    });

    expect(result.activatedEntries.map((item) => item.entry.id)).toEqual(["open"]);
    expect(result.trace.entries.find((item) => item.entryId === "guarded")).toMatchObject({
      status: "skipped",
      reason: "recursion_excluded",
    });
  });

  it("scans only the recursive content for ordinary entries in recursive passes", async () => {
    const result = await scanForActivatedEntries(chat, [entry({ id: "chat-only", keys: ["ancient gate"] })], {
      recursionPass: 1,
      recursionText: "a dragon sleeps here",
    });

    expect(result).toEqual([]);
  });
});
