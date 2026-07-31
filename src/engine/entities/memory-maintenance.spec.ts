import { describe, expect, it } from "vitest";

import type { MemoryCleanupProposal, MemoryCleanupSource } from "../contracts/types/memory-maintenance";
import { prepareMemoryCleanupCandidates, validateCleanupProposal } from "./memory-maintenance";

function source(overrides: Partial<MemoryCleanupSource> = {}): MemoryCleanupSource {
  return {
    id: "memory-1",
    scope: { kind: "chat", id: "chat-1" },
    content: "Mira keeps the brass key.",
    kind: "fact",
    status: "active",
    origin: "automatic",
    confidence: 0.8,
    messageIds: [],
    sourceChatIds: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    pinned: false,
    userEdited: false,
    automaticLineage: true,
    ...overrides,
  };
}

function containsEverySource(group: { sourceIds: string[] }, ids: string[]): boolean {
  return ids.every((id) => group.sourceIds.includes(id));
}

function proposal(overrides: Partial<MemoryCleanupProposal> = {}): MemoryCleanupProposal {
  return {
    id: "proposal-1",
    type: "combine",
    sourceIds: ["memory-a", "memory-b"],
    expected: {},
    replacement: { content: "Mira keeps the brass key.", kind: "fact" },
    reason: "Overlapping memories",
    selected: true,
    estimatedTokensBefore: 12,
    estimatedTokensAfter: 7,
    ...overrides,
  };
}

