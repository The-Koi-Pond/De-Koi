import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../../src/engine/capabilities/storage";
import type { AgentResult } from "../../src/engine/contracts/types/agent";
import {
  loadNarrativeCraftState,
  persistNarrativeCraftAgentMemory,
} from "../../src/engine/generation/agent-memory-runtime";

function storageWithRows(rows: Array<Record<string, unknown>>) {
  const storage = {
    list: vi.fn(async (collection: string, options?: { filters?: Record<string, unknown> }) => {
      if (collection === "agents") return [];
      if (collection !== "agent-memory") return [];
      const filters = options?.filters ?? {};
      return rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
    }),
    create: vi.fn(async (collection: string, value: Record<string, unknown>) => {
      const row = { id: `row-${rows.length + 1}`, ...value };
      if (collection === "agent-memory") rows.push(row);
      return row;
    }),
    update: vi.fn(async (_collection: string, id: string, patch: Record<string, unknown>) => {
      const row = rows.find((entry) => entry.id === id);
      if (row) Object.assign(row, patch);
      return row;
    }),
  } as unknown as StorageGateway;
  return storage;
}

describe("Narrative Craft memory runtime", () => {
  it("converts active legacy Secret Plot state without deleting the source rows", async () => {
    const rows = [
      {
        id: "arc",
        agentConfigId: "secret-plot-driver",
        chatId: "chat-1",
        key: "overarchingArc",
        value: JSON.stringify({ title: "A lost treaty resurfaces" }),
      },
      {
        id: "directions",
        agentConfigId: "secret-plot-driver",
        chatId: "chat-1",
        key: "sceneDirections",
        value: JSON.stringify([
          { direction: "Let the clue surface quietly.", fulfilled: false },
          { direction: "Resolve the old detour.", fulfilled: true },
        ]),
      },
    ];
    const storage = storageWithRows(rows);

    await expect(loadNarrativeCraftState(storage, "builtin:narrative-craft", "chat-1")).resolves.toMatchObject({
      threads: [
        expect.objectContaining({ kind: "main", summary: "A lost treaty resurfaces" }),
        expect.objectContaining({ kind: "subplot", summary: "Let the clue surface quietly." }),
      ],
    });
    expect(rows).toHaveLength(2);
  });

  it("persists one bounded current state row including the analysis reason", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const storage = storageWithRows(rows);
    const result = {
      agentId: "builtin:narrative-craft",
      agentType: "narrative-craft",
      type: "context_injection",
      data: {
        text: "",
        state: { pacing: "building", openQuestions: ["Who moved the key?"] },
        reason: "The current scene needs no intervention.",
      },
      tokensUsed: 0,
      durationMs: 0,
      success: true,
      error: null,
    } satisfies AgentResult;

    await persistNarrativeCraftAgentMemory(storage, "chat-1", [result]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentConfigId: "builtin:narrative-craft",
      chatId: "chat-1",
      key: "state",
    });
    expect(JSON.parse(String(rows[0]?.value))).toMatchObject({
      pacing: "building",
      openQuestions: ["Who moved the key?"],
      lastAnalysisReason: "The current scene needs no intervention.",
    });
  });
});
