import { describe, expect, it, vi } from "vitest";

import type { StorageGateway, StorageListOptions } from "../capabilities/storage";
import type { AgentResult } from "../contracts/types/agent";
import { emptyNarrativeCraftState } from "./narrative-craft-state";
import {
  consumeConversationCraftPendingGuidance,
  consumeNarrativeCraftPendingGuidance,
  loadConversationCraftState,
  loadNarrativeCraftState,
  persistConversationCraftAgentMemory,
  persistNarrativeCraftAgentMemory,
} from "./agent-memory-runtime";

type Row = Record<string, unknown>;

function storageWithRows(seed: Record<string, Row[]>) {
  const rows = new Map(Object.entries(seed).map(([entity, values]) => [entity, values.map((row) => ({ ...row }))]));
  const creates: Array<{ entity: string; value: Row }> = [];
  const updates: Array<{ entity: string; id: string; patch: Row }> = [];

  const storage = {
    list: vi.fn(async (entity: string, options?: StorageListOptions) => {
      const values = rows.get(entity) ?? [];
      const filters = options && "filters" in options ? options.filters : undefined;
      if (!filters) return values;
      return values.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
    }),
    create: vi.fn(async (entity: string, value: Row) => {
      creates.push({ entity, value });
      rows.set(entity, [...(rows.get(entity) ?? []), { ...value }]);
      return value;
    }),
    update: vi.fn(async (entity: string, id: string, patch: Row) => {
      updates.push({ entity, id, patch });
      rows.set(
        entity,
        (rows.get(entity) ?? []).map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
      return patch;
    }),
  } as unknown as StorageGateway;

  return { storage, creates, updates };
}

function result(data: unknown, overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agentId: "builtin:narrative-craft",
    agentType: "narrative-craft",
    type: "context_injection",
    data,
    tokensUsed: 12,
    durationMs: 34,
    success: true,
    error: null,
    ...overrides,
  };
}

describe("Narrative Craft agent memory", () => {
  it("prefers current state over legacy Secret Plot memory", async () => {
    const current = { ...emptyNarrativeCraftState(), pacing: "turning" as const };
    const { storage } = storageWithRows({
      "agent-memory": [
        {
          id: "current",
          agentConfigId: "builtin:narrative-craft",
          chatId: "chat-1",
          key: "state",
          value: JSON.stringify(current),
        },
        {
          id: "legacy",
          agentConfigId: "secret-plot-driver",
          chatId: "chat-1",
          key: "overarchingArc",
          value: "Old arc",
        },
      ],
    });

    await expect(loadNarrativeCraftState(storage, "builtin:narrative-craft", "chat-1")).resolves.toEqual(current);
  });

  it("lazily converts legacy fallback and stored-config memory without deleting it", async () => {
    const { storage } = storageWithRows({
      agents: [{ id: "custom-secret", type: "secret-plot-driver" }],
      "agent-memory": [
        {
          id: "arc",
          agentConfigId: "custom-secret",
          chatId: "chat-1",
          key: "overarchingArc",
          value: JSON.stringify({ summary: "A debt comes due" }),
        },
        {
          id: "direction",
          agentConfigId: "custom-secret",
          chatId: "chat-1",
          key: "sceneDirections",
          value: JSON.stringify([{ direction: "Keep the creditor offstage.", fulfilled: false }]),
        },
      ],
    });

    await expect(loadNarrativeCraftState(storage, "builtin:narrative-craft", "chat-1")).resolves.toMatchObject({
      threads: [
        expect.objectContaining({ summary: "A debt comes due", kind: "main" }),
        expect.objectContaining({ summary: "Keep the creditor offstage.", kind: "subplot" }),
      ],
    });
    expect(storage.delete).toBeUndefined();
  });

  it("stores one normalized state value for a successful Narrative Craft result", async () => {
    const { storage, creates } = storageWithRows({ "agent-memory": [] });
    await persistNarrativeCraftAgentMemory(storage, "chat-1", [
      result({
        text: "",
        state: { pacing: "quiet", openQuestions: ["  Who knocked?  "] },
        reason: "State refreshed.",
        intervened: false,
      }),
    ]);

    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      entity: "agent-memory",
      value: {
        agentConfigId: "builtin:narrative-craft",
        chatId: "chat-1",
        key: "state",
      },
    });
    expect(JSON.parse(String(creates[0]?.value.value))).toMatchObject({
      version: 1,
      pacing: "quiet",
      openQuestions: ["Who knocked?"],
      pendingGuidance: [],
      lastAnalysisReason: "State refreshed.",
    });
  });

  it("stores one validated directive for the next generation", async () => {
    const { storage, creates } = storageWithRows({ "agent-memory": [] });

    await persistNarrativeCraftAgentMemory(storage, "chat-1", [
      result({
        text: "Avoid repeating the cited rhetorical shape.",
        state: {
          pacing: "quiet",
          lastGuidance: ["Avoid repeating the cited rhetorical shape."],
        },
        reason: "The same shape appeared twice.",
        intervened: true,
      }),
    ]);

    expect(JSON.parse(String(creates[0]?.value.value))).toMatchObject({
      lastGuidance: ["Avoid repeating the cited rhetorical shape."],
      pendingGuidance: ["Avoid repeating the cited rhetorical shape."],
    });
  });

  it("consumes pending guidance once without erasing the visible last guidance", async () => {
    const state = {
      ...emptyNarrativeCraftState(),
      lastGuidance: ["Vary the repeated sentence opening."],
      pendingGuidance: ["Vary the repeated sentence opening."],
    };
    const { storage, updates } = storageWithRows({
      "agent-memory": [
        {
          id: "state-row",
          agentConfigId: "builtin:narrative-craft",
          chatId: "chat-1",
          key: "state",
          value: JSON.stringify(state),
        },
      ],
    });

    await expect(
      consumeNarrativeCraftPendingGuidance(storage, "builtin:narrative-craft", "chat-1"),
    ).resolves.toBe("Vary the repeated sentence opening.");
    await expect(
      consumeNarrativeCraftPendingGuidance(storage, "builtin:narrative-craft", "chat-1"),
    ).resolves.toBeNull();

    expect(updates).toHaveLength(1);
    expect(JSON.parse(String(updates[0]?.patch.value))).toMatchObject({
      lastGuidance: ["Vary the repeated sentence opening."],
      pendingGuidance: [],
    });
  });

  it("finds pending guidance stored under a configured Narrative Craft row", async () => {
    const state = {
      ...emptyNarrativeCraftState(),
      lastGuidance: ["Leave the image unexplained."],
      pendingGuidance: ["Leave the image unexplained."],
    };
    const { storage, updates } = storageWithRows({
      agents: [{ id: "configured-craft", type: "narrative-craft" }],
      "agent-memory": [
        {
          id: "configured-state",
          agentConfigId: "configured-craft",
          chatId: "chat-1",
          key: "state",
          value: JSON.stringify(state),
        },
      ],
    });

    await expect(
      consumeNarrativeCraftPendingGuidance(storage, "builtin:narrative-craft", "chat-1"),
    ).resolves.toBe("Leave the image unexplained.");
    expect(updates).toEqual([
      expect.objectContaining({ entity: "agent-memory", id: "configured-state" }),
    ]);
  });

  it("updates an existing state row and ignores failed or unrelated results", async () => {
    const { storage, creates, updates } = storageWithRows({
      "agent-memory": [
        {
          id: "state-row",
          agentConfigId: "builtin:narrative-craft",
          chatId: "chat-1",
          key: "state",
          value: "{}",
        },
      ],
    });

    await persistNarrativeCraftAgentMemory(storage, "chat-1", [
      result({ state: { pacing: "aftermath" } }, { success: false }),
      result({ state: { pacing: "building" } }, { agentType: "continuity" }),
      result({ state: { pacing: "aftermath" } }),
    ]);

    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ entity: "agent-memory", id: "state-row" });
    expect(JSON.parse(String(updates[0]?.patch.value))).toMatchObject({ version: 1, pacing: "aftermath" });
  });
});