describe("memory cleanup preparation", () => {
  it("allows every active provenance and pin variant while excluding inactive rows", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "automatic", origin: "automatic" }),
      source({ id: "pinned", status: "pinned", pinned: true }),
      source({ id: "manual", origin: "manual", userEdited: true }),
      source({ id: "imported", origin: "imported" }),
      source({ id: "correction", origin: "correction" }),
      source({ id: "command", origin: "command" }),
      source({ id: "wrong", status: "wrong" }),
    ]);

    expect(prepared.eligible.map((memory) => memory.id)).toEqual([
      "automatic",
      "pinned",
      "manual",
      "imported",
      "correction",
      "command",
    ]);
  });

  it("groups exact, provenance-overlap, lexical, and embedding candidates", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "exact-a", content: "Mira keeps the brass key." }),
      source({ id: "exact-b", content: "  mira keeps the brass key. " }),
      source({ id: "provenance", content: "The ferry leaves before dawn.", messageIds: ["message-1"] }),
      source({ id: "same-message", content: "Ferry departure is before dawn.", messageIds: ["message-1"] }),
      source({ id: "lexical-a", content: "Mira carries the brass key every day." }),
      source({ id: "lexical-b", content: "Every day Mira carries her brass key." }),
      source({ id: "embedding-a", content: "One unrelated phrase.", embedding: [1, 0] }),
      source({ id: "embedding-b", content: "Another unrelated phrase.", embedding: [0.9, 0.1] }),
    ]);

    expect(prepared.groups.some((group) => containsEverySource(group, ["exact-a", "exact-b"]))).toBe(true);
    expect(prepared.groups.some((group) => containsEverySource(group, ["provenance", "same-message"]))).toBe(true);
    expect(prepared.groups.some((group) => containsEverySource(group, ["lexical-a", "lexical-b"]))).toBe(true);
    expect(prepared.groups.some((group) => containsEverySource(group, ["embedding-a", "embedding-b"]))).toBe(true);
  });

  it("finds a short fact inside a longer elaboration with two shared meaningful tokens", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "short", content: "The brass key remains." }),
      source({
        id: "elaboration",
        content: "Mira hid the old brass key beneath the loose floorboard yesterday.",
      }),
    ]);

    expect(prepared.groups.some((group) => containsEverySource(group, ["short", "elaboration"]))).toBe(true);
  });

  it("accepts useful 0.80 embedding similarity without grouping unrelated vectors", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "near-a", content: "North window.", embedding: [1, 0] }),
      source({ id: "near-b", content: "Unrelated wording.", embedding: [0.8, 0.6] }),
      source({ id: "far", content: "Different wording.", embedding: [0, 1] }),
    ]);

    expect(prepared.groups.some((group) => containsEverySource(group, ["near-a", "near-b"]))).toBe(true);
    expect(prepared.groups.some((group) => containsEverySource(group, ["near-a", "far"]))).toBe(false);
  });

  it("does not create a singleton candidate because a memory is long", () => {
    const prepared = prepareMemoryCleanupCandidates([source({ id: "long", content: "x".repeat(601) })]);

    expect(prepared.groups).toEqual([]);
    expect(prepared.deferredCandidateCount).toBe(0);
  });

  it("does not group merely related memories", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "harbor", content: "Mira visited the harbor at dawn." }),
      source({ id: "ferry", content: "Mira promised to board the evening ferry." }),
    ]);

    expect(prepared.groups).toEqual([]);
  });

  it("never groups identical content across owner scopes", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "chat-one", scope: { kind: "chat", id: "chat-1" } }),
      source({ id: "chat-two", scope: { kind: "chat", id: "chat-2" } }),
    ]);

    expect(prepared.groups).toEqual([]);
  });

  it("defers independent consolidation groups beyond the per-analysis budget", () => {
    const prepared = prepareMemoryCleanupCandidates(
      Array.from({ length: 22 }, (_, index) => [
        source({ id: `pair-${index}-a`, content: `unique-${index}` }),
        source({ id: `pair-${index}-b`, content: `unique-${index}` }),
      ]).flat(),
    );

    expect(prepared.groups).toHaveLength(12);
    expect(prepared.deferredCandidateCount).toBe(10);
  });

  it("covers every edge in a component larger than one model group", () => {
    const chain = Array.from({ length: 12 }, (_, index) =>
      source({
        id: `chain-${index.toString().padStart(2, "0")}`,
        content: `Distinct memory ${index}.`,
        messageIds: [`edge-${index - 1}`, `edge-${index}`],
      }),
    );
    const prepared = prepareMemoryCleanupCandidates(chain);

    expect(prepared.groups.every((group) => group.sourceIds.length <= 8)).toBe(true);
    for (let index = 0; index < chain.length - 1; index += 1) {
      expect(
        prepared.groups.some((group) =>
          containsEverySource(group, [
            `chain-${index.toString().padStart(2, "0")}`,
            `chain-${(index + 1).toString().padStart(2, "0")}`,
          ]),
        ),
      ).toBe(true);
    }
    expect(prepared.deferredCandidateCount).toBe(0);
  });

  it("keeps an oversized qualifying seed pair instead of dropping it", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "large-a", content: "a".repeat(7_000), messageIds: ["shared"] }),
      source({ id: "large-b", content: "b".repeat(7_000), messageIds: ["shared"] }),
      source({ id: "extra", content: "c".repeat(2_000), messageIds: ["shared"] }),
    ]);

    expect(prepared.groups.some((group) => containsEverySource(group, ["large-a", "large-b"]))).toBe(true);
    expect(prepared.groups.find((group) => containsEverySource(group, ["large-a", "large-b"]))?.sourceIds).toHaveLength(
      2,
    );
  });

  it("builds the same groups regardless of source input order", () => {
    const sources = [
      source({ id: "a", content: "Mira keeps the brass key." }),
      source({ id: "b", content: "The brass key remains with Mira." }),
      source({ id: "c", content: "Mira stores the brass key in her coat." }),
    ];

    expect(prepareMemoryCleanupCandidates(sources).groups).toEqual(
      prepareMemoryCleanupCandidates([...sources].reverse()).groups,
    );
  });

  it("does not treat one oversized memory as a deferred consolidation candidate", () => {
    const prepared = prepareMemoryCleanupCandidates([source({ id: "oversized", content: "x".repeat(12_001) })]);

    expect(prepared.groups).toEqual([]);
    expect(prepared.deferredCandidateCount).toBe(0);
  });

  it("groups oversized exact duplicates because they do not need a model prompt", () => {
    const content = "x".repeat(12_001);
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "oversized-a", content }),
      source({ id: "oversized-b", content }),
    ]);

    expect(prepared.groups).toEqual([
      expect.objectContaining({
        id: "cleanup-group-1",
        sourceIds: ["oversized-a", "oversized-b"],
      }),
    ]);
    expect(prepared.deferredCandidateCount).toBe(0);
  });

  it("covers every eligible source exactly once in deterministic value groups", () => {
    const sources = Array.from({ length: 19 }, (_, index) =>
      source({ id: `memory-${index.toString().padStart(2, "0")}`, content: `Fact ${index}` }),
    );

    const forward = prepareMemoryCleanupCandidates(sources).valueGroups;
    const reverse = prepareMemoryCleanupCandidates([...sources].reverse()).valueGroups;
    const ids = forward.flatMap((group) => group.sourceIds);

    expect(forward).toEqual(reverse);
    expect(forward.every((group) => group.sourceIds.length <= 32)).toBe(true);
    expect(ids).toEqual(sources.map((memory) => memory.id));
    expect(new Set(ids).size).toBe(sources.length);
  });

  it("bounds Harlequin-scale provider work without skipping low-value review", () => {
    const sources = Array.from({ length: 94 }, (_, index) =>
      source({
        id: `harlequin-${index.toString().padStart(2, "0")}`,
        content: `Harlequin remembers circus detail ${index} with the shared crimson stage lantern.`,
      }),
    );

    const prepared = prepareMemoryCleanupCandidates(sources);
    const valueIds = prepared.valueGroups.flatMap((group) => group.sourceIds);

    expect(prepared.eligible).toHaveLength(94);
    expect(prepared.valueGroups).toHaveLength(3);
    expect(valueIds).toEqual(sources.map((memory) => memory.id));
    expect(new Set(valueIds).size).toBe(94);
    expect(prepared.groups).toHaveLength(12);
    expect(prepared.deferredCandidateCount).toBeGreaterThan(0);
  });

  it("keeps an oversized source in its own value group", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "oversized", content: "x".repeat(12_001) }),
      source({ id: "small", content: "Useful preference." }),
    ]);

    expect(prepared.valueGroups).toEqual([
      { id: "cleanup-value-group-1", sourceIds: ["oversized"] },
      { id: "cleanup-value-group-2", sourceIds: ["small"] },
    ]);
  });

  it("starts a new value group before adding a source past the character target", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "a", content: "a".repeat(7_000) }),
      source({ id: "b", content: "b".repeat(6_000) }),
      source({ id: "c", content: "c".repeat(1_000) }),
    ]);

    expect(prepared.valueGroups).toEqual([
      { id: "cleanup-value-group-1", sourceIds: ["a"] },
      { id: "cleanup-value-group-2", sourceIds: ["b", "c"] },
    ]);
  });

  it("includes pinned manual and edited memories but excludes inactive rows from value review", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "pinned", status: "pinned", pinned: true }),
      source({ id: "manual", origin: "manual" }),
      source({ id: "edited", userEdited: true }),
      source({ id: "wrong", status: "wrong" }),
    ]);

    expect(prepared.valueGroups.flatMap((group) => group.sourceIds)).toEqual(["edited", "manual", "pinned"]);
  });
});

