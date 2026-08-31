import { describe, expect, it } from "vitest";
import type { KnowledgeEdge } from "../contracts/types/memory";
import { formatEpistemicMemory, resolveEpistemicAccess } from "./epistemic-access";
import { epistemicSubjectsForGeneration } from "./epistemic-context";

const NOW = "2026-08-30T12:00:00.000Z";

function edge(overrides: Partial<KnowledgeEdge> = {}): KnowledgeEdge {
  return {
    id: "edge-1",
    memoryId: "memory-1",
    holder: { kind: "character", id: "alice" },
    stance: "knows",
    status: "active",
    confidence: null,
    provenance: [
      {
        kind: "user_edit",
        author: "user",
        messageIds: [],
        createdAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("epistemic memory access", () => {
  it("uses only the persona as the subject while impersonating", () => {
    expect(
      epistemicSubjectsForGeneration({
        impersonate: true,
        persona: { id: "persona-1", name: "Celia" },
        characters: [{ id: "alice", name: "Alice" }],
      }),
    ).toEqual([{ kind: "persona", id: "persona-1", name: "Celia" }]);
  });
  it("keeps edge-less memories on legacy scope behavior", () => {
    expect(
      resolveEpistemicAccess({
        memoryId: "memory-1",
        edges: [],
        subjects: [{ kind: "character", id: "alice" }],
        groups: [],
      }),
    ).toMatchObject({ admitted: true, classified: false, reason: "legacy_fallback" });
  });

  it("classifies memories after invalidation so they cannot fall back to legacy visibility", () => {
    expect(
      resolveEpistemicAccess({
        memoryId: "memory-1",
        edges: [edge({ status: "invalidated" })],
        subjects: [{ kind: "character", id: "alice" }],
        groups: [],
      }),
    ).toMatchObject({ admitted: false, classified: true, reason: "missing_edge" });
  });

  it("does not classify or admit a proposed-only edge", () => {
    expect(
      resolveEpistemicAccess({
        memoryId: "memory-1",
        edges: [edge({ status: "proposed" })],
        subjects: [{ kind: "character", id: "alice" }],
        groups: [],
      }),
    ).toMatchObject({ admitted: true, classified: false, reason: "legacy_fallback" });
  });

  it("uses a direct holder edge before group edges", () => {
    const result = resolveEpistemicAccess({
      memoryId: "memory-1",
      edges: [
        edge({ id: "direct", stance: "disbelieves" }),
        edge({ id: "group", holder: { kind: "group", id: "investigators" }, stance: "knows" }),
      ],
      subjects: [{ kind: "character", id: "alice" }],
      groups: [{ id: "investigators", characterIds: ["alice"] }],
    });

    expect(result).toMatchObject({ admitted: true, reason: "direct_edge" });
    expect(result.decisions[0]).toMatchObject({ stance: "disbelieves", edgeIds: ["direct"] });
  });

  it("admits a shared group stance but excludes conflicting group stances", () => {
    const common = {
      memoryId: "memory-1",
      subjects: [{ kind: "character" as const, id: "alice" }],
      groups: [
        { id: "investigators", characterIds: ["alice"] },
        { id: "court", characterIds: ["alice"] },
      ],
    };
    expect(
      resolveEpistemicAccess({
        ...common,
        edges: [
          edge({ id: "g1", holder: { kind: "group", id: "investigators" }, stance: "suspects" }),
          edge({ id: "g2", holder: { kind: "group", id: "court" }, stance: "suspects" }),
        ],
      }),
    ).toMatchObject({ admitted: true, reason: "group_edge" });

    expect(
      resolveEpistemicAccess({
        ...common,
        edges: [
          edge({ id: "g1", holder: { kind: "group", id: "investigators" }, stance: "suspects" }),
          edge({ id: "g2", holder: { kind: "group", id: "court" }, stance: "knows" }),
        ],
      }),
    ).toMatchObject({ admitted: false, reason: "group_conflict" });
  });

  it("requires every possible responder in a merged turn", () => {
    const result = resolveEpistemicAccess({
      memoryId: "memory-1",
      edges: [edge({ holder: { kind: "character", id: "alice" } })],
      subjects: [
        { kind: "character", id: "alice" },
        { kind: "character", id: "bob" },
      ],
      groups: [],
    });

    expect(result).toMatchObject({ admitted: false, classified: true, reason: "merged_intersection_failed" });
    expect(result.decisions).toEqual([
      expect.objectContaining({ subject: { kind: "character", id: "alice" }, admitted: true }),
      expect.objectContaining({ subject: { kind: "character", id: "bob" }, admitted: false }),
    ]);
  });

  it("never grants character access from a world-truth edge", () => {
    expect(
      resolveEpistemicAccess({
        memoryId: "memory-1",
        edges: [edge({ holder: { kind: "world", id: "world" } })],
        subjects: [{ kind: "character", id: "alice" }],
        groups: [],
      }),
    ).toMatchObject({ admitted: false, classified: true, reason: "missing_edge" });
  });

  it("frames belief, suspicion, and disbelief without canonicalizing them as truth", () => {
    expect(formatEpistemicMemory("The duke is a traitor.", [{ subject: { kind: "character", id: "alice" }, stance: "believes" }]))
      .toBe("Alice believes: The duke is a traitor.");
    expect(formatEpistemicMemory("The duke is a traitor.", [{ subject: { kind: "character", id: "alice" }, stance: "suspects" }]))
      .toBe("Alice suspects: The duke is a traitor.");
    expect(formatEpistemicMemory("The duke is a traitor.", [{ subject: { kind: "character", id: "alice" }, stance: "disbelieves" }]))
      .toBe("Alice has heard but disbelieves: The duke is a traitor.");
  });
});
