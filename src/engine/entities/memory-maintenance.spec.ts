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
    ...overrides,
  };
}

function proposal(overrides: Partial<MemoryCleanupProposal> = {}): MemoryCleanupProposal {
  return {
    id: "proposal-1",
    type: "combine",
    sourceIds: ["memory-a", "memory-b"],
    expected: {},
    replacement: { content: "Mira keeps the brass key.", kind: "fact" },
    reason: "Overlapping detail",
    selected: true,
    estimatedTokensBefore: 12,
    estimatedTokensAfter: 7,
    ...overrides,
  };
}

describe("memory cleanup preparation", () => {
  it("protects curated and inactive rows while allowing automatic rows", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "automatic", origin: "automatic" }),
      source({ id: "pinned", pinned: true }),
      source({ id: "manual", userEdited: true }),
      source({ id: "imported", origin: "imported" }),
      source({ id: "wrong", status: "wrong" }),
    ]);

    expect(prepared.eligible.map((memory) => memory.id)).toEqual(["automatic"]);
    expect(prepared.protected.map((memory) => memory.id)).toEqual(["pinned", "manual", "imported", "wrong"]);
  });

  it("groups exact, provenance-overlap, lexical, embedding, and verbose candidates", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "exact-a", content: "Mira keeps the brass key." }),
      source({ id: "exact-b", content: "  mira keeps the brass key. " }),
      source({ id: "provenance", content: "The ferry leaves before dawn.", messageIds: ["message-1"] }),
      source({ id: "same-message", content: "Ferry departure is before dawn.", messageIds: ["message-1"] }),
      source({ id: "lexical-a", content: "Mira carries the brass key every day." }),
      source({ id: "lexical-b", content: "Every day Mira carries her brass key." }),
      source({ id: "embedding-a", content: "One unrelated phrase.", embedding: [1, 0] }),
      source({ id: "embedding-b", content: "Another unrelated phrase.", embedding: [0.9, 0.1] }),
      source({ id: "verbose", content: "x".repeat(601) }),
    ]);

    const groups = prepared.groups.map((group) => [...group.sourceIds].sort().join(","));
    expect(groups).toContain("exact-a,exact-b");
    expect(groups).toContain("provenance,same-message");
    expect(groups).toContain("lexical-a,lexical-b");
    expect(groups).toContain("embedding-a,embedding-b");
    expect(prepared.groups.some((group) => group.sourceIds.includes("verbose"))).toBe(true);
  });

  it("does not group merely related memories", () => {
    const prepared = prepareMemoryCleanupCandidates([
      source({ id: "harbor", content: "Mira visited the harbor at dawn." }),
      source({ id: "ferry", content: "Mira promised to board the evening ferry." }),
    ]);

    expect(prepared.groups).toEqual([]);
  });

  it("caps model-facing groups and reports deferred candidates", () => {
    const prepared = prepareMemoryCleanupCandidates(
      Array.from({ length: 22 }, (_, index) =>
        source({ id: `verbose-${index}`, content: `${index}:${"x".repeat(601)}` }),
      ),
    );

    expect(prepared.groups).toHaveLength(20);
    expect(prepared.deferredCandidateCount).toBe(2);
  });

  it("defers a single oversized memory instead of exceeding the model prompt cap", () => {
    const prepared = prepareMemoryCleanupCandidates([source({ id: "oversized", content: "x".repeat(12_001) })]);

    expect(prepared.groups).toEqual([]);
    expect(prepared.deferredCandidateCount).toBe(1);
  });
});

describe("memory cleanup proposal validation", () => {
  it("allows a retained protected winner but never consumes it", () => {
    const automatic = source({ id: "automatic" });
    const pinned = source({ id: "pinned", pinned: true });
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
  });

  it("rejects protected consumption, cross-scope rows, and selected conflicts", () => {
    const automatic = source({ id: "automatic" });
    const manual = source({ id: "manual", origin: "manual", userEdited: true });
    const otherScope = source({
      id: "other",
      scope: { kind: "chat", id: "chat-2" },
    });
    const sources = new Map([
      [automatic.id, automatic],
      [manual.id, manual],
      [otherScope.id, otherScope],
    ]);

    expect(() => validateCleanupProposal(proposal({ sourceIds: ["automatic", "manual"] }), sources)).toThrow(
      "protected",
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
    expect(() =>
      validateCleanupProposal(
        proposal({
          type: "shorten",
          sourceIds: ["automatic", "automatic-2"],
        }),
        new Map([
          [automatic.id, automatic],
          ["automatic-2", source({ id: "automatic-2" })],
        ]),
      ),
    ).toThrow("exactly one");
  });
});