describe("memory cleanup proposal validation", () => {
  it("allows active manual, imported, correction, and command memories to be consumed", () => {
    const sources = [
      source({ id: "manual", origin: "manual", userEdited: true }),
      source({ id: "imported", origin: "imported" }),
      source({ id: "correction", origin: "correction" }),
      source({ id: "command", origin: "command" }),
    ];

    for (const candidate of sources) {
      const other = source({ id: `other-${candidate.id}` });
      const value = proposal({ sourceIds: [candidate.id, other.id] });
      expect(
        validateCleanupProposal(
          value,
          new Map([
            [candidate.id, candidate],
            [other.id, other],
          ]),
        ),
      ).toEqual(value);
    }
  });

  it("requires a pinned winner when keep-one consolidation references pinned memory", () => {
    const automatic = source({ id: "automatic", confidence: 0.99 });
    const pinned = source({ id: "pinned", status: "pinned", pinned: true });
    const valid = proposal({
      type: "keep_one",
      sourceIds: ["automatic"],
      winnerId: "pinned",
      replacement: undefined,
      reason: "Repeated fact",
    });

    expect(
      validateCleanupProposal(
        valid,
        new Map([
          [automatic.id, automatic],
          [pinned.id, pinned],
        ]),
      ),
    ).toEqual(valid);

    expect(() =>
      validateCleanupProposal(
        proposal({
          type: "keep_one",
          sourceIds: ["pinned"],
          winnerId: "automatic",
          replacement: undefined,
          reason: "Repeated fact",
        }),
        new Map([
          [automatic.id, automatic],
          [pinned.id, pinned],
        ]),
      ),
    ).toThrow("pinned winner");
  });

  it("rejects inactive consumption, cross-scope rows, and selected conflicts", () => {
    const automatic = source({ id: "automatic" });
    const inactive = source({ id: "inactive", status: "wrong" });
    const otherScope = source({
      id: "other",
      scope: { kind: "chat", id: "chat-2" },
    });
    const sources = new Map([
      [automatic.id, automatic],
      [inactive.id, inactive],
      [otherScope.id, otherScope],
    ]);

    expect(() => validateCleanupProposal(proposal({ sourceIds: ["automatic", "inactive"] }), sources)).toThrow(
      "inactive",
    );
    expect(() => validateCleanupProposal(proposal({ sourceIds: ["automatic", "other"] }), sources)).toThrow("scope");
    expect(() =>
      validateCleanupProposal(
        proposal({
          type: "conflict",
          sourceIds: [],
          winnerId: undefined,
          replacement: undefined,
          selected: true,
          reason: "Possible conflict",
        }),
        sources,
      ),
    ).toThrow("Conflicts cannot be selected");
  });

  it("rejects proposal shapes that storage cannot apply", () => {
    const automatic = source({ id: "automatic" });
    const sources = new Map([[automatic.id, automatic]]);

    expect(() => validateCleanupProposal(proposal({ type: "combine", sourceIds: ["automatic"] }), sources)).toThrow(
      "at least two",
    );
  });

  it("accepts one unchecked discard without a winner or replacement", () => {
    const memory = source({ id: "junk", status: "pinned", pinned: true, origin: "manual" });
    const discard = proposal({
      type: "discard",
      sourceIds: ["junk"],
      winnerId: undefined,
      replacement: undefined,
      reason: "Low-value memory",
      selected: false,
      estimatedTokensAfter: 0,
    });

    expect(validateCleanupProposal(discard, new Map([[memory.id, memory]]))).toEqual(discard);
  });

  it("rejects discard with zero or multiple sources, a winner, or a replacement", () => {
    const one = source({ id: "one" });
    const two = source({ id: "two" });
    const sources = new Map([
      [one.id, one],
      [two.id, two],
    ]);
    const base = {
      type: "discard" as const,
      reason: "Low-value memory" as const,
      selected: false,
      replacement: undefined,
      winnerId: undefined,
    };

    expect(() => validateCleanupProposal(proposal({ ...base, sourceIds: [] }), sources)).toThrow("exactly one");
    expect(() => validateCleanupProposal(proposal({ ...base, sourceIds: ["one", "two"] }), sources)).toThrow(
      "exactly one",
    );
    expect(() => validateCleanupProposal(proposal({ ...base, sourceIds: ["one"], winnerId: "two" }), sources)).toThrow(
      "winner",
    );
    expect(() =>
      validateCleanupProposal(
        proposal({
          ...base,
          sourceIds: ["one"],
          replacement: { content: "replacement", kind: "fact" },
        }),
        sources,
      ),
    ).toThrow("replacement");
  });

  it("accepts only a single-source kind-preserving context clarification", () => {
    const one = source({ id: "one", kind: "fact" });
    const two = source({ id: "two", kind: "fact" });
    const sources = new Map([
      [one.id, one],
      [two.id, two],
    ]);
    const clarify = proposal({
      id: "clarify-one",
      type: "clarify",
      sourceIds: ["one"],
      winnerId: undefined,
      replacement: { content: "Pierrot avoids discussing the circus accident.", kind: "fact" },
      reason: "Context clarification",
      estimatedTokensBefore: 8,
      estimatedTokensAfter: 8,
    });

    expect(validateCleanupProposal(clarify, sources)).toEqual(clarify);
    expect(() => validateCleanupProposal(proposal({ ...clarify, sourceIds: [] }), sources)).toThrow("one source");
    expect(() => validateCleanupProposal(proposal({ ...clarify, sourceIds: ["one", "two"] }), sources)).toThrow(
      "one source",
    );
    expect(() => validateCleanupProposal(proposal({ ...clarify, winnerId: "two" }), sources)).toThrow("winner");
    expect(() => validateCleanupProposal(proposal({ ...clarify, replacement: undefined }), sources)).toThrow(
      "replacement",
    );
    expect(() =>
      validateCleanupProposal(
        proposal({ ...clarify, replacement: { content: "Pierrot avoids the accident.", kind: "plot_state" } }),
        sources,
      ),
    ).toThrow("kind");
    expect(() => validateCleanupProposal(proposal({ ...clarify, reason: "Overlapping memories" }), sources)).toThrow(
      "context clarification",
    );
  });
});
