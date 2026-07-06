import { describe, expect, it } from "vitest";
import type { AgentResult } from "../../src/engine/contracts/types/agent";
import type { StorageGateway } from "../../src/engine/capabilities/storage";
import {
  loadAgentMemory,
  persistSecretPlotAgentMemory,
  secretPlotPromptGuidanceFromData,
  secretPlotStateFromMemory,
} from "../../src/engine/generation/agent-memory-runtime";

function memoryStorage(rows: Array<Record<string, unknown>>): StorageGateway {
  return {
    async list(collection, options) {
      if (collection !== "agent-memory") return [] as never;
      const filters = (options?.filters ?? {}) as Record<string, unknown>;
      return rows.filter((row) =>
        Object.entries(filters).every(([key, value]) => value === undefined || row[key] === value),
      ) as never;
    },
    async update(collection, id, patch) {
      if (collection !== "agent-memory") return null as never;
      const row = rows.find((entry) => entry.id === id);
      if (row) Object.assign(row, patch);
      return row as never;
    },
    async create(collection, value) {
      if (collection !== "agent-memory") return value as never;
      const row = { id: `row-${rows.length + 1}`, ...(value as Record<string, unknown>) };
      rows.push(row);
      return row as never;
    },
  } as StorageGateway;
}

function storedMemoryValue(rows: Array<Record<string, unknown>>, key: string): unknown {
  const value = rows.find((row) => row.key === key)?.value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function secretPlotResult(data: Record<string, unknown>): AgentResult {
  return {
    agentId: "secret-plot-config",
    agentType: "secret-plot-driver",
    type: "secret_plot",
    data,
    tokensUsed: 0,
    durationMs: 0,
    success: true,
    error: null,
  };
}

describe("secret plot memory runtime", () => {
  it("formats active arc and scene directions as hidden main-prompt guidance", () => {
    const guidance = secretPlotPromptGuidanceFromData({
      overarchingArc: { description: "A lost treaty resurfaces.", protagonistArc: "Trust becomes costly." },
      sceneDirections: [
        { direction: "Let the clue surface quietly.", fulfilled: false },
        { direction: "Resolve the old detour.", fulfilled: true },
      ],
    });

    expect(guidance).toContain("<overarching_arc>");
    expect(guidance).toContain("- Let the clue surface quietly.");
    expect(
      secretPlotPromptGuidanceFromData({
        sceneDirections: [{ direction: "Resolve the old detour.", fulfilled: true }],
      }),
    ).toBeNull();
  });

  it("allows full reroll to clear an explicit empty arc", async () => {
    const rows = [
      {
        id: "arc-row",
        agentConfigId: "secret-plot-config",
        chatId: "chat-1",
        key: "overarchingArc",
        value: JSON.stringify({ description: "Existing arc" }),
      },
    ];
    const storage = memoryStorage(rows);

    await persistSecretPlotAgentMemory(storage, "chat-1", [
      secretPlotResult({ overarchingArc: null, sceneDirections: [] }),
    ]);

    expect(rows[0]?.value).toBe("null");
  });

  it("preserves the existing arc on turn-only reroll", async () => {
    const rows = [
      {
        id: "arc-row",
        agentConfigId: "secret-plot-config",
        chatId: "chat-1",
        key: "overarchingArc",
        value: JSON.stringify({ description: "Existing arc" }),
      },
    ];
    const storage = memoryStorage(rows);

    await persistSecretPlotAgentMemory(
      storage,
      "chat-1",
      [secretPlotResult({ overarchingArc: null, sceneDirections: [] })],
      { rerollMode: "turn_only" },
    );

    expect(rows[0]?.value).toBe(JSON.stringify({ description: "Existing arc" }));
  });
  it("rolls fulfilled scene directions into recently fulfilled memory", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const storage = memoryStorage(rows);

    await persistSecretPlotAgentMemory(storage, "chat-1", [
      secretPlotResult({
        sceneDirections: [
          { direction: "Let the clue surface quietly.", fulfilled: false },
          { direction: "Resolve the old detour.", fulfilled: true },
        ],
      }),
    ]);

    expect(storedMemoryValue(rows, "sceneDirections")).toEqual([
      { direction: "Let the clue surface quietly.", fulfilled: false },
    ]);
    expect(storedMemoryValue(rows, "recentlyFulfilled")).toEqual(["Resolve the old detour."]);
  });

  it("keeps only the last ten recently fulfilled directions", async () => {
    const rows: Array<Record<string, unknown>> = [
      {
        id: "fulfilled-row",
        agentConfigId: "secret-plot-config",
        chatId: "chat-1",
        key: "recentlyFulfilled",
        value: JSON.stringify(Array.from({ length: 10 }, (_, index) => `fulfilled-${index + 1}`)),
      },
    ];
    const storage = memoryStorage(rows);

    await persistSecretPlotAgentMemory(storage, "chat-1", [
      secretPlotResult({ sceneDirections: [{ direction: "fulfilled-11", fulfilled: true }] }),
    ]);

    expect(storedMemoryValue(rows, "recentlyFulfilled")).toEqual([
      "fulfilled-2",
      "fulfilled-3",
      "fulfilled-4",
      "fulfilled-5",
      "fulfilled-6",
      "fulfilled-7",
      "fulfilled-8",
      "fulfilled-9",
      "fulfilled-10",
      "fulfilled-11",
    ]);
  });

  it("persists pacing across multiple memory updates", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const storage = memoryStorage(rows);

    await persistSecretPlotAgentMemory(storage, "chat-1", [
      secretPlotResult({ pacing: { mode: "slow-burn", pressure: 0.35 }, sceneDirections: [] }),
    ]);
    await persistSecretPlotAgentMemory(storage, "chat-1", [
      secretPlotResult({ sceneDirections: [{ direction: "Hold the reveal.", fulfilled: false }] }),
    ]);

    expect(storedMemoryValue(rows, "pacing")).toEqual({ mode: "slow-burn", pressure: 0.35 });
    expect(await loadAgentMemory(storage, "secret-plot-config", "chat-1")).toMatchObject({
      pacing: { mode: "slow-burn", pressure: 0.35 },
    });
  });

  it("persists stale detection and exposes it in secret plot state", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const storage = memoryStorage(rows);

    await persistSecretPlotAgentMemory(storage, "chat-1", [
      secretPlotResult({ sceneDirections: [], staleDetected: true }),
    ]);

    const memory = await loadAgentMemory(storage, "secret-plot-config", "chat-1");
    expect(memory.staleDetected).toBe(true);
    expect(secretPlotStateFromMemory(memory)).toEqual({ staleDetected: true });
  });
});