describe("Conversation Craft agent memory", () => {
  const conversationResult = (data: unknown, overrides: Partial<AgentResult> = {}): AgentResult =>
    result(data, {
      agentId: "builtin:conversation-craft",
      agentType: "conversation-craft",
      ...overrides,
    });

  it("stores normalized state and one validated directive", async () => {
    const { storage, creates } = storageWithRows({ "agent-memory": [] });

    await persistConversationCraftAgentMemory(storage, "chat-1", [
      conversationResult({
        text: "Leave more implied in the next reply.",
        state: {
          conversationMode: "group",
          recentPatterns: ["  answers every point  "],
          recentStrengths: ["distinct slang"],
        },
        reason: "The group response was too comprehensive.",
        intervened: true,
      }),
    ]);

    expect(creates).toHaveLength(1);
    expect(JSON.parse(String(creates[0]?.value.value))).toEqual({
      version: 1,
      conversationMode: "group",
      recentPatterns: ["answers every point"],
      recentStrengths: ["distinct slang"],
      pendingGuidance: ["Leave more implied in the next reply."],
      lastAnalysisReason: "The group response was too comprehensive.",
    });
  });

  it("loads and consumes pending guidance once", async () => {
    const state = {
      version: 1,
      conversationMode: "solo",
      recentPatterns: ["therapy language"],
      recentStrengths: [],
      pendingGuidance: ["React without canned validation."],
      lastAnalysisReason: "Voice drifted.",
    };
    const { storage, updates } = storageWithRows({
      "agent-memory": [
        {
          id: "conversation-state",
          agentConfigId: "builtin:conversation-craft",
          chatId: "chat-1",
          key: "state",
          value: JSON.stringify(state),
        },
      ],
    });

    await expect(loadConversationCraftState(storage, "builtin:conversation-craft", "chat-1")).resolves.toEqual(
      state,
    );
    await expect(
      consumeConversationCraftPendingGuidance(storage, "builtin:conversation-craft", "chat-1"),
    ).resolves.toBe("React without canned validation.");
    await expect(
      consumeConversationCraftPendingGuidance(storage, "builtin:conversation-craft", "chat-1"),
    ).resolves.toBeNull();
    expect(updates).toHaveLength(1);
  });

  it("finds configured memory and ignores failed or malformed results", async () => {
    const { storage, creates, updates } = storageWithRows({
      agents: [{ id: "configured-conversation-craft", type: "conversation-craft" }],
      "agent-memory": [
        {
          id: "configured-state",
          agentConfigId: "configured-conversation-craft",
          chatId: "chat-1",
          key: "state",
          value: JSON.stringify({
            version: 1,
            conversationMode: "group",
            pendingGuidance: ["Keep the voices distinct."],
          }),
        },
      ],
    });

    await persistConversationCraftAgentMemory(storage, "chat-1", [
      conversationResult({ state: {} }, { success: false }),
      conversationResult({ text: "bad", state: null, intervened: true }),
    ]);
    await expect(
      consumeConversationCraftPendingGuidance(storage, "builtin:conversation-craft", "chat-1"),
    ).resolves.toBe("Keep the voices distinct.");
    expect(creates).toHaveLength(0);
    expect(updates).toEqual([expect.objectContaining({ id: "configured-state" })]);
  });
});
